import { useState } from 'react'

export function ImageListEditor({
  label,
  images,
  busy,
  onChange,
  onUpload,
}: {
  label: string
  images: string[]
  busy: boolean
  onChange: (images: string[]) => void
  onUpload: (files: File[]) => Promise<void>
}) {
  const [url, setUrl] = useState('')

  function addUrl() {
    const value = url.trim()
    if (!value) return
    onChange([...images, value])
    setUrl('')
  }

  return (
    <div className="field image-list-editor">
      <span>{label}</span>
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
      <input
        className="file-input"
        type="file"
        accept="image/*"
        multiple
        disabled={busy}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || [])
          event.currentTarget.value = ''
          if (files.length) void onUpload(files)
        }}
      />
      <div className="image-url-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Rasm URL manzili"
        />
        <button type="button" className="button button-quiet button-small" onClick={addUrl} disabled={!url.trim()}>
          URL qo‘shish
        </button>
      </div>
    </div>
  )
}
