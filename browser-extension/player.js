import { icon, hydrateIcons, decorateSelects } from './lib/ui.js'
import { previewData } from './lib/preview.js'
const $ = id => document.getElementById(id)
const video = $('player-video'), status = $('player-status'), toggle = $('player-toggle'), seek = $('player-seek')
let session, offset = 0, playing = false, switching = false, duration = 0
hydrateIcons()
const time = seconds => { const n = Math.max(0, Math.floor(seconds || 0)); return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2,'0')}:${String(n % 60).padStart(2,'0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2,'0')}` }
function setStatus(message, error = false) { status.textContent = message; status.className = `grow ${error ? 'error' : 'muted'}` }
function updateToggle() { toggle.replaceChildren(icon(video.paused ? 'play' : 'pause'), document.createTextNode(video.paused ? 'Воспроизвести' : 'Пауза')) }
function openAt(position, resume) {
  offset = Math.max(0, Math.min(Math.floor(position), duration ? Math.ceil(duration) - 1 : 604800))
  const url = new URL(session.streamUrl), [height, fps] = $('player-quality').value.split(':')
  url.searchParams.set('start', String(offset)); if (height) url.searchParams.set('height', height); if (fps) url.searchParams.set('fps', fps)
  playing = resume; switching = true; toggle.disabled = true; setStatus(`Открываю поток · ${session.nodeName || 'LMS'}…`)
  video.src = url.href; video.load()
}
toggle.addEventListener('click', async () => { if (!video.paused) { playing = false; video.pause() } else try { playing = true; await video.play() } catch { playing = false; setStatus('Нажмите воспроизведение ещё раз', true) } })
video.addEventListener('play', () => { playing = true; updateToggle() })
video.addEventListener('pause', () => { if (!switching) playing = false; updateToggle() })
video.addEventListener('loadedmetadata', () => { switching = false; toggle.disabled = false; setStatus(`Поток через ${session.nodeName || 'LMS'} · без сохранения файла`); if (playing) void video.play().catch(() => { playing = false }) })
video.addEventListener('waiting', () => setStatus('Буферизация потока…'))
video.addEventListener('playing', () => setStatus(`Поток через ${session.nodeName || 'LMS'}`))
video.addEventListener('error', () => { toggle.disabled = true; setStatus('Поток недоступен. Источник может ограничивать доступ ноды, либо сеанс завершён. Откройте просмотр заново.', true) })
video.addEventListener('timeupdate', () => { const position = Math.min(duration || Infinity, offset + video.currentTime); $('player-position').textContent = time(position); if (document.activeElement !== seek) seek.value = String(position) })
seek.addEventListener('input', () => { $('player-position').textContent = time(seek.value) })
seek.addEventListener('change', () => openAt(Number(seek.value), playing))
$('player-quality').addEventListener('change', () => openAt(offset + video.currentTime, playing))
window.addEventListener('pagehide', () => { video.pause(); video.removeAttribute('src'); video.load() })
chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'accountChanged') return
  playing = false; video.pause(); video.removeAttribute('src'); video.load(); toggle.disabled = true
  setStatus('Аккаунт изменился. Откройте просмотр заново из карточки LMS.', true)
})
async function init() {
  const id = new URLSearchParams(location.search).get('id')
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Откройте видео кнопкой просмотра в карточке LMS.')
  const saved = (await chrome.storage.session.get(`preview:${id}`))[`preview:${id}`]
  if (!saved) throw new Error('Сеанс просмотра завершён. Откройте видео ещё раз из карточки LMS.')
  const item = previewData(saved)
  $('player-title').textContent = item.title; document.title = `${item.title} — LMS`
  if (item.thumbnail) video.poster = item.thumbnail
  if (item.sourceUrl) { $('player-source').href = item.sourceUrl; $('player-source').hidden = false }
  setStatus('LMS получает доступные качества и готовит поток…')
  const answer = await chrome.runtime.sendMessage({ type: 'prepareStream', id })
  if (!answer?.ok) throw new Error(answer?.error || 'LMS не смог подготовить поток')
  session = answer.result
  duration = Number(session.info?.durationSeconds) || 0
  if (duration > 0) { $('player-timeline').hidden = false; seek.max = String(Math.ceil(duration) - 1); $('player-duration').textContent = time(duration) }
  const select = $('player-quality'); select.replaceChildren()
  for (const variant of [...(session.info?.variants || [])].reverse()) {
    if (!variant.height) continue
    select.append(new Option(variant.quality || `${variant.height}p`, `${variant.height}:${variant.fps}`))
  }
  const selected = `${session.info?.height}:${session.info?.fps}`
  if ([...select.options].some(option => option.value === selected)) select.value = selected
  if (!select.options.length) select.append(new Option('Исходное', ''))
  $('player-quality-field').hidden = false; decorateSelects()
  openAt(0, false)
}
void init().catch(error => setStatus(error.message || 'Не удалось открыть видео', true))
