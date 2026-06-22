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

import { globSync, readFileSync, rmSync } from "node:fs"
import { basename, extname, join, resolve } from "node:path"

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
const GENERATOR_VERSION = "5"

/**
 * 由 output.{dir,name,ts,format} 派生四类产物路径(相对仓库根)+ 校验后的 format。
 * 图集 `{dir}/{name}.{format}`、样式 `{dir}/{name}.css`、脚本 `{dir}/{name}.{ts?ts:js}`、JSON `{dir}/{name}.json`。
 * format 默认 webp,只接受 'webp'|'png'(非法即报错)。
 * Derive the four product paths (repo-root-relative) + validated format from output.{dir,name,ts,format}.
 */
export function derivePaths(item: BitmapIconsItem): { format: "webp" | "png"; imagePath: string; stylePath: string; scriptPath: string; jsonPath: string } {
  const { dir, name, ts = true, format = "webp" } = item.output
  if (format !== "webp" && format !== "png") throw new Error(`[bitmap-icons] output.format 须为 "webp" 或 "png",得到 "${format}"`)
  return {
    format,
    imagePath: join(dir, `${name}.${format}`),
    stylePath: join(dir, `${name}.css`),
    scriptPath: join(dir, `${name}.${ts ? "ts" : "js"}`),
    jsonPath: join(dir, `${name}.json`),
  }
}

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
function configHashOf(item: BitmapIconsItem, paths: ReturnType<typeof derivePaths>): string {
  const sig = {
    v: GENERATOR_VERSION,
    padding: item.padding ?? 2,
    maxWidth: item.maxWidth ?? 4096,
    maxHeight: item.maxHeight ?? 4096,
    pot: item.pot ?? false,
    square: item.square ?? false,
    pixelRatio: item.pixelRatio ?? 1,
    prefix: item.prefix ?? "sprite",
    name: item.output.name,
    format: paths.format,
    ts: item.output.ts ?? true,
    image: paths.imagePath,
    style: paths.stylePath,
    script: paths.scriptPath,
    json: paths.jsonPath,
    png: item.png ?? null,
    webp: item.webp ?? null,
    nameTransformer: item.nameTransformer?.toString() ?? null,
  }
  return sha256(JSON.stringify(sig, (_k, v) => (typeof v === "function" ? `fn:${v.toString()}` : v)))
}

/** 每实例缓存文件:cacheFilename 优先;否则由 output.name 派生唯一默认名。 / Per-item cache file. */
function cacheFileOf(item: BitmapIconsItem): string {
  const def = `bitmap-icons-${item.output.name}`
  return resolveCacheFile(def, item.cacheFilename)
}

/**
 * 清理某实例上一轮残留产物 + 缓存 json(源图清空时调用)。
 * 缓存 json 结构 { outputs: string[], ... },outputs 为「仓库根相对」路径(参考 cache.ts 的 toRepoRel);
 * 需 resolve 回绝对再删。读不到缓存 json(首次就空)→ 无需清理。删除一律容错,不让清理本身崩。
 * Clean a previous run's stale products + cache json (when sources are emptied).
 * Cache json is { outputs: string[], ... } with repo-root-relative paths; resolve back to absolute before deleting.
 * No cache json (empty on first run) → nothing to clean. Deletions are fault-tolerant.
 */
function cleanupStaleOutputs(cacheFile: string): void {
  let prev: { outputs?: string[] } | null = null
  try {
    prev = JSON.parse(readFileSync(cacheFile, "utf8")) as { outputs?: string[] }
  } catch {
    return // 读不到/解析失败 → 无可清理 / unreadable → nothing to clean
  }
  const rmIfExists = (abs: string): void => {
    try {
      rmSync(abs, { force: true })
    } catch {
      /* 删除失败容错,不崩 / tolerate deletion failure */
    }
  }
  if (prev?.outputs) for (const rel of prev.outputs) rmIfExists(resolve(process.cwd(), rel))
  rmIfExists(cacheFile)
}

/**
 * 生成单张图集(经 groupCache)。返回是否命中缓存。
 * Generate one sheet via groupCache; returns whether it was a cache hit.
 */
export async function generateSheet(item: BitmapIconsItem): Promise<boolean> {
  const { sources, padding = 2, maxWidth = 4096, maxHeight = 4096, pot = false, square = false, pixelRatio = 1, prefix = "sprite" } = item
  const includeGlobs = toGlobList(item.include)
  const include = includeGlobs.length > 0 ? includeGlobs : ["**/*.{png,jpg,jpeg,webp,avif}"]
  const exclude = toGlobList(item.exclude)
  const nameOf = item.nameTransformer ?? ((base: string) => base)

  // 规范化 sources:string → [string];供枚举/报错复用。 / Normalize sources to an array.
  const sourceDirs = (Array.isArray(sources) ? sources : [sources]).filter((d) => d !== "")
  const sourcesLabel = sourceDirs.join(", ")

  // 图集格式与四类产物路径由 output.{dir,name,ts,format} 派生(format 默认 webp,只接受 webp/png)。
  const { format, imagePath, stylePath, scriptPath, jsonPath } = derivePaths(item)

  // 本组产物的绝对路径 → 排除出源扫描(产物可与源同目录)
  const ownOut = new Set([imagePath, stylePath, scriptPath, jsonPath].map((p) => resolve(p)))

  // 1) 遍历每个源目录枚举源图(命中 include & 支持扩展名 & 非产物命名 & 未被 exclude & 非本组产物)。
  //    每个文件记其所属源目录(dirAbs)以正确 resolve 绝对路径;跨所有源目录合并后按相对名排序保证可复现。
  // Enumerate each source dir, tag each file with its dir for correct abs-resolve, merge, then sort for reproducibility.
  const selected: { rel: string; dirAbs: string }[] = []
  for (const dir of sourceDirs) {
    const dirAbs = resolve(dir)
    let rels: string[]
    try {
      rels = globSync(include, { cwd: dirAbs })
    } catch {
      rels = []
    }
    for (const rel of rels) {
      if (SUPPORTED.test(rel) && !OUTPUT_NAMING.test(rel) && !matchesAnyGlob(rel, exclude) && !ownOut.has(resolve(dirAbs, rel))) {
        selected.push({ rel, dirAbs })
      }
    }
  }
  // 按相对名排序(跨源目录合并后)保证布局/重名报错可复现。
  selected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  if (selected.length === 0) {
    // 源图全删/为空 → 清理上一轮残留产物 + 缓存 json,避免下游仍 import 旧图。
    // Source emptied → wipe last run's stale products + cache json so downstream stops importing the old sheet.
    cleanupStaleOutputs(cacheFileOf(item))
    if (item.throwable !== false) {
      throw new Error(`[bitmap-icons] 输入目录无可打包图片: ${sourcesLabel}\n[bitmap-icons] no packable images in source dir(s): ${sourcesLabel}`)
    }
    console.warn(`[bitmap-icons] ${sourcesLabel} 无可打包图片,跳过`)
    return false
  }

  // 2) 读入所有源图(一次读取:既用于缓存指纹,也复用于 sharp 合成)
  const files = selected.map(({ rel, dirAbs }) => ({ rel, abs: resolve(dirAbs, rel), buf: readFileSync(resolve(dirAbs, rel)) }))
  const inputs: GroupInput[] = files.map((f) => ({ path: f.abs, content: f.buf }))

  // 3) groupCache:输入未变 + configHash 一致 + 产物在 + 代表产物(style)hash 一致 → 命中跳过整条管线
  const result = await groupCache(
    {
      cacheFile: cacheFileOf(item),
      cache: item.cache !== false,
      configHash: configHashOf(item, { format, imagePath, stylePath, scriptPath, jsonPath }),
      inputs,
      representative: stylePath, // style(css)恒产 → 代表产物
    },
    async () => {
      // ── 未命中:measure → pack → compose → encode → emit ──
      const sharp = (await import("sharp")).default
      // 先做廉价的命名/重名校验(顺序确定,错误可复现);通过后再并行测量尺寸。
      // Cheap naming/dup validation first (deterministic, reproducible errors), then measure in parallel.
      const named: { f: (typeof files)[number]; name: string }[] = []
      const seen = new Map<string, string>()
      for (const f of files) {
        const name = nameOf(basename(f.rel, extname(f.rel)))
        if (!/^[a-zA-Z_][\w-]*$/.test(name)) throw new Error(`[bitmap-icons] 非法精灵名 "${name}"(来自 ${f.rel});需匹配 /^[a-zA-Z_][\\w-]*$/`)
        const prev = seen.get(name)
        if (prev) throw new Error(`[bitmap-icons] 精灵名冲突 "${name}":${prev} 与 ${f.rel}`)
        seen.set(name, f.rel)
        named.push({ f, name })
      }
      // 并行读取尺寸:逐张 sharp().metadata() 互相独立 → Promise.all 并行(catch 带上原始 sharp 错误)。
      // Parallel metadata reads; each is independent. Preserve the original sharp error in the catch.
      const entries: Entry[] = await Promise.all(
        named.map(async ({ f, name }) => {
          let meta: Metadata
          try {
            meta = await sharp(f.buf).metadata()
          } catch (e) {
            throw new Error(`[bitmap-icons] 无法读取为图片:${f.rel}(${String(e)})`)
          }
          if (!meta.width || !meta.height) throw new Error(`[bitmap-icons] 读不到尺寸:${f.rel}`)
          return { width: meta.width, height: meta.height, x: 0, y: 0, name, buf: f.buf }
        }),
      )

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
      writeBufferIfChanged(resolve(imagePath), await encoded.toBuffer())

      const manifest: IconManifest = {}
      // locale 无关的码点序排序,保证 manifest 顺序跨机器/locale 可复现。
      // Locale-independent codepoint-order sort for reproducible manifest across machines/locales.
      for (const r of [...bin.rects].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        manifest[r.name] = { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      const sheet: IconSheetMeta = { width: bin.width, height: bin.height, pixelRatio }
      // 四类产物恒产:样式 / 脚本 / 坐标 JSON 全部生成。
      emitStyle(stylePath, manifest, { prefix, imagePath, sheetW: bin.width, sheetH: bin.height, pixelRatio })
      emitScript(scriptPath, manifest, { imagePath, stylePath, sheet })
      emitJson(jsonPath, manifest, { imagePath, sheet })

      console.log(`[bitmap-icons] ${Object.keys(manifest).length} 张 → ${imagePath} (${bin.width}×${bin.height})`)

      // 产物均已 side-effect 写盘 → 只交路径给 groupCache 读回校验(四类恒含)
      return [{ path: imagePath }, { path: stylePath }, { path: scriptPath }, { path: jsonPath }]
    },
  )
  if (result.hit) console.log(`[bitmap-icons] 命中缓存,跳过:${imagePath}`)
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
      if (item.throwable === false) console.warn(`[bitmap-icons] ${Array.isArray(item.sources) ? item.sources.join(", ") : item.sources} 生成失败:\n${String(e)}`)
      else throw e
    }
  }
}
