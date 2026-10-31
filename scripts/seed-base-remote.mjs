import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const repoDir = path.resolve(frontendDir, '..')
const baseDir = path.resolve(process.env.PDD_BASE_DIR || path.join(repoDir, 'Base'))
const BATCH = 40
const RETRIES = 6

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry(label, run) {
  let lastError
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const result = await run()
      if (result?.error) {
        const hint = result.error.message?.includes('permission denied') || result.error.code === '42501'
          ? ' Avval SQL Editor’da Frontend/supabase_live_fix.sql ni RUN qiling.'
          : ''
        throw new Error(`${result.error.message || result.error.code || 'xato'}.${hint}`)
      }
      return result
    } catch (error) {
      lastError = error
      const message = error?.message || String(error)
      const retryable = /fetch failed|network|timeout|ECONNRESET|ETIMEDOUT|503|502|429/i.test(message)
      if (!retryable || attempt === RETRIES) break
      const wait = attempt * 1500
      console.log(`  qayta urinish (${attempt}/${RETRIES}) ${label}: ${message}`)
      await sleep(wait)
    }
  }
  throw new Error(`${label}: ${lastError?.message || lastError}`)
}

function readEnv(contents) {
  const values = new Map()
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values.set(line.slice(0, separator).trim(), value)
  }
  return values
}

async function loadCredentials() {
  const env = readEnv(await readFile(path.join(frontendDir, '.env'), 'utf8').catch(() => ''))
  let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || env.get('VITE_SUPABASE_URL')
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    try {
      const mcp = JSON.parse(await readFile(path.join(repoDir, '.cursor', 'mcp.json'), 'utf8'))
      url = url || mcp.mcpServers?.supabase?.env?.SUPABASE_URL
      key = key || mcp.mcpServers?.supabase?.env?.SUPABASE_SERVICE_ROLE_KEY
    } catch {
      /* optional */
    }
  }
  if (!url || !key) {
    throw new Error('SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY topilmadi. Avval Frontend/supabase_live_fix.sql ni ishga tushiring.')
  }
  return { url, key }
}

async function upsert(client, table, rows, conflict) {
  for (let index = 0; index < rows.length; index += BATCH) {
    const chunk = rows.slice(index, index + BATCH)
    const label = `${table} ${index + 1}–${index + chunk.length}`
    await withRetry(label, () => client.from(table).upsert(chunk, { onConflict: conflict, ignoreDuplicates: false }))
    process.stdout.write(`  ${table}: ${Math.min(index + chunk.length, rows.length)}/${rows.length}\r`)
    await sleep(80)
  }
  if (rows.length) console.log(`  ${table}: ${rows.length}/${rows.length}`)
}

async function deleteAll(client, table, idColumn = 'id') {
  await withRetry(`${table} tozalash`, () => client.from(table).delete().not(idColumn, 'is', null))
}

function storagePath(image) {
  if (image.status !== 'available' || !image.path || image.path === 'null') return null
  return `base-import/${String(image.path).replace(/\\/g, '/')}`
}

async function main() {
  const sourcePath = path.resolve(baseDir, process.env.PDD_BASE_JSON || 'question_bank.json')
  const source = JSON.parse(await readFile(sourcePath, 'utf8'))
  const { url, key } = await loadCredentials()
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`Base savollarini Supabase’ga bo‘laklab yuklash: ${path.basename(sourcePath)}`)
  console.log(`  Savollar: ${source.questions.length}, javoblar: ${source.questions.reduce((n, q) => n + q.answers.length, 0)}`)

  await withRetry('Ulanish', () => client.from('base_questions').select('id', { count: 'exact', head: true }))

  await upsert(client, 'base_sections', source.sections.map((row) => ({
    id: row.id,
    sort_order: row.order,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.created_at,
  })), 'id')

  await upsert(client, 'base_lessons', source.lessons.map((row) => ({
    id: row.id,
    section_id: row.section_id,
    sort_order: row.order,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.created_at,
  })), 'id')

  await upsert(client, 'base_questions', source.questions.map((row) => ({
    id: row.id,
    question_type: row.type,
    lesson_id: row.lesson_id,
    sort_order: row.order ?? null,
    text: row.text,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_deleted: false,
  })), 'id')

  console.log('  Eski javob/rasmlar tozalanmoqda…')
  await deleteAll(client, 'base_answers')
  await deleteAll(client, 'base_question_images')
  await deleteAll(client, 'base_orphan_answers')
  await deleteAll(client, 'base_exam_variants')

  const answers = source.questions.flatMap((question) =>
    (question.answers || []).map((answer, index) => ({
      id: answer.id,
      question_id: question.id,
      sort_order: index,
      text: answer.text,
      is_correct: Boolean(answer.is_correct),
      created_at: answer.created_at || null,
      updated_at: answer.updated_at || null,
    })),
  )
  await upsert(client, 'base_answers', answers, 'id')

  const images = source.questions.flatMap((question) =>
    (question.images || []).map((image) => ({
      id: image.id,
      question_id: question.id,
      role: image.role,
      path: image.path ?? null,
      source_path: image.source_path ?? null,
      storage_path: storagePath(image),
      status: image.status === 'available' && image.path ? 'available' : 'missing',
      link_basis: image.link_basis ?? null,
    })),
  )
  await upsert(client, 'base_question_images', images, 'id')

  if (source.orphan_answers.length) {
    await upsert(client, 'base_orphan_answers', source.orphan_answers.map((row) => ({
      id: row.id,
      question_type: row.type,
      question_id: row.question_id,
      text: row.text,
      is_correct: Boolean(row.is_correct),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    })), 'id')
  }

  await upsert(client, 'base_import_metadata', [
    { key: 'schema_version', value: source.schema_version },
    { key: 'source', value: source.source },
    { key: 'data_quality', value: source.data_quality },
  ], 'key')

  const expected = {
    base_sections: source.sections.length,
    base_lessons: source.lessons.length,
    base_questions: source.questions.length,
    base_answers: answers.length,
    base_question_images: images.length,
    base_orphan_answers: source.orphan_answers.length,
  }
  for (const [table, count] of Object.entries(expected)) {
    const { count: actual } = await withRetry(`${table} sanash`, () =>
      client.from(table).select('id', { count: 'exact', head: true }))
    if (actual !== count) throw new Error(`${table}: kutilgan ${count}, bazada ${actual}`)
    console.log(`  tekshiruv ${table}: ${actual}`)
  }

  let refresh
  try {
    refresh = await withRetry('refresh_legacy_questions_from_base', () =>
      client.rpc('refresh_legacy_questions_from_base'))
  } catch (error) {
    refresh = { error }
  }
  if (refresh.error) {
    console.log('\nBase jadvallar yuklandi. Admin panel proyeksiyasi uchun SQL Editor’da')
    console.log('Frontend/supabase_seed_finish.sql faylini RUN qiling (kichik fayl).')
    console.log(`RPC: ${refresh.error.message}`)
    return
  }
  console.log('Admin panel yangilandi:', refresh.data)
  console.log('Tayyor. Desktop ilovada “Bazani yangilash”ni bosing.')
}

main().catch((error) => {
  console.error(`Seed xatosi: ${error.message}`)
  process.exitCode = 1
})
