[Chinese](../../../UPGRADE-GUIDE.md) · [English](../en/UPGRADE-GUIDE.md) · **日本語** · [한국어](../ko/UPGRADE-GUIDE.md) · [Deutsch](../de/UPGRADE-GUIDE.md) · [Français](../fr/UPGRADE-GUIDE.md) · [Español](../es/UPGRADE-GUIDE.md)

# アップグレードガイド（→ 1.8.0）

> 任意の 1.x から 1.8.0 への更新に適用されます。

## 🚀 クイックアップグレード

```bash
# 配布 tarball（依存込み）
plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-1.8.0.tgz")
dsh restart
```

npm の場合は `npm install dsh-context-hub@1.8.0` の後に DSH を再起動します。

## 📋 事前確認

- 記憶ストアをバックアップ：`cp ~/.dsh/context-hub/memory.db{,.bak}`。
- Node.js ≥ 22.13、DSH 0.2.x を確認。
- 現在の版を確認：`/context-hub status`。

## ✨ 新機能ガイド

- **明示的な記憶シグナル**：「覚えて」「やらないで」「好み」「TODO」などは LLM を介さず即座に保存されます。
- **競合検出**：否定・数値変更・状態遷移を検出し supersede で関連付けます。
- **記憶ビュー**：`/context-hub graph <番号>`、`/context-hub timeline [scope]`、`/context-hub conflicts <番号>`。
- **JSONL 入出力**：`/context-hub export-jsonl` と `import-jsonl <パス>`（hash により冪等）。
- **言語**：`/context-hub locale [auto|zh|en|ja|ko|de|fr|es]`、パネルからも切替可能。

## 🔧 設定の更新

新しい項目：`reviewPolicy`（`off` / `low-confidence` / `layered`）、`locale`（`auto` または言語コード）。既存項目の既定値は変わらないため、設定変更は必須ではありません。

```yaml
- id: dsh-context-hub
  config:
    reviewPolicy: layered
    locale: auto
```

## 🐛 トラブルシューティング

- 更新後にパネルが出ない → 強制再読み込み。改善しない場合は `node --check client/client.js`。
- 言語が変わらない → サーバ側プラグインを読み直すため DSH を再起動し、ページを再読み込み。
- 記憶ストアが使えない → `$DSH_HOME/context-hub/memory.db` の権限を確認。記憶なしでも会話は継続します。

## 📊 性能への影響

| 操作 | 追加遅延 |
| --- | --- |
| 明示シグナルの書き込み | 約 0ms |
| 競合検出 | +50〜200ms |
| 段階的審査（LLM） | +200〜500ms |
| グラフ生成 | +500〜2000ms |

ベクトル検索の負荷は従来どおり（任意・既定オフ）。

## 🆚 バージョン比較

| 機能 | 1.7.x | 1.8.0 |
| --- | --- | --- |
| 明示シグナル | ❌ | ✅ |
| 競合検出 | ❌ | ✅ |
| グラフ / タイムライン / 競合 | ❌ | ✅ |
| JSONL 入出力 | ❌ | ✅ |
| 正直な検索指標 | ❌ | ✅ |
| パネルの多言語 | ❌ | ✅ 7 言語 |

## 📞 サポート

- `dsh context-hub doctor` の出力
- DSH と Node.js の版、OS
- ログ：`tail -n 50 ~/.dsh/logs/context-hub.log`
- Issues：https://github.com/ElementBen555/context-hub/issues

## 🎉 完了

更新後の確認：

```bash
/context-hub status
/context-hub doctor
/context-hub probe
/context-hub locale
```
