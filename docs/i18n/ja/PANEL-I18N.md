[Chinese](../../../PANEL-I18N.md) · [English](../en/PANEL-I18N.md) · **日本語** · [한국어](../ko/PANEL-I18N.md) · [Deutsch](../de/PANEL-I18N.md) · [Français](../fr/PANEL-I18N.md) · [Español](../es/PANEL-I18N.md)

# パネルの言語切替

パネルは実行中に言語を切り替えられます。選択はブラウザごとに記憶され、記憶ストアにも同期されます。

## 概要

- 7 言語：zh / en / ja / ko / de / fr / es。
- `auto` はブラウザの言語（`navigator.language`）に従います。
- パネルの本文・表・ボタン・ツールチップがすべて切り替わり、再読み込みは不要です。

## 手順

1. パネルを開く（サイドバー下部のバッジ、または Esc）。
2. **言語** タブをクリック。
3. 言語を選ぶと即座に再描画されます。
4. 選択は `localStorage` に保存され、対応していれば記憶ストアにも書き込まれます。

## 特長

- 即時反映：状態駆動のため再読み込みも DSH 再起動も不要。
- 永続化：`localStorage` の `context-hub.locale` と SQLite の `config:locale`。
- 段階的フォールバック：未知のキーは英語 → 中国語の順に落ちます。
- 子コンポーネント（表・凡例・ボタン）も同じ言語を参照します。

## コマンドライン

```bash
/context-hub locale            # 現在の言語と一覧
/context-hub locale ja         # 日本語に切替
/context-hub locale auto       # システム言語に従う
```

## 対応言語

| コード | 言語 | 語彙数 |
| --- | --- | --- |
| zh | 简体中文 | 257/257 |
| en | English | 257/257 |
| ja | 日本語 | 257/257 |
| ko | 한국어 | 257/257 |
| de | Deutsch | 257/257 |
| fr | Français | 257/257 |
| es | Español | 257/257 |

## 保存場所

- ブラウザ：`localStorage["context-hub.locale"]`。
- サーバ：記憶ストアの `kv` テーブル、キー `config:locale`。
- テスト：`npm run test:panel-i18n` が 7 言語 × 5 タブを実際に描画して検証します。

## トラブルシューティング

- 変わらない：キャッシュされた JS を捨てるため強制再読み込み（`Ctrl+Shift+R`）。
- パネル自体が出ない：クライアントの構文エラーでバンドルが登録されていません。`node --check client/client.js` を実行してください。
- 再起動後に戻る：実行中のプラグインが対応していないと `config:locale` は書かれません。更新後に DSH を再起動してください。

## 関連

- [README](README.md)
- [COMPATIBILITY](COMPATIBILITY.md)
- 語彙データ：`scripts/locale-data/*.json`
