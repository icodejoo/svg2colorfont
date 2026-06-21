/**
 * @codejoo/imagemin —— 库入口。
 * Library entry point.
 *
 * 导出：引擎 `imagemin`、全部选项/结果类型、glob 助手，以及库级默认配置 `defaultOptions`。
 * Exports: the `imagemin` engine, all option/result types, the glob helpers, and `defaultOptions`.
 */

export { imagemin, matchesAnyGlob, toGlobList } from "./imagemin.ts"
export type { ImageminOptions, FileResult, OptimizeResult } from "./imagemin.ts"

export { defaultOptions } from "./options.ts"

// CLI 入口(供 graphics-icon 的 bin 复用,实现 pre-commit/全量压缩的完全平替)。
export { runCli } from "./bin.ts"
