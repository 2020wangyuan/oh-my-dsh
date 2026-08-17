/**
 * omo-core · Host half (Dynamic Cordis Plugin)
 * Part of oh-my-dsh — a DeepSeek Harness port of oh-my-openagent modules.
 *
 * Source of truth: session-registered plugin `omoc-2` / package `pkg-4`
 * (verified running, host status: running, handler `omo-status`).
 *
 * Load as a Dynamic Cordis Plugin from the DSH Web GUI:
 *   cordis_define({ plugin: { kind: 'new', idPrefix: 'omoc' },
 *                   code: { host: <this file's body> } })
 * and activate with cordis_run.
 *
 * Modules in this half:
 *   1. Rules injection   — systemPrompt.section `omo-rules` (order 150): injects
 *                          AGENTS.md + .omo/rules/** (refreshed every 60s).
 *   2. Hashline tools    — hashline_read / hashline_edit: line-anchored editing
 *                          keyed by per-line content hashes (FNV-1a 32-bit) that
 *                          reject stale-line writes.
 *   3. Comment checker   — omo_comments: flags placeholder TODOs, empty comments,
 *                          decorative separators, information-free TODOs.
 *   4. Commands          — /omo (status), /init-deep (AGENTS.md hierarchy).
 *   5. Status RPC        — 'omo-status' consumed by the Client half.
 *
 * Plain JavaScript only: no imports, no TypeScript, no JSX.
 */
return {
  apply(ctx) {
    // ================= 共享状态与工具函数 =================
    const state = {
      workspaceRoot: '',
      rulesText: '',
      registered: [],
    }

    // FNV-1a 32-bit -> 6 位十六进制内容哈希（Hashline 锚点）
    function h(s) {
      let x = 0x811c9dc5
      for (let i = 0; i < s.length; i++) {
        x ^= s.charCodeAt(i)
        x = Math.imul(x, 0x01000193) >>> 0
      }
      return x.toString(16).padStart(8, '0').slice(0, 6)
    }

    const fsx = ctx.get('fs')
    const sp = ctx.get('sandboxPolicy')
    if (sp && sp.workspaceRoot) state.workspaceRoot = sp.workspaceRoot
    if (fsx) {
      fsx.resolve('.', { cwd: state.workspaceRoot || undefined }).then((t) => {
        state.workspaceRoot = fsx.processPath(t)
      }).catch(() => { /* 工作区探测失败时保持空，后续降级为相对路径解析 */ })
    }

    // ================= Rules 注入（AGENTS.md + .omo/rules/**） =================
    async function loadRules() {
      const f = ctx.get('fs')
      if (!f || !state.workspaceRoot) { state.rulesText = ''; return }
      try {
        const parts = []
        const aTarget = await f.resolve('AGENTS.md', { cwd: state.workspaceRoot })
        const aStat = await f.stat(aTarget)
        if (aStat && aStat.type === 'file') {
          const text = await f.readText(aTarget)
          if (text.trim()) parts.push('===== AGENTS.md（项目规则，最高优先级，必须遵循）=====\n' + text)
        }
        const rDir = await f.resolve('.omo/rules', { cwd: state.workspaceRoot })
        const rStat = await f.stat(rDir)
        if (rStat && rStat.type === 'directory') {
          const entries = await f.listDir(rDir)
          for (const entry of entries.filter((e) => e.type === 'file').slice(0, 20)) {
            try {
              // 逐个读取规则文件，单个失败不影响其余规则
              const t = await f.resolve(entry.name, { cwd: state.workspaceRoot + '/.omo/rules' })
              const st = await f.stat(t)
              if (st && st.type === 'file') {
                const text = await f.readText(t)
                if (text.trim()) parts.push('===== .omo/rules/' + entry.name + ' =====\n' + text)
              }
            } catch (err) { /* 单个规则文件读取失败: 跳过 */ }
          }
        }
        state.rulesText = parts.join('\n\n')
      } catch (err) { /* rules 加载失败: 本轮不注入 */ state.rulesText = '' }
    }

    try {
      const sys = ctx.get('systemPrompt')
      if (sys) {
        loadRules()
        ctx.effect(() => sys.section({
          name: 'omo-rules',
          order: 150,
          text: () => state.rulesText
            ? '【Oh My DSH · 项目规则（AGENTS.md / .omo/rules）】\n' + state.rulesText + '\n【规则结束】'
            : '',
        }))
      }
    } catch (err) { console.error('[omo] rules init failed', err) }

    // 每 60 秒刷新一次规则缓存（避免每次组装提示词都做磁盘 IO）
    try {
      const timer = ctx.get('timer')
      if (timer) ctx.effect(() => timer.interval(() => { loadRules() }, 60000))
    } catch (err) { console.error('[omo] timer failed', err) }

    // ================= Hashline 工具 =================
    function formatHashlineResult(v) {
      if (!v || v.ok !== true) return String((v && v.error) || '读取失败')
      const head = '文件 ' + v.path + '（共 ' + v.lineCount + ' 行，指纹 ' + v.fingerprint + '）第 ' + v.start + '-' + v.end + ' 行：\n'
      return head + (v.lines || []).join('\n') + '\n\n修改时请用 hashline_edit，并携带对应行的 expectHash（形如 12#a1b2c3）。'
    }
    function formatEditResult(v) {
      if (!v || v.ok !== true) return String((v && v.error) || '编辑失败')
      return '已应用 ' + v.applied + ' 项操作于 ' + v.path + '（新指纹 ' + v.newFingerprint + '）\n' + JSON.stringify(v.actions) + '\n' + (v.note || '')
    }

    const hashlineReadDef = harness.defineTool({
      name: 'hashline_read',
      description: '带内容哈希锚点的文件读取工具（OmO Hashline 风格）。每行按 `行号#哈希| 内容` 输出。之后要修改文件请用 hashline_edit 并附上对应行的 expectHash，防止陈旧行错误。',
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: {
          path: { type: 'string', description: '要读取的文件路径（相对工作区根目录）' },
          start: { type: 'number', description: '起始行号（含，1 起）' },
          end: { type: 'number', description: '结束行号（含）' },
          cwd: { type: 'string', description: '可选：解析 path 的基准目录，默认工作区根' },
        },
        required: ['path'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) => [{ type: 'text', text: formatHashlineResult(value) }],
      },
      async execute(args, exec) {
        const f = ctx.get('fs')
        if (!f) return { ok: false, error: 'fs 服务不可用' }
        try {
          const target = await f.resolve(String(args.path || ''), { cwd: args.cwd || state.workspaceRoot || undefined, signal: exec.signal })
          const info = await f.stat(target, exec.signal)
          if (!info || info.type !== 'file') return { ok: false, error: '文件不存在或不是普通文件: ' + args.path }
          const content = await f.readText(target, exec.signal)
          const joined = content.replace(/\r\n/g, '\n')
          const raw = joined.split('\n')
          const hasTrail = joined.endsWith('\n')
          const lines = hasTrail ? raw.slice(0, -1) : raw
          const lineCount = lines.length
          const start = Math.max(1, Number(args.start) || 1)
          const end = Math.min(lineCount, Number(args.end) || lineCount)
          const out = []
          for (let i = start; i <= end; i++) {
            out.push(i + '#' + h(lines[i - 1]) + '| ' + lines[i - 1])
          }
          return { ok: true, path: String(args.path), lineCount, fingerprint: h(joined), start, end, lines: out }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    const hashlineEditDef = harness.defineTool({
      name: 'hashline_edit',
      description: '基于内容哈希锚点的安全编辑工具（OmO Hashline 风格）。每项锚定操作需携带 hashline_read 得到的 expectHash（行号#哈希，如 12#a1b2c3）；任一哈希不匹配则整批拒绝写入，避免陈旧行错误。',
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: {
          path: { type: 'string', description: '要编辑的文件路径' },
          cwd: { type: 'string', description: '可选基准目录' },
          ops: {
            type: 'array',
            description: '编辑操作（批量，按行号从大到小应用）：replace/delete 需要 line+expectHash；insertAfter/insertBefore 的 line 是锚点行；append 追加到文件末尾',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                op: { type: 'string', enum: ['replace', 'delete', 'insertAfter', 'insertBefore', 'append'] },
                line: { type: 'number' },
                expectHash: { type: 'string' },
                newContent: { type: 'string' },
              },
              required: ['op'],
            },
          },
        },
        required: ['path', 'ops'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) => [{ type: 'text', text: formatEditResult(value) }],
      },
      async execute(args, exec) {
        const f = ctx.get('fs')
        if (!f) return { ok: false, error: 'fs 服务不可用' }
        const ops = Array.isArray(args.ops) ? args.ops : []
        if (!String(args.path || '') || ops.length === 0) return { ok: false, error: '缺少 path 或 ops' }
        try {
          const target = await f.resolve(String(args.path), { cwd: args.cwd || state.workspaceRoot || undefined, signal: exec.signal })
          const content = await f.readText(target, exec.signal)
          const joined = content.replace(/\r\n/g, '\n')
          const raw = joined.split('\n')
          const hasTrail = joined.endsWith('\n')
          const lines = hasTrail ? raw.slice(0, -1) : raw
          // 1) 校验所有锚定操作的哈希
          const errors = []
          const anchored = []
          for (const op of ops) {
            if (op.op === 'append') continue
            const lineNo = Number(op.line)
            if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) {
              errors.push({ op: op.op, line: op.line, reason: '行号越界' })
              continue
            }
            const actual = h(lines[lineNo - 1])
            const expected = String(op.expectHash || '').split('#').pop() || ''
            if (expected && actual !== expected) {
              errors.push({ op: op.op, line: lineNo, expected, actual, current: lines[lineNo - 1] })
              continue
            }
            anchored.push({ op: op.op, line: lineNo, newContent: String(op.newContent || '') })
          }
          if (errors.length) {
            return { ok: false, error: '哈希校验失败，已拒绝整批写入（文件可能已被修改）', errors: errors.slice(0, 20) }
          }
          // 2) 按行号降序应用，保持原始行号有效
          anchored.sort((a, b) => b.line - a.line)
          const actions = []
          for (const a of anchored) {
            if (a.op === 'replace') { lines[a.line - 1] = a.newContent; actions.push({ op: a.op, line: a.line }) }
            else if (a.op === 'delete') { lines.splice(a.line - 1, 1); actions.push({ op: a.op, line: a.line }) }
            else if (a.op === 'insertAfter') { lines.splice(a.line, 0, a.newContent); actions.push({ op: a.op, line: a.line + 1 }) }
            else if (a.op === 'insertBefore') { lines.splice(a.line - 1, 0, a.newContent); actions.push({ op: a.op, line: a.line }) }
          }
          for (const op of ops) {
            if (op.op === 'append') { lines.push(String(op.newContent || '')); actions.push({ op: 'append', line: lines.length }) }
          }
          let newText = lines.join('\n')
          if (hasTrail || newText !== '') newText += '\n'
          await f.writeText(target, newText, undefined, exec.signal)
          return { ok: true, path: String(args.path), applied: actions.length, actions, newFingerprint: h(newText), note: '修改成功。行号已变化，如需继续编辑请重新调用 hashline_read。' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    // ================= Comment Checker =================
    const SLOP = [
      { name: '占位 TODO/FIXME', re: /^\s*(\/\/+|\/\**|\*)\s*(TODO|FIXME|XXX|HACK)\s*[:：]?\s*(implement|add|write|complete|fill|your|here|logic|代码|逻辑|实现|补充|写|改)/i },
      { name: '空注释', re: /^\s*\/\/+\s*$/ },
      { name: '装饰性注释', re: /^\s*(\/\/+|\*)\s*[\-=\*#\/\s]{6,}$/ },
      { name: '无信息 TODO', re: /^\s*\/\/+\s*(TODO|FIXME|XXX|HACK)(\s*[:：](.{0,11}$)|\s*$)/i },
    ]
    function formatComments(v) {
      if (!v || v.ok !== true) return String((v && v.error) || '扫描失败')
      if (!v.hits.length) return v.path + '：未发现 AI 味注释，干净。'
      return v.path + '：发现 ' + v.hits.length + ' 处疑似 AI 味注释（共扫 ' + v.scanned + ' 行）：\n' +
        v.hits.map((x) => '  ' + x.line + ' [' + x.kind + '] ' + x.text.trim()).join('\n')
    }
    const commentsDef = harness.defineTool({
      name: 'omo_comments',
      description: '扫描指定文件中的“AI 味”注释（占位 TODO/FIXME、空注释、装饰性注释、无信息 TODO），返回 文件:行号 清单。',
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: { path: { type: 'string', description: '要扫描的文件路径' }, cwd: { type: 'string' } },
        required: ['path'],
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: formatComments(value) }] },
      async execute(args, exec) {
        const f = ctx.get('fs')
        if (!f) return { ok: false, error: 'fs 服务不可用' }
        try {
          const target = await f.resolve(String(args.path), { cwd: args.cwd || state.workspaceRoot || undefined, signal: exec.signal })
          const content = await f.readText(target, exec.signal)
          const lines = content.replace(/\r\n/g, '\n').split('\n')
          const hits = []
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const comment = /\/\//.exec(line)
            if (!comment) continue
            const tail = line.slice(comment.index)
            for (const rule of SLOP) {
              if (rule.re.test(tail)) {
                hits.push({ line: i + 1, kind: rule.name, text: tail })
                break
              }
            }
          }
          return { ok: true, path: String(args.path), scanned: lines.length, hits: hits.slice(0, 50), total: hits.length }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    // ================= 注册工具 =================
    try { ctx.effect(() => harness.registerTool(ctx, hashlineReadDef)); state.registered.push('hashline_read') }
    catch (err) { console.error('[omo] register hashline_read failed', err) }
    try { ctx.effect(() => harness.registerTool(ctx, hashlineEditDef)); state.registered.push('hashline_edit') }
    catch (err) { console.error('[omo] register hashline_edit failed', err) }
    try { ctx.effect(() => harness.registerTool(ctx, commentsDef)); state.registered.push('omo_comments') }
    catch (err) { console.error('[omo] register omo_comments failed', err) }

    // ================= 命令 =================
    function statusText() {
      return [
        '### Oh My DSH 模块状态',
        '- 工作区: ' + (state.workspaceRoot || '（未知）'),
        '- Rules 注入: ' + (state.rulesText ? '已加载（' + state.rulesText.length + ' 字符）' : '未发现 AGENTS.md / .omo/rules'),
        '- 工具: ' + state.registered.join(', '),
        '- 纪律模块: 由 omo-discipline 插件提供（Todo Enforcer + omo_delegate 委派）',
        '- 命令: /omo 状态 · /init-deep 生成 AGENTS.md 层级',
      ].join('\n')
    }

    function extOf(name) {
      const i = name.lastIndexOf('.')
      return i >= 0 ? name.slice(i).toLowerCase() : ''
    }

    async function initDeep() {
      const f = ctx.get('fs')
      if (!f || !state.workspaceRoot) return []
      const created = []
      const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.dsh', '.next', '__pycache__', '.venv', '.omo'])
      const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.rb', '.php', '.vue', '.svelte', '.md', '.json', '.yaml', '.yml'])
      async function walk(relDir, depth) {
        const dirTarget = await f.resolve(relDir, { cwd: state.workspaceRoot })
        const info = await f.stat(dirTarget)
        if (!info || info.type !== 'directory') return
        const entries = await f.listDir(dirTarget)
        const hasSource = entries.some((e) => e.type === 'file' && SRC_EXT.has(extOf(e.name)))
        if (depth === 0 || (depth >= 1 && hasSource)) {
          const mdPath = depth === 0 ? 'AGENTS.md' : relDir + '/AGENTS.md'
          const target = await f.resolve(mdPath, { cwd: state.workspaceRoot })
          const st = await f.stat(target)
          if (!st) {
            const body = '# ' + (depth === 0 ? '项目' : relDir) + '\n\n' +
              '本文件由 /init-deep 自动生成。请在实际理解该目录代码后补充：职责说明、关键约定、易错点。\n\n' +
              '当前子项：\n' +
              entries.filter((e) => e.type === 'file').slice(0, 40).map((e) => '- ' + e.name).join('\n') + '\n'
            await f.writeText(target, body)
            created.push(mdPath)
          }
        }
        if (depth < 2) {
          for (const e of entries) {
            if (e.type !== 'directory') continue
            if (SKIP.has(e.name)) continue
            await walk(depth === 0 ? e.name : relDir + '/' + e.name, depth + 1)
          }
        }
      }
      await walk('.', 0)
      return created
    }

    try {
      const commands = ctx.get('commands')
      if (commands) {
        ctx.effect(() => commands.register({
          name: 'omo',
          description: '查看 Oh My DSH 模块状态与用法',
          handler: () => ({ kind: 'success', text: statusText() }),
        }))
        ctx.effect(() => commands.register({
          name: 'init-deep',
          description: '生成根级与子目录级 AGENTS.md 骨架（OmO /init-deep 风格）',
          handler: async () => {
            try {
              const created = await initDeep()
              return {
                kind: 'success',
                text: created.length
                  ? '已生成 ' + created.length + ' 个 AGENTS.md：\n' + created.map((x) => ' - ' + x).join('\n')
                  : '没有需要生成的 AGENTS.md（均已存在或目录不含源文件）',
              }
            } catch (err) {
              return { kind: 'error', text: String((err && err.message) || err) }
            }
          },
        }))
      }
    } catch (err) { console.error('[omo] commands init failed', err) }

    // ================= 状态 RPC（供 Client 状态条与设置页调用） =================
    harness.handle('omo-status', async () => ({
      workspaceRoot: state.workspaceRoot || '',
      rules: !!state.rulesText,
      hashline: true,
      comments: true,
      registered: state.registered,
      commands: ['/omo', '/init-deep'],
    }))
  },
}