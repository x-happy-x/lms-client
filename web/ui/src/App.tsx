import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { JobDialogsHost } from './components/jobs/JobDialogsHost'
import { JobsPage } from './components/jobs/JobsPage'
import { NewDownloadDialog } from './components/jobs/NewDownloadDialog'
import type { JobActions } from './components/jobs/JobItem'
import { MediaPage } from './components/media/MediaPage'
import { MediaViewer } from './components/media/MediaViewer'
import { NodesPage } from './components/nodes/NodesPage'
import { ProfilesPage } from './components/profiles/ProfilesPage'
import { SettingsPage } from './components/settings/SettingsPage'
import { useNewDownloadFlow } from './hooks/useNewDownloadFlow'
import { usePreferences } from './hooks/usePreferences'
import { useRouterData } from './hooks/useRouterData'
import { isViewableMedia } from './lib/fileKinds'
import type { Job, TabKey } from './types'
import { Icon, type IconName } from './ui/Icon'

const TABS: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'jobs', label: 'Загрузки', icon: 'download' },
  { key: 'media', label: 'Медиа', icon: 'image' },
  { key: 'nodes', label: 'Ноды', icon: 'server' },
  { key: 'profiles', label: 'Профили', icon: 'profile' },
  { key: 'settings', label: 'Настройки', icon: 'settings' }
]

type Viewer = { list: Job[]; index: number } | null
type JobDialog = { kind: 'url' | 'move'; job: Job } | null

export default function App() {
  const [tab, setTab] = useState<TabKey>('jobs')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [viewer, setViewer] = useState<Viewer>(null)
  const [dialog, setDialog] = useState<JobDialog>(null)
  const { prefs, setTheme, setView, setQuery, resetQuery } = usePreferences()
  const { health, version, jobs, nodes, profiles, refreshJobs, refreshNodes, refreshProfiles } = useRouterData({ setError })
  const newDownload = useNewDownloadFlow({ refreshJobs, setError })

  // "?add=<link>" opens the new-download dialog (bookmarklets, shared links).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const link = params.get('add')
    if (link) {
      void newDownload.openModal(link)
      window.history.replaceState(null, '', window.location.pathname)
    }
    // Runs once on load; openModal is stable enough for this one-shot.
  }, [])

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action()
        setError('')
        await refreshJobs()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [refreshJobs]
  )

  const actions: JobActions = useMemo(
    () => ({
      pause: (job) => void run(() => api.pauseJob(job.id)),
      resume: (job) => void run(() => api.resumeJob(job.id)),
      retry: (job) => void run(() => api.retryJob(job.id)),
      cancel: (job) => {
        if (window.confirm('Отменить загрузку?')) void run(() => api.cancelJob(job.id))
      },
      editUrl: (job) => setDialog({ kind: 'url', job }),
      move: (job) => setDialog({ kind: 'move', job }),
      open: (job) => {
        const list = jobs.filter(isViewableMedia)
        setViewer({ list, index: Math.max(0, list.findIndex((item) => item.id === job.id)) })
      }
    }),
    [run, jobs]
  )

  const active = jobs.filter((job) => job.status === 'RUNNING' || job.status === 'QUEUED').length
  const online = nodes.filter((node) => node.status === 'online').length
  const current = TABS.find((item) => item.key === tab)!

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Icon name="download" size={18} /></span>
          <span>
            <strong>LMS</strong>
            <span className="muted small">загрузки</span>
          </span>
        </div>
        <nav className="nav">
          {TABS.map((item) => (
            <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.key === 'jobs' && active > 0 ? <span className="count">{active}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`status-dot ${online > 0 ? 'node-online' : 'node-offline'}`} />
          <span className="small">
            Нод в сети: {online} из {nodes.length}
          </span>
          <span className="muted small">v{version}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{current.label}</h1>
          {tab === 'jobs' || tab === 'media' ? (
            <label className="search">
              <Icon name="search" size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по имени и ссылке" aria-label="Поиск" />
              {search ? (
                <button type="button" className="icon-btn small" onClick={() => setSearch('')} aria-label="Очистить">
                  <Icon name="close" size={16} />
                </button>
              ) : null}
            </label>
          ) : (
            <span className="spacer" />
          )}
          <button
            type="button"
            className="btn primary add-btn"
            onClick={() => {
              setTab('jobs')
              void newDownload.openModal()
            }}
          >
            <Icon name="plus" size={18} />
            <span>Загрузка</span>
          </button>
        </header>

        {error ? (
          <div className="alert error banner" role="alert">
            <Icon name="alert" size={18} /> {error}
            <button type="button" className="icon-btn small" onClick={() => setError('')} aria-label="Скрыть">
              <Icon name="close" size={16} />
            </button>
          </div>
        ) : null}
        {health === 'offline' ? <div className="alert warn banner">Роутер не отвечает — данные могут быть устаревшими.</div> : null}

        <main className="content">
          {tab === 'jobs' ? (
            <JobsPage
              jobs={jobs}
              nodes={nodes}
              search={search}
              prefs={prefs}
              actions={actions}
              onQuery={setQuery}
              onView={setView}
              onReset={resetQuery}
              onAdd={() => void newDownload.openModal()}
            />
          ) : null}
          {tab === 'media' ? <MediaPage jobs={jobs} search={search} onOpen={(list, index) => setViewer({ list, index })} /> : null}
          {tab === 'nodes' ? <NodesPage nodes={nodes} onRefresh={refreshNodes} /> : null}
          {tab === 'profiles' ? <ProfilesPage profiles={profiles} onRefresh={refreshProfiles} /> : null}
          {tab === 'settings' ? <SettingsPage theme={prefs.theme} onTheme={setTheme} version={version} health={health} /> : null}
        </main>
      </div>

      <nav className="bottom-nav">
        {TABS.map((item) => (
          <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {newDownload.open ? (
        <NewDownloadDialog
          value={newDownload.value}
          onChange={newDownload.onChange}
          onClose={newDownload.closeModal}
          onSubmit={(start) => void newDownload.submit(start)}
          profiles={profiles.filter((profile) => profile.enabled)}
          preflight={newDownload.preflight}
          preflightLoading={newDownload.preflightLoading}
          preflightError={newDownload.preflightError}
          selectedNode={newDownload.selectedNode}
          targets={newDownload.targets}
          targetsLoading={newDownload.targetsLoading}
          targetsError={newDownload.targetsError}
          submitting={newDownload.submitting}
          submitError={newDownload.submitError}
        />
      ) : null}
      <JobDialogsHost dialog={dialog} nodes={nodes} onClose={() => setDialog(null)} onDone={refreshJobs} />
      {viewer ? (
        <MediaViewer
          jobs={viewer.list}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  )
}
