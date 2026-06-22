/**
 * svg-icons 工厂 + 引擎：把「公共参数 + items[]」装配成 SVG 雪碧图。
 *
 * 职责：
 *   · 多实例：顶层公共参数合并进每个 item（item 覆盖公共）；每实例独立缓存文件。
 *   · 缓存：统一 groupCache（@codejoo/utils）——输入指纹 + configHash + 代表产物(sprite svg) hash；
 *     底层第三方工具与后处理「就地写盘」,故产物以 path-only 交给 groupCache 读回校验。
 *   · 后处理（post-process.ts）：归一化(可选) + id 作用域化 + 颜色改写 + 自产 script。
 *   · throwable：单实例失败时,true(默认)抛错中止 / false 告警继续。
 *
 * 按需加载：重依赖 vite-plugin-icons-spritesheet 经动态 import() 延迟到生成时；
 * colorfont 风格 normalize 路径在 @codejoo/utils 内部惰性加载 svgo/svgpath。
 */

import { copyFileSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import { groupCache, resolveCacheFile } from "@codejoo/utils/cache"
import { sha256 } from "@codejoo/utils/hash"

import { runPostProcess } from "./post-process.ts"

import type { ColorOption, SvgIconsItem, SvgIconsOptions, SvgIconsOutput } from "./types.ts"
import type { GroupInput } from "@codejoo/utils/cache"
import type { Plugin } from "vite"

// 生成器版本：改后处理逻辑/产物结构/缓存模型时 +1,使旧缓存失效。
const GENERATOR_VERSION = "6"

// 函数无法稳定序列化 → 用 toString() 参与指纹（改了颜色函数即视为配置变化）。
function serializeColor(c: ColorOption): string {
  return typeof c === "function" ? `fn:${c.toString()}` : JSON.stringify(c ?? null)
}

/** 合并公共参数到每个 item（item 同名字段覆盖公共）。 / Merge common into each item (item wins). */
function resolveItems(o: SvgIconsOptions): SvgIconsItem[] {
  const { items, ...common } = o
  return items.map((it) => ({ ...common, ...it }))
}

/**
 * 由 output `{ dir, name, ts? }` 派生三类产物的绝对路径（三产物恒产）。
 *   · sprite = {dir}/{name}.svg   · script = {dir}/{name}.{ts?ts:js}   · json = {dir}/{name}.json
 * Derive the three always-emitted product paths from output `{ dir, name, ts? }`.
 */
function derivePaths(output: SvgIconsOutput): { sprite: string; script: string; json: string; isTs: boolean } {
  const isTs = output.ts !== false // ts 默认 true / ts defaults to true
  const base = resolve(output.dir, output.name)
  return { sprite: `${base}.svg`, script: `${base}.${isTs ? "ts" : "js"}`, json: `${base}.json`, isTs }
}

/**
 * item + 已解析的单一 inputDir → 第三方插件原始选项。
 * inputDir 由 prepareInputDir 给出：单源目录直接用该目录，多源目录则用汇集后的临时 staging 目录。
 * item + a single resolved inputDir → underlying plugin options. The inputDir comes from
 * prepareInputDir: the source dir itself for a single source, or a merged staging dir for multiple.
 */
function toUnderlying(c: SvgIconsItem, inputDir: string) {
  const sprite = derivePaths(c.output).sprite
  // withTypes:false —— script 完全由后处理自产（iconsHref + iconsName + IconName）。
  return {
    inputDir,
    outputDir: dirname(sprite),
    fileName: `${c.output.name}.svg`,
    withTypes: false as const,
    iconNameTransformer: c.iconNameTransformer ?? ((name: string) => name),
    formatter: c.formatter ?? "oxfmt",
  }
}

/**
 * 解析喂给底层 iconsSpritesheet 的单一 inputDir（底层只吃单目录）。
 *   · 单源目录   → 直接返回该目录（不走 staging，零拷贝）。
 *   · 多源目录   → 把所有源 svg 按各自相对路径汇集进一个临时 staging 目录，返回 staging；
 *                  跨目录同名（同一相对路径 = 将来同一 symbol id）→ 抛错（仿 colorfont loadIcons）。
 * 返回 cleanup：用完删除 staging（单源目录时为 no-op）。
 *
 * Resolve the single inputDir for the underlying iconsSpritesheet (which only accepts one dir).
 * Single source → that dir as-is (no staging). Multiple sources → collect every source svg by its
 * relative path into a temp staging dir; cross-dir name clash (same relative path = same future symbol
 * id) → throw (like colorfont's loadIcons). Returns a cleanup that removes the staging dir.
 */
function prepareInputDir(sources: string | string[]): { inputDir: string; cleanup: () => void } {
  const dirs = toDirs(sources)
  if (dirs.length === 1) return { inputDir: resolve(dirs[0]), cleanup: () => {} }

  const staging = mkdtempSync(join(tmpdir(), "svg-icons-staging-"))
  // rel(相对路径，决定 symbol id) → 来源目录，用于冲突报错。 / rel → owning dir, for clash reporting.
  const seen = new Map<string, string>()
  try {
    for (const src of dirs) {
      const dir = resolve(src)
      let rels: string[] = []
      try {
        rels = globSync("**/*.svg", { cwd: dir })
      } catch {
        rels = []
      }
      for (const rel of rels) {
        const norm = rel.split("\\").join("/")
        const prev = seen.get(norm)
        if (prev !== undefined) {
          throw new Error(`[svg-icons] 跨源目录图标名冲突: "${norm}"(来自 ${prev} 与 ${dir})\n[svg-icons] icon name clash across sources: "${norm}" (from ${prev} and ${dir})`)
        }
        seen.set(norm, dir)
        const dest = join(staging, norm)
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(resolve(dir, rel), dest)
      }
    }
  } catch (e) {
    rmSync(staging, { recursive: true, force: true }) // 出错也清理临时目录 / clean up on error too
    throw e
  }
  return { inputDir: staging, cleanup: () => rmSync(staging, { recursive: true, force: true }) }
}

/** sources 规范化为目录数组（string → [string]）。 / Normalize sources to a directory array. */
function toDirs(sources: string | string[]): string[] {
  return Array.isArray(sources) ? sources : [sources]
}

/**
 * 读取多个源目录的 svg（每目录内 glob,合并后按绝对路径排序）→ GroupInput[]（路径 + 内容）。
 * Read svgs across source dirs (glob per dir, merge, sort by absolute path) → GroupInput[].
 */
function readInputs(sources: string | string[]): GroupInput[] {
  const out: GroupInput[] = []
  for (const src of toDirs(sources)) {
    const dir = resolve(src)
    let rels: string[] = []
    try {
      rels = globSync("**/*.svg", { cwd: dir })
    } catch {
      rels = []
    }
    for (const rel of rels) {
      // 读失败直接传播（由 svgIcons() runner 的 throwable 接管），不再静默吞掉。
      // Propagate read failures (handled by svgIcons() runner's throwable); no silent swallow.
      out.push({ path: resolve(dir, rel), content: readFileSync(resolve(dir, rel)) })
    }
  }
  // 跨目录合并后统一按绝对路径排序，保证产物稳定。 / Stable order across merged dirs.
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/** 影响产物的配置指纹（不含输入内容,那在 groupCache.files 里）。 / Config fingerprint (excludes inputs). */
function configHashOf(c: SvgIconsItem): string {
  const p = derivePaths(c.output)
  return sha256(
    JSON.stringify({
      v: GENERATOR_VERSION,
      sprite: p.sprite, // 代表产物 = 雪碧图 / representative product = sprite
      name: c.output.name,
      ts: p.isTs,
      color: serializeColor(c.color),
      normalize: JSON.stringify(c.normalize ?? null),
      nameTransformer: c.iconNameTransformer?.toString() ?? null,
      formatter: c.formatter ?? "oxfmt",
    }),
  )
}

/** 每实例缓存文件:cacheFilename 优先;否则由 output.name 派生唯一默认名。 / Per-item cache file. */
function cacheFileOf(item: SvgIconsItem): string {
  const def = `svg-icons-${item.output.name}`
  return resolveCacheFile(def, item.cacheFilename)
}

/** 把底层 iconsSpritesheet 插件的 buildStart 包成一个可调用的 runner（Vite 之外）。 / Wrap underlying buildStart. */
async function underlyingRunnerFor(opts: ReturnType<typeof toUnderlying>): Promise<() => Promise<void>> {
  const { iconsSpritesheet } = await import("vite-plugin-icons-spritesheet")
  const plugins = iconsSpritesheet([opts] as Parameters<typeof iconsSpritesheet>[0]) as Plugin[]
  const bs = plugins[0]?.buildStart
  // rollup 上下文桩:底层 buildStart 内若访问 this.xxx() 一律 no-op（Vite 之外）。
  const ctx = new Proxy({}, { get: () => () => {} })
  if (typeof bs !== "function") return async () => {}
  return () => (bs as (...a: unknown[]) => unknown).call(ctx) as Promise<void>
}

/** 单实例生成(经 groupCache)。返回是否命中。三产物(sprite/script/json)恒产。 / Generate one instance; returns hit. */
async function generateOne(item: SvgIconsItem): Promise<boolean> {
  // 输入只读一次，复用进 groupCache（避免读两遍）。空输入 → 抛错（由 svgIcons() runner 的 throwable 接管）。
  // 指纹始终读「真实源文件」（readInputs 聚合所有源目录），与 staging 无关。
  // Read inputs once and reuse. Fingerprint always reads the real source files across all dirs.
  const inputs = readInputs(item.sources)
  if (inputs.length === 0) {
    const where = toDirs(item.sources).join(", ")
    throw new Error(`[svg-icons] 输入目录未找到任何 .svg: ${where}\n[svg-icons] no .svg files found in input dir: ${where}`)
  }
  const paths = derivePaths(item.output)
  const r = await groupCache(
    {
      cacheFile: cacheFileOf(item),
      cache: item.cache !== false,
      configHash: configHashOf(item),
      inputs,
      representative: paths.sprite, // sprite svg 恒产 → 代表产物 / sprite always emitted → representative
    },
    async () => {
      // 多源目录:先汇集到临时 staging 目录喂底层(底层只吃单目录);单源目录直接用该目录(零拷贝)。
      // Multi-source → stage svgs into a temp dir for the single-dir underlying; single source uses it directly.
      const { inputDir, cleanup } = prepareInputDir(item.sources)
      try {
        // 第三方工具写出 sprite svg → 后处理就地重写(作用域/颜色)+ 自产 script + emit json 清单。
        const run = await underlyingRunnerFor(toUnderlying(item, inputDir))
        await run()
      } finally {
        cleanup() // 无论成败都清理 staging / always clean up staging
      }
      await runPostProcess({ sprite: paths.sprite, script: paths.script, json: paths.json, color: item.color, normalize: item.normalize })
      // 产物经 side-effect 写盘,只交路径给 groupCache 读回校验。三产物恒含。
      return [{ path: paths.sprite }, { path: paths.script }, { path: paths.json }]
    },
  )
  return r.hit
}

/**
 * 引擎入口（Vite 之外可单独调用）：按 items 生成所有 SVG 雪碧图 + 类型化脚本,维护各实例缓存。
 * 单实例失败:throwable!==false → 抛错中止;否则告警继续。
 */
export async function svgIcons(options: SvgIconsOptions): Promise<void> {
  const items = resolveItems(options)
  for (const item of items) {
    try {
      const hit = await generateOne(item)
      if (hit) console.log(`[svg-icons] 命中缓存,跳过:${derivePaths(item.output).sprite}`)
    } catch (e) {
      if (item.throwable === false) console.warn(`[svg-icons] ${toDirs(item.sources).join(", ")} 生成失败:\n${String(e)}`)
      else throw e
    }
  }
}

/**
 * vite 插件工厂：返回单个 Plugin。buildStart 生成全部;源目录变更(watch/HMR)则重生成。
 * Vite plugin factory: a single Plugin; regenerates on source changes.
 */
export function svgIconsVite(options: SvgIconsOptions): Plugin {
  const items = resolveItems(options)
  // 每个 item 的 sources 可为多目录 → 展开成多 root,affects 覆盖全部 root。
  // Each item's sources may be multiple dirs → expand into multiple roots; affects covers them all.
  const roots = items.flatMap((c) => toDirs(c.sources).map((s) => resolve(s)))
  // 自身三产物(sprite/script/json)都排除在 watch 之外，避免改写自己触发重生成。
  // Exclude all three own products (sprite/script/json) from watch so self-writes don't re-trigger.
  const ownOutputs = new Set(items.flatMap((c) => { const p = derivePaths(c.output); return [p.sprite, p.script, p.json] }))
  // 仅当变更文件落在某源目录内（且非自身产物）才重生成。
  const affects = (file: string): boolean => {
    const f = resolve(file)
    if (ownOutputs.has(f)) return false
    return roots.some((root) => {
      const rel = relative(root, f)
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
    })
  }
  // in-flight 合并:watchChange 与 handleHotUpdate 可能为同一次保存并发触发 →
  // 同一时刻只跑一次,进行中再来的触发尾随一次,避免并发写同一产物 + 缓存。
  // In-flight coalescing: dedupe concurrent watchChange/handleHotUpdate; run once, tail one rerun.
  let running: Promise<void> | null = null
  let pending = false
  const regenerate = (): Promise<void> => {
    if (running) {
      pending = true
      return running
    }
    running = (async () => {
      try {
        await svgIcons(options)
        while (pending) {
          pending = false
          await svgIcons(options)
        }
      } finally {
        running = null
        pending = false
      }
    })()
    return running
  }
  return {
    name: "vite-plugin-svg-icons",
    async buildStart() {
      await svgIcons(options)
    },
    async watchChange(id) {
      if (affects(id)) await regenerate()
    },
    async handleHotUpdate({ file }) {
      if (affects(file)) await regenerate()
    },
  }
}
