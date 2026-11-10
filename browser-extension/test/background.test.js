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

test('a website content script cannot start login, inspect the Account session or open a preview tab', async () => {
  for (const type of ['accountLogin', 'accountLogout', 'accountStatus', 'preview', 'prepareStream', 'mediaInfo', 'jobProgress']) {
    const result = await message({ type }, { url: 'https://example.com', tab: { id: 1 } })
    assert.equal(result.ok, false)
    assert.match(result.error, /только из окна расширения/)
  }
})

test('an authentication challenge is reported separately from a connection failure', async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Войдите через Account' }), { status: 401 })
    const result = await message({ type: 'health', settings: { routerUrl: 'https://lms.example' } })
    assert.deepEqual(result, { ok: false, error: 'Войдите через Account', authRequired: true })
  } finally { globalThis.fetch = previous }
})

test('discovery filters merge DOM/network metadata and settings reveal retained findings immediately', async () => {
  await scan(60, 'https://example.com/watch', [
    { url: '/large.mp4', sizeBytes: 2 * 1024 ** 2 },
    { url: '/small.mp4', sizeBytes: 100 },
    { url: '/track.MP3?token=1', sizeBytes: 8 * 1024 ** 2 },
    { url: '/unknown.webm' }
  ])
  await sniff(60, 'https://cdn.example/audio?id=1', 'audio/mpeg')
  chrome.webRequest.onHeadersReceived.listeners[0]({ tabId: 60, url: 'https://cdn.example/range.mp4', statusCode: 206, type: 'media', responseHeaders: [
    { name: 'Content-Type', value: 'video/mp4' }, { name: 'Content-Length', value: '100' }, { name: 'Content-Range', value: 'bytes 0-99/2097152' }
  ] })
  await sniff(60, 'https://cdn.example/manifest.m3u8', 'application/vnd.apple.mpegurl')
  let result = await findings(60)
  assert.equal(result.hiddenCount, 3)
  assert.equal(result.items.length, 4)
  assert.ok(result.items.some(item => item.url.endsWith('range.mp4') && item.sizeBytes === 2097152))
  chrome.storage.onChanged.listeners[0]({ discoveryIgnoredExtensions: { newValue: [] }, discoveryMinMb: { newValue: 0 } }, 'sync')
  result = await findings(60)
  assert.equal(result.items.length, 7)
  assert.equal(result.hiddenCount, 0)
  chrome.storage.onChanged.listeners[0]({ discoveryIgnoredExtensions: { newValue: ['mp3'] }, discoveryMinMb: { newValue: 1 } }, 'sync')
  assert.equal((await findings(60)).hiddenCount, 3)
})

test('forbidden access is distinguished from an offline router', async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Нет доступа к LMS' }), { status: 403 })
    const result = await message({ type: 'health', settings: { routerUrl: 'https://lms.example' } })
    assert.equal(result.accessDenied, true)
    assert.equal(result.authRequired, false)
  } finally { globalThis.fetch = previous }
})

test('VK player context associates CDN tracks with its canonical source and clears on navigation', async () => {
 await message({type:'scan',pageUrl:'https://yandex.ru/video/preview/123',title:'Selected video',mediaSourceUrl:'https://vk.com/video-1_2?sh=4',context:{thumbnail:'https://example.com/poster.jpg'},items:[]},{tab:{id:80},frameId:0})
 await sniff(80,'https://vk2-4.vkuser.net/?mid=1&id=2&sig=one','audio/webm')
 await sniff(80,'https://vk2-4.vkuser.net/?mid=1&id=2&sig=two','audio/webm')
 const state=await findings(80)
 assert.equal(state.mediaSourceUrl,'https://vkvideo.ru/video-1_2')
 assert.equal(state.items.length,0);assert.equal(state.hiddenCount,0)
 assert.equal(state.currentVideo.title,'Selected video');assert.equal(state.currentVideo.thumbnail,'https://example.com/poster.jpg')
 await scan(80,'https://yandex.ru/video/preview/456',[])
 assert.equal((await findings(80)).mediaSourceUrl,'');assert.deepEqual((await findings(80)).items,[])
})

test('identified videos survive SPA navigation independently while music stays separate', async () => {
 const previous=globalThis.fetch
 chrome.storage.onChanged.listeners[0]({routerUrl:{newValue:'https://lms.example'}},'sync')
 globalThis.fetch=async(url,init)=>new Response(JSON.stringify({kind:'video',url:JSON.parse(init.body).url,title:JSON.parse(init.body).url.includes('video-1_2')?'First lesson':'Second lesson',durationSeconds:120,entries:[]}))
 try{
  await scan(91,'https://vkvideo.ru/video-1_2',[])
  await message({type:'extract',tabId:91,url:'https://vkvideo.ru/video-1_2'})
  await scan(91,'https://vkvideo.ru/video-1_3',[])
  await sniff(91,'https://vkvd217.okcdn.ru/video.webm?id=video-audio','audio/webm')
  await sniff(91,'https://music.userapi.com/track.m4a','audio/mp4')
  await message({type:'extract',tabId:91,url:'https://vkvideo.ru/video-1_3'})
  let state=await findings(91)
  assert.equal(state.videos.length,2);assert.equal(state.items.length,1)
  assert.equal(state.items[0].url,'https://music.userapi.com/track.m4a')
  assert.equal(state.videos[0].title,'Second lesson');assert.equal(state.videos[1].title,'First lesson')
  await message({type:'extract',tabId:91,url:'https://vkvideo.ru/video-1_2?sh=4'})
  assert.equal((await findings(91)).videos.length,2,'revisiting a video must reuse its card')
  chrome.tabs.onUpdated.listeners[0](91,{url:'https://vkvideo.ru/video-1_4'},{})
  state=await findings(91);assert.equal(state.videos.length,2)
  chrome.tabs.onRemoved.listeners[0](91)
  assert.equal(values['videos:91'],undefined)
 }finally{globalThis.fetch=previous;chrome.storage.onChanged.listeners[0]({routerUrl:{newValue:''}},'sync')}
})
