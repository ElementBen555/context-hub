/** 无 DSH 的冒烟测试：用假 ctx 驱动插件的召回、抽取、工具与命令。 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'
import { apply, defaults, MemoryStore, resolveConfig } from './src/index.js'
import { DatabaseSync } from 'node:sqlite'

const dbPath = fileURLToPath(new URL('./tmp-smoke.db', import.meta.url))
rmSync(dbPath, { force: true })
process.env.DSH_CONTEXT_HUB_DB = dbPath

const tools = new Map()
const commands = new Map()
const listeners = new Map()

/** 假 cordis：事件可挂多个监听器；waterfall 按注册顺序链式调用。 */
function addListener(map, event, handler) {
  const list = map.get(event)
  if (list === undefined) map.set(event, [handler])
  else list.push(handler)
  return () => {
    const current = map.get(event)
    if (current !== undefined) map.set(event, current.filter(item => item !== handler))
  }
}

function emitEvent(map, event, ...args) {
  for (const handler of map.get(event) ?? []) handler(...args)
}

function firstHandler(map, event) {
  return (map.get(event) ?? [])[0]
}

async function emitWaterfall(map, event, payload, finalNext) {
  const handlers = [...(map.get(event) ?? [])]
  let index = 0
  const next = async () => {
    if (index >= handlers.length) return finalNext()
    const handler = handlers[index]
    index += 1
    return handler(payload, next)
  }
  return next()
}
const injected = []
const routes = []

const sessionEvents = []
const session = {
  id: 'session-1',
  header: { cwd: '/tmp/project' },
  seq: 0,
  eventAt(seq) { return sessionEvents[seq] },
}
const agent = {
  session,
  options: { provider: 'fake', model: 'fake-model' },
  inject(message) { injected.push(message) },
}

let llmCalls = 0
let pressureTokens = 600
const nativeSummarize = async () => ({ summary: [{ type: 'text', text: 'native summary' }], provider: 'fake', model: 'fake-model' })
const compactCalls = []
const compactionService = {
  summarize: nativeSummarize,
  async compactRegion(start, end) {
    compactCalls.push([start, end])
    return { shadowedSeqs: [start, end], shadowedTokenCount: 456, shadowedRange: { start, end }, summarySeq: 99 }
  },
}
let extractOutput = '[{"kind":"decision","text":"项目用 SQLite 存记忆，路径在 $DSH_HOME/context-hub。","tags":["storage"]}]'
const llm = {
  stream() {
    llmCalls += 1
    return (async function* () {
      yield { type: 'text-delta', index: 0, text: extractOutput }
    })()
  },
}
const ctx = {
  logger: { info: () => {}, warn: message => console.log('[warn]', message) },
  get(name) {
    if (name === 'agents') return { get: id => (id === 'session-1' ? agent : undefined) }
    if (name === 'compaction') return compactionService
    if (name === 'llm') return llm
    if (name === 'sessions') return { get: id => (id === 'session-1' ? session : undefined) }
    if (name === 'connection') return { fetch: { register(route) { routes.push(route); return () => Promise.resolve() } } }
    if (name === 'tokenMeter') return {
      measure: () => ({ surfaceTokens: 1000, totalTokens: 1400, nodes: sessionEvents.map((_event, seq) => ({ seq, tokens: 50 })) }),
      contextPressure: () => ({ pressureTokens: pressureTokens, contextWindow: 100000 }),
    }
    return undefined
  },
  tools: { register(definition) { tools.set(definition.name, definition) } },
  commands: { register(definition) { commands.set(definition.name, definition) } },
  on(event, handler) { return addListener(listeners, event, handler) },
  inject(_dependencies, callback) { callback(ctx) },
  effect() {},
}

apply(ctx, { recallMaxItems: 6, recallMaxChars: 1200, sessionTtlDays: 7, extractPassesPerTurn: 1, conflictPolicy: 'evidence', compactor: 'hub' })
console.log('tools:', [...tools.keys()].join(','))
console.log('commands:', [...commands.keys()].join(','))

const command = commands.get('context-hub')
const invocation = rawInput => ({ agent, signal: new AbortController().signal, commandId: 'cmd-1', rawInput })

const remembered = await command.handler(invocation('remember 用户偏好中文回答，代码注释用英文。'))
console.log('remember:', remembered.text)
if (!remembered.text.includes('已记住')) throw new Error('remember failed: ' + remembered.text)
console.log('search  :', (await command.handler(invocation('search 中文'))).text)

// 查询侧近义扩展：中文“压缩”与英文 fold / compaction 互通
const aliasSeed = await command.handler(invocation('remember 压缩优先复用原生 compaction 服务，不替换实现。'))
const aliasId = Number(aliasSeed.text.match(/#(\d+)/)?.[1] ?? 0)
const alias = await command.handler(invocation('explain fold'))
console.log('alias   :', alias.text.split('\n')[0], '-> #' + aliasId)
if (!alias.text.includes(`#${aliasId} `)) throw new Error('alias expansion failed')

// 用户消息触发召回
const userEvent = {
  type: 'user/message',
  seq: 0,
  data: { role: 'user', content: [{ type: 'text', text: '之前说的中文回答偏好还算数吗？' }], source: { kind: 'user' } },
}
sessionEvents.push(userEvent)
session.seq = 1
emitEvent(listeners, 'session/event', session, userEvent)
await sleep(20)
console.log('injected:', injected.length, injected[0]?.source, injected[0]?.content?.[0]?.text?.slice(0, 40))
if (injected.length !== 1) throw new Error('recall injection missing')
if (injected[0].source.kind !== 'context-hub') throw new Error('bad source')

// turn/end 触发抽取
const assistantEvent = {
  type: 'assistant/message',
  seq: 1,
  data: { role: 'assistant', content: [{ type: 'text', text: '算数，我会继续用中文回答。'.repeat(6) }], source: { kind: 'model', provider: 'fake', model: 'fake-model' } },
}
sessionEvents.push(assistantEvent)
session.seq = 2
const turnEnd = { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } }
sessionEvents.push(turnEnd)
session.seq = 3
emitEvent(listeners, 'session/event', session, turnEnd)
await sleep(50)
console.log('llm calls:', llmCalls)

// 召回未命中要留诊断：新会话、无上下文、查询与记忆零重叠
const session2 = {
  id: 'session-2',
  header: { cwd: session.header.cwd },
  seq: 0,
  eventAt() { return undefined },
}
const missEvent = {
  type: 'user/message',
  seq: 0,
  data: { role: 'user', content: [{ type: 'text', text: 'qqqq zzzz' }], source: { kind: 'user' } },
}
emitEvent(listeners, 'session/event', session2, missEvent)
await sleep(20)
const logTool = tools.get('context_hub_log')
const logText = (await logTool.execute({ limit: 20 }, { agent })).text
console.log('miss log:', logText.includes('召回未命中'))
if (!logText.includes('召回未命中')) throw new Error('recall miss not logged')
if (injected.length !== 1) throw new Error('unexpected injection for miss case')

// 服务级压缩器：summarize 被替换，且输出走 hub 提示词
if (compactionService.summarize === nativeSummarize) throw new Error('hub compactor not installed')
const hubSummary = await compactionService.summarize({ messages: [] }, agent)
console.log('hub compact:', hubSummary.llmStreamCall, hubSummary.summary[0].text.slice(0, 12))
if (hubSummary.llmStreamCall !== true) throw new Error('hub summarize envelope missing')

// 运行时切换命令
const off = await command.handler(invocation('compactor native'))
if (!off.text.includes('原生')) throw new Error('compactor native switch failed')
const on = await command.handler(invocation('compactor hub'))
if (!on.text.includes('hub 压缩器')) throw new Error('compactor hub switch failed')
if (compactionService.summarize === nativeSummarize) throw new Error('hub compactor not reinstalled')

// 失败回退：llm 返回空文本时必须落回原生
const originalStream = llm.stream
llm.stream = () => (async function* () { yield { type: 'text-delta', text: '' } })()
const fallback = await compactionService.summarize({ messages: [] }, agent)
if (fallback.summary[0].text !== 'native summary') throw new Error('hub compactor fallback failed')
llm.stream = originalStream

const searchTool = tools.get('context_hub_search')
const searched = await searchTool.execute({ query: 'SQLite 记忆' }, { agent })
console.log('tool search:', JSON.stringify(searched.text).slice(0, 120))
if (!searched.text.includes('SQLite')) throw new Error('extracted memory not searchable')

// 压缩 A/B：不触碰 compaction 服务，仅两次模型调用
const abTool = tools.get('context_hub_abtest')
const ab = await abTool.execute({ messages: 10 }, { agent, signal: new AbortController().signal })
console.log('abtest   :', ab.text.split('\n')[0], '|', ab.text.split('\n')[3])
if (!ab.text.includes('压缩 A/B')) throw new Error('abtest failed')

const historyTool = tools.get('context_hub_history')
const history = await historyTool.execute({ query: '中文回答' }, { agent })
console.log('tool history:', JSON.stringify(history.text).slice(0, 120))
if (!history.text.includes('seq 0')) throw new Error('history search failed')

// W3：区间原文还原（工具 + 命令）
const restoreInjected = []
const restoreAgent = { session, options: {}, inject(message) { restoreInjected.push(message) } }
const restoreTool = tools.get('context_hub_restore')
const deferred = []
const restoredByTool = await restoreTool.execute(
  { start: 0, end: 2, maxChars: 2000 },
  { agent: restoreAgent, deferContext(message) { deferred.push(message) } },
)
if (!restoredByTool.text.includes('已还原')) throw new Error('restore tool failed')
if (deferred.length !== 1 || deferred[0].source.form !== 'relay') throw new Error('restore relay source missing')
const restoredByCommand = await command.handler({
  agent: restoreAgent,
  signal: new AbortController().signal,
  commandId: 'restore-1',
  rawInput: 'restore 0 2',
})
if (!restoredByCommand.text.includes('已还原')) throw new Error('restore command failed')
if (restoreInjected.length !== 1 || restoreInjected[0].source.form !== 'relay') throw new Error('restore command injection missing')
console.log('restore :', restoredByCommand.text)

const status = await command.handler(invocation('status'))
console.log('status:\n' + status.text)
if (!status.text.includes('记忆：')) throw new Error('status missing memory section')
if (!status.text.includes('召回 6 条/1200 字符')) throw new Error('status missing recall config')
if (!status.text.includes('active')) throw new Error('status missing active counts')

// 冲突：同主题、仅一个词不同的两条 fact，应 supersede 旧条目
const longA = '部署流程规定构建产物统一放在 dist 目录，先运行 pnpm build 生成静态文件，再用 rsync 同步到生产服务器的 /srv/app 路径。'
const longB = longA.replace('dist', 'out')
const rememberA = await command.handler(invocation('remember ' + longA))
const supersededId = Number(rememberA.text.match(/#(\d+)/)?.[1] ?? 0)
if (supersededId === 0) throw new Error('remember id missing')
await command.handler(invocation('remember ' + longB))
const conflictStatus = await command.handler(invocation('status'))
console.log('conflict:', conflictStatus.text.split('\n').find(line => line.startsWith('记忆：')))
if (!conflictStatus.text.includes('superseded 1')) throw new Error('conflict supersede failed')

// 召回调试：给出候选与打分明细
const explained = await command.handler(invocation('explain 中文回答'))
console.log('explain:', explained.text.split('\n')[0])
if (!explained.text.includes('召回调试')) throw new Error('explain failed')

// FTS5 旁路：英文子串只在 FTS 命中（"gres" 不是关键词词元）
const ftsSeed = await command.handler(invocation('remember postgresql 连接池默认 10 个连接。'))
const ftsId = Number(ftsSeed.text.match(/#(\d+)/)?.[1] ?? 0)
const ftsHit = await command.handler(invocation('search gres'))
console.log('fts     :', ftsHit.text.split('\n')[0], '-> #' + ftsId)
if (!ftsHit.text.includes(`#${ftsId} `)) throw new Error('fts hybrid search failed')

// 检索探针：从记忆自造查询并统计命中率
const probeTool = tools.get('context_hub_probe')
const probed = await probeTool.execute({ limit: 5 }, { agent })
console.log('probe   :', probed.text.split('\n')[0])
if (!probed.text.includes('命中率')) throw new Error('probe failed')

// 向量旁路：查询与记忆没有共享词元，只能靠 embedding 命中
{
  const embedDb = fileURLToPath(new URL('./tmp-smoke-embed.db', import.meta.url))
  rmSync(embedDb, { force: true })
  const previousDb = process.env.DSH_CONTEXT_HUB_DB
  process.env.DSH_CONTEXT_HUB_DB = embedDb
  const tools2 = new Map()
  const commands2 = new Map()
  const session2 = { id: 'embed-session', header: { cwd: '/tmp/project' }, seq: 0, eventAt() { return undefined } }
  const agent2 = { session: session2, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    const data = body.input.map((text, index) => ({
      index,
      embedding: String(text).includes('蓝鲸') ? [1, 0] : [0.9, 0.1],
    }))
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const rwCtx = {
    logger: { info: () => {}, warn: message => console.log('[warn]', message) },
    get(name) {
      if (name === 'agents') return { get: id => (id === 'embed-session' ? agent2 : undefined) }
      if (name === 'sessions') return { get: id => (id === 'embed-session' ? session2 : undefined) }
      if (name === 'llm') return llm
      if (name === 'tokenMeter') return ctx.get('tokenMeter')
      if (name === 'connection') return ctx.get('connection')
      return undefined
    },
    tools: { register(definition) { tools2.set(definition.name, definition) } },
    commands: { register(definition) { commands2.set(definition.name, definition) } },
    on() {},
    inject(_dependencies, callback) { callback(rwCtx) },
    effect() {},
  }
  apply(rwCtx, {
    embedding: { enabled: true, baseUrl: 'http://fake.local/v1', model: 'fake-embed', minScore: 0.3, timeoutMs: 1000 },
  })
  const cmd2 = commands2.get('context-hub')
  const call2 = rawInput => ({ agent: agent2, signal: new AbortController().signal, commandId: 'cmd-2', rawInput })
  const seeded = await cmd2.handler(call2('remember 项目代号蓝鲸需要双周同步。'))
  const embedId = Number(seeded.text.match(/#(\d+)/)?.[1] ?? 0)
  await sleep(50)
  const semantic = await cmd2.handler(call2('search 海洋哺乳动物计划的节奏'))
  const explained2 = await cmd2.handler(call2('explain 海洋哺乳动物计划的节奏'))
  console.log('embed   :', semantic.text.split('\n')[0], '-> #' + embedId)
  if (!semantic.text.includes(`#${embedId} `)) throw new Error('embedding recall failed')
  if (!explained2.text.includes('向量 +')) throw new Error('embedding explain missing vector part')
  if (previousDb === undefined) delete process.env.DSH_CONTEXT_HUB_DB
  else process.env.DSH_CONTEXT_HUB_DB = previousDb
}

// 审计链：被冲突替换的旧条目应显示 superseded 与后继
const audit = await command.handler(invocation(`audit ${supersededId}`))
console.log('audit:', audit.text.split('\n')[0])
if (!audit.text.includes('superseded')) throw new Error('audit missing superseded status')

// 显式 supersede：新条目替换旧条目，链上可追
const replaced = await command.handler(invocation(`supersede ${supersededId} 部署统一用 out 目录，构建后同步到生产。`))
console.log('supersede:', replaced.text)
if (!replaced.text.includes('替换')) throw new Error('supersede failed')
const chain = await command.handler(invocation(`audit ${supersededId}`))
if (!chain.text.includes('↳')) throw new Error('audit chain missing successor')

// forget：软删除后不再计入 active
const newId = Number(chain.text.match(/↳ #(\d+)/)?.[1] ?? 0)
if (newId === 0) throw new Error('successor id missing')
const forgotten = await command.handler(invocation(`forget ${newId}`))
console.log('forget:', forgotten.text)
if (!forgotten.text.includes('已删除')) throw new Error('forget failed')
const afterForget = await command.handler(invocation('status'))
if (!afterForget.text.includes('active')) throw new Error('status after forget failed')

// 观测日志与导出
const log = await command.handler(invocation('log 12'))
console.log('log:', log.text.split('\n').slice(0, 2).join(' | '))
if (!log.text.includes('召回')) throw new Error('log missing recall event: ' + log.text.slice(0, 200))
const exported = await command.handler(invocation('export'))
console.log('export:', exported.text)
const exportPath = exported.text.split('到 ')[1]
if (!exportPath || !existsSync(exportPath)) throw new Error('export file missing')
const payload = JSON.parse(readFileSync(exportPath, 'utf8'))
if (!Array.isArray(payload.memories) || !Array.isArray(payload.events)) throw new Error('export payload bad')

// 探针：命令与工具共用报告；status 显示最近一次探针
const probe = await command.handler(invocation('probe 5'))
console.log('probe:', probe.text.split('\n')[0])
if (!probe.text.includes('检索探针')) throw new Error('probe command failed')
const statusAfterProbe = await command.handler(invocation('status'))
if (!statusAfterProbe.text.includes('探针：最近')) throw new Error('status missing last probe')

// 面板路由：GET /api/context-hub.status 返回 JSON 快照
const route = routes.find(item => item.path === '/api/context-hub.status')
if (route === undefined) throw new Error('status route missing')
const response = await route.fetch(new Request('http://localhost/api/context-hub.status?sessionId=session-1'))
const snapshot = await response.json()
if (snapshot.ok !== true) throw new Error('status snapshot not ok')
if (snapshot.session === null || snapshot.session.nodes === 0) throw new Error('status snapshot session missing')
if ((snapshot.memory?.active ?? 0) < 1) throw new Error('status snapshot memory missing')
if (!Array.isArray(snapshot.memory.recent) || !Array.isArray(snapshot.activity)) throw new Error('status snapshot shape bad')
if (!Array.isArray(snapshot.memory.pendingItems)) throw new Error('status snapshot pendingItems missing')
console.log('route:', snapshot.session.totalTokens, snapshot.memory.active, snapshot.compactor)

// 1.6.5：面板改配置（action=config）——写 kv、立即生效、非法值 400
const cfgActionRoute = routes.find(item => item.path === '/api/context-hub.action')
if (cfgActionRoute === undefined) throw new Error('action route missing')
const postCfg = body => cfgActionRoute.fetch(new Request('http://localhost/api/context-hub.action', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))
const cfgResp = await postCfg({ action: 'config', key: 'recallMaxItems', value: 7 })
const cfgBody = await cfgResp.json()
if (cfgBody.ok !== true || cfgBody.value !== 7) throw new Error('config set failed: ' + JSON.stringify(cfgBody))
const cfgSnap = await (await route.fetch(new Request('http://localhost/api/context-hub.status?sessionId=session-1'))).json()
if (cfgSnap.config.recallMaxItems !== 7) throw new Error('config not applied to snapshot: ' + cfgSnap.config.recallMaxItems)
const cfgBad = await postCfg({ action: 'config', key: 'sessionTtlDays', value: 5 })
if (cfgBad.status !== 400) throw new Error('invalid enum accepted: ' + cfgBad.status)
const cfgBadInt = await postCfg({ action: 'config', key: 'recallMaxChars', value: 'abc' })
if (cfgBadInt.status !== 400) throw new Error('invalid int accepted: ' + cfgBadInt.status)
const cfgDb2 = new DatabaseSync(dbPath)
const cfgRow2 = cfgDb2.prepare("SELECT value FROM kv WHERE key = 'config:recallMaxItems'").get()
const cfgEvent2 = cfgDb2.prepare("SELECT COUNT(*) AS n FROM context_events WHERE kind = 'config-change'").get()
cfgDb2.close()
if (cfgRow2 === undefined || cfgRow2.value !== '7') throw new Error('config not persisted: ' + JSON.stringify(cfgRow2))
if (Number(cfgEvent2?.n ?? 0) < 1) throw new Error('config-change event missing')
await postCfg({ action: 'config', key: 'recallMaxItems', value: 8 })
console.log('config  : recallMaxItems -> 7, persisted, invalid -> 400')
const compNativeResp = await postCfg({ action: 'compactor', value: 'native' })
const compNativeBody = await compNativeResp.json()
if (compNativeBody.ok !== true || compNativeBody.active !== false) throw new Error('compactor native failed: ' + JSON.stringify(compNativeBody))
if (compactionService.summarize !== nativeSummarize) throw new Error('compactor native did not restore summarize')
const compHubResp = await postCfg({ action: 'compactor', value: 'hub' })
const compHubBody = await compHubResp.json()
if (compHubBody.ok !== true || compHubBody.active !== true) throw new Error('compactor hub failed: ' + JSON.stringify(compHubBody))
if (compactionService.summarize === nativeSummarize) throw new Error('compactor hub did not wrap summarize')
const compSnap = await (await route.fetch(new Request('http://localhost/api/context-hub.status?sessionId=session-1'))).json()
if (compSnap.compactor !== 'hub') throw new Error('snapshot compactor not hub: ' + compSnap.compactor)
console.log('compactor: native ⇄ hub, snapshot/hub persisted')

// W2：记忆关系（memory_links）与一跳扩展
await command.handler(invocation('remember 蓝鲸项目使用 sqlite 存储向量。'))
await command.handler(invocation('remember 蓝鲸项目使用 sqlite 存储记忆。'))
const neighborExplain = await command.handler(invocation('explain 向量'))
if (!neighborExplain.text.includes('邻居扩展')) throw new Error('neighbor expansion missing: ' + neighborExplain.text)
console.log('neighbor:', neighborExplain.text.split('\n').find(line => line.includes('邻居扩展'))?.trim())
await command.handler(invocation('export'))
const exportDir = fileURLToPath(new URL('./exports', import.meta.url))
const exportFiles = readdirSync(exportDir).filter(name => name.endsWith('.json')).sort()
const linkPayload = JSON.parse(readFileSync(`${exportDir}/${exportFiles.at(-1)}`, 'utf8'))
if (!Array.isArray(linkPayload.links) || linkPayload.links.length === 0) throw new Error('memory links missing in export')
console.log('links   :', linkPayload.links.length, '条（exports/', exportFiles.at(-1), '）')

// W3：原生压缩摘要落成可检索记忆
const summaryEvent = {
  type: 'compaction/summary',
  seq: 4,
  data: {
    compactionId: 'compaction-1',
    summary: [{ type: 'text', text: '## 摘要\n压缩摘要测验标记 umbrella-42：阶段 B 已开始，保持六条召回与 1200 字符预算。' }],
    shadowedRange: { start: 0, end: 3 },
    shadowedTokenCount: 4321,
  },
}
sessionEvents.push(summaryEvent)
session.seq = 5
emitEvent(listeners, 'session/event', session, summaryEvent)
await sleep(20)
const summarySearch = await command.handler(invocation('search umbrella-42'))
if (!summarySearch.text.includes('umbrella-42')) throw new Error('summary capture failed: ' + summarySearch.text)
console.log('summary :', summarySearch.text.split('\n')[1] ?? summarySearch.text.split('\n')[0])

// W4：llm/stream 逐请求采样（只观察不改写），插件自身的辅助调用被过滤
const streamHandler = firstHandler(listeners, 'llm/stream')
if (typeof streamHandler !== 'function') throw new Error('llm/stream listener missing')
let streamed = 0
for await (const _chunk of streamHandler(
  { provider: 'fake', model: 'fake-model', sessionId: 'session-1', messages: [{ role: 'user', content: [{ type: 'text', text: '观测我' }] }], system: 'sys', tools: [{ name: 'x' }] },
  () => (async function* () { yield { type: 'text-delta', text: 'ok' } })(),
)) streamed += 1
if (streamed !== 1) throw new Error('llm/stream passthrough failed')
for await (const _chunk of streamHandler(
  { provider: 'fake', model: 'fake-model', messages: [], purpose: 'context-hub:extract' },
  () => (async function* () { /* 辅助调用无输出 */ })(),
)) { /* drain */ }
const statusAfter = await command.handler(invocation('status'))
if (!statusAfter.text.includes('请求：')) throw new Error('request sampling missing from status')
console.log('request :', statusAfter.text.split('\n').find(line => line.startsWith('请求：')))
const responseAfter = await route.fetch(new Request('http://localhost/api/context-hub.status?sessionId=session-1'))
const snapshotAfter = await responseAfter.json()
if (!Array.isArray(snapshotAfter.requests) || snapshotAfter.requests.length === 0) throw new Error('status snapshot requests missing')
if (!snapshotAfter.requests.some(item => item.lanes !== undefined)) throw new Error('request lanes missing')
if (!(snapshotAfter.memory.kinds?.summary >= 1)) throw new Error('status snapshot summary kind missing')

// 抽取游标持久化：重载后不应重抽同样的历史（用第二个 ctx 模拟插件重启）
const listeners2 = new Map()
const tools2 = new Map()
const commands2 = new Map()
const rwCtx = {
  logger: { info: () => {}, warn: message => console.log('[warn]', message) },
  get(name) {
    if (name === 'agents') return { get: id => (id === 'session-1' ? agent : undefined) }
    if (name === 'compaction') return compactionService
    if (name === 'llm') return llm
    if (name === 'sessions') return { get: id => (id === 'session-1' ? session : undefined) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    if (name === 'tokenMeter') return { measure: () => ({ surfaceTokens: 0, totalTokens: 0, nodes: [] }), contextPressure: () => ({}) }
    return undefined
  },
  tools: { register(definition) { tools2.set(definition.name, definition) } },
  commands: { register(definition) { commands2.set(definition.name, definition) } },
  on(event, handler) { return addListener(listeners2, event, handler) },
  inject(_dependencies, callback) { callback(rwCtx) },
  effect() {},
}
const callsBefore = llmCalls
apply(rwCtx, { recallMaxItems: 6, recallMaxChars: 1200, extractPassesPerTurn: 1, compactor: 'native' })
emitEvent(listeners2, 'session/event', session, turnEnd)
await sleep(30)
if (llmCalls !== callsBefore) throw new Error('extraction cursor not persisted across reload')
console.log('cursor:', 'persisted')

// W5：审核流（reviewPending=true 时，抽取的低置信记忆先入 pending）
const reviewDb = fileURLToPath(new URL('./tmp-smoke-review.db', import.meta.url))
rmSync(reviewDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = reviewDb
const reviewEvents = []
const reviewRoutes = []
const reviewSession = { id: 'session-3', header: { cwd: '/tmp/project' }, seq: 0, eventAt(seq) { return reviewEvents[seq] } }
const reviewAgent = { session: reviewSession, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
const reviewTools = new Map()
const reviewCommands = new Map()
const reviewListeners = new Map()
const reviewLlm = {
  stream() {
    return (async function* () {
      yield { type: 'text-delta', text: '[{"kind":"fact","text":"项目代号 Orca 的部署窗口固定在每周四凌晨两点，变更需提前一天冻结并通知 oncall。","tags":["ops"]}]' }
    })()
  },
}
const ctx3 = {
  logger: { info: () => {}, warn: message => console.log('[warn]', message) },
  get(name) {
    if (name === 'agents') return { get: id => (id === 'session-3' ? reviewAgent : undefined) }
    if (name === 'llm') return reviewLlm
    if (name === 'sessions') return { get: id => (id === 'session-3' ? reviewSession : undefined) }
    if (name === 'tokenMeter') return { measure: () => ({ surfaceTokens: 10, totalTokens: 10, nodes: [] }), contextPressure: () => ({}) }
    if (name === 'connection') return { fetch: { register(route) { reviewRoutes.push(route); return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register(definition) { reviewTools.set(definition.name, definition) } },
  commands: { register(definition) { reviewCommands.set(definition.name, definition) } },
  on(event, handler) { return addListener(reviewListeners, event, handler) },
  inject(_dependencies, callback) { callback(ctx3) },
  effect() {},
}
apply(ctx3, { reviewPending: true, extractPassesPerTurn: 1 })
const reviewUser = { type: 'user/message', seq: 0, data: { role: 'user', content: [{ type: 'text', text: '项目代号 Orca 的部署窗口固定在每周四凌晨两点，变更需提前一天冻结并通知 oncall。'.repeat(2) }], source: { kind: 'user' } } }
reviewEvents.push(reviewUser)
reviewSession.seq = 1
const reviewTurnEnd = { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } }
reviewEvents.push(reviewTurnEnd)
reviewSession.seq = 2
emitEvent(reviewListeners, 'session/event', reviewSession, reviewTurnEnd)
await sleep(40)
const reviewCmd = reviewCommands.get('context-hub')
const reviewInvocation = rawInput => ({ agent: reviewAgent, signal: new AbortController().signal, commandId: 'cmd-review', rawInput })
const pendingList = await reviewCmd.handler(reviewInvocation('review'))
if (!pendingList.text.includes('待审核')) throw new Error('pending review missing: ' + pendingList.text)
const pendingId = Number(pendingList.text.match(/#(\d+)/)?.[1] ?? 0)
const reviewRoute = reviewRoutes.find(item => item.path === '/api/context-hub.review')
if (reviewRoute === undefined) throw new Error('review route missing')
const reviewResponse = await reviewRoute.fetch(new Request('http://localhost/api/context-hub.review', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'approve', id: pendingId }),
}))
const reviewBody = await reviewResponse.json()
if (reviewBody.ok !== true || reviewBody.id !== pendingId) throw new Error('review route approve failed: ' + JSON.stringify(reviewBody))
const reviewSearch = await reviewCmd.handler(reviewInvocation('search 部署窗口'))
if (!reviewSearch.text.includes('Orca')) throw new Error('approved memory not searchable: ' + reviewSearch.text)
const reviewedId = Number((reviewSearch.text.match(/#(\d+)/) ?? [])[1])
const actionRoute = reviewRoutes.find(item => item.path === '/api/context-hub.action')
if (actionRoute === undefined) throw new Error('action route missing')
const supersedeResp = await actionRoute.fetch(new Request('http://localhost/api/context-hub.action', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'supersede', id: reviewedId, text: '项目代号 Orca 的部署窗口改为周五凌晨三点，变更需提前两天。' }),
}))
const supersedeBody = await supersedeResp.json()
if (supersedeBody.ok !== true || supersedeBody.newId === undefined) throw new Error('action supersede failed: ' + JSON.stringify(supersedeBody))
const forgetResp = await actionRoute.fetch(new Request('http://localhost/api/context-hub.action', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'forget', id: supersedeBody.newId }),
}))
const forgetBody = await forgetResp.json()
if (forgetBody.ok !== true) throw new Error('action forget failed: ' + JSON.stringify(forgetBody))
const modeResp = await actionRoute.fetch(new Request('http://localhost/api/context-hub.action', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'mode', value: 'observe' }),
}))
const modeBody = await modeResp.json()
if (modeBody.ok !== true || modeBody.value !== 'observe') throw new Error('action mode failed: ' + JSON.stringify(modeBody))
console.log('review  :', `pending #${pendingId} → approve → supersede → forget → mode ok`)
process.env.DSH_CONTEXT_HUB_DB = dbPath

// 1.2.0 W3：水位压缩（配置 enabled 后 pre-step 主动选区间调 compactRegion）
const wmCmd = commands.get('context-hub')
const wmOn = await wmCmd.handler(invocation('watermark on'))
if (!wmOn.text.includes('已开启水位压缩')) throw new Error('watermark on failed: ' + wmOn.text)
pressureTokens = 80000
sessionEvents[9] = { type: 'user/message', seq: 9, data: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(80000) }], source: { kind: 'user' } } }
session.seq = 10
session.surface = { nodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }
await emitWaterfall(listeners, 'agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind: 'continue' }))
if (compactCalls.length !== 1) throw new Error('watermark did not compact: ' + compactCalls.length)
console.log('watermark:', `compactRegion(${compactCalls[0][0]}, ${compactCalls[0][1]})`)

// 1.2.0：水位开关持久化 + HTTP 路由
const wmRoutes = routes.find(item => item.path === '/api/context-hub.watermark')
if (wmRoutes === undefined) throw new Error('watermark route missing')
const wmPost = await wmRoutes.fetch(new Request('http://localhost/api/context-hub.watermark', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enabled: false }),
}))
const wmPostBody = await wmPost.json()
if (wmPostBody.ok !== true || wmPostBody.enabled !== false) throw new Error('watermark route toggle failed: ' + JSON.stringify(wmPostBody))
const wmDb = new DatabaseSync(dbPath)
const wmRow = wmDb.prepare("SELECT value FROM kv WHERE key = 'watermark.enabled'").get()
wmDb.close()
if (wmRow === undefined || wmRow.value !== '0') throw new Error('watermark switch not persisted: ' + JSON.stringify(wmRow))
console.log('watermark switch:', 'POST /api/context-hub.watermark -> off, persisted')

// 持久化恢复：把开关置 on 后，新 ctx 启动应自动安装 pre-step 水位监听
const wmOnResp = await wmRoutes.fetch(new Request('http://localhost/api/context-hub.watermark', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enabled: true }),
}))
if ((await wmOnResp.json()).enabled !== true) throw new Error('watermark route on failed')
const wmListeners = new Map()
const wmCtx = {
  logger: { info() {}, warn() {}, error() {} },
  get(name) { return name === 'agents' ? { get: () => agent } : name === 'tokenMeter' ? { measure: () => ({ surfaceTokens: 0, totalTokens: 0, nodes: [] }), contextPressure: () => ({}) } : undefined },
  on(event, handler) { return addListener(wmListeners, event, handler) },
  effect() {},
  tools: { register() {} },
  commands: { register() {} },
  inject(_dependencies, callback) { callback(wmCtx) },
}
apply(wmCtx, { compactor: 'native' })
if ((wmListeners.get('agent/pre-step') ?? []).length === 0) throw new Error('watermark switch not restored on startup')
console.log('watermark switch:', 'restored on startup from kv')

// 1.2.0 W1：查询改写（LLM 扩同义词，失败回退原查询）
const rw2Tools = new Map()
const rw2Commands = new Map()
const rw2Llm = {
  stream() {
    return (async function* () {
      yield { type: 'text-delta', index: 0, text: '同义 改写 词' }
    })()
  },
}
const rw2Ctx = {
  logger: { info: () => {}, warn: () => {} },
  get(name) {
    if (name === 'agents') return { get: () => ({ session, options: { provider: 'fake', model: 'fake-model' } }) }
    if (name === 'llm') return rw2Llm
    if (name === 'tokenMeter') return { measure: () => ({ surfaceTokens: 1, totalTokens: 1, nodes: [] }), contextPressure: () => ({ pressureTokens: 1, contextWindow: 100 }) }
    return undefined
  },
  tools: { register(definition) { rw2Tools.set(definition.name, definition) } },
  commands: { register(definition) { rw2Commands.set(definition.name, definition) } },
  on() {},
  inject(_dependencies, callback) { callback(rw2Ctx) },
  effect() {},
}
apply(rw2Ctx, { rewrite: { enabled: true, provider: 'fake', model: 'fake-model' } })
const rewriteCmd = rw2Commands.get('context-hub')
const explainOut = await rewriteCmd.handler({ agent: { ...agent, session }, signal: new AbortController().signal, commandId: 'cmd-rw', rawInput: 'explain 中文回答应该怎么写更自然' })
if (!explainOut.text.includes('改写：同义 改写 词')) throw new Error('rewrite missing: ' + explainOut.text.slice(0, 200))
console.log('rewrite :', 'explain 带改写行 ok')

// 1.2.1 可选 LLM 重排：模型给 [2,1] 时首条应变成 #2
const rkDb = fileURLToPath(new URL('./tmp-smoke-rerank.db', import.meta.url))
rmSync(rkDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = rkDb
const rkTools = new Map()
const rkCommands = new Map()
const rkLlm = {
  stream(options) {
    const prompt = options?.messages?.[0]?.content?.[0]?.text ?? ''
    const line = prompt.split('\n').find(row => row.includes('beta two')) ?? '1)'
    const n = Number((line.match(/^(\d+)\)/) ?? [])[1] ?? 1)
    return (async function* () {
      yield { type: 'text-delta', index: 0, text: `[${n}]` }
    })()
  },
}
const rkCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: () => ({ session, options: { provider: 'fake', model: 'fake-model' } }) }
    if (name === 'llm') return rkLlm
    if (name === 'tokenMeter') return { measure: () => ({ surfaceTokens: 1, totalTokens: 1, nodes: [] }), contextPressure: () => ({ pressureTokens: 1, contextWindow: 100 }) }
    return undefined
  },
  tools: { register(definition) { rkTools.set(definition.name, definition) } },
  commands: { register(definition) { rkCommands.set(definition.name, definition) } },
  on() {},
  inject(_dependencies, callback) { callback(rkCtx) },
  effect() {},
}
apply(rkCtx, { rerank: { enabled: true, provider: 'fake', model: 'fake-model' } })
const rkCmd = rkCommands.get('context-hub')
const rkInvocation = rawInput => ({ agent: { ...agent, session }, signal: new AbortController().signal, commandId: 'cmd-rk', rawInput })
const rkA = await rkCmd.handler(rkInvocation('remember qqq alpha one'))
const rkB = await rkCmd.handler(rkInvocation('remember qqq beta two'))
const betaId = Number((rkB.text.match(/#(\d+)/) ?? [])[1])
const rkOut = await rkCmd.handler(rkInvocation('search qqq'))
const rerankedIds = [...rkOut.text.matchAll(/- \[#(\d+)/g)].map(m => Number(m[1]))
if (rerankedIds.length < 2) throw new Error('rerank candidates too short: ' + rkOut.text.slice(0, 120))
if (rerankedIds[0] !== betaId) throw new Error(`rerank order not applied: want #${betaId} first, got ${rerankedIds}`)
const rkLog = await rkCmd.handler(rkInvocation('log 20'))
if (!rkLog.text.includes('重排')) throw new Error('rerank event missing: ' + rkLog.text.slice(0, 300))
console.log('rerank  :', `LLM 顺序生效（首条 #${betaId}）`)
rmSync(rkDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = dbPath

// B1：doctor 自检输出档位与推荐配置
const doctor = await command.handler(invocation('doctor'))
if (!doctor.text.includes('档位')) throw new Error('doctor missing tier: ' + doctor.text)
if (!doctor.text.includes('推荐配置')) throw new Error('doctor missing recommended config')
console.log('doctor  :', doctor.text.split('\n')[0])

// C2：按最近一次压缩摘要还原原文并注入
const summaryId = Number((summarySearch.text.match(/#(\d+)/) ?? [])[1])
const beforeDecompress = injected.length
const decompressed = await command.handler(invocation(`decompress id:${summaryId}`))
if (!decompressed.text.includes('已还原')) throw new Error('decompress failed: ' + decompressed.text)
if (injected.length !== beforeDecompress + 1 || injected.at(-1)?.source?.form !== 'relay') throw new Error('decompress injection missing')
console.log('decompress:', decompressed.text)

// C1：接管分级可切换并显示在 status
const modeFull = await command.handler(invocation('mode full'))
if (!modeFull.text.includes('full')) throw new Error('mode full failed: ' + modeFull.text)
const modeStatus = await command.handler(invocation('status'))
if (!modeStatus.text.includes('模式 full')) throw new Error('status missing mode: ' + modeStatus.text.split('\n').slice(-2).join('\n'))
const modeObserve = await command.handler(invocation('mode observe'))
if (!modeObserve.text.includes('observe')) throw new Error('mode observe failed: ' + modeObserve.text)
console.log('mode    :', 'full -> observe ok')

// A2：抽取结果回指到原始消息（message_seq / sentence_no）
const a2Db = dbPath + '.a2'
rmSync(a2Db, { force: true })
process.env.DSH_CONTEXT_HUB_DB = a2Db
const a2Events = []
const a2Injected = []
const a2Session = { id: 'session-a2', header: { cwd: '/tmp/project' }, seq: 0, eventAt(seq) { return a2Events[seq] } }
const a2Agent = { session: a2Session, options: { provider: 'fake', model: 'fake-model' }, inject(message) { a2Injected.push(message) } }
const a2Llm = {
  stream() {
    return (async function* () {
      yield { type: 'text-delta', index: 0, text: '[{"kind":"decision","text":"部署窗口固定在每周三晚上10点之后，变更需提前一天。","tags":["ops"]}]' }
    })()
  },
}
const a2Tools = new Map()
const a2Commands = new Map()
const a2Listeners = new Map()
const a2Ctx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: id => (id === 'session-a2' ? a2Agent : undefined) }
    if (name === 'llm') return a2Llm
    if (name === 'sessions') return { get: id => (id === 'session-a2' ? a2Session : undefined) }
    if (name === 'tokenMeter') return { measure: () => ({ surfaceTokens: 10, totalTokens: 10, nodes: [] }), contextPressure: () => ({}) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register(definition) { a2Tools.set(definition.name, definition) } },
  commands: { register(definition) { a2Commands.set(definition.name, definition) } },
  on(event, handler) { return addListener(a2Listeners, event, handler) },
  inject(_dependencies, callback) { callback(a2Ctx) },
  effect() {},
}
apply(a2Ctx, {})
const a2User = { type: 'user/message', seq: 0, data: { role: 'user', content: [{ type: 'text', text: '部署窗口固定在每周三晚上十点之后，请记住。'.repeat(4) }], source: { kind: 'user' } } }
a2Events.push(a2User)
a2Session.seq = 1
const a2Assistant = { type: 'assistant/message', seq: 1, data: { role: 'assistant', content: [{ type: 'text', text: '好的，部署窗口固定在每周三晚上十点之后，变更需提前一天。'.repeat(4) }], source: { kind: 'model', provider: 'fake', model: 'fake-model' } } }
a2Events.push(a2Assistant)
a2Session.seq = 2
const a2FirstQuery = { type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: '部署窗口是什么时候，变更要提前多久？' }], source: { kind: 'user' } } }
a2Events.push(a2FirstQuery)
a2Session.seq = 3
emitEvent(a2Listeners, 'session/event', a2Session, a2FirstQuery)
await sleep(30)
const a2MessageOnly = a2Injected.at(-1)?.content?.[0]?.text ?? ''
if (!a2MessageOnly.includes('原文窗口 seq')) throw new Error('message index recall missing: ' + a2MessageOnly)
if (!a2MessageOnly.includes('部署窗口')) throw new Error('message index recall content missing')
console.log('msgindex:', '零记忆时按消息索引召回')
const a2TurnEnd = { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } }
a2Events.push(a2TurnEnd)
a2Session.seq = 4
emitEvent(a2Listeners, 'session/event', a2Session, a2TurnEnd)
await sleep(50)
const a2Cmd = a2Commands.get('context-hub')
const a2Invocation = rawInput => ({ agent: a2Agent, signal: new AbortController().signal, commandId: 'cmd-a2', rawInput })
const a2Search = await a2Cmd.handler(a2Invocation('search 部署窗口'))
const a2Id = Number((a2Search.text.match(/#(\d+)/) ?? [])[1])
const a2Audit = await a2Cmd.handler(a2Invocation(`audit ${a2Id}`))
if (!a2Audit.text.includes('消息 seq')) throw new Error('A2 message evidence missing: ' + a2Audit.text)
console.log('evidence:', `#${a2Id} 回指原始消息`)

// B2 阶段 2：召回按来源消息聚合，并带 ±1 句原文窗口
const a2RecallEvent = { type: 'user/message', seq: 4, data: { role: 'user', content: [{ type: 'text', text: '部署窗口是什么时候，变更要提前多久？' }], source: { kind: 'user' } } }
a2Events.push(a2RecallEvent)
a2Session.seq = 5
emitEvent(a2Listeners, 'session/event', a2Session, a2RecallEvent)
await sleep(30)
const a2RecallText = a2Injected.at(-1)?.content?.[0]?.text ?? ''
if (!a2RecallText.includes('原文窗口 seq')) throw new Error('B2 message window missing: ' + a2RecallText)
if (!a2RecallText.includes('部署窗口')) throw new Error('B2 recall content missing')
console.log('window  :', '召回按消息聚合 + 原文窗口')

rmSync(a2Db, { force: true })
process.env.DSH_CONTEXT_HUB_DB = dbPath


// C3：retainTurns 接管——只折叠最后 N 轮之前的最旧前缀
const rtDb = dbPath + '.rt'
rmSync(rtDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = rtDb
const rtEvents = []
for (let i = 0; i < 6; i += 1) {
  rtEvents.push({
    type: i % 2 === 0 ? 'user/message' : 'assistant/message',
    seq: i,
    data: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: `turn ${i} text` }], source: { kind: i % 2 === 0 ? 'user' : 'model' } },
  })
}
const rtSession = { id: 'session-rt', header: { cwd: '/tmp/project' }, seq: 6, eventAt(seq) { return rtEvents[seq] }, surface: { nodes: [0, 1, 2, 3, 4, 5] } }
const rtCalls = []
const rtListeners = new Map()
const rtCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 900, contextWindow: 1000 }) }
    if (name === 'compaction') return { compactRegion: async (start, end) => { rtCalls.push([start, end]); return { shadowedTokenCount: 100, shadowedRange: { start, end } } } }
    if (name === 'agents') return { get: () => ({ session: rtSession }) }
    if (name === 'sessions') return { get: () => rtSession }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register() {} },
  commands: { register() {} },
  on(event, handler) { return addListener(rtListeners, event, handler) },
  inject(_dependencies, callback) { callback(rtCtx) },
  effect() {},
}
apply(rtCtx, { watermark: { enabled: true, triggerRatio: 0.3, retainTurns: 2, minRegionNodes: 2 } })
await emitWaterfall(rtListeners, 'agent/pre-step', { agent: { session: rtSession }, signal: new AbortController().signal }, async () => ({}))
if (rtCalls.length !== 1) throw new Error('retainTurns watermark did not run: ' + JSON.stringify(rtCalls))
if (rtCalls[0][0] !== 0 || rtCalls[0][1] !== 1) throw new Error('retainTurns range wrong: ' + JSON.stringify(rtCalls))
console.log('takeover:', `retainTurns=2 -> compactRegion(${rtCalls[0][0]}, ${rtCalls[0][1]})`)
rmSync(rtDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = dbPath

// 抽取分片：每 pass 最多 8000 字符；2 次/轮应覆盖到第三条消息
const chunkDb = fileURLToPath(new URL('./tmp-smoke-chunk.db', import.meta.url))
rmSync(chunkDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = chunkDb
const chunkEvents = []
const chunkPrompts = []
const chunkListeners = new Map()
const chunkSession = { id: 'session-chunk', header: { cwd: '/tmp/project' }, seq: 0, eventAt(seq) { return chunkEvents[seq] } }
const chunkAgent = { session: chunkSession, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
const chunkCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: () => chunkAgent }
    if (name === 'sessions') return { get: () => chunkSession }
    if (name === 'llm') return {
      stream(options) {
        chunkPrompts.push(options.messages[0].content[0].text)
        return (async function* () { yield { type: 'text-delta', text: '[]' } })()
      },
    }
    if (name === 'tokenMeter') return { measure: () => ({ surfaceTokens: 10, totalTokens: 10, nodes: [] }), contextPressure: () => ({}) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register() {} },
  commands: { register() {} },
  on(event, handler) { return addListener(chunkListeners, event, handler) },
  inject(_dependencies, callback) { callback(chunkCtx) },
  effect() {},
}
apply(chunkCtx, { extractPassesPerTurn: 2 })
for (let index = 0; index < 3; index += 1) {
  chunkEvents.push({ type: 'user/message', seq: index, data: { role: 'user', content: [{ type: 'text', text: `${'x'.repeat(4000)}MARK-${index}` }], source: { kind: 'user' } } })
}
chunkSession.seq = 3
const chunkEnd = { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } }
chunkEvents.push(chunkEnd)
chunkSession.seq = 4
emitEvent(chunkListeners, 'session/event', chunkSession, chunkEnd)
await sleep(40)
if (chunkPrompts.length !== 2) throw new Error('extraction chunking did not run twice: ' + chunkPrompts.length)
if (!chunkPrompts[0].includes('MARK-0') || chunkPrompts[0].includes('MARK-2')) throw new Error('first pass range wrong')
if (!chunkPrompts[1].includes('MARK-2')) throw new Error('second pass did not continue from cursor')
console.log('chunk:', '2 passes, first covers MARK-0/1, second covers MARK-2')
rmSync(chunkDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = dbPath


// 1.6.0 ①：召回注入 token 硬顶（粗估）+ 超时旁路
const capDb = fileURLToPath(new URL('./tmp-smoke-cap.db', import.meta.url))
rmSync(capDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = capDb
const capTools = new Map()
const capCommands = new Map()
const capListeners = new Map()
const capInjected = []
const capEvents = []
const capSession = { id: 'session-cap', header: { cwd: '/tmp/project' }, seq: 0, eventAt(seq) { return capEvents[seq] } }
const capAgent = { session: capSession, options: { provider: 'fake', model: 'fake-model' }, inject(message) { capInjected.push(message) } }
const capCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: () => capAgent }
    if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 1000 }), measure: () => ({ surfaceTokens: 10, totalTokens: 20, nodes: [] }) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register(definition) { capTools.set(definition.name, definition) } },
  commands: { register(definition) { capCommands.set(definition.name, definition) } },
  on(event, handler) { return addListener(capListeners, event, handler) },
  inject(_dependencies, callback) { callback(capCtx) },
  effect() {},
}
apply(capCtx, { recallMaxTokens: 100, recallMaxChars: 8000, recallTimeoutMs: 0, embedding: { enabled: false }, rewrite: { enabled: false }, rerank: { enabled: false } })
const capExec = { agent: capAgent, signal: new AbortController().signal, token: {} }
for (let index = 0; index < 4; index += 1) {
  await capTools.get('context_hub_remember').execute({ text: `部署窗口固定在每周三晚上十点之后，变更需提前一天（第${index}条备注）。`, kind: 'fact' }, capExec)
}
const capEvent = { type: 'user/message', seq: 0, data: { role: 'user', content: [{ type: 'text', text: '部署窗口固定在每周三晚上十点之后吗？' }], source: { kind: 'user' } } }
capEvents.push(capEvent)
capSession.seq = 1
emitEvent(capListeners, 'session/event', capSession, capEvent)
await sleep(40)
const capText = capInjected.at(-1)?.content?.[0]?.text ?? ''
const capLimit = Math.floor(100 * 1.6)
if (capText.length === 0 || capText.length > capLimit) throw new Error(`recall token cap overflow: ${capText.length} > ${capLimit}`)
if (!capText.includes('部署窗口')) throw new Error('recall cap test lost content')
console.log('captokens:', `${capText.length} 字符 ≤ ${capLimit}（硬顶 100 tokens，截断生效）`)

// 超时旁路：改写慢于预算时，本次不注入，只记 recall-timeout
const capTimeoutDb = fileURLToPath(new URL('./tmp-smoke-timeout.db', import.meta.url))
rmSync(capTimeoutDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = capTimeoutDb
const slowTools = new Map()
const slowCommands = new Map()
const slowListeners = new Map()
const slowInjected = []
const slowEvents = []
const slowSession = { id: 'session-slow', header: { cwd: '/tmp/project' }, seq: 0, eventAt(seq) { return slowEvents[seq] } }
const slowAgent = { session: slowSession, options: { provider: 'fake', model: 'fake-model' }, inject(message) { slowInjected.push(message) } }
const slowLlm = {
  stream() {
    return (async function* () {
      await sleep(800)
      yield { type: 'text-delta', index: 0, text: '慢 改写' }
    })()
  },
}
const slowCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: () => slowAgent }
    if (name === 'llm') return slowLlm
    if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 1000 }), measure: () => ({ surfaceTokens: 10, totalTokens: 20, nodes: [] }) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register(definition) { slowTools.set(definition.name, definition) } },
  commands: { register(definition) { slowCommands.set(definition.name, definition) } },
  on(event, handler) { return addListener(slowListeners, event, handler) },
  inject(_dependencies, callback) { callback(slowCtx) },
  effect() {},
}
apply(slowCtx, {
  recallMaxTokens: 1200,
  recallTimeoutMs: 300,
  embedding: { enabled: false },
  rewrite: { enabled: true, provider: 'fake', model: 'fake-model', timeoutMs: 1200 },
  rerank: { enabled: false },
})
const slowExec = { agent: slowAgent, signal: new AbortController().signal, token: {} }
await slowTools.get('context_hub_remember').execute({ text: '部署窗口固定在每周三晚上十点之后。', kind: 'fact' }, slowExec)
const slowEvent = { type: 'user/message', seq: 0, data: { role: 'user', content: [{ type: 'text', text: '部署窗口固定在每周三晚上十点之后吗？' }], source: { kind: 'user' } } }
slowEvents.push(slowEvent)
slowSession.seq = 1
emitEvent(slowListeners, 'session/event', slowSession, slowEvent)
await sleep(1100)
if (slowInjected.length !== 0) throw new Error('recall should skip injection after deadline')
const timeoutDb = new DatabaseSync(capTimeoutDb)
const timeoutRows = timeoutDb.prepare("SELECT COUNT(*) AS n FROM context_events WHERE kind = 'recall-timeout'").get()
timeoutDb.close()
if (timeoutRows.n !== 1) throw new Error('recall-timeout not logged: ' + timeoutRows.n)
console.log('timeout :', '慢改写超预算 → 本次不注入，记 recall-timeout')

// 1.6.0 ②：git 身份做 project（跨机器一致）+ 旧 cwd 行迁移
const gitDb = fileURLToPath(new URL('./tmp-smoke-git.db', import.meta.url))
const gitRepo = fileURLToPath(new URL('./tmp-git-repo', import.meta.url))
rmSync(gitDb, { force: true })
rmSync(gitRepo, { recursive: true, force: true })
mkdirSync(gitRepo, { recursive: true })
execFileSync('git', ['init', '-q', gitRepo])
execFileSync('git', ['-C', gitRepo, 'remote', 'add', 'origin', 'git@github.com:Foo/Bar.git'])
process.env.DSH_CONTEXT_HUB_DB = gitDb
const gitTools = new Map()
const gitCommands = new Map()
const gitListeners = new Map()
const gitSession = { id: 'session-git', header: { cwd: gitRepo }, seq: 0, eventAt() { return undefined } }
const gitAgent = { session: gitSession, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
let gitCtx
gitCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: () => gitAgent }
    if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 1000 }), measure: () => ({ surfaceTokens: 10, totalTokens: 20, nodes: [] }) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register(definition) { gitTools.set(definition.name, definition) } },
  commands: { register(definition) { gitCommands.set(definition.name, definition) } },
  on(event, handler) { return addListener(gitListeners, event, handler) },
  inject(_dependencies, callback) { callback(gitCtx) },
  effect() {},
}
apply(gitCtx, { projectIdentity: 'cwd', embedding: { enabled: false }, rewrite: { enabled: false }, rerank: { enabled: false } })
const gitExec = { agent: gitAgent, signal: new AbortController().signal, token: {} }
await gitTools.get('context_hub_remember').execute({ text: '部署窗口固定在每周三晚上十点之后。', kind: 'fact' }, gitExec)
const gitDbConn = new DatabaseSync(gitDb)
const beforeRow = gitDbConn.prepare('SELECT project FROM memories ORDER BY id DESC LIMIT 1').get()
if (beforeRow.project !== gitRepo) throw new Error('cwd project not stored: ' + JSON.stringify(beforeRow))
gitDbConn.close()
apply(gitCtx, { projectIdentity: 'git', embedding: { enabled: false }, rewrite: { enabled: false }, rerank: { enabled: false } })
await gitTools.get('context_hub_search').execute({ query: '部署窗口' }, gitExec)
const gitDbConn2 = new DatabaseSync(gitDb)
const afterRow = gitDbConn2.prepare('SELECT project FROM memories ORDER BY id DESC LIMIT 1').get()
const migrateRow = gitDbConn2.prepare("SELECT COUNT(*) AS n FROM context_events WHERE kind = 'project-migrate'").get()
gitDbConn2.close()
if (afterRow.project !== 'git:github.com/foo/bar') throw new Error('git project key wrong: ' + JSON.stringify(afterRow))
if (migrateRow.n !== 1) throw new Error('project migration not logged')
console.log('project :', `cwd → git:github.com/foo/bar（迁移 ${migrateRow.n} 次）`)
rmSync(gitRepo, { recursive: true, force: true })

// 1.6.0 ③：消息级可逆折叠（unfold 用原文临时替代压缩摘要）
const ufDb = fileURLToPath(new URL('./tmp-smoke-unfold.db', import.meta.url))
rmSync(ufDb, { force: true })
process.env.DSH_CONTEXT_HUB_DB = ufDb
const ufTools = new Map()
const ufCommands = new Map()
const ufListeners = new Map()
const ufEvents = []
const ufSession = {
  id: 'session-unfold',
  header: { cwd: '/tmp/project' },
  seq: 0,
  eventAt(seq) { return ufEvents[seq] },
}
const ufAgent = { session: ufSession, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
const ufCtx = {
  logger: { info() {}, warn() {} },
  get(name) {
    if (name === 'agents') return { get: () => ufAgent }
    if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 1000 }), measure: () => ({ surfaceTokens: 10, totalTokens: 20, nodes: [] }) }
    if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
    return undefined
  },
  tools: { register(definition) { ufTools.set(definition.name, definition) } },
  commands: { register(definition) { ufCommands.set(definition.name, definition) } },
  on(event, handler) { return addListener(ufListeners, event, handler) },
  inject(_dependencies, callback) { callback(ufCtx) },
  effect() {},
}
apply(ufCtx, { embedding: { enabled: false }, rewrite: { enabled: false }, rerank: { enabled: false } })
ufEvents.push({ type: 'user/message', seq: 0, data: { role: 'user', content: [{ type: 'text', text: 'ORIGINAL-0 部署窗口固定在周三。' }], source: { kind: 'user' } } })
ufEvents.push({ type: 'assistant/message', seq: 1, data: { role: 'assistant', content: [{ type: 'text', text: 'ORIGINAL-1 好的，记下了。' }], source: { kind: 'model', provider: 'fake', model: 'fake-model' } } })
ufEvents.push({ type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: 'ORIGINAL-2 变更要提前一天。' }], source: { kind: 'user' } } })
ufEvents.push({ type: 'assistant/message', seq: 3, data: { role: 'assistant', content: [{ type: 'text', text: 'ORIGINAL-3 明白。' }], source: { kind: 'model', provider: 'fake', model: 'fake-model' } } })
ufEvents.push({ type: 'compaction/summary', seq: 4, data: { compactionId: 'cmp-1', summary: [{ type: 'text', text: '摘要：部署窗口相关。' }], shadowedSeqs: [0, 1, 2, 3], shadowedRange: { start: 0, end: 3 }, shadowedTokenCount: 20 } })
ufSession.seq = 5
const ufExec = { agent: ufAgent, signal: new AbortController().signal, token: {} }
const ufResult = await ufTools.get('context_hub_unfold').execute({ start: 0, end: 2, steps: 2, maxChars: 1000 }, ufExec)
const ufText = ufResult?.text ?? String(ufResult)
if (!ufText.includes('已展开')) throw new Error('unfold tool failed: ' + ufText)
const checkpointMessage = { id: 'cp-msg', role: 'user', content: [{ type: 'text', text: '摘要：部署窗口相关。' }], source: { kind: 'compact-checkpoint', compactionId: 'cmp-1' } }
const ufDecision = await emitWaterfall(
  ufListeners,
  'agent/pre-step',
  { agent: ufAgent, signal: new AbortController().signal, turn: 1, step: 1, messages: [], modelSelection: {} },
  async () => ({ kind: 'enter', messages: [checkpointMessage], startsRequestSeries: true }),
)
const unfolded = ufDecision.messages?.[0]
if (unfolded?.source?.form !== 'unfold') throw new Error('unfold replacement missing: ' + JSON.stringify(unfolded?.source))
if (!unfolded.content?.[0]?.text?.includes('ORIGINAL-0')) throw new Error('unfold text missing original content')
console.log('unfold  :', 'checkpoint 摘要 → 原文 relay（2 步预算）')

process.env.DSH_CONTEXT_HUB_DB = dbPath


// ---- P0：默认值、遗忘墓碑、session 作用域隔离 ----
{
  if (defaults.recallMaxItems !== 8 || defaults.recallMaxChars !== 1800 || defaults.recallCooldownTurns !== 6 || defaults.extractPassesPerTurn !== 2) {
    throw new Error(`default budget drift: ${defaults.recallMaxItems}/${defaults.recallMaxChars}/${defaults.recallCooldownTurns}/${defaults.extractPassesPerTurn}`)
  }
  console.log('defaults:', '召回 8/1800、冷却 6、抽取 2')

  const p0Db = fileURLToPath(new URL('./tmp-smoke-p0.db', import.meta.url))
  rmSync(p0Db, { force: true })
  process.env.DSH_CONTEXT_HUB_DB = p0Db
  const p0Tools = new Map()
  const p0Commands = new Map()
  const p0Listeners = new Map()
  function p0Session(id) {
    return { id, header: { cwd: '/tmp/project-p0' }, seq: 0, eventAt() { return undefined } }
  }
  function p0Agent(session) {
    return { session, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
  }
  const p0AgentA = p0Agent(p0Session('session-p0-A'))
  const p0Ctx = {
    logger: { info() {}, warn() {} },
    get(name) {
      if (name === 'agents') return { get: id => (id === 'session-p0-A' ? p0AgentA : undefined) }
      if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 1, contextWindow: 1000 }), measure: () => ({ surfaceTokens: 1, totalTokens: 2, nodes: [] }) }
      if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
      return undefined
    },
    tools: { register(definition) { p0Tools.set(definition.name, definition) } },
    commands: { register(definition) { p0Commands.set(definition.name, definition) } },
    on(event, handler) { return addListener(p0Listeners, event, handler) },
    inject(_deps, callback) { callback(p0Ctx) },
    effect() {},
  }
  apply(p0Ctx, { embedding: { enabled: false }, rewrite: { enabled: false }, rerank: { enabled: false } })
  const text = value => (typeof value === 'string' ? value : value?.text ?? '')
  const execA = { agent: p0AgentA, signal: new AbortController().signal, token: {} }

  const first = await p0Tools.get('context_hub_remember').execute({ text: 'P0-墓碑-口令 ORCA-42', kind: 'fact' }, execA)
  const firstId = Number(text(first).match(/#(\d+)/)?.[1])
  if (!Number.isFinite(firstId)) throw new Error(`remember did not return id: ${text(first)}`)
  await p0Commands.get('context-hub').handler({ agent: p0AgentA, signal: new AbortController().signal, commandId: 'p0-forget', rawInput: `forget ${firstId}` })
  await p0Tools.get('context_hub_remember').execute({ text: 'P0-墓碑-口令 ORCA-42', kind: 'fact' }, execA)
  const p0Check = new DatabaseSync(p0Db)
  const tombstone = p0Check.prepare('SELECT status FROM memories WHERE id = ?').get(firstId)
  p0Check.close()
  if (tombstone === undefined || tombstone.status !== 'deleted') throw new Error(`forgotten memory was resurrected: ${JSON.stringify(tombstone)}`)
  console.log('tombstone:', `#${firstId} 保持 deleted，未被同文写入复活`)

  await p0Tools.get('context_hub_remember').execute({ text: 'P0-会话隔离-口令 ZULU-77', kind: 'fact' }, execA)
  const p0AgentB = p0Agent(p0Session('session-p0-B'))
  const execB = { agent: p0AgentB, signal: new AbortController().signal, token: {} }
  const seenA = text(await p0Tools.get('context_hub_search').execute({ query: 'ZULU-77' }, execA))
  const seenB = text(await p0Tools.get('context_hub_search').execute({ query: 'ZULU-77' }, execB))
  if (!seenA.includes('P0-会话隔离-口令')) throw new Error(`session A search missed own memory: ${seenA}`)
  if (seenB.includes('P0-会话隔离-口令')) throw new Error('session-scope memory leaked into another session')
  console.log('isolation:', 'session 记忆只在原会话可见')
}

// ---- P1/P2：图谱 1-hop 与压缩账本 ----
{
  const gDb = fileURLToPath(new URL('./tmp-smoke-graph.db', import.meta.url))
  rmSync(gDb, { force: true })
  process.env.DSH_CONTEXT_HUB_DB = gDb
  const gTools = new Map()
  const gCommands = new Map()
  const gListeners = new Map()
  const gSession = { id: 'session-graph', header: { cwd: '/tmp/project-graph' }, seq: 12, eventAt() { return undefined } }
  const gAgent = { session: gSession, options: { provider: 'fake', model: 'fake-model' }, inject() {} }
  const gCtx = {
    logger: { info() {}, warn() {} },
    get(name) {
      if (name === 'agents') return { get: id => (id === 'session-graph' ? gAgent : undefined) }
      if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 10, contextWindow: 1000 }), measure: () => ({ surfaceTokens: 10, totalTokens: 20, nodes: [] }) }
      if (name === 'connection') return { fetch: { register() { return () => Promise.resolve() } } }
      return undefined
    },
    tools: { register(definition) { gTools.set(definition.name, definition) } },
    commands: { register(definition) { gCommands.set(definition.name, definition) } },
    on(event, handler) { return addListener(gListeners, event, handler) },
    inject(_deps, callback) { callback(gCtx) },
    effect() {},
  }
  apply(gCtx, { embedding: { enabled: false }, rewrite: { enabled: false }, rerank: { enabled: false } })
  const gExec = { agent: gAgent, signal: new AbortController().signal, token: {} }
  const a = await gTools.get('context_hub_remember').execute({ text: '图谱-蓝鲸-部署窗口在周三', tags: '蓝鲸,部署', kind: 'fact' }, gExec)
  const b = await gTools.get('context_hub_remember').execute({ text: '图谱-蓝鲸-回滚演练在周四', tags: '蓝鲸', kind: 'task' }, gExec)
  if (!String(a.text).includes('#') || !String(b.text).includes('#')) throw new Error('graph seed insert failed')
  const gCheck = new DatabaseSync(gDb)
  const entityCount = gCheck.prepare('SELECT COUNT(*) AS n FROM entities').get().n
  const edgeCount = gCheck.prepare('SELECT COUNT(*) AS n FROM entity_links').get().n
  const via = gCheck.prepare("SELECT GROUP_CONCAT(DISTINCT e.name) AS names FROM entity_links el JOIN entities e ON e.id = el.entity_id").get()
  if (entityCount < 2 || edgeCount < 2 || !String(via.names).includes('蓝鲸')) throw new Error(`graph seed missing: ${entityCount}/${edgeCount}/${via.names}`)
  const statusA1 = String((await gTools.get('context_hub_status').execute({}, gExec)).text)
  if (!statusA1.includes('图谱：')) throw new Error('status missing graph line')
  await emitEvent(gListeners, 'session/event', gSession, {
    type: 'compaction/summary',
    data: {
      compactionId: 'cmp-smoke-1',
      summary: [{ type: 'text', text: '图谱与账本冒烟摘要：保留部署窗口在每周三晚十点之后、回滚演练在周四下午两个关键约束，并记录负责人 p7 与端口 5432。' }],
      shadowedRange: { start: 0, end: 5 },
      shadowedSeqs: [0, 1, 2, 3, 4, 5],
      shadowedTokenCount: 1000,
    },
  })
  await sleep(15)
  const ledger = gCheck.prepare('SELECT * FROM compaction_ledger').all()
  if (ledger.length !== 1 || Number(ledger[0].saved_tokens) <= 0) throw new Error(`ledger missing: ${JSON.stringify(ledger)}`)
  const statusA2 = String((await gTools.get('context_hub_status').execute({}, gExec)).text)
  if (!statusA2.includes('压缩账本：1 次折叠')) throw new Error(`status missing ledger line: ${statusA2.slice(0, 200)}`)
  gCheck.close()
  console.log('graph  :', `${entityCount} 实体 / ${edgeCount} 链接（共享实体 ${via.names}）`)
  console.log('ledger :', `1 次折叠，省 ${ledger[0].saved_tokens} tokens`)
}

// cache：写入后同一查询必须看到新记忆（缓存失效）
{
  const cacheDb = fileURLToPath(new URL('./tmp-smoke-cache.db', import.meta.url))
  const cacheStore = new MemoryStore(cacheDb, resolveConfig({ recallMaxItems: 5, recallMaxChars: 1200 }))
  cacheStore.open()
  cacheStore.insert({ kind: 'fact', text: '缓存测试：蓝鲸项目使用 sqlite 存记忆', project: 'cache-p', scope: 'project', source: 'explicit' })
  const first = cacheStore.search('蓝鲸 sqlite', { project: 'cache-p' })
  cacheStore.insert({ kind: 'fact', text: '缓存测试补充：蓝鲸项目新增 redis 缓存层', project: 'cache-p', scope: 'project', source: 'explicit' })
  const second = cacheStore.search('蓝鲸 sqlite', { project: 'cache-p' })
  if (first.length === 0 || second.length <= first.length) throw new Error('search cache not invalidated on insert')
  cacheStore.close()
  rmSync(cacheDb, { force: true })
}

// backfill：清空实体链接后启动回填能恢复，且只做一次
{
  const backDb = fileURLToPath(new URL('./tmp-smoke-back.db', import.meta.url))
  const backStore = new MemoryStore(backDb, resolveConfig({}))
  backStore.open()
  const memory = backStore.insert({ kind: 'fact', text: '回填测试：项目代号蓝鲸部署在 k8s', tags: ['蓝鲸','部署'], project: 'back-p', source: 'explicit' })
  backStore.db.prepare('DELETE FROM entity_links').run()
  backStore.db.prepare("DELETE FROM kv WHERE key = 'entities.backfill'").run()
  const linked = backStore.backfillEntities()
  const again = backStore.backfillEntities()
  if (linked === 0 || again !== 0) throw new Error(`backfill expected once, got ${linked}/${again}`)
  backStore.close()
  rmSync(backDb, { force: true })
}
console.log('SMOKE OK')
