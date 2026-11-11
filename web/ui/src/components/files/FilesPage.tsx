import { useEffect, useMemo, useState } from 'react'
import { api, storageFileUrl } from '../../api'
import { formatBytes } from '../../lib/format'
import type { NodeItem, StorageFileEntry, StorageFileListing, StorageTarget } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Icon } from '../../ui/Icon'
import './files.css'

type Change = { operation: 'mkdir' | 'rename' | 'delete'; entry?: StorageFileEntry }
const previewable = (entry: StorageFileEntry) => !entry.directory && /^(video\/|audio\/|image\/(?!svg)|application\/pdf$|text\/plain$)/.test(entry.mimeType || '')
const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) }

export function FilesPage({ nodes, onChanged }: { nodes: NodeItem[]; onChanged?: () => void }) {
  const [nodeId, setNodeId] = useState(''), [root, setRoot] = useState(''), [path, setPath] = useState('')
  const [targets, setTargets] = useState<StorageTarget[]>([]), [listing, setListing] = useState<StorageFileListing | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [sort, setSort] = useState('name'), [revision, setRevision] = useState(0), [targetsRevision, setTargetsRevision] = useState(0)
  const [canWrite, setCanWrite] = useState(false), [change, setChange] = useState<Change | null>(null), [name, setName] = useState(''), [saving, setSaving] = useState(false), [changeError, setChangeError] = useState('')
  const [preview, setPreview] = useState<StorageFileEntry | null>(null)
  useEffect(() => { void api.fileAccess().then(setCanWrite).catch(() => setCanWrite(false)) }, [])
  useEffect(() => { if (!nodeId && nodes.length) setNodeId((nodes.find(node => node.enabled && node.status === 'online') || nodes.find(node => node.enabled))?.id || '') }, [nodes, nodeId])
  useEffect(() => {
    let current = true
    setTargets([]); setRoot(''); setPath(''); setListing(null); setError(''); setPreview(null)
    if (!nodeId) return
    setLoading(true)
    void api.getNodeStorageTargets(nodeId).then(response => {
      if (!current) return
      setTargets(response.targets || [])
      setRoot(response.defaultPath || response.targets?.[0]?.path || '')
      if (!response.targets?.length) setError('На ноде нет доступных хранилищ.')
    }).catch(failure => { if (current) setError(failure.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [nodeId, targetsRevision])
  useEffect(() => {
    if (!nodeId || !root) return
    let current = true
    setLoading(true); setError(''); setListing(null); setPreview(null)
    void api.browseFiles(nodeId, root, path).then(result => { if (current) setListing(result) }).catch(failure => { if (current) setError(failure.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [nodeId, root, path, revision])
  const entries = useMemo(() => (listing?.entries || []).filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1
    if (sort === 'size') return (b.sizeBytes || 0) - (a.sizeBytes || 0) || a.name.localeCompare(b.name, 'ru', { numeric: true })
    if (sort === 'date') return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    return a.name.localeCompare(b.name, 'ru', { numeric: true })
  }), [listing, query, sort])
  const reload = () => root ? setRevision(value => value + 1) : setTargetsRevision(value => value + 1)
  const navigate = (next: string) => { setQuery(''); setPath(next) }
  const openChange = (operation: Change['operation'], entry?: StorageFileEntry) => { setChange({ operation, entry }); setName(entry?.name || ''); setChangeError('') }
  const submitChange = async () => {
    if (!change || saving) return
    setSaving(true); setChangeError('')
    try {
      await api.mutateFile(nodeId, change.operation, { root, path: change.entry?.path || path, ...(change.operation === 'delete' ? {} : { name: name.trim() }) })
      setChange(null); setRevision(value => value + 1); onChanged?.()
    } catch (failure) { setChangeError((failure as Error).message) }
    finally { setSaving(false) }
  }
  const selectedTarget = targets.find(target => target.path === root)
  const crumbs = path.split('/').filter(Boolean)
  return <div className="page files-page">
    <div className="files-controls">
      <label className="field"><span>Нода</span><select aria-label="Нода файлового менеджера" value={nodeId} onChange={event => setNodeId(event.target.value)}><option value="" disabled>Выберите ноду</option>{nodes.filter(node => node.enabled).map(node => <option key={node.id} value={node.id}>{node.name}{node.status !== 'online' ? ' · не в сети' : ''}</option>)}</select></label>
      <label className="field files-storage"><span>Хранилище</span><select aria-label="Хранилище" value={root} disabled={!targets.length} onChange={event => { setRoot(event.target.value); navigate('') }}>{!targets.length ? <option value="">Нет хранилищ</option> : null}{targets.map(target => <option key={target.path} value={target.path}>{target.path}</option>)}</select></label>
      <button type="button" className="icon-btn" title="Обновить папку" aria-label="Обновить папку" disabled={loading || !root} onClick={reload}><Icon name="retry" /></button>
      {canWrite ? <button type="button" className="btn" disabled={!listing || loading || selectedTarget?.writable === false} onClick={() => openChange('mkdir')}><Icon name="plus" size={18} />Новая папка</button> : null}
    </div>
    {selectedTarget ? <div className="files-volume"><Icon name="disk" size={18} /><span>Свободно <strong>{formatBytes(selectedTarget.freeBytes)}</strong> из {formatBytes(selectedTarget.totalBytes)}</span>{!selectedTarget.writable ? <span className="tag">Только чтение</span> : null}</div> : null}
    <section className="files-browser" aria-label="Файлы и папки" aria-busy={loading}>
      <div className="files-browser-head">
        <nav className="files-breadcrumbs" aria-label="Путь"><button type="button" disabled={!path} onClick={() => navigate('')}><Icon name="folder" size={17} /><span>Файлы</span></button>{crumbs.map((part, index) => <span key={index}><Icon name="chevronRight" size={14} /><button type="button" disabled={index === crumbs.length - 1} onClick={() => navigate(crumbs.slice(0, index + 1).join('/'))}>{part}</button></span>)}</nav>
        <div className="files-filter"><label className="files-search"><Icon name="search" size={17} /><input aria-label="Поиск в папке" placeholder="Поиск в папке" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Сортировка файлов" value={sort} onChange={event => setSort(event.target.value)}><option value="name">По имени</option><option value="date">Сначала новые</option><option value="size">По размеру</option></select></div>
      </div>
      {error ? <div className="alert error" role="alert">{error}<button type="button" className="btn small" onClick={reload}>Повторить</button></div> : null}
      {loading ? <div className="files-empty" role="status"><span className="spinner" />Читаем папку…</div> : !error && !entries.length ? <div className="files-empty"><Icon name="folder" size={36} /><strong>{query ? 'Ничего не найдено' : !nodeId ? 'Выберите ноду' : 'Папка пуста'}</strong><span className="muted">{query ? 'Попробуйте другое имя файла.' : 'Здесь появятся файлы выбранного хранилища.'}</span></div> : null}
      {!loading && !error && entries.length ? <div className="files-list" role="list">{entries.map(entry => <div className={`files-row${entry.directory ? ' is-directory' : ''}`} key={entry.path} role="listitem">
        <button type="button" className="files-name" onClick={() => entry.directory ? navigate(entry.path) : previewable(entry) ? setPreview(entry) : window.open(storageFileUrl(nodeId, root, entry.path), '_blank', 'noopener')} title={entry.name}><span className="files-kind"><Icon name={entry.directory ? 'folder' : entry.mimeType?.startsWith('video/') ? 'video' : entry.mimeType?.startsWith('audio/') ? 'audio' : entry.mimeType?.startsWith('image/') ? 'image' : 'document'} size={22} /></span><span><strong>{entry.name}</strong><small>{entry.directory ? 'Папка' : entry.mimeType || 'Файл'}</small></span></button>
        <span className="files-size">{entry.directory ? '—' : formatBytes(entry.sizeBytes)}</span><span className="files-date">{date(entry.modifiedAt)}</span>
        <div className="files-actions">{!entry.directory ? <a className="icon-btn" href={storageFileUrl(nodeId, root, entry.path)} download title={`Скачать ${entry.name}`} aria-label={`Скачать ${entry.name}`}><Icon name="download" size={18} /></a> : <button type="button" className="icon-btn" onClick={() => navigate(entry.path)} title="Открыть папку" aria-label={`Открыть ${entry.name}`}><Icon name="chevronRight" size={18} /></button>}{canWrite && selectedTarget?.writable !== false ? <><button type="button" className="icon-btn" onClick={() => openChange('rename', entry)} title="Переименовать" aria-label={`Переименовать ${entry.name}`}><Icon name="edit" size={17} /></button><button type="button" className="icon-btn" onClick={() => openChange('delete', entry)} title="Удалить" aria-label={`Удалить ${entry.name}`}><Icon name="trash" size={17} /></button></> : null}</div>
      </div>)}</div> : null}
      {listing?.truncated ? <p className="files-note muted">Показаны первые {listing.entries.length} элементов. Для большой библиотеки используйте вложенные папки.</p> : null}
    </section>
    {preview ? <Dialog title={preview.name} onClose={() => setPreview(null)} size="lg" footer={<a className="btn" href={storageFileUrl(nodeId, root, preview.path)} download><Icon name="download" size={18} />Скачать</a>}><div className="files-preview">{preview.mimeType?.startsWith('video/') ? <video controls playsInline preload="metadata" src={storageFileUrl(nodeId, root, preview.path, true)} /> : preview.mimeType?.startsWith('audio/') ? <audio controls src={storageFileUrl(nodeId, root, preview.path, true)} /> : preview.mimeType?.startsWith('image/') ? <img src={storageFileUrl(nodeId, root, preview.path, true)} alt={preview.name} /> : <iframe title={preview.name} sandbox="" src={storageFileUrl(nodeId, root, preview.path, true)} />}</div></Dialog> : null}
    {change ? <Dialog title={change.operation === 'mkdir' ? 'Новая папка' : change.operation === 'rename' ? 'Переименовать' : 'Удалить файл'} onClose={() => { if (!saving) setChange(null) }} footer={<><button type="button" className="btn" disabled={saving} onClick={() => setChange(null)}>Отмена</button><button type="submit" form="file-mutation" className={`btn ${change.operation === 'delete' ? 'files-danger' : 'primary'}`} disabled={saving || (change.operation !== 'delete' && !name.trim())}>{saving ? 'Сохраняем…' : change.operation === 'delete' ? 'Удалить' : 'Сохранить'}</button></>}><form id="file-mutation" onSubmit={event => { event.preventDefault(); void submitChange() }}>{change.operation === 'delete' ? <p>Удалить «{change.entry?.name}»? {change.entry?.directory ? 'Удаляются только пустые папки.' : 'Файл будет удалён из хранилища ноды.'}</p> : <label className="field"><span>Имя</span><input autoFocus maxLength={255} value={name} onChange={event => setName(event.target.value)} disabled={saving} required /></label>}{changeError ? <p className="alert error" role="alert">{changeError}</p> : null}</form></Dialog> : null}
  </div>
}
