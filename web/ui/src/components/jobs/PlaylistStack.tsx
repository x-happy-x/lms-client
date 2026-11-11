import { useEffect, useId, useState } from 'react'
import { api } from '../../api'
import { formatBytes } from '../../lib/format'
import { playlistProgress } from '../../lib/playlists'
import type { Job, MediaEntry, NodeItem } from '../../types'
import { Icon } from '../../ui/Icon'
import { TransferProgress } from '../../ui/TransferProgress'
import { JobItem, type JobActions } from './JobItem'
import { PlaylistMedia } from './PlaylistMedia'

export function PlaylistStack({ jobs, nodeById, actions, layout }: { jobs: Job[]; nodeById: Map<string, NodeItem>; actions: JobActions; layout: 'row' | 'tile' }) {
  const first = jobs[0], metadata = first.playlist, whole = jobs.length === 1 && first.ytdlpOptions?.playlist === true
  const [open, setOpen] = useState(false), [entries, setEntries] = useState<MediaEntry[]>(metadata?.entries || [])
  const [title, setTitle] = useState(metadata?.title || ''), [thumbnail, setThumbnail] = useState(metadata?.thumbnail || '')
  const [count, setCount] = useState(metadata?.entryCount), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [loaded, setLoaded] = useState(Boolean(metadata?.entries?.length)), [retry, setRetry] = useState(0)
  const id = useId(), progress = playlistProgress(jobs), url = metadata?.url || first.url
  useEffect(() => {
    if (!open || loaded) return
    let active = true
    setLoading(true); setError('')
    api.extractMedia({ url, nodeId: first.nodeId, impersonate: first.ytdlpOptions?.impersonate, networkRouteId: first.networkRouteId }).then(result => {
      if (!active) return
      if (result.kind !== 'playlist') throw new Error('Источник больше не возвращает плейлист. Задания сохранены.')
      setEntries(result.entries); setTitle(result.title || ''); setThumbnail(result.thumbnail || result.entries.find(entry => entry.thumbnail)?.thumbnail || ''); setCount(result.entryCount); setLoaded(true)
    }).catch(reason => { if (active) setError(reason.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, loaded, url, first.nodeId, retry])
  const completed = jobs.filter(job => job.status === 'DONE').length, failed = jobs.filter(job => job.status === 'ERROR').length
  const size = jobs.reduce((sum, job) => sum + (job.outputSizeBytes || job.totalBytes || 0), 0)
  const total = count ?? (entries.length || undefined)
  const covers = [...new Set([thumbnail, ...entries.map(entry => entry.thumbnail)].filter(Boolean))].slice(0, 3)
  const state = jobs.some(job => job.status === 'RUNNING') ? 'RUNNING' : jobs.some(job => job.status === 'QUEUED') ? 'QUEUED' : jobs.some(job => job.status === 'PAUSED') ? 'PAUSED' : jobs.some(job => job.status === 'ERROR') ? 'ERROR' : jobs.every(job => job.status === 'DONE') ? 'DONE' : 'CANCELED'
  const summary = whole ? 'Весь список · одно задание' : `Выбрано ${jobs.length} · готово ${completed}`
  return (
    <article className={`playlist-stack${open ? ' expanded' : ''} playlist-stack-${layout}`}>
      <button type="button" className="playlist-stack-heading" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="playlist-stack-art" aria-hidden="true">{[2, 1, 0].map(index => <span className={`playlist-cover-layer cover-${index}`} key={index}><Icon name={index === 0 ? 'video' : 'layers'} size={index === 0 ? 28 : 22} />{covers[index] ? <img src={covers[index]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }} /> : null}</span>)}</span>
        <span className="playlist-stack-description"><span className="playlist-stack-eyebrow"><Icon name="layers" size={13} />Плейлист{total !== undefined ? <b>{total} роликов</b> : null}</span><strong>{title || 'Плейлист'}</strong><span className="playlist-stack-caption"><span>{summary}</span>{failed ? <span className="playlist-stack-failed">Ошибок: {failed}</span> : null}{size > 0 ? <span>{formatBytes(size)}</span> : null}</span><TransferProgress value={progress} status={state} label={whole ? state === 'DONE' ? 'Плейлист завершён' : 'Текущий ролик' : undefined} ariaLabel={`${whole ? 'Прогресс текущего ролика в плейлисте' : 'Прогресс выбранных роликов'} ${title || 'Плейлист'}`} /></span>
        <span className="playlist-stack-indicator"><Icon name="chevronDown" size={19} /></span>
      </button>
      {open ? <div id={id} className="playlist-stack-content">
        {loading ? <p className="playlist-notice" role="status"><span className="spinner" />Получаем список роликов…</p> : null}
        {error ? <div className="playlist-notice error" role="status">{error}<button type="button" className="icon-btn" aria-label="Повторить получение плейлиста" onClick={() => setRetry(retry + 1)}><Icon name="retry" /></button></div> : null}
        {whole ? <>
          <JobItem job={first} node={first.nodeId ? nodeById.get(first.nodeId) : undefined} actions={actions} layout="row" />
          <p className="muted small">Показан прогресс текущего ролика. Статусы отдельных роликов источник не сообщает.</p>
          <div className="playlist-preview-list">{entries.map((entry, index) => <PlaylistMedia key={entry.url} entry={entry} index={index + 1} nodeId={first.nodeId} networkRouteId={first.networkRouteId} maxHeight={first.ytdlpOptions?.maxHeight} />)}</div>
          {!loading && !error && !entries.length ? <p className="muted">Список роликов недоступен. Загрузкой можно управлять выше.</p> : null}
        </> : jobs.map(job => {
          const entry = entries.find(entry => entry.url === job.url)
          return <JobItem key={job.id} job={job} label={entry?.title} thumbnail={entry?.thumbnail} node={job.nodeId ? nodeById.get(job.nodeId) : undefined} actions={actions} layout="row" />
        })}
      </div> : null}
    </article>
  )
}
