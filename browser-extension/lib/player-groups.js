// Group only sources tied to a DOM player; titles, sizes and CDN names are not identities.
import { canonicalVideoPage } from './media-source.js'
export function mediaUrl(raw, base) {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  try { const url = new URL(raw, base); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 16384 ? url.href : '' } catch { return '' }
}
export function normalizePlayers(players, frameId, pageUrl) {
  const out = []
  for (const player of (Array.isArray(players) ? players : []).slice(0, 20)) {
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(player?.id || '')) continue
    const url = canonicalVideoPage(player.pageUrl) || mediaUrl(player.pageUrl || pageUrl)
    if (!url) continue
    const urls = key => [...new Set((Array.isArray(player[key]) ? player[key] : []).slice(0, 20).map(value => mediaUrl(value, pageUrl)).filter(Boolean))]
    out.push({ id: `${frameId}:${player.id}`, frameId, url, page: player.page !== false,
      title: String(player.title || 'Видео').slice(0, 200), thumbnail: mediaUrl(player.thumbnail, pageUrl),
      ...(Number.isFinite(player.durationSeconds) && player.durationSeconds > 0 ? { durationSeconds: player.durationSeconds } : {}),
      sources: urls('sources'), aliases: urls('aliases'), active: player.active === true })
  }
  return out
}
export function groupPlayerSources(items, frames) {
  const players = Object.values(frames || {}).flat(), byId = new Map(players.map(player => [player.id, player]))
  const roots = new Map()
  function root(player, visited = new Set()) {
    if (visited.has(player.id)) return player
    visited.add(player.id)
    const parents = players.filter(other => other.id !== player.id && other.aliases.includes(player.url))
    return parents.length === 1 ? root(parents[0], visited) : player
  }
  for (const player of players) { const owner = root(player); roots.set(owner.id, owner) }
  const remaining = items.filter(item => {
    if (!['video', 'stream'].includes(item.kind)) return true // Music stays independent.
    const explicit = item.playerId ? byId.get(`${item.frameId}:${item.playerId}`) : null
    if (explicit) return false
    const exact = players.filter(player => player.sources.includes(item.url) || player.aliases.includes(item.url))
    if (exact.length) return false
    // Never hide independent download links or infer ownership from title/size.
    if (!['video', 'stream', 'resource'].includes(item.source) || !Number.isInteger(item.frameId)) return true
    const local = players.filter(player => player.frameId === item.frameId)
    const active = local.filter(player => player.active)
    const owner = active.length === 1 ? active[0] : local.length === 1 ? local[0] : null
    return !owner
  })
  const videos = [...roots.values()].map(owner => ({ url: owner.url, page: owner.page, title: owner.title, thumbnail: owner.thumbnail, durationSeconds: owner.durationSeconds,
    aliases: [...new Set([...owner.aliases, ...players.filter(player => root(player).id === owner.id).map(player => player.url)])].filter(url => url !== owner.url).slice(0, 24), kind: 'video', pending: true }))
  return { items: remaining, videos }
}
