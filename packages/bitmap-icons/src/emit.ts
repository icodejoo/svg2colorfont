/**
 * 雪碧图边车文件生成:
 *   · 样式(CSS):一套类 —— 基类 .${prefix} + 每图 .${prefix}-${name}。
 *       每图类带「px 默认尺寸 + aspect-ratio + 百分比 background-size/position」:
 *       默认按 px 尺寸显示(项目可经 pxtorem 等转 rem/vw);改元素 width(或 width/height)
 *       即按容器自适应铺满。background-image 用「相对 image 的 url()」,交 Vite 解析。
 *   · script(.ts/.js):相对 import style(注入样式)与 image(取最终 URL),并导出
 *       iconsImage / iconsName;.ts 额外产 IconName 类型。
 *       调用方只 import 这个脚本即可,无需关心 image/style 在哪。
 *   · JSON:{ image(相对路径), width, height, pixelRatio, frames }(供 canvas/运行时)。
 * 每个写入「内容未变则跳过」(幂等,避免 dev 触发 HMR 循环)。
 *
 * Sprite-sheet sidecar emitters (style / script / JSON). Every write is idempotent
 * (skip when unchanged) to avoid HMR loops in dev. Relative url()/import resolved by Vite.
 */

import { autoGenBanner } from "@codejoo/utils/banner"
import { writeTextIfChanged } from "@codejoo/utils/fs-write"
import { relTo } from "@codejoo/utils/path-rel"

import type { IconManifest, IconSheetMeta } from "./types.ts"

const round = (n: number): number => Math.round(n * 10000) / 10000

interface StyleCtx {
  prefix: string
  imagePath: string
  sheetW: number
  sheetH: number
  pixelRatio: number
}

/** 单套类,适配任意尺寸容器(详见文件头)。background-image 用 style→image 的相对 url()。 / One class set, adapts to any container size; relative url(). */
export function emitStyle(out: string, manifest: IconManifest, ctx: StyleCtx): void {
  const { prefix, sheetW, sheetH } = ctx
  const r = ctx.pixelRatio || 1
  const url = relTo(out, ctx.imagePath)
  const lines: string[] = [
    // 用 /* */ 块注释:纯 CSS 不支持 // 行注释(PostCSS 会报 Unknown word)
    `/* 用法:<i class="${prefix} ${prefix}-foo"></i>`,
    " *   · 默认按 width(px,可经 pxtorem 等转 rem/vw)显示,高度按 aspect-ratio 自动;",
    " *   · 改元素 width(或同时设 width/height)即按容器自适应铺满 —— 背景按百分比缩放/定位,与 CSS 单位、像素密度无关。",
    " */",
    `.${prefix} {`,
    "  display: inline-block;",
    `  background-image: url("${url}");`,
    "  background-repeat: no-repeat;",
    "}",
    "",
  ]
  for (const [name, f] of Object.entries(manifest)) {
    const sx = round((sheetW / f.width) * 100)
    const sy = round((sheetH / f.height) * 100)
    const px = sheetW === f.width ? 0 : round((f.x / (sheetW - f.width)) * 100)
    const py = sheetH === f.height ? 0 : round((f.y / (sheetH - f.height)) * 100)
    lines.push(
      `.${prefix}-${name} {`,
      `  width: ${round(f.width / r)}px;`,
      `  aspect-ratio: ${f.width} / ${f.height};`,
      `  background-size: ${sx}% ${sy}%;`,
      `  background-position: ${px}% ${py}%;`,
      "}",
      "",
    )
  }
  writeTextIfChanged(out, autoGenBanner("block") + lines.join("\n"))
}

interface ScriptCtx {
  imagePath: string
  stylePath: string
  sheet: IconSheetMeta
}

/**
 * 入口脚本(精简):相对 import style(副作用,注入样式)与 image(Vite 解析为最终 URL),
 * 导出 iconsImage;.ts 再产「纯类型」IconName(string 联合,无运行时值)。
 * 调用方 `import { iconsImage, type IconName } from "<script>"` 即可,无需关心 image/style 位置。
 *
 * Entry script: relative import of style (side-effect inject) + image (resolved URL); exports
 * iconsImage / iconsName, plus a pure-type IconName union for .ts outputs.
 */
export function emitScript(out: string, manifest: IconManifest, ctx: ScriptCtx): void {
  const isTs = /\.ts$/i.test(out)
  const relStyle = relTo(out, ctx.stylePath)
  const relImage = relTo(out, ctx.imagePath)
  const head = isTs ? '/// <reference types="vite/client" />\n' : ""
  const names = Object.keys(manifest)
  let content =
    `${head}${autoGenBanner("line")}` +
    `import "${relStyle}" // 注入雪碧图样式(副作用)\n` +
    `import iconsImage from "${relImage}" // 图集 URL(Vite 解析/带 hash)\n\n` +
    "export { iconsImage }\n" +
    // 名称枚举对象:枚举每个精灵名(键=值=名称),供运行时按名引用
    `export const iconsName = { ${names.map((n) => `"${n}": "${n}"`).join(", ")} }\n`
  if (isTs) {
    // .ts 额外产「枚举值的字符串字面量联合类型」
    content += `export type IconName = ${names.map((n) => `"${n}"`).join(" | ") || "never"}\n`
  }
  writeTextIfChanged(out, content)
}

interface JsonCtx {
  imagePath: string
  sheet: IconSheetMeta
}

/** 坐标 JSON:{ image(相对路径), width, height, pixelRatio, frames }。纯数据,无 banner。 / Coordinate JSON: pure data, no banner. */
export function emitJson(out: string, manifest: IconManifest, ctx: JsonCtx): void {
  const image = relTo(out, ctx.imagePath)
  writeTextIfChanged(out, `${JSON.stringify({ image, ...ctx.sheet, frames: manifest }, null, 2)}\n`)
}
