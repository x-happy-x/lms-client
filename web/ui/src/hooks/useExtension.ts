import { useCallback, useEffect, useState } from 'react'

/** What the LMS browser extension reports through its content script (browser-extension/content.js). */
export type ExtensionState =
  | { status: 'checking' }
  | { status: 'missing' }
  | { status: 'installed'; version: string; connected: boolean }

type ExtensionMessage = { source: 'lms-extension'; type: string; version?: string; connected?: boolean }

function isExtensionMessage(event: MessageEvent): event is MessageEvent<ExtensionMessage> {
  return event.source === window && event.data?.source === 'lms-extension'
}

/**
 * Detects the extension and connects it to this router. The content script loads after the
 * page, so the ping is repeated for a few seconds before the extension counts as missing.
 */
export function useExtension() {
  const [state, setState] = useState<ExtensionState>({ status: 'checking' })
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    let answered = false
    const onMessage = (event: MessageEvent) => {
      if (!isExtensionMessage(event)) return
      const data = event.data
      if (data.type === 'pong' || data.type === 'connect-result') {
        answered = true
        setConnecting(false)
        setState((prev) => ({
          status: 'installed',
          version: data.version || '',
          // A declined connect keeps the previous answer.
          connected: data.type === 'connect-result' && !data.connected && prev.status === 'installed' ? prev.connected : Boolean(data.connected)
        }))
      }
    }
    window.addEventListener('message', onMessage)
    const ping = () => window.postMessage({ source: 'lms-ui', type: 'ping' }, window.location.origin)
    ping()
    let tries = 0
    const timer = window.setInterval(() => {
      tries += 1
      if (answered || tries > 6) {
        window.clearInterval(timer)
        if (!answered) setState({ status: 'missing' })
        return
      }
      ping()
    }, 500)
    // Re-check when the tab comes back (e.g. after installing the extension in another tab).
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  const connect = useCallback(() => {
    setConnecting(true)
    window.postMessage({ source: 'lms-ui', type: 'connect' }, window.location.origin)
  }, [])

  return { state, connecting, connect }
}
