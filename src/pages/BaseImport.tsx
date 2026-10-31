import { useMemo, useState } from 'react'
import { PageHeader } from '../App'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/types'

const IMAGE_BUCKET = 'pdd-images'
const IMAGE_FOLDER = 'base-import'
const UPLOAD_CONCURRENCY = 6
const IMAGE_PATTERN = /\.(jpe?g|png|webp|gif)$/i

interface BankImage {
  path: string | null
  status: string
}

interface BankQuestion {
  answers: unknown[]
  images: BankImage[]
}

interface QuestionBank {
  schema_version: string
  sections: unknown[]
  lessons: unknown[]
  questions: BankQuestion[]
  orphan_answers: unknown[]
}

interface ImportProgress {
  completed: number
  total: number
  failures: string[]
}

export default function BaseImport() {
  const [bankFile, setBankFile] = useState<File | null>(null)
  const [bank, setBank] = useState<QuestionBank | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress>({ completed: 0, total: 0, failures: [] })

  const imageLookup = useMemo(() => {
    const lookup = new Map<string, File[]>()
    for (const file of imageFiles) {
      const key = file.name.toLowerCase()
      lookup.set(key, [...(lookup.get(key) || []), file])
    }
    return lookup
  }, [imageFiles])

  const referencedImages = useMemo(
    () => [...new Set((bank?.questions || [])
      .flatMap((question) => question.images)
      .filter((image) => image.status === 'available' && image.path)
      .map((image) => image.path!.split(/[\\/]/).pop()!))],
    [bank],
  )
  const missingImages = referencedImages.filter((name) => !imageLookup.has(name.toLowerCase()))
  const duplicateNames = [...imageLookup].filter(([, files]) => files.length > 1).map(([name]) => name)
  const canUpload = Boolean(bank && imageFiles.length > 0 && missingImages.length === 0 && duplicateNames.length === 0 && !busy)

  async function selectBank(file?: File) {
    setBankFile(file || null)
    setBank(null)
    setError('')
    setSuccess('')
    if (!file) return

    try {
      const value: unknown = JSON.parse(await file.text())
      if (!value || typeof value !== 'object') throw new Error('JSON ildizi obyekt bo‘lishi kerak.')
      const parsed = value as Partial<QuestionBank>
      for (const key of ['sections', 'lessons', 'questions', 'orphan_answers'] as const) {
        if (!Array.isArray(parsed[key])) throw new Error(`JSON ichida "${key}" massivi topilmadi.`)
      }
      const questions = parsed.questions
      if (!Array.isArray(questions) || !questions.every((question: unknown) =>
        typeof question === 'object' && question !== null &&
        'answers' in question && Array.isArray(question.answers) &&
        'images' in question && Array.isArray(question.images))) {
        throw new Error('Savollarning answers va images maydonlari massiv bo‘lishi kerak.')
      }
      setBank(parsed as QuestionBank)
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  function selectImageFolder(files: FileList | null) {
    setError('')
    setSuccess('')
    setImageFiles(Array.from(files || []).filter((file) => IMAGE_PATTERN.test(file.name)))
  }

  async function verifyDatabase() {
    const client = requireSupabase()
    const expected: Record<string, number> = {
      base_sections: bank!.sections.length,
      base_lessons: bank!.lessons.length,
      base_questions: bank!.questions.length,
      base_answers: bank!.questions.reduce((total, question) => total + question.answers.length, 0),
      base_question_images: bank!.questions.reduce((total, question) => total + question.images.length, 0),
      base_orphan_answers: bank!.orphan_answers.length,
    }
    for (const [table, expectedCount] of Object.entries(expected)) {
      const { count, error: queryError } = await client.from(table).select('id', { count: 'exact', head: true })
      if (queryError) throw queryError
      if (count !== expectedCount) {
        throw new Error(
          `${table}: ${count ?? 0}/${expectedCount} qator. Avval Supabase SQL Editor’da ` +
          'Base/question_bank_seed.sql faylini ishga tushiring.',
        )
      }
    }
  }

  async function uploadImages() {
    if (!bank || !canUpload) return
    if (!window.confirm(
      `${imageFiles.length} ta rasm Storage’ga yuklanadi. Ma’lumotlar bazasi oldindan SQL seed bilan to‘ldirilgan bo‘lishi kerak. Davom etasizmi?`,
    )) return

    setBusy(true)
    setError('')
    setSuccess('')
    const state: ImportProgress = { completed: 0, total: imageFiles.length, failures: [] }
    setProgress({ ...state })

    try {
      await verifyDatabase()
      const files = [...imageFiles]
      let next = 0
      async function worker() {
        while (true) {
          const index = next++
          if (index >= files.length) return
          const file = files[index]
          try {
            const storagePath = `${IMAGE_FOLDER}/${file.name}`
            const { error: uploadError } = await requireSupabase().storage.from(IMAGE_BUCKET).upload(storagePath, file, {
              cacheControl: '31536000',
              contentType: file.type || undefined,
              upsert: true,
            })
            if (uploadError) throw uploadError
          } catch (reason) {
            state.failures.push(`${file.name}: ${getErrorMessage(reason)}`)
          } finally {
            state.completed++
            if (state.completed % 10 === 0 || state.completed === state.total) {
              setProgress({ ...state, failures: [...state.failures] })
            }
          }
        }
      }

      await Promise.all(Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, files.length) },
        () => worker(),
      ))
      if (state.failures.length > 0) {
        throw new Error(`${state.failures.length} ta rasm yuklanmadi: ${state.failures.slice(0, 5).join(' | ')}`)
      }
      setSuccess(`${state.completed} ta rasm pdd-images/${IMAGE_FOLDER}/ ichiga yuklandi.`)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Base fayllarini yuklash"
        description="Savol ma’lumotlari SQL seed orqali, rasmlar esa Supabase Storage’ga yuklanadi."
      />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}

      <div className="base-import-layout">
        <section className="panel-card base-import-step">
          <h2>1. Savol bankini tekshirish</h2>
          <p>Base/question_bank.json faylini tanlang. Uni avval <code>generate:base-seed</code> bilan SQL seed fayliga aylantirib, Supabase SQL Editor’da ishga tushiring.</p>
          <label className="bulk-file-picker">
            <span className="bulk-file-icon">▤</span>
            <span>
              <strong>{bankFile?.name || 'question_bank.json faylini tanlang'}</strong>
              <small>{bank ? `${bank.sections.length} bo‘lim · ${bank.lessons.length} dars · ${bank.questions.length} savol` : 'JSON format'}</small>
            </span>
            <span className="button button-quiet button-small">Tanlash</span>
            <input type="file" accept=".json,application/json" onChange={(event) => void selectBank(event.target.files?.[0])} disabled={busy} />
          </label>
        </section>

        <section className="panel-card base-import-step">
          <h2>2. Rasmlarni yuklash</h2>
          <p>Base/images papkasini tanlang. JSON’dagi barcha mavjud rasm havolalari tekshiriladi.</p>
          <label className="bulk-file-picker">
            <span className="bulk-file-icon image-icon">▧</span>
            <span>
              <strong>{imageFiles.length ? `${imageFiles.length} ta rasm tanlandi` : 'Base/images papkasini tanlang'}</strong>
              <small>{missingImages.length ? `${missingImages.length} ta kerakli rasm topilmadi` : 'PNG, JPG, WEBP yoki GIF'}</small>
            </span>
            <span className="button button-quiet button-small">Papkani tanlash</span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={(event) => selectImageFolder(event.target.files)}
              {...{ webkitdirectory: '', directory: '' }}
            />
          </label>
          {duplicateNames.length > 0 && <p className="base-import-error">Takrorlangan rasm nomlari: {duplicateNames.slice(0, 8).join(', ')}</p>}
          {missingImages.length > 0 && <p className="base-import-error">Topilmadi: {missingImages.slice(0, 8).join(', ')}</p>}
        </section>

        {bank && (
          <section className="panel-card base-import-summary">
            <h2>Manba tahlili</h2>
            <div className="base-import-metrics">
              <Metric label="Bo‘lim" value={bank.sections.length} />
              <Metric label="Dars" value={bank.lessons.length} />
              <Metric label="Savol" value={bank.questions.length} />
              <Metric label="Javob" value={bank.questions.reduce((total, question) => total + question.answers.length, 0)} />
              <Metric label="Rasm havolasi" value={bank.questions.reduce((total, question) => total + question.images.length, 0)} />
              <Metric label="Orphan javob" value={bank.orphan_answers.length} />
            </div>
            <p className="base-import-note">
              Rasmga havolasi uzilgan savollar va savoli topilmagan javoblar ham bazada saqlanadi.
              JSON’da yo‘q imtihon variantlari sun’iy yaratilmaydi.
            </p>
          </section>
        )}

        {busy && (
          <section className="panel-card base-import-progress">
            <strong>Storage’ga yuklanmoqda… {progress.completed}/{progress.total}</strong>
            <div className="progress-track">
              <div className="progress-value blue" style={{
                width: `${progress.total ? Math.round(progress.completed / progress.total * 100) : 0}%`,
              }} />
            </div>
          </section>
        )}

        <button className="button button-primary" onClick={() => void uploadImages()} disabled={!canUpload}>
          {busy ? 'Yuklanmoqda…' : 'Base rasmlarini Supabase’ga yuklash'}
        </button>
      </div>
    </>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="base-import-metric"><strong>{value.toLocaleString()}</strong><span>{label}</span></div>
}
