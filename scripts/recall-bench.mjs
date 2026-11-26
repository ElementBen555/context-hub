#!/usr/bin/env node
/**
 * 改写型召回基准（W1）。
 *
 * 30 条「记忆 → 改写查询」探针：查询与原句几乎不共享词元，用来量化
 * “关键词/FTS 能召回多少、语义路径能补多少”。默认只跑本地词法路径；
 * 配置了 embedding 端点后加跑向量路径，并给两条路径的对照。
 *
 * 用法：
 *   node scripts/recall-bench.mjs                 # 词法基线
 *   DSH_CONTEXT_HUB_EMBED_URL=http://127.0.0.1:8080/v1 \
 *   DSH_CONTEXT_HUB_EMBED_MODEL=bge-m3 \
 *   node scripts/recall-bench.mjs                 # 词法 + 真实向量对照
 *
 * 端点必须是 OpenAI 兼容的 /embeddings（脚本会在缺后缀时自动补）。
 * 探针与记忆都写在临时库，不碰 ~/.dsh/context-hub/memory.db。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MemoryStore, resolveConfig } from '../src/index.js'

/** 记忆句 + 几乎无词元重叠的改写查询。 */
export const PROBES = [
  ['压缩优先复用原生 compaction 服务，不新增第二套折叠器。', '折叠历史时先走内置机制'],
  ['记忆库默认放在用户主目录的隐藏文件夹。', '数据文件位置在 ~ 下的点目录里'],
  ['每次召回最多六条，总字符不超过一千二。', '注入条数与长度都有硬上限'],
  ['会话级条目七天后过期，项目和全局更久。', '临时事实一周后自动清理'],
  ['冲突默认新证据胜出，决策之间并列。', '两者矛盾时以更晚证据为准'],
  ['审核流默认关闭，避免阻塞自动写入。', '人工把关功能初始不启用'],
  ['中文检索要处理两个字以上的词组。', '双字片段得能搜到'],
  ['面板每十秒刷新一次，关闭即停止轮询。', '界面轮询间隔为十秒'],
  ['导出文件权限设为仅所有者可读。', '备份文件权限收紧到本人'],
  ['压缩器失败时回退到原生实现并记录事件。', '摘要生成出错就退回内置版本'],
  ['向量旁路缺失时退化到关键词与全文检索。', '没有嵌入服务也能工作'],
  ['抽取每次最多跑十轮，按游标增量。', '每轮结束后的提炼有次数上限'],
  ['记忆关系最多扩展一个邻居，不突破预算。', '从关联条目只再取一条'],
  ['数据库使用 WAL 模式减少锁冲突。', '日志预写模式让并发写更顺'],
  ['探针自动挑最稀有的词元出题。', '用冷门词生成自测查询'],
  ['时间衰减按指数计算，越旧权重越低。', '旧内容的分量随时间下降'],
  ['偏好默认写入全局范围，跨项目生效。', '用户习惯在所有仓库都适用'],
  ['决策默认写入项目范围，不污染其他仓库。', '项目内的选择不扩散出去'],
  ['技能类记忆保留长期，不参与短期淘汰。', '操作技巧不过期'],
  ['每轮结束触发一次记忆提炼。', '回答完成后才做归纳'],
  ['自动召回内容标记为不可信参考材料。', '注入的东西要谨慎对待'],
  ['记忆去重使用内容哈希，大小写不敏感。', '相同说法不会重复入库'],
  ['压缩摘要保留用户约束段，不能丢限制。', '折叠时限制条件要留下'],
  ['工具统一返回结构化文本对象。', '接口输出固定为文本对象'],
  ['命令支持查看条目的替换审计链。', '可以追踪旧版本被谁替代'],
  ['每个作用域最多存五千条，超出淘汰最旧。', '单范围容量上限是五千'],
  ['embedding 请求超时即降级为词法。', '向量调用过慢就放弃'],
  ['多进程写入靠忙等超时与重试。', '并发写用等待重试'],
  ['面板只读，不提供写操作也不回写会话。', '界面不能修改对话'],
  ['召回未命中会记录 recall-miss 事件。', '空手而归也会留下痕迹'],
]

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function runMode(mode, settings, file) {
  const store = new MemoryStore(file, settings)
  store.open()
  const ids = []
  for (const [memory] of PROBES) {
    const result = store.insert({
      kind: 'fact',
      text: memory,
      scope: 'project',
      confidence: 1,
      source: 'explicit',
      evidence: 'bench',
    })
    if (result.action !== 'inserted') throw new Error(`seed failed: ${result.action}`)
    ids.push(result.id)
  }
  if (mode === 'vector') {
    if (store.config.embedding.enabled !== true) {
      store.close()
      return { mode, skipped: 'embedding 未开启（检查 baseUrl/model）', hits1: 0, hits6: 0, rate: 0, latencies: [] }
    }
    try {
      const ping = await store.embedTexts(['探针连通性检查'])
      if (ping.length === 0) throw new Error('端点返回空向量')
    } catch (error) {
      store.close()
      return { mode, skipped: `embedding 调用失败：${error && error.message ? error.message : error}`, hits1: 0, hits6: 0, rate: 0, latencies: [] }
    }
    await store.backfillEmbeddings()
  }

  const latencies = []
  const positions = []
  for (let index = 0; index < PROBES.length; index += 1) {
    const [, query] = PROBES[index]
    const started = performance.now()
    const embVec = mode === 'vector' ? await store.embedQuery(query) : null
    const hits = store.rank(query, { limit: 10, embVec })
    latencies.push(performance.now() - started)
    const position = hits.findIndex(hit => hit.id === ids[index])
    positions.push(position === -1 ? null : position + 1)
  }
  store.close()
  const hits1 = positions.filter(position => position === 1).length
  const hits6 = positions.filter(position => position !== null && position <= 6).length
  const hits10 = positions.filter(position => position !== null && position <= 10).length
  return {
    mode,
    hits1,
    hits6,
    hits10,
    rate: Math.round((hits6 / PROBES.length) * 1000) / 10,
    p50: Math.round(median(latencies) * 10) / 10,
    positions,
  }
}

function printReport(results) {
  console.log(`改写型召回基准：${PROBES.length} 条探针（查询与原句几乎不共享词元）\n`)
  for (const result of results) {
    if (result.skipped) {
      console.log(`${result.mode.padEnd(8)} 跳过 —— ${result.skipped}`)
      continue
    }
    console.log(
      `${result.mode.padEnd(8)} top-1 ${String(result.hits1).padStart(2)}/${PROBES.length}` +
      ` · top-6 ${String(result.hits6).padStart(2)}/${PROBES.length}（${result.rate}%）` +
      (result.hits10 === undefined ? '' : ` · top-10 ${String(result.hits10).padStart(2)}/${PROBES.length}`) +
      ` · p50 ${result.p50}ms`,
    )
  }
  const lexical = results.find(result => result.mode === 'lexical')
  const vector = results.find(result => result.mode === 'vector' && !result.skipped)
  if (lexical && vector) {
    const delta = vector.hits6 - lexical.hits6
    console.log(`\n向量相对词法：top-6 ${delta >= 0 ? '+' : ''}${delta} 条`)
  }
  console.log('\n说明：词法路径=关键词+FTS5+近义扩展；向量路径=同一 rank() 加 cosine 加成，')
  console.log('      预算/冷却/scope/TTL/准入门槛完全一致。未配置端点时只报告词法基线。')
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-bench-'))
  const file = join(dir, 'memory.db')
  try {
    const base = resolveConfig({})
    const lexical = await runMode('lexical', { ...base, embedding: { ...base.embedding, enabled: false } }, file)

    const url = process.env.DSH_CONTEXT_HUB_EMBED_URL
    const model = process.env.DSH_CONTEXT_HUB_EMBED_MODEL
    const results = [lexical]
    if (url && model) {
      const vectorSettings = resolveConfig({ embedding: { enabled: true, baseUrl: url, model } })
      const vectorFile = join(dir, 'memory-vector.db')
      results.push(await runMode('vector', vectorSettings, vectorFile))
    } else {
      results.push({ mode: 'vector', skipped: '未设置 DSH_CONTEXT_HUB_EMBED_URL / _MODEL' })
    }
    printReport(results)
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
