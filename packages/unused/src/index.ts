/**
 * @codejoo/unused —— 未使用资产「检测(Vite 插件,产表)+ 删除(removeUnused / remove-unused CLI)」。
 *
 * 检测与删除分离:vite build 期 `unusedVite` 经模块图(load 钩子)与磁盘候选 diff,写出
 * `.cache.graphics/unused.json`(清单表);删除是独立、显式的一步(`removeUnused` / CLI 读该表执行)。
 * 经 graphics-icon 伞插件集成时,四引擎(colorfonts/svgIcons/bitmapIcons/imagemin)的输入目录与产物
 * 会被自动并入排除,避免误删图标源文件。
 *
 * @codejoo/unused — split detect (Vite plugin → manifest table) + delete (removeUnused / CLI).
 */

export { unusedVite } from './detect.ts'
export { findUnused } from './scan.ts'
export { removeUnused } from './remove.ts'
export { listCandidates } from './shared.ts'
export { runCli } from './bin.ts'
export { DEFAULT_ASSET_EXTS, DEFAULT_SOURCE_GLOBS } from './types.ts'
export type {
  CandidateOptions,
  UnusedDetectOptions,
  FindUnusedOptions,
  UnusedManifest,
  RemoveUnusedOptions,
  RemoveUnusedResult,
} from './types.ts'
