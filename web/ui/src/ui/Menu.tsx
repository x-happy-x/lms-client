import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type MenuItem = {
  label: string
  icon?: IconName
  onSelect?: () => void
  href?: string
  download?: boolean
  danger?: boolean
  hidden?: boolean
}

/** Button with a dropdown of actions; closes on outside click and Escape. */
export function Menu({ items, label = 'Ещё', trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = items.filter((item) => !item.hidden)
  if (visible.length === 0) return null

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger ?? <Icon name="more" />}
      </button>
      {open ? (
        <div className="menu-list" role="menu">
          {visible.map((item) =>
            item.href ? (
              <a
                key={item.label}
                role="menuitem"
                className={`menu-item${item.danger ? ' danger' : ''}`}
                href={item.href}
                download={item.download ? '' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.icon ? <Icon name={item.icon} size={18} /> : null}
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu-item${item.danger ? ' danger' : ''}`}
                onClick={() => {
                  setOpen(false)
                  item.onSelect?.()
                }}
              >
                {item.icon ? <Icon name={item.icon} size={18} /> : null}
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}
