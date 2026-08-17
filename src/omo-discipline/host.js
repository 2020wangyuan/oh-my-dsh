/**
 * omo-discipline · Host half (Dynamic Cordis Plugin)
 * Part of oh-my-dsh — a DeepSeek Harness port of oh-my-openagent modules.
 *
 * Source of truth: session-registered plugin `omod-3` / package `pkg-7`
 * (verified running, current package).
 *
 * Load as a Dynamic Cordis Plugin from the DSH Web GUI:
 *   cordis_define({ plugin: { kind: 'new', idPrefix: 'omod' },
 *                   code: { host: <this file's body> } })
 * and activate with cordis_run.
 *
 * Modules in this half:
 *   1. ULW discipline     — systemPrompt.section `omo-ulw-discipline` (order 152):
 *                            one-word trigger («ulw» / «ultrawork») → create_goal,
 *                            no empty-handed turns while the goal is active.
 *   2. /ulw command       — deterministic ULW activation (goals.create, 50 rounds).
 *   3. Evidence audit     — turn checkpoints (throttled 30s, last 12) written to
 *                            .omo/ulw-loop/<session>.md while a goal is active.
 *   4. Todo Enforcer      — agent/turn-stopping: if the goal is active and the
 *                            turn made zero tool calls, steer the agent back
 *                            (at most once per goal).
 *   5. omo_delegate       — delegate ONE background child by category
 *                            (deep / quick / visual / ultrabrain).
 *   6. omo_team           — Team Mode: lead (this agent) + up to 6 parallel
 *                            member children; aggregate a structured report.
 *
 * Plain JavaScript only: no imports, no TypeScript, no JSX.
 */
return {
  apply(ctx) {
    const state = {
      activity: new Map(), // agentId -> { tools: number }（当前回合内工具调用数）
      nudged: new Set(),   // 已拉回过的 agentId（同一目标只拉回一次）
      delegations: 0,
      lastEvidenceWrite: 0,
      checkpoints: [],     // ULW 证据审计：{ at, turn, tools, objective }
    }

    // ============ ULW（ultrawork / ulw-loop）纪律提示 ============
    try {
      const sys = ctx.get('systemPrompt')
      if (sys) {
        ctx.effect(() => sys.section({
          name: 'omo-ulw-discipline',
          order: 152,
          text: '【Oh My DSH · ULW 纪律】当用户消息以「ulw」或「ultrawork」开头，或请求是应持续推进的长期目标时，立即用 create_goal 建立持久目标（objective 为去掉关键词后的完整请求），随后用 update_goal 在每个阶段更新。目标处于 active 阶段时，任何回合都不得空手结束：要么继续推进（工具调用 / 文件操作 / 委派子代理），要么明确报告阻塞。目标真正完成时用 update_goal 标记 complete。',
        }))
      }
    } catch (err) { console.error('[omo-discipline] ulw section failed', err) }

    // ============ /ulw 命令：一个词激活持久目标模式 ============
    try {
      const commands = ctx.get('commands')
      if (commands) {
        ctx.effect(() => commands.register({
          name: 'ulw',
          description: '启动 ULW（ultrawork）持久目标模式：不干完不罢休（证据审计写入 .omo/ulw-loop/）',
          input: { hint: '<要持续推进的目标描述>' },
          handler: async (invocation) => {
            const goals = ctx.get('goals')
            if (!goals) return { kind: 'error', text: 'goals 服务不可用' }
            const objective = invocation.rawInput.replace(/^\s+/, '').trim()
            if (!objective) return { kind: 'error', text: '用法: /ulw <要持续推进的目标>' }
            try {
              const existing = goals.get(invocation.agent)
              if (existing && existing.phase !== 'complete') {
                return { kind: 'error', text: '已存在阶段为 ' + existing.phase + ' 的目标：「' + existing.objective + '」。请先完成或暂停它，再启动新的 ULW。' }
              }
            } catch (err) { /* 无目标：正常创建 */ }
            try {
              // 50 回合自动续跑额度；此后每回合由 Todo Enforcer 保证不空手收尾
              goals.create(invocation.agent, { objective, maxGoalRounds: 50 })
              return { kind: 'success', text: '🌀 ULW 模式已启动。目标：「' + objective + '」。\n纪律：不干完不罢休——每个回合都必须推进（工具/文件/委派）或明确报告阻塞。\n证据审计：目标 active 期间每 30 秒的回合 checkpoint 会写入 .omo/ulw-loop/。' }
            } catch (err) {
              return { kind: 'error', text: '启动失败: ' + String((err && err.message) || err) }
            }
          },
        }))
      }
    } catch (err) { console.error('[omo-discipline] ulw command failed', err) }

    // ============ 证据审计写入 .omo/ulw-loop/ ============
    async function writeEvidence(agentId) {
      const f = ctx.get('fs')
      const sp = ctx.get('sandboxPolicy')
      if (!f || !sp || !sp.workspaceRoot || state.checkpoints.length === 0) return
      const safeId = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '_')
      try {
        const base = sp.workspaceRoot + '/.omo/ulw-loop'
        const dirTarget = await f.resolve('.', { cwd: base })
        const di = await f.stat(dirTarget)
        if (!di || di.type !== 'directory') return // 目录不存在则不写，避免隐式创建
        const target = await f.resolve(safeId + '.md', { cwd: base })
        const lines = state.checkpoints.map((c) => '- ' + new Date(c.at).toISOString() + ' · turn ' + c.turn + ' · 工具 ' + c.tools + ' · ' + c.objective)
        await f.writeText(target, '# ULW 证据审计 · ' + agentId + '\n\n' + lines.join('\n') + '\n')
      } catch (err) { /* 证据写入失败不影响主流程 */ }
    }

    // ---------- 统计每个 agent 当前回合的工具活动 ----------
    ctx.on('tools/result', (exec, result) => {
      const id = exec && exec.agent && exec.agent.id
      if (!id) return
      const cur = state.activity.get(id) || { tools: 0 }
      cur.tools += 1
      state.activity.set(id, cur)
    })

    // 目标发生变化（创建/编辑/完成/阻塞）时，允许再次拉回
    ctx.on('goal/changed', (payload) => {
      const agentId = payload && payload.agent && payload.agent.id
      if (agentId) state.nudged.delete(agentId)
    })

    // ---------- Todo Enforcer + ULW 证据审计：回合收尾钩子 ----------
    ctx.on('agent/turn-stopping', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      const id = agent.id
      const used = (state.activity.get(id) || { tools: 0 }).tools
      const goals = ctx.get('goals')
      if (goals) {
        let goal
        try { goal = goals.get(agent) } catch (err) { goal = undefined }
        if (goal && goal.phase === 'active' && used === 0 && !state.nudged.has(id)) {
          state.nudged.add(id)
          const objective = typeof goal.objective === 'string' && goal.objective ? goal.objective : '（未命名目标）'
          const text = '【OmO 纪律执行】当前目标尚未完成：「' + objective + '」。本回合你没有调用任何工具或文件操作。请不要空手结束回合：继续推进目标（读取文件、搜索、写代码、委派子代理均可）；若确实受阻，请明确说明阻塞点并给出下一步建议。'
          try {
            // steer 会把这条消息送进 agent 的 next-step 队列并唤醒驱动
            agent.steer({ id: 'omo:' + Date.now() + ':' + id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'omo-discipline' } })
          } catch (err) { console.error('[omo-discipline] steer failed', err) }
        }
        // ULW 证据审计：目标活跃时写回合 checkpoint（30 秒节流 + 上限 12 条）
        if (goal && goal.phase === 'active') {
          const now = Date.now()
          if (now - state.lastEvidenceWrite > 30000) {
            state.lastEvidenceWrite = now
            state.checkpoints.push({ at: now, turn: payload.turn, tools: used, objective: String(goal.objective || '').slice(0, 200) })
            if (state.checkpoints.length > 12) state.checkpoints.shift()
            writeEvidence(id)
          }
        }
      }
      state.activity.set(id, { tools: 0 })
    })

    // ---------- omo_delegate：按类别委派背景子代理 ----------
    const CATEGORIES = {
      deep: '你是 Hephaestus（自主深度执行者）：独立探索代码库、调研现有模式并端到端完成，不要要求逐步确认，最后汇报做了什么、关键决策、产物路径与遗留问题。',
      quick: '你是快速执行者：单文件小改动、拼写/日志/简单任务。直接完成，回答精简。',
      visual: '你是视觉前端工程师：UI/UX、样式、组件与交互设计。注重可访问性与视觉细节。',
      ultrabrain: '你是资深架构师（ultrabrain）：复杂逻辑与架构决策。先给出方案与权衡，再落地实现。',
    }

    function formatDelegate(v) {
      if (!v || v.ok !== true) return String((v && v.error) || '委派失败')
      const head = '已委派子代理 [' + v.provider + ' / ' + v.category + '] → ' + v.child
      if (v.background) return head + '（后台运行中，可稍后跟进）'
      return head + '\n结束原因: ' + v.stopReason + '\n' + (v.output || '（子代理未返回文本结果）')
    }

    const delegateDef = harness.defineTool({
      name: 'omo_delegate',
      description: '按类别委派一个子代理并行工作（OmO Background Agents 风格）。类别自动匹配执行策略：deep（深度调研+实现）/ quick（快速小改）/ visual（前端视觉）/ ultrabrain（架构决策）。默认等待子代理完成并返回结果。',
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: {
          task: { type: 'string', description: '交给子代理的完整任务描述（自包含，子代理看不到本会话上下文）' },
          category: { type: 'string', enum: ['deep', 'quick', 'visual', 'ultrabrain'], description: '任务类别，默认 deep' },
          await: { type: 'boolean', description: 'true=等待完成并返回结果（默认）；false=立即返回子代理 id 后台运行' },
          provider: { type: 'string', description: '可选：子代理 provider 名（默认取第一个可用）' },
        },
        required: ['task'],
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: formatDelegate(value) }] },
      timeoutMs: 900000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sub = ctx.get('subagents')
        if (!sub) return { ok: false, error: 'subagents 服务不可用' }
        const agent = exec && exec.agent
        if (!agent) return { ok: false, error: '缺少调用方 agent 上下文' }
        const task = String(args.task || '')
        if (!task.trim()) return { ok: false, error: 'task 不能为空' }
        const category = String(args.category || 'deep')
        const preamble = CATEGORIES[category] || CATEGORIES.deep
        const prompt = preamble + '\n\n任务：' + task + '\n\n（由 omo_delegate 委派，完成后用结构化总结汇报。）'
        const providers = sub.list()
        const provider = String(args.provider || providers[0] || '')
        if (!provider) return { ok: false, error: '没有可用的 subagent provider（已注册: ' + (providers.join(', ') || '无') + '）' }
        try {
          const run = await sub.start(provider, {
            label: 'omo:' + category,
            prompt: [{ type: 'text', text: prompt }],
            parent: agent,
            signal: exec.signal,
          })
          state.delegations += 1
          const child = String(run.id)
          if (args.await === false) {
            return { ok: true, provider, category, child, background: true, note: '子代理已在后台运行，可用会话列表跟进。' }
          }
          const result = await run.result
          const output = Array.isArray(result && result.output)
            ? result.output.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
            : ''
          return { ok: true, provider, category, child, stopReason: String((result && result.stopReason) || 'done'), output: output.slice(0, 6000), note: '子代理已完成。' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    // ---------- omo_team：并行组建团队干活（OmO Team Mode 语义） ----------
    const TEAM_KINDS = {
      deep: '你是 Hephaestus（深度执行者），团队中的主力实现成员。',
      quick: '你是团队快速执行者（扫描/小改/拼写/简单任务）。',
      visual: '你是团队的视觉前端成员。',
      ultrabrain: '你是 Prometheus（架构师），团队中的规划与决策成员。',
    }

    function formatTeam(v) {
      if (!v || v.ok !== true) return String((v && v.error) || '团队运行失败')
      const head = '🤝 团队收队：' + v.succeeded + '/' + v.members + ' 名成员成功（目标：' + v.objective + '）\n\n'
      const body = v.results.map((r) => {
        const label = '◆ ' + r.name + (r.role ? '（' + r.role + '）' : '') + ' —— ' + (r.ok ? '✅ 完成 [' + r.stopReason + ']' : '❌ 失败 [' + r.stopReason + ']')
        const lines = (r.output || '（无文本输出）').split('\n')
        return label + '\n' + lines.map((l) => '    ' + l).join('\n')
      }).join('\n\n')
      return head + body + '\n\n（组长请审阅各成员汇报并将其整合为最终交付。）'
    }

    const teamDef = harness.defineTool({
      name: 'omo_team',
      description: '组建临时团队并行干活（OmO Team Mode 语义的 DSH 版）：队长（当前 agent、OmO 的 sisyphus 角色）+ 最多 6 个并行成员子代理，各自独立推进，全部完成后汇总结构化报告。适合可明确拆分的多线任务；如需串行分阶段编排请改用 workflow。',
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: {
          objective: { type: 'string', description: '团队总目标（队长保持所有权，最后整合）' },
          members: {
            type: 'array',
            description: '成员拆解（最多 6 个，可命名 OmO 风格代号）',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string', description: '成员代号（如 hephaestus / oracle / prometheus / librarian）' },
                role: { type: 'string', description: '职责一句话（如：深度实现 / 架构评审 / 调研）' },
                task: { type: 'string', description: '该成员的具体任务（自包含，可引用工作区文件）' },
                kind: { type: 'string', enum: ['deep', 'quick', 'visual', 'ultrabrain'], description: '执行类别，默认 deep' },
              },
              required: ['name', 'task'],
            },
          },
          provider: { type: 'string', description: '可选：子代理 provider 名（默认取第一个可用）' },
        },
        required: ['objective', 'members'],
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (args, value) => [{ type: 'text', text: formatTeam(value) }] },
      timeoutMs: 1800000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sub = ctx.get('subagents')
        if (!sub) return { ok: false, error: 'subagents 服务不可用' }
        const agent = exec && exec.agent
        if (!agent) return { ok: false, error: '缺少调用方 agent 上下文' }
        const objective = String(args.objective || '')
        const members = Array.isArray(args.members) ? args.members.slice(0, 6) : []
        if (!objective.trim() || members.length === 0) return { ok: false, error: '缺少 objective 或 members' }
        const providers = sub.list()
        const provider = String(args.provider || providers[0] || '')
        if (!provider) return { ok: false, error: '没有可用的 subagent provider（已注册: ' + (providers.join(', ') || '无') + '）' }
        try {
          // 逐个发布成员（发布即后台运行），随后并行等待全部结果
          const started = []
          for (const m of members) {
            const kind = TEAM_KINDS[String(m.kind || 'deep')] ? String(m.kind || 'deep') : 'deep'
            const roleLine = m.role ? ' 负责：' + m.role + '。' : ''
            const prompt = TEAM_KINDS[kind] + roleLine + '\n团队总目标：' + objective + '\n你的任务：' + String(m.task || '') + '\n\n完成后用一段结构化总结汇报（做了什么 / 关键决策 / 产物路径 / 遗留问题）。'
            try {
              const run = await sub.start(provider, {
                label: 'omo-team:' + String(m.name || 'member'),
                prompt: [{ type: 'text', text: prompt }],
                parent: agent,
                signal: exec.signal,
              })
              started.push({ name: String(m.name || 'member'), role: String(m.role || ''), promise: run.result })
            } catch (err) {
              started.push({ name: String(m.name || 'member'), role: String(m.role || ''), promise: Promise.resolve({ stopReason: 'error', output: [{ type: 'text', text: '启动失败: ' + String((err && err.message) || err) }] }) })
            }
          }
          state.delegations += started.length
          const settled = await Promise.allSettled(started.map((s) => s.promise))
          const results = started.map((s, i) => {
            const r = settled[i]
            if (r && r.status === 'rejected') return { name: s.name, role: s.role, ok: false, stopReason: 'error', output: String((r.reason && r.reason.message) || r.reason) }
            const v = r && r.value
            const text = Array.isArray(v && v.output) ? v.output.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : ''
            return { name: s.name, role: s.role, ok: true, stopReason: String((v && v.stopReason) || 'done'), output: text.slice(0, 4000) }
          })
          const okCount = results.filter((x) => x.ok).length
          return { ok: true, objective, provider, members: results.length, succeeded: okCount, results, note: '团队已收队。' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    try {
      ctx.effect(() => harness.registerTool(ctx, delegateDef))
      ctx.effect(() => harness.registerTool(ctx, teamDef))
      state.registeredTeam = true
    } catch (err) { console.error('[omo-discipline] register tools failed', err) }
  },
}