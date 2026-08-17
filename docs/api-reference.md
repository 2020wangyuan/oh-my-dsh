# Oh My DSH · API 参考

本文件是 oh-my-dsh（oh-my-openagent 的 DeepSeek Harness Dynamic Cordis Plugin 移植）的 API 参考，逐字对照三个源码文件整理：

- `src/omo-core/host.js` —— omo-core 的 Host 半端
- `src/omo-core/client.js` —— omo-core 的 Client 半端（浏览器）
- `src/omo-discipline/host.js` —— omo-discipline 的 Host 半端

三个文件均为**插件函数体**（顶层 `return { apply(ctx) { … } }`），由 `cordis_define` 直接粘贴加载，不作为独立模块运行。纯 JavaScript，无 import / TypeScript / JSX。

## 1. 工具表

| 名称 | 所在插件与端 | 参数（名称 / 类型 / 必填） | 返回结构（成功） | 行为要点 |
| --- | --- | --- | --- | --- |
| `hashline_read` | omo-core · Host | `path` string **必填**（相对工作区根目录）；`start` number 可选（起始行号，含，1 起）；`end` number 可选（结束行号，含）；`cwd` string 可选（解析 path 的基准目录，默认工作区根） | `{ ok: true, path, lineCount, fingerprint, start, end, lines }`，`lines` 为 `"行号#6位哈希\| 内容"` 数组；`fingerprint` 为全文内容的 FNV-1a 32-bit 哈希前 6 位；`start`/`end` 为裁剪后的实际范围 | 逐行输出内容哈希锚点；CRLF 归一并剥离末尾换行计数；`start`/`end` 越界自动裁剪（`Math.max(1, …)` / `Math.min(lineCount, …)`）；文本渲染附带提示「修改时请用 hashline_edit，并携带对应行的 expectHash」。失败返回 `{ ok: false, error }`，如 `fs 服务不可用`、`文件不存在或不是普通文件: <path>` |
| `hashline_edit` | omo-core · Host | `path` string **必填**；`ops` array **必填**（每项 `{ op: enum['replace','delete','insertAfter','insertBefore','append'], line?, expectHash?, newContent? }`，`required: ['op']`；`append` 不需 line/expectHash，其余定位操作由 `line`+`expectHash` 锚定）；`cwd` string 可选 | `{ ok: true, path, applied, actions, newFingerprint, note }`，`actions` 为 `{ op, line }` 数组；`note` 提示行号已变化、需重新 `hashline_read` | 先校验**全部**锚定操作的内容哈希（期望值取 `expectHash` 中 `#` 后的部分；expectHash 为空则跳过该校验）；任一不匹配则**整批拒绝**，返回 `{ ok: false, error: '哈希校验失败，已拒绝整批写入（文件可能已被修改）', errors }`（`errors` 截前 20，含 `{ op, line, expected, actual, current }` 或越界 `{ op, line, reason: '行号越界' }`）；校验通过后按行号**降序**应用 replace/delete/insertAfter/insertBefore，append 最后按原顺序追加；原文件有尾随换行或新文本非空时补 `\n` |
| `omo_comments` | omo-core · Host | `path` string **必填**；`cwd` string 可选 | `{ ok: true, path, scanned, hits, total }`，`hits` 截前 50，每项 `{ line, kind, text }`；`scanned` 为扫描行数；`total` 为命中总数 | 逐行定位首个 `//`，对行尾依次匹配 4 类 SLOP 规则（只记首个命中）：占位 TODO/FIXME（含中英文关键词）、空注释、装饰性注释（连续分隔符）、无信息 TODO；0 命中时渲染 `未发现 AI 味注释，干净。`，有命中时列出 `行号 [kind] 注释文本` |
| `omo_delegate` | omo-discipline · Host | `task` string **必填**（自包含任务描述，子代理看不到本会话上下文）；`category` string 可选，enum `['deep','quick','visual','ultrabrain']`，默认 `deep`；`await` boolean 可选，默认 `true`（`false` 时后台运行只返回子代理 id）；`provider` string 可选（默认取 `sub.list()` 第一个） | 等待模式：`{ ok: true, provider, category, child, stopReason, output, note }`（`output` 为子代理 text 输出拼接，截 6000 字符）；后台模式：`{ ok: true, provider, category, child, background: true, note }` | 类别决定子代理前言（deep=Hephaestus 自主深度执行 / quick=快速小改 / visual=视觉前端 / ultrabrain=资深架构师），提示词 = 前言 + 任务 + 汇总要求；`sub.start(provider, { label: 'omo:'+category, prompt, parent: agent, signal })`；`timeoutMs` 900000（15 分钟）；`isConcurrencySafe: () => false`。失败返回 `{ ok: false, error }`（`subagents 服务不可用` / `缺少调用方 agent 上下文` / `task 不能为空` / `没有可用的 subagent provider（已注册: …）`） |
| `omo_team` | omo-discipline · Host | `objective` string **必填**（团队总目标，队长保持所有权）；`members` array **必填**（最多 6 个，超长截断），每项 `{ name: string 必填, task: string 必填, role?: string, kind?: enum['deep','quick','visual','ultrabrain'] }`；`provider` string 可选 | `{ ok: true, objective, provider, members: N, succeeded: K, results: [{ name, role, ok, stopReason, output }], note: '团队已收队。' }`；`output` 截 4000 字符；`succeeded` 为 `ok === true` 的成员数 | 逐个发布成员（发布即后台运行），全部发布后 `Promise.allSettled` 并行等待；启动失败的成员记为 `{ ok: false, stopReason: 'error', output: '启动失败: …' }`；`timeoutMs` 1800000（30 分钟）；`isConcurrencySafe: () => false`；渲染汇总「🤝 团队收队：K/N 名成员成功」并逐成员展示汇报 |

## 2. 命令表

| 命令 | 插件 | 输入 | 返回文本行为 |
| --- | --- | --- | --- |
| `/omo` | omo-core | 无（未声明 `input`） | 返回 `{ kind: 'success', text }`。text 为状态段：`### Oh My DSH 模块状态`、`- 工作区: <workspaceRoot 或（未知）>`、`- Rules 注入: 已加载（N 字符）/ 未发现 AGENTS.md / .omo/rules`、`- 工具: hashline_read, hashline_edit, omo_comments`、`- 纪律模块: 由 omo-discipline 插件提供…`、`- 命令: /omo 状态 · /init-deep 生成 AGENTS.md 层级` |
| `/init-deep` | omo-core | 无 | handler 为 async。有创建：`{ kind: 'success', text: '已生成 N 个 AGENTS.md：\n - <路径>…' }`；无创建：`{ kind: 'success', text: '没有需要生成的 AGENTS.md（均已存在或目录不含源文件）' }`；异常：`{ kind: 'error', text }`。逻辑：跳过 SKIP 目录（`.git, node_modules, dist, build, .dsh, .next, __pycache__, .venv, .omo`），仅在目录含 SRC_EXT 源文件（20 种扩展名）且对应 AGENTS.md 不存在时生成骨架（根级与深度 ≤2 的子目录），正文含职责说明占位与当前文件列表（前 40） |
| `/ulw` | omo-discipline | `input: { hint: '<要持续推进的目标描述>' }` | 目标文本取自 `invocation.rawInput`（去行首空白后 trim）。空目标：`{ kind: 'error', text: '用法: /ulw <要持续推进的目标>' }`；goals 服务缺失：`{ kind: 'error', text: 'goals 服务不可用' }`；已存在未完成目标（`goals.get(agent).phase !== 'complete'`）：`{ kind: 'error', text: '已存在阶段为 <phase> 的目标：「<objective>」。请先完成或暂停它，再启动新的 ULW。' }`；成功：`goals.create(agent, { objective, maxGoalRounds: 50 })` 后返回 `{ kind: 'success', text: '🌀 ULW 模式已启动。目标：「…」。\n纪律：不干完不罢休——每个回合都必须推进（工具/文件/委派）或明确报告阻塞。\n证据审计：目标 active 期间每 30 秒的回合 checkpoint 会写入 .omo/ulw-loop/。' }`；异常：`{ kind: 'error', text: '启动失败: …' }` |

## 3. systemPrompt sections

| name | order | 文本来源 | 内容 |
| --- | --- | --- | --- |
| `omo-rules` | 150 | omo-core · Host | 动态：`() => state.rulesText ? '【Oh My DSH · 项目规则（AGENTS.md / .omo/rules）】\n' + rulesText + '\n【规则结束】' : ''`。rulesText 为空（未发现 AGENTS.md / .omo/rules/** 或加载失败）时输出空字符串。规则正文为 `===== AGENTS.md（项目规则，最高优先级，必须遵循）=====` / `===== .omo/rules/<文件名> =====` 标题块拼接 |
| `omo-ulw-discipline` | 152 | omo-discipline · Host | 静态文本（逐字）：【Oh My DSH · ULW 纪律】当用户消息以「ulw」或「ultrawork」开头，或请求是应持续推进的长期目标时，立即用 create_goal 建立持久目标（objective 为去掉关键词后的完整请求），随后用 update_goal 在每个阶段更新。目标处于 active 阶段时，任何回合都不得空手结束：要么继续推进（工具调用 / 文件操作 / 委派子代理），要么明确报告阻塞。目标真正完成时用 update_goal 标记 complete。 |

## 4. 事件 / 钩子

| 事件 | 插件 | 行为 |
| --- | --- | --- |
| `timer.interval(fn, 60000)` | omo-core | 每 60 秒刷新一次规则缓存（`loadRules()` 重读 AGENTS.md 与 `.omo/rules/**`，实现「60 秒内生效」）；避免每次组装提示词做磁盘 IO |
| `tools/result` | omo-discipline | `ctx.on('tools/result', (exec, result) => …)`：按 `exec.agent.id` 统计当前回合工具调用数（`state.activity: Map<agentId, { tools }>`，每次 `tools += 1`；result 参数仅作事件存在性使用，不参与计数） |
| `goal/changed` | omo-discipline | `(payload)`：取 `payload.agent.id`，从 `state.nudged` 集合删除该 agent（目标创建/编辑/完成/阻塞后允许 Todo Enforcer 再次拉回） |
| `agent/turn-stopping` | omo-discipline | `(payload)`：取 `payload.agent` 与 `payload.turn`。① **Todo Enforcer**：若 goals 可读且目标 `phase === 'active'`、本回合工具数 `=== 0`、且该 agent 未被拉回过（`!nudged.has(id)`）→ `nudged.add(id)` 并以 `agent.steer({ id: 'omo:<epoch>:<agentId>', role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'omo-discipline' } })` 送回「不要空手结束回合」指令（同一目标每 agent 至多一次）。② **ULW 证据审计**：目标 active 时写回合 checkpoint（`{ at, turn, tools, objective }`，objective 截 200 字符），间隔超过 30 秒（`now - lastEvidenceWrite > 30000`）才落一条，缓冲上限 12 条（超出 `shift()` 丢弃最旧），随后写入 `.omo/ulw-loop/<safeAgentId>.md`（agentId 中非 `[a-zA-Z0-9_-]` 替换为 `_`；目录不存在则不写、不隐式创建）。③ 回合收尾把该 agent 计数重置为 `{ tools: 0 }` |

## 5. Client 表面

| Slot / 表面 | 标识 | 内容 |
| --- | --- | --- |
| `conversation.input.dock` | `id: 'omo'`，`order: 30`，`label: 'Oh My DSH'` | 输入区上方的状态条：`host.call('omo-status')` 成功后显示 `OmO · rules✓/✗ · hashline✓ · comments✓ · <workspaceRoot>`，失败/加载中显示 `OmO 加载中…`；等宽字体，11px |
| `tool.call.toolview` | `key: 'hashline_read'` / `key: 'hashline_edit'` | 两张专属工具卡片：chip 徽标与左侧色条（`hashline_read` →「OmO 读取」`#36cfc9`；`hashline_edit` →「OmO 编辑」`#b37feb`）；摘要位 = `路径 <path>`、`第 <start>-<end> 行`、`<N> 项操作`（按参数出现与否拼接，无参数时回退显示 toolName） |
| `settings.section` | `id: 'omo-dsh'`，`order: 50`，`label: 'Oh My DSH'` | 设置页：工作区路径 + 5 行说明（Rules 注入 / Hashline 编辑 / Comment Checker / 纪律执行 / 命令），同样消费 `omo-status` RPC |
| Host RPC `omo-status` | `harness.handle('omo-status')` | 返回字段：`workspaceRoot`（string，未探测为空串）、`rules`（boolean，`!!state.rulesText`）、`hashline`（恒 `true`）、`comments`（恒 `true`）、`registered`（string[]，实际注册成功的工具名：hashline_read / hashline_edit / omo_comments）、`commands`（`['/omo', '/init-deep']`） |

## 6. 集成要求（依赖的 DSH 服务）

| 服务 | 消费者与用法 |
| --- | --- |
| `fs` | 核心基础设施。omo-core：工作区根探测（`fsx.resolve('.', …)` + `fsx.processPath(t)`）、规则加载（`resolve` / `stat` / `readText` / `listDir`）、hashline 读写（`readText` / `writeText`）、init-deep 目录遍历（`listDir` / `stat` / `writeText`）；omo-discipline：证据审计写入 `.omo/ulw-loop/`（`resolve` / `stat` / `writeText`，目录不存在则跳过） |
| `systemPrompt` | 两端插件注册 section：omo-core `sys.section({ name: 'omo-rules', order: 150, text: () => … })`；omo-discipline `sys.section({ name: 'omo-ulw-discipline', order: 152, text: '…' })`，均经 `ctx.effect()` 注册 |
| `timer` | omo-core `timer.interval(() => loadRules(), 60000)`，60 秒规则缓存刷新 |
| `commands` | `commands.register({ name, description, input?, handler })`：omo-core 注册 `omo` 与 `init-deep`；omo-discipline 注册 `ulw`（handler 读取 `invocation.rawInput`、`invocation.agent`） |
| `goals` | omo-discipline：`/ulw` 用 `goals.get(agent)` 查重、`goals.create(agent, { objective, maxGoalRounds: 50 })`；Todo Enforcer 在 `agent/turn-stopping` 中 `goals.get(agent)` 读取 `phase` / `objective` |
| `subagents` | omo-discipline：`sub.list()` 枚举可用 provider，`sub.start(provider, { label, prompt: [{type:'text'}] , parent: agent, signal })` 返回 run（`run.id` / `run.result`）——omo_delegate 单个委派、omo_team 并行发布（≤6）后 `Promise.allSettled` |
| `sandboxPolicy` | omo-core 读 `sp.workspaceRoot` 作为工作区根；omo-discipline 用它定位 `.omo/ulw-loop/` 证据目录 |
| `harness` | `harness.defineTool(...)` 定义 5 个工具（参数 schema、`output.render`、`async execute(args, exec)`、可选 `timeoutMs` / `isConcurrencySafe`），`harness.registerTool(ctx, def)` 经 `ctx.effect()` 注册；`harness.handle('omo-status', …)` 提供 Client 可调用的 Host RPC。工具执行上下文 `exec`：`exec.signal`（取消信号，hashline / 子代理传递）、`exec.agent`（omo_delegate / omo_team 的调用方 agent） |
| `slots`（Client） | omo-core Client 经 `slots.inject(name, () => slots.register(meta, render))` 注册三处 UI（dock / toolview ×2 / settings.section）；Client→Host 通信用 `host.call('omo-status')`；渲染用全局 `React`（`useState` / `useEffect` / `createElement`），纯函数体无 JSX |
| 事件总线（Host） | omo-discipline 监听 `tools/result`、`goal/changed`、`agent/turn-stopping`（见第 4 节），全部 `ctx.on()` 注册并随插件生命周期回收 |
