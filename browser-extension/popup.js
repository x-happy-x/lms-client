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

const ICON_PATHS = {
  video: 'm9 7 8 5-8 5Z M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  audio: 'M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z M21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h5',
  magnet: 'M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3Z M6 7h4 M14 7h4',
  copy: 'M9 9h11v11H9Z M15 5V3H3v12h2',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6.1 6.1A8 8 0 0 1 20 12 M4 12a8 8 0 0 0 13.9 5.9',
  external: 'M14 3h7v7 M21 3l-9 9 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  loader: 'M21 12a9 9 0 1 1-9-9'
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
  svg.classList.add('ui-icon')
  if (name === 'loader') svg.classList.add('spin')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.file)
  svg.append(path)
  return svg
}

function downloadButton() {
  return el('button', { className: 'btn primary card-send' }, [icon('download'), el('span', { textContent: 'Скачать' })])
}

function preview(item) {
  const box = el('div', { className: `preview preview-${item.kind}` })
  const kindIcon = ['video', 'stream'].includes(item.kind) ? 'video' : item.kind === 'audio' ? 'audio' : ['magnet', 'torrent'].includes(item.kind) ? 'magnet' : 'file'
  box.append(el('div', { className: 'preview-fallback' }, [icon(kindIcon), el('span', { textContent: KIND_LABEL[item.kind] || 'Файл' })]))
  if (item.thumbnail) {
    const img = el('img', { src: item.thumbnail, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' })
    img.addEventListener('load', () => box.classList.add('has-poster'))
    img.addEventListener('error', () => { img.remove(); box.classList.remove('has-poster') })
    box.append(img)
  }
  if (item.durationSeconds) box.append(el('span', { className: 'duration', textContent: formatDuration(item.durationSeconds) }))
  return box
}

function mediaDetails(item) {
  const format = item.kind === 'stream' ? (item.contentType === 'application/dash+xml' || extensionOf(item.url) === 'mpd' ? 'DASH' : 'HLS') :
    extensionOf(item.url).toUpperCase() || item.contentType?.split('/')[1]?.toUpperCase()
  return el('div', { className: 'media-meta' }, [
    el('span', { className: `media-kind media-kind-${item.kind}`, textContent: KIND_LABEL[item.kind] || 'Файл' }),
    ...[[format, ''], [item.height ? `${item.height}p` : '', ' quality'], [formatSize(item.sizeBytes), '']]
      .filter(([text]) => text).map(([text, className]) => el('span', { className: `meta-tag${className}`, textContent: text }))
  ])
}

function mediaCard(item, actions, status, tag = 'li') {
  return el(tag, { className: 'item media-card' }, [
    preview(item),
    el('div', { className: 'info' }, [
      el('div', { className: 'name', textContent: item.name, title: item.name }),
      el('div', { className: 'host muted', textContent: isMagnet(item.url) ? 'Magnet-ссылка' : hostOf(item.url), title: item.url }),
      mediaDetails(item)
    ]),
    el('div', { className: 'actions' }, actions),
    status
  ])
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props)
  for (const child of [].concat(children)) node.append(child)
  return node
}

async function send(url, linkType, statusNode, button) {
  if (button) button.disabled = true
  const cardButton = button?.classList.contains('card-send')
  if (cardButton) {
    button.setAttribute('aria-busy', 'true')
    button.replaceChildren(icon('loader'), el('span', { textContent: 'Отправка' }))
  }
  statusNode.textContent = 'Отправка…'
  statusNode.className = 'result muted'
  const speed = Number($('speed').value) || 0
  let result
  try { result = await chrome.runtime.sendMessage({ type: 'send', url, linkType, maxSpeedBytes: speed, quiet: true }) }
  catch (error) { result = { error: error.message } }
  if (result?.ok) {
    statusNode.replaceChildren(icon('check'), el('span', { textContent: `${result.nodeName || 'нода'} · ${TYPES.find(([key]) => key === result.type)?.[1] || result.type}` }))
    statusNode.className = 'result ok'
    if (cardButton) {
      button.classList.add('sent')
      button.replaceChildren(icon('check'), el('span', { textContent: 'В очереди' }))
    }
  } else {
    statusNode.textContent = result?.error || 'Ошибка'
    statusNode.className = 'result error'
    if (button) button.disabled = false
    if (cardButton) button.replaceChildren(icon('refresh'), el('span', { textContent: 'Повторить' }))
  }
  if (cardButton) button.setAttribute('aria-busy', 'false')
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
      previous.row.querySelector('.name').title = item.name
      previous.row.querySelector('.media-meta').replaceWith(mediaDetails(item))
      if (previous.kind !== item.kind && !previous.chosen) {
        previous.select.value = item.kind === 'stream' ? 'YTDLP' : suggestType(item.url)
      }
      previous.kind = item.kind
      previous.signature = signature
      continue
    }
    const typeSelect = el(
      'select',
      { className: 'type', title: 'Способ загрузки', ariaLabel: 'Способ загрузки' },
      TYPES.map(([value, label]) => el('option', { value, textContent: label }))
    )
    typeSelect.value = item.kind === 'stream' ? 'YTDLP' : suggestType(item.url)
    const status = el('div', { className: 'result', role: 'status' })
    const button = downloadButton()
    button.addEventListener('click', () => send(item.url, typeSelect.value, status, button))
    const copy = el('button', { className: 'icon copy-link', title: 'Копировать ссылку', ariaLabel: 'Копировать ссылку' }, [icon('copy')])
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.url)
        copy.replaceChildren(icon('check'))
        copy.title = 'Ссылка скопирована'
        setTimeout(() => { copy.replaceChildren(icon('copy')); copy.title = 'Копировать ссылку' }, 1800)
      } catch { copy.title = 'Не удалось скопировать ссылку' }
    })
    const row = mediaCard(item, [typeSelect, copy, button], status)
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
    const status = el('div', { className: 'result', role: 'status' })
    const button = downloadButton()
    button.addEventListener('click', () => send(result.url, 'YTDLP', status, button))
    box.append(
      el('h2', { className: 'section-title', textContent: `yt-dlp нашёл видео${node}` }),
      mediaCard({ ...result, name: result.title || result.url, kind: 'video' }, [button], status, 'div')
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
  $('open-ui').replaceChildren(icon('external'))
  $('open-options').replaceChildren(icon('settings'))
  $('rescan').prepend(icon('refresh'))
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
