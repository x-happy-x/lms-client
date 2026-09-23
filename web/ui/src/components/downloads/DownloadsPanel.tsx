import type { FormEvent } from 'react'
import { DownloadRow } from './DownloadRow'
import { DownloadFilters } from './DownloadFilters'
import { JobMoveForm } from './JobMoveForm'
import { JobUrlEditForm } from './JobUrlEditForm'
import type { IconRule, Job, NodeItem } from '../../types'
import type { DownloadFilter, MoveFormState, UrlEditFormState } from './types'

type DownloadsPanelProps = {
  jobs: Job[]
  nodes: NodeItem[]
  iconRules: IconRule[]
  filter: DownloadFilter
  onFilterChange: (filter: DownloadFilter) => void
  onRefresh: () => void
  moveState: MoveFormState
  onMoveStateChange: (state: MoveFormState) => void
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  urlEditState: UrlEditFormState
  onUrlEditStateChange: (state: UrlEditFormState) => void
  onUrlEditPrepare: (job: Job) => void
  onUrlEditSubmit: (event: FormEvent<HTMLFormElement>) => void
  onUrlEditCancel: () => void
  onMovePrepare: (job: Job) => void
  onMoveSubmit: (event: FormEvent<HTMLFormElement>) => void
  onMoveCancel: () => void
}

export function DownloadsPanel({
  jobs,
  nodes,
  iconRules,
  filter,
  onFilterChange,
  onRefresh,
  moveState,
  onMoveStateChange,
  onPause,
  onResume,
  onCancel,
  onRetry,
  urlEditState,
  onUrlEditStateChange,
  onUrlEditPrepare,
  onUrlEditSubmit,
  onUrlEditCancel,
  onMovePrepare,
  onMoveSubmit,
  onMoveCancel
}: DownloadsPanelProps) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Downloads</h2>
        <button type="button" className="button button-ghost" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <DownloadFilters filter={filter} onChange={onFilterChange} />

      <div className="download-list">
        {jobs.length === 0 ? (
          <div className="empty">No jobs in this filter</div>
        ) : (
          jobs.map((job) => (
            <div key={job.id}>
              <DownloadRow
                job={job}
                iconRules={iconRules}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
                onRetry={onRetry}
                onEditUrl={onUrlEditPrepare}
                onMove={onMovePrepare}
              />

              {urlEditState.jobId === job.id ? (
                <JobUrlEditForm
                  value={urlEditState}
                  onChange={onUrlEditStateChange}
                  onSubmit={onUrlEditSubmit}
                  onCancel={onUrlEditCancel}
                />
              ) : null}

              {moveState.jobId === job.id ? (
                <JobMoveForm
                  value={moveState}
                  nodes={nodes}
                  onChange={onMoveStateChange}
                  onSubmit={onMoveSubmit}
                  onCancel={onMoveCancel}
                />
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
