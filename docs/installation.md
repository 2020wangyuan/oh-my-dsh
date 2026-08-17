# Installation

This guide installs the two `oh-my-dsh` plugins into a running DeepSeek Harness (DSH) instance from the Web GUI. No files on disk are modified — the plugins are defined and activated inside the current DSH process.

## Environment requirements

- A running **DSH Web GUI** whose agent session exposes the Dynamic Cordis Plugin tools: `cordis_define`, `cordis_run`, and (for Client halves) the approval flow.
- The plugin code is plain JavaScript — no build step, no dependencies to install, no Node modules.
- DSH services used by the plugins (`fs`, `systemPrompt`, `timer`, `commands`, `sandboxPolicy`, `harness`, and optionally `subagents`) are read via `ctx.get(...)`; the code degrades gracefully when a service is unavailable, but features tied to a missing service are inert.

## Step 1 — Install `omo-core` (Host + Client)

1. In the Web GUI, call `cordis_define` with a **new** plugin:
   - `plugin`: `{ kind: 'new', idPrefix: 'omoc' }`
   - `code.host`: the file payload of `src/omo-core/host.js` (the `return { apply(ctx) { ... } }` body; the header comment is optional).
   - `code.client`: the file payload of `src/omo-core/client.js` (same shape).
   - Provide a `name` (e.g. `omo-core`) and a one-line `purpose`.
2. `cordis_define` returns the allocated `pluginId` and `packageId`.
3. Call `cordis_run` with those IDs (`mode: 'run'`).
4. The **first activation of the Client half requires your approval in the GUI**. Approve it — the Host half activates immediately; the browser surfaces (dock strip, tool cards, settings page) appear once the Client half is approved.

### Verification for `omo-core`

- Type `/omo` in the composer: the reply lists the workspace root, rules load state, registered tools (`hashline_read`, `hashline_edit`, `omo_comments`), and the two commands.
- A status strip appears above the composer: `OmO · rules✓/✗ · hashline✓ · comments✓ · <workspace root>`.
- Open the model's available tools (`Tool.listTools`): `hashline_read`, `hashline_edit`, and `omo_comments` are present.
- Open Settings → "Oh My DSH" section: the module status rows render.
- Rules injection activates only when the workspace contains `AGENTS.md` or `.omo/rules/**` — see Preconditions below.

## Step 2 — Install `omo-discipline` (Host only)

1. Call `cordis_define` with a **new** plugin:
   - `plugin`: `{ kind: 'new', idPrefix: 'omod' }`
   - `code.host`: the file payload of `src/omo-discipline/host.js`.
   - No `code.client` — this plugin is Host-only.
2. Call `cordis_run` with the returned IDs (`mode: 'run'`). No browser approval is needed (no Client half).

### Verification for `omo-discipline`

- `Tool.listTools` now also shows `omo_delegate` and `omo_team` (five `omo_*` tools in total across both plugins).
- Sending a message whose first word is `ulw` (or `ultrawork`) creates a persisted goal (`create_goal`) for that objective.
- `/ulw <objective>` starts ultrawork mode and reports `🌀 ULW 模式已启动`.
- These tools return an error ("`subagents` 服务不可用" / no provider) when the host composition does not provide a `subagents` service — see Preconditions below.

## Preconditions for optional features

| Feature | Required condition |
| --- | --- |
| Rules injection (`omo-rules` section) | A workspace root is detected *and* it contains `AGENTS.md` or a `.omo/rules/` directory (files there are injected, up to 20). |
| `/init-deep` | Workspace root detected; it walks up to 2 directory levels and creates `AGENTS.md` files where missing. |
| ULW evidence audit | `.omo/ulw-loop/` **already exists** in the workspace. Checkpoints are written only when the directory is present; the plugin never creates it implicitly. |
| `omo_delegate` / `omo_team` | A `subagents` service with at least one registered provider in the host composition. |

## Reinstalling after a restart

Dynamic Cordis Plugins are transient: they exist only in the current DSH process and vanish when the process restarts. To restore them after a restart, repeat Steps 1–2 (define → run → approve). Definitions do not survive restarts, so there is nothing to clean up.

## Troubleshooting

- `/omo` shows `未发现 AGENTS.md / .omo/rules` → the workspace exists but has no rules files yet; run `/init-deep` or add an `AGENTS.md`.
- Client surfaces do not appear → the Client activation may still be pending approval, or an earlier approval was rejected; re-run with `cordis_run` and approve.
- `omo_delegate` / `omo_team` fail to start → the session lacks a `subagents` service; delegation is unusable until the host composition provides one.
- A tool errors with `fs 服务不可用` → the session lacks the `fs` service; nearly all `omo-core` and most `omo-discipline` features require it.
- No ULW audit file appears in your shell-visible `.omo/ulw-loop/` → the plugin resolves paths against the **sandbox workspace root** (`sandboxPolicy.workspaceRoot`), which may differ from your shell's working directory (rules injection and the audit use that same root). Create `.omo/ulw-loop/` under *that* root, not your shell cwd.

Exact DSH service contracts behind these features are described in [api-reference.md](api-reference.md).
