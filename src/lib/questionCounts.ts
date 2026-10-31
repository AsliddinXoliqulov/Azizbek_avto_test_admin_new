import { requireSupabase } from './supabase'

export async function fetchQuestionCounts(field: 'bilet_id' | 'category_id') {
  const counts: Record<string, number> = {}
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await requireSupabase().from('questions')
      .select(field)
      .eq('is_deleted', false)
      .not(field, 'is', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw error

    for (const row of data || []) {
      const id = field === 'bilet_id'
        ? ('bilet_id' in row ? row.bilet_id : null)
        : ('category_id' in row ? row.category_id : null)
      if (id) counts[id] = (counts[id] || 0) + 1
    }

    if (!data || data.length < pageSize) return counts
    offset += pageSize
  }
}
