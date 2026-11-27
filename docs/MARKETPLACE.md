# 市场收录与一键安装

> 版本：1.8.1 · 索引文件：`docs/market/index.json`（DSH 插件市场 format 1）

## 1. 一键安装

### 方式 A：npm（推荐）

```bash
plugin_manager install_bundle(target="dsh-context-hub@1.8.1")
```

slim 包（约 290 kB，72 文件），不含 `embed/node_modules`。需要本地向量时补一步：

```bash
cd <安装目录>/embed && npm install --ignore-scripts
```

### 方式 B：市场界面

1. 打开 DSH 的 **插件市场 / Discover**；
2. 「添加索引」填入本仓库的索引地址：

   ```
   https://raw.githubusercontent.com/ElementBen555/context-hub/main/docs/market/index.json
   ```

3. 搜索 `Context Hub`，点安装（市场会把 `dsh-context-hub@1.8.1` 交给 `plugin_manager`）。

> 市场索引来自用户配置的索引源（`pluginMarket.indexes`）。官方聚合索引若接受提交，按第 3 节清单提交即可。

### 方式 C：含依赖分发包（离线）

```bash
plugin_manager install_bundle(target="/绝对路径/dist/dsh-context-hub-1.8.1.tgz")
```

## 2. 索引文件

`docs/market/index.json` 由脚本生成，遵循 DSH 的市场索引格式 1：

| 字段 | 值 |
|------|----|
| `format` | `1` |
| `title` | Context Hub / 上下文中枢 |
| `metadata.categories` | memory、context |
| `metadata.labels` | compaction、observability、local-first |
| `plugins[].name` | `dsh-context-hub` |
| `plugins[].icon` | `data:image/svg+xml;base64,…`（610 B，上限 32 KB） |
| `plugins[].repository` | https://github.com/ElementBen555/context-hub |
| `plugins[].versions[]` | `1.8.1`、`1.8.0`（npm 源，按 SemVer 降序） |
| `versions[].engines` | `{}`（任意 DSH 版本；0.2.x 含预发布） |

`engines` 刻意留空：DSH 运行版可能是 `0.2.3-alpha.2` 这类预发布版本，SemVer 区间对预发布有特殊规则，留空等价「任意版本」，避免市场误判不兼容。

### 生成与校验

```bash
node scripts/build-market-index.mjs   # 从 package.json / locale / icon.svg / npm 发布时间生成
node scripts/verify-market.mjs        # 结构检查 + DSH 官方 parseMarketIndex + npm 版本存在性
```

校验输出示例：

```
note: DSH validator: /path/to/deepseek-harness
MARKET INDEX OK (DSH validator + structural, npm checked)
  versions: dsh-context-hub@1.8.1, dsh-context-hub@1.8.0
```

`verify-market.mjs` 在没有 DSH 源码的环境会退化为本地结构检查（索引格式、SemVer 降序、图标大小、分类/标签声明、npm 版本存在性）。

## 3. 提交到聚合 / 官方索引的清单

提交一个条目时，聚合方通常需要以下信息（均已就绪）：

| 项 | 内容 |
|----|------|
| 包名 | `dsh-context-hub` |
| 最新版 | `1.8.1`（npm public） |
| 标题 | Context Hub（`zh`：上下文中枢） |
| 描述 | `locale/en.json`、`locale/zh.json` 的 `meta.description` |
| 图标 | `icon.svg`（610 B）或索引内 `data:` URI |
| 仓库 | https://github.com/ElementBen555/context-hub |
| 首页 | 同上（README） |
| 分类 | memory |
| 标签 | compaction、observability、local-first |
| 兼容 | DSH 0.2.x（含预发布）、Node ≥ 22.13 |
| 依赖 | 无（`node:sqlite` 内置）；本地向量为可选 |
| 许可 | MIT |
| 安装 spec | `dsh-context-hub@1.8.1` |
| 校验 | `node test-smoke.mjs` → SMOKE OK；`npm run test:panel-i18n` → PANEL I18N OK |

## 4. 发布新版本后的索引更新

```bash
# 1) 升版本并发布
npm version <x.y.z> --no-git-tag-version
npm publish --access public --cache /tmp/npm-cache

# 2) 更新索引里的版本列表（脚本里的 VERSIONS 常量）
#    scripts/build-market-index.mjs: const VERSIONS = ['<x.y.z>', ...]

# 3) 生成 + 校验 + 提交
node scripts/build-market-index.mjs
node scripts/verify-market.mjs
git add docs/market/index.json && git commit -m "chore: 更新市场索引 <x.y.z>" && git push
```

推送后 raw 地址即时生效，市场客户端下次刷新索引即可看到新版本。

## 5. 常见问题

| 现象 | 原因与处理 |
|------|-----------|
| 市场里搜不到 | 索引源未添加，或 raw 地址不是 `main` 分支；用 `curl` 确认返回 JSON |
| 显示不兼容 | 索引 `engines.dsh` 被改成具体区间且运行版是预发布；恢复为 `{}` |
| 安装后无面板 | 刷新页面；仍无则 `node --check client/client.js`，再重启 DSH |
| 安装后无本地向量 | npm 包不含 `embed/node_modules`，按方式 A 的补充步骤安装 |
| `install_bundle` 404 | 索引里的版本与 npm 实际版本不一致，跑 `verify-market.mjs` 定位 |

## 6. One-command install (English summary)

```bash
plugin_manager install_bundle(target="dsh-context-hub@1.8.1")
```

Marketplace: add the index `https://raw.githubusercontent.com/ElementBen555/context-hub/main/docs/market/index.json`
in the Discover page, search "Context Hub", and install. The npm package is slim; for local vectors run
`cd <install-dir>/embed && npm install --ignore-scripts`.
