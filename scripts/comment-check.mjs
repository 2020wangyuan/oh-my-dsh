#!/usr/bin/env node
/**
 * comment-check.mjs — “AI 味”注释检查器（仓库自带的可复现版 omo_comments）
 *
 * 规则与 src/omo-core/host.js 中 omo_comments 工具的 SLOP 表逐字一致：
 *   1. 占位 TODO/FIXME —— `//` 后紧跟 TODO/FIXME/XXX/HACK 及实现占位词
 *   2. 空注释          —— 整行只含注释符与空白
 *   3. 装饰性注释      —— 整行只含 `- = * # /` 等装饰符（分隔线等）
 *   4. 无信息 TODO     —— TODO/FIXME/XXX/HACK 后无说明或说明极短（≤11 字符）
 *
 * 扫描逻辑与 omo_comments 一致：逐行取第一个 `//` 之后的部分作为 tail，
 * 依次用这 4 条规则匹配，先命中即算（break）。
 * 与 omo_comments 的差异仅在 IO：omo_comments 经 DSH fs 服务读取，
 * 本脚本用 Node 标准库读取；判定本身逐字相同。
 *
 * 用法:
 *   node scripts/comment-check.mjs <path-or-dir>...
 *
 * 行为:
 *   - 目录参数递归扫描；默认跳过 .git / node_modules / dist / build /
 *     .dsh / .omo 目录；目录内仅处理
 *     .ts .tsx .js .jsx .mjs .py .go .rs .md .json .yaml .yml .vue .svelte
 *     扩展名的文件；显式传入的文件参数不受扩展名过滤限制。
 *   - 输出 `文件:行号 [规则名] 内容`；无命中输出 `0 处命中`。
 *   - 退出码：有命中为 1，否则为 0。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

// 与 omo_comments（src/omo-core/host.js 的 SLOP）逐字一致；数组顺序即匹配优先级。
const RULES = [
  { name: '占位 TODO/FIXME', re: /^\s*(\/\/+|\/\**|\*)\s*(TODO|FIXME|XXX|HACK)\s*[:：]?\s*(implement|add|write|complete|fill|your|here|logic|代码|逻辑|实现|补充|写|改)/i },
  { name: '空注释', re: /^\s*\/\/+\s*$/ },
  { name: '装饰性注释', re: /^\s*(\/\/+|\*)\s*[\-=\*#\/\s]{6,}$/ },
  { name: '无信息 TODO', re: /^\s*\/\/+\s*(TODO|FIXME|XXX|HACK)(\s*[:：](.{0,11}$)|\s*$)/i },
]

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.dsh', '.omo'])
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.md', '.json', '.yaml', '.yml', '.vue', '.svelte'])

/** 逐行扫描单个文件内容，返回 [{ line, kind, text }]，与 omo_comments 的命中结构一致。 */
function scanText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const hits = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const commentStart = /\/\//.exec(line)
    if (!commentStart) continue
    const tail = line.slice(commentStart.index)
    for (const rule of RULES) {
      if (rule.re.test(tail)) {
        hits.push({ line: i + 1, kind: rule.name, text: tail.trim() })
        break
      }
    }
  }
  return hits
}

/** 读取并扫描单个文件；读取失败时向 stderr 报错并返回空结果。 */
function scanFile(displayPath) {
  let text
  try {
    text = readFileSync(displayPath, 'utf8')
  } catch (err) {
    console.error('读取失败: ' + displayPath + ' — ' + String((err && err.message) || err))
    return []
  }
  return scanText(text)
}

/** 递归收集目录下待扫描文件：跳过 SKIP_DIRS，仅保留 EXTS 扩展名，输出顺序稳定。 */
function walkFiles(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    console.error('读取目录失败: ' + dir + ' — ' + String((err && err.message) || err))
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(full, out)
    } else if (entry.isFile() && EXTS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('用法: node scripts/comment-check.mjs <path-or-dir>...')
  process.exit(2)
}

const targets = []
for (const arg of args) {
  let st
  try {
    st = statSync(arg)
  } catch (err) {
    console.error('路径不存在: ' + arg)
    continue
  }
  if (st.isDirectory()) walkFiles(arg, targets)
  else if (st.isFile()) targets.push(arg)
  else console.error('忽略非普通文件: ' + arg)
}

let total = 0
for (const file of targets) {
  for (const hit of scanFile(file)) {
    console.log(file + ':' + hit.line + ' [' + hit.kind + '] ' + hit.text)
    total += 1
  }
}

if (total > 0) {
  console.log('共 ' + total + ' 处命中')
  process.exit(1)
}
console.log('0 处命中')
process.exit(0)