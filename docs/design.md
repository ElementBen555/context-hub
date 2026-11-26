# 上下文中枢（dsh-context-hub）设计与使用文档

> 版本 1.6.0 · 适用 DSH 0.2.3-alpha.2（已在本机 profile `web` 验证）
> 本文档描述**当前实现（1.6.0）**；目标规格已冻结为 [spec.md](spec.md) v1.0，实现差距见 spec 第 8 节。
> 已落地：P1 记忆准入/scope/TTL/衰减/冷却（0.2.0）、治理与观测命令（0.3.0）、近义召回（0.3.1）、召回兜底（0.4.1）、hub 压缩器（0.5.0）、客户端只读面板（0.6.0）、FTS5 混合检索与检索探针（0.7.0）、向量旁路与规模化（0.8.0）、压缩摘要入库与逐请求观测（0.9.0）、记忆关系与审核流（1.0.0）、召回基准/可逆还原/并发验证（1.1.0）、语义改写/水位接管（1.2.0）、本地 embed 服务（1.3.0）、面板图形化与四分区（1.3.1–1.5.5）、召回预算 8/1800 与分片抽取（1.5.6）、硬顶/超时、git 项目身份、消息级 unfold（1.6.0）。
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
        context_hub_* 四个工具 ────────────────┘
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
4. `tokens()` 切词，`store.search()` 扫最近 500 条记忆；
5. 过滤本会话已注入过的 id（`state.injected`）；
6. 取 ≤8 条、总长 ≤1800 字符，组装一条 user 消息；
7. `agent.inject(message)` 排入下一 pre-step；`touch()` 累加使用次数；
8. 注入内容是**一条独立 user 消息**，不改本轮用户原文、不进 system prompt、不产生新事件类型。

### 4.2 一轮结束 → 抽取 → 写库

1. `turn/end` 触发，异步执行（不 await，不阻塞收尾）；
2. 取 `state.extractedSeq → session.seq` 之间的事件，只挑 `user/message`、`assistant/message`；
3. 拼成 `User:` / `Assistant:` 文本，截断到**最后** 8000 字符；
4. 解析模型路由，`llm.stream()` 发一次性请求（`maxTokens: 600`，`purpose: 'context-hub:extract'`）；
5. 累积 `text-delta`，用 `parseMemories()` 容错解析 JSON 数组；
6. 逐条 `insert()`：`sha1(kind + 小写文本)` 去重，冲突只更新 kind；
7. **成功后才**把 `extractedSeq` 推进到本轮末尾；失败则下轮重试（幂等）。

### 4.3 /context-hub compact → 原生压缩

```
ctx.get('compaction').compactNow(agent, signal, commandId)
  → CompactionResult { shadowedSeqs, shadowedTokenCount, summarySeq, ... }
```

插件不参与选区、不参与摘要生成。压缩后的摘要作为新的 surface 起点，原始事件仍在会话日志里，因此 `context_hub_history` 依旧能检索到——这就是「给压缩补一个可检索的折叠区」。

---

## 5. 功能规格

### 5.1 记忆条目模型

类型（kind）固定五种：`decision`（决策及理由）、`fact`（项目事实）、`preference`（用户偏好）、`task`（未完成任务）、`skill`（可复用做法）。非法 kind 落为 `fact`。

抽取提示词要求每条 `text` 是**自包含的一句话**，保留精确路径、标识符、数值；最多 5 条；没有可记的就返回 `[]`。完整提示词见附录 A。

### 5.2 召回打分

```
tokens(text) = 拉丁词（[a-z0-9_./:#-]{2,}） ∪ 中文二元组
overlap      = |queryTokens ∩ memoryTokens|
ratio        = overlap / |queryTokens|
score        = overlap + ratio * 2 + (kind === 'preference' ? 1 : 0)
```

- 丢弃规则：`overlap === 1 且 queryTokens > 6` 视为噪声；
- 候选池：`ORDER BY last_used DESC, created_at DESC LIMIT 500`；
- 排序：`score` 降序，同分按 `created_at` 降序；
- 预算：最多 8 条、总字符 ≤1800（含表头与编号）；
- 去重：同一会话内注入过的 id 不再注入（进程内 `WeakMap<Session, {injected:Set}>`）。

### 5.3 存储

DDL（`memory.db`）：

```sql
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,        -- sha1(kind \0 lower(text))
  kind TEXT NOT NULL,               -- decision|fact|preference|task|skill
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',    -- 逗号分隔
  project TEXT NOT NULL DEFAULT '', -- 写入时的 session.header.cwd
  session_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,      -- epoch ms
  last_used INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memories_kind ON memories(kind);
```

写入用 `INSERT … ON CONFLICT(hash) DO UPDATE SET kind = excluded.kind RETURNING id`。

> 注意：冲突时**只更新 kind**，不会刷新 text/tags/project。也就是说「同一句话在另一个项目里再次出现」不会改写归属。这是 0.1.0 的有意保守选择，避免一次抽取错误覆盖历史数据。

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
| `记忆 N 条（kind…）` | `GROUP BY kind` | 记忆库构成 |
| `@ 路径` | `store.file` | 实际数据库位置 |

### 5.6 工具与命令

| 名称 | 参数 | 输出 | 说明 |
| --- | --- | --- | --- |
| `context_hub_search` | `query` 必填，`limit` 默认 5（上限 20） | 文本列表 | 检索记忆 |
| `context_hub_remember` | `text` 必填，`kind` 可选，`tags` 逗号分隔 | `已记住（#id）` | 手动写记忆，记录当前 cwd/session |
| `context_hub_history` | `query` 必填，`limit` 默认 5（上限 20） | `seq / role / 片段` | 检索完整会话日志 |
| `context_hub_status` | 无 | 见 5.5 | 只读洞察 |
| `/context-hub` | `status`、`search <q>`、`remember <text>`、`history <q>`、`compact` | 文本 | 命令版入口；`compact` 调原生压缩 |

---

## 6. 与 DSH 的契约

本插件只依赖**稳定公开面**，不 import 任何 `@deepseek-ai/*` 包（因此无需安装依赖、无版本对齐问题）：

| 依赖 | 用法 | 备注 |
| --- | --- | --- |
| `ctx.tools.register` | 注册 4 个工具 | `parameters` / `output.schema` 必须是**标准 JSON Schema** |
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

插件随后**静默不激活**（application: failed），工具不会出现。修法见 `TEXT_OUTPUT` 与四个工具的 `parameters`。

---

## 7. 配置

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | 决定默认库路径 |
| `DSH_CONTEXT_HUB_DB` | 空 | 直接覆盖数据库文件路径 |
| 库位置 | `$DSH_HOME/context-hub/memory.db` | 首次启动自动 `mkdir -p` |

代码内常量（改需重载）：

```js
RECALL_MAX_CHARS = 1800  // 单次召回注入的字符预算（可配置）
RECALL_MAX_ITEMS = 4     // 单次召回条数
EXTRACT_MAX_INPUT = 8000 // 抽取时对话切片上限
maxTokens: 600           // 抽取输出上限
```

> 0.1.0 没有 Config schema；要可视化配置需要导出 `Config`（Schemastery），属于路线图。

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
| 工具可见性 | 本会话动态出现 4 个 `context_hub_*` 工具 |
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
- 工具全部只读或只写自有库，不发起网络请求；抽取走宿主 `llm` 服务，不直连 API。
- 记忆库是本地文件（默认 0644 由 umask 决定），包含对话摘要性内容；共享机器上建议 `chmod 600` 或换 `DSH_CONTEXT_HUB_DB` 到私有目录。
- 召回内容进入模型上下文，属于**不可信数据**：即使记忆库被投毒，标注与「以当前对话为准」的措辞可降低但不能消除影响。写入路径目前只有本插件的抽取提示词与显式 `remember`。

---

## 12. 已知限制

1. **关键词召回**：同义改写、跨语言表述召回率有限；无向量、无 FTS5。
2. **无分层加权**：`project` 字段存了 `cwd`，但打分未使用；跨项目记忆平权参与竞争。
3. **无时效衰减**：旧决策与新决策同权，冲突不会自动消解；`uses` 只增不减。
4. **upsert 不刷新正文**：同 hash 只更新 kind，标签/项目/文本不更新。
5. **抽取有成本**：每轮一次辅助 LLM 调用（`maxTokens: 600`），长会话可考虑改为每 N 轮或按 token 增量。
6. **单进程**：`injected`、`extractedSeq` 在内存，同一 SQLite 被多个 DSH 实例共用时只有库是共享的。
7. **history 线性扫描**：无倒排索引，超大日志（>1 万事件）会变慢。
8. **无 UI**：只有命令与工具；`README` 里的面板仍是路线图。

---

## 13. 路线图

| 优先级 | 事项 | 验收标准 |
| --- | --- | --- |
| P1 | 混合检索（FTS5 旁路，关键词兜底） | 同义改写查询召回率提升，且零依赖降级可回退 |
| P1 | 分层记忆（会话/项目/全局）+ 项目加权 | 同项目记忆排序高于跨项目；可配置权重 |
| P1 | 时效衰减与冲突标记 | 新旧冲突条目在 `search` 输出中标注 `superseded` 而非静默合并 |
| P2 | 客户端面板（`window.__ModuleLoader__` + 右侧栏 slot） | 可视化记忆库、注入记录、折叠历史；只读优先 |
| P2 | 记忆感知压缩 | 用 `summarize()` 钩子把高价值记忆编进摘要骨架——**真正的差异化点** |
| P2 | history 倒排索引 | 万级事件检索保持在 50ms 内 |
| P3 | 导入/导出、记忆编辑与删除、`Config` schema | 不碰 SQL 也能治理记忆 |

---

## 附录 A：抽取提示词（原文）

```
You maintain a long-term memory store for an AI coding assistant. Read the conversation slice below and extract durable, reusable knowledge that will help in future sessions.

Output ONLY a JSON array (no prose, no code fences). Each item:
{"kind": "decision|fact|preference|task|skill", "text": "<one self-contained sentence, keep exact paths/identifiers/values>", "tags": ["<short tag>"]}

Rules:
- Only durable knowledge: decisions and their rationale, project facts, user preferences, open tasks, reusable procedures.
- Skip greetings, transient status, and anything only meaningful inside this conversation.
- At most 5 items; return [] when nothing is worth remembering.
```

发送时在末尾追加 `\n\n---\n` + 对话切片。

## 附录 B：召回注入消息（原文）

```
以下是长期记忆里可能与当前任务相关的条目（由 context-hub 自动召回，仅供参考、可能过时；与当前对话冲突时以当前对话为准）：
- [#12 decision] ……
- [#7 preference] ……
```

整段截断到 `recallMaxChars`（默认 1800）字符。

## 附录 C：关键源码位置

| 逻辑 | 位置 |
| --- | --- |
| 入口与事件挂载 | `src/index.js:538-564` |
| 召回 | `src/index.js:216-246` |
| 抽取与路由解析 | `src/index.js:267-316` |
| 存储与打分 | `src/index.js:80-167` |
| 工具注册 | `src/index.js:379-470` |
| 命令注册 | `src/index.js:471-532` |
| 常量 | `src/index.js:24-27` |


## 11. 0.3.0 增量（P2 主体）

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


## 12. 召回诊断与兜底（0.4.1）

- `maybeRecall` 记录三种结果：命中（`recall`，detail 前缀 `query:` 或 `context:`）、零命中（`recall-miss`）。
- 严格匹配零命中时，用「当前消息之前最近的助手/用户文本（≤600 字符）」再检索一次，解决「继续/做 3」这类短句与记忆零词面重叠的问题。
- 记忆侧也做近义扩展：`rank()` 对 `text + tags` 调用 `expandQueryTokens()`，与查询侧对称，`compact ↔ 压缩` 双向可通。
- `status` 活动行新增「召回未命中 N 次」，能区分「没触发」与「触发了但没命中」。

## 13. hub 压缩器（0.5.0）

- `compactor: native|hub`；hub 在 `ctx.inject(['compaction'])` 里包装实例的 `summarize()`，保存原方法并注册卸载。
- hub 摘要：8 段（含 `## 用户约束`）、maxTokens 3000、注入 ≤5 条记忆、`purpose: 'compaction'`；返回 `{summary, rawOutput, llmStreamCall: true, provider, model, maxTokens}`。
- 失败（空输出/流错误/无路由）→ `compact-hub-fallback` 事件 + `original.call(this, …)`，压缩继续。
- 运行时切换：`/context-hub compactor hub|native`；`status` 配置行显示档位。
- 为什么不是独立 bundle：见 [docs/compactor.md](compactor.md)（模块解析、双 compaction 服务、单插件三个约束）。

## 14. 客户端面板（0.6.0）

- 形态：`conversation.composer.dock`（session scope）里的一枚胶囊，点击用 `createPortal` 展开为只读面板；避开了右侧栏 tab 的 resource/address 机制，也不占用主面板。
- 数据通道：宿主 `installStatusRoute()` 用 `ctx.inject(['connection'])` 注册 `GET /api/context-hub.status`（`connection.fetch.register`，`requestBody: 'buffered'`），鉴权由 connection 层负责（未认证 401）。处理函数按 `sessionId` 取 `sessions.get()`，复用 `statusSnapshot()`：tokenMeter 测量、`surfaceBreakdown()` 构成、`foldedStats()`、记忆 `counts()`/`recentActive()`、`eventCounts()`、压缩器状态与配置。
- 客户端：手写 `window.__ModuleLoader__.load({id:'dsh-context-hub', factory(require){…}})`，只 require `react` / `react-dom`；`apply(ctx)` 里 `ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({id:'context-hub-status', order:2}, Pill))`；`package.json` 增加 `dsh.client {platform:'web', immediately:true, inject:['@deepseek-ai/dsh-client-locale']}` 与 `exports['./client']`。
- 胶囊文案：`上下文中枢 · 上下文 N% · 记忆 M`；N 取 `pressureTokens / contextWindow`，M 取 active 数。加载失败时显示「不可用」且面板给出错误文本。
- 面板刷新：打开后 10 秒轮询 + 手动刷新；关闭即停表并 abort 请求。样式全部内联，用系统色（`Canvas`/`CanvasText`/`Highlight`/`GrayText`）随明暗主题变化，不依赖主题变量。
- 边界：只读；不写会话、不触发压缩、不提供 forget/supersede（写操作仍走工具与 `/context-hub`）。客户端文案暂未接 locale 服务（下一步与发布准备一起处理）。
- 验证：`node test-smoke.mjs` 断言假 ctx 下路由注册与 JSON 形状（`route: 1400 4 hub`）；线上 `curl` 路由返回 401，证明注册生效、鉴权在工作；浏览器面板需刷新页面后可见。

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
