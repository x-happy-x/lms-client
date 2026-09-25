import type { Job, JobStatus, NodeItem } from '../types'
import { FILE_KINDS, kindOfJob, type FileKind } from './fileKinds'
import { STATUS_LABELS, sizeOf, titleFromJob } from './format'

export type StatusFilter = 'all' | 'active' | 'done' | 'failed'
export type SortKey = 'newest' | 'oldest' | 'name' | 'size' | 'progress' | 'status'
export type GroupKey = 'none' | 'status' | 'kind' | 'node' | 'day'

export type JobsQuery = {
  search: string
  status: StatusFilter
  kinds: FileKind[]
  nodeId: string
  sort: SortKey
  group: GroupKey
}

export type JobGroup = { key: string; label: string; jobs: Job[] }

const ACTIVE: JobStatus[] = ['QUEUED', 'RUNNING', 'PAUSED']
const STATUS_ORDER: JobStatus[] = ['RUNNING', 'QUEUED', 'PAUSED', 'ERROR', 'DONE', 'CANCELED']

export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Сначала новые',
  oldest: 'Сначала старые',
  name: 'По имени',
  size: 'По размеру',
  progress: 'По прогрессу',
  status: 'По статусу'
}

export const GROUP_LABELS: Record<GroupKey, string> = {
  none: 'Без группировки',
  status: 'По статусу',
  kind: 'По типу файла',
  node: 'По ноде',
  day: 'По дате'
}

export function matchesStatus(job: Job, filter: StatusFilter): boolean {
  switch (filter) {
    case 'active':
      return ACTIVE.includes(job.status)
    case 'done':
      return job.status === 'DONE'
    case 'failed':
      return job.status === 'ERROR' || job.status === 'CANCELED'
    default:
      return true
  }
}

function time(value?: string): number {
  const parsed = value ? new Date(value).getTime() : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

function comparator(sort: SortKey): (a: Job, b: Job) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => time(a.createdAt) - time(b.createdAt)
    case 'name':
      return (a, b) => titleFromJob(a).localeCompare(titleFromJob(b), 'ru', { numeric: true })
    case 'size':
      return (a, b) => (sizeOf(b) ?? -1) - (sizeOf(a) ?? -1)
    case 'progress':
      return (a, b) => (b.percent ?? (b.status === 'DONE' ? 100 : 0)) - (a.percent ?? (a.status === 'DONE' ? 100 : 0))
    case 'status':
      return (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || time(b.createdAt) - time(a.createdAt)
    default:
      return (a, b) => time(b.createdAt) - time(a.createdAt)
  }
}

function dayLabel(value?: string): { key: string; label: string } {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return { key: '0', label: 'Без даты' }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  const diffDays = Math.round((start.getTime() - day.getTime()) / 86400000)
  const key = day.toISOString().slice(0, 10)
  if (diffDays <= 0) return { key, label: 'Сегодня' }
  if (diffDays === 1) return { key, label: 'Вчера' }
  if (diffDays < 7) return { key, label: day.toLocaleDateString('ru-RU', { weekday: 'long' }) }
  return { key, label: day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) }
}

export function applyQuery(jobs: Job[], query: JobsQuery, nodes: NodeItem[]): JobGroup[] {
  const search = query.search.trim().toLowerCase()
  const filtered = jobs.filter((job) => {
    if (!matchesStatus(job, query.status)) return false
    if (query.nodeId && job.nodeId !== query.nodeId) return false
    if (query.kinds.length && !query.kinds.includes(kindOfJob(job))) return false
    if (search) {
      const haystack = `${titleFromJob(job)} ${job.url} ${job.storagePath ?? ''} ${job.message ?? ''}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
  const sorted = [...filtered].sort(comparator(query.sort))

  if (query.group === 'none') return [{ key: 'all', label: '', jobs: sorted }]

  const groups = new Map<string, JobGroup>()
  const order: string[] = []
  const add = (key: string, label: string, job: Job) => {
    if (!groups.has(key)) {
      groups.set(key, { key, label, jobs: [] })
      order.push(key)
    }
    groups.get(key)!.jobs.push(job)
  }
  for (const job of sorted) {
    switch (query.group) {
      case 'status':
        add(job.status, STATUS_LABELS[job.status] ?? job.status, job)
        break
      case 'kind': {
        const kind = kindOfJob(job)
        add(kind, FILE_KINDS.find((item) => item.kind === kind)?.label ?? kind, job)
        break
      }
      case 'node': {
        const node = nodes.find((item) => item.id === job.nodeId)
        add(job.nodeId ?? '-', node?.name ?? 'Нода не выбрана', job)
        break
      }
      case 'day': {
        const { key, label } = dayLabel(job.createdAt)
        add(key, label, job)
        break
      }
    }
  }

  const keys = [...order]
  if (query.group === 'status') keys.sort((a, b) => STATUS_ORDER.indexOf(a as JobStatus) - STATUS_ORDER.indexOf(b as JobStatus))
  if (query.group === 'kind') keys.sort((a, b) => FILE_KINDS.findIndex((k) => k.kind === a) - FILE_KINDS.findIndex((k) => k.kind === b))
  if (query.group === 'day') keys.sort((a, b) => b.localeCompare(a))
  return keys.map((key) => groups.get(key)!)
}

export function countByStatus(jobs: Job[]): Record<StatusFilter, number> {
  return {
    all: jobs.length,
    active: jobs.filter((job) => matchesStatus(job, 'active')).length,
    done: jobs.filter((job) => job.status === 'DONE').length,
    failed: jobs.filter((job) => matchesStatus(job, 'failed')).length
  }
}
