import { globSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { groupCache, resolveCacheFile } from '@codejoo/utils/cache'
import { sha256 } from '@codejoo/utils/hash'

import { buildFlavors } from './parallel.ts'
import { assignCodepoints, readLockfile, writeLockfile } from './codepoints/lockfile.ts'
import { emitCss as emitCssImpl } from './emit/emit-css.ts'
import { emitScript } from './emit/emit-dts.ts'
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
  FontMetadata,
  GlyphMeta,
  ResolvedOptions,
} from './types.ts'
import type { GroupInput } from '@codejoo/utils/cache'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 由 build() 的 metadata 派生「公开元数据清单」(恒产 `{dir}/{name}.json`),与 bitmap/svg 的 json 产物对齐。
 * 这是机器可读、语言无关的对外清单(只列本次构建实际产出的图标),供运行时/工具消费。
 * 它与 `{dir}/{name}.codepoints.json`(码位锁)**职责不同**:
 *  - 码位锁是「状态」:提交进仓库的稳定码位源,含墓碑(present 标志)与历史码位,不计入构建缓存键;
 *  - 本清单是「产物」:本次构建派生、随产物一起幂等落盘,内容随构建结果变化,不应手改、不提交价值低。
 * 两者文件名不同(`.codepoints.json` vs `.json`),互不冲突。codepoint 用十进制 int。
 *
 * Public, machine-readable manifest derived from build() metadata (the durable `{dir}/{name}.json`),
 * mirroring the bitmap/svg json product. Distinct from the codepoints lock: the lock is committed *state*
 * (stable codepoint source with tombstones), while this manifest is a build-derived *product*.
 */
function buildManifest(metadata: FontMetadata): string {
  const manifest = {
    fontName: metadata.fontName,
    unitsPerEm: metadata.unitsPerEm,
    // 只列本次构建实际产出的图标(metadata.glyphs);codepoint 十进制 int;flavors = 该图标产出的档位。
    glyphs: metadata.glyphs.map((g) => ({
      name: g.name,
      codepoint: g.codepoint,
      color: g.color,
      flavors: g.flavors,
    })),
  }
  // 纯数据,JSON 不支持注释,故**不加** autoGenBanner(与 bitmap 的 json 一致)。
  return `${JSON.stringify(manifest, null, 2)}\n`
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

/**
 * 纯函数:输入图标 + 选项 → 产物 Buffer + 元数据 + CSS/TS 生成器。不落盘、无缓存(缓存在 buildAndWrite)。
 * `preloaded`(可选):绝对路径 → svg 内容,由 buildAndWrite 透传已读到的 buffer,避免 loadIcons 二次磁盘读 + 二次 hash。
 * 对外签名向后兼容(新增可选入参,既有 CLI/调用方不受影响)。
 * Optional `preloaded` (abs path → svg content) lets buildAndWrite pass through buffers it already read,
 * avoiding a second disk read + hash in loadIcons. Signature stays backward-compatible.
 */
export async function build(options: ColorfontItem, preloaded?: Map<string, string>): Promise<BuildResult> {
  const o = resolveOptions(options)
  const icons = await loadIcons(o.sources, preloaded)

  // 空输入即视为失败:静默产出空字体几乎总是误配(输入路径错/目录空)。
  // 抛出后经 buildAndWrite→colorfonts runner 的 try/catch 按 throwable 处理(默认抛、false 告警);
  // CLI 直接调用时也会正常冒泡。
  // Empty input is treated as a failure: a silently-empty font is almost always a misconfig
  // (wrong path / empty dir). The throw propagates via the runner's throwable handling.
  if (icons.length === 0) {
    throw new Error(
      `colorfont: 输入目录未找到任何 .svg 图标: ${o.sources.join(', ')}\n` +
        `colorfont: no .svg icons found in source dir(s): ${o.sources.join(', ')}`,
    )
  }

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
    unitsPerEm: o.unitsPerEm,
    glyphs: glyphsMeta,
  }

  const dts = emitScript(metadata, o)

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
const COLORFONT_CACHE_VERSION = 'colorfont-cache-v3'

/** 影响产物的配置指纹(不含图标内容,那在 groupCache.files 里)。 */
function configHashOf(o: ResolvedOptions): string {
  return sha256(
    JSON.stringify({
      v: COLORFONT_CACHE_VERSION,
      fontName: o.fontName,
      name: o.name,
      ts: o.ts,
      unitsPerEm: o.unitsPerEm,
      ascender: o.ascender,
      descender: o.descender,
      baseSelector: o.baseSelector,
      classPrefix: o.classPrefix,
      colorFormat: o.colorFormat,
      formats: [...o.formats].sort(),
      colrv0: o.colrv0,
      woff2Quality: o.woff2Quality,
      paStart: o.paStart,
    }),
  )
}

/**
 * 读取源 svg(各 input 目录,按名排序)→ GroupInput[]。
 * 注意:必须与 loadIcons 的扫描口径一致 —— loadIcons 用 readdir(**仅顶层,非递归**),
 * 故这里也用非递归 `*.svg`。否则子目录的 svg 会进缓存指纹却不进字体,导致改子目录触发无谓重建、
 * 或指纹与实际构建集合脱节。
 */
function readSvgInputs(sources: string[]): GroupInput[] {
  const out: GroupInput[] = []
  for (const dir of sources) {
    let rels: string[] = []
    try {
      rels = globSync('*.svg', { cwd: dir })
    } catch {
      rels = []
    }
    rels.sort()
    for (const rel of rels) {
      // 不吞读失败:glob 已确认文件存在,此处读失败属真异常 → 抛出传播(经 runner 的 throwable 接管),
      // 避免静默丢图标导致缓存指纹与实际构建集合脱节。目录级 glob 失败仍按空目录处理(见上)。
      // Don't swallow read failures: glob already listed the file, so a read error here is a real fault →
      // let it propagate (handled by the runner's throwable). Only directory-level glob failure → empty dir.
      out.push({ path: resolve(dir, rel), content: readFileSync(resolve(dir, rel)) })
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
 * 便捷版(单字体实例):build 后把字体 / CSS / 脚本入口实物落盘 output.dir,经 groupCache 缓存。
 * 命中(输入+选项未变、产物在盘、代表产物 .css hash 一致)→ 跳过整条管线,返回 null。
 * 未命中 → 重建落盘,返回 BuildResult。码位锁(.codepoints.json)为「状态」非缓存产物,不随 cache:false 删除。
 */
export async function buildAndWrite(options: ColorfontItem): Promise<BuildResult | null> {
  const o = resolveOptions(options)
  const cssPath = join(o.dir, `${o.name}.css`)
  const scriptPath = join(o.dir, `${o.name}.${o.ts ? 'ts' : 'js'}`)
  // 公开元数据清单(恒产):{dir}/{name}.json —— 与 {name}.codepoints.json(码位锁/状态)文件名不同、职责不同。
  const manifestPath = join(o.dir, `${o.name}.json`)
  let captured: BuildResult | null = null

  // 一次读取:既用于缓存指纹,也透传给 build()/loadIcons 复用(避免未命中时二次磁盘读 + 二次 hash)。
  // Read sources once: used for the cache fingerprint and passed through to build()/loadIcons on a miss.
  const inputs = readSvgInputs(o.sources)
  const preloaded = new Map<string, string>(inputs.map((i) => [resolve(i.path), typeof i.content === 'string' ? i.content : i.content.toString('utf8')]))

  const r = await groupCache(
    {
      // 缓存文件默认按 name 派生(多实例唯一);可被 cacheFilename 覆盖。
      cacheFile: resolveCacheFile(`colorfont-${o.name}`, options.cacheFilename),
      cache: o.cache,
      configHash: configHashOf(o),
      inputs,
      representative: cssPath, // .css 必产 → 代表产物
    },
    async () => {
      const result = await build(options, preloaded) // 纯构建(无缓存),复用已读 buffer
      captured = result
      await mkdir(o.dir, { recursive: true })
      // 产物(字节)交给 groupCache 幂等落盘;码位锁单独写(非缓存产物)。
      const products: { path: string; content: Buffer | Uint8Array | string }[] = result.assets.map((a) => ({ path: join(o.dir, a.fileName), content: a.source }))
      products.push({ path: cssPath, content: result.emitCss((a) => `./${a.fileName}`) })
      products.push({ path: scriptPath, content: result.dts })
      // 公开元数据清单(恒产)与 css/脚本同列,交给 groupCache 幂等落盘;纯数据,无 banner。
      products.push({ path: manifestPath, content: buildManifest(result.metadata) })
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
    const label = item.output.name
    try {
      const r = await buildAndWrite(item)
      if (r === null) console.log(`[colorfont] 命中缓存,跳过:${label}`)
      else console.log(`[colorfont] ${label}: ${r.assets.length} 个产物(${[...new Set(r.assets.map((a) => a.color))].join(', ')})`)
    } catch (e) {
      if (item.throwable === false) console.warn(`[colorfont] ${label} 生成失败:\n${String(e)}`)
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
  ColorfontOutput,
  ColorFormat,
  FontAsset,
  FontFlavor,
  FontFormat,
  FontMetadata,
  GlyphMeta,
} from './types.ts'
