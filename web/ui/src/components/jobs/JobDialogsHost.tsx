import type { Job, NodeItem } from '../../types'
import { EditUrlDialog, MoveDialog, SpeedDialog } from './JobDialogs'

type Props = {
  dialog: { kind: 'url' | 'move' | 'speed'; job: Job } | null
  nodes: NodeItem[]
  onClose: () => void
  onDone: () => Promise<void>
}

export function JobDialogsHost({ dialog, nodes, onClose, onDone }: Props) {
  if (!dialog) return null
  if (dialog.kind === 'url') return <EditUrlDialog job={dialog.job} onClose={onClose} onDone={onDone} />
  if (dialog.kind === 'speed') return <SpeedDialog job={dialog.job} onClose={onClose} onDone={onDone} />
  return <MoveDialog job={dialog.job} nodes={nodes} onClose={onClose} onDone={onDone} />
}
