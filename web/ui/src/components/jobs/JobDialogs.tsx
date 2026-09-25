import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api'
import { formatBytes, titleFromJob } from '../../lib/format'
import type { Job, NodeItem, StorageTarget } from '../../types'
import { Dialog } from '../../ui/Dialog'

type Props = {
  job: Job
  onClose: () => void
  onDone: () => Promise<void>
}

export function EditUrlDialog({ job, onClose, onDone }: Props) {
  const [url, setUrl] = useState(job.url)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.updateJobUrl(job.id, url.trim())
      await onDone()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Изменить ссылку" subtitle={titleFromJob(job)} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Новая ссылка</span>
          <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <p className="muted small">Загрузка продолжится с новой ссылки. Удобно, когда старая протухла.</p>
        {error ? <div className="alert error">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={busy || !url.trim()}>Сохранить</button>
        </div>
      </form>
    </Dialog>
  )
}

export function MoveDialog({ job, nodes, onClose, onDone }: Props & { nodes: NodeItem[] }) {
  const [targetNodeId, setTargetNodeId] = useState(job.nodeId ?? nodes[0]?.id ?? '')
  const [storagePath, setStoragePath] = useState(job.storagePath ?? '')
  const [targets, setTargets] = useState<StorageTarget[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!targetNodeId) return
    let cancelled = false
    api
      .getNodeStorageTargets(targetNodeId, job.outputSizeBytes)
      .then((response) => {
        if (!cancelled) setTargets(response.targets ?? [])
      })
      .catch(() => {
        if (!cancelled) setTargets([])
      })
    return () => {
      cancelled = true
    }
  }, [targetNodeId, job.outputSizeBytes])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.moveJob(job.id, {
        targetNodeId: targetNodeId || undefined,
        storagePath: storagePath.trim() || undefined
      })
      await onDone()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const otherNode = targetNodeId !== job.nodeId

  return (
    <Dialog title="Переместить" subtitle={titleFromJob(job)} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Нода</span>
          <select value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)}>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}{node.id === job.nodeId ? ' (текущая)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Папка</span>
          <input value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="По умолчанию" list="move-targets" />
          <datalist id="move-targets">
            {targets.map((target) => (
              <option key={target.path} value={target.path}>{`${formatBytes(target.freeBytes)} свободно`}</option>
            ))}
          </datalist>
        </label>
        {otherNode ? (
          <p className="muted small">Файл будет передан через роутер на другую ноду и удалён с текущей.</p>
        ) : null}
        {error ? <div className="alert error">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={busy}>Переместить</button>
        </div>
      </form>
    </Dialog>
  )
}
