import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader } from '../App'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import type { Category, CategoryKind } from '../lib/types'
import { getErrorMessage } from '../lib/types'
import { fetchQuestionCounts } from '../lib/questionCounts'

const KIND_LABELS: Record<CategoryKind, string> = { TOPIC: 'Mavzu', ROAD_SIGN: 'Yo‘l belgilari', CHEATSHEET: 'Shpargalka' }

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [kind, setKind] = useState('')
  const [editing, setEditing] = useState<Category | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const [{ data, error: categoryError }, questionCounts] = await Promise.all([
        client.from('categories').select('id,name,kind,sort_order,is_deleted').eq('is_deleted', false).order('sort_order').order('name'),
        fetchQuestionCounts('category_id'),
      ])
      if (categoryError) throw categoryError
      setCategories((data || []) as Category[])
      setCounts(questionCounts)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function remove(category: Category) {
    if (!window.confirm(`“${category.name}” kategoriyasini o‘chirilgan deb belgilaysizmi?`)) return
    try {
      const { error: updateError } = await requireSupabase().from('categories').update({ is_deleted: true }).eq('id', category.id)
      if (updateError) throw updateError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  const visible = kind ? categories.filter((category) => category.kind === kind) : categories

  return (
    <>
      <PageHeader title="Kategoriyalar" description="Mavzular, yo‘l belgilari va shpargalka bo‘limlarini sozlang." action={<button className="button button-primary" onClick={() => setEditing(null)}>＋ Kategoriya qo‘shish</button>} />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar category-filter">
          <div className="filter-tabs"><button className={!kind ? 'selected' : ''} onClick={() => setKind('')}>Barchasi</button>{(Object.keys(KIND_LABELS) as CategoryKind[]).map((value) => <button key={value} className={kind === value ? 'selected' : ''} onClick={() => setKind(value)}>{KIND_LABELS[value]}</button>)}</div>
          <span className="count-pill">{visible.length} ta kategoriya</span>
        </div>
        <div className="table-scroll"><table><thead><tr><th>NOMI</th><th>TURI</th><th>SARALASH</th><th>SAVOLLAR</th><th className="align-right">AMALLAR</th></tr></thead><tbody>
          {loading ? <tr><td className="table-state" colSpan={5}>Kategoriyalar yuklanmoqda…</td></tr>
            : visible.length === 0 ? <tr><td className="table-state" colSpan={5}>Kategoriyalar hali qo‘shilmagan.</td></tr>
              : visible.map((category) => <tr key={category.id}>
                <td><div className="question-cell"><span className={`row-avatar ${category.kind === 'ROAD_SIGN' ? 'ticket-avatar' : ''}`}>{category.kind === 'ROAD_SIGN' ? '↗' : category.kind === 'CHEATSHEET' ? '✧' : 'M'}</span><strong>{category.name}</strong></div></td>
                <td><span className="tag tag-blue">{KIND_LABELS[category.kind]}</span></td><td>{category.sort_order}</td><td><strong>{counts[category.id] || 0}</strong> <span className="muted">ta savol</span></td>
                <td><div className="row-actions"><button className="button button-quiet button-small" onClick={() => setEditing(category)}>Tahrirlash</button><button className="icon-button danger-icon" title="Soft delete" onClick={() => void remove(category)}>⌫</button></div></td>
              </tr>)}
        </tbody></table></div>
      </section>
      {editing !== undefined && <CategoryEditor category={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load() }} />}
    </>
  )
}

function CategoryEditor({ category, onClose, onSaved }: { category: Category | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(category?.name || '')
  const [kind, setKind] = useState<CategoryKind>(category?.kind || 'TOPIC')
  const [sortOrder, setSortOrder] = useState(category?.sort_order.toString() || '0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = { name: name.trim(), kind, sort_order: Number(sortOrder) }
      const client = requireSupabase()
      const result = category
        ? await client.from('categories').update(payload).eq('id', category.id)
        : await client.from('categories').insert(payload)
      if (result.error) throw result.error
      onSaved()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={category ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya'} onClose={onClose} onSubmit={submit} busy={busy} submitLabel={category ? 'Saqlash' : 'Kategoriya yaratish'}>
    {error && <Notice message={error} />}
    <label className="field"><span>Nomi *</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
    <div className="form-grid">
      <label className="field"><span>Kategoriya turi</span><select value={kind} onChange={(event) => setKind(event.target.value as CategoryKind)}>{(Object.keys(KIND_LABELS) as CategoryKind[]).map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}</select></label>
      <label className="field"><span>Saralash tartibi</span><input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
    </div>
  </Modal>
}
