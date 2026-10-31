import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../App'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import type { Bilet } from '../lib/types'
import { getErrorMessage } from '../lib/types'
import { fetchQuestionCounts } from '../lib/questionCounts'

export default function Bilets() {
  const [bilets, setBilets] = useState<Bilet[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const [{ data, error: biletError }, questionCounts] = await Promise.all([
        client.from('bilets').select('id,number,title,is_deleted').eq('is_deleted', false).order('number'),
        fetchQuestionCounts('bilet_id'),
      ])
      if (biletError) throw biletError
      setBilets((data || []) as Bilet[])
      setCounts(questionCounts)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <>
      <PageHeader title="Biletlar" description="Biletlar savollar bazasidagi har 20 ta savol bo‘yicha avtomatik tuziladi." action={<button className="button button-quiet" onClick={() => void load()} disabled={loading}>↻ Yangilash</button>} />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="section-intro"><div><h2>Barcha biletlar</h2><p>Biletga savollar qo‘shish yoki bilet yaratish qo‘lda talab qilinmaydi.</p></div><span className="count-pill">{bilets.length} ta bilet</span></div>
        <div className="table-scroll"><table><thead><tr><th>BILET</th><th>SAVOLLAR</th><th>HOLATI</th><th className="align-right">AMALLAR</th></tr></thead><tbody>
          {loading ? <tr><td className="table-state" colSpan={4}>Biletlar yuklanmoqda…</td></tr>
            : bilets.length === 0 ? <tr><td className="table-state" colSpan={4}>Biletlar savollar bilan birga avtomatik hosil bo‘ladi. Hozircha bilet yo‘q.</td></tr>
              : bilets.map((bilet) => {
                const count = counts[bilet.id] || 0
                return <tr key={bilet.id}>
                  <td><div className="question-cell"><span className="row-avatar ticket-avatar">B</span><span><strong>{bilet.number}-bilet</strong><small>{bilet.title || `Variant ${bilet.number}`}</small></span></div></td>
                  <td><div className="count-cell"><strong>{count}</strong><span> / 20 savol</span><div className="mini-progress"><i style={{ width: `${Math.min(count / 20 * 100, 100)}%` }} /></div></div></td>
                  <td><span className={`badge ${count >= 20 ? 'badge-success' : 'badge-warning'}`}><i />{count >= 20 ? 'Tayyor' : 'To‘ldirilmoqda'}</span></td>
                  <td><div className="row-actions"><Link className="button button-quiet button-small" to={`/questions?bilet=${bilet.id}`}>Savollarini ko‘rish</Link></div></td>
                </tr>
              })}
        </tbody></table></div>
      </section>
    </>
  )
}
