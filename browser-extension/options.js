import { initDiagnostics } from './lib/ytdlp-ui.js'
import { DEFAULT_SETTINGS } from './lib/router.js'
import { initDownloadPreferences } from './lib/preferences.js'
import { decorateToggles, hydrateIcons } from './lib/ui.js'
import { initAccountUI } from './lib/account-ui.js'
import { parseIgnoredExtensions, discoveryMinMb } from './lib/discovery-filter.js'

const $ = (id) => document.getElementById(id)
const TEXT = ['routerUrl', 'accountUrl', 'username', 'password']
const CHECKS = ['interceptDownloads', 'interceptMagnets', 'sniffMedia', 'notifications']

function save(patch) {
  void chrome.storage.sync.set(patch).then(() => {
    $('saved').textContent = 'Сохранено'
    setTimeout(() => ($('saved').textContent = 'Изменения сохраняются сразу.'), 1200)
  })
}

async function init() {
  decorateToggles()
  hydrateIcons()
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) }
  const refreshAccount = initAccountUI()
  $('extension-version').textContent = chrome.runtime.getManifest().version
  $('discoveryIgnoredExtensions').value = parseIgnoredExtensions(settings.discoveryIgnoredExtensions).join(', ')
  $('discoveryIgnoredExtensions').addEventListener('change', () => {
    const value = parseIgnoredExtensions($('discoveryIgnoredExtensions').value)
    $('discoveryIgnoredExtensions').value = value.join(', ')
    save({ discoveryIgnoredExtensions: value })
  })
  $('discoveryMinMb').value = String(discoveryMinMb(settings.discoveryMinMb))
  $('discoveryMinMb').addEventListener('change', () => {
    const value = discoveryMinMb($('discoveryMinMb').value)
    $('discoveryMinMb').value = String(value)
    save({ discoveryMinMb: value })
  })

  for (const key of TEXT) {
    $(key).value = settings[key] || ''
    $(key).addEventListener('change', async () => { settings[key] = $(key).value.trim(); await chrome.storage.sync.set({ [key]: settings[key] }); void refreshAccount() })
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
  void initDownloadPreferences(settings)
  void initDiagnostics(settings)
}

void init()
