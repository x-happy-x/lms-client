// Public page identity and CDN deduplication; never infer video resolution from file size.
export function canonicalVideoPage(raw) {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    if (!['vk.com', 'www.vk.com', 'm.vk.com', 'vkvideo.ru', 'www.vkvideo.ru', 'm.vkvideo.ru'].includes(url.hostname)) return ''
    const routed = ['z', 'w'].map(key => url.searchParams.get(key) || '').find(value => /^video-?\d+_\d+/.test(value))
    const match = /^\/video(-?\d+_\d+)$/.exec(url.pathname) || /^video(-?\d+_\d+)/.exec(routed || '')
    if (match) return `https://vkvideo.ru/video${match[1]}`
    const oid = url.searchParams.get('oid'), id = url.searchParams.get('id')
    if (url.pathname === '/video_ext.php' && /^-?\d+$/.test(oid || '') && /^\d+$/.test(id || '')) return `https://vkvideo.ru/video${oid}_${id}`
  } catch { /* not a supported page */ }
  return ''
}
export function isVkMedia(raw) {
  try { const host = new URL(raw).hostname; return host.endsWith('.vkuser.net') || host.endsWith('.vkuser.ru') || (host.startsWith('vk') && host.endsWith('.okcdn.ru')) }
  catch { return false }
}
export function dedupeVkMedia(items) {
  const seen = new Map(), result = []
  for (const item of items) {
    if (!isVkMedia(item.url)) { result.push(item); continue }
    const url = new URL(item.url)
    // Preserve every content/representation parameter; only remove transport signatures.
    for (const key of ['expires', 'sig', 'srcIp', 'srcAg', 'pr', 'zs']) url.searchParams.delete(key)
    url.searchParams.sort()
    const key = `${item.kind}|${url.hostname}|${url.pathname}|${url.searchParams}`
    const prior = seen.get(key)
    if (prior) { Object.assign(prior, item); continue }
    const copy = { ...item }; seen.set(key, copy); result.push(copy)
  }
  return result
}
