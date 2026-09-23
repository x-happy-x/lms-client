import type { ReactNode } from 'react'

type BadgeTone = 'good' | 'bad' | 'muted' | 'queued' | 'live'

type BadgeProps = {
  tone?: BadgeTone
  children: ReactNode
}

export function Badge({ tone = 'muted', children }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
