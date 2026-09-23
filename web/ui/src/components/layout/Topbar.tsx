type TopbarProps = {
  search: string
  onSearchChange: (value: string) => void
  runningJobs: number
  completedJobs: number
  onCreateClick: () => void
}

export function Topbar({
  search,
  onSearchChange,
  runningJobs,
  completedJobs,
  onCreateClick
}: TopbarProps) {
  return (
    <header className="topbar">
      <input
        className="search-input"
        placeholder="Search downloads..."
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div className="topbar-actions">
        <span className="muted">
          {runningJobs} active • {completedJobs} done
        </span>
        <button type="button" className="button button-primary" onClick={onCreateClick}>
          + New Download
        </button>
      </div>
    </header>
  )
}
