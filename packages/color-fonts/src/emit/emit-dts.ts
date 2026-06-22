import { autoGenBanner } from '@codejoo/utils/banner'

import type { FontMetadata, ResolvedOptions } from '../types.ts'

/**
 * 生成自产脚本入口(codepoints + icons 类名映射 + baseName + colorIcons + iconContent)。
 * o.ts 为 true → 类型安全 .ts(IconName 联合 + `as const satisfies` + 类型注解);
 * o.ts 为 false → 等价 .js(运行时导出相同,但无任何 TS 类型:无 IconName、无 satisfies、无参数注解)。
 * Emits the self-generated script entry. ts:true → typed .ts; ts:false → equivalent plain .js.
 */
export function emitScript(metadata: FontMetadata, o: ResolvedOptions): string {
  const glyphs = metadata.glyphs
  const q = (s: string) => JSON.stringify(s)
  const hex = (n: number) => '0x' + n.toString(16)

  const cp = glyphs.map((g) => `  ${q(g.name)}: ${hex(g.codepoint)},`).join('\n')
  const cls = glyphs.map((g) => `  ${q(g.name)}: ${q(o.classPrefix + g.name)},`).join('\n')
  // 对象形式:便于外部 O(1) 判定 colorIcons[name] 是否彩色(只列出彩色图标)
  const colorObj = glyphs
    .filter((g) => g.color)
    .map((g) => `  ${q(g.name)}: true,`)
    .join('\n')
  const baseName = q(o.baseSelector.replace(/^\./, ''))

  // ── .js:无任何 TS 类型(去掉 IconName 联合、as const satisfies、参数类型注解) ──
  if (!o.ts) {
    return `${autoGenBanner('line')}
export const codepoints = {
${cp}
};

/** 图标名 → CSS 类名。 */
export const icons = {
${cls}
};

/** 挂字体的基础类名(不含点)。 */
export const baseName = ${baseName};

/** 多色图标(在支持 COLR/OT-SVG 的浏览器彩色渲染)。对象形式便于 O(1) 判定:colorIcons[name]。 */
export const colorIcons = {
${colorObj}
};

export function iconContent(name) {
  return String.fromCodePoint(codepoints[name]);
}
`
  }

  // ── .ts:类型安全(IconName 联合 + as const satisfies + 类型注解) ──
  const union = glyphs.length
    ? glyphs.map((g) => `  | ${q(g.name)}`).join('\n')
    : '  | never'

  return `${autoGenBanner('line')}
export type IconName =
${union};

export const codepoints = {
${cp}
} as const satisfies Record<IconName, number>;

/** 图标名 → CSS 类名。 */
export const icons = {
${cls}
} as const satisfies Record<IconName, string>;

/** 挂字体的基础类名(不含点)。 */
export const baseName = ${baseName};

/** 多色图标(在支持 COLR/OT-SVG 的浏览器彩色渲染)。对象形式便于 O(1) 判定:colorIcons[name]。 */
export const colorIcons = {
${colorObj}
} as const satisfies Partial<Record<IconName, true>>;

export function iconContent(name: IconName): string {
  return String.fromCodePoint(codepoints[name]);
}
`
}
