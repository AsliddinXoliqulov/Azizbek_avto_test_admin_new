import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { ImageListEditor } from '../components/ImageListEditor'
import { TranslateButton } from '../components/TranslateButton'
import { fetchAutoVariantCatalog } from '../lib/autoVariants'
import { requireSupabase } from '../lib/supabase'
import {
  getErrorMessage,
  QUESTION_LOCALES,
  QUESTION_LOCALE_LABELS,
} from '../lib/types'
import type { LocalizedText, QuestionLocale } from '../lib/types'

const PAGE_SIZE = 25

export interface AdminNewQuestion {
  id: number
  lesson_id: number | null
  is_new: boolean
  is_numeric: boolean
  is_similar: boolean
  text: string
  text_i18n?: Partial<LocalizedText>
  options: string[]
  options_i18n?: Partial<LocalizedText>[]
  correct_index: number
  image_url: string | null
  image_urls?: string[]
  explanation: string | null
  explanation_i18n?: Partial<LocalizedText> | null
  explanation_image_url: string | null
  explanation_image_urls?: string[]
  created_at: string
  ticket_number?: number
  ticket_position?: number
}

interface NewQuestionRow {
  key: string
  source: 'base' | 'admin_new'
  id: number
  lesson_id: number | null
  is_new: boolean
  is_numeric: boolean
  is_similar: boolean
  text: string
  text_i18n?: Partial<LocalizedText> | null
  options: string[]
  correct_index: number
  created_at: string
  ticket_number?: number
  ticket_position?: number
  admin_question?: AdminNewQuestion
}

export interface LessonOption {
  id: number
  label: string
}

interface Draft {
  lesson_id: number | null
  is_new: boolean
  is_numeric: boolean
  is_similar: boolean
  text: LocalizedText
  options: string[]
  options_i18n: LocalizedText[]
  correct_index: number
  image_urls: string[]
  explanation: LocalizedText
  explanation_image_urls: string[]
}

const emptyDraft = (): Draft => ({
  lesson_id: null,
  is_new: true,
  is_numeric: false,
  is_similar: false,
  text: { 'uz-Latn': '', 'uz-Cyrl': '', ru: '' },
  options: [''],
  options_i18n: [{ 'uz-Latn': '', 'uz-Cyrl': '', ru: '' }],
  correct_index: 0,
  image_urls: [],
  explanation: { 'uz-Latn': '', 'uz-Cyrl': '', ru: '' },
  explanation_image_urls: [],
})

export default function AdminNewQuestions() {
  const confirm = useConfirm()

  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [rows, setRows] = useState<NewQuestionRow[]>([])
  const [lessonOptions, setLessonOptions] = useState<LessonOption[]>([])
  const [count, setCount] = useState(0)
  const [query, setQuery] = useState('')
  const [ticketFilter, setTicketFilter] = useState('')
  const [ticketNumbers, setTicketNumbers] = useState<number[]>([])
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<AdminNewQuestion | null | undefined>(
    undefined
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const [sectionsResult, lessonsResult, catalog, baseNewResult] =
        await Promise.all([
          client
            .from('base_sections')
            .select('id,name')
            .eq('is_deleted', false)
            .order('sort_order'),
          client
            .from('base_lessons')
            .select('id,section_id,title,sort_order')
            .eq('is_deleted', false)
            .order('section_id')
            .order('sort_order'),
          fetchAutoVariantCatalog(),
          fetchRows<Record<string, unknown>>((from, to) =>
            client
              .from('base_questions')
              .select(
                'id,lesson_id,is_new,is_numeric,is_similar,text,created_at'
              )
              .eq('is_deleted', false)
              .eq('is_new', true)
              .order('id')
              .range(from, to)
          ),
        ])
      if (sectionsResult.error) throw sectionsResult.error
      if (lessonsResult.error) throw lessonsResult.error
      const questionRows: AdminNewQuestion[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: questionsError } = await client
          .from('admin_new_questions')
          .select('*')
          .eq('is_deleted', false)
          .eq('is_new', true)
          .order('id')
          .range(offset, offset + 499)
        if (questionsError) throw questionsError
        questionRows.push(...((data || []) as AdminNewQuestion[]))
        if (!data || data.length < 500) break
      }
      const sectionNames = new Map(
        (sectionsResult.data || []).map((section) => [
          section.id,
          section.name?.['uz-Latn'] || section.name?.ru || 'Bo‘lim',
        ])
      )
      const catalogRowsByKey = new Map(
        catalog.questions.map((question) => [question.key, question])
      )
      const adminRows: NewQuestionRow[] = questionRows.map((question) => {
        const catalogQuestion = catalogRowsByKey.get(`admin_new:${question.id}`)
        return {
          key: `admin_new:${question.id}`,
          source: 'admin_new',
          id: question.id,
          lesson_id: question.lesson_id,
          is_new: question.is_new,
          is_numeric: question.is_numeric,
          is_similar: question.is_similar,
          text: question.text_i18n?.['uz-Latn'] || question.text,
          text_i18n: question.text_i18n,
          options: question.options,
          correct_index: question.correct_index,
          created_at: question.created_at,
          ticket_number: catalogQuestion?.variant_number,
          ticket_position: catalogQuestion?.variant_position,
          admin_question: question,
        }
      })
      const baseRows: NewQuestionRow[] = (baseNewResult || []).map(
        (question) => {
          const id = Number(question.id)
          const catalogQuestion = catalogRowsByKey.get(`base:${id}`)
          const text = question.text as Partial<LocalizedText>
          return {
            key: `base:${id}`,
            source: 'base',
            id,
            lesson_id:
              question.lesson_id == null ? null : Number(question.lesson_id),
            is_new: Boolean(question.is_new),
            is_numeric: Boolean(question.is_numeric),
            is_similar: Boolean(question.is_similar),
            text: text?.['uz-Latn'] || text?.ru || `Savol #${id}`,
            text_i18n: text,
            options: Array.from(
              { length: catalogQuestion?.option_count || 0 },
              () => ''
            ),
            correct_index: 0,
            created_at: String(question.created_at || ''),
            ticket_number: catalogQuestion?.variant_number,
            ticket_position: catalogQuestion?.variant_position,
          }
        }
      )
      const allNewRows = [...baseRows, ...adminRows].sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.key.localeCompare(b.key)
      )
      const search = query.trim().toLocaleLowerCase()
      const filteredRows = ticketFilter
        ? allNewRows.filter(
            (question) => question.ticket_number === Number(ticketFilter)
          )
        : allNewRows
      const searchedRows = search
        ? filteredRows.filter(
            (question) =>
              question.text.toLocaleLowerCase().includes(search) ||
              Object.values(question.text_i18n || {}).some((text) =>
                text?.toLocaleLowerCase().includes(search)
              ) ||
              question.options.some((option) =>
                option.toLocaleLowerCase().includes(search)
              )
          )
        : filteredRows
      setRows(
        searchedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
      )
      setCount(searchedRows.length)
      setTicketNumbers(
        catalog.variants
          .filter((variant) => variant.kind === 'admin-new')
          .map((variant) => variant.number)
      )
      setLessonOptions(
        (lessonsResult.data || []).map((lesson) => ({
          id: lesson.id,
          label: `${lesson.section_id == null ? 'Biriktirilmagan' : sectionNames.get(lesson.section_id) || 'Bo‘lim'} · ${lesson.title?.['uz-Latn'] || lesson.title?.ru || `Dars ${lesson.id}`}`,
        }))
      )
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [page, query, ticketFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const editId = Number(searchParams.get('edit'))
    if (!Number.isInteger(editId) || editId <= 0) return
    void (async () => {
      try {
        const { data, error: fetchError } = await requireSupabase()
          .from('admin_new_questions')
          .select('*')
          .eq('id', editId)
          .maybeSingle()
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
    const confirmed = await confirm({
      title: 'Savolni o‘chirish',
      message:
        'Admin savolini o‘chirasizmi? O‘zgarish desktop ilovalarga sync qilinadi.',
      confirmLabel: 'O‘chirish',
      danger: true,
    })
    if (!confirmed) return
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
        title="Yangi savollar"
        description="Yangi savol sifatida alohida belgilangan savollar. Darsga biriktirish bu tasnifga ta’sir qilmaydi."
        action={
          <button
            className="button button-primary"
            onClick={() => setEditing(null)}
          >
            ＋ Savol qo‘shish
          </button>
        }
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="section-intro">
          <div>
            <h2>Yangi deb belgilangan savollar</h2>
            <p>Dars tanlovi savolning tasnifini o‘zgartirmaydi.</p>
          </div>
          <span className="count-pill">{count} ta yangi savol</span>
        </div>
        <div className="filter-bar">
          <label className="search-field">
            <span>⌕</span>
            <input
              placeholder="Savol yoki javob variantidan qidirish…"
              value={query}
              onChange={(event) => {
                setPage(0)
                setQuery(event.target.value)
              }}
            />
          </label>
          <select
            className="filter-select"
            value={ticketFilter}
            onChange={(event) => {
              setPage(0)
              setTicketFilter(event.target.value)
            }}
          >
            <option value="">Barcha variantlar</option>
            {ticketNumbers.map((number) => (
              <option key={number} value={number}>
                {number}-variant
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>SAVOL</th>
                <th>VARIANT</th>
                <th>HOLATI</th>
                <th className="align-right">AMALLAR</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    Savollar yuklanmoqda…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    {query || ticketFilter
                      ? 'Bu filtr bo‘yicha yangi savol topilmadi.'
                      : 'Yangi deb belgilangan savollar hali yo‘q.'}
                  </td>
                </tr>
              ) : (
                rows.map((question) => {
                  const adminQuestion =
                    question.source === 'admin_new'
                      ? question.admin_question
                      : undefined
                  return (
                    <tr key={question.key}>
                      <td>
                        <div className="question-cell">
                          <span className="row-avatar">
                            {question.source === 'base' ? 'B' : 'Q'}
                          </span>
                          <span className="truncate">
                            <strong>
                              {question.text_i18n?.['uz-Latn'] || question.text}
                            </strong>
                            <small>
                              {question.options.length} ta javob varianti
                              {question.source === 'base'
                                ? ' · Asosiy baza'
                                : ''}
                              {question.is_numeric ? ' · Raqamli' : ''}
                              {question.is_similar ? ' · O‘xshash' : ''}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="cell-primary">
                          {question.ticket_number
                            ? `${question.ticket_number}-variant · ${question.ticket_position}-savol`
                            : 'Variantga kiritilmagan'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-success">
                          <i />
                          Chop etilgan
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {question.source === 'base' ? (
                            <button
                              className="button button-quiet button-small"
                              onClick={() =>
                                navigate(
                                  `/questions?sourceQuestion=${question.id}`
                                )
                              }
                            >
                              Tahrirlash
                            </button>
                          ) : (
                            adminQuestion && (
                              <>
                                <button
                                  className="button button-quiet button-small"
                                  onClick={() => setEditing(adminQuestion)}
                                >
                                  Tahrirlash
                                </button>
                                <button
                                  className="icon-button danger-icon"
                                  title="O‘chirish"
                                  onClick={() => void remove(adminQuestion)}
                                >
                                  🗑
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{count.toLocaleString()} ta yangi deb belgilangan savol</span>
          <div className="pagination">
            <button
              className="button button-quiet button-small"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              ← Oldingi
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(count / PAGE_SIZE))}
            </span>
            <button
              className="button button-quiet button-small"
              onClick={() => setPage((current) => current + 1)}
              disabled={(page + 1) * PAGE_SIZE >= count}
            >
              Keyingi →
            </button>
          </div>
        </div>
      </section>
      {editing !== undefined && (
        <NewQuestionEditor
          question={editing}
          lessons={lessonOptions}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            void load()
          }}
        />
      )}
    </>
  )
}

async function fetchRows<T>(
  request: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error: fetchError } = await request(from, from + 499)
    if (fetchError) throw fetchError
    rows.push(...(data || []))
    if (!data || data.length < 500) return rows
  }
}

export function NewQuestionEditor({
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
  const [draft, setDraft] = useState<Draft>(() =>
    question
      ? {
          lesson_id: question.lesson_id,
          is_new: question.is_new ?? true,
          is_numeric: question.is_numeric ?? false,
          is_similar: question.is_similar ?? false,
          text: {
            'uz-Latn': question.text_i18n?.['uz-Latn'] || question.text,
            'uz-Cyrl': question.text_i18n?.['uz-Cyrl'] || question.text,
            ru: question.text_i18n?.ru || question.text,
          },
          options: [...question.options],
          options_i18n: question.options.map((option, index) => ({
            'uz-Latn': question.options_i18n?.[index]?.['uz-Latn'] || option,
            'uz-Cyrl': question.options_i18n?.[index]?.['uz-Cyrl'] || option,
            ru: question.options_i18n?.[index]?.ru || option,
          })),
          correct_index: question.correct_index,
          image_urls: question.image_urls?.length
            ? [...question.image_urls]
            : question.image_url
              ? [question.image_url]
              : [],
          explanation: {
            'uz-Latn':
              question.explanation_i18n?.['uz-Latn'] ||
              question.explanation ||
              '',
            'uz-Cyrl':
              question.explanation_i18n?.['uz-Cyrl'] ||
              question.explanation ||
              '',
            ru: question.explanation_i18n?.ru || question.explanation || '',
          },
          explanation_image_urls: question.explanation_image_urls?.length
            ? [...question.explanation_image_urls]
            : question.explanation_image_url
              ? [question.explanation_image_url]
              : [],
        }
      : emptyDraft()
  )
  const [locale, setLocale] = useState<QuestionLocale>('uz-Latn')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function uploadImages(
    files: File[],
    field: 'image_urls' | 'explanation_image_urls'
  ) {
    setBusy(true)
    setError('')
    try {
      const storage = requireSupabase().storage.from('pdd-images')
      for (const file of files) {
        const safeName = file.name
          .normalize('NFKD')
          .replace(/[^a-zA-Z0-9._-]/g, '-')
        const path = `questions/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await storage.upload(path, file, {
          upsert: false,
        })
        if (uploadError) throw uploadError
        const imageUrl = storage.getPublicUrl(path).data.publicUrl
        setDraft((current) => ({
          ...current,
          [field]: [...current[field], imageUrl],
        }))
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (QUESTION_LOCALES.some((key) => !draft.text[key].trim())) {
      setError('Savol matnini uchala tilda ham to‘ldiring.')
      return
    }
    const optionIndexes = draft.options_i18n
      .map((option, index) =>
        QUESTION_LOCALES.some((key) => option[key].trim()) ? index : -1
      )
      .filter((index) => index >= 0)
    const options = optionIndexes.map((index) =>
      draft.options_i18n[index]['uz-Latn'].trim()
    )
    if (options.length < 2) {
      setError('Kamida ikkita javob variantini to‘ldiring.')
      return
    }
    if (
      optionIndexes.some((index) =>
        QUESTION_LOCALES.some((key) => !draft.options_i18n[index][key].trim())
      )
    ) {
      setError('Har bir javob variantini uchala tilda ham to‘ldiring.')
      return
    }
    if (!optionIndexes.includes(draft.correct_index)) {
      setError('To‘g‘ri javob sifatida bo‘sh variant tanlangan.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        lesson_id: draft.lesson_id,
        pending_lesson_id: null,
        pending_unassigned_at: null,
        is_new: draft.is_new,
        is_numeric: draft.is_numeric,
        is_similar: draft.is_similar,
        text: draft.text['uz-Latn'].trim(),
        text_i18n: Object.fromEntries(
          QUESTION_LOCALES.map((key) => [key, draft.text[key].trim()])
        ),
        options,
        options_i18n: optionIndexes.map((index) =>
          Object.fromEntries(
            QUESTION_LOCALES.map((key) => [
              key,
              draft.options_i18n[index][key].trim(),
            ])
          )
        ),
        correct_index: optionIndexes.indexOf(draft.correct_index),
        image_urls: draft.image_urls,
        image_url: draft.image_urls[0] || null,
        explanation: draft.explanation['uz-Latn'].trim() || null,
        explanation_i18n: Object.values(draft.explanation).some((text) =>
          text.trim()
        )
          ? Object.fromEntries(
              QUESTION_LOCALES.map((key) => [
                key,
                draft.explanation[key].trim(),
              ])
            )
          : null,
        explanation_image_urls: draft.explanation_image_urls,
        explanation_image_url: draft.explanation_image_urls[0] || null,
      }
      const client = requireSupabase()
      const result = question
        ? await client
            .from('admin_new_questions')
            .update(payload)
            .eq('id', question.id)
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
    <Modal
      title={question ? 'Yangi savolni tahrirlash' : 'Yangi savol qo‘shish'}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel={question ? 'Saqlash' : 'Savol qo‘shish'}
    >
      {error && <Notice message={error} />}
      <label className="field">
        <span>Darsga biriktirish</span>
        <select
          value={draft.lesson_id ?? ''}
          onChange={(event) =>
            update(
              'lesson_id',
              event.target.value ? Number(event.target.value) : null
            )
          }
        >
          <option value="">Dars tanlanmagan</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        Yangi savol, raqamli va o‘xshash savol tasniflari dars tanlovidan
        mustaqil.
      </p>
      <div className="checkbox-grid classification-grid">
        <label>
          <input
            type="checkbox"
            checked={draft.is_new}
            onChange={(event) => update('is_new', event.target.checked)}
          />{' '}
          Yangi savol
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.is_numeric}
            onChange={(event) => update('is_numeric', event.target.checked)}
          />{' '}
          Raqamli savol
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.is_similar}
            onChange={(event) => update('is_similar', event.target.checked)}
          />{' '}
          O‘xshash savollar to‘plamiga qo‘shish
        </label>
      </div>
      <div className="language-tabs" role="tablist" aria-label="Savol tili">
        {QUESTION_LOCALES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={locale === key}
            className={locale === key ? 'selected' : ''}
            onClick={() => setLocale(key)}
          >
            {QUESTION_LOCALE_LABELS[key]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Savol matni · {QUESTION_LOCALE_LABELS[locale]} *</span>
        <textarea
          rows={3}
          value={draft.text[locale]}
          onChange={(event) =>
            update('text', { ...draft.text, [locale]: event.target.value })
          }
          required
        />
      </label>
      <TranslateButton
        sourceText={draft.text['uz-Latn']}
        onTranslated={(translations) =>
          setDraft((current) => ({
            ...current,
            text: { ...current.text, ...translations },
          }))
        }
      />
      <div className="field">
        <span>Javoblar (to‘g‘ri javobni belgilang) *</span>
        <div className="option-editor">
          {draft.options_i18n.map((option, index) => {
            const label =
              index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
            return (
              <div
                className={`option-input localized-option-input${draft.correct_index === index ? ' correct-option' : ''}`}
                key={index}
              >
                <label className="option-answer-label">
                  <input
                    type="radio"
                    name="new-question-correct"
                    checked={draft.correct_index === index}
                    onChange={() => update('correct_index', index)}
                  />
                  <b>{label}</b>
                  <input
                    value={option[locale]}
                    placeholder={`${label} javob`}
                    onChange={(event) =>
                      update(
                        'options_i18n',
                        draft.options_i18n.map((current, optionIndex) =>
                          optionIndex === index
                            ? { ...current, [locale]: event.target.value }
                            : current
                        )
                      )
                    }
                  />
                </label>
                <TranslateButton
                  sourceText={option['uz-Latn']}
                  onTranslated={(translations) =>
                    setDraft((current) => ({
                      ...current,
                      options_i18n: current.options_i18n.map(
                        (answer, answerIndex) =>
                          answerIndex === index
                            ? { ...answer, ...translations }
                            : answer
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="icon-button danger-icon option-remove"
                  title="Javobni olib tashlash"
                  disabled={draft.options_i18n.length <= 1}
                  onClick={() => {
                    update(
                      'options_i18n',
                      draft.options_i18n.filter(
                        (_, optionIndex) => optionIndex !== index
                      )
                    )
                    update(
                      'options',
                      draft.options.filter(
                        (_, optionIndex) => optionIndex !== index
                      )
                    )
                    if (draft.correct_index === index)
                      update('correct_index', Math.max(0, index - 1))
                    else if (draft.correct_index > index)
                      update('correct_index', draft.correct_index - 1)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="button button-quiet button-small option-add"
          onClick={() => {
            update('options_i18n', [
              ...draft.options_i18n,
              { 'uz-Latn': '', 'uz-Cyrl': '', ru: '' },
            ])
            update('options', [...draft.options, ''])
          }}
        >
          ＋ Variant qo‘shish
        </button>
      </div>
      <ImageListEditor
        label="Savol rasmlari"
        images={draft.image_urls}
        busy={busy}
        maxImages={1}
        onChange={(images) => update('image_urls', images)}
        onUpload={(files) => uploadImages(files, 'image_urls')}
      />
      <label className="field">
        <span>Tushuntirish · {QUESTION_LOCALE_LABELS[locale]}</span>
        <textarea
          rows={2}
          value={draft.explanation[locale]}
          onChange={(event) =>
            update('explanation', {
              ...draft.explanation,
              [locale]: event.target.value,
            })
          }
        />
      </label>
      <TranslateButton
        sourceText={draft.explanation['uz-Latn']}
        onTranslated={(translations) =>
          setDraft((current) => ({
            ...current,
            explanation: { ...current.explanation, ...translations },
          }))
        }
      />
      <ImageListEditor
        label="Tushuntirish rasmlari"
        images={draft.explanation_image_urls}
        busy={busy}
        maxImages={1}
        onChange={(images) => update('explanation_image_urls', images)}
        onUpload={(files) => uploadImages(files, 'explanation_image_urls')}
      />
    </Modal>
  )
}
