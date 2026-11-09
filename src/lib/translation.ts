export interface UzbekTranslations {
  'uz-Cyrl': string
  ru: string
}

const uzbekLatinToCyrillic: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и',
  j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ',
  r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з',
  sh: 'ш', ch: 'ч', ng: 'нг', yo: 'ё', yu: 'ю', ya: 'я', ye: 'е',
  "o'": 'ў', "g'": 'ғ',
}

function preserveCase(source: string, result: string) {
  return source[0] === source[0]?.toLocaleUpperCase() ? result.toLocaleUpperCase() : result
}

export function transliterateUzbekToCyrillic(text: string): string {
  const normalized = text.replace(/[ʻʼ‘’`]/g, "'")
  let result = ''

  for (let index = 0; index < normalized.length;) {
    const remaining = normalized.slice(index)
    const lower = remaining.toLocaleLowerCase()
    const hasVowelApostrophe = /^[og]'/i.test(remaining)
    const beginsYWithOapostrophe = /^yo'/i.test(remaining)
    const digraph = hasVowelApostrophe
      ? remaining.slice(0, 2)
      : beginsYWithOapostrophe
        ? ''
        : ['sh', 'ch', 'ng', 'yo', 'yu', 'ya', 'ye'].find((pair) => lower.startsWith(pair)) || ''

    if (digraph) {
      const sourceDigraph = remaining.slice(0, digraph.length)
      result += preserveCase(sourceDigraph, uzbekLatinToCyrillic[digraph.toLocaleLowerCase()])
      index += digraph.length
      continue
    }

    const character = normalized[index]
    if (character === "'") {
      result += 'ъ'
      index++
      continue
    }
    let translated = uzbekLatinToCyrillic[character.toLocaleLowerCase()] || character
    if (character.toLocaleLowerCase() === 'e' && (index === 0 || /[\s([{«"—-]/.test(normalized[index - 1]))) {
      translated = 'э'
    }
    result += preserveCase(character, translated)
    index++
  }

  return result
}

function splitForTranslation(text: string, limit = 450): { text: string; separator: string }[] {
  const chunks: { text: string; separator: string }[] = []
  let remaining = text

  while (remaining.length > limit) {
    let end = remaining.lastIndexOf(' ', limit)
    if (end < Math.floor(limit * 0.6)) end = limit
    const piece = remaining.slice(0, end)
    const separatorMatch = remaining.slice(end).match(/^\s+/)
    const separator = separatorMatch?.[0] || ''
    chunks.push({ text: piece, separator })
    remaining = remaining.slice(end + separator.length)
  }

  if (remaining) chunks.push({ text: remaining, separator: '' })
  return chunks
}

function normalizeRussianSource(text: string): string {
  return text
    .replace(/\\(['"’‘ʻʼ`])/g, '$1')
    .replace(/[ʻʼ‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(text: string): string {
  const decoder = document.createElement('textarea')
  decoder.innerHTML = text
  return decoder.value
}

async function translateChunkToRussian(text: string): Promise<string> {
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text)
  url.searchParams.set('langpair', 'uz|ru')
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Ruscha tarjima servisi javob bermadi (${response.status}).`)

  const result = await response.json() as {
    responseStatus?: number
    responseDetails?: string
    responseData?: { translatedText?: string }
  }
  const translated = result.responseData?.translatedText
  if (result.responseStatus !== 200 || !translated) {
    throw new Error(result.responseDetails || 'Ruscha tarjimani olib bo‘lmadi.')
  }
  return decodeHtmlEntities(translated)
}

export async function translateUzbekLatin(text: string): Promise<UzbekTranslations> {
  const source = text.trim()
  if (!source) throw new Error('Avval o‘zbekcha (lotin) matnini kiriting.')

  const russianSource = normalizeRussianSource(source)
  const chunks = splitForTranslation(russianSource)
  const russian: string[] = []
  for (const chunk of chunks) {
    russian.push(await translateChunkToRussian(chunk.text))
    if (chunk.separator) russian.push(chunk.separator)
  }

  return {
    'uz-Cyrl': transliterateUzbekToCyrillic(source),
    ru: russian.join('').replace(/\s+/g, ' ').trim(),
  }
}
