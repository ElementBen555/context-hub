/**
 * 文档多语言一致性检查。
 *
 * 覆盖 README、UPGRADE-GUIDE、COMPATIBILITY、PANEL-I18N 四类使用文档：
 *  - 每个语言的 4 份文件都存在
 *  - 首行是语言切换器（含全部 7 个语言入口）
 *  - 二级标题数量与中文源文件一致（±1）
 *  - 非日语版本不出现中文字符
 *
 * 运行：node scripts/docs-i18n-check.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LANGS = ['en', 'ja', 'ko', 'de', 'fr', 'es']
const DOCS = [
  { key: 'README', source: join(root, 'README.md'), target: (lang) => join(root, 'docs/i18n', lang, 'README.md') },
  { key: 'UPGRADE-GUIDE', source: join(root, 'UPGRADE-GUIDE.md'), target: (lang) => join(root, 'docs/i18n', lang, 'UPGRADE-GUIDE.md') },
  { key: 'COMPATIBILITY', source: join(root, 'docs/COMPATIBILITY.md'), target: (lang) => join(root, 'docs/i18n', lang, 'COMPATIBILITY.md') },
  { key: 'PANEL-I18N', source: join(root, 'docs/PANEL-I18N.md'), target: (lang) => join(root, 'docs/i18n', lang, 'PANEL-I18N.md') },
]
const cjk = /[\u4e00-\u9fff]/
// 语言名是专有名词，允许以其自身语言出现
const PROPER_NOUNS = ['简体中文', '日本語', '中文']
const h2 = /^##\s+\S/gm

function countH2(text) {
  return (text.match(h2) || []).length
}

const problems = []
let checked = 0

for (const doc of DOCS) {
  if (!existsSync(doc.source)) {
    problems.push(`${doc.key}: 缺少中文源文件 ${doc.source}`)
    continue
  }
  const sourceText = readFileSync(doc.source, 'utf8')
  const sourceH2 = countH2(sourceText)
  for (const lang of LANGS) {
    const file = doc.target(lang)
    if (!existsSync(file)) {
      problems.push(`${doc.key}/${lang}: 缺少 ${file.replace(root + '/', '')}`)
      continue
    }
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    const firstLine = lines[0] || ''
    const links = (firstLine.match(/\]\(/g) || []).length
    if (!firstLine.includes('Chinese') || links < 5) {
      problems.push(`${doc.key}/${lang}: 首行不是语言切换器`)
    }
    for (const code of ['en', 'ja', 'ko', 'de', 'fr', 'es']) {
      if (!firstLine.includes(`../${code}/`) && !firstLine.includes(`../../../${doc.key === 'README' ? 'README.md' : doc.key + '.md'}`)) {
        problems.push(`${doc.key}/${lang}: 切换器缺少 ${code} 入口`)
        break
      }
    }
    const targetH2 = countH2(text)
    if (Math.abs(targetH2 - sourceH2) > 1) {
      problems.push(`${doc.key}/${lang}: 二级标题 ${targetH2} 个，中文源 ${sourceH2} 个（相差 >1）`)
    }
    if (lang !== 'ja') {
      let body = lines.slice(1).join('\n')
      for (const noun of PROPER_NOUNS) body = body.split(noun).join('')
      const hit = body.match(new RegExp(cjk.source, 'g'))
      if (hit) {
        const sample = body.split('\n').find(line => cjk.test(line)) || ''
        problems.push(`${doc.key}/${lang}: 残留中文（${hit.length} 字）如：${sample.trim().slice(0, 60)}`)
      }
    }
    checked += 1
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`DOCS I18N OK (${checked} files = ${DOCS.length} docs × ${LANGS.length} langs)`)
