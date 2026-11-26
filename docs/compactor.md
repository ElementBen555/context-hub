# hub 压缩器（0.5.0）

## 它是什么

`compactor: hub` 让 context-hub 接管 DSH 压缩服务里的**摘要这一步**：触发、选区、恢复、`/compact` 全部沿用原生实现，只把「原生 7 段提示词」换成「记忆感知 8 段（含用户约束）」。hub 只换提示词与段结构，不注入记忆（记忆感知只在 A/B 工具里演示）；失败自动回退原生。

## 为什么不是单独的 bundle / 新服务

最初的计划是「独立 bundle 子类化 `BasicCompactionEngine`，只覆盖 `summarize()`」。实现时发现三个硬约束：

1. **模块解析**：out-of-tree 插件装在 `~/.dsh/profiles/web/node_modules`，从那里 `import('@deepseek-ai/dsh-compaction-basic')` 直接 `ERR_MODULE_NOT_FOUND`（安装树不在解析路径里）；把它作为 file 依赖装进来，又会引入第二份 `cordis`/`dsh-llm`，与宿主运行时实例不同源。
2. **同一 profile 只能有一个 compaction 服务**：插一条新 `compaction` 服务会和 `compaction-basic` 冲突；禁用原生再插入自己，则任何加载失败都会让自动压缩整体消失。
3. **用户目标是「只装一个插件」**：再加一个 bundle 就违背了前提。

所以改成**在 compaction 服务实例上包装 `summarize()`**：`installHubCompactor()` 用 `ctx.inject(['compaction'])` 等原生服务就绪，保存原方法，替换为 hub 版本，并在 `scope.effect` 里注册卸载；任何异常都 `original.call(this, …)` 回退。

## 怎么用

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml 追加（需重启 dsh 生效）
- id: dsh-context-hub
  config:
    compactor: hub
```

或不重启，直接运行：

```
/context-hub compactor hub      # 立刻挂载
/context-hub compactor native   # 立刻卸载
/context-hub compactor          # 查看当前状态
```

`status` 的「配置」行会显示 `压缩器 hub` 或 `压缩器 native`。

## 失败与回退

- 模型输出为空、流报错、没有可用模型路由 → 记录 `compact-hub-fallback` 事件，回退原生 7 段摘要，压缩本身照常完成。
- `compaction` 服务不存在（例如换 profile）→ 只记 `native（compaction 服务不可用）`，不影响其他功能。
- 升级 DSH 后若 `summarize` 改名或改签名：挂载时会因 `typeof service.summarize !== 'function'` 跳过，退化为原生，不会报错。

## 风险

- 这是**实例级 monkey patch**，依赖 `compaction-basic` 的内部约定（`summarize(input, agent, signal)` 返回 `SummaryResult`）。DSH 升级后需要回归一次 `/context-hub compactor hub` + 一次 `/compact`。
- `rawOutput` 只含文本块（不做图片投影）；带图片的会话摘要会丢失图片描述，这是刻意取舍。
- 提示词替换不改变选区；「压哪些消息」仍由原生策略决定。

## 验证记录（2026-11-25，0.5.0）

- smoke：挂载后 `summarize` 不再等于原生；返回 `llmStreamCall: true`；空输出时回退返回 `native summary`；`compactor native/hub` 命令切换均通过。`SMOKE OK`。
- 线上：`status` 显示 `压缩器 native`（默认）；hub 需用户显式切换或改 patch 后重启。
