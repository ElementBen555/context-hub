# 发布清单（D2）

> 状态：**1.6.4 已提交、待打包/推送**。npm 账号到位后按本文执行发布。

## 0. 前置

- npm 账号已登录，且对 `dsh-context-hub` 有发布权限（当前 registry 查询为 404，名字未占用）。
- 2FA 可用（如账号开启）。
- 已确认版本号：`package.json` 的 `version`。
- 已确认 `private: false`，且 `dependencies` 里没有本包自依赖。

```bash
npm whoami
npm view dsh-context-hub version   # 期望 404（未占用）
```

## 1. 本地校验

在仓库根目录执行：

```bash
npm_config_cache=$PWD/.npm-cache npm pack --dry-run   # slim registry 包
node test-smoke.mjs
node scripts/eval/recall.mjs --dataset scripts/eval/zh-holdout.json
```

检查：

- `npm pack --dry-run` 为 30 文件 / 253,204 字节（1.6.4 实测），且包含 `src/`、`client/`、`cordis.patch.yml`、`locale/`、`icon.svg`、`docs/`、`scripts/eval/`。
- **`npm pack` 只产 slim registry 包**（强制排除 `node_modules`）；含 `embed/node_modules` 的分发包必须用 `npm run pack:dist`（见 §2）。
- `package.json` 的 `dependencies` 为空或只含真实外部依赖，没有 `file:../dist/*.tgz`。
- `node test-smoke.mjs` 输出 `SMOKE OK`。

## 2. 打包

在仓库根目录执行：

```bash
npm run pack:dist          # 等价于 bash scripts/pack.sh
# 产物：dist/dsh-context-hub-<version>.tgz（内含 embed/node_modules）
```

`pack.sh` 基于 `git archive HEAD`，**先提交再打包**，否则会把旧提交的内容打进新版本号。校验产物：

```bash
tar -tzf dist/dsh-context-hub-<version>.tgz | grep -c 'embed/node_modules/'   # 必须 > 0
tar -tzf dist/dsh-context-hub-<version>.tgz | grep -vc '/$'                  # 文件总数
sha256sum dist/dsh-context-hub-<version>.tgz
```

1.6.2 基线：3,196 文件 / 157,534,812 字节。记录文件数与 SHA-256，写入 `dist/INSTALL.md`。

## 3. 发布

```bash
npm publish --access public
npm view dsh-context-hub version
```

发布后验证第三方安装路径：

```bash
# 在干净 profile 中
plugin_manager install_bundle(target="dsh-context-hub@<version>")
```

或：

```bash
dsh plugin --profile <profile> add dsh-context-hub@<version>
dsh --profile <profile> --dump-config   # 应列出 dsh-context-hub
```

## 4. 市场

- 在 dshmarket 提交/刷新插件条目。
- 市场描述使用 `locale/en.json` / `locale/zh.json` 的 `meta.title`、`meta.description`；详情页回退 README。
- 确认 `icon.svg` ≤ 256 KiB，README 首屏有安装命令与截图。

## 5. 发布后自检

- `plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)` 后无 warnings。
- `/context-hub status` 显示「模式」「检索」「压缩」「记忆」。
- `/context-hub doctor` 输出档位与缺口。
- `context_hub_remember` → `context_hub_search` 立即命中。
- 浏览器面板：未认证 `/api/context-hub.status` 返回 401；已认证页面能打开胶囊与面板；待审核条目可 approve/reject。
- `node scripts/eval/recall.mjs --format longmemeval --dataset <path> --limit 48` 可复跑（数据不随包分发）。

## 6. 回滚

- 发现严重问题：`npm deprecate dsh-context-hub@<version> "reason"`，发补丁版本。
- 需要撤回：`npm unpublish dsh-context-hub@<version>`（谨慎；发布 72 小时后通常不可撤回）。
- 保留 tgz 与 SHA-256，便于离线回装。

## 7. 已知阻塞

- 本机 `npm whoami` 未登录；D2 未执行。
- B3 的 LongMemEval 数据集不随包分发，发布前不需要打包进 tarball。
