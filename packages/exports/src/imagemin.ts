// graphics-icon/imagemin —— 图片压缩引擎 + CLI + 类型 + 默认配置(单例,无 items)。
import { imagemin, defaultOptions, matchesAnyGlob, toGlobList, runCli } from '@codejoo/imagemin'

// 主函数(引擎)imagemin —— 即项目名;亦作默认导出（两者同价）。
export { imagemin, defaultOptions, matchesAnyGlob, toGlobList, runCli }
export default imagemin
export type { ImageminOptions, FileResult, OptimizeResult } from '@codejoo/imagemin'
