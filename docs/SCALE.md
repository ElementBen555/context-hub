# 规模化验证（10 万条记忆）

目标：在单进程、本地 SQLite 的前提下，验证 10 万条记忆 + 2 万条消息时插件的读写延迟是否仍可用。

## 环境与方法

- Node 24.22.2，`node:sqlite`，WAL，单进程；临时库，不触碰真实 `~/.dsh/context-hub/memory.db`。
- 数据：100,000 条记忆（20 个项目、50 个会话，scope 10% session / 60% project / 30% global），20,000 条消息；直接 bulk insert 后 `rebuildFts()`。
- 查询：10 条中文查询 × 5 轮取延迟分位；`probe(200)` 统计每条记忆按自身关键词能否进 top-6。
- 脚本：`node scripts/scale.mjs 100000 20000`（输出 JSON；`--keep` 保留库文件）。

## 结果

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| open | 5 ms | 5 ms |
| bulk insert 100k 记忆 | 1,065 ms | 1,065 ms |
| bulk insert 20k 消息 | 1,969 ms | 1,969 ms |
| FTS rebuild | 1,094 ms | 1,094 ms |
| rank p50 / p95 / p99 | 97.2 / 110.6 / 114.5 ms | **85.6 / 99.8 / 106.6 ms** |
| probe top-6 命中 | 100/200（50%） | 120/200（60%） |
| DB 大小 | 60.1 MB | 67.0 MB |
| 进程 RSS | 216 MB | 249 MB |

rank 的 p95 已进入 100 ms 量级；DB 与内存都在可接受范围。

## 优化内容

1. **partial index**：`memories_session_recent` / `memories_project_recent` / `memories_scope_recent`（`(…, created_at DESC) WHERE status='active'`）。
2. **project 查询拆等值**：原来 `(project=? OR project='')` 让索引失效，改为两条等值查询后合并；候选窗口排序 `created_at DESC, id DESC`，窗口 800→400。
3. **token 缓存**：`MemoryStore.tokenCache`（上限 5000，写入时清空），避免每次 rank 重算记忆的 token 集合。
4. **FTS 查询分级**：整句短语 → 2 词 AND → 3 词 AND（均 `ORDER BY bm25 LIMIT 50`）→ 兜底 OR（不排序）；避免常见中文三元组触发十万级 bm25 排序。
5. **probe 修正**：SELECT 补 `session_id`（此前 session 记忆永远 probe 不到）；稀有词优先选长度 ≥3。

## 已知限制

- 合成语料模板重复度高（同一模板 + 自增编号），probe 的查询词常在同模板记录间歧义，60% 不能代表真实语料；真实库近期 probe 为 8/8（100%）。要判断召回质量，需要真实对话语料或更真实的 holdout（`scripts/eval/zh-holdout.json` 目前 12 条，偏小）。
- 仅测单进程单连接；多进程并发见 `scripts/concurrency.mjs`（900/900 写入、`quick_check ok`）。
- rank 仍受 400 窗口 × 3 scope 的候选打分限制；如果要更低 p99，可把 FTS 结果与窗口结果做 RRF 融合，而不是仅作补充。

## 下一步

- 用真实会话抽样扩到 200 条探针，重测召回质量。
- 评估 RRF 融合与 scope 窗口自适应（按候选密度）。
