# scripts/ —— 工程化脚本

## comment-check.mjs

仓库自带的 **“AI 味”注释检查器**，是会话内 `omo_comments` 工具（`omo-core` 插件注册的 DSH 工具）的**可复现命令行版本**：不依赖 DeepSeek Harness 运行环境，纯 Node 标准库即可执行，规则与扫描逻辑和 `omo_comments` 逐字一致。

### 用途

- 在 CI / pre-commit 中拦截占位 TODO、空注释、装饰性分隔线、无信息 TODO 等“AI 味”注释进入代码库。
- 有命中行为**先命中即算**：逐行取第一个 `//` 之后的部分，按 占位 TODO/FIXME → 空注释 → 装饰性注释 → 无信息 TODO 顺序匹配。
- 退出码：有命中为 1，否则为 0，可直接接入 gating（`npm run check:comments` 扫描 `src/ examples/ scripts/` 三个代码面）。
- **有意排除 `docs/`**：文档里展示的示例命中（如 usage.md 的 omo_comments 输出格式）本就是"被标记的注释"，属于演示内容；门禁只守护代码面。

### 用法

```bash
# 扫描代码面（等价于 npm run check:comments）
node scripts/comment-check.mjs src examples scripts

# 扫描多个目录或文件
node scripts/comment-check.mjs src scripts examples

# 扫描单个文件（显式文件参数不受扩展名过滤限制）
node scripts/comment-check.mjs path/to/file.py
```

输出格式：`文件:行号 [规则名] 内容`；无命中输出 `0 处命中`。

默认跳过 `.git` / `node_modules` / `dist` / `build` / `.dsh` / `.omo` 目录，仅处理 `.ts` `.tsx` `.js` `.jsx` `.mjs` `.py` `.go` `.rs` `.md` `.json` `.yaml` `.yml` `.vue` `.svelte` 扩展名。

### 与 omo_comments 的关系

- `omo_comments` 是运行在 DSH 会话内、经 `fs` 服务读取文件的动态工具；本脚本是同一判定逻辑的离线性实现，两者输出格式一致（`行号 [规则名] 内容`）。
- 判定规则的**唯一权威**是 `src/omo-core/host.js` 中 `omo_comments` 的 SLOP 表；本脚本头注释中逐字抄录了这 4 条正则与扫描方式。若日后修改 `omo_comments` 的规则，请同步本脚本，并在两处跑同一组样例验证一致。
- 对应关系：`占位 TODO/FIXME` / `空注释` / `装饰性注释` / `无信息 TODO` 四条规则与 `omo_comments` 返回的 `kind` 完全同名。

### 验证样例

```bash
# 干净文件应输出 0 处命中（该演示文件已通过 hashline / omo_comments 清理验证）
node scripts/comment-check.mjs /path/to/omo-demo.ts
```