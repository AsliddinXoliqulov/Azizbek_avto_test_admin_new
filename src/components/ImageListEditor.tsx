import { useEffect, useState } from 'react'
import { cleanOsonPravaWatermark } from '../lib/cleanOsonPravaWatermark'
import { useSiteLanguage } from '../lib/siteLanguage'

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
  const { t } = useSiteLanguage()
  const [url, setUrl] = useState('')
  const [processing, setProcessing] = useState(false)
  const [processingError, setProcessingError] = useState('')
  const [expandedImage, setExpandedImage] = useState<{
    src: string
    name: string
  } | null>(null)
  const canAddImage = maxImages == null || images.length < maxImages

  useEffect(() => {
    if (!expandedImage) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedImage(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [expandedImage])

  async function uploadFiles(files: File[]) {
    setProcessing(true)
    setProcessingError('')
    try {
      const uploadFiles: File[] = []
      for (const file of files) {
        uploadFiles.push(await cleanOsonPravaWatermark(file))
      }
      await onUpload(uploadFiles)
    } catch (reason) {
      setProcessingError(
        t(reason instanceof Error ? reason.message : 'Rasmni qayta ishlab bo‘lmadi.')
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
      <span>{t(label)}</span>
      {processing && <small className="field-hint">{t('Rasm tekshirilmoqda…')}</small>}
      {processingError && <small className="field-hint image-processing-error">{t(processingError)}</small>}
      {images.length > 0 && (
        <div className={`image-list${maxImages === 1 ? ' image-list-single' : ''}`}>
          {images.map((image, index) => {
            const name = image.split('/').pop()?.split('?')[0] || image
            return (
              <div
                className={`image-preview${maxImages === 1 ? ' image-preview-single' : ''}`}
                key={`${image}-${index}`}
              >
                {maxImages === 1 ? (
                  <>
                    <button
                      type="button"
                      className="image-remove"
                      aria-label={`${t('Rasmni olib tashlash')}: ${name}`}
                      title={t('Rasmni olib tashlash')}
                      onClick={() =>
                        onChange(
                          images.filter((_, imageIndex) => imageIndex !== index)
                        )
                      }
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      className="image-preview-expand"
                      onClick={() => setExpandedImage({ src: image, name })}
                      aria-label={t('Rasmni kattalashtirish')}
                      title={t('Rasmni kattalashtirish')}
                    >
                      <img src={image} alt={name} />
                    </button>
                    <span className="image-preview-name" title={name}>
                      {name}
                    </span>
                  </>
                ) : (
                  <>
                    <img src={image} alt={name} title={name} />
                    <button
                      type="button"
                      className="image-remove"
                      aria-label={`${t('Rasmni olib tashlash')}: ${name}`}
                      title={t('Rasmni olib tashlash')}
                      onClick={() =>
                        onChange(
                          images.filter((_, imageIndex) => imageIndex !== index)
                        )
                      }
                    >
                      ×
                    </button>
                    <small title={name}>{name}</small>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canAddImage && (
        <>
          <input
            className="file-input"
            type="file"
            accept="image/*"
            multiple={maxImages == null || maxImages > 1}
            disabled={busy || processing}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files || [])
                .slice(0, maxImages == null ? undefined : maxImages - images.length)
              event.currentTarget.value = ''
              if (files.length) void uploadFiles(files)
            }}
          />
          <div className="image-url-row">
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('Rasm URL manzili')}
            />
            <button type="button" className="button button-quiet button-small" onClick={addUrl} disabled={!url.trim()}>
              {t('URL qo‘shish')}
            </button>
          </div>
        </>
      )}
      {expandedImage && (
        <div
          className="image-lightbox"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpandedImage(null)
          }}
        >
          <button
            type="button"
            className="image-lightbox-close"
            onClick={() => setExpandedImage(null)}
            aria-label={t('Yopish')}
          >
            ×
          </button>
          <img src={expandedImage.src} alt={expandedImage.name} />
        </div>
      )}
    </div>
  )
}
