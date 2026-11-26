# 召回评测（B3）

目标：把「召回好不好」从主观感觉变成可复跑的指标，避免只报 `probe` 的自动出题命中率。

## 指标

| 指标 | 含义 | 局限 |
| --- | --- | --- |
| `R@k` | 期望记忆是否落在前 k 条 | 只测“找没找到”，不测最终答案 |
| `MRR` | 首个期望条目名次的倒数 | 多期望条目时只取第一个 |
| `p50/p95` | 单次查询延迟 | 本机、小库，不代表生产规模 |

## 跑法

```bash
# 内置 30 条改写探针（与 scripts/recall-bench.mjs 同一组）
node scripts/eval/recall.mjs

# 自建留出集
node scripts/eval/recall.mjs --dataset scripts/eval/zh-holdout.json

# 加向量对照（本地 embed/ 或任意 OpenAI 兼容端点）
DSH_CONTEXT_HUB_EMBED_URL=http://127.0.0.1:11434/v1 \
DSH_CONTEXT_HUB_EMBED_MODEL=bge-small-zh-v1.5 \
node scripts/eval/recall.mjs --dataset scripts/eval/zh-holdout.json

# 机器可读
node scripts/eval/recall.mjs --json
```

## 数据集格式

```json
{
  "name": "my-set",
  "facts": [{ "id": "f1", "text": "要检索的事实", "kind": "fact" }],
  "queries": [{ "query": "改写后的查询", "expected": ["f1"] }]
}
```

也接受 `cases: [{ memory, query, expectedId? }]` 的简写。

## LongMemEval-S

LongMemEval 数据不随包分发。下载 `longmemeval_s_cleaned.json` 后：

```bash
node scripts/eval/recall.mjs \
  --format longmemeval \
  --dataset /path/to/longmemeval_s_cleaned.json \
  --limit 48
```

当前实现把每个 `haystack_session` 当成一条事实（`id=session_id`），用 `answer_session_ids` 算 evidence recall；这不是 LLM 判分，也不是最终答案准确率。样本量小，置信区间宽，不能把一次结果当结论。`--limit` 在 LongMemEval 模式是题数，`--topk` 才是 top-k（默认 10）。

## 当前基线（2026-11-25）

| 数据集 | 模型 | 融合 | R@1 | R@5 | MRR | 备注 |
|---|---|---|---:|---:|---:|---|
| `zh-holdout` 12 | 无（词法） | — | 25.0% | 25.0% | 0.250 | 基线 |
| `zh-holdout` 12 | bge-base-zh-v1.5 q8 | weighted | 75.0% | 83.3% | 0.806 | 中文 |
| `zh-holdout` 12 | multilingual-e5-small q8 | weighted / rrf | 66.7% | **100%** | 0.799 | 中文，R@5 满分 |
| LongMemEval-S 48 | 无（词法） | — | 66.7% | 79.2% | 0.740 | evidence recall |
| LongMemEval-S 12 | 无（词法） | — | 75.0% | 83.3% | 0.806 | 英文子集 |
| LongMemEval-S 12 | bge-base-zh-v1.5 q8 | weighted | 66.7% | 75.0% | 0.734 | 中文模型套英文，掉点 |
| LongMemEval-S 12 | bge-base-zh-v1.5 q8 | rrf | 41.7% | 50.0% | 0.470 | 噪声向量被 RRF 放大 |
| LongMemEval-S 12 | multilingual-e5-small q8 | weighted | **75.0%** | **83.3%** | **0.806** | 与词法持平，英文掉点解决 |
| LongMemEval-S 12 | multilingual-e5-small q8 | rrf | 58.3% | 75.0% | 0.646 | RRF 不是万能；英文反而伤 |

> 早期记录过 `zh-holdout` 向量 R@5 58.3%，那是评测脚本没有先 `await store.embedQueue` 导致的欠采样；修正后同一 `bge-base-zh` weighted 为 83.3%。不要把旧数字当模型上限。
>
> 结论：
> - **中文/混合语言**：`multilingual-e5-small` 明显强于 `bge-base-zh`（`zh-holdout` R@5 100% vs 83.3%）。
> - **英文**：`bge-base-zh` 会掉点；换 `multilingual-e5-small` 后 weighted 与词法持平（R@5 83.3%）。
> - **融合**：默认 `weighted`；`rrf` 只在向量排名本身可靠时有用，英文上反而从 83.3% 掉到 75%，不要默认开。
> - 这些是 12/48 题的小样本，不能替代全量 LongMemEval 或 LLM 判分。

### 向量路径复跑

```bash
# 中文/混合：multilingual-e5-small（384 维，约 118MB）
EMBED_MODEL=Xenova/multilingual-e5-small EMBED_DTYPE=q8 PORT=11436 node embed/server.mjs

DSH_CONTEXT_HUB_EMBED_URL=http://127.0.0.1:11436/v1 \
DSH_CONTEXT_HUB_EMBED_MODEL=multilingual-e5-small \
DSH_CONTEXT_HUB_FUSION=weighted \
node scripts/eval/recall.mjs --dataset scripts/eval/zh-holdout.json

# 英文 LongMemEval 子集
DSH_CONTEXT_HUB_EMBED_URL=http://127.0.0.1:11436/v1 \
DSH_CONTEXT_HUB_EMBED_MODEL=multilingual-e5-small \
node --max-old-space-size=8192 scripts/eval/recall.mjs --format longmemeval \
  --dataset /path/to/longmemeval_s_cleaned.json --limit 12 --fusion weighted
```

换模型必须重建向量；不同模型向量不可比。`embed/server.mjs` 支持 `EMBED_MODEL=/abs/path` 本地模型目录。

## 本机复跑（1.5.4，2026-11-26）

环境：本机 CPU（Node 24）、`embed/server.mjs` + `Xenova/multilingual-e5-small` q8（384 维，118MB，SHA-256 `f80102d3…`），`fusion=weighted`，无 query prefix。

| 数据集 | 词法 R@5 | 向量 R@5 | 向量 R@1 | MRR | p50 |
| --- | --- | --- | --- | --- | --- |
| `zh-holdout`（12 题） | 25% | **100%** | 66.7% | 0.799 | 5ms |
| 30 条改写探针 | 13.3% | **80%** | 53.3% | — | 5.6ms |

对比：同探针 bge-small 56.7%、bge-m3+中文前缀 66.7%（见 CHANGELOG 1.5.4）。e5 的代价是英文上不如中文明显（LongMemEval 子集与词法持平），且模型要求 `query:`/`passage:` 前缀时需额外配置。

autoStart 复跑注意：profile 里要同时写 `embedding.dtype: q8`，否则插件拉起的服务会用 fp32 去找 `model.onnx`（1.5.4 起透传）。

## 诚实边界

- 数据集小、部分自建，不能替代第三方评测。
- 词法/向量/改写/重排的消融必须同数据集、同预算；关闭任一路径要能复现。
- `probe` 是“从已有记忆自造查询”，只能发现明显退化，不能证明泛化。
