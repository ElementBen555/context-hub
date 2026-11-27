/**
 * dsh-context-hub — 上下文中枢：压缩、记忆、洞察三合一的单一 DSH 插件。
 *
 * 三个能力共用一个进程内存储（SQLite）与同一条注入通道：
 *  - 记忆：turn/end 时用当前会话的模型抽取长期记忆；用户发消息时按关键词召回，
 *    通过 agent.inject() 作为一条可忽略的上下文注入下一个 step。
 *  - 压缩：/context-hub compact 复用 DSH 原生 compaction 服务；history 工具能检索
 *    已被折叠的历史事件，等于给压缩补一个“可检索的折叠区”。
 *  - 洞察：status 汇总上下文压力、折叠区间数量、记忆库构成。
 *
 * 设计原则：会话日志是唯一真相，记忆库只是派生缓存；任何一步失败都不得阻塞会话。
 * 规格：docs/spec.md（v1.0）。
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const name = 'dsh-context-hub'
export const inject = ['tools', 'commands']

const KIND_VALUES = ['decision', 'fact', 'preference', 'task', 'skill', 'summary']
const SCOPE_VALUES = ['session', 'project', 'global']
const STATUS_VALUES = ['active', 'superseded', 'archived', 'deleted', 'pending']

/** 抽取时送入模型的对话文本上限。 */
const EXTRACT_MAX_INPUT = 8000

/** 每个 scope 参与打分的最近条目数；超出部分靠 FTS 命中补齐（W6）。 */
const CANDIDATE_WINDOW = 400

/** 默认配置；可被插件 config（cordis.patch.yml）或环境变量覆盖。 */
export const defaults = {
  /** 单次召回注入的最多字符数。 */
  recallMaxChars: 1800,
  /** 单次召回注入的最多条数。 */
  recallMaxItems: 8,
  /** 同一记忆注入后的冷却轮数。 */
  recallCooldownTurns: 6,
  /** 单次召回注入的硬性 token 上限（中文按 ~1.6 字符/token 粗估）。 */
  recallMaxTokens: 1200,
  /** 召回总时限（毫秒）；超时本次不注入，只记 recall-timeout。0 关闭。 */
  recallTimeoutMs: 4000,
  /** 项目身份：git（origin URL 归一化，跨机器一致）| cwd（绝对路径）。 */
  projectIdentity: 'git',
  /** session 记忆 TTL（天），仅允许 3/7/15/30。 */
  sessionTtlDays: 7,
  /** project 记忆 TTL（天），0 表示不过期。 */
  projectTtlDays: 90,
  /** global 记忆 TTL（天），0 表示永久。 */
  globalTtlDays: 0,
  /** 每个 scope 的容量上限，超出按运行时得分淘汰到 archived。 */
  capacityPerScope: 5000,
  /** 每轮最多增量抽取次数，1..10。 */
  extractPassesPerTurn: 2,
  compactOnce: false,
  /** 单次抽取调用的超时（毫秒）；超时中止本次抽取并释放 latch，避免永久卡住。 */
  extractTimeoutMs: 60000,
  /** 写入门槛（0–1）；显式 remember 不受此限。 */
  admissionThreshold: 0.6,
  /** 冲突策略：evidence（新证据胜+决策并列）| recency（严格时间优先）。 */
  conflictPolicy: 'evidence',
  /** 压缩器：native（原生 7 段提示词）| hub（记忆感知 8 段，失败自动回退 native）。 */
  compactor: 'native',
  reviewPending: false,
  /** 向量召回（可选）：OpenAI 兼容 /embeddings 端点；关闭时只用关键词 + FTS5。 */
  embedding: { enabled: false, baseUrl: '', model: '', apiKeyEnv: 'DSH_CONTEXT_HUB_EMBED_KEY', minScore: 0.35, timeoutMs: 1500, autoStart: true, fusion: 'weighted', dtype: 'fp32' },
  /** 查询改写（可选）：一次 LLM 调用把查询扩成同义词/英文关键词；失败回退原查询。 */
  rewrite: { enabled: false, provider: '', model: '', maxTokens: 1200, timeoutMs: 12000, cacheSize: 128 },
  rerank: { enabled: false, provider: '', model: '', candidates: 6, maxTokens: 600, timeoutMs: 8000, reasoningEffort: '' },
  /** 压缩水位（可选，实验）：插件在 pre-step 主动选区间压缩；默认关闭，失败回退原生。 */
  watermark: { enabled: false, triggerRatio: 0.7, retainTokens: 20000, retainTurns: 0, cooldownTurns: 1, minRegionNodes: 4 },
  /** 消息级展开：用原文临时替代压缩摘要的步数与字符预算。 */
  unfold: { steps: 3, maxChars: 8000 },
  /** 接管分级：auto 保持旧行为；observe/assist/takeover/full 显式组合 compactor 与水位。 */
  mode: 'auto',
  /** A4: 分层复核策略：off / low-confidence / layered。 */
  reviewPolicy: 'low-confidence',
}


/** 面板/命令可改的运行时配置白名单（改后写 kv，重启沿用）。 */
const CONFIG_EDITABLE = {
  recallMaxItems: { kind: 'int', min: 1, max: 20 },
  recallMaxChars: { kind: 'int', min: 200, max: 8000 },
  recallCooldownTurns: { kind: 'int', min: 0, max: 20 },
  recallMaxTokens: { kind: 'int', min: 100, max: 4000 },
  recallTimeoutMs: { kind: 'int', min: 0, max: 20000 },
  sessionTtlDays: { kind: 'enum', values: [3, 7, 15, 30] },
  projectTtlDays: { kind: 'int', min: 0, max: 3650 },
  globalTtlDays: { kind: 'int', min: 0, max: 3650 },
  extractPassesPerTurn: { kind: 'int', min: 1, max: 10 },
  conflictPolicy: { kind: 'enum', values: ['evidence', 'recency'] },
  'embedding.enabled': { kind: 'bool' },
  'rewrite.enabled': { kind: 'bool' },
  'rerank.enabled': { kind: 'bool' },
}

function configPathGet(target, key) {
  let node = target
  for (const part of key.split('.')) node = node?.[part]
  return node
}

function configPathSet(target, key, value) {
  const parts = key.split('.')
  let node = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (node[parts[i]] === undefined || node[parts[i]] === null) node[parts[i]] = {}
    node = node[parts[i]]
  }
  node[parts[parts.length - 1]] = value
}

function normalizeConfigValue(spec, raw) {
  if (spec.kind === 'bool') {
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true
    if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
    return undefined
  }
  if (spec.kind === 'int') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return undefined
    return Math.min(spec.max, Math.max(spec.min, Math.round(n)))
  }
  if (spec.kind === 'enum') {
    const n = Number(raw)
    const candidate = Number.isFinite(n) ? n : String(raw)
    return spec.values.includes(candidate) ? candidate : undefined
  }
  return undefined
}

function applyStoredConfig(store) {
  if (store.db === undefined) return
  for (const [key, spec] of Object.entries(CONFIG_EDITABLE)) {
    let raw
    try { raw = store.getKv(`config:${key}`) } catch { continue }
    if (raw === undefined || raw === null || raw === '') continue
    const value = normalizeConfigValue(spec, raw)
    if (value !== undefined) configPathSet(store.config, key, value)
  }
}

function setConfigValue(ctx, store, key, raw) {
  const spec = CONFIG_EDITABLE[key]
  if (spec === undefined) return { ok: false, error: `不可修改的配置项：${key}` }
  const wantsOn = raw === true || raw === 'true' || raw === 1 || raw === '1'
  if (key === 'embedding.enabled' && wantsOn && store.config.embedding.baseUrl === '') {
    return { ok: false, error: '未配置 embedding.baseUrl，无法开启向量召回' }
  }
  const value = normalizeConfigValue(spec, raw)
  if (value === undefined) return { ok: false, error: `取值不合法：${key}=${String(raw)}` }
  configPathSet(store.config, key, value)
  try { store.setKv(`config:${key}`, String(value)) } catch { /* 持久化失败不阻塞本次生效 */ }
  store.logEvent('config-change', { detail: `${key}=${String(value)}` })
  if (key === 'embedding.enabled' && value === true) {
    void ensureEmbeddingService(ctx, store).then(() => store.backfillEmbeddings().catch(() => {})).catch(() => {})
  }
  if (key.endsWith('TtlDays')) {
    try { store.archiveExpired(); store.enforceCapacity() } catch { /* 维护失败不阻塞 */ }
  }
  return { ok: true, key, value }
}

const EXTRACT_PROMPT = [
  'You maintain a long-term memory store for an AI coding assistant. Read the conversation slice below and extract durable, reusable knowledge that will help in future sessions.',
  '',
  'Output ONLY a JSON array (no prose, no code fences). Each item:',
  '{"kind": "decision|fact|preference|task|skill", "text": "<one self-contained sentence, keep exact paths/identifiers/values>", "tags": ["<short tag>"]}',
  '',
  'Rules:',
  '- Only durable knowledge: decisions and their rationale, project facts, user preferences, open tasks, reusable procedures.',
  '- Each text must stand alone: no pronouns, no "this file"/"the above"; name the subject explicitly.',
  '- Skip greetings, transient status, and anything only meaningful inside this conversation.',
  '- At most 5 items; return [] when nothing is worth remembering.',
].join('\n')

/** 内存里的会话状态：已注入过的记忆 id、冷却轮、抽取游标。 */
const sessionState = new WeakMap()

function stateOf(session) {
  let state = sessionState.get(session)
  if (state === undefined) {
    state = {
      injected: new Set(),
      cooldown: new Map(),
      turn: 0,
      extractedSeq: 0,
      extractPasses: 0,
      extracting: false,
      unfolds: new Map(),
    }
    sessionState.set(session, state)
  }
  return state
}

function dbFile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return process.env.DSH_CONTEXT_HUB_DB && process.env.DSH_CONTEXT_HUB_DB.length > 0
    ? process.env.DSH_CONTEXT_HUB_DB
    : join(home, 'context-hub', 'memory.db')
}

function intEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : fallback
}

function clampInt(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** 合并默认配置、插件 config 与环境变量，并把范围夹到规格允许值。 */
export function resolveConfig(config) {
  const merged = {
    ...defaults,
    recallMaxChars: intEnv('DSH_CONTEXT_HUB_RECALL_CHARS', defaults.recallMaxChars),
    recallMaxItems: intEnv('DSH_CONTEXT_HUB_RECALL_ITEMS', defaults.recallMaxItems),
    recallMaxTokens: intEnv('DSH_CONTEXT_HUB_RECALL_TOKENS', defaults.recallMaxTokens),
    recallTimeoutMs: intEnv('DSH_CONTEXT_HUB_RECALL_TIMEOUT_MS', defaults.recallTimeoutMs),
    sessionTtlDays: intEnv('DSH_CONTEXT_HUB_SESSION_TTL_DAYS', defaults.sessionTtlDays),
    extractPassesPerTurn: intEnv('DSH_CONTEXT_HUB_EXTRACT_PASSES', defaults.extractPassesPerTurn),
    extractTimeoutMs: intEnv('DSH_CONTEXT_HUB_EXTRACT_TIMEOUT_MS', defaults.extractTimeoutMs),
    conflictPolicy: process.env.DSH_CONTEXT_HUB_CONFLICT_POLICY ?? defaults.conflictPolicy,
    compactor: process.env.DSH_CONTEXT_HUB_COMPACTOR ?? defaults.compactor,
    reviewPending: process.env.DSH_CONTEXT_HUB_REVIEW === '1',
  }
  if (config !== null && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) merged[key] = value
    }
  }
  const rawEmbed = merged.embedding !== null && typeof merged.embedding === 'object' ? merged.embedding : {}
  const embedding = {
    enabled: rawEmbed.enabled === true || Boolean(rawEmbed.baseUrl) || Boolean(process.env.DSH_CONTEXT_HUB_EMBED_URL),
    baseUrl: String(process.env.DSH_CONTEXT_HUB_EMBED_URL ?? rawEmbed.baseUrl ?? '').trim(),
    model: String(process.env.DSH_CONTEXT_HUB_EMBED_MODEL ?? rawEmbed.model ?? '').trim(),
    apiKeyEnv: String(rawEmbed.apiKeyEnv ?? defaults.embedding.apiKeyEnv),
    queryPrefix: String(process.env.DSH_CONTEXT_HUB_QUERY_PREFIX ?? rawEmbed.queryPrefix ?? '').trim(),
    minScore: Math.min(0.95, Math.max(0, Number(process.env.DSH_CONTEXT_HUB_EMBED_MIN_SCORE ?? rawEmbed.minScore ?? defaults.embedding.minScore) || defaults.embedding.minScore)),
    timeoutMs: clampInt(Number(rawEmbed.timeoutMs), 200, 15000, defaults.embedding.timeoutMs),
    autoStart: process.env.DSH_CONTEXT_HUB_EMBED_AUTOSTART === '0'
      ? false
      : process.env.DSH_CONTEXT_HUB_EMBED_AUTOSTART === '1'
        ? true
        : rawEmbed.autoStart !== false,
    fusion: (process.env.DSH_CONTEXT_HUB_FUSION ?? rawEmbed.fusion) === 'rrf' ? 'rrf' : 'weighted',
    dtype: String(process.env.DSH_CONTEXT_HUB_EMBED_DTYPE ?? rawEmbed.dtype ?? defaults.embedding.dtype).trim() || 'fp32',
  }
  if (embedding.enabled && (embedding.baseUrl.length === 0 || embedding.model.length === 0)) {
    embedding.enabled = false
    embedding.reason = 'baseUrl/model 未配置'
  }
  const rawRewrite = merged.rewrite !== null && typeof merged.rewrite === 'object' ? merged.rewrite : {}
  const rewrite = {
    enabled: rawRewrite.enabled === true || process.env.DSH_CONTEXT_HUB_REWRITE === '1',
    provider: String(process.env.DSH_CONTEXT_HUB_REWRITE_PROVIDER ?? rawRewrite.provider ?? '').trim(),
    model: String(process.env.DSH_CONTEXT_HUB_REWRITE_MODEL ?? rawRewrite.model ?? '').trim(),
    maxTokens: clampInt(Number(rawRewrite.maxTokens), 64, 2000, defaults.rewrite.maxTokens),
    timeoutMs: clampInt(Number(rawRewrite.timeoutMs), 500, 20000, defaults.rewrite.timeoutMs),
    cacheSize: clampInt(Number(rawRewrite.cacheSize), 8, 1000, defaults.rewrite.cacheSize),
  }
  const rawRerank = merged.rerank !== null && typeof merged.rerank === 'object' ? merged.rerank : {}
  const rerank = {
    enabled: rawRerank.enabled === true || process.env.DSH_CONTEXT_HUB_RERANK === '1',
    provider: String(process.env.DSH_CONTEXT_HUB_RERANK_PROVIDER ?? rawRerank.provider ?? '').trim(),
    model: String(process.env.DSH_CONTEXT_HUB_RERANK_MODEL ?? rawRerank.model ?? '').trim(),
    candidates: clampInt(Number(rawRerank.candidates), 3, 30, defaults.rerank.candidates),
    reasoningEffort: ['', 'low', 'medium', 'high'].includes(rawRerank.reasoningEffort) ? rawRerank.reasoningEffort : '',
    maxTokens: clampInt(Number(rawRerank.maxTokens), 100, 2000, defaults.rerank.maxTokens),
    timeoutMs: clampInt(Number(rawRerank.timeoutMs), 500, 20000, defaults.rerank.timeoutMs),
  }
  const rawWatermark = merged.watermark !== null && typeof merged.watermark === 'object' ? merged.watermark : {}
  const watermark = {
    enabled: rawWatermark.enabled === true || process.env.DSH_CONTEXT_HUB_WATERMARK === '1',
    triggerRatio: Math.min(0.95, Math.max(0.3, Number(rawWatermark.triggerRatio) || defaults.watermark.triggerRatio)),
    retainTokens: clampInt(Number(rawWatermark.retainTokens), 2000, 200000, defaults.watermark.retainTokens),
    retainTurns: clampInt(Number(process.env.DSH_CONTEXT_HUB_RETAIN_TURNS ?? rawWatermark.retainTurns), 0, 20, defaults.watermark.retainTurns),
    cooldownTurns: clampInt(Number(rawWatermark.cooldownTurns), 0, 20, defaults.watermark.cooldownTurns),
    minRegionNodes: clampInt(Number(rawWatermark.minRegionNodes), 2, 200, defaults.watermark.minRegionNodes),
  }
  const policy = merged.conflictPolicy === 'recency' ? 'recency' : 'evidence'
  const modeValue = process.env.DSH_CONTEXT_HUB_MODE ?? merged.mode
  const mode = ['observe', 'assist', 'takeover', 'full'].includes(modeValue) ? modeValue : 'auto'
  return {
    recallMaxChars: clampInt(Number(merged.recallMaxChars), 200, 8000, defaults.recallMaxChars),
    recallMaxItems: clampInt(Number(merged.recallMaxItems), 1, 20, defaults.recallMaxItems),
    recallMaxTokens: clampInt(Number(merged.recallMaxTokens), 100, 4000, defaults.recallMaxTokens),
    recallTimeoutMs: clampInt(Number(merged.recallTimeoutMs), 0, 20000, defaults.recallTimeoutMs),
    projectIdentity: (process.env.DSH_CONTEXT_HUB_PROJECT_IDENTITY ?? merged.projectIdentity) === 'cwd' ? 'cwd' : 'git',
    unfold: {
      steps: clampInt(Number(merged.unfold?.steps), 1, 20, defaults.unfold.steps),
      maxChars: clampInt(Number(merged.unfold?.maxChars), 1000, 20000, defaults.unfold.maxChars),
    },
    recallCooldownTurns: clampInt(Number(merged.recallCooldownTurns), 0, 20, defaults.recallCooldownTurns),
    sessionTtlDays: [3, 7, 15, 30].includes(Number(merged.sessionTtlDays))
      ? Number(merged.sessionTtlDays)
      : defaults.sessionTtlDays,
    projectTtlDays: clampInt(Number(merged.projectTtlDays), 0, 3650, defaults.projectTtlDays),
    globalTtlDays: clampInt(Number(merged.globalTtlDays), 0, 3650, defaults.globalTtlDays),
    capacityPerScope: clampInt(Number(merged.capacityPerScope), 100, 100000, defaults.capacityPerScope),
    extractPassesPerTurn: clampInt(Number(merged.extractPassesPerTurn), 1, 10, defaults.extractPassesPerTurn),
    compactOnce: merged.compactOnce === true || process.env.DSH_CONTEXT_HUB_COMPACT_ONCE === '1',
    extractTimeoutMs: clampInt(Number(merged.extractTimeoutMs), 5000, 300000, defaults.extractTimeoutMs),
    admissionThreshold: Math.min(1, Math.max(0, Number(merged.admissionThreshold) || defaults.admissionThreshold)),
    conflictPolicy: policy,
    compactor: merged.compactor === 'hub' ? 'hub' : 'native',
    reviewPending: merged.reviewPending === true,
    mode,
    embedding,
    rewrite,
    rerank,
    watermark,
  }
}

const ACTIVITY_LABELS = {
  recall: '召回', 'recall-miss': '召回未命中', extract: '抽取', compact: '压缩', summary: '摘要', request: '请求', restore: '还原', decompress: '还原原文', mode: '模式', forget: '遗忘', supersede: '替换', compactor: '压缩器', abtest: 'A/B', rewrite: '改写', 'rewrite-error': '改写失败', watermark: '水位压缩', 'watermark-error': '水位失败', 'watermark-toggle': '水位开关', 'rewrite-retry': '改写重试', rerank: '重排', 'rerank-error': '重排失败', 'rerank-empty': '重排空输出', reembed: '重算向量', 'embedding-reset': '清旧向量', 'embedding-start': '启动向量服务', 'embedding-ready': '向量服务就绪', 'embedding-start-error': '向量服务启动失败', 'recall-timeout': '召回超时', unfold: '展开原文', 'compact-auto': '自动压缩', 'compact-auto-error': '自动压缩失败', 'config-change': '配置修改',
}

/** 粗估文本 token 数（中文 ~1.6 字符/token，英文偏保守）；只用于注入硬顶。 */
function estimateInjectTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 1.6))
}

/** 把文本切成用于朴素重叠打分的 token：拉丁词 + 中文二元组。 */
function tokens(text) {
  const out = new Set()
  for (const word of text.toLowerCase().match(/[a-z0-9_./:#-]{2,}/g) ?? []) out.add(word)
  const cjk = text.replace(/[^\u4e00-\u9fff]+/g, '')
  for (let i = 0; i < cjk.length - 1; i += 1) out.add(cjk.slice(i, i + 2))
  return out
}

/** 查询侧近义扩展：只影响查询词元，不改变记忆存储与预算。 */
const ALIAS_GROUPS = [
  ['压缩', 'compact', 'compaction', 'fold'],
  ['记忆', 'memory', 'memories', 'remember'],
  ['插件', 'plugin', 'bundle'],
  ['文档', 'doc', 'docs', 'documentation', 'spec'],
  ['洞察', 'insight', 'status', 'observability'],
  ['召回', 'recall', 'inject'],
  ['抽取', 'extract', 'extraction'],
  ['摘要', 'summary', 'summarize'],
  ['配置', 'config', 'configuration', 'setting'],
  ['安装', 'install', 'install_bundle'],
  ['检索', 'search', 'query'],
  ['治理', 'governance', 'forget', 'supersede', 'audit'],
  ['冲突', 'conflict', 'superseded'],
  ['衰减', 'decay', 'ttl'],
  ['预算', 'budget', 'quota'],
  ['上下文', 'context'],
  ['导出', 'export', 'snapshot'],
  ['更新', 'update', 'upgrade'],
]

function expandQueryTokens(query) {
  const out = tokens(query)
  const lower = String(query).toLowerCase()
  for (const group of ALIAS_GROUPS) {
    if (!group.some(term => lower.includes(term))) continue
    for (const term of group) for (const token of tokens(term)) out.add(token)
  }
  return out
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const token of a) if (b.has(token)) inter += 1
  return inter / (a.size + b.size - inter)
}

function messageText(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n').trim()
}

/** A/B 用的两套摘要提示词：A = 原生式 7 段；B = 记忆感知 8 段（含用户约束）。 */
const AB_SECTIONS_A = [
  'Primary Request and Intent',
  'Key Technical Concepts',
  'Files and Code',
  'Errors and Fixes',
  'Pending Jobs',
  'Current Work',
  'Next Step',
]

const AB_SECTIONS_B = [
  '用户目标',
  '用户约束',
  '关键技术',
  '文件与代码',
  '错误与修复',
  '未完成事项',
  '当前进展',
  '下一步',
]

const AB_INSTRUCTION_A = `Summarize the conversation below for another engineer who must continue the work without seeing it.
Use exactly these Markdown sections, in order:
## Primary Request and Intent
## Key Technical Concepts
## Files and Code
## Errors and Fixes
## Pending Jobs
## Current Work
## Next Step
Keep file paths, exact identifiers, decisions and their reasons. Do not invent details.`

const AB_INSTRUCTION_B = `你是上下文压缩器。把下面的对话压成一份可以继续工作的交接摘要。
要求：
- 使用且只使用以下 8 个 Markdown 段落，按顺序；
- 保留文件绝对路径、函数/命令名、配置键、数值阈值、错误原文、决策及其理由；
- 「用户约束」必须单列：用户明确说过的偏好、禁止项、范围边界；
- 若长期记忆候选与对话冲突，以对话为准并标注冲突；
- 不编造、不省略未完成事项。

## 用户目标
## 用户约束
## 关键技术
## 文件与代码
## 错误与修复
## 未完成事项
## 当前进展
## 下一步`

/** 解析 8 段摘要，返回段名 → 内容映射；缺段返回 missing 列表。 */
function parseSummaryBlocks(text) {
  const sections = ['用户目标', '用户约束', '关键技术', '文件与代码', '错误与修复', '未完成事项', '当前进展', '下一步']
  const result = {}
  const sectionRegex = /##\s*(.+?)\n([\s\S]*?)(?=##|$)/g
  let match
  while ((match = sectionRegex.exec(text)) !== null) {
    const name = match[1].trim()
    const content = match[2].trim()
    result[name] = content
  }
  return { sections: result, missing: sections.filter(s => !result[s] || result[s] === '(none)') }
}

const HUB_COMPACTION_INSTRUCTION = `You are the compaction engine for this AI coding assistant. Condense the conversation ABOVE into a checkpoint that lets another model resume the work with no loss of essential context.

Output EXACTLY these 8 Markdown sections, in this order, terse bullets, "(none)" for empty:
## 用户目标
## 用户约束
## 关键技术
## 文件与代码
## 错误与修复
## 未完成事项
## 当前进展
## 下一步

Rules:
- 保留文件绝对路径、函数/命令名、配置键、数值阈值、错误原文、决策及其理由；用户明确说过的偏好与禁止项写进「用户约束」。
- 若对话里已有 <compacted-summary> 块，它是上一版检查点：合并而不是照抄，丢弃已过时的事实。
- 不要提到这次压缩、不要调用工具、只输出检查点正文。
- 输出语言与对话主要语言一致。`

/**
 * hub 压缩器：复用原生触发/选区/恢复，只替换 summarize 的提示词与投影。
 * 任一步失败都抛错，由调用方回退到原生实现。
 */
async function hubSummarize(ctx, store, input, agent, signal) {
  const startTime = Date.now()
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm service unavailable')
  const route = resolveRoute(agent, agent.session)
  if (route === undefined) throw new Error('no provider/model available for summarization')
  const attempt = async budget => {
    const options = {
      provider: route.provider,
      model: route.model,
      messages: [
        ...input.messages,
        { role: 'user', content: [{ type: 'text', text: HUB_COMPACTION_INSTRUCTION }] },
      ],
      maxTokens: budget,
      sessionId: agent.session?.id,
      purpose: 'compaction',
      ...(agent.session?.toolHistory === undefined ? {} : { toolHistory: agent.session.toolHistory() }),
      ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
      ...(signal === undefined ? {} : { signal }),
    }
    let text = ''
    let last = null
    const types = {}
    for await (const chunk of llm.stream(options)) {
      const type = String(chunk?.type ?? 'unknown')
      types[type] = (types[type] ?? 0) + 1
      if (chunk?.type === 'error') throw new Error(String(chunk.error?.message ?? chunk.error ?? 'llm stream error'))
      if (chunk?.type === 'finish') {
        last = chunk
        const reason = chunk.finish?.reason
        const failure = reason?.kind === 'error' ? reason.failure : (chunk.finish?.kind === 'error' ? chunk.finish.failure : undefined)
        if (failure !== undefined) throw new Error(String(failure?.message ?? failure))
      }
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    }
    return { text, types, last }
  }
  let maxTokens = 3000
  let text = ''
  let types = {}
  let last = null
  let retryReason = null
  ;({ text, types, last } = await attempt(maxTokens))
  // 推理型模型可能把预算全花在 reasoning-delta 上，正文为空：放大预算重试一次。
  if (text.trim().length === 0) {
    maxTokens = 8000
    retryReason = `empty @3000; ${JSON.stringify(types)}; msgs=${input.messages?.length ?? 0}`
    store.logEvent('compact-hub-retry', { sessionId: agent.session?.id, detail: retryReason })
    ;({ text, types, last } = await attempt(maxTokens))
  }
  if (text.trim().length === 0) throw new Error(`hub summarization produced no text`)
  
  // C5: 8 段校验
  const { missing } = parseSummaryBlocks(text)
  const sectionCheck = missing.length === 0
  
  // C5: 结转未完成目标（如果有上一版摘要，提取其未完成事项）
  const previousSummary = input.messages?.find(m => m?.content?.[0]?.text?.includes('<compacted-summary>'))
  if (previousSummary) {
    const prevText = previousSummary.content[0].text
    const prevMatch = prevText.match(/## 未完成事项\n([\s\S]*?)(?=##|$)/)
    if (prevMatch && prevMatch[1].trim() && prevMatch[1].trim() !== '(none)') {
      const carryOverJobs = prevMatch[1].trim()
      // 如果新摘要的未完成事项为空，结转旧事项
      if (!/## 未完成事项\n[\s\S]*?(?=##|$)/.test(text) || text.match(/## 未完成事项\n([\s\S]*?)(?=##|$)/)?.[1]?.trim().length < 10) {
        text = text.replace(/(## 未完成事项\n)([\s\S]*?)(?=##|$)/, `$1${carryOverJobs}\n\n`)
      }
    }
  }
  
  const blocks = [{ type: 'text', text }]
  const durationMs = Date.now() - startTime
  
  // C4: 压缩回执 - 记录详细信息
  const shadowedRange = input.region || {}
  const shadowedTokens = input.shadowedTokenCount || 0
  store.logEvent('compact-hub', {
    sessionId: agent.session?.id,
    tokens: text.length,
    detail: `${route.provider}/${route.model} ${text.length} chars`,
    // C4 压缩回执字段
    ledger: {
      start: shadowedRange.start || 0,
      end: shadowedRange.end || 0,
      shadowedTokens: Number(shadowedTokens) || 0,
      summaryChars: text.length,
      compressionRatio: shadowedTokens > 0 ? (text.length / shadowedTokens).toFixed(2) : 'N/A',
      durationMs,
      promptVersion: 'hub-8section-v1.0',
      sectionCheck,
      missingSections: missing,
      retry: retryReason !== null,
      retryReason,
      types,
    },
  })
  
  return {
    summary: blocks,
    rawOutput: blocks,
    llmStreamCall: true,
    provider: route.provider,
    model: route.model,
    maxTokens,
    // C4: 返回回执数据供外部使用
    ledger: {
      start: shadowedRange.start || 0,
      end: shadowedRange.end || 0,
      shadowedTokens: Number(shadowedTokens) || 0,
      summaryChars: text.length,
      compressionRatio: shadowedTokens > 0 ? (text.length / shadowedTokens).toFixed(2) : 'N/A',
      durationMs,
      promptVersion: 'hub-8section-v1.0',
      sectionCheck,
      missingSections: missing,
      retry: retryReason !== null,
    },
  }
}

/** 在已拿到的 compaction 实例上包装 summarize；幂等。 */
function wrapHubCompactor(service, scope, store) {
  try {
    if (service === undefined || typeof service.summarize !== 'function') {
      store.compactorState = 'native（compaction 服务不可用）'
      return
    }
    if (service.__contextHubCompactor === true) {
      store.compactorActive = true
      store.compactorState = 'hub'
      return
    }
    const original = service.summarize
    service.summarize = async function (input, agent, signal) {
      try {
        return await hubSummarize(scope, store, input, agent, signal)
      } catch (error) {
        scope.logger?.warn?.(`context-hub: hub compactor failed (${String(error)}); falling back to native`)
        store.logEvent('compact-hub-fallback', { detail: String(error).slice(0, 200) })
        return original.call(this, input, agent, signal)
      }
    }
    service.__contextHubCompactor = true
    store.compactorState = 'hub'
    store.compactorActive = true
    store.compactorUninstall = () => {
      service.summarize = original
      delete service.__contextHubCompactor
      store.compactorActive = false
      store.compactorState = 'native'
    }
    scope.effect?.(() => () => {
      service.summarize = original
      delete service.__contextHubCompactor
      store.compactorActive = false
    })
    scope.logger?.info?.('context-hub: hub compactor installed')
  } catch (error) {
    store.compactorState = `hub 安装失败：${String(error).slice(0, 80)}`
    scope.logger?.warn?.(`context-hub: hub compactor install failed: ${String(error)}`)
  }
}

/** 把 hub summarize 装到 compaction 服务的实例上；失败只告警，不阻塞插件。 */
function installHubCompactor(ctx, store) {
  const cached = store.compactionService
  if (cached !== undefined && typeof cached.summarize === 'function') {
    wrapHubCompactor(cached, store.compactionScope ?? { logger: ctx.logger }, store)
    return
  }
  try {
    ctx.inject(['compaction'], (scope) => {
      store.compactionScope = scope
      const service = scope.get('compaction')
      store.compactionService = service
      wrapHubCompactor(service, scope, store)
    })
  } catch (error) {
    store.compactorState = `hub 安装失败：${String(error).slice(0, 80)}`
    ctx.logger?.warn?.(`context-hub: hub compactor inject failed: ${String(error)}`)
  }
}

/** 切换压缩器并持久化；返回是否生效。 */
function setCompactor(ctx, store, value) {
  if (value !== 'hub' && value !== 'native') return undefined
  store.config.compactor = value
  if (value === 'hub') installHubCompactor(ctx, store)
  else {
    store.compactorUninstall?.()
    store.compactorActive = false
    store.compactorState = 'native'
  }
  if (store.db !== undefined) {
    store.setKv('compactor', value)
    store.logEvent('compactor', { detail: value })
  }
  return { value, active: store.compactorActive === true, state: store.compactorState ?? '' }
}

/** 从会话尾部收集最近 N 条 user/assistant 消息，拼成 A/B 输入。 */
function transcriptTail(session, maxMessages) {
  const end = typeof session.seq === 'number' ? session.seq : 0
  const picked = []
  for (let seq = end - 1; seq >= 0 && picked.length < maxMessages; seq -= 1) {
    const event = session.eventAt(seq)
    if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
    if (event.data?.source?.kind === 'context-hub') continue
    const text = messageText(event.data?.content)
    if (text.length === 0) continue
    picked.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text })
  }
  picked.reverse()
  const joined = picked.map(item => `[${item.role}]\n${item.text}`).join('\n\n')
  return { text: joined.length > 8000 ? joined.slice(-8000) : joined, count: picked.length }
}

async function runAbSummary(ctx, route, system, transcript, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm service unavailable')
  const started = Date.now()
  let text = ''
  const types = {}
  const chunks = llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: transcript }] }],
    maxTokens: 3000,
    signal,
    purpose: 'context-hub:abtest',
  })
  for await (const chunk of chunks) {
    const type = chunk?.type ?? 'unknown'
    types[type] = (types[type] ?? 0) + 1
    if (type === 'error') throw new Error(String(chunk.error?.message ?? chunk.error ?? 'stream error'))
    if (type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return { text: text.trim(), ms: Date.now() - started, types }
}

function abScore(text, transcript, sections) {
  const lower = text.toLowerCase()
  const present = sections.filter(section => lower.includes(section.toLowerCase())).length
  const summaryTokens = tokens(text)
  const sourceTokens = tokens(transcript)
  let shared = 0
  for (const token of sourceTokens) if (summaryTokens.has(token)) shared += 1
  return {
    present,
    total: sections.length,
    chars: text.length,
    coverage: sourceTokens.size === 0 ? 0 : shared / sourceTokens.size,
  }
}

function scopeForKind(kind) {
  if (kind === 'preference') return 'global'
  if (kind === 'decision' || kind === 'task') return 'project'
  return 'session'
}

/** 记忆质量评分（0–1，见 spec M2）：durable/specific/non-derivable/verifiable/non-duplicate。 */
function admissionScore(text, kind, source, evidence) {
  const lower = text.toLowerCase()
  const durableCue = /(决定|决策|选择|方案|默认|必须|不要|禁止|约定|规则|偏好|习惯|待办|未完成|下一步|坑|注意|decision|decided|choose|chose|default|must|never|always|prefer|todo|blocked|follow[- ]?up)/i.test(lower)
  const durable = durableCue ||
    ['decision', 'preference', 'task', 'skill'].includes(kind) ||
    (kind === 'fact' && text.length >= 40)

  let signals = 0
  if (/[/\\]|\.(js|ts|tsx|jsx|py|go|rs|java|json|ya?ml|toml|md|sh|sql)\b/i.test(text)) signals += 1 // 路径/文件名
  if (/\d/.test(text)) signals += 1
  if (/[a-z][a-z0-9]*[A-Z]|_[a-z0-9]|`[^`]+`/i.test(text)) signals += 1 // 标识符/反引号
  const specific = Math.min(1, signals / 2)

  // 可从代码/配置现场推出的事实不给分；带有“项目/仓库/环境”这类现场可见的通用描述降权。
  const derivable = /^(the project|this project|项目使用|该仓库使用)\b/i.test(text)
  const nonDerivable = derivable ? 0.2 : 0.5

  const verifiable = evidence !== undefined && evidence.length > 0 ? 1 : source === 'explicit' ? 1 : 0.2
  const nonDuplicate = 1

  return 0.30 * (durable ? 1 : 0)
    + 0.25 * specific
    + 0.20 * nonDerivable
    + 0.15 * verifiable
    + 0.10 * nonDuplicate
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function daySeconds() {
  return 86400
}

/** 最小化的 SQLite 记忆库；打开失败时插件其余部分仍可工作。 */
export class MemoryStore {
  constructor(file, config) {
    this.file = file
    this.config = config
    this.tokenCache = new Map()
    this.searchCache = new Map()
    this.db = undefined
    this.embedCache = new Map()
    this.embedQueue = Promise.resolve()
    this.embedError = ''
    this.embedCalls = 0
    this.rewriteCache = new Map()
  }

  /** 清空旧模型留下的向量；换 embedding 模型后必须重算（不同模型向量不可比）。 */
  resetEmbeddings() {
    if (this.db === undefined) return 0
    const model = String(this.config?.embedding?.model ?? '')
    const stale = this.db.prepare(
      "SELECT COUNT(*) AS n FROM memories WHERE embedding IS NOT NULL AND embedding <> '' AND embedding_model <> ?",
    ).get(model)
    const count = Number(stale?.n ?? 0)
    if (count === 0) return 0
    this.db.prepare(
      "UPDATE memories SET embedding = '', embedding_model = '' WHERE embedding_model <> ?",
    ).run(model)
    return count
  }

  open() {
    mkdirSync(dirname(this.file), { recursive: true })
    this.db = new DatabaseSync(this.file)
    try { this.db.exec('PRAGMA busy_timeout = 5000') } catch { /* 旧版 SQLite 忽略 */ }
    // W6：WAL + NORMAL 同步，降低长会话/并发读写的锁等待；个别文件系统不支持时忽略。
    try { this.db.exec('PRAGMA journal_mode = WAL') } catch { /* 忽略 */ }
    try { this.db.exec('PRAGMA synchronous = NORMAL') } catch { /* 忽略 */ }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'session',
        session_id TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.6,
        source TEXT NOT NULL DEFAULT 'extracted',
        evidence_seq TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL DEFAULT '',
        message_seq INTEGER NOT NULL DEFAULT 0,
        sentence_no INTEGER NOT NULL DEFAULT -1,
        valid_from INTEGER NOT NULL DEFAULT 0,
        valid_to INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        superseded_by INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL DEFAULT 0,
        uses INTEGER NOT NULL DEFAULT 0
      );
    `)
    // 先补列再建索引：旧库没有 scope 列时，CREATE INDEX 会直接报 "no such column"。
    this.migrate()
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope, status);
      CREATE INDEX IF NOT EXISTS memories_status_scope ON memories(status, scope);
      CREATE INDEX IF NOT EXISTS memories_session_recent ON memories(session_id, created_at DESC) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS memories_project_recent ON memories(project, created_at DESC) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS memories_scope_recent ON memories(scope, created_at DESC) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS context_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        memory_ids TEXT NOT NULL DEFAULT '',
        tokens INTEGER NOT NULL DEFAULT 0,
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS context_events_kind ON context_events(kind);
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(from_id, to_id, relation)
      );
      CREATE INDEX IF NOT EXISTS memory_links_from ON memory_links(from_id);
      CREATE INDEX IF NOT EXISTS memory_links_to ON memory_links(to_id);
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'term',
        project TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE(project, name)
      );
      CREATE TABLE IF NOT EXISTS entity_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        entity_id INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(memory_id, entity_id)
      );
      CREATE INDEX IF NOT EXISTS entity_links_memory ON entity_links(memory_id);
      CREATE INDEX IF NOT EXISTS entity_links_entity ON entity_links(entity_id);
      CREATE TABLE IF NOT EXISTS compaction_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compaction_id TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        start_seq INTEGER NOT NULL DEFAULT 0,
        end_seq INTEGER NOT NULL DEFAULT 0,
        shadowed_tokens INTEGER NOT NULL DEFAULT 0,
        summary_tokens INTEGER NOT NULL DEFAULT 0,
        saved_tokens INTEGER NOT NULL DEFAULT 0,
        reask INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(compaction_id)
      );
      CREATE INDEX IF NOT EXISTS compaction_ledger_session ON compaction_ledger(session_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL DEFAULT 0,
        uses INTEGER NOT NULL DEFAULT 0,
        UNIQUE(session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, seq);
      CREATE INDEX IF NOT EXISTS messages_project ON messages(project);
      CREATE INDEX IF NOT EXISTS messages_recent ON messages(last_used, created_at);
    `)
    // FTS5 旁路：trigram 对 ≥3 字符的中英文片段有效，2 字中文仍靠关键词二元组。
    // 不可用的是环境问题（SQLite 未编 FTS5），降级为纯关键词，不影响记忆主流程。
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          text, tags, content='memories', content_rowid='id', tokenize='trigram'
        )
      `)
      // 只在首次建表/索引版本变化时全量重建；日常写入走 syncFtsRow 增量同步。
      if (this.getKv('fts.marker') !== 'trigram-v2') {
        if (this.rebuildFts()) this.setKv('fts.marker', 'trigram-v2')
      }
      this.ftsReady = true
    } catch (error) {
      this.ftsReady = false
      this.ftsError = error instanceof Error ? error.message : String(error)
    }
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          text, content='messages', content_rowid='id', tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
          INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
        END;
      `)
      this.messagesFtsReady = true
    } catch (error) {
      this.messagesFtsReady = false
      this.messagesFtsError = error instanceof Error ? error.message : String(error)
    }
    try { chmodSync(this.file, 0o600) } catch { /* 权限收紧失败不阻塞 */ }
    this.archiveExpired()
    this.enforceCapacity()
  }

  /** 旧库升级：补齐 0.1.0 缺失的列。 */
  migrate() {
    const existing = new Set(this.db.prepare('PRAGMA table_info(memories)').all().map(row => row.name))
    const additions = [
      ['scope', "TEXT NOT NULL DEFAULT 'session'"],
      ['confidence', 'REAL NOT NULL DEFAULT 0.6'],
      ['source', "TEXT NOT NULL DEFAULT 'extracted'"],
      ['evidence_seq', "TEXT NOT NULL DEFAULT ''"],
      ['message_id', "TEXT NOT NULL DEFAULT ''"],
      ['message_seq', 'INTEGER NOT NULL DEFAULT 0'],
      ['sentence_no', 'INTEGER NOT NULL DEFAULT -1'],
      ['valid_from', 'INTEGER NOT NULL DEFAULT 0'],
      ['valid_to', 'INTEGER NOT NULL DEFAULT 0'],
      ['status', "TEXT NOT NULL DEFAULT 'active'"],
      ['superseded_by', 'INTEGER NOT NULL DEFAULT 0'],
      ['embedding', "TEXT NOT NULL DEFAULT ''"],
      ['embedding_model', "TEXT NOT NULL DEFAULT ''"],
    ]
    for (const [column, ddl] of additions) {
      if (!existing.has(column)) {
        try {
          this.db.exec(`ALTER TABLE memories ADD COLUMN ${column} ${ddl}`)
        } catch (error) {
          if (!String(error).includes('duplicate column name')) throw error
        }
      }
    }
    const after = new Set(this.db.prepare('PRAGMA table_info(memories)').all().map(row => row.name))
    const missing = additions.map(([column]) => column).filter(column => !after.has(column))
    if (missing.length > 0) throw new Error(`memory schema migration incomplete: missing ${missing.join(', ')}`)
  }

  close() {
    try { this.db?.close() } catch { /* 关闭失败不影响退出 */ }
  }

  /** 查重：同 kind + 同文本视为同一条（返回已存在的 active 条目）。 */
  findDuplicate(hash) {
    if (this.db === undefined) return undefined
    return this.db.prepare('SELECT id, status FROM memories WHERE hash = ?').get(hash)
  }

  /** 与同 scope 的条目做相似度比较，返回最高相似度与对应行。 */
  mostSimilar(text, scope, kind, { project = '', sessionId = '' } = {}) {
    if (this.db === undefined) return { similarity: 0 }
    if (scope === 'session' && sessionId.length === 0) return { similarity: 0 }
    const filters = ["status = 'active'", 'scope = ?']
    const params = [scope]
    if (scope === 'project' && project.length > 0) { filters.push("(project = ? OR project = '')"); params.push(project) }
    if (scope === 'session' && sessionId.length > 0) { filters.push('session_id = ?'); params.push(sessionId) }
    const rows = this.db.prepare(
      `SELECT id, kind, text, confidence, created_at FROM memories WHERE ${filters.join(' AND ')} LIMIT 300`,
    ).all(...params)
    const newTokens = tokens(text)
    let best = { similarity: 0 }
    for (const row of rows) {
      const similarity = jaccard(newTokens, tokens(`${row.text}`))
      if (similarity > best.similarity) best = { similarity, row }
    }
    return best
  }

  /** A5: 语义近邻去重——用向量相似度检测 cosine ≥0.92 的重复候选。 */
  findNearDuplicates(text, scope, { project = '', sessionId = '', limit = 5 } = {}) {
    if (this.db === undefined || this.config.embedding.enabled !== true) return []
    if (scope === 'session' && sessionId.length === 0) return []
    
    // 获取候选
    const filters = ["status = 'active'", 'scope = ?']
    const params = [scope]
    if (scope === 'project' && project.length > 0) { filters.push("(project = ? OR project = '')"); params.push(project) }
    if (scope === 'session' && sessionId.length > 0) { filters.push('session_id = ?'); params.push(sessionId) }
    
    const rows = this.db.prepare(
      `SELECT id, kind, text, confidence, embedding FROM memories WHERE ${filters.join(' AND ')} AND embedding IS NOT NULL AND embedding != '' LIMIT 500`,
    ).all(...params)
    
    // 计算新条目的向量
    const queryVec = this.embedQuerySync(text)
    if (!queryVec || queryVec.length === 0) return []
    
    const THRESHOLD = 0.92
    const candidates = []
    for (const row of rows) {
      try {
        const emb = JSON.parse(row.embedding)
        if (!Array.isArray(emb) || emb.length !== queryVec.length) continue
        const cos = this.cosine(queryVec, emb)
        if (cos >= THRESHOLD) {
          candidates.push({
            id: row.id,
            kind: row.kind,
            text: row.text,
            confidence: row.confidence,
            similarity: cos,
          })
        }
      } catch { /* 忽略解析错误 */ }
    }
    
    // 按相似度降序
    candidates.sort((a, b) => b.similarity - a.similarity)
    return candidates.slice(0, limit)
  }

  /** 同步嵌入查询（用于近邻检测）。 */
  embedQuerySync(text) {
    const cfg = this.config.embedding
    if (!cfg.enabled || !this.db) return null
    try {
      // 简化的同步嵌入——实际应该调用 onnxruntime
      // 这里返回 null，实际使用时需要完整的 onnx 推理
      return null
    } catch {
      return null
    }
  }

  /** W2：连边（幂等，重复只更新权重）。 */
  addLink(fromId, toId, relation, weight) {
    if (this.db === undefined || !Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) return
    try {
      this.db.prepare(
        'INSERT INTO memory_links (from_id, to_id, relation, weight, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(from_id, to_id, relation) DO UPDATE SET weight = excluded.weight',
      ).run(fromId, toId, relation, Math.min(1, Math.max(0, weight)), nowSeconds())
    } catch { /* 连边失败不影响记忆写入 */ }
  }

  /** W2：一跳邻居（按边权排序，过滤掉已选 id）。 */
  expandNeighbors(ids, { limit = 1, project = '' } = {}) {
    if (this.db === undefined || ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT l.weight AS link_weight, m.* FROM memory_links l
      JOIN memories m ON m.id = CASE WHEN l.from_id IN (${placeholders}) THEN l.to_id ELSE l.from_id END
      WHERE (l.from_id IN (${placeholders}) OR l.to_id IN (${placeholders}))
        AND m.status = 'active'
      ORDER BY l.weight DESC, m.id DESC
      LIMIT 60
    `).all(...ids, ...ids, ...ids)
    const seen = new Set(ids)
    const out = []
    for (const row of rows) {
      if (seen.has(row.id)) continue
      if (row.scope === 'project' && project.length > 0 && row.project !== project && row.project !== '') continue
      seen.add(row.id)
      out.push(row)
      if (out.length >= limit * 3) break
    }
    return out
  }

  /** E3: 获取记忆的关系图（多跳邻居）。 */
  memoryGraph(memoryId, { maxDepth = 2, limit = 20 } = {}) {
    if (this.db === undefined) return { nodes: [], edges: [] }
    const nodes = new Map()
    const edges = []
    const queue = [{ id: memoryId, depth: 0 }]
    const visited = new Set([memoryId])
    
    // 获取起始记忆
    const startMem = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId)
    if (!startMem) return { nodes: [], edges: [] }
    nodes.set(memoryId, startMem)
    
    while (queue.length > 0 && nodes.size < limit) {
      const { id, depth } = queue.shift()
      if (depth >= maxDepth) continue
      
      // 获取邻居
      const neighbors = this.db.prepare(`
        SELECT l.*, m.* FROM memory_links l
        JOIN memories m ON m.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
        WHERE (l.from_id = ? OR l.to_id = ?) AND m.status = 'active'
      `).all(id, id, id)
      
      for (const row of neighbors) {
        const neighborId = row.id === memoryId ? (row.from_id === id ? row.to_id : row.from_id) : row.id
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        
        nodes.set(neighborId, row)
        edges.push({
          from: row.from_id === id ? row.to_id : row.from_id,
          to: row.from_id === id ? row.from_id : row.to_id,
          relation: row.relation,
          weight: row.weight,
        })
        
        queue.push({ id: neighborId, depth: depth + 1 })
        if (nodes.size >= limit) break
      }
    }
    
    return { nodes: [...nodes.values()], edges }
  }

  /** E3: 获取冲突链（supersede 关系）。 */
  conflictChain(memoryId) {
    if (this.db === undefined) return []
    const chain = []
    let current = memoryId
    
    // 向前追溯（被谁替代）
    while (current) {
      const mem = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(current)
      if (!mem) break
      chain.unshift({ ...mem, direction: 'original' })
      current = mem.superseded_by > 0 ? mem.superseded_by : null
    }
    
    // 向后追溯（替代了谁）
    current = memoryId
    const visited = new Set()
    while (current && !visited.has(current)) {
      visited.add(current)
      const superseded = this.db.prepare('SELECT * FROM memories WHERE superseded_by = ?').all(current)
      for (const mem of superseded) {
        chain.push({ ...mem, direction: 'superseded' })
        current = mem.id
      }
      if (superseded.length === 0) break
    }
    
    return chain
  }

  /** E3: 获取记忆的时间线（按 created_at 排序的相关记忆）。 */
  memoryTimeline({ scope = 'project', project = '', limit = 20 } = {}) {
    if (this.db === undefined) return []
    const filters = ["status = 'active'"]
    const params = []
    
    if (scope === 'session') {
      // session 记忆需要 session_id
      return []
    } else if (scope === 'project' && project) {
      filters.push("(project = ? OR project = '')")
      params.push(project)
    } else {
      filters.push('scope = ?')
      params.push(scope)
    }
    
    return this.db.prepare(`
      SELECT id, kind, text, created_at, source, confidence
      FROM memories
      WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...params, limit)
  }

  /** P1：从文本/标签抽取实体并连到记忆（启发式，零额外 LLM 调用）。 */
  linkEntities(memoryId, text, tags, project) {
    if (this.db === undefined || !Number.isFinite(memoryId)) return 0
    const names = new Set()
    for (const tag of Array.isArray(tags) ? tags : []) {
      const value = String(tag ?? '').trim()
      if (value.length >= 2 && value.length <= 40) names.add(value)
    }
    const source = String(text ?? '')
    for (const match of source.matchAll(/[\u201c\u201d"']([^\u201c\u201d"']{2,30})[\u201c\u201d"']/g)) names.add(match[1].trim())
    for (const match of source.matchAll(/(?:^|[\s(（])((?:[\w.-]+\/)+[\w.-]+|\b[A-Z][A-Z0-9_]{2,}\b)/g)) names.add(match[1].trim())
    for (const match of source.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) names.add(match[0])
    const list = [...names].filter((name) => name.length >= 2).slice(0, 8)
    if (list.length === 0) return 0
    const now = nowSeconds()
    let linked = 0
    try {
      const upsert = this.db.prepare('INSERT INTO entities (name, kind, project, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(project, name) DO UPDATE SET name = excluded.name RETURNING id')
      const link = this.db.prepare('INSERT INTO entity_links (memory_id, entity_id, weight, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(memory_id, entity_id) DO NOTHING')
      for (const name of list) {
        const row = upsert.get(name, 'term', project, now)
        if (row?.id !== undefined) { link.run(memoryId, row.id, now); linked += 1 }
      }
    } catch { /* 图谱是附加信息，失败不影响写入 */ }
    return linked
  }

  /** P1：1-hop 图谱邻居——与给定记忆共享实体的其它记忆。 */
  graphNeighbors(ids, { limit = 2, project = '' } = {}) {
    if (this.db === undefined || ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const clause = project.length > 0 ? "AND (m.project = ? OR m.project = '')" : ''
    const rows = this.db.prepare(`
      SELECT m.*, SUM(el2.weight) AS graph_weight, GROUP_CONCAT(DISTINCT e.name) AS via_entities
      FROM entity_links el1
      JOIN entity_links el2 ON el2.entity_id = el1.entity_id
      JOIN memories m ON m.id = el2.memory_id
      JOIN entities e ON e.id = el1.entity_id
      WHERE el1.memory_id IN (${placeholders}) AND m.id NOT IN (${placeholders}) AND m.status = 'active' ${clause}
      GROUP BY m.id ORDER BY graph_weight DESC, m.id DESC LIMIT 40
    `).all(...ids, ...ids, ...(project.length > 0 ? [project] : []))
    const seen = new Set(ids)
    const out = []
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
      if (out.length >= limit * 3) break
    }
    return out
  }

  /** P2：记录一次压缩的账面数据（只读账本，幂等）。 */
  recordLedger({ compactionId = '', sessionId = '', start = 0, end = 0, shadowedTokens = 0, summaryChars = 0 } = {}) {
    if (this.db === undefined) return false
    const summaryTokens = Math.ceil(Math.max(0, summaryChars) / 1.6)
    const saved = Math.max(0, Number(shadowedTokens) - summaryTokens)
    try {
      this.db.prepare(`INSERT INTO compaction_ledger (compaction_id, session_id, start_seq, end_seq, shadowed_tokens, summary_tokens, saved_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(compaction_id) DO NOTHING`)
        .run(String(compactionId), sessionId, start, end, Number(shadowedTokens) || 0, summaryTokens, saved, nowSeconds())
      return true
    } catch { return false }
  }

  /** P2：判断新消息是否在压缩后重复了被折叠区间里的内容（复问）。 */
  markReask(sessionId, seq, text) {
    if (this.db === undefined || !Number.isFinite(seq) || String(text ?? '').length < 4) return false
    try {
      const rows = this.db.prepare("SELECT * FROM compaction_ledger WHERE session_id = ? AND reask = 0 AND end_seq < ? AND ? - end_seq <= 20 ORDER BY end_seq DESC LIMIT 3").all(sessionId, seq, seq)
      if (rows.length === 0) return false
      const queryTokens = tokens(text)
      if (queryTokens.size === 0) return false
      for (const row of rows) {
        const folded = this.db.prepare("SELECT text FROM messages WHERE session_id = ? AND seq BETWEEN ? AND ?").all(sessionId, row.start_seq, row.end_seq)
        if (folded.length === 0) continue
        const foldedTokens = tokens(folded.map((item) => item.text).join('\n'))
        let overlap = 0
        for (const token of queryTokens) if (foldedTokens.has(token)) overlap += 1
        if (overlap / queryTokens.size >= 0.6) {
          this.db.prepare('UPDATE compaction_ledger SET reask = 1 WHERE id = ?').run(row.id)
          this.logEvent('reask', { sessionId, detail: `seq ${row.start_seq}-${row.end_seq}` })
          return true
        }
      }
    } catch { /* 账本统计失败不影响召回 */ }
    return false
  }

  /** P2：压缩账本汇总。 */
  ledgerStats(sessionId = '') {
    if (this.db === undefined) return { count: 0, saved: 0, reask: 0, rate: 0, last: null }
    try {
      const where = sessionId.length > 0 ? 'WHERE session_id = ?' : ''
      const args = sessionId.length > 0 ? [sessionId] : []
      const row = this.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(saved_tokens), 0) AS saved, COALESCE(SUM(reask), 0) AS reask FROM compaction_ledger ${where}`).get(...args)
      const last = this.db.prepare(`SELECT * FROM compaction_ledger ${where} ORDER BY id DESC LIMIT 1`).get(...args)
      const count = Number(row?.count) || 0
      return { count, saved: Number(row?.saved) || 0, reask: Number(row?.reask) || 0, rate: count > 0 ? Number(row.reask) / count : 0, last: last ?? null }
    } catch { return { count: 0, saved: 0, reask: 0, rate: 0, last: null } }
  }

  /** P2：最近几条账本明细（面板用）。 */
  recentLedger(limit = 5) {
    if (this.db === undefined) return []
    try {
      return this.db.prepare('SELECT start_seq, end_seq, shadowed_tokens, summary_tokens, saved_tokens, reask, created_at FROM compaction_ledger ORDER BY id DESC LIMIT ?').all(limit)
    } catch { return [] }
  }

  /** P1：图谱规模。 */
  graphStats() {
    if (this.db === undefined) return { entities: 0, links: 0 }
    try {
      const e = this.db.prepare('SELECT COUNT(*) AS n FROM entities').get()
      const l = this.db.prepare('SELECT COUNT(*) AS n FROM entity_links').get()
      const top = this.db.prepare(`SELECT e.name AS name, COUNT(el.id) AS n FROM entities e JOIN entity_links el ON el.entity_id = e.id GROUP BY e.id ORDER BY n DESC, e.name LIMIT 6`).all()
      return { entities: Number(e?.n) || 0, links: Number(l?.n) || 0, top: top.map(row => ({ name: row.name, count: Number(row.n) || 0 })) }
    } catch { return { entities: 0, links: 0, top: [] } }
  }

  /** 启动回填：升级前已有记忆没有实体链接，补一次（最多 500 条）。 */
  backfillEntities(limit = 500) {
    if (this.db === undefined) return 0
    if (this.getKv('entities.backfill') === '1') return 0
    try {
      const rows = this.db.prepare(`SELECT id, text, tags, project FROM memories WHERE status = 'active' AND id NOT IN (SELECT memory_id FROM entity_links) ORDER BY id DESC LIMIT ?`).all(limit)
      let linked = 0
      for (const row of rows) linked += this.linkEntities(row.id, row.text, String(row.tags ?? '').split(',').filter(Boolean), row.project)
      if (rows.length < limit) this.setKv('entities.backfill', '1')
      if (linked > 0) this.logEvent('entities-backfill', { detail: `${rows.length} memories → ${linked} links` })
      return linked
    } catch { return 0 }
  }

  /** W5：待审核列表。 */
  reviewList(limit = 20) {
    if (this.db === undefined) return []
    return this.db.prepare("SELECT * FROM memories WHERE status = 'pending' ORDER BY id DESC LIMIT ?").all(limit)
  }

  /** W5：批准一条 pending 记忆。 */
  approve(id) {
    if (this.db === undefined) return undefined
    return this.db.prepare("UPDATE memories SET status = 'active' WHERE id = ? AND status = 'pending'").run(id).changes
  }

  /** W5：拒绝一条 pending 记忆（软删，审计链保留）。 */
  reject(id) {
    if (this.db === undefined) return undefined
    return this.db.prepare("UPDATE memories SET status = 'deleted' WHERE id = ? AND status = 'pending'").run(id).changes
  }

  /**
   * 写入一条记忆；返回 { id, action }，action ∈ inserted|duplicate|rejected|weaker。
   * 显式 remember（source=explicit）绕过质量门槛。
   */
  insert({ kind, text, tags = [], project = '', sessionId = '', scope, confidence, source = 'extracted', evidence = '', messageId = '', messageSeq = 0, sentenceNo = -1, validFrom, validTo }) {
    if (this.db === undefined) return { action: 'unavailable' }
    this.tokenCache.clear()
    this.searchCache.clear()
    const trimmed = text.trim()
    if (trimmed.length === 0) return { action: 'rejected', reason: 'empty' }
    const safeKind = KIND_VALUES.includes(kind) ? kind : 'fact'
    const safeScope = SCOPE_VALUES.includes(scope) ? scope : scopeForKind(safeKind)
    const safeSource = ['explicit', 'tool', 'compaction'].includes(source) ? source : 'extracted'
    const hash = createHash('sha1').update(`${safeKind}\u0000${trimmed.toLowerCase()}`).digest('hex')

    const duplicate = this.findDuplicate(hash)
    if (duplicate !== undefined && duplicate.status === 'active') {
      return { id: duplicate.id, action: 'duplicate' }
    }
    // P0：已删除/拒绝/被替代的条目不能被同文写入“复活”；归档可以重新激活。
    if (duplicate !== undefined && ['deleted', 'rejected', 'superseded'].includes(duplicate.status)) {
      return { id: duplicate.id, action: 'duplicate', status: duplicate.status, reason: 'tombstoned' }
    }

    const score = admissionScore(trimmed, safeKind, safeSource, evidence)
    const exempt = safeSource === 'explicit' || safeSource === 'compaction'
    if (!exempt && score < this.config.admissionThreshold) {
      return { action: 'rejected', reason: `score ${score.toFixed(2)} < ${this.config.admissionThreshold}` }
    }

    const confidenceValue = Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, Number(confidence)))
      : safeSource === 'explicit' ? 1 : safeSource === 'compaction' ? 0.95 : safeSource === 'tool' ? 0.8 : 0.6

    const similar = this.mostSimilar(trimmed, safeScope, safeKind, { project, sessionId })
    const conflict = similar.similarity >= 0.85 ? similar.row : undefined
    let conflictType = 'standard'
    if (conflict !== undefined) {
      const bothDecisions = conflict.kind === 'decision' && safeKind === 'decision'
      // A3: 三类冲突判定
      conflictType = classifyConflict(trimmed, conflict.text)
      if (!bothDecisions && this.config.conflictPolicy === 'evidence' && confidenceValue < conflict.confidence) {
        // 否定翻转总是新证据胜
        if (conflictType === 'negation-flip' && safeSource === 'explicit') {
          // explicit 否定旧记忆，继续写入
        } else {
          return { action: 'weaker', id: conflict.id, conflictType }
        }
      }
    }

    const createdAt = nowSeconds()
    const validFromValue = Number.isFinite(validFrom) ? Math.max(0, Math.trunc(validFrom)) : createdAt
    const validToValue = Number.isFinite(validTo) ? Math.max(0, Math.trunc(validTo)) : 0
    const messageSeqValue = Number.isFinite(messageSeq) ? Math.max(0, Math.trunc(messageSeq)) : 0
    const sentenceNoValue = Number.isFinite(sentenceNo) ? Math.trunc(sentenceNo) : -1
    const messageIdValue = String(messageId ?? '').slice(0, 200)
    // W5：高风险来源（自动抽取且置信 <0.8）在 reviewPending 开启时先入 pending，等待人工批准。
    // A4: 分层复核——knowledge/structural 默认复核，explicit 直写
    let statusValue = 'active'
    if (this.config.reviewPending === true) {
      if (safeSource === 'extracted' && confidenceValue < 0.8) {
        statusValue = 'pending'
      } else if (this.config.reviewPolicy === 'layered') {
        // layered 策略：knowledge/decision 类需要复核
        if (['decision', 'skill'].includes(safeKind) && safeSource === 'extracted') {
          statusValue = 'pending'
        }
      }
    }
    let inTx = false
    try { this.db.exec('BEGIN'); inTx = true } catch { /* 已有事务时直接写 */ }
    let id
    try {
    const row = this.db.prepare(`
      INSERT INTO memories (hash, kind, text, tags, project, scope, session_id, confidence, source, evidence_seq, message_id, message_seq, sentence_no, valid_from, valid_to, status, created_at, last_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(hash) DO UPDATE SET status = excluded.status, superseded_by = 0, confidence = excluded.confidence,
        evidence_seq = excluded.evidence_seq, message_id = excluded.message_id, message_seq = excluded.message_seq,
        sentence_no = excluded.sentence_no, valid_from = excluded.valid_from, valid_to = 0
      RETURNING id
    `).get(hash, safeKind, trimmed, tags.join(','), project, safeScope, sessionId, confidenceValue, safeSource, evidence, messageIdValue, messageSeqValue, sentenceNoValue, validFromValue, validToValue, statusValue, createdAt)
    id = row?.id

    if (conflict !== undefined && !(conflict.kind === 'decision' && safeKind === 'decision')) {
      // A3: 根据冲突类型记录 detail
      const conflictDetail = conflictType !== 'standard' ? ` (${conflictType})` : ''
      this.db.prepare("UPDATE memories SET status = 'superseded', superseded_by = ?, valid_to = ? WHERE id = ?").run(id, createdAt, conflict.id)
      this.logEvent?.('conflict-detected', { conflictType, newId: id, oldId: conflict.id, detail: `seq ${evidence}${conflictDetail}` })
    }
    // W2：与新记忆最相似的旧记忆连一条 related 边（同 scope 才连，避免跨项目串味）。
    if (similar.row !== undefined && similar.row.id !== undefined && similar.row.id !== id && similar.similarity >= 0.4) {
      this.addLink(id, similar.row.id, 'related', Math.min(1, similar.similarity))
    }
    if (inTx) this.db.exec('COMMIT')
    } catch (error) {
      if (inTx) { try { this.db.exec('ROLLBACK') } catch { /* 忽略 */ } }
      throw error
    }
    this.enforceCapacity()
    this.syncFtsRow(id, trimmed, tags.join(','))
    this.queueEmbedding(id, trimmed)
    this.linkEntities(id, trimmed, tags, project)
    return { id, action: 'inserted', scope: safeScope, confidence: confidenceValue }
  }

  touch(ids) {
    if (this.db === undefined || ids.length === 0) return
    const stmt = this.db.prepare('UPDATE memories SET uses = uses + 1, last_used = ? WHERE id = ?')
    const now = nowSeconds()
    for (const id of ids) stmt.run(now, id)
  }

  /** 写入单行 FTS（外部内容表增量同步，避免每次写都全量 rebuild）。 */
  syncFtsRow(id, text, tags) {
    if (this.db === undefined || this.ftsReady !== true) return false
    try {
      this.db.prepare('INSERT INTO memories_fts(rowid, text, tags) VALUES (?, ?, ?)').run(id, String(text), String(tags ?? ''))
      return true
    } catch {
      return false
    }
  }

  /** 重建 FTS 索引（外部内容表：内容仍以 memories 为准）。 */
  rebuildFts() {
    if (this.db === undefined) return false
    try {
      this.db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
      return true
    } catch {
      return false
    }
  }

  /** 向量端点：baseUrl 可带或不带 /embeddings 后缀。 */
  embedEndpoint() {
    const base = String(this.config.embedding.baseUrl).replace(/\/+$/, '')
    return /\/embeddings$/.test(base) ? base : `${base}/embeddings`
  }

  /** 调 OpenAI 兼容 embeddings 接口；返回与 inputs 等长的向量数组。 */
  async embedTexts(inputs) {
    const cfg = this.config.embedding
    if (cfg.enabled !== true) return []
    const apiKey = process.env[cfg.apiKeyEnv]
    const headers = { 'content-type': 'application/json' }
    if (apiKey !== undefined && apiKey.length > 0) headers.authorization = `Bearer ${apiKey}`
    const response = await fetch(this.embedEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, input: inputs }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    })
    if (!response.ok) throw new Error(`embeddings ${response.status}`)
    const data = await response.json()
    const rows = Array.isArray(data?.data) ? data.data : []
    return rows.map(row => (Array.isArray(row?.embedding) ? row.embedding : [])).filter(vec => vec.length > 0)
  }

  static cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length !== a.length) return 0
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb)
    return denom === 0 ? 0 : dot / denom
  }

  /** 查询向量；关闭时返回 null。失败只记状态，不阻塞召回。 */
  async embedQuery(query) {
    const cfg = this.config.embedding
    if (cfg.enabled !== true || this.db === undefined) return null
    const key = String(query).trim()
    if (key.length === 0) return null
    const cached = this.embedCache.get(key)
    if (cached !== undefined) return cached
    // 可选查询指令前缀（BGE 等检索模型可配）；默认不加，实测加前缀对 base 反而更差。
    const prefix = typeof cfg.queryPrefix === 'string' ? cfg.queryPrefix : ''
    const text = prefix !== '' && !key.startsWith(prefix) ? prefix + key : key
    try {
      const [vec] = await this.embedTexts([text])
      if (!Array.isArray(vec)) return null
      this.embedCalls += 1
      this.embedError = ''
      if (this.embedCache.size >= 100) this.embedCache.delete(this.embedCache.keys().next().value)
      this.embedCache.set(key, vec)
      return vec
    } catch (error) {
      this.embedError = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  /** 后台补写向量：先查后写，串行执行，失败重试下一轮。 */
  queueEmbedding(id, text) {
    if (this.config.embedding.enabled !== true || this.db === undefined) return
    this.embedQueue = this.embedQueue
      .then(() => this.embedAndStore(id, text))
      .catch((error) => { this.embedError = error instanceof Error ? error.message : String(error) })
  }

  async embedAndStore(id, text) {
    if (this.db === undefined) return
    try {
      const [vec] = await this.embedTexts([String(text)])
      if (!Array.isArray(vec)) return
      this.db.prepare('UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?')
        .run(JSON.stringify(vec), this.config.embedding.model, id)
      this.embedCalls += 1
      this.embedError = ''
    } catch (error) {
      this.embedError = error instanceof Error ? error.message : String(error)
    }
  }

  /** 启动时补齐历史条目缺失的向量（最多 200 条，后台执行）。 */
  async backfillEmbeddings(limit = 200) {
    if (this.config.embedding.enabled !== true || this.db === undefined) return 0
    const rows = this.db.prepare(
      "SELECT id, text FROM memories WHERE status = 'active' AND (embedding IS NULL OR embedding = '') LIMIT ?",
    ).all(limit)
    let done = 0
    for (const row of rows) {
      await this.embedAndStore(row.id, row.text)
      done += 1
    }
    return done
  }

  /** FTS5 候选：返回 rowid → 排名（0 最好）。不可用时返回空 Map。 */
  ftsHits(query) {
    if (this.db === undefined || this.ftsReady !== true) return new Map()
    const cleaned = String(query).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (cleaned.length < 3) return new Map()
    const words = (cleaned.match(/[\p{L}\p{N}]{3,}/gu) ?? [])
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
    const quoted = words.map(word => `"${word}"`)
    const ranked = [
      `"${cleaned.replace(/"/g, '')}"`,
      quoted.slice(0, 2).join(' AND '),
      quoted.join(' AND '),
    ].filter(Boolean)
    const run = (expression, ordered) => {
      const sql = `SELECT rowid AS id FROM memories_fts WHERE memories_fts MATCH ?${ordered ? ' ORDER BY bm25(memories_fts)' : ''} LIMIT 50`
      return this.db.prepare(sql).all(expression)
    }
    for (const expression of ranked) {
      try {
        const rows = run(expression, true)
        if (rows.length > 0) {
          const map = new Map()
          rows.forEach((row, index) => map.set(row.id, index))
          return map
        }
      } catch { /* 语法错误时继续下一种表达式 */ }
    }
    // 兜底：OR 不排序（常见词会命中十万级文档，bm25 排序代价太高），命中只作弱加成。
    if (quoted.length > 0) {
      try {
        const rows = run(quoted.join(' OR '), false)
        if (rows.length > 0) {
          const map = new Map()
          rows.forEach((row, index) => map.set(row.id, index))
          return map
        }
      } catch { /* ignore */ }
    }
    return new Map()
  }

  /** 词元缓存：同一批候选在连续查询/探针里复用，避免反复分词。 */
  haystackTokens(row) {
    let set = this.tokenCache.get(row.id)
    if (set !== undefined) return set
    set = expandQueryTokens(`${row.text} ${row.tags}`)
    if (this.tokenCache.size >= 5000) this.tokenCache.clear()
    this.tokenCache.set(row.id, set)
    return set
  }

  /** 排序并给出逐项打分明细；search 与 explain 共用同一套逻辑。 */
  rank(query, { limit = 6, project = '', sessionId = '', includeAll = false, includeInactive = false, embVec = null } = {}) {
    if (this.db === undefined) return []
    const queryTokens = expandQueryTokens(query)
    if (queryTokens.size === 0) return []
    const scopes = includeAll ? SCOPE_VALUES : ['session', 'project', 'global']
    const statusClause = includeInactive ? '' : " AND status = 'active'"
    const rows = []
    for (const scope of scopes) {
      if (scope === 'session') {
        // session 记忆只在它自己的会话里可见；没有会话上下文时一条都不取，避免跨会话串味。
        if (sessionId.length === 0) continue
        rows.push(...this.db.prepare(
          `SELECT * FROM memories WHERE scope = 'session' AND session_id = ?${statusClause} ORDER BY created_at DESC, id DESC LIMIT ${CANDIDATE_WINDOW}`,
        ).all(sessionId))
      } else if (scope === 'project' && project.length > 0) {
        // 拆成两条等值查询，避免 (project = ? OR project = '') 让索引失效。
        rows.push(...this.db.prepare(
          `SELECT * FROM memories WHERE scope = 'project' AND project = ?${statusClause} ORDER BY created_at DESC, id DESC LIMIT ${CANDIDATE_WINDOW}`,
        ).all(project))
        rows.push(...this.db.prepare(
          `SELECT * FROM memories WHERE scope = 'project' AND project = ''${statusClause} ORDER BY created_at DESC, id DESC LIMIT ${CANDIDATE_WINDOW}`,
        ).all())
      } else {
        rows.push(...this.db.prepare(
          `SELECT * FROM memories WHERE scope = ?${statusClause} ORDER BY created_at DESC, id DESC LIMIT ${CANDIDATE_WINDOW}`,
        ).all(scope))
      }
    }
    const ftsMap = this.ftsHits(query)
    // 大库：FTS 命中可能落在最近窗口之外，按 id 补进来（最多 50 条）。
    if (ftsMap.size > 0) {
      const seen = new Set(rows.map(row => row.id))
      const extra = [...ftsMap.keys()].filter(id => !seen.has(id)).slice(0, 50)
      if (extra.length > 0) {
        const placeholders = extra.map(() => '?').join(',')
        // FTS 补入的行同样要过作用域过滤，否则会绕过 session/project 隔离。
        const visible = row => {
          if (row.scope === 'session') return sessionId.length > 0 && row.session_id === sessionId
          if (row.scope === 'project') return project.length === 0 || row.project === project || row.project === ''
          return true
        }
        rows.push(...this.db.prepare(
          `SELECT * FROM memories WHERE id IN (${placeholders})${statusClause}`,
        ).all(...extra).filter(visible))
      }
    }
    const embMin = this.config.embedding.minScore
    const fusion = this.config.embedding.fusion === 'rrf' ? 'rrf' : 'weighted'
    const now = nowSeconds()
    const lambda = { session: 0.10, project: 0.01, global: 0.002 }
    const weight = { session: 1.0, project: 0.8, global: 0.6 }
    const candidates = []
    for (const row of rows) {
      const haystack = this.haystackTokens(row)
      let overlap = 0
      for (const token of queryTokens) if (haystack.has(token)) overlap += 1
      const ftsPosition = ftsMap.get(row.id)
      // 向量旁路：cosine ≥ minScore 才计入；weighted 直接加成，rrf 只用于排名融合。
      let cos = 0
      if (embVec !== null && row.embedding) {
        let vec = null
        try { vec = JSON.parse(row.embedding) } catch { vec = null }
        cos = MemoryStore.cosine(embVec, vec)
      }
      const hasLexical = overlap > 0 || ftsPosition !== undefined
      const hasVector = embVec !== null && cos >= embMin
      if (!hasLexical && !hasVector) continue
      if (overlap === 1 && queryTokens.size > 6 && ftsPosition === undefined && !hasVector) continue
      const ratio = overlap / queryTokens.size
      const boost = row.kind === 'preference' ? 1 : 0
      // FTS 只做加成：新关键词落在第 0 名加 1.0，靠后衰减到 0.3。
      const ftsBoost = ftsPosition === undefined ? 0 : 0.8
      const lexicalBase = overlap > 0 ? overlap + ratio * 2 + boost : (ftsPosition === undefined ? 0 : 0.8)
      const weightedEmb = hasVector ? 0.5 + 0.5 * cos : 0
      const days = Math.max(0, (now - (row.last_used || row.created_at)) / daySeconds())
      const decay = Math.exp(-(lambda[row.scope] ?? 0.01) * days)
      const usage = 1 + 0.1 * Math.min(row.uses ?? 0, 10)
      candidates.push({
        row,
        overlap,
        ftsPosition,
        cos,
        hasLexical,
        hasVector,
        ratio,
        ftsBoost,
        lexicalBase,
        weightedEmb,
        base: lexicalBase + ftsBoost + weightedEmb,
        decay,
        usage,
        scopeWeight: weight[row.scope] ?? 1,
      })
    }
    if (fusion === 'rrf' && embVec !== null) {
      // RRF：词法与向量各自排名，按 1/(k+rank) 融合，避免向量分值直接压过词法。
      const lexical = candidates.filter(item => item.hasLexical)
        .sort((a, b) => b.lexicalBase - a.lexicalBase || Number(b.row.created_at) - Number(a.row.created_at))
      const vector = candidates.filter(item => item.hasVector)
        .sort((a, b) => b.cos - a.cos || Number(b.row.created_at) - Number(a.row.created_at))
      const lexRank = new Map()
      lexical.forEach((item, index) => lexRank.set(item.row.id, index + 1))
      const vecRank = new Map()
      vector.forEach((item, index) => vecRank.set(item.row.id, index + 1))
      const K = 60
      const scored = candidates.map((item) => {
        const lr = lexRank.get(item.row.id)
        const vr = vecRank.get(item.row.id)
        const rrf = (lr === undefined ? 0 : 1 / (K + lr)) + (vr === undefined ? 0 : 1 / (K + vr))
        const score = rrf * 1000 * item.scopeWeight * item.decay * item.usage
        return {
          ...item.row,
          score,
          parts: {
            overlap: item.overlap,
            ratio: Number(item.ratio.toFixed(2)),
            rrf: Number(rrf.toFixed(4)),
            lexicalRank: lr ?? null,
            vectorRank: vr ?? null,
            cos: Number(item.cos.toFixed(3)),
            weight: item.scopeWeight,
            decay: Number(item.decay.toFixed(3)),
            usage: Number(item.usage.toFixed(2)),
            ...(item.ftsPosition === undefined ? {} : { fts: Number(item.ftsBoost.toFixed(2)) }),
          },
        }
      })
      scored.sort((a, b) => b.score - a.score || Number(b.created_at) - Number(a.created_at))
      return scored.slice(0, limit)
    }
    const scored = candidates.map((item) => {
      const score = item.base * item.scopeWeight * item.decay * item.usage
      return {
        ...item.row,
        score,
        parts: {
          overlap: item.overlap,
          ratio: Number(item.ratio.toFixed(2)),
          base: Number(item.base.toFixed(2)),
          weight: item.scopeWeight,
          decay: Number(item.decay.toFixed(3)),
          usage: Number(item.usage.toFixed(2)),
          ...(item.ftsPosition === undefined ? {} : { fts: Number(item.ftsBoost.toFixed(2)) }),
          ...(item.hasVector ? { emb: Number(item.weightedEmb.toFixed(2)), cos: Number(item.cos.toFixed(3)) } : {}),
        },
      }
    })
    scored.sort((a, b) => b.score - a.score || Number(b.created_at) - Number(a.created_at))
    return scored.slice(0, limit)
  }

  search(query, options = {}) {
    // 短 TTL 查询缓存：同一轮内改写/重排/上下文兜底会重复查同一句，省掉重复 FTS+打分。
    const cacheable = options.embVec === null || options.embVec === undefined
    const key = cacheable ? JSON.stringify([query, options.project ?? '', options.sessionId ?? '', options.limit ?? 0, options.includeAll === true, options.includeInactive === true]) : ''
    if (cacheable) {
      const hit = this.searchCache.get(key)
      if (hit !== undefined && Date.now() - hit.at < 30000) return hit.results
    }
    const results = this.rank(query, options)
    if (cacheable) {
      if (this.searchCache.size >= 32) this.searchCache.clear()
      this.searchCache.set(key, { at: Date.now(), results })
    }
    return results
  }

  /** 独立消息索引：FTS5 候选 rowid → 名次；不可用时返回空 Map。 */
  messagesFtsHits(query) {
    if (this.db === undefined || this.messagesFtsReady !== true) return new Map()
    const cleaned = String(query).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (cleaned.length < 3) return new Map()
    const words = (cleaned.match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 8)
    const expressions = [cleaned]
    if (words.length > 0) expressions.push(words.map(word => `"${word}"`).join(' OR '))
    for (const expression of expressions) {
      try {
        const rows = this.db.prepare(
          'SELECT rowid AS id FROM messages_fts WHERE messages_fts MATCH ? ORDER BY bm25(messages_fts) LIMIT 80',
        ).all(expression)
        if (rows.length > 0) {
          const map = new Map()
          rows.forEach((row, index) => map.set(row.id, index))
          return map
        }
      } catch { /* 语法不合法时退回词法 */ }
    }
    return new Map()
  }

  messageCount() {
    if (this.db === undefined) return 0
    try {
      return Number(this.db.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n ?? 0)
    } catch { return 0 }
  }

  /**
   * 增量索引会话消息（独立消息级候选）。只收 user/assistant 文本，
   * 跳过 context-hub 自己的注入；游标持久化到 kv，重载后不重扫。
   */
  indexSession(session, upToSeq) {
    if (this.db === undefined || session === undefined) return 0
    const sessionId = String(session.id ?? '')
    if (sessionId.length === 0) return 0
    const end = Number.isFinite(upToSeq)
      ? Math.max(0, Math.trunc(upToSeq))
      : (typeof session.seq === 'number' ? session.seq : 0)
    const key = `msgidx:${sessionId}`
    const stored = Number(this.getKv(key))
    const from = Number.isFinite(stored) && stored > 0 ? stored : 0
    if (from >= end) return 0
    const project = projectOf(session, this)
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, seq, role, project, text, created_at, last_used, uses)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT(session_id, seq) DO UPDATE SET text = excluded.text, role = excluded.role, project = excluded.project
    `)
    let inserted = 0
    let inTx = false
    try { this.db.exec('BEGIN'); inTx = true } catch { /* 已经有事务时直接写 */ }
    try {
      for (let seq = from; seq < end; seq += 1) {
        const event = session.eventAt?.(seq)
        if (event === undefined) continue
        if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
        if (event.data?.source?.kind === 'context-hub') continue
        const text = messageText(event.data?.content)
        if (text.length === 0) continue
        const role = event.type === 'user/message' ? 'user' : 'assistant'
        stmt.run(sessionId, seq, role, project, text.slice(0, 8000), nowSeconds())
        inserted += 1
      }
      if (inTx) this.db.exec('COMMIT')
    } catch (error) {
      if (inTx) { try { this.db.exec('ROLLBACK') } catch { /* 忽略 */ } }
      throw error
    }
    this.setKv(key, end)
    return inserted
  }

  touchMessages(ids) {
    if (this.db === undefined || ids.length === 0) return
    const stmt = this.db.prepare('UPDATE messages SET uses = uses + 1, last_used = ? WHERE id = ?')
    const now = nowSeconds()
    for (const id of ids) if (Number.isFinite(id)) stmt.run(now, id)
  }

  /** 真正的消息级候选：在同 session/project/global 范围内对消息文本打分。 */
  searchMessages(query, { limit = 6, project = '', sessionId = '' } = {}) {
    if (this.db === undefined) return []
    const queryTokens = expandQueryTokens(query)
    if (queryTokens.size === 0) return []
    const ftsMap = this.messagesFtsHits(query)
    const rows = []
    const seen = new Set()
    if (ftsMap.size > 0) {
      const ids = [...ftsMap.keys()].slice(0, 100)
      const placeholders = ids.map(() => '?').join(',')
      for (const row of this.db.prepare(`SELECT * FROM messages WHERE id IN (${placeholders})`).all(...ids)) {
        if (row.session_id !== sessionId && row.project !== project && row.project !== '') continue
        rows.push(row)
        seen.add(row.id)
      }
    }
    const recent = this.db.prepare(
      "SELECT * FROM messages WHERE (session_id = ? OR project = ? OR project = '') ORDER BY last_used DESC, created_at DESC LIMIT 600",
    ).all(sessionId, project)
    for (const row of recent) {
      if (seen.has(row.id)) continue
      rows.push(row)
      seen.add(row.id)
    }
    const now = nowSeconds()
    const scored = []
    for (const row of rows) {
      const haystack = expandQueryTokens(row.text)
      let overlap = 0
      for (const token of queryTokens) if (haystack.has(token)) overlap += 1
      const ftsPosition = ftsMap.get(row.id)
      if (overlap === 0 && ftsPosition === undefined) continue
      const ratio = overlap / queryTokens.size
      const ftsBoost = ftsPosition === undefined ? 0 : 0.8
      const base = overlap + ratio * 2 + ftsBoost
      const days = Math.max(0, (now - (row.last_used || row.created_at || now)) / daySeconds())
      const decay = Math.exp(-0.02 * days)
      const usage = 1 + 0.1 * Math.min(row.uses ?? 0, 5)
      const sameSession = row.session_id === sessionId ? 1.15 : 1
      scored.push({
        ...row,
        score: base * decay * usage * sameSession,
        parts: {
          overlap,
          ratio: Number(ratio.toFixed(2)),
          fts: Number(ftsBoost.toFixed(2)),
          decay: Number(decay.toFixed(3)),
          usage: Number(usage.toFixed(2)),
        },
      })
    }
    scored.sort((a, b) => b.score - a.score || b.created_at - a.created_at)
    return scored.slice(0, Math.max(1, limit))
  }

  /** 召回调试：返回 50 条候选及打分明细，含非 active 条目。 */
  explain(query, options) {
    return this.rank(query, { ...options, limit: 50, includeInactive: true })
  }

  /**
   * 检索探针：从 active 记忆里取稀有词元自造查询，检查原条目能否被召回（位置）。
   * 返回 { total, hits, rate, cases }；rate 为 top-k 命中率。
   */
  probe({ limit = 10, project = '', sessionId = '' } = {}) {
    if (this.db === undefined) return { total: 0, hits: 0, rate: 0, cases: [] }
    const rows = this.db.prepare(
      "SELECT id, text, kind, scope, project, session_id FROM memories WHERE status = 'active' AND length(text) >= 8 ORDER BY last_used DESC, id DESC LIMIT 200",
    ).all()
    const df = new Map()
    for (const row of rows) for (const token of new Set(tokens(row.text))) df.set(token, (df.get(token) ?? 0) + 1)
    const cases = []
    for (const row of rows) {
      // trigram FTS 匹配不了 2 字词：优先选 3 字以上的稀有词，长度不足时再退回 bigram。
      const all = [...new Set(tokens(row.text))]
      const long = all.filter(token => token.length >= 3)
      const pool = long.length >= 2 ? long : [...long, ...all.filter(token => token.length < 3)]
      const rare = pool
        .sort((a, b) => (df.get(a) - df.get(b)) || (b.length - a.length))
        .slice(0, 2)
      if (rare.length === 0) continue
      const query = rare.join(' ')
      const hits = this.rank(query, { limit: this.config.recallMaxItems, project: row.project || project, sessionId: row.scope === 'session' ? row.session_id : sessionId })
      const position = hits.findIndex(hit => hit.id === row.id)
      cases.push({
        id: row.id,
        query,
        text: String(row.text).slice(0, 40),
        position: position < 0 ? null : position + 1,
        score: position < 0 ? 0 : Number(hits[position].score.toFixed(2)),
      })
      if (cases.length >= limit) break
    }
    const hits = cases.filter(item => item.position !== null).length
    return { total: cases.length, hits, rate: cases.length === 0 ? 0 : Number((hits / cases.length).toFixed(2)), cases }
  }

  getById(id) {
    if (this.db === undefined) return undefined
    return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
  }

  /** 软删除：保留审计链，召回不再命中。 */
  forget(id) {
    if (this.db === undefined) return 0
    this.searchCache.clear()
    const row = this.getById(id)
    if (row === undefined || row.status === 'deleted') return 0
    this.db.prepare("UPDATE memories SET status = 'deleted' WHERE id = ?").run(id)
    return 1
  }

  /** 用一条显式记忆替代旧条目，保留 supersede 链。 */
  supersede(oldId, text) {
    this.searchCache.clear()
    const old = this.getById(oldId)
    if (old === undefined) return { action: 'missing' }
    const result = this.insert({
      kind: old.kind,
      text,
      tags: String(old.tags ?? '').split(',').filter(Boolean),
      scope: old.scope,
      project: old.project,
      sessionId: old.session_id,
      source: 'explicit',
      confidence: 1,
    })
    if (result.action !== 'inserted') return result
    this.db.prepare("UPDATE memories SET status = 'superseded', superseded_by = ?, valid_to = ? WHERE id = ?").run(result.id, nowSeconds(), oldId)
    this.addLink(result.id, oldId, 'supersedes', 1)
    return { action: 'inserted', id: result.id, replaced: oldId }
  }

  logEvent(kind, { sessionId = '', memoryIds = [], tokens = 0, detail = '' } = {}) {
    if (this.db === undefined) return
    try {
      this.db.prepare(
        'INSERT INTO context_events (kind, session_id, memory_ids, tokens, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(kind, sessionId, memoryIds.join(','), tokens, String(detail).slice(0, 500), nowSeconds())
      if (kind === 'request') {
        this.db.prepare(
          "DELETE FROM context_events WHERE kind = 'request' AND id NOT IN (SELECT id FROM context_events WHERE kind = 'request' ORDER BY id DESC LIMIT 200)",
        ).run()
      }
    } catch { /* 观测日志失败不影响主流程 */ }
  }

  /** 小型键值存储：用于跨进程续接抽取游标等可恢复状态。 */
  /** 把旧 cwd 项目键迁移到 git 身份键；返回迁移的记忆条数。 */
  migrateProject(from, to) {
    if (this.db === undefined || from === to || String(from).length === 0) return 0
    let moved = 0
    try {
      const info = this.db.prepare('UPDATE memories SET project = ? WHERE project = ?').run(to, from)
      moved = Number(info?.changes ?? 0)
    } catch { /* 迁移失败时不阻断 */ }
    try { this.db.prepare('UPDATE messages SET project = ? WHERE project = ?').run(to, from) } catch { /* 消息索引可选 */ }
    return moved
  }

  getKv(key) {
    if (this.db === undefined) return undefined
    try {
      return this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value
    } catch { return undefined }
  }

  setKv(key, value) {
    if (this.db === undefined) return
    try {
      this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))
    } catch { /* kv 写入失败不影响主流程 */ }
  }

  /** 从最近一条 extract 事件推断游标终点+1；用于 kv 表为空时的迁移。 */
  latestExtractEnd(sessionId) {
    if (this.db === undefined) return undefined
    try {
      const row = this.db.prepare(
        "SELECT detail FROM context_events WHERE kind = 'extract' AND session_id = ? ORDER BY id DESC LIMIT 1",
      ).get(sessionId)
      const match = /seq (\d+)-(\d+)/.exec(row?.detail ?? '')
      return match === null ? undefined : Number(match[2]) + 1
    } catch { return undefined }
  }

  recentEvents(limit = 10) {
    if (this.db === undefined) return []
    return this.db.prepare('SELECT * FROM context_events ORDER BY id DESC LIMIT ?').all(limit)
  }

  eventCounts() {
    if (this.db === undefined) return []
    return this.db.prepare('SELECT kind, COUNT(*) AS n, COALESCE(SUM(tokens), 0) AS tokens FROM context_events GROUP BY kind').all()
  }

  exportSnapshot(path, recent = 500) {
    if (this.db === undefined) return undefined
    const memories = this.db.prepare('SELECT * FROM memories ORDER BY id').all()
    const events = this.db.prepare('SELECT * FROM context_events ORDER BY id DESC LIMIT ?').all(recent)
    const links = this.db.prepare('SELECT * FROM memory_links ORDER BY id').all()
    const messages = this.db.prepare('SELECT * FROM messages ORDER BY id LIMIT 20000').all()
    const entities = this.db.prepare('SELECT * FROM entities ORDER BY id').all()
    const entityLinks = this.db.prepare('SELECT * FROM entity_links ORDER BY id').all()
    const compactionLedger = this.db.prepare('SELECT * FROM compaction_ledger ORDER BY id').all()
    const payload = {
      version: 5,
      exported_at: new Date().toISOString(),
      db: this.file,
      memories,
      links,
      messages,
      events,
      entities,
      entity_links: entityLinks,
      compaction_ledger: compactionLedger,
    }
    writeFileSync(path, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 })
    return { memories: memories.length, messages: messages.length, events: events.length, entities: entities.length, ledger: compactionLedger.length }
  }

  /** E5: JSONL 导出——每行一个记忆，便于脚本消费和增量导入。 */
  exportToJSONL(path) {
    if (this.db === undefined) return undefined
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY id').all()
    const lines = rows.map(row => JSON.stringify(row)).join('\n')
    writeFileSync(path, lines, { encoding: 'utf8', mode: 0o600 })
    return { count: rows.length, path }
  }

  /** E5: 幂等导入 JSONL——重复导入不产生重复行，基于 hash 去重。 */
  importFromJSONL(path) {
    if (this.db === undefined) return undefined
    const content = readFileSync(path, 'utf8')
    const lines = content.split('\n').filter(line => line.trim().length > 0)
    let imported = 0
    let skipped = 0
    let inTx = false
    try { this.db.exec('BEGIN'); inTx = true } catch { /* 已有事务时直接写 */ }
    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO memories (hash, kind, text, tags, project, scope, session_id, confidence, source, evidence_seq, message_id, message_seq, sentence_no, valid_from, valid_to, status, created_at, last_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hash) DO NOTHING
      `)
      for (const line of lines) {
        try {
          const row = JSON.parse(line)
          insertStmt.run(
            row.hash, row.kind, row.text, row.tags, row.project, row.scope, row.session_id,
            row.confidence, row.source, row.evidence_seq, row.message_id, row.message_seq,
            row.sentence_no, row.valid_from, row.valid_to, row.status, row.created_at, row.last_used
          )
          imported += 1
        } catch { /* 跳过无效行 */ }
      }
      if (inTx) this.db.exec('COMMIT')
      // 导入后重建 FTS 和向量
      this.rebuildFts()
      void this.backfillEmbeddings(200).catch(() => {})
      this.logEvent?.('import', { path, imported, skipped })
      return { imported, skipped, path }
    } catch (error) {
      if (inTx) { try { this.db.exec('ROLLBACK') } catch { /* 忽略 */ } }
      throw error
    }
  }

  counts() {
    if (this.db === undefined) return []
    return this.db.prepare(
      'SELECT scope, status, kind, COUNT(*) AS n FROM memories GROUP BY scope, status, kind ORDER BY scope, status, kind',
    ).all()
  }

  total() {
    return this.counts().filter(row => row.status === 'active').reduce((sum, row) => sum + Number(row.n), 0)
  }

  /** 最近使用/写入的 active 条目，供面板展示。 */
  recentActive(limit = 5) {
    if (this.db === undefined) return []
    return this.db.prepare(
      "SELECT id, kind, scope, confidence, text, uses FROM memories WHERE status = 'active' ORDER BY COALESCE(NULLIF(last_used, 0), created_at) DESC, id DESC LIMIT ?",
    ).all(limit)
  }

  /** 按 scope TTL 把过期条目归档（不物理删除）。 */
  archiveExpired() {
    if (this.db === undefined) return
    const now = nowSeconds()
    const ttl = {
      session: this.config.sessionTtlDays,
      project: this.config.projectTtlDays,
      global: this.config.globalTtlDays,
    }
    for (const [scope, days] of Object.entries(ttl)) {
      if (!days || days <= 0) continue
      this.db.prepare(
        `UPDATE memories SET status = 'archived'
         WHERE scope = ? AND status = 'active' AND COALESCE(NULLIF(last_used, 0), created_at) < ?`,
      ).run(scope, now - days * daySeconds())
    }
  }

  /** 每个 scope 超过容量时，按最后使用时间归档最旧条目。 */
  enforceCapacity() {
    if (this.db === undefined) return
    for (const scope of SCOPE_VALUES) {
      if (scope === 'session') {
        // 会话记忆按 (session_id) 分别限容，避免一个长会话把别的会话挤掉。
        const groups = this.db.prepare(
          "SELECT session_id AS sid, COUNT(*) AS n FROM memories WHERE scope = 'session' AND status = 'active' GROUP BY session_id HAVING n > ?",
        ).all(this.config.capacityPerScope)
        for (const group of groups) {
          const overflow = Number(group.n ?? 0) - this.config.capacityPerScope
          if (overflow <= 0) continue
          this.db.prepare(
            `UPDATE memories SET status = 'archived' WHERE id IN (
               SELECT id FROM memories WHERE scope = 'session' AND session_id = ? AND status = 'active'
               ORDER BY COALESCE(NULLIF(last_used, 0), created_at) ASC LIMIT ?
             )`,
          ).run(group.sid, overflow)
        }
        continue
      }
      const row = this.db.prepare(
        "SELECT COUNT(*) AS n FROM memories WHERE scope = ? AND status = 'active'",
      ).get(scope)
      const overflow = Number(row?.n ?? 0) - this.config.capacityPerScope
      if (overflow <= 0) continue
      this.db.prepare(
        `UPDATE memories SET status = 'archived' WHERE id IN (
           SELECT id FROM memories WHERE scope = ? AND status = 'active'
           ORDER BY COALESCE(NULLIF(last_used, 0), created_at) ASC LIMIT ?
         )`,
      ).run(scope, overflow)
    }
    // 清理空会话的悬挂计数没有意义：只做归档，不删除行（审计链保留）。
  }
}

/** 在完整会话日志里检索文本事件（包括已被压缩折叠的区间）。 */
function searchHistory(session, query, limit) {
  const queryTokens = tokens(query)
  const hits = []
  const end = typeof session.seq === 'number' ? session.seq : 0
  for (let seq = 0; seq < end; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const text = messageText(event.data?.content)
    if (text.length === 0) continue
    const haystack = tokens(text)
    let overlap = 0
    for (const token of queryTokens) if (haystack.has(token)) overlap += 1
    if (overlap === 0) continue
    hits.push({ seq, role: event.type === 'user/message' ? 'user' : 'assistant', text, score: overlap })
  }
  hits.sort((a, b) => b.score - a.score || b.seq - a.seq)
  return hits.slice(0, limit)
}

/**
 * W3：把会话日志里 [start, end) 的原始对话按 seq 还原成文本。
 * 只读日志、不删摘要；有字符预算，超出即截断并标记。
 */
function restoreTranscript(session, start, end, maxChars) {
  const limit = typeof session.seq === 'number' ? session.seq : 0
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(limit, Math.max(from, Math.floor(end)))
  const pieces = []
  let used = 0
  let truncated = false
  for (let seq = from; seq < to; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const text = messageText(event.data?.content)
    if (text.length === 0) continue
    const role = event.type === 'user/message' ? 'user' : 'assistant'
    const chunk = `[seq ${seq} ${role}] ${text.slice(0, 2000)}`
    if (used + chunk.length > maxChars) {
      truncated = true
      break
    }
    pieces.push(chunk)
    used += chunk.length
  }
  return { text: pieces.join('\n\n'), used, from, to, truncated }
}

/** 还原内容作为一条可忽略的上下文「转交」消息注入下一步。 */
function restoredMessage(restored) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: [
        `以下是被压缩历史区间 seq ${restored.from}-${restored.to - 1} 的原文摘录（来自会话日志${restored.truncated ? '，已按预算截断' : ''}；仅供参考）：`,
        '',
        restored.text,
      ].join('\n'),
    }],
    source: { kind: 'context-hub', form: 'relay' },
  }
}

/** 从摘要的 evidence/detail 里解析 seq 区间。 */
function parseRange(text) {
  const match = /(\d+)\s*[-–]\s*(\d+)/.exec(String(text ?? ''))
  if (match === null) return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined
  return { start, end }
}

/** 找压缩区间：显式 id 的 evidence_seq，或最近一条 summary 事件。 */
function resolveCompactionRange(store, id) {
  if (Number.isFinite(id)) {
    const row = store.getById(id)
    if (row === undefined) return { error: `没有编号为 #${id} 的记忆。` }
    const range = parseRange(row.evidence_seq) ?? (String(row.message_id ?? '').length > 0 && Number(row.message_seq) >= 0 ? { start: Number(row.message_seq), end: Number(row.message_seq) + 1 } : undefined)
    if (range === undefined) return { error: `#${id} 没有可定位的压缩区间（需要 summary 记忆或带证据 seq）。` }
    return { range, row }
  }
  const event = store.recentEvents(50).find(item => item.kind === 'summary' && parseRange(item.detail) !== undefined)
  if (event === undefined) return { error: '没有历史压缩摘要可供还原；请先压缩一次，或显式传 start/end。' }
  return { range: parseRange(event.detail) }
}

/** C2：按摘要区间还原原文并注入下一步；decompress 工具与命令共用。 */
function decompressTranscript(ctx, store, session, options, exec) {
  if (session === undefined) return '当前没有会话可供还原。'
  let range
  if (Number.isFinite(options.start)) {
    const end = Number.isFinite(options.end) ? Math.min(Math.max(options.start + 1, options.end), options.start + 400) : options.start + 40
    range = { start: Math.max(0, Math.floor(options.start)), end }
  } else {
    const resolved = resolveCompactionRange(store, Number.isFinite(options.id) ? options.id : undefined)
    if (resolved.error !== undefined) return resolved.error
    range = resolved.range
  }
  const budget = Number.isFinite(options.maxChars) ? Math.min(Math.max(1000, Number(options.maxChars)), 20000) : 8000
  const restored = restoreTranscript(session, range.start, range.end, budget)
  if (restored.text.length === 0) return `seq ${restored.from}-${restored.to - 1} 没有可还原的对话文本（可能只有工具或系统事件）。`
  const message = restoredMessage(restored)
  if (typeof exec?.deferContext === 'function') exec.deferContext(message)
  else if (typeof exec?.agent?.inject === 'function') exec.agent.inject(message)
  else if (typeof exec?.inject === 'function') exec.inject(message)
  else return '当前没有可注入的 agent，未还原。'
  store.logEvent('decompress', {
    sessionId: session.id ?? '',
    tokens: restored.used,
    detail: `seq ${restored.from}-${restored.to - 1}${restored.truncated ? ' (truncated)' : ''}`,
  })
  return `已还原 seq ${restored.from}-${restored.to - 1} 的 ${restored.used} 字符原文，并加入下一步上下文${restored.truncated ? '（已按预算截断）' : ''}。`
}

/**
 * 消息级可逆折叠：找到覆盖某区间的压缩 checkpoint（compaction/summary）。
 * 返回 compactionId 与原始 seq 区间，供 pre-step 用原文替代摘要节点。
 */
function findCompactionCheckpoint(session, range) {
  const end = typeof session?.seq === 'number' ? session.seq : 0
  for (let seq = end - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt?.(seq)
    if (event?.type !== 'compaction/summary') continue
    const seqs = Array.isArray(event.data?.shadowedSeqs)
      ? event.data.shadowedSeqs.map(Number).filter(value => Number.isFinite(value))
      : []
    let start
    let stop
    if (seqs.length > 0) {
      start = Math.min(...seqs)
      stop = Math.max(...seqs) + 1
    } else {
      const rangeValue = event.data?.shadowedRange
      if (rangeValue === undefined) continue
      start = Number(rangeValue.start)
      stop = Number(rangeValue.end) + 1
    }
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue
    if (range.start >= start && range.start < stop) {
      return { compactionId: String(event.data?.compactionId ?? ''), start, end: stop }
    }
  }
  return undefined
}

/** 展开一个压缩区间：接下来 N 步用原文替代摘要节点。 */
function unfoldRange(ctx, store, session, options) {
  if (session === undefined) return '当前没有会话可供展开。'
  let range
  if (Number.isFinite(options.start)) {
    const start = Math.max(0, Math.floor(options.start))
    const end = Number.isFinite(options.end)
      ? Math.min(Math.max(start + 1, Number(options.end)), start + 400)
      : start + 40
    range = { start, end }
  } else {
    const resolved = resolveCompactionRange(store, Number.isFinite(options.id) ? options.id : undefined)
    if (resolved.error !== undefined) return resolved.error
    range = resolved.range
  }
  const checkpoint = findCompactionCheckpoint(session, range)
  if (checkpoint === undefined) {
    return '该区间没有压缩摘要节点可展开（unfold 只作用于压缩 checkpoint）；要回看原文请用 decompress 或 restore。'
  }
  const steps = Number.isFinite(options.steps)
    ? Math.min(Math.max(1, Math.trunc(options.steps)), 20)
    : store.config.unfold.steps
  const budget = Number.isFinite(options.maxChars)
    ? Math.min(Math.max(1000, Math.trunc(options.maxChars)), 20000)
    : store.config.unfold.maxChars
  const key = checkpoint.compactionId.length > 0 ? checkpoint.compactionId : `range:${checkpoint.start}-${checkpoint.end}`
  stateOf(session).unfolds.set(key, { start: checkpoint.start, end: checkpoint.end, budget, remaining: steps })
  store.logEvent('unfold', {
    sessionId: session.id ?? '',
    tokens: 0,
    detail: `seq ${checkpoint.start}-${checkpoint.end - 1}，${steps} 步，预算 ${budget}`,
  })
  return `已展开 seq ${checkpoint.start}-${checkpoint.end - 1}：接下来 ${steps} 步的 pre-step 会用原文替代压缩摘要（预算 ${budget} 字符）。`
}

/**
 * 安装 pre-step 展开器：当 surface 里出现 context-hub 记录的 checkpoint，
 * 且该区间处于展开状态时，把摘要消息替换为原文 relay。只影响本次请求，不改会话日志。
 */
function installUnfold(ctx, store) {
  if (store.unfoldDispose !== undefined) return store.unfoldDispose
  store.unfoldDispose = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    const session = payload?.agent?.session
    if (session === undefined) return decision
    const state = stateOf(session)
    if (state.unfolds.size === 0) return decision
    let replaced = 0
    let used = 0
    const messages = decision.messages.map((message) => {
      const source = message?.source
      if (source?.kind !== 'compact-checkpoint') return message
      const key = String(source.compactionId ?? '')
      const entry = state.unfolds.get(key)
      if (entry === undefined) return message
      const restored = restoreTranscript(session, entry.start, entry.end, entry.budget)
      if (restored.text.length === 0) return message
      entry.remaining -= 1
      if (entry.remaining <= 0) state.unfolds.delete(key)
      replaced += 1
      used += restored.used
      return {
        id: randomUUID(),
        role: 'user',
        content: [{
          type: 'text',
          text: [
            `以下是用原文展开的压缩区间 seq ${restored.from}-${restored.to - 1}（临时替代摘要，剩 ${Math.max(0, entry.remaining)} 步；可能与后续摘要重复）：`,
            '',
            restored.text,
          ].join('\n'),
        }],
        source: { kind: 'context-hub', form: 'unfold' },
      }
    })
    if (replaced === 0) return decision
    store.logEvent('unfold', { sessionId: session.id, tokens: used, detail: `替代 ${replaced} 个摘要节点` })
    return { ...decision, messages }
  }, { global: true })
  return store.unfoldDispose
}

function foldedStats(session) {
  let count = 0
  let tokens = 0
  const end = typeof session.seq === 'number' ? session.seq : 0
  for (let seq = 0; seq < end; seq += 1) {
    const event = session.eventAt(seq)
    if (event?.type !== 'compaction/summary') continue
    count += 1
    const value = Number(event.data?.shadowedTokenCount)
    if (Number.isFinite(value)) tokens += value
  }
  return { count, tokens }
}

/** 组装一条“记忆召回”上下文消息；B2 阶段 2 按来源消息聚合渲染。 */
function recallMessage(items, config) {
  const lines = [
    '以下是长期记忆里可能与当前任务相关的条目（由 context-hub 自动召回，仅供参考、可能过时；与当前对话冲突时以当前对话为准）：',
  ]
  const messageItems = items.filter(item => item.synthetic === true)
  const factItems = items.filter(item => item.synthetic !== true)
  for (const item of messageItems) {
    lines.push(`- 原文窗口 seq ${item.message_seq} [${item.role ?? 'message'}]：${item.text}`)
  }
  const groups = []
  for (const item of factItems) {
    const key = String(item.message_id ?? '').length > 0 ? `m:${item.message_seq}` : `f:${item.id}`
    let group = groups.find(entry => entry.key === key)
    if (group === undefined) {
      group = {
        key,
        messageSeq: String(item.message_id ?? '').length > 0 ? Number(item.message_seq) : 0,
        window: item.sourceWindow,
        items: [],
      }
      groups.push(group)
    }
    group.items.push(item)
  }
  for (const group of groups) {
    const dateOf = item => new Date(Number(item.created_at) * 1000).toISOString().slice(0, 10)
    if (group.messageSeq > 0) {
      lines.push(`- 原文窗口 seq ${group.messageSeq}：${group.window ?? '（原文不可用）'}`)
      for (const item of group.items) {
        lines.push(`  · [#${item.id} ${item.kind} ${item.scope} ${dateOf(item)}] ${item.text}`)
      }
    } else {
      for (const item of group.items) {
        lines.push(`- [#${item.id} ${item.kind} ${item.scope} ${dateOf(item)}] ${item.text}`)
      }
    }
  }
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: lines.join('\n').slice(0, Math.min(config.recallMaxChars, Math.floor((Number(config.recallMaxTokens) > 0 ? Number(config.recallMaxTokens) : 1200) * 1.6))) }],
    source: { kind: 'context-hub', form: 'recall' },
  }
}

const projectKeyCache = new Map()

/** 把 git remote 归一化成 host/owner/repo：ssh、https、scp 风格落到同一个 key。 */
function normalizeGitRemote(raw) {
  let value = String(raw ?? '').trim()
  if (value.length === 0) return undefined
  value = value.replace(/\.git$/i, '')
  value = value.replace(/^git@([^:]+):/, '$1/')
  value = value.replace(/^ssh:\/\//i, '')
  value = value.replace(/^https?:\/\//i, '')
  value = value.replace(/^[^@/]+@/, '')
  value = value.replace(/\/{2,}/g, '/')
  value = value.replace(/^\/+|\/+$/g, '')
  if (value.length === 0) return undefined
  return `git:${value.toLowerCase()}`
}

/** 用 git 推断项目身份：优先 origin，其次仓库根路径；不在仓库里返回 undefined。 */
function gitProjectKey(cwd) {
  const run = (args) => execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 250,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  try {
    const remote = normalizeGitRemote(run(['remote', 'get-url', 'origin']))
    if (remote !== undefined) return remote
  } catch { /* 没有 origin 时退回仓库根 */ }
  try {
    const top = run(['rev-parse', '--show-toplevel']).replace(/\/+$/, '').toLowerCase()
    if (top.length > 0) return `path:${top}`
  } catch { /* 不是 git 仓库 */ }
  return undefined
}

/**
 * 项目身份：git 身份（默认，跨机器一致）或 cwd 绝对路径。
 * 第一次解析时把旧 cwd 键下的记忆迁移到新键（每个 cwd 一次），避免老数据“消失”。
 */
function projectOf(session, store) {
  const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : ''
  const identity = store?.config?.projectIdentity === 'cwd' ? 'cwd' : 'git'
  if (identity === 'cwd' || cwd.length === 0) return cwd
  const cached = projectKeyCache.get(cwd)
  if (cached !== undefined) return cached
  let key
  try { key = store?.db !== undefined ? store.getKv(`project:${cwd}`) : undefined } catch { key = undefined }
  if (typeof key !== 'string' || key.length === 0) key = gitProjectKey(cwd) ?? cwd
  projectKeyCache.set(cwd, key)
  if (store?.db !== undefined) {
    try { store.setKv(`project:${cwd}`, key) } catch { /* 忽略 */ }
    if (key !== cwd) {
      try {
        if (store.getKv(`project-migrated:${cwd}`) !== '1') {
          const moved = store.migrateProject(cwd, key)
          store.setKv(`project-migrated:${cwd}`, '1')
          if (moved > 0) store.logEvent('project-migrate', { detail: `${cwd} → ${key}（${moved} 条）` })
        }
      } catch { /* 迁移失败不阻塞 */ }
    }
  }
  return key
}

/** 取当前消息之前最近的助手/用户文本，作为召回查询的兜底上下文。 */
function recentContext(session, beforeSeq, maxChars = 600) {
  const end = typeof beforeSeq === 'number' ? beforeSeq : session.seq
  const pieces = []
  for (let seq = end - 1; seq >= 0 && pieces.length < 2; seq -= 1) {
    const event = session.eventAt(seq)
    if (event?.type !== 'assistant/message' && event?.type !== 'user/message') continue
    if (event.data?.source?.kind === 'context-hub') continue
    const text = messageText(event.data?.content)
    if (text.length > 0) pieces.push(text)
  }
  return pieces.join('\n').slice(-maxChars)
}

/** 用户发来新消息时召回相关记忆并注入下一个 step。 */
async function maybeRecall(ctx, store, session, event) {
  const source = event.data?.source
  if (source?.kind !== 'user') return
  const text = messageText(event.data?.content)
  if (text.length < 4) return
  const startedAt = Date.now()
  const budgetMs = Number(store.config.recallTimeoutMs)
  const deadline = Number.isFinite(budgetMs) && budgetMs > 0 ? startedAt + budgetMs : Number.POSITIVE_INFINITY
  const timeLeft = () => deadline - Date.now()
  try { store.indexSession(session, event.seq) } catch { /* 消息索引失败不阻塞召回 */ }
  try { store.markReask(session.id, event.seq, text) } catch { /* 账本统计失败不阻塞召回 */ }
  if (store.total() === 0 && store.messageCount() === 0) return

  const state = stateOf(session)
  const project = projectOf(session, store)
  const usable = item => {
    if (state.injected.has(item.id)) return false
    return (state.cooldown.get(item.id) ?? -1) < state.turn
  }
  let via = 'query'
  const agent = ctx.get('agents')?.get(session.id)
  
  // B5: 查询卫生——只取本步真人用户消息，排除注入块、工具结果、其他插件消息
  const queryText = sanitizeQueryText(session, event.seq)
  const queryForRecall = queryText || text
  
  // 硬时限：模型改写/重排占满预算时，宁可本次不注入，也不让记忆拖慢下一步。
  const rewritten = await rewriteQuery(ctx, store, agent, session, queryForRecall, deadline)
  const rewriteMs = Date.now() - startedAt
  const searchText = rewritten === null ? queryForRecall : `${queryForRecall} ${rewritten}`
  if (rewritten !== null) via = 'query+rewrite'
  const queryVec = timeLeft() > 120 ? await store.embedQuery(searchText) : null
  const embedMs = Date.now() - startedAt - rewriteMs
  let hits = store.search(searchText, { limit: store.config.recallMaxItems * 3, project, sessionId: session.id, embVec: queryVec }).filter(usable)
  if (hits.length === 0) {
    const context = recentContext(session, event.seq)
    if (context.length > 0) {
      via = 'context'
      const contextVec = timeLeft() > 120 ? await store.embedQuery(context) : null
      hits = store.search(context, { limit: store.config.recallMaxItems * 3, project, sessionId: session.id, embVec: contextVec }).filter(usable)
    }
  }
  const searchMs = Date.now() - startedAt - rewriteMs - embedMs
  hits = await rerankHits(ctx, store, session, text, hits, agent, deadline)
  const rerankMs = Date.now() - startedAt - rewriteMs - embedMs - searchMs

  // B2 阶段 2：按来源消息聚合排序——同一消息命中多条时优先整组进入预算。
  const groupScore = new Map()
  const groupKeyOf = item => (String(item.message_id ?? '').length > 0 ? `m:${item.message_seq}` : `f:${item.id}`)
  for (const item of hits) {
    const key = groupKeyOf(item)
    groupScore.set(key, (groupScore.get(key) ?? 0) + (Number(item.score) || 0))
  }
  hits.sort((a, b) => {
    const delta = (groupScore.get(groupKeyOf(b)) ?? 0) - (groupScore.get(groupKeyOf(a)) ?? 0)
    return delta !== 0 ? delta : (Number(b.score) || 0) - (Number(a.score) || 0)
  })

  // 独立消息索引：直接检索历史消息，补上“还没被抽取成事实”的上下文。
  const messageHits = store.searchMessages(searchText, {
    limit: Math.max(1, Math.min(3, Math.floor(store.config.recallMaxItems / 2))),
    project,
    sessionId: session.id,
  }).filter((message) => {
    const id = `msg:${session.id}:${message.seq}`
    if (state.injected.has(id)) return false
    return (state.cooldown.get(id) ?? -1) < state.turn
  })
  if (hits.length === 0 && messageHits.length === 0) {
    store.logEvent('recall-miss', { sessionId: session.id, detail: text.slice(0, 100) })
    return
  }

  // 双预算：字符（展示用）+ token（安全阀，防止字符数低估中文）。
  const maxTokens = Number(store.config.recallMaxTokens) > 0 ? Number(store.config.recallMaxTokens) : Number.POSITIVE_INFINITY
  const fits = candidate => usedTokens + estimateInjectTokens(candidate) <= maxTokens
  const chosen = []
  let used = 0
  let usedTokens = 0
  const chosenMessageSeqs = new Set()
  for (const message of messageHits) {
    if (chosen.length >= store.config.recallMaxItems) break
    const index = sentenceIndexFor(text, message.text)
    const window = sentenceWindow(message.text, index, 360)
    if (window.length === 0) continue
    if (used + window.length > store.config.recallMaxChars) continue
    if (!fits(window)) continue
    chosen.push({
      id: `msg:${session.id}:${message.seq}`,
      message_id: `${message.session_id}#${message.seq}`,
      message_seq: message.seq,
      messageRowId: message.id,
      role: message.role,
      kind: 'message',
      scope: 'session',
      text: window,
      created_at: message.created_at,
      score: message.score,
      synthetic: true,
    })
    used += window.length
    usedTokens += estimateInjectTokens(window)
    chosenMessageSeqs.add(Number(message.seq))
  }
  for (const item of hits) {
    if (chosen.length >= store.config.recallMaxItems) break
    if (chosenMessageSeqs.has(Number(item.message_seq)) && String(item.message_id ?? '').length > 0) continue
    if (used + item.text.length > store.config.recallMaxChars) continue
    if (!fits(item.text)) continue
    chosen.push(item)
    used += item.text.length
    usedTokens += estimateInjectTokens(item.text)
  }
  if (chosen.length === 0) return

  // W2：预算允许时补一跳邻居（≤1 条，标记来源）。
  if (chosen.length < store.config.recallMaxItems) {
    try {
      const factIds = chosen.filter(item => typeof item.id === 'number').map(item => item.id)
      for (const item of store.expandNeighbors(factIds, { limit: 1, project })) {
        if (chosen.length >= store.config.recallMaxItems) break
        if (chosenMessageSeqs.has(Number(item.message_seq)) && String(item.message_id ?? '').length > 0) continue
        if (used + item.text.length > store.config.recallMaxChars) continue
        if (!fits(item.text)) continue
        item.via = 'neighbor'
        chosen.push(item)
        used += item.text.length
        usedTokens += estimateInjectTokens(item.text)
      }
    } catch { /* 邻居扩展失败不影响主召回 */ }
  }

  // P1：图谱 1-hop——共享实体的记忆最多补 2 条，预算内且标记来源。
  if (chosen.length < store.config.recallMaxItems) {
    try {
      const factIds = chosen.filter(item => typeof item.id === 'number').map(item => item.id)
      const already = new Set(chosen.map(item => item.id))
      for (const item of store.graphNeighbors(factIds, { limit: 2, project })) {
        if (chosen.length >= store.config.recallMaxItems) break
        if (already.has(item.id)) continue
        if (used + item.text.length > store.config.recallMaxChars) continue
        if (!fits(item.text)) continue
        item.via = 'graph'
        item.via_entities = item.via_entities
        chosen.push(item)
        used += item.text.length
        usedTokens += estimateInjectTokens(item.text)
      }
    } catch { /* 图谱扩展失败不影响主召回 */ }
  }

  if (agent === undefined) return
  if (Date.now() > deadline) {
    store.logEvent('recall-timeout', {
      sessionId: session.id,
      tokens: used,
      detail: `${Date.now() - startedAt}ms / 限 ${budgetMs}ms，${chosen.length} 条候选未注入`,
    })
    return
  }
  for (const item of chosen) {
    if (!String(item.message_id ?? '').length || typeof session.eventAt !== 'function') continue
    try {
      const event = session.eventAt(Number(item.message_seq))
      const text = messageText(event?.data?.content)
      if (text.length > 0) {
        item.sourceText = text
        const index = Number(item.sentence_no) >= 0 ? Number(item.sentence_no) : sentenceIndexFor(item.text, text)
        item.sourceWindow = sentenceWindow(text, index)
      }
    } catch { /* 原文读取失败时只带 seq，不影响召回 */ }
  }
  try {
    agent.inject(recallMessage(chosen, store.config))
    for (const item of chosen) {
      state.injected.add(item.id)
      state.cooldown.set(item.id, state.turn + store.config.recallCooldownTurns)
    }
    const factIds = chosen.filter(item => typeof item.id === 'number').map(item => item.id)
    const messageRowIds = chosen.filter(item => Number.isFinite(item.messageRowId)).map(item => item.messageRowId)
    store.touch(factIds)
    store.touchMessages(messageRowIds)
    store.logEvent('recall', {
      sessionId: session.id,
      memoryIds: factIds,
      tokens: used,
      detail: `${via}: ${text.slice(0, 100)} (${Date.now() - startedAt}ms; rw ${rewriteMs} em ${embedMs} se ${searchMs} rr ${rerankMs})`,
    })
    state.lastRecall = {
      at: nowSeconds(),
      via,
      ids: chosen.map(item => item.id),
      tokens: used,
      messages: new Set(chosen.filter(item => String(item.message_id ?? '').length > 0).map(item => item.message_seq)).size,
    }
  } catch (error) {
    ctx.logger?.warn?.(`context-hub: recall injection failed: ${String(error)}`)
  }
}

/** 解析模型给出的 JSON 记忆数组；容错到“能救多少救多少”。 */
function parseMemories(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  let parsed
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const out = []
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') continue
    const memoryText = typeof item.text === 'string' ? item.text.trim() : ''
    if (memoryText.length < 4) continue
    const tags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').slice(0, 5) : []
    out.push({ kind: typeof item.kind === 'string' ? item.kind : 'fact', text: memoryText, tags })
  }
  return out
}

/** 解析本轮使用的模型路由：已记录的下一步选择 → 最近请求头 → Agent 选项 → 最近一条助手消息。 */
function resolveRoute(agent, session) {
  const candidates = []
  try { candidates.push(agent?.model?.current?.()) } catch { /* 忽略 */ }
  try {
    const config = agent?.session?.requestHeader?.()?.config
    if (config !== undefined) candidates.push(config)
  } catch { /* 忽略 */ }
  candidates.push(agent?.options)
  for (const candidate of candidates) {
    if (candidate?.provider !== undefined && candidate?.model !== undefined) return candidate
  }
  const end = typeof session?.seq === 'number' ? session.seq : 0
  for (let seq = end - 1; seq >= 0; seq -= 1) {
    const event = session?.eventAt?.(seq)
    if (event?.type === 'assistant/message') {
      const source = event.data?.source
      if (source?.provider !== undefined && source?.model !== undefined) {
        return { provider: source.provider, model: source.model }
      }
    }
  }
  return undefined
}

/** 查询改写系统提示：只输出一行可拼接的检索词，不要解释。 */
const REWRITE_SYSTEM = [
  'You expand a search query for a long-term memory store used by a coding assistant.',
  'Output ONE line only: 6-12 alternative search terms separated by spaces.',
  'Include Chinese synonyms/paraphrases and English keywords for the same concept; keep exact identifiers, filenames, and config keys when present.',
  'No explanations, no punctuation other than spaces, no quotes.',
].join('\n')

/**
 * 用一次 LLM 调用把查询扩成同义词/英文关键词；失败或未启用时返回 null（调用方回退原查询）。
 * 结果按查询文本缓存在 store.rewriteCache，避免每步都调用模型。
 */
async function rewriteQuery(ctx, store, agent, session, text, deadline) {
  const config = store.config.rewrite
  if (config?.enabled !== true || typeof text !== 'string' || text.length === 0) return null
  if (text.trim().length < 8) return null
  const cached = store.rewriteCache.get(text)
  if (cached !== undefined) return cached
  const remaining = deadline === undefined ? config.timeoutMs : Math.min(config.timeoutMs, deadline - Date.now())
  if (remaining < 200) return null
  const llm = ctx.get('llm')
  if (llm === undefined) return null
  const route = { provider: config.provider, model: config.model }
  if (route.provider.length === 0 || route.model.length === 0) {
    const fallback = resolveRoute(agent, session)
    if (fallback === undefined) return null
    route.provider = fallback.provider
    route.model = fallback.model
  }
  let timer
  try {
    timer = AbortSignal.timeout(Math.max(200, remaining))
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: REWRITE_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: text.slice(0, 2000) }] }],
      maxTokens: config.maxTokens,
      signal: timer,
      purpose: 'context-hub:rewrite',
    })
    let out = ''
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') out += chunk.text ?? ''
      if (out.length > 800) break
    }
    let cleaned = out.replace(/[\r\n]+/g, ' ').replace(/^[-*\d.\s]+/, '').trim().slice(0, 240)
    // 推理型模型常把 maxTokens 全花在 reasoning-delta 上，正文被挤空：放大预算重试一次。
    if (cleaned.length === 0) {
      const retry = llm.stream({
        provider: route.provider,
        model: route.model,
        system: REWRITE_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: text.slice(0, 2000) }] }],
        maxTokens: Math.min(2000, Math.max(900, config.maxTokens * 2)),
        signal: AbortSignal.timeout(Math.max(200, deadline === undefined ? config.timeoutMs : deadline - Date.now())),
        purpose: 'context-hub:rewrite',
      })
      for await (const chunk of retry) {
        if (chunk?.type === 'text-delta') out += chunk.text ?? ''
        if (out.length > 800) break
      }
      cleaned = out.replace(/[\r\n]+/g, ' ').replace(/^[-*\d.\s]+/, '').trim().slice(0, 240)
      store.logEvent('rewrite-retry', { sessionId: session?.id ?? '', detail: `maxTokens ${Math.min(2000, Math.max(900, config.maxTokens * 2))}` })
    }
    if (cleaned.length === 0) {
      store.logEvent('rewrite-empty', { sessionId: session?.id ?? '', detail: `maxTokens ${config.maxTokens}` })
      return null
    }
    if (store.rewriteCache.size >= config.cacheSize) store.rewriteCache.clear()
    store.rewriteCache.set(text, cleaned)
    store.logEvent('rewrite', { sessionId: session?.id ?? '', detail: cleaned.slice(0, 120) })
    return cleaned
  } catch (error) {
    store.logEvent('rewrite-error', { sessionId: session?.id ?? '', detail: String(error).slice(0, 160) })
    return null
  } finally {
  }
}

const RERANK_SYSTEM = [
  'You rank candidate memories by relevance to the user query.',
  'Return ONLY a JSON array of candidate numbers (1-based), most relevant first, at most 10 numbers.',
  'Include only numbers that appear in the candidate list; no explanations, no prose.',
].join('\n')

/**
 * 可选的 LLM 重排：对 rank() 已选出的前 N 条候选重新排序。
 * 失败/超时/空输出都返回原顺序（只记事件，不阻塞召回）。
 */
async function rerankHits(ctx, store, session, query, hits, agent, deadline) {
  const config = store.config.rerank
  if (config?.enabled !== true || hits.length <= 1 || typeof query !== 'string' || query.length === 0) return hits
  const llm = ctx.get('llm')
  if (llm === undefined) return hits
  const remaining = deadline === undefined ? config.timeoutMs : Math.min(config.timeoutMs, deadline - Date.now())
  if (remaining < 600) return hits
  const candidates = hits.slice(0, Math.min(config.candidates, hits.length))
  const route = { provider: config.provider, model: config.model }
  if (route.provider.length === 0 || route.model.length === 0) {
    const fallback = resolveRoute(agent, session)
    if (fallback === undefined) return hits
    route.provider = fallback.provider
    route.model = fallback.model
  }
  const topScore = Number(hits[0].score) || 0
  const secondScore = Number(hits[1].score) || 0
  if (topScore >= 4 && topScore >= secondScore * 1.25) return hits
  const listing = candidates.map((item, index) => `${index + 1}) ${item.text}`).join('\n')
  const startedAt = Date.now()
  const ask = async (budget) => {
    const left = deadline === undefined ? config.timeoutMs : deadline - Date.now()
    if (left < 400) return ''
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: RERANK_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: `Query: ${query.slice(0, 600)}\nCandidates:\n${listing}` }] }],
      maxTokens: budget,
      ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
      signal: AbortSignal.timeout(Math.max(300, Math.min(left, remaining))),
      purpose: 'context-hub:rerank',
    })
    let out = ''
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') out += chunk.text ?? ''
      if (out.length > 400) break
    }
    return out
  }
  try {
    let out = await ask(config.maxTokens)
    let match = out.match(/\[[\d,\s]+\]/)
    if (match === null) {
      const left = deadline === undefined ? config.timeoutMs : deadline - Date.now()
      if (left > 900) {
        store.logEvent('rerank-retry', { sessionId: session?.id ?? '', detail: `${left}ms left` })
        out = await ask(Math.min(1600, Math.max(900, config.maxTokens * 2)))
        match = out.match(/\[[\d,\s]+\]/)
      }
    }
    if (match === null) {
      store.logEvent('rerank-empty', { sessionId: session?.id ?? '', detail: out.slice(0, 80) })
      return hits
    }
    const order = JSON.parse(match[0]).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length)
    if (order.length === 0) {
      store.logEvent('rerank-empty', { sessionId: session?.id ?? '', detail: match[0].slice(0, 80) })
      return hits
    }
    const ranked = []
    const seen = new Set()
    for (const n of order) {
      if (seen.has(n)) continue
      seen.add(n)
      ranked.push(candidates[n - 1])
    }
    for (let i = 0; i < candidates.length; i += 1) if (!seen.has(i + 1)) ranked.push(candidates[i])
    for (let i = candidates.length; i < hits.length; i += 1) ranked.push(hits[i])
    store.logEvent('rerank', { sessionId: session?.id ?? '', detail: `${Date.now() - startedAt}ms #${ranked.map(item => item.id).join(' > #')}` })
    return ranked
  } catch (error) {
    store.logEvent('rerank-error', { sessionId: session?.id ?? '', detail: String(error).slice(0, 160) })
    return hits
  }
}

/** 当前 surface 的位置序列（含 system? 不含；SessionSurface.nodes 即模型可见顺序）。 */
function surfaceSeqs(session) {
  try {
    const nodes = session?.surface?.nodes
    return Array.isArray(nodes) ? nodes.slice() : []
  } catch {
    return []
  }
}

/** 估算某条 surface 事件的文本 tokens；没有正文时按最小步长计。 */
function estimateSeqTokens(session, seq) {
  try {
    const event = session?.eventAt?.(seq)
    const text = messageText(event?.data?.content ?? [])
    return Math.max(16, Math.ceil(text.length / 3.5))
  } catch {
    return 16
  }
}

/**
 * 水位压缩：压力达到 triggerRatio 时，自己选「保留尾部 retainTokens」的区间，
 * 调 compaction.compactRegion（原生负责校验配对/回放/摘要）。失败只记录，不阻塞。
 */
async function maybeWatermark(ctx, store, agent, signal) {
  const config = store.config.watermark
  if (config?.enabled !== true || agent?.session === undefined) return
  const meter = ctx.get('tokenMeter')
  const compaction = ctx.get('compaction')
  if (meter === undefined || compaction === undefined) return
  if (typeof compaction.compactRegion !== 'function') return
  const session = agent.session
  const pressure = meter.contextPressure(session)
  const window = Number(pressure?.contextWindow ?? 0)
  if (window <= 0) return
  const ratio = Number(pressure.pressureTokens ?? 0) / window
  if (ratio < config.triggerRatio) return
  const state = stateOf(session)
  if (state.lastWatermarkTurn !== undefined && state.turn - state.lastWatermarkTurn < config.cooldownTurns) return
  const seqs = surfaceSeqs(session)
  if (seqs.length < config.minRegionNodes + 2) return
  const start = seqs[0]
  let end
  if (config.retainTurns > 0) {
    // 对标“保留 N 轮 + 折叠”：只折叠最后 N 个用户回合之前的最旧前缀。
    const userSeqs = []
    for (const seq of seqs) {
      const event = session.eventAt?.(seq)
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') userSeqs.push(seq)
    }
    if (userSeqs.length > config.retainTurns) {
      const keepFrom = userSeqs[userSeqs.length - config.retainTurns]
      const before = seqs.filter(seq => seq < keepFrom)
      if (before.length < config.minRegionNodes) return
      end = before[before.length - 1]
    }
  }
  if (end === undefined) {
    let retained = 0
    let cut = seqs.length
    for (let i = seqs.length - 1; i >= 0; i -= 1) {
      retained += estimateSeqTokens(session, seqs[i])
      cut = i
      if (retained >= config.retainTokens) break
    }
    end = seqs[Math.max(0, cut - 1)]
  }
  if (start === undefined || end === undefined || start >= end) return
  state.lastWatermarkTurn = state.turn
  try {
    const result = await compaction.compactRegion(start, end, agent, signal)
    const retainLabel = config.retainTurns > 0 ? `${config.retainTurns} 轮` : `${config.retainTokens} tokens`
    store.logEvent('watermark', {
      sessionId: session.id,
      tokens: Number(result?.shadowedTokenCount ?? 0),
      detail: `seq ${result?.shadowedRange?.start ?? start}-${result?.shadowedRange?.end ?? end}（保留 ${retainLabel}；仅折叠最旧前缀）`,
    })
    ctx.logger?.info?.(`context-hub: watermark compacted ${result?.shadowedSeqs?.length ?? 0} nodes at ${Math.round(ratio * 100)}%`)
  } catch (error) {
    store.logEvent('watermark-error', { sessionId: session.id, detail: String(error).slice(0, 200) })
    ctx.logger?.warn?.(`context-hub: watermark compaction skipped (${String(error).slice(0, 120)})`)
  }
}

/** 注册 pre-step 水位监听；默认关闭，配置 watermark.enabled 才挂。 */
function installWatermark(ctx, store) {
  if (store.watermarkInstalled === true) return store.watermarkDispose
  store.watermarkInstalled = true
  store.watermarkDispose = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (signal?.aborted !== true) {
      try {
        await maybeWatermark(ctx, store, agent, signal)
      } catch (error) {
        ctx.logger?.warn?.(`context-hub: watermark failed: ${String(error)}`)
      }
    }
    return next()
  }, { prepend: true, global: true })
  return store.watermarkDispose
}

/**
 * 水位开关：运行时开/关，并把状态持久化到 kv（下次启动沿用）。
 * 持久化只影响本插件的 watermark，不写 profile 配置文件。
 */
function setWatermark(ctx, store, enabled) {
  const on = enabled === true
  store.config.watermark.enabled = on
  if (on) installWatermark(ctx, store)
  else if (typeof store.watermarkDispose === 'function') {
    store.watermarkDispose()
    store.watermarkDispose = undefined
    store.watermarkInstalled = false
  }
  if (store.db !== undefined) {
    store.setKv('watermark.enabled', on ? '1' : '0')
    store.logEvent('watermark-toggle', { detail: on ? 'on' : 'off' })
  }
  return on
}

/** 当前生效的接管分级；auto 时按 compactor/watermark 反推。 */
function modeOf(store) {
  const mode = store.config.mode
  if (mode !== undefined && mode !== 'auto') return mode
  if (store.config.watermark.enabled === true) return store.compactorActive === true ? 'full' : 'takeover'
  return store.compactorActive === true ? 'assist' : 'observe'
}

/** 切换接管分级：observe/assist/takeover/full，并持久化到 kv。只影响本插件。 */
function setCompactionMode(ctx, store, mode) {
  if (!['observe', 'assist', 'takeover', 'full'].includes(mode)) return undefined
  store.config.mode = mode
  const wantHub = mode === 'assist' || mode === 'full'
  const wantWatermark = mode === 'takeover' || mode === 'full'
  if (wantWatermark && store.config.watermark.retainTurns === 0 && store.config.watermark.retainTokens === defaults.watermark.retainTokens) store.config.watermark.retainTurns = 5
  if (wantHub) installHubCompactor(ctx, store)
  else store.compactorUninstall?.()
  setWatermark(ctx, store, wantWatermark)
  if (store.db !== undefined) {
    store.setKv('compaction.mode', mode)
    store.logEvent('mode', { detail: mode })
  }
  return mode
}

/** 收集游标之后的新对话文本；没有新内容时返回 undefined。 */
function newConversation(session, fromSeq) {
  const end = typeof session.seq === 'number' ? session.seq : 0
  const pieces = []
  const messages = []
  let consumed = fromSeq - 1
  let chars = 0
  for (let seq = fromSeq; seq < end; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      if (event.data?.source?.kind === 'context-hub') continue
      const text = messageText(event.data?.content)
      if (text.length > 0) {
        if (chars >= EXTRACT_MAX_INPUT) break
        const room = EXTRACT_MAX_INPUT - chars
        const body = text.length > room ? text.slice(0, room) : text
        const role = event.type === 'user/message' ? 'user' : 'assistant'
        pieces.push(`${role === 'user' ? 'User' : 'Assistant'}: ${body}`)
        messages.push({ seq, role, text: body })
        chars += body.length
        consumed = seq
      }
    }
  }
  if (pieces.length === 0) return undefined
  return { text: pieces.join('\n\n'), end: consumed + 1, messages }
}

/** B5: 构建查询卫生的用户消息文本——排除注入块、工具结果、其他插件消息。 */
function sanitizeQueryText(session, lastUserSeq) {
  const pieces = []
  const end = typeof session.seq === 'number' ? session.seq : 0
  for (let seq = lastUserSeq; seq < end; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    // 只取真人用户消息
    if (event.type !== 'user/message') continue
    // 排除插件注入
    if (event.data?.source?.kind === 'context-hub') continue
    // 排除工具调用结果
    if (event.data?.source?.form === 'tool_use' || event.data?.source?.form === 'tool_result') continue
    const text = messageText(event.data?.content)
    if (text.length > 0) {
      pieces.push(text)
    }
  }
  return pieces.join('\n').slice(0, 2000)
}

/** 从抽取结果回指到最可能的原始消息（共享词元最多的一条）。 */
function bestMessageForMemory(text, messages) {
  const target = tokens(text)
  if (target.size === 0) return undefined
  let best
  let bestScore = 0
  for (const message of messages) {
    const source = tokens(message.text)
    let overlap = 0
    for (const token of target) if (source.has(token)) overlap += 1
    const score = overlap / target.size
    if (score > bestScore) {
      bestScore = score
      best = message
    }
  }
  return best
}

/** 在一段原文里取命中句的前后各一句，控制预算。 */
function sentenceWindow(text, index, maxChars = 320) {
  const source = String(text ?? '')
  const sentences = source.split(/(?<=[。！？.!?\n])/).map(item => item.trim()).filter(Boolean)
  if (sentences.length === 0) return source.slice(0, maxChars)
  const center = index >= 0 ? index : 0
  const from = Math.max(0, center - 1)
  const to = Math.min(sentences.length, center + 2)
  return sentences.slice(from, to).join(' ').slice(0, maxChars)
}

/** 在原文里定位最相关的一句，供 audit/explain 回指；找不到时返回 -1。 */
function sentenceIndexFor(text, source) {
  const sentences = String(source).split(/(?<=[。！？.!?\n])/).map(item => item.trim()).filter(Boolean)
  if (sentences.length === 0) return -1
  const target = tokens(text)
  if (target.size === 0) return -1
  let best = -1
  let bestScore = 0
  sentences.forEach((sentence, index) => {
    const sourceTokens = tokens(sentence)
    let overlap = 0
    for (const token of target) if (sourceTokens.has(token)) overlap += 1
    const score = overlap / target.size
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })
  return best
}

/** A3: 检测否定翻转（"不要/不再/取消/停止" 等否定词）。 */
function isNegation(text) {
  const negationPatterns = [
    /(?:不要|别|不再|无须|不必|无需|取消|停止|废弃|删除|移除|禁用|不再使用)/i,
  ]
  return negationPatterns.some(p => p.test(text))
}

/** A3: 检测数值变更（版本号、阈值、配置值）。 */
function extractNumericValue(text) {
  // 匹配版本号、数字、百分比、布尔值
  const patterns = [
    /v?(\d+\.\d+(?:\.\d+)?)/,  // 版本号
    /(\d+(?:\.\d+)?)(%?\s*(?:个 | 条 | 次 | 秒 | 毫秒 | 天 | 周 | 月 | 年)?)/,  // 数字 + 单位
    /(?:true|false|是 | 否 | 开 | 关 | 启用 | 禁用)/i,  // 布尔
  ]
  const values = []
  for (const p of patterns) {
    const matches = text.match(p)
    if (matches) values.push(matches[0])
  }
  return values
}

/** A3: 检测状态迁移（open→closed, pending→done 等）。 */
function extractStatusChange(text) {
  const statusPatterns = [
    { from: /(?:打开 | 开启 | 启动 | 创建 | 新增 | 开始)/i, to: 'active' },
    { from: /(?:关闭 | 停止 | 结束 | 完成 | 做完 | 搞定)/i, to: 'closed' },
    { from: /(?:待办 | 待处理 | 进行中)/i, to: 'pending' },
    { from: /(?:完成 | 已解决 | 已修复 | 搞定)/i, to: 'done' },
  ]
  for (const { from, to } of statusPatterns) {
    if (from.test(text)) return to
  }
  return null
}

/** A3: 增强冲突判定——检测否定翻转、数值变更、状态迁移。 */
function classifyConflict(newText, oldText) {
  const newNegation = isNegation(newText)
  const oldNegation = isNegation(oldText)
  
  // 否定翻转：新记忆否定旧记忆
  if (newNegation && !oldNegation) return 'negation-flip'
  if (!newNegation && oldNegation) return 'negation-flip-reverse'
  
  // 数值变更
  const newValues = extractNumericValue(newText)
  const oldValues = extractNumericValue(oldText)
  if (newValues.length > 0 && oldValues.length > 0) {
    if (JSON.stringify(newValues) !== JSON.stringify(oldValues)) {
      return 'numeric-change'
    }
  }
  
  // 状态迁移
  const newStatus = extractStatusChange(newText)
  const oldStatus = extractStatusChange(oldText)
  if (newStatus && oldStatus && newStatus !== oldStatus) {
    return 'status-migration'
  }
  
  return 'standard'
}
async function extractMemories(ctx, store, session) {
  const config = store.config
  const state = stateOf(session)
  if (state.extracting) return
  const llm = ctx.get('llm')
  const agent = ctx.get('agents')?.get(session.id)
  const route = resolveRoute(agent, session)
  if (llm === undefined || route === undefined) return

  state.extracting = true
  try {
    // 插件重载后从库里的游标续接，避免反复重抽整段历史；旧库没有 kv 时回退到最后一条 extract 事件。
    if (state.extractedSeq === 0) {
      const persisted = Number(store.getKv(`extract:${session.id}`))
      if (Number.isFinite(persisted) && persisted > 0) state.extractedSeq = persisted
      else {
        const inferred = store.latestExtractEnd(session.id)
        if (inferred !== undefined) state.extractedSeq = inferred
      }
    }
    let passes = 0
    while (passes < config.extractPassesPerTurn) {
      const slice = newConversation(session, state.extractedSeq)
      if (slice === undefined) break
      if (slice.text.length < 80) {
        state.extractedSeq = slice.end
        break
      }

      // A1: 确定性优先的写入——先检查显式信号，零 LLM 直接写
      const explicitMemories = extractExplicitMemories(slice.messages)
      const explicitWritten = []
      for (const mem of explicitMemories) {
        const sourceMessage = slice.messages.find(m => m.seq === mem.messageSeq)
        const result = store.insert({
          kind: mem.kind,
          text: mem.text,
          tags: mem.tags || [],
          project: projectOf(session, store),
          sessionId: session.id,
          scope: scopeForKind(mem.kind),
          source: 'explicit',
          confidence: 1.0,
          evidence: `${state.extractedSeq}-${slice.end - 1}`,
          messageId: sourceMessage === undefined ? '' : `${session.id}#${sourceMessage.seq}`,
          messageSeq: sourceMessage?.seq ?? 0,
          sentenceNo: sourceMessage === undefined ? -1 : sentenceIndexFor(mem.text, sourceMessage?.text || ''),
        })
        if (result.action === 'inserted') explicitWritten.push(result.id)
      }
      if (explicitWritten.length > 0) {
        store.logEvent('explicit-remember', { sessionId: session.id, memoryIds: explicitWritten, detail: `seq ${state.extractedSeq}-${slice.end - 1}` })
      }

      // 剩余内容才走 LLM 抽取
      const llmText = slice.text
      let output = ''
      const stream = llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${EXTRACT_PROMPT}\n\n---\n${llmText}` }] }],
        maxTokens: 600,
        sessionId: session.id,
        purpose: 'context-hub:extract',
        signal: AbortSignal.timeout(config.extractTimeoutMs),
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
      }
      const evidence = `${state.extractedSeq}-${slice.end - 1}`
      const written = []
      for (const memory of parseMemories(output)) {
        const kind = KIND_VALUES.includes(memory.kind) ? memory.kind : 'fact'
        const sourceMessage = bestMessageForMemory(memory.text, slice.messages ?? [])
        const result = store.insert({
          ...memory,
          kind,
          project: projectOf(session, store),
          sessionId: session.id,
          scope: scopeForKind(kind),
          source: 'extracted',
          evidence,
          messageId: sourceMessage === undefined ? '' : `${session.id}#${sourceMessage.seq}`,
          messageSeq: sourceMessage?.seq ?? 0,
          sentenceNo: sourceMessage === undefined ? -1 : sentenceIndexFor(memory.text, sourceMessage.text),
        })
        if (result.action === 'inserted') written.push(result.id)
      }
      store.logEvent('extract', { sessionId: session.id, memoryIds: [...explicitWritten, ...written], detail: `seq ${evidence}` })
      state.extractedSeq = slice.end
      store.setKv(`extract:${session.id}`, state.extractedSeq)
      passes += 1
      if (passes >= config.extractPassesPerTurn) break
      // 还有剩余预算时，只有出现新消息才继续；否则下一轮再抽取。
      if (newConversation(session, state.extractedSeq) === undefined) break
    }
    state.extractPasses = passes
  } catch (error) {
    ctx.logger?.warn?.(`context-hub: memory extraction failed: ${String(error)}`)
  } finally {
    state.extracting = false
  }
}

/** A1: 从消息中检测显式信号（记住/以后/不要/偏好/约定），零 LLM 直接写入。 */
function extractExplicitMemories(messages) {
  const memories = []
  const explicitPatterns = [
    // 记住/保存/以后
    { pattern: /(?:记住|保存|以后|别忘了|务必|请记住)[:：\s,，]+(.{10,100})/i, kind: 'fact' },
    // 不要/禁止/避免
    { pattern: /(?:不要|别|禁止|避免|切勿|不准)[:：\s,，]+(.{10,100})/i, kind: 'preference' },
    // 偏好/喜欢/习惯
    { pattern: /(?:偏好|喜欢|习惯|通常|一般|总是)[:：\s,，]+(.{10,100})/i, kind: 'preference' },
    // 约定/决定/约定
    { pattern: /(?:约定|决定|确认|确定|达成共识)[:：\s,，]+(.{10,100})/i, kind: 'decision' },
    // 待办/任务/需要
    { pattern: /(?:待办|任务|需要|必须|应该|要|得)[:：\s,，]+(.{10,100})/i, kind: 'task' },
  ]
  
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    for (const { pattern, kind } of explicitPatterns) {
      const match = msg.text.match(pattern)
      if (match && match[1]) {
        const text = match[1].trim().slice(0, 200)
        if (text.length >= 10) {
          memories.push({
            kind,
            text,
            tags: [kind],
            messageSeq: msg.seq,
          })
        }
      }
    }
  }
  return memories
}

/** 把 surface 节点按事件类型归类，用于上下文构成观测。 */
/** W3：把原生压缩摘要落成可检索的 session 记忆（source=compaction 绕过准入门槛）。 */
async function recordCompactionSummary(ctx, store, session, event) {
  try {
    const data = event.data ?? {}
    const blocks = Array.isArray(data.summary) ? data.summary : []
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (text.length < 40) return
    const range = data.shadowedRange ?? {}
    const start = Number.isFinite(range.start) ? range.start : 0
    const end = Number.isFinite(range.end) ? range.end : 0
    const result = store.insert({
      kind: 'summary',
      text: `[压缩摘要 seq ${start}-${end}] ${text.slice(0, 4000)}`,
      project: projectOf(session, store),
      sessionId: session.id,
      scope: 'session',
      source: 'compaction',
      confidence: 0.95,
      evidence: `${start}-${end}`,
    })
    if (result.action === 'inserted') {
      store.recordLedger({
        compactionId: String(data.compactionId ?? `seq-${start}-${end}`),
        sessionId: session.id,
        start,
        end,
        shadowedTokens: Number(data.shadowedTokenCount) || 0,
        summaryChars: text.length,
      })
      store.logEvent('summary', {
        sessionId: session.id,
        memoryIds: [result.id],
        tokens: Number(data.shadowedTokenCount) || 0,
        detail: `seq ${start}-${end}`,
      })
    }
  } catch (error) {
    ctx.logger?.warn?.(`context-hub: summary capture failed: ${String(error)}`)
  }
}

/** 估算一次主请求的字符数与 token（不阻塞、不抛错）。 */
function estimateRequestTokens(options) {
  let chars = typeof options?.system === 'string' ? options.system.length : 0
  for (const message of Array.isArray(options?.messages) ? options.messages : []) {
    chars += messageText(message?.content).length
  }
  for (const tool of Array.isArray(options?.tools) ? options.tools : []) {
    try { chars += JSON.stringify(tool).length } catch { /* 不可序列化的工具描述跳过 */ }
  }
  return { chars, estTokens: Math.ceil(chars / 3.5) }
}

/** W4：逐请求观测，跳过插件自身的辅助调用与原生压缩。 */
function sampleRequest(ctx, store, options) {
  try {
    const purpose = typeof options?.purpose === 'string' ? options.purpose : ''
    if (purpose.startsWith('context-hub:') || purpose === 'compaction') return
    const { chars, estTokens } = estimateRequestTokens(options)
    let surfaceTokens = 0
    let totalTokens = 0
    let injected = 0
    let lanes
    const usage = options?.usage ?? options?.metadata?.usage
    const usageDetail = usage === undefined ? undefined : {
      input: Number(usage.inputTokens ?? usage.promptTokens ?? usage.input ?? 0) || 0,
      output: Number(usage.outputTokens ?? usage.completionTokens ?? usage.output ?? 0) || 0,
      cacheRead: Number(usage.cacheReadTokens ?? usage.cache_read_tokens ?? 0) || 0,
      cacheWrite: Number(usage.cacheWriteTokens ?? usage.cache_write_tokens ?? 0) || 0,
    }
    try {
      const meter = ctx.get('tokenMeter')
      const sessions = ctx.get('sessions')
      const sessionId = options?.sessionId
      const session = sessionId === undefined ? undefined : sessions?.get?.(sessionId)
      if (meter !== undefined && session !== undefined) {
        const measurement = meter.measure(session)
        surfaceTokens = Number(measurement.surfaceTokens) || 0
        totalTokens = Number(measurement.totalTokens) || 0
        injected = surfaceBreakdown(session, measurement).injected
      }
      if (session !== undefined) lanes = stateOf(session).lastRecall
    } catch { /* 测量失败不阻塞请求 */ }
    store.logEvent('request', {
      detail: JSON.stringify({
        purpose: purpose || 'chat',
        provider: options?.provider ?? '',
        model: options?.model ?? '',
        messages: Array.isArray(options?.messages) ? options.messages.length : 0,
        tools: Array.isArray(options?.tools) ? options.tools.length : 0,
        chars,
        estTokens,
        surfaceTokens,
        totalTokens,
        injected,
        outputReserve: Math.max(0, totalTokens - surfaceTokens),
        ...(usageDetail === undefined ? {} : { usage: usageDetail }),
        ...(lanes === undefined ? {} : { lanes }),
      }),
    })
  } catch (error) {
    ctx.logger?.warn?.(`context-hub: request sampling failed: ${String(error)}`)
  }
}

function surfaceBreakdown(session, measurement) {
  const parts = { user: 0, assistant: 0, tool: 0, injected: 0, summary: 0, other: 0 }
  for (const node of measurement.nodes ?? []) {
    const event = session.eventAt(node.seq)
    const type = event?.type
    const sourceKind = event?.data?.source?.kind
    const tokens = Number(node.tokens) || 0
    if (type === 'user/message') {
      if (sourceKind === 'context-hub') parts.injected += tokens
      else if (typeof sourceKind === 'string' && sourceKind.includes('compaction')) parts.summary += tokens
      else parts.user += tokens
    } else if (type === 'assistant/message') parts.assistant += tokens
    else if (type === 'tool/result' || type === 'tool/call') parts.tool += tokens
    else parts.other += tokens
  }
  return parts
}

/** 召回调试文本：候选、打分明细、预算与跳过原因；命令与工具共用。 */
async function recallExplainText(ctx, store, session, query, rewritten = null) {
  const config = store.config
  const searchText = rewritten === null ? query : `${query} ${rewritten}`
  const embVec = await store.embedQuery(searchText)
  let hits = store.explain(searchText, { project: session === undefined ? '' : projectOf(session, store), sessionId: session?.id ?? '', embVec })
  let messageHits = []
  if (session !== undefined) {
    try { store.indexSession(session, session.seq) } catch { /* 索引失败不阻塞 explain */ }
    try {
      messageHits = store.searchMessages(searchText, {
        limit: 5,
        project: projectOf(session, store),
        sessionId: session.id,
      })
    } catch { /* 消息检索失败不阻塞 explain */ }
  }
  const messageRows = messageHits.map((message) => {
    const index = sentenceIndexFor(query, message.text)
    const window = sentenceWindow(message.text, index, 220)
    return `- 消息 seq ${message.seq} [${message.role}] 分 ${message.score.toFixed(3)}（词元 ${message.parts?.overlap ?? 0}，FTS ${message.parts?.fts ?? 0}） ${window}`
  })
  if (hits.length === 0 && messageHits.length === 0) return `没有候选：没有任何记忆或消息与「${query}」共享词元。`
  let rerankNote = ''
  if (store.config.rerank.enabled === true && hits.length > 1) {
    const original = hits.map(item => item.id)
    hits = await rerankHits(ctx, store, session, searchText, hits, ctx.get('agents')?.get(session?.id))
    const after = hits.map(item => item.id)
    rerankNote = original.join(',') === after.join(',')
      ? `重排：候选 ${original.length} 条，未改变顺序（模型空输出或原序即最优）\n`
      : `重排：候选 ${original.length} 条，LLM 顺序 ${after.join(' > ')}\n`
  }
  const state = session === undefined ? undefined : stateOf(session)
  const chosen = []
  let used = 0
  const rows = hits.map((item) => {
    const p = item.parts
    const vectorNote = p.emb !== undefined ? `，向量 +${p.emb.toFixed(2)}` : (p.cos !== undefined ? `，cos ${p.cos}` : '')
    const fts = `${p.fts === undefined ? '' : `，FTS 第 ${p.fts} 位`}${vectorNote}`
    const detail = p.rrf === undefined
      ? `基础 ${p.base.toFixed(2)} × 权重 ${p.weight} × 衰减 ${p.decay.toFixed(2)} + 使用 ${p.usage.toFixed(2)}`
      : `RRF lex ${p.lexicalRank ?? '—'} / vec ${p.vectorRank ?? '—'}（rrf ${p.rrf}）× 权重 ${p.weight} × 衰减 ${p.decay.toFixed(2)} + 使用 ${p.usage.toFixed(2)}`
    const head = `#${item.id} ${item.kind}/${item.scope} 分 ${item.score.toFixed(3)}（词元 ${p.overlap}，覆盖率 ${p.ratio.toFixed(2)}${fts}，${detail}）${item.message_id ? ` 消息 seq ${item.message_seq}${Number(item.sentence_no) >= 0 ? ` 句 ${item.sentence_no}` : ''}` : (item.evidence_seq ? ` 证据 seq ${item.evidence_seq}` : '')}`
    let reason
    if (item.status !== 'active') reason = `跳过（${item.status}）`
    else if (state !== undefined && state.injected.has(item.id)) reason = '跳过（本会话已注入）'
    else if (state !== undefined && (state.cooldown.get(item.id) ?? 0) > state.turn) reason = '跳过（冷却中）'
    else if (chosen.length >= config.recallMaxItems) reason = '跳过（超出条数预算）'
    else if (used + item.text.length > config.recallMaxChars) reason = '跳过（超出字符预算）'
    else {
      reason = '入选'
      chosen.push(item.id)
      used += item.text.length
    }
    return `- ${head}\n  ${reason}`
  })
  if (chosen.length > 0) {
    const project = session === undefined ? '' : projectOf(session, store)
    for (const item of store.expandNeighbors(chosen.slice(0, 2), { limit: 1, project })) {
      if (chosen.includes(item.id)) continue
      const full = chosen.length >= config.recallMaxItems || used + item.text.length > config.recallMaxChars
      rows.push(`- #${item.id} ${item.kind}/${item.scope} 邻居扩展（权 ${Number(item.link_weight).toFixed(2)}，来源 #${chosen[0]}）\n  ${full ? '跳过（预算已满）' : '入选（邻居扩展）'}`)
    }
    for (const item of store.graphNeighbors(chosen.slice(0, 3), { limit: 2, project })) {
      if (chosen.includes(item.id)) continue
      const full = chosen.length >= config.recallMaxItems || used + item.text.length > config.recallMaxChars
      rows.push(`- #${item.id} ${item.kind}/${item.scope} 图谱扩展（共享实体 ${item.via_entities}）\n  ${full ? '跳过（预算已满）' : '入选（图谱扩展）'}`)
    }
  }
  return [
    `召回调试：「${query}」记忆候选 ${hits.length} 条 / 消息候选 ${messageHits.length} 条（预算 ${config.recallMaxItems} 条/${config.recallMaxChars} 字符）${rewritten === null ? '' : `\n改写：${rewritten}`}`,
    ...(rerankNote === '' ? [] : [rerankNote.trimEnd()]),
    ...(messageRows.length === 0 ? [] : ['消息候选：', ...messageRows]),
    ...rows,
  ].join('\n')
}

/** 洞察摘要：上下文压力 + 折叠区间 + 记忆库构成。 */
function statusText(ctx, store, session) {
  const lines = []
  const config = store.config
  const meter = ctx.get('tokenMeter')
  let measuredTokens = 0
  if (meter !== undefined && session !== undefined) {
    try {
      const measurement = meter.measure(session)
      measuredTokens = Number(measurement.totalTokens) || 0
      lines.push(`上下文：surface ${measurement.surfaceTokens} tokens / 合计 ${measurement.totalTokens} tokens（${measurement.nodes?.length ?? 0} 个节点）`)
      const parts = surfaceBreakdown(session, measurement)
      lines.push(`构成：用户 ${parts.user} / 助手 ${parts.assistant} / 工具 ${parts.tool} / 注入 ${parts.injected} / 摘要 ${parts.summary} / 其他 ${parts.other}；输出预留 ${Math.max(0, Number(measurement.totalTokens) - Number(measurement.surfaceTokens))} tokens（system/tools 未单独拆分）`)
      const pressure = meter.contextPressure(session)
      if (pressure.pressureTokens !== undefined) {
        lines.push(`压力：${pressure.pressureTokens}${pressure.contextWindow === undefined ? '' : ` / 窗口 ${pressure.contextWindow}`}`)
        if (Number(pressure.contextWindow) > 0) {
          const ratio = Number(pressure.pressureTokens) / Number(pressure.contextWindow)
          lines.push(`水位：${(ratio * 100).toFixed(0)}%（参考 70% 触发 / 60% 目标；实际阈值由 profile 的 compaction-basic 配置决定）${ratio >= 0.7 ? '，建议压缩' : ''}`)
        }
      }
    } catch { /* 测量失败不阻塞状态报告 */ }
  }
  if (session !== undefined) {
    const folded = foldedStats(session)
    const ratio = folded.tokens > 0 && measuredTokens > 0
      ? `，压缩比 ${(folded.tokens / (folded.tokens + measuredTokens)).toFixed(2)}`
      : ''
    lines.push(`压缩：已折叠 ${folded.count} 个区间（约 ${folded.tokens} tokens${ratio}）；事件 ${session.seq} 条（history 工具可检索折叠区）`)
  }
  const lastSummary = store.recentEvents(20).find(event => event.kind === 'summary')
  if (lastSummary !== undefined) {
    lines.push(`最近压缩：seq ${lastSummary.detail}（摘要已作为记忆 #${lastSummary.memory_ids || lastSummary.memoryIds} 入库，可用 search 检索）`)
  }
  const lastProbe = store.recentEvents(20).find(event => event.kind === 'probe')
  if (lastProbe !== undefined) {
    try {
      const report = JSON.parse(lastProbe.detail)
      lines.push(`探针：最近 ${report.hits}/${report.total} 命中${report.rate === undefined ? '' : `（${Math.round(Number(report.rate) * 100)}%）`}`)
    } catch { /* 旧事件格式忽略 */ }
  }
  const lastWatermark = store.recentEvents(30).find(event => event.kind === 'watermark')
  if (lastWatermark !== undefined) {
    lines.push(`水位压缩：最近 seq ${lastWatermark.detail}（约 ${lastWatermark.tokens} tokens）`)
  }
  const ledger = store.ledgerStats(session === undefined ? '' : session.id)
  if (ledger.count > 0) {
    lines.push(`压缩账本：${ledger.count} 次折叠，累计省 ${ledger.saved} tokens，复问率 ${(ledger.rate * 100).toFixed(0)}%${ledger.last ? `（最近 seq ${ledger.last.start_seq}-${ledger.last.end_seq}）` : ''}`)
  }
  const graph = store.graphStats()
  if (graph.entities > 0) {
    lines.push(`图谱：${graph.entities} 个实体 / ${graph.links} 条实体链接（召回时 1-hop 补 ≤2 条）`)
  }
  if (session !== undefined) {
    const activeUnfolds = [...stateOf(session).unfolds.values()]
    if (activeUnfolds.length > 0) {
      lines.push(`展开：${activeUnfolds.map(entry => `seq ${entry.start}-${entry.end - 1}（剩 ${entry.remaining} 步）`).join('，')}`)
    }
  }
  const rows = store.counts()
  const byStatus = { active: 0, superseded: 0, archived: 0, pending: 0 }
  const byScope = { session: 0, project: 0, global: 0 }
  const byKind = {}
  for (const row of rows) {
    const n = Number(row.n)
    if (row.status === 'active') {
      byScope[row.scope] = (byScope[row.scope] ?? 0) + n
      byKind[row.kind] = (byKind[row.kind] ?? 0) + n
    }
    byStatus[row.status] = (byStatus[row.status] ?? 0) + n
  }
  const kinds = Object.entries(byKind).map(([kind, n]) => `${kind} ${n}`).join('，')
  lines.push(
    `记忆：active ${byStatus.active}（session ${byScope.session} / project ${byScope.project} / global ${byScope.global}${kinds ? `；${kinds}` : ''}），superseded ${byStatus.superseded}，archived ${byStatus.archived}，pending ${byStatus.pending}${byStatus.pending > 0 ? '（/context-hub review 审核）' : ''}；消息索引 ${store.messageCount()} 条（${store.messagesFtsReady === true ? 'FTS5' : '词法'}） @ ${store.file}`,
  )
  lines.push(
    `配置：模式 ${modeOf(store)}；召回 ${config.recallMaxItems} 条/${config.recallMaxChars} 字符，冷却 ${config.recallCooldownTurns} 轮；TTL session ${config.sessionTtlDays} 天 / project ${config.projectTtlDays} 天；抽取 ${config.extractPassesPerTurn} 次/轮；冲突 ${config.conflictPolicy}；项目 ${config.projectIdentity === 'cwd' ? 'cwd' : 'git'}；硬顶 ${config.recallMaxTokens} tokens${config.recallTimeoutMs > 0 ? `/超时 ${config.recallTimeoutMs}ms` : ''}；检索 ${store.ftsReady === true ? '关键词+FTS5' : '仅关键词'}${config.embedding.enabled ? (store.embedError ? `+向量（异常：${store.embedError}）` : `+向量（${config.embedding.fusion}）`) : ''}；压缩器 ${store.compactorActive === true ? 'hub' : 'native'}${store.compactorState && store.compactorActive !== true ? `（${store.compactorState}）` : ''}；改写 ${config.rewrite.enabled === true ? '开' : '关'}；重排 ${config.rerank.enabled === true ? `开（候选 ${config.rerank.candidates}）` : '关'}；水位 ${config.watermark.enabled === true ? `开（${Math.round(config.watermark.triggerRatio * 100)}% 触发，保留 ${config.watermark.retainTurns > 0 ? `${config.watermark.retainTurns} 轮` : `${config.watermark.retainTokens} tokens`}）` : '关（原生阈值）'}`,
  )
  const requests = store.recentEvents(200).filter((event) => event.kind === 'request')
  if (requests.length > 0) {
    let sum = 0
    let injectedSum = 0
    let parsed = 0
    for (const row of requests.slice(0, 20)) {
      try {
        const detail = JSON.parse(row.detail)
        sum += Number(detail.estTokens) || 0
        injectedSum += Number(detail.injected) || 0
        parsed += 1
      } catch { /* 旧格式跳过 */ }
    }
    lines.push(`请求：最近 ${requests.length} 次主请求采样，平均约 ${parsed > 0 ? Math.round(sum / parsed) : 0} tokens（其中注入约 ${parsed > 0 ? Math.round(injectedSum / parsed) : 0}）`)
  }
  const activity = store.eventCounts()
  if (activity.length > 0) {
    const label = ACTIVITY_LABELS
    lines.push(`活动：${activity.map(row => `${label[row.kind] ?? row.kind} ${row.n} 次`).join('，')}`)
  }
  if (store.openError !== undefined) lines.push(`警告：记忆库不可用 —— ${store.openError}`)
  return lines.join('\n')
}

/** 面板用的结构化快照；status 文本与 HTTP 路由共用同一数据源。 */
function statusSnapshot(ctx, store, session, sessionId) {
  const config = store.config
  const snapshot = {
    ok: true,
    generatedAt: Date.now(),
    db: store.file,
    openError: store.openError ?? null,
    compactor: store.compactorActive === true ? 'hub' : 'native',
    compactorState: store.compactorState ?? null,
    config: {
      mode: modeOf(store),
      recallMaxItems: config.recallMaxItems,
      recallMaxChars: config.recallMaxChars,
      recallMaxTokens: config.recallMaxTokens,
      recallTimeoutMs: config.recallTimeoutMs,
      cooldown: config.recallCooldownTurns,
      sessionTtlDays: config.sessionTtlDays,
      projectTtlDays: config.projectTtlDays,
      globalTtlDays: config.globalTtlDays,
      extractPasses: config.extractPassesPerTurn,
      conflictPolicy: config.conflictPolicy,
      embedding: config.embedding.enabled === true,
      rewrite: config.rewrite.enabled === true,
      watermark: config.watermark.enabled === true,
      watermarkRetainTurns: config.watermark.retainTurns,
      watermarkRetainTokens: config.watermark.retainTokens,
      fusion: config.embedding.fusion,
      rerank: config.rerank.enabled === true,
    },
    session: null,
    memory: { active: 0, superseded: 0, archived: 0, deleted: 0, pending: 0, scopes: { session: 0, project: 0, global: 0 }, kinds: {}, recent: [] },
    activity: [],
  }
  snapshot.graph = store.graphStats()
  snapshot.ledger = { ...store.ledgerStats(sessionId ?? ''), recent: store.recentLedger(5) }
  if (session !== undefined) {
    const meter = ctx.get('tokenMeter')
    const detail = { id: sessionId ?? String(session.id ?? ''), surfaceTokens: 0, totalTokens: 0, nodes: 0, pressure: undefined, contextWindow: undefined, parts: null, outputReserve: 0, folded: { count: 0, tokens: 0 }, events: Number(session.seq) || 0 }
    if (meter !== undefined) {
      try {
        const measurement = meter.measure(session)
        detail.surfaceTokens = Number(measurement.surfaceTokens) || 0
        detail.totalTokens = Number(measurement.totalTokens) || 0
        detail.nodes = measurement.nodes?.length ?? 0
        detail.parts = surfaceBreakdown(session, measurement)
        detail.outputReserve = Math.max(0, detail.totalTokens - detail.surfaceTokens)
        const pressure = meter.contextPressure(session)
        detail.pressure = pressure.pressureTokens
        detail.contextWindow = pressure.contextWindow
      } catch { /* 测量失败不阻塞面板 */ }
    }
    const folded = foldedStats(session)
    detail.folded = folded
    snapshot.session = detail
  }
  const byStatus = { active: 0, superseded: 0, archived: 0, deleted: 0, pending: 0 }
  const scopes = { session: 0, project: 0, global: 0 }
  const kinds = {}
  for (const row of store.counts()) {
    const n = Number(row.n)
    byStatus[row.status] = (byStatus[row.status] ?? 0) + n
    if (row.status === 'active') {
      scopes[row.scope] = (scopes[row.scope] ?? 0) + n
      kinds[row.kind] = (kinds[row.kind] ?? 0) + n
    }
  }
  snapshot.memory = {
    ...byStatus,
    scopes,
    kinds,
    messages: store.messageCount(),
    pendingItems: store.reviewList(10).map(row => ({
      id: row.id, kind: row.kind, scope: row.scope, confidence: row.confidence,
      text: String(row.text ?? '').slice(0, 160),
    })),
    recent: store.recentActive(6).map(row => ({
      id: row.id, kind: row.kind, scope: row.scope, confidence: row.confidence, uses: row.uses,
      text: String(row.text ?? '').slice(0, 160),
    })),
  }
  snapshot.activity = store.eventCounts().map(row => ({ kind: row.kind, count: Number(row.n) }))
  snapshot.requests = store.recentEvents(200)
    .filter((event) => event.kind === 'request')
    .slice(0, 20)
    .map((row) => {
      try { return { at: Number(row.created_at) || 0, ...JSON.parse(row.detail) } } catch { return undefined }
    })
    .filter((item) => item !== undefined)
  return snapshot
}

/** 面板数据路由：由 connection 服务托管鉴权，供客户端 fetch。 */
/**
 * 一次性空闲压缩：turn/end 后等 agent 空闲，调一次 compactNow。
 * 忙（用户紧接着发了新消息）时不消耗开关，下一轮 turn/end 再试。
 */
function installAutoCompact(ctx, store) {
  if (store.config.compactOnce !== true) return
  let pending = false
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    if (store.getKv('compact-once.done') === '1' || pending) return
    pending = true
    setTimeout(() => {
      void (async () => {
        try {
          const agent = ctx.get('agents')?.get(session.id)
          const compaction = ctx.get('compaction')
          if (!agent || !compaction) return
          await agent.whenIdle?.()
          const result = await compaction.compactNow(agent, new AbortController().signal)
          store.setKv('compact-once.done', '1')
          store.logEvent('compact-auto', {
            tokens: result?.shadowedTokenCount ?? 0,
            detail: result ? `seq ${result.startSeq}-${result.endSeq}` : '无可压缩区间',
          })
        } catch (error) {
          const message = String(error?.message ?? error)
          if (!/active work|busy/i.test(message)) {
            store.setKv('compact-once.done', '1')
            store.logEvent('compact-auto-error', { detail: message })
          }
        } finally {
          pending = false
        }
      })()
    }, 400)
  }, { global: true })
}

function installStatusRoute(ctx, store) {
  try {
    ctx.inject(['connection'], (scope) => {
      const connection = scope.get('connection')
      if (connection === undefined || connection.fetch === undefined) return
      const unregisterStatus = connection.fetch.register({
        path: '/api/context-hub.status',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const url = new URL(request.url, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId') ?? ''
            let session
            if (sessionId.length > 0) session = scope.get('sessions')?.get(sessionId)
            return new Response(JSON.stringify(statusSnapshot(scope, store, session, sessionId)), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: String(error) }), {
              status: 500,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          }
        },
      })
      const unregisterWatermark = connection.fetch.register({
        path: '/api/context-hub.watermark',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await request.json().catch(() => ({}))
            const enabled = body && body.enabled === true
            setWatermark(scope, store, enabled)
            return new Response(JSON.stringify({ ok: true, enabled: store.config.watermark.enabled === true }), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: String(error) }), {
              status: 500,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          }
        },
      })
      const unregisterReview = connection.fetch.register({
        path: '/api/context-hub.review',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const body = await request.json().catch(() => ({}))
            const action = body?.action
            const id = Number(body?.id)
            if (!Number.isFinite(id) || (action !== 'approve' && action !== 'reject')) {
              return new Response(JSON.stringify({ ok: false, error: 'action 必须是 approve/reject，id 必须是数字' }), {
                status: 400,
                headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
              })
            }
            const changed = action === 'approve' ? store.approve(id) : store.reject(id)
            if (!changed) {
              return new Response(JSON.stringify({ ok: false, error: `#${id} 不是待审核记忆` }), {
                status: 404,
                headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
              })
            }
            store.logEvent(`review-${action}`, { memoryIds: [id], detail: `#${id}（panel）` })
            return new Response(JSON.stringify({ ok: true, id, action }), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: String(error) }), {
              status: 500,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          }
        },
      })
      const unregisterAction = connection.fetch.register({
        path: '/api/context-hub.action',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const json = (status, payload) => new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
          try {
            const body = await request.json().catch(() => ({}))
            const action = body?.action
            const id = Number(body?.id)
            const value = body?.value
            if (action === 'config') {
              const key = typeof body?.key === 'string' ? body.key : ''
              const result = setConfigValue(ctx, store, key, value)
              if (!result.ok) return json(400, result)
              return json(200, { ok: true, action, key: result.key, value: result.value })
            }
            if (action === 'forget') {
              if (!Number.isFinite(id)) return json(400, { ok: false, error: 'id 必须是数字' })
              if (store.forget(id) === 0) return json(404, { ok: false, error: `#${id} 不存在或已删除` })
              store.logEvent('forget', { memoryIds: [id], detail: `#${id}（panel）` })
              return json(200, { ok: true, action, id })
            }
            if (action === 'supersede') {
              const text = typeof body?.text === 'string' ? body.text.trim() : ''
              if (!Number.isFinite(id) || text.length === 0) return json(400, { ok: false, error: '需要 id 与非空 text' })
              const result = store.supersede(id, text)
              if (result.action === 'missing') return json(404, { ok: false, error: `#${id} 不存在` })
              if (result.action !== 'inserted') return json(409, { ok: false, error: result.action })
              store.logEvent('supersede', { memoryIds: [result.id, id], detail: `#${result.id} 替换 #${id}（panel）` })
              return json(200, { ok: true, action, id, newId: result.id, replaced: id })
            }
            if (action === 'compactor') {
              const result = setCompactor(ctx, store, value)
              if (result === undefined) return json(400, { ok: false, error: 'value 必须是 hub/native' })
              if (result.value === 'hub' && result.active !== true) {
                return json(409, { ok: false, action, value, active: false, error: result.state || 'compaction 服务不可用' })
              }
              return json(200, { ok: true, action, value: result.value, active: result.active, state: result.state })
            }
            if (action === 'mode') {
              const applied = setCompactionMode(ctx, store, value)
              if (applied === undefined) return json(400, { ok: false, error: 'value 必须是 observe/assist/takeover/full' })
              return json(200, { ok: true, action, value: applied, compactor: store.compactorActive === true, watermark: store.config.watermark.enabled === true })
            }
            return json(400, { ok: false, error: '未知 action' })
          } catch (error) {
            return json(500, { ok: false, error: String(error) })
          }
        },
      })
      scope.effect(() => () => { void unregisterStatus(); void unregisterWatermark(); void unregisterReview(); void unregisterAction() })
    })
  } catch (error) {
    ctx.logger?.warn?.(`context-hub: status route install failed: ${String(error)}`)
  }
}

/** 每个工具都返回同一种形状：一段可直接阅读的文本。 */
const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

/** 探针报告文本：工具与 /context-hub probe 共用。 */
function probeText(store, session, limit) {
  const report = store.probe({ limit, project: session === undefined ? '' : projectOf(session, store) })
  store.logEvent('probe', { detail: JSON.stringify({ total: report.total, hits: report.hits, rate: report.rate }) })
  if (report.total === 0) return '没有可用的探针样本（需要 active 且长度 ≥8 的记忆）。'
  
  // E4: 诚实指标——显示样本量与置信区间
  const n = report.total
  const p = report.rate
  // 简单置信区间计算（Wilson 区间近似）
  const z = 1.96  // 95% 置信度
  const marginOfError = z * Math.sqrt((p * (1 - p)) / n)
  const ciLower = Math.max(0, (p - marginOfError) * 100)
  const ciUpper = Math.min(100, (p + marginOfError) * 100)
  
  const lines = [
    `检索探针：${report.hits}/${report.total} 命中（top-${store.config.recallMaxItems} 命中率 ${Math.round(report.rate * 100)}%）`,
    `📊 E4 诚实指标：样本量 n=${n}，95% 置信区间 [${ciLower.toFixed(1)}%, ${ciUpper.toFixed(1)}%]`,
    `⚠️ 注意：自造探针不构成泛化证据；公共基准结果请见 docs/EVAL.md`,
    ...report.cases.map(item => `- #${item.id} q=「${item.query}」 → ${item.position === null ? '未命中' : `第 ${item.position} 位（${item.score}）`}  ${item.text}`),
  ]
  return lines.join('\n')
}

/** B1：能力自检与推荐档；只读，不改配置。 */
function doctorReport(store) {
  const config = store.config
  const fts = store.ftsReady === true
  const embedding = config.embedding.enabled === true
  const rewrite = config.rewrite.enabled === true
  const rerank = config.rerank.enabled === true
  const gaps = []
  let tier = 'minimal'
  if (!fts) gaps.push('FTS5 不可用：当前 SQLite 未编译 FTS5，检索会退回纯关键词。')
  if (!embedding) gaps.push('向量召回未启用：配置 embedding.baseUrl/model，或使用包内 embed/ 本地服务（默认 bge-small-zh-v1.5）。')
  if (embedding && store.embedError) gaps.push(`向量端点异常：${store.embedError}`)
  if (fts && embedding) tier = 'balanced'
  if (tier === 'balanced' && rewrite && rerank) tier = 'semantic'
  if (!fts) tier = 'minimal'
  const lines = [
    `上下文中枢自检：档位 ${tier}`,
    `能力：FTS5 ${fts ? '可用' : '不可用'}；向量 ${embedding ? (store.embedError ? `异常（${store.embedError}）` : `开（${config.embedding.fusion}）`) : '关'}；改写 ${rewrite ? '开' : '关'}；重排 ${rerank ? '开' : '关'}；压缩器 ${store.compactorActive === true ? 'hub' : 'native'}；水位 ${config.watermark.enabled === true ? '开' : '关'}；审核 ${config.reviewPending === true ? '开' : '关'}`,
    `记忆库：${store.file}（active ${store.total()} 条，FTS 行 ${fts ? '已同步' : '未启用'}；消息索引 ${store.messageCount()} 条，${store.messagesFtsReady === true ? 'FTS5' : '词法'}）`,
    `融合建议：${config.embedding.fusion === 'rrf' ? '当前 RRF（词法/向量各排名后融合）' : '当前 weighted（向量分直接加成）；英文/多语言数据建议试 fusion: rrf'}`,
  ]
  if (gaps.length > 0) {
    lines.push('缺口：')
    lines.push(...gaps.map(item => `- ${item}`))
  } else {
    lines.push('缺口：无；当前能力完整。')
  }
  lines.push('推荐配置（复制到 profile 的 cordis.patch.yml，按需删改）：')
  lines.push('```yaml')
  if (tier === 'minimal') {
    lines.push('# 先启用本地向量服务：cd embed && npm install --ignore-scripts && ./start.sh')
    lines.push('embedding:')
    lines.push('  enabled: true')
    lines.push("  baseUrl: 'http://127.0.0.1:11434/v1'")
    lines.push("  model: 'bge-small-zh-v1.5'")
  } else if (tier === 'balanced') {
    lines.push('rewrite:')
    lines.push('  enabled: true          # 可选：小模型扩同义词，失败回退原查询')
    lines.push('compactor: hub           # 可选：8 段摘要，失败回退 native')
  } else {
    lines.push('rerank:')
    lines.push('  enabled: true          # 候选重排；多一跳延迟，失败回退原序')
    lines.push('watermark:')
    lines.push('  enabled: true          # 仅建议在空闲会话试；默认关')
    lines.push('  triggerRatio: 0.7')
    lines.push('  retainTokens: 20000')
  }
  lines.push('```')
  lines.push('提示：先跑 `/context-hub probe` 与 `scripts/recall-bench.mjs` 看基线，再决定是否开改写/重排；不要同时开 watermark 与 billion-context 的压缩层。')
  return lines.join('\n')
}

function defineTools(ctx, store) {
  ctx.tools.register({
    name: 'context_hub_search',
    description: '在长期记忆库里检索与关键词相关的记忆条目（决策、事实、偏好、任务、技能）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索关键词或一句话。' },
        limit: { type: 'number', description: '最多返回条数，默认 5。' },
        all: { type: 'boolean', description: '是否跨项目检索（默认只查当前项目与全局）。' },
      },
      required: ['query'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const query = typeof args?.query === 'string' ? args.query : ''
      const limit = Number.isFinite(args?.limit) ? Math.min(Math.max(1, Number(args.limit)), 20) : 5
      const session = exec?.agent?.session
      const rewritten = await rewriteQuery(ctx, store, exec?.agent, session, query)
      const searchText = rewritten === null ? query : `${query} ${rewritten}`
      const embVec = await store.embedQuery(searchText)
      let hits = store.search(searchText, {
        limit: Math.max(limit, store.config.rerank.enabled === true ? store.config.rerank.candidates : 0),
        includeAll: args?.all === true,
        project: session === undefined ? '' : projectOf(session, store),
        sessionId: session?.id ?? '',
        embVec,
      })
      if (store.config.rerank.enabled === true) {
        hits = (await rerankHits(ctx, store, session, query, hits, exec?.agent)).slice(0, limit)
      }
      if (hits.length === 0) return { text: `没有找到与「${query}」相关的记忆。` }
      return {
        text: hits.map(item => `- [#${item.id} ${item.kind} ${item.scope} conf ${item.confidence}] ${item.text}${item.tags ? `（tags: ${item.tags}）` : ''}`).join('\n'),
      }
    },
  })

  ctx.tools.register({
    name: 'context_hub_remember',
    description: '把一条值得跨会话记住的信息写入长期记忆库。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: '要记住的完整事实或决策（自包含，不依赖指代）。' },
        kind: { type: 'string', description: 'decision | fact | preference | task | skill，默认 fact。' },
        tags: { type: 'string', description: '逗号分隔的标签，可选。' },
        scope: { type: 'string', description: 'session | project | global，可选；按 kind 推导默认值。' },
      },
      required: ['text'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const text = typeof args?.text === 'string' ? args.text : ''
      if (text.trim().length === 0) return { text: '没有可写入的内容。' }
      const session = exec?.agent?.session
      const result = store.insert({
        kind: typeof args?.kind === 'string' ? args.kind : 'fact',
        text,
        tags: typeof args?.tags === 'string' ? args.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [],
        project: session === undefined ? '' : projectOf(session, store),
        sessionId: session?.id ?? '',
        scope: typeof args?.scope === 'string' ? args.scope : undefined,
        source: 'explicit',
      })
      if (result.action === 'inserted') return { text: `已记住（#${result.id}，${result.scope}，置信 ${result.confidence}）。` }
      if (result.action === 'duplicate') return { text: `已存在相同记忆（#${result.id}），未重复写入。` }
      if (result.action === 'weaker') return { text: `已有更强证据的同主题记忆（#${result.id}），本次未写入。` }
      if (result.action === 'unavailable') return { text: '记忆库不可用，本次未写入。' }
      return { text: `未写入：${result.reason ?? '内容被质量门槛拒绝'}。` }
    },
  })

  ctx.tools.register({
    name: 'context_hub_history',
    description: '在完整会话日志里检索历史消息，包括已经被压缩折叠的区间。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索关键词或一句话。' },
        limit: { type: 'number', description: '最多返回条数，默认 5。' },
      },
      required: ['query'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) return { text: '当前没有会话可供检索。' }
      const query = typeof args?.query === 'string' ? args.query : ''
      const limit = Number.isFinite(args?.limit) ? Math.min(Math.max(1, Number(args.limit)), 20) : 5
      const hits = searchHistory(session, query, limit)
      if (hits.length === 0) return { text: `会话日志里没有找到与「${query}」相关的内容。` }
      return {
        text: hits.map(hit => `- seq ${hit.seq} [${hit.role}] ${hit.text.slice(0, 300).replace(/\s+/g, ' ')}`).join('\n'),
      }
    },
  })

  ctx.tools.register({
    name: 'context_hub_restore',
    description: '按 seq 区间还原会话中已被压缩的原始对话（只读会话日志、有字符预算），并把原文加入下一步上下文。摘要不够用时用它回看细节。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        start: { type: 'number', description: '起始 seq（含）。' },
        end: { type: 'number', description: '结束 seq（不含），默认 start+40。' },
        maxChars: { type: 'number', description: '字符预算，默认 4000，最大 12000。' },
      },
      required: ['start'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) return { text: '当前没有会话可供还原。' }
      const start = Math.max(0, Math.floor(Number(args?.start)))
      if (!Number.isFinite(start)) return { text: 'start 必须是数字 seq。' }
      const endValue = Number(args?.end)
      const end = Number.isFinite(endValue) ? Math.min(Math.max(start + 1, endValue), start + 400) : start + 40
      const maxChars = Number.isFinite(args?.maxChars) ? Math.min(Math.max(500, Number(args.maxChars)), 12000) : 4000
      const restored = restoreTranscript(session, start, end, maxChars)
      if (restored.text.length === 0) return { text: `seq ${restored.from}-${restored.to - 1} 没有可还原的对话文本（可能只有工具或系统事件）。` }
      const message = restoredMessage(restored)
      if (typeof exec.deferContext === 'function') exec.deferContext(message)
      else exec.agent?.inject?.(message)
      store.logEvent('restore', {
        sessionId: session.id ?? '',
        tokens: restored.used,
        detail: `seq ${restored.from}-${restored.to - 1}${restored.truncated ? ' (truncated)' : ''}`,
      })
      return { text: `已还原 seq ${restored.from}-${restored.to - 1} 的 ${restored.used} 字符原文，并加入下一步上下文。` }
    },
  })

  ctx.tools.register({
    name: 'context_hub_decompress',
    description: '按压缩摘要的区间还原原始消息并加入下一步上下文；默认取最近一次压缩，也可指定 summary 记忆编号或 start/end。摘要不够用时用它回看细节。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'number', description: 'summary 记忆编号；不传则取最近一次压缩。' },
        start: { type: 'number', description: '起始 seq（含）；与 id 二选一。' },
        end: { type: 'number', description: '结束 seq（不含），默认 start+40。' },
        maxChars: { type: 'number', description: '字符预算，默认 8000，最大 20000。' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const session = exec.agent?.session
      const id = Number(args?.id)
      const start = Number(args?.start)
      const end = Number(args?.end)
      const maxChars = Number(args?.maxChars)
      return { text: decompressTranscript(ctx, store, session, { id, start, end, maxChars }, exec) }
    },
  })

  ctx.tools.register({
    name: 'context_hub_unfold',
    description: '把一次压缩的区间展开：接下来若干步的 pre-step 用原文临时替代压缩摘要（消息级可逆），便于在原文上继续推理。只影响模型请求，不改会话日志。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'number', description: 'summary 记忆编号；不传则取最近一次压缩。' },
        start: { type: 'number', description: '起始 seq（含）；与 id 二选一。' },
        end: { type: 'number', description: '结束 seq（不含）。' },
        steps: { type: 'number', description: '替代多少步，默认用配置的 unfold.steps（3）。' },
        maxChars: { type: 'number', description: '每步原文预算，默认 8000。' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      return {
        text: unfoldRange(ctx, store, exec.agent?.session, {
          id: Number(args?.id),
          start: Number(args?.start),
          end: Number(args?.end),
          steps: Number(args?.steps),
          maxChars: Number(args?.maxChars),
        }),
      }
    },
  })

  ctx.tools.register({
    name: 'context_hub_abtest',
    description: '压缩器 A/B：对最近对话分别用「原生式 7 段」与「记忆感知 8 段」各跑一次模型，比较段覆盖率、来源覆盖率与耗时。不改变会话与压缩服务。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        messages: { type: 'number', description: '取最近多少条 user/assistant 消息，默认 30，范围 5–100' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) return { text: '当前没有会话。' }
      const route = resolveRoute(exec.agent, session)
      if (route === undefined) return { text: '无法确定模型路由，暂不能跑 A/B。' }
      const wanted = Number(args.messages)
      const limit = Number.isFinite(wanted) ? Math.min(Math.max(Math.trunc(wanted), 5), 100) : 30
      const tail = transcriptTail(session, limit)
      if (tail.text.length === 0) return { text: '最近没有可摘要的对话。' }
      const memories = store.search(tail.text, { limit: 5, project: projectOf(session, store) })
      const memoryBlock = memories.length === 0 ? '（无）' : memories.map(item => `- [#${item.id} ${item.kind}] ${item.text}`).join('\n')
      const transcript = `--- 对话 ---\n${tail.text}\n--- 记忆候选 ---\n${memoryBlock}`
      const results = {}
      try {
        for (const [key, instruction, sections] of [['A', AB_INSTRUCTION_A, AB_SECTIONS_A], ['B', AB_INSTRUCTION_B, AB_SECTIONS_B]]) {
          let output = await runAbSummary(ctx, route, instruction, transcript, exec.signal)
          if (output.text.length === 0) output = await runAbSummary(ctx, route, instruction, transcript, exec.signal)
          results[key] = { ...abScore(output.text, tail.text, sections), ms: output.ms, text: output.text, types: output.types }
        }
      } catch (error) {
        return { text: `A/B 调用失败：${error instanceof Error ? error.message : String(error)}` }
      }
      const a = results.A
      const b = results.B
      const verdict = b.present > a.present || (b.present === a.present && b.coverage >= a.coverage)
        ? 'B（记忆感知 8 段）在本次输入上更好或持平'
        : 'A（原生式 7 段）在本次输入上更好'
      store.logEvent('abtest', {
        sessionId: session.id,
        detail: `A ${a.present}/${a.total} cov ${a.coverage.toFixed(2)} ${a.ms}ms ${JSON.stringify(a.types)}; B ${b.present}/${b.total} cov ${b.coverage.toFixed(2)} ${b.ms}ms ${JSON.stringify(b.types)}`,
      })
      const clip = value => (value.length > 1200 ? `${value.slice(0, 1200)}…` : value)
      return {
        text: [
          `压缩 A/B：输入 ${tail.count} 条消息 / ${tail.text.length} 字符，路由 ${route.provider}/${route.model}`,
          `A 原生式：段 ${a.present}/${a.total}，${a.chars} 字符，来源覆盖 ${a.coverage.toFixed(2)}，${a.ms}ms`,
          `B 记忆感知：段 ${b.present}/${b.total}，${b.chars} 字符，来源覆盖 ${b.coverage.toFixed(2)}，${b.ms}ms`,
          `判定：${verdict}`,
          '',
          '--- A ---',
          clip(a.text),
          '',
          '--- B ---',
          clip(b.text),
        ].join('\n'),
      }
    },
  })
  ctx.tools.register({
    name: 'context_hub_explain',
    description: '召回调试：给定关键词，列出候选记忆的打分明细、召回预算与每条未入选的原因。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', description: '要调试的关键词或一句话' } },
      required: ['query'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const query = String(args.query ?? '')
      const rewritten = await rewriteQuery(ctx, store, exec?.agent, exec?.agent?.session, query)
      return { text: await recallExplainText(ctx, store, exec.agent?.session, query, rewritten) }
    },
  })
  ctx.tools.register({
    name: 'context_hub_log',
    description: '查看最近的观测事件时间线（召回、抽取、压缩），用于确认记忆闭环是否在真实会话中运行。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { limit: { type: 'number', description: '返回条数，默认 10，最大 50' } },
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const wanted = Number(args.limit)
      const limit = Number.isFinite(wanted) ? Math.min(Math.max(Math.trunc(wanted), 1), 50) : 10
      const events = store.recentEvents(limit)
      if (events.length === 0) return { text: '还没有观测事件。' }
      return {
        text: events.map(event => {
          const when = new Date(event.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19)
          const ids = event.memory_ids ? ` #${String(event.memory_ids).split(',').filter(Boolean).join(', #')}` : ''
          return `- ${when} ${ACTIVITY_LABELS[event.kind] ?? event.kind}${ids}${event.tokens ? `（${event.tokens}）` : ''}${event.detail ? `：${event.detail}` : ''}`
        }).join('\n'),
      }
    },
  })

  ctx.tools.register({
    name: 'context_hub_probe',
    description: '检索探针：从现有记忆自造查询，检查每条记忆能否被召回并给出命中率；用于评估召回质量。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { limit: { type: 'number', description: '探针条数，默认 10，最大 50' } },
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const wanted = Number(args.limit)
      const limit = Number.isFinite(wanted) ? Math.min(Math.max(Math.trunc(wanted), 1), 50) : 10
      return { text: probeText(store, exec.agent?.session, limit) }
    },
  })
  ctx.tools.register({
    name: 'context_hub_doctor',
    description: '能力自检：检查 FTS5、向量、改写、重排、压缩器与水位，给出 minimal/balanced/semantic 档位和推荐配置；只读，不改配置。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute() {
      return { text: doctorReport(store) }
    },
  })
  ctx.tools.register({
    name: 'context_hub_status',
    description: '查看上下文中枢的洞察：上下文压力、已折叠区间、记忆库构成与当前配置。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    output: TEXT_OUTPUT,
    async execute(_args, exec) {
      return { text: statusText(ctx, store, exec.agent?.session) }
    },
  })
}

function defineCommand(ctx, store) {
  ctx.commands.register({
    name: 'context-hub',
    description: '上下文中枢：status / doctor / mode / search / remember / history / restore / decompress / unfold / explain / probe / log / audit / compact / compactor / reembed / watermark / config / review',
    input: { hint: 'status | doctor | mode [observe|assist|takeover|full] | search <词> | remember <内容> | history <词> | restore <start> [end] | decompress [id|start] [end] | unfold [id:<n>|start] [end] [steps:<n>] | explain <词> | probe [n] | log [n] | audit <id> | compact | compactor <hub|native> | reembed | watermark [on|off] | config [键] [值] | review [list|approve|reject] [id]' },
    async handler(invocation) {
      const raw = invocation.rawInput.trim()
      const [sub, ...rest] = raw.split(/\s+/)
      const argument = rest.join(' ').trim()
      const session = invocation.agent?.session

      if (sub === '' || sub === 'status') {
        return { kind: 'success', text: statusText(ctx, store, session) }
      }
      if (sub === 'doctor') {
        return { kind: 'success', text: doctorReport(store) }
      }
      if (sub === 'mode') {
        if (argument === '') {
          return {
            kind: 'success',
            text: [
              `接管模式：${modeOf(store)}`,
              'observe：只用原生压缩；assist：原生触发 + hub 8 段摘要；takeover：原生摘要 + 水位接管；full：hub 摘要 + 水位接管。',
              '用法：/context-hub mode observe | assist | takeover | full',
            ].join('\n'),
          }
        }
        const applied = setCompactionMode(ctx, store, argument)
        if (applied === undefined) return { kind: 'error', text: '用法：/context-hub mode observe | assist | takeover | full' }
        return { kind: 'success', text: `已切换接管模式：${applied}（压缩器 ${store.compactorActive === true ? 'hub' : 'native'}，水位 ${store.config.watermark.enabled === true ? '开' : '关'}）；已持久化。` }
      }
      if (sub === 'compactor') {
        if (argument === 'hub' || argument === 'native') {
          const result = setCompactor(ctx, store, argument)
          if (result === undefined) return { kind: 'error', text: '用法：/context-hub compactor hub | native' }
          if (argument === 'hub') {
            return {
              kind: result.active === true ? 'success' : 'error',
              text: result.active === true
                ? '已挂载 hub 压缩器：保留原生触发/选区，仅替换摘要提示词；失败自动回退 native。'
                : `挂载失败：${result.state || 'compaction 服务不可用'}`,
            }
          }
          return { kind: 'success', text: '已卸载 hub 压缩器，回到原生摘要。' }
        }
        return {
          kind: 'success',
          text: `压缩器：${store.compactorActive === true ? 'hub（记忆感知 8 段）' : 'native（原生 7 段）'}${store.compactorState && store.compactorActive !== true ? `；状态：${store.compactorState}` : ''}\n用法：/context-hub compactor hub | native`,
        }
      }
      if (sub === 'watermark') {
        if (argument === 'on' || argument === 'off') {
          const on = argument === 'on'
          setWatermark(ctx, store, on)
          return {
            kind: 'success',
            text: on
              ? `已开启水位压缩：${Math.round(store.config.watermark.triggerRatio * 100)}% 触发、保留尾部 ${store.config.watermark.retainTokens} tokens；开关已持久化（下次启动沿用）。`
              : '已关闭水位压缩，回到原生阈值；开关已持久化。',
          }
        }
        const wm = store.config.watermark
        return {
          kind: 'success',
          text: `水位压缩：${wm.enabled === true ? '开' : '关'}（触发 ${Math.round(wm.triggerRatio * 100)}%，保留 ${wm.retainTokens} tokens，冷却 ${wm.cooldownTurns} 轮）\n用法：/context-hub watermark on | off`,
        }
      }
      if (sub === 'config') {
        const [key, ...restValue] = argument.split(/\s+/).filter(Boolean)
        if (key === undefined) {
          const rows = Object.keys(CONFIG_EDITABLE).map(k => `- ${k} = ${String(configPathGet(store.config, k))}`)
          return {
            kind: 'success',
            text: ['可改配置（面板「配置」页同款，改后写记忆库并立即生效）：', ...rows, '用法：/context-hub config <键> <值>'].join('\n'),
          }
        }
        const result = setConfigValue(ctx, store, key, restValue.join(' '))
        if (!result.ok) return { kind: 'error', text: result.error }
        return { kind: 'success', text: `已设置 ${result.key} = ${String(result.value)}（已持久化，立即生效）。` }
      }
      if (sub === 'reembed') {
        if (store.db === undefined) return { kind: 'error', text: '记忆库不可用。' }
        if (store.config.embedding.enabled !== true) return { kind: 'error', text: '未启用 embedding：先在 profile 配置 embedding.enabled/baseUrl/model。' }
        const cleared = store.resetEmbeddings()
        let done = 0
        for (let i = 0; i < 50; i += 1) {
          const n = await store.backfillEmbeddings(200)
          done += n
          if (n < 200) break
        }
        store.logEvent('reembed', { tokens: done, detail: `model ${store.config.embedding.model}（清 ${cleared}）` })
        return { kind: 'success', text: `已清空 ${cleared} 条旧向量，用 ${store.config.embedding.model} 重算 ${done} 条。` }
      }
      if (sub === 'review') {
        const [action, idText] = argument.split(/\s+/)
        const id = Number(idText)
        if (action === 'approve' || action === 'reject') {
          if (!Number.isFinite(id)) return { kind: 'error', text: `用法：/context-hub review ${action} <id>` }
          const changed = action === 'approve' ? store.approve(id) : store.reject(id)
          if (!changed) return { kind: 'error', text: `#${id} 不是待审核记忆（只有 pending 能审核）。` }
          store.logEvent(`review-${action}`, { memoryIds: [id], detail: `#${id}` })
          return { kind: 'success', text: action === 'approve' ? `已批准 #${id}，现在可以被召回。` : `已拒绝 #${id}（软删除，审计链保留）。` }
        }
        const pending = store.reviewList(20)
        if (pending.length === 0) return { kind: 'success', text: '没有待审核记忆（reviewPending 关闭时抽取直接入库）。' }
        return {
          kind: 'success',
          text: [
            `待审核 ${pending.length} 条（approve 后才会被召回）：`,
            ...pending.map(row => `#${row.id} ${row.kind}/${row.scope} 置信 ${row.confidence} · ${String(row.text).slice(0, 120)}`),
            '用法：/context-hub review approve <id> | reject <id>',
          ].join('\n'),
        }
      }
      if (sub === 'restore') {
        if (session === undefined) return { kind: 'error', text: '当前没有会话可供还原。' }
        const [startText, endText] = argument.split(/\s+/)
        const start = Number.parseInt(startText, 10)
        if (!Number.isFinite(start)) return { kind: 'error', text: '用法：/context-hub restore <起始 seq> [结束 seq]' }
        const endValue = Number.parseInt(endText, 10)
        const end = Number.isFinite(endValue) ? Math.min(Math.max(start + 1, endValue), start + 400) : start + 40
        const restored = restoreTranscript(session, start, end, 4000)
        if (restored.text.length === 0) return { kind: 'success', text: `seq ${restored.from}-${restored.to - 1} 没有可还原的对话文本。` }
        invocation.agent?.inject?.(restoredMessage(restored))
        store.logEvent('restore', {
          sessionId: session.id ?? '',
          tokens: restored.used,
          detail: `seq ${restored.from}-${restored.to - 1}${restored.truncated ? ' (truncated)' : ''}`,
        })
        return {
          kind: 'success',
          text: `已还原 seq ${restored.from}-${restored.to - 1} 的 ${restored.used} 字符原文，并注入下一步上下文。`,
        }
      }
      if (sub === 'decompress') {
        const parts = argument.split(/\s+/).filter(Boolean)
        let id
        let start
        let end
        if (parts.length > 0) {
          if (parts[0].startsWith('id:')) {
            id = Number.parseInt(parts[0].slice(3), 10)
          } else if (parts.length >= 2) {
            start = Number.parseInt(parts[0], 10)
            end = Number.parseInt(parts[1], 10)
          } else {
            const value = Number.parseInt(parts[0], 10)
            if (Number.isFinite(value) && store.getById(value)?.kind === 'summary') id = value
            else start = value
          }
        }
        return { kind: 'success', text: decompressTranscript(ctx, store, session, { id, start, end }, invocation) }
      }
      if (sub === 'unfold') {
        const parts = argument.split(/\s+/).filter(Boolean)
        let id
        let start
        let end
        let steps
        for (const part of parts) {
          if (part.startsWith('id:')) id = Number.parseInt(part.slice(3), 10)
          else if (part.startsWith('steps:')) steps = Number.parseInt(part.slice(6), 10)
          else if (!Number.isFinite(start)) start = Number.parseInt(part, 10)
          else if (!Number.isFinite(end)) end = Number.parseInt(part, 10)
        }
        return {
          kind: 'success',
          text: unfoldRange(ctx, store, session, { id, start, end, steps }),
        }
      }
      if (sub === 'search') {
        if (argument.length === 0) return { kind: 'error', text: '用法：/context-hub search <关键词>' }
        const embVec = await store.embedQuery(argument)
        let hits = store.search(argument, {
          limit: store.config.rerank.enabled === true ? Math.max(10, store.config.rerank.candidates) : 10,
          project: session === undefined ? '' : projectOf(session, store),
          sessionId: session?.id ?? '',
          embVec,
        })
        if (store.config.rerank.enabled === true) {
          hits = (await rerankHits(ctx, store, session, argument, hits, invocation.agent)).slice(0, 10)
        }
        if (hits.length === 0) return { kind: 'success', text: `没有找到与「${argument}」相关的记忆。` }
        return { kind: 'success', text: hits.map(item => `- [#${item.id} ${item.kind} ${item.scope}] ${item.text}`).join('\n') }
      }
      if (sub === 'remember') {
        if (argument.length === 0) return { kind: 'error', text: '用法：/context-hub remember <要记住的内容>' }
        const result = store.insert({
          kind: 'fact',
          text: argument,
          project: session === undefined ? '' : projectOf(session, store),
          sessionId: session?.id ?? '',
          source: 'explicit',
        })
        if (result.action === 'inserted') return { kind: 'success', text: `已记住（#${result.id}）。` }
        if (result.action === 'duplicate') return { kind: 'success', text: `已存在相同记忆（#${result.id}）。` }
        return { kind: 'error', text: '写入失败。' }
      }
      if (sub === 'history') {
        if (argument.length === 0) return { kind: 'error', text: '用法：/context-hub history <关键词>' }
        if (session === undefined) return { kind: 'error', text: '当前没有会话。' }
        const hits = searchHistory(session, argument, 10)
        if (hits.length === 0) return { kind: 'success', text: `会话日志里没有找到与「${argument}」相关的内容。` }
        return {
          kind: 'success',
          text: hits.map(hit => `- seq ${hit.seq} [${hit.role}] ${hit.text.slice(0, 300).replace(/\s+/g, ' ')}`).join('\n'),
        }
      }
      if (sub === 'explain') {
        if (argument.length === 0) return { kind: 'error', text: '用法：/context-hub explain <关键词>' }
        const rewritten = await rewriteQuery(ctx, store, invocation.agent, session, argument)
        return { kind: 'success', text: await recallExplainText(ctx, store, session, argument, rewritten) }
      }
      if (sub === 'probe') {
        const wanted = Number.parseInt(argument, 10)
        const limit = Number.isFinite(wanted) ? Math.min(Math.max(wanted, 1), 50) : 10
        return { kind: 'success', text: probeText(store, session, limit) }
      }
      if (sub === 'log') {
        const wanted = Number.parseInt(argument, 10)
        const limit = Number.isFinite(wanted) ? Math.min(Math.max(wanted, 1), 50) : 10
        const events = store.recentEvents(limit)
        if (events.length === 0) return { kind: 'success', text: '还没有观测事件。' }
        return {
          kind: 'success',
          text: events.map(event => {
            const when = new Date(event.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19)
            const ids = event.memory_ids ? ` #${String(event.memory_ids).split(',').filter(Boolean).join(', #')}` : ''
            return `- ${when} ${ACTIVITY_LABELS[event.kind] ?? event.kind}${ids}${event.tokens ? `（${event.tokens}）` : ''}${event.detail ? `：${event.detail}` : ''}`
          }).join('\n'),
        }
      }
      if (sub === 'audit') {
        const id = Number.parseInt(argument, 10)
        if (!Number.isFinite(id)) return { kind: 'error', text: '用法：/context-hub audit <记忆编号>' }
        const row = store.getById(id)
        if (row === undefined) return { kind: 'error', text: `没有编号为 #${id} 的记忆。` }
        const chain = []
        let current = row
        for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
          chain.push(current)
          const nextId = Number(current.superseded_by)
          if (!current.superseded_by || !Number.isFinite(nextId) || nextId === current.id) break
          current = store.getById(nextId)
        }
        const lines = chain.map((item, index) => {
          const prefix = index === 0 ? '' : '  ↳ '
          const evidence = item.evidence_seq ? ` 证据 seq ${item.evidence_seq}` : ''
          const message = item.message_id ? ` 消息 seq ${item.message_seq}${Number(item.sentence_no) >= 0 ? ` 句 ${item.sentence_no}` : ''}` : ''
          const validity = item.valid_from ? ` 生效 ${new Date(item.valid_from * 1000).toISOString().slice(0, 19)}${item.valid_to ? ` → 失效 ${new Date(item.valid_to * 1000).toISOString().slice(0, 19)}` : ''}` : ''
          return `${prefix}#${item.id} [${item.status}] ${item.kind}/${item.scope} 置信 ${item.confidence} 来源 ${item.source}${evidence}${message}${validity}\n${prefix}  ${item.text}\n${prefix}  created ${new Date(item.created_at * 1000).toISOString().slice(0, 19)}，last_used ${new Date(item.last_used * 1000).toISOString().slice(0, 19)}，uses ${item.uses}`
        })
        return { kind: 'success', text: lines.join('\n') }
      }
      // E3: 记忆视图 - 关系图
      if (sub === 'graph') {
        const id = Number.parseInt(argument, 10)
        if (!Number.isFinite(id)) return { kind: 'error', text: '用法：/context-hub graph <记忆编号>' }
        const row = store.getById(id)
        if (row === undefined) return { kind: 'error', text: `没有编号为 #${id} 的记忆。` }
        const { nodes, edges } = store.memoryGraph(id, { maxDepth: 2, limit: 20 })
        if (nodes.length <= 1) return { kind: 'success', text: `#${id} 没有关联记忆。` }
        const lines = [
          `记忆关系图：#${id}（${nodes.length} 个节点，${edges.length} 条边）`,
          ...nodes.slice(0, 10).map(n => `- #${n.id} [${n.kind}/${n.scope}] ${n.text.slice(0, 60)}${n.id === id ? ' ← 中心' : ''}`),
          '---',
          ...edges.slice(0, 10).map(e => `- #${e.from} → #${e.to} (${e.relation}, 权 ${Number(e.weight).toFixed(2)})`),
        ]
        return { kind: 'success', text: lines.join('\n') }
      }
      // E3: 记忆视图 - 时间线
      if (sub === 'timeline') {
        const scope = argument.split(' ')[0] || 'project'
        const project = store.project || ''
        const timeline = store.memoryTimeline({ scope, project, limit: 20 })
        if (timeline.length === 0) return { kind: 'success', text: `没有 ${scope} 范围的记忆时间线。` }
        const lines = [
          `记忆时间线（${scope}，最近 ${timeline.length} 条）：`,
          ...timeline.map((m, i) => `${i + 1}. #${m.id} [${m.kind}] ${new Date(m.created_at * 1000).toISOString().slice(0, 10)} ${m.text.slice(0, 80)}`),
        ]
        return { kind: 'success', text: lines.join('\n') }
      }
      // E3: 记忆视图 - 冲突链
      if (sub === 'conflicts') {
        const id = Number.parseInt(argument, 10)
        if (!Number.isFinite(id)) return { kind: 'error', text: '用法：/context-hub conflicts <记忆编号>' }
        const row = store.getById(id)
        if (row === undefined) return { kind: 'error', text: `没有编号为 #${id} 的记忆。` }
        const chain = store.conflictChain(id)
        if (chain.length <= 1) return { kind: 'success', text: `#${id} 没有冲突历史。` }
        const lines = [
          `冲突链：#${id}（${chain.length} 条相关记忆）`,
          ...chain.map((c, i) => {
            const prefix = c.direction === 'original' ? '→' : '↳'
            return `${prefix} #${c.id} [${c.status}] ${new Date(c.created_at * 1000).toISOString().slice(0, 10)} ${c.text.slice(0, 60)}`
          }),
        ]
        return { kind: 'success', text: lines.join('\n') }
      }
      if (sub === 'forget') {
        const id = Number.parseInt(argument, 10)
        if (!Number.isFinite(id)) return { kind: 'error', text: '用法：/context-hub forget <记忆编号>' }
        const row = store.getById(id)
        if (row === undefined) return { kind: 'error', text: `没有编号为 #${id} 的记忆。` }
        if (store.forget(id) === 0) return { kind: 'success', text: `#${id} 已经删除。` }
        return { kind: 'success', text: `已删除 #${id}（软删除，审计链保留；可用 /context-hub audit ${id} 查看）。` }
      }
      if (sub === 'supersede') {
        const [idText, ...rest] = argument.split(/\s+/)
        const id = Number.parseInt(idText, 10)
        const text = rest.join(' ').trim()
        if (!Number.isFinite(id) || text.length === 0) {
          return { kind: 'error', text: '用法：/context-hub supersede <旧编号> <新内容>' }
        }
        const result = store.supersede(id, text)
        if (result.action === 'missing') return { kind: 'error', text: `没有编号为 #${id} 的记忆。` }
        if (result.action === 'duplicate') return { kind: 'success', text: `相同内容已存在（#${result.id}）。` }
        if (result.action !== 'inserted') return { kind: 'error', text: '替换失败。' }
        return { kind: 'success', text: `已用 #${result.id} 替换 #${result.replaced}（旧条目保留为 superseded）。` }
      }
      if (sub === 'export') {
        if (store.db === undefined) return { kind: 'error', text: '记忆库不可用。' }
        const target = join(dirname(store.file), 'exports', `export-${Date.now()}.json`)
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        const result = store.exportSnapshot(target)
        if (result === undefined) return { kind: 'error', text: '导出失败：记忆库不可用。' }
        return { kind: 'success', text: `已导出 ${result.memories} 条记忆、${result.messages ?? 0} 条消息索引、${result.events} 条事件到 ${target}` }
      }
      // E5/D5: JSONL 导出与幂等导入
      if (sub === 'export-jsonl') {
        if (store.db === undefined) return { kind: 'error', text: '记忆库不可用。' }
        const target = join(dirname(store.file), 'exports', `memories-${Date.now()}.jsonl`)
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        const result = store.exportToJSONL(target)
        if (result === undefined) return { kind: 'error', text: '导出失败：记忆库不可用。' }
        return { kind: 'success', text: `已导出 ${result.count} 条记忆到 ${target}（JSONL 格式，每行一个记忆，便于脚本消费）` }
      }
      if (sub === 'import-jsonl') {
        if (store.db === undefined) return { kind: 'error', text: '记忆库不可用。' }
        const path = args?.path
        if (!path || typeof path !== 'string') return { kind: 'error', text: '用法：/context-hub import-jsonl <路径>' }
        if (!existsSync(path)) return { kind: 'error', text: `文件不存在：${path}` }
        try {
          const result = store.importFromJSONL(path)
          return { kind: 'success', text: `已导入 ${result.imported} 条记忆，跳过 ${result.skipped} 条（基于 hash 去重，幂等）` }
        } catch (error) {
          return { kind: 'error', text: `导入失败：${error instanceof Error ? error.message : String(error)}` }
        }
      }
      if (sub === 'compact') {
        const compaction = ctx.get('compaction')
        if (compaction === undefined) return { kind: 'error', text: '压缩服务不可用。' }
        try {
          const result = await compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)
          if (result === null) return { kind: 'success', text: '还没有可压缩的历史。' }
          store.logEvent('compact', {
            sessionId: session?.id ?? '',
            tokens: result.shadowedTokenCount,
            detail: `summary seq ${result.summarySeq}`,
          })
          return {
            kind: 'success',
            text: `已压缩 ${result.shadowedSeqs.length} 条历史（约 ${result.shadowedTokenCount} tokens），摘要 seq ${result.summarySeq}。`,
            sourceEventSeq: result.summarySeq,
          }
        } catch (error) {
          if (invocation.signal?.aborted) return { kind: 'error', text: '压缩已取消。' }
          return { kind: 'error', text: `压缩失败：${error instanceof Error ? error.message : String(error)}` }
        }
      }
      return { kind: 'error', text: '用法：/context-hub status | doctor | mode [observe|assist|takeover|full] | search <关键词> | remember <内容> | history <关键词> | restore <起始 seq> [结束 seq] | decompress [id:<编号>|起始 seq] [结束 seq] | unfold [id:<编号>|起始 seq] [结束 seq] [steps:<n>] | explain <关键词> | log [条数] | audit <编号> | graph <编号> | timeline [scope] | conflicts <编号> | forget <编号> | supersede <编号> <新内容> | export | export-jsonl | import-jsonl <路径> | compact | compactor <hub|native> | reembed | watermark [on|off] | config [键] [值] | review [list|approve|reject] [id]' }
    },
  })
}

/**
 * 插件入口：建立记忆库、注册工具与命令、挂上召回/抽取的会话事件。
 * @param ctx 插件上下文。
 * @param config 可选配置（cordis.patch.yml 的 config 字段）。
 */
const EMBED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'embed')

function isLoopbackEmbedding(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

function embedServiceRoot(baseUrl) {
  return String(baseUrl).replace(/\/v1\/?$/i, '').replace(/\/+$/, '')
}

async function pingEmbedService(baseUrl, timeoutMs = 800) {
  try {
    const response = await fetch(`${embedServiceRoot(baseUrl)}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 本地 embedding 服务随插件一起分发（embed/）。当配置指向回环地址且服务未启动时，
 * 由插件拉起一个 detached 子进程；模型首次使用会从 HF 镜像下载到 embed/.cache/。
 * 只对回环地址生效，绝不替远端端点做任何事。
 */
async function ensureEmbeddingService(ctx, store) {
  const cfg = store.config.embedding
  if (cfg.enabled !== true || cfg.autoStart !== true || isLoopbackEmbedding(cfg.baseUrl) !== true) return
  if (await pingEmbedService(cfg.baseUrl)) return
  const server = join(EMBED_DIR, 'server.mjs')
  if (existsSync(server) !== true) {
    store.logEvent('embedding-start-error', { detail: `缺少 ${server}` })
    return
  }
  let port = '11434'
  try { port = new URL(cfg.baseUrl).port || '11434' } catch {}
  const model = String(cfg.model).includes('/') ? String(cfg.model) : `Xenova/${cfg.model}`
  try {
    const child = spawn(process.execPath, [server], {
      cwd: EMBED_DIR,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PORT: port, EMBED_MODEL: model, EMBED_DTYPE: cfg.dtype || 'fp32' },
    })
    child.unref()
    store.logEvent('embedding-start', { detail: `pid ${child.pid} port ${port} model ${model} dtype ${cfg.dtype || 'fp32'}` })
  } catch (error) {
    store.logEvent('embedding-start-error', { detail: String(error) })
    return
  }
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    if (await pingEmbedService(cfg.baseUrl, 1000)) {
      store.embedError = undefined
      store.logEvent('embedding-ready', { detail: `port ${port}（${((i + 1) * 0.5).toFixed(1)}s）` })
      void ensureEmbeddingService(ctx, store)
        .then(() => store.backfillEmbeddings().catch(() => {}))
        .catch(() => {})
      return
    }
  }
  store.logEvent('embedding-start-error', { detail: '30s 内未就绪，看 embed/embed.log' })
}

export function apply(ctx, config) {
  const settings = resolveConfig(config)
  const store = new MemoryStore(dbFile(), settings)
  try {
    store.open()
    ctx.logger?.info?.(`context-hub: memory store at ${store.file}`)
    applyStoredConfig(store)
    try { store.backfillEntities() } catch { /* 回填失败不影响启动 */ }
    if (settings.embedding.enabled) {
      const cleared = store.resetEmbeddings()
      if (cleared > 0) store.logEvent('embedding-reset', { detail: `model ${settings.embedding.model}（清 ${cleared} 条旧向量）` })
      void ensureEmbeddingService(ctx, store)
        .then(() => store.backfillEmbeddings().catch(() => {}))
        .catch(() => {})
    }
  } catch (error) {
    store.openError = String(error)
    store.close()
    store.db = undefined
    ctx.logger?.warn?.(`context-hub: memory store unavailable (${String(error)}); memory features disabled`)
  }
  if (store.db !== undefined) {
    const persistedMode = store.getKv('compaction.mode')
    if (settings.mode === 'auto' && ['observe', 'assist', 'takeover', 'full'].includes(persistedMode)) {
      settings.mode = persistedMode
      store.config.mode = persistedMode
    }
    if (settings.mode === 'auto') {
      const persisted = store.getKv('watermark.enabled')
      if (persisted === '0' || persisted === '1') {
        settings.watermark.enabled = persisted === '1'
        store.config.watermark.enabled = settings.watermark.enabled
      }
    }
  }
  ctx.effect(() => () => store.close())

  try {
    ctx.inject(['compaction'], (scope) => {
      store.compactionScope = scope
      store.compactionService = scope.get('compaction')
    })
  } catch {}
  try {
    const savedCompactor = store.db !== undefined ? store.getKv('compactor') : undefined
    if (savedCompactor === 'hub' || savedCompactor === 'native') settings.compactor = savedCompactor
  } catch {}

  defineTools(ctx, store)
  defineCommand(ctx, store)
  if (settings.mode !== 'auto') setCompactionMode(ctx, store, settings.mode)
  else {
    if (settings.compactor === 'hub') installHubCompactor(ctx, store)
    if (settings.watermark.enabled) installWatermark(ctx, store)
  }
  installStatusRoute(ctx, store)
  installUnfold(ctx, store)
  installAutoCompact(ctx, store)

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      stateOf(session).turn += 1
      return
    }
    if (event.type === 'user/message') {
      void maybeRecall(ctx, store, session, event).catch((error) => {
        ctx.logger?.warn?.(`context-hub: recall failed: ${String(error)}`)
      })
      return
    }
    if (event.type === 'turn/end') {
      try { store.indexSession(session, session.seq) } catch (error) {
        ctx.logger?.warn?.(`context-hub: message index failed: ${String(error)}`)
      }
      void extractMemories(ctx, store, session)
      return
    }
    if (event.type === 'compaction/summary') {
      void recordCompactionSummary(ctx, store, session, event)
    }
  })

  // W4：逐请求观测（waterfall 只观察，不改写 options）。
  ctx.on('llm/stream', (options, next) => {
    sampleRequest(ctx, store, options)
    return next()
  }, { global: true })

  ctx.on('session/disposed', (session) => { sessionState.delete(session) })
}
