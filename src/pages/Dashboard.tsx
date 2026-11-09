import { Link } from 'react-router-dom'

const actions = [
  {
    to: '/chapters',
    icon: (
      <>
        <path d="m2 9 10-5 10 5-10 5L2 9Z" />
        <path d="M6 11v5c3.7 2.7 8.3 2.7 12 0v-5M22 9v5" />
      </>
    ),
    tone: 'mint',
    title: 'Darslar',
  },
  {
    to: '/categories',
    icon: (
      <>
        <path d="M5 3h14v18H5z" />
        <path d="m8 12 2.5 2.5L16 9M8 7h8M8 18h5" />
      </>
    ),
    tone: 'gold',
    title: 'Mavzular',
  },
  {
    to: '/questions',
    icon: (
      <>
        <circle cx="5" cy="6" r="1.3" />
        <circle cx="5" cy="12" r="1.3" />
        <circle cx="5" cy="18" r="1.3" />
        <path d="M10 6h10M10 12h10M10 18h10" />
      </>
    ),
    tone: 'rose',
    title: 'Savollar',
  },
  {
    to: '/codes',
    icon: (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <path d="m11.2 11.2 9.3 9.3M16 16l2-2m-5-1 2-2" />
      </>
    ),
    tone: 'violet',
    title: 'Aktivatsiya kodlari',
  },
]

export default function Dashboard() {
  return (
    <main className="admin-home-stage" aria-label="Boshqaruv bo‘limlari">
      <section className="admin-home-grid">
        {actions.map((action) => (
          <Link
            className={`admin-home-tile ${action.tone}`}
            key={action.to}
            to={action.to}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {action.icon}
            </svg>
            <strong>{action.title}</strong>
          </Link>
        ))}
      </section>
    </main>
  )
}
