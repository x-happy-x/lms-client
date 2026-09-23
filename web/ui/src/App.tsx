import { useMemo, useState, type FormEvent } from 'react'
import { api } from './api'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { NewDownloadForm } from './components/jobs/NewDownloadForm'
import { DownloadsPanel } from './components/downloads/DownloadsPanel'
import { NodesPanel } from './components/nodes/NodesPanel'
import { ProfilesPanel } from './components/profiles/ProfilesPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { useJobsPanelController } from './hooks/useJobsPanelController'
import { useNewDownloadFlow } from './hooks/useNewDownloadFlow'
import { useRouterData } from './hooks/useRouterData'
import { useUiPreferences } from './hooks/useUiPreferences'
import type { TabKey } from './types'

type NodeForm = {
  name: string
  baseUrl: string
  clientId: string
  secret: string
  enabled: boolean
}

type ProfileForm = {
  name: string
  type: string
  enabled: boolean
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('jobs')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const [createNode, setCreateNode] = useState<NodeForm>({
    name: '',
    baseUrl: '',
    clientId: 'router-main',
    secret: '',
    enabled: true
  })
  const [editNodeId, setEditNodeId] = useState('')
  const [editNode, setEditNode] = useState<NodeForm | null>(null)

  const [newProfile, setNewProfile] = useState<ProfileForm>({
    name: '',
    type: 'DIRECT',
    enabled: true
  })

  const preferences = useUiPreferences()

  const {
    health,
    version,
    jobs,
    nodes,
    profiles,
    refreshJobs,
    refreshNodes,
    refreshProfiles
  } = useRouterData({ setError })

  const newDownload = useNewDownloadFlow({
    refreshJobs,
    setError
  })

  const jobsPanel = useJobsPanelController({
    jobs,
    nodes,
    search,
    refreshJobs,
    setError
  })

  const jobsActiveCount = useMemo(
    () => jobs.filter((job) => job.status === 'RUNNING' || job.status === 'QUEUED' || job.status === 'PAUSED').length,
    [jobs]
  )
  const jobsCompletedCount = useMemo(() => jobs.filter((job) => job.status === 'DONE').length, [jobs])
  const onlineNodes = useMemo(() => nodes.filter((node) => node.status === 'online').length, [nodes])
  const offlineNodes = useMemo(
    () => nodes.filter((node) => node.status === 'offline' || node.status === 'never_seen').length,
    [nodes]
  )

  const createNodeAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await api.createNode(createNode)
      setCreateNode((current) => ({ ...current, name: '', baseUrl: '', secret: '' }))
      setError('')
      await refreshNodes()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const updateNodeAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editNodeId || !editNode) return
    try {
      await api.updateNode(editNodeId, editNode)
      setEditNodeId('')
      setEditNode(null)
      setError('')
      await refreshNodes()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const createProfileAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await api.createProfile(newProfile)
      setNewProfile((current) => ({ ...current, name: '' }))
      setError('')
      await refreshProfiles()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={tab}
        onChangeTab={setTab}
        theme={preferences.theme}
        onToggleTheme={preferences.toggleTheme}
        version={version}
        onlineNodes={onlineNodes}
        offlineNodes={offlineNodes}
        health={health}
      />

      <main className="main-content">
        <Topbar
          search={search}
          onSearchChange={setSearch}
          runningJobs={jobsActiveCount}
          completedJobs={jobsCompletedCount}
          onCreateClick={() => {
            setTab('jobs')
            void newDownload.openModal()
          }}
        />

        {error ? <div className="error-banner">{error}</div> : null}

        {tab === 'jobs' ? (
          <div className="jobs-layout jobs-layout-single">
            <DownloadsPanel
              jobs={jobsPanel.visibleJobs}
              nodes={nodes}
              iconRules={preferences.iconRules}
              filter={jobsPanel.filter}
              onFilterChange={jobsPanel.setFilter}
              onRefresh={refreshJobs}
              moveState={jobsPanel.moveForm}
              onMoveStateChange={jobsPanel.setMoveForm}
              onPause={jobsPanel.pauseJob}
              onResume={jobsPanel.resumeJob}
              onCancel={jobsPanel.cancelJob}
              onRetry={jobsPanel.retryJob}
              urlEditState={jobsPanel.urlEditForm}
              onUrlEditStateChange={jobsPanel.setUrlEditForm}
              onUrlEditPrepare={jobsPanel.prepareUrlEdit}
              onUrlEditSubmit={jobsPanel.submitUrlEdit}
              onUrlEditCancel={jobsPanel.cancelUrlEdit}
              onMovePrepare={jobsPanel.prepareMove}
              onMoveSubmit={jobsPanel.submitMove}
              onMoveCancel={jobsPanel.cancelMove}
            />
          </div>
        ) : null}

        {tab === 'nodes' ? (
          <NodesPanel
            nodes={nodes}
            createForm={createNode}
            onCreateFormChange={setCreateNode}
            onCreateSubmit={createNodeAction}
            editNodeId={editNodeId}
            editForm={editNode}
            onEditStart={(node) => {
              setEditNodeId(node.id)
              setEditNode({
                name: node.name,
                baseUrl: node.baseUrl,
                clientId: node.clientId,
                secret: '',
                enabled: node.enabled
              })
            }}
            onEditCancel={() => {
              setEditNodeId('')
              setEditNode(null)
            }}
            onEditFormChange={setEditNode}
            onEditSubmit={updateNodeAction}
            onRefresh={refreshNodes}
          />
        ) : null}

        {tab === 'profiles' ? (
          <ProfilesPanel
            profiles={profiles}
            form={newProfile}
            onFormChange={setNewProfile}
            onSubmit={createProfileAction}
          />
        ) : null}

        {tab === 'settings' ? (
          <SettingsPanel
            rules={preferences.iconRules}
            onRuleChange={preferences.updateRule}
            onAddRule={preferences.addRule}
            onDeleteRule={preferences.deleteRule}
            onResetDefaults={preferences.resetRules}
          />
        ) : null}
      </main>

      <NewDownloadForm
        open={newDownload.open}
        value={newDownload.value}
        onChange={newDownload.onChange}
        onClose={newDownload.closeModal}
        onSubmit={(startImmediately) => void newDownload.submit(startImmediately)}
        nodes={nodes}
        profiles={profiles.filter((profile) => profile.enabled)}
        preflight={newDownload.preflight}
        preflightLoading={newDownload.preflightLoading}
        preflightError={newDownload.preflightError}
        selectedNode={newDownload.selectedNode}
        targets={newDownload.targets}
        targetsLoading={newDownload.targetsLoading}
        targetsError={newDownload.targetsError}
      />
    </div>
  )
}
