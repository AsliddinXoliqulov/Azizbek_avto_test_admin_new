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
  const [filter, setFilter] = useState('')
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
      const { error: expireError } = await client.rpc('expire_stale_tokens')
      if (expireError) throw expireError
      let request = client.from('activation_tokens')
        .select('id,code,note,status,created_at,expires_at,device_id,activated_at,created_by,validity_days')
        .order('created_at', { ascending: false })
        .limit(200)
      if (filter === '15_DAY') request = request.eq('validity_days', 15)
      else if (filter) request = request.eq('status', filter)
      const { data, error: tokenError } = await request
      if (tokenError) throw tokenError
      setTokens((data || []) as ActivationToken[])
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

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
      message: t('{0} kodini bekor qilasizmi? Ulangan qurilma keyingi tekshiruvda bloklanadi.').replace('{0}', token.code),
      confirmLabel: t('Bekor qilish'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const { error: revokeError } = await requireSupabase().rpc('revoke_activation_code', { p_id: token.id })
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
      message: token.device_id
        ? t('{0} kodini qayta faollashtirasizmi? Kod {1} davomida ochiladi va faqat avval ulangan qurilmada ishlaydi ({2}…).')
          .replace('{0}', token.code).replace('{1}', t(token.validity_days === 15 ? '15 kun' : '1 soat')).replace('{2}', token.device_id.slice(0, 10))
        : t('{0} kodini qayta faollashtirasizmi? Kod {1} davomida ochiladi; bu kod avval qurilmaga ulanmagan.')
          .replace('{0}', token.code).replace('{1}', t(token.validity_days === 15 ? '15 kun' : '1 soat')),
      confirmLabel: t('Qayta faollashtirish'),
    })
    if (!confirmed) return
    try {
      const { error: rpcError } = await requireSupabase().rpc('reactivate_revoked_activation_code', { p_id: token.id })
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
      const { error: rpcError } = await requireSupabase().rpc('delete_revoked_activation_code', { p_id: token.id })
      if (rpcError) throw rpcError
      setSuccess(t('{0} kodi bazadan butunlay o‘chirildi.').replace('{0}', token.code))
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader title="Aktivatsiya kodlari" description="Desktop ilovalar uchun odatiy yoki 15 kun ichida ishlatiladigan kodlarni yarating va boshqaring." action={<button className="button button-primary" onClick={() => setShowCreate(true)}>{t('＋ Kod yaratish')}</button>} />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar">
          <div className="filter-tabs">
            <button className={!filter ? 'selected' : ''} onClick={() => setFilter('')}>{t('Barchasi')}</button>
            {['PENDING', 'ACTIVATED', 'EXPIRED', 'REVOKED'].map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{statusLabel(status, t)}</button>)}
            <button className={filter === '15_DAY' ? 'selected' : ''} onClick={() => setFilter('15_DAY')}>{t('15 kunlik')}</button>
          </div>
          <button className="button button-quiet button-small" onClick={() => void load()} disabled={loading}>{t('↻ Yangilash')}</button>
        </div>
        <div className="table-scroll"><table><thead><tr><th>{t('KOD / IZOH')}</th><th>{t('HOLATI')}</th><th>{t('YARATILGAN')}</th><th>{t('MUDDATI')}</th><th>{t('QURILMA')}</th><th className="align-right">{t('AMALLAR')}</th></tr></thead><tbody>
          {loading ? <tr><td className="table-state" colSpan={6}>{t('Kodlar yuklanmoqda…')}</td></tr>
            : tokens.length === 0 ? <tr><td className="table-state" colSpan={6}>{t('Kodlar topilmadi.')}</td></tr>
              : tokens.map((token) => <tr key={token.id}>
                <td><div className={`token-cell${token.validity_days === 15 ? ' token-cell-fifteen-day' : ''}`}><div className="token-code"><code>{token.code}</code><button className="icon-button" type="button" onClick={() => void copyCode(token)} title={t(copiedTokenId === token.id ? 'Nusxalandi' : 'Kodni nusxalash')} aria-label={t('{0} kodini nusxalash').replace('{0}', token.code)}>{copiedTokenId === token.id ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="2.5" width="8" height="10" rx="1.5" /><path d="M10.5 13.5v.2a1.3 1.3 0 0 1-1.3 1.3H3.3A1.3 1.3 0 0 1 2 13.7V6.3A1.3 1.3 0 0 1 3.3 5h.2" /></svg>}</button></div><small>{token.note || t('Izoh kiritilmagan')}</small></div></td>
                <td><span className={`badge ${token.status === 'ACTIVATED' ? 'badge-success' : token.status === 'PENDING' ? 'badge-warning' : 'badge-neutral'}`}><i />{statusLabel(token.status, t)}</span></td>
                <td>{formatDate(token.created_at, language)}</td><td>{formatDate(token.expires_at, language)}</td>
                <td><span className="device-id">{token.device_id ? `${token.device_id.slice(0, 10)}…` : '—'}</span></td>
                <td><div className="row-actions">
                  {token.status === 'REVOKED' && (
                    <button className="text-button" onClick={() => void reactivate(token)}>{t('Qayta faollashtirish')}</button>
                  )}
                  {['EXPIRED', 'REVOKED'].includes(token.status)
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
      {showCreate && <CreateCode onClose={() => setShowCreate(false)} onCreated={(code) => { setShowCreate(false); setSuccess(t('Yangi aktivatsiya kodi: {0}').replace('{0}', code)); void load() }} />}
    </>
  )
}

function CreateCode({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const { t } = useSiteLanguage()
  const [note, setNote] = useState('')
  const [fifteenDayCode, setFifteenDayCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data, error: rpcError } = await requireSupabase().rpc('generate_activation_code', {
        p_note: note.trim() || null,
        p_validity_days: fifteenDayCode ? 15 : 0,
      })
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

  return <Modal title={t('Aktivatsiya kodi yaratish')} onClose={onClose} onSubmit={submit} busy={busy} submitLabel={t('Kod yaratish')}>
    {error && <Notice message={error} />}
    <label className="field"><span>{t('Izoh (ixtiyoriy)')}</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Ism yoki telefon raqami')} /></label>
    <div className="checkbox-grid classification-grid"><label><input type="checkbox" checked={fifteenDayCode} onChange={(event) => setFifteenDayCode(event.target.checked)} /> {t('15 kunlik kod')}</label></div>
  </Modal>
}

function statusLabel(status: string, t: (text: string) => string) {
  return ({ PENDING: t('Kutilmoqda'), ACTIVATED: t('Faollashtirilgan'), EXPIRED: t('Muddati tugagan'), REVOKED: t('Bekor qilingan') } as Record<string, string>)[status] || status
}

function formatDate(value: string, language: string) {
  return new Date(value).toLocaleString(language === 'ru' ? 'ru-RU' : 'uz-UZ', { dateStyle: 'medium', timeStyle: 'short' })
}
