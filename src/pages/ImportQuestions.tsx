import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../App'
import { Notice } from '../components/Notice'
import { requireSupabase } from '../lib/supabase'
import { useSiteLanguage } from '../lib/siteLanguage'
import { getErrorMessage } from '../lib/types'

interface ImportedQuestion {
  text: string
  options: string[]
  correct_index: number
  lesson_id?: number | null
  image_url?: string | null
  explanation?: string | null
  explanation_image_url?: string | null
}

export default function ImportQuestions() {
  const { t } = useSiteLanguage()
  const example = JSON.stringify([{
    text: t('Yo‘l belgisi nimani bildiradi?'),
    options: [t('Birinchi javob'), t('Ikkinchi javob'), t('Uchinchi javob'), t('To‘rtinchi javob')],
    correct_index: 0,
    lesson_id: null,
    explanation: t('Belgi haqida tushuntirish.'),
  }], null, 2)
  const [json, setJson] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function importQuestions() {
    setError('')
    setSuccess('')
    let rows: unknown
    try {
      rows = JSON.parse(json)
    } catch (reason) {
      setError(t('JSON formati noto‘g‘ri: {0}').replace('{0}', getErrorMessage(reason)))
      return
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      setError(t('JSON ichida kamida bitta savoldan iborat massiv bo‘lishi kerak.'))
      return
    }
    if (rows.length > 250) {
      setError(t('Bir martada ko‘pi bilan 250 ta savol import qilinadi. Faylni bo‘lib yuklang.'))
      return
    }

    const validated: ImportedQuestion[] = []
    for (const [index, item] of rows.entries()) {
      if (!item || typeof item !== 'object') {
        setError(t('{0}-qator savol obyekti emas.').replace('{0}', String(index + 1)))
        return
      }
      const candidate = item as Partial<ImportedQuestion>
      if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
        setError(t('{0}-savolda matn ({1}) bo‘sh.').replace('{0}', String(index + 1)).replace('{1}', 'text'))
        return
      }
      if (!Array.isArray(candidate.options) || candidate.options.length < 2 ||
          candidate.options.some((option) => typeof option !== 'string' || !option.trim())) {
        setError(t('{0}-savolda kamida 2 ta to‘ldirilgan javob varianti ({1}) bo‘lishi kerak.').replace('{0}', String(index + 1)).replace('{1}', 'options'))
        return
      }
      if (!Number.isInteger(candidate.correct_index) || candidate.correct_index! < 0 || candidate.correct_index! >= candidate.options.length) {
        setError(t('{0}-savolning {1} qiymati javob variantlari chegarasida bo‘lishi kerak.').replace('{0}', String(index + 1)).replace('{1}', 'correct_index'))
        return
      }
      if (candidate.lesson_id != null && (!Number.isInteger(candidate.lesson_id) || candidate.lesson_id < 1)) {
        setError(t('{0}-savolning {1} qiymati musbat butun son yoki null bo‘lishi kerak.').replace('{0}', String(index + 1)).replace('{1}', 'lesson_id'))
        return
      }
      validated.push(candidate as ImportedQuestion)
    }

    setBusy(true)
    try {
      const payload = validated.map((item) => ({
        text: item.text.trim(),
        options: item.options.map((option) => option.trim()),
        correct_index: item.correct_index,
        lesson_id: item.lesson_id ?? null,
        image_url: item.image_url || null,
        explanation: item.explanation || null,
        explanation_image_url: item.explanation_image_url || null,
      }))
      const { error: insertError } = await requireSupabase().from('admin_new_questions').insert(payload)
      if (insertError) throw insertError
      setSuccess(t('{0} ta admin savoli qo‘shildi. {1} null bo‘lsa yangi savol, berilgan bo‘lsa tegishli darsga biriktiriladi.')
        .replace('{0}', String(payload.length)).replace('{1}', 'lesson_id'))
      setJson('')
      setFileName('')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return
    setError('')
    setSuccess('')
    try {
      setJson(await file.text())
      setFileName(file.name)
    } catch (reason) {
      setError(t('Faylni o‘qib bo‘lmadi: {0}').replace('{0}', getErrorMessage(reason)))
    }
  }

  function downloadExample() {
    const url = URL.createObjectURL(new Blob([example], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'pdd-savollar-namuna.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader title="Admin savollari importi" description="JSON fayldan admin savollarini import qiling; har bir savolga lesson_id bering yoki null qoldiring." />
      {error && <Notice message={error} onClose={() => setError('')} />}
      {success && <Notice message={success} kind="success" onClose={() => setSuccess('')} />}
      <div className="import-layout">
        <section className="panel-card import-card">
          <div className="card-heading"><div><h2>{t('JSON faylni yuklash')}</h2><p>{t('{0} ko‘rsatilgan savollar darsga, null bo‘lganlari yangi savollar oqimiga tushadi.').replace('{0}', 'lesson_id')}</p></div><span className="subtle-icon">⇧</span></div>
          <label className="upload-zone">
            <span className="upload-symbol">↑</span><strong>{fileName || t('JSON faylni tanlang')}</strong><small>{t('Yoki JSON matnini pastdagi maydonga joylang · ko‘pi bilan 250 savol')}</small>
            <input type="file" accept=".json,application/json" onChange={(event) => void readFile(event.target.files?.[0])} />
          </label>
          <label className="field import-json-field"><span>{t('Savollar JSON *')}</span><textarea rows={15} spellCheck={false} value={json} onChange={(event) => { setJson(event.target.value); setFileName('') }} placeholder={example} /></label>
          <div className="import-actions"><button className="button button-quiet" onClick={downloadExample}>{t('Namuna yuklab olish')}</button><button className="button button-primary" onClick={() => void importQuestions()} disabled={busy || !json.trim()}>{busy ? t('Import qilinmoqda…') : t('⇧ Savollarni import qilish')}</button></div>
        </section>
        <aside className="import-help">
          <div className="panel-card">
            <div className="card-heading"><div><h2>{t('Import tartibi')}</h2><p>{t('Bazaga xavfsiz qo‘shish')}</p></div></div>
            <ol className="steps-list"><li><span>1</span><div><strong>{t('JSON tayyorlang')}</strong><small>{t('{0} 0 dan boshlanadi; {1} dars ID’si yoki null bo‘lsin.').replace('{0}', 'correct_index').replace('{1}', 'lesson_id')}</small></div></li><li><span>2</span><div><strong>{t('Tekshirib import qiling')}</strong><small>{t('Savollarda kamida 2 ta javob varianti bo‘lsin, bir importda maksimal 250 savol kiritiladi.')}</small></div></li><li><span>3</span><div><strong>{t('Tartiblanadi')}</strong><small>{t('Darsga biriktirilgan savollar odatiy variantlarga, yangilar esa oxirgi variantlarga qo‘shiladi.')}</small></div></li></ol>
            <Link to="/questions?type=new" className="text-link">{t('Savollar ro‘yxatiga o‘tish →')}</Link>
          </div>
          <div className="info-box import-warning"><strong>{t('PDF va rasmlar')}</strong><br />{t('Bu import JSON orqali ishlaydi, OCR qilmaydi. Matnni va rasm URL’larini oldindan tayyorlang; fayl rasmlarini Savol tahrirlash oynasidan storage’ga yuklash mumkin.')}</div>
        </aside>
      </div>
    </>
  )
}
