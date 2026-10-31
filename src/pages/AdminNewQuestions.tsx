import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../App'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { ImageListEditor } from '../components/ImageListEditor'
import { requireSupabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/types'

const PAGE_SIZE = 25

interface AdminNewQuestion {
  id: number
  lesson_id: number | null
  text: string
  options: string[]
  correct_index: number
  image_url: string | null
  image_urls?: string[]
  explanation: string | null
  explanation_image_url: string | null
  explanation_image_urls?: string[]
  created_at: string
  ticket_number?: number
  ticket_position?: number
}

interface LessonOption {
  id: number
  label: string
}

interface Draft {
  lesson_id: number | null
  text: string
  options: string[]
  correct_index: number
  image_urls: string[]
  explanation: string
  explanation_image_urls: string[]
}

const emptyDraft = (): Draft => ({
  lesson_id: null,
  text: '',
  options: [''],
  correct_index: 0,
  image_urls: [],
  explanation: '',
  explanation_image_urls: [],
})

export default function AdminNewQuestions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState<AdminNewQuestion[]>([])
  const [lessonOptions, setLessonOptions] = useState<LessonOption[]>([])
  const [count, setCount] = useState(0)
  const [query, setQuery] = useState('')
  const [ticketFilter, setTicketFilter] = useState('')
  const [ticketNumbers, setTicketNumbers] = useState<number[]>([])
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<AdminNewQuestion | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const [questionsCountResult, sectionsResult, lessonsResult, baseCountResult, assignedCountResult] = await Promise.all([
        client.from('admin_new_questions').select('id', { count: 'exact', head: true })
          .eq('is_deleted', false).is('lesson_id', null),
        client.from('base_sections').select('id,name').order('sort_order'),
        client.from('base_lessons').select('id,section_id,title,sort_order').order('section_id').order('sort_order'),
        client.from('questions').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
        client.from('admin_new_questions').select('id', { count: 'exact', head: true })
          .eq('is_deleted', false).not('lesson_id', 'is', null),
      ])
      if (questionsCountResult.error) throw questionsCountResult.error
      if (sectionsResult.error) throw sectionsResult.error
      if (lessonsResult.error) throw lessonsResult.error
      if (baseCountResult.error) throw baseCountResult.error
      if (assignedCountResult.error) throw assignedCountResult.error
      const questionRows: AdminNewQuestion[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: questionsError } = await client.from('admin_new_questions').select('*')
          .eq('is_deleted', false).is('lesson_id', null).order('id').range(offset, offset + 499)
        if (questionsError) throw questionsError
        questionRows.push(...((data || []) as AdminNewQuestion[]))
        if (!data || data.length < 500) break
      }
      const sectionNames = new Map((sectionsResult.data || []).map((section) => [
        section.id,
        section.name?.['uz-Latn'] || section.name?.ru || 'Bo‘lim',
      ]))
      const regularQuestionCount = (baseCountResult.count || 0) + (assignedCountResult.count || 0)
      const firstAdminTicket = Math.ceil(regularQuestionCount / 20) + 1
      const ticketedRows = questionRows.map((question, index) => ({
        ...question,
        ticket_number: firstAdminTicket + Math.floor(index / 20),
        ticket_position: (index % 20) + 1,
      }))
      const search = query.trim().toLocaleLowerCase()
      const filteredRows = ticketFilter
        ? ticketedRows.filter((question) => question.ticket_number === Number(ticketFilter))
        : ticketedRows
      const searchedRows = search
        ? filteredRows.filter((question) =>
          question.text.toLocaleLowerCase().includes(search)
          || question.options.some((option) => option.toLocaleLowerCase().includes(search)))
        : filteredRows
      setRows(searchedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE))
      setCount(searchedRows.length)
      setTicketNumbers(Array.from(
        { length: Math.ceil(ticketedRows.length / 20) },
        (_, index) => firstAdminTicket + index,
      ))
      setLessonOptions((lessonsResult.data || []).map((lesson) => ({
        id: lesson.id,
        label: `${sectionNames.get(lesson.section_id) || 'Bo‘lim'} · ${lesson.title?.['uz-Latn'] || lesson.title?.ru || `Dars ${lesson.id}`}`,
      })))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [page, query, ticketFilter])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const editId = Number(searchParams.get('edit'))
    if (!Number.isInteger(editId) || editId <= 0) return
    void (async () => {
      try {
        const { data, error: fetchError } = await requireSupabase()
          .from('admin_new_questions').select('*').eq('id', editId).maybeSingle()
        if (fetchError) throw fetchError
        if (!data) throw new Error('Tahrirlash uchun savol topilmadi.')
        setEditing(data as AdminNewQuestion)
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('edit')
        setSearchParams(nextParams, { replace: true })
      } catch (reason) {
        setError(getErrorMessage(reason))
      }
    })()
  }, [searchParams, setSearchParams])

  async function remove(question: AdminNewQuestion) {
    if (!window.confirm('Admin savolini o‘chirasizmi? O‘zgarish desktop ilovalarga sync qilinadi.')) return
    try {
      const { error: updateError } = await requireSupabase()
        .from('admin_new_questions')
        .update({ is_deleted: true })
        .eq('id', question.id)
      if (updateError) throw updateError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader
        title="Admin savollari"
        description="Faqat yangi deb belgilangan admin savollari. Darsga biriktirilgan savollar Savollar bo‘limida ko‘rinadi."
        action={<button className="button button-primary" onClick={() => setEditing(null)}>＋ Savol qo‘shish</button>}
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="section-intro">
          <div><h2>Admin qo‘shgan savollar</h2><p>Yangi savollar umumiy variantlarning oxirida biletlar bo‘yicha joylashadi.</p></div>
          <span className="count-pill">{count} ta admin savoli</span>
        </div>
        <div className="filter-bar">
          <label className="search-field"><span>⌕</span><input placeholder="Savol yoki javob variantidan qidirish…" value={query} onChange={(event) => { setPage(0); setQuery(event.target.value) }} /></label>
          <select className="filter-select" value={ticketFilter} onChange={(event) => { setPage(0); setTicketFilter(event.target.value) }}>
            <option value="">Barcha biletlar</option>
            {ticketNumbers.map((number) => <option key={number} value={number}>{number}-bilet</option>)}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>SAVOL</th><th>BILET</th><th>HOLATI</th><th className="align-right">AMALLAR</th></tr></thead>
            <tbody>
              {loading ? <tr><td className="table-state" colSpan={4}>Savollar yuklanmoqda…</td></tr>
                : rows.length === 0 ? <tr><td className="table-state" colSpan={4}>{query || ticketFilter ? 'Bu filtr bo‘yicha admin savoli topilmadi.' : 'Admin savollari hali qo‘shilmagan.'}</td></tr>
                  : rows.map((question) => {
                    return (
                      <tr key={question.id}>
                        <td><div className="question-cell"><span className="row-avatar">Q</span><span className="truncate"><strong>{question.text}</strong><small>{question.options.length} ta javob varianti</small></span></div></td>
                        <td><span className="cell-primary">{question.ticket_number}-bilet · {question.ticket_position}-savol</span></td>
                        <td><span className="badge badge-success"><i />Chop etilgan</span></td>
                        <td><div className="row-actions"><button className="button button-quiet button-small" onClick={() => setEditing(question)}>Tahrirlash</button><button className="icon-button danger-icon" title="O‘chirish" onClick={() => void remove(question)}>⌫</button></div></td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>{count.toLocaleString()} ta admin savoli</span><div className="pagination"><button className="button button-quiet button-small" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>← Oldingi</button><span>{page + 1} / {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span><button className="button button-quiet button-small" onClick={() => setPage((current) => current + 1)} disabled={(page + 1) * PAGE_SIZE >= count}>Keyingi →</button></div></div>
      </section>
      {editing !== undefined && (
        <NewQuestionEditor
          question={editing}
          lessons={lessonOptions}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); void load() }}
        />
      )}
    </>
  )
}

function NewQuestionEditor({
  question,
  lessons,
  onClose,
  onSaved,
}: {
  question: AdminNewQuestion | null
  lessons: LessonOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => question ? {
    lesson_id: question.lesson_id,
    text: question.text,
    options: [...question.options],
    correct_index: question.correct_index,
    image_urls: question.image_urls?.length ? [...question.image_urls] : question.image_url ? [question.image_url] : [],
    explanation: question.explanation || '',
    explanation_image_urls: question.explanation_image_urls?.length ? [...question.explanation_image_urls] : question.explanation_image_url ? [question.explanation_image_url] : [],
  } : emptyDraft())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function uploadImages(files: File[], field: 'image_urls' | 'explanation_image_urls') {
    setBusy(true)
    setError('')
    try {
      const storage = requireSupabase().storage.from('pdd-images')
      for (const file of files) {
        const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-')
        const path = `questions/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await storage.upload(path, file, { upsert: false })
        if (uploadError) throw uploadError
        const imageUrl = storage.getPublicUrl(path).data.publicUrl
        setDraft((current) => ({ ...current, [field]: [...current[field], imageUrl] }))
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
      setError('To‘g‘ri javob sifatida bo‘sh variant tanlangan.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        lesson_id: draft.lesson_id,
        text: draft.text.trim(),
        options,
        correct_index: draft.options.slice(0, draft.correct_index).filter((option) => option.trim()).length,
        image_urls: draft.image_urls,
        image_url: draft.image_urls[0] || null,
        explanation: draft.explanation.trim() || null,
        explanation_image_urls: draft.explanation_image_urls,
        explanation_image_url: draft.explanation_image_urls[0] || null,
      }
      const client = requireSupabase()
      const result = question
        ? await client.from('admin_new_questions').update(payload).eq('id', question.id)
        : await client.from('admin_new_questions').insert(payload)
      if (result.error) throw result.error
      onSaved()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={question ? 'Yangi savolni tahrirlash' : 'Yangi savol qo‘shish'} onClose={onClose} onSubmit={submit} busy={busy} submitLabel={question ? 'Saqlash' : 'Savol qo‘shish'}>
      {error && <Notice message={error} />}
      <label className="field"><span>Joylashuvi</span><select value={draft.lesson_id ?? ''} onChange={(event) => update('lesson_id', event.target.value ? Number(event.target.value) : null)}><option value="">Yangi savol — umumiy imtihon va variantlar oxiri</option>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.label}</option>)}</select></label>
      <p className="field-hint">Dars tanlansa savol o‘sha darsga va umumiy variantlarga qo‘shiladi. “Yangi savol” tanlansa, variantlar oxiriga qo‘shilib haqiqiy imtihonda ham tasodifiy tushadi.</p>
      <label className="field"><span>Savol matni *</span><textarea rows={3} value={draft.text} onChange={(event) => update('text', event.target.value)} required /></label>
      <div className="field">
        <span>Javoblar (to‘g‘ri javobni belgilang) *</span>
        <div className="option-editor">{draft.options.map((option, index) => {
          const label = index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
          return <label className={`option-input${draft.correct_index === index ? ' correct-option' : ''}`} key={index}><input type="radio" name="new-question-correct" checked={draft.correct_index === index} onChange={() => update('correct_index', index)} /><b>{label}</b><input value={option} placeholder={`${label} javob`} onChange={(event) => update('options', draft.options.map((current, optionIndex) => optionIndex === index ? event.target.value : current))} /></label>
        })}</div>
        <button type="button" className="button button-quiet button-small option-add" onClick={() => update('options', [...draft.options, ''])}>＋ Variant qo‘shish</button>
      </div>
      <ImageListEditor label="Savol rasmlari" images={draft.image_urls} busy={busy} onChange={(images) => update('image_urls', images)} onUpload={(files) => uploadImages(files, 'image_urls')} />
      <label className="field"><span>Tushuntirish</span><textarea rows={2} value={draft.explanation} onChange={(event) => update('explanation', event.target.value)} /></label>
      <ImageListEditor label="Tushuntirish rasmlari" images={draft.explanation_image_urls} busy={busy} onChange={(images) => update('explanation_image_urls', images)} onUpload={(files) => uploadImages(files, 'explanation_image_urls')} />
    </Modal>
  )
}
