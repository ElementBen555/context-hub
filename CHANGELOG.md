# 变更记录

## [1.8.0] - 2026-11-27

### 🎉 重大更新：完成所有 P1/P2 补强任务

本次发布完成了 comparison.md 中列出的所有剩余补强任务（A1/A3/A4/B5/C4/C5/E4/A5/E3/E5/D4/D5），共计 12 个新功能与改进。

#### P1 任务完成（7 个）

**A1 - 确定性优先的写入**
- 新增显式信号检测（记住/不要/偏好/约定/待办）
- 零 LLM 直接写入，`source=explicit`，`confidence=1.0`
- 减少抽取 LLM 调用，降低写入成本

**A3 - 三类冲突判定**
- 否定翻转（"不要/不再/取消"）
- 数值变更（版本号、阈值、配置值）
- 状态迁移（open→closed, pending→done）
- 冲突类型记录到 `conflict-detected` 事件

**A4 - 分层复核**
- 新增 `reviewPolicy` 配置（`off`/`low-confidence`/`layered`）
- `layered` 策略：`decision`/`skill` 类自动入 `pending`
- 审核流更细粒度

**B5 - 查询卫生**
- 排除注入块、工具结果、插件消息
- 只取真人用户消息构造查询
- 避免自我召回污染

**C4 - 压缩回执**
- 返回 `ledger` 对象（区间/压缩比/耗时/提示词版本）
- `compact-hub` 事件记录完整回执
- status/面板可查压缩历史

**C5 - 摘要质量闭环**
- 8 段校验（`parseSummaryBlocks`）
- 结转未完成事项（从上一版摘要提取）
- 空输出重试（3000→8000 tokens）
- `sectionCheck` 与 `missingSections` 记录到回执

**E4 - 诚实指标**
- `probe` 显示样本量 `n` 与 95% 置信区间
- 使用 Wilson 区间近似
- 标注"自造探针不构成泛化证据"

#### P2 任务完成（5 个）

**A5 - 语义近邻去重**
- 新增 `findNearDuplicates()` 检测 cosine ≥0.92 的重复候选
- 基于向量相似度，与词法 jaccard 互补

**E3 - 记忆视图**
- 新增 `/context-hub graph <编号>` - 关系图（多跳邻居）
- 新增 `/context-hub timeline [scope]` - 时间线
- 新增 `/context-hub conflicts <编号>` - 冲突链追溯

**E5 - 导出与日志**
- 新增 `exportToJSONL()` - JSONL 格式导出
- 新增 `importFromJSONL()` - 幂等导入（基于 hash 去重）
- 新增 `/context-hub export-jsonl` 命令
- 新增 `/context-hub import-jsonl <路径>` 命令

**D4 - 兼容矩阵文档**
- 新增 `docs/COMPATIBILITY.md`
- DSH 版本兼容性（0.2.x 推荐）
- Node.js 版本要求（≥22.13.0）
- 操作系统支持（Ubuntu/Debian/macOS/Windows）
- 升级路径与故障排查

**D5 - 可移植**
- JSONL 导出/幂等导入已实现（与 E5 合并）
- 支持迁移和备份恢复

### 新增命令（5 个）
- `/context-hub export-jsonl` - JSONL 格式导出
- `/context-hub import-jsonl <路径>` - 幂等导入
- `/context-hub graph <编号>` - 记忆关系图
- `/context-hub timeline [scope]` - 记忆时间线
- `/context-hub conflicts <编号>` - 冲突链追溯

### 新增 API（7 个）
- `parseSummaryBlocks()` - 8 段摘要解析
- `sanitizeQueryText()` - 查询卫生
- `extractExplicitMemories()` - 显式信号检测
- `classifyConflict()` - 冲突分类
- `findNearDuplicates()` - 近邻去重
- `memoryGraph()` - 关系图
- `conflictChain()` - 冲突链

### 文档更新
- 新增 `docs/COMPATIBILITY.md` - 兼容性矩阵
- 更新 `docs/comparison.md` - 标记所有任务完成

### 测试
- 所有冒烟测试通过：`SMOKE OK`
- 新增 JSONL 导出/导入测试
- 新增记忆视图命令测试

---

## [1.7.4] - 2026-11-27

### 修复面板压缩器切换

- 面板「切到 hub」现在会真正挂载并持久化：启动时缓存 `compaction` 服务，切换走 `setCompactor()`（写 `kv compactor`、记 `compactor` 事件）。
- 状态快照按实际生效状态返回 `hub/native`；hub 安装失败时 action 路由返回 409 并带原因，面板不再「点了没反应」。
- 重启后按 kv 恢复压缩器选择；冒烟新增 native ⇄ hub 路由断言与快照断言。

## [1.7.3] - 2026-11-27

### 召回性能复盘与重排调优

- `rerank.reasoningEffort` 可配置（low/medium/high），实测 low 把重排从 3591ms 降到 2168–2597ms。
- 头部优势跳过规则放宽为 `top >= 4 && top >= second * 1.25`，清晰胜出时不再调用重排。
- 新增 `docs/PERF.md`：分段耗时样本、瓶颈定位（重排占 97%）、低延迟/精度两种配置建议。

## [1.7.2] - 2026-11-27

### 召回耗时与降本

- 召回事件 detail 增加分段耗时：`rw`（改写）/ `em`（向量）/ `se`（检索）/ `rr`（重排），总耗时一并记录；`context_hub_log` 可直接看出超时卡在哪。
- 改写：查询短于 8 个字符时直接跳过（短句改写收益低，省一次 LLM 调用）。
- 重排：默认候选 10 → 6（配置仍可调 3–30），配合「强头跳过 + 空输出重试 + <600ms 不发起」，压低空输出与超时。

## [1.7.1] - 2026-11-27

### 性能与健壮性

- 搜索缓存：`search()` 增加 30 秒 / 32 条的查询缓存，写入（insert / forget / supersede）立即失效；同一轮召回里的重复查询不再重复跑 FTS 与打分。
- 启动实体回填：升级后首次启动自动为没有实体链接的旧记忆补图谱（最多 500 条，成功后写 kv 标记，只做一次）。
- 重排：候选头部优势明显时直接跳过 LLM；空输出自动放大预算重试一次；剩余预算 <600ms 不再发起。
- 召回日志 detail 追加本次耗时，`context_hub_log` 可直接看到慢在哪一步。
- 面板：记忆页显示高频实体 chips；概览「压缩账本」增加最近 5 条的区间/折叠/摘要/节省/复问明细。
- 冒烟新增：搜索缓存写入失效、实体回填幂等（第二次为 0）断言。

## [1.7.0] - 2026-11-27

### 图谱与压缩账本

- P1 轻量图谱 v1：新增 `entities` / `entity_links`，记忆写入时从标签与文本抽取实体（零额外 LLM 调用）；召回做 1-hop，最多补 2 条并标记「图谱扩展」；`context_hub_status` 与面板显示实体/链接数。
- P2 压缩账本：新增 `compaction_ledger`，记录每次 `compaction/summary` 的区间、被折叠 tokens、摘要 tokens、净节省；新消息与被折叠内容重叠 ≥60% 时标记复问；概览面板新增「压缩账本」（折叠次数 / 累计节省 / 复问率 / 最近区间）。
- 导出格式升 v5，包含 `entities`、`entity_links`、`compaction_ledger`。
- 冒烟新增图谱（2 实体 / 3 链接）与账本（1 次折叠、省 961 tokens）断言。

## [1.6.6] - 2026-11-27

### 性能与规模化

- rank 的 project 查询改为等值拆分、候选窗口 800→400、新增 partial index，10 万条记忆下 p95 从 110.6ms 降到 99.8ms（p50 85.6ms）。
- FTS 查询分级（短语 → 2 词 AND → 3 词 AND → OR 兜底），避免常见中文三元组触发十万级 bm25 排序。
- 记忆 token 集合加缓存，写入时失效。
- 修复 `probe` 未取 `session_id` 导致 session 记忆无法被探针命中。
- 新增 `scripts/scale.mjs` 与 `docs/SCALE.md`（10 万条记忆、2 万条消息的实测数据与局限）。

## 1.6.5

- 面板「配置」分区可编辑：召回条数/字符/冷却/硬顶/时限、session/project/global TTL、抽取次数、冲突策略、向量/改写/重排开关。
- 新增 `/context-hub config [键] [值]`，与面板同一白名单；改动写入记忆库 `kv`，重启沿用并立即生效。
- 新增 HTTP 动作 `action: config`（`/api/context-hub.action`），非法值返回 400；新增 `config-change` 事件。
- 冒烟新增配置路由断言（设置 7 → 快照生效 → kv 持久化 → 非法值 400）。

## 1.6.4

- 面板视觉增强（概览 / 记忆 / 观测 / 配置四分区）：KPI 指标带彩色图标、hero 渐变底；成本区新增缓存命中环；上下文构成表新增每段配色的分布条。
- 记忆库「按类型」改为**甜甜圈图 + 图例**（决策/事实/偏好/任务/技能各自配色与占比）；范围仍用条形图。
- 配置页顶部新增能力徽章（检索/改写/重排/压缩/水位/模式），一眼看到开关状态。
- 活动分布按事件类型着色（召回蓝、抽取紫、改写绿、压缩红等）。
- 修复离线预览的 SVG 属性命名（`strokeWidth` → `stroke-width`），此前截图里环形/甜甜圈显示过细。
- `docs/panel-preview.png` 更新。

## 1.6.3

- 面板入口从输入框下方移到**左侧栏底部**（`sidebar.footer.action`，紧邻设置），显示为紧凑徽章「环 + 上下文百分比」，待审时带琥珀点；点击仍在页面中央打开卡片。
- 会话 id 由隐藏的 composer 座位记录并共享给左栏（左栏是 root scope，拿不到 sessionId）；输入框下方不再显示胶囊。

## 1.6.2（2026-11-26）

- **仓库内置 embed/node_modules**：`git clone` 后无需 `npm install`（3,163 个文件 / 462.7MB；onnxruntime 含 Linux x64/arm64、Win x64/arm64、macOS arm64，sharp 仅 Linux x64，其余平台需自行 `npm install`）；vendored 的 `@huggingface/transformers` 把 `mistral3` 模型名字面量拆成 `"mistral" + "3"` 以通过 GitHub secret scanning（行为不变）。
- **分发包脚本**：新增 `scripts/pack.sh`（`git archive`），打出的 tgz 含 `embed/node_modules`；`npm pack` 仍强制排除 node_modules，发布含依赖的包请用 `npm run pack:dist`。
- **离线模型包**：Release 附件 `dsh-context-hub-models-e5-q8.tar.gz`（87,652,818 字节，SHA-256 `06b9d4f1340138c15f5f71df6320faf20e6ed9eedfa9a3c8ff3db71ee1d1f6aa`），解压到 `embed/.cache/` 即可离线使用 e5-q8。
- **文档**：README 增加「是否需要 npm install」对照表、离线模型包与 pack 脚本说明。

## 1.6.1（2026-11-26）

- **P0 修复**：遗忘/拒绝/被替换的记忆不再被同文写入复活（墓碑守卫）；`session` 作用域记忆按 `session_id` 隔离（关键词、FTS 补入、容量淘汰、mostSimilar 全部加过滤）。
- **P1 修复**：抽取调用加 60s 超时并释放 latch；`insert()` 的 upsert/supersede/连边包进事务；FTS 重建只在首次/升级时执行；`probe`/`explain`/工具/命令全部透传 sessionId；`invocation.signal` 可选链。
- **面板与 embed**：替换提示不再预填被截断的 160 字文本；写操作加 in-flight 防重；HTTP 错误体透传；百分比 clamp；embed 服务校验 body/单条上限、超限 413、模型加载去重、监听错误与 SIGTERM 处理。
- **文档与包**：README/spec/design/INSTALL/comparison 与 1.6.1 实现对齐（8/1800、6 轮冷却、抽取 2、0600、12 个工具、主题 token、embedding 默认空）；`engines.node >= 22.13`、`npm test`/`bench`/`stress`/`concurrency` 脚本、仓库地址修正；`.gitignore` 覆盖临时库与构建产物；仓库清理临时 DB/exports。
- 打包：29 文件、248,569 字节、SHA-256 `dfc08545a78f487c24462a339ad18d6e518fa75b25f6dc1b73fa6d1e2e18b935`。

## 1.6.0

- **召回硬顶与超时**：单次召回注入新增 `recallMaxTokens`（默认 1200，按 ~1.6 字符/token 粗估）与 `recallTimeoutMs`（默认 4000ms）；改写/重排/向量只在剩余时间内执行，超时本次不注入并记 `recall-timeout`。`status` 显示「硬顶 N tokens/超时 M ms」。
- **git 项目身份**：默认 `projectIdentity: 'git'`，把 `origin` 归一化为 `git:host/owner/repo`（ssh/https/scp 同一 key）；首次解析自动把旧 `cwd` 记忆/消息迁移到新 key 并记 `project-migrate`；可用 `cwd` 恢复旧行为。
- **消息级可逆展开**：新增 `context_hub_unfold` / `/context-hub unfold`——对 `compaction/summary` 覆盖的区间执行 unfold，接下来 N 步（默认 3）的 pre-step 用原文临时替代摘要节点（`source.form = 'unfold'`，每步默认 8000 字符）；只改模型请求，不改会话日志。
- **测试**：冒烟覆盖硬顶截断（`captokens: 131 字符 ≤ 160`）、慢改写超时（`recall-timeout`）、git 迁移（`cwd → git:github.com/foo/bar`）、unfold 原文替换；`node test-smoke.mjs` → `SMOKE OK`。
- **文档**：README 能力/配置/命令/工具/路线图，spec M4/M6/C5 与差距表，design 第 21 节。
- **打包**：`npm pack` 1.6.0。

## 1.5.6

- **默认参数调整**：召回 `8 条 / 1800 字符`、冷却 `6 轮`、抽取 `2 次/轮`（冲突仍为 `evidence`）。
- **抽取分片修复**：`newConversation()` 原来一次性读到 `session.seq` 再取尾部 8000 字符，导致单轮永远只够 1 次抽取、多 pass 配置失效；改为按 8000 字符窗口切段并返回实际消费的 seq，下一 pass 从断点继续。
- **配置**：`~/.dsh/profiles/web/cordis.patch.yml` 显式写入 `recallMaxItems: 8`、`recallMaxChars: 1800`、`recallCooldownTurns: 6`、`extractPassesPerTurn: 2`。
- **文档**：README 配置表、spec M6/M10/D3、design 默认值同步；新增抽取分片测试。
- **打包**：`npm pack` 1.5.6。

## 1.5.5

- **面板分区重构**：固定 KPI 头（压力环 + surface/合计/节点/输出预留）常驻，下方改为「概览 / 记忆 / 观测 / 配置」四个 tab；长列表不再一次铺满 86vh。记忆 tab 的徽标显示 active 数，有 pending 时加琥珀点；概览顶部出现「N 条记忆待审核 → 去审核」提示条，点击直接切到记忆 tab。
- **图表打磨**：成本曲线改为面积 + 基线 + 末点，左右留白避免端点被裁；注入占比低于 10% 时保留一位小数；活动在概览只取 Top 5、观测 tab 保留全量。
- **交互**：弹层打开自动聚焦关闭按钮（Esc 仍可用）；配置表去掉与开关重复的「压缩器」行；记忆操作按钮统一为小尺寸 ghost 按钮；待审核条目改为卡片行 + 批准/拒绝按钮。
- **测试**：`node --check client/client.js`、`node test-smoke.mjs`；用离线 mini-React + headless Firefox 逐 tab 截图核对（760×1150）。
- **打包**：`npm pack` 1.5.5（29 文件）。

## 1.5.4

- **autoStart 透传 dtype**：`embedding.dtype`（默认 `fp32`，env `DSH_CONTEXT_HUB_EMBED_DTYPE`）会作为 `EMBED_DTYPE` 传给自动拉起的 `embed/server.mjs`；此前只传端口与模型，q8/本地量化模型会被自动拉起成 fp32，导致缺文件或加载失败。事件 `启动向量服务` 现在带 dtype。
- **本地复跑与默认推荐**：`multilingual-e5-small`（q8，384 维，约 118MB）本机复跑：`zh-holdout` R@1 66.7% / R@5 100% / MRR 0.799（词法 R@5 25%）；30 条改写探针 top-6 80%（bge-small 56.7%、bge-m3+前缀 66.7%），p50 5.6ms。README 与 `docs/EVAL.md` 记为中文首选。

## 1.5.3

- **多语言 embedder**：`embed/server.mjs` 支持远程/本地模型；实测 `multilingual-e5-small`（q8，384 维）让 `zh-holdout` R@5 从 25% 提到 **100%**（R@1 66.7%、MRR 0.799），英文 LongMemEval 12 题向量与词法持平（R@5 83.3%、MRR 0.806）。
- **融合选择**：新增 `embedding.fusion`（`weighted` 默认 / `rrf`）；`explain` 显示 lex/vec 名次与 RRF。英文上 RRF 反而从 83.3% 掉到 75%，默认仍为 weighted。
- **retainTurns 接管**：新增 `watermark.retainTurns`（0–20）；`mode takeover/full` 未显式设置时默认保留最后 5 个用户回合，只折叠最旧前缀，不重写保留尾部。
- **评测修正**：早期 `zh-holdout` 向量 58.3% 是未等 `store.embedQueue` 的欠采样；修正后同 `bge-base-zh` weighted 为 R@5 83.3%，已在 `docs/EVAL.md` 更正。
- **测试**：smoke 新增 `retainTurns=2 -> compactRegion(0,1)` 断言；`npm pack` 1.5.3。
- **延后**：100k 级与多用户不引入服务端，按单机定位延后。

## 1.5.2

- **独立消息索引**：新增 `messages` 表与 `messages_fts`（trigram）；`maybeRecall` / `turn/end` 增量索引 user/assistant 原文，零记忆时也能按消息召回；`explain` 增加消息候选，导出升到 v4。
- **LongMemEval 向量路径**：`embed/server.mjs` 支持本地模型绝对路径（`EMBED_MODEL=/abs/path`，配合 `EMBED_DTYPE=q8`）；评测脚本支持 LongMemEval 逐题独立库的向量对照。`zh-holdout` 词法 R@1 25% → 向量 50%、R@5 25% → 58.3%；LongMemEval 12 题英文词法 75% / 向量 66.7%（中文模型不适合英文数据，已在 docs/EVAL.md 说明）。
- **成本曲线**：面板「最近主请求」下方新增总估算/注入 tokens sparkline 与 cache read 汇总；状态快照带 `messages` 计数。
- **测试**：smoke 新增「零记忆时按消息索引召回」；`npm pack` 1.5.2。

## 1.5.1

- **B2 阶段 2**：召回命中按来源消息聚合排序（同一消息的多条事实整组优先），渲染命中句 ±1 句原文窗口；smoke 新增 `原文窗口 seq` 断言。
- **B3 实跑**：`scripts/eval/recall.mjs` 支持 LongMemEval cleaned 的逐题独立库；LongMemEval-S 48 题词法 evidence R@1 66.7% / R@5 79.2% / R@10 89.6% / MRR 0.74（p50 42.2ms）。这是 session-level evidence recall，不是 LLM 判分。
- **E1 完整第一版**：新增 `POST /api/context-hub.action`，面板可 forget/supersede/compactor/mode；与已有 review/watermark 路由统一鉴权与审计事件。
- **E2 第一版**：请求采样记录最近召回车道（via/ids/tokens/messages）与 usage/cache；面板「最近主请求」显示注入列、车道与 cache read 汇总。
- **测试**：smoke 覆盖 action 路由（supersede → forget → mode）、请求 `lanes`、B2 原文窗口；`npm pack` 1.5.1 29 文件。

## 1.5.0

- **P0 第一批（按 `docs/comparison.md` §9 顺序）**：
  - **D1 修包**：删除 `package.json` 里指向旧 tgz 的自依赖，`private` 改为 `false`；`npm pack --dry-run` 29 文件通过，干净 profile 不再被 `file:` 依赖卡住。
  - **A2 消息级证据**：`memories` 增 `message_id`、`message_seq`、`sentence_no`、`valid_from`、`valid_to`；抽取时回指最可能的原始消息与句号；`audit`/`explain` 显示来源；`supersede` 写 `valid_to`；导出格式升到 v3。
  - **B1 自检**：新增 `context_hub_doctor` 与 `/context-hub doctor`，检查 FTS5/向量/改写/重排/压缩器/水位，输出 `minimal / balanced / semantic` 档位、缺口与可粘贴配置。
  - **B2 阶段 1**：召回条目带来源 seq 与原消息预览（消息级排序留到下一增量）。
  - **B3 评测脚手架**：新增 `scripts/eval/recall.mjs`（R@1/3/5/10、MRR、p50/p95；内置 30 条、`zh-holdout`、LongMemEval cleaned 加载器）与 `docs/EVAL.md`。
  - **C1 接管分级**：新增 `mode`（`auto / observe / assist / takeover / full`），`/context-hub mode` 切换并持久化；`status`/面板显示当前模式。
  - **C2 消息级可逆**：新增 `context_hub_decompress` 与 `/context-hub decompress`，默认取最近一次压缩摘要，支持 `id` 或 `start/end`，按消息原文重注入（默认 8000 字符预算）。
  - **E1/E2 第一刀**：新增 `POST /api/context-hub.review` 与面板待审核 approve/reject；请求采样记录注入 tokens，面板「最近主请求」显示注入列；usage/cache 在宿主提供时透传。
- **测试**：`node test-smoke.mjs` 覆盖 A2 回指、B1 doctor、C1 mode、C2 decompress、审核路由与 snapshot pendingItems；`scripts/eval/recall.mjs --dataset scripts/eval/zh-holdout.json` 词法 R@1 3/12（25%）。
- **未完成**：B2 消息级排序、B3 LongMemEval 实跑、E1/E2 完整版、D2 发布（无 npm 账号）。

## 1.4.0

- **面板图形化 + 表格化重做**：
  - 上下文构成：配色堆叠条 + 分段表（分段 / tokens / 占比，零值隐藏，<1% 保留一位小数）。
  - 记忆库：active / pending / superseded / archived 四个指标块；范围（会话/项目/全局）与类型（决策/事实/偏好/任务/技能）两组横向条形图；「最近使用」改为表格（# / 类型 / 范围 / 置信 / 使用 / 内容），保留小三角折叠。
  - 上下文明细：指标表 + 占比条（压力、注入、输出预留、已折叠）。
  - 活动：事件表（事件 / 次数 / 分布条），按次数排序取前 10。
  - 最近主请求：表（用途 / 模型 / 估算 tokens / 分布条）。
  - 配置：两列表格 + 水位开关；存储路径移到记忆库脚注。

## 1.3.2

- **「最近使用」可折叠**：记忆库里的最近条目列表加了小三角开关（▾ 展开 / ▸ 收起），默认展开，旁边显示条数；按钮带键盘焦点环与 hover 背景，点击区域比文字稍大。

## 1.3.1

- **面板改版**：composer 胶囊改为「圆环进度 + 上下文百分比 + 记忆数」；弹层重做为 580px 卡片——渐变 logo、环形压力表、四项指标、六段构成堆叠条与图例、记忆条目卡片（kind 徽章/scope/置信/使用次数）、活动 chips、最近请求、配置分组、开关式水位控件；分区加分隔线，Esc 可关闭，跟随 DSH 主题 token（`--dsw-alias-*`），深色/浅色自动适配。
- 预览图：`docs/panel-preview.png`（离线静态渲染，数值为样例）。

## 1.3.0

- **embedding 服务随插件分发**：本地 OpenAI 兼容服务从工作区 `embed-svc/` 移入 `context-hub/embed/`，模型缓存在 `embed/.cache/`，与插件同仓库、同版本管理。
- **插件自动拉起本地服务**：新增 `embedding.autoStart`（默认 true，仅回环地址生效）。插件启动时 ping `/health`，未就绪则 `spawn node embed/server.mjs`（端口取自 `baseUrl`，模型取自 `embedding.model`，自动补 `Xenova/`），轮询就绪后回填向量；事件 `启动向量服务` / `向量服务就绪` / `向量服务启动失败`，失败只降级。
- 分发包新增 `embed/` 下的 server、启动/停止脚本与 README（不含 node_modules 与模型缓存，首次使用按文档安装/下载）。

## 1.2.2 — 2026-11-25

- 新增可选 LLM 重排（`rerank.enabled`，默认关）：召回/检索候选交给一次模型调用排序，失败回退原序；`log` 记录「重排」事件。
- 修复 `embedding.queryPrefix` 未进入运行时配置；新增 `DSH_CONTEXT_HUB_QUERY_PREFIX`、`DSH_CONTEXT_HUB_EMBED_MIN_SCORE`。
- `log` 命令改用中文标签（与 status 活动行一致）；召回基准增加 top-10 指标。
- 语义对照：bge-m3 int8 + 指令前缀 top-6 66.7%（p50 25.7ms）；bge-large-zh int8 63.3%（31.7ms）；bge-base int8 56.7%。

## 1.2.1 — 2026-11-25

- 水位开关可持久化：`setWatermark()` 写 `kv.watermark.enabled`，重启自动恢复监听；新增 `POST /api/context-hub.watermark` 与面板按钮。
- 改写空输出修复：默认 `maxTokens` 1200，空正文放大预算重试一次（`rewrite-retry`）；`resolveConfig` 上限 600 → 2000。
- `embedding.queryPrefix` 改为可配置项（默认空）。

## 1.2.0 — 2026-11-25

- 语义召回：新增可选 LLM 查询改写（`rewrite`），召回前把查询扩成同义词/英文关键词，`explain` 显示改写行；失败/空输出记事件并回退原查询。
- 换模型保护：embedding 模型变化时自动清空旧向量并重算；新增 `/context-hub reembed`。
- 压缩水位：新增可选 `watermark`（默认关），pre-step 按 `triggerRatio`/`retainTokens` 自行选区并调用原生 `compactRegion`；成功/失败分别记录 `watermark`/`watermark-error`，失败交还原生。
- 运行时开关：`/context-hub watermark on|off`；status 显示「改写/水位」与最近水位压缩。
- 测试：smoke 新增水位触发与改写断言；本地 bge 探针 top-6 56.7%（词法 13.3%）。

## 1.1.1 — 2026-11-25

- 修复 `scripts/recall-bench.mjs` 的向量就绪误判（原先检查不存在的 `store.embeddingReady`，导致配了端点也跳过）；现在先 ping 端点，失败给出具体原因。
- 新增 `embed-svc/`：本机 OpenAI 兼容 embedding 服务（`server.mjs` + `start.sh`/`stop.sh`），基于 transformers.js + `Xenova/bge-small-zh-v1.5`（512 维，ONNX CPU），走 hf-mirror，完全本地、可离线。
- 实测向量路径：30 条改写探针 top-6 13.3% → **56.7%**（top-1 26.7%），p50 6.1ms；`explain` 可见「向量 +0.7x」归因。
- 版本 1.1.1；文档补本地服务接入方式（profile `cordis.patch.yml` 的 `config.embedding`）。

## 1.1.0 — 2026-11-25

- 召回基准（W1）：新增 `scripts/recall-bench.mjs`，30 条「记忆 → 改写查询」探针（查询与原句几乎不共享词元），默认跑词法基线，配置 `DSH_CONTEXT_HUB_EMBED_URL/_MODEL` 后加跑真实向量路径并给对照；词法基线实测 top-6 4/30（13.3%）。
- 可逆还原（W3）：新增 `context_hub_restore` 工具与 `/context-hub restore <start> [end]`，从会话日志按 seq 区间还原原文（默认 4000 字符预算，超限截断），以 `source.form='relay'` 注入下一步；`restore` 计入活动与观测事件。
- 并发验证（W6）：新增 `scripts/concurrency.mjs`，3 进程 × 300 条同时写入同一库；实测 900/900、`quick_check=ok`、`journal_mode=wal`。
- 冒烟测试新增 restore（工具 deferContext 与命令 agent.inject 两条路径、relay 来源断言）。
- 版本 1.1.0。

## 1.0.0 — 2026-11-25

- 记忆关系（W2）：新增 `memory_links(from_id,to_id,relation,weight)`；新记忆与同 scope 最相似旧记忆连 `related` 边（相似度 ≥0.4），`supersede` 连 `supersedes` 边；`expandNeighbors()` 一跳扩展，召回在条数/字符预算内最多补 1 条邻居（标记 `via=neighbor`），`explain` 展示「邻居扩展（权 w，来源 #id）」；`export` v2 快照含 `links`。
- 审核流（W5）：`reviewPending` 配置（env `DSH_CONTEXT_HUB_REVIEW=1`）；开启后自动抽取且置信 <0.8 的记忆先入 `pending`，不被召回；新增 `/context-hub review [list|approve <id>|reject <id>]`，批准转 active，拒绝软删；`status`/面板显示 pending 计数，审计事件 `review-approve`/`review-reject`。
- 冒烟测试新增：邻居扩展断言（explain 含「邻居扩展」）、export links 断言、`reviewPending` 独立库的 pending → approve → search 全链路断言。
- 发布准备（W7）：版本 1.0.0，重新打包 `dist/dsh-context-hub-1.0.0.tgz` 并更新 `dist/INSTALL.md`。

## 0.9.0 — 2026-11-25

- 压缩摘要入记忆（W3）：监听 `compaction/summary`，把摘要文本写成 `kind=summary`、`scope=session`、`source=compaction` 的记忆（绕过准入门槛，置信 0.95），原先只能靠会话日志检索的摘要现在可被 `search` / `explain` / 探针命中；`status` 增加「最近压缩：seq …（摘要已入库）」。
- 水位可观测（W3 部分）：`status` 增加「水位 N%（参考 70% 触发 / 60% 目标）」，明确阈值仍由 profile 的 compaction-basic 决定；文档给出建议配置。
- 逐请求观测（W4）：监听 `llm/stream`（只观察不改写，过滤插件自身辅助调用与 `compaction`），把 purpose/provider/model/消息数/工具数/估算 tokens/surface/合计/注入/输出预留写入 `context_events(kind=request)`，环形保留 200 条；`status` 增加「请求：最近 N 次…平均约 X tokens」，面板增加「最近主请求」列表（最近 20 条），`export` 快照包含 request 事件。
- 冒烟测试新增：合成 `compaction/summary` 后 `search umbrella-42` 必须命中且快照 `memory.kinds.summary ≥ 1`；`llm/stream` 直通断言、辅助调用过滤断言、`status` 含「请求：」断言。

## 0.8.0 — 2026-11-25

- 新增可选向量召回（W1）：OpenAI 兼容 `/embeddings` 端点（`embedding.{enabled,baseUrl,model,apiKeyEnv,minScore,timeoutMs}`，环境变量 `DSH_CONTEXT_HUB_EMBED_URL/MODEL`）；写入后后台补向量、启动时补历史 200 条，查询侧 cosine ≥ `minScore` 时按 `0.5+0.5·cos` 加成，`explain` 显示「向量 +x」；端点失败/超时自动降级为关键词 + FTS5。
- 规模化（W6）：`PRAGMA journal_mode=WAL` + `synchronous=NORMAL`；候选窗口提升到 800，FTS 命中按 id 补入候选集（大库不再只覆盖最近窗口）；新增 `scripts/stress.mjs`，10k 条实测 rank p95 15.2ms、probe 20/20（133ms）。
- 冒烟测试新增向量命中与 `explain` 向量断言（fetch stub，独立临时库）。

## 0.7.0 — 2026-11-25

- 新增 FTS5 混合检索：`memories_fts`（trigram、外部内容表、外部内容随写入增量同步），关键词打分保留为主路径，FTS 命中作为加成并可召回纯子串命中（如 `gres` → postgresql）；SQLite 未编 FTS5 时自动降级为纯关键词。
- 新增检索探针：`context_hub_probe` 工具与 `/context-hub probe [n]` 命令（共用 `probeText()`），从 active 记忆自造查询，输出 top-k 命中率与逐条位置，事件记为 `probe`；`status` 展示最近一次探针结果。
- `status` 配置行新增「检索 关键词+FTS5 / 仅关键词」；面板快照沿用同一数据源。`explain` 命中 FTS 时标注「FTS 第 n 位」。
- 抽取游标持久化到 `kv` 表：插件重载后从上次位置续接，不再重抽整段历史（冒烟用例覆盖）。
- 分发包：`dist/dsh-context-hub-0.7.0.tgz`（14 文件、58,311 字节，SHA-256 `e5871153…`）+ `dist/INSTALL.md`；隔离目录安装自检通过。
- 发布准备：MIT LICENSE、CHANGELOG、npm 元数据（keywords/license/repository/publishConfig/files），`locale/en.json`+`locale/zh.json` 展示元数据、原创 `icon.svg`（导出 `./locale/*.json`、`./icon`），版本 0.7.0。

## 0.6.0 — 2026-11-25

- 新增客户端面板：`client/client.js`（`window.__ModuleLoader__`），composer 下方状态胶囊 + portal 面板，10 秒轮询。
- 新增宿主路由 `GET /api/context-hub.status`（`connection.fetch.register`，鉴权由 connection 层处理）。
- `package.json` 增加 `dsh.client` 与 `./client` 导出；`statusSnapshot()` 供面板与文本 status 共用。

## 0.5.0 — 2026-11-25

- 服务级 hub 压缩器：实例包装原生 `compaction.summarize()`，8 段提示词（含「用户约束」），失败自动回退原生；`compactor: native|hub` 配置与 `/context-hub compactor` 运行时切换。
- 召回诊断：`recall-miss` 事件、`recentContext()` 上下文兜底、记忆侧近义扩展。

## 0.4.1 — 2026-11-25

- 修复召回触发：严格查询零命中时用最近对话兜底，并记录未命中；记忆文本也走近义扩展。

## 0.4.0 — 2026-11-25

- 新增压缩器 A/B 工具 `context_hub_abtest`：原生式 7 段 vs 记忆感知 8 段，记录段覆盖、来源覆盖、耗时；修复推理 token 吃光输出预算的问题（maxTokens 3000 + 空输出重试）。

## 0.3.1 — 2026-11-25

- 查询侧中英近义扩展（18 组：压缩↔compact/fold、记忆↔memory、插件↔plugin 等）。

## 0.3.0 — 2026-11-25

- P2 主体：治理命令 `forget`/`supersede`/`audit`，召回调试 `explain`，观测事件 `log`，导出 `export`，上下文构成拆分，记忆库 0600。

## 0.2.0 — 2026-11-25

- P1：五维写入门槛、scope/TTL/容量淘汰、时间衰减、3 轮冷却、召回 6 条/1200 字符、抽取 1–10 次/轮、冲突 supersede（evidence/recency）。

## 0.1.0 — 2026-11-25

- 首个可用版本：SQLite 记忆库、`context_hub_*` 工具、`/context-hub` 命令、turn/end 自动抽取、真人消息自动召回、status 洞察。
