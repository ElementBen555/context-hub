/**
 * 规模化验证：造 N 条记忆 + M 条消息，测 open/写入/FTS/召回/探针的延迟与库体积。
 * 与 stress.mjs 的区别：多项目、多会话、三种 scope、带消息索引，更接近真实负载。
 * 用法：node scripts/scale.mjs [memories=100000] [messages=20000]
 * 只用于本机评估，不参与插件运行。
 */
import { statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, resolveConfig } from '../src/index.js'

const rowCount = Number(process.argv[2] ?? 100000)
const msgCount = Number(process.argv[3] ?? 20000)
const db = join(tmpdir(), `context-hub-scale-${process.pid}.db`)
rmSync(db, { force: true })
for (const suffix of ['-wal', '-shm']) rmSync(`${db}${suffix}`, { force: true })

const config = resolveConfig({ recallMaxItems: 6, recallMaxChars: 1200, recallMaxTokens: 1200 })
const store = new MemoryStore(db, config)
const results = {}
const timed = (label, fn) => {
  const start = performance.now()
  const value = fn()
  const ms = performance.now() - start
  results[label] = Number(ms.toFixed(1))
  console.log(`${label}: ${ms.toFixed(0)}ms`)
  return value
}

timed('open_empty', () => store.open())

const projects = Array.from({ length: 20 }, (_, i) => `proj-${i}`)
const sessions = Array.from({ length: 50 }, (_, i) => `sess-${i}`)
const kinds = ['decision', 'fact', 'preference', 'task', 'skill']
// 用真实表结构写入（不经过 insert()，避免每行一次 addLink 的额外开销）
const insert = store.db.prepare(`
  INSERT INTO memories
    (hash, kind, text, tags, project, scope, session_id, confidence, source, evidence_seq,
     status, created_at, last_used, uses, embedding, embedding_model)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'extract', ?, 'active', ?, 0, 0, '', '')
`)

const textFor = i => {
  const project = projects[i % projects.length]
  const session = sessions[i % sessions.length]
  const module = i % 200
  const port = 3000 + (i % 500)
  const owner = `p${i % 40}`
  switch (i % 5) {
    case 0:
      return `项目 ${project} 的模块 ${module} 决定使用 ${port} 端口，负责人 ${owner}，依据压测记录 ${i}。`
    case 1:
      return `项目 ${project} 的事实：会话 ${session} 中模块 ${module} 的部署窗口是周${i % 7}，负责人 ${owner}。`
    case 2:
      return `用户偏好：${project} 相关任务优先使用 pnpm，避免 npm，记录编号 ${i}。`
    case 3:
      return `任务：为 ${project} 的模块 ${module} 补齐监控与告警，截止第 ${i % 52} 周，负责人 ${owner}。`
    default:
      return `技能：处理 ${project} 模块 ${module} 的发布时先跑 smoke 再灰度，参考记录 ${i}。`
  }
}
const scopeFor = i => (i % 10 === 0 ? 'session' : i % 10 <= 6 ? 'project' : 'global')
const nowSec = Math.floor(Date.now() / 1000)

timed('insert_memories', () => {
  store.db.exec('BEGIN')
  for (let i = 0; i < rowCount; i += 1) {
    const createdAt = nowSec - (i % 63072000) // 最长两年前
    insert.run(
      `scale-${i}`,
      kinds[i % kinds.length],
      textFor(i),
      `scale,${projects[i % projects.length]}`,
      projects[i % projects.length],
      scopeFor(i),
      sessions[i % sessions.length],
      0.6 + (i % 5) / 10,
      `${i}-${i + 10}`,
      createdAt,
    )
  }
  store.db.exec('COMMIT')
})

timed('insert_messages', () => {
  const insertMsg = store.db.prepare(`
    INSERT INTO messages (session_id, seq, role, text, project, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  store.db.exec('BEGIN')
  for (let i = 0; i < msgCount; i += 1) {
    insertMsg.run(
      sessions[i % sessions.length],
      i,
      i % 2 === 0 ? 'user' : 'assistant',
      `消息 ${i}：${textFor(i)}`,
      projects[i % projects.length],
      nowSec - i,
    )
  }
  store.db.exec('COMMIT')
})

timed('fts_rebuild', () => store.rebuildFts())

const project = 'proj-7'
const queries = [
  '部署窗口 模块 42',
  '端口 3500 负责人 p7',
  '优先使用 pnpm',
  '补齐监控与告警',
  '发布 smoke 灰度',
  '会话 sess-13 部署',
  '模块 199 任务',
  '用户偏好 部署',
  'proj-7 模块 100',
  '压测记录 90000',
]
const latencies = []
let miss = 0
for (let round = 0; round < 5; round += 1) {
  for (const query of queries) {
    const start = performance.now()
    const hits = store.search(query, { limit: 6, project, includeAll: false })
    latencies.push(performance.now() - start)
    if (hits.length === 0) miss += 1
  }
}
latencies.sort((a, b) => a - b)
const pct = q => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]
results.rank_n = latencies.length
results.rank_p50 = Number(pct(0.5).toFixed(1))
results.rank_p95 = Number(pct(0.95).toFixed(1))
results.rank_p99 = Number(pct(0.99).toFixed(1))
results.rank_max = Number(latencies.at(-1).toFixed(1))
results.rank_miss = miss
console.log(`rank: n=${latencies.length} p50=${results.rank_p50}ms p95=${results.rank_p95}ms p99=${results.rank_p99}ms miss=${miss}`)

const probeStart = performance.now()
const probe = store.probe({ limit: 200, project })
results.probe_ms = Number((performance.now() - probeStart).toFixed(1))
results.probe_total = probe.total
results.probe_hits = probe.hits
results.probe_rate = Number(probe.rate.toFixed(3))
console.log(`probe: ${probe.hits}/${probe.total} (${(probe.rate * 100).toFixed(1)}%) in ${results.probe_ms}ms`)

try {
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
} catch {}
results.db_bytes = statSync(db).size
try {
  results.wal_bytes = statSync(`${db}-wal`).size
} catch {
  results.wal_bytes = 0
}
results.rss_mb = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1))
results.rows = rowCount
results.messages = msgCount
results.journal = store.db.prepare('PRAGMA journal_mode').get().journal_mode

store.close()
for (const suffix of ['', '-wal', '-shm']) rmSync(`${db}${suffix}`, { force: true })

console.log(JSON.stringify(results, null, 2))
