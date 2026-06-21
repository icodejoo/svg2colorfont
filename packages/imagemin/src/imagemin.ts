/**
 * 图片压缩核心 —— sharp（位图） + svgo（矢量）
 * Image compression engine — sharp (bitmaps) + svgo (vectors).
 *
 * 哈希缓存机制（避免对同一张图重复压缩，且可随源码提交、团队共享）：
 *   缓存结构为 `{ 相对路径: 压缩后(最终落盘)内容的 hash }`，提交进 git。
 *   1. 运行时读取 JSON 到 `old`；同时把所有 value 收进 `reverse` 反查表（指纹 → 路径），
 *      并把"磁盘上仍存在的条目"搬进临时对象 `temp`
 *      —— 不存在的文件条目（已删除/被移走的旧路径）就此被剪枝（防 JSON 膨胀）。
 *   2. 处理每张图前先算它当前内容的 hash，命中以下任一即跳过：
 *        · `old[path] === hash` → 同路径内容未变（最常见）
 *        · `reverse.has(hash)` → 内容指纹此前已压缩过 ⇒ 文件被
 *          移动/重命名/复制：路径变了但内容是旧的"最终成品"，无需再压。
 *      否则压缩；仅当结果更小才写回磁盘；再把"磁盘最终内容"的 hash 写入 `temp[path]`。
 *   3. 结束后把 `temp` 写回 JSON（重命名后的新路径随之"接管"该条目）。
 *
 *   团队协作：拉取仓库后图片与缓存同源 → hash 命中 → 不再重复压缩。
 *   重命名/移动友好：缓存以"内容指纹"为准而非路径，挪动文件不会触发重复压缩。
 *   安全性：只有"压缩后更小"才写回，否则保留原图，绝不劣化或反向增大。
 *
 * sharp / svgo 为重依赖，全部在 compress() 内「动态导入」：仅当真正压缩时才加载，
 * 故仅导入本引擎 API 不会拉起 sharp/svgo。
 * sharp / svgo are heavy deps, dynamically imported inside compress(): importing the engine
 * API never loads them until compression actually runs.
 */

import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { extname, relative } from "node:path"

import { resolveCacheFile, openPerFileCache } from "@codejoo/utils/cache"
import { matchesAnyGlob, toGlobList } from "@codejoo/utils/glob"
import { sha256 } from "@codejoo/utils/hash"
import { scaleSvgToWidth } from "@codejoo/utils/scale-svg"

// sharp 0.35+ 以命名空间默认导出暴露选项类型(无具名导出),故按 sharp.X 引用(仅类型,运行时擦除)。
// sharp 0.35+ exposes option types via its default-export namespace (no named exports) -> reference as sharp.X (type-only).
import type { SharpOptions, ResizeOptions, PngOptions, JpegOptions, WebpOptions, AvifOptions, TiffOptions, GifOptions, Sharp } from "./sharp-types.ts"
import type { Config as SvgoConfig } from "svgo"

// 转发 glob 助手，便于 CLI / 调用方从本引擎一处导入（语义与 @codejoo/utils/glob 完全一致）。
// Re-export the glob helpers so the CLI / callers can import them from one place.
export { matchesAnyGlob, toGlobList } from "@codejoo/utils/glob"

export interface ImageminOptions {
  /** 仅处理匹配这些 glob 的文件（include）；可传单个或数组，如 "**\/*.{png,svg}" */
  include: string | string[]
  /** 命中这些 glob 的文件跳过（exclude，优先级高于 include）；可传单个或数组 */
  exclude?: string | string[]
  /**
   * 哈希缓存 JSON 路径（可选）。
   *   · 省略       → 落共享缓存目录 `.cache.graphics/imagemin.json`（随源码提交以便团队共享）。
   *   · 裸文件名   → `.cache.graphics/<name>.json`。
   *   · 含路径分隔 → 按完整路径解析（完全自定义位置）。
   * Hash-cache JSON path (optional). Omit → shared `.cache.graphics/imagemin.json`.
   */
  cacheFile?: string
  /** 打印每张图的压缩统计 */
  logStats?: boolean
  /** 同时处理的图片数（并发）。默认 8 以平衡速度与内存 */
  concurrency?: number
  /**
   * 出错时是否抛出并中止流程（默认 true）。
   *   · true  → 任一图失败即抛错中止（vite/closeBundle 走 vite 报错；CLI 非零退出 → 阻断提交）。
   *   · false → 仅 console.warn 告警并继续（成功项照常落盘+缓存，失败项下次重试）。
   * Throw & abort on error (default true); false → warn & continue.
   */
  throwable?: boolean

  // ── 位图：以下均为对应底层依赖的「完整」选项对象，直接透传 ──
  /** sharp 构造参数（animated / failOn / limitInputPixels / density / pages …） */
  sharpOptions?: SharpOptions
  /** 统一缩放（在编码前应用） */
  resize?: ResizeOptions
  /** 保留元数据（默认 sharp 会剥离以减小体积） */
  keepMetadata?: boolean
  /** 按 EXIF 方向自动旋转 */
  rotate?: boolean
  /** sharp.png() 全部选项 */
  png?: PngOptions
  /** sharp.jpeg() 全部选项 */
  jpeg?: JpegOptions
  /** sharp.jpeg() 全部选项（.jpg 扩展名专用，缺省回退 jpeg） */
  jpg?: JpegOptions
  /** sharp.webp() 全部选项 */
  webp?: WebpOptions
  /** sharp.avif() 全部选项 */
  avif?: AvifOptions
  /** sharp.tiff() 全部选项 */
  tiff?: TiffOptions
  /** sharp.gif() 全部选项 */
  gif?: GifOptions

  // ── 矢量：svgo 的「完整」Config，直接透传 ──
  /** svgo optimize() 的完整配置（plugins / multipass / js2svg / floatPrecision …） */
  svg?: SvgoConfig
  /**
   * SVG 目标 viewBox 宽度（防小 viewBox 整数化变形）。默认 1024。
   *   · number → 把无 <filter> 的 SVG 等比放大到该宽度，再用 floatPrecision:0 整数取整
   *     （大坐标系整数化误差 <0.05%：干掉小数又不变形）。归一化结果即使字节略增也会强制写回。
   *   · false / 0 → 不归一化。
   *   · (filename, size) => number | falsy → 按文件定制：size 为该 SVG 当前 viewBox 宽度，
   *     返回目标宽度；返回 falsy 则该图不归一化（走安全精度 svg.floatPrecision ?? 2）。
   *   · 含 <filter> 的复杂 SVG（stdDeviation 等难缩放）一律不归一化、用安全精度。
   */
  svgSize?: number | false | ((filename: string, size: number) => number | false | null | undefined)
}

export interface FileResult {
  file: string
  /** 命中缓存被跳过 */
  skipped: boolean
  /** 因重命名/移动/复制（内容指纹命中）而跳过：仅迁移了缓存 key */
  moved?: boolean
  /** 磁盘内容是否被改写（用于判断是否需要重新 stage） */
  changed: boolean
  before: number
  after: number
  error?: string
}

export interface OptimizeResult {
  results: FileResult[]
  /** 实际被改写的文件（相对路径，供 git 重新 stage） */
  changed: string[]
  /** 实际使用的缓存文件绝对路径 */
  cacheFile: string
}

// imagemin 缓存版本:改判定/产出逻辑时 +1。
const IMAGEMIN_CACHE_VERSION = "imagemin-v2"

/**
 * 影响产物的压缩参数指纹(并入 configHash)。参数变(如 webp q80→q60)→ 整表作废、全部按新参数重压。
 * include/exclude/cacheFile/logStats/concurrency 不影响产物,故不计入。函数(如 svgSize)按 toString 序列化。
 */
function imageminConfigHash(o: ImageminOptions): string {
  const sig = {
    v: IMAGEMIN_CACHE_VERSION,
    png: o.png, jpeg: o.jpeg, jpg: o.jpg, webp: o.webp, avif: o.avif, tiff: o.tiff, gif: o.gif,
    svg: o.svg, svgSize: o.svgSize, resize: o.resize, sharpOptions: o.sharpOptions, keepMetadata: o.keepMetadata, rotate: o.rotate,
  }
  return sha256(JSON.stringify(sig, (_k, v) => (typeof v === "function" ? `fn:${v.toString()}` : v)))
}

const kib = (n: number): string => `${(n / 1024).toFixed(2)} KiB`

const toRel = (file: string): string => relative(process.cwd(), file).replace(/\\/g, "/")

/** compress 结果：data=压缩后字节；force=即使不更小也写回（用于 SVG 归一化这类"有意变换"）。 */
interface CompressResult {
  data: Buffer
  force: boolean
}

/**
 * 调 sharp / svgo 压缩；不支持的格式返回 null。file 为相对路径，供 svgSize 函数定制。
 * sharp 与 svgo 在此「动态导入」—— 仅当真正压缩时才加载这两个重依赖。
 */
async function compress(buf: Buffer, ext: string, o: ImageminOptions, file: string): Promise<CompressResult | null> {
  if (ext === "svg") {
    const { optimize } = await import("svgo")
    const text = buf.toString("utf8")
    const base = o.svg ?? {}
    const hasFilter = /<filter[\s>]/i.test(text)
    // 当前 viewBox 宽度（取第 3 个数）；解析目标宽度
    const vb = /viewBox\s*=\s*"([^"]+)"/i.exec(text)
    const curW = vb ? Number(vb[1].split(/[\s,]+/)[2]) : 0
    const sizeOpt = o.svgSize ?? 1024
    const target = typeof sizeOpt === "function" ? sizeOpt(file, curW) : sizeOpt

    // 简单 SVG（无 filter）且目标有效：等比放大到 target 烘焙坐标 → floatPrecision:0 整数取整（无损）。
    // 归一化是"有意变换"，force=true → 即使字节略增也写回，保证 viewBox 统一。
    if (!hasFilter && target && target > 0 && curW > 0) {
      const scaled = await scaleSvgToWidth(text, target)
      const { data } = optimize(scaled, { ...base, floatPrecision: 0 })
      return { data: Buffer.from(data, "utf8"), force: true }
    }
    // 含 filter / 关闭归一化：不放大，安全精度，仅"更小"才写回。
    const { data } = optimize(text, { ...base, floatPrecision: base.floatPrecision ?? 2 })
    return { data: Buffer.from(data, "utf8"), force: false }
  }

  const sharp = (await import("sharp")).default
  let img = sharp(buf, { animated: true, failOn: "none", ...o.sharpOptions })
  if (o.rotate) img = img.rotate()
  if (o.resize) img = img.resize(o.resize)
  if (o.keepMetadata) img = img.keepMetadata()

  let encoded: Sharp
  switch (ext) {
    case "png":
      encoded = img.png(o.png)
      break
    case "jpg":
    case "jpeg":
      encoded = img.jpeg(o.jpg ?? o.jpeg)
      break
    case "webp":
      encoded = img.webp(o.webp)
      break
    case "avif":
      encoded = img.avif(o.avif)
      break
    case "tif":
    case "tiff":
      encoded = img.tiff(o.tiff)
      break
    case "gif":
      encoded = img.gif(o.gif)
      break
    default:
      return null
  }
  return { data: await encoded.toBuffer(), force: false }
}

/** 有上限的并发执行（无第三方依赖） */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

export async function imagemin(files: string[], options: ImageminOptions): Promise<OptimizeResult> {
  // 缓存文件：可选；省略时落共享目录 .cache.graphics/imagemin.json。
  // 统一逐文件缓存(含反查表):路径命中→skip;内容指纹命中(改名/移动/复制)→moved(迁移 key);否则 process。
  // configHash 并入压缩参数:参数变 → 整表作废、全部按新参数重压。
  const cacheFile = resolveCacheFile("imagemin", options.cacheFile)
  const cache = openPerFileCache(cacheFile, imageminConfigHash(options))

  // 只处理"存在 & 命中 include glob & 未命中 exclude glob"的文件；删除项由 openPerFileCache 内部按 existsSync 剪枝。
  const include = toGlobList(options.include)
  const exclude = toGlobList(options.exclude)
  const targets = files.filter((f) => {
    if (!existsSync(f)) return false
    const rel = toRel(f)
    return matchesAnyGlob(rel, include) && !matchesAnyGlob(rel, exclude)
  })
  const limit = options.concurrency ?? 8

  const results = await mapPool(targets, limit, async (file): Promise<FileResult> => {
    const rel = toRel(file)
    try {
      const buf = await readFile(file)
      const action = cache.decide(rel, sha256(buf))
      if (action === "skip") return { file: rel, skipped: true, changed: false, before: buf.length, after: buf.length }
      if (action === "moved") return { file: rel, skipped: true, moved: true, changed: false, before: buf.length, after: buf.length }

      const ext = extname(file).slice(1).toLowerCase()
      const out = await compress(buf, ext, options, rel)

      // 写回条件：内容确有变化 且（force=有意变换 / 或结果更小）。
      //   · 普通压缩：仅"更小"才写回，绝不放大；
      //   · SVG 归一化(force)：即使略大也写回，以落实"viewBox 统一"。
      let finalBuf: Buffer = buf
      if (out && out.data.length > 0 && !out.data.equals(buf) && (out.force || out.data.length < buf.length)) {
        finalBuf = out.data
        // 以 Uint8Array 视图写出:规避 @types/node 24 中 Buffer<ArrayBufferLike> 与 NonSharedBuffer 的类型摩擦。
        await writeFile(file, new Uint8Array(finalBuf.buffer, finalBuf.byteOffset, finalBuf.byteLength))
      }

      cache.record(rel, sha256(finalBuf)) // 记录"磁盘最终内容"的 hash
      return { file: rel, skipped: false, changed: finalBuf !== buf, before: buf.length, after: finalBuf.length }
    } catch (err) {
      // 失败不 record 该文件 → 不入缓存,下次重试;错误收集后批末强制抛出。
      return { file: rel, skipped: false, changed: false, before: 0, after: 0, error: String((err as Error)?.message ?? err) }
    }
  })

  cache.save() // 成功项(已 record)写入缓存;失败项未 record → 不入缓存

  if (options.logStats) printStats(results)

  // 错误处理由 throwOnError 开关控制(默认 true):成功项已落盘 + 缓存;失败项未入缓存、下次重试。
  //   · true  → 抛出汇总(vite/closeBundle 走 vite 报错;CLI 非零退出 → 阻断提交)。
  //   · false → 仅 console.warn 告警并继续。
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    const msg = `[imagemin] ${failed.length}/${targets.length} 张处理失败:\n${failed.map((r) => `  · ${r.file}: ${r.error}`).join("\n")}`
    if (options.throwable === false) console.warn(msg)
    else throw new Error(msg) // 默认 true:抛错中止
  }

  return {
    results,
    changed: results.filter((r) => r.changed).map((r) => r.file),
    cacheFile,
  }
}

function printStats(results: FileResult[]): void {
  const processed = results.filter((r) => !r.skipped && !r.error)
  const skipped = results.filter((r) => r.skipped)
  const failed = results.filter((r) => r.error)

  for (const r of processed) {
    if (r.changed) {
      const pct = (((r.before - r.after) / r.before) * 100).toFixed(1)
      console.log(`  ✓ ${r.file}  ${kib(r.before)} → ${kib(r.after)}  (-${pct}%)`)
    } else {
      console.log(`  · ${r.file}  已最优，保留原图`)
    }
  }
  for (const r of skipped) console.log(`  ⟳ ${r.file}  ${r.moved ? "重命名/移动，仅迁移缓存 key" : "命中缓存，跳过"}`)
  for (const r of failed) console.warn(`  ✗ ${r.file}  压缩失败：${r.error}`)
  const before = processed.reduce((s, r) => s + r.before, 0)
  const after = processed.reduce((s, r) => s + r.after, 0)
  const tail = before > 0 ? `，共省 ${kib(before - after)} (${(((before - after) / before) * 100).toFixed(1)}%)` : ""
  console.log(`[imagemin] 处理 ${processed.length}，跳过 ${skipped.length}，失败 ${failed.length}${tail}`)
}
