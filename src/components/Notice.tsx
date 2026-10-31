interface NoticeProps {
  message: string
  kind?: 'error' | 'success' | 'info'
  onClose?: () => void
}

export function Notice({ message, kind = 'error', onClose }: NoticeProps) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onClose && <button className="notice-close" type="button" onClick={onClose} aria-label="Yopish">×</button>}
    </div>
  )
}
