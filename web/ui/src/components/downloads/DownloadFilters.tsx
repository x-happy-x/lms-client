type JobFilter = 'active' | 'completed' | 'failed' | 'all'

type DownloadFiltersProps = {
  filter: JobFilter
  onChange: (filter: JobFilter) => void
}

const FILTER_OPTIONS: Array<{ value: JobFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'all', label: 'All' }
]

export function DownloadFilters({ filter, onChange }: DownloadFiltersProps) {
  return (
    <div className="filter-row">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`tab-chip ${filter === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
