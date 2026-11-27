[Chinese](../../../COMPATIBILITY.md) · [English](../en/COMPATIBILITY.md) · **日本語** · [한국어](../ko/COMPATIBILITY.md) · [Deutsch](../de/COMPATIBILITY.md) · [Français](../fr/COMPATIBILITY.md) · [Español](../es/COMPATIBILITY.md)

# 互換性と環境マトリクス

> 版：2026-11-27 · 実装 **1.8.1** に対応
> 目的：対応する DSH / Node.js / OS を明示し、劣化時の挙動を示します。

## 1. 主要な依存

| 依存 | 最小 | 推奨 | 説明 |
| --- | --- | --- | --- |
| DSH | 0.2.0 | 0.2.x 最新 | `cordis` と `compaction` サービスを使用 |
| Node.js | 22.13.0 | 22.x / 24.x LTS | `node:sqlite` と ESM が必要 |
| npm | 10.0 | 10.x / 11.x | 依存導入時のみ |

## 2. インストール方法

- **npm**：`npm install dsh-context-hub@<version>`（slim、`embed/node_modules` を含まない）。
- **ソース**：`git clone` + `npm install`（Node ≥22.13）。
- **オフライン tarball**：`scripts/pack.sh` の出力は `embed/node_modules` を含むため追加導入不要。

## 3. OS 対応

| OS | 状態 | 備考 |
| --- | --- | --- |
| Linux x64 | ✅ 完全対応 | onnxruntime と sharp のバイナリ同梱 |
| Linux arm64 | ✅ 対応 | onnxruntime arm64 同梱、sharp は未同梱 |
| macOS arm64 | ⚠️ 部分対応 | onnxruntime あり、darwin x64 なし、sharp なし |
| Windows x64 | ⚠️ 部分対応 | onnxruntime あり、sharp なし |

プラグイン本体は純 JavaScript のため DSH が動く環境ならどこでも動作します。ネイティブバイナリに依存するのは任意のローカルベクトルサービスのみです。

## 4. DSH バージョン互換性

| DSH | 状態 |
| --- | --- |
| 0.2.x | ✅ 対応（主対象） |
| < 0.2.0 | ❌ 非対応（`compaction` API なし） |

## 5. Node.js バージョン互換性

| Node.js | 状態 |
| --- | --- |
| 22.13+ | ✅ 必須の最小版（`node:sqlite` 安定版） |
| 24.x | ✅ 検証済み |

## 6. 任意機能の依存

| 機能 | 要件 |
| --- | --- |
| ベクトル検索 | OpenAI 互換 `/embeddings`、または同梱の `embed/` |
| クエリ書き換え / 再ランク | エージェントが利用できるモデル経路 |
| 圧縮要約 | DSH の `compaction` サービス（ネイティブ） |

## 7. 既知の制限

- npm パッケージは slim です。ローカルベクトルには `cd embed && npm install --ignore-scripts` が必要。
- 同梱の `sharp` は Linux x64 のみ。macOS/Windows では自身で依存導入が必要です。
- `npm pack` は `node_modules` を除外するため、依存込みは `scripts/pack.sh` を使ってください。
- 英語の意味検索（LongMemEval R@5 83.3%）は語彙検索と同等で、上回りません。

## 8. アップグレード手順

1. 記憶ストアをバックアップ（`cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.bak`）。
2. プラグインを差し替え（`plugin_manager install_bundle` または `npm install`）。
3. サーバ側プラグインを読み直すため DSH を再起動。
4. `/context-hub doctor` で確認。

DB スキーマの変更は追加のみで、移行作業は不要です。

## 9. トラブルシューティング

- **`/api/context-hub.status` が 401**：ルートは登録済みで未認証のためです。パネルは認証済みページから取得します。
- **パネルが出ない**：クライアントの構文エラー。`node --check client/client.js` を実行。
- **`FTS5 unavailable`**：SQLite を更新。検索はキーワードのみに劣化します。
- **ベクトルサービス未起動**：`embed/embed.log` と `curl localhost:11434/health` を確認。

## 10. テスト範囲

- `node test-smoke.mjs` — サーバ側の通し試験。
- `npm run test:panel-i18n` — 7 言語 × 5 タブのパネル。
- `npm run check:locales` — 語彙データとクライアントの同期。
- `node scripts/docs-i18n-check.mjs` — ドキュメントの多言語。
- `node scripts/stress.mjs` / `scripts/concurrency.mjs` — 規模と同時実行。

## 11. 変更履歴

[CHANGELOG.md](../../../CHANGELOG.md) と [RELEASE-1.8.0.md](../../../RELEASE-1.8.0.md) を参照。

## 12. サポート範囲

GitHub Issues によるコミュニティサポート（SLA なし）。報告時は `doctor` の出力、DSH と Node.js の版、OS 情報を添えてください。

## 13. フィードバック

https://github.com/ElementBen555/context-hub/issues に再現手順とログを添えて起票してください。
