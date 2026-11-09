import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader, useAdmin } from '../App'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/types'

const FALLBACK_IMAGE_SETTING = 'no_question_image_url'
const MAX_FALLBACK_IMAGE_SIZE = 12 * 1024 * 1024
const FALLBACK_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default function Account() {
  const { profile, uiScale, setUiScale } = useAdmin()
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => window.matchMedia('(max-width: 800px)').matches)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fallbackImageUrl, setFallbackImageUrl] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [imageLoading, setImageLoading] = useState(true)
  const [imageBusy, setImageBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canManageFallbackImage = profile.role === 'SUPER_ADMIN'
  const scaleValue = isNarrowScreen ? Math.min(uiScale, 38) : uiScale
  const scaleMax = isNarrowScreen ? 38 : 100

  useEffect(() => {
    let active = true
    async function loadFallbackImage() {
      try {
        const { data, error: loadError } = await requireSupabase()
          .from('app_settings')
          .select('value')
          .eq('key', FALLBACK_IMAGE_SETTING)
          .maybeSingle()
        if (loadError) throw loadError
        if (active) setFallbackImageUrl(typeof data?.value === 'string' ? data.value : '')
      } catch (reason) {
        if (active) setError(getErrorMessage(reason))
      } finally {
        if (active) setImageLoading(false)
      }
    }
    void loadFallbackImage()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 800px)')
    const updateScreenSize = () => setIsNarrowScreen(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateScreenSize)
    return () => mediaQuery.removeEventListener('change', updateScreenSize)
  }, [])

  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(selectedImage)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedImage])

  function start() {
    setBusy(true)
    setError('')
    setSuccess('')
  }

  function finish() {
    setBusy(false)
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) {
      setError('Yangi parol kamida 8 ta belgidan iborat bo‘lsin.')
      return
    }
    if (password !== confirmPassword) {
      setError('Parol va tasdiqlash paroli mos kelmadi.')
      return
    }
    start()
    try {
      const { error: updateError } = await requireSupabase().auth.updateUser({ password })
      if (updateError) throw updateError
      setPassword('')
      setConfirmPassword('')
      setSuccess('Parolingiz yangilandi. Eski parol talab qilinmadi.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      finish()
    }
  }

  function chooseFallbackImage(file: File | undefined) {
    setError('')
    setSuccess('')
    setSelectedImage(null)
    if (!file) {
      return
    }
    if (!FALLBACK_IMAGE_MIME_TYPES.has(file.type)) {
      setError('Faqat JPG, PNG yoki WebP formatidagi rasmni tanlang.')
      return
    }
    if (file.size > MAX_FALLBACK_IMAGE_SIZE) {
      setError('Rasm hajmi 12 MB dan oshmasligi kerak.')
      return
    }
    setSelectedImage(file)
  }

  async function saveFallbackImage() {
    if (!selectedImage) return
    setImageBusy(true)
    setError('')
    setSuccess('')
    try {
      const extensionByType: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }
      const client = requireSupabase()
      const storage = client.storage.from('pdd-images')
      const path = `app/no-question-image-${Date.now()}.${extensionByType[selectedImage.type]}`
      const { error: uploadError } = await storage.upload(path, selectedImage, {
        contentType: selectedImage.type,
        cacheControl: '3600',
      })
      if (uploadError) throw uploadError
      const url = storage.getPublicUrl(path).data.publicUrl
      const { error: settingError } = await client.from('app_settings').upsert(
        {
          key: FALLBACK_IMAGE_SETTING,
          value: url,
          description: 'Savol rasmi bo‘lmaganda ilovada ko‘rsatiladigan rasm',
        },
        { onConflict: 'key' }
      )
      if (settingError) throw settingError
      setFallbackImageUrl(url)
      setSelectedImage(null)
      setSuccess('Rasm saqlandi. Ilovada yangilanish sinxronlangach ko‘rinadi.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setImageBusy(false)
    }
  }

  async function clearFallbackImage() {
    setImageBusy(true)
    setError('')
    setSuccess('')
    try {
      const { error: settingError } = await requireSupabase()
        .from('app_settings')
        .upsert(
          {
            key: FALLBACK_IMAGE_SETTING,
            value: '',
            description: 'Savol rasmi bo‘lmaganda ilovada ko‘rsatiladigan rasm',
          },
          { onConflict: 'key' }
        )
      if (settingError) throw settingError
      setFallbackImageUrl('')
      setSelectedImage(null)
      setSuccess('Maxsus rasm olib tashlandi. Ilovada namuna.png ko‘rsatiladi.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setImageBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Akkaunt sozlamalari" description="Panelda ko‘rinadigan ism va parolni yangilang." />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <div className="account-layout">
        <div className="account-main">
          <section className="panel-card account-card">
            <div className="account-card-heading"><span className="account-icon violet-bg">⌑</span><div><h2>Yangi parol</h2><p>Joriy parol so‘ralmaydi; akkauntga kirgan bo‘lishingiz kifoya.</p></div></div>
            <form className="account-form" onSubmit={savePassword}>
              <div className="form-grid">
                <label className="field"><span>Yangi parol</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
                <label className="field"><span>Yangi parolni tasdiqlang</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required /></label>
              </div>
              <div className="account-submit"><button className="button button-primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Yangi parolni saqlash'}</button></div>
            </form>
          </section>
        </div>

        <aside className="account-side">
          <section className="panel-card account-card">
            <div className="card-heading account-side-heading"><h2>Rasmi yo‘q savollar uchun rasm</h2></div>
            <p className="account-fallback-description">
              Bitta rasm saqlanadi va faqat savolning o‘z rasmi bo‘lmaganda ishlatiladi.
              Savollarga alohida nusxa yozilmaydi.
            </p>
            <div className="account-fallback-preview">
              {previewUrl || fallbackImageUrl ? (
                <img
                  src={previewUrl || fallbackImageUrl}
                  alt="Rasmi yo‘q savollar uchun tanlangan rasm"
                />
              ) : (
                <span>{imageLoading ? 'Rasm yuklanmoqda…' : 'Hozir namuna.png ishlatiladi'}</span>
              )}
            </div>
            {canManageFallbackImage ? (
              <>
                <label className="field account-fallback-picker">
                  <span>Rasm tanlang (JPG, PNG yoki WebP; 12 MB gacha)</span>
                  <input
                    className="file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={imageBusy || imageLoading}
                    onChange={(event) => {
                      chooseFallbackImage(event.currentTarget.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <div className="account-fallback-actions">
                  {fallbackImageUrl && (
                    <button
                      className="button button-quiet"
                      type="button"
                      onClick={() => void clearFallbackImage()}
                      disabled={imageBusy || imageLoading}
                    >
                      Namuna rasmini tiklash
                    </button>
                  )}
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => void saveFallbackImage()}
                    disabled={imageBusy || imageLoading || !selectedImage}
                  >
                    {imageBusy ? 'Saqlanmoqda…' : 'Rasmni saqlash'}
                  </button>
                </div>
              </>
            ) : (
              <p className="field-hint">Bu rasmni faqat super admin o‘zgartira oladi.</p>
            )}
            <section className="ui-scale-card ui-scale-card-compact" aria-label="Interfeys o‘lchami">
              <div className="ui-scale-control">
                <button
                  className="ui-scale-step"
                  type="button"
                  aria-label="Interfeysni kichraytirish"
                  title="Kichraytirish"
                  disabled={scaleValue === 1}
                  onClick={() => setUiScale(Math.max(1, scaleValue - 1))}
                >−</button>
                <label className="ui-scale-slider-label">
                  <input
                    type="range"
                    min="1"
                    max={scaleMax}
                    step="1"
                    value={scaleValue}
                    aria-label="Interfeys o‘lchami"
                    aria-valuetext={`${scaleValue} / 100`}
                    onChange={(event) => setUiScale(Number(event.target.value))}
                  />
                </label>
                <button
                  className="ui-scale-step"
                  type="button"
                  aria-label="Interfeysni kattalashtirish"
                  title="Kattalashtirish"
                  disabled={scaleValue === scaleMax}
                  onClick={() => setUiScale(Math.min(scaleMax, scaleValue + 1))}
                >+</button>
              </div>
            </section>
          </section>
        </aside>
      </div>
    </>
  )
}
