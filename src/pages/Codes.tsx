import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import { useSiteLanguage } from '../lib/siteLanguage'
import type { ActivationToken } from '../lib/types'
import { getErrorMessage } from '../lib/types'

export default function Codes() {
  const confirm = useConfirm()
  const { t, language } = useSiteLanguage()

  const [tokens, setTokens] = useState<ActivationToken[]>([])
  const [platform, setPlatform] = useState<'desktop' | 'website'>('desktop')
  const [filter, setFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const website = platform === 'website'
      const { error: expireError } = await client.rpc(
        website ? 'expire_stale_web_activation_tokens' : 'expire_stale_tokens',
      )
      if (expireError) throw expireError
      let request = client.from(website ? 'web_activation_tokens' : 'activation_tokens')
        .select('id,code,note,status,created_at,expires_at,device_id,activated_at,created_by')
        .order('created_at', { ascending: false })
        .limit(200)
      if (filter) request = request.eq('status', filter)
      const { data, error: tokenError } = await request
      if (tokenError) throw tokenError
      setTokens((data || []) as ActivationToken[])
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [filter, platform])

  useEffect(() => { void load() }, [load])

  const selectedTokens = tokens.filter((token) => selectedIds.has(token.id))
  const revocableTokens = selectedTokens.filter((token) => ['PENDING', 'ACTIVATED'].includes(token.status))
  const revokedTokens = selectedTokens.filter((token) => token.status === 'REVOKED')

  function toggleToken(tokenId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(tokenId)
      else next.delete(tokenId)
      return next
    })
  }

  function toggleAllTokens(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const token of tokens) {
        if (checked) next.add(token.id)
        else next.delete(token.id)
      }
      return next
    })
  }

  async function bulkAction(action: 'revoke' | 'reactivate' | 'delete') {
    const targets = action === 'revoke' ? revocableTokens : revokedTokens
    if (!targets.length || bulkBusy) return

    const actionLabel = action === 'revoke'
      ? t('Bekor qilish')
      : action === 'reactivate'
        ? t('Qayta faollashtirish')
        : t('Butunlay o‘chirish')
    const confirmed = await confirm({
      title: actionLabel,
      message: t('Tanlangan {0} ta kod uchun “{1}” amalini bajarasizmi?')
        .replace('{0}', String(targets.length))
        .replace('{1}', actionLabel),
      confirmLabel: actionLabel,
      danger: action !== 'reactivate',
    })
    if (!confirmed) return

    setBulkBusy(true)
    setError('')
    setSuccess('')
    let completed = 0
    const failures: string[] = []
    const rpcName = action === 'revoke'
      ? platform === 'website' ? 'revoke_web_activation_code' : 'revoke_activation_code'
      : action === 'reactivate'
        ? platform === 'website' ? 'reactivate_revoked_web_activation_code' : 'reactivate_revoked_activation_code'
        : platform === 'website' ? 'delete_revoked_web_activation_code' : 'delete_revoked_activation_code'

    try {
      const client = requireSupabase()
      for (const token of targets) {
        const { error: rpcError } = await client.rpc(rpcName, { p_id: token.id })
        if (rpcError) failures.push(`${token.code}: ${getErrorMessage(rpcError)}`)
        else completed += 1
      }
      setSelectedIds(new Set())
      await load()
      if (completed) {
        setSuccess(t('{0} ta kodga “{1}” amali bajarildi.').replace('{0}', String(completed)).replace('{1}', actionLabel))
      }
      if (failures.length) {
        setError(t('{0} ta kodni o‘zgartirib bo‘lmadi: {1}')
          .replace('{0}', String(failures.length))
          .replace('{1}', failures.join('; ')))
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBulkBusy(false)
    }
  }

  async function copyCode(token: ActivationToken) {
    try {
      await navigator.clipboard.writeText(token.code)
      setCopiedTokenId(token.id)
      setSuccess(t('{0} kodi nusxalandi.').replace('{0}', token.code))
    } catch (reason) {
      setError(t('Kodni nusxalab bo‘lmadi: {0}').replace('{0}', getErrorMessage(reason)))
    }
  }

  async function revoke(token: ActivationToken) {
    const confirmed = await confirm({
      title: t('Aktivatsiya kodini bekor qilish'),
      message: platform === 'website'
        ? t('{0} kodini bekor qilasizmi? Bu kod bilan faollashtirilgan barcha qurilmalar bloklanadi.').replace('{0}', token.code)
        : t('{0} kodini bekor qilasizmi? Ulangan qurilma keyingi tekshiruvda bloklanadi.').replace('{0}', token.code),
      confirmLabel: t('Bekor qilish'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const { error: revokeError } = await requireSupabase().rpc(
        platform === 'website' ? 'revoke_web_activation_code' : 'revoke_activation_code',
        { p_id: token.id },
      )
      if (revokeError) throw revokeError
      setSuccess(t('{0} kodi bekor qilindi.').replace('{0}', token.code))
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function reactivate(token: ActivationToken) {
    const confirmed = await confirm({
      title: t('Kodni qayta faollashtirish'),
      message: platform === 'website'
        ? t('{0} kodini qayta faollashtirasizmi? U 15 kun davomida bir nechta qurilmada ishlaydi.')
          .replace('{0}', token.code)
        : token.device_id
          ? t('{0} kodini qayta faollashtirasizmi? Kod {1} davomida ochiladi va faqat avval ulangan qurilmada ishlaydi ({2}…).')
            .replace('{0}', token.code)
            .replace('{1}', t('1 soat'))
            .replace('{2}', token.device_id.slice(0, 10))
          : t('{0} kodini qayta faollashtirasizmi? Kod {1} davomida ochiladi; bu kod avval qurilmaga ulanmagan.')
            .replace('{0}', token.code)
            .replace('{1}', t('1 soat')),
      confirmLabel: t('Qayta faollashtirish'),
    })
    if (!confirmed) return
    try {
      const { error: rpcError } = await requireSupabase().rpc(
        platform === 'website' ? 'reactivate_revoked_web_activation_code' : 'reactivate_revoked_activation_code',
        { p_id: token.id },
      )
      if (rpcError) throw rpcError
      setSuccess(t('{0} kodi qayta faollashtirildi.').replace('{0}', token.code))
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function deleteInactive(token: ActivationToken) {
    const confirmed = await confirm({
      title: t('Kodni bazadan butunlay o‘chirish'),
      message: t('{0} kodi va unga tegishli yozuv bazadan butunlay o‘chadi. Bu amalni qaytarib bo‘lmaydi.').replace('{0}', token.code),
      confirmLabel: t('Butunlay o‘chirish'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const { error: rpcError } = await requireSupabase().rpc(
        platform === 'website' ? 'delete_revoked_web_activation_code' : 'delete_revoked_activation_code',
        { p_id: token.id },
      )
      if (rpcError) throw rpcError
      setSuccess(t('{0} kodi bazadan butunlay o‘chirildi.').replace('{0}', token.code))
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader
        title="Aktivatsiya kodlari"
        description="Desktop ilova va sayt uchun alohida aktivatsiya kodlarini yarating va boshqaring."
        action={
          <div className="page-action-group activation-code-actions">
            <button
              className="button button-primary"
              onClick={() => setShowCreate(true)}
            >
              {t('＋ Kod yaratish')}
            </button>
            <button
              className="button button-quiet"
              onClick={() => void load()}
              disabled={loading}
            >
              {t('↻ Yangilash')}
            </button>
          </div>
        }
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar">
          <div className="filter-tabs">
            <button className={platform === 'desktop' ? 'selected' : ''} onClick={() => { setPlatform('desktop'); setFilter(''); setSelectedIds(new Set()) }}>{t('Desktop ilova')}</button>
            <button className={platform === 'website' ? 'selected' : ''} onClick={() => { setPlatform('website'); setFilter(''); setSelectedIds(new Set()) }}>{t('Sayt')}</button>
          </div>
          <select
            className="filter-select"
            aria-label={t('Aktivatsiya kodlarini filtrlash')}
            value={filter}
            onChange={(event) => { setFilter(event.target.value); setSelectedIds(new Set()) }}
          >
            <option value="">{t('Barchasi')}</option>
            <option value="ACTIVATED">{statusLabel('ACTIVATED', t)}</option>
            <option value="REVOKED">{statusLabel('REVOKED', t)}</option>
          </select>
          {selectedTokens.length > 0 && (
            <details className="bulk-code-menu">
              <summary aria-label={t('Tanlangan kodlar amallari')} title={t('Amallar')}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="4" r="1.5" />
                  <circle cx="10" cy="10" r="1.5" />
                  <circle cx="10" cy="16" r="1.5" />
                </svg>
              </summary>
              <div className="bulk-code-menu-options">
                {revocableTokens.length > 0 && (
                  <button className="danger-text" disabled={bulkBusy} onClick={() => void bulkAction('revoke')}>
                    {t('Bekor qilish')} ({revocableTokens.length})
                  </button>
                )}
                {revokedTokens.length > 0 && (
                  <>
                    <button disabled={bulkBusy} onClick={() => void bulkAction('reactivate')}>
                      {t('Qayta faollashtirish')} ({revokedTokens.length})
                    </button>
                    <button className="danger-text" disabled={bulkBusy} onClick={() => void bulkAction('delete')}>
                      {t('Butunlay o‘chirish')} ({revokedTokens.length})
                    </button>
                  </>
                )}
              </div>
            </details>
          )}
        </div>
        <div className="table-scroll"><table><thead><tr>
          <th><input type="checkbox" aria-label={t('Barcha kodlarni tanlash')} checked={tokens.length > 0 && tokens.every((token) => selectedIds.has(token.id))} onChange={(event) => toggleAllTokens(event.target.checked)} /></th>
          <th>{t('KOD / IZOH')}</th><th>{t('HOLATI')}</th><th>{t('YARATILGAN')}</th><th>{t('MUDDATI')}</th><th>{t(platform === 'website' ? 'BIRINCHI QURILMA' : 'QURILMA')}</th><th className="align-right">{t('AMALLAR')}</th></tr></thead><tbody>
          {loading ? <tr><td className="table-state" colSpan={7}>{t('Kodlar yuklanmoqda…')}</td></tr>
            : tokens.length === 0 ? <tr><td className="table-state" colSpan={7}>{t('Kodlar topilmadi.')}</td></tr>
              : tokens.map((token) => <tr key={token.id}>
                <td><input type="checkbox" aria-label={t('{0} kodini tanlash').replace('{0}', token.code)} checked={selectedIds.has(token.id)} onChange={(event) => toggleToken(token.id, event.target.checked)} /></td>
                <td><div className="token-cell"><div className="token-code"><code>{token.code}</code><button className="icon-button" type="button" onClick={() => void copyCode(token)} title={t(copiedTokenId === token.id ? 'Nusxalandi' : 'Kodni nusxalash')} aria-label={t('{0} kodini nusxalash').replace('{0}', token.code)}>{copiedTokenId === token.id ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="2.5" width="8" height="10" rx="1.5" /><path d="M10.5 13.5v.2a1.3 1.3 0 0 1-1.3 1.3H3.3A1.3 1.3 0 0 1 2 13.7V6.3A1.3 1.3 0 0 1 3.3 5h.2" /></svg>}</button></div><small>{token.note || t('Izoh kiritilmagan')}</small></div></td>
                <td><span className={`badge ${token.status === 'ACTIVATED' ? 'badge-success' : token.status === 'PENDING' ? 'badge-warning' : 'badge-neutral'}`}><i />{statusLabel(token.status, t)}</span></td>
                <td>{formatDate(token.created_at, language)}</td><td>{formatDate(token.expires_at, language)}</td>
                <td><span className="device-id">{token.device_id ? `${token.device_id.slice(0, 10)}…` : '—'}</span></td>
                <td><div className="row-actions">
                  {token.status === 'REVOKED' && (
                    <button className="text-button" onClick={() => void reactivate(token)}>{t('Qayta faollashtirish')}</button>
                  )}
                  {token.status === 'REVOKED'
                    ? <button
                      className="icon-button danger-icon"
                      type="button"
                      title={t('Aktivatsiya kodini butunlay o‘chirish')}
                      aria-label={t('{0} kodini butunlay o‘chirish').replace('{0}', token.code)}
                      onClick={() => void deleteInactive(token)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" /></svg>
                    </button>
                    : ['PENDING', 'ACTIVATED'].includes(token.status) && (
                      <button className="text-button danger-text" onClick={() => void revoke(token)}>{t('Bekor qilish')}</button>
                    )}
                </div></td>
              </tr>)}
        </tbody></table></div>
        <div className="table-footer"><span>{t('Oxirgi 200 tagacha kod ko‘rsatiladi')}</span></div>
      </section>
      {showCreate && <CreateCode platform={platform} onClose={() => setShowCreate(false)} onCreated={(code) => { setShowCreate(false); setSuccess(t('Yangi aktivatsiya kodi: {0}').replace('{0}', code)); void load() }} />}
    </>
  )
}

function CreateCode({ platform, onClose, onCreated }: { platform: 'desktop' | 'website'; onClose: () => void; onCreated: (code: string) => void }) {
  const { t } = useSiteLanguage()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data, error: rpcError } = platform === 'website'
        ? await requireSupabase().rpc('generate_web_activation_code', { p_note: note.trim() || null })
        : await requireSupabase().rpc('generate_activation_code', { p_note: note.trim() || null })
      if (rpcError) throw rpcError
      const token = Array.isArray(data) ? data[0] : data
      if (!token?.code) throw new Error(t('Server kod yaratdi, ammo javobda kod topilmadi.'))
      onCreated(token.code as string)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={platform === 'website' ? t('Sayt uchun 15 kunlik aktivatsiya kodi') : t('Desktop ilova uchun aktivatsiya kodi')} onClose={onClose} onSubmit={submit} busy={busy} submitLabel={t('Kod yaratish')}>
    {error && <Notice message={error} />}
    <label className="field"><span>{t('Izoh (ixtiyoriy)')}</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Ism yoki telefon raqami')} /></label>
  </Modal>
}

function statusLabel(status: string, t: (text: string) => string) {
  return ({ PENDING: t('Kutilmoqda'), ACTIVATED: t('Faollashtirilgan'), REVOKED: t('Bekor qilingan') } as Record<string, string>)[status] || status
}

function formatDate(value: string, language: string) {
  return new Date(value).toLocaleString(language === 'ru' ? 'ru-RU' : 'uz-UZ', { dateStyle: 'medium', timeStyle: 'short' })
}
