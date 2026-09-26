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

const SEGMENT_EXT = new Set(['ts', 'm4s', 'vtt', 'key'])

/**
 * Kind of a network response worth listing for the tab, or ''. Streams (HLS/DASH manifests)
 * and torrents are kept from any request type; plain video/audio only from media elements —
 * XHR video is almost always MSE segments that cannot be downloaded on their own.
 */
export function sniffKind(url, contentType, requestType) {
  if (!isHttp(url)) return ''
  const ext = extensionOf(url)
  const byType = kindFromContentType(contentType)
  const byExt = kindOf(url)
  if (byType === 'stream' || byExt === 'stream') return 'stream'
  if (byType === 'torrent' || byExt === 'torrent') return 'torrent'
  if ((byType === 'video' || byType === 'audio') && requestType === 'media' && !SEGMENT_EXT.has(ext)) return byType
  return ''
}
