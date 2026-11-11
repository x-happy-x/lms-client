import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

type DialogProps = {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}

export function Dialog({ title, subtitle, onClose, children, footer, size = 'md' }: DialogProps) {
  const section = useRef<HTMLElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = returnFocus.current
    const focusable = () => [...(section.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0 && !element.matches(':disabled'))
    if (!section.current?.contains(document.activeElement)) (section.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])') ?? focusable()[0] ?? section.current)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusable(), first = elements[0], last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); section.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !section.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !section.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <div className="backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={section}
        tabIndex={-1}
        className={`dialog dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-foot">{footer}</footer> : null}
      </section>
    </div>
  )
}
