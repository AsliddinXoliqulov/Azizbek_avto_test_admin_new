import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../App'
import { requireSupabase } from '../lib/supabase'
import type { CoverageReport } from '../lib/types'
import { getErrorMessage } from '../lib/types'
import { Notice } from '../components/Notice'
import logo from '../logo.jpg'

const EMPTY_REPORT: CoverageReport = {
  questions_total: 0,
  questions_published: 0,
  questions_draft: 0,
  bilets_total: 0,
  tricky_count: 0,
  numeric_count: 0,
  road_sign_count: 0,
  reference_signs_total: 0,
  reference_signs_missing: 0,
  active_codes: 0,
  pending_codes: 0,
}

export default function Dashboard() {
  const [report, setReport] = useState<CoverageReport>(EMPTY_REPORT)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcError } = await requireSupabase().rpc('coverage_report')
      if (rpcError) throw rpcError
      setReport({ ...EMPTY_REPORT, ...(data as Partial<CoverageReport>) })
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <>
      <PageHeader title="Umumiy ko‘rinish" description="AZIZBEK AVTO TEST tizimining bugungi holati." action={<button className="button button-quiet" onClick={() => void load()} disabled={loading}>↻ Yangilash</button>} />
      {error && <Notice message={error} />}
      <div className="welcome-strip">
        <div className="welcome-copy"><span className="eyebrow">AZIZBEK AVTO TEST · ADMIN</span><h2>Haydovchilik bilimlari boshqaruvi</h2><p>Savollar va testlar bir joyda — boshqarish oson, foydalanish qulay.</p></div>
        <img className="welcome-logo" src={logo} alt="Azizbek Avto Test" />
      </div>
      <section className="stat-grid">
        <StatCard label="Jami savollar" value={report.questions_total} icon="▤" tone="blue" loading={loading} detail={`${report.questions_published} ta chop etilgan`} />
        <StatCard label="Qoralamalar" value={report.questions_draft} icon="◷" tone="amber" loading={loading} detail="Tasdiqlash kutilmoqda" />
        <StatCard label="Biletlar" value={report.bilets_total} icon="▦" tone="violet" loading={loading} detail="Faol imtihon biletlari" />
        <StatCard label="Faol kodlar" value={report.active_codes} icon="⌁" tone="green" loading={loading} detail={`${report.pending_codes} ta kutilmoqda`} />
      </section>
      <div className="dashboard-grid dashboard-grid-single">
        <section className="panel-card quick-actions">
          <div className="card-heading"><div><h2>Tezkor amallar</h2><p>Ko‘p ishlatiladigan bo‘limlar</p></div></div>
          <Link to="/questions" className="quick-action"><span className="quick-icon blue-bg">▤</span><span><strong>Savollarni boshqarish</strong><small>Savollar bazasini ko‘rish va tahrirlash</small></span><b>→</b></Link>
          <Link to="/codes" className="quick-action"><span className="quick-icon green-bg">⌁</span><span><strong>Kod yaratish</strong><small>Qurilma uchun 1 soatlik kod</small></span><b>→</b></Link>
        </section>
      </div>
    </>
  )
}

function StatCard({ label, value, icon, tone, loading, detail }: { label: string; value: number; icon: string; tone: string; loading: boolean; detail: string }) {
  return (
    <article className="stat-card">
      <div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div>
      <strong className="stat-value">{loading ? '—' : value.toLocaleString()}</strong>
      <span className="stat-detail">{detail}</span>
    </article>
  )
}
