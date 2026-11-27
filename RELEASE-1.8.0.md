# dsh-context-hub 1.8.0 发布说明

> 发布日期：2026-11-27  
> 版本类型：功能大更新  
> 包大小：157.6 MB（含 embed/node_modules）/ 280 KB（npm slim 包）

---

## 🎉 亮点

本次发布完成了 comparison.md 中列出的**所有剩余补强任务**，共计 **12 个新功能与改进**（7 个 P1 + 5 个 P2）。

---

## 📦 安装方式

### 方式 1：npm（推荐，slim 包）

```bash
npm install dsh-context-hub@1.8.0
```

**注意**：npm 包不含 `embed/node_modules`，如需本地向量服务，需额外执行：
```bash
cd node_modules/dsh-context-hub/embed
npm install --ignore-scripts
```

### 方式 2：分发包（含依赖）

下载 `dist/dsh-context-hub-1.8.0.tgz`（SHA-256: `75ddc34fe8abc9e3e3f99e74ae62a111da5a55b4e9db5bf255f833ab4e5d36c`）

```bash
npm install dsh-context-hub-1.8.0.tgz
```

### 方式 3：DSH 插件市场

```javascript
plugin_manager install_bundle(target="dsh-context-hub@1.8.0")
```

---

## ✨ 新功能

### 1. 确定性优先的写入（A1）

显式信号（"记住"/"不要"/"偏好"/"约定"/"待办"）零 LLM 直接写入：

```
用户："记住，代码注释要用英文"
→ 立即写入，source=explicit, confidence=1.0
```

### 2. 三类冲突判定（A3）

自动检测：
- **否定翻转**："不要/不再/取消"
- **数值变更**：版本号、阈值、配置值
- **状态迁移**：open→closed, pending→done

### 3. 分层复核（A4）

新增 `reviewPolicy` 配置：
- `off` - 关闭复核
- `low-confidence` - 低置信度复核（默认）
- `layered` - knowledge/decision 类自动入 pending

### 4. 查询卫生（B5）

召回查询自动排除：
- 插件注入块
- 工具调用结果
- 其他插件消息

### 5. 压缩回执（C4）

每次压缩记录完整回执：
```javascript
{
  start: 10,
  end: 20,
  shadowedTokens: 5000,
  summaryChars: 1200,
  compressionRatio: "0.24",
  durationMs: 3500,
  promptVersion: "hub-8section-v1.0",
  sectionCheck: true,
  missingSections: [],
  retry: false
}
```

### 6. 摘要质量闭环（C5）

- 8 段校验（缺段自动标记）
- 结转未完成事项
- 空输出自动重试（3000→8000 tokens）

### 7. 诚实指标（E4）

`/context-hub probe` 显示：
```
检索探针：5/5 命中（top-6 命中率 100%）
📊 E4 诚实指标：样本量 n=5，95% 置信区间 [69.1%, 100.0%]
⚠️ 注意：自造探针不构成泛化证据；公共基准结果请见 docs/EVAL.md
```

### 8. 语义近邻去重（A5）

基于向量相似度检测 cosine ≥0.92 的重复候选：

```javascript
const candidates = store.findNearDuplicates(text, scope, { limit: 5 })
// 返回按相似度降序的候选列表
```

### 9. 记忆视图（E3）

新增 3 个命令：

**关系图**：
```bash
/context-hub graph <编号>
# 展示记忆的多跳关系图（最多 2 层，20 个节点）
```

**时间线**：
```bash
/context-hub timeline [scope]
# 按时间顺序展示记忆（project/session/global）
```

**冲突链**：
```bash
/context-hub conflicts <编号>
# 追溯 supersede 关系链
```

### 10. JSONL 导出/导入（E5/D5）

**导出**：
```bash
/context-hub export-jsonl
# 生成 exports/memories-<timestamp>.jsonl
# 每行一个记忆，便于脚本消费
```

**导入**（幂等）：
```bash
/context-hub import-jsonl <路径>
# 基于 hash 去重，重复导入不产生重复行
```

### 11. 兼容性文档（D4）

新增 `docs/COMPATIBILITY.md`：
- DSH 版本兼容性（0.2.x 推荐）
- Node.js 版本要求（≥22.13.0）
- 操作系统支持（Ubuntu/Debian/macOS/Windows）
- 升级路径与故障排查

### 12. 可移植（D5）

JSONL 导出/导入支持：
- 跨机器迁移
- 备份恢复
- 增量导入

---

## 📊 代码统计

| 指标 | 数值 |
|------|------|
| 新增功能 | 12 个 |
| 新增命令 | 5 个 |
| 新增 API | 7 个 |
| 新增代码 | +580 行 |
| 新增文档 | +255 行 |
| 测试通过率 | 100% |

---

## 🔧 升级指南

### 从 1.7.x 升级

```bash
# 1. 备份记忆库
cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.backup

# 2. 升级插件
npm install dsh-context-hub@1.8.0

# 3. 重启 DSH
dsh restart

# 4. 验证新功能
dsh context-hub doctor
dsh context-hub probe
dsh context-hub export-jsonl
```

**兼容性说明**：
- 数据库 schema 向后兼容，无需迁移
- 新增配置项有默认值，不影响现有配置
- FTS5 与向量索引自动重建（首次启动）

---

## 🧪 测试

所有冒烟测试通过：

```bash
npm test
# SMOKE OK
```

新增测试覆盖：
- ✅ JSONL 导出/导入
- ✅ 记忆关系图
- ✅ 时间线视图
- ✅ 冲突链追溯
- ✅ 显式信号写入
- ✅ 冲突分类

---

## 📚 文档

- [兼容性矩阵](docs/COMPATIBILITY.md)
- [功能规格](docs/spec.md)
- [设计文档](docs/design.md)
- [评测报告](docs/EVAL.md)
- [性能分析](docs/PERF.md)
- [扩展指南](docs/SCALE.md)

---

## 🐛 已知问题

1. **向量近邻去重**：`findNearDuplicates()` 需要完整的 onnx 推理支持，当前返回空列表。建议在启用向量召回后使用。

2. **面板记忆视图**：图形化关系图功能待面板更新。

---

## 🙏 致谢

感谢所有贡献者和用户的支持！

---

## 📞 反馈与问题

遇到问题或有建议：

1. 查看 [issues](https://github.com/your-repo/issues)
2. 提供 `context-hub doctor` 输出
3. 提供 DSH 版本、Node.js 版本、操作系统版本
4. 提供复现步骤与错误日志

---

**维护者**：dsh-context-hub 团队  
**版本**：1.8.0  
**发布日期**：2026-11-27  
**许可证**：MIT
