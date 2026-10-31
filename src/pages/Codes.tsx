import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader } from '../App'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import type { ActivationToken } from '../lib/types'
import { getErrorMessage } from '../lib/types'

export default function Codes() {
  const [tokens, setTokens] = useState<ActivationToken[]>([])
  const [filter, setFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const { error: expireError } = await client.rpc('expire_stale_tokens')
      if (expireError) throw expireError
      let request = client.from('activation_tokens')
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
  }, [filter])

  useEffect(() => { void load() }, [load])

  async function revoke(token: ActivationToken) {
    if (!window.confirm(`${token.code} kodini bekor qilasizmi? Ulangan qurilma keyingi tekshiruvda bloklanadi.`)) return
    try {
      const { error: revokeError } = await requireSupabase().rpc('revoke_activation_code', { p_id: token.id })
      if (revokeError) throw revokeError
      setSuccess(`${token.code} kodi bekor qilindi.`)
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader title="Aktivatsiya kodlari" description="Desktop ilovalar uchun 1 soat amal qiladigan kodlarni yarating va boshqaring." action={<button className="button button-primary" onClick={() => setShowCreate(true)}>＋ Kod yaratish</button>} />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar">
          <div className="filter-tabs"><button className={!filter ? 'selected' : ''} onClick={() => setFilter('')}>Barchasi</button>{['PENDING', 'ACTIVATED', 'EXPIRED', 'REVOKED'].map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{statusLabel(status)}</button>)}</div>
          <button className="button button-quiet button-small" onClick={() => void load()} disabled={loading}>↻ Yangilash</button>
        </div>
        <div className="table-scroll"><table><thead><tr><th>KOD / IZOH</th><th>HOLATI</th><th>YARATILGAN</th><th>MUDDATI</th><th>QURILMA</th><th className="align-right">AMALLAR</th></tr></thead><tbody>
          {loading ? <tr><td className="table-state" colSpan={6}>Kodlar yuklanmoqda…</td></tr>
            : tokens.length === 0 ? <tr><td className="table-state" colSpan={6}>Kodlar topilmadi.</td></tr>
              : tokens.map((token) => <tr key={token.id}>
                <td><div className="token-cell"><code>{token.code}</code><small>{token.note || 'Izoh kiritilmagan'}</small></div></td>
                <td><span className={`badge ${token.status === 'ACTIVATED' ? 'badge-success' : token.status === 'PENDING' ? 'badge-warning' : 'badge-neutral'}`}><i />{statusLabel(token.status)}</span></td>
                <td>{formatDate(token.created_at)}</td><td>{formatDate(token.expires_at)}</td>
                <td><span className="device-id">{token.device_id ? `${token.device_id.slice(0, 10)}…` : '—'}</span></td>
                <td><div className="row-actions">{['PENDING', 'ACTIVATED'].includes(token.status) && <button className="text-button danger-text" onClick={() => void revoke(token)}>Bekor qilish</button>}</div></td>
              </tr>)}
        </tbody></table></div>
        <div className="table-footer"><span>Oxirgi 200 tagacha kod ko‘rsatiladi · SUB_ADMIN faqat o‘z kodlarini ko‘radi.</span></div>
      </section>
      {showCreate && <CreateCode onClose={() => setShowCreate(false)} onCreated={(code) => { setShowCreate(false); setSuccess(`Yangi aktivatsiya kodi: ${code}`); void load() }} />}
    </>
  )
}

function CreateCode({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data, error: rpcError } = await requireSupabase().rpc('generate_activation_code', { p_note: note.trim() || null })
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
    <div className="info-box">Kod 8 belgidan iborat bo‘ladi va 1 soat amal qiladi. Har bir kod bitta qurilmada bir marta ishlatiladi.</div>
  </Modal>
}

function statusLabel(status: string) {
  return ({ PENDING: 'Kutilmoqda', ACTIVATED: 'Faollashtirilgan', EXPIRED: 'Muddati tugagan', REVOKED: 'Bekor qilingan' } as Record<string, string>)[status] || status
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' })
}
