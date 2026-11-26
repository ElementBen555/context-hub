#!/usr/bin/env node
/**
 * B3：可复跑的召回基准脚手架。
 *
 * 支持两种输入：
 *   1) 本仓库格式 { name, facts: [{id,text,kind?}], queries: [{query,expected:[id]}] }
 *   2) LongMemEval cleaned 格式（--format longmemeval [--limit N]）
 *      每个 session 作为一条事实（id=session_id），query=question，expected=answer_session_ids。
 *
 * 指标：recall@1/3/5/10、MRR、p50/p95。默认只跑词法；设置
 * DSH_CONTEXT_HUB_EMBED_URL / _MODEL 后加跑向量（写入回填 + 查询侧 cosine）。
 *
 * 用法：
 *   node scripts/eval/recall.mjs
 *   node scripts/eval/recall.mjs --dataset scripts/eval/zh-holdout.json
 *   node scripts/eval/recall.mjs --format longmemeval --dataset data/longmemeval_s_cleaned.json --limit 48
 *   node scripts/eval/recall.mjs --json
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MemoryStore, resolveConfig } from '../../src/index.js'
import { PROBES } from '../recall-bench.mjs'

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

function builtinDataset() {
  return {
    name: 'builtin-30',
    facts: PROBES.map(([text], index) => ({ id: `p${index}`, text, kind: 'fact' })),
    queries: PROBES.map(([, query], index) => ({ query, expected: [`p${index}`] })),
  }
}

function normalizeDataset(raw) {
  if (Array.isArray(raw?.facts) && Array.isArray(raw?.queries)) {
    return { name: raw.name ?? 'custom', facts: raw.facts, queries: raw.queries }
  }
  if (Array.isArray(raw?.cases)) {
    return {
      name: raw.name ?? 'cases',
      facts: raw.cases.map((item, index) => ({ id: `c${index}`, text: item.memory, kind: item.kind ?? 'fact' })),
      queries: raw.cases.map((item, index) => ({ query: item.query, expected: [item.expectedId ?? `c${index}`] })),
    }
  }
  throw new Error('数据集格式不识别：需要 facts+queries 或 cases')
}

function normalizeLongMemEval(raw, questionLimit) {
  const questions = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : []
  if (questions.length === 0) throw new Error('LongMemEval 数据为空或格式不识别')
  const picked = questionLimit === undefined ? questions : questions.slice(0, questionLimit)
  const cases = []
  for (const question of picked) {
    const expected = Array.isArray(question.answer_session_ids) ? question.answer_session_ids.map(String) : []
    if (expected.length === 0) continue
    const sessions = Array.isArray(question.haystack_sessions) ? question.haystack_sessions : []
    const sessionIds = Array.isArray(question.haystack_session_ids) ? question.haystack_session_ids.map(String) : []
    const facts = []
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index]
      if (!Array.isArray(session)) continue
      const id = String(sessionIds[index] ?? session.session_id ?? '')
      if (id.length === 0) continue
      const texts = session
        .map(message => (typeof message?.content === 'string' ? message.content : ''))
        .filter(text => text.length > 0)
      if (texts.length === 0) continue
      facts.push({ id, text: texts.join('\n').slice(0, 4000), kind: 'fact' })
    }
    if (facts.length === 0) continue
    cases.push({ query: String(question.question ?? ''), expected, facts })
  }
  return { name: 'longmemeval', cases }
}

async function runMode(mode, settings, dataset, file, limit) {
  const store = new MemoryStore(file, settings)
  store.open()
  const idMap = new Map()
  for (const fact of dataset.facts) {
    const result = store.insert({
      kind: fact.kind ?? 'fact',
      text: String(fact.text),
      scope: 'project',
      confidence: 1,
      source: 'explicit',
      evidence: `eval:${dataset.name}`,
    })
    if (result.action === 'inserted' && result.id !== undefined) idMap.set(String(fact.id), result.id)
  }
  if (mode === 'vector') {
    if (store.config.embedding.enabled !== true) {
      store.close()
      return { mode, skipped: 'embedding 未开启（检查 DSH_CONTEXT_HUB_EMBED_URL / _MODEL）' }
    }
    try {
      const ping = await store.embedTexts(['召回基准连通性检查'])
      if (ping.length === 0) throw new Error('端点返回空向量')
    } catch (error) {
      store.close()
      return { mode, skipped: `embedding 调用失败：${error instanceof Error ? error.message : String(error)}` }
    }
    await store.embedQueue
    await store.backfillEmbeddings()
  }

  const latencies = []
  const positions = []
  for (const item of dataset.queries) {
    const expected = new Set((item.expected ?? []).map(String).filter(id => idMap.has(id)).map(id => idMap.get(id)))
    if (expected.size === 0) continue
    const started = performance.now()
    const embVec = mode === 'vector' ? await store.embedQuery(item.query) : null
    const hits = store.rank(item.query, { limit, embVec })
    latencies.push(performance.now() - started)
    const position = hits.findIndex(hit => expected.has(hit.id))
    positions.push(position === -1 ? null : position + 1)
  }
  store.close()
  const total = positions.length
  const at = k => positions.filter(position => position !== null && position <= k).length
  const mrr = total === 0 ? 0 : positions.reduce((sum, position) => sum + (position === null ? 0 : 1 / position), 0) / total
  return {
    mode,
    total,
    recall1: at(1),
    recall3: at(3),
    recall5: at(5),
    recall10: at(10),
    mrr: Number(mrr.toFixed(3)),
    p50: Number(median(latencies).toFixed(1)),
    p95: Number(percentile(latencies, 95).toFixed(1)),
  }
}

async function embeddingReady(settings, file) {
  const store = new MemoryStore(file, settings)
  store.open()
  try {
    const vectors = await store.embedTexts(['召回基准连通性检查'])
    return vectors.length > 0
  } catch {
    return false
  } finally {
    store.close()
  }
}

async function runLongMemEval(mode, settings, dataset, dir, topK) {
  const positions = []
  const latencies = []
  let skipped = 0
  for (let index = 0; index < dataset.cases.length; index += 1) {
    const item = dataset.cases[index]
    const file = join(dir, `${mode}-lme-${index}.db`)
    const store = new MemoryStore(file, settings)
    store.open()
    const idMap = new Map()
    for (const fact of item.facts) {
      const result = store.insert({
        kind: 'fact',
        text: fact.text,
        scope: 'project',
        confidence: 1,
        source: 'explicit',
        evidence: 'longmemeval',
      })
      if (result.action === 'inserted' && result.id !== undefined) idMap.set(String(fact.id), result.id)
    }
    if (mode === 'vector') {
      if (store.config.embedding.enabled !== true) {
        store.close()
        return { mode, skipped: 'embedding 未开启（检查 DSH_CONTEXT_HUB_EMBED_URL / _MODEL）' }
      }
      await store.embedQueue
      await store.backfillEmbeddings()
    }
    const expected = new Set(item.expected.filter(id => idMap.has(id)).map(id => idMap.get(id)))
    if (expected.size === 0) {
      skipped += 1
      store.close()
      continue
    }
    const started = performance.now()
    const embVec = mode === 'vector' ? await store.embedQuery(item.query) : null
    const hits = store.rank(item.query, { limit: topK, embVec })
    latencies.push(performance.now() - started)
    const position = hits.findIndex(hit => expected.has(hit.id))
    positions.push(position === -1 ? null : position + 1)
    store.close()
  }
  const total = positions.length
  const at = k => positions.filter(position => position !== null && position <= k).length
  const mrr = total === 0 ? 0 : positions.reduce((sum, position) => sum + (position === null ? 0 : 1 / position), 0) / total
  return {
    mode,
    total,
    skippedCases: skipped,
    recall1: at(1),
    recall3: at(3),
    recall5: at(5),
    recall10: at(10),
    mrr: Number(mrr.toFixed(3)),
    p50: Number(median(latencies).toFixed(1)),
    p95: Number(percentile(latencies, 95).toFixed(1)),
  }
}

function printReport(name, results, limit) {  console.log(`召回基准：${name} · top-${limit}\n`)
  for (const result of results) {
    if (typeof result.skipped === 'string') {
      console.log(`${result.mode.padEnd(8)} 跳过 —— ${result.skipped}`)
      continue
    }
    const pct = value => (result.total === 0 ? 0 : Math.round((value / result.total) * 1000) / 10)
    console.log(
      `${result.mode.padEnd(8)} n=${result.total}` +
      ` · R@1 ${result.recall1}（${pct(result.recall1)}%）` +
      ` · R@3 ${result.recall3}（${pct(result.recall3)}%）` +
      ` · R@5 ${result.recall5}（${pct(result.recall5)}%）` +
      ` · R@10 ${result.recall10}（${pct(result.recall10)}%）` +
      ` · MRR ${result.mrr} · p50 ${result.p50}ms · p95 ${result.p95}ms`,
    )
  }
  console.log('\n口径：R@k = 期望条目是否落在前 k；MRR = 首个期望条目名次倒数；')
  console.log('      词法=关键词+FTS5+近义扩展；向量=同一 rank() 加 cosine。没有同环境同数据集的公开跑分，不把本结果当泛化结论。')
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name, fallback) => {
    const index = args.indexOf(name)
    return index === -1 || args[index + 1] === undefined ? fallback : args[index + 1]
  }
  const format = flag('--format', 'native')
  const datasetPath = flag('--dataset', '')
  const questionLimit = Number.parseInt(flag('--limit', '0'), 10)
  const topK = Number.parseInt(flag('--topk', '10'), 10) || 10
  const fusion = flag('--fusion', '')
  const minScore = Number.parseFloat(flag('--min-score', ''))
  const asJson = args.includes('--json')
  const longmemeval = format === 'longmemeval'
  let dataset
  if (longmemeval) {
    if (datasetPath === '' || !existsSync(resolve(datasetPath))) {
      throw new Error('LongMemEval 模式需要 --dataset 指向 longmemeval_s_cleaned.json；数据集不随包分发。')
    }
    const raw = JSON.parse(readFileSync(resolve(datasetPath), 'utf8'))
    dataset = normalizeLongMemEval(raw, Number.isFinite(questionLimit) && questionLimit > 0 ? questionLimit : undefined)
  } else if (datasetPath !== '') {
    dataset = normalizeDataset(JSON.parse(readFileSync(resolve(datasetPath), 'utf8')))
  } else {
    dataset = builtinDataset()
  }

  const dir = mkdtempSync(join(tmpdir(), 'hub-eval-'))
  try {
    const base = resolveConfig({})
    const lexicalSettings = { ...base, embedding: { ...base.embedding, enabled: false } }
    const lexical = longmemeval
      ? await runLongMemEval('lexical', lexicalSettings, dataset, dir, topK)
      : await runMode('lexical', lexicalSettings, dataset, join(dir, 'lexical.db'), topK)
    const url = process.env.DSH_CONTEXT_HUB_EMBED_URL
    const model = process.env.DSH_CONTEXT_HUB_EMBED_MODEL
    const results = [lexical]
    if (url && model) {
      const vectorSettings = resolveConfig({ embedding: { enabled: true, baseUrl: url, model, ...(fusion === '' ? {} : { fusion }), ...(Number.isFinite(minScore) ? { minScore } : {}) } })
      if (longmemeval) {
        if (await embeddingReady(vectorSettings, join(dir, 'probe.db'))) {
          results.push(await runLongMemEval('vector', vectorSettings, dataset, dir, topK))
        } else {
          results.push({ mode: 'vector', skipped: 'embedding 端点不可用' })
        }
      } else {
        results.push(await runMode('vector', vectorSettings, dataset, join(dir, 'vector.db'), topK))
      }
    } else {
      results.push({ mode: 'vector', skipped: '未设置 DSH_CONTEXT_HUB_EMBED_URL / _MODEL' })
    }
    if (asJson) console.log(JSON.stringify({ dataset: dataset.name, topK, results }, null, 2))
    else printReport(dataset.name, results, topK)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
