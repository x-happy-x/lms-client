// Router (lms-client /api/ui) client used by the service worker and popup.
import { normalizeRouterUrl, suggestType } from './links.js'

export const DEFAULT_SETTINGS = {
  routerUrl: '',
  username: '',
  password: '',
  interceptDownloads: true,
  interceptKinds: ['video', 'archive', 'disk', 'app', 'torrent'],
  interceptMinMb: 20,
  interceptMagnets: true,
  sniffMedia: true,
  maxSpeedBytes: 0,
  notifications: true
}

export function authHeaders(settings) {
  if (!settings.username && !settings.password) return {}
  return { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${settings.username}:${settings.password}`)))}` }
}

async function request(settings, path, init = {}, fetchImpl = fetch) {
  const base = normalizeRouterUrl(settings.routerUrl)
  if (!base) throw new Error('Не указан адрес LMS — откройте настройки расширения')
  const response = await fetchImpl(`${base}/api/ui${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(settings), ...(init.headers || {}) }
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

/**
 * Asks the router to run yt-dlp on a node over the page (no download): one video or a
 * playlist / page with several videos as `entries`. Slow on big playlists (up to ~2 min).
 */
export function extractMedia(settings, url, fetchImpl) {
  return request(settings, '/media/extract', { method: 'POST', body: JSON.stringify({ url }) }, fetchImpl)
}

export function health(settings, fetchImpl) {
  return request(settings, '/system/health', {}, fetchImpl)
}

/**
 * Picks node, type and folder from a preflight answer. The wanted type wins when the node
 * supports it; otherwise the node's recommendation. Nodes that cannot take the link are skipped.
 */
export function planJob(preflight, url, wantedType) {
  const wanted = wantedType || suggestType(url)
  const usable = (preflight?.nodes || []).filter((node) => node.supportedTypes?.length && !node.error)
  if (!usable.length) {
    const reason = (preflight?.nodes || []).map((node) => node.error || (node.status !== 'online' && node.statusText)).find(Boolean)
    throw new Error(reason || 'Нет нод, которые могут скачать эту ссылку')
  }
  const withWanted = usable.filter((node) => node.supportedTypes.includes(wanted))
  const pool = withWanted.length ? withWanted : usable
  const node = pool.find((item) => item.nodeId === preflight.bestNodeId) || pool[0]
  const type = node.supportedTypes.includes(wanted) ? wanted : node.recommendedType || node.supportedTypes[0]
  return { nodeId: node.nodeId, nodeName: node.nodeName, type, storagePath: node.defaultStoragePath || undefined }
}

/** Preflight + create; returns the created job and where it went. */
export async function sendToRouter(settings, url, { type, maxSpeedBytes } = {}, fetchImpl) {
  const preflight = await request(settings, '/jobs/preflight', { method: 'POST', body: JSON.stringify({ url }) }, fetchImpl)
  const plan = planJob(preflight, url, type)
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
        maxSpeedBytes: limit > 0 ? limit : undefined
      })
    },
    fetchImpl
  )
  return { job, plan }
}
