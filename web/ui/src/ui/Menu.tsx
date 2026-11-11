import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>({ position: 'fixed' })
  useLayoutEffect(() => {
    if (!open || !ref.current || !popup.current) return
    const anchor = ref.current.getBoundingClientRect(), box = popup.current.getBoundingClientRect()
    const height = Math.min(box.height, window.innerHeight - 16)
    setPosition({ position: 'fixed', left: Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8)), top: anchor.bottom + 6 + height <= window.innerHeight - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6), maxHeight: window.innerHeight - 16, overflowY: 'auto' })
    popup.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !popup.current?.contains(document.activeElement)) return
      event.preventDefault()
      const entries = [...popup.current.querySelectorAll<HTMLElement>('[role="menuitem"]')], at = entries.indexOf(document.activeElement as HTMLElement)
      entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus()
    }
    const onScroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
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
        <div className="menu-list" role="menu" ref={popup} style={position}>
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
                  ref.current?.querySelector('button')?.focus()
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
