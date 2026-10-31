import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const baseDir = path.resolve(process.env.PDD_BASE_DIR || path.join(frontendDir, '..', 'Base'))
const imagesDir = path.resolve(process.env.PDD_BASE_IMAGES || path.join(baseDir, 'images'))
const sourcePath = path.resolve(baseDir, process.env.PDD_BASE_JSON || 'question_bank.json')
const envPath = path.join(frontendDir, '.env')
const bucket = 'pdd-images'
const storageFolder = 'base-import'
const concurrency = 6
const imagePattern = /\.(jpe?g|png|webp|gif)$/i

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

async function prompt(question) {
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    return (await readline.question(question)).trim()
  } finally {
    readline.close()
  }
}

async function promptPassword() {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Parolni xavfsiz kiritish uchun oddiy interaktiv terminaldan foydalaning.')
  }

  stdout.write('Admin paroli (kiritish yashiriladi): ')
  stdin.setEncoding('utf8')
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise((resolve, reject) => {
    let password = ''
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
    }
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('Amal bekor qilindi.'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(password)
          return
        }
        if (character === '\u0008' || character === '\u007f') {
          if (password.length > 0) {
            password = password.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        if (character >= ' ') {
          password += character
          stdout.write('*')
        }
      }
    }
    stdin.on('data', onData)
  })
}

function contentType(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[extension] || 'application/octet-stream'
}

async function verifySeed(client, source, sourceFileName) {
  const expected = {
    base_sections: source.sections.length,
    base_lessons: source.lessons.length,
    base_questions: source.questions.length,
    base_answers: source.questions.reduce((total, question) => total + question.answers.length, 0),
    base_question_images: source.questions.reduce((total, question) => total + question.images.length, 0),
    base_orphan_answers: source.orphan_answers.length,
  }

  for (const [table, count] of Object.entries(expected)) {
    const { count: actual, error } = await client.from(table).select('id', { count: 'exact', head: true })
    if (error) throw new Error(`${table} jadvalini tekshirib bo‘lmadi: ${error.message}`)
    if (actual !== count) {
      throw new Error(
        `Base ma’lumotlari to‘liq emas: ${table} jadvalida ${actual ?? 0}/${count} qator. ` +
        `Avval Supabase SQL Editor’da Base/${sourceFileName} faylini ishga tushiring.`,
      )
    }
  }
}

async function listStorageFiles(storage, rootPath) {
  const files = new Set()
  const directories = [rootPath]
  while (directories.length > 0) {
    const directory = directories.pop()
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(directory, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw new Error(`Storage fayllarini tekshirib bo‘lmadi (${directory}): ${error.message}`)
      for (const entry of data || []) {
        const entryPath = `${directory}/${entry.name}`
        if (entry.id == null) directories.push(entryPath)
        else files.add(entryPath)
      }
      if (!data || data.length < 1000) break
    }
  }
  return files
}

async function main() {
  const [envContents, sourceContents] = await Promise.all([
    readFile(envPath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw new Error('Frontend/.env fayli topilmadi.')
      throw error
    }),
    readFile(sourcePath, 'utf8'),
  ])
  const source = JSON.parse(sourceContents)
  const env = readEnv(envContents)
  const url = process.env.VITE_SUPABASE_URL || env.get('VITE_SUPABASE_URL')
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || env.get('VITE_SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    throw new Error('Frontend/.env ichida VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY bo‘lishi kerak.')
  }

  const entries = []
  async function collectImageFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await collectImageFiles(entryPath)
      } else if (entry.isFile() && imagePattern.test(entry.name)) {
        entries.push(entryPath)
      }
    }
  }
  await collectImageFiles(imagesDir)
  const imageLookup = new Map()
  const imageBasenameLookup = new Map()
  for (const localPath of entries) {
    const relativePath = path.relative(imagesDir, localPath).replace(/\\/g, '/')
    const key = relativePath.toLowerCase()
    if (imageLookup.has(key)) throw new Error(`Rasm yo‘li katta-kichik harfda takrorlangan: ${relativePath}`)
    imageLookup.set(key, localPath)
    const basenameKey = path.basename(localPath).toLowerCase()
    if (!imageBasenameLookup.has(basenameKey)) imageBasenameLookup.set(basenameKey, localPath)
    else imageBasenameLookup.set(basenameKey, null)
  }

  const unavailable = []
  const uploadTargets = new Map()
  for (const question of source.questions) {
    for (const image of question.images) {
      if (image.status !== 'available' || !image.path) continue
      const targetName = String(image.path).replace(/\\/g, '/')
      const localName = targetName.replace(/^images\//, '')
      const targetParts = targetName.split('/')
      if (!targetName.startsWith('images/') || targetParts.some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Rasm yo‘li noto‘g‘ri: ${image.path}`)
      }
      const sourceName = path.posix.basename(String(image.source_path || image.path).replace(/\\/g, '/'))
      const localPath = imageLookup.get(localName.toLowerCase())
        || imageBasenameLookup.get(sourceName.toLowerCase())
      if (!localPath) {
        unavailable.push(targetName)
        continue
      }
      const storagePath = `${storageFolder}/${targetName}`
      const existing = uploadTargets.get(storagePath)
      if (existing && existing.localPath !== localPath) {
        throw new Error(`Bir xil Storage yo‘liga turli rasmlar mos keldi: ${storagePath}`)
      }
      uploadTargets.set(storagePath, { name: targetName, localPath, storagePath })
    }
  }
  if (unavailable.length > 0) {
    throw new Error(`JSON'da ko‘rsatilgan ${unavailable.length} ta rasm Base/images ichida yo‘q: ${unavailable.slice(0, 10).join(', ')}`)
  }

  const files = [...uploadTargets.values()]
  const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file.localPath)).size)))
    .reduce((sum, size) => sum + size, 0)

  console.log('\nBase rasmlarini Supabase Storage’ga yuklash')
  console.log(`  Manba: ${imagesDir}`)
  console.log(`  Fayllar: ${files.length} ta (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`)
  console.log(`  Ma’lumotlar: Base/${path.basename(sourcePath)} orqali yuklanadi.`)
  if ((await prompt('\nDavom etish uchun HA deb yozing: ')).toLocaleUpperCase() !== 'HA') {
    console.log('Yuklash bekor qilindi.')
    return
  }

  const email = await prompt('Admin email: ')
  if (!email) throw new Error('Admin email bo‘sh bo‘lishi mumkin emas.')
  const password = await promptPassword()
  if (!password) throw new Error('Admin paroli bo‘sh bo‘lishi mumkin emas.')

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError) throw new Error(`Supabase login amalga oshmadi: ${authError.message}`)
  if (!authData.user) throw new Error('Supabase login javobida foydalanuvchi topilmadi.')

  const { data: profile, error: profileError } = await client.from('admins')
    .select('id,is_active')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (profileError) throw new Error(`Admin huquqini tekshirib bo‘lmadi: ${profileError.message}`)
  if (!profile?.is_active) throw new Error('Bu Supabase foydalanuvchisi faol admin emas.')

  await verifySeed(client, source, path.basename(sourcePath))

  const existingFiles = await listStorageFiles(client.storage.from(bucket), `${storageFolder}/images`)
  const filesToUpload = files.filter((file) => !existingFiles.has(file.storagePath))
  console.log(`  Storage’da oldindan bor: ${files.length - filesToUpload.length}/${files.length}`)
  console.log(`  Qayta yuklanadigan: ${filesToUpload.length}`)
  if (filesToUpload.length === 0) {
    console.log('Tayyor: barcha rasmlar Storage’da mavjud.')
    return
  }

  let nextFile = 0
  let uploaded = 0
  const failures = []
  async function uploadWorker() {
    while (true) {
      const index = nextFile++
      if (index >= filesToUpload.length) return
      const file = filesToUpload[index]
      try {
        const body = await readFile(file.localPath)
        const { error } = await client.storage.from(bucket).upload(file.storagePath, body, {
          cacheControl: '31536000',
          contentType: contentType(file.name),
          upsert: true,
        })
        if (error) throw error
        uploaded++
        if (uploaded % 25 === 0 || uploaded === filesToUpload.length) {
          console.log(`  Yuklandi: ${uploaded}/${filesToUpload.length}`)
        }
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`)
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, filesToUpload.length) },
    () => uploadWorker(),
  ))
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} ta rasm yuklanmadi. Birinchi xatolar: ${failures.slice(0, 5).join(' | ')}`,
    )
  }

  console.log(`Tayyor: ${uploaded} ta rasm pdd-images/${storageFolder}/ ichiga yuklandi.`)
}

main().catch((error) => {
  console.error(`Base import xatosi: ${error.message}`)
  process.exitCode = 1
})
