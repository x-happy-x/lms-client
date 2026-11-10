// Scans the page for media and download links and hands magnet clicks to LMS.
// Classic script (content scripts cannot be modules); classification happens in the worker.
;(() => {
  if (window.__lmsContent) return
  window.__lmsContent = true

  const MAGNET = /^magnet:\?/i
  let magnetIntercept = true
  let timer = 0
  let sniffMedia = true
  let resourcePage = location.href
  const resources = new Map()

  chrome.storage.sync.get({ interceptMagnets: true, sniffMedia: true }, (value) => {
    magnetIntercept = value.interceptMagnets !== false
    sniffMedia = value.sniffMedia !== false
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.interceptMagnets) magnetIntercept = changes.interceptMagnets.newValue !== false
    if (area === 'sync' && changes.sniffMedia) {
      sniffMedia = changes.sniffMedia.newValue !== false
      schedule(0)
    }
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
    const push = (url, source, name, metadata = {}) => {
      if (!url || /^(blob|data|javascript):/i.test(url)) return
      try { url = new URL(url, document.baseURI).href } catch { return }
      items.push({ url, source, name: name || '', ...metadata })
    }
    // Open shadow roots are common in custom video player components.
    const roots = [document]
    for (const root of roots) {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) {
          roots.push(element.shadowRoot)
          observe(element.shadowRoot)
        }
      }
    }
    for (const root of roots) {
      for (const media of root.querySelectorAll('video, audio')) {
        const source = media.tagName === 'VIDEO' ? 'video' : 'audio'
        const name = media.getAttribute('title') || media.getAttribute('aria-label') || ''
        const metadata = {
          thumbnail: media.poster || '', durationSeconds: media.duration,
          width: media.videoWidth, height: media.videoHeight
        }
        push(media.currentSrc || media.getAttribute('src') || media.getAttribute('data-src'), source, name, metadata)
        for (const child of media.querySelectorAll('source[src], source[data-src]')) {
          push(child.getAttribute('src') || child.getAttribute('data-src'), source, name, metadata)
        }
      }
      for (const link of root.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href') || ''
        if (MAGNET.test(href)) push(href, 'magnet', '')
        else if (link.hasAttribute('download')) push(link.href, 'download-attr', link.getAttribute('download') || text(link))
        else if (looksLikeFile(link.href)) push(link.href, 'link', '')
      }
    }
    const poster = document.querySelector('meta[property="og:image"]')?.content || ''
    for (const meta of document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')) {
      const content = meta.getAttribute('content') || ''
      push(content, 'video', document.title, { thumbnail: poster })
    }
    if (resourcePage !== location.href) {
      resources.clear()
      resourcePage = location.href
    }
    if (sniffMedia) items.push(...resources.values())
    return items
  }

  function recordResources(entries) {
    if (resourcePage !== location.href) {
      resources.clear()
      resourcePage = location.href
    }
    for (const entry of entries) {
      // Resource Timing recovers media loaded before the worker/content scan started.
      // MIME-only URLs are handled by webRequest; don't mistake MSE chunks for files.
      let path
      try { path = new URL(entry.name).pathname } catch { continue }
      if (!/\.(?:mp4|webm|m4v|mov|mp3|m4a|ogg|m3u8|mpd)$/i.test(path)) continue
      if (/(?:^|[/_.-])(?:init|segment|seg|chunk|fragment)[-_.\d/]/i.test(path)) continue
      if (/[?&](?:range|bytestart|byteend)=/i.test(entry.name)) continue
      resources.set(entry.name, { url: entry.name, source: 'resource' })
      if (resources.size > 60) resources.delete(resources.keys().next().value)
    }
    schedule(300)
  }

  try {
    new PerformanceObserver((list) => recordResources(list.getEntries())).observe({ type: 'resource', buffered: true })
  } catch { /* Resource Timing is unavailable in some frames. */ }

  function report() {
    timer = 0
    const items = collect()
    if (!chrome.runtime?.id) return // extension was reloaded; this script is orphaned
    chrome.runtime.sendMessage({ type: 'scan', pageUrl: location.href, title: document.title, items }).catch(() => {})
  }

  function schedule(delay = 800) {
    if (!timer) timer = setTimeout(report, delay)
  }

  const observed = new WeakSet()
  function observe(root) {
    if (observed.has(root)) return
    observed.add(root)
    new MutationObserver(() => schedule(800)).observe(root, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'href', 'data-src', 'poster', 'content', 'title']
    })
    root.addEventListener('loadedmetadata', () => schedule(100), true)
    root.addEventListener('play', () => schedule(100), true)
  }
  observe(document.documentElement)
  // Players often set the source only on play.
  document.addEventListener('play', () => schedule(300), true)
  document.addEventListener('loadedmetadata', () => schedule(300), true)
  window.addEventListener('popstate', () => schedule(100))
  window.addEventListener('hashchange', () => schedule(100))
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'rescan') report()
  })

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

  // Bridge for the LMS web UI ("Расширение" page): it asks whether the extension is installed
  // and can connect it to its own address. Only the top frame answers, a site learns only
  // whether the extension points at that site, and connecting always asks the user first.
  function originOf(raw) {
    let value = (raw || '').trim()
    if (!value) return ''
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`
    try {
      return new URL(value).origin
    } catch {
      return ''
    }
  }

  function reply(type, extra) {
    window.postMessage({ source: 'lms-extension', type, version: chrome.runtime.getManifest().version, ...extra }, location.origin)
  }

  if (window.top === window) {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return
      const data = event.data
      if (!data || data.source !== 'lms-ui' || !chrome.runtime?.id) return
      if (data.type === 'ping') {
        chrome.storage.sync.get({ routerUrl: '' }, (value) => {
          reply('pong', { connected: originOf(value.routerUrl) === location.origin })
        })
      }
      if (data.type === 'connect') {
        const ok = window.confirm(`Подключить расширение LMS к ${location.origin}?\nСсылки и перехваченные загрузки будут отправляться сюда.`)
        if (!ok) {
          reply('connect-result', { connected: false })
          return
        }
        chrome.storage.sync.set({ routerUrl: location.origin }, () => reply('connect-result', { connected: true }))
      }
    })
  }

  schedule(300)
})()
