import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface NoticeProps {
  message: string
  kind?: 'error' | 'success' | 'info'
  onClose?: () => void
}

const ToastTargetContext = createContext<HTMLDivElement | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return (
    <ToastTargetContext.Provider value={target}>
      <div className="toast-container" ref={setTarget} aria-live="polite" aria-relevant="additions text" />
      {children}
    </ToastTargetContext.Provider>
  )
}

export function Notice({ message, kind = 'error', onClose }: NoticeProps) {
  const toastTarget = useContext(ToastTargetContext)

  useEffect(() => {
    if (!onClose) return
    const timeout = window.setTimeout(onClose, kind === 'error' ? 8000 : 5000)
    return () => window.clearTimeout(timeout)
  }, [message, kind, onClose])

  const notice = (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onClose && <button className="notice-close" type="button" onClick={onClose} aria-label="Yopish">×</button>}
    </div>
  )

  if (!onClose) return notice
  if (!toastTarget) return null
  return createPortal(<div className="toast-item">{notice}</div>, toastTarget)
}
