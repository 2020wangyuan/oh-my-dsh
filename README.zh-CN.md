# oh-my-dsh

> 把 oh-my-openagent 的纪律与代理编排思想带到 DeepSeek Harness——以两个**临时 Dynamic Cordis 插件**的形式，从 Web GUI 加载。

[English](README.md) | **简体中文**

<!-- 徽章占位 —— 首次发布时替换为真实的 shields.io 链接 -->
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange.svg) ![Status: experimental](https://img.shields.io/badge/status-experimental-lightgrey.svg)

[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（OmO）用一个规则、哈希锚定编辑、注释卫生、ultrawork（ULW）目标强制与委派能力包裹 agent。`oh-my-dsh` 把这些思想移植到 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH，一个基于 Cordis 的插件式 agent harness）上。交付物是 **Dynamic Cordis Plugins**：每个插件含一个 Host（Node.js）端、可选一个 Client（浏览器）端，用纯 JavaScript 编写（无 import、无 TypeScript、无 JSX），通过 Web GUI 的 `cordis_define` / `cordis_run` 定义并激活，DSH 进程重启后消失。

本仓库包含两个插件：

- **`omo-core`**（Host + Client）——规则注入、哈希锚定编辑、注释检查、两条斜杠命令、三个 Client UI 表面。
- **`omo-discipline`**（仅 Host）——ULW 目标纪律、证据审计、回合收尾强制器，以及委派与团队工具。

## ✨ 功能特性

### 文档纪律

- **规则注入** —— `AGENTS.md` 与 `.omo/rules/**` 下每个文件（最多 20 个）会作为 `omo-rules` 小节（order 150）注入系统提示词，每 60 秒刷新一次。
- **`/init-deep`** —— 为你的仓库生成根级与子目录级 `AGENTS.md` 骨架。

### 安全编辑

- **`hashline_read` / `hashline_edit`** —— 基于逐行内容哈希（FNV-1a 32-bit，显示为 6 位十六进制）的行锚定文件编辑。每个锚定操作都携带读取时得到的 `expectHash`；任一哈希不匹配则整批拒绝——陈旧行写入永远不会落地。

### 代码卫生

- **`omo_comments`** —— 扫描文件中的"AI 味"注释：占位 TODO/FIXME、空注释、装饰性分隔线、无信息 TODO。

### 目标执行（ULW）

- **ULW 纪律提示** —— 系统提示词小节（order 152）：把以 `ulw` / `ultrawork` 开头的消息转化为持久化的 `create_goal`，并禁止目标处于 active 期间的空手回合。
- **`/ulw`** —— 一条命令启动 ultrawork 模式（`goals.create`，50 个续跑回合）。
- **证据审计** —— 目标 active 期间，回合 checkpoint（节流至 30 秒、保留最近 12 条）写入 `.omo/ulw-loop/<session>.md`。
- **Todo Enforcer** —— 在 `agent/turn-stopping` 时，若目标 active 且本回合零工具调用，则把 agent 拉回（同一目标最多一次）。

### 委派与团队

- **`omo_delegate`** —— 按类别（`deep` / `quick` / `visual` / `ultrabrain`）委派一个后台（或等待）子代理。
- **`omo_team`** —— 团队模式：你（组长）分派给最多 6 个并行成员子代理并汇总结构化报告；单个成员失败不会拖垮整队。

### Client UI（来自 `omo-core`）

- 输入框上方状态条（`conversation.input.dock`，id `omo`，order 30）：rules / hashline / comments 状态与工作区根。
- `hashline_read` 与 `hashline_edit` 的紧凑工具卡片（`tool.call.toolview`）。
- "Oh My DSH" 设置页（`settings.section`，id `omo-dsh`，order 50）。

## 📦 与 OmO 的模块映射

| OmO 灵感模块 | oh-my-dsh 中的移植 | 状态 |
| --- | --- | --- |
| `hashline-core` | `hashline_read` / `hashline_edit` 工具 | ✅ 已移植 |
| `agents-md-core` | 规则注入（`omo-rules` 小节）+ `/init-deep` | ✅ 已移植 |
| `comment-checker-core` | `omo_comments` 工具 | ✅ 已移植 |
| `rules-engine` | `omo-rules` 小节背后的规则加载/刷新 | ✅ 已移植 |
| `delegate-core` | `omo_delegate` 工具（4 种类别） | ✅ 已移植 |
| `team-core` | `omo_team` 工具（团队模式） | ✅ 已移植（语义） |
| tmux 实时团队可视化 | — | ⚠️ 未移植 / 降级 |
| 11 个具名 discipline agent | 收敛为一个 ULW 纪律提示 + Todo Enforcer | ⚠️ 未移植 / 降级 |
| team worktree + mailbox 基础设施 | — | ⚠️ 未移植 / 降级 |

完整、经上游源码核对的映射（含各项"保留了什么/舍弃了什么"）见 [docs/omo-mapping.md](docs/omo-mapping.md)。

## 🚀 快速开始

前置条件：一个运行中的 DSH Web GUI，且 agent 工具集中可见 Dynamic Cordis Plugin 能力（`cordis_define` / `cordis_run`）。

1. **定义** —— 在 Web GUI 中为新建插件调用 `cordis_define`：
   - `omo-core`：填 `idPrefix` `omoc`，把 `src/omo-core/host.js` 的函数体粘贴进 `code.host`，`src/omo-core/client.js` 粘贴进 `code.client`。
   - `omo-discipline`：填 `idPrefix` `omod`，仅 `code.host` 粘贴 `src/omo-discipline/host.js`（Host-only 插件，无 client 代码）。
2. **运行** —— 用返回的 `pluginId` / `packageId` 对每个插件调用 `cordis_run`。
3. **批准** —— Client 半（`omo-core` 的浏览器代码）首次激活需要你在 GUI 中批准；批准后 dock 状态条、工具卡片与设置页才会出现。

完整安装流程与验证清单见 [docs/installation.md](docs/installation.md)。

## 🧩 用法速览

| 表面 | 作用 |
| --- | --- |
| `hashline_read <path>` | 读取文件，每行以 `行号#哈希\| 内容` 前缀输出；哈希用于锚定后续编辑。 |
| `hashline_edit` | 批量操作（`replace` / `delete` / `insertAfter` / `insertBefore` / `append`），每个锚定操作携带 `expectHash`；任一不匹配整批拒绝。 |
| `omo_comments <path>` | 返回 `文件:行号` 的 AI 味注释清单（含类别）。 |
| `omo_delegate` | 按 `deep` / `quick` / `visual` / `ultrabrain` 类别委派一个子代理；`await: false` 则后台运行。 |
| `omo_team` | 分派给 ≤ 6 个成员子代理并汇总结构化报告。 |
| `/omo` | 插件状态：工作区根、规则加载状态、已注册工具、命令。 |
| `/init-deep` | 生成根级与子目录级 `AGENTS.md` 骨架。 |
| `/ulw <objective>` | 启动 ultrawork 模式：持久目标、50 回合、证据审计。 |
| dock 状态条 / 工具卡片 / 设置页 | `omo-core` 渲染的 Client 表面。 |

每个工具的参数表、输出格式与 ULW 工作流见 [docs/usage.md](docs/usage.md)。

## 🧭 文档

- [docs/installation.md](docs/installation.md) — 环境要求与逐步安装说明。
- [docs/usage.md](docs/usage.md) — 每个工具、命令与 UI 表面的参数与示例。
- [docs/api-reference.md](docs/api-reference.md) — DSH 服务契约与 RPC 细节（本发布版 docs/ 集合的一部分）。
- [docs/omo-mapping.md](docs/omo-mapping.md) — 经上游源码核对的模块映射，以及有意未移植的部分。

## ⚠️ 注意事项

- **插件是临时的。** Dynamic Cordis Plugins 只存在于当前 DSH 进程中；进程重启即消失。重装 = 重新定义并运行。
- **依赖 DSH 服务。** 代码通过 `ctx.get(...)` 读取可选服务，服务缺失时优雅降级（`fs`、`systemPrompt`、`timer`、`commands`、`sandboxPolicy`、`harness`，Client 端还有 `slots`）。
- **委派需要 `subagents`。** 除非宿主组合提供了带至少一个 provider 的 `subagents` 服务，否则 `omo_delegate` 与 `omo_team` 会明确报错。
- **规则注入需要工作区。** 只有检测到工作区根且其中包含 `AGENTS.md` 或 `.omo/rules/` 时才会注入规则。
- **ULW 证据需要目录。** 只有当 `.omo/ulw-loop/` 已存在时才写入 checkpoint；插件从不隐式创建它（注意：该目录要建在插件解析到的沙箱工作区根下，未必是你 shell 的当前目录）。

## 🙏 致谢

灵感来自 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（`github.com/code-yeongyu/oh-my-openagent`）。上方模块映射致谢其核心模块；本移植基于 DSH 的 Dynamic Cordis Plugin API 重新实现了这些思想。

## 📄 License

以 MIT License 发布。