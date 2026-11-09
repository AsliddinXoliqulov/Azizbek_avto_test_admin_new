import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import type { AdminProfile } from './lib/types'
import { getErrorMessage } from './lib/types'
import { Notice, ToastProvider } from './components/Notice'
import Dashboard from './pages/Dashboard'
import Questions from './pages/Questions'
import Chapters from './pages/Chapters'
import Codes from './pages/Codes'
import Account from './pages/Account'
import Categories from './pages/Categories'
import logo from './logo.jpg'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface AuthContextValue {
  profile: AdminProfile
  refreshProfile: () => Promise<void>
  registerBackHandler: (handler: (() => void) | null) => void
  uiScale: UiScale
  setUiScale: (scale: UiScale) => void
}

export type UiScale = number

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAdmin() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('Admin sessiyasi topilmadi.')
  return context
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
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
      const { error: signInError } =
        method === 'magic-link'
          ? await requireSupabase().auth.signInWithOtp({
              email: email.trim(),
              options: {
                emailRedirectTo: redirectUrl(),
                shouldCreateUser: false,
              },
            })
          : await requireSupabase().auth.signInWithPassword({
              email: email.trim(),
              password,
            })
      if (signInError) throw signInError
      if (method === 'magic-link') {
        setMessage(
          'Kirish havolasi email manzilingizga yuborildi. Xatdagi havolani ochib panelga kiring.'
        )
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
        <img
          className="brand-logo brand-logo-login"
          src={logo}
          alt="Azizbek Prava Akademiyasi"
        />
        <p className="eyebrow">AZIZBEK PRAVA AKADEMIYASI · ADMIN</p>
        <h1>Boshqaruv paneli</h1>
        <p className="login-description">
          Davom etish uchun admin hisobingizga kiring.
        </p>
        {!isSupabaseConfigured && (
          <Notice message="Supabase sozlanmagan. Frontend papkasidagi .env.example faylidan .env yarating va Supabase URL hamda anon public key ni kiriting." />
        )}
        {error && <Notice message={error} />}
        {message && <Notice message={message} kind="success" />}
        <div className="login-methods">
          <button
            type="button"
            className={method === 'magic-link' ? 'selected' : ''}
            onClick={() => {
              setMethod('magic-link')
              setError('')
              setMessage('')
            }}
          >
            Email havolasi
          </button>
          <button
            type="button"
            className={method === 'password' ? 'selected' : ''}
            onClick={() => {
              setMethod('password')
              setError('')
              setMessage('')
            }}
          >
            Login va parol
          </button>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Admin email</span>
            <input
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {method === 'password' && (
            <label className="field">
              <span>Parol</span>
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
          )}
          <button
            className="button button-primary button-wide"
            disabled={busy || !isSupabaseConfigured}
          >
            {busy
              ? 'Kutilmoqda…'
              : method === 'magic-link'
                ? 'Gmail’ga kirish havolasini yuborish'
                : 'Login va parol bilan kirish'}
          </button>
        </form>
      </section>
    </main>
  )
}

function AdminLayout({
  profile,
  refreshProfile,
  children,
}: Pick<AuthContextValue, 'profile' | 'refreshProfile'> & {
  children: ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [signOutError, setSignOutError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [backHandler, setBackHandler] = useState<(() => void) | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [installHelp, setInstallHelp] = useState('')
  const [appInstalled, setAppInstalled] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('admin-theme') === 'light' ? 'light' : 'dark'
  )
  const [uiScale, setUiScale] = useState<UiScale>(() => {
    const savedScale = localStorage.getItem('admin-ui-scale')
    if (localStorage.getItem('admin-ui-scale-version') === '5') {
      const savedValue = Number(savedScale)
      return Number.isInteger(savedValue) &&
        savedValue >= 1 &&
        savedValue <= 100
        ? savedValue
        : 1
    }
    if (savedScale === 'extra-large') return 100
    if (savedScale === 'large') return 38
    if (savedScale === 'medium') return 1
    return 1
  })

  const registerBackHandler = useCallback((handler: (() => void) | null) => {
    setBackHandler(() => handler)
  }, [])

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setAppInstalled(true)
      setInstallPrompt(null)
      setInstallHelp('')
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('admin-theme', theme)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    const factor = 1.2 + ((uiScale - 1) / 99) * 0.8
    root.style.setProperty('--admin-ui-scale-factor', String(factor))
    root.dataset.uiScaleLevel =
      factor >= 1.75 ? 'extra-large' : factor >= 1.5 ? 'large' : 'medium'
    localStorage.setItem('admin-ui-scale', String(uiScale))
    localStorage.setItem('admin-ui-scale-version', '5')
  }, [uiScale])

  useEffect(() => {
    if (!profileMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !profileMenuRef.current?.contains(event.target)
      )
        setProfileMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileMenuOpen])

  function goBack() {
    if (backHandler) {
      backHandler()
      return
    }
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }

  async function installApp() {
    setInstallHelp('')
    if (!installPrompt) {
      setInstallHelp(
        'Brauzer menyusidan “Ilovani o‘rnatish” yoki “Bosh ekranga qo‘shish” bandini tanlang.'
      )
      return
    }
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      setInstallPrompt(null)
      if (outcome === 'accepted') setAppInstalled(true)
    } catch (error) {
      console.error('PWA ilovasini o‘rnatib bo‘lmadi:', error)
      setInstallHelp(
        'Ilovani o‘rnatib bo‘lmadi. Brauzer menyusidan qayta urinib ko‘ring.'
      )
    }
  }

  async function signOut() {
    setSigningOut(true)
    setSignOutError('')
    setProfileMenuOpen(false)
    const { error } = await requireSupabase().auth.signOut()
    if (error) {
      setSignOutError(error.message)
      setSigningOut(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        profile,
        refreshProfile,
        registerBackHandler,
        uiScale,
        setUiScale,
      }}
    >
      <div className="admin-scale-frame">
        <div className="app-shell admin-shell">
          <header className="admin-topbar">
            <Link className="admin-brand" to="/">
              <img className="brand-logo brand-logo-small" src={logo} alt="" />
              <span className="admin-brand-copy">
                <strong>AZIZBEK PRAVA</strong>
                <em>AKADEMIYASI</em>
                <small>ADMIN PANEL</small>
              </span>
            </Link>
            <button
              type="button"
              className="global-back-button"
              onClick={goBack}
              title="Orqaga"
              aria-label="Orqaga"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19 12H5m7 7-7-7 7-7" />
              </svg>
            </button>
            <Link
              className="global-home-button"
              to="/"
              title="Bosh sahifa"
              aria-label="Bosh sahifa"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" />
              </svg>
            </Link>
            <button
              type="button"
              className="theme-toggle-button"
              onClick={() =>
                setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
              }
              title={theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'}
              aria-label={
                theme === 'dark'
                  ? 'Kunduzgi rejimga o‘tish'
                  : 'Tungi rejimga o‘tish'
              }
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
              )}
            </button>
            <div className="admin-topbar-actions">
              <div className="profile-menu-wrap" ref={profileMenuRef}>
                <button
                  type="button"
                  className={`admin-profile-button${profileMenuOpen ? ' is-open' : ''}`}
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  aria-label="Profil menyusini ochish"
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="true"
                  title="Profil"
                >
                  <span className="profile-avatar">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
                    </svg>
                  </span>
                  <svg
                    className="profile-chevron"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="m7 10 5 5 5-5" />
                  </svg>
                </button>
                {profileMenuOpen && (
                  <div className="profile-dropdown">
                    <div className="profile-dropdown-heading">
                      <span className="profile-avatar profile-avatar-large">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
                        </svg>
                      </span>
                      <span className="profile-dropdown-identity">
                        <strong>{profile.full_name || 'Admin'}</strong>
                        <small>{profile.email}</small>
                      </span>
                    </div>
                    <div className="profile-dropdown-divider" />
                    <Link
                      className="profile-dropdown-action"
                      to="/account"
                      onClick={() => setProfileMenuOpen(false)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                        <path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3H3.7a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
                      </svg>
                      <span>Profil va sozlamalar</span>
                      <svg
                        className="profile-action-arrow"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </Link>
                    {!appInstalled && (
                      <button
                        type="button"
                        className="profile-dropdown-action profile-install-action"
                        onClick={() => void installApp()}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3" />
                        </svg>
                        <span>Ilovani o‘rnatish</span>
                      </button>
                    )}
                    {installHelp && (
                      <p className="profile-dropdown-error profile-install-help">
                        {installHelp}
                      </p>
                    )}
                    <button
                      type="button"
                      className="profile-dropdown-action profile-theme-action"
                      onClick={() =>
                        setTheme((current) =>
                          current === 'dark' ? 'light' : 'dark'
                        )
                      }
                      aria-label={
                        theme === 'dark'
                          ? 'Kunduzgi rejimga o‘tish'
                          : 'Tungi rejimga o‘tish'
                      }
                    >
                      {theme === 'dark' ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                        </svg>
                      )}
                      <span>
                        {theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'}
                      </span>
                    </button>
                    <button
                      className="profile-dropdown-action profile-signout-action"
                      onClick={() => void signOut()}
                      disabled={signingOut}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
                      </svg>
                      <span>
                        {signingOut ? 'Chiqilmoqda…' : 'Hisobdan chiqish'}
                      </span>
                    </button>
                    {signOutError && (
                      <p className="profile-dropdown-error">{signOutError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="main-area">
            <div
              className={
                location.pathname === '/'
                  ? 'content-area content-area-dashboard'
                  : 'content-area'
              }
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  )
}

function ProtectedRoutes({
  session,
  profile,
  profileLoading,
  authError,
  refreshProfile,
}: {
  session: Session | null
  profile: AdminProfile | null
  profileLoading: boolean
  authError: string
  refreshProfile: () => Promise<void>
}) {
  if (!session) return <Login />
  if (profileLoading)
    return (
      <main className="loading-screen">
        <div className="spinner" />
        <span>Admin huquqlari tekshirilmoqda…</span>
      </main>
    )
  if (!profile) {
    return (
      <main className="login-page">
        <section className="login-card">
          <img
            className="brand-logo brand-logo-login"
            src={logo}
            alt="Azizbek Prava Akademiyasi"
          />
          <h1>Admin huquqi topilmadi</h1>
          <p className="login-description">
            {authError ||
              'Bu foydalanuvchi admins jadvalida faol admin sifatida ro‘yxatdan o‘tmagan.'}
          </p>
          <button
            className="button button-quiet button-wide"
            onClick={() => void requireSupabase().auth.signOut()}
          >
            Hisobdan chiqish
          </button>
        </section>
      </main>
    )
  }

  return (
    <AdminLayout profile={profile} refreshProfile={refreshProfile}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/questions" element={<Questions />} />
        <Route
          path="/new-questions"
          element={<Navigate to="/questions?type=new" replace />}
        />
        <Route path="/chapters" element={<Chapters />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/codes" element={<Codes />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AdminLayout>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const sessionUserId = useRef<string | null>(null)
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  async function refreshProfile() {
    const client = requireSupabase()
    const {
      data: { session: currentSession },
    } = await client.auth.getSession()
    setSession(currentSession)
    if (!currentSession) {
      setProfile(null)
      return
    }
    const { data, error } = await client
      .from('admins')
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
      const { error: syncError } = await client.rpc(
        'update_own_admin_profile',
        {
          p_full_name: null,
          p_sync_email: true,
        }
      )
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
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error
        if (!active) return
        sessionUserId.current = data.session?.user.id ?? null
        setSession(data.session)
        setProfileLoading(Boolean(data.session))
      })
      .catch((error: unknown) => {
        if (active) setAuthError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null
      const identityChanged = sessionUserId.current !== nextUserId
      sessionUserId.current = nextUserId
      setSession(nextSession)
      if (identityChanged) setProfileLoading(Boolean(nextSession))
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
        const { data, error } = await client
          .from('admins')
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
          const { error: syncError } = await client.rpc(
            'update_own_admin_profile',
            {
              p_full_name: null,
              p_sync_email: true,
            }
          )
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
    return () => {
      active = false
    }
  }, [session?.user.id, session?.user.email])

  if (loading)
    return (
      <main className="loading-screen">
        <div className="spinner" />
        <span>Yuklanmoqda…</span>
      </main>
    )
  return (
    <ToastProvider>
      {authError && !session && (
        <Notice message={authError} onClose={() => setAuthError('')} />
      )}
      <ProtectedRoutes
        session={session}
        profile={profile}
        profileLoading={profileLoading}
        authError={authError}
        refreshProfile={refreshProfile}
      />
    </ToastProvider>
  )
}
