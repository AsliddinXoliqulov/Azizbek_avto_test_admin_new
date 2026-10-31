export type AdminRole = 'SUPER_ADMIN' | 'SUB_ADMIN'
export type CategoryKind = 'TOPIC' | 'ROAD_SIGN' | 'CHEATSHEET'
export type QuestionStatus = 'DRAFT' | 'PUBLISHED'

export interface AdminProfile {
  id: string
  email: string
  full_name: string | null
  role: AdminRole
  is_active: boolean
}

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  sort_order: number
  is_deleted: boolean
}

export interface Bilet {
  id: string
  number: number
  title: string | null
  is_deleted: boolean
}

export interface Question {
  id: string
  bilet_id: string | null
  bilet_position: number | null
  category_id: string | null
  text: string
  options: string[]
  correct_index: number
  image_url: string | null
  image_urls: string[]
  explanation: string | null
  explanation_image_url: string | null
  explanation_image_urls: string[]
  sign_code: string | null
  is_tricky: boolean
  is_road_sign: boolean
  is_numeric: boolean
  status: QuestionStatus
  is_deleted: boolean
  created_at: string
}

export interface CoverageReport {
  questions_total: number
  questions_published: number
  questions_draft: number
  bilets_total: number
  tricky_count: number
  numeric_count: number
  road_sign_count: number
  reference_signs_total: number
  reference_signs_missing: number
  active_codes: number
  pending_codes: number
}

export interface ActivationToken {
  id: string
  code: string
  note: string | null
  status: 'PENDING' | 'ACTIVATED' | 'EXPIRED' | 'REVOKED'
  created_at: string
  expires_at: string
  device_id: string | null
  activated_at: string | null
  created_by: string | null
}

export interface AdminListItem extends AdminProfile {
  created_at: string
  tokens_created: number
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) {
    return String(error.message)
  }
  return 'Kutilmagan xatolik yuz berdi.'
}
