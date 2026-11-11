// A failed request can be retried; a pending/successful request is reused only for its URL.
export function createExtractSearch(run) {
  let current
  return {
    has(url) { return current?.url === url },
    invalidate() { current = undefined },
    request(url, { force = false, ...options } = {}) {
      if (!force && current?.url === url && current.state !== 'error') return current.promise
      const attempt = { url, state: 'loading' }
      current = attempt
      attempt.promise = Promise.resolve().then(() => run(url, { force, ...options })).then(
        ok => { attempt.state = ok ? 'ready' : 'error'; return ok },
        error => { attempt.state = 'error'; throw error }
      )
      return attempt.promise
    }
  }
}
