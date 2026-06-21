import { globSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { groupCache, resolveCacheFile } from '@codejoo/utils/cache'
import { sha256 } from '@codejoo/utils/hash'

import { buildFlavors } from './parallel.ts'
import { assignCodepoints, readLockfile, writeLockfile } from './codepoints/lockfile.ts'
import { emitCss as emitCssImpl } from './emit/emit-css.ts'
import { emitDts } from './emit/emit-dts.ts'
import { resolveOptions } from './options.ts'
import { loadIcons } from './pipeline/load-icons.ts'
import { prepareIcons } from './pipeline/prepare-icons.ts'

import type {
  BuildResult,
  BuildWarning,
  ColorFormat,
  ColorfontItem,
  ColorfontOptions,
  FontFlavor,
  GlyphMeta,
  ResolvedOptions,
} from './types.ts'
import type { GroupInput } from '@codejoo/utils/cache'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 由 colorFormat + 是否存在彩色图标,推导要产出的 flavor 集合(mono 永远产出)。 */
function resolveFlavors(cf: ColorFormat, anyColor: boolean): { flavors: FontFlavor[]; warnings: BuildWarning[] } {
  const warnings: BuildWarning[] = []
  const flavors: FontFlavor[] = ['mono']
  const add = (f: FontFlavor) => {
    if (!flavors.includes(f)) flavors.push(f)
  }
  switch (cf) {
    case 'mono':
      break
    case 'colrv0':
      add('colrv0')
      break
    case 'otsvg':
      add('otsvg')
      break
    case 'auto':
      if (anyColor) {
        add('colrv0')
        add('otsvg')
      }
      break
    case 'colrv1':
      // colrv1 作为额外档由 wasm 写表后端产出(见 build());同时产 colrv0+otsvg 作共存/回退
      add('colrv0')
      add('otsvg')
      break
  }
  return { flavors, warnings }
}

/** 纯函数:输入图标 + 选项 → 产物 Buffer + 元数据 + CSS/TS 生成器。不落盘、无缓存(缓存在 buildAndWrite)。 */
export async function build(options: ColorfontItem): Promise<BuildResult> {
  const o = resolveOptions(options)
  const icons = await loadIcons(o.input)

  const lock = await readLockfile(o.codepointsFile, o.paStart)
  const cpMap = assignCodepoints(
    icons.map((i) => i.name),
    lock,
    today(),
  )

  // useThreads 提前:预处理池与各档构建都用它('auto' 在图标 ≥200 时启用)
  const useThreads = o.threads === true || (o.threads === 'auto' && icons.length >= 200)

  // per-icon 预处理(svgo 规范化 + 解析 + 颜色检测 + base/层轮廓),worker 池并行(线程数=CPU 一半)
  const prepared = await prepareIcons(
    icons.map((icon) => ({ name: icon.name, svg: icon.svg, codepoint: cpMap[icon.name] })),
    o,
    useThreads,
  )

  const anyColor = prepared.some((p) => p.needsColor)
  const { flavors, warnings } = resolveFlavors(o.colorFormat, anyColor)
  // colrv0 开关:关闭则不产 COLRv0 档(只面向支持 COLRv1+OT-SVG 的现代浏览器)
  if (!o.colrv0) {
    const i = flavors.indexOf('colrv0')
    if (i >= 0) flavors.splice(i, 1)
  }

  // 决定要构建的档:mono 永远;colrv0/otsvg 视彩色与开关;colrv1 仅显式且 wasm 可用
  const toBuild: FontFlavor[] = ['mono']
  if (flavors.includes('colrv0')) toBuild.push('colrv0')
  if (flavors.includes('otsvg')) toBuild.push('otsvg')
  if (o.colorFormat === 'colrv1' && anyColor) {
    const { isColrv1Available } = await import('./colrv1/wasm-writer.ts')
    if (await isColrv1Available()) toBuild.push('colrv1')
    else
      warnings.push({
        code: 'COLRV1_WASM_MISSING',
        level: 'warn',
        message:
          'colrv1-writer wasm 未构建,colrv1 档已跳过(仍产出 colrv0+otsvg)。装 Rust 后在 packages/colrv1-writer 跑 wasm-pack build 即启用。',
      })
  }

  const assets = await buildFlavors(toBuild, prepared, o, useThreads)

  const glyphsMeta: GlyphMeta[] = prepared.map((p) => ({
    name: p.name,
    codepoint: p.codepoint,
    unicode: String.fromCodePoint(p.codepoint),
    color: p.needsColor,
    flavors: [...toBuild],
  }))

  const metadata = {
    fontName: o.fontName,
    fontFamily: o.fontFamily,
    unitsPerEm: o.unitsPerEm,
    glyphs: glyphsMeta,
  }

  const dts = emitDts(metadata, o)

  return {
    assets,
    metadata,
    dts,
    codepoints: lock,
    warnings,
    emitCss: (resolveUrl) => emitCssImpl(assets, metadata, o, resolveUrl),
  }
}

// 引擎缓存版本:改产物格式 / 缓存模型时 +1。
const COLORFONT_CACHE_VERSION = 'colorfont-cache-v2'

/** 影响产物的配置指纹(不含图标内容,那在 groupCache.files 里)。 */
function configHashOf(o: ResolvedOptions): string {
  return sha256(
    JSON.stringify({
      v: COLORFONT_CACHE_VERSION,
      fontName: o.fontName,
      fontFamily: o.fontFamily,
      unitsPerEm: o.unitsPerEm,
      ascender: o.ascender,
      descender: o.descender,
      baseSelector: o.baseSelector,
      classPrefix: o.classPrefix,
      colorFormat: o.colorFormat,
      formats: [...o.formats].sort(),
      colrv0: o.colrv0,
      woff2Quality: o.woff2Quality,
    }),
  )
}

/** 读取源 svg(各 input 目录,按名排序)→ GroupInput[]。 */
function readSvgInputs(inputs: string[]): GroupInput[] {
  const out: GroupInput[] = []
  for (const dir of inputs) {
    let rels: string[] = []
    try {
      rels = globSync('**/*.svg', { cwd: dir })
    } catch {
      rels = []
    }
    rels.sort()
    for (const rel of rels) {
      try {
        out.push({ path: resolve(dir, rel), content: readFileSync(resolve(dir, rel)) })
      } catch {
        /* 读不到就略过(下次仍 miss) */
      }
    }
  }
  return out
}

/** 合并公共参数到每个 item(item 同名字段覆盖公共)。 */
function resolveItems(o: ColorfontOptions): ColorfontItem[] {
  const { items, ...common } = o
  return items.map((it) => ({ ...common, ...it }))
}

/**
 * 便捷版(单字体实例):build 后把字体 / CSS / TS 实物落盘 outDir,经 groupCache 缓存。
 * 命中(输入+选项未变、产物在盘、代表产物 .css hash 一致)→ 跳过整条管线,返回 null。
 * 未命中 → 重建落盘,返回 BuildResult。码位锁(.codepoints.json)为「状态」非缓存产物,不随 cache:false 删除。
 */
export async function buildAndWrite(options: ColorfontItem): Promise<BuildResult | null> {
  const o = resolveOptions(options)
  const cssPath = join(o.outDir, `${o.fontName}.css`)
  let captured: BuildResult | null = null

  const r = await groupCache(
    {
      cacheFile: resolveCacheFile(`colorfont-${o.fontName}`, options.cacheFilename),
      cache: o.cache,
      configHash: configHashOf(o),
      inputs: readSvgInputs(o.input),
      representative: cssPath, // .css 必产 → 代表产物
    },
    async () => {
      const result = await build(options) // 纯构建(无缓存)
      captured = result
      await mkdir(o.outDir, { recursive: true })
      // 产物(字节)交给 groupCache 幂等落盘;码位锁单独写(非缓存产物)。
      const products: { path: string; content: Buffer | Uint8Array | string }[] = result.assets.map((a) => ({ path: join(o.outDir, a.fileName), content: a.source }))
      products.push({ path: cssPath, content: result.emitCss((a) => `./${a.fileName}`) })
      products.push({ path: join(o.outDir, `${o.fontName}.ts`), content: result.dts })
      await writeLockfile(o.codepointsFile, result.codepoints)
      return products
    },
  )
  return r.hit ? null : captured
}

/**
 * 批量(多字体实例)引擎入口:按 items 生成所有字体,各自独立缓存。
 * 单实例失败:throwable!==false → 抛错中止;否则告警继续。
 */
export async function colorfonts(options: ColorfontOptions): Promise<void> {
  for (const item of resolveItems(options)) {
    try {
      const r = await buildAndWrite(item)
      if (r === null) console.log(`[colorfont] 命中缓存,跳过:${item.fontName}`)
      else console.log(`[colorfont] ${item.fontName}: ${r.assets.length} 个产物(${[...new Set(r.assets.map((a) => a.color))].join(', ')})`)
    } catch (e) {
      if (item.throwable === false) console.warn(`[colorfont] ${item.fontName} 生成失败:\n${String(e)}`)
      else throw e
    }
  }
}

export { serializeLockfile, readLockfile } from './codepoints/lockfile.ts'

// CLI 入口(供 graphics-icon 的 bin 复用) —— 与 imagemin 对齐。
export { run as runCli } from './cli/cli.ts'

export type {
  BuildResult,
  ColorfontCommon,
  ColorfontItem,
  ColorfontOptions,
  ColorFormat,
  FontAsset,
  FontFlavor,
  FontFormat,
  FontMetadata,
  GlyphMeta,
} from './types.ts'
