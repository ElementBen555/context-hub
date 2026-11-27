# 补强路线图（7 项）

本文件是「接下来做什么」的唯一依据：每项都有目标、做法、验收、状态。状态只有三种：`未开始` / `进行中` / `已完成`。完成后必须同时更新本文件的验收结果与 README 的「已验证」。

## 原则

1. **本地优先**：默认不依赖外部服务；向量、LLM 改写/重排都是可选项。
2. **单包**：一个插件完成压缩补位、记忆、观测；不拆分。
3. **可解释**：每次注入、每条记忆、每次折叠都能回答「为什么」。
4. **先证明再扩能力**：没有度量就不加功能。

## 总览

| # | 项 | 现状 | 目标 | 状态 |
| --- | --- | --- | --- | --- |
| P0 | 质量评估 | 12 条 holdout、30 条探针、200 条合成 probe | 200 条真实探针 + 100 条 holdout + 负样本；R@5 ≥ 90%，FP ≤ 5% | 进行中 |
| P1 | 轻量图谱 v1 | 仅相似边 `memory_links` | 实体/关系 + 1-hop，最多补 2 条 | 未开始 |
| P2 | 压缩账本 | 只有 watermark 开关与折叠计数 | 只读账本（折叠区间/省下 tokens/复问率），再评估接管 | 未开始 |
| P3 | 规模验证 | 10 万条：rank p95 99.8ms | 保持 p95 < 150ms；可选 100 万条压测 | 已完成（1.6.6） |
| P4 | CI + 渠道 | 手动跑 smoke | GitHub Actions（smoke/stress/eval）+ dshmarket 清单 | 未开始 |
| P5 | npm 发布 | 名称未占用，包已验证 | slim 包 + `embed` 可选安装；新机器可装 | 未开始（用户暂缓） |
| P6 | 多平台/依赖 | Linux x64 验证 | macOS arm64 / Windows 的安装矩阵与降级 | 未开始 |

## P0 质量评估

**问题**：现在的 12 条 holdout 太小，200 条 probe 是合成语料，60% 不能代表真实召回；没有「不该召回」的负样本。

**做法**：
- 从真实会话记忆抽样 200 条，人工/LLM 各写一条改写查询（不共享原句词元），组成 `scripts/eval/real-200.json`；隐私字段脱敏。
- 负样本 50 条：与语料无关的问题，期望召回为空或低分。
- 指标：R@1/3/5、MRR、FP rate、p50/p95；词法与向量分别记录。

**验收**：真实 200 条上 R@5 ≥ 90%；负样本 FP ≤ 5%；无向量时 p95 < 20ms。

**当前**：`scripts/eval/recall.mjs` 已支持本仓库格式与 LongMemEval；`zh-holdout.json` 12 条；`recall-bench.mjs` 30 条改写探针。真实 200 条待采样。

## P1 轻量图谱 v1

**问题**：只有 `related` / `supersedes` 两类边，回答不了「这个决定影响了哪些任务」。

**做法**：
- 表 `entities(id, kind, name, project, created_at)`、`edges(from_id, to_id, relation, weight, evidence_seq)`；关系先支持 `about` / `affects` / `requires`。
- 抽取复用 turn/end 的 LLM 结果，不新增调用；实体去重按 `(project, lower(name))`。
- 召回只做 1-hop：命中记忆取权重最高的 2 条邻居，标注「经 #id 关联」；不做社区发现、不做全图遍历。

**验收**：多跳探针（A 决定 → B 任务）R@5 提升 ≥ 10%；单次注入增量 ≤ 200 tokens；图谱关闭时行为不变。

## P2 压缩账本

**问题**：压缩仍委托原生 `compaction-basic`，我们只有触发与水位，没有「省了多少、有没有反复问」的账。

**做法**：
- 只读账本：记录每次 `compaction/summary` 的 `shadowedTokenCount`、摘要 tokens、压缩前后请求量、随后 3 轮是否复问同一问题。
- 面板增加「压缩」页：区间列表、累计节省、复问率、失败回退次数。
- 评估达标后再讨论是否接管 `summarize` 或做可逆折叠。

**验收**：连续 30 天数据；累计节省 ≥ 20%；复问率不高于未压缩基线；失败自动回退。

## P3 规模验证

已完成：`scripts/scale.mjs` 10 万记忆 + 2 万消息，rank p50 85.6 / p95 99.8 / p99 106.6ms，DB 67MB，RSS 249MB；详见 `docs/SCALE.md`。

可选：100 万条压测；RRF 融合 FTS 与窗口结果，目标 p99 < 80ms。

## P4 CI + 渠道

- GitHub Actions：`npm test`（smoke）、`stress`、`concurrency`、`eval --json`（无端点时跳过向量）。
- dshmarket 清单：README、icon、locale、截图、安装命令。
- 验收：PR 上 CI 全绿；从 tarball 安装后 `/context-hub status` 正常。

## P5 npm 发布

**用户决定（2026-11-27）**：暂不发布，先做其它项。恢复条件：有 npm 账号或 granular token。

- 主体发布 slim 包（30 文件）；`embed/node_modules` 不打进 npm 包。
- 首次使用：`npx dsh-context-hub setup`（或文档提示 `cd embed && npm install --ignore-scripts`）。
- `prepublishOnly` 校验：版本一致、smoke 通过、文件清单。

## P6 多平台/依赖

- 当前只验证 Linux x64；macOS arm64 走 `onnxruntime-node` 预编译，Windows 需要单独测。
- 向量默认关闭；缺依赖时降级关键词 + FTS5，不阻塞会话。
- 验收：三平台各跑一次 smoke + 一次 embedding 健康检查。

## 里程碑

| 里程碑 | 内容 | 预计 |
| --- | --- | --- |
| M1 | P0 真实评估数据集 + 基线数字 | 3–5 天 |
| M2 | P1 图谱骨架 + 召回接线 | 2 周 |
| M3 | P2 账本 + P4 CI/市场 | 3 周 |
| M4 | P5 npm + P6 多平台 | 视账号/环境 |

## 决策记录

- 2026-11-27：npm 暂缓（m06115），先做 P0/P1/P2。
- 2026-11-26：向量默认关闭；embed 随包但不进 npm。
- 2026-11-26：图谱只做 1-hop，不做社区发现。
- 2026-11-25：默认不替换 compaction 服务；`compactor: hub` 只包装 `summarize()`。
