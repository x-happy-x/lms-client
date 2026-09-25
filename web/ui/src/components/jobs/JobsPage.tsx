import { useMemo } from 'react'
import { kindOfJob, type FileKind } from '../../lib/fileKinds'
import { applyQuery, countByStatus, matchesStatus } from '../../lib/jobsView'
import type { Preferences, ViewMode } from '../../hooks/usePreferences'
import type { Job, NodeItem } from '../../types'
import { Icon } from '../../ui/Icon'
import { JobItem, type JobActions } from './JobItem'
import { JobsToolbar } from './JobsToolbar'

type JobsPageProps = {
  jobs: Job[]
  nodes: NodeItem[]
  search: string
  prefs: Preferences
  actions: JobActions
  onQuery: (patch: Partial<Preferences['query']>) => void
  onView: (view: ViewMode) => void
  onReset: () => void
  onAdd: () => void
}

export function JobsPage({ jobs, nodes, search, prefs, actions, onQuery, onView, onReset, onAdd }: JobsPageProps) {
  const query = useMemo(() => ({ ...prefs.query, search }), [prefs.query, search])
  const groups = useMemo(() => applyQuery(jobs, query, nodes), [jobs, query, nodes])
  const counts = useMemo(() => countByStatus(jobs), [jobs])
  const kindCounts = useMemo(() => {
    const map = new Map<FileKind, number>()
    for (const job of jobs) {
      if (!matchesStatus(job, prefs.query.status)) continue
      const kind = kindOfJob(job)
      map.set(kind, (map.get(kind) ?? 0) + 1)
    }
    return map
  }, [jobs, prefs.query.status])
  const total = groups.reduce((sum, group) => sum + group.jobs.length, 0)
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  return (
    <div className="page">
      <JobsToolbar
        query={prefs.query}
        counts={counts}
        kindCounts={kindCounts}
        nodes={nodes}
        view={prefs.view}
        onQuery={onQuery}
        onView={onView}
        onReset={onReset}
      />

      {total === 0 ? (
        <div className="empty">
          <Icon name="download" size={40} />
          <h3>{jobs.length === 0 ? 'Загрузок пока нет' : 'Ничего не найдено'}</h3>
          <p className="muted">
            {jobs.length === 0
              ? 'Вставьте ссылку на файл, видео или magnet — нода скачает его, а забрать можно будет здесь.'
              : 'Измените фильтры или строку поиска.'}
          </p>
          {jobs.length === 0 ? (
            <button type="button" className="btn primary" onClick={onAdd}>
              <Icon name="plus" size={18} /> Новая загрузка
            </button>
          ) : (
            <button type="button" className="btn" onClick={onReset}>Сбросить фильтры</button>
          )}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="group">
            {group.label ? (
              <h3 className="group-title">
                {group.label}
                <span className="count">{group.jobs.length}</span>
              </h3>
            ) : null}
            <div className={prefs.view === 'grid' ? 'tiles' : 'rows'}>
              {group.jobs.map((job) => (
                <JobItem
                  key={job.id}
                  job={job}
                  node={job.nodeId ? nodeById.get(job.nodeId) : undefined}
                  actions={actions}
                  layout={prefs.view === 'grid' ? 'tile' : 'row'}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
