import type { FormEvent } from 'react'
import type { UrlEditFormState } from './types'

type JobUrlEditFormProps = {
  value: UrlEditFormState
  onChange: (state: UrlEditFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}

export function JobUrlEditForm({ value, onChange, onSubmit, onCancel }: JobUrlEditFormProps) {
  return (
    <form className="inline-form" onSubmit={onSubmit}>
      <label className="wide">
        URL
        <input
          value={value.url}
          onChange={(event) => onChange({ ...value, url: event.target.value })}
          placeholder="https://example.com/file.bin"
        />
      </label>
      <button type="submit" className="button button-primary">
        Update link
      </button>
      <button type="button" className="button button-ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}
