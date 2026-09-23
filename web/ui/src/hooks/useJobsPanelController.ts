import { useMemo, useState, type FormEvent } from 'react'
import { api } from '../api'
import type { Job, NodeItem } from '../types'
import type { DownloadFilter, MoveFormState, UrlEditFormState } from '../components/downloads/types'

type UseJobsPanelControllerParams = {
  jobs: Job[]
  nodes: NodeItem[]
  search: string
  refreshJobs: () => Promise<void>
  setError: (message: string) => void
}

function withOptional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const EMPTY_MOVE_FORM: MoveFormState = {
  jobId: '',
  targetNodeId: '',
  storagePath: ''
}

const EMPTY_URL_EDIT_FORM: UrlEditFormState = {
  jobId: '',
  url: ''
}

export function useJobsPanelController({
  jobs,
  nodes,
  search,
  refreshJobs,
  setError
}: UseJobsPanelControllerParams) {
  const [filter, setFilter] = useState<DownloadFilter>('active')
  const [moveForm, setMoveForm] = useState<MoveFormState>(EMPTY_MOVE_FORM)
  const [urlEditForm, setUrlEditForm] = useState<UrlEditFormState>(EMPTY_URL_EDIT_FORM)

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    let list = jobs
    if (query) {
      list = jobs.filter((job) => `${job.type} ${job.url}`.toLowerCase().includes(query))
    }
    if (filter === 'active') return list.filter((job) => ['QUEUED', 'RUNNING', 'PAUSED'].includes(job.status))
    if (filter === 'completed') return list.filter((job) => job.status === 'DONE')
    if (filter === 'failed') return list.filter((job) => ['ERROR', 'CANCELED'].includes(job.status))
    return list
  }, [filter, jobs, search])

  const runJobAction = async (handler: () => Promise<unknown>) => {
    try {
      await handler()
      setError('')
      await refreshJobs()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const pauseJob = (jobId: string) => void runJobAction(() => api.pauseJob(jobId))
  const resumeJob = (jobId: string) => void runJobAction(() => api.resumeJob(jobId))
  const cancelJob = (jobId: string) => void runJobAction(() => api.cancelJob(jobId))
  const retryJob = (jobId: string) => void runJobAction(() => api.retryJob(jobId))

  const prepareMove = (job: Job) => {
    setMoveForm({
      jobId: job.id,
      targetNodeId: job.nodeId || (nodes[0]?.id ?? ''),
      storagePath: job.storagePath || ''
    })
  }

  const cancelMove = () => {
    setMoveForm(EMPTY_MOVE_FORM)
  }

  const submitMove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!moveForm.jobId) return
    await runJobAction(() =>
      api.moveJob(moveForm.jobId, {
        targetNodeId: withOptional(moveForm.targetNodeId),
        storagePath: withOptional(moveForm.storagePath)
      })
    )
    setMoveForm(EMPTY_MOVE_FORM)
  }

  const prepareUrlEdit = (job: Job) => {
    setUrlEditForm({
      jobId: job.id,
      url: job.url
    })
  }

  const cancelUrlEdit = () => {
    setUrlEditForm(EMPTY_URL_EDIT_FORM)
  }

  const submitUrlEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!urlEditForm.jobId) return
    await runJobAction(() =>
      api.updateJobUrl(urlEditForm.jobId, {
        url: urlEditForm.url.trim()
      })
    )
    setUrlEditForm(EMPTY_URL_EDIT_FORM)
  }

  return {
    filter,
    setFilter,
    visibleJobs,
    moveForm,
    setMoveForm,
    prepareMove,
    cancelMove,
    submitMove,
    urlEditForm,
    setUrlEditForm,
    prepareUrlEdit,
    cancelUrlEdit,
    submitUrlEdit,
    pauseJob,
    resumeJob,
    cancelJob,
    retryJob
  }
}
