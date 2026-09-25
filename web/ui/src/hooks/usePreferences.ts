import { useEffect, useState } from 'react'
import type { ThemeMode } from '../types'
import type { JobsQuery } from '../lib/jobsView'

const KEY = 'lms-ui-preferences-v2'

export type ViewMode = 'list' | 'grid'

export type Preferences = {
  theme: ThemeMode
  view: ViewMode
  query: Omit<JobsQuery, 'search'>
}

const DEFAULTS: Preferences = {
  theme: 'system',
  view: 'list',
  query: { status: 'all', kinds: [], nodeId: '', sort: 'newest', group: 'status' }
}

function load(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return { ...DEFAULTS, ...parsed, query: { ...DEFAULTS.query, ...(parsed.query ?? {}) } }
  } catch {
    return DEFAULTS
  }
}

/** UI preferences kept per browser (localStorage). */
export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(load)

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // storage may be unavailable (private mode)
    }
  }, [prefs])

  useEffect(() => {
    const root = document.documentElement
    if (prefs.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = prefs.theme
  }, [prefs.theme])

  return {
    prefs,
    setTheme: (theme: ThemeMode) => setPrefs((current) => ({ ...current, theme })),
    setView: (view: ViewMode) => setPrefs((current) => ({ ...current, view })),
    setQuery: (patch: Partial<Preferences['query']>) =>
      setPrefs((current) => ({ ...current, query: { ...current.query, ...patch } })),
    resetQuery: () => setPrefs((current) => ({ ...current, query: DEFAULTS.query }))
  }
}
