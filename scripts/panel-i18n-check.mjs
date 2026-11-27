/**
 * 面板国际化回归测试（无需浏览器）
 *
 * 用桩化的 React 真实执行 client/client.js 的 factory 与组件，
 * 逐个标签页（overview/memory/observe/config/locale）渲染中英文两套文案，
 * 断言英文模式下不残留中文（语言名与示例数据除外）。
 *
 * 运行：node scripts/panel-i18n-check.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client', 'client.js')
const code = readFileSync(clientPath, 'utf8')

let registered = null
const fakeWindow = { __ModuleLoader__: { load(o) { registered = o } } }
const fakeNavigator = { language: 'zh-CN' }
let queue = []
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ? { ...props, children } : { children } }
  },
  useState(initial) { return queue.length > 0 ? queue.shift() : [initial, () => {}] },
  useRef(v) { return { current: v } },
  useCallback(f) { return f },
  useEffect() {},
  useMemo(f) { return f() },
}
const createPortal = (node) => (node && typeof node.type === 'function' ? node.type(node.props) : node)
const requireStub = (id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return { createPortal }
  throw new Error('unexpected require in client bundle: ' + id)
}

new Function('window', 'document', 'navigator', 'require', code)(fakeWindow, { body: {} }, fakeNavigator, requireStub)
if (registered === null) throw new Error('client bundle did not register')
const mod = registered.factory(requireStub)
const slots = []
mod.apply({ slots: { inject: (_n, fn) => fn(), register: (_n, c) => slots.push(c) } })
if (slots.length === 0) throw new Error('client bundle registered no slots')

const snapshot = {
  ok: true, generatedAt: 0, db: '/home/u/.dsh/context-hub/memory.db', openError: null,
  compactor: 'hub', compactorState: null,
  config: {
    locale: 'auto', mode: 'assist', recallMaxItems: 8, recallMaxChars: 1800, recallMaxTokens: 1200,
    recallTimeoutMs: 4000, cooldown: 6, sessionTtlDays: 7, projectTtlDays: 90, globalTtlDays: 0,
    extractPasses: 2, conflictPolicy: 'evidence', embedding: true, rewrite: false, rerank: false,
    watermark: false, fusion: 'weighted', watermarkRetainTurns: 0, watermarkRetainTokens: 20000,
  },
  session: {
    id: 'abcdef123456', surfaceTokens: 1000, totalTokens: 1400, nodes: 3, events: 12,
    pressure: 600, contextWindow: 100000, outputReserve: 400,
    parts: { user: 500, assistant: 300, tool: 0, injected: 100, summary: 0, other: 100 },
    folded: { count: 2, tokens: 900 },
  },
  memory: {
    active: 5, pending: 1, superseded: 2, archived: 3, deleted: 0, messages: 12,
    scopes: { session: 3, project: 2, global: 0 },
    kinds: { decision: 2, fact: 2, preference: 1 },
    recent: [{ id: 1, kind: 'fact', scope: 'session', confidence: 0.9, uses: 3, text: 'sample memory' }],
    pendingItems: [{ id: 2, kind: 'decision', scope: 'project', confidence: 0.5, text: 'pending sample' }],
  },
  activity: [{ kind: 'recall', count: 4 }, { kind: 'compact', count: 2 }, { kind: 'recall-miss', count: 1 }],
  requests: [
    { at: 1, estTokens: 1200, injected: 300, usage: { input: 900, cacheRead: 100, output: 200 },
      lanes: { via: 'vector', ids: [1, 2], tokens: 300, messages: 2 } },
    { at: 2, estTokens: 1500, injected: 200 },
  ],
  ledger: {
    count: 2, saved: 1800, rate: 0.1, last: { start_seq: 1, end_seq: 8 },
    recent: [{ start_seq: 1, end_seq: 8, shadowed_tokens: 900, summary_tokens: 120, saved_tokens: 780, reask: 1 }],
  },
  graph: { entities: 3, links: 4, top: [{ name: 'whale', count: 2 }, { name: 'deploy', count: 1 }] },
}

function stringsFor(tab, locale) {
  queue = [
    ['sid-1', () => {}], [snapshot, () => {}], [null, () => {}], [true, () => {}], [locale, () => {}],
    [true, () => {}], [tab, () => {}],
  ]
  const el = slots[0]({ wide: true })
  const tree = typeof el.type === 'function' ? el.type(el.props) : el
  const out = []
  const walk = (node, depth) => {
    if (node === null || node === undefined || depth > 30) return
    if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return }
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return }
    if (typeof node === 'object' && node.props) {
      for (const key of ['title', 'aria-label', 'placeholder']) {
        if (typeof node.props[key] === 'string') out.push(node.props[key])
      }
      if (Array.isArray(node.props.tabs)) {
        for (const tab of node.props.tabs) if (tab && tab.label) out.push(String(tab.label))
      }
      if (typeof node.type === 'function') walk(node.type(node.props), depth + 1)
      else walk(node.props.children, depth + 1)
    }
  }
  walk(tree, 0)
  return out
}

// 语言名按自身语言显示，示例数据是用户内容，二者不算未翻译
const ALLOW = ['简体中文', '日本語', '한국어', 'sample memory', 'pending sample', 'whale', 'deploy', '会话只读', '治理可写']
const cjk = /[\u4e00-\u9fff]/
// 仅中文使用、日文不用的简体字形，用来识别「日文界面残留中文」
const zhOnly = ['记忆', '压缩', '设置', '语言', '配置', '观测', '概览', '待审核', '摘要', '抽取', '召回', '检索', '存储', '标签']
const tabs = ['overview', 'memory', 'observe', 'config', 'locale']
const locales = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es']
let failed = 0

for (const locale of locales) {
  for (const tab of tabs) {
    const out = stringsFor(tab, locale)
    let cleaned = out.join(' | ')
    for (const a of ALLOW) cleaned = cleaned.split(a).join('')
    let residual = cleaned.match(new RegExp(cjk.source, 'g'))
    // 日文允许汉字，但不能出现简体中文专用字形
    if (locale === 'ja') residual = zhOnly.filter(word => cleaned.includes(word))
    const ok = locale === 'zh' ? out.length > 0 : (Array.isArray(residual) ? residual.length === 0 : !residual)
    if (!ok) failed += 1
    let detail = ''
    if (!ok) {
      const bad = locale === 'ja'
        ? residual
        : [...new Set(cleaned.split(' | ').filter(x => cjk.test(x)))].slice(0, 6)
      detail = `  残留: ${bad.join(' ¶ ')}`
    }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${locale}/${tab}  strings=${out.length}${detail}`)
  }
}

const en = (tab) => stringsFor(tab, 'en').join(' | ')
const must = [
  [en('overview').includes('Context Composition'), 'overview 区块标题英文'],
  [en('overview').includes('Compaction Ledger'), 'overview 压缩账本英文'],
  [en('memory').includes('active memories'), 'memory 记忆图例英文'],
  [en('memory').includes('Pending Review'), 'memory 待审核英文'],
  [en('memory').includes('Forget'), 'memory 遗忘按钮英文'],
  [en('observe').includes('Purpose'), 'observe 表头英文'],
  [en('config').includes('Recall budget'), 'config 召回预算英文'],
  [en('config').includes('Vector recall'), 'config 向量召回英文'],
  [en('locale').includes('Language'), 'locale 标签英文'],
]
for (const [pass, label] of must) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`)
  if (!pass) failed += 1
}

console.log(failed === 0 ? 'PANEL I18N OK' : `PANEL I18N FAILED: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
