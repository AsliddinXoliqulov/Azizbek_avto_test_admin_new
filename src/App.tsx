import { createContext, useContext, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import type { AdminProfile } from './lib/types'
import { getErrorMessage } from './lib/types'
import { Notice } from './components/Notice'
import Dashboard from './pages/Dashboard'
import Questions from './pages/Questions'
import AdminNewQuestions from './pages/AdminNewQuestions'
import Bilets from './pages/Bilets'
import Codes from './pages/Codes'
import Account from './pages/Account'
import logo from './logo.jpg'

interface AuthContextValue {
  profile: AdminProfile
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAdmin() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('Admin sessiyasi topilmadi.')
  return context
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-action">{action}</div>}
    </div>
  )
}

function Login() {
  const navigate = useNavigate()
  const [method, setMethod] = useState<'magic-link' | 'password'>('magic-link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function redirectUrl() {
    return `${window.location.origin}/`
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { error: signInError } = method === 'magic-link'
        ? await requireSupabase().auth.signInWithOtp({
            email: email.trim(),
            options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false },
          })
        : await requireSupabase().auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) throw signInError
      if (method === 'magic-link') {
        setMessage('Kirish havolasi email manzilingizga yuborildi. Xatdagi havolani ochib panelga kiring.')
      } else {
        navigate('/', { replace: true })
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <img className="brand-logo brand-logo-login" src={logo} alt="Azizbek Avto Test" />
        <p className="eyebrow">AZIZBEK AVTO TEST · ADMIN</p>
        <h1>Boshqaruv paneli</h1>
        <p className="login-description">Davom etish uchun admin hisobingizga kiring.</p>
        {!isSupabaseConfigured && (
          <Notice message="Supabase sozlanmagan. Frontend papkasidagi .env.example faylidan .env yarating va Supabase URL hamda anon public key ni kiriting." />
        )}
        {error && <Notice message={error} />}
        {message && <Notice message={message} kind="success" />}
        <div className="login-methods">
          <button type="button" className={method === 'magic-link' ? 'selected' : ''} onClick={() => { setMethod('magic-link'); setError(''); setMessage('') }}>Email havolasi</button>
          <button type="button" className={method === 'password' ? 'selected' : ''} onClick={() => { setMethod('password'); setError(''); setMessage('') }}>Login va parol</button>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Admin email</span>
            <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          {method === 'password' && <label className="field">
            <span>Parol</span>
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>}
          <button className="button button-primary button-wide" disabled={busy || !isSupabaseConfigured}>
            {busy ? 'Kutilmoqda…' : method === 'magic-link' ? 'Gmail’ga kirish havolasini yuborish' : 'Login va parol bilan kirish'}
          </button>
        </form>
        <div className="login-foot">Faqat faol adminlar kira oladi. Magic link uchun Supabase’da shu admin email’i mavjud bo‘lishi kerak.</div>
      </section>
    </main>
  )
}

function AdminLayout({ profile, refreshProfile, children }: AuthContextValue & { children: ReactNode }) {
  const [signOutError, setSignOutError] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    setSignOutError('')
    const { error } = await requireSupabase().auth.signOut()
    if (error) {
      setSignOutError(error.message)
      setSigningOut(false)
    }
  }

  const menu = [
    { to: '/', label: 'Umumiy ko‘rinish', icon: '⌂', end: true },
    { to: '/questions', label: 'Savollar', icon: '▤' },
    { to: '/new-questions', label: 'Admin savollari', icon: '＋' },
    { to: '/bilets', label: 'Biletlar', icon: '▦' },
    { to: '/codes', label: 'Aktivatsiya kodlari', icon: '⌁' },
    { to: '/account', label: 'Akkaunt sozlamalari', icon: '⚙' },
  ]

  return (
    <AuthContext.Provider value={{ profile, refreshProfile }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link className="sidebar-brand" to="/">
            <img className="brand-logo brand-logo-small" src={logo} alt="" />
            <span><strong>AZIZBEK AVTO TEST</strong><small>ADMIN PANEL</small></span>
          </Link>
          <div className="sidebar-label">MENYU</div>
          <nav className="sidebar-nav">
            {menu.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-user">
              <span className="avatar">{(profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span>
              <span className="sidebar-user-info"><strong>{profile.full_name || 'Admin'}</strong><small>{profile.role === 'SUPER_ADMIN' ? 'Bosh admin' : 'Admin'}</small></span>
            </div>
            <button className="signout-button" onClick={signOut} disabled={signingOut}>↪ <span>{signingOut ? 'Chiqilmoqda…' : 'Chiqish'}</span></button>
            {signOutError && <p className="inline-error">{signOutError}</p>}
          </div>
        </aside>
        <main className="main-area">
          <header className="topbar">
            <div className="breadcrumb"><span>Admin</span><b>/</b><strong>{menu.find((item) => item.to === location.pathname)?.label || 'Boshqaruv'}</strong></div>
            <div className="topbar-right"><span className="status-dot" /> Baza bilan bog‘langan</div>
          </header>
          <div className="content-area">{children}</div>
        </main>
      </div>
    </AuthContext.Provider>
  )
}

function ProtectedRoutes({ session, profile, profileLoading, authError, refreshProfile }: { session: Session | null; profile: AdminProfile | null; profileLoading: boolean; authError: string; refreshProfile: () => Promise<void> }) {
  if (!session) return <Login />
  if (profileLoading) return <main className="loading-screen"><div className="spinner" /><span>Admin huquqlari tekshirilmoqda…</span></main>
  if (!profile) {
    return (
      <main className="login-page">
        <section className="login-card">
          <img className="brand-logo brand-logo-login" src={logo} alt="Azizbek Avto Test" />
          <h1>Admin huquqi topilmadi</h1>
          <p className="login-description">{authError || 'Bu foydalanuvchi admins jadvalida faol admin sifatida ro‘yxatdan o‘tmagan.'}</p>
          <button className="button button-quiet button-wide" onClick={() => void requireSupabase().auth.signOut()}>Hisobdan chiqish</button>
        </section>
      </main>
    )
  }

  return (
    <AdminLayout profile={profile} refreshProfile={refreshProfile}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/questions" element={<Questions />} />
        <Route path="/new-questions" element={<AdminNewQuestions />} />
        <Route path="/bilets" element={<Bilets />} />
        <Route path="/codes" element={<Codes />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AdminLayout>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  async function refreshProfile() {
    const client = requireSupabase()
    const { data: { session: currentSession } } = await client.auth.getSession()
    setSession(currentSession)
    if (!currentSession) {
      setProfile(null)
      return
    }
    const { data, error } = await client.from('admins')
      .select('id,email,full_name,role,is_active')
      .eq('id', currentSession.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data || !data.is_active) {
      setProfile(null)
      await client.auth.signOut()
      setAuthError('Admin profilingiz faol emas yoki topilmadi.')
      return
    }
    const authEmail = currentSession.user.email?.toLowerCase()
    if (authEmail && data.email.toLowerCase() !== authEmail) {
      const { error: syncError } = await client.rpc('update_own_admin_profile', {
        p_full_name: null,
        p_sync_email: true,
      })
      if (syncError) throw syncError
      data.email = authEmail
    }
    setProfile(data as AdminProfile)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    const client = requireSupabase()
    let active = true
    void client.auth.getSession().then(({ data, error }) => {
      if (error) throw error
      if (!active) return
      setSession(data.session)
      setProfileLoading(Boolean(data.session))
    }).catch((error: unknown) => {
      if (active) setAuthError(getErrorMessage(error))
    }).finally(() => {
      if (active) setLoading(false)
    })
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfileLoading(Boolean(nextSession))
      if (!nextSession) setProfile(null)
      else setAuthError('')
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    let active = true
    setProfileLoading(true)
    const client = requireSupabase()
    void (async () => {
      try {
        const { data, error } = await client.from('admins')
          .select('id,email,full_name,role,is_active')
          .eq('id', session.user.id)
          .maybeSingle()
        if (error) throw error
        if (!active) return
        if (!data || !data.is_active) {
          setProfile(null)
          setAuthError('Admin profilingiz faol emas yoki topilmadi.')
          await client.auth.signOut()
          return
        }
        const authEmail = session.user.email?.toLowerCase()
        if (authEmail && data.email.toLowerCase() !== authEmail) {
          const { error: syncError } = await client.rpc('update_own_admin_profile', {
            p_full_name: null,
            p_sync_email: true,
          })
          if (syncError) throw syncError
          data.email = authEmail
        }
        setProfile(data as AdminProfile)
      } catch (reason) {
        if (active) setAuthError(getErrorMessage(reason))
      } finally {
        if (active) setProfileLoading(false)
      }
    })()
    return () => { active = false }
  }, [session])

  if (loading) return <main className="loading-screen"><div className="spinner" /><span>Yuklanmoqda…</span></main>
  return (
    <>
      {authError && !session && <div className="global-notice"><Notice message={authError} onClose={() => setAuthError('')} /></div>}
      <ProtectedRoutes session={session} profile={profile} profileLoading={profileLoading} authError={authError} refreshProfile={refreshProfile} />
    </>
  )
}
