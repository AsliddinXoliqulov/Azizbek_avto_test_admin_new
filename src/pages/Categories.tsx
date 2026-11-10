import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { TranslateButton } from '../components/TranslateButton'
import { useSiteLanguage } from '../lib/siteLanguage'
import { normalizeSearchText } from '../lib/search'
import { requireSupabase } from '../lib/supabase'
import type {
  BaseLesson,
  BaseSection,
  LocalizedText,
  QuestionLocale,
} from '../lib/types'
import {
  getErrorMessage,
  QUESTION_LOCALES,
  QUESTION_LOCALE_LABELS,
} from '../lib/types'

type TopicDraft = { lesson: BaseLesson | null }

function localizedText(
  value: Partial<LocalizedText> | null | undefined
): LocalizedText {
  return {
    'uz-Latn': value?.['uz-Latn'] || '',
    'uz-Cyrl': value?.['uz-Cyrl'] || '',
    ru: value?.ru || '',
  }
}

function localizedTextForLanguage(
  value: Partial<LocalizedText> | null | undefined,
  language: 'uz-Latn' | 'uz-Cyrl' | 'ru'
) {
  const preferred = value?.[language]
  if (preferred?.trim()) return preferred
  for (const fallback of ['uz-Latn', 'uz-Cyrl', 'ru'] as const) {
    const text = value?.[fallback]
    if (text?.trim()) return text
  }
  return ''
}

function sectionName(
  section: BaseSection,
  index: number,
  language: 'uz-Latn' | 'uz-Cyrl' | 'ru',
  t: (text: string) => string
) {
  const name = localizedText(section.name)
  return (
    localizedTextForLanguage(name, language) ||
    `${t('Bo‘lim')} ${index + 1}`
  )
}

export default function Categories() {
  const { language, t } = useSiteLanguage()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sections, setSections] = useState<BaseSection[]>([])
  const [lessons, setLessons] = useState<BaseLesson[]>([])
  const [searchQuery, setSearchQuery] = useState(
    () => searchParams.get('search') || ''
  )
  const [sectionFilter, setSectionFilter] = useState('')
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>(
    {}
  )
  const [topicDraft, setTopicDraft] = useState<TopicDraft | null>(null)
  const [deletingTopicId, setDeletingTopicId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setSearchQuery(searchParams.get('search') || '')
  }, [searchParams])

  const normalizedSearch = normalizeSearchText(searchQuery)
  const filteredLessons = lessons.filter((lesson) => {
    if (sectionFilter === 'unassigned' && lesson.section_id !== null)
      return false
    if (
      sectionFilter &&
      sectionFilter !== 'unassigned' &&
      String(lesson.section_id) !== sectionFilter
    )
      return false
    if (!normalizedSearch) return true

    const section = sections.find((item) => item.id === lesson.section_id)
    const searchableText = [
      ...Object.values(lesson.title || {}),
      ...Object.values(section?.name || {}),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
    return normalizeSearchText(searchableText).includes(normalizedSearch)
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = requireSupabase()
      const [sectionsResult, lessonsResult] = await Promise.all([
        client
          .from('base_sections')
          .select('id,sort_order,name,is_deleted')
          .eq('is_deleted', false)
          .order('sort_order')
          .order('id'),
        client
          .from('base_lessons')
          .select('id,section_id,sort_order,title,is_deleted')
          .order('section_id')
          .order('sort_order')
          .order('id'),
      ])
      if (sectionsResult.error) throw sectionsResult.error
      if (lessonsResult.error) throw lessonsResult.error

      const counts: Record<number, number> = {}
      for (let offset = 0; ; offset += 500) {
        const [baseResult, adminResult] = await Promise.all([
          client
            .from('base_questions')
            .select('lesson_id,base_answers(is_correct)')
            .eq('is_deleted', false)
            .not('lesson_id', 'is', null)
            .order('id')
            .range(offset, offset + 499),
          client
            .from('admin_new_questions')
            .select('lesson_id')
            .eq('is_deleted', false)
            .not('lesson_id', 'is', null)
            .order('id')
            .range(offset, offset + 499),
        ])
        if (baseResult.error) throw baseResult.error
        if (adminResult.error) throw adminResult.error
        for (const row of baseResult.data || []) {
          const answers = row.base_answers || []
          if (
            answers.length < 2 ||
            answers.filter((answer) => answer.is_correct).length !== 1
          )
            continue
          counts[row.lesson_id] = (counts[row.lesson_id] || 0) + 1
        }
        for (const row of adminResult.data || [])
          counts[row.lesson_id] = (counts[row.lesson_id] || 0) + 1
        if (
          (baseResult.data || []).length < 500 &&
          (adminResult.data || []).length < 500
        )
          break
      }

      setSections((sectionsResult.data || []) as BaseSection[])
      setLessons((lessonsResult.data || []) as BaseLesson[])
      setQuestionCounts(counts)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openTopicQuestions(lesson: BaseLesson) {
    navigate(`/chapters?lessonId=${lesson.id}`)
  }

  async function permanentlyDeleteTopic(lesson: BaseLesson) {
    const confirmed = await confirm({
      title: t('Mavzuni butunlay o‘chirish'),
      message:
        t('Bu amalni ortga qaytarib bo‘lmaydi. Mavzuga biriktirilgan savollar saqlanadi, lekin mavzudan ajratiladi. Davom etasizmi?'),
      confirmLabel: t('Butunlay o‘chirish'),
      danger: true,
    })
    if (!confirmed) return

    setDeletingTopicId(lesson.id)
    setError('')
    try {
      const client = requireSupabase()
      const { data, error: deleteError } = await client.rpc(
        'admin_delete_base_lesson',
        { p_lesson_id: lesson.id }
      )
      if (deleteError) throw deleteError
      if (!data) {
        throw new Error(t('Mavzu topilmadi yoki uni o‘chirishga ruxsat yo‘q.'))
      }
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setDeletingTopicId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Mavzular"
        description="Mavzularni bo‘limlarga biriktiring va har bir mavzudagi savollarni boshqaring."
        action={
          <button
            className="button button-primary"
            onClick={() => setTopicDraft({ lesson: null })}
          >
            ＋ {t('Mavzu qo‘shish')}
          </button>
        }
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar categories-filter-bar">
          <strong className="topic-list-heading">{t('Mavzular ro‘yxati')}</strong>
          <span className="count-pill">
            {t('Mavzular:')} {filteredLessons.length}
          </span>
          <label className="search-field categories-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={t('Mavzu yoki bo‘lim nomidan qidirish…')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label={t('Mavzu yoki bo‘lim nomidan qidirish')}
            />
          </label>
          <select
            className="filter-select categories-section-filter"
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            aria-label={t('Bo‘lim bo‘yicha filtrlash')}
          >
            <option value="">{t('Barcha bo‘limlar')}</option>
            <option value="unassigned">{t('Biriktirilmagan')}</option>
            {sections.map((section, index) => (
              <option key={section.id} value={section.id}>
                {sectionName(section, index, language, t)}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('MAVZU')}</th>
                <th>{t('BO‘LIM')}</th>
                <th>{t('SAVOLLAR')}</th>
                <th className="align-right">{t('AMALLAR')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    {t('Mavzular yuklanmoqda…')}
                  </td>
                </tr>
              ) : lessons.length === 0 ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    {t('Mavzular hali qo‘shilmagan.')}
                  </td>
                </tr>
              ) : filteredLessons.length === 0 ? (
                <tr>
                  <td className="table-state" colSpan={4}>
                    {t('Filtr bo‘yicha mavzu topilmadi.')}
                  </td>
                </tr>
              ) : (
                filteredLessons.map((lesson) => {
                  const sectionIndex = sections.findIndex(
                    (section) => section.id === lesson.section_id
                  )
                  return (
                    <tr key={lesson.id}>
                      <td>
                        {lesson.is_deleted ? (
                          localizedTextForLanguage(lesson.title, language) ||
                          t('Nomsiz mavzu')
                        ) : (
                          <button
                            className="topic-name-button"
                            type="button"
                            onClick={() => openTopicQuestions(lesson)}
                          >
                            {localizedTextForLanguage(lesson.title, language) ||
                              t('Nomsiz mavzu')}
                          </button>
                        )}
                      </td>
                      <td>
                        {sectionIndex < 0 ? '—' : sectionIndex + 1}
                      </td>
                      <td>
                        <strong>{questionCounts[lesson.id] || 0}</strong>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className={
                              lesson.is_deleted || lesson.section_id === null
                                ? 'button button-quiet button-small'
                                : 'icon-button topic-action-button'
                            }
                            type="button"
                            title={
                              lesson.is_deleted || lesson.section_id === null
                                ? t('Bo‘limga biriktirish')
                                : t('Tahrirlash')
                            }
                            aria-label={
                              lesson.is_deleted || lesson.section_id === null
                                ? t('Bo‘limga biriktirish')
                                : t('Tahrirlash')
                            }
                            onClick={() => setTopicDraft({ lesson })}
                          >
                            {lesson.is_deleted || lesson.section_id === null
                              ? t('Bo‘limga biriktirish')
                              : (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z" />
                                </svg>
                              )}
                          </button>
                          {!lesson.is_deleted && (
                            <>
                              <button
                                className="icon-button topic-action-button"
                                type="button"
                                title={t('Savollar')}
                                aria-label={t('Savollar')}
                                onClick={() => openTopicQuestions(lesson)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <circle cx="12" cy="12" r="9" />
                                  <path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1 .9-1.8 1.2-1.8 2.7M12 17h.01" />
                                </svg>
                              </button>
                            </>
                          )}
                          <button
                            className="icon-button topic-action-button danger-icon"
                            type="button"
                            title={
                              deletingTopicId === lesson.id
                                ? t('O‘chirilmoqda…')
                                : t('Butunlay o‘chirish')
                            }
                            aria-label={
                              deletingTopicId === lesson.id
                                ? t('O‘chirilmoqda…')
                                : t('Butunlay o‘chirish')
                            }
                            disabled={deletingTopicId === lesson.id}
                            onClick={() => void permanentlyDeleteTopic(lesson)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" />
                            </svg>
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
      </section>
      {topicDraft && (
        <TopicEditor
          key={topicDraft.lesson?.id ?? 'new'}
          lesson={topicDraft.lesson}
          sections={sections}
          onClose={() => setTopicDraft(null)}
          onSaved={() => {
            setTopicDraft(null)
            void load()
          }}
        />
      )}
    </>
  )
}

function TopicEditor({
  lesson,
  sections,
  onClose,
  onSaved,
}: {
  lesson: BaseLesson | null
  sections: BaseSection[]
  onClose: () => void
  onSaved: () => void
}) {
  const { language, t } = useSiteLanguage()
  const [title, setTitle] = useState<LocalizedText>(() =>
    localizedText(lesson?.title)
  )
  const [sectionId, setSectionId] = useState(
    String(
      lesson &&
        !lesson.is_deleted &&
        sections.some((section) => section.id === lesson.section_id)
        ? lesson.section_id
        : sections[0]?.id || ''
    )
  )
  const [locale, setLocale] = useState<QuestionLocale>('uz-Latn')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (QUESTION_LOCALES.some((key) => !title[key].trim())) {
      setError(
        t('Mavzu nomini uchala tilda kiriting yoki avtomatik tarjimadan foydalaning.')
      )
      return
    }
    if (!sectionId) {
      setError(t('Mavzu uchun bo‘limni tanlang.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const client = requireSupabase()
      const sortOrder =
        lesson && lesson.section_id === Number(sectionId)
          ? lesson.sort_order
          : await client
              .from('base_lessons')
              .select('sort_order')
              .eq('section_id', Number(sectionId))
              .order('sort_order', { ascending: false })
              .limit(1)
              .then(({ data, error: orderError }) => {
                if (orderError) throw orderError
                return (data?.[0]?.sort_order ?? 0) + 1
              })
      const payload = {
        title,
        section_id: Number(sectionId),
        sort_order: sortOrder,
        is_deleted: false,
      }
      const result = lesson
        ? await client.from('base_lessons').update(payload).eq('id', lesson.id)
        : await client.from('base_lessons').insert({
            ...payload,
            created_at: new Date().toISOString(),
          })
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
      title={lesson ? t('Mavzuni tahrirlash') : t('Yangi mavzu')}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitDisabled={sections.length === 0}
      submitLabel={lesson ? t('Saqlash') : t('Mavzu qo‘shish')}
    >
      {error && <Notice message={error} />}
      {sections.length === 0 ? (
        <p className="muted">{t('Avval “Darslar” bo‘limida bo‘lim yarating.')}</p>
      ) : (
        <>
          <label className="field">
            <span>{t('Mavzu qaysi bo‘limga tegishli?')}</span>
            <select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
            >
              {sections.map((section, index) => (
                <option key={section.id} value={section.id}>
                  {sectionName(section, index, language, t)}
                </option>
              ))}
            </select>
          </label>
          <div className="language-tabs" role="tablist" aria-label={t('Mavzu tili')}>
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
            <span>{t('Mavzu nomi')} · {QUESTION_LOCALE_LABELS[locale]}</span>
            <input
              value={title[locale]}
              onChange={(event) =>
                setTitle((current) => ({
                  ...current,
                  [locale]: event.target.value,
                }))
              }
              required
            />
          </label>
          <TranslateButton
            sourceText={title['uz-Latn']}
            onTranslated={(translations) =>
              setTitle((current) => ({ ...current, ...translations }))
            }
          />
        </>
      )}
    </Modal>
  )
}
