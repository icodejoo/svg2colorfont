/**
 * 位图雪碧图核心:枚举源图 → 读入(指纹+sharp) → groupCache 判定 → maxrects 打包 → sharp 合成 → 编码 → 产边车。
 * 无 Vite 类型依赖,便于直接测试。
 *
 * 关键决策 / Key decisions:
 *   · 单张图集:打包必须落一个 bin;溢出/单图过大 → 明确报错,绝不静默拆图。
 *   · allowRotation:false —— CSS background 切片不能旋转。
 *   · 源按文件名排序后再打包 → 跨机器布局可复现。
 *   · 缓存:统一 groupCache —— 输入指纹 + configHash + 代表产物(style/css) hash;命中校验全部产物 existsSync。
 *   · 产物经 emit/writeBufferIfChanged「就地写盘」,以 path-only 交给 groupCache 读回算 hash。
 *   · sharp / maxrects-packer 在 regenerate 内按需动态 import —— 命中或仅导入工厂时不加载这些重依赖。
 */

import { globSync, readFileSync } from "node:fs"
import { basename, extname, resolve } from "node:path"

import { groupCache, resolveCacheFile } from "@codejoo/utils/cache"
import { sha256 } from "@codejoo/utils/hash"
import { toGlobList, matchesAnyGlob } from "@codejoo/utils/glob"
import { writeBufferIfChanged } from "@codejoo/utils/fs-write"

import { emitJson, emitScript, emitStyle } from "./emit.ts"

import type { Metadata } from "./sharp-types.ts"
import type { BitmapIconsItem, BitmapIconsOptions, IconManifest, IconSheetMeta } from "./types.ts"
import type { GroupInput } from "@codejoo/utils/cache"

const SUPPORTED = /\.(png|jpe?g|webp|avif)$/i
const OUTPUT_NAMING = /\.sprite\.(png|jpe?g|webp|avif)$/i // 产物命名约定 → 永不当作源
// 产物格式版本:改变生成内容(如样式/脚本结构)或缓存模型时 +1,使旧缓存失效。
const GENERATOR_VERSION = "4"

/** maxrects 矩形:addArray 后由 place() 就地写入 x/y。 */
interface Entry {
  width: number
  height: number
  x: number
  y: number
  name: string
  buf: Buffer
  oversized?: boolean
  rot?: boolean
}

/** 影响产物的配置指纹(不含输入内容,那在 groupCache.files 里)。 / Config fingerprint (excludes inputs). */
function configHashOf(item: BitmapIconsItem, format: string): string {
  const sig = {
    v: GENERATOR_VERSION,
    padding: item.padding ?? 2,
    maxWidth: item.maxWidth ?? 4096,
    maxHeight: item.maxHeight ?? 4096,
    pot: item.pot ?? false,
    square: item.square ?? false,
    pixelRatio: item.pixelRatio ?? 1,
    prefix: item.prefix ?? "sprite",
    format,
    image: item.output.image,
    style: item.output.style,
    script: item.output.script ?? null,
    json: item.output.json ?? null,
    png: item.png ?? null,
    webp: item.webp ?? null,
    nameTransformer: item.nameTransformer?.toString() ?? null,
  }
  return sha256(JSON.stringify(sig, (_k, v) => (typeof v === "function" ? `fn:${v.toString()}` : v)))
}

/** 每实例缓存文件:cacheFilename 优先;否则由 output.image 派生唯一默认名。 / Per-item cache file. */
function cacheFileOf(item: BitmapIconsItem): string {
  const def = `bitmap-icons-${basename(item.output.image).replace(/\.\w+$/, "")}`
  return resolveCacheFile(def, item.cacheFilename)
}

/**
 * 生成单张图集(经 groupCache)。返回是否命中缓存。
 * Generate one sheet via groupCache; returns whether it was a cache hit.
 */
export async function generateSheet(item: BitmapIconsItem): Promise<boolean> {
  const { inputDir, output, padding = 2, maxWidth = 4096, maxHeight = 4096, pot = false, square = false, pixelRatio = 1, prefix = "sprite" } = item
  const includeGlobs = toGlobList(item.include)
  const include = includeGlobs.length > 0 ? includeGlobs : ["**/*.{png,jpg,jpeg,webp,avif}"]
  const exclude = toGlobList(item.exclude)
  const nameOf = item.nameTransformer ?? ((base: string) => base)

  // 图集格式由 output.image 扩展名决定
  const imgExt = extname(output.image).slice(1).toLowerCase()
  const format = imgExt === "png" ? "png" : imgExt === "webp" ? "webp" : null
  if (!format) throw new Error(`[bitmap-icons] output.image 扩展名须为 .png 或 .webp,得到 ".${imgExt}"`)

  const inputAbs = resolve(inputDir)
  // 本组产物的绝对路径 → 排除出源扫描(产物可与源同目录)
  const ownOut = new Set([output.image, output.style, output.script, output.json].filter((p): p is string => Boolean(p)).map((p) => resolve(p)))

  // 1) 枚举源图(命中 include & 支持扩展名 & 非产物命名 & 未被 exclude & 非本组产物),按名排序保证可复现
  let rels: string[]
  try {
    rels = globSync(include, { cwd: inputAbs })
  } catch {
    rels = []
  }
  const selected = rels
    .filter((rel) => SUPPORTED.test(rel) && !OUTPUT_NAMING.test(rel) && !matchesAnyGlob(rel, exclude) && !ownOut.has(resolve(inputAbs, rel)))
    .sort()
  if (selected.length === 0) {
    console.warn(`[bitmap-icons] ${inputDir} 无可打包图片,跳过`)
    return false
  }

  // 2) 读入所有源图(一次读取:既用于缓存指纹,也复用于 sharp 合成)
  const files = selected.map((rel) => ({ rel, abs: resolve(inputAbs, rel), buf: readFileSync(resolve(inputAbs, rel)) }))
  const inputs: GroupInput[] = files.map((f) => ({ path: f.abs, content: f.buf }))

  // 3) groupCache:输入未变 + configHash 一致 + 产物在 + 代表产物(style)hash 一致 → 命中跳过整条管线
  const result = await groupCache(
    {
      cacheFile: cacheFileOf(item),
      cache: item.cache !== false,
      configHash: configHashOf(item, format),
      inputs,
      representative: output.style, // style(css)必产 → 代表产物
    },
    async () => {
      // ── 未命中:measure → pack → compose → encode → emit ──
      const sharp = (await import("sharp")).default
      const entries: Entry[] = []
      const seen = new Map<string, string>()
      for (const f of files) {
        const name = nameOf(basename(f.rel, extname(f.rel)))
        if (!/^[a-zA-Z_][\w-]*$/.test(name)) throw new Error(`[bitmap-icons] 非法精灵名 "${name}"(来自 ${f.rel});需匹配 /^[a-zA-Z_][\\w-]*$/`)
        const prev = seen.get(name)
        if (prev) throw new Error(`[bitmap-icons] 精灵名冲突 "${name}":${prev} 与 ${f.rel}`)
        seen.set(name, f.rel)
        let meta: Metadata
        try {
          meta = await sharp(f.buf).metadata()
        } catch {
          throw new Error(`[bitmap-icons] 无法读取为图片:${f.rel}`)
        }
        if (!meta.width || !meta.height) throw new Error(`[bitmap-icons] 读不到尺寸:${f.rel}`)
        entries.push({ width: meta.width, height: meta.height, x: 0, y: 0, name, buf: f.buf })
      }

      const { MaxRectsPacker } = await import("maxrects-packer")
      const packer = new MaxRectsPacker<Entry>(maxWidth, maxHeight, padding, { smart: true, pot, square, allowRotation: false, border: 0 })
      packer.addArray(entries)

      const placed = packer.bins.flatMap((b) => b.rects)
      const oversized = placed.filter((r) => r.oversized)
      if (oversized.length > 0) {
        throw new Error(`[bitmap-icons] 以下精灵单张就超过 ${maxWidth}×${maxHeight},无法放入单张图集:\n${oversized.map((r) => `  · ${r.name} (${r.width}×${r.height})`).join("\n")}`)
      }
      if (packer.bins.length > 1) {
        throw new Error(`[bitmap-icons] ${placed.length} 张精灵在 ${maxWidth}×${maxHeight} 内放不下(需 ${packer.bins.length} 张图集)。请提高 maxWidth/maxHeight、减少精灵数,或拆成多组配置。`)
      }
      const bin = packer.bins[0]

      const canvas = sharp({ create: { width: bin.width, height: bin.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(bin.rects.map((r) => ({ input: r.buf, left: r.x, top: r.y })))
      const encoded = format === "webp" ? canvas.webp(item.webp ?? { quality: 80, effort: 6 }) : canvas.png(item.png ?? { compressionLevel: 9, adaptiveFiltering: true })
      writeBufferIfChanged(resolve(output.image), await encoded.toBuffer())

      const manifest: IconManifest = {}
      for (const r of [...bin.rects].sort((a, b) => a.name.localeCompare(b.name))) {
        manifest[r.name] = { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      const sheet: IconSheetMeta = { width: bin.width, height: bin.height, pixelRatio }
      emitStyle(output.style, manifest, { prefix, imagePath: output.image, sheetW: bin.width, sheetH: bin.height, pixelRatio })
      if (output.script) emitScript(output.script, manifest, { imagePath: output.image, stylePath: output.style, sheet })
      if (output.json) emitJson(output.json, manifest, { imagePath: output.image, stylePath: output.style, sheet })

      console.log(`[bitmap-icons] ${Object.keys(manifest).length} 张 → ${output.image} (${bin.width}×${bin.height})`)

      // 产物均已 side-effect 写盘 → 只交路径给 groupCache 读回校验
      const products: { path: string }[] = [{ path: output.image }, { path: output.style }]
      if (output.script) products.push({ path: output.script })
      if (output.json) products.push({ path: output.json })
      return products
    },
  )
  if (result.hit) console.log(`[bitmap-icons] 命中缓存,跳过:${output.image}`)
  return result.hit
}

/** 合并公共参数到每个 item（item 同名字段覆盖公共）。 / Merge common into each item (item wins). */
function resolveItems(o: BitmapIconsOptions): BitmapIconsItem[] {
  const { items, ...common } = o
  return items.map((it) => ({ ...common, ...it }))
}

/**
 * 引擎入口（Vite 之外可单独调用）：按 items 生成所有图集 + 边车,维护各实例缓存。
 * 单实例失败:throwable!==false → 抛错中止;否则告警继续。
 */
export async function bitmapIcons(options: BitmapIconsOptions): Promise<void> {
  for (const item of resolveItems(options)) {
    try {
      await generateSheet(item)
    } catch (e) {
      if (item.throwable === false) console.warn(`[bitmap-icons] ${item.inputDir} 生成失败:\n${String(e)}`)
      else throw e
    }
  }
}
