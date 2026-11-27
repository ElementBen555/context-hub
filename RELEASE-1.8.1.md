# dsh-context-hub 1.8.1 发布说明

> 发布日期：2026-11-27  
> 类型：功能更新（多语言）

## 亮点

- **面板 7 语言**：zh / en / ja / ko / de / fr / es，每种 257 词条，覆盖标题栏、五个标签页、表格表头、图例、按钮、空态与提示；`auto` 跟随浏览器语言。
- **即时切换**：面板「语言」标签选中即重绘，无需刷新或重启；偏好写入 `localStorage`（`context-hub.locale`），并尽力同步到记忆库 `config:locale`。
- **文档 6 语言**：README / UPGRADE-GUIDE / COMPATIBILITY / PANEL-I18N 各 6 份译文，位于 `docs/i18n/`；中文为权威源。

## 修复

- 语言切换无效：`snapshot.config` 缺 `locale` 字段且面板文案只读服务端值 → 改为客户端状态驱动 + 服务端兜底。
- 面板整块消失：语言页 `sections.push(...)` 少一个右括号，`client.js` 语法错误导致插件未注册。
- 词典回退顺序：目标语言 → 英文 → 中文。

## 安装

```bash
# npm（slim，72 文件；本地向量需 cd embed && npm install --ignore-scripts）
plugin_manager install_bundle(target="dsh-context-hub@1.8.1")

# 分发包（含 embed/node_modules，约 150MB）
plugin_manager install_bundle(target="/绝对路径/dist/dsh-context-hub-1.8.1.tgz")
```

## 产物

| 渠道 | 地址 | 校验 |
|------|------|------|
| npm | https://www.npmjs.com/package/dsh-context-hub/v/1.8.1 | shasum `7251bb4e…`，72 文件 |
| GitHub Release | https://github.com/ElementBen555/context-hub/releases/tag/v1.8.1 | sha256 `8e94d858…`，157,694,010 字节 |

## 回归入口

```bash
node test-smoke.mjs              # SMOKE OK
npm run test:panel-i18n          # PANEL I18N OK（7 语言 × 5 标签页）
npm run check:locales            # LOCALES IN SYNC（5 × 257）
npm run test:docs-i18n           # DOCS I18N OK（24 文件）
```
