import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../App'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { ImageListEditor } from '../components/ImageListEditor'
import { requireSupabase } from '../lib/supabase'
import type { Bilet, Question } from '../lib/types'
import { getErrorMessage } from '../lib/types'

const PAGE_SIZE = 25
type QuestionDraft = Omit<Question, 'id' | 'created_at' | 'is_deleted'>
type QuestionListItem = Question & { admin_question_id?: number; lesson_label?: string }

function blankQuestion(): QuestionDraft {
  return {
    bilet_id: null,
    bilet_position: null,
    category_id: null,
    text: '',
    options: [''],
    correct_index: 0,
    image_url: null,
    image_urls: [],
    explanation: null,
    explanation_image_url: null,
    explanation_image_urls: [],
    sign_code: null,
    is_tricky: false,
    is_road_sign: false,
    is_numeric: false,
    status: 'DRAFT',
  }
}

export default function Questions() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [questions, setQuestions] = useState<QuestionListItem[]>([])
  const [bilets, setBilets] = useState<Bilet[]>([])
  const [query, setQuery] = useState('')
  const [biletFilter, setBiletFilter] = useState(searchParams.get('bilet') || '')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<QuestionListItem | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const search = query.trim()
      const [baseCountResult, biletResult, lessonResult, assignedCountResult] = await Promise.all([
        client.from('questions').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
        client.from('bilets').select('id,number,title,is_deleted').eq('is_deleted', false).order('number'),
        client.from('base_lessons').select('id,section_id,title'),
        client.from('admin_new_questions').select('id', { count: 'exact', head: true })
          .eq('is_deleted', false).not('lesson_id', 'is', null),
      ])
      if (baseCountResult.error) throw baseCountResult.error
      if (biletResult.error) throw biletResult.error
      if (lessonResult.error) throw lessonResult.error
      if (assignedCountResult.error) throw assignedCountResult.error

      const baseQuestions: Question[] = []
      for (let offset = 0; ; offset += 500) {
        let request = client.from('questions').select('*').eq('is_deleted', false)
        if (search) request = request.ilike('text', `%${search}%`)
        if (biletFilter && !biletFilter.startsWith('admin-added-')) request = request.eq('bilet_id', biletFilter)
        const { data, error: baseError } = await request
          .order('bilet_id', { ascending: true, nullsFirst: false })
          .order('bilet_position', { ascending: true, nullsFirst: false })
          .range(offset, offset + 499)
        if (baseError) throw baseError
        baseQuestions.push(...((data || []) as Question[]))
        if (!data || data.length < 500) break
      }

      const assignedQuestions: Record<string, unknown>[] = []
      for (let offset = 0; ; offset += 500) {
        const request = client.from('admin_new_questions').select('*')
          .eq('is_deleted', false).not('lesson_id', 'is', null)
        const { data, error: assignedError } = await request.order('id').range(offset, offset + 499)
        if (assignedError) throw assignedError
        assignedQuestions.push(...(data || []))
        if (!data || data.length < 500) break
      }

      const lessons = new Map((lessonResult.data || []).map((lesson) => [
        lesson.id,
        lesson.title?.['uz-Latn'] || lesson.title?.ru || `Dars ${lesson.id}`,
      ]))
      const allBilets = (biletResult.data || []) as Bilet[]
      const baseCount = baseCountResult.count || 0
      const assignedRows: QuestionListItem[] = assignedQuestions.map((row, index) => {
        const ticketNumber = Math.floor((baseCount + index) / 20) + 1
        const ticket = allBilets.find(({ number }) => number === ticketNumber)
        const images = Array.isArray(row.image_urls) ? row.image_urls as string[] : []
        const explanationImages = Array.isArray(row.explanation_image_urls) ? row.explanation_image_urls as string[] : []
        return {
          id: String(row.id),
          admin_question_id: Number(row.id),
          bilet_id: ticket?.id || `admin-added-${ticketNumber}`,
          bilet_position: ((baseCount + index) % 20) + 1,
          category_id: null,
          text: String(row.text || ''),
          options: Array.isArray(row.options) ? row.options as string[] : [],
          correct_index: Number(row.correct_index || 0),
          image_url: images[0] || String(row.image_url || '') || null,
          image_urls: images,
          explanation: String(row.explanation || '') || null,
          explanation_image_url: explanationImages[0] || String(row.explanation_image_url || '') || null,
          explanation_image_urls: explanationImages,
          sign_code: null,
          is_tricky: false,
          is_road_sign: false,
          is_numeric: false,
          status: 'PUBLISHED',
          is_deleted: false,
          created_at: String(row.created_at || ''),
          lesson_label: lessons.get(Number(row.lesson_id)) || `Dars ${row.lesson_id}`,
        }
      })
      const lastTicketNumber = Math.ceil((baseCount + (assignedCountResult.count || 0)) / 20)
      for (let number = 1; number <= lastTicketNumber; number++) {
        if (!allBilets.some((bilet) => bilet.number === number)) {
          allBilets.push({ id: `admin-added-${number}`, number, title: `Variant ${number}`, is_deleted: false })
        }
      }
      const merged = [...baseQuestions, ...assignedRows]
        .filter((question) => (!biletFilter || question.bilet_id === biletFilter)
          && (!search || question.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
        .sort((left, right) => {
          const leftTicket = allBilets.find(({ id }) => id === left.bilet_id)?.number ?? Number.MAX_SAFE_INTEGER
          const rightTicket = allBilets.find(({ id }) => id === right.bilet_id)?.number ?? Number.MAX_SAFE_INTEGER
          return leftTicket - rightTicket
            || (left.bilet_position ?? Number.MAX_SAFE_INTEGER) - (right.bilet_position ?? Number.MAX_SAFE_INTEGER)
            || left.created_at.localeCompare(right.created_at)
        })
      setQuestions(merged.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE))
      setTotal(merged.length)
      setBilets(allBilets)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [biletFilter, page, query])

  useEffect(() => { void load() }, [load])

  async function softDelete(question: QuestionListItem) {
    if (!window.confirm('Savolni o‘chirilgan deb belgilaysizmi? Bu o‘zgarish desktop ilovalarga sync orqali yetib boradi.')) return
    try {
      const result = question.admin_question_id
        ? await requireSupabase().from('admin_new_questions').update({ is_deleted: true }).eq('id', question.admin_question_id)
        : await requireSupabase().from('questions').update({ is_deleted: true }).eq('id', question.id)
      const updateError = result.error
      if (updateError) throw updateError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function publish(question: QuestionListItem) {
    try {
      if (question.admin_question_id) return
      const { error: updateError } = await requireSupabase().from('questions').update({ status: 'PUBLISHED' }).eq('id', question.id)
      if (updateError) throw updateError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader title="Savollar" description="Asosiy baza va darslarga biriktirilgan savollarni boshqaring." />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar">
          <label className="search-field"><span>⌕</span><input placeholder="Savol matnidan qidirish…" value={query} onChange={(event) => { setPage(0); setQuery(event.target.value) }} /></label>
          <select className="filter-select" value={biletFilter} onChange={(event) => { setPage(0); setBiletFilter(event.target.value) }}><option value="">Barcha biletlar</option>{bilets.map((bilet) => <option key={bilet.id} value={bilet.id}>{bilet.number}-bilet</option>)}</select>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>SAVOL</th><th>BILET</th><th>HOLATI</th><th className="align-right">AMALLAR</th></tr></thead>
            <tbody>
              {loading ? <tr><td className="table-state" colSpan={4}>Savollar yuklanmoqda…</td></tr>
                : questions.length === 0 ? <tr><td className="table-state" colSpan={4}>Bu filtr bo‘yicha savol topilmadi.</td></tr>
                  : questions.map((question) => {
                    const bilet = bilets.find((item) => item.id === question.bilet_id)
                    return (
                      <tr key={question.id}>
                        <td><div className="question-cell"><span className="row-avatar">Q</span><span className="truncate"><strong>{question.text}</strong><small>{question.options?.length || 0} ta javob varianti</small></span></div></td>
                        <td><span className="cell-primary">{bilet ? `${bilet.number}-bilet${question.bilet_position ? ` · ${question.bilet_position}-savol` : ''}` : 'Biletsiz'}</span>{question.lesson_label && <small className="question-source-label">{question.lesson_label}</small>}</td>
                        <td><span className={`badge ${question.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'}`}><i />{question.status === 'PUBLISHED' ? 'Chop etilgan' : 'Qoralama'}</span></td>
                        <td><div className="row-actions">{!question.admin_question_id && question.status === 'DRAFT' && <button className="text-button success-text" onClick={() => void publish(question)}>Nashr</button>}{question.admin_question_id ? <button className="icon-button" title="Tahrirlash" onClick={() => navigate(`/new-questions?edit=${question.admin_question_id}`)}>✎</button> : <button className="icon-button" title="Tahrirlash" onClick={() => setEditing(question)}>✎</button>}<button className="icon-button danger-icon" title="O‘chirish" onClick={() => void softDelete(question)}>⌫</button></div></td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>{total.toLocaleString()} ta savol</span><div className="pagination"><button className="button button-quiet button-small" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>← Oldingi</button><span>{page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><button className="button button-quiet button-small" onClick={() => setPage((current) => current + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>Keyingi →</button></div></div>
      </section>
      {editing !== undefined && <QuestionEditor question={editing} bilets={bilets} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load() }} />}
    </>
  )
}

function QuestionEditor({ question, bilets, onClose, onSaved }: { question: QuestionListItem | null; bilets: Bilet[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<QuestionDraft>(() => {
    if (!question) return blankQuestion()
    const options = [...question.options]
    while (options.length < 2) options.push('')
    return {
      bilet_id: question.bilet_id,
      bilet_position: question.bilet_position,
      category_id: question.category_id,
      text: question.text,
      options,
      correct_index: question.correct_index,
      image_url: question.image_url,
      image_urls: question.image_urls?.length ? [...question.image_urls] : question.image_url ? [question.image_url] : [],
      explanation: question.explanation,
      explanation_image_url: question.explanation_image_url,
      explanation_image_urls: question.explanation_image_urls?.length ? [...question.explanation_image_urls] : question.explanation_image_url ? [question.explanation_image_url] : [],
      sign_code: question.sign_code,
      is_tricky: question.is_tricky,
      is_road_sign: question.is_road_sign,
      is_numeric: question.is_numeric,
      status: question.status,
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function update<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function uploadImages(files: File[], field: 'image_urls' | 'explanation_image_urls') {
    setError('')
    setBusy(true)
    try {
      const storage = requireSupabase().storage.from('pdd-images')
      for (const file of files) {
        const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-')
        const path = `questions/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await storage.upload(path, file, { upsert: false })
        if (uploadError) throw uploadError
        const { data } = storage.getPublicUrl(path)
        setDraft((current) => ({ ...current, [field]: [...current[field], data.publicUrl] }))
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const options = draft.options.map((option) => option.trim()).filter(Boolean)
    if (options.length < 2) {
      setError('Kamida ikkita javob variantini to‘ldiring.')
      return
    }
    if (!draft.options[draft.correct_index]?.trim()) {
      setError('To‘g‘ri javob sifatida bo‘sh variant tanlangan. Avval uni to‘ldiring.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...draft,
        options,
        image_url: draft.image_urls[0] || null,
        explanation_image_url: draft.explanation_image_urls[0] || null,
        bilet_position: draft.bilet_id && draft.bilet_position ? Number(draft.bilet_position) : null,
        correct_index: draft.options.slice(0, draft.correct_index).filter((option) => option.trim()).length,
      }
      const client = requireSupabase()
      const result = question
        ? await client.from('questions').update(payload).eq('id', question.id)
        : await client.from('questions').insert(payload)
      if (result.error) throw result.error
      onSaved()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={question ? 'Savolni tahrirlash' : 'Yangi savol'} onClose={onClose} onSubmit={submit} busy={busy} submitLabel={question ? 'O‘zgarishlarni saqlash' : 'Savol yaratish'}>
      {error && <Notice message={error} />}
      <label className="field"><span>Savol matni *</span><textarea rows={3} value={draft.text} onChange={(event) => update('text', event.target.value)} required /></label>
      <div className="form-grid">
        <label className="field"><span>Bilet</span><select value={draft.bilet_id || ''} onChange={(event) => update('bilet_id', event.target.value || null)}><option value="">Biletsiz</option>{bilets.map((bilet) => <option key={bilet.id} value={bilet.id}>{bilet.number}-bilet</option>)}</select></label>
        <label className="field"><span>Biletdagi tartib</span><input type="number" min="1" value={draft.bilet_position || ''} onChange={(event) => update('bilet_position', event.target.value ? Number(event.target.value) : null)} disabled={!draft.bilet_id} /></label>
        <label className="field"><span>Holati</span><select value={draft.status} onChange={(event) => update('status', event.target.value as QuestionDraft['status'])}><option value="DRAFT">Qoralama</option><option value="PUBLISHED">Chop etilgan</option></select></label>
      </div>
      <div className="field">
        <span>Javob variantlari *</span>
        <div className="option-editor">{draft.options.map((option, index) => {
          const label = index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
          return <label className={`option-input${draft.correct_index === index ? ' correct-option' : ''}`} key={index}><input type="radio" name="correct-option" checked={draft.correct_index === index} onChange={() => update('correct_index', index)} /><b>{label}</b><input value={option} placeholder={`${label} javob`} onChange={(event) => update('options', draft.options.map((current, optionIndex) => optionIndex === index ? event.target.value : current))} /></label>
        })}</div>
        <button type="button" className="button button-quiet button-small option-add" onClick={() => update('options', [...draft.options, ''])}>＋ Variant qo‘shish</button>
      </div>
      <ImageListEditor label="Savol rasmlari" images={draft.image_urls} busy={busy} onChange={(images) => update('image_urls', images)} onUpload={(files) => uploadImages(files, 'image_urls')} />
      <label className="field"><span>Tushuntirish / shpargalka</span><textarea rows={2} value={draft.explanation || ''} onChange={(event) => update('explanation', event.target.value || null)} /></label>
      <ImageListEditor label="Tushuntirish rasmlari" images={draft.explanation_image_urls} busy={busy} onChange={(images) => update('explanation_image_urls', images)} onUpload={(files) => uploadImages(files, 'explanation_image_urls')} />
    </Modal>
  )
}
