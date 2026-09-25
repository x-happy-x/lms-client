// Service worker: settings, per-tab findings, context menus, download interception,
// media sniffing and sending links to the LMS router.
import { shouldIntercept, downloadKind, sniffKind } from './lib/intercept.js'
import { displayName, isHttp, isMagnet, isVideoHost, normalizeCandidates, normalizeRouterUrl } from './lib/links.js'
import { DEFAULT_SETTINGS, health, sendToRouter } from './lib/router.js'

const TYPE_LABEL = { DIRECT: 'HTTP', YTDLP: 'yt-dlp', ARIA2C: 'aria2c', TORRENT: 'торрент' }
const SNIFF_LIMIT = 60

// Settings are read synchronously in onCreated, so keep a cached copy.
let settings = { ...DEFAULT_SETTINGS }
const ready = chrome.storage.sync.get(DEFAULT_SETTINGS).then((value) => {
  settings = { ...DEFAULT_SETTINGS, ...value }
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return
  for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue ?? DEFAULT_SETTINGS[key]
})

// ---- per-tab findings (memory + storage.session so a restarted worker keeps them) ----

const tabs = new Map()
const dirty = new Set()
let flushTimer = 0

async function tabState(tabId) {
  let state = tabs.get(tabId)
  if (!state) {
    const key = `tab:${tabId}`
    const stored = (await chrome.storage.session.get(key))[key]
    state = tabs.get(tabId) || stored || { pageUrl: '', title: '', frames: {}, sniffed: [] }
    tabs.set(tabId, state)
  }
  return state
}

function touch(tabId) {
  dirty.add(tabId)
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = 0
      const batch = {}
      for (const id of dirty) if (tabs.has(id)) batch[`tab:${id}`] = tabs.get(id)
      dirty.clear()
      chrome.storage.session.set(batch).catch(() => {})
    }, 400)
  }
  updateBadge(tabId)
}

function itemsOf(state) {
  const raw = [...Object.values(state.frames).flat(), ...state.sniffed]
  return normalizeCandidates(raw, state.pageUrl)
}

function updateBadge(tabId) {
  const state = tabs.get(tabId)
  const count = state ? itemsOf(state).length : 0
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' }).catch(() => {})
  chrome.action.setBadgeText({ tabId, text: count ? String(Math.min(count, 99)) : '' }).catch(() => {})
}

function resetTab(tabId, pageUrl = '') {
  tabs.set(tabId, { pageUrl, title: '', frames: {}, sniffed: [] })
  touch(tabId)
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' && change.url) resetTab(tabId, change.url)
})
chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId)
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {})
})

// ---- sending ----

function notify(title, message, buttonUrl) {
  if (!settings.notifications) return
  const id = `lms-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const options = { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 0 }
  if (buttonUrl) options.buttons = [{ title: 'Скачать в браузере' }]
  chrome.notifications.create(id, options).catch(() => {})
  if (buttonUrl) chrome.storage.session.set({ [`notif:${id}`]: buttonUrl }).catch(() => {})
}

chrome.notifications.onButtonClicked.addListener(async (id) => {
  const key = `notif:${id}`
  const url = (await chrome.storage.session.get(key))[key]
  if (url) chrome.downloads.download({ url }).catch(() => {})
  chrome.notifications.clear(id)
})

async function sendUrl(url, { type, maxSpeedBytes, fallbackDownload = false, quiet = false } = {}) {
  await ready
  url = (url || '').trim()
  if (!isMagnet(url) && !isHttp(url)) throw new Error('Нужна http(s)- или magnet-ссылка')
  try {
    const { job, plan } = await sendToRouter(settings, url, { type, maxSpeedBytes })
    if (!quiet) {
      notify(
        'Отправлено в LMS',
        `${displayName(url)}\n${plan.nodeName || 'нода'} · ${TYPE_LABEL[plan.type] || plan.type}`,
        fallbackDownload && isHttp(url) ? url : undefined
      )
    }
    return { ok: true, jobId: job?.id, type: plan.type, nodeName: plan.nodeName }
  } catch (error) {
    if (fallbackDownload && isHttp(url)) {
      chrome.downloads.download({ url }).catch(() => {})
      notify('LMS недоступен — качаю в браузере', `${displayName(url)}\n${error.message}`)
    } else if (!quiet) {
      notify('Не удалось отправить в LMS', `${displayName(url)}\n${error.message}`)
    }
    return { ok: false, error: error.message }
  }
}

// ---- download interception ----

chrome.downloads.onCreated.addListener(async (item) => {
  await ready
  const routerBase = normalizeRouterUrl(settings.routerUrl)
  if (!shouldIntercept(settings, item, routerBase, chrome.runtime.id)) return
  try {
    await chrome.downloads.cancel(item.id)
    await chrome.downloads.erase({ id: item.id })
  } catch {
    return // already finished or removed: leave it to the browser
  }
  const url = item.finalUrl || item.url
  // Torrent files go by URL too: the node fetches the .torrent and starts the swarm.
  const type = downloadKind(item) === 'torrent' ? 'TORRENT' : undefined
  await sendUrl(url, { type, fallbackDownload: true })
})

// ---- network sniffing of media streams ----

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!settings.sniffMedia || details.tabId < 0) return
    const header = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === 'content-type')
    const kind = sniffKind(details.url, header?.value, details.type)
    if (!kind) return
    tabState(details.tabId).then((state) => {
      if (state.sniffed.some((item) => item.url === details.url)) return
      state.sniffed.push({ url: details.url, source: kind === 'audio' ? 'audio' : 'video', name: '' })
      if (state.sniffed.length > SNIFF_LIMIT) state.sniffed.shift()
      touch(details.tabId)
    })
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
)

// ---- context menus and shortcut ----

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'lms-link', title: 'Скачать через LMS', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'lms-media', title: 'Скачать это медиа через LMS', contexts: ['video', 'audio'] })
    chrome.contextMenus.create({ id: 'lms-page', title: 'Отправить страницу в LMS (yt-dlp)', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'lms-selection', title: 'Отправить выделенную ссылку в LMS', contexts: ['selection'] })
  })
  if (details.reason === 'install') chrome.runtime.openOptionsPage()
})

function firstLink(text) {
  const match = /(magnet:\?[^\s"'<>]+|https?:\/\/[^\s"'<>]+)/i.exec(text || '')
  return match ? match[1] : ''
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const page = info.pageUrl || tab?.url || ''
  if (info.menuItemId === 'lms-link') void sendUrl(info.linkUrl)
  if (info.menuItemId === 'lms-page') void sendUrl(page, { type: 'YTDLP' })
  if (info.menuItemId === 'lms-selection') void sendUrl(firstLink(info.selectionText))
  if (info.menuItemId === 'lms-media') {
    // MSE players expose blob: sources; the page itself is what yt-dlp can resolve.
    if (isHttp(info.srcUrl)) void sendUrl(info.srcUrl)
    else void sendUrl(page, { type: 'YTDLP' })
  }
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'send-page') return
  const current = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (current?.url) void sendUrl(current.url, { type: 'YTDLP' })
})

// ---- messages from content scripts and the popup ----

async function onMessage(message, sender) {
  switch (message?.type) {
    case 'scan': {
      const tabId = sender.tab?.id
      if (tabId == null) return null
      const state = await tabState(tabId)
      if (sender.frameId === 0) {
        if (state.pageUrl && state.pageUrl !== message.pageUrl && new URL(state.pageUrl).pathname !== new URL(message.pageUrl).pathname) {
          state.sniffed = [] // SPA navigation to another page
        }
        state.pageUrl = message.pageUrl
        state.title = message.title
      }
      state.frames[sender.frameId || 0] = message.items.slice(0, 500)
      touch(tabId)
      return null
    }
    case 'send':
      return sendUrl(message.url, { type: message.linkType, maxSpeedBytes: message.maxSpeedBytes, quiet: message.quiet })
    case 'getTab': {
      const state = await tabState(message.tabId)
      const pageUrl = state.pageUrl || message.pageUrl || ''
      return { pageUrl, title: state.title || message.title || '', videoHost: isVideoHost(pageUrl), items: itemsOf({ ...state, pageUrl }) }
    }
    case 'health':
      await ready
      try {
        await health(message.settings ? { ...settings, ...message.settings } : settings)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    default:
      return null
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  onMessage(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }))
  return true
})
