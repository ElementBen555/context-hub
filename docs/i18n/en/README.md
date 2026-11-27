[Chinese](../../../README.md) · **English** · [日本語](../ja/README.md) · [한국어](../ko/README.md) · [Deutsch](../de/README.md) · [Français](../fr/README.md) · [Español](../es/README.md)

# dsh-context-hub · Context Hub

One plugin that packs **compaction, memory and insight** into a single DSH bundle: install once, no host-side build (plain ESM JavaScript), data stored in local SQLite.

> Documentation index:
> - [docs/spec.md](../../spec.md) — feature spec v1.0 (frozen; gap table updated per release): compaction watermark, memory standards/scopes/conflicts/governance, observability dimensions, parameter table, acceptance criteria
> - [docs/design.md](../../design.md) — current architecture, data flow, storage layout, DSH contracts, failure modes and roadmap (Chinese)
> - [docs/comparison.md](../../comparison.md) — six-way comparison with billion-context / dsh-memory / OpenViking / graph-memory / dsh-mnemon, W1–W8 weaknesses and the five-dimension reinforcement plan (Chinese)
> - [docs/EVAL.md](../../EVAL.md) — recall evaluation harness, R@k / MRR definitions, zh-holdout and LongMemEval usage
> - [docs/COMPATIBILITY.md](COMPATIBILITY.md) — version compatibility matrix
> - [docs/PANEL-I18N.md](PANEL-I18N.md) — panel language switching
> - [docs/ROADMAP.md](../../ROADMAP.md) — reinforcement roadmap (P0 eval / P1 graph / P2 compaction ledger / P3 scale / P4 CI / P5 npm / P6 multi-platform)

## Why one instead of three

In DSH these three things are three stages of the same context pipeline:

- **Memory** decides *what should be carried into a new session*;
- **Compaction** decides *what to drop and what to keep when the current session no longer fits*;
- **Insight** decides *how you know the first two are doing the right thing*.

They share one store, one injection channel (`agent.inject()`) and one retrieval entry point. Splitting them into three plugins only duplicates work and makes them fight each other.

## Capabilities

| Capability | Implementation | Entry point |
| --- | --- | --- |
| Memory | `turn/end` extracts structured memories with the session's current model; items passing the five-dimension quality gate are written to SQLite | automatic + `context_hub_remember` |
| Recall | On each user message, hybrid scoring over keywords + FTS5 trigram (synonym expansion + scope weighting + time decay), optionally combined with vector cosine; injected into the next step (marked as reference-only) | automatic + `context_hub_search` |
| Retrieval quality | `context_hub_probe` builds its own queries to measure top-k hit rate; `context_hub_explain` shows per-item scoring details | `context_hub_probe` / `context_hub_explain` |
| Governance | session/project/global tiers, TTL archiving, capacity eviction, conflict supersede | automatic |
| Compaction | Reuses DSH native compaction; with `compactor: hub` it wraps `summarize()` on the instance (8-section prompt, falls back on failure) | `/context-hub compact`, `/context-hub compactor` |
| Compaction summaries as memories | Listens to `compaction/summary`; summaries are stored as `kind=summary` (session) and can be recalled/probed later | automatic + `context_hub_search` |
| Folded-region search | Scans the full session log (including folded regions) | `context_hub_history` |
| Folded-region restore | Re-injects original text for a seq range into the next step (character budget) | `context_hub_restore` / `/context-hub restore` |
| Summary-range decompress | Replays the original messages behind the latest compaction summary (or a summary id) (default 8000 chars) | `context_hub_decompress` / `/context-hub decompress` |
| Message-level reversible unfold | `unfold` on a compaction summary: for the next N steps the pre-step substitutes the original text for the summary node (changes the model request only, never the session log) | `context_hub_unfold` / `/context-hub unfold` |
| Hard budgets | A single recall injection is bounded by a token cap (default 1200) and a total deadline (default 4000 ms); on timeout nothing is injected and a `recall-timeout` event is logged | automatic |
| Project identity | Normalizes the git `origin` into `git:host/owner/repo` (consistent across machines); on first resolution old cwd rows are migrated | automatic |
| Insight | Context surface/total tokens, composition breakdown, output reserve, watermark, folded regions, last compaction, latest request samples + memory composition + message index + cost curve | `/context-hub status`, sidebar badge + centered overlay |
| Audit | Soft delete, explicit supersede, audit chain, observation log, JSON export | `/context-hub forget/supersede/audit/log/export` |
| Memory relations | `memory_links` edges (related/supersedes); recall expands one hop, ≤1 item | automatic + visible in `explain` |
| Message index | Separate `messages` + `messages_fts`; indexed incrementally before recall; recall by original text even with zero memories | automatic + message candidates in `explain` |
| Review flow | With `reviewPending=true`, low-confidence extractions go to pending first; approve/reject manually | `/context-hub review` |

## Installation

```bash
# npm registry (available from 1.8.0; slim package without embed dependencies)
# plugin_manager install_bundle(target="dsh-context-hub@1.8.0")

# Distribution tarball (includes embed/node_modules; recommended for other machines; must be an absolute .tgz path)
# plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-<version>.tgz")

# Or install from a local directory (development)
# plugin_manager install_bundle(target="/absolute/path/to/context-hub")
```

`dsh-context-hub` was published to npm on 2026-11-27 (public, first version 1.7.4): https://www.npmjs.com/package/dsh-context-hub . The npm package is slim (about 280 kB, without `embed/node_modules`); to use local vectors, run `cd embed && npm install --ignore-scripts` in the install directory, or use the dependency-bundled tarball from `scripts/pack.sh` / `git clone`.

After installation the profile `package.json` gains a dependency and a bundle entry, and `cordis.patch.yml` gets `id: dsh-context-hub` inserted.

Reload after editing sources (no reinstall needed):

```
plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)
```

> Note: `parameters` / `output.schema` of `ctx.tools.register` must be standard JSON Schema (arrays such as `required: [...]` on objects). Per-property `required: true` is the `defineTool` shortcut and is normalized only there.

## Verified

- **1.8.0**: all P1/P2 reinforcement tasks completed (A1/A3/A4/B5/C4/C5/E4/A5/E3/E5/D4/D5); 5 new commands (export-jsonl/import-jsonl/graph/timeline/conflicts), JSONL export/import, memory views, compatibility doc.
- **1.7.4**: panel compactor switchable native ⇄ hub and persisted, failures return 409; smoke covers route and snapshot.
- **1.7.3**: recall stage timing review (rerank 97% of latency); `rerank.reasoningEffort=low` cuts 30%; new `docs/PERF.md`.
- **1.7.2**: recall stage timings logged; short queries skip rewrite; rerank default candidates 6; `node test-smoke.mjs` → `SMOKE OK`.
- **1.7.1**: search cache (invalidated on write) + startup entity backfill + rerank empty-output retry / strong-head skip; panel graph chips and ledger details; `SMOKE OK`.
- **1.7.0**: graph 1-hop (automatic entity/edge extraction, ≤2 items on recall) and compaction ledger (fold count/savings/re-ask rate); `SMOKE OK`.
- **1.6.6**: 100k memories + 20k messages: rank p50 **85.6 ms / p95 99.8 ms / p99 106.6 ms**, DB 67 MB, RSS 249 MB; see [`docs/SCALE.md`](../../SCALE.md).
- **1.6.2**: vendored-deps tarball from `scripts/pack.sh`: 3,196 files / 157,534,812 bytes, SHA-256 `fdd5f16b…`.
- **1.6.0**: recall injection token cap/timeout bypass, git project identity (with old-row migration), message-level unfold — all smoke-asserted.
- **1.5.3**: `multilingual-e5-small` brings zh-holdout R@5 to 100%; English LongMemEval 12 questions reaches 83.3% (on par with lexical); `mode takeover/full` keeps the last 5 turns by default.
- Earlier versions (0.1.0 → 1.5.2) are listed in the Chinese README and in [`CHANGELOG.md`](../../../CHANGELOG.md).

## Usage

```
/context-hub status                  # insight: context pressure / folded regions / memory store
/context-hub doctor                  # self-check: FTS5/vector/rewrite/rerank capabilities and tier
/context-hub mode [observe|assist|takeover|full]  # takeover levels
/context-hub decompress [id:<n>|startSeq] [endSeq]  # replay original text behind a summary range
/context-hub search <keyword>        # search long-term memory
/context-hub remember <content>      # write one memory manually
/context-hub history <keyword>       # search the full session log (including folded regions)
/context-hub restore <startSeq> [endSeq]  # restore folded text and inject it into the next step (4000 chars)
/context-hub unfold [id:<n>|startSeq] [endSeq] [steps:<n>]  # unfold a compaction summary for the next N steps
/context-hub explain <keyword>       # recall debug: candidates, scoring details, rejection reasons
/context-hub probe [n]               # recall hit-rate probe (default 10)
/context-hub log [n]                 # observation event timeline (recall/extract/compact)
/context-hub audit <id>              # audit chain: status, confidence, evidence, successor
/context-hub forget <id>             # soft delete (audit chain kept)
/context-hub supersede <id> <new>    # explicit replacement keeping the supersede chain
/context-hub export                  # export memories and events snapshot (JSON, 0600)
/context-hub compact                 # trigger native compaction now
/context-hub compactor <hub|native>  # switch compactor at runtime (falls back to native)
/context-hub reembed                 # recompute all vectors (after a model change)
/context-hub watermark [on|off]      # compaction watermark switch (persisted)
/context-hub config [key] [value]    # view/change recall budget, TTL, extraction, conflict, semantic toggles
/context-hub review                  # pending list (when reviewPending is on)
/context-hub review approve <id>     # only approved items are recalled
/context-hub review reject <id>      # reject (soft delete, audit chain kept)
/context-hub locale [auto|zh|en|ja|ko|de|fr|es]  # switch panel/command language
```

Panel: after refreshing the web page, the sidebar footer shows a badge ("ring + context percentage", with an amber dot when items are pending). Clicking it opens a 640 px card with a fixed KPI header (pressure ring + surface/total/nodes/output reserve) and four tabs: **Overview** (composition bar + segment table, cost curve sparklines, top-5 activity; a "review" callout appears when items are pending), **Memory** (active/pending/superseded/archived/message-index tiles, scope/type bars + type donut, recent table, approve/reject), **Observe** (context detail, full activity, recent requests with recall lanes), **Config** (recall budget / memory TTL / extraction & conflict steppers, semantic recall toggles, watermark switch, compactor and mode switches, capability chips; changes are written to the memory store and take effect immediately). There is also a **Language** tab. Esc or clicking the backdrop closes it; it refreshes every 10 s; colors follow DSH theme tokens (`--dsw-alias-*`), light/dark adaptive.

![Panel preview](../../panel-preview.png)

Data comes from the host route `/api/context-hub.status` (authenticated by the `connection` service; unauthenticated requests get 401); watermark toggles use `POST /api/context-hub.watermark`, writes use `POST /api/context-hub.review` and `POST /api/context-hub.action`.

Model-side tools: `context_hub_search`, `context_hub_remember`, `context_hub_history`, `context_hub_restore`, `context_hub_decompress`, `context_hub_unfold`, `context_hub_status`, `context_hub_doctor`, plus read-only diagnostics `context_hub_explain`, `context_hub_log`, `context_hub_probe` and `context_hub_abtest`. A/B notes in [docs/ab-compactor.md](../../ab-compactor.md); recall benchmarks in [docs/EVAL.md](../../EVAL.md).

## Configuration

Defaults live in `defaults` in `src/index.js` and can be overridden by plugin config or environment variables:

| Option | Default | Range |
| --- | --- | --- |
| `recallMaxItems` / `DSH_CONTEXT_HUB_RECALL_ITEMS` | 8 | 1–20 |
| `recallMaxChars` / `DSH_CONTEXT_HUB_RECALL_CHARS` | 1800 | 200–8000 |
| `recallCooldownTurns` | 6 | 0–20 |
| `recallMaxTokens` / `DSH_CONTEXT_HUB_RECALL_TOKENS` | 1200 | 100–4000; hard token cap per recall injection (~1.6 chars/token for Chinese) |
| `recallTimeoutMs` / `DSH_CONTEXT_HUB_RECALL_TIMEOUT_MS` | 4000 | 0–20000; total recall deadline, nothing injected on timeout |
| `projectIdentity` / `DSH_CONTEXT_HUB_PROJECT_IDENTITY` | `git` | `git` (normalized origin) / `cwd` (absolute path) |
| `sessionTtlDays` / `DSH_CONTEXT_HUB_SESSION_TTL_DAYS` | 7 | 3 / 7 / 15 / 30 |
| `projectTtlDays` | 90 | 0–3650 (0 = never expires) |
| `globalTtlDays` | 0 | 0–3650 (0 = permanent) |
| `capacityPerScope` | 5000 | 100–100000 |
| `extractPassesPerTurn` / `DSH_CONTEXT_HUB_EXTRACT_PASSES` | 2 | 1–10 |
| `extractTimeoutMs` / `DSH_CONTEXT_HUB_EXTRACT_TIMEOUT_MS` | 60000 | 5000–300000; aborts the extraction and releases the latch |
| `admissionThreshold` | 0.6 | 0–1 |
| `conflictPolicy` / `DSH_CONTEXT_HUB_CONFLICT_POLICY` | `evidence` | `evidence` / `recency` |
| `compactor` / `DSH_CONTEXT_HUB_COMPACTOR` | `native` | `native` / `hub` (falls back to native; see [docs/compactor.md](../../compactor.md)) |
| `mode` / `DSH_CONTEXT_HUB_MODE` | `auto` | `auto` / `observe` / `assist` / `takeover` / `full`; explicit modes combine compactor and watermark and are persisted |
| `reviewPending` / `DSH_CONTEXT_HUB_REVIEW=1` | false | When on, extractions with confidence <0.8 go to pending and need `/context-hub review approve` |
| `embedding.enabled` | false | Adds vector cosine; auto-enabled when `baseUrl` or `DSH_CONTEXT_HUB_EMBED_URL` is set |
| `embedding.baseUrl` / `DSH_CONTEXT_HUB_EMBED_URL` | empty | OpenAI-compatible endpoint, with or without the `/embeddings` suffix |
| `embedding.model` / `DSH_CONTEXT_HUB_EMBED_MODEL` | empty | Model name required by the endpoint |
| `embedding.dtype` / `DSH_CONTEXT_HUB_EMBED_DTYPE` | `fp32` | Use `q8` for quantized models; passed as `EMBED_DTYPE` when auto-starting `embed/server.mjs` |
| `embedding.autoStart` / `DSH_CONTEXT_HUB_EMBED_AUTOSTART` | true | Loopback only: spawn `embed/server.mjs` when the service is not running; set `0` to disable |
| `embedding.apiKeyEnv` | `DSH_CONTEXT_HUB_EMBED_KEY` | Env var holding the bearer key; empty means no Authorization header |
| `embedding.minScore` | 0.35 | 0–0.95; cosine below this is ignored |
| `embedding.fusion` / `DSH_CONTEXT_HUB_FUSION` | `weighted` | `weighted` (vector bonus) / `rrf` (rank fusion); `weighted` recommended for English |
| `embedding.timeoutMs` | 1500 | 200–15000; on timeout degrades to keywords + FTS5 |
| `rewrite.enabled` / `DSH_CONTEXT_HUB_REWRITE=1` | false | Each new query is expanded once by a small model; falls back to the original query |
| `rewrite.provider` / `model` | empty (agent route) | Rewrite model route; `maxTokens` 1200 (empty output retries with a larger budget), `timeoutMs` 12000, `cacheSize` 128 |
| `watermark.enabled` / `DSH_CONTEXT_HUB_WATERMARK=1` | false | Pre-step selects a region by watermark and compacts via native `compactRegion`; panel/command switches persist to the memory store |
| `watermark.retainTurns` / `DSH_CONTEXT_HUB_RETAIN_TURNS` | 0 | 0–20; when >0 keep the last N user turns and fold only the oldest prefix; `mode takeover/full` defaults to 5 |
| `watermark.triggerRatio` | 0.7 | 0.3–0.95, trigger when pressure reaches it |
| `watermark.retainTokens` | 20000 | 2000–200000, tail tokens kept while compacting |
| `watermark.cooldownTurns` | 1 | 0–20, minimum turns between two watermark compactions |
| `unfold.steps` | 3 | 1–20; steps covered by one unfold |
| `unfold.maxChars` | 8000 | 1000–20000; per-step original-text budget replacing the summary |
| `embedding.queryPrefix` | empty | Optional query-side instruction prefix (some BGE models suggest it; measured worse on base, off by default) |
| `rerank.enabled` / `DSH_CONTEXT_HUB_RERANK=1` | false | Optional LLM rerank of recall candidates (one extra hop; falls back to original order) |
| `rerank.provider` / `model` | empty (agent route) | Rerank model; `candidates` 10 (3–30), `timeoutMs` 8000 |

To configure an installed entry, add `config:` to its item in `cordis.patch.yml` (`insert:` is only for initial bundle installation):

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
      enabled: true          # semantic rewrite: small model expands synonyms, falls back on failure
    watermark:
      enabled: true          # watermark takeover: pre-step region compaction (experimental)
      triggerRatio: 0.7
      retainTokens: 20000
```

### Local embedding service (bundled)

If you do not want to send memory text to an external API, use the bundled `embed/` directory — an OpenAI-compatible local service (transformers.js + ONNX CPU):

> **The repository already vendors `embed/node_modules/`** (about 475 MB; the vendored onnxruntime covers linux x64/arm64, win32 x64/arm64, darwin arm64 (no darwin x64), sharp only ships linux x64 binaries, so out of the box it works on Linux x64). Model weights are not vendored (`embed/.cache/`, currently e5-q8 ≈ 118 MB, directory ≈ 134 MB) and are downloaded on first start, or you can copy an existing `.cache` for offline use. Only the npm package (without `node_modules`) needs the step below.

**Offline model bundle**: the release asset `dsh-context-hub-models-e5-q8.tar.gz` (about 84 MB) contains the `multilingual-e5-small` q8 weights; extract it into the cache directory for offline use:

```bash
tar -xzf dsh-context-hub-models-e5-q8.tar.gz -C embed/.cache
# yields embed/.cache/Xenova/multilingual-e5-small/
```

**Do I still need `npm install`?**

| How you got it | Contains `embed/node_modules/` | Still need `npm install`? |
| --- | --- | --- |
| `git clone` of this repo | yes (vendored) | no |
| tgz from `scripts/pack.sh` (since 1.6.2) | yes | no |
| npm package / early tgz without deps | no | yes: `cd embed && npm install --ignore-scripts` |

> `npm pack` / `npm publish` always exclude `node_modules`, so use `scripts/pack.sh` (`git archive`) for dependency-bundled tarballs.

```bash
cd embed
npm install --ignore-scripts      # npm package only: transformers.js + onnxruntime (~475 MB)
./start.sh                        # manual start: 127.0.0.1:11434, log embed.log
curl -s localhost:11434/health    # {"ok":true,...,"ready":true}
```

**Usually you do not start it manually**: when `embedding.baseUrl` points to a loopback address and `embedding.autoStart` is true (default), the plugin notices the service is not running, spawns a detached `embed/server.mjs`, polls `/health` until ready and then backfills vectors, logging `embedding-start` / `embedding-ready` / `embedding-start-error` events; failures only degrade.

Model files live in `embed/.cache/Xenova/<model>/` (first request downloads from hf-mirror: bge-small-zh-v1.5 ≈ 95 MB, multilingual-e5-small q8 ≈ 118 MB). **Model choice**: `multilingual-e5-small` (q8) is recommended for Chinese/mixed content; `bge` models are smaller alternatives; `fusion` defaults to `weighted`, try `rrf` only when vector ranking is reliable. To change model: update `embedding.model`, stop the old service (`embed/stop.sh`) and reload; the plugin clears stale vectors when the model changes.

## Distribution and release

- `package.json`: `files` covers `src`, `client`, `cordis.patch.yml`, `locale`, `icon.svg`, `README.md`, `LICENSE`, `CHANGELOG.md`, `docs`, `scripts`, `test-smoke.mjs`, `embed/` (with `node_modules`); `exports` adds `./locale/*.json` and `./icon`; `publishConfig.access=public`.
- Display metadata: `locale/en.json` / `locale/zh.json` provide `meta.title` and `meta.description`; `icon.svg` is a 610 B original SVG (limit 256 KiB).
- Two packaging modes: `npm pack` (slim, 35 files, ~291 kB, without `embed/node_modules`) and `scripts/pack.sh` (`git archive`, with vendored deps, ~157 MB).
- Release status (2026-11-27): **npm 1.8.0 published** (public, slim ≈ 280 kB).
- Distribution tarballs: the latest `dist/dsh-context-hub-*.tgz` (version, file count, bytes and SHA-256 as recorded in `dist/INSTALL.md` at release time).
- Release command: `npm_config_cache=$PWD/.npm-cache npm publish --access public` (needs a granular token with 2FA bypass).

## Data

- Default path: `$DSH_HOME/context-hub/memory.db` (`~/.dsh` when `DSH_HOME` is unset).
- Override: environment variable `DSH_CONTEXT_HUB_DB=/path/to/memory.db`.
- Memory is a **derived cache**: the session log is the only source of truth; a corrupted or deleted database never stops the session.

## Design boundaries (current version)

- Does not replace the compaction service by default: with `compactor: native` native compaction is still provided by `compaction-basic`, and the plugin only triggers and indexes; with `compactor: hub` it wraps `summarize()` on the instance (no service re-registration, falls back on failure); see [docs/compactor.md](../../compactor.md).
- The panel only writes governance, switches and budget parameters (forget/supersede/review/watermark/compactor/mode/recall items·chars·cooldown·cap·timeout/TTL/extract passes/conflict policy/vector·rewrite·rerank toggles). It does not edit memory content; context data is read-only and never written back to the session.
- No custom session event types: only existing `user/message` and `turn/end` events drive behavior.
- Recall is keyword overlap (Chinese bigrams + Latin words) + FTS5 trigram bonus, optionally combined with **vector cosine** (0.8.0, OpenAI-compatible endpoint) and **LLM query rewrite** (1.2.0, off by default, falls back); an 18-group built-in synonym table acts as fallback. Any of FTS5/vector/rewrite being unavailable degrades automatically without affecting the main path.
- Watermark switch: the panel config area has an on/off button, equivalent to `/context-hub watermark on|off`; the state is stored in the memory store `kv` and survives restarts.
- Compaction is delegated to native by default: `compactor: hub` only swaps the summary prompt; with `watermark.enabled: true` (off by default) the plugin selects a region in pre-step via `triggerRatio` + `retainTokens`/`retainTurns` and calls native `compactRegion`, folding only the oldest prefix; failures are logged and handed back to native thresholds.
- Recall caps and timeouts: `recallMaxTokens` bounds the injection size, `recallTimeoutMs` bounds the total deadline; rewrite/rerank/vector only run within the remaining time, and it is better to inject nothing than to exceed the deadline.
- Message-level `unfold` only substitutes the compaction summary node on the surface during pre-step (`source.kind === 'compact-checkpoint'`), never touching the session log; the summary returns once the steps are used up.
- Extraction failures only log `logger.warn` and never block the session.

## Roadmap

Delivered (newest first):

- **1.8.0**: 12 P1/P2 reinforcements (deterministic writes, conflict classification, layered review, query hygiene, compaction receipts, summary quality loop, honest metrics, near-duplicate detection, memory views, JSONL export/import, compatibility doc, portability).
- **1.7.0**: graph 1-hop and compaction ledger.
- **1.6.0**: recall token cap + timeout bypass, git project identity, message-level unfold.
- **1.5.x**: panel rebuild (KPI header + four tabs), independent message index, multilingual-e5-small, watermark retainTurns, takeover modes.
- **1.4.0**: panel graphical/table rework.
- **1.3.x**: local embedding service moved into `embed/`, panel visual refresh, collapsible "recently used".
- **1.2.x**: LLM query rewrite, watermark takeover, persisted watermark switch.
- **1.1.x**: local embedding service, restore tool, recall benchmark.
- **1.0.0**: memory relations, review flow, export v2.
- **0.9.0**: summaries as memories, per-request sampling.
- **0.8.0**: optional vector recall, SQLite WAL, 10k stress test.
- **0.7.0**: FTS5 hybrid retrieval, recall probe, cursor persistence.
- **0.6.0**: read-only panel.
- **0.5.0**: service-level compactor.
- Earlier history is in the Chinese README.

Not done / next:

- Five-dimension reinforcement plan in [docs/comparison.md](../../comparison.md) section 5.
- Semantic recall: Chinese zh-holdout R@5 100%, but English LongMemEval R@5 83.3% (on par with lexical) is still weak.
- Watermark takeover is off by default; try `retainTokens` in an idle session first.
- Rewrite/rerank/watermark thresholds still require profile or commands.
- Docs are translated for the four usage documents (README, UPGRADE-GUIDE, COMPATIBILITY, PANEL-I18N); design/spec/comparison remain Chinese.
