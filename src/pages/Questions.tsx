import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { ImageListEditor } from '../components/ImageListEditor'
import { TranslateButton } from '../components/TranslateButton'
import { fetchAutoVariantCatalog } from '../lib/autoVariants'
import type { AutoVariantQuestion } from '../lib/autoVariants'
import { useSiteLanguage } from '../lib/siteLanguage'
import { requireSupabase } from '../lib/supabase'
import { normalizeSearchText } from '../lib/search'
import type { Bilet, Question } from '../lib/types'
import {
  getErrorMessage,
  QUESTION_LOCALES,
  QUESTION_LOCALE_LABELS,
} from '../lib/types'
import type { LocalizedText, QuestionLocale } from '../lib/types'
import { NewQuestionEditor } from './AdminNewQuestions'
import type { AdminNewQuestion } from './AdminNewQuestions'

const PAGE_SIZE = 50
type QuestionDraft = Omit<Question, 'id' | 'created_at' | 'is_deleted'>
type QuestionListItem = Question & {
  global_question_number?: number
  admin_question_id?: number
  text_i18n?: Partial<LocalizedText>
  lesson_id?: number | null
  section_id?: number | null
  lesson_label?: string
  manual_variant_labels?: string[]
}
type SectionFilter = { id: number; name: string }
type LessonFilter = { id: number; section_id: number | null; title: string }
type QuestionTypeFilter =
  | ''
  | 'new'
  | 'old'
  | 'numeric'
  | 'similar'
  | 'ordinary'

function localizedText(
  value: Partial<LocalizedText> | null | undefined,
  language: QuestionLocale,
  fallback = ''
) {
  return (
    value?.[language] ||
    value?.['uz-Latn'] ||
    value?.ru ||
    value?.['uz-Cyrl'] ||
    fallback
  )
}

function truncateFilterLabel(label: string, maxLength = 28) {
  return label.length > maxLength
    ? `${label.slice(0, maxLength).trimEnd()}…`
    : label
}

function matchesQuestionType(
  question: QuestionListItem,
  filter: QuestionTypeFilter
) {
  switch (filter) {
    case 'new':
      return Boolean(question.is_new)
    case 'old':
      return !question.is_new
    case 'numeric':
      return Boolean(question.is_numeric)
    case 'similar':
      return Boolean(question.is_similar)
    case 'ordinary':
      return !question.is_new && !question.is_numeric && !question.is_similar
    default:
      return true
  }
}

function blankQuestion(): QuestionDraft {
  return {
    bilet_id: null,
    bilet_position: null,
    category_id: null,
    text: '',
    options: ['', ''],
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
  const { t, language } = useSiteLanguage()
  const confirm = useConfirm()

  const [searchParams, setSearchParams] = useSearchParams()
  const [questions, setQuestions] = useState<QuestionListItem[]>([])
  const [bilets, setBilets] = useState<Bilet[]>([])
  const [sections, setSections] = useState<SectionFilter[]>([])
  const [lessons, setLessons] = useState<LessonFilter[]>([])
  const [query, setQuery] = useState(() => searchParams.get('search') || '')
  const [appliedQuery, setAppliedQuery] = useState(
    () => searchParams.get('search') || ''
  )
  const [biletFilter, setBiletFilter] = useState(
    searchParams.get('bilet') || ''
  )
  const [questionTypeFilter, setQuestionTypeFilter] =
    useState<QuestionTypeFilter>(() => {
      const type = searchParams.get('type')
      return type === 'new' ||
        type === 'old' ||
        type === 'numeric' ||
        type === 'similar' ||
        type === 'ordinary'
        ? type
        : ''
    })
  const [sectionFilter, setSectionFilter] = useState('')
  const [lessonFilter, setLessonFilter] = useState(
    () => searchParams.get('lesson') || ''
  )
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<QuestionListItem | undefined>(
    undefined
  )
  const [adminEditing, setAdminEditing] = useState<
    AdminNewQuestion | null | undefined
  >(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const search = normalizeSearchText(appliedQuery)
      const [baseCountResult, sectionResult, lessonResult, catalog] =
        await Promise.all([
          client
            .from('questions')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false),
          client
            .from('base_sections')
            .select('id,name')
            .eq('is_deleted', false)
            .order('sort_order')
            .order('id'),
          client
            .from('base_lessons')
            .select('id,section_id,title')
            .eq('is_deleted', false)
            .order('section_id')
            .order('sort_order')
            .order('id'),
          fetchAutoVariantCatalog(),
        ])
      if (baseCountResult.error) throw baseCountResult.error
      if (sectionResult.error) throw sectionResult.error
      if (lessonResult.error) throw lessonResult.error

      const baseQuestions: Question[] = []
      for (let offset = 0; ; offset += 500) {
        let request = client
          .from('questions')
          .select('*')
          .eq('is_deleted', false)
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
        const request = client
          .from('admin_new_questions')
          .select('*')
          .eq('is_deleted', false)
        const { data, error: assignedError } = await request
          .order('id')
          .range(offset, offset + 499)
        if (assignedError) throw assignedError
        assignedQuestions.push(...(data || []))
        if (!data || data.length < 500) break
      }

      const sectionNames = new Map(
        (sectionResult.data || []).map((section) => [
          section.id,
          localizedText(
            section.name,
            language,
            `${t('Bo‘lim')} ${section.id}`
          ),
        ])
      )
      const lessonSectionName = (sectionId: number | null) =>
        sectionId === null
          ? t('Biriktirilmagan')
          : sectionNames.get(sectionId) || `${t('Bo‘lim')} ${sectionId}`
      const lessonRows = (lessonResult.data || []).map((lesson) => ({
        id: lesson.id,
        section_id: lesson.section_id,
        title: localizedText(
          lesson.title,
          language,
          `${t('Bob')} ${lesson.id}`
        ),
      }))
      const lessonLabels = new Map(
        (lessonResult.data || []).map((lesson) => [
          lesson.id,
          `${lessonSectionName(lesson.section_id)} · ${localizedText(lesson.title, language, `${t('Bob')} ${lesson.id}`)}`,
        ])
      )
      const lessonSections = new Map(
        lessonRows.map((lesson) => [lesson.id, lesson.section_id])
      )
      const sourceQuestionIds = [
        ...new Set(
          baseQuestions
            .map((question) => Number(question.source_question_id))
            .filter((id) => Number.isSafeInteger(id) && id > 0)
        ),
      ]
      const adminQuestionIds = assignedQuestions
        .map((row) => Number(row.id))
        .filter(Number.isSafeInteger)
      const [
        sourceQuestions,
        baseMemberships,
        adminMemberships,
        manualVariantsResult,
      ] = await Promise.all([
        fetchChunks(sourceQuestionIds, (ids) =>
          client
            .from('base_questions')
            .select('id,lesson_id,is_new,is_numeric,is_similar')
            .in('id', ids)
        ),
        fetchChunks(sourceQuestionIds, (ids) =>
          client
            .from('base_manual_variant_questions')
            .select('variant_id,question_id')
            .eq('question_source', 'base')
            .in('question_id', ids)
        ),
        fetchChunks(adminQuestionIds, (ids) =>
          client
            .from('base_manual_variant_questions')
            .select('variant_id,question_id')
            .eq('question_source', 'admin_new')
            .in('question_id', ids)
        ),
        client
          .from('base_manual_variants')
          .select('id,title')
          .eq('is_deleted', false),
      ])
      if (manualVariantsResult.error) throw manualVariantsResult.error
      const variantNames = new Map(
        (manualVariantsResult.data || []).map((variant) => [
          variant.id,
          variant.title?.['uz-Latn'] ||
            variant.title?.ru ||
            variant.title?.['uz-Cyrl'] ||
            `Manual variant ${variant.id}`,
        ])
      )
      const variantLabelsByQuestion = new Map<string, string[]>()
      for (const membership of [
        ...(
          baseMemberships as { variant_id: number; question_id: number }[]
        ).map((row) => ({ ...row, source: 'base' })),
        ...(
          adminMemberships as { variant_id: number; question_id: number }[]
        ).map((row) => ({ ...row, source: 'admin_new' })),
      ]) {
        const label = variantNames.get(membership.variant_id)
        if (!label) continue
        const key = `${membership.source}:${membership.question_id}`
        variantLabelsByQuestion.set(key, [
          ...(variantLabelsByQuestion.get(key) || []),
          label,
        ])
      }
      const sourceQuestionById = new Map(
        (sourceQuestions as Record<string, unknown>[]).map((row) => [
          Number(row.id),
          row,
        ])
      )
      const enrichedBaseQuestionsUnassigned = baseQuestions.map((question) => {
        const sourceId = Number(question.source_question_id)
        const source = sourceQuestionById.get(sourceId)
        const metadata = source
          ? (source as Record<string, unknown>)
          : undefined
        const lessonId =
          metadata?.lesson_id == null ? null : Number(metadata.lesson_id)
        return {
          ...question,
          lesson_id: lessonId,
          section_id:
            lessonId == null ? null : (lessonSections.get(lessonId) ?? null),
          is_new:
            typeof metadata?.is_new === 'boolean'
              ? metadata.is_new
              : question.is_new,
          is_numeric:
            typeof metadata?.is_numeric === 'boolean'
              ? metadata.is_numeric
              : question.is_numeric,
          is_similar:
            typeof metadata?.is_similar === 'boolean'
              ? metadata.is_similar
              : question.is_similar,
          lesson_label:
            lessonId == null ? undefined : lessonLabels.get(lessonId),
          manual_variant_labels:
            variantLabelsByQuestion.get(`base:${sourceId}`) || [],
        }
      })
      const allBilets: Bilet[] = catalog.variants.map((variant) => ({
        id: variant.id,
        number: variant.number,
        title: variant.title,
        is_deleted: false,
      }))
      const autoQuestionByKey = new Map<string, AutoVariantQuestion>(
        catalog.questions.map((question) => [question.key, question])
      )
      const baseCount = baseCountResult.count || 0
      const assignedRows: QuestionListItem[] = assignedQuestions.map(
        (row, index) => {
          const id = Number(row.id)
          const autoQuestion = autoQuestionByKey.get(`admin_new:${id}`)
          const fallbackTicketNumber = Math.floor((baseCount + index) / 20) + 1
          const ticketNumber =
            autoQuestion?.variant_number ??
            (Boolean(row.is_new) ? null : fallbackTicketNumber)
          const ticket =
            ticketNumber == null
              ? undefined
              : allBilets.find(({ number }) => number === ticketNumber)
          const images = Array.isArray(row.image_urls)
            ? (row.image_urls as string[])
            : []
          const explanationImages = Array.isArray(row.explanation_image_urls)
            ? (row.explanation_image_urls as string[])
            : []
          return {
            id: String(row.id),
            admin_question_id: id,
            bilet_id: ticket?.id || null,
            bilet_position:
              autoQuestion?.variant_position ??
              (ticketNumber == null ? null : ((baseCount + index) % 20) + 1),
            category_id: null,
            text: String(row.text || ''),
            text_i18n:
              row.text_i18n && typeof row.text_i18n === 'object'
                ? (row.text_i18n as Partial<LocalizedText>)
                : undefined,
            options: Array.isArray(row.options)
              ? (row.options as string[])
              : [],
            correct_index: Number(row.correct_index || 0),
            image_url: images[0] || String(row.image_url || '') || null,
            image_urls: images,
            explanation: String(row.explanation || '') || null,
            explanation_image_url:
              explanationImages[0] ||
              String(row.explanation_image_url || '') ||
              null,
            explanation_image_urls: explanationImages,
            sign_code: null,
            is_tricky: false,
            is_road_sign: false,
            is_numeric: Boolean(row.is_numeric),
            is_new: Boolean(row.is_new),
            is_similar: Boolean(row.is_similar),
            status: 'PUBLISHED',
            is_deleted: false,
            created_at: String(row.created_at || ''),
            lesson_id: row.lesson_id == null ? null : Number(row.lesson_id),
            section_id:
              row.lesson_id == null
                ? null
                : (lessonSections.get(Number(row.lesson_id)) ?? null),
            lesson_label: row.lesson_id
              ? lessonLabels.get(Number(row.lesson_id)) ||
                `Bob ${row.lesson_id}`
              : undefined,
            manual_variant_labels:
              variantLabelsByQuestion.get(`admin_new:${Number(row.id)}`) || [],
          }
        }
      )
      const enrichedBaseQuestions = enrichedBaseQuestionsUnassigned.map(
        (question) => {
          const autoQuestion = autoQuestionByKey.get(
            `base:${Number(question.source_question_id)}`
          )
          if (!autoQuestion) return question
          const generatedVariant = allBilets.find(
            (variant) => variant.number === autoQuestion.variant_number
          )
          return {
            ...question,
            bilet_id: generatedVariant?.id || question.bilet_id,
            bilet_position: autoQuestion.variant_position,
            is_new: autoQuestion.is_new,
            is_numeric: autoQuestion.is_numeric,
            is_similar: autoQuestion.is_similar,
          }
        }
      )
      const allQuestions = [...enrichedBaseQuestions, ...assignedRows].sort(
        (left, right) => {
          const leftTicket =
            allBilets.find(({ id }) => id === left.bilet_id)?.number ??
            Number.MAX_SAFE_INTEGER
          const rightTicket =
            allBilets.find(({ id }) => id === right.bilet_id)?.number ??
            Number.MAX_SAFE_INTEGER
          return (
            leftTicket - rightTicket ||
            (left.bilet_position ?? Number.MAX_SAFE_INTEGER) -
              (right.bilet_position ?? Number.MAX_SAFE_INTEGER) ||
            left.created_at.localeCompare(right.created_at)
          )
        }
      )
      const numberedQuestions = allQuestions.map((question, index) => ({
        ...question,
        global_question_number: index + 1,
      }))
      const merged = numberedQuestions
        .filter(
          (question) =>
            matchesQuestionType(question, questionTypeFilter) &&
            (!biletFilter || question.bilet_id === biletFilter) &&
            (!sectionFilter ||
              String(question.section_id ?? '') === sectionFilter) &&
            (!lessonFilter ||
              String(question.lesson_id ?? '') === lessonFilter) &&
            (!search ||
              normalizeSearchText(question.text).includes(search))
        )
      setQuestions(merged)
      setTotal(merged.length)
      setBilets(allBilets)
      setSections(
        (sectionResult.data || []).map((section) => ({
          id: section.id,
          name: localizedText(
            section.name,
            language,
            `${t('Bo‘lim')} ${section.id}`
          ),
        }))
      )
      setLessons(lessonRows)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [
    biletFilter,
    lessonFilter,
    appliedQuery,
    questionTypeFilter,
    sectionFilter,
    language,
    t,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus) return
    const target = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('[data-question-focus]')
    ).find((row) => row.dataset.questionFocus === focus)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [questions, searchParams])

  useEffect(() => {
    const sourceQuestionId = Number(searchParams.get('sourceQuestion'))
    if (!Number.isSafeInteger(sourceQuestionId) || sourceQuestionId <= 0) return
    void (async () => {
      try {
        const { data, error: fetchError } = await requireSupabase()
          .from('questions')
          .select('*')
          .eq('source_question_id', sourceQuestionId)
          .maybeSingle()
        if (fetchError) throw fetchError
        if (!data) throw new Error(t('Tahrirlash uchun asosiy savol topilmadi.'))
        setEditing(data as QuestionListItem)
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('sourceQuestion')
        setSearchParams(nextParams, { replace: true })
      } catch (reason) {
        setError(getErrorMessage(reason))
      }
    })()
  }, [searchParams, setSearchParams, t])

  async function softDelete(question: QuestionListItem) {
    const confirmed = await confirm({
      title: t('Savolni o‘chirish'),
      message:
        t('Savolni o‘chirilgan deb belgilaysizmi? Bu o‘zgarish desktop ilovalarga sync orqali yetib boradi.'),
      confirmLabel: t('O‘chirish'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const result = question.admin_question_id
        ? await requireSupabase()
            .from('admin_new_questions')
            .update({ is_deleted: true })
            .eq('id', question.admin_question_id)
        : await requireSupabase()
            .from('questions')
            .update({ is_deleted: true })
            .eq('id', question.id)
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
      const { error: updateError } = await requireSupabase()
        .from('questions')
        .update({ status: 'PUBLISHED' })
        .eq('id', question.id)
      if (updateError) throw updateError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(0)
    setAppliedQuery(query.trim())
  }

  async function editAdminQuestion(id: number) {
    try {
      const { data, error: fetchError } = await requireSupabase()
        .from('admin_new_questions')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (fetchError) throw fetchError
      if (!data) throw new Error(t('Tahrirlash uchun yangi savol topilmadi.'))
      setAdminEditing(data as AdminNewQuestion)
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  const editorLessons = lessons.map((lesson) => ({
    id: lesson.id,
    label: `${lesson.section_id === null ? t('Biriktirilmagan') : sections.find((section) => section.id === lesson.section_id)?.name || `${t('Bo‘lim')} ${lesson.section_id}`} · ${lesson.title}`,
  }))

  return (
    <>
      <PageHeader
        title="Savollar"
        description="Savollarni qo‘shing, qidiring va darslarga biriktiring."
        action={
          <button
            className="button button-primary"
            onClick={() => setAdminEditing(null)}
          >
            ＋ {t('Savol qo‘shish')}
          </button>
        }
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar questions-filter-bar">
          <form className="search-field" onSubmit={submitSearch} role="search">
            <input
              placeholder={t('Savol matnidan qidirish…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t('Savol matnidan qidirish')}
            />
            <button
              type="submit"
              aria-label={t('Qidirish')}
              title={t('Qidirish')}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
            </button>
          </form>
          <select
            className="filter-select"
            value={questionTypeFilter}
            onChange={(event) => {
              setPage(0)
              setQuestionTypeFilter(event.target.value as QuestionTypeFilter)
            }}
            aria-label={t('Savol turi bo‘yicha filtrlash')}
          >
            <option value="">{t('Barcha savollar')}</option>
            <option value="new">{t('Yangi')}</option>
            <option value="old">{t('Eski')}</option>
            <option value="numeric">{t('Raqamli')}</option>
            <option value="similar">{t('O‘xshash')}</option>
            <option value="ordinary">{t('Oddiy')}</option>
          </select>
          <select
            className="filter-select"
            value={sectionFilter}
            onChange={(event) => {
              setPage(0)
              setLessonFilter('')
              setSectionFilter(event.target.value)
            }}
          >
            <option value="">{t('Barcha bo‘limlar')}</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id} title={section.name}>
                {truncateFilterLabel(section.name)}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={lessonFilter}
            onChange={(event) => {
              setPage(0)
              setLessonFilter(event.target.value)
            }}
          >
            <option value="">{t('Barcha boblar')}</option>
            {lessons
              .filter(
                (lesson) =>
                  !sectionFilter || String(lesson.section_id) === sectionFilter
              )
              .map((lesson) => (
                <option key={lesson.id} value={lesson.id} title={lesson.title}>
                  {truncateFilterLabel(lesson.title)}
                </option>
              ))}
          </select>
          <select
            className="filter-select"
            value={biletFilter}
            onChange={(event) => {
              setPage(0)
              setBiletFilter(event.target.value)
            }}
          >
            <option value="">{t('Barcha variantlar')}</option>
            {bilets.map((bilet) => (
              <option key={bilet.id} value={bilet.id}>
                {bilet.number}-variant
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('SAVOL')}</th>
                <th>{t('VARIANT')}</th>
                <th>{t('HOLATI')}</th>
                <th className="align-right">{t('AMALLAR')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && questions.length === 0 ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    {t('Savollar yuklanmoqda…')}
                  </td>
                </tr>
              ) : questions.length === 0 ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    {t('Bu filtr bo‘yicha savol topilmadi.')}
                  </td>
                </tr>
              ) : (
                questions
                  .slice(0, (page + 1) * PAGE_SIZE)
                  .map((question, index) => {
                    const bilet = bilets.find(
                      (item) => item.id === question.bilet_id
                    )
                    const questionNumber =
                      question.global_question_number ?? index + 1
                    const focusKey = question.admin_question_id
                      ? `admin_new:${question.admin_question_id}`
                      : question.source_question_id
                        ? `base:${question.source_question_id}`
                        : ''
                    return (
                      <tr
                        key={question.id}
                        data-question-focus={focusKey}
                        className={
                          searchParams.get('focus') === focusKey
                            ? 'question-focus-match'
                            : undefined
                        }
                      >
                        <td>
                          <div className="question-cell">
                            <span className="row-avatar">{questionNumber}</span>
                            <span className="truncate">
                              <strong>
                                {localizedText(question.text_i18n, language) ||
                                  question.text}
                              </strong>
                              <small>
                                {question.options?.length || 0}{' '}
                                {t('ta javob varianti')}
                                {question.is_new ? ` · ${t('Yangi')}` : ''}
                                {question.is_numeric ? ` · ${t('Raqamli')}` : ''}
                                {question.is_similar ? ` · ${t('O‘xshash')}` : ''}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="cell-primary">
                            {bilet
                              ? `${bilet.number}${t('-variant')}${question.bilet_position ? ` · ${question.bilet_position}${t('-savol')}` : ''}`
                              : t('Variantga kiritilmagan')}
                          </span>
                          {question.lesson_label && (
                            <small className="question-source-label">
                              {question.lesson_label}
                            </small>
                          )}
                          {question.manual_variant_labels?.map((label) => (
                            <small className="question-source-label" key={label}>
                              {label}
                            </small>
                          ))}
                        </td>
                        <td>
                          <span
                            className={`badge ${question.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'}`}
                          >
                            <i />
                            {question.status === 'PUBLISHED'
                              ? t('Chop etilgan')
                              : t('Qoralama')}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            {!question.admin_question_id &&
                              question.status === 'DRAFT' && (
                                <button
                                  className="text-button success-text"
                                  onClick={() => void publish(question)}
                                >
                                  {t('Nashr')}
                                </button>
                              )}
                            {question.admin_question_id ? (
                              <button
                                className="icon-button"
                                title={t('Tahrirlash')}
                                onClick={() =>
                                  void editAdminQuestion(
                                    question.admin_question_id!
                                  )
                                }
                              >
                                ✎
                              </button>
                            ) : (
                              <button
                                className="icon-button"
                                title={t('Tahrirlash')}
                                onClick={() => setEditing(question)}
                              >
                                ✎
                              </button>
                            )}
                            <button
                              className="icon-button danger-icon"
                              title={t('O‘chirish')}
                              onClick={() => void softDelete(question)}
                            >
                              🗑
                            </button>
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
          <span>
            {total === 0
              ? t('0 ta savol')
              : `${Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} / ${total.toLocaleString()} ${t('ta savol')}`}
          </span>
          <div className="pagination">
            {(page + 1) * PAGE_SIZE < total && (
              <button
                className="button button-quiet button-small"
                onClick={() => setPage((current) => current + 1)}
              >
                {t('Yana')} {Math.min(PAGE_SIZE, total - (page + 1) * PAGE_SIZE)} {t('ta')}
              </button>
            )}
          </div>
        </div>
      </section>
      {editing !== undefined &&
        (editing.source_question_id ? (
          <BaseQuestionEditor
            question={editing}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined)
              void load()
            }}
          />
        ) : (
          <QuestionEditor
            question={editing}
            bilets={bilets}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined)
              void load()
            }}
          />
        ))}
      {adminEditing !== undefined && (
        <NewQuestionEditor
          question={adminEditing}
          lessons={editorLessons}
          onClose={() => setAdminEditing(undefined)}
          onSaved={() => {
            setAdminEditing(undefined)
            void load()
          }}
        />
      )}
    </>
  )
}

function QuestionEditor({
  question,
  bilets,
  onClose,
  onSaved,
}: {
  question: QuestionListItem | null
  bilets: Bilet[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useSiteLanguage()
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
      image_urls: question.image_urls?.length
        ? [...question.image_urls]
        : question.image_url
          ? [question.image_url]
          : [],
      explanation: question.explanation,
      explanation_image_url: question.explanation_image_url,
      explanation_image_urls: question.explanation_image_urls?.length
        ? [...question.explanation_image_urls]
        : question.explanation_image_url
          ? [question.explanation_image_url]
          : [],
      sign_code: question.sign_code,
      is_tricky: question.is_tricky,
      is_road_sign: question.is_road_sign,
      is_numeric: question.is_numeric,
      status: question.status,
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function update<K extends keyof QuestionDraft>(
    key: K,
    value: QuestionDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function uploadImages(
    files: File[],
    field: 'image_urls' | 'explanation_image_urls'
  ) {
    setError('')
    setBusy(true)
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
        const { data } = storage.getPublicUrl(path)
        setDraft((current) => ({
          ...current,
          [field]: [...current[field], data.publicUrl],
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
    const options = draft.options.map((option) => option.trim()).filter(Boolean)
    if (options.length < 2) {
      setError(t('Kamida ikkita javob variantini to‘ldiring.'))
      return
    }
    if (!draft.options[draft.correct_index]?.trim()) {
      setError(
        t('To‘g‘ri javob sifatida bo‘sh variant tanlangan. Avval uni to‘ldiring.')
      )
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
        bilet_position:
          draft.bilet_id && draft.bilet_position
            ? Number(draft.bilet_position)
            : null,
        correct_index: draft.options
          .slice(0, draft.correct_index)
          .filter((option) => option.trim()).length,
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
    <Modal
      className="question-editor-modal"
      title={question ? t('Savolni tahrirlash') : t('Yangi savol')}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel={
        question ? t('O‘zgarishlarni saqlash') : t('Savol yaratish')
      }
    >
      {error && <Notice message={error} />}
      <div className="question-editor-prompt-row">
        <label className="field question-editor-prompt">
          <span>{t('Savol matni')} *</span>
          <textarea
            rows={3}
            value={draft.text}
            onChange={(event) => update('text', event.target.value)}
            required
          />
        </label>
        <ImageListEditor
          label={t('Savol rasmlari')}
          images={draft.image_urls}
          busy={busy}
          maxImages={1}
          onChange={(images) => update('image_urls', images)}
          onUpload={(files) => uploadImages(files, 'image_urls')}
        />
      </div>
      <div className="form-grid question-editor-meta">
        <label className="field">
          <span>{t('Bilet')}</span>
          <select
            value={draft.bilet_id || ''}
            onChange={(event) => update('bilet_id', event.target.value || null)}
          >
            <option value="">{t('Biletsiz')}</option>
            {bilets.map((bilet) => (
              <option key={bilet.id} value={bilet.id}>
                {bilet.number}{t('-bilet')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Biletdagi tartib')}</span>
          <input
            type="number"
            min="1"
            value={draft.bilet_position || ''}
            onChange={(event) =>
              update(
                'bilet_position',
                event.target.value ? Number(event.target.value) : null
              )
            }
            disabled={!draft.bilet_id}
          />
        </label>
        <label className="field">
          <span>{t('Holati')}</span>
          <select
            value={draft.status}
            onChange={(event) =>
              update('status', event.target.value as QuestionDraft['status'])
            }
          >
            <option value="DRAFT">{t('Qoralama')}</option>
            <option value="PUBLISHED">{t('Chop etilgan')}</option>
          </select>
        </label>
      </div>
      <div className="field question-editor-answers">
        <span>{t('Javob variantlari')} *</span>
        <div className="option-editor">
          {draft.options.map((option, index) => {
            const label = `F${index + 1}`
            return (
              <label
                className={`option-input${draft.correct_index === index ? ' correct-option' : ''}`}
                key={index}
              >
                <input
                  type="radio"
                  name="correct-option"
                  checked={draft.correct_index === index}
                  onChange={() => update('correct_index', index)}
                />
                <b>{label}</b>
                <input
                  value={option}
                  placeholder={`${label} ${t('javob')}`}
                  onChange={(event) =>
                    update(
                      'options',
                      draft.options.map((current, optionIndex) =>
                        optionIndex === index ? event.target.value : current
                      )
                    )
                  }
                />
              </label>
            )
          })}
        </div>
        <button
          type="button"
          className="button button-quiet button-small option-add"
          onClick={() => update('options', [...draft.options, ''])}
        >
          ＋ {t('Variant qo‘shish')}
        </button>
      </div>
      <div className="question-editor-explanation-row">
        <label className="field">
          <span>{t('Tushuntirish / shpargalka')}</span>
          <textarea
            rows={2}
            value={draft.explanation || ''}
            onChange={(event) =>
              update('explanation', event.target.value || null)
            }
          />
        </label>
        <ImageListEditor
          label={t('Tushuntirish rasmlari')}
          images={draft.explanation_image_urls}
          busy={busy}
          maxImages={1}
          onChange={(images) => update('explanation_image_urls', images)}
          onUpload={(files) => uploadImages(files, 'explanation_image_urls')}
        />
      </div>
    </Modal>
  )
}

interface CanonicalQuestionDraft {
  lesson_id: number | null
  text: LocalizedText
  options: LocalizedText[]
  correct_index: number
  explanation: LocalizedText
  image_urls: string[]
  explanation_image_urls: string[]
  is_new: boolean
  is_numeric: boolean
  is_similar: boolean
}

interface BaseQuestionImage {
  id: string
  question_id: number
  role: 'question' | 'description'
  path: string | null
  source_path: string | null
  storage_path: string | null
  status: 'available' | 'missing'
  link_basis: string | null
}

function blankLocalized(): LocalizedText {
  return { 'uz-Latn': '', 'uz-Cyrl': '', ru: '' }
}

async function fetchChunks<T>(
  ids: number[],
  request: (
    ids: number[]
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await request(ids.slice(offset, offset + 100))
    if (error) throw error
    rows.push(...(data || []))
  }
  return rows
}

function asLocalized(value: unknown, fallback = ''): LocalizedText {
  const localized =
    value && typeof value === 'object' ? (value as Partial<LocalizedText>) : {}
  return {
    'uz-Latn': localized['uz-Latn'] || fallback,
    'uz-Cyrl': localized['uz-Cyrl'] || fallback,
    ru: localized.ru || fallback,
  }
}

function storagePathFromPublicUrl(imageUrl: string) {
  try {
    const path = new URL(imageUrl).pathname
    const marker = '/storage/v1/object/public/pdd-images/'
    const markerIndex = path.indexOf(marker)
    return markerIndex < 0
      ? null
      : decodeURIComponent(path.slice(markerIndex + marker.length))
  } catch {
    return null
  }
}

function publicUrlForBaseImage(
  client: ReturnType<typeof requireSupabase>,
  image: BaseQuestionImage
) {
  let storagePath = image.storage_path
  if (!storagePath) {
    const sourcePath = (image.path || image.source_path || '').replace(
      /\\/g,
      '/'
    )
    if (sourcePath.startsWith('images/'))
      storagePath = `base-import/${sourcePath}`
  }
  return storagePath
    ? client.storage.from('pdd-images').getPublicUrl(storagePath).data.publicUrl
    : null
}

function BaseQuestionEditor({
  question,
  onClose,
  onSaved,
}: {
  question: QuestionListItem
  onClose: () => void
  onSaved: () => void
}) {
  const { t, language } = useSiteLanguage()
  const [draft, setDraft] = useState<CanonicalQuestionDraft>(() => ({
    lesson_id: null,
    text: asLocalized(null, question.text),
    options: question.options.map((option) => asLocalized(null, option)),
    correct_index: question.correct_index,
    explanation: asLocalized(null, question.explanation || ''),
    image_urls: [],
    explanation_image_urls: [],
    is_new: false,
    is_numeric: question.is_numeric,
    is_similar: false,
  }))
  const [imageRows, setImageRows] = useState<BaseQuestionImage[]>([])
  const [lessons, setLessons] = useState<
    {
      id: number
      section_id: number | null
      title: Partial<LocalizedText>
      section_name: Partial<LocalizedText>
    }[]
  >([])
  const [locale, setLocale] = useState<QuestionLocale>('uz-Latn')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const client = requireSupabase()
        const [
          questionResult,
          answersResult,
          sectionsResult,
          lessonsResult,
          imagesResult,
        ] = await Promise.all([
          client
            .from('base_questions')
            .select(
              'id,lesson_id,text,explanation,is_new,is_numeric,is_similar'
            )
            .eq('id', question.source_question_id)
            .single(),
          client
            .from('base_answers')
            .select('sort_order,text,is_correct')
            .eq('question_id', question.source_question_id)
            .order('sort_order'),
          client
            .from('base_sections')
            .select('id,name')
            .eq('is_deleted', false)
            .order('sort_order'),
          client
            .from('base_lessons')
            .select('id,section_id,title')
            .eq('is_deleted', false)
            .order('section_id')
            .order('sort_order'),
          client
            .from('base_question_images')
            .select(
              'id,question_id,role,path,source_path,storage_path,status,link_basis'
            )
            .eq('question_id', question.source_question_id)
            .order('role')
            .order('id'),
        ])
        if (questionResult.error) throw questionResult.error
        if (answersResult.error) throw answersResult.error
        if (sectionsResult.error) throw sectionsResult.error
        if (lessonsResult.error) throw lessonsResult.error
        if (imagesResult.error) throw imagesResult.error
        const currentImages = (imagesResult.data || []) as BaseQuestionImage[]
        const imageUrlsByRole = {
          question: currentImages
            .filter((image) => image.role === 'question')
            .map((image) => publicUrlForBaseImage(client, image))
            .filter((url): url is string => Boolean(url)),
          description: currentImages
            .filter((image) => image.role === 'description')
            .map((image) => publicUrlForBaseImage(client, image))
            .filter((url): url is string => Boolean(url)),
        }
        const sectionNames = new Map(
          (sectionsResult.data || []).map((section) => [
            section.id,
            section.name as Partial<LocalizedText>,
          ])
        )
        if (active) {
          setDraft({
            lesson_id: questionResult.data.lesson_id,
            text: asLocalized(questionResult.data.text, question.text),
            options: (answersResult.data || []).map((answer) =>
              asLocalized(answer.text)
            ),
            correct_index: Math.max(
              0,
              (answersResult.data || []).findIndex(
                (answer) => answer.is_correct
              )
            ),
            explanation: asLocalized(
              questionResult.data.explanation,
              question.explanation || ''
            ),
            image_urls: imageUrlsByRole.question,
            explanation_image_urls: imageUrlsByRole.description,
            is_new: Boolean(questionResult.data.is_new),
            is_numeric: Boolean(questionResult.data.is_numeric),
            is_similar: Boolean(questionResult.data.is_similar),
          })
          setImageRows(currentImages)
          setLessons(
            (lessonsResult.data || []).map((lesson) => ({
              ...lesson,
              title: lesson.title as Partial<LocalizedText>,
              section_name:
                lesson.section_id === null
                  ? {}
                  : sectionNames.get(lesson.section_id) || {},
            }))
          )
        }
      } catch (reason) {
        if (active) setError(getErrorMessage(reason))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [question])

  function update<K extends keyof CanonicalQuestionDraft>(
    key: K,
    value: CanonicalQuestionDraft[K]
  ) {
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
      setError(t('Savol matnini uchala tilda ham to‘ldiring.'))
      return
    }
    if (
      draft.options.length < 2 ||
      draft.options.some((option) =>
        QUESTION_LOCALES.some((key) => !option[key].trim())
      )
    ) {
      setError(t('Kamida ikkita javob variantini uchala tilda ham to‘ldiring.'))
      return
    }
    const questionImagePaths = draft.image_urls.map((url) =>
      storagePathFromPublicUrl(url)
    )
    const explanationImagePaths = draft.explanation_image_urls.map((url) =>
      storagePathFromPublicUrl(url)
    )
    if (
      [...questionImagePaths, ...explanationImagePaths].some((path) => !path)
    ) {
      setError(
        t('Rasmni pdd-images omboriga yuklang yoki shu ombordagi rasm URL manzilini kiriting.')
      )
      return
    }
    setBusy(true)
    setError('')
    try {
      const client = requireSupabase()
      const text = Object.fromEntries(
        QUESTION_LOCALES.map((key) => [key, draft.text[key].trim()])
      )
      const explanation = Object.values(draft.explanation).some((value) =>
        value.trim()
      )
        ? Object.fromEntries(
            QUESTION_LOCALES.map((key) => [key, draft.explanation[key].trim()])
          )
        : null
      const { error: questionError } = await client
        .from('base_questions')
        .update({
          lesson_id: draft.lesson_id,
          pending_lesson_id: null,
          pending_unassigned_at: null,
          text,
          explanation,
          is_new: draft.is_new,
          is_numeric: draft.is_numeric,
          is_similar: draft.is_similar,
        })
        .eq('id', question.source_question_id)
      if (questionError) throw questionError

      const answers = draft.options.map((option, index) => ({
        question_id: question.source_question_id,
        sort_order: index,
        text: Object.fromEntries(
          QUESTION_LOCALES.map((key) => [key, option[key].trim()])
        ),
        is_correct: index === draft.correct_index,
      }))
      const { error: answersError } = await client
        .from('base_answers')
        .upsert(answers, { onConflict: 'question_id,sort_order' })
      if (answersError) throw answersError
      const { error: removeExtraAnswersError } = await client
        .from('base_answers')
        .delete()
        .eq('question_id', question.source_question_id)
        .gte('sort_order', answers.length)
      if (removeExtraAnswersError) throw removeExtraAnswersError

      const { error: projectionError } = await client
        .from('questions')
        .update({
          text: draft.text['uz-Latn'].trim(),
          options: draft.options.map((option) => option['uz-Latn'].trim()),
          correct_index: draft.correct_index,
          explanation: draft.explanation['uz-Latn'].trim() || null,
          image_url: draft.image_urls[0] || null,
          explanation_image_url: draft.explanation_image_urls[0] || null,
        })
        .eq('id', question.id)
      if (projectionError) throw projectionError

      const buildImageRecords = (
        role: BaseQuestionImage['role'],
        urls: string[],
        storagePaths: (string | null)[]
      ) => {
        const roleRows = imageRows.filter((image) => image.role === role)
        const selectedRows = urls.map((url, index) => {
          const existing = roleRows.find(
            (image) => publicUrlForBaseImage(client, image) === url
          )
          return {
            id:
              existing?.id ||
              `admin-${role}-${String(index).padStart(4, '0')}-${crypto.randomUUID()}`,
            question_id: question.source_question_id!,
            role,
            path: existing?.path || null,
            source_path: existing?.source_path || null,
            storage_path: storagePaths[index]!,
            status: 'available' as const,
            link_basis: 'admin_editor',
          }
        })
        const uneditableRows = roleRows.filter(
          (image) => !publicUrlForBaseImage(client, image)
        )
        return [...selectedRows, ...uneditableRows]
      }
      const imageRecords = [
        ...buildImageRecords('question', draft.image_urls, questionImagePaths),
        ...buildImageRecords(
          'description',
          draft.explanation_image_urls,
          explanationImagePaths
        ),
      ]
      if (imageRecords.length) {
        const { error: imagesUpsertError } = await client
          .from('base_question_images')
          .upsert(imageRecords, { onConflict: 'id' })
        if (imagesUpsertError) throw imagesUpsertError
      }
      const desiredImageIds = new Set(imageRecords.map((image) => image.id))
      const { data: savedImages, error: savedImagesError } = await client
        .from('base_question_images')
        .select('id')
        .eq('question_id', question.source_question_id)
      if (savedImagesError) throw savedImagesError
      const staleImageIds = (savedImages || [])
        .map((image) => image.id as string)
        .filter((id) => !desiredImageIds.has(id))
      if (staleImageIds.length) {
        const { error: removeStaleImagesError } = await client
          .from('base_question_images')
          .delete()
          .eq('question_id', question.source_question_id)
          .in('id', staleImageIds)
        if (removeStaleImagesError) throw removeStaleImagesError
      }
      onSaved()
    } catch (reason) {
      setError(getErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <Modal
      className="question-editor-modal"
      title={t('Savolni tahrirlash')}
      onClose={onClose}
      onSubmit={submit}
      busy={busy || loading}
      submitLabel={t('O‘zgarishlarni saqlash')}
    >
      {error && <Notice message={error} />}
      {loading ? (
        <div className="table-state">{t('Savol yuklanmoqda…')}</div>
      ) : (
        <>
          <label className="field">
            <span>{t('Darsga biriktirish')}</span>
            <select
              value={draft.lesson_id ?? ''}
              onChange={(event) =>
                update(
                  'lesson_id',
                  event.target.value ? Number(event.target.value) : null
                )
              }
            >
              <option value="">{t('Dars tanlanmagan')}</option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {localizedText(
                    lesson.section_name,
                    language,
                    t('Bo‘lim')
                  )}{' '}
                  ·{' '}
                  {localizedText(
                    lesson.title,
                    language,
                    `${t('Dars')} ${lesson.id}`
                  )}
                </option>
              ))}
            </select>
          </label>
          <div className="checkbox-grid classification-grid">
            <label>
              <input
                type="checkbox"
                checked={draft.is_new}
                onChange={(event) => update('is_new', event.target.checked)}
              />{' '}
              {t('Yangi savol')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.is_numeric}
                onChange={(event) => update('is_numeric', event.target.checked)}
              />{' '}
              {t('Raqamli savol')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.is_similar}
                onChange={(event) => update('is_similar', event.target.checked)}
              />{' '}
              {t('O‘xshash savollar')}
            </label>
          </div>
          <div
            className="language-tabs"
            role="tablist"
            aria-label={t('Savol tili')}
          >
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
            <span>
              {t('Savol matni')} · {QUESTION_LOCALE_LABELS[locale]}
            </span>
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
            <span>
              {t('Javoblar (to‘g‘ri javobni belgilang)')} ·{' '}
              {QUESTION_LOCALE_LABELS[locale]}
            </span>
            <div className="option-editor">
              {draft.options.map((option, index) => {
                const label =
                  index < 26
                    ? String.fromCharCode(65 + index)
                    : String(index + 1)
                return (
                  <div
                    className={`option-input localized-option-input${draft.correct_index === index ? ' correct-option' : ''}`}
                    key={index}
                  >
                    <label className="option-answer-label">
                      <input
                        type="radio"
                        name={`base-correct-${question.source_question_id}`}
                        checked={draft.correct_index === index}
                        onChange={() => update('correct_index', index)}
                      />
                      <b>{label}</b>
                      <input
                        value={option[locale]}
                        onChange={(event) =>
                          update(
                            'options',
                            draft.options.map((current, optionIndex) =>
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
                          options: current.options.map((answer, answerIndex) =>
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
                      title={t('Javobni olib tashlash')}
                      disabled={draft.options.length <= 2}
                      onClick={() => {
                        const next = draft.options.filter(
                          (_, optionIndex) => optionIndex !== index
                        )
                        update('options', next)
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
              onClick={() =>
                update('options', [...draft.options, blankLocalized()])
              }
            >
              ＋ {t('Javob qo‘shish')}
            </button>
          </div>
          <ImageListEditor
            label={t('Savol rasmlari')}
            images={draft.image_urls}
            busy={busy}
            maxImages={1}
            onChange={(images) => update('image_urls', images)}
            onUpload={(files) => uploadImages(files, 'image_urls')}
          />
          <div className="question-editor-explanation-row">
            <div className="question-editor-explanation">
              <label className="field">
                <div className="question-editor-prompt-label-row">
                  <span>
                    {t('Tushuntirish')} · {QUESTION_LOCALE_LABELS[locale]}
                  </span>
                  <TranslateButton
                    sourceText={draft.explanation['uz-Latn']}
                    onTranslated={(translations) =>
                      setDraft((current) => ({
                        ...current,
                        explanation: {
                          ...current.explanation,
                          ...translations,
                        },
                      }))
                    }
                  />
                </div>
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
            </div>
            <ImageListEditor
              label={t('Tushuntirish rasmlari')}
              images={draft.explanation_image_urls}
              busy={busy}
              maxImages={1}
              onChange={(images) => update('explanation_image_urls', images)}
              onUpload={(files) =>
                uploadImages(files, 'explanation_image_urls')
              }
            />
          </div>
        </>
      )}
    </Modal>
  )
}
