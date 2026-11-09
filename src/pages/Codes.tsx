import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import type { ActivationToken } from '../lib/types'
import { getErrorMessage } from '../lib/types'

export default function Codes() {
  const confirm = useConfirm()

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
      setSuccess(`${token.code} kodi nusxalandi.`)
    } catch (reason) {
      setError(`Kodni nusxalab bo‘lmadi: ${getErrorMessage(reason)}`)
    }
  }

  async function revoke(token: ActivationToken) {
    const confirmed = await confirm({
      title: 'Aktivatsiya kodini bekor qilish',
      message: `${token.code} kodini bekor qilasizmi? Ulangan qurilma keyingi tekshiruvda bloklanadi.`,
      confirmLabel: 'Bekor qilish',
      danger: true,
    })
    if (!confirmed) return
    try {
      const { error: revokeError } = await requireSupabase().rpc('revoke_activation_code', { p_id: token.id })
      if (revokeError) throw revokeError
      setSuccess(`${token.code} kodi bekor qilindi.`)
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function reactivate(token: ActivationToken) {
    const confirmed = await confirm({
      title: 'Kodni qayta faollashtirish',
      message: token.device_id
        ? `${token.code} kodini qayta faollashtirasizmi? Kod ${token.validity_days === 15 ? '15 kun' : '1 soat'} davomida ochiladi va faqat avval ulangan qurilmada ishlaydi (${token.device_id.slice(0, 10)}…).`
        : `${token.code} kodini qayta faollashtirasizmi? Kod ${token.validity_days === 15 ? '15 kun' : '1 soat'} davomida ochiladi; bu kod avval qurilmaga ulanmagan.`,
      confirmLabel: 'Qayta faollashtirish',
    })
    if (!confirmed) return
    try {
      const { error: rpcError } = await requireSupabase().rpc('reactivate_revoked_activation_code', { p_id: token.id })
      if (rpcError) throw rpcError
      setSuccess(`${token.code} kodi qayta faollashtirildi.`)
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function deleteInactive(token: ActivationToken) {
    const confirmed = await confirm({
      title: 'Kodni bazadan butunlay o‘chirish',
      message: `${token.code} kodi va unga tegishli yozuv bazadan butunlay o‘chadi. Bu amalni qaytarib bo‘lmaydi.`,
      confirmLabel: 'Butunlay o‘chirish',
      danger: true,
    })
    if (!confirmed) return
    try {
      const { error: rpcError } = await requireSupabase().rpc('delete_revoked_activation_code', { p_id: token.id })
      if (rpcError) throw rpcError
      setSuccess(`${token.code} kodi bazadan butunlay o‘chirildi.`)
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader title="Aktivatsiya kodlari" description="Desktop ilovalar uchun odatiy yoki 15 kun ichida ishlatiladigan kodlarni yarating va boshqaring." action={<button className="button button-primary" onClick={() => setShowCreate(true)}>＋ Kod yaratish</button>} />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar">
          <div className="filter-tabs">
            <button className={!filter ? 'selected' : ''} onClick={() => setFilter('')}>Barchasi</button>
            {['PENDING', 'ACTIVATED', 'EXPIRED', 'REVOKED'].map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{statusLabel(status)}</button>)}
            <button className={filter === '15_DAY' ? 'selected' : ''} onClick={() => setFilter('15_DAY')}>15 kunlik</button>
          </div>
          <button className="button button-quiet button-small" onClick={() => void load()} disabled={loading}>↻ Yangilash</button>
        </div>
        <div className="table-scroll"><table><thead><tr><th>KOD / IZOH</th><th>HOLATI</th><th>YARATILGAN</th><th>MUDDATI</th><th>QURILMA</th><th className="align-right">AMALLAR</th></tr></thead><tbody>
          {loading ? <tr><td className="table-state" colSpan={6}>Kodlar yuklanmoqda…</td></tr>
            : tokens.length === 0 ? <tr><td className="table-state" colSpan={6}>Kodlar topilmadi.</td></tr>
              : tokens.map((token) => <tr key={token.id}>
                <td><div className={`token-cell${token.validity_days === 15 ? ' token-cell-fifteen-day' : ''}`}><div className="token-code"><code>{token.code}</code><button className="icon-button" type="button" onClick={() => void copyCode(token)} title={copiedTokenId === token.id ? 'Nusxalandi' : 'Kodni nusxalash'} aria-label={`${token.code} kodini nusxalash`}>{copiedTokenId === token.id ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="2.5" width="8" height="10" rx="1.5" /><path d="M10.5 13.5v.2a1.3 1.3 0 0 1-1.3 1.3H3.3A1.3 1.3 0 0 1 2 13.7V6.3A1.3 1.3 0 0 1 3.3 5h.2" /></svg>}</button></div><small>{token.note || 'Izoh kiritilmagan'}</small></div></td>
                <td><span className={`badge ${token.status === 'ACTIVATED' ? 'badge-success' : token.status === 'PENDING' ? 'badge-warning' : 'badge-neutral'}`}><i />{statusLabel(token.status)}</span></td>
                <td>{formatDate(token.created_at)}</td><td>{formatDate(token.expires_at)}</td>
                <td><span className="device-id">{token.device_id ? `${token.device_id.slice(0, 10)}…` : '—'}</span></td>
                <td><div className="row-actions">
                  {token.status === 'REVOKED' && (
                    <button className="text-button" onClick={() => void reactivate(token)}>Qayta faollashtirish</button>
                  )}
                  {['EXPIRED', 'REVOKED'].includes(token.status)
                    ? <button
                      className="icon-button danger-icon"
                      type="button"
                      title="Aktivatsiya kodini butunlay o‘chirish"
                      aria-label={`${token.code} kodini butunlay o‘chirish`}
                      onClick={() => void deleteInactive(token)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" /></svg>
                    </button>
                    : ['PENDING', 'ACTIVATED'].includes(token.status) && (
                      <button className="text-button danger-text" onClick={() => void revoke(token)}>Bekor qilish</button>
                    )}
                </div></td>
              </tr>)}
        </tbody></table></div>
        <div className="table-footer"><span>Oxirgi 200 tagacha kod ko‘rsatiladi</span></div>
      </section>
      {showCreate && <CreateCode onClose={() => setShowCreate(false)} onCreated={(code) => { setShowCreate(false); setSuccess(`Yangi aktivatsiya kodi: ${code}`); void load() }} />}
    </>
  )
}

function CreateCode({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
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
      if (!token?.code) throw new Error('Server kod yaratdi, ammo javobda kod topilmadi.')
      onCreated(token.code as string)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Aktivatsiya kodi yaratish" onClose={onClose} onSubmit={submit} busy={busy} submitLabel="Kod yaratish">
    {error && <Notice message={error} />}
    <label className="field"><span>Izoh (ixtiyoriy)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ism yoki telefon raqami" /></label>
    <div className="checkbox-grid classification-grid"><label><input type="checkbox" checked={fifteenDayCode} onChange={(event) => setFifteenDayCode(event.target.checked)} /> 15 kunlik kod</label></div>
  </Modal>
}

function statusLabel(status: string) {
  return ({ PENDING: 'Kutilmoqda', ACTIVATED: 'Faollashtirilgan', EXPIRED: 'Muddati tugagan', REVOKED: 'Bekor qilingan' } as Record<string, string>)[status] || status
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' })
}
