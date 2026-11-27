#!/usr/bin/env node
/**
 * 校验 docs/market/index.json 是否为合法的 DSH 市场索引（format 1），
 * 并确认索引里列的每个版本都真实存在于 npm、可被 install_bundle 安装。
 *
 * 优先用 DSH 自带校验器（@deepseek-ai/dsh-plugin-market-index）；
 * 找不到时退化为本地结构检查（保证 CI 或干净环境也能跑）。
 *
 * 用法：node scripts/verify-market.mjs [--offline]
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const offline = process.argv.includes('--offline')
const indexPath = join(root, 'docs/market/index.json')
const problems = []
const notes = []

if (!existsSync(indexPath)) {
  console.error('缺少 docs/market/index.json，先运行 node scripts/build-market-index.mjs')
  process.exit(1)
}

const raw = readFileSync(indexPath, 'utf8')
let index
try {
  index = JSON.parse(raw)
} catch (error) {
  console.error(`index.json 不是合法 JSON：${error.message}`)
  process.exit(1)
}

/* ---- 1) 权威校验：DSH 自带解析器 ---- */
const checkout = process.env.DSH_CHECKOUT
  ?? ['/home/element/Applications/deepseek-harness'].find(path => existsSync(join(path, 'packages/util/plugin-market-index/lib/index.js')))
let validatedByDsh = false
if (checkout !== undefined) {
  try {
    const mod = await import(pathToFileURL(join(checkout, 'packages/util/plugin-market-index/lib/index.js')).href)
    mod.parseMarketIndex(index, `file://${indexPath}`)
    validatedByDsh = true
    notes.push(`DSH validator: ${checkout}`)
  } catch (error) {
    problems.push(`DSH parseMarketIndex 拒绝：${error.message}`)
  }
} else {
  notes.push('未找到 DSH checkout，跳过权威校验（使用本地结构检查）')
}

/* ---- 2) 本地结构检查（始终执行，便于独立复现） ---- */
if (index.format !== 1) problems.push('format 必须是 1')
if (typeof index.title !== 'object' || index.title.en === undefined) problems.push('title 必须含 en')
if (!Array.isArray(index.plugins) || index.plugins.length === 0) problems.push('plugins 不能为空')

for (const plugin of index.plugins ?? []) {
  const at = `plugins[${plugin.name ?? '?'}]`
  if (typeof plugin.name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(plugin.name)) {
    problems.push(`${at}: name 不是合法 npm 包名`)
  }
  if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) problems.push(`${at}: versions 不能为空`)

  const seen = new Set()
  let previous = ''
  for (const version of plugin.versions ?? []) {
    if (seen.has(version.version)) problems.push(`${at}: 版本重复 ${version.version}`)
    seen.add(version.version)
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version.version ?? '')) {
      problems.push(`${at}: 版本号不是 SemVer：${version.version}`)
    }
    if (previous !== '' && compareSemver(previous, version.version) < 0) {
      problems.push(`${at}: versions 必须按 SemVer 降序（${previous} → ${version.version}）`)
    }
    previous = version.version
    if (!(version.publishTimestamp > 0)) problems.push(`${at}@${version.version}: publishTimestamp 缺失`)
    if (version.source?.type === 'npm') {
      // npm 源：无需 registry 字段
    } else if (version.source?.type === 'git') {
      if (!/^[0-9a-f]{40}$/.test(version.source.commit ?? '')) problems.push(`${at}@${version.version}: git commit 必须是 40 位小写 sha`)
      if (!String(version.source.url ?? '').startsWith('https://')) problems.push(`${at}@${version.version}: git url 必须是 https`)
    } else {
      problems.push(`${at}@${version.version}: source.type 必须是 npm 或 git`)
    }
  }

  const icon = plugin.icon
  if (typeof icon === 'string' && icon.startsWith('data:')) {
    const match = /^data:image\/(?:svg\+xml|png|jpeg|webp);base64,(.*)$/s.exec(icon)
    if (match === null) problems.push(`${at}: data: 图标类型不受支持`)
    else if (Buffer.from(match[1], 'base64').byteLength > 32 * 1024) problems.push(`${at}: 内联图标超过 32KB`)
  }

  const category = plugin.metadata?.category
  if (category !== undefined && !(category in (index.metadata?.categories ?? {}))) {
    problems.push(`${at}: category ${category} 未在 metadata.categories 声明`)
  }
  for (const label of plugin.metadata?.labels ?? []) {
    if (!(label in (index.metadata?.labels ?? {}))) problems.push(`${at}: label ${label} 未在 metadata.labels 声明`)
  }
}

/* ---- 3) npm 上每个版本真实存在（可用 install_bundle 安装） ---- */
if (!offline) {
  for (const plugin of index.plugins ?? []) {
    let registry = {}
    try {
      const response = await fetch(`https://registry.npmjs.org/${plugin.name}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      registry = await response.json()
    } catch (error) {
      problems.push(`${plugin.name}: 读取 npm registry 失败（${error.message}）；可用 --offline 跳过`)
      continue
    }
    for (const version of plugin.versions ?? []) {
      if (registry.versions?.[version.version] === undefined) {
        problems.push(`${plugin.name}@${version.version}: npm 上不存在（市场安装会 404）`)
      }
    }
    const latest = registry['dist-tags']?.latest
    if (latest !== undefined && !(plugin.versions ?? []).some(v => v.version === latest)) {
      notes.push(`npm latest 是 ${latest}，索引未列；需要时运行 build-market-index 更新`)
    }
  }
}

/* ---- 输出 ---- */
for (const note of notes) console.log(`note: ${note}`)
if (problems.length > 0) {
  console.error(problems.map(p => `FAIL ${p}`).join('\n'))
  process.exit(1)
}
const versions = (index.plugins ?? []).flatMap(p => (p.versions ?? []).map(v => `${p.name}@${v.version}`))
console.log(`MARKET INDEX OK (${validatedByDsh ? 'DSH validator + ' : ''}structural${offline ? ', offline' : ', npm checked'})`)
console.log(`  versions: ${versions.join(', ')}`)

function compareSemver(a, b) {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  const preA = a.includes('-') ? 1 : 0
  const preB = b.includes('-') ? 1 : 0
  return preB - preA
}
