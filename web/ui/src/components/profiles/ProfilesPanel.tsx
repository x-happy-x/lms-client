import type { FormEvent } from 'react'
import { Badge } from '../common/Badge'
import type { Profile } from '../../types'

type ProfileFormState = {
  name: string
  type: string
  enabled: boolean
}

type ProfilesPanelProps = {
  profiles: Profile[]
  form: ProfileFormState
  onFormChange: (next: ProfileFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function ProfilesPanel({ profiles, form, onFormChange, onSubmit }: ProfilesPanelProps) {
  return (
    <div className="split-grid">
      <section className="panel">
        <h2>Add profile</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(event) => onFormChange({ ...form, name: event.target.value })}
              required
            />
          </label>
          <label>
            Type
            <select value={form.type} onChange={(event) => onFormChange({ ...form, type: event.target.value })}>
              <option value="DIRECT">DIRECT</option>
              <option value="YTDLP">YTDLP</option>
              <option value="ARIA2C">ARIA2C</option>
            </select>
          </label>
          <label className="checkbox-row wide">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => onFormChange({ ...form, enabled: event.target.checked })}
            />
            Enabled
          </label>
          <div className="form-actions wide">
            <button type="submit" className="button button-primary">
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Profiles</h2>
        <div className="node-list">
          {profiles.map((profile) => (
            <article key={profile.id} className="node-card">
              <div className="node-head">
                <strong>{profile.name}</strong>
                <Badge tone={profile.enabled ? 'good' : 'muted'}>
                  {profile.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <div className="node-meta">
                <span>{profile.type}</span>
                <span>{profile.id}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
