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

import { globSync, readFileSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"

import { groupCache, resolveCacheFile } from "@codejoo/utils/cache"
import { sha256 } from "@codejoo/utils/hash"

import { runPostProcess } from "./post-process.ts"

import type { ColorOption, SvgIconsItem, SvgIconsOptions } from "./types.ts"
import type { GroupInput } from "@codejoo/utils/cache"
import type { Plugin } from "vite"

// 生成器版本：改后处理逻辑/产物结构/缓存模型时 +1,使旧缓存失效。
const GENERATOR_VERSION = "5"

// 函数无法稳定序列化 → 用 toString() 参与指纹（改了颜色函数即视为配置变化）。
function serializeColor(c: ColorOption): string {
  return typeof c === "function" ? `fn:${c.toString()}` : JSON.stringify(c ?? null)
}

/** 合并公共参数到每个 item（item 同名字段覆盖公共）。 / Merge common into each item (item wins). */
function resolveItems(o: SvgIconsOptions): SvgIconsItem[] {
  const { items, ...common } = o
  return items.map((it) => ({ ...common, ...it }))
}

/** item → 第三方插件原始选项。 / Map an item to the underlying plugin's options. */
function toUnderlying(c: SvgIconsItem) {
  // withTypes:false —— script 完全由后处理自产（iconsHref + iconsName + IconName）。
  return {
    inputDir: c.input,
    outputDir: dirname(c.output.svg),
    fileName: basename(c.output.svg),
    withTypes: false as const,
    iconNameTransformer: c.iconNameTransformer ?? ((name: string) => name),
    formatter: c.formatter ?? "oxfmt",
  }
}

/** 读取源 svg（按名排序）→ GroupInput[]（路径 + 内容）。 / Read source svgs → GroupInput[]. */
function readInputs(input: string): GroupInput[] {
  const dir = resolve(input)
  let rels: string[] = []
  try {
    rels = globSync("**/*.svg", { cwd: dir })
  } catch {
    rels = []
  }
  rels.sort()
  const out: GroupInput[] = []
  for (const rel of rels) {
    try {
      out.push({ path: resolve(dir, rel), content: readFileSync(resolve(dir, rel)) })
    } catch {
      /* 读不到就略过（下次仍会 miss） */
    }
  }
  return out
}

/** 影响产物的配置指纹（不含输入内容,那在 groupCache.files 里）。 / Config fingerprint (excludes inputs). */
function configHashOf(c: SvgIconsItem): string {
  return sha256(
    JSON.stringify({
      v: GENERATOR_VERSION,
      svg: c.output.svg,
      script: c.output.script ?? null,
      color: serializeColor(c.color),
      normalize: JSON.stringify(c.normalize ?? null),
      nameTransformer: c.iconNameTransformer?.toString() ?? null,
      formatter: c.formatter ?? "oxfmt",
    }),
  )
}

/** 每实例缓存文件:cacheFilename 优先;否则由输出名派生唯一默认名。 / Per-item cache file. */
function cacheFileOf(item: SvgIconsItem): string {
  const def = `svg-icons-${basename(item.output.svg).replace(/\.\w+$/, "")}`
  return resolveCacheFile(def, item.cacheFilename)
}

/** 单实例生成(经 groupCache)。返回是否命中。 / Generate one instance via groupCache; returns hit. */
async function generateOne(item: SvgIconsItem, underlyingBuildStart?: () => Promise<void>): Promise<boolean> {
  const r = await groupCache(
    {
      cacheFile: cacheFileOf(item),
      cache: item.cache !== false,
      configHash: configHashOf(item),
      inputs: readInputs(item.input),
      representative: item.output.svg, // sprite svg 必产 → 代表产物
    },
    async () => {
      // 第三方工具写出 sprite svg → 后处理就地重写(作用域/颜色)+ 自产 script。
      if (underlyingBuildStart) await underlyingBuildStart()
      await runPostProcess({ sprite: item.output.svg, script: item.output.script, color: item.color, normalize: item.normalize })
      // 产物经 side-effect 写盘,只交路径给 groupCache 读回校验。
      const products: { path: string }[] = [{ path: item.output.svg }]
      if (item.output.script) products.push({ path: item.output.script })
      return products
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
  const { iconsSpritesheet } = await import("vite-plugin-icons-spritesheet")
  const underlying = iconsSpritesheet(items.map(toUnderlying) as Parameters<typeof iconsSpritesheet>[0]) as Plugin[]
  // rollup 上下文桩:底层 buildStart 内若访问 this.xxx() 一律 no-op（Vite 之外）。
  const ctx = new Proxy({}, { get: () => () => {} })
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      const bs = underlying[i]?.buildStart
      const run = typeof bs === "function" ? () => (bs as (...a: unknown[]) => unknown).call(ctx) as Promise<void> : undefined
      const hit = await generateOne(item, run)
      if (hit) console.log(`[svg-icons] 命中缓存,跳过:${item.output.svg}`)
    } catch (e) {
      if (item.throwable === false) console.warn(`[svg-icons] ${item.input} 生成失败:\n${String(e)}`)
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
  const roots = items.map((c) => resolve(c.input))
  const ownOutputs = new Set(items.flatMap((c) => [c.output.svg, c.output.script].filter((p): p is string => Boolean(p)).map((p) => resolve(p))))
  // 仅当变更文件落在某 input 目录内（且非自身产物）才重生成。
  const affects = (file: string): boolean => {
    const f = resolve(file)
    if (ownOutputs.has(f)) return false
    return roots.some((root) => {
      const rel = relative(root, f)
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
    })
  }
  return {
    name: "vite-plugin-svg-icons",
    async buildStart() {
      await svgIcons(options)
    },
    async watchChange(id) {
      if (affects(id)) await svgIcons(options)
    },
    async handleHotUpdate({ file }) {
      if (affects(file)) await svgIcons(options)
    },
  }
}
