// graphics-icon/colorfont —— 彩色 webfont 引擎 + CLI + 类型(Vite 能力请走 graphics-icon/vite)。
//   build(单实例纯函数) / buildAndWrite(单实例落盘) / colorfonts(多实例批量) / runCli
import { build, buildAndWrite, colorfonts, runCli, serializeLockfile, readLockfile } from '@codejoo/colorfont'

// 主函数(多实例批量引擎)colorfonts —— 即项目名;亦作默认导出（两者同价）。
export { build, buildAndWrite, colorfonts, runCli, serializeLockfile, readLockfile }
export default colorfonts
export type { ColorfontOptions, ColorfontCommon, ColorfontItem, BuildResult, FontFormat, ColorFormat, FontAsset, FontFlavor, FontMetadata, GlyphMeta } from '@codejoo/colorfont'
