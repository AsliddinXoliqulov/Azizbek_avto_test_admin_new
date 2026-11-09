import { useEffect } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useSiteLanguage } from '../lib/siteLanguage'

interface ModalProps {
  title: string
  onClose: () => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
  submitLabel?: string
  busy?: boolean
  submitDisabled?: boolean
  className?: string
}

export function Modal({
  title,
  onClose,
  onSubmit,
  children,
  submitLabel = 'Saqlash',
  busy = false,
  submitDisabled = false,
  className,
}: ModalProps) {
  const { t } = useSiteLanguage()
  const modalClassName = className ? `modal ${className}` : 'modal'

  useEffect(() => {
    const body = document.body
    const root = document.documentElement
    const previousBodyOverflow = body.style.overflow
    const previousRootOverflow = root.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - root.clientWidth

    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      body.style.overflow = previousBodyOverflow
      root.style.overflow = previousRootOverflow
      body.style.paddingRight = previousBodyPaddingRight
    }
  }, [])

  const content = (
    <>
      <div className="modal-header">
        <h2>{t(title)}</h2>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label={t('Yopish')}
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {onSubmit && (
        <div className="modal-footer">
          <button
            className="button button-quiet"
            type="button"
            onClick={onClose}
          >
            {t('Bekor qilish')}
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || submitDisabled}
          >
            {t(busy ? 'Saqlanmoqda…' : submitLabel)}
          </button>
        </div>
      )}
    </>
  )

  return (
    <div
      className={`modal-backdrop${className ? ` ${className}-backdrop` : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {onSubmit
        ? (
          <form className={modalClassName} onSubmit={onSubmit}>
            {content}
          </form>
        )
        : (
          <section className={modalClassName}>
            {content}
          </section>
        )}
    </div>
  )
}
