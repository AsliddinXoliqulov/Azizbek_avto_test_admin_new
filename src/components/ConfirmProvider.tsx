import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSiteLanguage } from '../lib/siteLanguage'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmAction | null>(null)

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('Tasdiqlash oynasi topilmadi.')
  return confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useSiteLanguage()
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const finish = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed)
    resolveRef.current = null
    setDialog(null)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setDialog(options)
  }), [])

  useEffect(() => {
    if (!dialog) return undefined
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') finish(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dialog, finish])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="confirm-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) finish(false)
        }}>
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
          >
            <div className={`confirm-icon${dialog.danger ? ' danger' : ''}`} aria-hidden="true">
              {dialog.danger ? '!' : '?'}
            </div>
            <div className="confirm-copy">
              <h2 id="confirm-title">{t(dialog.title)}</h2>
              <p id="confirm-message">{t(dialog.message)}</p>
            </div>
            <div className="confirm-actions">
              <button className="button button-quiet" type="button" onClick={() => finish(false)}>
                {t(dialog.cancelLabel || 'Bekor qilish')}
              </button>
              <button
                autoFocus
                className={`button ${dialog.danger ? 'button-danger' : 'button-primary'}`}
                type="button"
                onClick={() => finish(true)}
              >
                {t(dialog.confirmLabel || 'Tasdiqlash')}
              </button>
            </div>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
