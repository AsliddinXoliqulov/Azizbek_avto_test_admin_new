import { useState } from 'react'
import type { UzbekTranslations } from '../lib/translation'
import { translateUzbekLatin } from '../lib/translation'
import { useSiteLanguage } from '../lib/siteLanguage'

export function TranslateButton({ sourceText, onTranslated }: {
  sourceText: string
  onTranslated: (translations: UzbekTranslations) => void
}) {
  const { t } = useSiteLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function translate() {
    setBusy(true)
    setError('')
    try {
      const translations = await translateUzbekLatin(sourceText)
      onTranslated(translations)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="translation-control">
      <button
        className="translation-button"
        type="button"
        onClick={() => void translate()}
        disabled={busy || !sourceText.trim()}
        title={t('O‘zbekcha matndan kirill va rus tiliga tarjima qilish. Ruscha tarjima MyMemory servisiga yuboriladi.')}
        aria-label={t('Kirill va rus tiliga avtomatik tarjima')}
      >
        <span aria-hidden="true">{busy ? '…' : '文A'}</span>
        <span>{t(busy ? 'Tarjima qilinmoqda…' : 'Qolgan tillarni to‘ldirish')}</span>
      </button>
      {error && <span className="translation-error" role="alert">{t(error)}</span>}
    </span>
  )
}
