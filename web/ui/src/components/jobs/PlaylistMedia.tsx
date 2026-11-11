import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { formatBytes, formatDuration } from '../../lib/format'
import type { MediaEntry, MediaInfo } from '../../types'
import { Icon } from '../../ui/Icon'
import './playlist.css'

let active = 0
const queue: Array<() => void> = []
function drain() { while (active < 2 && queue.length) queue.shift()?.() }
const cache = new Map<string, MediaInfo>()
function inspect(url: string, nodeId?: string, maxHeight?: number, networkRouteId?: string): Promise<MediaInfo> {
  const key = `${url}\n${nodeId}\n${maxHeight}\n${networkRouteId}`
  if (cache.has(key)) return Promise.resolve(cache.get(key)!)
  return new Promise((resolve, reject) => {
    queue.push(() => {
      active++
      api.mediaInfo({ url, nodeId, maxHeight, networkRouteId }).then(result => {
        cache.set(key, result)
        if (cache.size > 300) cache.delete(cache.keys().next().value!)
        resolve(result)
      }, reject).finally(() => { active--; drain() })
    })
    drain()
  })
}

export function PlaylistMedia({ entry, index, nodeId, maxHeight, networkRouteId, selected, onSelect, action }: {
  entry: MediaEntry; index: number; nodeId?: string; maxHeight?: number; networkRouteId?: string; selected?: boolean; onSelect?: () => void; action?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState('')
  const [stream, setStream] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const previewButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!stream) return
    dialog.current?.showModal()
    closeButton.current?.focus()
    return () => { previewButton.current?.focus() }
  }, [stream])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(item => item.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let current = true
    setInfo(null); setError('')
    inspect(entry.url, nodeId, maxHeight, networkRouteId).then(result => { if (current) setInfo(result) }, reason => { if (current) setError(reason.message) })
    return () => { current = false }
  }, [visible, entry.url, nodeId, maxHeight, networkRouteId])
  async function preview() {
    setPreviewBusy(true); setError('')
    try { setStream((await api.prepareMedia({ url: entry.url, nodeId, maxHeight, networkRouteId })).streamUrl) }
    catch (reason) { setError((reason as Error).message) }
    finally { setPreviewBusy(false) }
  }
  return (
    <div className="playlist-entry" ref={ref}>
      <div className="playlist-entry-cover">
        {entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="video" size={25} />}
        <span>{entry.durationSeconds ? formatDuration(entry.durationSeconds) : index}</span>
      </div>
      <div className="playlist-entry-info">
        <strong>{entry.title || info?.title || `Ролик ${index}`}</strong>
        <div className="playlist-entry-meta">
          {info ? <><span>{info.quality || 'Исходное качество'}</span><span>{info.sizeBytes ? `${info.sizeEstimated ? '≈ ' : ''}${formatBytes(info.sizeBytes)}` : 'Размер неизвестен'}</span></> : <span>{error ? 'Качество недоступно' : 'Качество и размер…'}</span>}
        </div>
        {error ? <p className="playlist-entry-error" role="status">{error}</p> : null}
        <div className="playlist-entry-actions">
          {onSelect ? <button type="button" className={`playlist-chip${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}><Icon name={selected ? 'check' : 'plus'} size={14} />{selected ? 'Выбрано' : 'Выбрать'}</button> : null}
          <button type="button" className="icon-btn" ref={previewButton} aria-label={`Смотреть ${entry.title || 'ролик'}`} title="Смотреть без загрузки" disabled={previewBusy} onClick={() => void preview()}><Icon name="play" size={17} /></button>
          {action}
        </div>
      </div>
      {stream ? <dialog className="playlist-player" ref={dialog} aria-label="Просмотр видео" onCancel={event => { event.preventDefault(); setStream('') }}><button type="button" className="icon-btn playlist-player-close" ref={closeButton} onClick={() => setStream('')} aria-label="Закрыть видео"><Icon name="close" /></button><video src={stream} controls autoPlay playsInline /></dialog> : null}
    </div>
  )
}
