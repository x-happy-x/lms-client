type NodeFormState = {
  name: string
  baseUrl: string
  clientId: string
  secret: string
  enabled: boolean
}

type NodeFormFieldsProps = {
  value: NodeFormState
  onChange: (next: NodeFormState) => void
  secretLabel: string
  secretPlaceholder?: string
}

export function NodeFormFields({
  value,
  onChange,
  secretLabel,
  secretPlaceholder
}: NodeFormFieldsProps) {
  return (
    <>
      <label>
        Name
        <input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          required
        />
      </label>
      <label>
        Base URL
        <input
          value={value.baseUrl}
          onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
          required
        />
      </label>
      <label>
        Client ID (HMAC key id)
        <input
          value={value.clientId}
          onChange={(event) => onChange({ ...value, clientId: event.target.value })}
          required
        />
      </label>
      <label>
        {secretLabel}
        <input
          placeholder={secretPlaceholder}
          value={value.secret}
          onChange={(event) => onChange({ ...value, secret: event.target.value })}
          required={!secretPlaceholder}
        />
      </label>
      <label className="checkbox-row wide">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        Enabled
      </label>
    </>
  )
}
