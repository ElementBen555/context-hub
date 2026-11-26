# 上下文中枢 · 功能规格（v1.0 冻结 + 实现对照）

> 本文件是**冻结的目标规格**，后面的「与 1.6.4 实现的差距」逐项标明落地状态；参数总表同时给出代码默认值，二者冲突时以代码与本章实现列为准。

> 状态：**已冻结 v1.0**（2026-11-25，D1–D5 已拍板，见第 9 节）。参数调整走版本变更：先改本文档 → 再改实现。
> 本文档定义「压缩、记忆、观测」三件事的边界、参数与验收标准；实现差距见第 8 节。
> 变更规则：任何改动必须先改本文档并注明版本，再改代码。

---

## 0. 一句话定义

| 能力 | 本质 | 成功标准 |
| --- | --- | --- |
| 压缩 | **预算问题**：固定窗口内最大化决策相关信息密度 | 压缩后仍能回答「在做什么、改过什么、下一步、卡在哪」 |
| 记忆 | **质量问题**：只写跨会话仍然成立的命题 | 召回条目被采纳率高，错记忆接近零 |
| 观测 | **归因问题**：每一 token 都能说清从哪来、为什么在 | 任意一步可回答「上下文里有什么、为什么」 |

---

## 1. 总原则

- **P1 单一真相**：会话日志是唯一真相；记忆库、摘要、面板全是派生视图，可随时重建。
- **P2 上下文税**：压缩、召回、抽取共享一个预算上限——默认 **模型窗口的 5%**。任何一项超支必须在观测面板可见。
- **P3 失败降级**：任一子功能失败只降级自身，不阻塞会话、不改会话状态、不抛错。
- **P4 可逆**：压缩可检索原文；记忆可追溯到证据消息；注入可区分来源。
- **P5 默认最小**：默认作用域 session、默认只读面板、默认不跨项目共享。

---

## 2. 压缩（C）

### C1 触发条件

| 触发 | 条件 | 优先级 |
| --- | --- | --- |
| 压力 | `pressure ≥ contextWindow × 70%` | 自动 |
| 模型切换 | 新模型窗口更小，当前 surface 超出 | 自动 |
| 溢出 | 收到上下文超限错误 | 自动，立即 |
| 手动 | `/context-hub compact` | 最高，抢占自动 |

同一时刻只允许一个压缩任务（busy 时手动请求返回「压缩进行中」）。

### C2 选区

- 只压**连续区间** `[startSeq, endSeq)`，一次一个区间。
- **禁止**压缩：system prompt、工具定义、用户最新一条消息、当前未完成的 tool_use/tool_result 对。
- 保留尾部原文：最近 `retainTokens = 20000` 不参与折叠。
- 区间必须对齐轮次边界（不跨 `turn/start`），避免摘要里出现半截对话。

### C3 目标水位

- 压缩后 `surface ≤ contextWindow × 60%`。
- 若单次压缩达不到水位，允许连续压缩多个区间，但每次之间重新测量。
- 压缩失败（摘要不可用）时回退：先 prune 工具输出，再放弃本次压缩并记录事件。

### C4 摘要结构（固定 8 段）

1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and Fixes
5. Pending Jobs
6. Current Work
7. Next Step
8. **User Constraints**（用户明确说过的限制，逐条保留）

**无损清单**（摘要里必须逐字保留）：文件路径、命令、错误码、配置键、数值阈值、未完成事项、用户原话中的约束。

### C5 可逆与检索

- 每个摘要记录 `startSeq / endSeq / summarySeq`。
- `context_hub_history` 能检索被折叠区间的原文。
- 摘要本身作为一条消息进入 surface，来源标记 `notice{summary}`。
- **消息级展开（1.6.0）**：`unfold` 记录「哪个压缩区间、接下来几步」，pre-step 把 `source.kind === 'compact-checkpoint'` 的摘要节点临时替换成原文 relay（`form=unfold`）；只改本次请求，不改会话日志，步数用完自动恢复摘要。

### C6 度量

| 指标 | 定义 | 目标 |
| --- | --- | --- |
| 压缩比 | 折叠 token / 原 token | 记录，不设硬指标 |
| 溢出复发率 | 压缩后 3 轮内再次溢出的比例 | < 5% |
| 探针通过率 | 压缩后回答 5 个关键问题的正确率 | ≥ 4/5 |
| 缓存友好 | 压缩是否保留前缀（system+tools+保留尾部） | 是 |

### C7 与原生 compaction 的边界

- **不替换** `compaction-basic`，不注册第二个 compaction 服务。
- 本插件只做：触发策略、折叠区检索、P2 的「记忆感知摘要」——已实现（0.5.0）：包装 `compaction` 实例的 `summarize()`，不替换服务；默认 `compactor: 'native'`，hub 为 opt-in。

---

## 3. 记忆（M）

### M1 记忆单元

一条记忆 = **一条自包含命题** + 元数据。判定标准：脱离当前对话、去掉指代后仍能独立成立。

类型限定：`decision`（决策+理由）、`fact`（项目事实）、`preference`（用户偏好）、`task`（未完成）、`skill`（可复用做法）、`summary`（压缩摘要自动生成，scope=session）。

### M2 写入门槛（质量分 0–1，≥0.6 才写）

| 维度 | 权重 | 判定 |
| --- | --- | --- |
| durable | 0.30 | 未来 7 天仍可能有用 |
| specific | 0.25 | 含路径/标识符/数值/约束 |
| non-derivable | 0.20 | 不能从代码、git、配置文件现场推出 |
| verifiable | 0.15 | 能指向证据消息 seq |
| non-duplicate | 0.10 | 与库内条目相似度 < 0.85 |

低于 0.6 的候选**丢弃而不是降级存储**。宁可少写：错记忆会持续污染后续会话。

### M3 元数据

```
kind, scope(session|project|global), confidence(0–1),
source(extracted|explicit|tool|compaction), evidenceSeq（单个区间字符串，如 "12-19"）,
created_at, last_used, uses, status(active|superseded|archived|pending|deleted)
```

置信度默认：`explicit = 1.0`、`compaction = 0.95`、`tool = 0.8`、`extracted = 0.6`。

### M4 作用域与生命周期（默认 session，可跨会话）

| scope | 归属 | TTL | 检索权重 | 说明 |
| --- | --- | --- | --- | --- |
| session | 当前会话 | **3 / 7 / 15 / 30 天可选，默认 7 天**未用 → archived | 1.0 | 会话决策、临时约束 |
| project | `git:host/owner/repo`（默认，origin 归一化）/ `cwd` | 90 天 | 0.8 | 项目事实、构建命令、踩坑；默认 git，跨机器一致，首次解析迁移旧 cwd 行 |
| global | 用户 | 永久，需被使用 | 0.6 | 偏好、跨项目习惯 |

- 默认写入 scope 由 `kind` 决定：`preference → global`，`task/decision → project`，其余 `session`。
- 会话结束**不删除** session 记忆，只让它随 TTL 衰减。
- 可选值实现为配置 `memory.sessionTtlDays ∈ {3,7,15,30}`，默认 7；修改只影响之后到期判定，不追溯删除。
- 跨 scope 召回需要显式开启（默认只在同 scope + global 内召回）。

### M5 衰减与淘汰

```
runtime_score = base_score × exp(-λ_scope × days_since_last_used) × (1 + 0.1 × min(uses, 10))
λ_session = 0.10, λ_project = 0.01, λ_global = 0.002
```

- 每 scope 上限 **5000 条**；超出按 `runtime_score` 升序淘汰到 `archived`。
- `archived` 不参与召回，记录保留，可按 id 用 `audit` 追溯；暂无恢复为 `active` 的命令（`/context-hub restore` 只还原折叠区原文，不是恢复记忆）。
- 删除是软删除 + 墓碑：`/context-hub forget <id>` 只把 `status` 置为 `deleted` 并保留审计链（不做硬删除、无额外确认步骤）；已删除条目不会被同文写入复活。

### M6 复用与召回

- 触发：真人消息提交时（`source.kind === 'user'`，长度 ≥ 4）。
- 预算：**最多 8 条 / 1800 字符**，计入上下文税；同一记忆注入后冷却 6 轮。
- **硬顶与超时（1.6.0）**：单次注入另有 `recallMaxTokens`（默认 1200）token 硬顶，按中文 ~1.6 字符/token 粗估；整次召回有 `recallTimeoutMs`（默认 4000ms）总时限，改写/重排/向量只在剩余时间内执行，超时本次不注入并记 `recall-timeout`。
- 去重：同一会话内同一 id 不重复注入；同一 id **6 轮冷却**（1.5.6 起）。
- 排序：关键词重叠分 × scope 权重 × 运行时衰减分；FTS5 trigram 命中作加成（≥3 字符的片段，纯子串命中给 0.8 基础分），FTS5 不可用时自动退回纯关键词。
- 质量度量：`context_hub_probe` 从记忆自造查询，报告 top-k 命中率与逐条位置；命令行 `/context-hub probe [n]`；`status` 展示最近一次探针结果。
- 注入形态：独立 user 消息，`source = {kind:'context-hub', form:'recall'}`，开头声明「仅供参考、可能过时、冲突以当前对话为准」。
- 可解释：注入附带每条命中的 token（写入调试日志，不占注入预算）。

### M7 冲突消解

| 冲突类型 | 判定 | 策略 |
| --- | --- | --- |
| 事实冲突 | 同 scope 同 subject，值不同 | 新证据胜，旧条目 `status=superseded`，保留链 |
| 偏好冲突 | 显式 remember 与旧 preference 矛盾 | 显式胜，旧条目 `superseded` |
| 决策冲突 | 项目演进导致前后决策不同 | 并存，召回时**并列标注**「曾决定 A，后改为 B」 |

策略开关 `conflictPolicy`：

- `evidence`（默认）：按上表——事实/偏好以证据强度与新证据判定，决策类并列标注时间线。
- `recency`：严格时间优先，新条目无条件胜出，旧条目置 `superseded` 且不并列展示（只保留历史可检索）。

- 同一 slot 判定：同 scope + 语义相似度 > 0.85 + 同一 subject key（如「记忆存储方案」）。
- 禁止静默二选一：决策类冲突必须让模型看到时间线。

### M8 治理与审计

- 每条记忆可追溯 `evidenceSeq`（哪几条消息支撑）与 `source`。
- `/context-hub` 提供：`search`、`remember`、`forget <id>`、`supersede <id> <新内容>`、`audit <id>`。
- 每周自动维护（P2）：去重合并、过期归档、冲突扫描。
- 任何自动变更都要留下 `status` 变更记录（只改状态、不删记录）。

### M9 隐私与隔离

- 记忆库默认权限 `0600`：打开库时 `open()` 执行 `chmod 0600`（失败不阻塞）。
- 项目隔离：默认只召回当前 `project` + `global`；跨项目检索只能用工具 `context_hub_search` 的 `all: true`，命令 `/context-hub search` 暂不支持 `--all`。
- 面板与导出只读本地，不上传；导出文件包含原文，需提示用户。

---

### M10 抽取频率

- 默认**每轮 2 次**（`turn/end`，可配 1–10），按增量：只处理游标 `extractedSeq` 之后的新消息，无新内容则不调用模型。
- 可配置 `memory.extractPassesPerTurn ∈ 1..10`，默认 2：同一轮内最多做 N 次增量抽取（用于工具循环很长、单次输入被截断的轮次）；每轮实际次数受「是否有新内容」约束。
- 每次抽取成功才推进游标；失败保留游标，下一轮重试。
- 抽取调用计入上下文税的第 2 优先级（见附录 C）。

## 4. 观测（O）

### O1 每步六段堆叠

| 段 | 来源 |
| --- | --- |
| 系统提示词 | system prompt 组装结果 |
| 工具定义 | tools schema |
| 历史消息 | surface（压缩后） |
| 注入上下文 | 召回、摘要、插件注入 |
| 输出预留 | maxTokens |
| 压缩预留 | headroom |

末尾以斜线显示「已用 / 窗口」。任一注入项可展开看原文与来源。

### O2 每步事件

- 本步注入了哪些记忆 `id`、命中 token、打分。
- 本步是否发生压缩、折叠了哪些 seq。
- token 用量、估算成本、cache 命中率。
- 模型路由（provider/model/effort）。

### O3 会话级视图

- 时间线：用户消息 → 召回 → step → 压缩 → 注入，按 seq 排列。
- 折叠区间可视化：可展开原文（复用 `history`）。
- 记忆库浏览：按 scope / kind / status 过滤，显示 `uses / last_used`。
- 上下文压力曲线：每步 pressure / window。

### O4 归因指标

| 指标 | 用途 |
| --- | --- |
| 注入 token 占比 | 判断记忆是否挤占预算 |
| 召回命中率 | 用「后续是否重复提问」做代理 |
| 压缩次数与压缩比 | 调压缩水位 |
| 记忆增长与使用分布 | 判断写入门槛是否过松 |
| 每千轮成本 | 抽取调用的经济性 |

### O5 召回调试

给定一条查询，输出每条候选的：命中 token、base/scope/decay 分、是否被预算或冷却过滤。回答「为什么这条没被召回」。

### O7 客户端面板（0.6.0 起；1.4.0 图形化/表格化；1.5.5 分区；1.6.3 左栏入口）

- 入口：左侧栏底部徽章（圆环 + 百分比，待审带琥珀点）→ portal 弹层。固定 KPI 头（压力环 + surface/合计/节点/输出预留）；下方四分区：概览（构成 / 成本曲线 / 活动 Top 5）、记忆（指标块 + 范围/类型条形图 + 最近使用表 + 待审核 approve/reject）、观测（上下文明细 / 活动全量 / 最近主请求与召回车道）、配置（运行参数 + 水位开关 + 压缩器 + 接管模式）。
- 写操作仅限治理与开关：`POST /api/context-hub.watermark`、`/review`、`/action`（forget/supersede/compactor/mode）；记忆内容不可编辑，上下文数据只读。
- 数据：宿主 `GET /api/context-hub.status`（connection 鉴权）返回 `{ok, session{surfaceTokens,totalTokens,nodes,pressure,contextWindow,parts,folded,events}, memory{active,scopes,kinds,recent}, activity, config, compactor, db}`。
- 刷新：打开后 10 秒轮询，关闭停止；失败显示错误而不阻塞聊天。
- 归因：面板只展示已记录的事实（度量/计数/配置），不做推断；注入与压缩的逐条明细仍在 `log` / `history` / `explain`。

### O6 入口与导出

- `/context-hub status`：文本版六段摘要。
- 面板（已实现，0.6.0 起，O7）：左栏底部徽章打开弹层，支持展开与筛选，并提供治理与开关的写操作。
- 导出：JSON 事件流 + 记忆库快照（显式操作，含隐私提示）。

---

## 5. 参数总表

| 参数 | 目标值 | 当前实现 |
| --- | --- | --- |
| 压缩触发水位 | 70% | 用原生默认 |
| 压缩目标水位 | 60% | 用原生默认 |
| 尾部保留 | 20k tokens | 原生 `retainTokens` |
| 召回条数 | 8 | 8（1.5.6） |
| 召回字符 | 1800 | 1800 |
| 召回 token 硬顶 | 1200 | 1200（1.6.0） |
| 召回总时限 | 4000ms | 4000ms（1.6.0） |
| 召回冷却 | 6 轮 | 6 轮 |
| project 身份 | git origin 归一化 | git（1.6.0，可配 cwd） |
| session TTL | 3/7/15/30 天，默认 7 | 已实现（默认 7，可配） |
| project TTL | 90 天 | 已实现（默认 90，0=不过期） |
| 每 scope 容量 | 5000 | 已实现（session 按会话计数） |
| 写入门槛 | 0.6 | 五维评分（显式 remember 绕过） |
| 冲突检测阈值 | 0.85 | 已实现（同 scope + project/session 过滤） |
| 冲突策略 | evidence（默认）/ recency | 已实现（`conflictPolicy`） |
| 上下文税上限 | 窗口 5% | 部分：单次注入 1200 tokens 硬顶 + 4000ms 超时（1.6.0） |
| 抽取频率 | 每轮 2 次，可配 1–10 | 每轮 2 次（增量分片） |
| 抽取模型 | 会话当前模型 | 当前模型 ✅ |
| DB 权限 | 0600 | 打开时 `chmod 0600` |

---

## 6. 失败矩阵

| 故障 | 降级 | 观测 |
| --- | --- | --- |
| SQLite 不可用 | 记忆功能关闭，其余正常 | status 显示 0 条 + 警告 |
| 抽取模型失败 | 不推进游标，下轮重试 | 调试日志 |
| 摘要模型失败 | 回退 prune，再失败放弃本次压缩 | 压缩事件标 error |
| 模型路由缺失 | 跳过抽取 | 调试日志 |
| 事件不可读 | 跳过该 seq | 调试日志 |
| 记忆库损坏 | 重命名为 `.corrupt` 并新建空库 | 启动警告 |

---

## 7. 验收标准

- **A1** 压缩后能正确回答：当前任务、涉及文件、下一步、未完成事项（4/5 通过）。
- **A2** 注入的记忆与当前任务相关率 ≥ 60%（人工抽检 20 条）。
- **A3** 同一会话同一记忆不重复注入；6 轮冷却生效。
- **A4** 冲突写入后，检索结果中新旧条目标注 `superseded`，不静默丢旧值。
- **A5** `status` 输出的 token 数与 `tokenMeter` 实测一致。
- **A6** 任一子功能故障时，会话仍能正常完成一轮。

---

## 7bis. C8 压缩器实现与回退

- 两档：`native`（原生 7 段）与 `hub`（记忆感知 8 段 + 记忆候选），默认 `native`。
- 实现：在 `compaction` 服务实例上包装 `summarize()`，保留原生触发、选区、恢复与 `/compact`；不新增第二个 compaction 服务。
- 失败：空输出/流报错/无路由 → 记录 `compact-hub-fallback` 并回退原生，压缩不中断。
- 切换：配置 `compactor`（重启生效）或 `/context-hub compactor hub|native`（运行时）。
- 理由（D6）：out-of-tree 插件无法解析 `@deepseek-ai/dsh-compaction-basic`（会引入第二份 cordis）；同 profile 不允许双 compaction 服务；单插件是用户前提。

## 8. 与 1.6.4 实现的差距

| 需求 | 现状 | 差距 | 优先级 |
| --- | --- | --- | --- |
| M2 写入门槛 | 五维加权 ≥0.6，显式 remember / compaction 绕过 | 部分实现（0.2.0）：durable/specific/verifiable 真实打分；nonDerivable 只有 0.2/0.5 两档、nonDuplicate 恒为 1（均为常量，不是真实判定） | P2 |
| M4 scope/TTL | scope 列 + TTL 归档（3/7/15/30 可配） | 已实现（0.2.0） | — |
| M5 衰减/容量 | 运行时打分 + 每 scope 5000 上限淘汰 | 已实现（0.2.0） | — |
| M6 召回预算 | 8 条 / 1800 字符，冷却 6 轮 | 已实现（1.5.6） | — |
| M6 冷却 | 6 轮冷却 | 已实现（1.5.6） | — |
| M10 抽取次数 | 每轮 1–10 次增量，可配 | 已实现（0.2.0） | — |
| D1 TTL 可选 | 3/7/15/30 配置项 | 已实现（0.2.0） | — |
| D5 冲突策略 | evidence / recency 开关 | 已实现（0.2.0） | — |
| M7 冲突 | 相似度 ≥0.85 同 scope 时 supersede；决策-决策并列保留 | 已实现（0.3.0） | — |
| M8 治理 | `forget` 软删、`supersede` 替换、`audit` 链、`log`、`export` | 已实现（0.3.0） | — |
| O1 六段 | 按事件类型拆用户/助手/工具/注入/摘要 + 输出预留 | 部分实现（0.3.0；system/tools 未拆） | P2 |
| O2 每步事件 | `context_events` 表记录 recall/extract/compact | 已实现（0.3.0） | — |
| O3 会话视图 | 命令 `log` + 工具 `context_hub_log` 时间线 | 已实现（0.3.0） | — |
| O5 召回调试 | 命令 `explain` + 工具 `context_hub_explain` 输出候选与打分明细、跳过原因 | 已实现（0.3.0） | — |
| O6 导出 | `export` 写 JSON 快照（0600） | 已实现（0.3.0） | — |
| O7 面板 | 左栏底部徽章（圆环 + 百分比，待审带琥珀点）+ 四分区弹层（KPI/概览/记忆/观测/配置），治理与开关路由 | 已实现（1.5.5 四分区；1.6.3 左栏入口）；用户已目视确认 | locale 未接 |
| O8 检索探针 | `context_hub_probe` 输出 top-k 命中率与逐条位置 | 已实现（0.7.0） | — |
| M6 混合检索 | 关键词 + FTS5 trigram 加成；不可用降级 | 已实现（0.7.0） | — |
| W3 摘要可检索 | `compaction/summary` → `kind=summary`（session）记忆，`search/explain/probe` 可命中；`status` 显示最近压缩与水位 | 已实现（0.9.0）；水位阈值仍由原生 `thresholdRatio/retainTokens` 决定 | 水位透传校验 |
| W1 向量旁路 | 可选 `/embeddings`，cosine 加成、超时降级、`explain` 归因 | 已实现（0.8.0）；无真实端点，仅 fetch stub 验证 | 端点实测 |
| W6 规模化 | WAL、候选窗口 800 + FTS 补入、10k 压测脚本 | 已实现（0.8.0）；单进程 10k 实测 | 多会话并发未测 |
| W4 逐请求观测 | `llm/stream` 采样写 `context_events(kind=request)`（环形 200 条），`status`/面板显示最近请求，`export` 含样本 | 已实现（0.9.0） | usage/缓存字段待接 |
| W2 记忆关系 | `memory_links` + related/supersedes，召回一跳扩展 ≤1 条，`explain` 标注来源 | 已实现（1.0.0）；不做 PageRank/全图 | 关系类型扩展 |
| W5 审核流 | `reviewPending` 低置信入 pending，`/context-hub review approve|reject`，审计事件 | 已实现（1.0.0）；默认关闭以免阻塞自动抽取 | 审批通知 |
| W1 基准 | `scripts/recall-bench.mjs` 30 条改写探针；本地 bge-small-zh 实测 top-6 **56.7%**（词法 13.3%） | 已实测（1.1.1/1.2.0）；未达 70% 线 | 换大模型或改写 |
| W3 还原 | `context_hub_restore` / `/context-hub restore`：按 seq 还原折叠区原文，预算 4000 字符，`form=relay` 注入 | 已实现（1.1.0） | 消息级 decompress |
| W3 展开 | `context_hub_unfold` / `/context-hub unfold`：pre-step 用原文临时替代压缩摘要，默认 3 步 × 8000 字符 | 已实现（1.6.0） | 面板入口 |
| M6 硬顶/超时 | `recallMaxTokens` + `recallTimeoutMs`，超时记 `recall-timeout` 不注入 | 已实现（1.6.0） | — |
| M4 git project | origin 归一化为 `git:host/owner/repo`，首次解析迁移旧 cwd 行 | 已实现（1.6.0） | — |
| W6 并发 | `scripts/concurrency.mjs`：3 进程 × 300 条同写，`quick_check` + WAL 校验 | 已验证（1.1.0）；100k 级未测 | 长事务压测 |
| C1 触发水位 | `watermark`（opt-in）：pre-step 按 triggerRatio 触发，自己取「保留尾部 retainTokens」的区间调 `compactRegion`；默认关闭，失败记录并交给原生 | 已实现（1.2.0，opt-in）；开关可持久化（1.2.1） | 大区间授权策略 |
| C4 8 段摘要 | `compactor: hub` 时 8 段（含用户约束） | 已实现（0.5.0；`native` 仍用原生提示词） | — |
| 权限 0600 | 创建后 chmod 0600 | 已实现（0.3.0） | — |
| 分发 | `dist/` 由 `scripts/pack.sh` 按 `package.json` 版本生成（`git archive`，含 `embed/node_modules`），当前 1.6.4；`dist/INSTALL.md` 说明绝对路径 `.tgz` 安装（本次发布生成 1.6.4 归档） | 已打包自检，未在其它 profile 端到端验证 | npm 未发布（用户决定） |

---

## 9ter. v1.2 语义改写与水位接管（1.2.0）

### 9ter.1 查询改写（可选，默认关）

- 位置：召回前（`maybeRecall`）、`context_hub_search`、`/context-hub search|explain`。
- 做法：一次 `llm.stream`（`purpose=context-hub:rewrite`，maxTokens 1200（空输出放大预算重试一次），超时 12s），提示词要求输出一行 8–12 个同义词/英文关键词；结果拼到检索文本后，仍走同一 `rank()`（预算/权重/衰减/门槛不变）。
- 缓存：按查询文本缓存（默认 128 条），命中不重复调用；失败/空输出记 `rewrite-error`/`rewrite-empty` 并回退原查询。
- 配置：`rewrite {enabled, provider, model, maxTokens, timeoutMs, cacheSize}`；`provider/model` 为空时用 agent 当前路由。
- 成本：每条新的真人消息一次小模型调用；可在 profile 用 `rewrite.enabled: false` 关闭。

### 9ter.2 水位接管（可选，默认关）

- 位置：`agent/pre-step`（prepend，先于原生监听器）；只有 `watermark.enabled` 时才注册。
- 判定：`tokenMeter.contextPressure(session)` 的 `pressureTokens/contextWindow ≥ triggerRatio`；同一轮冷却 `cooldownTurns`。
- 选区：`Session.surface.nodes` 从尾部累加估算 tokens，保留尾部 `retainTokens`，起点取首个 surface seq、终点取保留区前一个 seq；少于 `minRegionNodes` 不动作。
- 执行：`compaction.compactRegion(start, end, agent, signal)` —— 原生负责配对校验、摘要、回放替换和持久化；成功后写 `watermark` 事件，失败写 `watermark-error` 并静默交还原生。
- 开关与持久化：`/context-hub watermark on|off` 或面板按钮 → `setWatermark()`，状态写 `kv.watermark.enabled`，重启后 apply 时恢复；不需要改 profile 配置。
- 与 hub 压缩器关系：可同时开；hub 只换摘要提示词，watermark 决定何时/压哪段。
- 风险：区间过大可能一次折叠掉大量对话；建议先在空闲会话试 `retainTokens`，或用 `/context-hub watermark on|off` 灰度。

### 9ter.3 可选 LLM 重排（1.2.2，默认关）

- 位置：`maybeRecall` 选中预算前、`context_hub_search`、`/context-hub search`；`explain` 复用同一路径。
- 做法：取关键词/FTS/向量合并后的前 `candidates` 条（默认 10），把「查询 + 编号候选」交给一次 `llm.stream`（`purpose=context-hub:rerank`，maxTokens 默认 600、可配 100–2000），要求只返回按相关度排序的编号 JSON 数组；按返回顺序重排，未提及的候选保持原相对顺序接在后面。
- 降级：无 `llm`、模型路由缺失、超时（默认 8s）、输出不是数组 → 记 `rerank-error`/`rerank-empty` 并原样返回，不影响召回。
- 配置：`rerank {enabled, provider, model, candidates, maxTokens, timeoutMs}`；env `DSH_CONTEXT_HUB_RERANK=1` / `_PROVIDER` / `_MODEL`。
- 成本：每条真人消息多一次模型调用；召回是异步的，不阻塞用户回合，但会占用一次额度。
- 边界：只重排已入选候选，不扩大召回集合；语义缺口仍需向量或改写补。

## 9. 已决定（v1.0 冻结）

| ID | 问题 | 决定 |
| --- | --- | --- |
| D1 | session 记忆 TTL | 默认 7 天；可选 3 / 7 / 15 / 30 天 |
| D2 | 压缩水位 | 70% 触发、压到 60%；先按默认，后续看效果调整 |
| D3 | 召回预算 | 8 条 / 1800 字符、冷却 6 轮（1.5.6 起）；抽取 2 次/轮 |
| D4 | 抽取频率 | 默认每轮 2 次（1.5.6 起）、按增量；可配 1–10 |
| D5 | 冲突策略 | 默认「新证据胜 + 决策并列标注」；可选「严格时间优先」 |

冻结后的调整流程：改本文档并升小版本（v1.1…）→ 同步参数总表与差距表 → 再改实现。

---

## 9bis. v1.1 补充：可选向量召回与规模化（0.8.0）

- **定位**：向量是关键词 + FTS5 的旁路，不是主路径。关闭时行为与 0.7.0 完全一致。
- **配置**：`embedding.enabled`（`baseUrl`/`DSH_CONTEXT_HUB_EMBED_URL` 存在时自动开启）、`baseUrl`、`model`、`apiKeyEnv`、`minScore`（默认 0.35）、`timeoutMs`（默认 1500）。
- **写入**：`insert()` 后进入串行后台队列取向量并写 `memories.embedding`（JSON 数组）与 `embedding_model`；启动时对缺失向量的 active 条目补写（最多 200 条）。
- **查询**：召回时 `embedQuery()` 取查询向量（内存缓存 100 条），`rank()` 对每条候选算 cosine；`cos ≥ minScore` 时 `emb = 0.5 + 0.5·cos`，与关键词/FTS 分相加；无词元重叠也可单独命中。
- **降级**：端点非 2xx、超时、响应缺 `data[].embedding` 时记 `embedError` 并继续关键词路径；`status` 显示「+向量（异常：…）」。
- **隐私**：开启后记忆文本（含路径/标识符）会发送到配置的外部端点；默认关闭，文档需在启用说明中标注。
- **本地服务（1.3.0）**：`embed/` 目录随包分发（`server.mjs` + `start.sh`/`stop.sh` + README）；1.6.2 起包含 `node_modules`（3,163 个文件 / 462.7MB），模型缓存不随包，另附 `dsh-context-hub-models-e5-q8.tar.gz`（解压到 `embed/.cache/`）；`embedding.autoStart` 默认 true，仅当 `baseUrl` 是回环地址（127.0.0.1/localhost/::1）时生效——插件启动先 ping `/health`，未就绪则 `spawn(process.execPath, [embed/server.mjs], {detached:true})`，端口取自 `baseUrl`、模型取自 `embedding.model`（无 `/` 时补 `Xenova/`），30s 内轮询就绪后回填向量；事件 `embedding-start`/`embedding-ready`/`embedding-start-error`，失败只降级。手动 `start.sh` 仍可用，两者共用同一 `embed.pid` 之外的端口检测（先 ping，避免重复进程）。

- **规模化**：`journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=5000`；候选窗口 `CANDIDATE_WINDOW=800`，FTS 命中按 id 补入（≤50 条），避免大库只覆盖最近窗口造成的漏召回。
- **度量**：`scripts/stress.mjs` 10k 条 → rank p50 12.5ms / p95 15.2ms（120 查询）、probe 20/20（133ms）、库 3.9MB（本机 Node 24.22.2）。
- **实测（1.2.2）**：30 条改写探针（词法 top-6 13.3%，p50 0.3ms）→ `bge-small-zh-v1.5` 56.7%（6.1ms）→ `bge-base-zh-v1.5` int8 56.7%（10.2ms）→ `bge-m3` int8 60%（19.6ms）→ **`bge-m3` int8 + 中文指令前缀 66.7%**（top-1 43.3%，p50 25.7ms，top-10 仍 20/30）；`bge-large-zh-v1.5` int8 + 前缀 63.3%（31.7ms，top-10 22/30）。仍未达 W1 的 70% 验收线；m3 的 10 条未命中落在 top-10 之外，LLM 重排没有可捞回的候选，故重排对基准无提升（它是排序修正，不是召回扩展）。`minScore` 降到 0.25/0.15 无变化，说明不是门槛误杀。

## 附录 A：记忆状态机

```
candidate ──score≥0.6──▶ active
candidate ──reviewPending 且 confidence<0.8──▶ pending ──approve──▶ active
pending ──reject──▶ deleted
active ──新证据冲突──▶ superseded
active ──TTL 到期/容量淘汰──▶ archived
active/archived/pending ──显式 forget──▶ deleted（软删除 + 墓碑，审计链保留）
（暂无 archived → active 的恢复命令；`/context-hub restore` 只还原折叠区原文，不是恢复记忆）
```

## 附录 B：召回打分（目标）

```
base    = overlapCount + (overlap / queryTokens) * 2 + (kind === 'preference' ? 1 : 0)
final   = base * scopeWeight * exp(-λ * daysSinceLastUsed) * (1 + 0.1 * min(uses, 10))
过滤    = overlap==1 && queryTokens>6 → 丢弃
        | status !== 'active' → 不参与
        | 会话内已注入 或 6 轮冷却 → 跳过
```

## 附录 C：上下文税

```
recallTokens + injectedSummaryTokens + extractionOverhead ≤ window * 0.05
```

超支时优先级：召回 > 摘要注入 > 抽取（抽取可延后到下一轮）。
