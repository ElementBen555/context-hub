# embed-svc — 本机 OpenAI 兼容 embedding 服务

给 `dsh-context-hub` 的向量召回用：完全本地、可离线、不需要 API key。

- 运行时：Node ≥ 22 + `@huggingface/transformers`（ONNX CPU）
- 默认模型：`Xenova/bge-small-zh-v1.5`（24M 参数，512 维，权重 95MB）
- 接口：`POST /v1/embeddings`（OpenAI 形状）、`GET /health`、`GET /v1/models`

## 启动 / 停止

```bash
npm install --ignore-scripts   # 首次：约 500MB（含 onnxruntime）
./start.sh                     # 后台启动，127.0.0.1:11434，日志 embed.log，PID embed.pid
./stop.sh
curl -s localhost:11434/health # {"ok":true,"model":"...","ready":true}
```

`start.sh` 用 `nohup`，不会随终端退出；但本机没有可用的 systemd user bus，所以没有做服务单元——重启后需要再跑一次。想开机自启可以把它加进桌面环境的 autostart，或在 shell profile 里调用。

## 测试

```bash
curl -s localhost:11434/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"input":["压缩优先复用原生 compaction 服务","把历史折叠起来而不是删掉"]}' \
| python3 -c "import json,sys; d=json.load(sys.stdin); a,b=[x['embedding'] for x in d['data']]; print(len(a), round(sum(x*y for x,y in zip(a,b)),3))"
```

本机实测：512 维，首次调用约 0.24s（含加载模型），之后单条约 6–20ms。

## 换模型

```bash
EMBED_MODEL=Xenova/bge-m3 EMBED_DTYPE=fp32 ./start.sh
```

可选（体积/质量递增）：`Xenova/bge-small-zh-v1.5`（95MB）→ `Xenova/bge-base-zh-v1.5` → `Xenova/bge-m3`（约 1–2GB，1024 维）。

换模型后要重算旧向量：插件只按维度比较相似度，新旧模型同维时会算出无意义分数。清空后重启插件会回填：

```bash
sqlite3 ~/.dsh/context-hub/memory.db "UPDATE memories SET embedding='', embedding_model='' WHERE status='active';"
```

## 模型下载

`server.mjs` 走 `HF_ENDPOINT`（默认 `https://hf-mirror.com`），缓存在 `.cache/`，下载一次后离线可用。

如果 transformers.js 的下载卡住（它直接读 CDN，遇到限速会停住），可以手动放文件：

```bash
D=.cache/Xenova/bge-small-zh-v1.5/onnx
mkdir -p "$D"
curl -L -o "$D/model.onnx" "$(curl -sSI https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model.onnx | grep -i '^location:' | cut -d' ' -f2 | tr -d '\r')"
```

## 实现要点

- 模型懒加载：第一个请求才初始化 pipeline，启动瞬间不发网络请求。
- 请求串行化：内部 promise 链，避免并发推理抢内存；单条延迟低，够记忆召回用。
- `input` 支持字符串或数组（1–64 条），返回 `{"data":[{"embedding":[...]}]}`，顺序与输入一致。
- 只监听 `127.0.0.1`，不对外暴露。
