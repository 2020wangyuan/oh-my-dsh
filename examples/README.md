# Oh My DSH · 示例

本目录演示 oh-my-dsh（DSH 版 oh-my-openagent）两个插件的主要能力：

| 文件 | 演示内容 |
| --- | --- |
| `omo-demo.ts` | 演示文件：`add` / `greet` / `separator` / `clamp` 四个函数 + 一条合法行为注释，供注释扫描与 Hashline 工具演练 |
| `rules/demo-rule.md` | 演示 `.omo/rules/` 规则注入：放入工作区后由 omo-core 自动注入系统提示词 |

## 演练 (a)：注释扫描 —— 预期 0 命中

在已注册 omo-core 插件的 DSH 会话中，用 `omo_comments` 工具扫描本文件：

```
omo_comments(path: "examples/omo-demo.ts")
```

预期返回：`examples/omo-demo.ts：未发现 AI 味注释，干净。`（`hits` 为空，`total` 为 0）。

omo_comments 只匹配四类「AI 味」模式（见 `src/omo-core/host.js` 的 SLOP 表）：占位 TODO/FIXME、空注释、装饰性注释（连续分隔符）、无信息 TODO。`separator()` 中「故意为空」的注释虽然内容简短，但不属于上述任何一类（不含 TODO/FIXME/XXX/HACK 关键词、非空、非分隔符），因此不会被误报，与本演示「0 命中」的目标一致。

无需 GUI 的环境可另备独立脚本（如 `scripts/comment-check.mjs`，按 SLOP 规则实现），与插件内 omo_comments 判断一致；本仓库当前的主路径即插件工具 `omo_comments`。

## 演练 (b)：Rules 注入 —— 确认 rules=true

1. 把 `rules/demo-rule.md` 复制到任意 DSH 代理工作区的 `.omo/rules/` 下（与该工作区的 AGENTS.md 同级）。
2. 工作区探测由 sandboxPolicy 提供：omo-core 在启动时解析工作区根，随后每 60 秒刷新一次规则缓存（timer）。新放入的规则文件最迟 60 秒内进入缓存。
3. 确认方式二选一：
   - 在会话中执行命令 `/omo`，状态文本应出现 `Rules 注入: 已加载（N 字符）`（N 为含 AGENTS.md 与规则文件的注入字符数）；
   - 调用 Host RPC `omo-status`，检查返回字段 `rules: true`。
4. 验证注入效果：系统提示词将包含 `【Oh My DSH · 项目规则（AGENTS.md / .omo/rules）】` 段（systemPrompt section `omo-rules`，order 150），段落内容即 `===== .omo/rules/demo-rule.md =====` 标题 + 规则正文。
