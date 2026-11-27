#!/usr/bin/env node
/**
 * 生成 DSH 插件市场索引（format 1）：docs/market/index.json
 *
 * 索引是市场 Discover 页读取的唯一 JSON：用户在「插件市场 → 添加索引」里填这个文件的 URL
 * （例如 GitHub raw 地址）即可看到并一键安装本插件。
 *
 * 数据来源：
 *  - package.json（名称、版本、仓库、关键词）
 *  - locale/en.json、locale/zh.json（meta.title / meta.description）
 *  - icon.svg（内联为 data: URI，需 ≤ 32KB）
 *  - npm registry（各版本发布时间；离线时退化为当前时间）
 *
 * 用法：node scripts/build-market-index.mjs [--offline]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const offline = process.argv.includes('--offline')
const baseUrl = 'https://github.com/ElementBen555/context-hub'

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const en = JSON.parse(readFileSync(join(root, 'locale/en.json'), 'utf8'))
const zh = JSON.parse(readFileSync(join(root, 'locale/zh.json'), 'utf8'))
const icon = readFileSync(join(root, 'icon.svg'))
if (icon.byteLength > 32 * 1024) throw new Error(`icon.svg 超过 32KB：${icon.byteLength}`)
const iconData = `data:image/svg+xml;base64,${icon.toString('base64')}`

const VERSIONS = ['1.9.0', '1.8.1', '1.8.0']

async function publishTimes() {
  if (offline) return {}
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg.name}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return {}
    const body = await response.json()
    return body.time ?? {}
  } catch {
    return {}
  }
}

const fallback = Math.floor(Date.now() / 1000)
const times = await publishTimes()

const index = {
  format: 1,
  title: { en: 'Context Hub', zh: '上下文中枢' },
  description: {
    en: 'Compression, long-term memory and context observability for DSH in one bundle: local SQLite, budgeted recall, reversible folding, 7-language panel.',
    zh: '把压缩、长期记忆与上下文观测装进一个 DSH bundle：本地 SQLite、预算化召回、可逆折叠、7 语言面板。',
  },
  metadata: {
    categories: {
      memory: { title: { en: 'Memory', zh: '记忆' } },
      context: { title: { en: 'Context', zh: '上下文' } },
    },
    labels: {
      compaction: { title: { en: 'Compaction', zh: '压缩' } },
      observability: { title: { en: 'Observability', zh: '可观测' } },
      'local-first': { title: { en: 'Local-first', zh: '本地优先' } },
    },
    sortKeys: {},
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'Context Hub', zh: '上下文中枢' },
      description: {
        en: en.meta?.description ?? index.description.en,
        zh: zh.meta?.description ?? index.description.zh,
      },
      icon: iconData,
      author: 'ElementBen555',
      homepage: `${baseUrl}#readme`,
      repository: { url: baseUrl },
      metadata: {
        category: 'memory',
        keywords: [...new Set([
          ...(pkg.keywords ?? []),
          'dsh-plugin', 'dsh-bundle', 'context', 'memory', 'compaction', 'sqlite', 'fts5', 'i18n',
        ])],
        labels: ['compaction', 'observability', 'local-first'],
        sortKeys: {},
      },
      versions: VERSIONS.map(version => ({
        version,
        publishTimestamp: Math.floor(Date.parse(times[version] ?? '') / 1000) || fallback,
        source: { type: 'npm' },
        engines: {},
      })),
    },
  ],
}

const out = join(root, 'docs/market/index.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`)
console.log(`wrote ${out}`)
console.log(`plugin ${pkg.name} @ ${VERSIONS.join(', ')} · icon ${icon.byteLength}B · versions ${VERSIONS.length}`)
