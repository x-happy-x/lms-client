import { extensionOf, hostOf, isHttp, isMagnet, normalizeRouterUrl, suggestType } from './lib/links.js'
import { DEFAULT_SETTINGS } from './lib/router.js'

const KIND_LABEL = {
  video: 'Видео',
  stream: 'Поток',
  audio: 'Аудио',
  magnet: 'Magnet',
  torrent: 'Торрент',
  archive: 'Архив',
  document: 'Документ',
  disk: 'Образ',
  app: 'Программа',
  file: 'Файл'
}
const TYPES = [
  ['DIRECT', 'HTTP'],
  ['YTDLP', 'yt-dlp'],
  ['ARIA2C', 'aria2c'],
  ['TORRENT', 'Торрент']
]

const $ = (id) => document.getElementById(id)
let settings = { ...DEFAULT_SETTINGS }
const itemRows = new Map()

function preview(item) {
  const box = el('div', { className: 'preview' })
  if (item.thumbnail) {
    const img = el('img', { src: item.thumbnail, alt: '', referrerPolicy: 'no-referrer' })
    img.addEventListener('error', () => img.remove())
    box.append(img)
  }
  const label = el('span', { className: 'preview-kind', textContent: KIND_LABEL[item.kind] || item.kind })
  box.append(label)
  if (item.durationSeconds) box.append(el('span', { className: 'duration', textContent: formatDuration(item.durationSeconds) }))
  return box
}

function mediaDetails(item) {
  const format = item.kind === 'stream' ? (item.contentType === 'application/dash+xml' || extensionOf(item.url) === 'mpd' ? 'DASH' : 'HLS') :
    extensionOf(item.url).toUpperCase() || item.contentType?.split('/')[1]?.toUpperCase()
  return [format, item.height ? `${item.height}p` : '', formatSize(item.sizeBytes),
    isMagnet(item.url) ? 'magnet' : hostOf(item.url)].filter(Boolean).join(' · ')
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props)
  for (const child of [].concat(children)) node.append(child)
  return node
}

async function send(url, linkType, statusNode, button) {
  if (button) button.disabled = true
  statusNode.textContent = 'Отправка…'
  statusNode.className = 'result muted'
  const speed = Number($('speed').value) || 0
  const result = await chrome.runtime.sendMessage({ type: 'send', url, linkType, maxSpeedBytes: speed, quiet: true })
  if (result?.ok) {
    statusNode.textContent = `✓ ${result.nodeName || 'нода'} · ${TYPES.find(([key]) => key === result.type)?.[1] || result.type}`
    statusNode.className = 'result ok'
  } else {
    statusNode.textContent = result?.error || 'Ошибка'
    statusNode.className = 'result error'
    if (button) button.disabled = false
  }
}

function renderItems(items) {
  const list = $('items')
  const urls = new Set(items.map((item) => item.url))
  for (const [url, entry] of itemRows) {
    if (!urls.has(url)) { entry.row.remove(); itemRows.delete(url) }
  }
  $('count').textContent = items.length ? String(items.length) : ''
  $('empty').hidden = items.length > 0
  for (const item of items) {
    const previous = itemRows.get(item.url)
    const signature = JSON.stringify(item)
    if (previous?.signature === signature) continue
    if (previous) {
      previous.row.querySelector('.preview').replaceWith(preview(item))
      previous.row.querySelector('.name').textContent = item.name
      const details = previous.row.querySelector('.host')
      details.textContent = details.title = mediaDetails(item)
      if (previous.kind !== item.kind && !previous.chosen) {
        previous.select.value = item.kind === 'stream' ? 'YTDLP' : suggestType(item.url)
      }
      previous.kind = item.kind
      previous.signature = signature
      continue
    }
    const typeSelect = el(
      'select',
      { className: 'type', title: 'Способ загрузки' },
      TYPES.map(([value, label]) => el('option', { value, textContent: label }))
    )
    typeSelect.value = item.kind === 'stream' ? 'YTDLP' : suggestType(item.url)
    const status = el('div', { className: 'result' })
    const button = el('button', { className: 'btn primary small', textContent: 'В LMS' })
    button.addEventListener('click', () => send(item.url, typeSelect.value, status, button))
    const copy = el('button', { className: 'icon small', textContent: '⧉', title: 'Копировать ссылку' })
    copy.addEventListener('click', () => navigator.clipboard.writeText(item.url))
    const row = el('li', { className: 'item' }, [
        preview(item),
        el('div', { className: 'info' }, [
          el('div', { className: 'name', textContent: item.name, title: item.url }),
          el('div', { className: 'host muted', textContent: mediaDetails(item), title: mediaDetails(item) }),
          status
        ]),
        el('div', { className: 'actions' }, [typeSelect, el('div', { className: 'row tight' }, [copy, button])])
      ])
    list.append(row)
    const entry = { row, signature, kind: item.kind, select: typeSelect, chosen: false }
    typeSelect.addEventListener('change', () => { entry.chosen = true })
    itemRows.set(item.url, entry)
  }
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const sec = String(Math.floor(seconds % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function formatSize(bytes) {
  if (!bytes) return ''
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** yt-dlp results: one video, or playlist entries with checkboxes. */
function renderExtract(result) {
  const box = $('ytdlp')
  box.hidden = false
  box.replaceChildren()
  const node = result.nodeName ? ` · нода ${result.nodeName}` : ''

  if (result.kind !== 'playlist') {
    const status = el('div', { className: 'result' })
    const button = el('button', { className: 'btn primary small', textContent: 'В LMS' })
    button.addEventListener('click', () => send(result.url, 'YTDLP', status, button))
    const meta = [formatDuration(result.durationSeconds), formatSize(result.sizeBytes), result.extractor].filter(Boolean).join(' · ')
    box.append(
      el('h2', { className: 'section-title', textContent: `yt-dlp нашёл видео${node}` }),
      el('div', { className: 'item' }, [
        el('span', { className: 'kind kind-video', textContent: 'Видео' }),
        el('div', { className: 'info' }, [
          el('div', { className: 'name', textContent: result.title || result.url, title: result.url }),
          el('div', { className: 'host muted', textContent: meta }),
          status
        ]),
        button
      ])
    )
    return
  }

  const entries = result.entries || []
  const total = result.entryCount || entries.length
  box.append(el('h2', { className: 'section-title', textContent: `yt-dlp: ${result.title || 'плейлист'} · ${total} видео${node}` }))
  if (!entries.length) {
    box.append(el('p', { className: 'empty muted', textContent: 'Список пуст.' }))
    return
  }

  const checks = []
  const list = el('ul', { className: 'items entries' })
  for (const entry of entries) {
    const check = el('input', { type: 'checkbox', checked: true })
    checks.push({ check, entry })
    const status = el('div', { className: 'result' })
    entry.status = status
    list.append(
      el('li', { className: 'entry' }, [
        el('label', { className: 'entry-label' }, [
          check,
          el('span', { className: 'name', textContent: entry.title || entry.url, title: entry.url }),
          el('span', { className: 'muted small', textContent: formatDuration(entry.durationSeconds) })
        ]),
        status
      ])
    )
  }

  const selectedCount = () => checks.filter((item) => item.check.checked).length
  const sendSelected = el('button', { className: 'btn primary small' })
  const refreshLabel = () => {
    sendSelected.textContent = `Выбранные (${selectedCount()})`
    sendSelected.disabled = selectedCount() === 0
  }
  checks.forEach((item) => item.check.addEventListener('change', refreshLabel))
  refreshLabel()

  const toggle = el('button', { className: 'btn small', textContent: 'Все / ничего' })
  toggle.addEventListener('click', () => {
    const all = selectedCount() !== checks.length
    checks.forEach((item) => (item.check.checked = all))
    refreshLabel()
  })

  const whole = el('button', { className: 'btn small', textContent: 'Весь плейлист одной загрузкой' })
  const summary = el('div', { className: 'result' })
  whole.addEventListener('click', () => send(result.url, 'YTDLP', summary, whole))

  sendSelected.addEventListener('click', async () => {
    const chosen = checks.filter((item) => item.check.checked && !item.sent)
    sendSelected.disabled = true
    let ok = 0
    for (const [index, item] of chosen.entries()) {
      summary.textContent = `Отправка ${index + 1} из ${chosen.length}…`
      summary.className = 'result muted'
      await send(item.entry.url, 'YTDLP', item.entry.status)
      if (item.entry.status.classList.contains('ok')) {
        ok++
        item.sent = true
        item.check.checked = false
        item.check.disabled = true
      }
    }
    summary.textContent = `Отправлено ${ok} из ${chosen.length}`
    summary.className = `result ${ok === chosen.length ? 'ok' : 'error'}`
    refreshLabel()
  })

  box.append(el('div', { className: 'row wrap' }, [sendSelected, whole, toggle]), summary, list)
  if (result.truncated) {
    box.append(el('p', { className: 'muted small', textContent: `Показаны первые ${entries.length} — для остальных отправьте весь плейлист.` }))
  }
}

async function runExtract(tabId, url, force = false) {
  const button = $('extract')
  const box = $('ytdlp')
  button.disabled = true
  button.textContent = 'yt-dlp разбирает страницу…'
  box.hidden = false
  box.replaceChildren(el('p', { className: 'muted small', textContent: 'Это может занять до минуты на больших плейлистах.' }))
  const answer = await chrome.runtime.sendMessage({ type: 'extract', tabId, url, force })
  button.disabled = false
  button.textContent = 'Найти через yt-dlp заново'
  if (answer?.ok) {
    renderExtract(answer.result)
  } else {
    box.replaceChildren(el('div', { className: 'result error', textContent: `yt-dlp: ${answer?.error || 'ошибка'}` }))
  }
}

async function checkRouter() {
  const status = $('status')
  if (!normalizeRouterUrl(settings.routerUrl)) {
    status.textContent = 'не настроен'
    status.className = 'pill warn'
    $('setup').hidden = false
    return
  }
  const result = await chrome.runtime.sendMessage({ type: 'health' })
  status.textContent = result?.ok ? 'на связи' : 'нет связи'
  status.className = `pill ${result?.ok ? 'ok' : 'error'}`
  status.title = result?.error || normalizeRouterUrl(settings.routerUrl)
}

async function init() {
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) }
  $('speed').value = String(settings.maxSpeedBytes || 0)
  if (!$('speed').value) $('speed').value = '0'

  const openOptions = (event) => {
    event?.preventDefault()
    chrome.runtime.openOptionsPage()
  }
  $('open-options').addEventListener('click', openOptions)
  $('setup-link').addEventListener('click', openOptions)
  $('open-ui').addEventListener('click', () => {
    const base = normalizeRouterUrl(settings.routerUrl)
    if (base) chrome.tabs.create({ url: `${base}/` })
    else openOptions()
  })

  // ?tab=<id> lets the popup be opened as a page for a given tab (debugging, screenshots).
  const forced = Number(new URLSearchParams(location.search).get('tab'))
  const tab = forced ? await chrome.tabs.get(forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  const data = await chrome.runtime.sendMessage({ type: 'getTab', tabId: tab?.id, pageUrl: tab?.url, title: tab?.title })
  let pageUrl = data?.pageUrl || tab?.url || ''
  $('page-title').textContent = data?.title || tab?.title || pageUrl
  $('page-title').title = pageUrl
  const pageStatus = el('div', { className: 'result' })
  $('page-title').after(pageStatus)
  const sendPage = $('send-page')
  if (!isHttp(pageUrl)) sendPage.disabled = true
  if (data?.videoHost) sendPage.classList.add('primary')
  sendPage.addEventListener('click', () => send(pageUrl, 'YTDLP', pageStatus, sendPage))

  const extractButton = $('extract')
  const canExtract = isHttp(pageUrl) && Boolean(normalizeRouterUrl(settings.routerUrl))
  extractButton.disabled = !canExtract
  let extracted = false
  extractButton.addEventListener('click', () => {
    void runExtract(tab?.id, pageUrl, extracted)
    extracted = true
  })
  // Video sites are what yt-dlp is for: look right away (the worker caches the answer).
  if (canExtract && data?.videoHost) {
    extracted = true
    void runExtract(tab?.id, pageUrl)
  }

  const quickStatus = el('div', { className: 'result' })
  $('quick').after(quickStatus)
  $('quick').addEventListener('submit', (event) => {
    event.preventDefault()
    const url = $('quick-url').value.trim()
    if (url) void send(url, undefined, quickStatus)
  })

  renderItems(data?.items || [])
  let refreshTimer = 0
  const refresh = async () => {
    const latest = await chrome.runtime.sendMessage({ type: 'getTab', tabId: tab?.id })
    if (!latest) return
    if (latest.pageUrl && latest.pageUrl !== pageUrl) {
      pageUrl = latest.pageUrl
      $('page-title').textContent = latest.title || pageUrl
      $('page-title').title = pageUrl
      $('ytdlp').hidden = true
      extracted = false
      extractButton.disabled = !isHttp(pageUrl) || !normalizeRouterUrl(settings.routerUrl)
      sendPage.disabled = !isHttp(pageUrl)
    }
    renderItems(latest.items || [])
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'tabChanged' || message.tabId !== tab?.id || refreshTimer) return
    refreshTimer = setTimeout(() => { refreshTimer = 0; void refresh() }, 150)
  })
  $('rescan').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'rescan', tabId: tab?.id })
    await refresh()
  })
  // Rescan all frames, including players whose metadata arrived while the popup opened.
  if (tab?.id && isHttp(pageUrl)) {
    await chrome.runtime.sendMessage({ type: 'rescan', tabId: tab.id })
    await refresh()
  }
  void checkRouter()
}

void init()
