import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import type { NewJobFormState } from '../../hooks/useNewDownloadFlow'
import { Icon } from '../../ui/Icon'
import { PlaylistMedia } from './PlaylistMedia'

export function PlaylistInspector({ value, onChange }: { value: NewJobFormState; onChange: (next: NewJobFormState) => void }) {
  const current = useRef(value)
  current.current = value
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (value.type !== 'YTDLP' || !/^https?:\/\//i.test(value.url) || !value.nodeId) {
      setLoading(false)
      if (current.current.mediaLoading) onChange({ ...current.current, mediaLoading: false })
      return
    }
    let active = true
    setLoading(true); setError('')
    onChange({ ...current.current, mediaLoading: true })
    const timer = window.setTimeout(() => {
      api.extractMedia({ url: value.url.trim(), nodeId: value.nodeId }).then(result => {
        if (!active) return
        onChange({ ...current.current, media: result, playlistId: crypto.randomUUID(), selectedEntries: undefined, mediaLoading: false })
      }, reason => { if (active) { setError(reason.message); onChange({ ...current.current, mediaLoading: false }) } }).finally(() => { if (active) setLoading(false) })
    }, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [value.type, value.url, value.nodeId, retry])
  if (value.type !== 'YTDLP') return null
  const result = value.media, entries = result?.entries || [], selected = new Set(value.selectedEntries || [])
  const all = value.selectedEntries === undefined
  return (
    <section className="playlist-inspector" aria-label="Видео и плейлист">
      <div className="playlist-inspector-heading"><Icon name="layers" /><strong>Видео и плейлист</strong><button type="button" className="icon-btn" disabled={loading || !value.nodeId} onClick={() => setRetry(retry + 1)} aria-label="Обновить список роликов"><Icon name="retry" size={18} /></button></div>
      {loading ? <p className="playlist-notice" role="status"><span className="spinner" />Находим ролики на выбранной ноде…</p> : null}
      {error ? <p className="playlist-notice error" role="status">{error}</p> : null}
      <div className="field-row">
        <label className="field"><span>Качество</span><select value={value.maxHeight} onChange={event => onChange({ ...value, maxHeight: Number(event.target.value) })}><option value={0}>Лучшее доступное</option>{[2160, 1440, 1080, 720, 480, 360, 240, 144].map(height => <option key={height} value={height}>До {height}p</option>)}</select></label>
        <label className="field"><span>Формат</span><select value={value.container} onChange={event => onChange({ ...value, container: event.target.value })}><option value="auto">Автоматически</option><option value="mp4">MP4</option><option value="mkv">MKV</option></select></label>
      </div>
      <button type="button" className={`playlist-chip${value.audioOnly ? ' selected' : ''}`} aria-pressed={value.audioOnly} onClick={() => onChange({ ...value, audioOnly: !value.audioOnly })}><Icon name="audio" size={16} />Только аудио</button>
      {!loading && result ? (
        result.kind === 'playlist' ? <>
          <div className="playlist-source-summary"><div className="playlist-mini-stack">{result.thumbnail || entries[0]?.thumbnail ? <img src={result.thumbnail || entries[0].thumbnail} alt="" referrerPolicy="no-referrer" /> : <Icon name="layers" size={30} />}</div><div><strong>{result.title || 'Плейлист'}</strong><p className="muted">{result.entryCount ?? entries.length} роликов{result.truncated ? ' · показаны первые 300' : ''}</p></div></div>
          <div className="playlist-selection-bar"><button type="button" className={`playlist-chip${all ? ' selected' : ''}`} aria-pressed={all} onClick={() => onChange({ ...value, selectedEntries: undefined })}>Весь плейлист</button><button type="button" className={`playlist-chip${!all ? ' selected' : ''}`} aria-pressed={!all} onClick={() => onChange({ ...value, selectedEntries: entries.map(entry => entry.url) })}>Выбрать ролики</button>{!all ? <button type="button" className="playlist-chip" onClick={() => onChange({ ...value, selectedEntries: selected.size ? [] : entries.map(entry => entry.url) })}>{selected.size ? 'Снять выбор' : 'Выбрать все'}</button> : null}</div>
          <p className="muted small">{all ? 'Одна загрузка, все ролики в отдельной папке.' : `Выбрано ${selected.size} из ${entries.length}. Каждый ролик — отдельная загрузка в одной стопке.`}</p>
          <div className="playlist-preview-list">{entries.map((entry, index) => <PlaylistMedia key={entry.url} entry={entry} index={index + 1} nodeId={value.nodeId} maxHeight={value.maxHeight || undefined} selected={selected.has(entry.url)} onSelect={all ? undefined : () => { const next = new Set(selected); if (next.has(entry.url)) next.delete(entry.url); else next.add(entry.url); onChange({ ...value, selectedEntries: [...next] }) }} />)}</div>
          {!entries.length ? <p className="playlist-notice">Источник не вернул список роликов. Можно отправить весь плейлист.</p> : null}
        </> : <PlaylistMedia entry={result} index={1} nodeId={value.nodeId} maxHeight={value.maxHeight || undefined} />
      ) : null}
    </section>
  )
}
