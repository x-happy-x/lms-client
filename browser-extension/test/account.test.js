import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { accountOrigin, verifyCallback, readAccount, routerSettings, loginAccount, logoutAccount, statusAccount } from '../lib/account.js'
import { authHeaders, health } from '../lib/router.js'

const settings = { routerUrl: 'https://lms.example', accountUrl: 'https://account.example' }
const redirect = 'https://acehojonpkjinnelheepaajgjbeejbff.chromiumapp.org/account'
const token = `kat_${'a'.repeat(48)}`
const user = { login: 'tester', name: 'Тест', role: 'editor' }
let values = {}, session = {}, consent
const memory = source => ({
  get: async key => key === null ? { ...source() } : { [key]: source()[key] },
  set: async batch => Object.assign(source(), batch),
  remove: async keys => { for (const key of [].concat(keys)) delete source()[key] }
})
globalThis.chrome = {
  storage: { local: memory(() => values), session: memory(() => session) },
  runtime: { sendMessage: async () => {} },
  identity: {
    getRedirectURL: () => redirect,
    launchWebAuthFlow: async ({ url, interactive }) => {
      assert.equal(interactive, true)
      consent = new URL(url)
      return `${redirect}?state=${consent.searchParams.get('state')}&code=${'c'.repeat(43)}`
    }
  }
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('manifest public key keeps the callback extension ID stable', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)))
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  const id = [...digest].map(value => String.fromCharCode(97 + parseInt(value, 16))).join('')
  assert.equal(id, new URL(redirect).hostname.split('.')[0])
  assert.ok(manifest.permissions.includes('identity'))
})
function fixture({ expires = 3600, routerStatus = 200 } = {}) {
  const calls = []
  const fetch = async (raw, init) => {
    calls.push({ raw, init })
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    const url = new URL(raw)
    if (url.pathname === '/api/ui/auth/config') return response({ enabled: true, accountOrigin: settings.accountUrl })
    if (url.pathname === '/api/extensions/token') {
      const body = JSON.parse(init.body)
      assert.equal(body.client_id, 'lms-extension')
      assert.equal(body.redirect_uri, redirect)
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), consent.searchParams.get('code_challenge'))
      return response({ access_token: token, token_type: 'Bearer', expires_in: expires })
    }
    assert.equal(init.headers.Authorization, `Bearer ${token}`)
    if (init.method === 'DELETE') return response({ ok: true })
    return response(routerStatus === 200 ? { enabled: true, user } : { error: 'Доступ отозван' }, routerStatus)
  }
  return { fetch, calls }
}

test('Account validates exact HTTPS origins and identity callback state', () => {
  assert.equal(accountOrigin('https://account.example/'), settings.accountUrl)
  for (const url of ['http://account.example', 'https://user:pass@account.example', 'https://account.example/path', 'https://account.example?x=1']) assert.throws(() => accountOrigin(url))
  assert.equal(accountOrigin('http://127.0.0.1:4567'), 'http://127.0.0.1:4567')
  const code = 'c'.repeat(43), state = 's'.repeat(43)
  assert.equal(verifyCallback(`${redirect}?state=${state}&code=${code}`, redirect, state), code)
  for (const url of [`${redirect}?state=wrong&code=${code}`, `${redirect}?state=${state}&state=${state}&code=${code}`, `https://evil.example/account?state=${state}&code=${code}`, `${redirect}?state=${state}&error=access_denied`, `${redirect}?state=${state}&code=${code}#secret`]) assert.throws(() => verifyCallback(url, redirect, state))
})

test('login uses PKCE and stores a scoped token locally; logout revokes and clears private cache', async () => {
  values = {}; session = { 'extract:1': { private: true }, 'tab:1': {} }
  const { fetch, calls } = fixture()
  assert.deepEqual(await loginAccount(settings, fetch), { ok: true, user })
  assert.equal(values.lmsAccount.token, token)
  assert.equal(values.lmsAccount.router, settings.routerUrl)
  assert.ok(values.lmsAccount.expiresAt > Date.now())
  assert.equal(session['extract:1'], undefined)
  assert.ok(session['tab:1'])
  assert.equal((await readAccount(settings)).user.login, 'tester')
  assert.equal(await readAccount({ ...settings, routerUrl: 'https://other.example' }), null)
  assert.equal(await readAccount({ ...settings, accountUrl: 'https://other.example' }), null)
  const auth = await routerSettings(settings)
  assert.equal(authHeaders({ ...auth, username: 'legacy', password: 'legacy' }).Authorization, `Bearer ${token}`)
  assert.deepEqual((await statusAccount(settings, fetch)).user, user)
  session['extract:1'] = { private: true }
  // Revoke the saved session even if the router address has since changed.
  await logoutAccount({ ...settings, routerUrl: 'https://other.example' }, fetch)
  assert.equal(values.lmsAccount, undefined)
  assert.equal(session['extract:1'], undefined)
  assert.equal(calls.at(-1).raw, `${settings.accountUrl}/api/extensions/session`)
  assert.equal(calls.at(-1).init.method, 'DELETE')
})

test('expired/revoked tokens are dropped and a failed router confirmation revokes the minted token', async () => {
  values = { lmsAccount: { router: settings.routerUrl, account: settings.accountUrl, token, expiresAt: Date.now() - 1 } }
  assert.equal(await readAccount(settings), null)
  values.lmsAccount.expiresAt = Date.now() + 10000
  session = { 'extract:2': {} }
  const rejected = fixture({ routerStatus: 401 })
  const status = await statusAccount(settings, rejected.fetch)
  assert.equal(status.user, null)
  assert.equal(values.lmsAccount, undefined)
  assert.deepEqual(session, {})
  await assert.rejects(loginAccount(settings, rejected.fetch), /Доступ отозван/)
  assert.equal(rejected.calls.at(-1).init.method, 'DELETE')
  assert.equal(values.lmsAccount, undefined)
  const invalid = fixture({ expires: -1 })
  await assert.rejects(loginAccount(settings, invalid.fetch), /срок доступа/)
  assert.equal(invalid.calls.at(-1).init.method, 'DELETE')
})

test('API never treats an HTML login page as healthy and a 401 clears the current session', async () => {
  await assert.rejects(health(settings, async () => new Response('<html>Login</html>')), /страницу вместо API/)
  values = { lmsAccount: { router: settings.routerUrl, account: settings.accountUrl, token, expiresAt: Date.now() + 10000 } }
  const auth = await routerSettings(settings)
  await assert.rejects(health(auth, async () => response({ error: 'Войдите' }, 401)), /Войдите/)
  assert.equal(values.lmsAccount, undefined)
  // A request from the old session must not clear a newer login.
  values = { lmsAccount: { router: settings.routerUrl, account: settings.accountUrl, token: token.replace('a', 'b'), expiresAt: Date.now() + 10000 } }
  await auth.onUnauthorized()
  assert.ok(values.lmsAccount)
})
