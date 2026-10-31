import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const baseDir = path.resolve(process.env.PDD_BASE_DIR || path.join(scriptDir, '..', '..', 'Base'))
const sourcePath = path.resolve(baseDir, process.env.PDD_BASE_JSON || 'question_bank.json')
const outputPath = path.resolve(baseDir, process.env.PDD_BASE_SEED_OUTPUT || 'question_bank_seed.sql')

const source = await readFile(sourcePath, 'utf8')
const parsed = JSON.parse(source)
for (const key of ['sections', 'lessons', 'questions', 'orphan_answers', 'exam_variants']) {
  if (!Array.isArray(parsed[key])) {
    throw new Error(`Base/question_bank.json ichida "${key}" massivi topilmadi.`)
  }
}

let delimiter = '$pdd_seed$'
let delimiterIndex = 0
while (source.includes(delimiter)) delimiter = `$pdd_seed_${delimiterIndex++}$`

const sql = [
  `-- Generated from ${path.basename(sourcePath)}. Re-run: npm run generate:base-seed`,
  `select public.seed_base_question_bank(${delimiter}${source.trim()}${delimiter}::jsonb);`,
  '',
].join('\n')

await writeFile(outputPath, sql, 'utf8')
console.log(`Seed SQL yozildi: ${outputPath}`)
console.log(
  `Bo‘limlar: ${parsed.sections.length}; darslar: ${parsed.lessons.length}; ` +
  `savollar: ${parsed.questions.length}; orphan javoblar: ${parsed.orphan_answers.length}`,
)
