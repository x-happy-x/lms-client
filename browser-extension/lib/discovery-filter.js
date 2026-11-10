import { extensionOf } from './links.js'

const MIME_EXTENSIONS = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/webm': 'webm'
}

export function parseIgnoredExtensions(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/)
  return [...new Set(entries.map(entry => String(entry).trim().toLowerCase().replace(/^\*?\./, ''))
    .filter(entry => /^[a-z0-9]+(?:[.+-][a-z0-9]+)*$/.test(entry) && entry.length <= 32))].slice(0, 100)
}

export function discoveryMinMb(value) {
  const size = Number(value ?? 1)
  return Number.isFinite(size) ? Math.max(0, Math.min(size, Number.MAX_SAFE_INTEGER / 1024 ** 2)) : 1
}

export function discoveryFilterReason(item, settings) {
  const ignored = parseIgnoredExtensions(settings.discoveryIgnoredExtensions ?? ['mp3'])
  let path = ''
  try { path = decodeURIComponent(new URL(item.url).pathname).toLowerCase() } catch { /* no usable filename */ }
  if (ignored.some(ext => path.endsWith(`.${ext}`))) return 'extension'
  if (!extensionOf(item.url)) {
    const type = (item.contentType || '').split(';')[0].trim().toLowerCase()
    if (ignored.includes(MIME_EXTENSIONS[type])) return 'extension'
  }
  // Zero, absent and invalid sizes represent unknown metadata in page scans.
  if (Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 && item.sizeBytes < discoveryMinMb(settings.discoveryMinMb) * 1024 ** 2) return 'size'
  return ''
}

export function filterDiscoveries(items, settings) {
  return items.filter(item => !discoveryFilterReason(item, settings))
}
