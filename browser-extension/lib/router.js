// Router (lms-client /api/ui) client used by the service worker and popup.
import { normalizeRouterUrl, suggestType } from './links.js'
import { videoOptions as savedVideoOptions } from './preferences.js'
import { sourceFailure } from './source-error.js'

export const DEFAULT_SETTINGS = {
  routerUrl: '',
  accountUrl: 'https://account.crubs.crazedns.ru',
  username: '',
  password: '',
  interceptDownloads: true,
  interceptKinds: ['video', 'archive', 'disk', 'app', 'torrent'],
  interceptMinMb: 20,
  interceptMagnets: true,
  sniffMedia: true,
  discoveryIgnoredExtensions: ['mp3'],
  discoveryMinMb: 1,
  maxSpeedBytes: 0,
  downloadNodeId: '',
  downloadPath: '',
  videoMaxHeight: 0,
  videoAudioOnly: false,
  videoContainer: 'auto',
  videoAudioFormat: 'm4a',
  videoMaxFps: 0,
  videoStartSeconds: null,
  videoEndSeconds: null,
  videoForceKeyframes: false,
  videoEmbedMetadata: false,
  notifications: true
}

export function authHeaders(settings) {
  if (settings.accountToken) return { Authorization: `Bearer ${settings.accountToken}` }
  if (!settings.username && !settings.password) return {}
  return { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${settings.username}:${settings.password}`)))}` }
}

async function request(settings, path, init = {}, fetchImpl = fetch) {
  const base = normalizeRouterUrl(settings.routerUrl)
  if (!base) throw new Error('Не указан адрес LMS — откройте настройки расширения')
  const response = await fetchImpl(`${base}/api/ui${path}`, {
    ...init,
    redirect: 'error',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...authHeaders(settings), ...(init.headers || {}) }
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!response.ok) {
    if (response.status === 401) await settings.onUnauthorized?.()
    const message = body?.authRequired ? 'Войдите через Account в расширении LMS. Вход на сайте выполняется отдельно.' : body?.error || `HTTP ${response.status}`
    const sourceError = path.startsWith('/media/') && ![401, 403].includes(response.status) ? sourceFailure(message) : null
    const error = new Error(sourceError?.message || message)
    if (sourceError) error.code = sourceError.code
    error.status = response.status
    throw error
  }
  if (!body) throw new Error('LMS вернул страницу вместо API. Войдите через Account и проверьте адрес роутера.')
  return body
}

/**
 * Asks the router to run yt-dlp on a node over the page (no download): one video or a
 * playlist / page with several videos as `entries`. Slow on big playlists (up to ~2 min).
 */
export function extractMedia(settings, url, fetchImpl) {
  return request(settings, '/media/extract', { method: 'POST', body: JSON.stringify({ url, nodeId: settings.downloadNodeId || undefined }) }, fetchImpl)
}

export function listNodes(settings, fetchImpl) {
  return request(settings, '/nodes?enabled=true', {}, fetchImpl)
}

export function mediaInfo(settings, url, direct = false, fetchImpl) {
  return request(settings, '/media/info', { method: 'POST', body: JSON.stringify({ url, direct, nodeId: settings.downloadNodeId || undefined, maxHeight: Number(settings.videoMaxHeight) || undefined, maxFps: Number(settings.videoMaxFps) || undefined }) }, fetchImpl)
}

export async function prepareMedia(settings, item, fetchImpl) {
  const result = await request(settings, '/media/preview', { method: 'POST', body: JSON.stringify({ url: item.url, direct: !item.page, nodeId: settings.downloadNodeId || undefined, maxHeight: Number(item.maxHeight || settings.videoMaxHeight) || undefined, maxFps: Number(item.maxFps || settings.videoMaxFps) || undefined }) }, fetchImpl)
  if (!/^\/api\/ui\/media\/stream\/[A-Za-z0-9_-]{43}$/.test(result.streamUrl || '')) throw new Error('Некорректный адрес потока LMS')
  return { ...result, streamUrl: normalizeRouterUrl(settings.routerUrl) + result.streamUrl }
}

export function listJobs(settings, fetchImpl) { return request(settings, '/jobs', {}, fetchImpl) }

export function storageTargets(settings, nodeId, fetchImpl) {
  return request(settings, `/nodes/${encodeURIComponent(nodeId)}/storage/targets`, {}, fetchImpl)
}

export function health(settings, fetchImpl) {
  return request(settings, '/system/health', {}, fetchImpl)
}

/**
 * Picks node, type and folder from a preflight answer. The wanted type wins when the node
 * supports it; otherwise the node's recommendation. Nodes that cannot take the link are skipped.
 */
export function planJob(preflight, url, wantedType, preferredNodeId) {
  const wanted = wantedType || suggestType(url)
  const usable = (preflight?.nodes || []).filter((node) => node.supportedTypes?.length && !node.error)
  if (!usable.length) {
    const reason = (preflight?.nodes || []).map((node) => node.error || (node.status !== 'online' && node.statusText)).find(Boolean)
    throw new Error(reason || 'Нет нод, которые могут скачать эту ссылку')
  }
  if (preferredNodeId) {
    const selected = usable.find((node) => node.nodeId === preferredNodeId)
    if (!selected) throw new Error('Выбранная нода недоступна. Выберите другую ноду или автоматический выбор.')
    if (!selected.supportedTypes.includes(wanted)) throw new Error(`Выбранная нода не поддерживает ${wanted}`)
    return { nodeId: selected.nodeId, nodeName: selected.nodeName, type: wanted, storagePath: selected.defaultStoragePath || undefined }
  }
  const withWanted = usable.filter((node) => node.supportedTypes.includes(wanted))
  const pool = withWanted.length ? withWanted : usable
  const node = pool.find((item) => item.nodeId === preflight.bestNodeId) || pool[0]
  const type = node.supportedTypes.includes(wanted) ? wanted : node.recommendedType || node.supportedTypes[0]
  return { nodeId: node.nodeId, nodeName: node.nodeName, type, storagePath: node.defaultStoragePath || undefined }
}

/** Preflight + create; returns the created job and where it went. */
export async function sendToRouter(settings, url, { type, maxSpeedBytes, nodeId, storagePath, ytdlpOptions } = {}, fetchImpl) {
  const preflight = await request(settings, '/jobs/preflight', { method: 'POST', body: JSON.stringify({ url }) }, fetchImpl)
  const videoOptions = ytdlpOptions || savedVideoOptions(settings)
  const needsOptions = (type || suggestType(url)) === 'YTDLP' && Object.keys(videoOptions).length > 0
  const needsAdvanced = ['audioFormat', 'maxFps', 'startSeconds', 'endSeconds', 'forceKeyframes', 'embedMetadata'].some(key => key in videoOptions)
  let candidates = preflight
  if (needsOptions) {
    candidates = { ...preflight, nodes: (preflight.nodes || []).filter((node) => node.ytdlpOptionsSupported && (!needsAdvanced || node.advancedOptionsSupported)) }
    const preferred = nodeId ?? settings.downloadNodeId
    if (!candidates.nodes.length || (preferred && !candidates.nodes.some((node) => node.nodeId === preferred))) {
      throw new Error('Для качества и плейлистов обновите lms-node и lms-client. Выбранная нода не сообщает поддержку параметров yt-dlp.')
    }
  }
  const plan = planJob(candidates, url, type, nodeId ?? settings.downloadNodeId)
  plan.storagePath = (storagePath ?? settings.downloadPath)?.trim() || plan.storagePath
  if (type === 'YTDLP' && plan.type !== 'YTDLP' && Object.keys(videoOptions).length) {
    throw new Error('Нет ноды с yt-dlp для выбранных параметров видео')
  }
  const limit = maxSpeedBytes ?? settings.maxSpeedBytes
  const job = await request(
    settings,
    '/jobs',
    {
      method: 'POST',
      body: JSON.stringify({
        type: plan.type,
        url,
        nodeId: plan.nodeId,
        storagePath: plan.storagePath,
        startImmediately: true,
        maxSpeedBytes: limit > 0 ? limit : undefined,
        ytdlpOptions: plan.type === 'YTDLP' && Object.keys(videoOptions).length ? videoOptions : undefined
      })
    },
    fetchImpl
  )
  return { job, plan }
}
