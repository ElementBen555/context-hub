# 上下文中枢（dsh-context-hub）设计与使用文档

> 版本 1.6.4 · 适用 DSH 0.2.3-alpha.2（已在本机 profile `web` 验证）
> 本文档描述**当前实现（1.6.4）**；目标规格已冻结为 [spec.md](spec.md) v1.0，实现差距见 spec 第 8 节。
> 版本脉络：1.6.1 墓碑/会话隔离，1.6.2 vendored 依赖，1.6.3 左栏入口，1.6.4 面板图表；细节见 [CHANGELOG](../CHANGELOG.md)。
> 已落地：P1 记忆准入/scope/TTL/衰减/冷却（0.2.0）、治理与观测命令（0.3.0）、近义召回（0.3.1）、召回兜底（0.4.1）、hub 压缩器（0.5.0）、客户端只读面板（0.6.0）、FTS5 混合检索与检索探针（0.7.0）、向量旁路与规模化（0.8.0）、压缩摘要入库与逐请求观测（0.9.0）、记忆关系与审核流（1.0.0）、召回基准/可逆还原/并发验证（1.1.0）、语义改写/水位接管（1.2.0）、本地 embed 服务（1.3.0）、面板图形化与四分区（1.3.1–1.5.5）、召回预算 8/1800 与分片抽取（1.5.6）、硬顶/超时、git 项目身份、消息级 unfold（1.6.0）、墓碑与会话隔离（1.6.1）、vendored 依赖（1.6.2）、面板左栏入口（1.6.3）、面板图表（1.6.4）。
> 一个 host 侧 bundle，把「记忆、压缩、洞察」三件事装进同一个插件，数据落本地 SQLite，宿主侧零构建。

---

## 1. 定位

DSH 的上下文流水线本来就有三个环节，但分别散在不同插件里：

| 环节 | 解决的问题 | 常见独立实现 |
| --- | --- | --- |
| 记忆 | 新会话该带什么进来 | graph-memory、MemOS、Hindsight… |
| 压缩 | 会话装不下时丢什么、留什么 | billion-context、compaction-basic |
| 洞察 | 怎么知道前两件事做对了 | dsh-context |

拆成三个插件的问题是：对同一份历史各建一套索引、各写一条注入通道、互不知道对方做了什么。上下文中枢把它们放进**一个 bundle、一份存储、一条注入通道**：

- 记忆库是**派生缓存**，会话日志才是唯一真相；
- 压缩**不重复造轮子**，直接调用 DSH 原生 `compaction` 服务，只额外提供「折叠区检索」；
- 洞察复用 `tokenMeter` 的测量结果，不自己数 token。

**非目标**（0.1.0 明确不做，后续仅部分放宽）：替换 compaction 服务注册（0.5.0 改为实例包装 `summarize()`，不换服务）、追加自定义会话事件类型、改 system prompt 常驻内容、向量检索、多进程共享记忆。

---

## 2. 快速开始

```bash
# 安装（绝对路径指向本目录）
# plugin_manager install_bundle(target="/home/element/文档/deepseek-harness/default-workspace/context-hub")

# 只改源码时：热重载，不必重装
# plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)

# 卸载
# plugin_manager set_plugin(target="include:dsh-context-hub", enabled=false)   # 停用（记忆库保留）
# plugin_manager remove_bundle(target="dsh-context-hub")                        # 彻底移除
```

装好后的自检三连：

```
/context-hub status      # 应看到 上下文 / 压缩 / 记忆 三行
/context-hub remember 测试一条记忆
/context-hub search 测试
```

> 斜杠命令菜单可能缓存了页面加载时的列表，`/context-hub` 需要刷新一次页面才出现在补全里；命令本身在重载后就已注册。

---

## 3. 架构

```
                    ┌──────────────────────────────┐
   user/message ───▶│ maybeRecall()                │
                    │  tokens() → store.search()   │──▶ agent.inject(recallMessage)
                    └──────────────────────────────┘         (source: context-hub/recall)
                                   │
                                   ▼
                    ┌──────────────────────────────┐
   turn/end ───────▶│ extractMemories()            │
                    │  事件切片 → llm.stream()     │──▶ MemoryStore.insert()
                    │  parseMemories() → upsert    │
                    └──────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ MemoryStore (node:sqlite)    │
                    │ $DSH_HOME/context-hub/        │
                    │   memory.db                  │
                    └──────────────────────────────┘
                                   ▲
        /context-hub search|remember|status ──┐
        context_hub_* 十二个工具 ───────────────┘
```

组件清单：

| 组件 | 职责 |
| --- | --- |
| `apply(ctx)` | 唯一入口：打开存储、注册工具与命令、挂会话事件、注册清理 effect |
| `MemoryStore` | SQLite 连接、DDL、去重写入、召回打分、计数；打开失败即整体降级 |
| `maybeRecall` | 真人消息触发，按会话去重注入下一 step |
| `extractMemories` | 一轮结束异步抽取，失败只 warn |
| `searchHistory` | 全量扫会话日志（含已折叠区间） |
| `statusText` | 汇总 tokenMeter、折叠区间、记忆库统计 |

---

## 4. 数据流与时序

### 4.1 用户消息 → 召回 → 下一步

1. `session/event` 收到 `user/message`；
2. 只处理 `data.source.kind === 'user'`（跳过 agent.inject、system 等自造消息，避免自我召回）；
3. 文本 < 4 字符直接返回；
4. `expandQueryTokens()` 切词，`store.search()` 按 scope 各扫 `CANDIDATE_WINDOW = 800` 条候选；
5. 过滤本会话已注入过的 id（`state.injected`）；
6. 取 ≤ `recallMaxItems`（8）条，字符 ≤ `recallMaxChars`（1800）且 `estimateInjectTokens()` ≤ `recallMaxTokens`（1200），组装一条 user 消息；
7. `agent.inject(message)` 排入下一 pre-step；`touch()` 累加使用次数；
8. 注入内容是**一条独立 user 消息**，不改本轮用户原文、不进 system prompt、不产生新事件类型。

### 4.2 一轮结束 → 抽取 → 写库

1. `turn/end` 触发，异步执行（不 await，不阻塞收尾）；
2. 从 `kv['extract:<sessionId>']`（或最后一条 extract 事件）恢复游标 `extractedSeq`，取游标到 `session.seq` 之间的事件，只挑 `user/message`、`assistant/message`；
3. 从游标向前**累计到 ≤8000 字符**（`EXTRACT_MAX_INPUT`）：单条超长按剩余额度截断，跳过 `source.kind === 'context-hub'` 的注入消息；切片不足 80 字符只推进游标、不调模型；
4. 解析模型路由，`llm.stream()` 发一次性请求（`maxTokens: 600`，`purpose: 'context-hub:extract'`，`AbortSignal.timeout(extractTimeoutMs)`）；每轮最多 `extractPassesPerTurn`（2）次增量切片；
5. 累积 `text-delta`，用 `parseMemories()` 容错解析 JSON 数组；
6. 逐条 `insert()`：`hash = sha1(kind + '\0' + lower(text))` 去重；upsert 只刷新 status/置信/证据/消息定位/valid_*，不改 kind/text/tags/project；
7. **成功后才**把 `extractedSeq` 与 `kv['extract:<sessionId>']` 同步推进；失败（含超时）只 warn，下轮重试（幂等）。

### 4.3 /context-hub compact → 原生压缩

```
ctx.get('compaction').compactNow(agent, signal, commandId)
  → CompactionResult { shadowedSeqs, shadowedTokenCount, summarySeq, ... }
```

插件不参与选区、不参与摘要生成。压缩后的摘要作为新的 surface 起点，原始事件仍在会话日志里，因此 `context_hub_history` 依旧能检索到——这就是「给压缩补一个可检索的折叠区」。

---

## 5. 功能规格

### 5.1 记忆条目模型

类型（kind）固定六种：`decision`（决策及理由）、`fact`（项目事实）、`preference`（用户偏好）、`task`（未完成任务）、`skill`（可复用做法）、`summary`（压缩摘要入库）。非法 kind 落为 `fact`。

抽取提示词要求每条 `text` 是**自包含的一句话**，保留精确路径、标识符、数值；最多 5 条；没有可记的就返回 `[]`。完整提示词见附录 A。

### 5.2 召回打分

```
tokens(text) = 拉丁词（[a-z0-9_./:#-]{2,}） ∪ 中文二元组（查询/记忆两侧都过 expandQueryTokens，含 18 组中英近义）
overlap      = |queryTokens ∩ memoryTokens|
ratio        = overlap / |queryTokens|
lexicalBase  = overlap > 0 ? overlap + ratio*2 + (kind === 'preference' ? 1 : 0) : (FTS 命中 ? 0.8 : 0)
ftsBoost     = FTS 命中 ? 0.3 + 0.7*(1 - 名次/命中总数) : 0
emb          = 有向量且 cos ≥ embedding.minScore ? 0.5 + 0.5*cos : 0
base         = lexicalBase + ftsBoost + emb
score        = base × scopeWeight × decay × usage
```

- `scopeWeight`：session 1.0 / project 0.8 / global 0.6；
- `decay = exp(-λ·days)`：λ 为 session 0.10、project 0.01、global 0.002，`days` 按 `last_used || created_at` 起算；
- `usage = 1 + 0.1 × min(uses, 10)`，命中后 `touch()` 累加；
- **RRF 分支**：`embedding.fusion === 'rrf'` 且带查询向量时，词法/向量各自排名，`rrf = 1/(60+词法名次) + 1/(60+向量名次)`，`score = rrf × 1000 × scopeWeight × decay × usage`；
- 丢弃规则：`overlap === 1 且 queryTokens > 6`、且无 FTS/向量命中，视为噪声；
- 候选池：每个 scope 取 `ORDER BY last_used DESC, created_at DESC LIMIT CANDIDATE_WINDOW`（`CANDIDATE_WINDOW = 800`）；FTS 命中落在窗口外的按 id 补入（≤50 条），并仍过 scope 可见性过滤；
- 排序：`score` 降序，同分按 `created_at` 降序；
- 预算：最多 `recallMaxItems`（8）条、总字符 ≤ `recallMaxChars`（1800），另受 `recallMaxTokens`（1200）硬顶；
- 去重/冷却：同一会话注入过的 id 不再注入，且注入后冷却 `recallCooldownTurns`（6）轮；
- session scope 记忆只在本会话可见（`session_id` 过滤）；project scope 命中本项目或 `project = ` 的记录；没有项目上下文（后台会话）时全库 project 记忆都参与。

### 5.3 存储

DDL（`memory.db`）：

```sql
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,              -- sha1(kind \0 lower(text))
  kind TEXT NOT NULL,                     -- decision|fact|preference|task|skill|summary
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',          -- 逗号分隔
  project TEXT NOT NULL DEFAULT '',       -- projectOf()：默认 git:host/owner/repo
  scope TEXT NOT NULL DEFAULT 'session',  -- session|project|global
  session_id TEXT NOT NULL DEFAULT '',    -- session scope 的隔离键
  confidence REAL NOT NULL DEFAULT 0.6,
  source TEXT NOT NULL DEFAULT 'extracted', -- extracted|explicit|tool|compaction
  evidence_seq TEXT NOT NULL DEFAULT '',  -- 抽取来源 seq 区间 "a-b"
  message_id TEXT NOT NULL DEFAULT '',    -- <sessionId>#<seq>
  message_seq INTEGER NOT NULL DEFAULT 0,
  sentence_no INTEGER NOT NULL DEFAULT -1,
  valid_from INTEGER NOT NULL DEFAULT 0,  -- epoch 秒
  valid_to INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- active|superseded|archived|deleted|pending
  superseded_by INTEGER NOT NULL DEFAULT 0,
  embedding TEXT NOT NULL DEFAULT '',     -- JSON 浮点数组；'' = 未取向量
  embedding_model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,            -- epoch 秒
  last_used INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope, status);
CREATE INDEX IF NOT EXISTS memories_status_scope ON memories(status, scope);
```

> 旧库由 `migrate()` 逐列 `ALTER TABLE` 补齐 `scope/confidence/source/evidence_seq/message_id/message_seq/sentence_no/valid_from/valid_to/status/superseded_by/embedding/embedding_model`；顺序必须是建表 → 补列 → 建索引，否则旧库会因 `no such column` 整体降级为「无库」模式。

同一 `open()` 内还会创建另外五张表：

| 表 | 用途 |
| --- | --- |
| `messages(id, session_id, seq, role, project, text, created_at, last_used, uses, UNIQUE(session_id,seq))` | 独立消息索引；`indexSession()` 增量写入，供「原文窗口」召回与 FTS 补位。 |
| `memory_links(id, from_id, to_id, relation, weight, created_at, UNIQUE(from_id,to_id,relation))` | 记忆关系，`relation` 目前只有 `related` / `supersedes`。 |
| `kv(key, value)` | 小状态：抽取游标、project 缓存与迁移标记、FTS marker、接管模式与水位开关。 |
| `context_events(id, kind, session_id, memory_ids, tokens, detail, created_at)` | 观测事件时间线（recall/extract/compact/request/…）；`request` 环形裁剪保留最近 200 条。 |
| `messages_fts`（virtual FTS5，`content='messages'`，trigram） | 消息级全文检索，由触发器与 `messages` 同步。 |

`memories_fts`（`content='memories'`，trigram）同样在 `open()` 内创建；详见 §15。库文件在 `open()` 末尾 `chmod 0600`。

写入用：

```sql
INSERT INTO memories (hash, kind, text, tags, project, scope, session_id, confidence, source,
                      evidence_seq, message_id, message_seq, sentence_no, valid_from, valid_to,
                      status, created_at, last_used)
VALUES (…, 0)
ON CONFLICT(hash) DO UPDATE SET
  status = excluded.status, superseded_by = 0, confidence = excluded.confidence,
  evidence_seq = excluded.evidence_seq, message_id = excluded.message_id,
  message_seq = excluded.message_seq, sentence_no = excluded.sentence_no,
  valid_from = excluded.valid_from, valid_to = 0
RETURNING id
```

> 冲突时**不更新** `kind/text/tags/project`：同一句话的归属不会被改写。`status = excluded.status` 只用于把 `archived` 重新激活；`deleted/rejected/superseded` 的旧条目在查重阶段以 `reason: 'tombstoned'` 直接拒绝，不会被同文“复活”（1.6.1）。

### 5.4 历史检索（折叠区补位）

`searchHistory()` 从 `seq 0` 扫到 `session.seq`，只读 `session.eventAt(seq)`，对 `user/message`、`assistant/message` 做同样的 token 重叠打分，返回 `seq / role / 前 300 字`。

- 成本 O(事件数)，千级事件无感；万级以上建议加索引（路线图 P2）。
- 因为直接读会话日志，压缩折叠、摘要替换都不影响检索结果。
- 只读：不会把检索到的旧消息重新注入上下文，需要模型自己判断是否引用。

### 5.5 洞察字段

| 字段 | 来源 | 含义 |
| --- | --- | --- |
| `surface N tokens` | `tokenMeter.measure(session).surfaceTokens` | 当前 surface（压缩后实际送模型的部分） |
| `合计 N tokens` | `.totalTokens` | 含被 shadow 的历史总量 |
| `（N 个节点）` | `.nodes.length` | surface 上的消息/事件节点数 |
| `压力 P / 窗口 W` | `tokenMeter.contextPressure(session)` | 压力值与该模型上下文窗口 |
| `已折叠 N 个区间` | 数 `compaction/summary` 事件 | 历史压缩次数 |
| `事件 N 条` | `session.seq` | 会话日志总事件数 |
| `记忆：active N（session/project/global；kind N），superseded N…` | `counts()` 按 status/scope/kind 聚合 | 记忆库构成；pending >0 时提示 `review` |
| `构成：用户 … / 助手 …` | `surfaceBreakdown(session, measurement)` | surface 节点按事件类型拆分；输出预留单列 |
| `水位：N%（参考 70% 触发 / 60% 目标）` | `contextPressure` ÷ `contextWindow` | 仅供参照，真实阈值由 profile 的压缩器配置决定 |
| `@ 路径` | `store.file` | 实际数据库位置 |

### 5.6 工具与命令

1.6.4 注册 12 个工具（全部在 `defineTools()` 里按 `ctx.tools.register` 直接声明）：

| 名称 | 参数要点 | 输出 |
| --- | --- | --- |
| `context_hub_search` | `query` 必填；`limit` 默认 5（1–20）；`all` 跨项目 | `- [#id kind scope conf N] text（tags: …）` |
| `context_hub_remember` | `text` 必填；`kind`（默认 fact）、`tags` 逗号分隔、`scope`（按 kind 推导） | `已记住（#id，scope，置信 N）` / 已存在 / 被更强证据拦下 |
| `context_hub_history` | `query` 必填；`limit` 默认 5（1–20） | `- seq N [role] 前 300 字` |
| `context_hub_status` | 无 | 见 §5.5 |
| `context_hub_explain` | `query` 必填 | 候选打分明细 + 未入选原因 |
| `context_hub_log` | `limit` 默认 10（1–50） | 观测事件倒序 |
| `context_hub_abtest` | `messages` 默认 30（5–100） | 7 段 vs 8 段压缩 A/B |
| `context_hub_probe` | `limit` 默认 10（1–50） | `{total,hits,rate,cases}` |
| `context_hub_restore` | `start` 必填；`end` 默认 start+40；`maxChars` 默认 4000（≤12000） | 原文经 `exec.deferContext` 注入下一步 |
| `context_hub_decompress` | `id` 或 `start`/`end`；`end` 默认 start+40；`maxChars` 默认 8000（≤20000） | 折叠块原文回填 |
| `context_hub_unfold` | `id` 或 `start`/`end`；`steps` 默认 3；`maxChars` 默认 8000 | 后续 N 步用原文临时替代摘要 |
| `context_hub_doctor` | 无 | FTS5/向量/改写/重排/压缩器/水位自检 + 档位建议 |

命令 `/context-hub` 共 **21 个子命令**（缺省参数等同 `status`）：

| 分组 | 子命令 |
| --- | --- |
| 只读 | `status`（缺省）、`doctor`、`search <q>`、`history <q>`、`explain <q>`、`probe [n]`、`log [n]`、`audit <id>` |
| 写入/治理 | `remember <text>`、`forget <id>`、`supersede <id> <新内容>`、`review [approve\|reject] <id>`（无参数列待审）、`export` |
| 压缩 | `compact`、`compactor <hub\|native>`、`watermark [on\|off]`、`mode [observe\|assist\|takeover\|full]` |
| 还原/向量 | `restore <start> [end]`、`decompress [id\|start] [end]`、`unfold [id:<n>\|start] [end] [steps:<n>]`、`reembed` |

---

## 6. 与 DSH 的契约

本插件只依赖**稳定公开面**，不 import 任何 `@deepseek-ai/*` 包（因此无需安装依赖、无版本对齐问题）：

| 依赖 | 用法 | 备注 |
| --- | --- | --- |
| `ctx.tools.register` | 注册 12 个工具 | `parameters` / `output.schema` 必须是**标准 JSON Schema** |
| `ctx.commands.register` | 注册 `/context-hub` | `handler(invocation)` 返回 `{kind, text, sourceEventSeq?}` |
| `ctx.on('session/event')` | 监听 `user/message`、`turn/end` | 只读，不改事件 |
| `ctx.on('session/disposed')` | 清理会话状态 | 防 WeakMap 之外的残留 |
| `agent.inject(message)` | 召回通道 | 不唤醒 agent；进入下一个被接纳 step |
| `ctx.get('llm').stream(options)` | 抽取一次性调用 | 失败只 warn |
| `ctx.get('tokenMeter')` | `measure` / `contextPressure` | 已在 b 段实测字段名 |
| `ctx.get('compaction').compactNow` | `/compact` | 返回 `CompactionResult \| null` |
| `ctx.get('agents').get(sessionId)` | 由 session 找 agent | 键是 SessionId |

**Schema 陷阱（真实踩过）**：直接 `register` 的 schema 不能写逐属性 `required: true`，那只有 `defineTool` 的简写编译器会归一化；运行时校验器只接受对象上的 `required: [...]` 数组。写成前者会得到：

```
JsonSchemaError: unsupported JSON schema: schema.properties.text.required is not supported on type "string"
```

插件随后**静默不激活**（application: failed），工具不会出现。修法见 `TEXT_OUTPUT` 与十二个工具的 `parameters`。

---

## 7. 配置

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | 决定默认库路径 |
| `DSH_CONTEXT_HUB_DB` | 空 | 直接覆盖数据库文件路径 |
| 库位置 | `$DSH_HOME/context-hub/memory.db` | 首次启动自动 `mkdir -p` |

代码内常量（改需重载）：

```js
EXTRACT_MAX_INPUT = 8000   // 抽取切片上限（每次增量 ≤8000 字符）
CANDIDATE_WINDOW  = 800    // 每个 scope 的召回候选池
maxTokens: 600             // 抽取输出上限（写死在 llm.stream 调用里）
```

可配置项在 `defaults` 里声明，`resolveConfig()` 合并 profile `config` 后逐项 clamp：

| 配置项 | 默认 | 允许范围 | 说明 |
| --- | --- | --- | --- |
| `recallMaxChars` | 1800 | 200–8000 | 单次召回注入字符预算 |
| `recallMaxItems` | 8 | 1–20 | 单次召回最多条数 |
| `recallMaxTokens` | 1200 | 100–4000 | 单次注入 token 硬顶（按 ~1.6 字符/token 估） |
| `recallTimeoutMs` | 4000 | 0–20000 | 召回总时限，0 表示不设限 |
| `extractPassesPerTurn` | 2 | 1–10 | 每轮最多增量抽取次数（1.5.6） |
| `extractTimeoutMs` | 60000 | 5000–300000 | 单次抽取超时，超时释放 latch |

其余默认项（完整列表见 `src/index.js` 的 `defaults`）：`recallCooldownTurns=6`、`sessionTtlDays=7`、`projectTtlDays=90`、`globalTtlDays=0`、`capacityPerScope=5000`、`admissionThreshold=0.6`、`conflictPolicy='evidence'`、`projectIdentity='git'`、`compactor='native'`、`reviewPending=false`，以及 `embedding` / `rewrite` / `rerank` / `watermark` / `unfold` / `mode` 分组。

覆盖顺序：`defaults` < profile 的 `config` 字段 < 环境变量（`DSH_CONTEXT_HUB_RECALL_CHARS`、`DSH_CONTEXT_HUB_RECALL_ITEMS`、`DSH_CONTEXT_HUB_RECALL_TOKENS`、`DSH_CONTEXT_HUB_RECALL_TIMEOUT_MS`、`DSH_CONTEXT_HUB_EXTRACT_PASSES`、`DSH_CONTEXT_HUB_EXTRACT_TIMEOUT_MS`）。越界值被 clamp 到上表范围，非法值回落默认；改完热重载插件即可生效，无需重启 DSH。`/context-hub mode|watermark|compactor` 的运行时开关写入 `kv`，重启后沿用，也不需要改配置。

> 1.6.4 仍未导出 `Config`（Schemastery），所以 DSH 设置页渲染不出表单；面板「配置」页是自绘的只读快照 + 上述几个运行时开关。导出 schema 在路线图里。

---

## 8. 安装结构

```
context-hub/
├── package.json          # name=dsh-context-hub, dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml      # - insert: [{id: dsh-context-hub, name: dsh-context-hub}]
├── src/index.js          # 全部逻辑，纯 ESM，无构建步骤
├── test-smoke.mjs        # 假 ctx 冒烟测试
├── README.md
└── docs/design.md        # 本文档
```

安装实际写入：

- `~/.dsh/profiles/web/package.json` → `dependencies["dsh-context-hub"] = "link:/…/context-hub"` + `bundles` 增加一项；
- `node_modules/dsh-context-hub` → 指向源码目录的 symlink；
- 运行时可管理 entry：`include:dsh-context-hub`（命名法 `include:<patchId>`）。

**HMR**：改 `src/index.js` 后 `set_plugin(enabled=true)` 即重载，进程内 `MemoryStore` 会重新打开（SQLite 文件句柄随 effect 释放）。

**状态是持久的**：记忆库不在内存里，重启 DSH 后历史记忆仍在；`injected` 与 `extractedSeq` 是进程内状态，重启后归零——重启后第一轮会重新抽取最近窗口，靠 hash 去重避免重复条目。

---

## 9. 验证记录（本机实测）

| 项 | 结果 |
| --- | --- |
| 激活 | `application: applied`，`warnings: []` |
| 工具可见性 | 0.1.0 历史记录：本会话动态出现 4 个 `context_hub_*` 工具（1.6.4 固定注册 12 个，见 §5.6） |
| status | `surface 244372 tokens / 合计 260626 tokens（304 个节点）`；`压力 71410 / 窗口 1048576`；`事件 1106 条` |
| 记忆闭环 | `remember` 写入 #1；一轮结束后自动抽取使库从 1 条增至 3 条（fact 2，preference 1） |
| 折叠区检索 | 在 1106 条事件中定位到最早的 `seq 8 [user] 安装dshmarket` |
| 冒烟测试 | `node test-smoke.mjs` → `SMOKE OK`（注册、召回注入、turn/end 抽取、检索、status） |

冒烟测试用一个假 ctx 覆盖：`agents.get`、`llm.stream`（yield 一段 JSON）、`tools.register`、`commands.register`、`on`、`effect`；用临时 `DSH_CONTEXT_HUB_DB` 隔离真实库。它验证的是**逻辑**，不是 DSH 契约——契约靠真实 profile 里的 status 与写入验证。

---

## 10. 失败模式

> 升级踩坑（0.1.0 → 0.2.0）：`CREATE INDEX` 与 `ALTER TABLE` 的顺序不能反。旧库没有 `scope` 列时，先执行 `CREATE INDEX ... ON memories(scope, status)` 会立刻报 `no such column: scope`，导致整个 `open()` 失败、记忆功能整体降级。正确顺序：建表 → 补列 → 建索引。

| 故障 | 行为 | 用户可感知的影响 |
| --- | --- | --- |
| SQLite 打不开（权限/磁盘） | warn，`store.db = undefined`，工具与命令仍注册 | 记忆功能空转，`status` 显示 0 条 |
| 抽取模型调用失败 | warn，不推进 `extractedSeq`，下轮重试 | 该轮记忆缺失，后续补 |
| 模型返回非 JSON | `parseMemories` 取首个 `[` 到末个 `]` 再试；仍失败则丢弃 | 静默跳过，不报错 |
| 无 agent（如后台评估会话） | `maybeRecall` / `extract` 直接返回 | 无注入、无抽取 |
| 模型路由解析不到 | 依次尝试 `model.current()` → `requestHeader().config` → `agent.options` → 最近 assistant 消息 source | 全失败则跳过抽取 |
| `compaction` 服务缺失 | `/context-hub compact` 返回错误文本 | 其它功能不受影响 |
| 会话超长 | `searchHistory` 全量扫描变慢 | 千级无感，万级需索引 |

所有失败路径都只写 `logger.warn`，**不 throw、不阻塞会话、不改会话状态**。

---

## 11. 信任与安全边界

- 注入消息显式标注「仅供参考、可能过时；与当前对话冲突时以当前对话为准」，`source = {kind:'context-hub', form:'recall'}`，模型和审计都能区分来源。
- 插件**不写会话日志**、不新增事件类型、不改 system prompt，因此可随时停用而不留一致性债。
- 工具读写自有 SQLite；抽取/改写/重排走宿主 `llm` 服务，不直连 API。仅当显式启用 `embedding.enabled` 时才向配置的 OpenAI 兼容端点发 `POST /embeddings`，默认关闭。
- 记忆库是本地文件（打开时 `chmod 0600`），包含对话摘要性内容；共享机器上仍建议把 `DSH_CONTEXT_HUB_DB` 放到私有目录。
- 召回内容进入模型上下文，属于**不可信数据**：即使记忆库被投毒，标注与「以当前对话为准」的措辞可降低但不能消除影响。写入路径目前只有本插件的抽取提示词与显式 `remember`。

---

## 12. 已知限制（1.6.4）

1. **单进程状态**：`injected`、`extractedSeq`、`projectKeyCache` 都在进程内；多个 DSH 实例共用一个库时只有 SQLite 数据共享，冷却/去重/抽取游标各算各的。
2. **history 仍是线性扫描**：`searchHistory()` 从 seq 0 逐条 `eventAt()`，不使用 `messages`/`messages_fts` 索引；万级以上事件会明显变慢。
3. **跨语言召回弱**：不开向量时，中文查询命中英文表述（及反向）主要靠 18 组 `ALIAS_GROUPS`，覆盖有限；英文词形变化靠 trigram FTS 部分缓解。
4. **关系图无向且关系类型少**：`memory_links` 只连 `related`（相似度 ≥0.4）与 `supersedes`，没有图遍历、没有 PageRank；邻居扩展只补 1 跳。
5. **抽取质量取决于模型**：`parseMemories()` 只做容错解析，不校验事实正确性；模型返回空/非 JSON 时本轮静默跳过。
6. **向量能力要本地依赖与模型**：`embedding.enabled` 需要 OpenAI 兼容端点；内置 embed 服务依赖 vendored 的 `embed/node_modules`（1.6.2）与模型文件，首次加载慢、体积大。
7. **面板是 10 秒轮询快照**：不是推送/实时流；关闭面板即停表，后台变化要等下次刷新。
8. **没有导出 `Config` schema**：DSH 设置页无法渲染表单，配置只能改 profile `config` 或环境变量后热重载。

---

## 13. 路线图

以下只剩**确实没做**的项；已实现项标注版本，不再挂在表里。

| 优先级 | 事项 | 现状 / 验收标准 |
| --- | --- | --- |
| P1 | `Config` schema（Schemastery） | 未导出；导出后 DSH 设置页可直接渲染、校验并持久化 |
| P1 | 记忆导入 | 只有 `export`（v4 快照），没有 `import`；目标：可回灌 `memories` / `memory_links` / `messages` |
| P2 | 多进程协调 | 当前只有 WAL + `busy_timeout=5000`；目标：跨实例共享冷却/抽取游标或加锁 |
| P2 | history 倒排索引 | 当前 O(事件数)；目标：复用 `messages_fts` 或建 seq 倒排，万级 <50ms |
| P2 | 面板 locale | 文案仍硬编码中文；目标：接 `@deepseek-ai/dsh-client-locale` |
| P3 | 英文 eval 提升 | recall-bench 词法基线 top-6 仅 4/30（13.3%）；目标：改写/向量/别名覆盖把英文改写召回拉高 |

已在早期版本落地的项（保留在此便于追溯）：FTS5 混合检索（0.7.0）、向量旁路（0.8.0）、分层加权 + 时效衰减 + 冲突消解（0.2.0）、面板（0.6.0，1.6.3 迁入左栏、1.6.4 图表）、记忆关系与审核流（1.0.0）、restore/unfold/decompress（1.1.0/1.6.0）、本地 embed 服务（1.3.0）、git 项目身份（1.6.0）。

---

## 附录 A：抽取提示词（原文）

```
You maintain a long-term memory store for an AI coding assistant. Read the conversation slice below and extract durable, reusable knowledge that will help in future sessions.

Output ONLY a JSON array (no prose, no code fences). Each item:
{"kind": "decision|fact|preference|task|skill", "text": "<one self-contained sentence, keep exact paths/identifiers/values>", "tags": ["<short tag>"]}

Rules:
- Only durable knowledge: decisions and their rationale, project facts, user preferences, open tasks, reusable procedures.
- Each text must stand alone: no pronouns, no "this file"/"the above"; name the subject explicitly.
- Skip greetings, transient status, and anything only meaningful inside this conversation.
- At most 5 items; return [] when nothing is worth remembering.
```

发送时在末尾追加 `\n\n---\n` + 对话切片。

## 附录 B：召回注入消息（原文格式）

`recallMessage()` 的头部固定为：

```
以下是长期记忆里可能与当前任务相关的条目（由 context-hub 自动召回，仅供参考、可能过时；与当前对话冲突时以当前对话为准）：
```

随后是两类条目（命中消息时先出「原文窗口」，事实条目按命中消息分组，缩进两格）：

```
- 原文窗口 seq 102 [user]：……（消息级命中，整句窗口 ≤360 字符）
- 原文窗口 seq 88：……
  · [#12 decision project 2026-11-26] ……
- [#7 preference global 2026-11-20] ……
```

即：消息级命中 `- 原文窗口 seq N [role]：text`；事实条目 `- [#id kind scope YYYY-MM-DD] text`，若带 `message_seq` 则先写 `- 原文窗口 seq N：window`、再以 `  · [#…]` 缩进列出该窗口命中的条目。

整段最后再截断到 `min(recallMaxChars, floor(recallMaxTokens × 1.6))`：默认 `min(1800, 1200×1.6=1920)` = 1800 字符。注意选条目阶段已按「字符 + token 估算」双预算逐条过滤，这一步只是兜底截断。

## 附录 C：关键源码位置

行号按 1.6.4（`src/index.js` 共 4027 行）核对；**行号随版本漂移，以函数名为准**。

| 逻辑 | 位置 |
| --- | --- |
| 常量（KIND_VALUES / EXTRACT_MAX_INPUT / CANDIDATE_WINDOW） | `src/index.js:26-34` |
| `defaults` 配置对象 | `src/index.js:37-81` |
| `resolveConfig()`（clamp + env 覆盖） | `src/index.js:138-238` |
| `MemoryStore` 类 | `src/index.js:563` |
| `open()`（DDL / migrate / 索引） | `src/index.js:596-710` |
| `insert()`（hash + upsert 语义） | `src/index.js:837-905` |
| `rank()`（召回打分 / RRF / 衰减） | `src/index.js:1060-1205` |
| `searchHistory()`（线性扫描） | `src/index.js:1578-1597` |
| `recallMessage()`（注入格式） | `src/index.js:1825-1867` |
| `maybeRecall()` | `src/index.js:1949-2120` |
| `extractMemories()` | `src/index.js:2540-2618` |
| `installStatusRoute()`（4 条路由） | `src/index.js:3029-3160` |
| `defineTools()`（12 个工具） | `src/index.js:3241-3578` |
| `defineCommand()`（21 个子命令） | `src/index.js:3579-3878` |
| `apply()`（入口与事件挂载） | `src/index.js:3951-4027` |


## 22. 0.3.0 增量（P2 主体）

- **治理**：`forget <id>` 软删除（`status='deleted'`，召回与检索不再命中，审计链保留）；`supersede <id> <新内容>` 写新条目并把旧条目置 `superseded`、`superseded_by` 指向新条目；`audit <id>` 打印状态/置信/来源/证据 seq/时间/使用次数，并沿 `superseded_by` 展开最多 5 级后继。
- **召回调试**：`rank()` 返回逐项打分明细 `parts {overlap, ratio, base, weight, decay, usage, fts?}`；`explain <query>` 输出 50 条候选（含非 active）与每条「入选/跳过（已注入/冷却/条数预算/字符预算/状态）」原因，命中 FTS 时标注「FTS 第 n 位」。
- **观测事件**：新表 `context_events(id, kind, session_id, memory_ids, tokens, detail, created_at)`；`recall`、`extract`（记录新写入 id）、`compact`（记录 shadowedTokenCount 与摘要 seq）各写一行；`log [n]` 输出倒序时间线。
- **导出**：`export` 把全部记忆 + 最近 500 条事件写成 JSON（`exports/export-<ts>.json`，目录 0700、文件 0600）。
- **构成观测**：`status` 新增「构成」行——按 surface 节点的 seq 映射事件类型，拆为用户/助手/工具/注入(context-hub)/摘要(compaction)/其他，并显示 `totalTokens - surfaceTokens` 作为输出预留；system prompt 与工具定义未单独拆分（token-meter 的 baseline 不暴露这两段）。
- **压缩度量**：`foldedStats()` 汇总 `compaction/summary.shadowedTokenCount`，status 显示折叠区间数、折叠 tokens 与「折叠 tokens /（折叠 + 当前 surface）」压缩比。
- **权限**：打开数据库后 `chmod 0600`，忽略不支持 chmod 的平台错误。
- **仍未做**：C1 压缩水位与 C4 8 段摘要依赖替换 compaction 服务（会与 compaction-basic 抢同名服务，风险高）；客户端面板需要客户端 bundle 与 slot 注册。二者留待单独评估。

### 0.3.1 召回近义扩展

- 新增 `ALIAS_GROUPS`（18 组中英别名）与 `expandQueryTokens()`，只扩展查询侧词元；记忆原文与打分公式不变，因此预算、权重、衰减、冷却全部照旧。
- 例：查询 `fold` 会展开出 `压缩 / compact / compaction`，命中只写了中文「压缩」的记忆；查询「压缩」也能命中只写 `compact` 的记忆。
- 诊断：`context_hub_explain` 的「词元 / 覆盖率」会反映扩展后的查询词元数，便于判断是扩展过头还是没扩到。


## 23. 召回诊断与兜底（0.4.1）

- `maybeRecall` 记录三种结果：命中（`recall`，detail 前缀 `query:` 或 `context:`）、零命中（`recall-miss`）。
- 严格匹配零命中时，用「当前消息之前最近的助手/用户文本（≤600 字符）」再检索一次，解决「继续/做 3」这类短句与记忆零词面重叠的问题。
- 记忆侧也做近义扩展：`rank()` 对 `text + tags` 调用 `expandQueryTokens()`，与查询侧对称，`compact ↔ 压缩` 双向可通。
- `status` 活动行新增「召回未命中 N 次」，能区分「没触发」与「触发了但没命中」。

## 24. hub 压缩器（0.5.0）

- `compactor: native|hub`；hub 在 `ctx.inject(['compaction'])` 里包装实例的 `summarize()`，保存原方法并注册卸载。
- hub 摘要：8 段（含 `## 用户约束`）、maxTokens 3000、注入 ≤5 条记忆、`purpose: 'compaction'`；返回 `{summary, rawOutput, llmStreamCall: true, provider, model, maxTokens}`。
- 失败（空输出/流错误/无路由）→ `compact-hub-fallback` 事件 + `original.call(this, …)`，压缩继续。
- 运行时切换：`/context-hub compactor hub|native`；`status` 配置行显示档位。
- 为什么不是独立 bundle：见 [docs/compactor.md](compactor.md)（模块解析、双 compaction 服务、单插件三个约束）。

## 14. 客户端面板（0.6.0 → 1.6.3 左栏入口）

- 入口（1.6.3 起）：不再是输入框下方胶囊。左侧栏底部 `sidebar.footer.action` 注册紧凑徽章（环形进度 + 上下文百分比，有待审记忆时带琥珀点）；点击用 `createPortal` 在页面中央展开四分区面板（概览/记忆/观测/配置）。上下文只读，治理（forget/supersede/review）与开关（水位/压缩器/接管模式）可写。
- 会话 id 传递：左栏是 root scope、拿不到 sessionId，所以仍在 `conversation.composer.dock` 注册一个隐藏的 `ComposerAnchor`，只负责记住当前 sessionId 并广播给左栏徽章；输入框下方不再显示任何 UI。
- 数据通道：宿主 `installStatusRoute()` 在 `ctx.inject(['connection'])` 里用 `connection.fetch.register` 注册 **4 条**路由（`requestBody: 'buffered'`），鉴权由 connection 层负责（未认证 401）：
  - `GET /api/context-hub.status?sessionId=…` → `statusSnapshot()`：tokenMeter 测量、`surfaceBreakdown()` 构成、`foldedStats()`、`counts()`/`recentActive()`、`eventCounts()`、压缩器/水位/模式；
  - `POST /api/context-hub.watermark` `{enabled}`；
  - `POST /api/context-hub.review` `{action:'approve'|'reject', id}`；
  - `POST /api/context-hub.action` `{action:'forget'|'supersede'|'compactor'|'mode', id?, text?, value?}`。
- 客户端：手写 `window.__ModuleLoader__.load({id:'dsh-context-hub', factory(require){…}})`，只 require `react` / `react-dom`；`apply(ctx)` 里向 `sidebar.footer.action`（`context-hub-status`，order 2）与 `conversation.composer.dock`（`context-hub-session`，order 2）各 `ctx.slots.inject(...)` + `register(...)`；`package.json` 的 `dsh.client {platform:'web', immediately:true, inject:['@deepseek-ai/dsh-client-locale']}` 与 `exports['./client']` 负责加载。
- 视觉：1.3.1–1.5.5 面板图形化；1.6.4 加 KPI 图标、hero 渐变、缓存命中环、构成分布条、按类型甜甜圈、配置能力徽章、活动类型着色（纯 SVG，离线预览同样渲染）。
- 刷新：打开后 10 秒轮询 + 手动刷新；关闭即停表并 abort 请求。样式内联但全部取 DSH 主题 token（`--dsw-alias-*`，带兜底值），深色/浅色自动适配。
- 边界：不写会话日志、不触发压缩；治理写操作只改插件自有 SQLite。客户端文案暂未接 locale 服务（文案仍硬编码中文）。
- 验证：`node test-smoke.mjs` 断言假 ctx 下 4 条路由注册与 JSON 形状（0.6.0 冒烟日志里那句 `route: 1400 4 hub` 属历史格式，现以路由表断言为准）；线上 `curl` 路由返回 401，证明注册生效、鉴权在工作；浏览器面板需刷新页面后可见。

## 15. FTS5 混合检索与检索探针（0.7.0）

**动机**：关键词重叠对「子串/词形变化」无感（`gres` 召不回 `postgresql`）；需要一个零依赖的第二路检索，同时能量化召回质量。

**FTS5 表**（`open()` 内创建，失败即降级）：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text, tags, content='memories', content_rowid='id', tokenize='trigram'
)
```

- 外部内容表：文本仍以 `memories` 为唯一真相，FTS 只是索引；`open()` 时 `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` 全量重建，`insert()` 后用 `syncFtsRow(id,text,tags)` 增量补一行。
- tokenizer 选择：`unicode61` 对中文完全无效（1 个汉字都不切）；`trigram` 能命中 ≥3 字的任意中英片段（`压缩优先`、`compaction`），2 字中文仍靠关键词二元组。
- 打分：`ftsHits(query)` 返回 rowid→名次；`rank()` 里 `ftsBoost = 0.3 + 0.7 × (1 - 名次/总数)`，纯 FTS 命中给 `base = 0.8`。关键词仍是主路径，FTS 是加成/第二路径。
- 降级：`CREATE VIRTUAL TABLE` 失败（SQLite 未编 FTS5）→ `ftsReady=false`，`ftsHits()` 永远返回空 Map，行为等同 0.6.0；`status` 配置行显示「检索 关键词+FTS5 / 仅关键词」。

**检索探针**（`context_hub_probe`）：

- 取 active、长度 ≥8 的记忆（最多 200 条），统计词元文档频率，选每条的 2 个最稀有词元拼查询；
- 用与真实召回相同的 `rank()`（预算 `recallMaxItems`）检索，记录原条目名次；
- 返回 `{total,hits,rate,cases}`，事件记 `probe`；实测 4/4 命中（top-6）。抽取游标存于 `kv` 表（键 `extract:<sessionId>`），插件重载后从库内位置续接。命令 `/context-hub probe [n]` 与工具共用 `probeText()`，`status` 读取最近一条 probe 事件显示「探针：最近 M/N 命中」。

**已知局限**：trigram 的 bm25 在单文档时恒为 -0.000001，名次区分度有限；FTS 只按名次加成，不解析 bm25 数值。没有 embedding/向量旁路——零依赖是当前约束下的取舍。

## 16. 分发与发布（0.7.0）

- 打包：`npm pack` 产出 `dsh-context-hub-0.7.0.tgz`（14 文件，58,311 字节），内容是 `src/`、`client/`、`cordis.patch.yml`、`locale/`、`icon.svg`、`docs/`、README/LICENSE/CHANGELOG/package.json。
- 分发：复制 tgz 后 `plugin_manager install_bundle(target="/绝对路径/xxx.tgz")`；DSH 的 `parseInstallSpec` 对绝对路径 `.tgz` 返回 `{ kind: 'tarball' }`，走 pnpm tarball 安装。
- 自检：隔离目录 `npm install ./dsh-context-hub-0.7.0.tgz` 后，`dsh-context-hub`、`./locale/{en,zh}.json`、`./icon`、`./client` 均可解析；`import { apply, inject }` 得到 `tools,commands`。未在其它 DSH profile 做端到端安装。
- 发布：npm 未发布（本机无账号，用户决定暂缓）；`npm publish --dry-run` 通过，名称 `dsh-context-hub` 未被占用。
- SHA-256：`e5871153fd35b89de5a643835e8c5f86abd14246d40a35c272b4dc738bb5c466`。

## 17. 向量旁路与规模化（0.8.0）

- 数据：`memories` 新增 `embedding`（JSON 浮点数组，空串表示未取）与 `embedding_model`；旧库由 `migrate()` 补列。
- 写入：`insert()` 成功后排入 `embedQueue`（串行 Promise 链），`embedAndStore()` 调 `embedTexts([text])` 再 UPDATE；失败只记 `embedError`。启动时 `backfillEmbeddings(200)` 补齐历史。
- 查询：`embedQuery()` 带 100 条内存缓存；`rank({embVec})` 中 `cos = MemoryStore.cosine(embVec, JSON.parse(row.embedding))`，`cos ≥ minScore` 时 `emb = 0.5 + 0.5·cos`；`base = lexicalBase + ftsBoost + emb`，纯向量命中给 `lexicalBase = 0` 但 `emb > 0`，因此不会被跳过。
- 端点：`embedEndpoint()` 兼容 `baseUrl` 带/不带 `/embeddings`；请求体 `{model, input}`，`AbortSignal.timeout(timeoutMs)`；key 从 `apiKeyEnv` 指定的环境变量读取。
- 隐私：开启即意味着记忆文本外发；默认关闭，README 配置表已标注。
- 规模化：`PRAGMA journal_mode=WAL`、`synchronous=NORMAL`；`CANDIDATE_WINDOW=800` 控制每 scope 扫描量；FTS 命中里不在窗口内的 id 用 `SELECT ... WHERE id IN (...)` 补进候选（≤50）。
- 压测：`scripts/stress.mjs` 直接在 SQLite 里灌 10k 行（绕过 `mostSimilar` 的 O(n) 写入开销），测 `rank`/`probe`/库大小；结果见 README「已验证」。
- 已知边界：2 字中文查询仍依赖二元组 + 最近窗口；多进程并发写入未压测；向量不参与 `probe()`（探针只测关键词/FTS 路径）。

## 18. 压缩摘要入库与逐请求观测（0.9.0）

- 摘要入库（W3）：`ctx.on('session/event')` 新增 `compaction/summary` 分支 → `recordCompactionSummary()` 取 `event.data.summary` 的 text 块拼成正文（<40 字符丢弃），以 `kind=summary`、`scope=session`、`source=compaction`、置信 0.95 写入 `memories`，正文前缀 `[压缩摘要 seq A-B]`，`evidence_seq=A-B`；`source=compaction` 在 `insert()` 中与 `explicit` 一样绕过五维门槛，避免摘要因「不可独立验证」被拒。
- 写入成功记 `context_events(kind=summary, memory_ids, tokens=shadowedTokenCount)`；`status` 显示「最近压缩：seq …（摘要已作为记忆 #N 入库）」。摘要参与普通检索打分（关键词/FTS/向量），所以 `search`、`explain`、`probe` 都能命中，`scope=session` 让它随 TTL 归档。
- 水位可观测：`status` 在水位 ≥70% 时追加「建议压缩」；阈值本身仍由 profile 的 compaction-basic 配置决定，插件不硬改（见 spec C1）。
- 逐请求观测（W4）：`ctx.on('llm/stream', (options, next) => { sampleRequest(...); return next(options) })`——只观察不改写。过滤 `purpose` 以 `context-hub:` 开头的辅助调用与 `compaction`（避免摘要/抽取污染样本）。
- 样本字段：`purpose/provider/model/messages/tools/chars/estTokens`（字符数 ÷ 3.5 估算），以及从 `tokenMeter.measure(session)` 取到的 `surfaceTokens/totalTokens/injected/outputReserve`；写 `context_events(kind=request)`，`logEvent` 内对 request 做环形裁剪（保留最近 200 条）。
- 展示：`status` 输出「请求：最近 N 次主请求采样，平均约 X tokens」；`statusSnapshot.requests` 取最近 20 条，面板「最近主请求」逐条列出（目的、provider/model、消息数、估算 tokens）；`export` 的 events 里自然包含 request 样本。
- 性能：每次主请求一次 `measure()` + 一次 INSERT（本机 1200 节点量级）；压测未覆盖 measure 开销，按设计目标 <5ms/请求。
- 已知边界：`usage`（缓存命中/成本）尚未接入；采样不区分重试；panel 的列表是快照，不是曲线。

## 19. 记忆关系与审核流（1.0.0）

- 关系表：`memory_links(id, from_id, to_id, relation, weight, created_at, UNIQUE(from_id,to_id,relation))` + 两端索引；不建图数据库、不做 PageRank。
- 连边时机：`insert()` 里复用已算出的 `mostSimilar()`，相似度 ≥0.4 时连 `related`（权重=相似度）；`supersede()` 连 `supersedes`（权重 1）。连边失败只吞掉，不影响写入。
- 召回扩展：`maybeRecall()` 选出主命中后，若预算还有余量，`expandNeighbors(chosen ids, {limit:1, project})` 取边权最高的一条 active 邻居（同 project 或 global/session），补进注入并标记 `via=neighbor`；不改变主命中排序。
- 可解释：`explain` 在主候选后追加「邻居扩展（权 w，来源 #id）」行，并标注是否因条数/字符预算被跳过。
- 导出：快照升到 v2，`memories + links + events`；旧导出仍可读（没有 links 字段）。
- 审核：`reviewPending`（默认 false）开启时，`insert()` 对 `source=extracted && confidence<0.8` 写 `status='pending'`；`rank()` 只取 active，所以 pending 不会被召回。`reviewList/approve/reject` 操作 pending，`approve → active`、`reject → deleted`；命令 `/context-hub review [list|approve|reject]`，事件 `review-approve`/`review-reject`。
- 状态机：`pending → active`（批准）或 `pending → deleted`（拒绝）；已 active 的记忆不能再被 review 命令改变。
- 默认关闭的理由：开启后自动抽取的记忆默认置信 0.6，会全部进 pending，等于把「自动记忆」变成「人工记忆」；适合团队/多 agent 场景显式打开。

## 20. 召回基准、可逆还原与并发验证（1.1.0）

- 召回基准（W1）：`scripts/recall-bench.mjs` 内置 30 条「记忆 → 改写查询」，查询与原句几乎不共享词元，避免用同一句话自测。默认只跑词法路径（关键词 + FTS5 + 18 组近义）；设置 `DSH_CONTEXT_HUB_EMBED_URL` / `_MODEL` 后，同一个 `rank()` 再加 vector 模式，两条路径的预算、冷却、scope/TTL、准入门槛完全一致，所以差值只归因于语义。基线实测 top-6 4/30（13.3%）——这是目前最诚实的 W1 数字，也说明“改写召回”确实是短板。
- 可逆还原（W3）：`restoreTranscript(session, start, end, maxChars)` 只读会话日志，把 `user/message` 与 `assistant/message` 按 seq 还原成带角色标签的文本，默认 4000 字符、最多 12000，超限截断并标记。`context_hub_restore` 工具用 `exec.deferContext()`、`/context-hub restore` 用 `agent.inject()`，两条路径都产出一条 `source={kind:'context-hub', form:'relay'}` 的上下文消息，并写 `restore` 观测事件。它不删除摘要、不改变压缩结果，属于“折叠后仍能回看细节”的检索式可逆，不是 billion-context 的消息级 `decompress`。
- 并发验证（W6）：`scripts/concurrency.mjs` fork 3 个子进程，每个向同一库插 300 条；`busy_timeout=5000` + WAL 下实测 900/900、`quick_check=ok`、`journal_mode=wal`，总耗时约 220ms。仍不覆盖 100k 级与长事务。
- 版本 1.1.0；冒烟测试增加 restore 的工具和命令双路径断言。

## 21. 硬顶与超时、git 项目身份、消息级 unfold（1.6.0）

### 21.1 召回注入的 token 硬顶与总时限

- 字符预算不能代表真实体积：中文一个汉字约 1 token，而 `recallMaxChars` 按字符算。1.6.0 增加 `estimateInjectTokens(text) = ceil(len / 1.6)` 作为保守估计，单次注入另受 `recallMaxTokens`（默认 1200）约束。
- 双预算在选条目时同时生效：消息窗口、事实条目、邻居扩展各走一遍 `used + len <= recallMaxChars` 与 `fits(text)`（token 估算）；任一超限就跳过该条，而不是事后截断整段（截断会切掉后面的条目编号与来源行）。
- 总时限：`recallTimeoutMs`（默认 4000，0=关闭）算出 `deadline`。改写只在剩余 ≥200ms 时发起（`AbortSignal.timeout` 取剩余时间），重排只在剩余 ≥150ms 时发起，向量查询在剩余 ≤120ms 时跳过；注入前再检查一次，超时则写 `recall-timeout` 事件并**本次不注入**。理由：记忆是锦上添花，不能让一次慢模型调用拖住用户回合。
- 可观测：`status` 配置行显示「硬顶 N tokens/超时 M ms」；活动标签有「召回超时」。

### 21.2 git 身份做 project

- 动机：跨机器/换目录后 `cwd` 变了，project 记忆就“消失”。1.6.0 默认 `projectIdentity: 'git'`，把 `git remote get-url origin` 归一化成 `git:host/owner/repo`（小写、去 `.git`、ssh/https/scp 三种写法同一 key）；没有 origin 时退回 `path:<toplevel>`；不是 git 仓库则用 cwd。
- 解析顺序：`projectKeyCache`（进程内）→ `kv['project:<cwd>']` → git 推断 → 写回 kv；`projectIdentity: 'cwd'` 可完全恢复旧行为。
- 迁移：首次得到 `key ≠ cwd` 时 `migrateProject(cwd, key)` 把 `memories.project` 与 `messages.project` 一起改掉，写 `kv['project-migrated:<cwd>']` 防重复，记 `project-migrate` 事件（带条数）。
- 边界：只在 project 键变化时迁移一次；如果同一 cwd 后来换了 remote，需要手动清 `kv` 的 `project:<cwd>`（未做自动失效）。

### 21.3 消息级可逆展开（unfold）

- 目标：压缩把一段消息折叠成一个摘要节点后，模型只能看到摘要。`unfold` 允许“接下来 N 步用原文替代摘要”，补上 billion-context 式 `decompress` 的会话内版本。
- 识别 checkpoint：`findCompactionCheckpoint(session, range)` 从 `session.seq-1` 往前扫 `compaction/summary` 事件，用 `shadowedSeqs` 的 min/max（没有则 `shadowedRange`）判断是否覆盖请求的 start；命中后记下 `compactionId` 与 `[start, end)`。
- 区间来源：可以给 `start/end`（配合 `decompress` 的 seq），也可以给 `id`（summary 记忆编号 / 最近一次压缩），复用 `resolveCompactionRange()`。
- 执行：`unfoldRange()` 把 `{start,end,budget,remaining}` 放进 `stateOf(session).unfolds`，写 `unfold` 事件。`installUnfold()` 注册 `agent/pre-step`：先 `await next()` 拿决策，只有 `kind === 'enter'` 时才替换 `decision.messages` 中 `source.kind === 'compact-checkpoint'` 且 id 命中的消息；替换成 `role=user`、`source={kind:'context-hub', form:'unfold'}` 的原文 relay。每替换一次 `remaining -= 1`，到 0 删除条目、恢复摘要。
- 只改请求不改日志：替换发生在 pre-step 的内存消息里，`session` 事件日志、surface、摘要节点都不动，所以 `history/decompress/export` 仍看到原始折叠结构。
- 预算：默认 `unfold.steps=3`、`unfold.maxChars=8000`（单步原文上限 20000），由 `restoreTranscript()` 按 seq 还原 user/assistant 文本并截断。
- 工具与命令：`context_hub_unfold`（参数 id/start/end/steps/maxChars）与 `/context-hub unfold [id:<编号>|起始seq] [结束seq] [steps:<n>]`。
- 测试：冒烟里构造 4 条消息 + 一条 `compaction/summary(shadowedSeqs=[0..3])`，`unfold start=0 end=2 steps=2` 后由 pre-step 的 `enter` 决策带一个 `compact-checkpoint` 消息触发，断言输出消息 `source.form === 'unfold'` 且包含 `ORIGINAL-0`。
