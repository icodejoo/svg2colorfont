/**
 * vite-plugin-svg-icons —— 库出口。
 * vite-plugin-svg-icons — library entry.
 *
 * 在 SVG 雪碧图（<symbol> + <use href>）基础上提供：id 作用域化（修 issue #38）、颜色改写、
 * 自产带类型的 script 入口（iconsHref + iconsName + IconName）、共享磁盘缓存，以及与 colorfont
 * 同步的可选 normalize/缩放能力。
 *
 * On top of SVG sprite sheets (<symbol> + <use href>): id scoping (fixes issue #38), color rewriting,
 * an auto-generated typed script entry (iconsHref + iconsName + IconName), a shared on-disk cache,
 * and an opt-in normalize/scale step in sync with colorfont.
 *
 * 用法 / Usage:
 *   // vite.config.ts
 *   import { svgIconsVite } from "vite-plugin-svg-icons"
 *   export default defineConfig({
 *     plugins: [
 *       svgIconsVite({
 *         items: [
 *           {
 *             sources: "src/assets/icons",   // 单目录;多目录用数组 ["a", "b"]
 *             output: {
 *               svg: "src/sprites/common.sprites.svg",
 *               script: "src/sprites/index.ts",
 *             },
 *             color: true,            // fill/stroke → currentColor（主题化）
 *             normalize: false,       // 可选：true 或 { width: 1024 } 开启 colorfont 风格归一化
 *           },
 *         ],
 *       }),
 *     ],
 *   })
 *
 *   // 消费 / consume
 *   import { iconsHref, iconsName, type IconName } from "@/sprites"
 *   <use :href="`${iconsHref}#${iconsName.foo}`" />
 */

// 引擎(Vite 之外单独使用):函数用法即项目名 svgIcons。 / Engine = project name.
export { svgIcons } from "./create.ts"

// Vite 插件工厂:引擎名 + Vite 后缀。CLI 入口 —— 与 imagemin 对齐:可编程调用,也可经 bin 运行。
export { svgIconsVite } from "./create.ts"
export { runCli } from "./bin.ts"

export type { SvgIconsOptions, SvgIconsCommon, SvgIconsItem, SvgIconsConfig, SvgIconsOutput, ColorOption, ColorFn, NormalizeOption } from "./types.ts"
