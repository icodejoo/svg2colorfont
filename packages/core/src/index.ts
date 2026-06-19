import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildFlavors } from './parallel.ts'
import { computeCacheKey, readCache, writeCache } from './cache/build-cache.ts'
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
  ColorfontOptions,
  FontFlavor,
  GlyphMeta,
} from './types.ts'

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

/** 纯函数:输入图标 + 选项 → 产物 Buffer + 元数据 + CSS/TS 生成器。不落盘。 */
export async function build(options: ColorfontOptions): Promise<BuildResult> {
  const o = resolveOptions(options)
  const icons = await loadIcons(o.input)

  const lock = await readLockfile(o.codepointsFile, o.paStart)
  const cpMap = assignCodepoints(
    icons.map((i) => i.name),
    lock,
    today(),
  )

  // 构建缓存:输入图标 + 影响产物的选项 + 码位不变 → 命中则跳过整条管线,直接复用上次字体产物
  const cacheKey = o.cache ? computeCacheKey(icons.map((i) => ({ name: i.name, svg: i.svg })), cpMap, o) : ''
  if (o.cache) {
    const hit = readCache(o.cache.dir, cacheKey)
    if (hit) return { ...hit, emitCss: (resolveUrl) => emitCssImpl(hit.assets, hit.metadata, o, resolveUrl) }
  }

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
  // 写入构建缓存(失败静默,不影响构建)
  if (o.cache) writeCache(o.cache.dir, cacheKey, { assets, metadata, dts, codepoints: lock, warnings })

  return {
    assets,
    metadata,
    dts,
    codepoints: lock,
    warnings,
    emitCss: (resolveUrl) => emitCssImpl(assets, metadata, o, resolveUrl),
  }
}

/** 便捷版:build 后把字体 / CSS / TS 入口 / 码位锁写到 outDir。 */
export async function buildAndWrite(options: ColorfontOptions): Promise<BuildResult> {
  const o = resolveOptions(options)
  const result = await build(options)

  await mkdir(o.outDir, { recursive: true })
  for (const asset of result.assets) {
    await writeFile(join(o.outDir, asset.fileName), asset.source)
  }
  await writeFile(join(o.outDir, `${o.fontName}.css`), result.emitCss((a) => `./${a.fileName}`), 'utf8')
  await writeFile(join(o.outDir, `${o.fontName}.ts`), result.dts, 'utf8')
  await writeLockfile(o.codepointsFile, result.codepoints)

  return result
}

export { serializeLockfile, readLockfile } from './codepoints/lockfile.ts'

export type {
  BuildResult,
  ColorfontOptions,
  ColorFormat,
  FontAsset,
  FontFlavor,
  FontFormat,
  FontMetadata,
  GlyphMeta,
  VitePluginColorfontOptions,
} from './types.ts'
