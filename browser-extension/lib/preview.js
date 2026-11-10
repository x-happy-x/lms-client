export function previewUrl(raw) {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 16384) throw new Error('Для просмотра нужна HTTP(S)-ссылка без логина и пароля')
  return url.href
}

export function previewMode(item) {
  return 'player'
}

export function previewData(item) {
  const url = previewUrl(item.url)
  let sourceUrl, thumbnail
  try { sourceUrl = previewUrl(item.sourceUrl) } catch { /* source unavailable */ }
  try { thumbnail = previewUrl(item.thumbnail) } catch { /* poster unavailable */ }
  return { url, sourceUrl, thumbnail, page: Boolean(item.page), ...(Number(item.maxHeight) >= 144 && Number(item.maxHeight) <= 4320 ? { maxHeight: Number(item.maxHeight) } : {}), ...(Number(item.maxFps) >= 1 && Number(item.maxFps) <= 240 ? { maxFps: Number(item.maxFps) } : {}), title: String(item.title || item.name || 'Видео').slice(0, 200), contentType: String(item.contentType || '').split(';')[0].slice(0, 100), createdAt: Date.now() }
}

export async function openPreview(item) {
  const data = previewData(item)
  const values = await chrome.storage.session.get(null)
  await chrome.storage.session.remove(Object.keys(values).filter(key => key.startsWith('preview:') && values[key]?.createdAt < Date.now() - 6 * 3600e3))
  const id = crypto.randomUUID(), key = `preview:${id}`
  await chrome.storage.session.set({ [key]: data })
  try {
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`player.html?id=${id}`) })
    await chrome.storage.session.set({ [`previewTab:${tab.id}`]: key })
  } catch (error) { await chrome.storage.session.remove(key); throw error }
  return { ok: true, mode: 'player' }
}

export async function forgetPreview(tabId) {
  const key = `previewTab:${tabId}`, data = (await chrome.storage.session.get(key))[key]
  await chrome.storage.session.remove(data ? [key, data] : [key])
}
