import { icon, decorateToggles, hydrateIcons, decorateSelect, decorateSelects } from './lib/ui.js'
import { extensionOf, hostOf, isHttp, isMagnet, normalizeRouterUrl, suggestType } from './lib/links.js'
import { DEFAULT_SETTINGS } from './lib/router.js'
import { initDownloadPreferences, videoOptions } from './lib/preferences.js'
import { initAccountUI } from './lib/account-ui.js'
import { isVkMedia, canonicalVideoPage } from './lib/media-source.js'

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
const videoRows = new Map()
let onPlaylistActivate = () => {}
let extractGeneration = 0
let currentPageUrl = ''
let sourceTabId
let latestJobs = [], progressTimer = 0, progressBusy = false
const mediaOverrides = new Map()
const infoCache = new Map(), infoQueue = []
let infoActive = 0, infoGeneration = 0
const infoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    infoObserver.unobserve(entry.target)
    infoQueue.push({ row: entry.target, generation: infoGeneration }); void drainInfo()
  }
}, { rootMargin: '100px' })
function watchInfo(row, item) {
  row.dataset.mediaUrl = item.url
  row.dataset.mediaPage = String(Boolean(item.page))
  infoObserver.observe(row)
}
async function drainInfo() {
  if (infoActive >= 2 || !infoQueue.length) return
  const { row, generation } = infoQueue.shift()
  if (!row.isConnected || generation !== infoGeneration) { void drainInfo(); return }
  infoActive++
  const key = `${row.dataset.mediaUrl}|${settings.downloadNodeId}|${settings.videoMaxHeight}|${settings.videoMaxFps}`
  try {
    let result = infoCache.get(key)
    if (!result) {
      const answer = await chrome.runtime.sendMessage({ type: 'mediaInfo', url: row.dataset.mediaUrl, tabId: sourceTabId, direct: row.dataset.mediaPage !== 'true' })
      if (!answer?.ok) throw new Error(answer?.error || 'Сведения недоступны')
      result = answer.result; infoCache.set(key, result)
    }
    if (generation !== infoGeneration || !row.isConnected) return
    const details = row.querySelector('.media-meta')
    const size = el('span', { className: 'meta-tag' })
    const variants = [...(result.variants || [])].filter(variant => variant.height > 0).reverse()
    const quality = el('select', { title: 'Качество этого видео', ariaLabel: 'Качество этого видео' }, variants.map(variant => el('option', { value: `${variant.height}:${variant.fps || 0}`, textContent: variant.quality || `${variant.height}p` })))
    if (!variants.length) quality.append(new Option(result.quality || 'Исходное', ''))
    const chosen = mediaOverrides.get(row.dataset.mediaUrl)
    quality.value = `${chosen?.maxHeight || result.height}:${chosen?.maxFps || result.fps || 0}`
    if (!quality.value && quality.options.length) quality.selectedIndex = 0
    const updateSize = () => {
      const variant = variants.find(variant => `${variant.height}:${variant.fps || 0}` === quality.value) || result
      size.textContent = variant.sizeBytes ? `${variant.sizeEstimated ? '≈ ' : ''}${formatSize(variant.sizeBytes)}` : 'Размер неизвестен'
      size.title = 'Размер исходного ролика в выбранном качестве; итоговый фрагмент может отличаться'
    }
    quality.addEventListener('change', () => {
      const [maxHeight, maxFps] = quality.value.split(':').map(Number)
      mediaOverrides.set(row.dataset.mediaUrl, { ...(maxHeight ? { maxHeight } : {}), ...(maxFps ? { maxFps } : {}) }); updateSize()
    })
    details?.replaceChildren(quality, size); if (details) decorateSelect(quality); updateSize()
  } catch (error) {
    if (generation === infoGeneration && row.isConnected) { const details = row.querySelector('.media-meta'); if (details) { details.textContent = 'Качество и размер недоступны'; details.title = error.message } }
  } finally { infoActive--; void drainInfo() }
  void drainInfo()
}

async function pollProgress() {
  if (progressBusy) return
  progressBusy = true
  try {
    const answer = await chrome.runtime.sendMessage({ type: 'jobProgress' })
    if (answer?.ok) { latestJobs = answer.jobs || []; paintProgress() }
  } catch { /* retain the last known state on a temporary connection failure */ }
  finally {
    progressBusy = false; clearTimeout(progressTimer)
    if (latestJobs.some(job => ['QUEUED', 'RUNNING', 'PAUSED'].includes(job.status))) progressTimer = setTimeout(pollProgress, 2000)
  }
}
function paintProgress() {
  const jobs = new Map(latestJobs.map(job => [job.url, job]))
  for (const card of document.querySelectorAll('[data-media-url]')) {
    const job = jobs.get(card.dataset.mediaUrl), box = card.querySelector('.preview')
    if (!box) continue
    if (!job) { box.querySelector('.download-water')?.remove(); continue }
    let overlay = box.querySelector('.download-water')
    if (!overlay) {
      overlay = el('div', { className: 'download-water', role: 'progressbar' })
      const fill = el('div', { className: 'water-fill' })
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 400 40'); svg.setAttribute('preserveAspectRatio', 'none'); svg.classList.add('water-wave')
      for (let index = 0; index < 2; index++) {
        const path = document.createElementNS(svg.namespaceURI, 'path')
        path.setAttribute('d', 'M0 20 Q25 0 50 20 T100 20 T150 20 T200 20 T250 20 T300 20 T350 20 T400 20 V40 H0Z'); path.classList.add(`wave-${index}`); svg.append(path)
      }
      fill.append(svg); overlay.append(fill, el('strong', { className: 'water-percent' }), el('span', { className: 'water-caption' })); box.append(overlay)
    }
    const labels = { QUEUED: 'В очереди', RUNNING: 'Загрузка', PAUSED: 'Пауза', DONE: 'Готово', ERROR: 'Ошибка', CANCELED: 'Отменено' }
    const percent = job.status === 'DONE' ? 100 : Math.max(0, Math.min(100, Number(job.percent) || 0))
    const known = job.percent != null || job.status === 'DONE'
    overlay.dataset.state = job.status; overlay.classList.toggle('indeterminate', !known)
    overlay.style.setProperty('--progress', `${percent}%`)
    overlay.setAttribute('aria-label', `${labels[job.status] || job.status}: ${known ? `${Math.round(percent)}%` : 'размер неизвестен'}`)
    overlay.setAttribute('aria-valuemin', '0'); overlay.setAttribute('aria-valuemax', '100')
    if (known) overlay.setAttribute('aria-valuenow', String(Math.round(percent))); else overlay.removeAttribute('aria-valuenow')
    overlay.querySelector('.water-percent').textContent = known ? `${Math.round(percent)}%` : '···'
    overlay.querySelector('.water-caption').textContent = job.status === 'RUNNING' && job.speedBytes ? `${formatSize(job.speedBytes)}/с` : labels[job.status] || job.status
    overlay.title = [labels[job.status], job.etaSeconds ? `Осталось ${formatDuration(job.etaSeconds)}` : '', job.errorText || ''].filter(Boolean).join(' · ')
  }
}

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

function playButton(item, status) {
  const button = el('button', { className: 'icon icon-bordered card-play', title: 'Смотреть без загрузки', ariaLabel: `Смотреть ${item.name || item.title || 'видео'}` }, [icon('play')])
  button.addEventListener('click', async () => {
    try {
      const latest = itemRows.get(item.url)?.item || item
      const answer = await chrome.runtime.sendMessage({ type: 'preview', item: { ...latest, ...mediaOverrides.get(item.url), sourceUrl: item.page ? item.url : currentPageUrl } })
      if (!answer?.ok) throw new Error(answer?.error || 'Не удалось открыть просмотр')
    } catch (error) { status.textContent = error.message; status.className = 'result error' }
  })
  return button
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
  const card = el(tag, { className: 'item media-card' }, [
    preview(item),
    el('div', { className: 'info' }, [
      el('div', { className: 'name', textContent: item.name, title: item.name }),
      el('div', { className: 'host muted', textContent: isMagnet(item.url) ? 'Magnet-ссылка' : hostOf(item.url), title: item.url }),
      mediaDetails(item)
    ]),
    el('div', { className: 'actions' }, actions),
    status
  ])
  card.dataset.mediaUrl = item.url
  return card
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
    ytdlpOptions: linkType === 'YTDLP' ? { ...videoOptions(settings, playlist), ...(!settings.videoAudioOnly ? mediaOverrides.get(url) : {}) } : undefined
  }) }
  catch (error) { result = { error: error.message } }
  if (result?.ok) {
    void pollProgress()
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

function renderItems(items, hiddenCount = 0) {
  const hasVkVideo = [...videoRows.keys()].some(url => canonicalVideoPage(url))
  items = items.filter(item => !videoRows.has(canonicalVideoPage(item.url) || item.url) && !(hasVkVideo && isVkMedia(item.url)))
  $('filter-status').hidden = hiddenCount === 0
  $('filter-status').textContent = hiddenCount ? `Скрыто фильтром: ${hiddenCount}` : ''
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
      previous.item = item
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
    const row = mediaCard(item, [typeSelect, copy, ...(['video', 'stream'].includes(item.kind) ? [playButton(item, status)] : []), button], status)
    list.append(row)
    decorateSelect(typeSelect)
    const entry = { row, signature, item, kind: item.kind, select: typeSelect, chosen: false }
    typeSelect.addEventListener('change', () => { entry.chosen = true })
    itemRows.set(item.url, entry)
  }
  updatePageCount()
  let music = 0
  for (const entry of itemRows.values()) {
    if (entry.item.kind === 'audio') { if (entry.row.parentElement !== $('music-items')) $('music-items').append(entry.row); music++ }
    else if (entry.row.parentElement !== list) list.append(entry.row)
  }
  $('music-section').hidden = music === 0
  paintProgress()
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
function renderVideoCards(videos = [], currentVideo = null) {
  const entries = videos.map(video => ({ ...video, url: canonicalVideoPage(video.url) || video.url }))
  if (currentVideo && !entries.some(video => video.url === currentVideo.url)) entries.unshift(currentVideo)
  const urls = new Set(entries.map(video => video.url)), container = $('single-video')
  for (const [url, entry] of videoRows) if (!urls.has(url)) { entry.row.remove(); videoRows.delete(url) }
  for (const [index, video] of entries.entries()) {
    const previous = videoRows.get(video.url), item = { ...video, name: video.title || video.url, kind: 'video', page: video.page !== false }
    let row
    if (previous) {
      row = previous.row
      if (previous.item.title !== item.title || previous.item.thumbnail !== item.thumbnail || previous.item.durationSeconds !== item.durationSeconds) {
        row.querySelector('.name').textContent = item.name; row.querySelector('.name').title = item.name
        row.querySelector('.preview').replaceWith(preview(item))
      }
      Object.assign(previous.item, item)
    } else {
      const status = el('div', { className: 'result', role: 'status' }), button = downloadButton()
      button.addEventListener('click', () => send(item.url, 'YTDLP', status, button))
      row = mediaCard(item, [playButton(item, status), button], status, 'div')
      row.querySelector('.media-meta').textContent = 'Качество и размер…'
      videoRows.set(item.url, { row, item }); watchInfo(row, item)
    }
    if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null)
    const duplicate = itemRows.get(item.url)
    if (duplicate) { duplicate.row.remove(); itemRows.delete(item.url) }
  }
  container.hidden = entries.length === 0
  updatePageCount(); paintProgress()
}

function renderExtract(result, videos) {
  const box = $('ytdlp')
  box.replaceChildren()
  box.hidden = result.kind !== 'playlist'
  $('playlist-count').textContent = ''
  $('playlist-empty').hidden = result.kind === 'playlist'

  if (result.kind !== 'playlist') {
    $('playlist-empty-text').textContent = 'Найденные ролики находятся во вкладке «На текущей странице».'
    renderVideoCards(videos || [result, ...[...videoRows.values()].map(entry => entry.item).filter(item => item.url !== result.url)])
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
    const row = el('li', { className: 'entry' }, [
        preview({ ...entry, kind: 'video' }),
        el('div', { className: 'entry-info' }, [
          el('div', { className: 'name', textContent: entry.title || entry.url, title: entry.title || entry.url }),
          el('div', { className: 'media-meta muted', textContent: 'Качество и размер…' }),
          el('div', { className: 'entry-actions' }, [
            el('label', { className: 'check' }, [check, el('span', { className: 'chip-on', textContent: 'Выбрано' }), el('span', { className: 'chip-off', textContent: 'Выбрать' })]),
            playButton({ ...entry, page: true }, status),
            button
          ])
        ]),
        status
      ])
    list.append(row); watchInfo(row, { ...entry, page: true })
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
  box.querySelector('.playlist-summary').dataset.mediaUrl = result.url
  box.append(summary, el('div', { className: 'selection-toolbar' }, [toggle, selectedLabel, sendSelected]), list)
  decorateToggles(box)
  paintProgress()
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
    renderExtract(answer.result, answer.videos)
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
  status.textContent = result?.ok ? 'на связи' : result?.authRequired ? 'нужен вход' : result?.accessDenied ? 'нет доступа' : 'нет связи'
  status.className = `pill ${result?.ok ? 'ok' : result?.authRequired ? 'warn' : 'error'}`
  status.title = result?.error || normalizeRouterUrl(settings.routerUrl)
}

async function init() {
  hydrateIcons()
  decorateToggles()
  $('extension-version').textContent = chrome.runtime.getManifest().version
  $('open-filter').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#discovery-filter') }))
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
  sourceTabId = tab?.id
  const data = await chrome.runtime.sendMessage({ type: 'getTab', tabId: tab?.id, pageUrl: tab?.url, title: tab?.title })
  let pageUrl = data?.pageUrl || tab?.url || ''
  let mediaSourceUrl = data?.mediaSourceUrl || pageUrl
  currentPageUrl = pageUrl
  $('page-title').textContent = data?.title || tab?.title || pageUrl
  $('page-title').title = pageUrl
  const pageStatus = el('div', { className: 'result' })
  $('panel-page').prepend(pageStatus)
  const sendPage = $('send-page')
  if (!isHttp(pageUrl)) sendPage.disabled = true
  if (data?.videoHost) sendPage.classList.add('primary')
  sendPage.addEventListener('click', () => send(mediaSourceUrl, 'YTDLP', pageStatus, sendPage))

  const extractButton = $('extract')
  const canExtract = () => isHttp(pageUrl) && Boolean(normalizeRouterUrl(settings.routerUrl))
  extractButton.disabled = !canExtract()
  let extracted = false
  extractButton.addEventListener('click', () => {
    void runExtract(tab?.id, mediaSourceUrl, extracted, true)
    extracted = true
  })
  onPlaylistActivate = () => {
    if (!extracted && canExtract() && !extractButton.disabled) {
      extracted = true
      void runExtract(tab?.id, mediaSourceUrl)
    }
  }
  // Video sites are what yt-dlp is for: look right away (the worker caches the answer).
  if (canExtract() && data?.videoHost) {
    extracted = true
    void runExtract(tab?.id, mediaSourceUrl)
  }

  const quickStatus = el('div', { className: 'result' })
  $('quick').after(quickStatus)
  $('quick').addEventListener('submit', (event) => {
    event.preventDefault()
    const url = $('quick-url').value.trim()
    if (url) void send(url, undefined, quickStatus, $('quick').querySelector('button'))
  })

  renderVideoCards(data?.videos || [], data?.currentVideo)
  renderItems(data?.items || [], data?.hiddenCount || 0)
  void initDownloadPreferences(settings, () => {
    infoGeneration++; infoQueue.length = 0
    mediaOverrides.clear()
    for (const row of document.querySelectorAll('[data-media-page]')) infoObserver.observe(row)
    if (!Object.keys(videoOptions(settings)).length) return
    for (const entry of itemRows.values()) {
      if (['video', 'audio', 'stream'].includes(entry.kind)) { entry.select.value = 'YTDLP'; entry.select.lmsSync?.() }
    }
  })
  let refreshTimer = 0
  const refresh = async () => {
    const latest = await chrome.runtime.sendMessage({ type: 'getTab', tabId: tab?.id })
    if (!latest) return
    const previousSource = mediaSourceUrl
    mediaSourceUrl = latest.mediaSourceUrl || latest.pageUrl || pageUrl
    if (latest.pageUrl && latest.pageUrl !== pageUrl) {
      extractGeneration++
      pageUrl = latest.pageUrl
      currentPageUrl = pageUrl
      $('page-title').textContent = latest.title || pageUrl
      $('page-title').title = pageUrl
      $('ytdlp').hidden = true
      $('ytdlp').replaceChildren()
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
    if (latest.title) $('page-title').textContent = latest.title
    renderVideoCards(latest.videos || [], latest.currentVideo)
    renderItems(latest.items || [], latest.hiddenCount || 0)
    if (latest.mediaSourceUrl && (mediaSourceUrl !== previousSource || (!extracted && latest.videoHost)) && canExtract()) { extracted = true; void runExtract(tab?.id, mediaSourceUrl) }
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'accountChanged') {
      latestJobs = []; paintProgress(); infoCache.clear(); mediaOverrides.clear(); infoGeneration++; infoQueue.length = 0
      $('ytdlp').replaceChildren(); renderVideoCards(); extracted = false
      void checkRouter(); void pollProgress(); return
    }
    if (message?.type === 'jobsChanged') { void pollProgress(); return }
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
  decorateSelects(); void pollProgress()
}

void init()
