import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { TranslateButton } from '../components/TranslateButton'
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

function sectionName(section: BaseSection, index: number) {
  const name = localizedText(section.name)
  const automatic =
    /^\d+\s*[-–]\s*bo[’‘ʻ']?lim$/i.test(name['uz-Latn'].trim()) ||
    /^\d+\s*[-–]\s*бўлим$/i.test(name['uz-Cyrl'].trim()) ||
    /^раздел\s+\d+$/i.test(name.ru.trim())
  return automatic
    ? `${index + 1}-bo‘lim`
    : name['uz-Latn'] || name.ru || `Bo‘lim ${index + 1}`
}

export default function Categories() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [sections, setSections] = useState<BaseSection[]>([])
  const [lessons, setLessons] = useState<BaseLesson[]>([])
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>(
    {}
  )
  const [topicDraft, setTopicDraft] = useState<TopicDraft | null>(null)
  const [deletingTopicId, setDeletingTopicId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  async function removeTopic(lesson: BaseLesson) {
    const confirmed = await confirm({
      title: 'Mavzuni o‘chirish',
      message:
        'Mavzu o‘chiriladi va unga bog‘langan savollar mavzudan ajratiladi. Savollar bazadan o‘chirilmaydi.',
      confirmLabel: 'O‘chirish',
      danger: true,
    })
    if (!confirmed) return
    try {
      const client = requireSupabase()
      const { error: baseError } = await client
        .from('base_questions')
        .update({
          lesson_id: null,
          pending_lesson_id: null,
          pending_unassigned_at: null,
        })
        .eq('lesson_id', lesson.id)
      if (baseError) throw baseError
      const { error: adminError } = await client
        .from('admin_new_questions')
        .update({
          lesson_id: null,
          pending_lesson_id: null,
          pending_unassigned_at: null,
        })
        .eq('lesson_id', lesson.id)
      if (adminError) throw adminError
      const { error: lessonError } = await client
        .from('base_lessons')
        .update({ is_deleted: true })
        .eq('id', lesson.id)
      if (lessonError) throw lessonError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function permanentlyDeleteTopic(lesson: BaseLesson) {
    const confirmed = await confirm({
      title: 'Mavzuni butunlay o‘chirish',
      message:
        'Bu amalni ortga qaytarib bo‘lmaydi. Mavzuga biriktirilgan savollar saqlanadi, lekin mavzudan ajratiladi. Davom etasizmi?',
      confirmLabel: 'Butunlay o‘chirish',
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
        throw new Error('Mavzu topilmadi yoki uni o‘chirishga ruxsat yo‘q.')
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
            ＋ Mavzu qo‘shish
          </button>
        }
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      <section className="panel-card table-panel">
        <div className="filter-bar">
          <strong className="topic-list-heading">Mavzular ro‘yxati</strong>
          <span className="count-pill">{lessons.length} ta mavzu</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>MAVZU</th>
                <th>BO‘LIM</th>
                <th>HOLATI</th>
                <th>SAVOLLAR</th>
                <th className="align-right">AMALLAR</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="table-state" colSpan={5}>
                    Mavzular yuklanmoqda…
                  </td>
                </tr>
              ) : lessons.length === 0 ? (
                <tr>
                  <td className="table-state" colSpan={5}>
                    Mavzular hali qo‘shilmagan.
                  </td>
                </tr>
              ) : (
                lessons.map((lesson) => {
                  const sectionIndex = sections.findIndex(
                    (section) => section.id === lesson.section_id
                  )
                  const section = sections[sectionIndex]
                  return (
                    <tr key={lesson.id}>
                      <td>
                        {lesson.is_deleted ? (
                          lesson.title['uz-Latn'] ||
                          lesson.title.ru ||
                          'Nomsiz mavzu'
                        ) : (
                          <button
                            className="topic-name-button"
                            type="button"
                            onClick={() => openTopicQuestions(lesson)}
                          >
                            {lesson.title['uz-Latn'] ||
                              lesson.title.ru ||
                              'Nomsiz mavzu'}
                          </button>
                        )}
                      </td>
                      <td>
                        {lesson.section_id === null
                          ? 'Biriktirilmagan'
                          : section
                            ? sectionName(section, sectionIndex)
                            : 'Bo‘lim topilmadi'}
                      </td>
                      <td>
                        {lesson.is_deleted
                          ? 'O‘chirilgan'
                          : lesson.section_id === null
                            ? 'Biriktirilmagan'
                            : 'Faol'}
                      </td>
                      <td>
                        <strong>{questionCounts[lesson.id] || 0}</strong>{' '}
                        <span className="muted">ta savol</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="button button-quiet button-small"
                            type="button"
                            onClick={() => setTopicDraft({ lesson })}
                          >
                            {lesson.is_deleted || lesson.section_id === null
                              ? 'Bo‘limga biriktirish'
                              : 'Tahrirlash'}
                          </button>
                          {!lesson.is_deleted && (
                            <>
                              <button
                                className="button button-quiet button-small"
                                type="button"
                                onClick={() => openTopicQuestions(lesson)}
                              >
                                Savollar
                              </button>
                              <button
                                className="button button-danger button-small"
                                type="button"
                                disabled={deletingTopicId === lesson.id}
                                onClick={() => void removeTopic(lesson)}
                              >
                                O‘chirish
                              </button>
                            </>
                          )}
                          <button
                            className="button button-danger-quiet button-small"
                            type="button"
                            disabled={deletingTopicId === lesson.id}
                            onClick={() => void permanentlyDeleteTopic(lesson)}
                          >
                            {deletingTopicId === lesson.id
                              ? 'O‘chirilmoqda…'
                              : 'Butunlay o‘chirish'}
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
        'Mavzu nomini uchala tilda kiriting yoki avtomatik tarjimadan foydalaning.'
      )
      return
    }
    if (!sectionId) {
      setError('Mavzu uchun bo‘limni tanlang.')
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
      title={lesson ? 'Mavzuni tahrirlash' : 'Yangi mavzu'}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitDisabled={sections.length === 0}
      submitLabel={lesson ? 'Saqlash' : 'Mavzu qo‘shish'}
    >
      {error && <Notice message={error} />}
      {sections.length === 0 ? (
        <p className="muted">Avval “Darslar” bo‘limida bo‘lim yarating.</p>
      ) : (
        <>
          <label className="field">
            <span>Mavzu qaysi bo‘limga tegishli?</span>
            <select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
            >
              {sections.map((section, index) => (
                <option key={section.id} value={section.id}>
                  {sectionName(section, index)}
                </option>
              ))}
            </select>
          </label>
          <div className="language-tabs" role="tablist" aria-label="Mavzu tili">
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
            <span>Mavzu nomi · {QUESTION_LOCALE_LABELS[locale]}</span>
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
