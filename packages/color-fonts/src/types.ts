// 公共与内部类型契约。

/** 输出容器格式。 */
export type FontFormat = 'woff2' | 'woff' | 'ttf'

/**
 * 颜色编码策略(高层意图,逐图标判定 → 决定产出哪些 flavor)。
 * - 'auto'   : 单色仅 mono;多色产 colrv0 + otsvg(+ colrv1 若开启) + mono
 * - 'mono'   : 仅单色 glyf 轮廓
 * - 'colrv0' : COLRv0 平涂 + mono 回退
 * - 'otsvg'  : OT-SVG 内嵌 + mono 回退
 * - 'colrv1' : COLRv1 渐变(opt-in,wasm 后端) + 共存档
 */
export type ColorFormat = 'auto' | 'mono' | 'colrv0' | 'otsvg' | 'colrv1'

/** 底层 flavor(产物维度)。 */
export type FontFlavor = 'mono' | 'colrv0' | 'otsvg' | 'colrv1'

/** opentype.js Path 实例(避免到处依赖其类型,这里宽松别名)。 */
export type OutlinePath = import('opentype.js').Path

export interface CodepointEntry {
  /** 分配的 PUA 码位(十进制 int)。一经分配,删除图标也不回收(墓碑)。 */
  codepoint: number
  /** 首次分配日期。 */
  since?: string
  /** 该图标当前是否仍存在于 input。 */
  present?: boolean
}

export interface CodepointMap {
  version: 1
  /** PUA 起始码位,默认 0xE000。 */
  paFirst: number
  /** name → entry。按 codepoint 升序序列化。 */
  glyphs: Record<string, CodepointEntry>
}

/**
 * 各实例可共享的「公共参数」(顶层设置;每个 item 与之合并,item 同名字段覆盖)。
 * Shared "common" params (set at top level; merged into each item, item overrides).
 */
export interface ColorfontCommon {
  /** em 方格,默认 1000。 */
  unitsPerEm?: number
  /** 默认按 unitsPerEm 推导:asc = 0.8em, desc = -0.2em。 */
  ascender?: number
  descender?: number
  /** 基础选择器(挂 font-family 的根 class),默认 '.icon'。 */
  baseSelector?: string
  /** 每图标 class 前缀,默认 'icon-'。 */
  classPrefix?: string
  /** 颜色策略,默认 'auto'。 */
  colorFormat?: ColorFormat
  /** 输出容器,默认 ['woff2'](所有现代浏览器支持)。如需兼容老浏览器,写 ['woff2','woff']。 */
  formats?: FontFormat[]
  /** woff2 的 brotli 压缩质量 1..=11。默认 11(生产最高压缩);dev 自动用 9(快 ~30×,体积仅 +6%)。 */
  woff2Quality?: number
  /** 是否生成 COLRv0 档(平涂彩色,面向不支持 COLRv1 的老环境)。默认 true。 */
  colrv0?: boolean
  /** 多线程:per-icon 预处理用 worker 池 + 每档一 worker。默认 'auto'(图标 ≥200 时启用)。 */
  threads?: boolean | 'auto'
  /** PUA 起始码位,默认 0xE000。 */
  paStart?: number
  /** 是否启用缓存(默认 true);false → 删除该实例缓存与旧产物并强制重建。 / Enable cache (default true). */
  cache?: boolean
  /** 出错是否抛出并中止(默认 true);false → 仅告警并继续。 / Throw & abort on error (default true). */
  throwable?: boolean
}

/**
 * 单字体实例的输出配置。 / Output config for one font instance.
 */
export interface ColorfontOutput {
  /** 产物输出目录(字体 + .css + 脚本入口 + 码位锁实物落盘于此)。 / Output dir. */
  dir: string
  /**
   * CSS 字体名 = @font-face font-family + OpenType name 表 + 字形归属。
   * The CSS font name: @font-face font-family + OpenType name table + glyph ownership.
   */
  fontName: string
  /**
   * 产物基名。字体 `{dir}/{name}.{flavor}.{format}`、样式 `{dir}/{name}.css`、
   * 脚本 `{dir}/{name}.ts`(或 `.js`)、码位锁 `{dir}/{name}.codepoints.json`(固定派生)。
   * Product base name. Drives font/css/script/codepoints-lock file names.
   */
  name: string
  /** 产 .ts 入口(默认 true);false → 产等价 .js(运行时导出相同,无任何 TS 类型)。 / Emit .ts (default) or .js. */
  ts?: boolean
}

/** 单字体实例配置(公共参数 + 本实例专属)。 / One font instance (common + instance-only). */
export interface ColorfontItem extends ColorfontCommon {
  /** 图标源目录(.svg)。 / Icon source dir(s) (.svg). */
  sources: string | string[]
  /** 输出配置:目录 / 字体名 / 产物基名 / 脚本语言。 / Output config. */
  output: ColorfontOutput
  /**
   * 独立(CLI/函数)模式的缓存文件:完整路径或裸名。省略 → 由 output.name 派生唯一默认名。
   * vite 插件模式请用 `cacheName`(仅名字,目录由系统管理)。
   */
  cacheFilename?: string
}

/**
 * 引擎/插件入参:公共参数 + `items[]`。每个实例 = { ...公共, ...本项 }(本项覆盖公共)。
 * Options: common params + `items[]`. Each instance = { ...common, ...item } (item wins).
 */
export interface ColorfontOptions extends ColorfontCommon {
  items: ColorfontItem[]
}

export interface ResolvedOptions {
  /** 规范化后的源目录绝对路径数组。 / Normalized absolute source dirs. */
  sources: string[]
  /** 输出目录(绝对)。 / Output dir (absolute). */
  dir: string
  /** CSS 字体名(@font-face font-family + OpenType name + 字形归属)。 / CSS font name. */
  fontName: string
  /** 产物基名。 / Product base name. */
  name: string
  /** 脚本入口语言:true → .ts,false → .js。 / Script entry language. */
  ts: boolean
  unitsPerEm: number
  ascender: number
  descender: number
  baseSelector: string
  classPrefix: string
  colorFormat: ColorFormat
  formats: FontFormat[]
  /** 是否生成 COLRv0 档。 */
  colrv0: boolean
  /** woff2 brotli 质量 1..=11。 */
  woff2Quality: number
  threads: boolean | 'auto'
  /** 是否启用缓存(groupCache 由 buildAndWrite 持有;build 本身为纯函数无缓存)。 */
  cache: boolean
  /** 码位锁绝对路径,内部派生 = `<dir>/<name>.codepoints.json`(不可配置)。 / Derived codepoints-lock path. */
  codepointsFile: string
  paStart: number
}

/** 一个图标在管线中的中间表示。 */
export interface GlyphDef {
  name: string
  codepoint: number
  advanceWidth: number
  path: OutlinePath
}

export interface FontAsset {
  fileName: string
  source: Uint8Array
  color: FontFlavor
  format: FontFormat
  hash: string
}

export interface GlyphMeta {
  name: string
  codepoint: number
  unicode: string
  color: boolean
  flavors: FontFlavor[]
}

export interface FontMetadata {
  fontName: string
  unitsPerEm: number
  glyphs: GlyphMeta[]
}

export interface BuildWarning {
  code: string
  level: 'info' | 'warn' | 'error'
  icon?: string
  message: string
}

export interface BuildResult {
  assets: FontAsset[]
  metadata: FontMetadata
  /** 自产 TS 入口源码。 */
  dts: string
  /** 更新后的码位锁表(buildAndWrite 会写回)。 */
  codepoints: CodepointMap
  warnings: BuildWarning[]
  /** url 回调式 CSS 生成 —— core 不决定字体最终 URL。 */
  emitCss(resolveUrl: (asset: FontAsset) => string): string
}
