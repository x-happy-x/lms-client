import { hostOf, isHttp, isMagnet, normalizeRouterUrl, suggestType } from './lib/links.js'
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
  list.replaceChildren()
  $('count').textContent = items.length ? String(items.length) : ''
  $('empty').hidden = items.length > 0
  for (const item of items) {
    const typeSelect = el(
      'select',
      { className: 'type', title: 'Способ загрузки' },
      TYPES.map(([value, label]) => el('option', { value, textContent: label }))
    )
    typeSelect.value = suggestType(item.url)
    const status = el('div', { className: 'result' })
    const button = el('button', { className: 'btn primary small', textContent: 'В LMS' })
    button.addEventListener('click', () => send(item.url, typeSelect.value, status, button))
    const copy = el('button', { className: 'icon small', textContent: '⧉', title: 'Копировать ссылку' })
    copy.addEventListener('click', () => navigator.clipboard.writeText(item.url))
    list.append(
      el('li', { className: 'item' }, [
        el('span', { className: `kind kind-${item.kind}`, textContent: KIND_LABEL[item.kind] || item.kind }),
        el('div', { className: 'info' }, [
          el('div', { className: 'name', textContent: item.name, title: item.url }),
          el('div', { className: 'host muted', textContent: isMagnet(item.url) ? 'magnet' : hostOf(item.url) }),
          status
        ]),
        el('div', { className: 'actions' }, [typeSelect, el('div', { className: 'row tight' }, [copy, button])])
      ])
    )
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
  const pageUrl = data?.pageUrl || tab?.url || ''
  $('page-title').textContent = data?.title || tab?.title || pageUrl
  $('page-title').title = pageUrl
  const pageStatus = el('div', { className: 'result' })
  $('page-title').after(pageStatus)
  const sendPage = $('send-page')
  if (!isHttp(pageUrl)) sendPage.disabled = true
  if (data?.videoHost) sendPage.classList.add('primary')
  sendPage.addEventListener('click', () => send(pageUrl, 'YTDLP', pageStatus, sendPage))

  const quickStatus = el('div', { className: 'result' })
  $('quick').after(quickStatus)
  $('quick').addEventListener('submit', (event) => {
    event.preventDefault()
    const url = $('quick-url').value.trim()
    if (url) void send(url, undefined, quickStatus)
  })

  renderItems(data?.items || [])
  void checkRouter()
}

void init()
