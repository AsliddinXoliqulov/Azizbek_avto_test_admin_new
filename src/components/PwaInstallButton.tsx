import { useEffect, useState } from 'react'
import { useSiteLanguage } from '../lib/siteLanguage'
import {
  consumePwaInstallPrompt,
  isPwaInstalled,
  markPwaInstalled,
  subscribeToPwaInstall,
} from '../lib/pwaInstall'

function isAppleMobile() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export default function PwaInstallButton({
  variant = 'header',
}: {
  variant?: 'header' | 'login'
}) {
  const { t } = useSiteLanguage()
  const [installed, setInstalled] = useState(() => isPwaInstalled())
  const [help, setHelp] = useState('')

  useEffect(() => {
    const syncState = () => {
      setInstalled(isPwaInstalled())
      if (isPwaInstalled()) setHelp('')
    }
    syncState()
    return subscribeToPwaInstall(syncState)
  }, [])

  async function install() {
    setHelp('')
    const prompt = consumePwaInstallPrompt()
    if (!prompt) {
      setHelp(
        isAppleMobile()
          ? 'iPhone’da Safari’da oching, “Ulashish” tugmasini bosing va “Bosh ekranga qo‘shish”ni tanlang.'
          : 'Brauzeringiz menyusidan “Ilovani o‘rnatish” yoki “Bosh ekranga qo‘shish”ni tanlang. Bu band bo‘lmasa, saytni PWA o‘rnatishni qo‘llaydigan brauzerda oching.'
      )
      return
    }
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') markPwaInstalled()
    } catch (error) {
      console.error('PWA ilovasini o‘rnatib bo‘lmadi:', error)
      setHelp('Ilovani o‘rnatib bo‘lmadi. Brauzer menyusidan qayta urinib ko‘ring.')
    }
  }

  if (installed) return null

  return (
    <span className={`pwa-install-wrap pwa-install-wrap-${variant}`}>
      <button
        type="button"
        className={`pwa-install-button pwa-install-button-${variant}`}
        onClick={() => void install()}
        aria-label={t('Ilovani o‘rnatish')}
        title={t('Ilovani o‘rnatish')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3" />
        </svg>
        <span>{t('Ilovani o‘rnatish')}</span>
      </button>
      {help && (
        <span className="pwa-install-help" role="status">
          {t(help)}
        </span>
      )}
    </span>
  )
}
