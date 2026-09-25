import type { Job, NodeItem } from '../../types'
import { EditUrlDialog, MoveDialog } from './JobDialogs'

type Props = {
  dialog: { kind: 'url' | 'move'; job: Job } | null
  nodes: NodeItem[]
  onClose: () => void
  onDone: () => Promise<void>
}

export function JobDialogsHost({ dialog, nodes, onClose, onDone }: Props) {
  if (!dialog) return null
  if (dialog.kind === 'url') return <EditUrlDialog job={dialog.job} onClose={onClose} onDone={onDone} />
  return <MoveDialog job={dialog.job} nodes={nodes} onClose={onClose} onDone={onDone} />
}
