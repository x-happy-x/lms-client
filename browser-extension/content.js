// Scans the page for media and download links and hands magnet clicks to LMS.
// Classic script (content scripts cannot be modules); classification happens in the worker.
;(() => {
  if (window.__lmsContent) return
  window.__lmsContent = true

  const MAGNET = /^magnet:\?/i
  let magnetIntercept = true
  let timer = 0

  chrome.storage.sync.get({ interceptMagnets: true }, (value) => {
    magnetIntercept = value.interceptMagnets !== false
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.interceptMagnets) magnetIntercept = changes.interceptMagnets.newValue !== false
  })

  const PAGE_EXT = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml', 'cgi', 'js', 'css', 'json', 'xml', 'svg', 'ico'])

  // Cheap pre-filter so pages with thousands of links do not flood the worker.
  function looksLikeFile(href) {
    try {
      const url = new URL(href)
      if (!/^https?:$/.test(url.protocol)) return false
      const match = /\.([a-z0-9]{1,9})$/i.exec(url.pathname)
      return Boolean(match) && !PAGE_EXT.has(match[1].toLowerCase())
    } catch {
      return false
    }
  }

  function text(node) {
    return (node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  function collect() {
    const items = []
    const push = (url, source, name) => {
      if (url && !/^(blob|data|javascript):/i.test(url)) items.push({ url, source, name: name || '' })
    }
    for (const media of document.querySelectorAll('video, audio')) {
      const source = media.tagName === 'VIDEO' ? 'video' : 'audio'
      const name = media.getAttribute('title') || ''
      push(media.currentSrc || media.src, source, name)
      for (const child of media.querySelectorAll('source[src]')) push(child.src, source, name)
    }
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || ''
      if (MAGNET.test(href)) push(href, 'magnet', '')
      else if (link.hasAttribute('download')) push(link.href, 'download-attr', link.getAttribute('download') || text(link))
      else if (looksLikeFile(link.href)) push(link.href, 'link', '')
    }
    for (const meta of document.querySelectorAll('meta[property^="og:video"], meta[name^="twitter:player:stream"]')) {
      const content = meta.getAttribute('content') || ''
      if (/^https?:/i.test(content)) push(content, 'video', document.title)
    }
    return items
  }

  function report() {
    timer = 0
    const items = collect()
    if (!chrome.runtime?.id) return // extension was reloaded; this script is orphaned
    chrome.runtime.sendMessage({ type: 'scan', pageUrl: location.href, title: document.title, items }).catch(() => {})
  }

  function schedule(delay = 800) {
    if (!timer) timer = setTimeout(report, delay)
  }

  new MutationObserver(() => schedule(1500)).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href']
  })
  // Players often set the source only on play.
  document.addEventListener('play', () => schedule(300), true)
  document.addEventListener('loadedmetadata', () => schedule(300), true)

  function onMagnetClick(event) {
    if (!magnetIntercept || event.defaultPrevented) return
    if (event.type === 'click' && event.button !== 0) return
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    const href = link?.getAttribute('href') || ''
    if (!MAGNET.test(href)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    chrome.runtime.sendMessage({ type: 'send', url: href, origin: 'magnet-click' }).catch(() => {})
  }
  document.addEventListener('click', onMagnetClick, true)
  document.addEventListener('auxclick', onMagnetClick, true)

  schedule(300)
})()
