import { FILE_KINDS, type FileKind } from '../../lib/fileKinds'
import { GROUP_LABELS, SORT_LABELS, type GroupKey, type SortKey, type StatusFilter } from '../../lib/jobsView'
import type { Preferences, ViewMode } from '../../hooks/usePreferences'
import type { NodeItem } from '../../types'
import { Icon } from '../../ui/Icon'

type JobsToolbarProps = {
  query: Preferences['query']
  counts: Record<StatusFilter, number>
  kindCounts: Map<FileKind, number>
  nodes: NodeItem[]
  view: ViewMode
  onQuery: (patch: Partial<Preferences['query']>) => void
  onView: (view: ViewMode) => void
  onReset: () => void
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'done', label: 'Готовые' },
  { value: 'failed', label: 'С ошибкой' }
]

export function JobsToolbar({ query, counts, kindCounts, nodes, view, onQuery, onView, onReset }: JobsToolbarProps) {
  const toggleKind = (kind: FileKind) =>
    onQuery({ kinds: query.kinds.includes(kind) ? query.kinds.filter((item) => item !== kind) : [...query.kinds, kind] })
  const filtered = query.kinds.length > 0 || query.nodeId !== '' || query.status !== 'all'

  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <div className="segmented" role="tablist" aria-label="Статус">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={query.status === tab.value}
              className={query.status === tab.value ? 'active' : ''}
              onClick={() => onQuery({ status: tab.value })}
            >
              {tab.label}
              <span className="count">{counts[tab.value]}</span>
            </button>
          ))}
        </div>

        <div className="toolbar-controls">
          <label className="select-inline">
            <Icon name="server" size={16} />
            <select value={query.nodeId} onChange={(event) => onQuery({ nodeId: event.target.value })} aria-label="Нода">
              <option value="">Все ноды</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </label>
          <label className="select-inline">
            <Icon name="sliders" size={16} />
            <select value={query.sort} onChange={(event) => onQuery({ sort: event.target.value as SortKey })} aria-label="Сортировка">
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="select-inline">
            <Icon name="layers" size={16} />
            <select value={query.group} onChange={(event) => onQuery({ group: event.target.value as GroupKey })} aria-label="Группировка">
              {Object.entries(GROUP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="segmented compact" aria-label="Вид">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => onView('list')} title="Список" aria-label="Список">
              <Icon name="list" size={18} />
            </button>
            <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => onView('grid')} title="Плитка" aria-label="Плитка">
              <Icon name="grid" size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="chips" aria-label="Тип файла">
        {FILE_KINDS.filter((item) => (kindCounts.get(item.kind) ?? 0) > 0 || query.kinds.includes(item.kind)).map((item) => (
          <button
            key={item.kind}
            type="button"
            className={`chip kind-${item.kind}${query.kinds.includes(item.kind) ? ' active' : ''}`}
            aria-pressed={query.kinds.includes(item.kind)}
            onClick={() => toggleKind(item.kind)}
          >
            <Icon name={item.kind} size={16} />
            {item.label}
            <span className="count">{kindCounts.get(item.kind) ?? 0}</span>
          </button>
        ))}
        {filtered ? (
          <button type="button" className="chip ghost" onClick={onReset}>
            Сбросить фильтры
          </button>
        ) : null}
      </div>
    </div>
  )
}
