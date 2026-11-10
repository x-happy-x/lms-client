// The popup and options page edit the same saved download defaults.
import { icon, decorateToggles, decorateSelects } from './ui.js'
export function parseTime(value) {
  if (value == null || String(value).trim() === '') return null
  const parts = String(value).trim().split(':')
  if (parts.length > 3 || parts.some(part => !/^\d+$/.test(part)) || (parts.length > 1 && parts.slice(1).some(part => Number(part) > 59))) throw new Error('Время: секунды или ЧЧ:ММ:СС')
  const seconds = parts.reduce((sum, part) => sum * 60 + Number(part), 0)
  if (seconds > 604800) throw new Error('Максимум — 7 дней')
  return seconds
}
export function videoOptions(settings, playlist) {
  return {
    ...(settings.videoAudioOnly ? { audioOnly: true, ...(settings.videoAudioFormat && settings.videoAudioFormat !== 'm4a' ? { audioFormat: settings.videoAudioFormat } : {}) } : {
      ...(Number(settings.videoMaxHeight) > 0 ? { maxHeight: Number(settings.videoMaxHeight) } : {}),
      ...(settings.videoContainer && settings.videoContainer !== 'auto' ? { container: settings.videoContainer } : {}),
      ...(Number(settings.videoMaxFps) > 0 ? { maxFps: Number(settings.videoMaxFps) } : {})
    }),
    ...(settings.videoStartSeconds != null ? { startSeconds: Number(settings.videoStartSeconds) } : {}),
    ...(settings.videoEndSeconds != null ? { endSeconds: Number(settings.videoEndSeconds) } : {}),
    ...(settings.videoForceKeyframes && (settings.videoStartSeconds != null || settings.videoEndSeconds != null) ? { forceKeyframes: true } : {}),
    ...(settings.videoEmbedMetadata ? { embedMetadata: true } : {}),
    ...(playlist == null ? {} : { playlist })
  }
}

export async function initDownloadPreferences(settings, onChange = () => {}) {
  const $ = (id) => document.getElementById(id)
  const advanced = document.createElement('details')
  advanced.className = 'advanced-options disclosure'
  advanced.innerHTML = `<summary><span class="disclosure-icon" data-icon="sliders"></span><span class="grow">Дополнительно · yt-dlp / FFmpeg</span><span class="disclosure-chevron" data-icon="chevron"></span></summary><div class="preferences-body"><div class="grid2"><label class="field"><span>Частота кадров</span><select id="videoMaxFps"><option value="0">Любая частота</option>${[24,25,30,50,60,120].map(n => `<option value="${n}">До ${n} fps</option>`).join('')}</select></label><label class="field"><span>Формат аудио</span><select id="videoAudioFormat">${['m4a','mp3','opus','flac','wav'].map(s => `<option value="${s}">${s.toUpperCase()}</option>`).join('')}</select></label></div><div class="grid2"><label class="field"><span>Начало фрагмента</span><input id="videoStartSeconds" placeholder="0:00 или секунды" inputmode="text" /></label><label class="field"><span>Конец фрагмента</span><input id="videoEndSeconds" placeholder="До конца видео" inputmode="text" /></label></div><label class="check"><input id="videoForceKeyframes" type="checkbox" /> Точная обрезка</label><label class="check"><input id="videoEmbedMetadata" type="checkbox" /> Встроить метаданные</label><p class="hint muted">Точная обрезка перекодирует границы фрагмента и занимает больше времени. Формат аудио применяется в режиме «Только аудио».</p><p id="advanced-error" class="result error" role="status"></p></div>`
  $('destination-status').after(advanced)
  // Static markup only; all user values are assigned through input properties.
  const { hydrateIcons } = await import('./ui.js')
  hydrateIcons(advanced); decorateToggles(advanced)
  const status = $('destination-status')
  const refresh = $('refresh-destinations')
  refresh.replaceChildren(icon('refresh'))
  refresh.title = refresh.ariaLabel = 'Обновить ноды и папки'
  refresh.className = 'icon icon-bordered'
  const keys = ['downloadNodeId', 'downloadPath', 'videoMaxHeight', 'videoAudioOnly', 'videoContainer', 'videoMaxFps', 'videoAudioFormat', 'videoStartSeconds', 'videoEndSeconds', 'videoForceKeyframes', 'videoEmbedMetadata']
  const updateSummary = () => {
    const summary = $('download-summary')
    if (!summary) return
    const quality = settings.videoAudioOnly ? `Только аудио · ${(settings.videoAudioFormat || 'm4a').toUpperCase()}` :
      [Number(settings.videoMaxHeight) ? `До ${settings.videoMaxHeight}p` : 'Лучшее качество', settings.videoContainer !== 'auto' ? settings.videoContainer?.toUpperCase() : ''].filter(Boolean).join(' · ')
    summary.textContent = `${quality} · ${settings.downloadPath || 'Папка по умолчанию'}`
    summary.title = summary.textContent
  }
  const save = async (key, value) => {
    settings[key] = value
    updateSummary()
    await chrome.storage.sync.set({ [key]: value })
    onChange()
  }
  const updateAudio = () => {
    $('videoMaxHeight').disabled = settings.videoAudioOnly
    $('videoContainer').disabled = settings.videoAudioOnly
    $('videoMaxFps').disabled = settings.videoAudioOnly
    $('videoAudioFormat').disabled = !settings.videoAudioOnly
    $('videoForceKeyframes').disabled = settings.videoStartSeconds == null && settings.videoEndSeconds == null
  }
  const loadTargets = async () => {
    const nodeId = $('downloadNodeId').value
    $('download-paths').replaceChildren()
    status.textContent = 'Папка на выбранной ноде. Пустое поле — папка по умолчанию.'
    if (!nodeId) return
    status.textContent = 'Загружаю папки…'
    const answer = await chrome.runtime.sendMessage({ type: 'storageTargets', nodeId })
    if ($('downloadNodeId').value !== nodeId) return
    if (!answer?.ok) { status.textContent = answer?.error || 'Не удалось получить папки ноды'; return }
    const result = answer.result
    for (const target of result?.targets || []) {
      if (!target.writable) continue
      const option = document.createElement('option')
      option.value = target.path
      const bytes = Number(target.freeBytes)
      const space = Number.isFinite(bytes) ? `${(bytes / (bytes >= 1e12 ? 1e12 : 1e9)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${bytes >= 1e12 ? 'ТБ' : 'ГБ'}` : 'неизвестно'
      option.label = `Свободно ${space}${target.path === result.defaultPath ? ' · по умолчанию' : ''}`
      $('download-paths').append(option)
    }
    status.textContent = result?.defaultPath ? `По умолчанию: ${result.defaultPath}. Можно указать подпапку.` : 'Можно указать папку или подпапку на ноде.'
  }
  for (const key of keys) {
    const input = $(key)
    if (input.type === 'checkbox') input.checked = Boolean(settings[key])
    else input.value = String(settings[key] ?? '')
    input.addEventListener('change', async () => {
      let value
      try {
        value = input.type === 'checkbox' ? input.checked : ['videoMaxHeight', 'videoMaxFps'].includes(key) ? Number(input.value) : ['videoStartSeconds', 'videoEndSeconds'].includes(key) ? parseTime(input.value) : input.value.trim()
        const start = key === 'videoStartSeconds' ? value : settings.videoStartSeconds
        const end = key === 'videoEndSeconds' ? value : settings.videoEndSeconds
        if (end != null && end <= (start || 0)) throw new Error('Конец фрагмента должен быть позже начала')
        input.setCustomValidity(''); $('advanced-error').textContent = ''
      } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); $('advanced-error').textContent = error.message; return }
      await save(key, value)
      updateAudio()
      if (key === 'downloadNodeId') {
        $('downloadPath').value = ''
        await save('downloadPath', '')
        await loadTargets()
      }
    })
  }
  updateAudio()
  updateSummary()
  decorateSelects()
  const loadNodes = async () => {
    const selected = settings.downloadNodeId || ''
    status.textContent = 'Загружаю ноды…'
    const answer = await chrome.runtime.sendMessage({ type: 'destinations' })
    const select = $('downloadNodeId')
    select.replaceChildren(new Option('Автоматически', ''))
    for (const node of answer?.nodes || []) {
      select.append(new Option(`${node.name}${node.status === 'offline' ? ' · не в сети' : ''}`, node.id))
    }
    if (selected && ![...select.options].some((option) => option.value === selected)) {
      select.append(new Option('Сохранённая нода · недоступна', selected))
    }
    select.value = selected
    if (!answer?.ok) { status.textContent = answer?.error || 'Не удалось получить ноды. Проверьте подключение к LMS.'; return }
    await loadTargets()
  }
  $('refresh-destinations').addEventListener('click', () => { void loadNodes() })
  if (settings.routerUrl) await loadNodes()
  else status.textContent = 'Подключите LMS в настройках, чтобы выбрать ноду и папку.'
}
