# dsh-context-hub 1.8.0 用户更新指南

> 发布日期：2026-11-27  
> 适用版本：从任意 1.x 版本升级到 1.8.0

---

## 🚀 快速升级

### 方式 1：从 GitHub Release 下载（推荐）

```bash
# 1. 下载分发包
curl -L -o dsh-context-hub-1.8.0.tgz \
  https://github.com/ElementBen555/context-hub/releases/download/v1.8.0/dsh-context-hub-1.8.0.tgz

# 2. 验证完整性
echo "75ddc34fe8abc9e3e3f99e74ae6e2a111da5a55b4e9db5bf255f833ab4e5d36c  dsh-context-hub-1.8.0.tgz" | sha256sum -c

# 3. 安装
npm install dsh-context-hub-1.8.0.tgz

# 4. 重启 DSH
dsh restart
```

### 方式 2：npm（待发布）

```bash
npm install dsh-context-hub@1.8.0
dsh restart
```

---

## 📋 升级前检查

### 1. 检查当前版本

```bash
dsh plugin list | grep context-hub
# 或
dsh context-hub version
```

### 2. 备份记忆库（可选但推荐）

```bash
# 找到记忆库位置
ls -lh ~/.dsh/context-hub/memory.db

# 备份
cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.backup.$(date +%Y%m%d)
```

### 3. 检查系统要求

- **Node.js**: ≥22.13.0
  ```bash
  node --version
  ```
- **DSH**: 0.2.x
  ```bash
  dsh --version
  ```

---

## ✨ 新功能使用指南

### 1. 显式信号记忆（A1）

**用法**：在对话中直接说出记忆意图

```
用户："记住，我偏好使用 TypeScript"
→ 系统立即写入，无需 LLM 判断

用户："不要记住我的浏览历史"
→ 系统记录否定偏好

用户："待办：本周完成代码审查"
→ 创建任务记忆
```

**提示**：
- 关键词：记住、不要、偏好、约定、待办、设置
- 支持否定："不要记住"、"不再保存"

---

### 2. 冲突检测与处理（A3）

**自动检测场景**：

```
旧记忆："项目使用 Python 3.10"
新输入："项目现在使用 Python 3.11"
→ 自动标记冲突，创建 supersede 关系
```

```
旧记忆："API 限流 100 次/分钟"
新输入："取消 API 限流"
→ 自动检测否定翻转
```

**查看冲突链**：
```bash
/context-hub conflicts <记忆编号>
```

---

### 3. 记忆关系图（E3）

**查看记忆关联**：
```bash
/context-hub graph <记忆编号>
# 展示最多 2 层关系，20 个节点
```

**示例输出**：
```
记忆 #123: "使用 TypeScript"
├─ superseded_by → #456: "改用 JavaScript"
├─ related → #789: "前端技术栈"
└─ derived → #101: "代码风格规范"
```

---

### 4. 时间线视图（E3）

**按时间浏览记忆**：
```bash
# 当前项目
/context-hub timeline project

# 全局记忆
/context-hub timeline global

# 当前会话
/context-hub timeline session
```

**输出格式**：
```
2026-11-27 10:30  #456 改用 JavaScript
2026-11-27 09:15  #123 使用 TypeScript
2026-11-26 16:45  #789 前端技术栈
```

---

### 5. JSONL 导出/导入（E5/D5）

**导出所有记忆**：
```bash
/context-hub export-jsonl
# 生成：exports/memories-20261127-103045.jsonl
```

**导出文件示例**：
```jsonl
{"id":123,"text":"使用 TypeScript","kind":"preference","scope":"project","created_at":"2026-11-27T10:30:00Z","hash":"abc123"}
{"id":456,"text":"改用 JavaScript","kind":"decision","scope":"project","created_at":"2026-11-27T11:00:00Z","supersedes":[123],"hash":"def456"}
```

**导入记忆（幂等）**：
```bash
/context-hub import-jsonl exports/memories-20261127-103045.jsonl
# 基于 hash 去重，重复导入不会产生重复行
```

**使用场景**：
- 跨机器迁移记忆
- 定期备份
- 团队共享配置

---

### 6. 诚实指标（E4）

**查看召回质量**：
```bash
/context-hub probe
```

**输出示例**：
```
检索探针：5/5 命中（top-6 命中率 100%）
📊 E4 诚实指标：样本量 n=5，95% 置信区间 [69.1%, 100.0%]
⚠️ 注意：自造探针不构成泛化证据；公共基准结果请见 docs/EVAL.md
```

---

### 7. 冲突链追溯（E3）

**查看完整冲突历史**：
```bash
/context-hub conflicts <记忆编号>
```

**输出示例**：
```
记忆 #123: "使用 Python 3.10"
  superseded_by → #456: "使用 Python 3.11"
    superseded_by → #789: "使用 Python 3.12"

共 3 次变更，最近一次：2026-11-27 11:00
```

---

## 🔧 配置项更新

### 新增配置项

在 `~/.dsh/config.json` 中添加：

```json
{
  "context-hub": {
    "reviewPolicy": "layered",  // off | low-confidence | layered
    "explicitSignals": true,     // 启用显式信号（默认 true）
    "conflictDetection": true,   // 启用冲突检测（默认 true）
    "exportDir": "./exports"     // 导出目录
  }
}
```

**配置说明**：

| 配置项 | 可选值 | 默认值 | 说明 |
|--------|--------|--------|------|
| `reviewPolicy` | `off` / `low-confidence` / `layered` | `low-confidence` | 复核策略 |
| `explicitSignals` | `true` / `false` | `true` | 显式信号写入 |
| `conflictDetection` | `true` / `false` | `true` | 冲突检测 |
| `exportDir` | 任意路径 | `./exports` | 导出目录 |

---

## 🐛 故障排查

### 问题 1：升级后记忆丢失

**解决方案**：
```bash
# 1. 检查记忆库路径
ls -lh ~/.dsh/context-hub/

# 2. 恢复备份
cp ~/.dsh/context-hub/memory.db.backup.* ~/.dsh/context-hub/memory.db

# 3. 重启 DSH
dsh restart
```

### 问题 2：新命令不可用

**解决方案**：
```bash
# 1. 检查版本
dsh context-hub version

# 2. 确认安装路径
ls -lh ~/.dsh/plugins/context-hub/dist/

# 3. 重新安装
npm install dsh-context-hub-1.8.0.tgz --force
```

### 问题 3：向量召回失败

**解决方案**：
```bash
# 1. 检查 onnx 模型
ls -lh ~/.dsh/context-hub/embed/models/

# 2. 重新下载模型
cd ~/.dsh/context-hub/embed
./download-models.sh

# 3. 重启
dsh restart
```

### 问题 4：导出文件为空

**解决方案**：
```bash
# 1. 检查记忆数量
dsh context-hub stats

# 2. 确认有记忆数据
dsh context-hub list --limit 1

# 3. 检查导出目录权限
ls -lh exports/
```

---

## 📊 性能影响

### 内存占用

| 操作 | 额外内存 | 说明 |
|------|----------|------|
| 冲突检测 | +5-10 MB | 实时计算 |
| 关系图 | +10-20 MB | 临时计算 |
| JSONL 导出 | +50-100 MB | 全量导出时 |
| 向量召回 | +50-100 MB | ONNX 运行时 |

### 响应时间

| 操作 | 延迟增加 | 说明 |
|------|----------|------|
| 显式信号写入 | ~0ms | 直接写入 |
| 冲突检测 | +50-200ms | 向量相似度计算 |
| 分层复核 | +200-500ms | LLM 复核 |
| 关系图生成 | +500-2000ms | 多跳查询 |

---

## 🆚 版本对比

### 1.7.x → 1.8.0

| 功能 | 1.7.x | 1.8.0 |
|------|-------|-------|
| 显式信号写入 | ❌ | ✅ |
| 冲突检测 | ❌ | ✅ |
| 关系图 | ❌ | ✅ |
| 时间线 | ❌ | ✅ |
| JSONL 导出 | ❌ | ✅ |
| 冲突链追溯 | ❌ | ✅ |
| 诚实指标 | ❌ | ✅ |
| 近邻去重 | ❌ | ✅ |
| 兼容性文档 | ❌ | ✅ |

---

## 📞 获取帮助

### 官方渠道

1. **GitHub Issues**: [https://github.com/ElementBen555/context-hub/issues](https://github.com/ElementBen555/context-hub/issues)
2. **文档**: [https://github.com/ElementBen555/context-hub/tree/main/docs](https://github.com/ElementBen555/context-hub/tree/main/docs)
3. **Release 说明**: [https://github.com/ElementBen555/context-hub/releases/tag/v1.8.0](https://github.com/ElementBen555/context-hub/releases/tag/v1.8.0)

### 提供诊断信息

遇到问题时，请提供：

```bash
# 1. 插件诊断
dsh context-hub doctor

# 2. 版本信息
node --version
dsh --version
dsh context-hub version

# 3. 系统信息
uname -a

# 4. 错误日志
tail -n 50 ~/.dsh/logs/context-hub.log
```

---

## 🎉 升级完成

升级成功后，运行以下命令验证：

```bash
# 1. 检查版本
dsh context-hub version
# 输出：1.8.0

# 2. 运行冒烟测试
dsh context-hub probe
# 输出：SMOKE OK

# 3. 尝试新功能
dsh context-hub export-jsonl
dsh context-hub timeline
dsh context-hub doctor
```

---

**更新日期**: 2026-11-27  
**维护者**: dsh-context-hub 团队  
**版本**: 1.8.0
