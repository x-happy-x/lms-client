import type { ThemeMode } from '../../types'
import { Icon, type IconName } from '../../ui/Icon'

const THEMES: Array<{ value: ThemeMode; label: string; icon: IconName }> = [
  { value: 'system', label: 'Как в системе', icon: 'monitor' },
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' }
]

export function SettingsPage({ theme, onTheme, version, health }: { theme: ThemeMode; onTheme: (theme: ThemeMode) => void; version: string; health: string }) {
  return (
    <div className="page narrow">
      <section className="card">
        <h3>Оформление</h3>
        <div className="segmented wrap">
          {THEMES.map((item) => (
            <button key={item.value} type="button" className={theme === item.value ? 'active' : ''} onClick={() => onTheme(item.value)}>
              <Icon name={item.icon} size={18} /> {item.label}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>О роутере</h3>
        <dl className="facts">
          <div><dt>Версия</dt><dd>{version}</dd></div>
          <div><dt>Состояние API</dt><dd>{health === 'ok' || health === 'UP' ? 'работает' : health}</dd></div>
        </dl>
        <p className="muted small">
          Готовые файлы скачиваются с ноды через роутер: ничего не хранится на роутере, а скорость в локальной сети
          ограничена только каналом до ноды. Фото и видео открываются прямо в браузере.
        </p>
      </section>
    </div>
  )
}
