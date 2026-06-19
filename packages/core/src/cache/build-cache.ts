// 构建级缓存(参考 build/imagemin 的内容哈希缓存策略,适配「一组图标→整套字体」的粒度):
//   key = sha256(引擎版本 + 影响产物的选项 + 全部图标内容 + 最终码位)。
//   命中(key 不变 + 产物文件都在)→ 直接复用上次字体字节,跳过整条管线(svgo/svg2ttf/woff2)。
//   持久化到 cacheDir(默认 node_modules/.cache;可指向仓库内以团队共享,类似 imagemin)。
//   只保留「当前 key」一份(写入前清理旧产物),避免缓存膨胀。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { BuildResult, CodepointMap, FontAsset, FontMetadata, ResolvedOptions } from '../types.ts'

// 引擎产物格式变化时 bump,使旧缓存整体失效。
const VERSION = 'colorfont-cache-v1'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** 缓存可复用的 BuildResult 主体(emitCss 闭包不入缓存,命中后由调用方重建)。 */
export type CachedResult = Pick<BuildResult, 'assets' | 'metadata' | 'dts' | 'codepoints' | 'warnings'>

/** key 取决于:引擎版本 + 影响产物的选项 + 图标内容 + 最终码位(cpMap)。线程数等不影响产物的选项不计入。 */
export function computeCacheKey(
  icons: { name: string; svg: string }[],
  cpMap: Record<string, number>,
  o: ResolvedOptions,
): string {
  const sig = {
    v: VERSION,
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
  }
  const h = createHash('sha256')
  h.update(JSON.stringify(sig))
  for (const ic of [...icons].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    h.update(`\0${ic.name}\0${cpMap[ic.name]}\0${sha(ic.svg)}`)
  }
  return h.digest('hex')
}

interface Manifest {
  version: string
  key: string
  metadata: FontMetadata
  dts: string
  warnings: BuildResult['warnings']
  codepoints: CodepointMap
  assets: { fileName: string; color: FontAsset['color']; format: FontAsset['format']; hash: string }[]
}

/** 命中则返回缓存产物(读回字体字节);未命中/损坏/版本不符 → null。 */
export function readCache(dir: string, key: string): CachedResult | null {
  try {
    const mfPath = join(dir, 'manifest.json')
    if (!existsSync(mfPath)) return null
    const m = JSON.parse(readFileSync(mfPath, 'utf8')) as Manifest
    if (m.version !== VERSION || m.key !== key) return null
    const assets: FontAsset[] = []
    for (const a of m.assets) {
      const p = join(dir, a.fileName)
      if (!existsSync(p)) return null // 产物文件缺失 → 视为未命中
      assets.push({ fileName: a.fileName, color: a.color, format: a.format, hash: a.hash, source: new Uint8Array(readFileSync(p)) })
    }
    return { assets, metadata: m.metadata, dts: m.dts, codepoints: m.codepoints, warnings: m.warnings }
  } catch {
    return null
  }
}

/** 写入缓存:清理旧产物 → 写字体字节 + manifest。失败静默(不影响构建)。 */
export function writeCache(dir: string, key: string, r: CachedResult): void {
  try {
    mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true, recursive: true })
    for (const a of r.assets) writeFileSync(join(dir, a.fileName), a.source)
    const m: Manifest = {
      version: VERSION,
      key,
      metadata: r.metadata,
      dts: r.dts,
      warnings: r.warnings,
      codepoints: r.codepoints,
      assets: r.assets.map((a) => ({ fileName: a.fileName, color: a.color, format: a.format, hash: a.hash })),
    }
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`)
  } catch {
    /* 缓存写失败不影响构建 */
  }
}
