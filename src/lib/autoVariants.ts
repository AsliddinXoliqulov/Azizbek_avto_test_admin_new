import { requireSupabase } from './supabase'
import type { LocalizedText } from './types'

export type AutoVariantKind = 'question-bank' | 'admin-new'
export type AutoQuestionSource = 'base' | 'admin_new'

export interface AutoVariantQuestion {
  key: string
  source: AutoQuestionSource
  id: number
  is_new: boolean
  is_numeric: boolean
  is_similar: boolean
  text: Partial<LocalizedText>
  option_count: number
  lesson_id: number | null
  created_at: string
  variant_number: number
  variant_position: number
}

export interface AutoVariant {
  id: string
  number: number
  title: string
  kind: AutoVariantKind
  question_count: number
  questions: AutoVariantQuestion[]
}

export interface AutoVariantCatalog {
  variants: AutoVariant[]
  questions: AutoVariantQuestion[]
}

interface BaseQuestionRow {
  id: number
  is_new: boolean
  is_numeric: boolean
  is_similar: boolean
  text: Partial<LocalizedText>
  lesson_id: number | null
  created_at: string
}

interface BaseAnswerRow {
  question_id: number
  is_correct: boolean
}

interface AdminQuestionRow {
  id: number
  is_new: boolean
  text: string
  text_i18n: Partial<LocalizedText> | null
  options: string[] | null
  correct_index: number
  is_numeric: boolean
  is_similar: boolean
  lesson_id: number | null
  created_at: string
}

function questionKey(source: AutoQuestionSource, id: number) {
  return `${source}:${id}`
}

async function fetchAll<T>(
  request: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await request(from, from + 499)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 500) return rows
  }
}

function sortedById(rows: AutoVariantQuestion[]) {
  return rows.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'base' ? -1 : 1
    return a.id - b.id
  })
}

function sortedByCreatedAt(rows: AutoVariantQuestion[]) {
  return rows.sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
    || a.id - b.id
    || (a.source === b.source ? 0 : a.source === 'base' ? -1 : 1))
}

function buildVariants(rows: AutoVariantQuestion[], kind: AutoVariantKind, firstNumber: number) {
  const variants: AutoVariant[] = []
  for (let offset = 0; offset < rows.length; offset += 20) {
    const index = Math.floor(offset / 20) + 1
    const number = firstNumber + index - 1
    const questions = rows.slice(offset, offset + 20).map((question, itemIndex) => ({
      ...question,
      variant_number: number,
      variant_position: itemIndex + 1,
    }))
    variants.push({
      id: `auto-variant-${number}`,
      number,
      title: kind === 'admin-new' ? `Yangi variant — ${number}` : `Variant ${number}`,
      kind,
      question_count: questions.length,
      questions,
    })
  }
  return variants
}

export async function fetchAutoVariantCatalog(): Promise<AutoVariantCatalog> {
  const client = requireSupabase()
  const [baseRows, answerRows, adminRows] = await Promise.all([
    fetchAll<BaseQuestionRow>((from, to) => client.from('base_questions')
      .select('id,is_new,is_numeric,is_similar,text,lesson_id,created_at')
      .eq('is_deleted', false).order('id').range(from, to)),
    fetchAll<BaseAnswerRow>((from, to) => client.from('base_answers')
      .select('question_id,is_correct').order('question_id').range(from, to)),
    fetchAll<AdminQuestionRow>((from, to) => client.from('admin_new_questions')
      .select('id,is_new,is_numeric,is_similar,text,text_i18n,options,correct_index,lesson_id,created_at')
      .eq('is_deleted', false).order('id').range(from, to)),
  ])
  const answerStats = new Map<number, { count: number; correct: number }>()
  for (const answer of answerRows) {
    const stats = answerStats.get(answer.question_id) || { count: 0, correct: 0 }
    stats.count++
    if (answer.is_correct) stats.correct++
    answerStats.set(answer.question_id, stats)
  }

  const questions: AutoVariantQuestion[] = baseRows
    .filter((question) => {
      const stats = answerStats.get(question.id)
      return stats && stats.count >= 2 && stats.correct === 1
    })
    .map((question) => ({
      key: questionKey('base', question.id),
      source: 'base',
      id: question.id,
      is_new: question.is_new,
      is_numeric: question.is_numeric,
      is_similar: question.is_similar,
      text: question.text || {},
      option_count: answerStats.get(question.id)?.count || 0,
      lesson_id: question.lesson_id,
      created_at: question.created_at,
      variant_number: 0,
      variant_position: 0,
    }))

  for (const question of adminRows) {
    const options = question.options || []
    if (options.length < 2 || question.correct_index < 0 || question.correct_index >= options.length) continue
    questions.push({
      key: questionKey('admin_new', question.id),
      source: 'admin_new',
      id: question.id,
      is_new: question.is_new,
      is_numeric: question.is_numeric,
      is_similar: question.is_similar,
      text: question.text_i18n || { 'uz-Latn': question.text },
      option_count: options.length,
      lesson_id: question.lesson_id,
      created_at: question.created_at,
      variant_number: 0,
      variant_position: 0,
    })
  }

  const regular = sortedById(questions.filter((question) => !question.is_new))
  const newlyClassified = sortedByCreatedAt(questions.filter((question) => question.is_new))
  const regularVariants = buildVariants(regular, 'question-bank', 1)
  const firstNewNumber = regularVariants.length + 1
  const newVariants = buildVariants(newlyClassified, 'admin-new', firstNewNumber)
  const allQuestions = [...regularVariants, ...newVariants].flatMap((variant) => variant.questions)
  return {
    variants: [...regularVariants, ...newVariants],
    questions: allQuestions,
  }
}
