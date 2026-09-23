import { useEffect, useState } from 'react'
import type { IconRule, ThemeMode } from '../types'

const THEME_KEY = 'lms-router-theme'
const ICON_RULES_KEY = 'lms-router-icon-rules'

function defaultIconRules(): IconRule[] {
  return [
    { id: 'video', label: 'Video', icon: '🎬', pattern: '\\.(mp4|mkv|avi|mov|webm)$', enabled: true },
    { id: 'audio', label: 'Audio', icon: '🎵', pattern: '\\.(mp3|flac|wav|ogg|m4a)$', enabled: true },
    { id: 'archive', label: 'Archive', icon: '🗜️', pattern: '\\.(zip|rar|7z|tar|gz)$', enabled: true },
    { id: 'doc', label: 'Document', icon: '📄', pattern: '\\.(pdf|docx?|pptx?|xlsx?)$', enabled: true },
    { id: 'model', label: 'Model', icon: '🧠', pattern: '\\.(safetensors|gguf|bin|pt)$', enabled: true },
    { id: 'image', label: 'Image', icon: '🖼️', pattern: '\\.(jpg|jpeg|png|gif|webp)$', enabled: true }
  ]
}

function loadIconRules(): IconRule[] {
  if (typeof window === 'undefined') return defaultIconRules()
  const raw = window.localStorage.getItem(ICON_RULES_KEY)
  if (!raw) return defaultIconRules()
  try {
    const parsed = JSON.parse(raw) as IconRule[]
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultIconRules()
    return parsed
  } catch {
    return defaultIconRules()
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'claude'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'claude' || saved === 'claude-dark') return saved
  return 'claude-dark'
}

export function useUiPreferences() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [iconRules, setIconRules] = useState<IconRule[]>(loadIconRules)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem(ICON_RULES_KEY, JSON.stringify(iconRules))
  }, [iconRules])

  const toggleTheme = () => {
    setTheme((current) => (current === 'claude-dark' ? 'claude' : 'claude-dark'))
  }

  const updateRule = (id: string, patch: Partial<IconRule>) => {
    setIconRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const addRule = () => {
    setIconRules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        label: 'Custom',
        icon: '📦',
        pattern: '',
        enabled: true
      }
    ])
  }

  const deleteRule = (id: string) => {
    setIconRules((current) => current.filter((rule) => rule.id !== id))
  }

  const resetRules = () => {
    setIconRules(defaultIconRules())
  }

  return {
    theme,
    toggleTheme,
    iconRules,
    updateRule,
    addRule,
    deleteRule,
    resetRules
  }
}
