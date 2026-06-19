import { toWoff } from './encode/to-woff.ts'
import { toWoff2 } from './encode/to-woff2.ts'
import { buildColrv0Ttf } from './flavors/build-colrv0.ts'
import { buildOtsvgTtf } from './flavors/build-otsvg.ts'
import { buildGlyfTtf } from './glyf/svg-font.ts'
import { contentHash } from './util/hash.ts'

import type { GlyfGlyph } from './glyf/svg-font.ts'
import type { PreparedIcon } from './pipeline/prepare-core.ts'
import type { FontAsset, FontFlavor, FontFormat, ResolvedOptions } from './types.ts'

// 图标中间数据统一为 PreparedIcon(预计算 base/层轮廓,可序列化跨 worker)。
export type { PreparedIcon } from './pipeline/prepare-core.ts'

async function encodeFont(
  ttf: Uint8Array,
  format: FontFormat,
  color: FontFlavor,
  o: ResolvedOptions,
): Promise<FontAsset> {
  let source: Uint8Array
  if (format === 'ttf') source = ttf
  else if (format === 'woff2') source = await toWoff2(ttf, o.woff2Quality)
  else source = toWoff(ttf)
  const hash = contentHash(source)
  return { fileName: `${o.fontName}.${color}.${hash}.${format}`, source, color, format, hash }
}

/** 构建某一档的 SFNT(TTF)字节。各写表器直接消费预计算的 PreparedIcon(不再 toOutline)。 */
async function buildTtf(flavor: FontFlavor, icons: PreparedIcon[], o: ResolvedOptions): Promise<Uint8Array> {
  if (flavor === 'mono') {
    const glyphs: GlyfGlyph[] = icons.map((ic) => ({
      name: ic.name,
      d: ic.base.d,
      advanceWidth: ic.base.advanceWidth,
      unicode: ic.codepoint,
    }))
    return buildGlyfTtf(glyphs, o)
  }
  if (flavor === 'colrv0') return buildColrv0Ttf(icons, o)
  if (flavor === 'otsvg') return buildOtsvgTtf(icons, o)
  // colrv1:JS 前端产 paint 树 → Rust/wasm 写 COLR/CPAL
  const { buildColrv1 } = await import('./colrv1/build-colrv1.ts')
  const { addColrv1 } = await import('./colrv1/wasm-writer.ts')
  const { baseSfnt, doc } = buildColrv1(icons, o)
  return addColrv1(baseSfnt, doc)
}

/** 构建某一档的全部产物(各容器格式)。主线程同步路径与 worker 都调用它。 */
export async function buildFlavorAssets(
  flavor: FontFlavor,
  icons: PreparedIcon[],
  o: ResolvedOptions,
): Promise<FontAsset[]> {
  const ttf = await buildTtf(flavor, icons, o)
  const out: FontAsset[] = []
  for (const format of o.formats) out.push(await encodeFont(ttf, format, flavor, o))
  return out
}
