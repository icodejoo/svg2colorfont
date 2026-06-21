/**
 * @codejoo/unused 类型与默认值。
 * Types & defaults for @codejoo/unused.
 */

/**
 * 默认候选资产扩展名(图片/字体/媒体)——这些通常不被源码 `import`,
 * 故作为「未使用」检测的候选集合。可经 `include`/`ext` 覆盖。
 * Default candidate asset extensions; used to build the default `include` when none is given.
 */
export const DEFAULT_ASSET_EXTS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.tif', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.flac',
]

/**
 * 默认源文件 glob —— 静态扫描(findUnused)据此搜集「引用」。node_modules/dist/.cache.graphics 一律剪除。
 * Default source globs scanned by the static detector for references.
 */
export const DEFAULT_SOURCE_GLOBS = [
  '**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx,vue,svelte,astro,html,htm,css,scss,sass,less,styl,json,md,mdx}',
]

/** 候选资产解析的公共字段(detect / scan 共用)。 / Shared candidate-resolution fields. */
export interface CandidateOptions {
  /** 扫描根目录(默认 "src")。 / Scan root directory (default "src"). */
  root?: string
  /**
   * 候选资产 glob(在 root 下匹配,相对 root)。省略 → 由 `ext` 生成 `**​/*<ext>`。
   * Candidate-asset globs (relative to root). Omitted → derived from `ext`.
   */
  include?: string | string[]
  /** 当未给 `include` 时,用于生成默认 include 的扩展名(默认 DEFAULT_ASSET_EXTS)。 */
  ext?: string[]
  /**
   * 排除 glob(仓库根相对、正斜杠)。经伞插件使用时,四引擎输入/产物会自动并入。
   * Exclude globs (repo-root-relative). Engine inputs/outputs are merged in via the umbrella.
   */
  exclude?: string | string[]
}

/** unusedVite(构建期、基于 vite 模块图)检测插件选项。 / Options for the vite-based detector. */
export interface UnusedDetectOptions extends CandidateOptions {
  /** 清单表输出路径(默认 .cache.graphics/unused.json)。 / Manifest output path. */
  output?: string
  /** 是否启用(默认 true)。 / Enabled (default true). */
  enabled?: boolean
}

/** findUnused(静态扫描、不依赖 vite)选项。 / Options for the bundler-independent static detector. */
export interface FindUnusedOptions extends CandidateOptions {
  /** 待扫描的源文件 glob(默认 DEFAULT_SOURCE_GLOBS)。 / Source globs to scan for references. */
  sources?: string | string[]
  /** 源文件扫描根(默认 cwd)。 / Root to scan sources from (default cwd). */
  sourceRoot?: string
  /** 清单表输出路径(默认 .cache.graphics/unused.json)。 / Manifest output path. */
  output?: string
}

/** 检测产出的「未使用清单表」结构。 / Shape of the emitted "unused" manifest table. */
export interface UnusedManifest {
  /** 产表方式:vite 模块图 / 静态扫描。 / How the table was produced. */
  mode: 'vite' | 'scan'
  /** 扫描根(仓库根相对)。 / Scan root (repo-root-relative). */
  root: string
  /** 疑似未使用文件(仓库根相对、已排序)。 / Suspected-unused files (repo-relative, sorted). */
  unused: string[]
}

/** removeUnused 删除引擎选项。 / Options for the removeUnused delete engine. */
export interface RemoveUnusedOptions {
  /** 清单表路径(默认 .cache.graphics/unused.json)。 / Manifest path. */
  manifest?: string
  /** 仅打印不实际删除(默认 false)。 / Print-only, no deletion (default false). */
  dryRun?: boolean
  /**
   * 删除白名单 glob(仓库根相对)。给出后,仅删除「命中 include」的清单项;省略 = 不限制。
   * Delete allow-list. When set, only entries matching `include` are deleted.
   */
  include?: string | string[]
  /**
   * 删除黑名单 glob(仓库根相对)。命中者一律保留(最终安全闸,优先级高于 include)。
   * Delete deny-list. Matching entries are always kept (final safety gate; wins over include).
   */
  exclude?: string | string[]
}

/** removeUnused 结果。 / Result of removeUnused. */
export interface RemoveUnusedResult {
  /** 已删除(或 dry-run 下「将删除」)的文件。 / Deleted (or, in dry-run, would-delete) files. */
  removed: string[]
  /** 被 include/exclude 过滤而跳过的清单项。 / Entries skipped by the include/exclude filter. */
  skipped: string[]
  /** 清单中但磁盘已不存在的文件。 / Files in the manifest that no longer exist on disk. */
  missing: string[]
}
