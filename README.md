# oh-my-dsh

> Bring oh-my-openagent's discipline and agent-organization ideas to DeepSeek Harness — as two transient **Dynamic Cordis Plugins** you load from the Web GUI.

<!-- Badge placeholders — replace with real shields.io links at first release -->
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-orange.svg) ![Status: experimental](https://img.shields.io/badge/status-experimental-lightgrey.svg)

[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OmO) wraps an agent in rules, hashline-keyed edits, comment hygiene, ultrawork (ULW) goal enforcement, and delegation. `oh-my-dsh` ports those ideas onto [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH), a Cordis-based plugin harness. The deliverables are **Dynamic Cordis Plugins**: each plugin has a Host (Node.js) half and optionally a Client (browser) half, is written in plain JavaScript (no imports, no TypeScript, no JSX), is defined and activated through the Web GUI's `cordis_define` / `cordis_run`, and disappears when the DSH process restarts.

Two plugins ship in this repository:

- **`omo-core`** (Host + Client) — rules injection, hashline-anchored editing, comment checking, two slash commands, three Client UI surfaces.
- **`omo-discipline`** (Host only) — ULW goal discipline, evidence audit, a turn-ending enforcer, and delegation/team tools.

## ✨ Features

### Documentation discipline

- **Rules injection** — `AGENTS.md` plus every file under `.omo/rules/**` (up to 20) are injected into the system prompt as the `omo-rules` section (order 150), refreshed every 60 seconds.
- **`/init-deep`** — generates root-level and subdirectory `AGENTS.md` skeletons for your repository.

### Safe editing

- **`hashline_read` / `hashline_edit`** — line-anchored file editing keyed by per-line content hashes (FNV-1a 32-bit, rendered as 6 hex characters). Every anchored operation carries the `expectHash` from the read; if any hash mismatches, the whole batch is rejected — stale-line writes never land.

### Code hygiene

- **`omo_comments`** — scans a file for "AI-flavored" comments: placeholder TODO/FIXME, empty comments, decorative separator lines, and information-free TODOs.

### Goal execution (ULW)

- **ULW discipline prompt** — a system-prompt section (order 152) that turns messages starting with `ulw` / `ultrawork` into a persisted `create_goal`, and forbids empty-handed rounds while the goal is active.
- **`/ulw`** — one command to start ultrawork mode (`goals.create`, 50 continuation rounds).
- **Evidence audit** — while a goal is active, turn checkpoints (throttled to 30 s, last 12 kept) are written to `.omo/ulw-loop/<session>.md`.
- **Todo Enforcer** — on `agent/turn-stopping`, if the goal is active and the turn made zero tool calls, the agent is steered back (at most once per goal).

### Delegation & teams

- **`omo_delegate`** — one background (or awaited) child subagent, picked by category (`deep` / `quick` / `visual` / `ultrabrain`).
- **`omo_team`** — Team Mode: you (the lead) fan out to up to 6 parallel member subagents and aggregate a structured report; a failing member never sinks the team.

### Client UI (from `omo-core`)

- A status strip above the composer (`conversation.input.dock`, id `omo`, order 30): rules / hashline / comments activity plus workspace root.
- Compact tool cards for `hashline_read` and `hashline_edit` (`tool.call.toolview`).
- An "Oh My DSH" settings page (`settings.section`, id `omo-dsh`, order 50).

## 📦 Module mapping to OmO

| OmO inspiration module | Port in oh-my-dsh | Status |
| --- | --- | --- |
| `hashline-core` | `hashline_read` / `hashline_edit` tools | ✅ Ported |
| `agents-md-core` | Rules injection (`omo-rules` section) + `/init-deep` | ✅ Ported |
| `comment-checker-core` | `omo_comments` tool | ✅ Ported |
| `rules-engine` | Rules loading/refresh behind the `omo-rules` section | ✅ Ported |
| `delegate-core` | `omo_delegate` tool (4 categories) | ✅ Ported |
| `team-core` | `omo_team` tool (Team Mode) | ✅ Ported (semantics) |
| tmux live team visualization | — | ⚠️ Not ported / downgraded |
| 11 named discipline agents | condensed into one ULW discipline prompt + Todo Enforcer | ⚠️ Not ported / downgraded |
| team worktree + mailbox infrastructure | — | ⚠️ Not ported / downgraded |

## 🚀 Quick Start

Prerequisite: a running DSH Web GUI with Dynamic Cordis Plugin support (`cordis_define` / `cordis_run` visible in the agent toolset).

1. **Define** — in the Web GUI, call `cordis_define` for a new plugin:
   - `omo-core`: `idPrefix` `omoc`, paste the payload of `src/omo-core/host.js` into `code.host` and `src/omo-core/client.js` into `code.client`.
   - `omo-discipline`: `idPrefix` `omod`, paste `src/omo-discipline/host.js` into `code.host` only (Host-only plugin, no client code).
2. **Run** — call `cordis_run` with the returned `pluginId` / `packageId` for each plugin.
3. **Approve** — the first activation of a Client half (the `omo-core` browser code) requires your approval in the GUI; approve it to activate the dock, tool cards, and settings page.

See [docs/installation.md](docs/installation.md) for the full walkthrough and verification checklist.

### 快速开始 / Quick Start（中文）

1. 打开 DSH Web GUI，调用 `cordis_define` 新建插件：`omo-core` 填 `idPrefix: omoc`（`code.host` 粘贴 `src/omo-core/host.js`，`code.client` 粘贴 `src/omo-core/client.js`）；`omo-discipline` 填 `idPrefix: omod`（仅 `code.host`，粘贴 `src/omo-discipline/host.js`）。
2. 用返回的 `pluginId` / `packageId` 调用 `cordis_run` 激活。
3. Client 端（浏览器侧）首次运行需在 GUI 中手动批准。
4. 验证：输入 `/omo` 查看状态；输入框上方应出现 OmO 状态条（rules✓ · hashline✓ · comments✓）。

## 🧩 Usage at a glance

| Surface | What it does |
| --- | --- |
| `hashline_read <path>` | Reads a file, each line prefixed with `` 行号#哈希&#124; 内容 `` (line number, hash, content); the hashes anchor later edits. |
| `hashline_edit` | Batch ops (`replace` / `delete` / `insertAfter` / `insertBefore` / `append`) with `expectHash` per anchored op; any mismatch rejects the whole batch. |
| `omo_comments <path>` | Returns a `file:line` list of AI-flavored comments with their kind. |
| `omo_delegate` | Delegate one subagent by `deep` / `quick` / `visual` / `ultrabrain` category; `await: false` runs it in the background. |
| `omo_team` | Fan out to ≤ 6 member subagents and aggregate a structured report. |
| `/omo` | Plugin status: workspace root, rules load state, registered tools, commands. |
| `/init-deep` | Generate root + subdirectory `AGENTS.md` skeletons. |
| `/ulw <objective>` | Start ultrawork mode: persisted goal, 50 rounds, evidence audit. |
| Dock strip / tool cards / settings page | Client surfaces rendered by `omo-core`. |

Per-tool parameter tables, output formats, and the ULW workflow: [docs/usage.md](docs/usage.md).

## 🧭 Documentation

- [docs/installation.md](docs/installation.md) — environment requirements and step-by-step plugin installation.
- [docs/usage.md](docs/usage.md) — every tool, command, and UI surface, with parameters and examples.
- [docs/api-reference.md](docs/api-reference.md) — DSH service contracts and RPC details (part of the `docs/` set for this release).
- [docs/omo-mapping.md](docs/omo-mapping.md) — source-verified mapping of every upstream OmO module to its oh-my-dsh counterpart, plus what was deliberately not ported.

## ⚠️ Notes

- **Plugins are transient.** Dynamic Cordis Plugins live in the current DSH process; a process restart removes them. Re-define and re-run to reinstall.
- **DSH services required.** The code reads optional services via `ctx.get(...)` and degrades gracefully when a service is missing (`fs`, `systemPrompt`, `timer`, `commands`, `sandboxPolicy`, `harness`, and, on the Client, `slots`).
- **Delegation needs `subagents`.** `omo_delegate` and `omo_team` fail with a clear error unless the host composition provides a `subagents` service with at least one provider.
- **Rules injection needs a workspace.** Rules are only injected when a workspace root is detected and it contains `AGENTS.md` or `.omo/rules/`.
- **ULW evidence needs a directory.** Checkpoints are written only when `.omo/ulw-loop/` already exists; the plugin never creates it implicitly.

## 🙏 Acknowledgements

Inspired by [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (`github.com/code-yeongyu/oh-my-openagent`). The module mapping above credits its core modules; this port reimplements their ideas against DSH's Dynamic Cordis Plugin API.

## 📄 License

Released under the MIT License.
