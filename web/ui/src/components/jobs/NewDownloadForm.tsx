import type { JobPreflightNode, JobPreflightResponse, NodeItem, Profile, StorageTarget } from '../../types'
import { formatBytes } from '../../utils/format'

type NewJobFormState = {
  type: string
  url: string
  storagePath: string
  nodeId: string
  profileId: string
}

type NewDownloadFormProps = {
  open: boolean
  value: NewJobFormState
  onChange: (next: NewJobFormState) => void
  onClose: () => void
  onSubmit: (startImmediately: boolean) => void
  nodes: NodeItem[]
  profiles: Profile[]
  preflight: JobPreflightResponse | null
  preflightLoading: boolean
  preflightError: string
  selectedNode: JobPreflightNode | null
  targets: StorageTarget[]
  targetsLoading: boolean
  targetsError: string
}

function protocolLabel(type: string, selectedNode: JobPreflightNode | null) {
  const option = selectedNode?.options.find((item) => item.type === type)
  if (!option) return type
  const flags = []
  if (option.resumeSupported) flags.push('resume')
  if (option.segmentedPossible) flags.push('segments later')
  return flags.length > 0 ? `${type} • ${flags.join(' • ')}` : type
}

export function NewDownloadForm({
  open,
  value,
  onChange,
  onClose,
  onSubmit,
  nodes,
  profiles,
  preflight,
  preflightLoading,
  preflightError,
  selectedNode,
  targets,
  targetsLoading,
  targetsError
}: NewDownloadFormProps) {
  if (!open) return null

  const availableTypes = selectedNode?.supportedTypes?.length
    ? selectedNode.supportedTypes
    : ['DIRECT', 'YTDLP', 'ARIA2C']

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="new-download-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="new-download-title">New download</h2>
            <p className="muted modal-subtitle">Paste a link, inspect nodes, then choose destination and profile.</p>
          </div>
          <button type="button" className="button button-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-grid">
          <label className="wide">
            URL
            <input
              autoFocus
              value={value.url}
              onChange={(event) => onChange({ ...value, url: event.target.value })}
              placeholder="https://example.com/file.bin"
            />
          </label>

          <label>
            Protocol
            <select value={value.type} onChange={(event) => onChange({ ...value, type: event.target.value })}>
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {protocolLabel(type, selectedNode)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Profile
            <select value={value.profileId} onChange={(event) => onChange({ ...value, profileId: event.target.value })}>
              <option value="">None</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <div className="wide modal-section">
            <div className="section-title-row">
              <h3>Preflight</h3>
              {preflightLoading ? <span className="muted">Checking URL and nodes...</span> : null}
            </div>
            {preflightError ? <div className="error-text">{preflightError}</div> : null}
            {!preflightLoading && !preflightError && preflight ? (
              <div className="preflight-summary">
                <span>
                  Size:{' '}
                  {selectedNode?.sizeKnown
                    ? formatBytes(selectedNode.sizeBytes ?? 0)
                    : selectedNode?.error || 'Unknown'}
                </span>
                <span>Recommended: {selectedNode?.recommendedType || 'n/a'}</span>
              </div>
            ) : null}
          </div>

          <div className="wide modal-section">
            <div className="section-title-row">
              <h3>Nodes</h3>
              <span className="muted">Best ping is auto-selected</span>
            </div>
            <div className="node-choice-grid">
              {preflight?.nodes?.length ? (
                preflight.nodes.map((node) => {
                  const routerNode = nodes.find((item) => item.id === node.nodeId)
                  const isActive = value.nodeId === node.nodeId
                  const canUse = node.supportedTypes.length > 0 && !node.error
                  return (
                    <button
                      key={node.nodeId}
                      type="button"
                      className={`node-choice ${isActive ? 'active' : ''}`}
                      onClick={() => onChange({ ...value, nodeId: node.nodeId })}
                    >
                      <span className="node-choice-name">{node.nodeName}</span>
                      <span className="node-choice-meta">
                        {node.status}
                        {typeof node.pingMs === 'number' ? ` • ${node.pingMs} ms` : ''}
                      </span>
                      <span className="node-choice-meta">
                        {(node.supportedTypes.length ? node.supportedTypes.join(', ') : 'No supported protocols')}
                      </span>
                      <span className="node-choice-meta">
                        {node.error || routerNode?.statusText || node.statusText}
                      </span>
                      {!canUse ? <span className="node-choice-warning">Unavailable for this URL</span> : null}
                    </button>
                  )
                })
              ) : preflight ? (
                <div className="muted">No enabled nodes are configured on the router.</div>
              ) : (
                <div className="muted">Paste a URL to load node availability.</div>
              )}
            </div>
          </div>

          <div className="wide modal-section">
            <div className="section-title-row">
              <h3>Storage path</h3>
              {targetsLoading ? <span className="muted">Loading node disks...</span> : null}
            </div>
            <label>
              Path
              <input
                value={value.storagePath}
                onChange={(event) => onChange({ ...value, storagePath: event.target.value })}
                placeholder={selectedNode?.defaultStoragePath || '/downloads'}
              />
            </label>
            {targetsError ? <div className="error-text">{targetsError}</div> : null}
            {targets.length > 0 ? (
              <div className="target-grid">
                {targets.map((target) => (
                  <button
                    key={target.path}
                    type="button"
                    className={`target-item ${value.storagePath === target.path ? 'active' : ''}`}
                    onClick={() => onChange({ ...value, storagePath: target.path })}
                  >
                    <span>{target.path}</span>
                    <span>
                      {formatBytes(target.freeBytes)} free
                      {typeof target.canFit === 'boolean' ? ` • ${target.canFit ? 'fits' : 'no space'}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="button button-primary" onClick={() => onSubmit(true)} disabled={!value.url.trim() || !value.nodeId}>
            Download
          </button>
          <button type="button" className="button" onClick={() => onSubmit(false)} disabled={!value.url.trim() || !value.nodeId}>
            Add
          </button>
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}
