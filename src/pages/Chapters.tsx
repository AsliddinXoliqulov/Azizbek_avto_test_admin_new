import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../App'
import { useAdmin } from '../App'
import { useConfirm } from '../components/ConfirmProvider'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { useSiteLanguage } from '../lib/siteLanguage'
import { requireSupabase } from '../lib/supabase'
import { normalizeSearchText } from '../lib/search'
import {
  getErrorMessage,
} from '../lib/types'
import type {
  BaseLesson,
  BaseSection,
  LocalizedText,
} from '../lib/types'

function localizedValue(
  value: Partial<LocalizedText> | null | undefined
): LocalizedText {
  return {
    'uz-Latn': value?.['uz-Latn'] || '',
    'uz-Cyrl': value?.['uz-Cyrl'] || '',
    ru: value?.ru || '',
  }
}

function sectionTitle(section: BaseSection, number: number): LocalizedText {
  const title = localizedValue(section.name)
  const hasAutomaticName =
    /^\d+\s*[-–]\s*bo[’‘ʻ']?lim$/i.test(title['uz-Latn'].trim()) ||
    /^\d+\s*[-–]\s*бўлим$/i.test(title['uz-Cyrl'].trim()) ||
    /^раздел\s+\d+$/i.test(title.ru.trim())
  return hasAutomaticName
    ? {
        'uz-Latn': `${number}-bo‘lim`,
        'uz-Cyrl': `${number}-бўлим`,
        ru: `Раздел ${number}`,
      }
    : title
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

interface BaseQuestionRow {
  id: number
  source: 'base' | 'admin_new'
  lesson_id: number | null
  lesson_sort_order: number | null
  text: Partial<LocalizedText>
}

interface PendingQuestionMove {
  id: number
  lesson_id: number | null
  pending_lesson_id: number
  pending_unassigned_at: string
}

const QUESTION_MOVE_WINDOW_MS = 10 * 60 * 1000

const questionKey = (question: BaseQuestionRow) =>
  `${question.source}:${question.id}`

function autoScrollDragTarget(source: HTMLElement | undefined, pointerY: number) {
  const edgeSize = 76
  const maxStep = 22
  let element = source?.parentElement ?? null
  while (element && element !== document.body && element !== document.documentElement) {
    const overflowY = window.getComputedStyle(element).overflowY
    const canScroll =
      (overflowY === 'auto' || overflowY === 'scroll') &&
      element.scrollHeight > element.clientHeight
    if (canScroll) {
      const bounds = element.getBoundingClientRect()
      const distanceFromTop = pointerY - bounds.top
      const distanceFromBottom = bounds.bottom - pointerY
      if (distanceFromTop < edgeSize && element.scrollTop > 0) {
        const step = Math.min(maxStep, Math.ceil((edgeSize - distanceFromTop) / 3))
        element.scrollTop = Math.max(0, element.scrollTop - step)
        return
      }
      if (
        distanceFromBottom < edgeSize &&
        element.scrollTop + element.clientHeight < element.scrollHeight
      ) {
        const step = Math.min(maxStep, Math.ceil((edgeSize - distanceFromBottom) / 3))
        element.scrollTop = Math.min(
          element.scrollHeight - element.clientHeight,
          element.scrollTop + step
        )
        return
      }
    }
    element = element.parentElement
  }

  const page = document.scrollingElement
  if (!page) return
  if (pointerY < edgeSize && page.scrollTop > 0) {
    page.scrollTop = Math.max(0, page.scrollTop - maxStep)
  } else if (
    pointerY > window.innerHeight - edgeSize &&
    page.scrollTop + page.clientHeight < page.scrollHeight
  ) {
    page.scrollTop = Math.min(
      page.scrollHeight - page.clientHeight,
      page.scrollTop + maxStep
    )
  }
}

async function fetchPendingMoves(
  request: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: Record<string, unknown>[] | null
    error: { message: string } | null
  }>,
  t: (text: string) => string
): Promise<PendingQuestionMove[]> {
  const rows: PendingQuestionMove[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await request(offset, offset + 499)
    if (error) throw error
    for (const row of data || []) {
      const id = Number(row.id)
      const pendingLessonId = Number(row.pending_lesson_id)
      if (
        !Number.isSafeInteger(id) ||
        !Number.isSafeInteger(pendingLessonId) ||
        typeof row.pending_unassigned_at !== 'string'
      ) {
        throw new Error(t('Vaqtincha ajratilgan savol ma’lumotlari noto‘g‘ri.'))
      }
      rows.push({
        id,
        lesson_id: row.lesson_id == null ? null : Number(row.lesson_id),
        pending_lesson_id: pendingLessonId,
        pending_unassigned_at: row.pending_unassigned_at,
      })
    }
    if (!data || data.length < 500) return rows
  }
}

export default function Chapters() {
  const { language, t } = useSiteLanguage()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { registerBackHandler } = useAdmin()

  const [sections, setSections] = useState<BaseSection[]>([])
  const [lessons, setLessons] = useState<BaseLesson[]>([])
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>(
    {}
  )
  const [showLessonPicker, setShowLessonPicker] = useState(false)
  const [lessonPickerSearch, setLessonPickerSearch] = useState('')
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<number>>(
    () => new Set()
  )
  const [attachingLessons, setAttachingLessons] = useState(false)
  const [lessonQuestions, setLessonQuestions] = useState<
    BaseLesson | undefined
  >()
  const [showQuestionPicker, setShowQuestionPicker] = useState(false)
  const [busyTopicId, setBusyTopicId] = useState<number | null>(null)
  const [pendingMoveExpiry, setPendingMoveExpiry] = useState<number | null>(
    null
  )
  const [assignmentRefreshKey, setAssignmentRefreshKey] = useState(0)
  const pendingMoveTimer = useRef<number | null>(null)
  const dragSourceLessonId = useRef<number | null>(null)
  const dragActivated = useRef(false)
  const dragPointerId = useRef<number | null>(null)
  const dragOffsetY = useRef(0)
  const dragStartRect = useRef<DOMRect | null>(null)
  const dragPointerX = useRef(0)
  const dragPointerY = useRef(0)
  const dragTargetIndex = useRef<number | null>(null)
  const lessonDragFrame = useRef<number | null>(null)
  const lessonRowElements = useRef(new Map<number, HTMLElement>())
  const previousLessonRects = useRef<Map<number, DOMRect> | null>(null)
  const [draggingLessonId, setDraggingLessonId] = useState<number | null>(null)
  const [dragPosition, setDragPosition] = useState<{ left: number; width: number; top: number } | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const activeSection = sections.find(
    (section) => section.id === activeSectionId
  )
  const sectionLessons = useMemo(
    () =>
      activeSection
        ? lessons
            .filter(
              (lesson) =>
                lesson.section_id === activeSection.id && !lesson.is_deleted
            )
            .sort(
              (left, right) =>
                left.sort_order - right.sort_order || left.id - right.id
            )
        : [],
    [activeSection, lessons]
  )
  const displayedSectionLessons = (() => {
    if (draggingLessonId === null || dropTargetIndex === null)
      return sectionLessons
    const sourceIndex = sectionLessons.findIndex(
      (lesson) => lesson.id === draggingLessonId
    )
    if (sourceIndex < 0) return sectionLessons
    const reordered = sectionLessons.filter(
      (lesson) => lesson.id !== draggingLessonId
    )
    reordered.splice(dropTargetIndex, 0, sectionLessons[sourceIndex])
    return reordered
  })()
  useLayoutEffect(() => {
    const previousRects = previousLessonRects.current
    if (previousRects) {
      for (const [lessonId, element] of lessonRowElements.current) {
        if (lessonId === draggingLessonId) continue
        const previousRect = previousRects.get(lessonId)
        if (!previousRect) continue
        const offset = previousRect.top - element.getBoundingClientRect().top
        if (!offset) continue
        element.style.transition = 'none'
        element.style.transform = `translateY(${offset}px)`
        requestAnimationFrame(() => {
          element.style.transition = ''
          element.style.transform = ''
        })
      }
    }

    return () => {
      previousLessonRects.current = new Map(
        [...lessonRowElements.current].map(([lessonId, element]) => [
          lessonId,
          element.getBoundingClientRect(),
        ])
      )
    }
  }, [draggingLessonId, dropTargetIndex])
  const availableLessons = lessons.filter(
    (lesson) =>
      lesson.section_id === null &&
      !lesson.is_deleted &&
      normalizeSearchText(
        Object.values(lesson.title || {})
          .filter((value): value is string => typeof value === 'string')
          .join(' ')
      ).includes(normalizeSearchText(lessonPickerSearch))
  )

  useEffect(() => {
    registerBackHandler(() => {
      if (showQuestionPicker) setShowQuestionPicker(false)
      else if (lessonQuestions) {
        setLessonQuestions(undefined)
        setSearchParams(
          activeSectionId === null
            ? {}
            : { sectionId: String(activeSectionId) },
          { replace: true }
        )
      } else if (activeSectionId !== null) {
        setActiveSectionId(null)
        setSearchParams({}, { replace: true })
      }
      else if (window.history.state?.idx > 0) navigate(-1)
      else navigate('/')
    })
    return () => registerBackHandler(null)
  }, [
    activeSectionId,
    lessonQuestions,
    navigate,
    registerBackHandler,
    showQuestionPicker,
  ])

  const restoreExpiredQuestionMoves = useCallback(async () => {
    const client = requireSupabase()
    const [baseMoves, adminMoves] = await Promise.all([
      fetchPendingMoves((from, to) =>
        client
          .from('base_questions')
          .select('id,lesson_id,pending_lesson_id,pending_unassigned_at')
          .not('pending_lesson_id', 'is', null)
          .order('id')
          .range(from, to),
        t
      ),
      fetchPendingMoves((from, to) =>
        client
          .from('admin_new_questions')
          .select('id,lesson_id,pending_lesson_id,pending_unassigned_at')
          .not('pending_lesson_id', 'is', null)
          .order('id')
          .range(from, to),
        t
      ),
    ])
    const now = Date.now()
    let nextExpiry = Number.POSITIVE_INFINITY
    for (const [source, moves] of [
      ['base', baseMoves],
      ['admin_new', adminMoves],
    ] as const) {
      const table = source === 'base' ? 'base_questions' : 'admin_new_questions'
      for (const move of moves) {
        const expiresAt =
          Date.parse(move.pending_unassigned_at) + QUESTION_MOVE_WINDOW_MS
        if (!Number.isFinite(expiresAt))
          throw new Error(
            `${t('Noto‘g‘ri ko‘chirish muddati')}: #${move.id}.`
          )
        if (expiresAt > now) {
          nextExpiry = Math.min(nextExpiry, expiresAt)
          continue
        }
        if (move.lesson_id !== null) {
          const { error: clearError } = await client
            .from(table)
            .update({ pending_lesson_id: null, pending_unassigned_at: null })
            .eq('id', move.id)
            .eq('pending_lesson_id', move.pending_lesson_id)
          if (clearError) throw clearError
          continue
        }
        const { error: restoreError } = await client
          .from(table)
          .update({
            lesson_id: move.pending_lesson_id,
            pending_lesson_id: null,
            pending_unassigned_at: null,
          })
          .eq('id', move.id)
          .eq('pending_lesson_id', move.pending_lesson_id)
          .is('lesson_id', null)
        if (restoreError) throw restoreError
      }
    }
    setPendingMoveExpiry(Number.isFinite(nextExpiry) ? nextExpiry : null)
  }, [t])

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
        for (const row of adminResult.data || []) {
          counts[row.lesson_id] = (counts[row.lesson_id] || 0) + 1
        }
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
    void restoreExpiredQuestionMoves()
      .then(() => load())
      .catch((reason) => {
        setError(getErrorMessage(reason))
        setLoading(false)
      })
  }, [load, restoreExpiredQuestionMoves])

  useEffect(() => {
    const requestedSectionId = Number(searchParams.get('sectionId'))
    const hasSectionId =
      Number.isSafeInteger(requestedSectionId) && requestedSectionId > 0
    setActiveSectionId(hasSectionId ? requestedSectionId : null)

    const requestedLessonId = Number(searchParams.get('lessonId'))
    if (!Number.isSafeInteger(requestedLessonId) || requestedLessonId <= 0) {
      setLessonQuestions(undefined)
      return
    }
    const lesson = lessons.find((item) => item.id === requestedLessonId)
    if (!lesson) return
    setActiveSectionId(lesson.section_id)
    setLessonQuestions(lesson)
  }, [lessons, searchParams])

  useEffect(() => {
    if (pendingMoveTimer.current !== null)
      window.clearTimeout(pendingMoveTimer.current)
    if (pendingMoveExpiry === null) return
    pendingMoveTimer.current = window.setTimeout(
      () => {
        void restoreExpiredQuestionMoves()
          .then(() => {
            setAssignmentRefreshKey((current) => current + 1)
            void load()
          })
          .catch((reason) => {
            setError(getErrorMessage(reason))
            setPendingMoveExpiry(Date.now() + 60_000)
          })
      },
      Math.max(0, pendingMoveExpiry - Date.now())
    )
    return () => {
      if (pendingMoveTimer.current !== null)
        window.clearTimeout(pendingMoveTimer.current)
    }
  }, [load, pendingMoveExpiry, restoreExpiredQuestionMoves])

  useEffect(() => {
    const updateLessonDropTarget = (clientX: number, clientY: number) => {
      const target = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>('[data-lesson-id]')
      const targetId = target ? Number(target.dataset.lessonId) : null
      const sourceId = dragSourceLessonId.current
      const remainingLessons = sectionLessons.filter(
        (lesson) => lesson.id !== sourceId
      )
      if (targetId !== null && targetId !== sourceId) {
        const targetIndex = remainingLessons.findIndex(
          (lesson) => lesson.id === targetId
        )
        if (targetIndex >= 0 && target) {
          const midpoint =
            target.getBoundingClientRect().top + target.clientHeight / 2
          const nextIndex = Math.min(
            remainingLessons.length,
            targetIndex + Number(clientY >= midpoint)
          )
          dragTargetIndex.current = nextIndex
          setDropTargetIndex(nextIndex)
          return
        }
      }
      const list = document.querySelector<HTMLElement>('.chapter-lessons')
      if (list) {
        const bounds = list.getBoundingClientRect()
        const nextIndex =
          clientY < bounds.top
            ? 0
            : clientY > bounds.bottom
              ? remainingLessons.length
              : dragTargetIndex.current ?? 0
        dragTargetIndex.current = nextIndex
        setDropTargetIndex(nextIndex)
      }
    }

    const autoScrollLessonDrag = () => {
      if (!dragActivated.current || dragSourceLessonId.current === null) {
        lessonDragFrame.current = null
        return
      }
      const source = lessonRowElements.current.get(dragSourceLessonId.current)
      autoScrollDragTarget(source, dragPointerY.current)
      updateLessonDropTarget(dragPointerX.current, dragPointerY.current)
      lessonDragFrame.current = window.requestAnimationFrame(autoScrollLessonDrag)
    }

    const finishLessonDrag = (event: PointerEvent) => {
      if (
        dragPointerId.current !== null &&
        event.pointerId !== dragPointerId.current
      )
        return
      const sourceId = dragSourceLessonId.current
      const wasActivated = dragActivated.current
      const targetIndex = dragTargetIndex.current
      dragSourceLessonId.current = null
      dragActivated.current = false
      dragPointerId.current = null
      dragStartRect.current = null
      dragTargetIndex.current = null
      if (lessonDragFrame.current !== null) {
        window.cancelAnimationFrame(lessonDragFrame.current)
        lessonDragFrame.current = null
      }
      setDraggingLessonId(null)
      setDragPosition(null)
      setDropTargetIndex(null)
      if (wasActivated && sourceId !== null && targetIndex !== null)
        void moveLessonTo(sourceId, targetIndex)
    }

    const trackLessonDrag = (event: PointerEvent) => {
      if (!dragActivated.current) return
      if (event.pointerId !== dragPointerId.current) return
      dragPointerX.current = event.clientX
      dragPointerY.current = event.clientY
      setDragPosition((current) =>
        current
          ? {
              ...current,
              top: event.clientY - dragOffsetY.current,
            }
          : current
      )
      updateLessonDropTarget(event.clientX, event.clientY)
      if (lessonDragFrame.current === null) {
        lessonDragFrame.current = window.requestAnimationFrame(autoScrollLessonDrag)
      }
    }

    document.addEventListener('pointerup', finishLessonDrag)
    document.addEventListener('pointercancel', finishLessonDrag)
    document.addEventListener('pointermove', trackLessonDrag)
    return () => {
      document.removeEventListener('pointerup', finishLessonDrag)
      document.removeEventListener('pointercancel', finishLessonDrag)
      document.removeEventListener('pointermove', trackLessonDrag)
    }
  }, [sectionLessons])

  async function addSection() {
    const confirmed = await confirm({
      title: t('Bo‘lim qo‘shish'),
      message: t('Yangi bo‘lim qo‘shmoqchimisiz?'),
      confirmLabel: t('Bo‘lim qo‘shish'),
    })
    if (!confirmed) return

    try {
      const maxSortOrder = sections.reduce(
        (max, section) => Math.max(max, section.sort_order),
        -1
      )
      const number = sections.length + 1
      const { error: insertError } = await requireSupabase()
        .from('base_sections')
        .insert({
          name: {
            'uz-Latn': `${number}-bo‘lim`,
            'uz-Cyrl': `${number}-бўлим`,
            ru: `Раздел ${number}`,
          },
          sort_order: maxSortOrder + 1,
          created_at: new Date().toISOString(),
        })
      if (insertError) throw insertError
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function assignLesson(lesson: BaseLesson, sectionId: number) {
    const nextOrder =
      lessons
        .filter((item) => item.section_id === sectionId && !item.is_deleted)
        .reduce((max, item) => Math.max(max, item.sort_order), 0) + 1
    const { error: updateError } = await requireSupabase()
      .from('base_lessons')
      .update({
        section_id: sectionId,
        sort_order: nextOrder,
        is_deleted: false,
      })
      .eq('id', lesson.id)
    if (updateError) throw updateError
    setLessons((current) =>
      current.map((item) =>
        item.id === lesson.id
          ? {
              ...item,
              section_id: sectionId,
              sort_order: nextOrder,
              is_deleted: false,
            }
          : item
      )
    )
  }

  async function attachSelectedLessons(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeSection || selectedLessonIds.size === 0) return
    setAttachingLessons(true)
    setError('')
    try {
      const selectedLessons = lessons.filter((lesson) =>
        selectedLessonIds.has(lesson.id)
      )
      let nextOrder =
        lessons
          .filter(
            (lesson) =>
              lesson.section_id === activeSection.id && !lesson.is_deleted
          )
          .reduce((max, lesson) => Math.max(max, lesson.sort_order), 0) + 1
      const client = requireSupabase()
      for (const lesson of selectedLessons) {
        const { error: updateError } = await client
          .from('base_lessons')
          .update({
            section_id: activeSection.id,
            sort_order: nextOrder,
            is_deleted: false,
          })
          .eq('id', lesson.id)
        if (updateError) throw updateError
        nextOrder += 1
      }
      setSelectedLessonIds(new Set())
      setShowLessonPicker(false)
      await load()
    } catch (reason) {
      await load()
      setError(getErrorMessage(reason))
    } finally {
      setAttachingLessons(false)
    }
  }

  async function toggleLessonAssignment(lesson: BaseLesson, checked: boolean) {
    if (checked && !activeSection) return
    if (!checked) {
      const confirmed = await confirm({
        title: t('Mavzuni bo‘limdan ajratish'),
        message: t('Ushbu mavzuni bo‘limdan ajratmoqchimisiz?'),
        confirmLabel: t('Ajratish'),
        danger: true,
      })
      if (!confirmed) return
    }
    setBusyTopicId(lesson.id)
    setError('')
    try {
      if (checked) {
        await assignLesson(lesson, activeSection!.id)
      } else {
        const { error: updateError } = await requireSupabase()
          .from('base_lessons')
          .update({ section_id: null })
          .eq('id', lesson.id)
        if (updateError) throw updateError
        setLessons((current) =>
          current.map((item) =>
            item.id === lesson.id ? { ...item, section_id: null } : item
          )
        )
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusyTopicId(null)
    }
  }

  async function moveLessonTo(lessonId: number, targetIndex: number) {
    if (!activeSection || busyTopicId !== null) return
    const orderedLessons = [...sectionLessons].sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id - right.id
    )
    const currentIndex = orderedLessons.findIndex((item) => item.id === lessonId)
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= orderedLessons.length ||
      currentIndex === targetIndex
    )
      return

    setBusyTopicId(lessonId)
    setError('')
    let completedMoves = 0
    try {
      const direction = targetIndex < currentIndex ? 'up' : 'down'
      for (let index = currentIndex; index !== targetIndex; ) {
        const { data, error: moveError } = await requireSupabase().rpc(
          'admin_move_base_lesson',
          { p_lesson_id: lessonId, p_direction: direction }
        )
        if (moveError) throw moveError
        if (!data) {
          throw new Error(
            t('Mavzu tartibini o‘zgartirib bo‘lmadi. Sahifani yangilang.')
          )
        }
        index += direction === 'up' ? -1 : 1
        completedMoves += 1
      }

      const reorderedLessons = [...orderedLessons]
      const [movedLesson] = reorderedLessons.splice(currentIndex, 1)
      reorderedLessons.splice(targetIndex, 0, movedLesson)
      const sortOrderById = new Map(
        reorderedLessons.map((item, index) => [item.id, index + 1])
      )
      setLessons((current) =>
        current.map((item) => {
          const sortOrder = sortOrderById.get(item.id)
          return sortOrder === undefined ? item : { ...item, sort_order: sortOrder }
        })
      )
    } catch (reason) {
      if (completedMoves > 0) await load()
      setError(getErrorMessage(reason))
    } finally {
      setBusyTopicId(null)
    }
  }

  async function removeSection(section: BaseSection) {
    const confirmed = await confirm({
      title: t('Bo‘limni o‘chirish'),
      message: t(
        'Bo‘lim o‘chiriladi. Ichidagi mavzular va savollar saqlanib, mavzular bo‘limsiz qoladi.'
      ),
      confirmLabel: t('O‘chirish'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const client = requireSupabase()
      const { error: lessonsError } = await client
        .from('base_lessons')
        .update({ section_id: null })
        .eq('section_id', section.id)
      if (lessonsError) throw lessonsError
      const sectionResult = await client
        .from('base_sections')
        .update({ is_deleted: true })
        .eq('id', section.id)
      if (sectionResult.error) throw sectionResult.error
      if (activeSectionId === section.id) {
        setActiveSectionId(null)
        setSearchParams({})
      }
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <>
      <PageHeader
        title={
          lessonQuestions ? 'Savollar' : activeSection ? 'Mavzular' : 'Darslar'
        }
        description={
          lessonQuestions
            ? `${localizedTextForLanguage(lessonQuestions.title, language) || 'Mavzu'} mavzusidagi savollarni ko‘ring va boshqaring.`
            : activeSection
              ? 'Mavzularni ko‘ring va boshqaring.'
              : 'Ilovadagi bo‘limlar, mavzular va savol biriktirishni boshqaring.'
        }
        action={
          lessonQuestions ? (
            <button
              className="button button-primary"
              onClick={() => setShowQuestionPicker(true)}
            >
              ＋ {t('Savol biriktirish')}
            </button>
          ) : activeSection ? (
            <div className="page-action-group">
              <button
                className="button button-primary"
                onClick={() => {
                  setSelectedLessonIds(new Set())
                  setLessonPickerSearch('')
                  setShowLessonPicker(true)
                }}
              >
                ＋ {t('Mavzularni biriktirish')}
              </button>
            </div>
          ) : undefined
        }
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {lessonQuestions ? (
        <LessonQuestionsEditor
          key={`${lessonQuestions.id}:${assignmentRefreshKey}`}
          lesson={lessonQuestions}
          showPicker={showQuestionPicker}
          onClosePicker={() => setShowQuestionPicker(false)}
          onSaved={() => {
            void restoreExpiredQuestionMoves()
              .then(() => load())
              .catch((reason) => setError(getErrorMessage(reason)))
          }}
          onViewQuestion={(question) => {
            const focus = `${question.source}:${question.id}`
            navigate(
              `/questions?search=${encodeURIComponent(localizedTextForLanguage(question.text, language))}&focus=${encodeURIComponent(focus)}`
            )
          }}
        />
      ) : loading ? (
        <section className="panel-card table-panel">
          <div className="table-state">{t('Bo‘limlar yuklanmoqda…')}</div>
        </section>
      ) : activeSection ? (
        <section className="panel-card chapter-card topic-panel">
          <div className="chapter-lessons">
            {sectionLessons.length === 0 ? (
              <div className="chapter-empty">
                {t('Bu bo‘limda mavzu yo‘q. “Mavzularni biriktirish” tugmasi orqali mavjud mavzularni tanlang.')}
              </div>
            ) : (
              displayedSectionLessons.map((lesson, index) => (
                <Fragment key={lesson.id}>
                {draggingLessonId !== null && dropTargetIndex === index && (
                  <div
                    className="lesson-row lesson-row-drop-placeholder"
                    aria-hidden="true"
                  />
                )}
                <article
                  className={`lesson-row${draggingLessonId === lesson.id ? ' is-reordering' : ''}${draggingLessonId !== null && dropTargetIndex === index ? ' is-drop-target' : ''}`}
                  ref={(element) => {
                    if (element) lessonRowElements.current.set(lesson.id, element)
                    else lessonRowElements.current.delete(lesson.id)
                  }}
                  data-lesson-id={lesson.id}
                  style={
                    draggingLessonId === lesson.id && dragPosition
                      ? {
                          position: 'fixed',
                          left: dragPosition.left,
                          top: dragPosition.top,
                          width: dragPosition.width,
                          zIndex: 50,
                        }
                      : undefined
                  }
                >
                  <span className="lesson-order">{index + 1}</span>
                  <button
                    className="icon-button topic-reorder-handle"
                    type="button"
                    title={t('Mavzuni yuqoriga yoki pastga sudrash uchun bosing va torting')}
                    aria-label={`${localizedTextForLanguage(lesson.title, language) || t('Mavzu')} ${t('mavzuni yuqoriga yoki pastga sudrash uchun bosing va torting')}`}
                    disabled={busyTopicId !== null}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || busyTopicId !== null) return
                      event.preventDefault()
                      dragSourceLessonId.current = lesson.id
                      dragPointerId.current = event.pointerId
                      dragPointerX.current = event.clientX
                      dragPointerY.current = event.clientY
                      dragOffsetY.current =
                        event.clientY -
                        event.currentTarget
                          .closest('.lesson-row')!
                          .getBoundingClientRect().top
                      const row = event.currentTarget.closest('.lesson-row')
                      if (!row) return
                      dragStartRect.current = row.getBoundingClientRect()
                      const originalIndex = sectionLessons.findIndex(
                        (item) => item.id === lesson.id
                      )
                      dragTargetIndex.current = originalIndex
                      setDropTargetIndex(originalIndex)
                      const rect = dragStartRect.current
                      dragActivated.current = true
                      setDraggingLessonId(lesson.id)
                      setDragPosition({
                        left: rect.left,
                        width: rect.width,
                        top: dragPointerY.current - dragOffsetY.current,
                      })
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="lesson-copy lesson-open-questions"
                    onClick={() => {
                      setLessonQuestions(lesson)
                      setSearchParams({
                        ...(lesson.section_id === null
                          ? {}
                          : { sectionId: String(lesson.section_id) }),
                        lessonId: String(lesson.id),
                      })
                    }}
                    aria-label={`${localizedTextForLanguage(lesson.title, language) || t('Mavzu')} ${t('savollarini biriktirish')}`}
                  >
                    <strong>
                      {localizedTextForLanguage(lesson.title, language) ||
                        t('Nomsiz mavzu')}
                    </strong>
                    <small>
                      {t('Savollar:')} {questionCounts[lesson.id] || 0}
                    </small>
                  </button>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      title={t('Mavzular bo‘limida topish')}
                      aria-label={`${localizedTextForLanguage(lesson.title, language) || t('Mavzu')} ${t('mavzular bo‘limida topish')}`}
                      onClick={() =>
                        navigate(
                          `/categories?search=${encodeURIComponent(localizedTextForLanguage(lesson.title, language))}`
                        )
                      }
                    >
                      👁
                    </button>
                    <input
                      className="topic-assignment-checkbox"
                      type="checkbox"
                      checked
                      disabled={busyTopicId !== null}
                      aria-label={`${localizedTextForLanguage(lesson.title, language) || t('Mavzu')} ${t('ni bo‘limdan ajratish')}`}
                      onChange={() => toggleLessonAssignment(lesson, false)}
                    />
                  </div>
                </article>
                </Fragment>
              ))
            )}
          </div>
        </section>
      ) : (
        <div className="chapter-grid">
          {sections.map((section, sectionIndex) => {
            const sectionLessons = lessons.filter(
              (lesson) => lesson.section_id === section.id && !lesson.is_deleted
            )
            const sectionQuestionCount = sectionLessons.reduce(
              (total, lesson) => total + (questionCounts[lesson.id] || 0),
              0
            )
            const title = sectionTitle(section, sectionIndex + 1)
            return (
              <section
                className="panel-card chapter-card chapter-overview-card"
                key={section.id}
              >
                <button
                  type="button"
                  className="chapter-open"
                  onClick={() => {
                    setActiveSectionId(section.id)
                    setSearchParams({ sectionId: String(section.id) })
                  }}
                  aria-label={`${localizedTextForLanguage(section.name, language) || t('Bo‘lim')} ${t('mavzularini ochish')}`}
                >
                  <span className="chapter-title-group">
                    <span className="chapter-open-copy">
                      <strong>
                        {localizedTextForLanguage(title, language) || t('Nomsiz bo‘lim')}
                      </strong>
                      <small>
                        {t('Darslar:')} {sectionLessons.length} ·{' '}
                        {t('Savollar:')} {sectionQuestionCount}
                      </small>
                    </span>
                  </span>
                </button>
                <div className="chapter-overview-actions">
                  <button
                    className="icon-button danger-icon"
                    title={t('Bo‘limni o‘chirish')}
                    onClick={() => void removeSection(section)}
                  >
                    🗑
                  </button>
                </div>
              </section>
            )
          })}
          <button
            type="button"
            className="chapter-add-card"
            onClick={() => void addSection()}
          >
            <span>＋</span>
            <span className="chapter-add-copy">
              <strong>{t('Bo‘lim qo‘shish')}</strong>
              <small>{t('Keyingi bo‘limni yaratish')}</small>
            </span>
          </button>
        </div>
      )}
      {showLessonPicker && activeSection && (
        <Modal
          title={t('Mavzularni bo‘limga biriktirish')}
          onClose={() => setShowLessonPicker(false)}
          onSubmit={attachSelectedLessons}
          busy={attachingLessons}
          submitDisabled={selectedLessonIds.size === 0}
          submitLabel={t('Tanlanganlarni biriktirish')}
        >
          <label className="search-field lesson-attach-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={t('Mavzu nomidan qidirish…')}
              value={lessonPickerSearch}
              onChange={(event) => setLessonPickerSearch(event.target.value)}
              aria-label={t('Mavzu nomidan qidirish')}
            />
          </label>
          {lessons.filter(
            (lesson) =>
              lesson.section_id !== activeSection.id || lesson.is_deleted
          ).length === 0 ? (
            <p className="muted">{t('Biriktirish uchun boshqa mavjud mavzu yo‘q.')}</p>
          ) : availableLessons.length === 0 ? (
            <p className="muted">{t('Qidiruv bo‘yicha mavzu topilmadi.')}</p>
          ) : (
            <div className="lesson-attach-list">
              {availableLessons.map((lesson) => {
                  return (
                    <label className="lesson-attach-option" key={lesson.id}>
                      <input
                        type="checkbox"
                        checked={selectedLessonIds.has(lesson.id)}
                        onChange={(event) =>
                          setSelectedLessonIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(lesson.id)
                            else next.delete(lesson.id)
                            return next
                          })}
                      />
                      <span>
                        <strong>
                          {localizedTextForLanguage(lesson.title, language) ||
                            t('Nomsiz mavzu')}
                        </strong>
                        <small>{t('Biriktirilmagan')}</small>
                      </span>
                    </label>
                  )
                })}
            </div>
          )}
          {selectedLessonIds.size === 0 && availableLessons.length === 0 && (
              <p className="lesson-attach-hint">
                {t('Biriktirilmagan mavzu topilmadi.')}
              </p>
            )}
        </Modal>
      )}
    </>
  )
}

async function fetchQuestions(
  request: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: Record<string, unknown>[] | null
    error: { message: string } | null
  }>,
  source: BaseQuestionRow['source']
): Promise<BaseQuestionRow[]> {
  const rows: BaseQuestionRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await request(offset, offset + 499)
    if (error) throw error
    rows.push(
      ...(data || []).map((row) => {
        const localized = source === 'admin_new' ? row.text_i18n : row.text
        return {
          id: Number(row.id),
          source,
          lesson_id: row.lesson_id === null ? null : Number(row.lesson_id),
          lesson_sort_order:
            row.lesson_sort_order === null || row.lesson_sort_order === undefined
              ? null
              : Number(row.lesson_sort_order),
          text: (localized as Partial<LocalizedText>) || {
            'uz-Latn': String(row.text || ''),
          },
        }
      })
    )
    if (!data || data.length < 500) return rows
  }
}

function LessonQuestionsEditor({
  lesson,
  showPicker,
  onClosePicker,
  onSaved,
  onViewQuestion,
}: {
  lesson: BaseLesson
  showPicker: boolean
  onClosePicker: () => void
  onSaved: () => void
  onViewQuestion: (question: BaseQuestionRow) => void
}) {
  const { language, t } = useSiteLanguage()
  const confirm = useConfirm()
  const [questions, setQuestions] = useState<BaseQuestionRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draggingQuestionKey, setDraggingQuestionKey] = useState<string | null>(null)
  const [questionDropTargetIndex, setQuestionDropTargetIndex] = useState<number | null>(null)
  const [questionDragPosition, setQuestionDragPosition] = useState<{
    left: number
    width: number
    top: number
  } | null>(null)
  const questionDragPointerId = useRef<number | null>(null)
  const questionDragOffsetY = useRef(0)
  const questionDragPointerX = useRef(0)
  const questionDragPointerY = useRef(0)
  const questionDragTargetIndex = useRef<number | null>(null)
  const questionDragSourceKey = useRef<string | null>(null)
  const questionRowElements = useRef(new Map<string, HTMLElement>())
  const questionDragFrame = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const client = requireSupabase()
        const [baseRows, adminRows] = await Promise.all([
          fetchQuestions(
            (from, to) =>
              client
                .from('base_questions')
                .select('id,lesson_id,lesson_sort_order,text')
                .eq('is_deleted', false)
                .order('id')
                .range(from, to),
            'base'
          ),
          fetchQuestions(
            (from, to) =>
              client
                .from('admin_new_questions')
                .select('id,lesson_id,lesson_sort_order,text,text_i18n')
                .eq('is_deleted', false)
                .order('id')
                .range(from, to),
            'admin_new'
          ),
        ])
        const rows = [...baseRows, ...adminRows]
        if (active) {
          setQuestions(rows)
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
  }, [lesson.id])

  useEffect(() => {
    if (showPicker) setSelected([])
  }, [showPicker])

  const visible = useMemo(() => {
    const search = normalizeSearchText(query)
    return questions
      .filter((question) => question.lesson_id === null)
      .filter(
        (question) =>
          !search ||
          Object.values(question.text || {}).some((text) =>
            normalizeSearchText(String(text)).includes(search)
          )
      )
      .sort((left, right) => left.id - right.id)
  }, [questions, query])

  const assignedQuestions = questions
    .filter((question) => question.lesson_id === lesson.id)
    .sort(
      (left, right) =>
        (left.lesson_sort_order ?? Number.MAX_SAFE_INTEGER) -
          (right.lesson_sort_order ?? Number.MAX_SAFE_INTEGER) ||
        (left.source === right.source ? 0 : left.source === 'base' ? -1 : 1) ||
        left.id - right.id
    )
  const displayedAssignedQuestions = (() => {
    if (draggingQuestionKey === null || questionDropTargetIndex === null) {
      return assignedQuestions
    }
    const source = assignedQuestions.find(
      (question) => questionKey(question) === draggingQuestionKey
    )
    if (!source) return assignedQuestions
    const reordered = assignedQuestions.filter(
      (question) => questionKey(question) !== draggingQuestionKey
    )
    reordered.splice(questionDropTargetIndex, 0, source)
    return reordered
  })()

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const client = requireSupabase()
      const add = questions.filter(
        (question) =>
          selected.includes(questionKey(question)) &&
          question.lesson_id === null
      )
      for (const source of ['base', 'admin_new'] as const) {
        const idsToAdd = add
          .filter((question) => question.source === source)
          .map((question) => question.id)
        const table =
          source === 'base' ? 'base_questions' : 'admin_new_questions'
        if (idsToAdd.length) {
          const { error: addError } = await client
            .from(table)
            .update({
              lesson_id: lesson.id,
              lesson_sort_order: null,
              pending_lesson_id: null,
              pending_unassigned_at: null,
              updated_at: new Date().toISOString(),
            })
            .in('id', idsToAdd)
          if (addError) throw addError
        }
      }
      const addedKeys = new Set(add.map(questionKey))
      setQuestions((current) =>
        current.map((question) =>
          addedKeys.has(questionKey(question))
            ? { ...question, lesson_id: lesson.id, lesson_sort_order: null }
            : question
        )
      )
      setSelected([])
      onClosePicker()
      onSaved()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function moveQuestionTo(question: BaseQuestionRow, targetIndex: number) {
    const currentIndex = assignedQuestions.findIndex(
      (item) => questionKey(item) === questionKey(question)
    )
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= assignedQuestions.length ||
      currentIndex === targetIndex
    ) return
    setBusy(true)
    setError('')
    let completedMoves = 0
    try {
      const direction = targetIndex < currentIndex ? 'up' : 'down'
      for (let index = currentIndex; index !== targetIndex; ) {
        const { data, error: moveError } = await requireSupabase().rpc(
          'admin_move_lesson_question',
          {
            p_lesson_id: lesson.id,
            p_question_source: question.source,
            p_question_id: question.id,
            p_direction: direction,
          }
        )
        if (moveError) throw moveError
        if (data !== true) {
          throw new Error(t('Savol tartibini o‘zgartirib bo‘lmadi. Sahifani yangilang.'))
        }
        index += direction === 'up' ? -1 : 1
        completedMoves += 1
      }

      const reordered = [...assignedQuestions]
      const [movedQuestion] = reordered.splice(currentIndex, 1)
      reordered.splice(targetIndex, 0, movedQuestion)
      const orderByKey = new Map(
        reordered.map((item, order) => [questionKey(item), order])
      )
      setQuestions((current) =>
        current.map((item) => {
          const order = orderByKey.get(questionKey(item))
          return order === undefined ? item : { ...item, lesson_sort_order: order }
        })
      )
    } catch (reason) {
      if (completedMoves > 0) onSaved()
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const updateQuestionDropTarget = (clientX: number, clientY: number) => {
      const target = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>('[data-question-key]')
      const targetKey = target?.dataset.questionKey
      const sourceKey = questionDragSourceKey.current
      const remainingQuestions = assignedQuestions.filter(
        (question) => questionKey(question) !== sourceKey
      )
      if (targetKey && targetKey !== sourceKey && target) {
        const targetIndex = remainingQuestions.findIndex(
          (question) => questionKey(question) === targetKey
        )
        if (targetIndex >= 0) {
          const midpoint =
            target.getBoundingClientRect().top + target.clientHeight / 2
          const nextIndex = Math.min(
            remainingQuestions.length,
            targetIndex + Number(clientY >= midpoint)
          )
          questionDragTargetIndex.current = nextIndex
          setQuestionDropTargetIndex(nextIndex)
          return
        }
      }

      const list = document.querySelector<HTMLElement>(
        '.lesson-question-page .lesson-question-list'
      )
      if (list) {
        const bounds = list.getBoundingClientRect()
        const nextIndex =
          clientY < bounds.top
            ? 0
            : clientY > bounds.bottom
              ? remainingQuestions.length
              : questionDragTargetIndex.current ?? 0
        questionDragTargetIndex.current = nextIndex
        setQuestionDropTargetIndex(nextIndex)
      }
    }

    const autoScrollQuestionDrag = () => {
      if (
        questionDragPointerId.current === null ||
        questionDragSourceKey.current === null
      ) {
        questionDragFrame.current = null
        return
      }
      const source = questionRowElements.current.get(
        questionDragSourceKey.current
      )
      autoScrollDragTarget(source, questionDragPointerY.current)
      updateQuestionDropTarget(
        questionDragPointerX.current,
        questionDragPointerY.current
      )
      questionDragFrame.current = window.requestAnimationFrame(
        autoScrollQuestionDrag
      )
    }

    const finishQuestionDrag = (event: PointerEvent) => {
      if (
        questionDragPointerId.current !== null &&
        event.pointerId !== questionDragPointerId.current
      ) return
      const sourceKey = questionDragSourceKey.current
      const targetIndex = questionDragTargetIndex.current
      const source = assignedQuestions.find(
        (question) => questionKey(question) === sourceKey
      )
      questionDragPointerId.current = null
      questionDragSourceKey.current = null
      questionDragTargetIndex.current = null
      if (questionDragFrame.current !== null) {
        window.cancelAnimationFrame(questionDragFrame.current)
        questionDragFrame.current = null
      }
      setDraggingQuestionKey(null)
      setQuestionDragPosition(null)
      setQuestionDropTargetIndex(null)
      if (source && targetIndex !== null) {
        void moveQuestionTo(
          source,
          Math.min(targetIndex, assignedQuestions.length - 1)
        )
      }
    }

    const trackQuestionDrag = (event: PointerEvent) => {
      if (
        questionDragPointerId.current === null ||
        event.pointerId !== questionDragPointerId.current
      ) return
      questionDragPointerX.current = event.clientX
      questionDragPointerY.current = event.clientY
      setQuestionDragPosition((current) =>
        current
          ? { ...current, top: event.clientY - questionDragOffsetY.current }
          : current
      )
      updateQuestionDropTarget(event.clientX, event.clientY)
      if (questionDragFrame.current === null) {
        questionDragFrame.current = window.requestAnimationFrame(
          autoScrollQuestionDrag
        )
      }
    }

    document.addEventListener('pointerup', finishQuestionDrag)
    document.addEventListener('pointercancel', finishQuestionDrag)
    document.addEventListener('pointermove', trackQuestionDrag)
    return () => {
      document.removeEventListener('pointerup', finishQuestionDrag)
      document.removeEventListener('pointercancel', finishQuestionDrag)
      document.removeEventListener('pointermove', trackQuestionDrag)
    }
  }, [assignedQuestions])

  async function unassign(question: BaseQuestionRow) {
    const confirmed = await confirm({
      title: t('Savolni mavzudan ajratish'),
      message: t('Ushbu savolni mavzudan ajratmoqchimisiz?'),
      confirmLabel: t('Ajratish'),
      danger: true,
    })
    if (!confirmed) return

    setBusy(true)
    setError('')
    try {
      const table =
        question.source === 'base' ? 'base_questions' : 'admin_new_questions'
      const { error: updateError } = await requireSupabase()
        .from(table)
        .update({
          lesson_id: null,
          lesson_sort_order: null,
          pending_lesson_id: lesson.id,
          pending_unassigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', question.id)
      if (updateError) throw updateError
      setQuestions((current) =>
        current.map((item) =>
          questionKey(item) === questionKey(question)
            ? { ...item, lesson_id: null, lesson_sort_order: null }
            : item
        )
      )
      onSaved()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <Notice message={error} />}
      <section className="panel-card lesson-question-page">
        {loading ? (
          <div className="table-state">{t('Savollar yuklanmoqda…')}</div>
        ) : assignedQuestions.length === 0 ? (
          <div className="chapter-empty">
            {t('Bu mavzuga hali savol biriktirilmagan. Yuqoridagi tugma orqali savol tanlang.')}
          </div>
        ) : (
          <div className="lesson-question-list">
            {displayedAssignedQuestions.map((question, index) => (
              <Fragment key={questionKey(question)}>
              {draggingQuestionKey !== null &&
                questionDropTargetIndex === index && (
                  <div
                    className="lesson-question-option lesson-question-drop-placeholder"
                    aria-hidden="true"
                  />
                )}
              <div
                ref={(element) => {
                  const key = questionKey(question)
                  if (element) questionRowElements.current.set(key, element)
                  else questionRowElements.current.delete(key)
                }}
                data-question-key={questionKey(question)}
                className={`lesson-question-option${draggingQuestionKey === questionKey(question) ? ' is-reordering' : ''}`}
                style={
                  draggingQuestionKey === questionKey(question) && questionDragPosition
                    ? {
                        position: 'fixed',
                        left: questionDragPosition.left,
                        top: questionDragPosition.top,
                        width: questionDragPosition.width,
                        zIndex: 50,
                      }
                    : undefined
                }
              >
                <span className="lesson-order">{index + 1}</span>
                <button
                  type="button"
                  className="icon-button topic-reorder-handle"
                  title={t('Savolni yuqoriga yoki pastga sudrash uchun bosing va torting')}
                  aria-label={t('Savolni yuqoriga yoki pastga sudrash uchun bosing va torting')}
                  disabled={busy}
                  onContextMenu={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || busy) return
                    event.preventDefault()
                    const row = event.currentTarget.closest<HTMLElement>(
                      '.lesson-question-option'
                    )
                    if (!row) return
                    const rect = row.getBoundingClientRect()
                    const sourceKey = questionKey(question)
                    const originalIndex = assignedQuestions.findIndex(
                      (item) => questionKey(item) === sourceKey
                    )
                    if (originalIndex < 0) return
                    questionDragPointerId.current = event.pointerId
                    questionDragPointerX.current = event.clientX
                    questionDragPointerY.current = event.clientY
                    questionDragSourceKey.current = sourceKey
                    questionDragOffsetY.current = event.clientY - rect.top
                    questionDragTargetIndex.current = originalIndex
                    setQuestionDropTargetIndex(originalIndex)
                    setDraggingQuestionKey(sourceKey)
                    setQuestionDragPosition({
                      left: rect.left,
                      width: rect.width,
                      top: rect.top,
                    })
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" />
                  </svg>
                </button>
                <span className="lesson-question-assigned-copy">
                  <strong>
                    {localizedTextForLanguage(question.text, language) ||
                      `${t('Savol')} #${question.id}`}
                  </strong>
                  <small>
                    {question.source === 'base'
                      ? t('Asosiy baza')
                      : t('Admin savoli')}{' '}
                    · #{question.id}
                  </small>
                </span>
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-button lesson-question-view"
                    title={t('Savolni savollar bo‘limida ko‘rish')}
                    aria-label={t('Savolni ko‘rish')}
                    onClick={() => onViewQuestion(question)}
                  >
                    👁
                  </button>
                  <input
                    className="topic-assignment-checkbox"
                    type="checkbox"
                    checked
                    disabled={busy}
                    title={t('Savol mavzuga biriktirilgan')}
                    aria-label={`${t('Savolni mavzuga biriktirish')}: ${localizedTextForLanguage(question.text, language) || `${t('Savol')} #${question.id}`}`}
                    onChange={() => void unassign(question)}
                  />
                </div>
              </div>
              </Fragment>
            ))}
          </div>
        )}
      </section>
      {showPicker && (
        <Modal
          title={t('Savol biriktirish')}
          onClose={onClosePicker}
          onSubmit={save}
          busy={busy}
          submitDisabled={loading || selected.length === 0}
          submitLabel={t('Tanlanganlarni biriktirish')}
        >
          {error && <Notice message={error} />}
          <label className="search-field lesson-question-search">
            <span>⌕</span>
            <input
              placeholder={t('Savollarni qidirish…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {loading ? (
            <div className="table-state">{t('Savollar yuklanmoqda…')}</div>
          ) : (
            <div className="lesson-question-list">
              {visible.map((question) => (
                <div
                  className="lesson-question-option"
                  key={questionKey(question)}
                >
                  <label className="lesson-question-select">
                    <span>
                      <strong>
                        {localizedTextForLanguage(question.text, language) ||
                          `${t('Savol')} #${question.id}`}
                      </strong>
                      <small>
                        {question.source === 'base'
                          ? t('Asosiy baza')
                          : t('Admin savoli')}{' '}
                        · #{question.id} · {t('biriktirilmagan')}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={selected.includes(questionKey(question))}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, questionKey(question)]
                            : current.filter(
                                (key) => key !== questionKey(question)
                              )
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button lesson-question-view"
                    title={t('Savolni savollar bo‘limida ko‘rish')}
                    aria-label={t('Savolni ko‘rish')}
                    onClick={() => onViewQuestion(question)}
                  >
                    👁
                  </button>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="table-state">
                  {questions.some((question) => question.lesson_id === null)
                    ? t('Mos savol topilmadi.')
                    : t('Biriktirilmagan savol topilmadi.')}
                </div>
              )}
            </div>
          )}
          <p className="field-hint">
            {t('Bu ro‘yxatda faqat hech qaysi mavzuga biriktirilmagan savollar ko‘rsatiladi.')}
          </p>
        </Modal>
      )}
    </>
  )
}
