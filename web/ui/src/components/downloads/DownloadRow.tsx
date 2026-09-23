import { useMemo, useState } from 'react'
import { elapsedSeconds, formatBytes, formatDuration, formatEta, formatSpeed, titleFromJob } from '../../utils/format'
import { iconForJob, remainingLabel, transferLabel } from '../../utils/downloadVisual'
import type { IconRule, Job } from '../../types'

type DownloadRowProps = {
  job: Job
  iconRules: IconRule[]
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onMove: (job: Job) => void
  onEditUrl: (job: Job) => void
}

function canPause(job: Job): boolean {
  return job.status === 'RUNNING' || job.status === 'QUEUED'
}

function canResume(job: Job): boolean {
  return job.status === 'PAUSED'
}

function canCancel(job: Job): boolean {
  return job.status === 'RUNNING' || job.status === 'QUEUED' || job.status === 'PAUSED'
}

export function DownloadRow({
  job,
  iconRules,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onMove,
  onEditUrl
}: DownloadRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const progress = typeof job.percent === 'number' ? Math.max(1, Math.min(100, Math.round(job.percent))) : 0
  const fileName = titleFromJob(job.url, job.type, job.outputPath)
  const icon = useMemo(() => iconForJob(job, iconRules), [job, iconRules])
  const elapsed = elapsedSeconds(
    job.startedAt ?? job.createdAt,
    job.finishedAt ?? (job.status === 'DONE' || job.status === 'ERROR' || job.status === 'CANCELED' ? job.updatedAt : undefined)
  )
  const sizeLabel = typeof job.outputSizeBytes === 'number' && job.outputSizeBytes > 0
    ? formatBytes(job.outputSizeBytes)
    : (typeof job.totalBytes === 'number' && job.totalBytes > 0 ? formatBytes(job.totalBytes) : null)

  return (
    <article className="download-row download-row-reference">
      <div className="file-icon" title={icon.label}>
        <span>{icon.icon}</span>
      </div>

      <div className="download-main">
        <div className="download-title-line">
          <strong>{fileName}</strong>
          <span className="progress-title">{progress}%</span>
        </div>

        <div className="progress-line progress-line-reference">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="download-meta download-meta-reference">
          <span>{job.status}</span>
          <span>elapsed {formatDuration(elapsed)}</span>
          <span>size {sizeLabel ?? '-'}</span>
          <span>{formatSpeed(job.speedBytes)}</span>
          <span>{formatEta(job.etaSeconds)}</span>
          <span>{transferLabel(job)}</span>
          <span>left {remainingLabel(job)}</span>
        </div>
        {job.message ? <div className="download-meta download-meta-reference"><span>{job.message}</span></div> : null}
      </div>

      <div className="download-actions download-actions-reference">
        {canPause(job) && (
          <button type="button" className="icon-button icon-button-accent" onClick={() => onPause(job.id)} title="Pause">
            II
          </button>
        )}
        {canResume(job) && (
          <button type="button" className="icon-button icon-button-accent" onClick={() => onResume(job.id)} title="Resume">
            ▶
          </button>
        )}
        {(job.status === 'ERROR' || job.status === 'CANCELED') && (
          <button type="button" className="icon-button" onClick={() => onRetry(job.id)} title="Retry">
            ↻
          </button>
        )}
        {canCancel(job) && (
          <button type="button" className="icon-button" onClick={() => onCancel(job.id)} title="Cancel">
            ×
          </button>
        )}

        <div className="more-menu-wrap">
          <button
            type="button"
            className="icon-button"
            onClick={() => setMenuOpen((current) => !current)}
            title="More actions"
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="more-menu">
              <button
                type="button"
                onClick={() => {
                  onEditUrl(job)
                  setMenuOpen(false)
                }}
              >
                Change link
              </button>
              <button
                type="button"
                onClick={() => {
                  onMove(job)
                  setMenuOpen(false)
                }}
              >
                Move to another node
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
