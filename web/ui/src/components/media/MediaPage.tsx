import { useMemo, useState } from 'react'
import { isViewableMedia, kindOfJob } from '../../lib/fileKinds'
import { formatBytes, titleFromJob } from '../../lib/format'
import type { Job } from '../../types'
import { Icon } from '../../ui/Icon'
import { Thumb } from '../../ui/Thumb'

type Filter = 'all' | 'video' | 'image'

/** Gallery of finished photos and videos; opening one streams it without saving. */
export function MediaPage({ jobs, search, onOpen }: { jobs: Job[]; search: string; onOpen: (list: Job[], index: number) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const media = useMemo(() => {
    const query = search.trim().toLowerCase()
    return jobs
      .filter(isViewableMedia)
      .filter((job) => filter === 'all' || kindOfJob(job) === filter)
      .filter((job) => !query || titleFromJob(job).toLowerCase().includes(query))
      .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
  }, [jobs, filter, search])

  return (
    <div className="page">
      <div className="toolbar">
        <div className="toolbar-row">
          <div className="segmented">
            {(['all', 'video', 'image'] as Filter[]).map((value) => (
              <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                {value === 'all' ? 'Всё' : value === 'video' ? 'Видео' : 'Фото'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {media.length === 0 ? (
        <div className="empty">
          <Icon name="image" size={40} />
          <h3>Медиа пока нет</h3>
          <p className="muted">Здесь появятся скачанные фото и видео — их можно смотреть сразу, без скачивания на устройство.</p>
        </div>
      ) : (
        <div className="gallery">
          {media.map((job, index) => (
            <button key={job.id} type="button" className="gallery-item" onClick={() => onOpen(media, index)}>
              <Thumb job={job} size="lg" />
              <span className="gallery-caption">
                <span className="title">{titleFromJob(job)}</span>
                <span className="muted small">{job.outputSizeBytes ? formatBytes(job.outputSizeBytes) : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
