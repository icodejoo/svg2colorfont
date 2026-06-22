/**
 * 位图雪碧图配置与产物类型。
 * 设计参考 spritesmith,但适配 Vite 插件 + sharp + maxrects-packer。
 *
 * Bitmap sprite-sheet config & output types.
 * Inspired by spritesmith, adapted for a Vite plugin built on sharp + maxrects-packer.
 */

// sharp 0.35+ 以命名空间默认导出暴露选项类型(无具名导出),故按命名空间引用(仅类型,运行时被擦除)。
// sharp 0.35+ exposes option types via its default-export namespace (no named exports), so reference them as sharp.X (type-only, erased at runtime).
import type { PngOptions, WebpOptions } from "./sharp-types.ts"

/**
 * 输出配置:目录 + 基名 + 脚本语言 + 图集格式。四类产物全部恒产,路径全由 dir/name 派生:
 *   图集 `{dir}/{name}.{format}`(format 默认 webp);样式 `{dir}/{name}.css`(只产 css,无 scss);
 *   脚本 `{dir}/{name}.{ts?ts:js}`(默认 .ts);坐标 JSON `{dir}/{name}.json`。
 * 不再有 publicPath:CSS 用「style→image 的相对 url()」,script 用相对 import,均交 Vite 解析。
 *
 * Output config: dir + base name + script language + atlas format. All four products are always
 * emitted, with every path derived from dir/name: image `{dir}/{name}.{format}` (format default webp),
 * style `{dir}/{name}.css` (css only, no scss), script `{dir}/{name}.{ts?ts:js}` (default .ts),
 * JSON `{dir}/{name}.json`. No publicPath — relative url()/import resolved by Vite.
 */
export interface BitmapIconsOutput {
  /** 产物输出目录(图集 + .css + 脚本入口 + 坐标 JSON 均落盘于此)。 / Output dir for all products. */
  dir: string
  /** 产物基名。派生图集 `{dir}/{name}.{format}`、样式 `{dir}/{name}.css`、脚本 `{dir}/{name}.{ts?ts:js}`、JSON `{dir}/{name}.json`。 / Base name driving all product file names. */
  name: string
  /** 产 .ts 入口(默认 true);false → 产等价 .js(运行时导出相同,无任何 TS 类型)。 / Emit .ts (default) or .js. */
  ts?: boolean
  /** 图集图片格式,'webp' | 'png'(默认 'webp')。 / Atlas image format, 'webp' | 'png' (default 'webp'). */
  format?: "webp" | "png"
}

/**
 * 各实例可共享的「公共参数」(顶层设置;每个 item 与之合并,item 同名字段覆盖)。
 * Shared "common" params (set at top level; merged into each item, item overrides).
 */
export interface BitmapIconsCommon {
  /** 精灵之间的间隙(px)。默认 2,防止相邻切片采样溢色。 */
  padding?: number
  /** 单张 sheet 的最大宽/高(px)。默认 4096(安全 GPU 纹理上限)。 */
  maxWidth?: number
  maxHeight?: number
  /** sheet 尺寸取 2 的幂。默认 false。 */
  pot?: boolean
  /** sheet 强制为正方形。默认 false。 */
  square?: boolean
  /** 源图相对「逻辑像素」的倍率(@2x→2、@3x→3)。默认 1。 */
  pixelRatio?: number
  /** 透传 sharp.png()(image 为 .png 时)。默认 { compressionLevel: 9, adaptiveFiltering: true }。 */
  png?: PngOptions
  /** 透传 sharp.webp()(image 为 .webp 时)。默认 { quality: 80, effort: 6 }。 */
  webp?: WebpOptions
  /** CSS 类名前缀:基类 .${prefix} + 每图类 .${prefix}-${name}。默认 "sprite"。 */
  prefix?: string
  /** 由源文件「基础名(无扩展名)」生成精灵名。默认原样。名字须匹配 /^[a-zA-Z_][\w-]*$/。 */
  nameTransformer?: (basename: string) => string
  /** 纳入的图片 glob(相对每个源目录)。默认 ["**\/*.{png,jpg,jpeg,webp,avif}"]。 */
  include?: string | string[]
  /** 排除的 glob(优先级高于 include)。默认 []。 */
  exclude?: string | string[]
  /** 是否启用缓存(默认 true);false → 删除该实例缓存与旧产物并强制重建。 / Enable cache (default true). */
  cache?: boolean
  /** 出错是否抛出并中止(默认 true);false → 仅告警并继续。 / Throw & abort on error (default true). */
  throwable?: boolean
}

/** 单组位图雪碧图配置(公共参数 + 本实例专属)。 / One sprite-sheet config (common + instance-only). */
export interface BitmapIconsItem extends BitmapIconsCommon {
  /**
   * 源图目录(相对仓库根),单个或多个;多个源目录会全部枚举后合并打进同一张雪碧图。
   * 约定:产物命名 *.sprite.{webp,png} 会被自动排除出源扫描。重名校验跨所有源目录生效。
   * Source dir(s) (relative to repo root); one or many. Multiple dirs are all enumerated
   * and merged into a single sheet. *.sprite.{webp,png} products are auto-excluded; dup-name check spans all dirs.
   */
  sources: string | string[]
  /** 输出配置:目录 / 基名 / 脚本语言 / 图集格式。 / Output config. */
  output: BitmapIconsOutput
  /**
   * 独立(CLI/函数)模式的缓存文件:完整路径或裸名。省略 → 由 output.name 派生唯一默认名。
   * vite 插件模式请用 `cacheName`(仅名字,目录由系统管理)。
   */
  cacheFilename?: string
}

/**
 * 插件/引擎入参:公共参数 + `items[]`。每个实例 = { ...公共, ...本项 }(本项覆盖公共)。
 * Options: common params + `items[]`. Each instance = { ...common, ...item } (item wins).
 */
export interface BitmapIconsOptions extends BitmapIconsCommon {
  items: BitmapIconsItem[]
}

/** @deprecated 旧名,等价于 BitmapIconsItem(过渡用)。 / Old alias for BitmapIconsItem. */
export type BitmapIconsConfig = BitmapIconsItem

/** 一个精灵在 sheet 中的位置与尺寸(均为图集实际像素)。 / A sprite's position & size in the sheet (actual sheet pixels). */
export interface IconFrame {
  x: number
  y: number
  width: number
  height: number
}

/** 名称 -> frame 映射。 / Name → frame map. */
export type IconManifest = Record<string, IconFrame>

/** sheet 元信息(写入 script / JSON)。 / Sheet metadata (written to script / JSON). */
export interface IconSheetMeta {
  width: number
  height: number
  pixelRatio: number
}
