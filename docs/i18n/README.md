# 文档多语言 / Documentation languages

本目录保存使用类文档的翻译版本。中文是权威源文件，其余语言为对应译文。

This directory holds translations of the usage documents. Chinese is the source of truth.

| 文档 / Document | en | ja | ko | de | fr | es |
| --- | --- | --- | --- | --- | --- | --- |
| README | [en](en/README.md) | [ja](ja/README.md) | [ko](ko/README.md) | [de](de/README.md) | [fr](fr/README.md) | [es](es/README.md) |
| UPGRADE-GUIDE | [en](en/UPGRADE-GUIDE.md) | [ja](ja/UPGRADE-GUIDE.md) | [ko](ko/UPGRADE-GUIDE.md) | [de](de/UPGRADE-GUIDE.md) | [fr](fr/UPGRADE-GUIDE.md) | [es](es/UPGRADE-GUIDE.md) |
| COMPATIBILITY | [en](en/COMPATIBILITY.md) | [ja](ja/COMPATIBILITY.md) | [ko](ko/COMPATIBILITY.md) | [de](de/COMPATIBILITY.md) | [fr](fr/COMPATIBILITY.md) | [es](es/COMPATIBILITY.md) |
| PANEL-I18N | [en](en/PANEL-I18N.md) | [ja](ja/PANEL-I18N.md) | [ko](ko/PANEL-I18N.md) | [de](de/PANEL-I18N.md) | [fr](fr/PANEL-I18N.md) | [es](es/PANEL-I18N.md) |

## 范围 / Scope

- 已翻译：README、UPGRADE-GUIDE、COMPATIBILITY、PANEL-I18N（4 份 × 6 语言）。
- 保持中文：`docs/design.md`、`docs/spec.md`、`docs/comparison.md`、`docs/EVAL.md` 等内部设计与评测文档。
- 面板与命令行的界面文案使用另一套词表：`scripts/locale-data/*.json`（见 [PANEL-I18N](../PANEL-I18N.md)）。

## 校验 / Verification

```bash
node scripts/docs-i18n-check.mjs
# DOCS I18N OK (24 files = 4 docs × 6 langs)
```

检查项：每个语言的 4 份文件齐全、首行语言切换器包含全部入口、二级标题数量与中文源一致（±1）、非日语版本不残留中文（语言名等专有名词除外）。

## 新增语言 / Adding a language

1. 在 `docs/i18n/<code>/` 下按中文源文件补 4 份译文；
2. 首行写语言切换器（照现有文件）；
3. 在 `scripts/docs-i18n-check.mjs` 的 `LANGS` 中加入该语言；
4. 运行校验脚本。
