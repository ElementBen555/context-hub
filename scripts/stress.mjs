/**
 * 规模化压测（W6）：造 N 条记忆，测 rank/probe 的延迟与库大小。
 * 用法：node scripts/stress.mjs [rows=10000]
 * 只用于本机评估，不参与插件运行。
 */
import { statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, resolveConfig } from '../src/index.js'

const rows = Number(process.argv[2] ?? 10000)
const db = join(tmpdir(), `context-hub-stress-${process.pid}.db`)
rmSync(db, { force: true })
const config = resolveConfig({ recallMaxItems: 6, recallMaxChars: 1200 })
const store = new MemoryStore(db, config)
const mark = (label, start) => console.log(`${label}: ${(performance.now() - start).toFixed(0)}ms`)

let t = performance.now()
store.open()
mark('open (empty)', t)

const insert = store.db.prepare(`
  INSERT INTO memories (hash, kind, text, tags, project, scope, session_id, confidence, source, evidence_seq, status, created_at, last_used)
  VALUES (?, ?, ?, '', 'alpha', 'project', 's', 1, 'explicit', '', 'active', ?, 0)
`)
const hash = i => `stress-${i}`
t = performance.now()
store.db.exec('BEGIN')
for (let i = 0; i < rows; i += 1) {
  const text = `项目 alpha 模块 ${i % 50} 采用配置 ${i % 200} 的部署方式，记录编号 ${i}，负责人 p${i % 30}。`
  insert.run(hash(i), i % 5 === 0 ? 'decision' : 'fact', text, Math.floor(Date.now() / 1000) - i)
}
store.db.exec('COMMIT')
mark(`insert ${rows}`, t)

t = performance.now()
store.rebuildFts()
mark('fts rebuild', t)
console.log('journal:', store.db.prepare('PRAGMA journal_mode').get())

const queries = ['部署方式', '配置 42', '负责人 p7', '模块 12 记录', 'alpha 项目', '部署方式 编号']
const latencies = []
for (let round = 0; round < 20; round += 1) {
  for (const query of queries) {
    const start = performance.now()
    const hits = store.search(query, { limit: 6, project: 'alpha', includeAll: false })
    latencies.push(performance.now() - start)
    if (hits.length === 0) throw new Error(`no hit for ${query}`)
  }
}
latencies.sort((a, b) => a - b)
const p = q => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))].toFixed(1)
console.log(`rank: n=${latencies.length} p50=${p(0.5)}ms p95=${p(0.95)}ms max=${latencies.at(-1).toFixed(1)}ms`)

t = performance.now()
const probe = store.probe({ limit: 20 })
mark(`probe(${probe.total}) ${probe.hits}/${probe.total}`, t)
console.log('db size:', (statSync(db).size / 1024 / 1024).toFixed(1), 'MB')
store.close()
rmSync(db, { force: true })
rmSync(`${db}-wal`, { force: true })
rmSync(`${db}-shm`, { force: true })
