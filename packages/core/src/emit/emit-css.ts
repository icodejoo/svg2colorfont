import type { FontAsset, FontFlavor, FontFormat, FontMetadata, ResolvedOptions } from '../types.ts'

const FORMAT_ORDER: FontFormat[] = ['woff2', 'woff', 'ttf']

/** tech() 链顺序:强 → 弱。 */
const CHAIN_ORDER: FontFlavor[] = ['colrv1', 'otsvg', 'colrv0', 'mono']

/** flavor → CSS tech() 关键字(mono 无 tech)。 */
const TECH: Record<FontFlavor, string | null> = {
  colrv1: 'color-colrv1',
  otsvg: 'color-svg',
  colrv0: 'color-colrv0',
  mono: null,
}

/** 每档对应的目标浏览器与原因(写进 CSS 注释,便于阅读/排错)。 */
const FLAVOR_NOTE: Record<FontFlavor, string> = {
  colrv1: 'Chrome/Edge 98+ 与 Firefox:COLRv1 渐变矢量(体积最小、可 font-palette 换色)',
  otsvg: 'Safari / iOS:OT-SVG(Chromium 永不支持 OT-SVG,故此格式专供 Safari)',
  colrv0: '较旧的 Chrome/Edge/Firefox:COLRv0 平涂多色(不支持渐变)',
  mono: '所有浏览器:单色轮廓回退(渲染器不认彩色表时用)',
}

/** 容器格式对应的浏览器(用于单色保底块的逐 url 注释)。 */
const FORMAT_NOTE: Record<FontFormat, string> = {
  woff2: 'WOFF2:Chrome/Edge/Firefox/Safari 等所有现代浏览器',
  woff: 'WOFF:更老的浏览器(IE11 / 旧版 Safari)',
  ttf: 'TrueType:非 Web 环境或极老浏览器的兜底',
}

const q = (s: string) => JSON.stringify(s)
const cssFormat = (f: FontFormat) => (f === 'ttf' ? 'truetype' : f)

function groupByColor(assets: FontAsset[]): Map<FontFlavor, FontAsset[]> {
  const m = new Map<FontFlavor, FontAsset[]>()
  for (const a of assets) {
    const list = m.get(a.color) ?? []
    list.push(a)
    m.set(a.color, list)
  }
  for (const list of m.values()) {
    list.sort((a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format))
  }
  return m
}

/**
 * 生成 CSS:
 *  - 保底 @font-face:仅 mono(所有格式)—— 不认 tech() 的浏览器只会用到这条。
 *  - 若有彩色档,再加一条 tech() 回退链 @font-face(同 family,后写优先)——
 *    现代浏览器按 COLRv1 → OT-SVG → COLRv0 → mono 各取所需。
 *  - 每个 url 后带注释:对应浏览器 + 为什么。
 *  - 基础 class + 每图标 ::before content。
 */
export function emitCss(
  assets: FontAsset[],
  metadata: FontMetadata,
  o: ResolvedOptions,
  resolveUrl: (asset: FontAsset) => string,
): string {
  const byColor = groupByColor(assets)
  const ff = q(o.fontFamily)
  /** 一条 src 项:url + format(+ tech) + 行尾浏览器注释。 */
  const entry = (a: FontAsset, tech: string | null, note: string) =>
    `url(${q(resolveUrl(a))}) format(${q(cssFormat(a.format))})${tech ? ` tech(${tech})` : ''} /* ${note} */`

  const monoAssets = byColor.get('mono') ?? []
  // 保底块按容器格式逐 url 注释(都是 mono,区别在格式支持度)
  const fallbackSrc = monoAssets.map((a) => entry(a, null, FORMAT_NOTE[a.format])).join(',\n       ')

  let css = `@font-face {
  font-family: ${ff};
  font-display: block;
  src: ${fallbackSrc};
}
`

  const hasColor = (['colrv1', 'otsvg', 'colrv0'] as FontFlavor[]).some((c) => byColor.has(c))
  if (hasColor) {
    // tech() 链按 flavor 逐 url 注释(区别在彩色表 / 目标浏览器)
    const chain: string[] = []
    for (const flavor of CHAIN_ORDER) {
      const list = byColor.get(flavor)
      if (!list || !list.length) continue
      chain.push(entry(list[0], TECH[flavor], FLAVOR_NOTE[flavor]))
    }
    css += `
/* 现代浏览器:tech() 各取所需(后写的 @font-face 同 family 覆盖上面的保底) */
@font-face {
  font-family: ${ff};
  font-display: block;
  src:
    ${chain.join(',\n    ')};
}
`
  }

  // 基类:强制图标字体(!important 压过继承),其余字体属性继承上下文(大小/粗细/行高随文本)。
  css += `
${o.baseSelector} {
  font: inherit;
  font-family: ${ff} !important;
  -webkit-font-smoothing: antialiased;
}
`

  css += metadata.glyphs
    .map(
      (g) =>
        `.${o.classPrefix}${g.name}::before { content: "\\${g.codepoint.toString(16)}"; }`,
    )
    .join('\n')

  return css + '\n'
}
