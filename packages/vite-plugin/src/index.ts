/**
 * graphics-icon/vite —— 伞 Vite 插件入口(唯一对外的 Vite 形态)。
 * Umbrella Vite plugin: composes the four engines under one option set, returns a SINGLE plugin.
 *
 * 组合 / Composes:
 *   · colorfont    —— 一组 SVG 图标 → 彩色 webfont,**实物落盘**到 outDir(.woff2/.woff + .css + .ts)。
 *   · svgIcons     —— SVG <symbol> 雪碧图(svg-icons 插件工厂)。
 *   · bitmapIcons  —— 位图雪碧图(bitmap-icons 插件工厂)。
 *   · imagemin     —— 构建产物图片压缩(closeBundle)。
 *
 * 多实例:colorfonts/svgIcons/bitmapIcons 均为 `{ ...公共, items:[...] }`(每项与公共合并)。
 * 缓存:各引擎自持(groupCache);vite 模式每实例用 `cacheName`(仅文件名,落 .cache.graphics/),伞层映射为引擎的 `cacheFilename`。
 * 错误:各实例 `throwable`(默认 true)→ 失败抛错(vite 报错);false → 告警继续。
 *
 * 引擎/命令函数(Vite 之外)请从各子路径导入(graphics-icon/bitmap 等)。
 */

import { isAbsolute, relative, resolve } from 'node:path'
import { promises as fs } from 'node:fs'

import { svgIconsVite } from 'svg-icons'
import { bitmapIconsVite } from 'bitmap-icons'
import { colorfonts } from '@codejoo/colorfont'
import { unusedVite } from '@codejoo/unused'
import * as imageminEngine from '@codejoo/imagemin'

import type { Plugin } from 'vite'
import type { ColorfontCommon, ColorfontItem, ColorfontOptions } from '@codejoo/colorfont'
import type { SvgIconsCommon, SvgIconsItem } from 'svg-icons'
import type { BitmapIconsCommon, BitmapIconsItem } from 'bitmap-icons'
import type { UnusedDetectOptions } from '@codejoo/unused'

// ── vite 选项:每实例用 cacheName(仅文件名),不暴露独立模式的 cacheFilename ──
/** 把实例的 `cacheFilename` 替换为 `cacheName`(vite 模式只给名字,目录由系统管理)。 */
type ViteItem<T> = Omit<T, 'cacheFilename'> & {
  /** 该实例缓存文件名(落共享目录 .cache.graphics/;省略 → 由输出名派生)。 */
  cacheName?: string
}

/** colorfont 子选项(vite):公共参数 + items + 插件层 watch/devFast。 */
export interface ColorfontPluginOptions extends ColorfontCommon {
  items: ViteItem<ColorfontItem>[]
  /** dev 期监听 .svg 源变更并重生成,默认 true。 */
  watch?: boolean
  /** dev 极速档:woff2 用 q9(更快、体积略大),默认 true。 */
  devFast?: boolean
}
/** svgIcons 子选项(vite)。 */
export interface SvgIconsPluginOptions extends SvgIconsCommon {
  items: ViteItem<SvgIconsItem>[]
}
/** bitmapIcons 子选项(vite)。 */
export interface BitmapIconsPluginOptions extends BitmapIconsCommon {
  items: ViteItem<BitmapIconsItem>[]
}
/** imagemin 子选项(vite):引擎选项部分覆盖 + enabled 开关(imagemin 为单例,无 items)。 */
export type ImageminPluginOptions = Partial<imageminEngine.ImageminOptions> & {
  /** 关闭则 closeBundle 不压缩(默认开启)。 */
  enabled?: boolean
}

/**
 * 伞插件统一选项。每个子键:传对象 → 启用;传 `false`/省略 → 跳过。
 */
export interface GraphicsIconOptions {
  colorfonts?: ColorfontPluginOptions | false
  svgIcons?: SvgIconsPluginOptions | false
  bitmapIcons?: BitmapIconsPluginOptions | false
  imagemin?: ImageminPluginOptions | false
  /**
   * 未使用资产检测:build 期经模块图 diff 写出清单表(.cache.graphics/unused.json),供 `removeUnused`/
   * `remove-unused` 删除。四引擎(colorfonts/svgIcons/bitmapIcons)的输入目录与产物会自动并入排除。
   * `exclude` 为额外排除项(在自动排除之上追加)。
   */
  unused?: UnusedDetectOptions | false
}

/**
 * 收集四引擎的「输入目录(/**) + 产物路径」作为 unused 检测的排除项 —— 引擎消费资产但不被源码 import,
 * 不排除会被误判为未使用而误删。仅取各实例 items 上可靠存在的 input/output 字段。
 */
function engineExcludes(options: GraphicsIconOptions): string[] {
  const out: string[] = []
  // 归一为「仓库根(cwd)相对、正斜杠」——与 unusedVite 候选路径的匹配口径一致(绝对/相对配置皆可)。
  const rel = (p: string): string => relative(process.cwd(), resolve(p)).replace(/\\/g, '/')
  const dirGlob = (p: string): string => `${rel(p).replace(/\/+$/, '')}/**`
  const pushDir = (input: string | string[] | undefined): void => {
    for (const d of Array.isArray(input) ? input : input ? [input] : []) out.push(dirGlob(d))
  }
  const pushFile = (p: string | undefined): void => {
    if (p) out.push(rel(p))
  }

  if (options.colorfonts) for (const it of options.colorfonts.items ?? []) { pushDir(it.input); if (it.outDir) out.push(dirGlob(it.outDir)) }
  if (options.svgIcons) for (const it of options.svgIcons.items ?? []) { pushDir(it.input); pushFile(it.output?.svg); pushFile(it.output?.script) }
  if (options.bitmapIcons) for (const it of options.bitmapIcons.items ?? []) { pushDir(it.inputDir); pushFile(it.output?.image); pushFile(it.output?.style); pushFile(it.output?.script); pushFile(it.output?.json) }
  return out
}

/** 把 vite 实例数组的 `cacheName` 映射为引擎的 `cacheFilename`(resolveCacheFile 按裸名落共享目录)。 */
function mapItems<T extends { cacheName?: string }>(items: T[]): Array<Omit<T, 'cacheName'> & { cacheFilename?: string }> {
  return items.map((it) => {
    const { cacheName, ...rest } = it
    return cacheName != null ? { ...rest, cacheFilename: cacheName } : (rest as Omit<T, 'cacheName'>)
  })
}

/** 某文件是否落在某 input 目录内(用于 watch 判定)。 */
function underAny(file: string, dirs: string[]): boolean {
  const f = resolve(file)
  return dirs.some((d) => {
    const rel = relative(d, f)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

// ── colorfont 子插件(实物落盘,无虚拟模块/中间件) ──
function colorfontsVite(opts: ColorfontPluginOptions): Plugin {
  const { watch, devFast, items, ...common } = opts
  const baseItems = mapItems(items) as ColorfontItem[]
  const inputDirs = items.flatMap((it) => (Array.isArray(it.input) ? it.input : [it.input])).map((d) => resolve(d))
  let isBuild = false

  const run = async (): Promise<void> => {
    // dev 极速档:未显式设 woff2Quality 时用 q9;build 用默认(11)。
    const o: ColorfontOptions =
      !isBuild && devFast !== false ? { ...common, woff2Quality: common.woff2Quality ?? 9, items: baseItems } : { ...common, items: baseItems }
    await colorfonts(o)
  }
  const affects = (file: string): boolean => file.toLowerCase().endsWith('.svg') && underAny(file, inputDirs)

  return {
    name: 'graphics-icon:colorfont',
    configResolved(config: { command?: string }) {
      isBuild = config.command === 'build'
    },
    async buildStart() {
      await run()
    },
    async watchChange(id: string) {
      if (watch !== false && affects(id)) await run()
    },
    async handleHotUpdate(ctx: { file: string }) {
      if (watch !== false && affects(ctx.file)) await run()
    },
  } as Plugin
}

// ── imagemin 子插件(closeBundle 压缩产物目录图片) ──
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.tif', '.tiff', '.webp', '.avif', '.svg'])

async function listImages(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = resolve(dir, e.name)
    if (e.isDirectory()) out.push(...(await listImages(full)))
    else if (IMAGE_EXTS.has(e.name.slice(e.name.lastIndexOf('.')).toLowerCase())) out.push(full)
  }
  return out
}

export function imageminVite(opts?: ImageminPluginOptions): Plugin {
  let outDir = 'dist'
  return {
    name: 'graphics-icon:imagemin',
    apply: 'build',
    configResolved(config: { build?: { outDir?: string } }) {
      outDir = config.build?.outDir ?? 'dist'
    },
    async closeBundle() {
      if (opts?.enabled === false) return
      const root = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir)
      const files = await listImages(root)
      if (files.length === 0) return
      const merged: imageminEngine.ImageminOptions = { ...imageminEngine.defaultOptions, ...opts }
      await imageminEngine.imagemin(files, merged)
    },
  } as Plugin
}

// ── 单插件合并:把各启用子插件的同名钩子多路复用到「一个」Vite Plugin 上 ──
type AnyHook = (this: unknown, ...args: unknown[]) => unknown
const FANOUT_HOOKS = ['config', 'configResolved', 'configureServer', 'buildStart', 'load', 'buildEnd', 'generateBundle', 'closeBundle', 'watchChange', 'handleHotUpdate'] as const

function mergePlugins(name: string, subs: Plugin[]): Plugin {
  const merged: Record<string, unknown> = { name }
  const asRec = (p: Plugin): Record<string, AnyHook> => p as unknown as Record<string, AnyHook>
  for (const hook of FANOUT_HOOKS) {
    const impls = subs.filter((p) => typeof asRec(p)[hook] === 'function')
    if (impls.length === 0) continue
    merged[hook] = async function (this: unknown, ...args: unknown[]): Promise<void> {
      for (const p of impls) await asRec(p)[hook].apply(this, args)
    }
  }
  return merged as unknown as Plugin
}

/**
 * 伞插件主入口:`graphicsIcon({...})` 即「一个」Vite 插件。按传入子键(非 false)实例化对应子插件并合并。
 * svg/bitmap 复用各自引擎包的插件工厂;colorfont 为实物落盘子插件;imagemin 在 closeBundle 压缩。
 */
export default function graphicsIcon(options: GraphicsIconOptions = {}): Plugin {
  const subs: Plugin[] = []
  if (options.svgIcons) subs.push(svgIconsVite({ ...options.svgIcons, items: mapItems(options.svgIcons.items) as SvgIconsItem[] }))
  if (options.bitmapIcons) subs.push(bitmapIconsVite({ ...options.bitmapIcons, items: mapItems(options.bitmapIcons.items) as BitmapIconsItem[] }))
  if (options.colorfonts) subs.push(colorfontsVite(options.colorfonts))
  if (options.imagemin) subs.push(imageminVite(options.imagemin))
  // unused 必须最后:其 load 钩子需观察前面引擎/应用引入的全部模块;排除自动并入四引擎输入/产物。
  if (options.unused) {
    const auto = engineExcludes(options)
    subs.push(unusedVite({ ...options.unused, exclude: [...auto, ...(options.unused.exclude ?? [])] }))
  }
  return mergePlugins('graphics-icon', subs)
}

// ── 选项类型再导出 ──
export type { ColorfontItem, ColorfontCommon } from '@codejoo/colorfont'
export type { SvgIconsItem, SvgIconsCommon } from 'svg-icons'
export type { BitmapIconsItem, BitmapIconsCommon } from 'bitmap-icons'
export type { UnusedDetectOptions } from '@codejoo/unused'
