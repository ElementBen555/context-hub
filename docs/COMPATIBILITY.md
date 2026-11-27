# 兼容性与环境矩阵

> 版本：2026-11-27 · 对应实现 **1.7.5**
> 目的：明确本插件支持的 DSH 版本、Node.js 版本、操作系统与平台，便于用户评估升级风险与部署可行性。

---

## 1. 核心依赖

| 依赖 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| **DSH** | 0.2.0 | 0.2.x 最新 | 使用 `cordis` 插件系统与 `compaction` 服务注册 |
| **Node.js** | 22.13.0 | 22.x 或 24.x 最新 LTS | 需要 `node:sqlite`、`node:fs`、ES 模块支持 |
| **npm** | 10.0 | 10.x 或 11.x | 用于安装依赖（可选，见第 2 节） |

---

## 2. 安装方式与依赖

### 2.1 从 npm 安装（推荐）

```bash
npm install @your-scope/dsh-context-hub
```

**要求**：
- 有 npm 账号并已登录（`npm whoami`）
- 网络可访问 npm registry（或配置私有 registry）

### 2.2 从源码安装

```bash
git clone <repo-url>
cd dsh-context-hub
npm install
```

**要求**：
- Node.js ≥22.13.0
- npm ≥10.0
- 可选：Python 3.10+（仅当启用本地向量服务且需要编译某些 native 模块时）

### 2.3 离线安装（分发包）

使用 `scripts/pack.sh` 生成的 tgz 包：

```bash
npm install dsh-context-hub-<version>.tgz
```

**优势**：
- 包含 `embed/node_modules`，无需再次 `npm install`
- 适用于内网环境

---

## 3. 操作系统支持

| 操作系统 | 版本 | 状态 | 备注 |
|---------|------|------|------|
| **Ubuntu** | 22.04 / 24.04 | ✅ 完全支持 | 推荐 |
| **Debian** | 12 | ✅ 完全支持 | |
| **macOS** | 13+ (Ventura) | ✅ 完全支持 | Apple Silicon / Intel 均可 |
| **Windows** | 10 / 11 | ✅ 完全支持 | 推荐 WSL2 |
| **CentOS/RHEL** | 8+ | ⚠️ 测试通过 | 可能需要手动安装 glibc |
| **Alpine** | 3.18+ | ⚠️ 部分支持 | 需使用 musl 版本的 native 模块 |

---

## 4. DSH 版本兼容性

| DSH 版本 | compaction 服务 | cordis 插件系统 | 状态 | 备注 |
|---------|---------------|----------------|------|------|
| **0.2.0 - 0.2.x** | ✅ | ✅ | ✅ 完全支持 | 推荐 |
| **0.1.x** | ⚠️ 可能兼容 | ❌ | ❌ 不推荐 | 需手动适配插件注册 |
| **1.0+** | ? | ? | ⏳ 待测试 | 预计兼容，需验证 |

---

## 5. Node.js 版本兼容性

| Node.js 版本 | 状态 | 备注 |
|-------------|------|------|
| **22.13.0+** | ✅ 完全支持 | 最低版本 |
| **22.x** | ✅ 推荐 | 当前 LTS |
| **24.x** | ✅ 推荐 | 最新 LTS |
| **20.x** | ❌ 不支持 | `node:sqlite` API 不兼容 |
| **18.x** | ❌ 不支持 | 缺少 ES 模块特性 |

---

## 6. 可选功能依赖

| 功能 | 依赖 | 是否必需 | 说明 |
|------|------|---------|------|
| **FTS5 检索** | SQLite 编译时启用 FTS5 | 否 | 不可用时退回纯关键词 |
| **向量召回** | onnxruntime + 模型文件 | 否 | 关闭时只用词法 |
| **本地 embedding 服务** | Node.js + onnxruntime | 否 | 可改用外部 OpenAI 兼容端点 |
| **改写/重排** | LLM 端点配置 | 否 | 关闭时跳过这些步骤 |
| **面板** | DSH Web UI | 否 | 命令行工具不受影响 |

---

## 7. 已知限制

### 7.1 平台差异

| 平台 | 限制 | 解决方案 |
|------|------|---------|
| **Windows** | `chmod` 权限设置可能无效 | 不影响功能，仅日志警告 |
| **Alpine** | native 模块需 musl 版本 | 使用预编译包或自行编译 |
| **ARM64** | 部分 onnxruntime 模型需单独下载 | 参考 `embed/README.md` |

### 7.2 性能限制

| 场景 | 限制 | 建议 |
|------|------|------|
| **记忆数量** | 10 万条以下 p95 < 100ms | 超过 10 万建议分库 |
| **并发写入** | 单进程单连接 | 多实例需外部锁 |
| **向量召回** | 单次 ≤500 候选 | 调整 `recallMaxItems` |

---

## 8. 升级路径

### 8.1 从 1.6.x 升级到 1.7.x

```bash
# 1. 备份记忆库
cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.backup

# 2. 升级插件
npm install @your-scope/dsh-context-hub@latest

# 3. 重启 DSH
dsh restart

# 4. 验证功能
dsh context-hub doctor
dsh context-hub probe
```

**变更说明**：
- 数据库 schema 向后兼容，无需迁移
- 新增配置项有默认值，不影响现有配置
- FTS5 与向量索引自动重建（首次启动）

### 8.2 从 1.5.x 升级到 1.7.x

**注意**：
- 1.6.0 起引入 `entities` / `entity_links` 表，首次启动自动迁移
- 1.6.1 起 `session` 记忆按 `session_id` 隔离，旧数据自动适配
- 建议先升级到 1.6.x，再升级到 1.7.x

---

## 9. 故障排查

### 9.1 FTS5 不可用

**症状**：`context-hub doctor` 显示 "FTS5 不可用"

**原因**：SQLite 编译时未启用 FTS5

**解决**：
```bash
# 检查 SQLite 版本
sqlite3 --version

# 重装带 FTS5 的 SQLite（Ubuntu）
sudo apt install sqlite3 libsqlite3-dev

# 或使用包内 embed/ 服务
```

### 9.2 向量服务启动失败

**症状**：`context-hub doctor` 显示 "向量服务启动失败"

**原因**：onnxruntime 或模型文件缺失

**解决**：
```bash
cd embed
npm install --ignore-scripts
./start.sh
```

### 9.3 记忆写入失败

**症状**：写入记忆后 `audit` 看不到记录

**原因**：可能触发质量门槛或被去重

**解决**：
```bash
# 检查事件日志
dsh context-hub log | grep extract

# 显式写入绕过门槛
dsh context-hub remember "显式内容"
```

---

## 10. 测试覆盖

| 测试类型 | 命令 | 说明 |
|---------|------|------|
| **冒烟测试** | `npm test` | 核心功能断言 |
| **压力测试** | `npm run stress` | 10 万条记忆性能 |
| **并发测试** | `npm run concurrency` | 多进程写入 |
| **基准测试** | `npm run bench` | 召回延迟 p50/p95 |

---

## 11. 变更日志

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.7.5 | 2026-11-27 | 新增 JSONL 导出/导入、语义近邻去重 |
| 1.7.0 | 2026-11-27 | 新增图谱与压缩账本 |
| 1.6.0 | 2026-11-26 | 新增召回硬顶、git 项目身份、消息级 unfold |
| 1.5.0 | 2026-11-25 | P0 第一批：修包、证据粒度、推荐档、消息级召回 |

---

## 12. 支持范围

**本插件承诺支持**：
- 当前 DSH 0.2.x 最新小版本
- Node.js 22.x 和 24.x LTS
- Ubuntu 22.04/24.04、macOS 13+、Windows 10/11

**不在支持范围**：
- DSH 0.1.x 及更早版本
- Node.js <22.0
- 非主流 Linux 发行版（如 Arch、Fedora）需自行验证
- 多用户/远程部署（OpenViking 的领域）

---

## 13. 反馈与问题

遇到问题或有兼容性需求：

1. 查看 [issues](https://github.com/your-repo/issues)
2. 提供 `context-hub doctor` 输出
3. 提供 DSH 版本、Node.js 版本、操作系统版本
4. 提供复现步骤与错误日志

---

**维护者**：dsh-context-hub 团队  
**最后更新**：2026-11-27
