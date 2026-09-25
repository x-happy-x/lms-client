import { fileUrl } from '../../api'
import { isViewableMedia, kindLabel, kindOfJob } from '../../lib/fileKinds'
import {
  STATUS_LABELS,
  formatBytes,
  formatDate,
  formatDuration,
  formatPercent,
  formatSpeed,
  titleFromJob,
  transfer,
  typeLabel
} from '../../lib/format'
import type { Job, NodeItem } from '../../types'
import { Icon } from '../../ui/Icon'
import { Menu, type MenuItem } from '../../ui/Menu'
import { Thumb } from '../../ui/Thumb'

export type JobActions = {
  pause: (job: Job) => void
  resume: (job: Job) => void
  retry: (job: Job) => void
  cancel: (job: Job) => void
  editUrl: (job: Job) => void
  move: (job: Job) => void
  open: (job: Job) => void
}

type JobItemProps = {
  job: Job
  node?: NodeItem
  actions: JobActions
  layout: 'row' | 'tile'
}

const ACTIVE = ['QUEUED', 'RUNNING', 'PAUSED']

function progressOf(job: Job): number {
  if (job.status === 'DONE') return 100
  return typeof job.percent === 'number' ? Math.max(0, Math.min(100, job.percent)) : 0
}

function details(job: Job, node?: NodeItem): string[] {
  const { done, total } = transfer(job)
  const parts: string[] = []
  if (job.status === 'RUNNING') {
    if (typeof done === 'number' && typeof total === 'number') parts.push(`${formatBytes(done)} из ${formatBytes(total)}`)
    else if (typeof total === 'number') parts.push(formatBytes(total))
    const speed = formatSpeed(job.speedBytes)
    if (speed) parts.push(speed)
    const eta = formatDuration(job.etaSeconds)
    if (eta && job.etaSeconds) parts.push(`осталось ${eta}`)
  } else if (typeof total === 'number') {
    parts.push(formatBytes(total))
  }
  parts.push(typeLabel(job.type))
  if (node) parts.push(node.name)
  const date = formatDate(job.finishedAt ?? job.createdAt)
  if (date) parts.push(date)
  return parts
}

function menuItems(job: Job, actions: JobActions): MenuItem[] {
  const done = job.status === 'DONE' && Boolean(job.outputPath)
  return [
    { label: 'Скачать на это устройство', icon: 'download', href: fileUrl(job.id), download: true, hidden: !done },
    { label: 'Открыть', icon: 'eye', onSelect: () => actions.open(job), hidden: !isViewableMedia(job) },
    { label: 'Переместить', icon: 'move', onSelect: () => actions.move(job), hidden: !job.remoteJobId },
    { label: 'Изменить ссылку', icon: 'edit', onSelect: () => actions.editUrl(job), hidden: job.status === 'DONE' },
    {
      label: 'Копировать ссылку',
      icon: 'copy',
      onSelect: () => void navigator.clipboard?.writeText(job.url)
    },
    { label: 'Отменить', icon: 'close', onSelect: () => actions.cancel(job), danger: true, hidden: !ACTIVE.includes(job.status) }
  ]
}

function QuickActions({ job, actions }: { job: Job; actions: JobActions }) {
  return (
    <>
      {job.status === 'RUNNING' || job.status === 'QUEUED' ? (
        <button type="button" className="icon-btn accent" title="Пауза" aria-label="Пауза" onClick={() => actions.pause(job)}>
          <Icon name="pause" />
        </button>
      ) : null}
      {job.status === 'PAUSED' ? (
        <button type="button" className="icon-btn accent" title="Продолжить" aria-label="Продолжить" onClick={() => actions.resume(job)}>
          <Icon name="play" />
        </button>
      ) : null}
      {job.status === 'ERROR' || job.status === 'CANCELED' ? (
        <button type="button" className="icon-btn" title="Повторить" aria-label="Повторить" onClick={() => actions.retry(job)}>
          <Icon name="retry" />
        </button>
      ) : null}
      {job.status === 'DONE' && job.outputPath ? (
        <a className="icon-btn accent" title="Скачать на это устройство" aria-label="Скачать" href={fileUrl(job.id)} download>
          <Icon name="download" />
        </a>
      ) : null}
    </>
  )
}

export function JobItem({ job, node, actions, layout }: JobItemProps) {
  const title = titleFromJob(job)
  const progress = progressOf(job)
  const kind = kindOfJob(job)
  const viewable = isViewableMedia(job)
  // Running jobs show live numbers instead; finished ones need no "Completed" line.
  const note = job.status === 'ERROR' ? job.errorText || job.message : job.status === 'RUNNING' || job.status === 'DONE' ? '' : job.message
  const showProgress = ACTIVE.includes(job.status)

  const thumb = viewable ? (
    <button type="button" className="thumb-button" onClick={() => actions.open(job)} aria-label={`Открыть ${title}`}>
      <Thumb job={job} size={layout === 'tile' ? 'lg' : 'sm'} />
    </button>
  ) : (
    <Thumb job={job} size={layout === 'tile' ? 'lg' : 'sm'} />
  )

  if (layout === 'tile') {
    return (
      <article className={`tile status-${job.status.toLowerCase()}`}>
        {thumb}
        <div className="tile-body">
          <strong className="title" title={title}>{title}</strong>
          <div className="meta">
            <span className={`status-dot status-${job.status.toLowerCase()}`} />
            {STATUS_LABELS[job.status]}
            {showProgress && job.percent != null ? ` · ${formatPercent(job.percent)}` : ''}
            {job.status === 'DONE' && job.outputSizeBytes ? ` · ${formatBytes(job.outputSizeBytes)}` : ''}
          </div>
          {showProgress ? <div className="progress"><span style={{ width: `${progress}%` }} /></div> : null}
        </div>
        <div className="tile-actions">
          <QuickActions job={job} actions={actions} />
          <Menu items={menuItems(job, actions)} />
        </div>
      </article>
    )
  }

  return (
    <article className={`row status-${job.status.toLowerCase()}`}>
      {thumb}
      <div className="row-main">
        <div className="row-title">
          <strong className="title" title={job.url}>{title}</strong>
          <span className={`badge status-${job.status.toLowerCase()}`}>{STATUS_LABELS[job.status]}</span>
          {showProgress && job.percent != null ? <span className="percent">{formatPercent(job.percent)}</span> : null}
        </div>
        {showProgress ? (
          <div className={`progress${job.status === 'RUNNING' && job.percent == null ? ' indeterminate' : ''}`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        <div className="meta">
          <span className="kind-label">{kindLabel(kind)}</span>
          {details(job, node).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
        {note ? <div className={`note${job.status === 'ERROR' ? ' error' : ''}`}>{note}</div> : null}
      </div>
      <div className="row-actions">
        <QuickActions job={job} actions={actions} />
        <Menu items={menuItems(job, actions)} />
      </div>
    </article>
  )
}
