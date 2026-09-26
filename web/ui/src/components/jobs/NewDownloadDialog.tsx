import type { NewJobFormState } from '../../hooks/useNewDownloadFlow'
import { extractLink } from '../../hooks/useNewDownloadFlow'
import { formatBytes, typeLabel } from '../../lib/format'
import type { JobPreflightNode, JobPreflightResponse, Profile, StorageTarget } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Icon } from '../../ui/Icon'
import { SpeedLimitPicker } from '../../ui/SpeedLimitPicker'

type Props = {
  value: NewJobFormState
  onChange: (next: NewJobFormState) => void
  onClose: () => void
  onSubmit: (startImmediately: boolean) => void
  profiles: Profile[]
  preflight: JobPreflightResponse | null
  preflightLoading: boolean
  preflightError: string
  selectedNode: JobPreflightNode | null
  targets: StorageTarget[]
  targetsLoading: boolean
  targetsError: string
  submitting: boolean
  submitError: string
}

const NODE_STATUS: Record<string, string> = {
  online: 'в сети',
  offline: 'не в сети',
  never_seen: 'ещё не отвечала',
  disabled: 'выключена'
}

export function NewDownloadDialog(props: Props) {
  const { value, onChange, onClose, onSubmit, preflight, preflightLoading, preflightError, selectedNode } = props
  const types = selectedNode?.supportedTypes?.length ? selectedNode.supportedTypes : ['DIRECT', 'YTDLP', 'ARIA2C', 'TORRENT']
  const canSubmit = value.url.trim() !== '' && value.nodeId !== '' && !props.submitting

  return (
    <Dialog
      title="Новая загрузка"
      subtitle="Ссылка на файл, страницу с видео, .torrent или magnet"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn" onClick={() => onSubmit(false)} disabled={!canSubmit}>
            Добавить на паузе
          </button>
          <button type="button" className="btn primary" onClick={() => onSubmit(true)} disabled={!canSubmit}>
            <Icon name="download" size={18} /> Скачать
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>Ссылка</span>
          <div className="input-with-button">
            <input
              autoFocus
              value={value.url}
              onChange={(event) => onChange({ ...value, url: event.target.value })}
              onPaste={(event) => {
                const text = event.clipboardData.getData('text')
                const link = extractLink(text)
                if (link !== text.trim()) {
                  event.preventDefault()
                  onChange({ ...value, url: link })
                }
              }}
              placeholder="https://… или magnet:?…"
            />
            {preflightLoading ? <span className="spinner" aria-label="Проверка" /> : null}
          </div>
        </label>
        {preflightError ? <div className="alert error">{preflightError}</div> : null}

        {preflight ? (
          <>
            <div className="field">
              <span>Нода</span>
              <div className="choice-grid">
                {preflight.nodes.length === 0 ? <p className="muted">На роутере нет включённых нод.</p> : null}
                {preflight.nodes.map((node) => {
                  const usable = node.supportedTypes.length > 0 && !node.error
                  return (
                    <button
                      key={node.nodeId}
                      type="button"
                      className={`choice${value.nodeId === node.nodeId ? ' active' : ''}${usable ? '' : ' disabled'}`}
                      onClick={() => onChange({ ...value, nodeId: node.nodeId })}
                    >
                      <span className="choice-title">
                        <span className={`status-dot node-${node.status}`} />
                        {node.nodeName}
                        {preflight.bestNodeId === node.nodeId ? <span className="tag">лучшая</span> : null}
                      </span>
                      <span className="muted small">
                        {NODE_STATUS[node.status] ?? node.status}
                        {typeof node.pingMs === 'number' ? ` · ${node.pingMs} мс` : ''}
                        {node.sizeKnown && node.sizeBytes ? ` · ${formatBytes(node.sizeBytes)}` : ''}
                      </span>
                      {node.error ? <span className="small error-text">{node.error}</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="field">
              <span>Способ загрузки</span>
              <div className="segmented wrap">
                {types.map((type) => {
                  const option = selectedNode?.options.find((item) => item.type === type)
                  return (
                    <button
                      key={type}
                      type="button"
                      className={value.type === type ? 'active' : ''}
                      title={option?.message}
                      onClick={() => onChange({ ...value, type })}
                    >
                      {typeLabel(type)}
                      {option?.resumeSupported ? <span className="tag">докачка</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Папка на ноде {props.targetsLoading ? '…' : ''}</span>
                <input
                  value={value.storagePath}
                  onChange={(event) => onChange({ ...value, storagePath: event.target.value })}
                  placeholder={selectedNode?.defaultStoragePath || '/downloads'}
                />
              </label>
              <label className="field">
                <span>Профиль</span>
                <select value={value.profileId} onChange={(event) => onChange({ ...value, profileId: event.target.value })}>
                  <option value="">Без профиля</option>
                  {props.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field">
              <span>Ограничение скорости</span>
              <SpeedLimitPicker value={value.maxSpeedBytes} onChange={(maxSpeedBytes) => onChange({ ...value, maxSpeedBytes })} />
            </div>
            {props.targetsError ? <div className="alert error">{props.targetsError}</div> : null}
            {props.targets.length > 0 ? (
              <div className="targets">
                {props.targets.map((target) => {
                  const usedPercent = target.totalBytes > 0 ? 100 - (target.freeBytes / target.totalBytes) * 100 : 0
                  return (
                    <button
                      key={target.path}
                      type="button"
                      className={`target${value.storagePath === target.path ? ' active' : ''}${target.canFit === false || !target.writable ? ' warn' : ''}`}
                      onClick={() => onChange({ ...value, storagePath: target.path })}
                    >
                      <span className="target-path"><Icon name="folder" size={16} /> {target.path}</span>
                      <span className="meter"><span style={{ width: `${usedPercent}%` }} /></span>
                      <span className="muted small">
                        {formatBytes(target.freeBytes)} свободно из {formatBytes(target.totalBytes)}
                        {target.canFit === false ? ' · не поместится' : ''}
                        {!target.writable ? ' · только чтение' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </>
        ) : null}
        {props.submitError ? <div className="alert error">{props.submitError}</div> : null}
      </div>
    </Dialog>
  )
}
