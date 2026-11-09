// Rasmlarni Supabase Storage (pdd-images/base-import/images/N-bolim/) ga ALMASHTIRIB yuklaydi.
// import-base.mjs allaqachon bor fayllarni o'tkazib yuboradi; bu skript esa hajmi farq qilganlarini almashtiradi.
//
// Ishlatish (Frontend papkasida):
//   1) 1-bolim_rasmlar.zip ... 4-bolim_rasmlar.zip ni bitta papkaga yoying: ROOT/1-bolim, ROOT/2-bolim, ...
//   2) node scripts/replace-images.mjs "C:\\yo'l\\ROOT"            (faqat hisobot: nima o'zgarishini ko'rsatadi)
//   3) node scripts/replace-images.mjs "C:\\yo'l\\ROOT" --apply    (haqiqatan yuklaydi)
// Taqqoslash fayl HAJMI bo'yicha (bir xil hajmli, lekin boshqa rasm bo'lsa — almashmaydi). Admin email/parol so'raladi (service_role kalit kerak emas). Bu skript hali haqiqiy Supabase bilan sinalmagan:
// avval 2-qadamdagi hisobotni tekshiring.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'pdd-images'
const PREFIX = 'base-import/images'
const root = process.argv[2]
const apply = process.argv.includes('--apply')
if (!root || !fs.existsSync(root)) {
  console.error('Foydalanish: node scripts/replace-images.mjs <papka> [--apply]')
  process.exit(1)
}

const here = path.dirname(fileURLToPath(import.meta.url))
function env(name) {
  if (process.env[name]) return process.env[name]
  const file = path.join(here, '..', '.env')
  if (!fs.existsSync(file)) return ''
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}
const url = env('VITE_SUPABASE_URL')
const key = env('VITE_SUPABASE_ANON_KEY')
if (!url || !key) throw new Error('.env da VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY kerak.')

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

const local = []
for (const section of fs.readdirSync(root).filter((n) => /^\d+-bolim$/.test(n)).sort()) {
  for (const name of fs.readdirSync(path.join(root, section))) {
    const ext = path.extname(name).toLowerCase()
    if (!types[ext]) continue
    const file = path.join(root, section, name)
    local.push({ storagePath: `${PREFIX}/${section}/${name}`, file, ext, size: fs.statSync(file).size })
  }
}
console.log(`Mahalliy rasmlar: ${local.length}`)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const email = await rl.question('Admin email: ')
const password = await rl.question('Admin paroli: ')
rl.close()

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: authError } = await client.auth.signInWithPassword({ email, password })
if (authError) throw new Error('Login xatosi: ' + authError.message)

// Mavjud fayllar: papka bo'yicha ro'yxat (hajm bilan)
const remote = new Map()
for (const section of new Set(local.map((l) => l.storagePath.split('/')[2]))) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(BUCKET).list(`${PREFIX}/${section}`, { limit: 1000, offset })
    if (error) throw new Error('Ro‘yxat xatosi: ' + error.message)
    for (const item of data) remote.set(`${PREFIX}/${section}/${item.name}`, item.metadata?.size ?? null)
    if (data.length < 1000) break
  }
}

const plan = { missing: [], changed: [], same: [] }
for (const item of local) {
  const remoteSize = remote.get(item.storagePath)
  if (remoteSize == null) plan.missing.push(item)
  else if (remoteSize !== item.size) plan.changed.push(item)
  else plan.same.push(item)
}
const mb = (items) => (items.reduce((s, i) => s + i.size, 0) / 1048576).toFixed(1)
console.log(`Yangi (Storage'da yo'q): ${plan.missing.length} (${mb(plan.missing)} MB)`)
console.log(`Hajmi farq qiladi (almashtiriladi): ${plan.changed.length} (${mb(plan.changed)} MB)`)
console.log(`O'zgarmagan (hajmi bir xil): ${plan.same.length}`)
if (!apply) {
  console.log('\nBu faqat hisobot. Yuklash uchun --apply qo‘shing.')
  process.exit(0)
}

const queue = [...plan.missing, ...plan.changed]
let done = 0
let failed = 0
async function worker() {
  while (queue.length) {
    const item = queue.shift()
    const { error } = await client.storage.from(BUCKET).upload(item.storagePath, fs.readFileSync(item.file), {
      upsert: true,
      contentType: types[item.ext],
      cacheControl: '3600',
    })
    if (error) {
      failed++
      console.error(`XATO ${item.storagePath}: ${error.message}`)
    } else if (++done % 25 === 0) console.log(`  Yuklandi: ${done}`)
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
console.log(`\nTayyor. Yuklandi: ${done}, xato: ${failed}.`)
process.exit(failed ? 1 : 0)
