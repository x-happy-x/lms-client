import { useState, type FormEvent } from 'react'
import { api, type NodePayload } from '../../api'
import { formatAgo, formatBytes, typeLabel } from '../../lib/format'
import type { NodeItem, StorageTarget } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Icon } from '../../ui/Icon'

const STATUS: Record<string, string> = {
  online: 'В сети',
  offline: 'Не в сети',
  never_seen: 'Ещё не отвечала',
  disabled: 'Выключена',
  unknown: 'Неизвестно'
}

const EMPTY: NodePayload = { name: '', baseUrl: '', clientId: 'router-main', secret: '', enabled: true }

function NodeDialog({ node, onClose, onSaved }: { node: NodeItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<NodePayload>(
    node ? { name: node.name, baseUrl: node.baseUrl, clientId: node.clientId, secret: '', enabled: node.enabled } : EMPTY
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      if (node) await api.updateNode(node.id, form)
      else await api.createNode(form)
      await onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={node ? `Нода ${node.name}` : 'Новая нода'} subtitle="Удалённый агент lms-node, к которому роутер отправляет загрузки" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field-row">
          <label className="field">
            <span>Название</span>
            <input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="s1" />
          </label>
          <label className="field">
            <span>Адрес</span>
            <input required value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://192.168.99.13:8080" />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Client ID (HMAC)</span>
            <input required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
          </label>
          <label className="field">
            <span>Секрет</span>
            <input
              type="password"
              required={!node}
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder={node ? 'Оставьте пустым, чтобы не менять' : ''}
              autoComplete="new-password"
            />
          </label>
        </div>
        <label className="switch-row">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span>Включена — принимает новые загрузки</span>
        </label>
        {error ? <div className="alert error">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Dialog>
  )
}

function Storage({ nodeId }: { nodeId: string }) {
  const [targets, setTargets] = useState<StorageTarget[] | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const response = await api.getNodeStorageTargets(nodeId)
      setTargets(response.targets ?? [])
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (targets === null) {
    return (
      <div>
        <button type="button" className="btn small" onClick={() => void load()}>
          <Icon name="folder" size={16} /> Показать диски
        </button>
        {error ? <div className="alert error">{error}</div> : null}
      </div>
    )
  }
  return (
    <div className="targets compact">
      {targets.length === 0 ? <span className="muted small">Нет доступных папок</span> : null}
      {targets.map((target) => {
        const used = target.totalBytes > 0 ? 100 - (target.freeBytes / target.totalBytes) * 100 : 0
        return (
          <div key={target.path} className={`target static${!target.writable ? ' warn' : ''}`}>
            <span className="target-path"><Icon name="folder" size={16} /> {target.path}</span>
            <span className="meter"><span style={{ width: `${used}%` }} /></span>
            <span className="muted small">{formatBytes(target.freeBytes)} свободно из {formatBytes(target.totalBytes)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function NodesPage({ nodes, onRefresh }: { nodes: NodeItem[]; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<NodeItem | null | undefined>(undefined)

  return (
    <div className="page">
      <div className="page-head">
        <p className="muted">Ноды скачивают файлы; роутер раздаёт задания и отдаёт готовые файлы в локальную сеть.</p>
        <button type="button" className="btn primary" onClick={() => setEditing(null)}>
          <Icon name="plus" size={18} /> Добавить ноду
        </button>
      </div>
      {nodes.length === 0 ? (
        <div className="empty">
          <Icon name="server" size={40} />
          <h3>Нод пока нет</h3>
          <p className="muted">Добавьте lms-node: адрес, client ID и HMAC-секрет из её настроек.</p>
        </div>
      ) : (
        <div className="cards">
          {nodes.map((node) => (
            <article key={node.id} className="card">
              <header className="card-head">
                <span className={`status-dot node-${node.status}`} />
                <div className="card-title">
                  <strong>{node.name}</strong>
                  <span className="muted small">{node.baseUrl}</span>
                </div>
                <button type="button" className="icon-btn" onClick={() => setEditing(node)} aria-label="Изменить">
                  <Icon name="edit" size={18} />
                </button>
              </header>
              <dl className="facts">
                <div><dt>Статус</dt><dd>{STATUS[node.status] ?? node.status}</dd></div>
                <div><dt>Пинг</dt><dd>{typeof node.pingMs === 'number' ? `${node.pingMs} мс` : '—'}</dd></div>
                <div><dt>Был в сети</dt><dd>{formatAgo(node.lastSeenAt)}</dd></div>
                <div><dt>Client ID</dt><dd>{node.clientId}</dd></div>
              </dl>
              {node.statusText && node.status !== 'online' ? <p className="note">{node.statusText}</p> : null}
              <div className="chips">
                {(node.availableTypes ?? []).map((type) => (
                  <span key={type} className="chip static">{typeLabel(type)}</span>
                ))}
              </div>
              {node.status === 'online' ? <Storage nodeId={node.id} /> : null}
            </article>
          ))}
        </div>
      )}
      {editing !== undefined ? <NodeDialog node={editing} onClose={() => setEditing(undefined)} onSaved={onRefresh} /> : null}
    </div>
  )
}
