# dsh-context-hub 优劣势与补强计划

> 版本：2026-11-26 · 对应实现 **1.6.1**
> 目的：把「和别的插件比，强在哪、弱在哪」写清楚，并把弱项收敛成五个可验收的补强方向。
> 方法：本机实测（`test-smoke.mjs`、`scripts/*.mjs`、真实会话的 `context_hub_status/probe/abtest`）+ 竞品 README、npm registry、GitHub 公开数据。**没有做同环境、同数据集的横向跑分**；竞品能力以其公开描述与公开数据为准，数据口径见 §2.1，引用见 §8。
> 与上一版的差异：1.1.1 版主要对比 billion-context / graph-memory / dsh-context，未纳入 dsh-memory（灵枢）、OpenViking、dsh-mnemon；本版补齐这三个，并修正 graph-memory 的仓库引用（在架项目为 `adoresever/graph-memory`，不是旧文档里的 `d3412-999/dsh-graph-memory`）。

## 0. 结论摘要

- 我们仍然不是任何单项的第一名：压缩不如 billion-context 完整，记忆写入/时序不如 dsh-memory（灵枢），服务端与多用户不如 OpenViking，上下文接管不如 graph-memory，可组合性与 UI 不如 dsh-mnemon。
- 我们的独特位置是：**一个 bundle 同时覆盖记忆、压缩、洞察三件事，共用一份 SQLite、一条注入通道，默认不与原生压缩抢注册，召回有预算且可解释**。
- 1.4.0 的真实进展：面板图形化/表格化；本地 embedding 服务随包分发并可自动拉起；LLM 改写与 LLM 重排可选；水位压缩 opt-in；`restore` 可按 seq 还原折叠区原文；`reviewPending` 审核流与 `memory_links` 已落地。
- 仍然拖后腿的五个方面：**① 记忆写入精度与证据粒度；② 检索默认质量与公共评测；③ 压缩/上下文接管与完整可逆；④ 分发、规模与生态；⑤ 观测的“可操作”程度**。这五个方面就是 §5 的补强主线。
- 补强顺序建议：先修包与上架（否则一切都是自证）→ 补证据粒度与默认检索档 → 做消息级可逆与接管分级 → 补公共基准与面板操作 → 最后再谈多用户/远程。
- 1.5.0 已落地（P0 第一批）：D1 修包、A2 消息级证据、B1 doctor、B2 召回带原文、B3 评测脚手架、C1 接管分级、C2 `decompress`；E1/E2 做了第一刀（面板审核、请求注入列）。
- 1.5.1 补齐：B2 阶段 2（消息级聚合排序 + ±1 句窗口）、B3 LongMemEval-S 48 题实跑（词法 evidence R@5 79.2%）、E1 面板 forget/supersede/compactor/mode、E2 请求车道与 usage/cache 汇总。
- 1.5.2 补齐可选增量：**独立消息索引**（`messages` + `messages_fts`，零记忆时也能按消息召回）、**LongMemEval 向量路径**、**面板成本曲线**。
- 1.5.3 补齐：**多语言 embedder**（multilingual-e5-small：zh-holdout R@5 100%、英文 LongMemEval 12 题向量与词法持平 83.3%）、**RRF 可选融合**（默认 weighted；RRF 在英文上反而伤，已如实记录）、**retainTurns 接管**（保留最后 N 个用户回合，只折叠最旧前缀）。**D2 仍受 npm 账号阻塞；100k/多用户按单机定位延后。**

## 1. 我们是什么（1.6.1）

| 环节 | 实现 | 入口 |
| --- | --- | --- |
| 记忆 | `turn/end` 用会话当前模型抽取结构化记忆，五维质量门槛（0.6）后写 SQLite；sha1 精确去重；`explicit`/`compaction` 绕过门槛；A2 起记录 `message_id/message_seq/sentence_no/valid_from/valid_to` | 自动 + `context_hub_remember` |
| 召回 | 用户消息触发，独立消息索引 + 关键词/FTS5 + 可选向量（weighted/RRF）、LLM 改写/重排；≤8 条/1800 字符、6 轮冷却、1200 tokens 硬顶、4000ms 超时；消息级候选 + ±1 句窗口 | 自动 + `context_hub_search` |
| 检索质量 | `probe` 自造查询测 top-k；`explain` 给逐条打分与跳过原因；`abtest` 对比压缩提示词；**B1/B3 新增 `doctor` 与 `scripts/eval/recall.mjs`** | 工具 + `/context-hub` 子命令 |
| 压缩 | 默认复用原生 compaction；`compactor: hub` 包装 `summarize()`；`watermark` opt-in，支持 `retainTokens`/`retainTurns`（保留 N 轮，只折叠最旧前缀）；`mode` 四档 | `/context-hub compact`、`compactor`、`watermark`、`mode` |
| 折叠区 | `compaction/summary` 落成 `kind=summary` 记忆；按 seq 检索 `history`、还原 `restore`；**C2 新增按摘要区间 `decompress`** | `context_hub_history` / `context_hub_restore` / `context_hub_decompress` |
| 洞察 | surface/总 tokens、六项构成、输出预留、水位、折叠区间、最近压缩、最近主请求、记忆库构成、消息索引与成本曲线；E2 起请求行带注入 tokens | `/context-hub status`、composer 面板 |
| 治理 | scope/TTL/容量、冲突 supersede（写 `valid_to`）、软删、审计链、审核流、JSON 导出；E1 起面板可 approve/reject | `forget/supersede/audit/log/export/review` + 面板 |
| 关系 | `memory_links`（related/supersedes），召回时一跳扩展 ≤1 条 | 自动 + `explain` 可见 |
| 消息索引 | 独立 `messages` + `messages_fts`；召回前增量索引，零记忆时也能按原文召回 | 自动 + `explain` 消息候选 |

实测基线（2026-11-25，本机 profile `web`，deepseek-flash）：surface 539,150 tokens → 1.1.0 时 669,147 tokens / 1,388 节点 / 5,268 事件；记忆 active 6；`probe` 4/4 → 20/20（自动出题，**不构成泛化证据**）；30 条改写探针：词法 top-6 13.3%，接本地 `multilingual-e5-small` 后 80%（24/30，p50 5.6ms）；zh-holdout 向量 R@1 66.7% / R@5 100%；A/B 摘要 B 8/8 段、来源覆盖 0.25，A 7/7 段、0.30。

## 2. 横向对比（1.5.3）

### 2.1 数据口径

下载量为 npm `last-month`（截止 2026-11-24），stars 取 GitHub API（2026-11-25）。`dsh-memory` 指 `@furongjun1999/dsh-memory`（灵枢）；`OpenViking` 指 DSH 插件 `@openviking/dsh-memory-plugin`，star 数为 OpenViking 主仓库。数字用于判断成熟度，不等价于质量结论。

| 项目 | 版本 | 形态 | npm 月下载 | GitHub stars | 公开评测 |
| --- | --- | --- | ---: | ---: | --- |
| context-hub | 1.5.3 | DSH 单 bundle，本地 SQLite | **未发布（404）** | 未统计 | 自造 30 条 + `zh-holdout` 12 条 + LongMemEval-S 48 题（另 12 题向量对照） |
| billion-context | 0.1.216 | 代理/原生跨客户端压缩层 | 3,921,176 | 8,394 | 论文 + 1500 题三方基准 + 生产数据 |
| dsh-memory（灵枢） | 0.11.1 | Python MCP 子进程 + md 认知图 + Rust 检索 | 38,245 | 753 | hive-memory-bench + LoCoMo 第三方复现 |
| OpenViking | 0.5.41 | 独立服务端 + DSH 插件 | 49,132 | 42,753 | 以产品与集成测试为主 |
| graph-memory | 1.6.0-beta.17 | DSH 原生 + OpenClaw 适配 | 594（npm 仍为旧版） | 680 | 20 轮实测（T20 -80.69%）+ 149 测试 |
| dsh-mnemon | 0.5.55 | DSH 原生 + 可组合 Source/Strategy | 165,754 | 1,127 | 机制测试；明确声明不代表模型准确率 |

### 2.2 记忆写入与治理

| 能力 | 我们 | 灵枢 | OpenViking | graph-memory | mnemon |
| --- | --- | --- | --- | --- | --- |
| 写入触发 | `turn/end` 一次 LLM 抽取 | 确定性规则优先，零 LLM | 服务端抽取/提交 | 每轮一次辅助 LLM，只取问题+最终答案 | 任务 Agent 去重提炼，或用户点选 |
| 成本 | 每轮一次模型调用 | 写入 0.013–0.020 秒（官方数据） | 服务端调用 | 每轮一次辅助调用 | 取决于策略/Provider |
| 证据粒度 | `evidence_seq` + A2 消息级列（`message_id/message_seq/sentence_no/valid_from/valid_to`） | md 原文 + ccg 六要素 | 服务端会话/资源 | 原始问题与最终答案 | 档案/记忆空间条目 |
| 时序/冲突 | 相似度 ≥0.85 + 置信比较；`valid_from/valid_to` 已落库，三类冲突判定待做 | 双时间轴 + 三类冲突 | 服务端治理 | 隔离失败抽取 | 依赖 Provider |
| 审核 | `reviewPending` 低置信入 pending | 按层复核（knowledge/structural/self/anchor） | 账号/权限 | 隔离而非审核 | 组件级开关 |
| 去重 | sha1 精确去重 | 归一化哈希 + 近邻 | 服务端 | 结构化契约 | Agent 去重 |

### 2.3 检索与召回

| 能力 | 我们 | 灵枢 | OpenViking | graph-memory | mnemon |
| --- | --- | --- | --- | --- | --- |
| 默认路径 | 词法 + FTS5；向量/改写/重排默认关 | 确定性规则 + Rust 检索 | 服务端六类 context 召回 | 向量 TopK + FTS5 回退 | 分层：常驻/检索/Provider |
| 语义 | 可选 BGE / multilingual-e5 / OpenAI 兼容；weighted 默认，RRF 可选 | 结构化检索为主 | 服务端语义/上下文 | 可选 embedding | 取决于 Provider |
| 消息级召回 | 独立消息索引 + 事实聚合；零记忆时也能按原文召回，渲染 ±1 句窗口 | 时间线/原文可回溯 | 会话提交 | **命中带回原始 Q/A** | 项目档案/记忆空间 |
| 融合/预算 | 关键词+FTS+向量加权；8 条/1800 字符 + 1200 tokens 硬顶 | 服务端/规则 | `recallMaxTokens` + 六类配额 | TopK | 策略预算 |
| 调试 | `explain`/`probe`/`abtest`/`doctor` + `scripts/eval/recall.mjs` | 指标与审计 | 服务端日志 | `gm_status`/`gm_stats` | UI 中可见本轮读写 |
| 公共基准 | LongMemEval-S 48 题词法 R@5 79.2%；12 题 e5 向量与词法持平；zh-holdout e5 R@5 100% | 有 | 以产品为主 | 有 20 轮实测 | 无准确率声明 |

### 2.4 压缩与上下文接管

| 能力 | 我们 | billion-context | graph-memory | OpenViking | mnemon |
| --- | --- | --- | --- | --- | --- |
| 控制何时/压多少 | 默认原生；`watermark` 可选（token 或 N 轮），只折叠最旧前缀 | 模型驱动，自管预算 | 保留最近 5 轮，旧历史折叠 | `turn/end` 按 token 阈值提交 | 策略预算 |
| 完整可逆 | 按 seq `restore` + 按摘要区间 `decompress`（消息级原文，有预算） | `compress`/`decompress` 完整闭环 | 折叠区保留精确 Q/A | 服务端保存 | 文件/Provider |
| 前缀缓存 | 未做专门优化 | 自报 96–99% 命中 | 未强调 | 服务端 | 未强调 |
| 摘要结构 | 8 段，A/B 验证 | 结转未完成目标 | 回合摘要 + SPO 导航 | 服务端规划 | 无固定摘要器 |
| 跨客户端 | 仅 DSH | 20+ | DSH + OpenClaw | 多宿主 | DSH |
| 证据 | 提示词 A/B | 论文 + 1500 题 | 20 轮实测 | 产品 | 机制测试 |

### 2.5 部署、规模与生态

| 能力 | 我们 | 灵枢 | OpenViking | graph-memory | mnemon |
| --- | --- | --- | --- | --- | --- |
| 依赖 | `node:sqlite`，零外部 | Python + Rust + 30+ 配置 | 独立服务端 + 账号 | SQLite，可选 embedding | 本地文件 + 可选 Provider |
| 多用户/远程 | 单机单用户 | `--serve` 多智能体 | **远程、账号隔离** | 单机 | 单机 + Git 同步 |
| 规模验证 | 10k、3 进程；100k 未测 | Rust 检索、并发实例 | 服务端 | 未强调 | 未强调 |
| 分发 | 未发 npm；tgz 已修自依赖 | npm | npm + 官网安装器 | npm 旧版，GitHub 固定 tag | npm + 市场 |
| 安装体验 | 需手改 profile/绝对路径 | `init` + MCP | 安装器/插件页 | 固定 tag | 插件页一键 |
| 兼容 | DSH 0.2.x、Node ≥22.5 | 跨 MCP 宿主 | DSH <1.0 | DSH 0.2.x | DSH 0.2.x |

### 2.6 观测与 UI

| 能力 | 我们 | 灵枢 | OpenViking | graph-memory | mnemon |
| --- | --- | --- | --- | --- | --- |
| 面板 | 卡片 + 图形/表格 + 成本曲线 + 待审核/治理操作 | 指标/MCP | Studio + 管理器 | 状态工具 | **完整 WebUI** |
| 归因 | `explain` 逐条打分、`probe`、`abtest` | 审计链 | 服务端日志 | 状态/统计 | 本轮读写可见 |
| 请求级 | 最近 200 条采样 | 有 | 有 | 有 | 有 |
| 成本/缓存 | 面板成本曲线 + usage/cache（宿主提供时） | 有部分 | 服务端 | 未接 | 未强调 |
| 审计 | 追加式事件 + 软删 | 强 | 账号/权限 | 隔离 | 本地存储 |

## 3. 优势

- **S1 一体化，共用数据**：抽取的记忆同时服务召回、`hub` 摘要与面板归因；三个专项插件拼起来会重复注入、预算互相打架。
- **S2 低冲突**：默认 `native` 时只做触发与折叠区检索；`hub` 仅实例包装 `summarize()`，失败回退（`compact-hub-fallback`），不新增 compaction 服务。
- **S3 召回是预算而不是税**：8 条/1800 字符、6 轮冷却、1200 tokens 硬顶、4000ms 超时、scope 权重（1.0/0.8/0.6）、TTL、每 scope 5000 条上限、五维准入 0.6；比恒定大预算注入更适合长会话。
- **S4 可解释、可度量**：`explain` 给出 overlap/ratio/base/weight/decay/usage 与跳过原因；`probe` 给命中率；`abtest` 给段覆盖/来源覆盖。多数记忆插件只有成功/失败。
- **S5 零外部依赖、可降级**：`node:sqlite` 单文件，FTS5 不可用自动退回纯关键词；embedding/改写/重排任一失败都不阻塞主路径。
- **S6 中文友好**：中文二元组 + 18 组中英近义 + trigram，短查询与 `compact↔压缩` 这类跨语言写法能命中。
- **S7 治理与归因合一**：软删、显式替换、审计链、审核流、观测日志、JSON 导出都在同一份存储上，能回答“这条记忆为什么被召回/为什么被删”。

## 4. 劣势与根因（W1–W8）

每条按「现象 → 影响 → 根因」写；具体动作与验收见 §5。

### W1 检索默认质量不足，且缺少公共评测

- 现象：向量/改写/重排默认关；开启本地 e5 后 30 条改写探针 top-6 80%，但 `probe` 仍是自动出题，不能单独证明泛化。
- 影响：开箱即用的长会话召回不稳定，“换个说法”场景仍会漏。
- 根因：增强链默认关闭、没有推荐档；公共基准已跑 LongMemEval-S 48 题，但仍是证据召回而不是答案准确率；独立消息索引与多语言向量已落地，但抽取粒度仍是整轮切条。

### W2 消息级证据与聚合排序已补，抽取粒度仍是整轮

- 现象：`message_id/message_seq/sentence_no/valid_from/valid_to` 已落库，`audit` 可回指；独立 `messages/messages_fts` 已能按原文召回，并聚合排序、渲染 ±1 句窗口。剩余问题是抽取仍按整轮切条，时序查询入口未暴露。
- 影响：同一消息的多条事实已能整组进入预算，但“按时间点查询”仍要人工看 `valid_from/valid_to`。
- 根因：排序已切到消息组，数据模型仍是事实表 + 证据回指。

### W3 可逆有了，但接管仍弱

- 现象：`decompress` 已能按摘要区间还原；`watermark` 支持 `retainTurns`（保留 N 轮、只折叠最旧前缀），但默认关、无前缀缓存命中率指标；选区权仍归原生。
- 影响：压缩收益上限受原生策略限制；与 billion-context 的可逆折叠、graph-memory 的上下文接管不在一个层级。
- 根因：设计上不替换 compaction 服务，也不拥有“模型可见历史”的选区权。

### W4 面板已能闭环治理，成本和曲线仍浅

- 现象：面板已能 approve/reject、forget、supersede、compactor、mode、水位；请求行显示注入与 usage/cache 汇总。成本曲线已交付；剩余是批量操作与二次确认。
- 影响：日常治理不再必须切命令，但深度调参仍依赖 `status`/`explain`。
- 根因：面板从只读视图逐步外移写操作，成本字段依赖宿主是否提供 usage。

### W5 治理是软删 + 审计链，不是分层复核

- 现象：`reviewPending` 只对“自动抽取且置信 <0.8”生效；没有按层/来源/风险的分级复核；审计事件可被软删但无不可变库。
- 影响：多 agent/团队场景下，知识层被污染只能事后清理。
- 根因：写入即生效；`status` 只有 active/pending/superseded/archived/deleted。

### W6 规模化只验证到 10k / 3 进程

- 现象：10k 条 rank p95 15.2ms、3 进程 900/900 通过；100k 级、长事务、跨机器共享未测。
- 影响：长期重度使用或大团队时，延迟与锁等待未知。
- 根因：单文件 SQLite、单连接、单进程；候选窗口 800 是折中。

### W7 生态位仍未闭环

- 现象：自依赖已删、`private` 已改 false，但 npm 仍未发布（registry 404）、未进 dshmarket；现有分发包仍是旧 tgz。
- 影响：别人还不能一条命令安装，也拿不到真实反馈。
- 根因：发布被 npm 账号阻塞；市场材料与验证还没走完。

### W8 配置面过大，缺少“推荐档”

- 现象：30+ 配置项，向量/改写/重排/水位/审核默认关；用户需要自己拼组合。
- 影响：开箱体验接近“只开词法”，与竞品的“装完就能用”有差距；也放大了 W1。
- 根因：能力以 opt-in 方式叠加，没有 profile 预设与启动自检建议。

## 5. 五个方面的补强计划

> 对应上一轮对比的五个方面：A 记忆写入与治理、B 检索与召回、C 压缩与上下文接管、D 部署/规模/生态、E 观测与 UI。
> 优先级：P0 先做（决定能不能被用起来），P1 做深（决定能不能被留下），P2 做宽（决定能不能被传播）。
>
> 完成度（2026-11-25，1.5.3）：**D1 / A2 / B1 / B2 / B3 / C1 / C2 / E1 / E2 完成第一版；B4（weighted/RRF）与 C3（retainTurns/前缀稳定）完成第一版**；D2 阻塞，100k/多用户延后。详见 §9。

### A. 记忆写入与治理（对齐灵枢 / graph-memory / mnemon）

| 编号 | 动作 | 做法 | 验收 | 优先级 |
| --- | --- | --- | --- | --- |
| A1 | 确定性优先的写入 | 显式信号（“记住/以后/不要/偏好/约定”）用规则直接写（`source=explicit/rule`），零 LLM；其余才走模型 | 显式场景 0 次 LLM；smoke 覆盖；写入耗时 p95 < 10ms | P1 |
| A2 | 消息级证据（已完成） | `memories` 增 `message_id`、`message_seq`、`sentence_no`、`valid_from`、`valid_to`；抽取时回指；`audit/explain` 可显示原文位置 | 旧库自动迁移；命中可回指原消息；时序查询有入口 | P0 |
| A3 | 三类冲突判定 | 在相似度基础上加否定翻转、数值变更、状态迁移；supersede 写 `valid_to`，不删除 | 三类 case 各有 smoke；误判率可回滚 | P1 |
| A4 | 分层复核 | `reviewPolicy: off / low-confidence / layered`；`knowledge`/`structural` 默认复核，`explicit` 直写；审计只追加 | pending/approve/reject 计数正确；分层开关可持久化 | P1 |
| A5 | 语义近邻去重 | sha1 精确去重之外，cosine ≥0.92 视为重复/合并候选，不直接删 | 30 条近重复集无错误合并；去重率与召回率同时报告 | P2 |

### B. 检索与召回（对齐 mnemon / graph-memory / memoria）

| 编号 | 动作 | 做法 | 验收 | 优先级 |
| --- | --- | --- | --- | --- |
| B1 | 推荐档与自检 | 新增 `context_hub_doctor`（或 `/context-hub doctor`）：检测 FTS5/embedding/模型端点，输出 `minimal / balanced / semantic` 三档建议与可粘贴配置（一键写入留到下一增量） | 一条命令给出当前档位与缺口；不静默降级 | P0 |
| B2 | 消息级召回（已完成） | 独立 `messages/messages_fts` 增量索引；零记忆时也能按原文召回；按来源消息聚合排序，渲染 ±1 句窗口 | 零记忆消息召回、原文窗口、聚合排序均有 smoke 断言 | P0 |
| B3 | 公共基准 | 已交付 `scripts/eval/recall.mjs` + `scripts/eval/zh-holdout.json` + `docs/EVAL.md`；LongMemEval 48 题词法、12 题向量对照；zh-holdout R@5 词法 25% → 向量 58.3% | 可复跑脚本；报告 R@1/3/5/10、MRR、p50/p95；LongMemEval 数据需自备 | P0 |
| B4 | 车道融合与归因（第一版） | 词法/FTS 与向量支持 `weighted`（默认）/`rrf`；`explain` 显示 lex/vec 名次与 RRF；重排只作用于 top-k | 同一数据集消融：zh-holdout e5 R@5 100%；英文 RRF 反而伤，默认 weighted | P1 |
| B5 | 查询卫生 | 只取本步用户原文构造查询；排除注入块、工具结果、其他插件消息；避免自我召回 | smoke 断言：注入消息不触发检索 | P1 |

### C. 压缩与上下文接管（对齐 billion-context / graph-memory）

| 编号 | 动作 | 做法 | 验收 | 优先级 |
| --- | --- | --- | --- | --- |
| C1 | 接管分级（已完成） | 定义 `observe / assist / takeover / full` 四档；默认 `auto`（保持旧行为），推荐 `assist`；`status` 明示当前档；失败逐级回退 | 四档可切换；回退有事件；默认不改变非 hub 用户 | P0 |
| C2 | 消息级可逆（已完成） | 保存“摘要 ↔ 区间”映射；新增 `context_hub_decompress [id|start] [end]`，默认取最近一次摘要，按消息原文重注入（预算可配），与 `restore` 并存 | 压缩→还原 round-trip 文本一致（预算内）；审计有记录 | P0 |
| C3 | 前缀稳定/缓存友好（第一版） | `retainTurns` 保留最后 N 个用户回合，只折叠最旧前缀；不重写保留尾部；cache 命中率在宿主提供 usage 时记录 | `mode takeover/full` 默认保留 5 轮；smoke 断言折叠区间；文档标注前缀策略 | P1 |
| C4 | 压缩回执 | 每次压缩记录区间、shadowed tokens、压缩比、耗时、使用的提示词版本；`status`/面板可查 | 最近 20 次压缩有回执；可导出 | P1 |
| C5 | 摘要质量闭环 | 8 段校验（缺段降级）、结转未完成目标与用户约束、空输出重试；A/B 纳入验收 | 段覆盖/来源覆盖不下降；失败回退可观测 | P1 |

### D. 部署、规模与生态（对齐 mnemon / OpenViking / billion-context）

| 编号 | 动作 | 做法 | 验收 | 优先级 |
| --- | --- | --- | --- | --- |
| D1 | 修包（已完成） | 删除 `package.json` 的自依赖；`private` 改为 `false`；`files` 重新审计 | `npm pack --dry-run` 通过（29 文件，无 `file:` 依赖）；干净 profile 从 tgz 安装无解析错误 | P0 |
| D2 | 上架 | npm 账号就绪后 `npm publish`；提交 dshmarket；用 `install_bundle(target="dsh-context-hub@x.y.z")` 验证第三方路径 | registry 200；市场页可安装；README 去掉“未发布”限定 | P0（受账号阻塞） |
| D3 | 规模化 | 造 100k 条 + 长事务 + 4 进程；为 `rank()` 的 scope/status 加组合索引；记录 WAL/quick_check | rank/probe p95 达标；无锁死；库大小与内存可接受 | P1 |
| D4 | 兼容矩阵 | 覆盖 DSH 0.2.x 的 RC/正式版、Node 22/24；smoke 进 CI | 矩阵全绿；失败给出可复现命令 | P1 |
| D5 | 可移植 | 在 JSON 导出之外补 JSONL 导出/幂等导入；保留已失效历史；遗忘不复活 | 导出→导入 round-trip；重复导入不产生重复行 | P1 |
| D6 | 边界声明 | 继续坚持单机单用户；远程/多用户只做“导出/共享文件”级，不引入服务端 | README/文档明确非目标；不承诺团队权限 | P2 |

### E. 观测与 UI（对齐 mnemon / OpenViking / dsh-context）

| 编号 | 动作 | 做法 | 验收 | 优先级 |
| --- | --- | --- | --- | --- |
| E1 | 面板可操作（已完成第一版） | 面板已提供 approve/reject、forget、supersede、compactor、mode、水位开关；统一走 `/api/context-hub.review` 与 `/api/context-hub.action` | 未认证 401；操作后有审计事件；smoke 覆盖 approve/supersede/forget/mode | P1 |
| E2 | 请求级归因（已完成第一版） | 每请求记录注入 tokens、输出预留、最近召回车道与 usage/cache；面板显示注入列、汇总行与「成本曲线」（总估算/注入 sparkline） | 最近 20 条请求可见；单请求开销 < 5ms | P1 |
| E3 | 记忆视图 | 关系边、冲突链、provenance、时间线；不做全图 PageRank/社区检测 | 面板可展开链接与原文；数据来自现有表 | P2 |
| E4 | 诚实指标 | `probe` 显示样本量与置信区间；区分“自造探针/公开基准”；不把 20/20 当泛化结论 | 文案与文档一致；指标可追溯 | P1 |
| E5 | 导出与日志 | JSONL 快照、结构化日志（沿用 pino）、审计链只追加；导出含 links/events/requests | 导出可被脚本消费；日志不含记忆正文 | P2 |

## 6. 阶段路线

| 阶段 | 版本 | 内容 | 说明 |
| --- | --- | --- | --- |
| P0 | 1.5.0 | D1 修包、A2 证据粒度、B1 推荐档/自检、B2 消息级召回（阶段 1）、B3 公共基准脚手架、C1 接管分级、C2 消息级可逆 | 第一批已完成；“装得上、测得准、可还原”已闭环 |
| P0 | 1.5.x | D2 上架（账号就绪后）+ 1.5.1/1.5.2 已补齐消息索引 / LongMemEval 词法+向量 / 成本曲线 / E1/E2 | 除 D2 外已完成 |
| P1 | 1.6.0 | A1/A3/A4、B5、C4/C5、D3/D4/D5、E4 | B4/C3 已在 1.5.3 完成第一版；剩余补齐默认体验与治理 |
| P2 | 2.0 | A5、E3、E5、D6 边界与可移植 | 生态与长期维护 |

每个阶段结束统一跑：`node test-smoke.mjs`、`node scripts/stress.mjs`（或 100k 版）、真实会话 `probe`、`status` 对照、`docs/` 与 `CHANGELOG.md` 更新、版本号 +0.1。涉及检索/压缩的改动必须同时更新 `docs/spec.md` 的验收标准，避免文档与实现再次漂移。

## 7. 非目标（本轮不做）

- 不替换 DSH 的 compaction 服务注册；`watermark` 只是 opt-in 的 pre-step 主动选区，仍调用原生 `compactRegion`。
- 不做全图 PageRank、社区检测与技能自动沉淀（留给 graph-memory / mnemon 类插件）。
- 不自建向量库/嵌入服务，不内置大模型；本地 embedding 仍是可选 sidecar。
- 不做多用户/团队权限与远程记忆中心（OpenViking 的领域）；只保留导出/导入级可移植。
- **100k 级与多用户本轮明确延后**：单机定位下不引入服务端；若将来做团队，按 OpenViking 式服务端另立项，不在本插件内塞。
- 不为了对齐竞品而牺牲“单 bundle、零外部依赖、失败可降级”的默认路径。

## 8. 参考

- [billion-context](https://github.com/ranxianglei/billion-context) — 跨客户端压缩代理、可逆 `compress/decompress`、前缀缓存、论文与 1500 题基准。
- [dsh-memory（灵枢）](https://github.com/FuRongJun-1999/dsh-memory) — Python MCP + md 认知图 + Rust 检索、确定性写入、分层复核、hive-memory-bench / LoCoMo。
- [OpenViking](https://github.com/volcengine/OpenViking) — 上下文数据库；DSH 插件 `@openviking/dsh-memory-plugin`，需要服务端，六类 context 召回与技能目录。
- [graph-memory](https://github.com/adoresever/graph-memory) — 保留最近 N 轮 + 旧历史折叠、向量 TopK + FTS5、原始 Q/A 证据、20 轮实测。
- [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) — Source/Strategy 可组合、分层记忆、9 种 Provider、WebUI、自进化技能。
- `memoria`（本机 `default-workspace/memoria`，未在 npm 上架）— JSONL 导入导出、消息级召回、LongMemEval-S 结果；本版只把它作为方法参考，不作为在架竞品。
- [dsh-context](https://github.com/bowenliang123/dsh-context) — 六段堆叠、逐请求浏览器、缓存与成本（洞察类参考）。
- 本 repo：[spec.md](spec.md)、[design.md](design.md)、[compactor.md](compactor.md)、[ab-compactor.md](ab-compactor.md)。

## 9. 执行顺序与进度（2026-11-25）

按 §0 的建议顺序推进；每完成一项就更新本表，并在 `CHANGELOG.md` 留一条可复核的记录。

| 顺序 | 编号 | 事项 | 状态 | 验收证据 |
| ---: | --- | --- | --- | --- |
| 1 | D1 | 修包：清 `package.json` 自依赖、`private`、files | **完成** | `npm pack --dry-run` 29 文件；无 `file:` 依赖 |
| 2 | A2 | 消息级证据：`message_seq/message_id/sentence_no/valid_from/valid_to` | **完成** | 旧库迁移 + `audit` 显示 `消息 seq`；smoke 覆盖 |
| 3 | B1 | `context_hub_doctor` 推荐档与自检 | **完成**（只读） | 工具/命令输出档位、缺口与可粘贴配置 |
| 4 | B2 | 独立消息索引 + 消息聚合排序 + 窗口 | **完成** | `messages/messages_fts`；零记忆也能按原文召回；smoke 覆盖 |
| 5 | B3 | 公共基准 + LongMemEval 词法/向量 | **完成** | 48 题词法 R@5 79.2%；e5 英文 12 题 83.3%、zh-holdout 100% |
| 6 | C1 | 接管分级 observe/assist/takeover/full | **完成** | `status` 显示模式；`/context-hub mode` 持久化；smoke 覆盖 |
| 7 | C2 | 消息级 `decompress`（按摘要区间还原原文） | **完成** | `context_hub_decompress` + 命令；round-trip + `decompress` 事件 |
| 8 | E1 | 面板可操作（审核/遗忘/替换/压缩器/模式/水位） | **完成第一版** | review + action 路由；面板按钮；smoke 覆盖 approve/supersede/forget/mode |
| 9 | E2 | 请求级归因（车道/注入/usage/cache/成本曲线） | **完成第一版** | 请求记录 `lanes` 与 usage；面板注入列 + 汇总行 + sparkline |
| 10 | D2 | npm / dshmarket 上架 | **阻塞（无 npm 账号）** | `npm whoami` 未登录；`npm publish --dry-run` 通过；清单见 `docs/RELEASE.md` |
| 11 | B4 | 车道融合：weighted / RRF + explain 名次 | **完成第一版** | `embedding.fusion`；e5 英文 weighted 83.3%，RRF 75% 已记录 |
| 12 | C3 | retainTurns 接管 + 只折叠最旧前缀 | **完成第一版** | `watermark.retainTurns`；mode takeover/full 默认 5 轮；smoke 断言 |
| 13 | D3/D6 | 100k / 多用户 | **延后** | 单机定位；团队场景按 OpenViking 式服务端另立项 |

> 说明：D2 需要 npm 账号；在账号就绪前只做 D1 与 tgz 验证，不把“未发布”写成已完成。B2 已交付“独立消息索引 + 消息聚合排序 + ±1 句窗口”；多语言向量已选型（multilingual-e5-small），但抽取粒度仍是整轮切条，100k/多用户延后。
