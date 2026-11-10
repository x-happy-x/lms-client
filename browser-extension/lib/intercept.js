// Pure decisions for download interception and network media sniffing.
import { extensionOf, isHttp, kindFromContentType, kindOf } from './links.js'

/** Kind of a browser download item: by URL, then file name, then MIME; 'file' when unknown. */
export function downloadKind(item) {
  const byUrl = kindOf(item.finalUrl || item.url || '')
  if (byUrl) return byUrl
  const name = (item.filename || '').split(/[\\/]/).pop()
  if (name.includes('.')) {
    const byName = kindOf(`http://x/${encodeURIComponent(name)}`)
    if (byName) return byName
  }
  return kindFromContentType(item.mime) || 'file'
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/**
 * Whether to take a browser download away and hand it to LMS. Skips our own fallback
 * downloads, blob:/data: URLs (they only exist in the page), files from the router itself
 * ("download to this device") and files below the size threshold.
 */
export function shouldIntercept(settings, item, routerBase, selfId) {
  if (!settings.interceptDownloads || !routerBase) return false
  if (item.byExtensionId && item.byExtensionId === selfId) return false
  const url = item.finalUrl || item.url || ''
  if (!isHttp(url)) return false
  if (sameOrigin(url, routerBase)) return false
  if (item.state && item.state !== 'in_progress') return false
  const kind = downloadKind(item)
  if (!settings.interceptKinds.includes(kind)) return false
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : -1
  const min = Math.max(0, Number(settings.interceptMinMb) || 0) * 1024 * 1024
  return size < 0 || size >= min
}

const SEGMENT_EXT = new Set(['ts', 'm4s', 'cmfv', 'cmfa', 'vtt', 'key'])

export function isMediaSegment(url) {
  try {
    const parsed = new URL(url)
    return SEGMENT_EXT.has(extensionOf(url)) ||
      /(?:^|[/_.-])(?:init|segment|seg|chunk|fragment)[-_.\d/]/i.test(parsed.pathname) ||
      ['range', 'bytestart', 'byteend'].some((key) => parsed.searchParams.has(key))
  } catch {
    return false
  }
}

/**
 * Kind of a network response worth listing for the tab, or ''. Streams (HLS/DASH manifests)
 * and torrents are kept from any request type. Players also fetch complete media with
 * XHR/fetch; exclude recognizable MSE fragments, but keep HTTP Range responses whose
 * URL still addresses the full file.
 */
export function sniffKind(url, contentType, requestType) {
  if (!isHttp(url)) return ''
  const byType = kindFromContentType(contentType)
  const byExt = kindOf(url)
  if (byType === 'stream' || byExt === 'stream') return 'stream'
  if (byType === 'torrent' || byExt === 'torrent') return 'torrent'
  if (isMediaSegment(url)) return ''
  const kind = byType || byExt
  if ((kind === 'video' || kind === 'audio') && ['media', 'xmlhttprequest', 'other'].includes(requestType)) return kind
  return ''
}

/** Preserve MIME classification for extensionless manifests and the full Range size. */
export function sniffCandidate(details) {
  if (details.statusCode && (details.statusCode < 200 || details.statusCode >= 300)) return null
  const header = (name) => (details.responseHeaders || []).find((h) => h.name.toLowerCase() === name)?.value || ''
  const contentType = header('content-type')
  const kind = sniffKind(details.url, contentType, details.type)
  if (!kind) return null
  const total = /\/(\d+)$/.exec(header('content-range'))?.[1]
  const size = Number(total || (details.statusCode !== 206 ? header('content-length') : 0))
  return {
    url: details.url, source: kind, kind, contentType,
    ...(size > 0 && Number.isFinite(size) && kind !== 'stream' ? { sizeBytes: size } : {})
  }
}
