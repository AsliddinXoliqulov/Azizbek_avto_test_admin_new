import { useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader, useAdmin } from '../App'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/types'

export default function Account() {
  const { profile, refreshProfile } = useAdmin()
  const [name, setName] = useState(profile.full_name || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState<'name' | 'password' | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function start(action: 'name' | 'password') {
    setBusy(action)
    setError('')
    setSuccess('')
  }

  function finish() {
    setBusy(null)
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    start('name')
    try {
      const { error: rpcError } = await requireSupabase().rpc('update_own_admin_profile', {
        p_full_name: name.trim() || null,
        p_sync_email: false,
      })
      if (rpcError) throw rpcError
      await refreshProfile()
      setSuccess('Ismingiz yangilandi.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      finish()
    }
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
    start('password')
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

  return (
    <>
      <PageHeader title="Akkaunt sozlamalari" description="Panelda ko‘rinadigan ism va parolni yangilang." />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <div className="account-layout">
        <div className="account-main">
          <section className="panel-card account-card">
            <div className="account-card-heading"><span className="account-icon blue-bg">♙</span><div><h2>Admin profili</h2><p>Panelda ko‘rinadigan nom va login emailingiz.</p></div></div>
            <div className="account-role"><span>Joriy rol</span><span className={`tag ${profile.role === 'SUPER_ADMIN' ? 'tag-violet' : 'tag-blue'}`}>{profile.role === 'SUPER_ADMIN' ? 'Bosh admin' : 'Admin'}</span></div>
            <form className="account-form" onSubmit={saveName}>
              <label className="field"><span>Foydalanuvchi nomi</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ism Familiya" /></label>
              <div className="account-submit"><button className="button button-quiet" disabled={busy !== null}>{busy === 'name' ? 'Saqlanmoqda…' : 'Ismni saqlash'}</button></div>
            </form>
            <div className="account-form">
              <label className="field"><span>Login email / Gmail</span><input type="email" autoComplete="email" value={profile.email} disabled readOnly /></label>
              <p className="field-hint">Login emailini o‘zgartirish o‘chirilgan.</p>
            </div>
          </section>

          <section className="panel-card account-card">
            <div className="account-card-heading"><span className="account-icon violet-bg">⌑</span><div><h2>Yangi parol</h2><p>Joriy parol so‘ralmaydi; akkauntga kirgan bo‘lishingiz kifoya.</p></div></div>
            <form className="account-form" onSubmit={savePassword}>
              <div className="form-grid">
                <label className="field"><span>Yangi parol</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
                <label className="field"><span>Yangi parolni tasdiqlang</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required /></label>
              </div>
              <div className="account-submit"><button className="button button-primary" disabled={busy !== null}>{busy === 'password' ? 'Saqlanmoqda…' : 'Yangi parolni saqlash'}</button></div>
            </form>
          </section>
        </div>

        <aside className="account-side">
          <section className="panel-card account-card">
            <div className="card-heading"><div><h2>Kirish usullari</h2><p>Admin hisobingizga kirish</p></div></div>
            <div className="auth-method"><span className="auth-method-icon">✉</span><span><strong>Gmail magic link</strong><small>Parolsiz, bir martalik xavfsiz havola</small></span><i className="status-dot" /></div>
            <div className="auth-method"><span className="auth-method-icon password-letter">•••</span><span><strong>Email va parol</strong><small>Zaxira kirish usuli</small></span><i className="status-dot" /></div>
          </section>
          <div className="info-box account-security"><strong>Supabase talablari</strong><br />Magic link redirect manzili Supabase Auth URL Configuration allowlist’ida bo‘lishi shart.</div>
        </aside>
      </div>
    </>
  )
}
