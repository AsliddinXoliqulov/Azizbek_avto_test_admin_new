import type { FormEvent, ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
  submitLabel?: string
  busy?: boolean
}

export function Modal({ title, onClose, onSubmit, children, submitLabel = 'Saqlash', busy = false }: ModalProps) {
  const content = (
    <>
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Yopish">×</button>
      </div>
      <div className="modal-body">{children}</div>
      {onSubmit && (
        <div className="modal-footer">
          <button className="button button-quiet" type="button" onClick={onClose}>Bekor qilish</button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Saqlanmoqda…' : submitLabel}
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      {onSubmit
        ? <form className="modal" onSubmit={onSubmit}>{content}</form>
        : <section className="modal">{content}</section>}
    </div>
  )
}
