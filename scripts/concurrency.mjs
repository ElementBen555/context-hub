#!/usr/bin/env node
/**
 * W6：多进程并发写入验证。
 *
 * 三个子进程同时往同一个 SQLite 记忆库写（每个 300 条），主进程等待后校验：
 * 行数正确、`PRAGMA quick_check` 通过、WAL 生效、没有 SQLITE_BUSY 失败。
 *
 * 用法：node scripts/concurrency.mjs [workers] [rowsPerWorker]
 */
import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, resolveConfig } from '../src/index.js'

const isWorker = process.argv[2] === 'worker'

function settings() {
  return resolveConfig({})
}

if (isWorker) {
  const [, , , file, rowsText, baseText] = process.argv
  const rows = Number(rowsText)
  const base = Number(baseText)
  const store = new MemoryStore(file, settings())
  store.open()
  const started = performance.now()
  let inserted = 0
  for (let index = 0; index < rows; index += 1) {
    const result = store.insert({
      kind: 'fact',
      text: `并发写入 ${base + index}：子进程 ${base} 的第 ${index} 条记录，用于验证 WAL 下的锁等待与重试。`,
      scope: 'project',
      confidence: 1,
      source: 'explicit',
      evidence: 'concurrency',
    })
    if (result.action === 'inserted') inserted += 1
  }
  const elapsed = Math.round(performance.now() - started)
  store.close()
  process.stdout.write(JSON.stringify({ base, inserted, elapsed }))
  process.exit(0)
}

const workers = Number(process.argv[2] ?? 3)
const rows = Number(process.argv[3] ?? 300)
const dir = mkdtempSync(join(tmpdir(), 'hub-concurrency-'))
const file = join(dir, 'memory.db')

try {
  const seeded = new MemoryStore(file, settings())
  seeded.open()
  seeded.close()

  const started = performance.now()
  const results = await Promise.all(Array.from({ length: workers }, (_, index) => new Promise((resolve, reject) => {
    const child = fork(process.argv[1], ['worker', file, String(rows), String(index * rows)], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.on('error', reject)
    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`worker ${index} exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(output))
      } catch (error) {
        reject(new Error(`worker ${index} bad output: ${output.slice(0, 200)}`))
      }
    })
  })))
  const elapsed = Math.round(performance.now() - started)

  const store = new MemoryStore(file, settings())
  store.open()
  const total = store.db.prepare('SELECT COUNT(*) AS n FROM memories').get().n
  const quick = store.db.prepare('PRAGMA quick_check').get()
  const journal = store.db.prepare('PRAGMA journal_mode').get()
  store.close()

  const expected = workers * rows
  const inserted = results.reduce((sum, item) => sum + item.inserted, 0)
  console.log(`并发写入：${workers} 进程 × ${rows} 条`)
  for (const item of results) console.log(`  worker ${item.base}: ${item.inserted}/${rows} 条，${item.elapsed}ms`)
  console.log(`  合计插入 ${inserted}/${expected}，库内 ${total} 行，耗时 ${elapsed}ms`)
  console.log(`  quick_check: ${quick.quick_check}，journal_mode: ${journal.journal_mode}`)
  if (inserted !== expected || total !== expected) {
    console.error('FAIL：插入数与库内行数不一致（检查 busy_timeout / WAL）')
    process.exitCode = 1
  } else if (String(quick.quick_check) !== 'ok') {
    console.error('FAIL：quick_check 未通过')
    process.exitCode = 1
  } else {
    console.log('CONCURRENCY OK')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
