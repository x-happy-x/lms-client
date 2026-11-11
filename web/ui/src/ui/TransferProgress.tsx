import { useId, type CSSProperties } from 'react'
import type { JobStatus } from '../types'
import { STATUS_LABELS, formatPercent } from '../lib/format'
import './transfer-progress.css'

/** Reports actual tool progress. Unknown size stays indeterminate, never a guessed percentage. */
export function TransferProgress({ value, status, label, ariaLabel, showLabel = true }: { value?: number | null; status: JobStatus; label?: string; ariaLabel?: string; showLabel?: boolean }) {
  const id = useId().replace(/:/g, '')
  const known = status === 'DONE' || (typeof value === 'number' && Number.isFinite(value))
  const percent = status === 'DONE' ? 100 : known ? Math.max(0, Math.min(100, value as number)) : undefined
  const caption = label || STATUS_LABELS[status] || 'Загрузка'
  const reading = known ? formatPercent(percent) : status === 'QUEUED' ? 'Ожидание' : 'Размер неизвестен'
  return <span className={`transfer-progress state-${status.toLowerCase()}${known ? '' : ' is-unknown'}`} role="progressbar" aria-label={ariaLabel || caption} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${caption}: ${reading}`}>
    {showLabel ? <span className="transfer-progress-label"><span>{caption}</span><strong>{reading}</strong></span> : null}
    <span className="transfer-progress-track"><span className="transfer-progress-fill" style={{ '--transfer-value': `${percent ?? 0}%` } as CSSProperties}>
      <svg className="transfer-progress-wave" aria-hidden="true" width="100%" height="12"><defs><pattern id={id} width="32" height="12" patternUnits="userSpaceOnUse"><path d="M0 6C4 1 12 1 16 6S28 11 32 6" fill="none" stroke="currentColor" strokeWidth="1.5" /></pattern></defs><rect width="100%" height="12" fill={`url(#${id})`} /></svg>
    </span></span>
  </span>
}
