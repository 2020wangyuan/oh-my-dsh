# Usage

This document covers every tool, slash command, and Client UI surface provided by `oh-my-dsh`. Install the plugins first — see [installation.md](installation.md).

All tool names below are prefixed `omo_` / `hashline_` and appear in the agent's tool list once the plugins are running. Paths are resolved against the workspace root unless a `cwd` is given.

---

## Tools

### `hashline_read` — hashline-anchored file read

Reads a file and prints each line prefixed with its content hash. The hash is FNV-1a 32-bit rendered as 6 lowercase hex characters (`12#a1b2c3| <line content>`). These hashes are the anchors that make later edits stale-line-safe.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | ✅ | File path, relative to the workspace root (or `cwd`). |
| `start` | number | — | First line to print, 1-based. Default 1. |
| `end` | number | — | Last line to print, inclusive. Defaults to the last line. |
| `cwd` | string | — | Base directory for resolving `path`. Default workspace root. |

**Output format**

```
文件 <path>（共 <lineCount> 行，指纹 <fingerprint>）第 <start>-<end> 行：
12#a1b2c3| <line 12 content>
13#d4e5f6| <line 13 content>

修改时请用 hashline_edit，并携带对应行的 expectHash（形如 12#a1b2c3）。
```

`fingerprint` is the hash of the whole file and changes on every edit.

**Example flow** — always pair read with edit:

1. `hashline_read` on the file to get current line hashes.
2. Build `hashline_edit` ops using the `expectHash` values printed by the read (either `a1b2c3` or `12#a1b2c3` is accepted).
3. After a successful edit, the tool notes that line numbers have shifted — call `hashline_read` again before planning further edits.

### `hashline_edit` — hashline-anchored safe edit

Applies a batch of anchored operations to a file. **Any `expectHash` mismatch rejects the entire batch** and leaves the file untouched — this is the stale-line protection: if the file changed since your read, the write fails loudly instead of corrupting lines.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | ✅ | File path (relative to workspace root or `cwd`). |
| `ops` | array | ✅ | Batch of operations, applied by descending line number. |
| `cwd` | string | — | Base directory for resolving `path`. |

**Operation items** (`ops[]`):

| Field | Type | Description |
| --- | --- | --- |
| `op` | string (required) | `replace` · `delete` · `insertAfter` · `insertBefore` · `append` |
| `line` | number | Target line. Required for every op except `append`. `insertAfter` / `insertBefore` use it as the anchor line. |
| `expectHash` | string | Hash to verify for that line (`replace` / `delete` / `insert*`). Omit or leave empty to skip verification — but then you lose stale-line protection; always pass the hash from `hashline_read`. |
| `newContent` | string | Replacement / insertion content. |

**Semantics**

- Anchored ops (`replace`, `delete`, `insertAfter`, `insertBefore`) are hash-checked **before** any write; if one or more checks fail, the whole batch is refused and up to 20 mismatches are reported.
- Valid ops are applied in **descending line order**, so earlier line numbers stay valid while the batch runs.
- `append` needs no `line` / `expectHash` and adds the content at the end of the file, after the anchored ops.
- The file keeps a single trailing newline (it is preserved when present).

**Output**

```
已应用 <n> 项操作于 <path>（新指纹 <newFingerprint>）
[{"op":"replace","line":12}, ...]
修改成功。行号已变化，如需继续编辑请重新调用 hashline_read。
```

### `omo_comments` — AI-flavored comment scanner

Scans a single file and returns a `文件:行号` list of comments that look like AI boilerplate leftovers.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | ✅ | File path to scan. |
| `cwd` | string | — | Base directory for resolving `path`. |

Detected kinds:

| Kind | Matches |
| --- | --- |
| `占位 TODO/FIXME` | Placeholder TODO/FIXME/XXX/HACK with a generic instruction (`implement`, `add`, `write`, `complete`, `fill in`, `你的代码`, `逻辑`, …) |
| `空注释` | Empty comment lines (`//` with nothing after) |
| `装饰性注释` | Decorative separator lines made of `- = * # /` runs |
| `无信息 TODO` | TODO/FIXME/XXX/HACK with no or a nearly empty description |

**Output format** — clean file:

```
<path>：未发现 AI 味注释，干净。
```

File with hits (at most 50 are listed; `total` holds the full count):

```
<path>：发现 3 处疑似 AI 味注释（共扫 120 行）：
  7 [占位 TODO/FIXME] // TODO: add logic here
  12 [空注释] //
  19 [装饰性注释] // ================
```

### `omo_delegate` — category-based subagent delegation

Delegates **one** child subagent to work in parallel, with a role prompt chosen by category. By default it waits for the child and returns its report; pass `await: false` to fire and forget.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `task` | string | ✅ | Self-contained task description. The child sees no parent context, so state everything the child needs. |
| `category` | enum | — | `deep` (default) · `quick` · `visual` · `ultrabrain` |
| `await` | boolean | — | `true` (default) waits for completion; `false` returns immediately with the child id in the background. |
| `provider` | string | — | Subagent provider name; defaults to the first one registered with `subagents`. |

**When to use each category**

| Category | Role persona | Use when |
| --- | --- | --- |
| `deep` | Hephaestus (autonomous executor) | End-to-end implementation or research across the codebase; no step-by-step confirmation. |
| `quick` | Fast executor | Single-file small changes, spelling, logging, trivial fixes. Expect a terse reply. |
| `visual` | Visual front-end engineer | UI/UX, styling, components, interaction design; accessibility matters. |
| `ultrabrain` | Prometheus (architect) | Complex logic and architecture decisions; proposes a plan and tradeoffs first, then implements. |

**Output**

- `await: false` → `已委派子代理 [<provider> / <category>] → <child>（后台运行中，可稍后跟进）`
- `await: true` → `结束原因: <stopReason>` plus the child's text output (capped at 6000 chars). The tool times out after 15 minutes.

Requires a `subagents` service with at least one provider; otherwise it errors (`subagents 服务不可用` / no provider).

### `omo_team` — Team Mode fan-out

Runs a temporary team: you are the lead (the OmO "sisyphus" role), up to **6 parallel member subagents** work independently, and the tool aggregates a structured report once all of them settle. Member failures do not sink the team.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `objective` | string | ✅ | The team's overall objective. You keep ownership and integrate the results. |
| `members` | array | ✅ | Member breakdown, max 6 entries (see below). |
| `provider` | string | — | Subagent provider; defaults to the first registered one. |

**`members[]` structure**

```json
{
  "objective": "Ship the omo-core documentation",
  "members": [
    { "name": "hephaestus", "kind": "deep",     "role": "深度实现", "task": "Implement the parser in src/parse.js" },
    { "name": "librarian",  "kind": "quick",    "role": "文档撰写", "task": "Write the README quick start" },
    { "name": "prometheus", "kind": "ultrabrain","role": "架构评审", "task": "Review the module split and flag risks" },
    { "name": "oracle",     "kind": "deep",     "role": "调研",     "task": "Survey existing DSH services we should reuse" }
  ]
}
```

Each member requires `name` and `task`; `role` is a one-line responsibility and `kind` picks the persona prompt (`deep` / `quick` / `visual` / `ultrabrain`, default `deep`). Members are published one by one (each starts running as it is published) and then awaited together.

**Result format**

```
🤝 团队收队：3/4 名成员成功（目标：<objective>）

◆ hephaestus（深度实现）—— ✅ 完成 [done]
    实现了 parse.js，产物路径 src/parse.js …
◆ librarian（文档撰写）—— ❌ 失败 [error]
    启动失败: …

（组长请审阅各成员汇报并将其整合为最终交付。）
```

- Each member line shows `✅ 完成` / `❌ 失败` with its stop reason and indented output (capped at 4000 chars per member).
- `Promise.allSettled` semantics: if a member throws or fails, its entry reports `ok: false` and the team still completes; member start failures do not abort the other members.
- The tool times out after 30 minutes. Requires a `subagents` service.

---

## Commands

### `/omo` — plugin status

Prints the current `omo-core` status:

```
### Oh My DSH 模块状态
- 工作区: /path/to/workspace
- Rules 注入: 已加载（1234 字符）  |  或  未发现 AGENTS.md / .omo/rules
- 工具: hashline_read, hashline_edit, omo_comments
- 纪律模块: 由 omo-discipline 插件提供（Todo Enforcer + omo_delegate 委派）
- 命令: /omo 状态 · /init-deep 生成 AGENTS.md 层级
```

Use it to confirm both plugins are alive and rules are being injected.

### `/init-deep` — AGENTS.md hierarchy skeleton

Generates a root `AGENTS.md` plus subdirectory `AGENTS.md` skeletons, OmO `/init-deep` style:

- Walks the workspace to a **depth of 2** from the root.
- Always generates the root `AGENTS.md` (when missing).
- At depth ≥ 1, generates `AGENTS.md` only in directories that contain source files (extensions: `.ts .tsx .js .jsx .py .go .rs .java .kt .c .cpp .h .rb .php .vue .svelte .md .json .yaml .yml`).
- Skips `.git`, `node_modules`, `dist`, `build`, `.dsh`, `.next`, `__pycache__`, `.venv`, `.omo`.
- Never overwrites an existing `AGENTS.md`; each skeleton lists up to the first 40 files of that directory for you to annotate.

Output reports the number and paths of generated files, or that nothing needed generating.

### `/ulw <objective>` — start ultrawork mode

Starts ULW (ultrawork): a persisted, long-running goal loop for the given objective. `objective` is everything after the command.

- Creates the goal via the `goals` service with **`maxGoalRounds: 50`** of automatic continuation.
- Refuses to start (with the existing goal's phase and objective) if a non-complete goal already exists — finish or pause it first.
- On success: `🌀 ULW 模式已启动`, the discipline contract (every round must advance or report a blocker), and the evidence-audit note.

The same outcome happens implicitly when a user message starts with `ulw` / `ultrawork` — the discipline prompt then calls `create_goal` with the request minus the keyword.

## ULW standard workflow

1. **Start.** Either the user opens with `ulw` / `ultrawork <objective>` (or you run `/ulw <objective>`): a persisted goal is created for the full request minus the keyword. While the goal is `active`, no round may end empty-handed.
2. **Advance every round.** Each round must move the goal forward — tool calls, file operations, or delegating subagents. If a round ends with **zero tool calls** while a goal is active, the **Todo Enforcer** reacts on `agent/turn-stopping` and steers a reminder back into your next-step queue: you are pulled back into work, or must explicitly state the blocker and next steps. A goal is nudged at most once — the guard is reset when the goal changes (`goal/changed`).
3. **Stage updates.** Update the goal as phases progress (`get_goal` for the current id/revision, then `update_goal`). Keep the objective current so the loop targets the real work.
4. **Finish.** Mark the goal `complete` via `update_goal` once it is genuinely done. If the same blocking condition persists, report the concrete condition instead of stopping silently.

**Where to read the evidence audit.** While a goal is active, turn checkpoints (throttled to one per 30 s, newest 12 kept) are written to `.omo/ulw-loop/<session>.md` in the workspace — **only if that directory already exists** (the plugin never creates it). Each write rewrites the file with the current checkpoint list; each line records the ISO timestamp, turn number, tool-call count, and the goal objective:

```
# ULW 证据审计 · <agentId>

- 2025-08-14T10:00:00.000Z · turn 3 · 工具 4 · Ship the omo-core documentation
```

The file is the durable record of ultrawork execution for that session.

## Client UI surfaces (from `omo-core`)

| Surface | Slot / id | Shows |
| --- | --- | --- |
| Status strip above the composer | `conversation.input.dock`, id `omo`, order 30 | `OmO · rules✓/✗ · hashline✓ · comments✓ · <workspace root>` — a small monospace strip (or `OmO 加载中…` before the status RPC answers). |
| Tool cards | `tool.call.toolview` for `hashline_read` and `hashline_edit` | A colored chip (`OmO 读取` cyan / `OmO 编辑` purple) plus a compact summary: path, line range (reads), operation count (edits). |
| Settings page | `settings.section`, id `omo-dsh`, order 50 | An "Oh My DSH" page listing the workspace root and one row per module: Rules injection, Hashline editing, Comment checker, discipline execution (Todo Enforcer + `omo_delegate`), and the available commands. |

All three surfaces pull their data through the Host RPC `omo-status`, which returns `{ workspaceRoot, rules, hashline, comments, registered, commands }`.

For the underlying DSH service contracts (system prompt sections, tool registration, subagents, goals), see [api-reference.md](api-reference.md).
