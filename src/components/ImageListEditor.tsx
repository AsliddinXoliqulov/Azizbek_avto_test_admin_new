import { useState } from 'react'
import { cleanOsonPravaWatermark } from '../lib/cleanOsonPravaWatermark'

export function ImageListEditor({
  label,
  images,
  busy,
  onChange,
  onUpload,
  maxImages,
}: {
  label: string
  images: string[]
  busy: boolean
  onChange: (images: string[]) => void
  onUpload: (files: File[]) => Promise<void>
  maxImages?: number
}) {
  const [url, setUrl] = useState('')
  const [cleanWatermark, setCleanWatermark] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [processingError, setProcessingError] = useState('')
  const canAddImage = maxImages == null || images.length < maxImages

  async function uploadFiles(files: File[]) {
    setProcessing(true)
    setProcessingError('')
    try {
      const uploadFiles: File[] = []
      for (const file of files) {
        uploadFiles.push(cleanWatermark ? await cleanOsonPravaWatermark(file) : file)
      }
      await onUpload(uploadFiles)
    } catch (reason) {
      setProcessingError(
        reason instanceof Error ? reason.message : 'Rasmni qayta ishlab bo‘lmadi.'
      )
    } finally {
      setProcessing(false)
    }
  }

  function pasteImage(event: React.ClipboardEvent<HTMLDivElement>) {
    if (busy || processing || !canAddImage) return
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item, index) => {
        const blob = item.getAsFile()
        if (!blob) return null
        const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
        return new File([blob], `clipboard-image-${Date.now()}-${index}.${extension}`, {
          type: blob.type,
        })
      })
      .filter((file): file is File => file !== null)
      .slice(0, maxImages == null ? undefined : maxImages - images.length)
    if (!files.length) return
    event.preventDefault()
    void uploadFiles(files)
  }

  function addUrl() {
    const value = url.trim()
    if (!value || !canAddImage) return
    onChange([...images, value])
    setUrl('')
  }

  return (
    <div className="field image-list-editor" onPaste={pasteImage} tabIndex={0}>
      <span>{label}</span>
      <small className="field-hint">Rasmni clipboard’ga nusxa oling va shu yerda Ctrl+V bosing.</small>
      <label className="image-watermark-toggle">
        <input
          type="checkbox"
          checked={cleanWatermark}
          disabled={busy || processing}
          onChange={(event) => setCleanWatermark(event.currentTarget.checked)}
        />
        <span>Pastki o‘ngdagi OsonPrava belgisini tozalash</span>
      </label>
      <small className="field-hint">
        Markazdagi watermark o‘zgartirilmaydi. Faqat tanlangan rasmga qo‘llanadi.
      </small>
      {processing && <small className="field-hint">Rasm tekshirilmoqda…</small>}
      {processingError && <small className="field-hint image-processing-error">{processingError}</small>}
      {images.length > 0 && (
        <div className="image-list">
          {images.map((image, index) => {
            const name = image.split('/').pop()?.split('?')[0] || image
            return (
              <div className="image-preview" key={`${image}-${index}`}>
                <img src={image} alt={name} title={name} />
                <button
                  type="button"
                  className="image-remove"
                  aria-label={`Rasmni olib tashlash: ${name}`}
                  title="Rasmni olib tashlash"
                  onClick={() => onChange(images.filter((_, imageIndex) => imageIndex !== index))}
                >
                  ×
                </button>
                <small title={name}>{name}</small>
              </div>
            )
          })}
        </div>
      )}
      {!canAddImage && <small className="field-hint">Yangi rasm qo‘shish uchun avval mavjud rasmni olib tashlang.</small>}
      <input
        className="file-input"
        type="file"
        accept="image/*"
        multiple={maxImages == null || maxImages > 1}
        disabled={busy || processing || !canAddImage}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || [])
            .slice(0, maxImages == null ? undefined : maxImages - images.length)
          event.currentTarget.value = ''
          if (files.length && canAddImage) void uploadFiles(files)
        }}
      />
      <div className="image-url-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Rasm URL manzili"
          disabled={!canAddImage}
        />
        <button type="button" className="button button-quiet button-small" onClick={addUrl} disabled={!url.trim() || !canAddImage}>
          URL qo‘shish
        </button>
      </div>
    </div>
  )
}
