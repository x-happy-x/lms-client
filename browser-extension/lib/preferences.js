// The popup and options page edit the same saved download defaults.
export function videoOptions(settings, playlist) {
  return {
    ...(settings.videoAudioOnly ? { audioOnly: true } : {
      ...(Number(settings.videoMaxHeight) > 0 ? { maxHeight: Number(settings.videoMaxHeight) } : {}),
      ...(settings.videoContainer && settings.videoContainer !== 'auto' ? { container: settings.videoContainer } : {})
    }),
    ...(playlist == null ? {} : { playlist })
  }
}

export async function initDownloadPreferences(settings, onChange = () => {}) {
  const $ = (id) => document.getElementById(id)
  const status = $('destination-status')
  const keys = ['downloadNodeId', 'downloadPath', 'videoMaxHeight', 'videoAudioOnly', 'videoContainer']
  const updateSummary = () => {
    const summary = $('download-summary')
    if (!summary) return
    const quality = settings.videoAudioOnly ? 'Только аудио · M4A' :
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
      option.label = `Свободно ${(target.freeBytes / 1024 ** 3).toFixed(1)} ГБ`
      $('download-paths').append(option)
    }
    status.textContent = result?.defaultPath ? `По умолчанию: ${result.defaultPath}. Можно указать подпапку.` : 'Можно указать папку или подпапку на ноде.'
  }
  for (const key of keys) {
    const input = $(key)
    if (input.type === 'checkbox') input.checked = Boolean(settings[key])
    else input.value = String(settings[key] ?? '')
    input.addEventListener('change', async () => {
      const value = input.type === 'checkbox' ? input.checked : key === 'videoMaxHeight' ? Number(input.value) : input.value.trim()
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
