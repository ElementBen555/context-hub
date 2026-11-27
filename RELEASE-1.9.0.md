# dsh-context-hub 1.9.0 发布说明

> 发布日期：2026-11-27 · 类型：P0/P1 能力补强

## P0

- **推荐档一键落地**：`/context-hub doctor apply` 探测 `127.0.0.1:11434`，写入 `embedding.baseUrl/model` 并启用；e5 自动补 `query: ` / `passage: ` 前缀，必要时清旧向量重算。
- **英文召回**：纯拉丁查询向量优先排序（中文仍加权融合）。en-holdout R@5 75%→93.8%、R@10 100%、MRR 0.719→0.822；zh-holdout 保持 100%。
- **首次运行引导**：`status` 提示 + 面板「一键开启」提示条。

## P1

- 前缀缓存命中统计（`status` / 面板，来自宿主 usage）。
- 水位授权上限 `watermark.maxRegionTokens`（超限跳过并记 `watermark-skip`）。
- `/context-hub watermark undo` + 面板「撤销上次折叠」。
- 水位目标占用率 `watermark.targetRatio`（选区权增强，`planWatermarkRegion` 纯函数）。

## 产物

| 渠道 | 地址 | 校验 |
|------|------|------|
| npm | https://www.npmjs.com/package/dsh-context-hub/v/1.9.0 | slim，约 300 kB |
| GitHub Release | https://github.com/ElementBen555/context-hub/releases/tag/v1.9.0 | 附件 157,717,565 字节，sha256 `084856b1…` |
| 市场索引 | `docs/market/index.json`（1.9.0 / 1.8.1 / 1.8.0） | DSH `parseMarketIndex` 通过 |

## 安装

```bash
plugin_manager install_bundle(target="dsh-context-hub@1.9.0")
# 或离线包
plugin_manager install_bundle(target="/绝对路径/dist/dsh-context-hub-1.9.0.tgz")
```

## 回归

```bash
node test-smoke.mjs        # SMOKE OK
npm run test:panel-i18n    # PANEL I18N OK
npm run check:locales      # LOCALES IN SYNC
npm run test:docs-i18n     # DOCS I18N OK
npm run market:verify      # MARKET INDEX OK
```
