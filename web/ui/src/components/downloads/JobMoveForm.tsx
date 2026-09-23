import type { FormEvent } from 'react'
import type { NodeItem } from '../../types'
import type { MoveFormState } from './types'

type JobMoveFormProps = {
  value: MoveFormState
  nodes: NodeItem[]
  onChange: (state: MoveFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}

export function JobMoveForm({ value, nodes, onChange, onSubmit, onCancel }: JobMoveFormProps) {
  return (
    <form className="inline-form" onSubmit={onSubmit}>
      <label>
        Node
        <select value={value.targetNodeId} onChange={(event) => onChange({ ...value, targetNodeId: event.target.value })}>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Path
        <input
          value={value.storagePath}
          onChange={(event) => onChange({ ...value, storagePath: event.target.value })}
          placeholder="/downloads/models"
        />
      </label>
      <button type="submit" className="button button-primary">
        Apply
      </button>
      <button type="button" className="button button-ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}
