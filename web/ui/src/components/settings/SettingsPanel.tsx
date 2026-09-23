import type { IconRule } from '../../types'

type SettingsPanelProps = {
  rules: IconRule[]
  onRuleChange: (id: string, patch: Partial<IconRule>) => void
  onAddRule: () => void
  onDeleteRule: (id: string) => void
  onResetDefaults: () => void
}

export function SettingsPanel({
  rules,
  onRuleChange,
  onAddRule,
  onDeleteRule,
  onResetDefaults
}: SettingsPanelProps) {
  return (
    <section className="panel settings-panel">
      <div className="panel-head">
        <h2>File Icon Rules</h2>
        <div className="form-actions">
          <button type="button" className="button button-ghost" onClick={onResetDefaults}>
            Defaults
          </button>
          <button type="button" className="button button-primary" onClick={onAddRule}>
            Add Rule
          </button>
        </div>
      </div>

      <div className="muted">
        Regex is tested against filename and URL. First matched enabled rule is used.
      </div>

      <div className="settings-rules">
        {rules.map((rule) => (
          <article key={rule.id} className="settings-rule">
            <label>
              Icon
              <input
                value={rule.icon}
                maxLength={4}
                onChange={(event) => onRuleChange(rule.id, { icon: event.target.value })}
              />
            </label>
            <label>
              Label
              <input
                value={rule.label}
                onChange={(event) => onRuleChange(rule.id, { label: event.target.value })}
              />
            </label>
            <label className="wide">
              Regex
              <input
                value={rule.pattern}
                onChange={(event) => onRuleChange(rule.id, { pattern: event.target.value })}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => onRuleChange(rule.id, { enabled: event.target.checked })}
              />
              Enabled
            </label>
            <button type="button" className="button" onClick={() => onDeleteRule(rule.id)}>
              Delete
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
