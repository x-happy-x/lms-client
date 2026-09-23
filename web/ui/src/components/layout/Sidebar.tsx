import { type CSSProperties } from 'react'
import { Badge } from '../common/Badge'
import type { TabKey, ThemeMode } from '../../types'

type SidebarProps = {
  activeTab: TabKey
  onChangeTab: (tab: TabKey) => void
  theme: ThemeMode
  onToggleTheme: () => void
  version: string
  onlineNodes: number
  offlineNodes: number
  health: string
}

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'jobs', label: 'Downloads' },
  { key: 'nodes', label: 'Nodes' },
  { key: 'profiles', label: 'Profiles' },
  { key: 'settings', label: 'Settings' }
]

function healthTone(health: string): 'good' | 'bad' | 'queued' {
  if (health === 'ok' || health === 'healthy') return 'good'
  if (health === 'unknown') return 'queued'
  return 'bad'
}

export function Sidebar({
  activeTab,
  onChangeTab,
  theme,
  onToggleTheme,
  version,
  onlineNodes,
  offlineNodes,
  health
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <strong>LMS Client</strong>
        <Badge tone={healthTone(health.toLowerCase())}>{health.toLowerCase()}</Badge>
      </div>

      <div className="sidebar-meta">
        {onlineNodes} online / {offlineNodes} offline
      </div>

      <nav className="sidebar-nav" aria-label="Sections" style={{ '--tab-index': tabs.findIndex((tab) => tab.key === activeTab) } as CSSProperties}>
        <i className="sidebar-nav-indicator" />
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`sidebar-link ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => onChangeTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-meta">v{version}</span>
        <button type="button" className="button button-ghost" onClick={onToggleTheme}>
          {theme === 'claude-dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </aside>
  )
}
