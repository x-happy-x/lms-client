// Service worker: settings, per-tab findings, context menus, download interception,
// media sniffing and sending links to the LMS router.
import { shouldIntercept, downloadKind, sniffCandidate } from './lib/intercept.js'
import { displayName, isHttp, isMagnet, isVideoHost, kindOf, normalizeCandidates, normalizeRouterUrl } from './lib/links.js'
import { DEFAULT_SETTINGS, extractMedia, health, listNodes, storageTargets, sendToRouter, mediaInfo, prepareMedia, listJobs } from './lib/router.js'
import { videoOptions } from './lib/preferences.js'
import { canonicalVideoPage, dedupeVkMedia, isVkMedia } from './lib/media-source.js'
import { routerSettings, loginAccount, logoutAccount, statusAccount } from './lib/account.js'
import { filterDiscoveries } from './lib/discovery-filter.js'
import { openPreview, forgetPreview } from './lib/preview.js'

const TYPE_LABEL = { DIRECT: 'HTTP', YTDLP: 'yt-dlp', ARIA2C: 'aria2c', TORRENT: 'торрент' }
const SNIFF_LIMIT = 60

// Settings are read synchronously in onCreated, so keep a cached copy.
let settings = { ...DEFAULT_SETTINGS }
const ready = chrome.storage.sync.get(DEFAULT_SETTINGS).then(async (value) => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  settings = { ...DEFAULT_SETTINGS, ...value }
  for (const id of tabs.keys()) touch(id)
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return
  for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue ?? DEFAULT_SETTINGS[key]
  if (['discoveryIgnoredExtensions', 'discoveryMinMb'].some(key => key in changes)) {
    for (const id of tabs.keys()) touch(id)
  }
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
  chrome.runtime.sendMessage({ type: 'tabChanged', tabId }).catch(() => {})
}

function itemsOf(state) {
  const raw = [...Object.values(state.frames).flat(), ...state.sniffed]
  return filterDiscoveries(dedupeVkMedia(normalizeCandidates(raw, state.pageUrl)), settings)
}

function findingsOf(state) {
  const all = dedupeVkMedia(normalizeCandidates([...Object.values(state.frames).flat(), ...state.sniffed], state.pageUrl))
  const sources = Object.values(state.sources || {}).filter(Boolean)
  const unique = [...new Set(sources)]
  const mediaSourceUrl = state.sources?.[0] || (unique.length === 1 ? unique[0] : '')
  if (mediaSourceUrl) for (const item of all) if (isVkMedia(item.url)) {
    item.name = `${state.title || 'VK Видео'} · ${item.kind === 'audio' ? 'аудиодорожка' : 'поток проигрывателя'}`
    const poster = Object.values(state.contexts || {}).find(context => context?.thumbnail)?.thumbnail
    if (poster) item.thumbnail = poster
  }
  const items = filterDiscoveries(all, settings)
  return { items, hiddenCount: all.length - items.length, mediaSourceUrl }
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

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) resetTab(tabId, change.url || tab?.url || '')
})
chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId)
  chrome.storage.session.remove([`tab:${tabId}`, `extract:${tabId}`]).catch(() => {})
  void forgetPreview(tabId).catch(() => {})
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

async function sendUrl(url, { type, maxSpeedBytes, nodeId, storagePath, ytdlpOptions, fallbackDownload = false, quiet = false } = {}) {
  await ready
  url = (url || '').trim()
  if (!isMagnet(url) && !isHttp(url)) throw new Error('Нужна http(s)- или magnet-ссылка')
  if (!type && Object.keys(videoOptions(settings)).length && ['video', 'audio', 'stream'].includes(kindOf(url))) {
    type = 'YTDLP'
  }
  try {
    const auth = await routerSettings(settings)
    const { job, plan } = await sendToRouter(auth, url, { type, maxSpeedBytes, nodeId, storagePath, ytdlpOptions })
    if (job?.id) {
      const records = (await chrome.storage.session.get('lmsJobs')).lmsJobs || []
      await chrome.storage.session.set({ lmsJobs: [...records.filter(x => x.url !== url && x.accountSession === auth.accountSession && x.routerUrl === settings.routerUrl), { url, id: job.id, accountSession: auth.accountSession, routerUrl: settings.routerUrl, job }].slice(-100) })
      chrome.runtime.sendMessage({ type: 'jobsChanged' }).catch(() => {})
    }
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
    const candidate = sniffCandidate(details)
    if (!candidate) return
    tabState(details.tabId).then((state) => {
      const existing = state.sniffed.find((item) => item.url === details.url)
      if (existing) Object.assign(existing, candidate)
      else state.sniffed.push(candidate)
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
    if (isHttp(info.srcUrl)) void sendUrl(info.srcUrl, { type: 'YTDLP' })
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
  if (['prepareStream', 'mediaInfo', 'jobProgress'].includes(message?.type)) {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Доступно только из окна расширения')
    await ready
    const auth = await routerSettings(settings)
    if (message.type === 'prepareStream') {
      const id = String(message.id || '')
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Некорректный сеанс просмотра')
      const item = (await chrome.storage.session.get(`preview:${id}`))[`preview:${id}`]
      if (!item) throw new Error('Сеанс просмотра завершён')
      return { ok: true, result: await prepareMedia(auth, item) }
    }
    if (message.type === 'mediaInfo') return { ok: true, result: await mediaInfo(auth, message.url, Boolean(message.direct)) }
    const all = (await chrome.storage.session.get('lmsJobs')).lmsJobs || []
    const records = all.filter(x => x.accountSession === auth.accountSession && x.routerUrl === settings.routerUrl)
    if (!records.length) return { ok: true, jobs: [] }
    const jobs = await listJobs(auth)
    const byId = new Map((Array.isArray(jobs) ? jobs : jobs.items || []).map(job => [job.id, job]))
    const updated = records.map(record => ({ ...record, job: byId.get(record.id) || record.job }))
    await chrome.storage.session.set({ lmsJobs: updated })
    return { ok: true, jobs: updated.map(({ url, job }) => ({ url, ...job })) }
  }
  if (message?.type === 'preview') {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Просмотр доступен только из окна расширения')
    await ready
    return openPreview(message.item || {})
  }
  if (['accountLogin', 'accountLogout', 'accountStatus'].includes(message?.type)) {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Вход доступен только из окна расширения')
    await ready
    if (message.type === 'accountLogin') return loginAccount(settings)
    if (message.type === 'accountLogout') return logoutAccount(settings)
    return statusAccount(settings)
  }
  switch (message?.type) {
    case 'scan': {
      const tabId = sender.tab?.id
      if (tabId == null) return null
      const state = await tabState(tabId)
      if (sender.frameId === 0) {
        if (state.pageUrl && state.pageUrl !== message.pageUrl) {
          state.sniffed = []
          state.frames = {} // SPA navigation, including query/hash routes
          state.sources = {}; state.contexts = {}
        }
        state.pageUrl = message.pageUrl
        state.title = message.title
      }
      state.frames[sender.frameId || 0] = message.items.slice(0, 500)
      state.sources ||= {}; state.contexts ||= {}
      state.sources[sender.frameId || 0] = canonicalVideoPage(message.mediaSourceUrl || message.pageUrl)
      state.contexts[sender.frameId || 0] = { thumbnail: isHttp(message.context?.thumbnail) ? String(message.context.thumbnail).slice(0, 16384) : '' }
      touch(tabId)
      return null
    }
    case 'send':
      return sendUrl(message.url, { type: message.linkType, maxSpeedBytes: message.maxSpeedBytes, nodeId: message.nodeId, storagePath: message.storagePath, ytdlpOptions: message.ytdlpOptions, quiet: message.quiet })
    case 'destinations':
      await ready
      return { ok: true, nodes: await listNodes(await routerSettings(settings)) }
    case 'storageTargets':
      await ready
      return { ok: true, result: await storageTargets(await routerSettings(settings), message.nodeId) }
    case 'getTab': {
      const state = await tabState(message.tabId)
      const pageUrl = state.pageUrl || message.pageUrl || ''
      return { pageUrl, title: state.title || message.title || '', videoHost: isVideoHost(pageUrl), ...findingsOf({ ...state, pageUrl }) }
    }
    case 'rescan':
      await chrome.tabs.sendMessage(message.tabId, { type: 'rescan' }).catch(() => {})
      return { ok: true }
    case 'extract': {
      // Cached per tab and page so reopening the popup does not rerun yt-dlp.
      await ready
      const auth = await routerSettings(settings)
      const key = `extract:${message.tabId}`
      const cached = (await chrome.storage.session.get(key))[key]
      if (!message.force && cached?.url === message.url && cached.nodeId === settings.downloadNodeId && cached.routerUrl === settings.routerUrl && cached.accountSession === auth.accountSession) return { ok: true, result: cached.result }
      try {
        const result = await extractMedia(auth, message.url)
        chrome.storage.session.set({ [key]: { url: message.url, nodeId: settings.downloadNodeId, routerUrl: settings.routerUrl, accountSession: auth.accountSession, result } }).catch(() => {})
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    }
    case 'health':
      await ready
      try {
        await health(await routerSettings(message.settings ? { ...settings, ...message.settings } : settings))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error.message, authRequired: error.status === 401, ...(error.status === 403 ? { accessDenied: true } : {}) }
      }
    default:
      return null
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  onMessage(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }))
  return true
})
