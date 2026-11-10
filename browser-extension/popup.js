import { icon, decorateToggles, hydrateIcons } from './lib/ui.js'
import { extensionOf, hostOf, isHttp, isMagnet, normalizeRouterUrl, suggestType } from './lib/links.js'
import { DEFAULT_SETTINGS } from './lib/router.js'
import { initDownloadPreferences, videoOptions } from './lib/preferences.js'
import { initAccountUI } from './lib/account-ui.js'

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
  file: 'Файл',
  playlist: 'Плейлист'
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
let onPlaylistActivate = () => {}
let extractGeneration = 0

function updatePageCount() {
  const count = itemRows.size + ($('single-video').hidden ? 0 : $('single-video').childElementCount)
  $('count').textContent = count ? String(count) : ''
  $('empty').hidden = count > 0
}

function selectTab(name) {
  for (const key of ['page', 'playlist']) {
    const active = name === key
    $(`tab-${key}`).setAttribute('aria-selected', String(active))
    $(`tab-${key}`).tabIndex = active ? 0 : -1
    $(`panel-${key}`).hidden = !active
  }
  if (name === 'playlist') onPlaylistActivate()
}

function downloadButton(title = 'Скачать видео') {
  return el('button', { className: 'icon primary card-send', title, ariaLabel: title }, [icon('download')])
}

function preview(item) {
  const box = el('div', { className: `preview preview-${item.kind}` })
  const kindIcon = item.kind === 'playlist' ? 'playlist' : ['video', 'stream'].includes(item.kind) ? 'video' : item.kind === 'audio' ? 'audio' : ['magnet', 'torrent'].includes(item.kind) ? 'magnet' : 'file'
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

async function send(url, linkType, statusNode, button, { playlist = false } = {}) {
  if (button) button.disabled = true
  const cardButton = button?.classList.contains('card-send')
  if (cardButton) {
    button.setAttribute('aria-busy', 'true')
    button.replaceChildren(icon('loader'))
    button.title = button.ariaLabel = 'Отправка в LMS'
  }
  statusNode.textContent = 'Отправка…'
  statusNode.className = 'result muted'
  const speed = Number($('speed').value) || 0
  let result
  try { result = await chrome.runtime.sendMessage({
    type: 'send', url, linkType, maxSpeedBytes: speed, quiet: true,
    nodeId: settings.downloadNodeId, storagePath: $('downloadPath').value.trim(),
    ytdlpOptions: linkType === 'YTDLP' ? videoOptions(settings, playlist) : undefined
  }) }
  catch (error) { result = { error: error.message } }
  if (result?.ok) {
    statusNode.replaceChildren(icon('check'), el('span', { textContent: `${result.nodeName || 'нода'} · ${TYPES.find(([key]) => key === result.type)?.[1] || result.type}` }))
    statusNode.className = 'result ok'
    if (cardButton) {
      button.classList.add('sent')
      button.replaceChildren(icon('check'))
      button.title = button.ariaLabel = 'Добавлено в очередь'
    }
  } else {
    statusNode.textContent = result?.error || 'Ошибка'
    statusNode.className = 'result error'
    if (button) button.disabled = false
    if (cardButton) {
      button.replaceChildren(icon('refresh'))
      button.title = button.ariaLabel = 'Повторить скачивание'
    }
  }
  if (cardButton) button.setAttribute('aria-busy', 'false')
}

function renderItems(items) {
  const list = $('items')
  const urls = new Set(items.map((item) => item.url))
  for (const [url, entry] of itemRows) {
    if (!urls.has(url)) { entry.row.remove(); itemRows.delete(url) }
  }
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
    const mediaPreferences = settings.videoMaxHeight || settings.videoAudioOnly || settings.videoContainer !== 'auto'
    typeSelect.value = item.kind === 'stream' || (['video', 'audio'].includes(item.kind) && mediaPreferences) ? 'YTDLP' : suggestType(item.url)
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
  updatePageCount()
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
  box.replaceChildren()
  box.hidden = result.kind !== 'playlist'
  $('single-video').hidden = true
  $('single-video').replaceChildren()
  $('playlist-count').textContent = ''
  $('playlist-empty').hidden = result.kind === 'playlist'

  if (result.kind !== 'playlist') {
    const status = el('div', { className: 'result', role: 'status' })
    const button = downloadButton()
    button.addEventListener('click', () => send(result.url, 'YTDLP', status, button))
    $('single-video').hidden = false
    $('empty').hidden = true
    $('playlist-empty-text').textContent = 'Найден один ролик. Он находится во вкладке «На текущей странице».'
    $('single-video').append(
      mediaCard({ ...result, name: result.title || result.url, kind: 'video' }, [button], status, 'div')
    )
    updatePageCount()
    return
  }

  const entries = result.entries || []
  const total = result.entryCount || entries.length
  $('playlist-count').textContent = total ? String(total) : ''
  updatePageCount()
  if (!entries.length) {
    box.append(el('p', { className: 'hint muted', textContent: 'Список роликов недоступен. Можно отправить весь плейлист.' }))
  }

  const checks = []
  const list = el('ul', { className: 'items entries' })
  for (const entry of entries) {
    const check = el('input', { type: 'checkbox', checked: true, ariaLabel: `Выбрать ролик ${entry.title || entry.url}` })
    checks.push({ check, entry })
    const status = el('div', { className: 'result', role: 'status' })
    entry.status = status
    const button = downloadButton(`Скачать ${entry.title || 'ролик'}`)
    entry.button = button
    button.addEventListener('click', async () => {
      await send(entry.url, 'YTDLP', status, button)
      if (status.classList.contains('ok')) {
        const item = checks.find((item) => item.check === check)
        item.sent = true
        check.checked = false
        check.disabled = true
        refreshLabel()
      }
    })
    list.append(
      el('li', { className: 'entry' }, [
        preview({ ...entry, kind: 'video' }),
        el('div', { className: 'entry-info' }, [
          el('div', { className: 'name', textContent: entry.title || entry.url, title: entry.title || entry.url }),
          el('div', { className: 'entry-actions' }, [
            el('label', { className: 'check' }, [check, el('span', { className: 'chip-on', textContent: 'Выбрано' }), el('span', { className: 'chip-off', textContent: 'Выбрать' })]),
            button
          ])
        ]),
        status
      ])
    )
  }

  const selectedCount = () => checks.filter((item) => item.check.checked).length
  const sendSelected = downloadButton('Скачать выбранные ролики')
  sendSelected.id = 'send-selected'
  const selectedLabel = el('span', { className: 'muted selection-count' })
  const allCheck = el('input', { type: 'checkbox', checked: checks.length > 0, disabled: !checks.length, ariaLabel: 'Выбрать все ролики' })
  const refreshLabel = () => {
    selectedLabel.textContent = `Выбрано ${selectedCount()} из ${entries.length}`
    sendSelected.title = sendSelected.ariaLabel = `Скачать выбранные ролики (${selectedCount()})`
    sendSelected.disabled = selectedCount() === 0
    allCheck.checked = selectedCount() > 0 && checks.every((item) => item.check.checked || item.sent)
    allCheck.indeterminate = selectedCount() > 0 && !allCheck.checked
    allCheck.disabled = !checks.length || checks.every((item) => item.sent)
  }
  checks.forEach((item) => item.check.addEventListener('change', refreshLabel))
  refreshLabel()

  const toggle = el('label', { className: 'check' }, [allCheck, el('span', { textContent: 'Все ролики' })])
  allCheck.addEventListener('change', () => {
    checks.forEach((item) => { if (!item.sent) item.check.checked = allCheck.checked })
    refreshLabel()
  })

  const whole = downloadButton('Скачать весь плейлист')
  whole.classList.add('playlist-download')
  const summary = el('div', { className: 'result', role: 'status' })
  whole.addEventListener('click', () => send(result.url, 'YTDLP', summary, whole, { playlist: true }))

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
        item.entry.button.disabled = true
        item.entry.button.classList.add('sent')
        item.entry.button.replaceChildren(icon('check'))
        item.entry.button.title = item.entry.button.ariaLabel = 'Добавлено в очередь'
      }
    }
    summary.textContent = `Отправлено ${ok} из ${chosen.length}`
    summary.className = `result ${ok === chosen.length ? 'ok' : 'error'}`
    refreshLabel()
  })

  box.prepend(el('div', { className: 'playlist-summary' }, [
    preview({ ...result, kind: 'playlist', thumbnail: result.thumbnail || entries.find((entry) => entry.thumbnail)?.thumbnail }),
    el('div', { className: 'playlist-info' }, [
      el('div', { className: 'name', textContent: result.title || 'Плейлист', title: result.title || '' }),
      el('p', { className: 'hint muted', textContent: `${total || 'Все'} видео · весь плейлист` })
    ]),
    whole
  ]))
  box.append(summary, el('div', { className: 'selection-toolbar' }, [toggle, selectedLabel, sendSelected]), list)
  decorateToggles(box)
  if (result.truncated) {
    box.append(el('p', { className: 'muted small', textContent: `Показаны первые ${entries.length} — для остальных отправьте весь плейлист.` }))
  }
}

async function runExtract(tabId, url, force = false, activate = false) {
  const generation = ++extractGeneration
  const button = $('extract')
  const feedback = $('extract-feedback')
  button.disabled = true
  button.replaceChildren(icon('loader'))
  button.setAttribute('aria-busy', 'true')
  feedback.className = 'result muted'
  feedback.textContent = 'Ищем видео и плейлист…'
  let answer
  try { answer = await chrome.runtime.sendMessage({ type: 'extract', tabId, url, force }) }
  catch (error) { answer = { error: error.message } }
  if (generation !== extractGeneration) return
  button.disabled = false
  button.replaceChildren(icon('search'))
  button.setAttribute('aria-busy', 'false')
  if (answer?.ok) {
    feedback.textContent = ''
    renderExtract(answer.result)
    if (activate) selectTab(answer.result.kind === 'playlist' ? 'playlist' : 'page')
  } else {
    feedback.className = 'result error'
    feedback.textContent = answer?.error || 'Не удалось найти видео'
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
  status.textContent = result?.ok ? 'на связи' : result?.authRequired ? 'нужен вход' : 'нет связи'
  status.className = `pill ${result?.ok ? 'ok' : result?.authRequired ? 'warn' : 'error'}`
  status.title = result?.error || normalizeRouterUrl(settings.routerUrl)
}

async function init() {
  hydrateIcons()
  decorateToggles()
  $('open-ui').replaceChildren(icon('external'))
  $('open-options').replaceChildren(icon('settings'))
  $('rescan').replaceChildren(icon('refresh'))
  $('extract').replaceChildren(icon('search'))
  $('send-page').replaceChildren(icon('download'))
  $('send-page').classList.add('card-send')
  for (const name of ['page', 'playlist']) {
    const tabButton = $(`tab-${name}`)
    tabButton.addEventListener('click', () => selectTab(name))
    tabButton.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'page' : event.key === 'End' ? 'playlist' : name === 'page' ? 'playlist' : 'page'
      selectTab(next)
      $(`tab-${next}`).focus()
    })
  }
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) }
  initAccountUI({ compact: true })
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
  $('panel-page').prepend(pageStatus)
  const sendPage = $('send-page')
  if (!isHttp(pageUrl)) sendPage.disabled = true
  if (data?.videoHost) sendPage.classList.add('primary')
  sendPage.addEventListener('click', () => send(pageUrl, 'YTDLP', pageStatus, sendPage))

  const extractButton = $('extract')
  const canExtract = () => isHttp(pageUrl) && Boolean(normalizeRouterUrl(settings.routerUrl))
  extractButton.disabled = !canExtract()
  let extracted = false
  extractButton.addEventListener('click', () => {
    void runExtract(tab?.id, pageUrl, extracted, true)
    extracted = true
  })
  onPlaylistActivate = () => {
    if (!extracted && canExtract() && !extractButton.disabled) {
      extracted = true
      void runExtract(tab?.id, pageUrl)
    }
  }
  // Video sites are what yt-dlp is for: look right away (the worker caches the answer).
  if (canExtract() && data?.videoHost) {
    extracted = true
    void runExtract(tab?.id, pageUrl)
  }

  const quickStatus = el('div', { className: 'result' })
  $('quick').after(quickStatus)
  $('quick').addEventListener('submit', (event) => {
    event.preventDefault()
    const url = $('quick-url').value.trim()
    if (url) void send(url, undefined, quickStatus, $('quick').querySelector('button'))
  })

  renderItems(data?.items || [])
  void initDownloadPreferences(settings, () => {
    if (!settings.videoMaxHeight && !settings.videoAudioOnly && settings.videoContainer === 'auto') return
    for (const entry of itemRows.values()) {
      if (['video', 'audio', 'stream'].includes(entry.kind)) entry.select.value = 'YTDLP'
    }
  })
  let refreshTimer = 0
  const refresh = async () => {
    const latest = await chrome.runtime.sendMessage({ type: 'getTab', tabId: tab?.id })
    if (!latest) return
    if (latest.pageUrl && latest.pageUrl !== pageUrl) {
      extractGeneration++
      pageUrl = latest.pageUrl
      $('page-title').textContent = latest.title || pageUrl
      $('page-title').title = pageUrl
      $('ytdlp').hidden = true
      $('ytdlp').replaceChildren()
      $('single-video').hidden = true
      $('single-video').replaceChildren()
      $('playlist-count').textContent = ''
      $('playlist-empty').hidden = false
      $('playlist-empty-text').textContent = 'Откройте страницу с плейлистом. Здесь появятся его ролики и превью.'
      $('extract-feedback').textContent = ''
      extracted = false
      extractButton.replaceChildren(icon('search'))
      extractButton.setAttribute('aria-busy', 'false')
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
