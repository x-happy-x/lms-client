import { useState, type FormEvent } from 'react'
import { api, type ProfilePayload } from '../../api'
import { typeLabel } from '../../lib/format'
import type { Profile } from '../../types'
import { Icon } from '../../ui/Icon'

const TYPES = ['DIRECT', 'YTDLP', 'ARIA2C', 'TORRENT']

export function ProfilesPage({ profiles, onRefresh }: { profiles: Profile[]; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState<ProfilePayload>({ name: '', type: 'YTDLP', enabled: true, outputTemplate: '', extraArgsJson: '' })
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await api.createProfile({
        ...form,
        outputTemplate: form.outputTemplate?.trim() || undefined,
        extraArgsJson: form.extraArgsJson?.trim() || undefined
      })
      setForm({ ...form, name: '', outputTemplate: '', extraArgsJson: '' })
      setError('')
      await onRefresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="page split">
      <section className="card">
        <h3>Новый профиль</h3>
        <p className="muted small">Профиль — именованный набор настроек, который можно выбрать при добавлении загрузки.</p>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Название</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Видео 1080p" />
          </label>
          <label className="field">
            <span>Способ загрузки</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Шаблон имени (необязательно)</span>
            <input value={form.outputTemplate} onChange={(e) => setForm({ ...form, outputTemplate: e.target.value })} placeholder="%(title)s.%(ext)s" />
          </label>
          <label className="field">
            <span>Доп. аргументы, JSON (необязательно)</span>
            <input value={form.extraArgsJson} onChange={(e) => setForm({ ...form, extraArgsJson: e.target.value })} placeholder='["-f","bv*[height<=1080]+ba"]' />
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>Включён</span>
          </label>
          {error ? <div className="alert error">{error}</div> : null}
          <div className="form-actions">
            <button type="submit" className="btn primary"><Icon name="plus" size={18} /> Создать</button>
          </div>
        </form>
      </section>
      <section className="stack">
        {profiles.length === 0 ? <div className="empty small"><Icon name="profile" size={32} /><p className="muted">Профилей пока нет.</p></div> : null}
        {profiles.map((profile) => (
          <article key={profile.id} className="card compact">
            <header className="card-head">
              <Icon name="profile" />
              <div className="card-title">
                <strong>{profile.name}</strong>
                <span className="muted small">{typeLabel(profile.type)}{profile.enabled ? '' : ' · выключен'}</span>
              </div>
            </header>
            {profile.outputTemplate ? <p className="mono small">{profile.outputTemplate}</p> : null}
            {profile.extraArgsJson ? <p className="mono small">{profile.extraArgsJson}</p> : null}
          </article>
        ))}
      </section>
    </div>
  )
}
