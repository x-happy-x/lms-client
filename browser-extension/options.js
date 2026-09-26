import { DEFAULT_SETTINGS } from './lib/router.js'

const $ = (id) => document.getElementById(id)
const TEXT = ['routerUrl', 'username', 'password']
const CHECKS = ['interceptDownloads', 'interceptMagnets', 'sniffMedia', 'notifications']

function save(patch) {
  void chrome.storage.sync.set(patch).then(() => {
    $('saved').textContent = 'Сохранено'
    setTimeout(() => ($('saved').textContent = 'Изменения сохраняются сразу.'), 1200)
  })
}

async function init() {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) }

  for (const key of TEXT) {
    $(key).value = settings[key] || ''
    $(key).addEventListener('change', () => save({ [key]: $(key).value.trim() }))
  }
  for (const key of CHECKS) {
    $(key).checked = Boolean(settings[key])
    $(key).addEventListener('change', () => save({ [key]: $(key).checked }))
  }

  const kinds = [...$('interceptKinds').querySelectorAll('input')]
  for (const input of kinds) {
    input.checked = settings.interceptKinds.includes(input.value)
    input.addEventListener('change', () => save({ interceptKinds: kinds.filter((item) => item.checked).map((item) => item.value) }))
  }

  $('interceptMinMb').value = String(settings.interceptMinMb)
  $('interceptMinMb').addEventListener('change', () => save({ interceptMinMb: Math.max(0, Number($('interceptMinMb').value) || 0) }))

  $('maxSpeedBytes').value = String(settings.maxSpeedBytes || 0)
  $('maxSpeedBytes').addEventListener('change', () => save({ maxSpeedBytes: Number($('maxSpeedBytes').value) || 0 }))

  $('test').addEventListener('click', async () => {
    const result = $('test-result')
    result.textContent = 'Проверка…'
    result.className = 'result muted'
    const answer = await chrome.runtime.sendMessage({
      type: 'health',
      settings: { routerUrl: $('routerUrl').value.trim(), username: $('username').value.trim(), password: $('password').value }
    })
    result.textContent = answer?.ok ? '✓ LMS отвечает' : answer?.error || 'Нет ответа'
    result.className = `result ${answer?.ok ? 'ok' : 'error'}`
  })
}

void init()
