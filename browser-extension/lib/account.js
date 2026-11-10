import { normalizeRouterUrl } from './links.js'

const KEY = 'lmsAccount'
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

async function clearExtracts() {
  const values = await chrome.storage.session.get(null)
  await chrome.storage.session.remove(Object.keys(values).filter(key => key.startsWith('extract:')))
}

async function forgetAccount() {
  await chrome.storage.local.remove(KEY)
  await clearExtracts()
  chrome.runtime.sendMessage({ type: 'accountChanged' }).catch(() => {})
}

export function accountOrigin(raw) {
  const url = new URL(raw)
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Для Account нужен HTTPS-адрес без пути; HTTP разрешён только на localhost')
  }
  return url.origin
}

export function verifyCallback(raw, expected, state) {
  const url = new URL(raw)
  const target = new URL(expected)
  if (url.origin !== target.origin || url.pathname !== target.pathname || url.hash || url.searchParams.get('state') !== state || url.searchParams.getAll('state').length !== 1) {
    throw new Error('Account вернул неверный адрес или state')
  }
  if (url.searchParams.has('error')) throw new Error('Вход отменён')
  const code = url.searchParams.get('code')
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code || '') || url.searchParams.getAll('code').length !== 1) throw new Error('Account не вернул код входа')
  return code
}

async function jsonRequest(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, redirect: 'error', credentials: 'omit', headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const raw = await response.text()
  let body
  try { body = JSON.parse(raw) } catch { throw new Error('Вместо API получена страница входа. Проверьте адрес LMS и Account.') }
  if (!response.ok) {
    const error = new Error(body?.error || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return body
}

export async function readAccount(settings) {
  const saved = (await chrome.storage.local.get(KEY))[KEY]
  if (!saved || saved.router !== normalizeRouterUrl(settings.routerUrl) || saved.account !== accountOrigin(settings.accountUrl) || saved.expiresAt <= Date.now()) return null
  return saved
}

export async function routerSettings(settings) {
  const saved = await readAccount(settings)
  return { ...settings, accountToken: saved?.token, accountSession: saved?.expiresAt || 0,
    onUnauthorized: async () => {
      if (saved && (await chrome.storage.local.get(KEY))[KEY]?.token === saved.token) await forgetAccount()
    }
  }
}

export async function statusAccount(settings, fetchImpl = fetch) {
  const router = normalizeRouterUrl(settings.routerUrl)
  if (!router) return { ok: true, enabled: false, user: null, message: 'Укажите адрес LMS' }
  const configuration = await jsonRequest(`${router}/api/ui/auth/config`, {}, fetchImpl)
  if (!configuration.enabled) return { ok: true, enabled: false, user: null, message: 'Вход через Account не включён на роутере' }
  if (accountOrigin(configuration.accountOrigin) !== accountOrigin(settings.accountUrl)) throw new Error('Адрес Account отличается от настроек роутера')
  const saved = await readAccount(settings)
  if (!saved) return { ok: true, enabled: true, user: null }
  try {
    const session = await jsonRequest(`${router}/api/ui/auth/session`, { headers: { Authorization: `Bearer ${saved.token}` } }, fetchImpl)
    return { ok: true, enabled: true, user: session.user }
  } catch (error) {
    if ([401, 403].includes(error.status)) { await forgetAccount(); return { ok: true, enabled: true, user: null, message: error.message } }
    throw error
  }
}

export async function loginAccount(settings, fetchImpl = fetch) {
  const router = normalizeRouterUrl(settings.routerUrl), account = accountOrigin(settings.accountUrl)
  if (!router) throw new Error('Сначала укажите адрес LMS')
  const configuration = await jsonRequest(`${router}/api/ui/auth/config`, {}, fetchImpl)
  if (!configuration.enabled) throw new Error('Обновите LMS и включите ROUTERD_ACCOUNT_ORIGIN на роутере')
  if (accountOrigin(configuration.accountOrigin) !== account) throw new Error('Account в настройках расширения отличается от Account на роутере')
  const redirect = chrome.identity.getRedirectURL('account'), state = random(), verifier = random()
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const url = new URL(`${account}/extensions/authorize`)
  url.search = new URLSearchParams({ client_id: 'lms-extension', redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
  const callback = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true })
  const code = verifyCallback(callback, redirect, state)
  const tokens = await jsonRequest(`${account}/api/extensions/token`, { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', client_id: 'lms-extension', redirect_uri: redirect, code, code_verifier: verifier }) }, fetchImpl)
  if (!/^kat_[0-9a-f]{48}$/.test(tokens.access_token || '') || tokens.token_type !== 'Bearer') throw new Error('Account вернул некорректный токен')
  const token = tokens.access_token
  try {
    const expires = Number(tokens.expires_in)
    if (!Number.isFinite(expires) || expires <= 0) throw new Error('Account вернул некорректный срок доступа')
    const session = await jsonRequest(`${router}/api/ui/auth/session`, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl)
    if (!session.enabled || !session.user?.login) throw new Error('LMS не подтвердил авторизацию')
    await logoutAccount(settings, fetchImpl).catch(() => {})
    await clearExtracts()
    await chrome.storage.local.set({ [KEY]: { router, account, token, user: session.user, expiresAt: Date.now() + Math.min(expires, 30 * 86400) * 1000 } })
    chrome.runtime.sendMessage({ type: 'accountChanged' }).catch(() => {})
    return { ok: true, user: session.user }
  } catch (error) {
    await jsonRequest(`${account}/api/extensions/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, fetchImpl).catch(() => {})
    throw error
  }
}

export async function logoutAccount(settings, fetchImpl = fetch) {
  const saved = (await chrome.storage.local.get(KEY))[KEY]
  await forgetAccount()
  if (saved && /^kat_[0-9a-f]{48}$/.test(saved.token)) await jsonRequest(`${accountOrigin(saved.account)}/api/extensions/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${saved.token}` } }, fetchImpl)
  return { ok: true }
}
