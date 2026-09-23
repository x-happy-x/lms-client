import type { FormEvent } from 'react'
import { Badge } from '../common/Badge'
import { NodeFormFields } from './NodeFormFields'
import type { NodeItem } from '../../types'
import { formatAgo } from '../../utils/format'

type NodeFormState = {
  name: string
  baseUrl: string
  clientId: string
  secret: string
  enabled: boolean
}

type NodesPanelProps = {
  nodes: NodeItem[]
  createForm: NodeFormState
  onCreateFormChange: (next: NodeFormState) => void
  onCreateSubmit: (event: FormEvent<HTMLFormElement>) => void
  editNodeId: string
  editForm: NodeFormState | null
  onEditStart: (node: NodeItem) => void
  onEditCancel: () => void
  onEditFormChange: (next: NodeFormState) => void
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRefresh: () => void
}

function statusView(status: NodeItem['status']): { label: string; tone: 'good' | 'bad' | 'queued' | 'muted' } {
  switch (status) {
    case 'online':
      return { label: 'Online', tone: 'good' }
    case 'offline':
      return { label: 'Offline', tone: 'bad' }
    case 'never_seen':
      return { label: 'Never seen', tone: 'queued' }
    case 'disabled':
      return { label: 'Disabled', tone: 'muted' }
    default:
      return { label: 'Unknown', tone: 'muted' }
  }
}

export function NodesPanel({
  nodes,
  createForm,
  onCreateFormChange,
  onCreateSubmit,
  editNodeId,
  editForm,
  onEditStart,
  onEditCancel,
  onEditFormChange,
  onEditSubmit,
  onRefresh
}: NodesPanelProps) {
  return (
    <div className="split-grid">
      <section className="panel">
        <h2>Add node</h2>
        <form className="form-grid" onSubmit={onCreateSubmit}>
          <NodeFormFields value={createForm} onChange={onCreateFormChange} secretLabel="Secret" />
          <div className="form-actions wide">
            <button type="submit" className="button button-primary">
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Nodes</h2>
          <button type="button" className="button button-ghost" onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <div className="node-list">
          {nodes.length === 0 ? <div className="muted">No nodes configured yet.</div> : null}
          {nodes.map((node) => {
            const view = statusView(node.status)
            const isEditing = editNodeId === node.id && editForm
            return (
              <article className="node-card" key={node.id}>
                {isEditing ? (
                  <form className="form-grid compact" onSubmit={onEditSubmit}>
                    <NodeFormFields
                      value={editForm}
                      onChange={onEditFormChange}
                      secretLabel="New secret"
                      secretPlaceholder="leave empty to keep"
                    />
                    <div className="form-actions wide">
                      <button type="submit" className="button button-primary">
                        Update
                      </button>
                      <button type="button" className="button button-ghost" onClick={onEditCancel}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="node-head">
                      <strong>{node.name}</strong>
                      <Badge tone={view.tone}>{view.label}</Badge>
                    </div>
                    <div className="muted">{node.baseUrl}</div>
                    <div className="node-meta">
                      <span>{node.clientId}</span>
                      {typeof node.pingMs === 'number' ? <span>{node.pingMs} ms</span> : null}
                      <span>{formatAgo(node.lastSeenAt)}</span>
                    </div>
                    <div className="type-chips">
                      {(node.availableTypes ?? []).map((item) => (
                        <span key={item} className="type-chip">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="form-actions">
                      <button type="button" className="button button-ghost" onClick={() => onEditStart(node)}>
                        Edit
                      </button>
                    </div>
                  </>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
