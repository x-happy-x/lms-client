// Pure link classification shared by the service worker, popup and tests.

export const VIDEO_HOSTS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'rutube.ru', 'vk.com', 'vkvideo.ru', 'twitch.tv',
  'tiktok.com', 'dailymotion.com', 'ok.ru', 'instagram.com', 'x.com', 'twitter.com', 'reddit.com'
]

const EXT = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'flv', 'ts', 'm2ts', 'mpg', 'mpeg', '3gp'],
  stream: ['m3u8', 'mpd'],
  audio: ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'avif', 'bmp', 'tif', 'tiff'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'epub', 'fb2', 'djvu'],
  disk: ['iso', 'img', 'dmg', 'vhd', 'vhdx', 'vmdk', 'qcow2'],
  app: ['apk', 'exe', 'msi', 'deb', 'rpm', 'appimage', 'pkg'],
  torrent: ['torrent']
}

const BY_EXT = new Map(Object.entries(EXT).flatMap(([kind, list]) => list.map((ext) => [ext, kind])))

/** Kinds worth offering as downloads (images on a page are usually not). */
const DOWNLOADABLE = new Set(['video', 'stream', 'audio', 'archive', 'document', 'disk', 'app', 'torrent'])

export function isMagnet(url) {
  return typeof url === 'string' && /^magnet:\?/i.test(url.trim())
}

export function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim())
}

export function extensionOf(url) {
  try {
    const path = new URL(url).pathname
    const name = decodeURIComponent(path.split('/').pop() || '')
    const dot = name.lastIndexOf('.')
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  } catch {
    return ''
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function isVideoHost(url) {
  const host = hostOf(url)
  return VIDEO_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))
}

/** Kind by MIME type from a response (webRequest sniffing). */
export function kindFromContentType(contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  if (!type) return ''
  if (type === 'application/vnd.apple.mpegurl' || type === 'application/x-mpegurl' || type === 'application/dash+xml') return 'stream'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/x-bittorrent') return 'torrent'
  if (type === 'application/zip' || type === 'application/x-7z-compressed' || type === 'application/vnd.rar') return 'archive'
  if (type === 'application/pdf') return 'document'
  return ''
}

/** Kind of a link: magnet, by extension, or '' when it is just a page. */
export function kindOf(url) {
  if (isMagnet(url)) return 'magnet'
  if (!isHttp(url)) return ''
  return BY_EXT.get(extensionOf(url)) || ''
}

export function isDownloadable(url) {
  const kind = kindOf(url)
  return kind === 'magnet' || DOWNLOADABLE.has(kind)
}

/**
 * Job type for the router. Magnets and .torrent → TORRENT; video sites and HLS/DASH
 * streams → YTDLP (it assembles streams); other files → DIRECT.
 */
export function suggestType(url) {
  const kind = kindOf(url)
  if (kind === 'magnet' || kind === 'torrent') return 'TORRENT'
  if (kind === 'stream' || isVideoHost(url)) return 'YTDLP'
  return 'DIRECT'
}

/** Short display name: magnet dn, file name, or host + path. */
export function displayName(url) {
  if (isMagnet(url)) {
    const dn = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dn')
    return dn || 'Magnet-ссылка'
  }
  try {
    const parsed = new URL(url)
    const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
    return last || parsed.hostname
  } catch {
    return url
  }
}

/**
 * Normalizes raw candidates from a page scan: resolves relative URLs, drops blob:/data:
 * and duplicates, keeps only downloadable links (plus video elements, which are media
 * even without an extension), and orders them videos first.
 */
export function normalizeCandidates(candidates, baseUrl) {
  const seen = new Set()
  const out = []
  for (const candidate of candidates) {
    let url = candidate.url
    if (!url || typeof url !== 'string') continue
    url = url.trim()
    if (!isMagnet(url)) {
      try {
        url = new URL(url, baseUrl).href
      } catch {
        continue
      }
      if (!isHttp(url)) continue
    }
    const kind = kindOf(url) || (candidate.source === 'video' ? 'video' : candidate.source === 'audio' ? 'audio' : '')
    const keep = kind === 'magnet' || DOWNLOADABLE.has(kind) || candidate.source === 'download-attr'
    if (!keep || seen.has(url)) continue
    seen.add(url)
    out.push({ url, kind: kind || 'file', name: candidate.name || displayName(url), source: candidate.source })
  }
  const order = ['video', 'stream', 'audio', 'magnet', 'torrent']
  const rank = (item) => {
    const index = order.indexOf(item.kind)
    return index === -1 ? order.length : index
  }
  return out.sort((a, b) => rank(a) - rank(b))
}

/** Normalizes the router address the way the Android app does. */
export function normalizeRouterUrl(raw) {
  let value = (raw || '').trim().replace(/\/+$/, '')
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  value = value.replace(/\/api\/ui$/, '').replace(/\/api$/, '')
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}
