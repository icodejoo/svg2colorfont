// graphics-icon/unused —— 未使用资产删除引擎 + 静态检测 + CLI + 类型。
//   removeUnused(按清单表删除) / findUnused(不依赖 vite 的静态检测,产表) / runCli(remove-unused)。
//   构建期检测在 graphics-icon/vite 的 `unused` 选项(基于模块图,更精确)。
import { removeUnused, findUnused, runCli } from '@codejoo/unused'

// 主函数 removeUnused —— 按清单表删除;亦作默认导出（两者同价）。
export { removeUnused, findUnused, runCli }
export default removeUnused
export type {
  RemoveUnusedOptions,
  RemoveUnusedResult,
  FindUnusedOptions,
  UnusedDetectOptions,
  UnusedManifest,
} from '@codejoo/unused'
