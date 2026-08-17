/**
 * omo-core · Client half (Dynamic Cordis Plugin, browser)
 * Part of oh-my-dsh — a DeepSeek Harness port of oh-my-openagent modules.
 *
 * Source of truth: session-registered plugin `omoc-2` / package `pkg-4`
 * (verified running, client status: running).
 *
 * Load as the `client` side of the same Dynamic Cordis Plugin:
 *   cordis_define({ plugin: { kind: 'new', idPrefix: 'omoc' },
 *                   code: { client: <this file's body> } })
 *
 * Rendered surfaces:
 *   1. conversation.input.dock  id `omo`   (order 30)  — status strip above the
 *      composer: rules / hashline / comments activity + workspace root.
 *   2. tool.call.toolview       keys `hashline_read`, `hashline_edit` — compact
 *      cards for the Hashline tools.
 *   3. settings.section         id `omo-dsh` (order 50) — an "Oh My DSH" page.
 *
 * Plain JavaScript + React.createElement only (no JSX, no imports).
 * host.call('omo-status') reaches this package's Host half.
 */
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // ---------- 输入区上方状态条（conversation.input.dock） ----------
    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'omo', order: 30, label: 'Oh My DSH' },
      () => {
        const [status, setStatus] = React.useState(null)
        React.useEffect(() => {
          let alive = true
          host.call('omo-status').then((v) => { if (alive) setStatus(v) }).catch(() => { /* 状态拉取失败保持加载态 */ })
          return () => { alive = false }
        }, [])
        const root = status && status.workspaceRoot
        const text = status
          ? 'OmO · rules' + (status.rules ? '✓' : '✗') + ' · hashline✓ · comments✓' + (root ? ' · ' + root : '')
          : 'OmO 加载中…'
        return React.createElement('div', {
          style: {
            fontSize: 11,
            opacity: 0.8,
            padding: '2px 4px',
            fontFamily: 'ui-monospace, monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        }, text)
      },
    ))

    // ---------- Hashline 工具专属卡片（tool.call.toolview） ----------
    function makeCard(toolName, title, accent) {
      slots.inject('tool.call.toolview', () => slots.register(
        { name: 'tool.call.toolview', key: toolName },
        (props) => {
          let args = {}
          try { args = JSON.parse(props.block.arguments || '{}') } catch (err) { /* 参数解析失败时显示空摘要 */ }
          const bits = []
          if (args.path) bits.push('路径 ' + args.path)
          if (args.start) bits.push('第 ' + args.start + (args.end ? '-' + args.end : '') + ' 行')
          if (Array.isArray(args.ops)) bits.push(args.ops.length + ' 项操作')
          const chip = React.createElement('span', {
            key: 'chip',
            style: { fontWeight: 700, color: '#fff', background: accent, borderRadius: 3, padding: '1px 6px', fontSize: 10, marginRight: 8 },
          }, title)
          const sum = React.createElement('span', {
            key: 'sum',
            style: { fontFamily: 'ui-monospace, monospace', fontSize: 11, opacity: 0.8 },
          }, bits.join('  ') || props.toolName)
          return React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', padding: '4px 8px', margin: '2px 0', borderLeft: '3px solid ' + accent, background: 'rgba(127,127,127,0.06)', borderRadius: 4 },
          }, [chip, sum])
        },
      ))
    }
    makeCard('hashline_read', 'OmO 读取', '#36cfc9')
    makeCard('hashline_edit', 'OmO 编辑', '#b37feb')

    // ---------- 设置页（settings.section） ----------
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'omo-dsh', order: 50, label: 'Oh My DSH' },
      () => {
        const [status, setStatus] = React.useState(null)
        React.useEffect(() => {
          let alive = true
          host.call('omo-status').then((v) => { if (alive) setStatus(v) }).catch(() => { /* 同上 */ })
          return () => { alive = false }
        }, [])
        const rows = [
          ['Rules 注入', '每次组装提示词自动注入 AGENTS.md 与 .omo/rules/**，60s 刷新'],
          ['Hashline 编辑', 'hashline_read / hashline_edit：行级内容哈希锚点，拒绝陈旧行写入'],
          ['Comment Checker', 'omo_comments：扫描占位 TODO / 空注释等 AI 味注释'],
          ['纪律执行', 'omo-discipline 插件：Todo Enforcer（目标未完成时拉回）+ omo_delegate 类别委派'],
          ['命令', '/omo 查看状态 · /init-deep 生成 AGENTS.md 层级骨架'],
        ]
        const children = [
          React.createElement('div', { key: 'head', style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, 'Oh My DSH —— DSH 版 oh-my-openagent'),
          React.createElement('div', { key: 'ws', style: { fontSize: 12, marginBottom: 10, opacity: 0.75 } }, '工作区: ' + ((status && status.workspaceRoot) || '…')),
        ]
        for (const r of rows) {
          children.push(React.createElement('div', { key: r[0], style: { margin: '6px 0' } },
            React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, r[0]),
            React.createElement('span', { style: { marginLeft: 8, opacity: 0.7, fontSize: 12 } }, r[1]),
          ))
        }
        return React.createElement('div', { style: { padding: 12 } }, children)
      },
    ))
  },
}