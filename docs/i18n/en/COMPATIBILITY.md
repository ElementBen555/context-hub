[Chinese](../../../COMPATIBILITY.md) · **English** · [日本語](../ja/COMPATIBILITY.md) · [한국어](../ko/COMPATIBILITY.md) · [Deutsch](../de/COMPATIBILITY.md) · [Français](../fr/COMPATIBILITY.md) · [Español](../es/COMPATIBILITY.md)

# Compatibility and environment matrix

> Version: 2026-11-27 · corresponds to implementation **1.8.1**
> Purpose: state which DSH, Node.js and OS versions this plugin supports, and what degrades gracefully.

## 1. Core dependencies

| Dependency | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| DSH | 0.2.0 | latest 0.2.x | uses the `cordis` plugin system and the `compaction` service |
| Node.js | 22.13.0 | 22.x or 24.x LTS | needs `node:sqlite` and ESM |
| npm | 10.0 | 10.x / 11.x | only for installing dependencies |

## 2. Install methods

- **npm**: `npm install dsh-context-hub@<version>` (slim package, no `embed/node_modules`).
- **Source**: `git clone` + `npm install`; requires Node ≥22.13.
- **Offline tarball**: `scripts/pack.sh` output contains `embed/node_modules`, so no further install is needed.

## 3. OS support

| OS | Status | Notes |
| --- | --- | --- |
| Linux x64 | ✅ fully supported | vendored onnxruntime and sharp binaries available |
| Linux arm64 | ✅ supported | onnxruntime arm64 vendored; sharp arm64 not vendored |
| macOS arm64 | ⚠️ partial | onnxruntime available, no darwin x64; sharp missing |
| Windows x64 | ⚠️ partial | onnxruntime available; sharp missing |

The plugin itself is pure JavaScript and runs anywhere DSH runs; only the optional local vector service depends on native binaries.

## 4. DSH version compatibility

| DSH | Status |
| --- | --- |
| 0.2.x | ✅ supported (primary target) |
| < 0.2.0 | ❌ not supported (missing `compaction` API) |

## 5. Node.js version compatibility

| Node.js | Status |
| --- | --- |
| 22.13+ | ✅ required minimum (`node:sqlite` stability) |
| 24.x | ✅ tested |

## 6. Optional feature dependencies

| Feature | Requirement |
| --- | --- |
| Vector recall | OpenAI-compatible `/embeddings` endpoint, or the bundled `embed/` service |
| Query rewrite / rerank | any model route available to the agent |
| Compaction summaries | DSH `compaction` service (native) |

## 7. Known limitations

- The npm package is slim: local vectors need `cd embed && npm install --ignore-scripts`.
- The bundled `sharp` binary ships Linux x64 only; macOS/Windows users need to install dependencies themselves.
- `npm pack` excludes `node_modules`; use `scripts/pack.sh` for dependency-bundled tarballs.
- English semantic recall (LongMemEval R@5 83.3%) is on par with lexical retrieval, not better.

## 8. Upgrade path

1. Back up the memory store (`cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.bak`).
2. Replace the plugin (`plugin_manager install_bundle` or `npm install`).
3. Restart DSH so the server-side plugin reloads.
4. Verify with `dsh context-hub doctor` / `/context-hub doctor`.

Database schema changes are additive; no migration step is required.

## 9. Troubleshooting

- **401 on `/api/context-hub.status`**: the route is registered but the request is unauthenticated; the panel fetches from an authenticated page.
- **Panel missing**: client bundle syntax error; run `node --check client/client.js`.
- **`FTS5 unavailable`**: rebuild or upgrade SQLite; recall degrades to keyword scoring only.
- **Vector service not ready**: check `embed/embed.log` and `curl localhost:11434/health`.

## 10. Test coverage

- `node test-smoke.mjs` — server-side end-to-end (tools, commands, recall, extraction, compaction, routes).
- `npm run test:panel-i18n` — 7 languages × 5 panel tabs.
- `npm run check:locales` — word tables in sync with the client bundle.
- `node scripts/docs-i18n-check.mjs` — documentation localisation.
- `node scripts/stress.mjs` / `scripts/concurrency.mjs` — scale and concurrency.

## 11. Changelog

See [CHANGELOG.md](../../../CHANGELOG.md) and [RELEASE-1.8.0.md](../../../RELEASE-1.8.0.md).

## 12. Support scope

Community support through GitHub issues; no SLA. Include the output of `doctor`, DSH and Node.js versions and OS details when reporting.

## 13. Feedback

Open an issue at https://github.com/ElementBen555/context-hub/issues with reproduction steps and logs.
