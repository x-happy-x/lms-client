import { useState } from 'react'

const MB = 1024 * 1024
const PRESETS = [1, 5, 10, 25, 50]

export function formatLimit(bytes?: number | null): string {
  if (!bytes) return 'без ограничения'
  const mb = bytes / MB
  return `${mb >= 10 || Number.isInteger(mb) ? Math.round(mb) : mb.toFixed(1)} МБ/с`
}

/** Speed limit in bytes/s; null = unlimited. Presets plus a custom value in MB/s. */
export function SpeedLimitPicker({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const isPreset = value === null || PRESETS.some((mb) => mb * MB === value)
  const [custom, setCustom] = useState(isPreset || value === null ? '' : String(+(value / MB).toFixed(2)))

  return (
    <div className="speed-picker">
      <div className="segmented wrap">
        <button type="button" className={value === null ? 'active' : ''} onClick={() => onChange(null)}>
          Без ограничения
        </button>
        {PRESETS.map((mb) => (
          <button key={mb} type="button" className={value === mb * MB ? 'active' : ''} onClick={() => onChange(mb * MB)}>
            {mb} МБ/с
          </button>
        ))}
      </div>
      <label className="speed-custom">
        <span className="muted small">Своё значение</span>
        <input
          type="number"
          min="0.1"
          step="0.1"
          inputMode="decimal"
          value={custom}
          placeholder="МБ/с"
          onChange={(event) => {
            setCustom(event.target.value)
            const mb = Number.parseFloat(event.target.value.replace(',', '.'))
            onChange(Number.isFinite(mb) && mb > 0 ? Math.round(mb * MB) : null)
          }}
        />
        <span className="muted small">МБ/с</span>
      </label>
    </div>
  )
}
