import assert from 'node:assert/strict'
import { test } from 'node:test'

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn) } })
const values = {}
const storage = {
  async get(key) { return typeof key === 'string' ? { [key]: values[key] } : { ...key } },
  async set(batch) { Object.assign(values, batch) },
  async remove(keys) { for (const key of [].concat(keys)) delete values[key] }
}
const messages = []
globalThis.chrome = {
  storage: { sync: storage, session: storage, local: { ...storage, setAccessLevel: async () => {} }, onChanged: event() },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  runtime: { onMessage: event(), onInstalled: event(), sendMessage: async (message) => messages.push(message), getURL: path => `chrome-extension://test/${path}` },
  tabs: { onUpdated: event(), onRemoved: event(), sendMessage: async () => {} },
  webRequest: { onHeadersReceived: event() },
  downloads: { onCreated: event() },
  notifications: { onButtonClicked: event() },
  contextMenus: { onClicked: event() },
  commands: { onCommand: event() }
}
await import('../background.js')
const message = (body, sender = {}) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](body, sender, resolve))
const scan = (tabId, pageUrl, items, frameId = 0) => message({ type: 'scan', pageUrl, title: 'Page', items }, { tab: { id: tabId }, frameId })
const findings = (tabId) => message({ type: 'getTab', tabId })
const sniff = async (tabId, url, contentType) => {
  chrome.webRequest.onHeadersReceived.listeners[0]({
    tabId, url, statusCode: 200, type: 'xmlhttprequest',
    responseHeaders: [{ name: 'Content-Type', value: contentType }]
  })
  await new Promise(setImmediate)
}

test('worker combines iframe media and network manifests and announces live changes', async () => {
  await scan(10, 'https://example.com/watch', [])
  await scan(10, 'https://player.example.com', [{ url: 'https://cdn.example.com/v.mp4', source: 'video', durationSeconds: 65 }], 1)
  await sniff(10, 'https://cdn.example.com/manifest?id=1', 'application/dash+xml')
  const state = await findings(10)
  assert.equal(state.items.length, 2)
  assert.equal(state.items.find((item) => item.kind === 'stream').url, 'https://cdn.example.com/manifest?id=1')
  assert.equal(state.items[0].durationSeconds, 65)
  assert.ok(messages.some((item) => item.type === 'tabChanged' && item.tabId === 10))
})

test('reload and query-only SPA navigation discard findings from the previous page', async () => {
  await scan(20, 'https://example.com/watch?v=1', [{ url: '/a.mp4', source: 'video' }])
  await scan(20, 'https://player.example.com', [{ url: 'https://cdn.example.com/old.mp4', source: 'video' }], 1)
  await sniff(20, 'https://cdn.example.com/old.m3u8', 'application/vnd.apple.mpegurl')
  await scan(20, 'https://example.com/watch?v=2', [])
  assert.deepEqual((await findings(20)).items, [])
  await scan(20, 'https://example.com/watch?v=2', [{ url: '/b.mp4', source: 'video' }])
  chrome.tabs.onUpdated.listeners[0](20, { status: 'loading' }, { url: 'https://example.com/watch?v=2' })
  assert.deepEqual((await findings(20)).items, [])
})

test('a website content script cannot start login, logout or inspect the Account session', async () => {
  for (const type of ['accountLogin', 'accountLogout', 'accountStatus']) {
    const result = await message({ type }, { url: 'https://example.com', tab: { id: 1 } })
    assert.equal(result.ok, false)
    assert.match(result.error, /только из окна расширения/)
  }
})
