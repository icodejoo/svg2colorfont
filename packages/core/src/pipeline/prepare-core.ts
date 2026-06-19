// per-icon 预处理(可并行、可序列化):svgo 规范化 → 解析 → 颜色检测 → base/层轮廓(toOutline)各算一次。
// 产出 PreparedIcon 供所有写表器直接消费,消除各档重复 toOutline(colrv0/colrv1 慢的根因)。
import { toOutline } from '../outline/to-outline.ts'
import { detectColor } from './detect-color.ts'
import { normalizeSvg } from './normalize-svg.ts'
import { getSvgInner, parseSvg } from '../util/svg.ts'

import type { BBox } from '../outline/to-outline.ts'
import type { ColorLayer } from './detect-color.ts'
import type { ResolvedOptions } from '../types.ts'
import type { ViewBox } from '../util/svg.ts'

/** 预计算好的一层:轮廓 d(em y-up)+ advanceWidth + bbox(渐变映射用)+ 颜色信息。 */
export interface OutlinedLayer {
  d: string
  advanceWidth: number
  bbox: BBox
  /** 原始 fill(渐变解析用,如 url(#g))。 */
  fill: string
  /** 解析后颜色(#rrggbb / currentColor / 渐变兜底灰)。 */
  color: string
}

/** 一个图标的全部预计算结果(可安全跨 worker 传递)。 */
export interface PreparedIcon {
  name: string
  codepoint: number
  viewBox: ViewBox
  /** 合并轮廓(mono 字形 / 彩色档的 silhouette 兜底)。 */
  base: { d: string; advanceWidth: number; bbox: BBox }
  layers: OutlinedLayer[]
  /** 规范化 SVG 内层(OT-SVG 嵌入用)。 */
  inner: string
  multicolor: boolean
  needsColor: boolean
}

export interface RawIcon {
  name: string
  svg: string
  codepoint: number
}

/** 处理单个图标:规范化 + 解析 + 检测 + base/层轮廓。纯函数,可在主线程或 worker 调用。 */
export function prepareOne(raw: RawIcon, o: ResolvedOptions): PreparedIcon {
  const norm = normalizeSvg(raw.svg)
  const { viewBox, paths } = parseSvg(norm)
  const plan = detectColor(paths)
  const base = toOutline(plan.allDs, viewBox, o)

  // 单色快路径:colorFormat:'mono' 只产 mono 档,只需 base 轮廓 →
  // 跳过每层 toOutline(图标多层时省一大笔)+ 跳过 OT-SVG 用的 inner。
  const monoOnly = o.colorFormat === 'mono'
  const layers: OutlinedLayer[] = monoOnly
    ? []
    : plan.layers.map((l: ColorLayer) => {
        const out = toOutline([l.d], viewBox, o)
        return { d: out.d, advanceWidth: out.advanceWidth, bbox: out.bbox, fill: l.fill, color: l.color }
      })

  return {
    name: raw.name,
    codepoint: raw.codepoint,
    viewBox,
    base: { d: base.d, advanceWidth: base.advanceWidth, bbox: base.bbox },
    layers,
    inner: monoOnly ? '' : getSvgInner(norm),
    multicolor: monoOnly ? false : plan.multicolor,
    needsColor: monoOnly ? false : plan.multicolor || plan.hasGradient,
  }
}
