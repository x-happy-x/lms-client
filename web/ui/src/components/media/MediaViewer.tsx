import { useEffect } from 'react'
import { fileUrl } from '../../api'
import { kindOfJob } from '../../lib/fileKinds'
import { formatBytes, titleFromJob } from '../../lib/format'
import type { Job } from '../../types'
import { Icon } from '../../ui/Icon'

type Props = {
  jobs: Job[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

/**
 * Full-screen viewer: photos and videos stream from the node through the router
 * (Range requests let the video seek), nothing is saved on this device.
 */
export function MediaViewer({ jobs, index, onIndex, onClose }: Props) {
  const job = jobs[index]
  const hasPrev = index > 0
  const hasNext = index < jobs.length - 1

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && hasPrev) onIndex(index - 1)
      if (event.key === 'ArrowRight' && hasNext) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, hasPrev, hasNext, onIndex, onClose])

  if (!job) return null
  const kind = kindOfJob(job)
  const src = fileUrl(job.id, true)

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={titleFromJob(job)}>
      <header className="viewer-bar">
        <div className="viewer-title">
          <strong>{titleFromJob(job)}</strong>
          <span className="muted small">
            {index + 1} из {jobs.length}
            {job.outputSizeBytes ? ` · ${formatBytes(job.outputSizeBytes)}` : ''}
          </span>
        </div>
        <a className="icon-btn" href={fileUrl(job.id)} download title="Скачать на это устройство" aria-label="Скачать">
          <Icon name="download" />
        </a>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>
      <div className="viewer-stage" onClick={onClose}>
        <div className="viewer-media" onClick={(event) => event.stopPropagation()}>
          {kind === 'video' ? (
            <video key={job.id} src={src} controls autoPlay playsInline preload="metadata" />
          ) : (
            <img key={job.id} src={src} alt={titleFromJob(job)} />
          )}
        </div>
      </div>
      {hasPrev ? (
        <button type="button" className="viewer-nav prev" onClick={() => onIndex(index - 1)} aria-label="Предыдущий">
          <Icon name="chevronLeft" size={28} />
        </button>
      ) : null}
      {hasNext ? (
        <button type="button" className="viewer-nav next" onClick={() => onIndex(index + 1)} aria-label="Следующий">
          <Icon name="chevronRight" size={28} />
        </button>
      ) : null}
    </div>
  )
}
