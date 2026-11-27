# dsh-context-hub · 上下文中枢

一个插件，把 **压缩、记忆、洞察** 三件事装进同一个 DSH bundle：只安装一次，宿主侧零构建（纯 ESM JavaScript），数据落在本地 SQLite。

> 文档索引：
> - [docs/spec.md](docs/spec.md) — 功能规格 v1.0（已冻结，差距表随版本更新）：压缩水位、记忆标准/作用域/冲突/治理、观测维度、参数表、验收标准
> - [docs/design.md](docs/design.md) — 当前实现的架构、数据流、存储结构、DSH 契约、失败模式与路线图
> - [docs/comparison.md](docs/comparison.md) — 与 billion-context / dsh-memory（灵枢）/ OpenViking / graph-memory / dsh-mnemon 的六方对比、W1–W8 弱项拆解与五维补强计划
> - [docs/EVAL.md](docs/EVAL.md) — 召回评测脚手架、R@k/MRR 口径、zh-holdout 与 LongMemEval 用法
> - [docs/RELEASE.md](docs/RELEASE.md) — npm / dshmarket 发布清单与回滚（D2，当前受 npm 账号阻塞）
> - [docs/ROADMAP.md](docs/ROADMAP.md) — 补强路线图（P0 评估 / P1 图谱 / P2 压缩账本 / P3 规模 / P4 CI / P5 npm / P6 多平台），后续开发按此执行

## 为什么是「一个」而不是「三个」

这三件事在 DSH 里本来就是同一条上下文流水线的三个环节：

- **记忆**决定「什么该带进新会话」；
- **压缩**决定「当前会话装不下时丢什么、留什么」；
- **洞察**决定「你怎么知道上面两件事做得对不对」。

它们共享同一份存储、同一条注入通道（`agent.inject()`）和同一个检索入口，拆成三个插件只会重复造轮子、互相打架。

## 能力

| 能力 | 实现 | 入口 |
| --- | --- | --- |
| 记忆 | `turn/end` 用会话当前模型抽取结构化记忆，过五维质量门槛后写入 SQLite | 自动 + `context_hub_remember` |
| 召回 | 用户发消息时按关键词 + FTS5 trigram 混合打分（近义扩展 + scope 加权 + 时间衰减），可选叠加向量余弦；注入下一个 step（标记为「仅供参考」） | 自动 + `context_hub_search` |
| 检索质量 | `context_hub_probe` 自造查询测 top-k 命中率；`context_hub_explain` 给出逐条打分明细 | `context_hub_probe` / `context_hub_explain` |
| 治理 | session/project/global 分层、TTL 归档、容量淘汰、冲突 supersede | 自动 |
| 压缩 | 复用 DSH 原生 compaction；`compactor: hub` 时在实例上包装 `summarize()`（8 段提示词，失败回退） | `/context-hub compact`、`/context-hub compactor` |
| 压缩摘要入记忆 | 监听 `compaction/summary`，摘要以 `kind=summary`（session）入库，之后可被检索/探针命中 | 自动 + `context_hub_search` |
| 折叠区检索 | 直接扫完整会话日志（含已折叠区间） | `context_hub_history` |
| 折叠区还原 | 按 seq 区间把原文重新注入下一步（有字符预算） | `context_hub_restore` / `/context-hub restore` |
| 摘要区间还原 | 按最近一次压缩摘要（或 summary 编号）还原原始消息并注入（默认 8000 字符预算） | `context_hub_decompress` / `/context-hub decompress` |
| 消息级可逆展开 | 对压缩摘要执行 `unfold`：接下来 N 步的 pre-step 用原文临时替代摘要节点（只改模型请求，不改会话日志） | `context_hub_unfold` / `/context-hub unfold` |
| 硬性预算 | 一次召回注入受 token 硬顶（默认 1200）与总时限（默认 4000ms）双重保护；超时本次不注入，只记 `recall-timeout` | 自动 |
| 项目身份 | 默认把 git `origin` 归一化为 `git:host/owner/repo`（跨机器一致）；首次解析自动把旧 cwd 行迁移到新 key | 自动 |
| 洞察 | 上下文 surface/总 tokens、构成拆分、输出预留、水位、已折叠区间、最近压缩、最近主请求采样 + 记忆库构成 + 消息索引 + 成本曲线 | `/context-hub status`、左栏徽章 + 中央弹层 |
| 审计 | 软删除、显式替换、审计链、观测日志、JSON 导出 | `/context-hub forget/supersede/audit/log/export` |
| 记忆关系 | `memory_links` 连边（related/supersedes），召回时一跳扩展 ≤1 条 | 自动 + `explain` 可见 |
| 消息索引 | 独立 `messages` + `messages_fts`，召回前增量索引；零记忆也能按原文召回 | 自动 + `explain` 消息候选 |
| 审核流 | `reviewPending=true` 时低置信抽取先入 pending，人工 approve/reject | `/context-hub review` |

## 安装

```bash
# npm registry（1.7.4 起可用；slim 包，不含 embed 依赖）
# plugin_manager install_bundle(target="dsh-context-hub@1.7.4")

# 分发包（含 embed/node_modules，推荐给别的机器；绝对路径必须指向 .tgz）
# plugin_manager install_bundle(target="/绝对路径/dist/dsh-context-hub-<版本>.tgz")

# 或者从本地目录安装（开发时）
# plugin_manager install_bundle(target="/absolute/path/to/context-hub")
```

`dsh-context-hub` 已于 2026-11-27 发布到 npm（public，首个版本 1.7.4）：https://www.npmjs.com/package/dsh-context-hub 。npm 包是 slim 包（约 280 kB，不含 `embed/node_modules`）；要用本地向量，需在安装目录执行 `cd embed && npm install --ignore-scripts`，或者改用含依赖的 `scripts/pack.sh` 分发包 / `git clone`。

安装后 profile 的 `package.json` 会增加依赖与 bundle 条目，`cordis.patch.yml` 插入 `id: dsh-context-hub`。

改完源码后重新加载（不必重装）：

```
plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)
```

> 注意：`ctx.tools.register` 的 `parameters` / `output.schema` 必须是标准 JSON Schema（对象上用 `required: [...]` 数组），不能写逐属性的 `required: true`——那是 `defineTool` 的简写，只有它会归一化。

## 已验证

- **1.7.4**：面板压缩器 native ⇄ hub 可切换并持久化，失败返回 409；冒烟覆盖路由与快照。
- **1.7.3**：召回分段耗时复盘（重排占 97%）；`rerank.reasoningEffort=low` 降 30%；新增 `docs/PERF.md`。
- **1.7.2**：召回分段耗时写入日志；短查询跳过改写；重排默认候选 6；`node test-smoke.mjs` → `SMOKE OK`。
- **1.7.1**：搜索缓存（写入失效）+ 启动实体回填 + 重排空输出重试/强头跳过；面板图谱 chips 与账本明细；`node test-smoke.mjs` → `SMOKE OK`。
- **1.7.0**：图谱 1-hop（实体/边自动抽取，召回补 ≤2 条）与压缩账本（折叠次数/节省/复问率）；`node test-smoke.mjs` → `SMOKE OK`（含图谱 2 实体/3 链接、账本省 961 tokens）。
- **1.6.6**：10 万条记忆 + 2 万条消息下 rank p50 **85.6ms / p95 99.8ms / p99 106.6ms**，DB 67MB，RSS 249MB；见 [`docs/SCALE.md`](docs/SCALE.md)。探针在合成语料上 60%（模板重复导致歧义），真实库 8/8。
（本机 profile `web`）

- 1.6.4：面板图表/甜甜圈/缓存环增强，`node test-smoke.mjs` → `SMOKE OK`。
- 1.6.3：`cordis_inspect` 显示左栏 `sidebar.footer.action` 注册 occupant `id=context-hub-status`、`order=2`、`active:true`；`conversation.composer.dock` 只挂隐藏的 `ComposerAnchor`。
- 1.6.2：`scripts/pack.sh` 打出的含 vendored deps 分发包 3,196 文件 / 157,534,812 字节，SHA-256 `fdd5f16b…`。
- 1.6.1：墓碑守卫与 `session` 作用域隔离等 P0/P1 修复后回归 `node test-smoke.mjs` → `SMOKE OK`。
- 1.6.0：召回注入硬顶/超时旁路、git 身份 project（含旧行迁移）、消息级 unfold 三项冒烟断言通过（`captokens: 131 字符 ≤ 160`、`timeout: 慢改写超预算 → 记 recall-timeout`、`project: cwd → git:github.com/foo/bar（迁移 1 次）`、`unfold: checkpoint 摘要 → 原文 relay`）→ `SMOKE OK`。
- 1.5.3：`node test-smoke.mjs` → `SMOKE OK`，新增 retainTurns 折叠区间断言；`multilingual-e5-small` 让 zh-holdout R@5 达到 100%、英文 LongMemEval 12 题向量与词法持平（83.3%）；`mode takeover/full` 默认保留最后 5 轮，只折叠最旧前缀。
- 1.5.2：独立消息索引 + 成本曲线；早期 `zh-holdout` 向量 58.3% 是评测脚本未等 embedding 队列导致的欠采样，修正后同模型为 83.3%，已在 docs/EVAL.md 更正。
- 1.3.0 自动拉起本地向量服务：杀掉 11434 后重载插件，1 秒内 `/health` 恢复 `{"ok":true,...,"ready":false}`（首次请求后 `ready:true`），`status` 活动出现「启动向量服务 1 次、向量服务就绪 1 次」，检索行仍为 `关键词+FTS5+向量`。
- 1.2.0 语义改写与水位的实测：`explain 把历史折叠起来而不是删掉` 返回「改写：历史折叠 折叠历史 … fold history」并把向量分从 +0.71 提到 +0.80；`node test-smoke.mjs` 覆盖 `compactRegion(0, 8)` 水位触发与改写行 → `SMOKE OK`。
- 1.1.1 本地向量实测：`embed/` 起本地 `bge-small-zh-v1.5`（512 维，ONNX CPU，95MB）后，同一 30 条改写探针 **top-6 13.3% → 56.7%**（top-1 4/30 → 8/30），p50 6.1ms；`explain` 显示「向量 +0.7x」；未达 70% 验收线，属小模型对极抽象改写的区分度限制。
- 1.1.0：`node scripts/recall-bench.mjs` → 词法基线 top-6 4/30（13.3%），`node scripts/concurrency.mjs 3 300` → CONCURRENCY OK；`node test-smoke.mjs` 新增 restore 工具/命令与 relay 来源断言 → `SMOKE OK`。
- 1.0.0：`node test-smoke.mjs` → `SMOKE OK`，新增断言覆盖「邻居扩展（explain 含邻居扩展）」「export 含 links」「reviewPending 独立库 pending → approve → search」；`node scripts/stress.mjs` 10k 条 rank p95 14.9ms、probe 20/20；分发包 `dsh-context-hub-1.0.0.tgz`（15 文件；大小与 SHA-256 见 `dist/INSTALL.md`）。
- 0.8.0：向量旁路——冒烟测试用 fetch stub 验证「无共享词元」的查询（`海洋哺乳动物计划的节奏` → `项目代号蓝鲸需要双周同步`）靠 cosine 命中，且 `explain` 显示 `向量 +1.00`，向量关闭时既有断言不变；规模化（`node scripts/stress.mjs 10000`）：10,000 条记忆、WAL，`rank` p50 12.5ms / p95 15.2ms（120 次查询），`probe` 20/20 命中（133ms），库 3.9MB，候选窗口 800 + FTS 按 id 补入解决了「大库只看最近窗口」的漏召回。
- 0.7.0 混合检索与探针：真实库 `context_hub_probe` → `检索探针：4/4 命中（top-6 命中率 100%）`；`status` 显示 `检索 关键词+FTS5` 与 `探针：最近 4/4 命中（100%）`；冒烟用例覆盖纯子串命中（`gres` → postgresql）、`/context-hub probe` 命令与抽取游标跨重载续接。
- 0.6.0 面板：`curl http://127.0.0.1:3080/api/context-hub.status` 返回 `401 unauthorized`（路由已注册、鉴权生效），浏览器内由已认证页面 fetch 同一路径取数。
- 0.6.0 面板注册：`cordis_inspect`（client `Slots.listSubTree`，根 `conversation.composer.dock`）显示 occupant `id=context-hub-status`、`order=2`、`active=true`，与内建 `activity`/`usage` 并列；用户已于 2026-11-25 目视确认胶囊显示「上下文中枢」。
- 0.2.0 升级验证：旧库自动补列（3 条旧记忆 → scope=session），`status` 显示 `active 3（session 3）` 与新配置行；实写 `context_hub_remember` 带 scope → `已记住（#4，project，置信 1）`。

- 插件 entry：`include:dsh-context-hub`，`application: applied`，无 warnings。
- 实际工具返回：`上下文：surface 216887 tokens / 合计 233141 tokens（234 个节点）`、`压缩：已折叠 0 个区间；事件 865 条`、`记忆：1 条 @ /home/element/.dsh/context-hub/memory.db`。
- `context_hub_remember` → `已记住（#1）`；`context_hub_search` 立即命中；`context_hub_history` 在 865 条事件里定位到最早的 `seq 8 [user] 安装dshmarket`。
- 无 DSH 的假 ctx 冒烟测试：`node test-smoke.mjs` → `SMOKE OK`（工具/命令注册、召回注入、turn/end 抽取、检索、status、冲突 supersede、`/api/context-hub.status` JSON 快照）。

## 使用

```
/context-hub status                  # 洞察：上下文压力 / 折叠区间 / 记忆库
/context-hub doctor                  # 自检：FTS5/向量/改写/重排能力与推荐档
/context-hub mode [observe|assist|takeover|full]  # 接管分级
/context-hub decompress [id:<编号>|起始seq] [结束seq]  # 按摘要区间还原原文
/context-hub search 关键词            # 检索长期记忆
/context-hub remember 要记住的内容     # 手动写一条记忆
/context-hub history 关键词            # 检索完整会话日志（含折叠区）
/context-hub restore 起始seq [结束seq]  # 还原折叠区原文并注入下一步（预算 4000 字符）
/context-hub unfold [id:<编号>|起始seq] [结束seq] [steps:<n>]  # 展开压缩摘要：接下来 N 步用原文替代
/context-hub explain 关键词           # 召回调试：候选、打分明细、未入选原因
/context-hub probe [n]               # 检索命中率探针（默认 10 条）
/context-hub log [条数]               # 观测事件时间线（recall/extract/compact）
/context-hub audit 编号               # 审计链：状态、置信、证据、后继
/context-hub forget 编号              # 软删除（审计链保留）
/context-hub supersede 编号 新内容     # 显式替换并保留 supersede 链
/context-hub export                  # 导出记忆与事件快照（JSON, 0600）
/context-hub compact                 # 立即触发一次原生压缩
/context-hub compactor <hub|native>  # 运行时切换压缩器（失败回退原生）
/context-hub reembed                 # 重算全部向量（换模型后）
/context-hub watermark [on|off]      # 水位压缩开关（持久化）
/context-hub config [键] [值]         # 查看/修改召回预算、TTL、抽取、冲突、语义开关（持久化）
/context-hub watermark [on|off]      # 水位压缩开关（持久化到记忆库）
/context-hub review                  # 待审核列表（reviewPending 开启时）
/context-hub review approve 编号      # 批准后才会被召回
/context-hub review reject 编号       # 拒绝（软删除，审计链保留）
```

面板：刷新 Web 页面后，左侧栏底部是徽章「圆环 + 上下文百分比」（待审时带琥珀色小点，不再显示「记忆 M」）。点开是 640px 卡片，顶部固定 KPI（压力环 + surface/合计/节点/输出预留），下面四个分区：**概览**（上下文构成堆叠条 + 分段表、成本曲线「总估算/注入」双 sparkline + cache 汇总、活动 Top 5；有待审核时顶部出现「去审核」提示条）、**记忆**（有效/待审/已替换/已归档/消息索引指标块、范围/类型条形图 + 类型甜甜圈、最近使用表格、待审核 approve/reject）、**观测**（上下文明细、活动全量、最近主请求与召回车道）、**配置**（召回预算/记忆 TTL/抽取与冲突的步进与分段控件、语义召回三个开关、水位开关、压缩器与接管模式切换、能力徽章；改动即写记忆库并立即生效）。Esc 或点遮罩关闭，每 10 秒自动刷新；配色跟随 DSH 主题 token（`--dsw-alias-*`），深色/浅色自动适配。

![面板预览](docs/panel-preview.png)

数据来自宿主路由 `/api/context-hub.status`（由 `connection` 服务托管鉴权，未认证请求返回 401）；开关水位走 `POST /api/context-hub.watermark`，写操作走 `POST /api/context-hub.review` 与 `POST /api/context-hub.action`。

模型侧工具：`context_hub_search`、`context_hub_remember`、`context_hub_history`、`context_hub_restore`、`context_hub_decompress`、`context_hub_unfold`、`context_hub_status`、`context_hub_doctor`，以及只读诊断的 `context_hub_explain`（召回打分明细）、`context_hub_log`（观测时间线）、`context_hub_probe`（检索命中率）与 `context_hub_abtest`（压缩提示词 A/B）。A/B 实验记录见 [docs/ab-compactor.md](docs/ab-compactor.md)；召回基准见 [docs/EVAL.md](docs/EVAL.md)。`status` 另有一行「活动」汇总召回/抽取/压缩次数，以及「探针：最近 N/M 命中（含百分比）」。命令行同款：`/context-hub probe [n]`。

## 配置

默认值写在 `src/index.js` 的 `defaults` 里，可通过插件 config 或环境变量覆盖：

| 配置 | 默认 | 范围 |
| --- | --- | --- |
| `recallMaxItems` / `DSH_CONTEXT_HUB_RECALL_ITEMS` | 8 | 1–20 |
| `recallMaxChars` / `DSH_CONTEXT_HUB_RECALL_CHARS` | 1800 | 200–8000 |
| `recallCooldownTurns` | 6 | 0–20 |
| `recallMaxTokens` / `DSH_CONTEXT_HUB_RECALL_TOKENS` | 1200 | 100–4000；召回注入的 token 硬顶（中文按 ~1.6 字符/token 粗估） |
| `recallTimeoutMs` / `DSH_CONTEXT_HUB_RECALL_TIMEOUT_MS` | 4000 | 0–20000；召回总时限，超时本次不注入 |
| `projectIdentity` / `DSH_CONTEXT_HUB_PROJECT_IDENTITY` | `git` | `git`（origin 归一化）/ `cwd`（绝对路径） |
| `sessionTtlDays` / `DSH_CONTEXT_HUB_SESSION_TTL_DAYS` | 7 | 3 / 7 / 15 / 30 |
| `projectTtlDays` | 90 | 0–3650（0=不过期） |
| `globalTtlDays` | 0 | 0–3650（0=永久） |
| `capacityPerScope` | 5000 | 100–100000 |
| `extractPassesPerTurn` / `DSH_CONTEXT_HUB_EXTRACT_PASSES` | 2 | 1–10 |
| `extractTimeoutMs` / `DSH_CONTEXT_HUB_EXTRACT_TIMEOUT_MS` | 60000 | 5000–300000；超时中止本次抽取并释放 latch |
| `admissionThreshold` | 0.6 | 0–1 |
| `conflictPolicy` / `DSH_CONTEXT_HUB_CONFLICT_POLICY` | `evidence` | `evidence` / `recency` |
| `compactor` / `DSH_CONTEXT_HUB_COMPACTOR` | `native` | `native` / `hub`（失败回退 native；见 [docs/compactor.md](docs/compactor.md)）|
| `mode` / `DSH_CONTEXT_HUB_MODE` | `auto` | `auto` / `observe` / `assist` / `takeover` / `full`；显式模式会组合 compactor 与水位并持久化 |
| `reviewPending` / `DSH_CONTEXT_HUB_REVIEW=1` | false | 开启后自动抽取且置信 <0.8 的记忆先入 pending，需 `/context-hub review approve` |
| `embedding.enabled` | false | 开启后叠加向量余弦；`baseUrl` 或 `DSH_CONTEXT_HUB_EMBED_URL` 存在时自动开启 |
| `embedding.baseUrl` / `DSH_CONTEXT_HUB_EMBED_URL` | 空 | OpenAI 兼容端点，可带或不带 `/embeddings` 后缀 |
| `embedding.model` / `DSH_CONTEXT_HUB_EMBED_MODEL` | 空 | 端点要求的模型名 |
| `embedding.dtype` / `DSH_CONTEXT_HUB_EMBED_DTYPE` | `fp32` | 量化模型用 `q8`；自动拉起 `embed/server.mjs` 时经 `EMBED_DTYPE` 透传 |
| `embedding.autoStart` / `DSH_CONTEXT_HUB_EMBED_AUTOSTART` | true | 仅回环地址生效：服务未启动时由插件拉起 `embed/server.mjs`；设 `0` 关闭 |
| `embedding.apiKeyEnv` | `DSH_CONTEXT_HUB_EMBED_KEY` | 从该环境变量读 Bearer key；空则不发送 Authorization |
| `embedding.minScore` | 0.35 | 0–0.95，cosine 低于此值不计入 |
| `embedding.fusion` / `DSH_CONTEXT_HUB_FUSION` | `weighted` | `weighted`（向量分加成）/ `rrf`（词法/向量各排名后融合）；英文建议 weighted |
| `embedding.timeoutMs` | 1500 | 200–15000，超时即降级为关键词 + FTS5 |
| `rewrite.enabled` / `DSH_CONTEXT_HUB_REWRITE=1` | false | 开启后每条新查询先用一次小模型扩同义词/英文关键词，失败回退原查询 |
| `rewrite.provider` / `model` | 空（用 agent 路由） | 改写的模型路由；`maxTokens` 1200（空输出会放大预算重试一次）、`timeoutMs` 12000、`cacheSize` 128 |
| `watermark.enabled` / `DSH_CONTEXT_HUB_WATERMARK=1` | false | 开启后 pre-step 主动按水位选区压缩（调原生 `compactRegion`），默认关闭；面板/命令开关会持久化到记忆库 |
| `watermark.retainTurns` / `DSH_CONTEXT_HUB_RETAIN_TURNS` | 0 | 0–20；>0 时保留最后 N 个用户回合，只折叠最旧前缀；`mode takeover/full` 未显式设置时默认 5 |
| `watermark.triggerRatio` | 0.7 | 0.3–0.95，压力达到即触发 |
| `watermark.retainTokens` | 20000 | 2000–200000，压缩时保留的尾部 tokens |
| `watermark.cooldownTurns` | 1 | 0–20，两次水位压缩至少间隔的轮数 |
| `unfold.steps` | 3 | 1–20；一次 unfold 覆盖的步数 |
| `unfold.maxChars` | 8000 | 1000–20000；每步用于替代摘要的原文预算 |
| `embedding.queryPrefix` | 空 | 可选：查询侧指令前缀（部分 BGE 检索模型建议加；实测 base 加后更差，默认不加） |
| `rerank.enabled` / `DSH_CONTEXT_HUB_RERANK=1` | false | 可选 LLM 重排：召回/检索的多条候选交给一次模型调用排序（多一跳延迟，失败回退原序） |
| `rerank.provider` / `model` | 空（用 agent 路由） | 重排模型；`candidates` 10（送排候选数，3–30）、`timeoutMs` 8000 |

cordis.patch.yml 里给已安装条目加 `config:` 即可（`insert:` 只用于 bundle 初始安装），例如：

```yaml
- id: dsh-context-hub
  config:
    extractPassesPerTurn: 2
    compactor: hub
    embedding:
      enabled: true
      baseUrl: https://api.example.com/v1
      model: text-embedding-3-small
      apiKeyEnv: MY_EMBED_KEY
    rewrite:
      enabled: true          # 语义改写：小模型扩同义词，失败回退
    watermark:
      enabled: true          # 水位接管：pre-step 主动选区压缩（实验）
      triggerRatio: 0.7
      retainTokens: 20000
```

### 本地 embedding 服务（随插件自带）

如果不想把记忆文本发给外部 API，用项目里的 `embed/` 目录——一个 OpenAI 兼容的本地服务（transformers.js + ONNX CPU）：

> **仓库已内置 `embed/node_modules/`**（约 475MB，vendored 的 onnxruntime 含 linux x64/arm64、win32 x64/arm64、darwin arm64（无 darwin x64），sharp 只含 linux x64 二进制（无 macOS/Windows），因此默认只在 Linux x64 开箱即用）：从本仓库 clone 后无需再 `npm install`。模型权重不入库（`embed/.cache/`，当前配置的 e5-q8 权重 118MB、目录约 134MB），首次启动自动下载，或把已有 `.cache` 拷过去离线使用。若安装的是 npm 分发包（不含 `node_modules`），才需要下面这一步。
>
**离线模型包**：Release 附件 `dsh-context-hub-models-e5-q8.tar.gz`（约 84MB）是当前在用的 `multilingual-e5-small` q8 权重，解压到缓存目录即可离线使用：

```bash
tar -xzf dsh-context-hub-models-e5-q8.tar.gz -C embed/.cache
# 得到 embed/.cache/Xenova/multilingual-e5-small/
```

**需要 `npm install` 吗？**

| 获取方式 | 含 `embed/node_modules/` | 还要 `npm install` 吗 |
| --- | --- | --- |
| `git clone` 本仓库 | 是（已入仓） | 不需要 |
| `scripts/pack.sh` 打出的 tgz（1.6.2 起） | 是 | 不需要 |
| npm 包 / 早期不含依赖的 tgz | 否 | 需要：`cd embed && npm install --ignore-scripts` |

> `npm pack` / `npm publish` 会强制排除 `node_modules`，所以「含依赖的分发包」请用 `scripts/pack.sh`（`git archive`），不要用 `npm pack`。

> 为了让仓库通过 GitHub 的 secret scanning，vendored 的 `@huggingface/transformers` 里 `mistral3` 这个模型名字面量被拆成了 `"mistral" + "3"`（仅影响该模型名的写法，e5/bge 等不受影响）；其余文件与 npm 原包一致。

```bash
cd embed
npm install --ignore-scripts      # 仅 npm 分发包需要：transformers.js + onnxruntime（约 475MB）
./start.sh                        # 手动启动：127.0.0.1:11434，日志 embed.log
curl -s localhost:11434/health    # {"ok":true,...,"ready":true}
```

**一般不用手动起**：插件配置里 `embedding.baseUrl` 指向回环地址、且 `embedding.autoStart` 为真（默认）时，插件启动会发现服务没在跑，自动 `spawn` 一个 detached 的 `embed/server.mjs`（端口取 baseUrl，模型取 `embedding.model`，自动补 `Xenova/` 前缀），并轮询 `/health` 到就绪后回填向量；全过程记 `启动向量服务` / `向量服务就绪` / `向量服务启动失败` 事件，失败只降级不阻塞会话。

模型文件在 `embed/.cache/Xenova/<model>/`（首次请求从 hf-mirror 下载：bge-small-zh-v1.5 约 95MB、multilingual-e5-small q8 约 118MB，之后可离线）。**模型选择**：中文/中英混合首选 `multilingual-e5-small`（q8）；`bge` 系仅作小体积备选（如 `bge-small-zh-v1.5` 约 95MB）；`fusion` 默认 `weighted`，`rrf` 只建议在向量排名可靠时试。换模型：改 `embedding.model`，停掉旧服务（`embed/stop.sh`）再重启插件；模型不一致时插件会自动清旧向量。服务也支持本地目录：`EMBED_MODEL=/abs/path/to/model EMBED_DTYPE=q8 PORT=11434 node embed/server.mjs`。

然后在 profile 的 `cordis.patch.yml` 给 `dsh-context-hub` 加：

```yaml
- id: dsh-context-hub
  config:
    embedding:
      enabled: true
      baseUrl: 'http://127.0.0.1:11434/v1'
      model: 'bge-small-zh-v1.5'   # 服务端兜底；中文/中英混合首选 multilingual-e5-small
      minScore: 0.35
      timeoutMs: 3000
```

重载插件后 `status` 的「检索」会变成 `关键词+FTS5+向量`；`explain <查询>` 里能看到「向量 +0.x」的归因。

> 注意：`start.sh` 用 `nohup` 起进程，适合手动/登录自启；本机没有可用的 systemd user bus，所以没有做服务单元。关机或杀掉进程后需重新 `./start.sh`。

## 分发与发布

- `package.json`：`files` 含 `src`、`client`、`cordis.patch.yml`、`locale`、`icon.svg`、`README.md`、`LICENSE`、`CHANGELOG.md`、`docs`、`scripts`、`test-smoke.mjs`、`embed/`（含 `node_modules`）；`exports` 增加 `./locale/*.json` 与 `./icon`；`publishConfig.access=public`。
- 展示元数据：`locale/en.json` / `locale/zh.json` 提供 `meta.title` 与 `meta.description`（不声明 `meta.detail`，详情页回退 README）；`icon.svg` 为 610 B 原创 SVG（限 256 KiB）。
- `LICENSE`（MIT）与 `CHANGELOG.md` 已就位。打包分两种：`npm pack`（slim，30 个文件、253,204 字节，不含 `embed/node_modules`）与 `scripts/pack.sh`（`git archive`，含 vendored 依赖，约 157MB）。临时用 `npm_config_cache=$PWD/.npm-cache` 绕过只读的 `~/.npm`。
- 发布状态（2026-11-27）：**已发布 npm 1.7.4**（public，slim 包 280.2 kB / 34 文件，shasum `42a143d8…`）；本机 profile 仍以 `link:` 方式开发。
- 分发包：`dist/` 下的最新 `dsh-context-hub-*.tgz`（版本、文件数、字节数与 SHA-256 以发布时生成的 `dist/INSTALL.md` 为准，避免包内文档自引用过期）；DSH 安装解析器把绝对路径 `.tgz` 识别为 tarball。
- 打包产物自检：`npm pack` 的 1.0.0 tarball 含 `src/`、`client/`、`cordis.patch.yml`、`locale/`、`icon.svg`、`docs/`；`createRequire` 能解析 `dsh-context-hub`、`./locale/en.json`、`./locale/zh.json`、`./icon`、`./client`，且 `import { apply, inject }` 得到 `tools,commands`（0.7.0 已验证，1.0.0 结构相同）。
- 发布命令：`npm_config_cache=$PWD/.npm-cache npm publish --access public`（需带 bypass 2FA 的 granular token）；发布后用 `plugin_manager install_bundle(target="dsh-context-hub@<版本>")` 验证第三方安装路径。
- 名称 `dsh-context-hub` 已由 `element555` 注册并持有（registry 可见 `0.0.0-stage` 与 `1.7.4`）。

## 数据

- 默认路径：`$DSH_HOME/context-hub/memory.db`（`DSH_HOME` 未设置时为 `~/.dsh`）。
- 覆盖：环境变量 `DSH_CONTEXT_HUB_DB=/path/to/memory.db`。
- 记忆是**派生缓存**：会话日志才是唯一真相；库损坏/删除不影响会话继续。

## 设计边界（当前版本）

- 默认不替换 compaction 服务：`compactor: native` 时原生压缩仍由 `compaction-basic` 提供，本插件只做触发与检索补位；`compactor: hub` 时在实例上包装 `summarize()`（不动服务注册，失败回退原生），详见 [docs/compactor.md](docs/compactor.md)。
- 面板只写治理、开关与预算参数（遗忘/替换/审核/水位/压缩器/模式/召回条数·字符·冷却·硬顶·时限/TTL/抽取次数/冲突策略/向量·改写·重排开关），不提供记忆内容编辑；上下文数据只读，不回写会话。
- 不追加自定义会话事件类型：只用既有 `user/message` / `turn/end` 事件驱动。
- 召回是「关键词重叠（中文二元组 + 拉丁词）+ FTS5 trigram 加成」，可选叠加**向量余弦**（0.8.0，OpenAI 兼容端点）与**LLM 查询改写**（1.2.0，默认关，失败回退原查询）；同义扩展另有 18 组内置词表兜底。FTS5/向量/改写任一不可用都自动降级，不影响主路径。
- 水位开关：面板配置区有「开启/关闭水位压缩」按钮，`/context-hub watermark on|off` 等价；开关状态存进记忆库 `kv`，重启后沿用（不需要改 profile 配置）。
- 压缩默认完全交给原生：`compactor: hub` 只换摘要提示词；`watermark.enabled: true`（默认关）时插件才在 pre-step 按 `triggerRatio` + `retainTokens`/`retainTurns` 主动选区间调原生 `compactRegion`，只折叠最旧前缀，失败记录后交还原生阈值。
- 召回硬顶与超时：`recallMaxTokens` 控制单次注入体积，`recallTimeoutMs` 控制总时限；改写/重排/向量只在剩余时间内执行，超时宁可本次不注入。
- 消息级 `unfold` 只在 pre-step 临时替换 surface 上的压缩摘要节点（`source.kind === 'compact-checkpoint'`），不改会话日志，步数用完自动恢复摘要。
- 抽取失败只记 `logger.warn`，绝不阻塞会话。

## 路线图

已交付（按版本倒序）：

- **1.6.5**：面板「配置」分区可改（召回预算/记忆 TTL/抽取与冲突/语义召回开关），写入记忆库 `kv` 并立即生效；新增 `/context-hub config [键] [值]`；`node test-smoke.mjs` → `SMOKE OK`。
- **1.6.4**：面板图表/甜甜圈/缓存环增强（记忆类型甜甜圈、85% 式缓存命中环、构成分布条、能力徽章），`node test-smoke.mjs` → `SMOKE OK`。
- **1.6.3**：面板入口移到左侧栏底部 `sidebar.footer.action`（圆环 + 上下文百分比徽章，待审带琥珀点），`conversation.composer.dock` 只挂隐藏的 `ComposerAnchor`。
- **1.6.2**：vendored deps 分发包（`scripts/pack.sh`）3,196 文件 / 157,534,812 字节 / SHA-256 `fdd5f16b…`。
- **1.6.1**：墓碑守卫 + `session` 作用域隔离 + 抽取超时等 P0/P1 修复，回归 `node test-smoke.mjs` → `SMOKE OK`。
- **1.6.0**：三项补强——召回注入 token 硬顶（1200）+ 总时限（4000ms）与 `recall-timeout` 旁路；`projectIdentity: git` 用 origin 归一化做项目键并迁移旧 cwd 行；`context_hub_unfold` / `/context-hub unfold` 把压缩摘要临时展开成原文（默认 3 步 × 8000 字符）。
- **1.5.6**：默认召回调为 8 条/1800 字符、冷却 6 轮、抽取 2 次/轮；`newConversation()` 改为按 8000 字符分片推进，修多 pass 失效。
- **1.5.5**：面板重构为「固定 KPI 头 + 概览/记忆/观测/配置四分区」；成本曲线改进（面积、基线、末点、左右留白）；记忆 tab 有待审提示点与一键跳转；配置表精简；弹层打开即聚焦关闭按钮。
- **1.5.3**：多语言 embedder（multilingual-e5-small：zh-holdout R@5 100%、英文 LongMemEval 12 题 83.3%）、`embedding.fusion`（weighted/RRF）、`watermark.retainTurns`（保留 N 轮、只折叠最旧前缀）、`mode takeover/full` 默认 5 轮。
- **1.5.2**：独立消息索引（`messages` + `messages_fts`，零记忆也能按原文召回）、LongMemEval 向量路径、面板成本曲线（总估算/注入 sparkline + cache 汇总）、导出 v4 含消息索引。
- **1.5.1**：B2 阶段 2（按来源消息聚合排序 + ±1 句窗口）、LongMemEval-S 48 题实跑（词法 evidence R@5 79.2%）、E1 面板 forget/supersede/compactor/mode、E2 请求车道与 usage/cache 汇总。
- **1.5.0**：P0 第一批——修包（删自依赖、private false）、消息级证据列（`message_id/message_seq/sentence_no/valid_from/valid_to`）、`doctor` 自检、召回带来源 seq/原文预览、`decompress`、接管分级 `mode`、评测脚手架（`scripts/eval/recall.mjs` + `docs/EVAL.md`）、面板审核与请求注入列。
- **1.4.0**：面板图形化/表格化重做（构成分段表、记忆指标块与两类条形图、明细/活动/请求占比表、最近使用表格），保持小三角折叠与水位开关。
- **1.3.2**：「最近使用」列表支持小三角折叠/展开（顺带放大点击热区与焦点环）。
- **1.3.1**：面板视觉改版（圆环压力、构成堆叠条、记忆卡片、活动 chips、开关式水位控件，跟随 `--dsw-alias-*` 主题；Esc 关闭）；预览图 `docs/panel-preview.png`。
- **1.3.0**：本地 embedding 服务移入项目 `embed/`，随分发包（server/start/stop/README，不含 node_modules 与模型缓存）；新增 `embedding.autoStart`（默认 true，仅回环地址）——插件启动时 ping `/health`，未就绪则 spawn `embed/server.mjs`，就绪后回填向量，事件 `启动向量服务`/`向量服务就绪`/`向量服务启动失败`；1.3.0 分发包 24 文件。
- **1.2.2**：语义对照：bge-m3 int8+指令前缀 top-6 **66.7%**（p50 25.7ms，568MB）；bge-large-zh int8 63.3%（31.7ms）；base int8 56.7%；m3 的 10 条未命中落在 top-10 之外，LLM 重排无提升空间。可选 LLM 重排（`rerank`，默认关；`log` 记 `重排` 事件、失败回退原序）、`log` 命令改用中文标签；smoke 增加重排顺序断言。
- **1.2.1**：水位开关可持久化（`kv`）+ 面板按钮 + `POST /api/context-hub.watermark`；`embedding.queryPrefix` 可选项；smoke 增开关持久化与路由断言。
- **1.2.0**：LLM 查询改写（`rewrite`，`explain` 显示改写词，失败回退）；压缩水位接管（`watermark`，pre-step 按 trigger/retain 选区调 `compactRegion`，默认关闭、失败交还原生）；status 显示「改写/水位」；`/context-hub watermark on|off`；smoke 覆盖改写与水位。
- **1.1.1**：本地 embedding 服务（`embed/`，transformers.js + bge-small-zh-v1.5，95MB，OpenAI 兼容），30 条改写探针 top-6 **56.7%**（词法 13.3%）、p50 6.1ms；`/context-hub reembed` 与换模型清旧向量；分发包 19 文件。
- **1.1.0（W1/W3/W6 收尾）**：30 条改写探针召回基准（`scripts/recall-bench.mjs`，词法基线 top-6 13.3%，配端点后可对照向量）；`context_hub_restore` 按 seq 还原折叠区原文并注入（默认 4000 字符）；3 进程并发写入验证（900/900、WAL、quick_check ok）。
- **1.0.0（W2/W5/W7）**：记忆关系（`memory_links` + related/supersedes + 召回一跳扩展 ≤1 条，`explain` 显示「邻居扩展」）；审核流（`reviewPending` 下低置信抽取入 pending，`/context-hub review approve|reject`，status/面板显示 pending）；导出 v2 含 links；重新打包 1.0.0 分发包。
- **0.9.0（W3/W4）**：压缩摘要写成 `summary` 记忆并可检索，`status` 增加「最近压缩」；逐请求采样（`llm/stream` 只观察，`context_events(kind=request)` 环形 200 条，含 surface/合计/注入/输出预留），`status` 与面板显示最近请求；冒烟测试新增摘要入库与请求采样断言。
- **0.8.0（W1/W6）**：可选向量召回（OpenAI 兼容 `/embeddings`，写入后台补向量、查询侧余弦加成、失败/超时降级、`explain` 显示「向量 +x」）；SQLite WAL + `synchronous=NORMAL`、候选窗口 800 + FTS 命中按 id 补入（大库不受最近窗口限制）、`scripts/stress.mjs` 万条压测。
- **0.7.0**：FTS5 混合检索（trigram、外部内容表、增量同步、不可用降级）+ 检索探针（工具与 `/context-hub probe`）；抽取游标持久化到 `kv` 表；发布元数据（MIT、CHANGELOG、locale、icon）与可分发 tgz。
- **0.6.0**：客户端只读面板（composer 胶囊 + portal 面板 + `/api/context-hub.status`），10 秒轮询；用户已目视确认。
- **0.5.0**：服务级压缩器 `compactor: native|hub`——实例包装 `summarize()`，失败回退原生；`/context-hub compactor` 运行时切换。
- **0.4.1**：召回未命中诊断（`recall-miss`）+ 上下文兜底 + 记忆侧近义扩展。
- **0.4.0**：压缩提示词 A/B 工具（原生 7 段 vs 记忆感知 8 段），真实模型路由跑两遍，记录段覆盖/来源覆盖/耗时与空输出踩坑。
- **0.3.1**：查询侧中英近义扩展（18 组，压缩↔compact/fold 等）。
- **0.3.0（P2 主体）**：治理命令（forget/supersede/audit）、召回调试（explain）、观测日志（log）、JSON 导出（export）、上下文构成拆分、库文件 0600。
- **0.2.0（P1）**：五维写入门槛（≥0.6）、scope + TTL（3/7/15/30、project 90、global 永久）、时间衰减、容量淘汰、3 轮冷却、6 条/1200 字符召回预算、抽取 1–10 次可配、冲突 supersede（evidence/recency）。
- **0.1.0**：host 单 bundle 骨架——SQLite 记忆、`turn/end` 自动抽取、真人消息召回、4 个工具、`/context-hub` 命令。

未做 / 下一步：

- 五维补强计划（记忆写入、检索、压缩接管、部署生态、观测 UI）见 [docs/comparison.md](docs/comparison.md) 第 5 节；P0 先做修包、证据粒度、推荐档、消息级召回与消息级可逆。
- 语义召回：中文 zh-holdout R@5 100% 已达标，但英文 LongMemEval 子集 R@5 仅 83.3%（与词法持平）仍是弱项；下一步侧重英文/跨语言检索策略。
- 水位接管默认关闭：开启前建议先在空闲会话试 `retainTokens`；大区间一次折叠的授权策略（按 token 上限/确认）未做。
- 面板可写遗忘/替换/审核/水位/压缩器/模式，其余只读；改写/重排/水位阈值仍走 profile 或命令。
- 面板接 locale 服务（现在中英文案硬编码在组件里）。
- npm 发布与市场收录：等有 npm 账号后 `npm publish`（npm 上仍未发布），再用 `install_bundle(target="dsh-context-hub@1.6.4")` 验证；自依赖已清，发布前只需重打包。
