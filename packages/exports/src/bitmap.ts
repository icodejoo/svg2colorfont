// graphics-icon/bitmap —— 位图雪碧图引擎 + CLI + 类型(Vite 能力请走 graphics-icon/vite)。
import { bitmapIcons, runCli } from 'bitmap-icons'

// 主函数(引擎)bitmapIcons —— 即项目名;亦作默认导出（两者同价）。
export { bitmapIcons, runCli }
export default bitmapIcons
export type { BitmapIconsOptions, BitmapIconsCommon, BitmapIconsItem, BitmapIconsConfig, BitmapIconsOutput, IconFrame, IconManifest, IconSheetMeta } from 'bitmap-icons'
