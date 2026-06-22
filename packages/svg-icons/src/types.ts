/**
 * svg-icons 配置与颜色策略类型。
 * svg-icons config and color-strategy types.
 */

/**
 * 颜色改写策略：
 *   · true            → fill/stroke 改为 currentColor（跟随 CSS color）
 *   · string          → 改为该颜色
 *   · falsy/undefined → 什么都不做
 *   · 函数            → 对每处颜色调用 (name=文件名/symbolId, symbolId, 原颜色)；
 *                       返回真值字符串则替换为该值，返回 falsy 则保留原样
 * Color rewrite strategy:
 *   · true      → fill/stroke become currentColor (follows CSS color)
 *   · string    → replace with that color
 *   · falsy     → no-op
 *   · function  → called per color as (name, symbolId, currentColor); truthy string replaces, falsy keeps
 */
export type ColorFn = (name: string, symbolId: string, color: string) => string | false | null | undefined
export type ColorOption = boolean | string | ColorFn | null | undefined

/**
 * 归一化 / 缩放策略（默认关闭 → 行为不变，安全）：
 *   · falsy/undefined → 不做归一化（默认）
 *   · true            → 以默认宽度 1024 归一化每个 symbol 几何
 *   · { width }       → 以指定宽度归一化
 * 启用后，每个图标 symbol 的几何会被归一化/缩放到统一的 viewBox 宽度，
 * 复用 colorfont 引擎的同一套「缩放 + 整数化」策略（@codejoo/utils/scale-svg 的 normalizeSvg）。
 *
 * Normalize / scale strategy (default OFF → unchanged, safe behavior):
 *   · falsy      → no normalization (default)
 *   · true       → normalize each symbol geometry to the default width 1024
 *   · { width }  → normalize to the given width
 * When enabled, each icon symbol's geometry is normalized/scaled to a uniform viewBox width,
 * reusing colorfont's same scale+integerize strategy (normalizeSvg from @codejoo/utils/scale-svg).
 */
export type NormalizeOption = boolean | { width?: number } | undefined

/**
 * 产物输出（与 colorfont 的 output 统一为 `{ dir, name, ts? }`）。
 * 三类产物全部恒产，路径由 dir + name 派生：
 *   · 雪碧图：`{dir}/{name}.svg`
 *   · 脚本：  `{dir}/{name}.{ts ? 'ts' : 'js'}`（ts 默认 true）
 *   · 清单：  `{dir}/{name}.json`（机器可读的 symbol id 列表）
 * Output (unified with colorfont's `{ dir, name, ts? }`). All three products are always emitted,
 * with paths derived from dir + name:
 *   · sprite:   `{dir}/{name}.svg`
 *   · script:   `{dir}/{name}.{ts ? 'ts' : 'js'}` (ts defaults to true)
 *   · manifest: `{dir}/{name}.json` (machine-readable symbol-id list)
 */
export interface SvgIconsOutput {
  /** 产物输出目录，如 'src/sprites/svg/common'。 / Output directory. */
  dir: string
  /** 产物基名（不含扩展名），雪碧图/脚本/清单共用。 / Base name (no ext), shared by all products. */
  name: string
  /**
   * 脚本是否产 TypeScript（默认 true）：
   *   · true  → `{name}.ts`，附带 `export type IconName` 字符串字面量联合（供代码提示）。
   *   · false → `{name}.js`，仅运行时对象（iconsHref + iconsName），无类型。
   * Emit a TypeScript script (default true): true → `{name}.ts` with the `IconName` union;
   * false → `{name}.js` with the runtime objects only (no types).
   */
  ts?: boolean
}

/**
 * 各实例可共享的「公共参数」(顶层设置;每个 item 与之合并,item 同名字段覆盖)。
 * Shared "common" params (set at top level; merged into each item, item overrides).
 */
export interface SvgIconsCommon {
  /** 颜色改写策略（见 ColorOption） / color rewrite strategy */
  color?: ColorOption
  /**
   * 归一化 / 缩放（默认关闭）。开启后每个 symbol 几何被缩放到统一 viewBox 宽度（默认 1024），
   * 与 colorfont 的 normalizeSvg 同步。见 NormalizeOption。
   */
  normalize?: NormalizeOption
  /** symbol id 转换；默认保留原文件名（维持现有 <use href="#xxx">） */
  iconNameTransformer?: (name: string) => string
  /** 生成后的格式化器（svg 不支持时插件会优雅回退） */
  formatter?: "svgo" | "prettier" | "oxfmt"
  /** 是否启用缓存（默认 true）；false → 删除该实例缓存与旧产物并强制重建。 / Enable cache (default true). */
  cache?: boolean
  /** 出错是否抛出并中止（默认 true）；false → 仅告警并继续。 / Throw & abort on error (default true). */
  throwable?: boolean
}

/** 单实例配置（公共参数 + 本实例专属）。 / One instance config (common + instance-only fields). */
export interface SvgIconsItem extends SvgIconsCommon {
  /**
   * 图标源目录:单个目录字符串,或多个目录的数组（数组中所有目录的 svg 合进同一张 sprite）。
   * Icon source directory(ies): a single directory string, or an array of directories
   * (all svgs across the array are merged into the same sprite).
   */
  sources: string | string[]
  /** 产物输出 `{ dir, name, ts? }`（三产物恒产，路径由 dir+name 派生） / output `{ dir, name, ts? }` (all products always emitted) */
  output: SvgIconsOutput
  /**
   * 独立(CLI/函数)模式的缓存文件:完整路径或裸名（裸名 → 落共享目录 .cache.graphics/）。
   * 省略 → 由输出名派生唯一默认名。vite 插件模式请用 `cacheName`（仅名字,目录由系统管理）。
   * Standalone cache file (full path or bare name). Omit → unique default from the output name.
   */
  cacheFilename?: string
}

/**
 * 插件/引擎入参:公共参数 + `items[]`。每个实例 = { ...公共, ...本项 }（本项覆盖公共）。
 * Options: common params + `items[]`. Each instance = { ...common, ...item } (item wins).
 */
export interface SvgIconsOptions extends SvgIconsCommon {
  items: SvgIconsItem[]
}

/** @deprecated 旧名,等价于 SvgIconsItem(过渡用)。 / Old alias for SvgIconsItem. */
export type SvgIconsConfig = SvgIconsItem
