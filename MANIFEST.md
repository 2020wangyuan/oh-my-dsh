# oh-my-dsh · MANIFEST

oh-my-dsh 是 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 思想在 DeepSeek Harness（DSH）上的移植：以 **Dynamic Cordis Plugins**（纯 JS、无编译、无第三方依赖）实现 OmO 风格的纪律注入、Hashline 行锚编辑、评论卫生检查与子代理 / 团队委派。

- **载体**：DSH 会话内 `cordis_define` → `cordis_run` 加载的动态 Cordis 插件
- **源码形态**：每个文件是插件的一个「半体」函数体——`host` 跑在 DSH Node 进程，`client` 跑在浏览器页面；加载时直接作为 Cordis Plugin 的函数体返回，无 import / 无 TypeScript / 无 JSX

## 仓库布局

```
oh-my-dsh/
├── LICENSE                  MIT License（Copyright (c) 2026 oh-my-dsh contributors）
├── package.json             包元数据与脚本（npm run check:comments）
├── README.md                仓库首页说明
├── .gitignore
├── MANIFEST.md              本文件：布局 + 插件清单 + 源码溯源
├── src/
│   ├── omo-core/            omo-core 插件（双端）
│   │   ├── host.js          Host 半体
│   │   └── client.js        Client 半体
│   └── omo-discipline/      omo-discipline 插件（仅 host）
│       └── host.js
├── docs/
│   ├── installation.md      安装指南（Web GUI 内加载两个插件）
│   ├── usage.md             工具 / 命令 / UI 表面使用说明
│   ├── api-reference.md     三个源码文件的 API 参考
│   └── omo-mapping.md       OmO → oh-my-dsh 模块映射
├── examples/
│   ├── omo-demo.ts          已通过 hashline / omo_comments 清理的演示文件
│   ├── rules/demo-rule.md   演示 .omo/rules/ 规则注入
│   └── README.md            示例说明
└── scripts/
    ├── comment-check.mjs    omo_comments 的可复现命令行检查器（纯 Node 标准库）
    ├── publish.sh           gh CLI 一键建仓并推送脚本
    └── README.md            脚本说明
```

## 插件清单

| 插件 | 目录 | 构成 |
| --- | --- | --- |
| omo-core | `src/omo-core/` | `host.js` + `client.js`（双端） |
| omo-discipline | `src/omo-discipline/` | `host.js`（仅 host） |

### omo-core（双端）

**模块清单（host 半体）**

1. **Rules 注入** —— `systemPrompt.section` `omo-rules`（order 150）：每次组装提示词时注入根 `AGENTS.md` 与 `.omo/rules/**`（60s 定时刷新缓存；注入内容以 `【Oh My DSH · 项目规则】` 段落包裹）
2. **Hashline 工具** —— `hashline_read` / `hashline_edit`：按行输出 `行号#FNV-1a32哈希| 内容`，编辑时携带 `expectHash` 校验，任一哈希不匹配则整批拒绝写入
3. **Comment Checker** —— `omo_comments`：扫描占位 TODO/FIXME、空注释、装饰性注释、无信息 TODO 四类「AI 味」注释（规则见 `scripts/comment-check.mjs` 头注释，两者逐字一致）
4. **命令** —— `/omo`（模块状态）、`/init-deep`（递归生成根级与子目录级 `AGENTS.md` 骨架，深度 ≤ 2）
5. **状态 RPC** —— `harness.handle('omo-status')`：向 Client 半体提供工作区、rules、已注册工具等状态

**注册的工具 / 命令 / UI 表面**

- 工具：`hashline_read`、`hashline_edit`、`omo_comments`
- 命令：`/omo`、`/init-deep`
- RPC：`omo-status`（仅本包 Client 半体消费）
- Client UI（slots）：`conversation.input.dock` id `omo`（order 30，输入区上方状态条）；`tool.call.toolview` key `hashline_read` / `hashline_edit`（工具专属卡片）；`settings.section` id `omo-dsh`（order 50，「Oh My DSH」设置页）

**运行时依赖的 DSH 服务**

- Host：`fs`、`sandboxPolicy`（工作区探测）、`systemPrompt`、`timer`、`commands`；harness API（`defineTool` / `registerTool` / `handle`）
- Client：`slots`（`inject` / `register`）、`host.call`、React（`React.createElement`）

### omo-discipline（仅 host）

**模块清单**

1. **ULW 纪律提示** —— `systemPrompt.section` `omo-ulw-discipline`（order 152）：消息以「ulw」/「ultrawork」开头或请求为长期目标时用 `create_goal` 建立持久目标，active 期间回合不得空手结束
2. **`/ulw` 命令** —— 确定性激活 ULW：`goals.create(agent, { objective, maxGoalRounds: 50 })`；已存在 active 目标时拒绝重复启动
3. **证据审计** —— `agent/turn-stopping` 钩子：目标 active 期间写回合 checkpoint（30s 节流、最多 12 条）到 `.omo/ulw-loop/<session>.md`
4. **Todo Enforcer** —— 目标 active 且当回合零工具调用时，`agent.steer` 拉回（每个目标至多一次，`goal/changed` 时重置）
5. **`omo_delegate`** —— 按类别（deep / quick / visual / ultrabrain）委派 1 个后台子代理，可选等待结果（默认等待）
6. **`omo_team`** —— OmO Team Mode 的 DSH 版：队长 + 最多 6 名并行成员子代理，`Promise.allSettled` 汇总结构化报告

**注册的工具 / 命令 / UI 表面**

- 工具：`omo_delegate`、`omo_team`
- 命令：`/ulw`
- 监听的会话事件：`tools/result`、`goal/changed`、`agent/turn-stopping`
- 无 Client 半体，无 UI 表面

**运行时依赖的 DSH 服务**

- `systemPrompt`、`commands`、`goals`、`fs`、`sandboxPolicy`、`subagents`（`list` / `start`）；harness API（`defineTool` / `registerTool`）

## 源码溯源

- 动态插件源码的**唯一权威来源**是运行中的 DSH 会话：`cordis_inspect_self(pluginId, packageId)` 返回的 `code.host` / `code.client` 函数体。
- 本仓库 `src/` 即从运行中会话**逐字导出**，未做任何改写：
  - **omo-core** = `pkg-4` 的 host + client（源码头注释另记录会话注册的插件 id `omoc-2`）
  - **omo-discipline** = `pkg-7` 的 host（源码头注释另记录会话注册的插件 id `omod-3`）
- 如需**重新导出或核对**：在 DSH Web GUI 会话中调用 `cordis_inspect_self(pluginId, packageId)`（如 `omoc-2` / `pkg-4`），将返回的 host / client 函数体原样保存到对应文件；随后用 `cordis_define({ plugin: { kind: 'existing' } })` 追加新包、`cordis_run` 激活。
- 一致性提醒：判断运行中插件行为以会话内 inspect 结果为准，本仓库仅是发行快照；修改会话内插件后请同步导出，避免两者漂移。

## 工程化入口

- `npm run check:comments`（即 `node scripts/comment-check.mjs src examples scripts`）：离线复现 `omo_comments` 的四条规则，扫描 `src/`、`examples/`、`scripts/` 三个代码面，有命中退出码 1。
- **有意排除 `docs/`**：文档中作为示例逐字引用了 `omo_comments` 的输出片段（示例行带 `//` 前缀、内容如 `TODO: add logic here`），属于演示"被标记的注释"而非真实代码注释；门禁只守护代码面，故不扫描文档。