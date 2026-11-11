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
  { value: 'failed', label: 'Ошибки' }
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
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const at = STATUS_TABS.indexOf(tab), next = event.key === 'Home' ? 0 : event.key === 'End' ? STATUS_TABS.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + STATUS_TABS.length) % STATUS_TABS.length
                onQuery({ status: STATUS_TABS[next].value })
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
              }}
            >
              {tab.label}
              <span className="count">{counts[tab.value]}</span>
            </button>
          ))}
        </div>

        <div className="toolbar-actions">
          <details className="filter-panel" onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation() } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}>
            <summary><Icon name="sliders" size={17} /><span>Фильтры</span>{query.nodeId || query.group !== 'status' || query.sort !== 'newest' ? <span className="filter-dot" /> : null}<Icon name="chevronDown" size={15} /></summary>
            <div className="toolbar-controls">
          <label className="select-inline"><span className="filter-label">Нода</span>
            <Icon name="server" size={16} />
            <select value={query.nodeId} onChange={(event) => onQuery({ nodeId: event.target.value })} aria-label="Нода">
              <option value="">Все ноды</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </label>
          <label className="select-inline"><span className="filter-label">Порядок</span>
            <Icon name="sliders" size={16} />
            <select value={query.sort} onChange={(event) => onQuery({ sort: event.target.value as SortKey })} aria-label="Сортировка">
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="select-inline"><span className="filter-label">Группировка</span>
            <Icon name="layers" size={16} />
            <select value={query.group} onChange={(event) => onQuery({ group: event.target.value as GroupKey })} aria-label="Группировка">
              {Object.entries(GROUP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
            </div>
          </details>
          <div className="segmented compact" aria-label="Вид">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => onView('list')} title="Список" aria-label="Список" aria-pressed={view === 'list'}>
              <Icon name="list" size={18} />
            </button>
            <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => onView('grid')} title="Плитка" aria-label="Плитка" aria-pressed={view === 'grid'}>
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
