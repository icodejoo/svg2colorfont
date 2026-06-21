// graphics-icon/svg —— SVG 雪碧图引擎 + CLI + 类型(Vite 能力请走 graphics-icon/vite)。
import { svgIcons, runCli } from 'svg-icons'

// 主函数(引擎)svgIcons —— 即项目名;亦作默认导出（两者同价）。
export { svgIcons, runCli }
export default svgIcons
export type { SvgIconsOptions, SvgIconsCommon, SvgIconsItem, SvgIconsConfig, SvgIconsOutput, ColorOption, ColorFn, NormalizeOption } from 'svg-icons'
