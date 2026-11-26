// 最小 OpenAI 兼容 embedding 服务：POST /v1/embeddings
// 用法：node server.mjs           （默认端口 11434，模型 Xenova/bge-small-zh-v1.5）
//      EMBED_MODEL=Xenova/bge-m3 PORT=11434 node server.mjs
//      EMBED_MODEL=/abs/path/to/bge-base-zh-v1.5 EMBED_DTYPE=q8 PORT=11434 node server.mjs
import { existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline, env } from '@huggingface/transformers'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 11434)
const MODEL = process.env.EMBED_MODEL || 'Xenova/bge-small-zh-v1.5'
const DTYPE = process.env.EMBED_DTYPE || 'fp32'
const LOCAL_MODEL = path.isAbsolute(MODEL) && existsSync(MODEL)

env.allowLocalModels = LOCAL_MODEL
env.allowRemoteModels = !LOCAL_MODEL
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com'
env.cacheDir = process.env.EMBED_CACHE || path.join(HERE, '.cache')

let extractor = null
let loading = null
let chain = Promise.resolve()

async function loadModel() {
  if (extractor !== null) return extractor
  if (loading === null) {
    loading = pipeline('feature-extraction', MODEL, { dtype: DTYPE })
      .then(model => { extractor = model; return model })
      .finally(() => { loading = null })
  }
  return loading
}

async function embed(texts) {
  await loadModel()
  const run = chain.then(async () => {
    const out = await extractor(texts, { pooling: 'mean', normalize: true })
    return out.tolist()
  })
  chain = run.catch(() => undefined)
  return run
}

function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return send(res, 200, { ok: true, model: MODEL, ready: extractor !== null })
  }
  if (req.method === 'GET' && req.url.replace(/\/+$/, '') === '/v1/models') {
    return send(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'local' }] })
  }
  if (req.method !== 'POST' || !/\/(v1\/)?embeddings$/.test(req.url.replace(/\/+$/, ''))) {
    return send(res, 404, { error: { message: `no route: ${req.method} ${req.url}` } })
  }
  let raw = ''
  let rejected = false
  req.setEncoding('utf8')
  req.on('data', c => {
    if (rejected) return
    raw += c
    if (raw.length > 2_000_000) {
      rejected = true
      send(res, 413, { error: { message: 'payload too large (max 2 MB)' } })
      req.destroy()
    }
  })
  req.on('end', async () => {
    if (rejected) return
    let body
    try { body = JSON.parse(raw) } catch { return send(res, 400, { error: { message: 'invalid json' } }) }
    if (body === null || typeof body !== 'object') return send(res, 400, { error: { message: 'body must be a JSON object' } })
    const input = body.input
    if (input === undefined || input === null) return send(res, 400, { error: { message: 'input is required' } })
    const texts = (Array.isArray(input) ? input : [input]).map(value => String(value ?? '').trim())
    if (texts.length === 0 || texts.length > 64) return send(res, 400, { error: { message: 'input must be 1..64 texts' } })
    if (texts.some(text => text.length === 0 || text.length > 20000)) {
      return send(res, 400, { error: { message: 'each text must be 1..20000 characters' } })
    }
    try {
      const vectors = await embed(texts)
      send(res, 200, {
        object: 'list',
        model: MODEL,
        data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        usage: { prompt_tokens: texts.reduce((n, t) => n + t.length, 0), total_tokens: texts.reduce((n, t) => n + t.length, 0) },
      })
    } catch (error) {
      send(res, 500, { error: { message: String(error && error.message ? error.message : error) } })
    }
  })
})

server.on('error', error => {
  console.error(`[embed] server error: ${error && error.message ? error.message : error}`)
  process.exitCode = 1
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`embed server on http://127.0.0.1:${PORT} (model=${MODEL}, dtype=${DTYPE})`)
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
