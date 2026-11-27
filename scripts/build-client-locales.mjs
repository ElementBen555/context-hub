/**
 * 把 scripts/locale-data/<lang>.json 内联进 client/client.js 的 EXTRA_MORE 块。
 *
 * 客户端 bundle 只能 require react，无法在运行时读文件，所以词表在构建期内联；
 * 数据文件仍是唯一来源，便于逐语言校对与测试。
 *
 * 运行：node scripts/build-client-locales.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const clientPath = join(root, 'client', 'client.js')
const dataDir = join(here, 'locale-data')
const LANGS = ['ja', 'ko', 'de', 'fr', 'es']
const checkOnly = process.argv.includes('--check')

const keys = JSON.parse(readFileSync(join(dataDir, '_keys.json'), 'utf8'))
const problems = []
const tables = {}

for (const lang of LANGS) {
  const file = join(dataDir, `${lang}.json`)
  if (!existsSync(file)) { problems.push(`${lang}: 缺少 ${file}`); continue }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push(`${lang}: JSON 解析失败 ${error.message}`)
    continue
  }
  const missing = keys.filter(key => typeof data[key] !== 'string')
  const extra = Object.keys(data).filter(key => !keys.includes(key))
  if (missing.length > 0) problems.push(`${lang}: 缺 ${missing.length} 个键（${missing.slice(0, 8).join(', ')}…）`)
  if (extra.length > 0) problems.push(`${lang}: 多余键 ${extra.slice(0, 8).join(', ')}`)
  tables[lang] = data
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

const generated = JSON.stringify(tables, null, 2)
  .split('\n')
  .map(line => `    ${line}`)
  .join('\n')

const source = readFileSync(clientPath, 'utf8')
const startMarker = '    /* i18n:extra-more:start */'
const endMarker = '    /* i18n:extra-more:end */'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)
if (start === -1 || end === -1) {
  console.error('client/client.js 缺少 i18n:extra-more 标记')
  process.exit(1)
}

const block = `${startMarker}\n    const EXTRA_MORE = ${generated.trimStart()}\n${endMarker}`
const next = source.slice(0, start) + block + source.slice(end + endMarker.length)

if (checkOnly) {
  if (next !== source) {
    console.error('client/client.js 与 locale-data 不同步，请运行 node scripts/build-client-locales.mjs')
    process.exit(1)
  }
  console.log(`LOCALES IN SYNC (${LANGS.length} languages × ${keys.length} keys)`)
  process.exit(0)
}

if (next === source) {
  console.log('already up to date')
} else {
  writeFileSync(clientPath, next)
  console.log(`inlined ${LANGS.length} languages × ${keys.length} keys into client/client.js`)
}
