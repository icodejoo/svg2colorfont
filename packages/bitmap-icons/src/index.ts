/**
 * vite-plugin-bitmap-icons —— 库出口。
 *
 * 用 sharp + maxrects-packer 把 inputDir 下的位图打成一张图集(*.sprite.webp),并生成:
 * 样式(基类 + 每图自适应类)、入口脚本(相对 import 图与样式 + 导出坐标/类型)、可选 JSON。
 * 数组形式可生成多张图集。
 *
 * 无 publicPath:CSS 用「style→image 相对 url()」、script 用相对 import,均交 Vite 解析/带 hash。
 * 产物用 *.sprite.{webp,png} 命名 → 自动排除出源扫描(故可与源图同目录)。
 *
 * 调用方只需:import { iconsImage, type IconName } from "<output.script 路径>" —— 该脚本注入样式、
 * 给出图 URL 与 IconName 类型,无需关心图/样式文件在哪。
 *
 * vite-plugin-bitmap-icons — library entry. Pack bitmaps into a single atlas (sharp + maxrects-packer),
 * emitting a stylesheet, an entry script (relative imports + coords/type) and optional JSON.
 * See README for a vite.config example.
 */

// 引擎(Vite 之外单独使用):函数用法即项目名 bitmapIcons。 / Engine = project name.
export { bitmapIcons } from "./generate-sheet.ts"

// Vite 插件工厂:引擎名 + Vite 后缀。CLI 入口 —— 与 imagemin 对齐:可编程调用,也可经 bin 运行。
export { bitmapIconsVite } from "./plugin.ts"
export { runCli } from "./bin.ts"

export type { BitmapIconsOptions, BitmapIconsCommon, BitmapIconsItem, BitmapIconsConfig, BitmapIconsOutput, IconFrame, IconManifest, IconSheetMeta } from "./types.ts"
