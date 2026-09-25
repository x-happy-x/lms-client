import { useEffect, type ReactNode } from 'react'
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  return (
    <div className="backdrop" role="presentation" onMouseDown={onClose}>
      <section
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
