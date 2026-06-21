#!/usr/bin/env node
/**
 * imagemin CLI 入口 —— 复用 ./options.ts 的默认配置与 ./imagemin.ts 的引擎。
 * imagemin CLI entry — reuses the defaults from ./options.ts and the engine from ./imagemin.ts.
 *
 * 用法 / Usage：
 *   · 指定文件（如 pre-commit 暂存的图片）：codejoo-imagemin <图片...>
 *   · 全量扫描（无 git hooks 的项目）：     codejoo-imagemin --all [目录...]
 *   · 自定义配置（覆盖默认值）：            codejoo-imagemin --all --config ./imagemin.config.js
 *
 * 本脚本只「压缩 + 更新缓存」，不碰 git。
 * This script only "compress + update cache"; it never touches git.
 */

import { globSync } from "node:fs"
import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { imagemin, matchesAnyGlob, toGlobList } from "./imagemin.ts"
import { defaultOptions } from "./options.ts"

import type { ImageminOptions } from "./imagemin.ts"

/**
 * 全量扫描：用 include glob 在 roots 下匹配图片，按 exclude glob 排除。返回去重后的绝对路径。
 * 完全由 options.include / options.exclude 驱动（单一事实来源，支持数组）。
 *
 * 排除一律以「仓库根（process.cwd()）相对路径」匹配 —— 与暂存模式、imagemin 语义一致：
 * 无论从哪个子目录扫，`**​/dist/**` 这类规则都生效。
 */
function walkImages(roots: string[], options: ImageminOptions): string[] {
  const include = toGlobList(options.include)
  const exclude = toGlobList(options.exclude)
  const isExcluded = (p: string): boolean => matchesAnyGlob(p, exclude)

  const seen = new Set<string>()
  const out: string[] = []
  for (const root of roots) {
    let rels: string[]
    try {
      // exclude 传给 globSync 仅作「目录剪枝」加速（其对叶子文件的过滤不可靠）；
      // 权威排除在下方以「仓库相对路径」事后判定。
      rels = globSync(include, { cwd: root, exclude: isExcluded })
    } catch {
      continue // 目录不可读 → 跳过
    }
    for (const rel of rels) {
      const full = resolve(root, rel)
      const repoRel = relative(process.cwd(), full) // 仓库根相对路径（权威排除依据）
      if (isExcluded(repoRel) || seen.has(full)) continue
      seen.add(full)
      out.push(full)
    }
  }
  return out
}

/** 取 `--config <path>` 的值（若提供）。 / Read the value of `--config <path>` if present. */
function getConfigArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--config")
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined
}

/**
 * 动态导入用户配置并浅合并到默认值之上（用户配置优先）。
 * Dynamically import a user config and shallow-merge it over the defaults (user wins).
 */
async function loadOptions(configPath?: string): Promise<ImageminOptions> {
  if (!configPath) return defaultOptions
  const mod = (await import(pathToFileURL(resolve(configPath)).href)) as { default?: Partial<ImageminOptions> } & Partial<ImageminOptions>
  const userOpts = mod.default ?? mod
  return { ...defaultOptions, ...userOpts }
}

/**
 * 运行 CLI。可被其他包(如 graphics-icon 的 bin)直接调用以「完全平替」本 CLI。
 * Run the CLI. Exported so other packages (e.g. graphics-icon's bin) can reuse it verbatim.
 */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  // --all / --scan：全量扫描模式。可选附带目录：--all public src/assets（缺省扫描整个仓库根）。
  const fullScan = argv.includes("--all") || argv.includes("--scan")
  const configPath = getConfigArg(argv)
  // 位置参数：剔除选项标志与 --config 的值
  const positional = argv.filter((a, i) => !a.startsWith("-") && argv[i - 1] !== "--config")

  const options = await loadOptions(configPath)

  let files: string[]
  if (fullScan) {
    const roots = positional.length > 0 ? positional.map((d) => resolve(d)) : [process.cwd()]
    files = walkImages(roots, options)
    if (files.length === 0) {
      console.log("[imagemin] 全量扫描：未找到可处理的图片")
      return
    }
    console.log(`[imagemin] 全量扫描，共 ${files.length} 张图片…`)
  } else {
    files = positional
    if (files.length === 0) {
      console.log("[imagemin] 无图片文件，跳过（如需全量扫描请加 --all）")
      return
    }
  }

  const { changed } = await imagemin(files, options)
  console.log(`[imagemin] ${fullScan ? "全量" : "处理"}完成：改写 ${changed.length} 张（缓存已更新）`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err: unknown) => {
    console.error("[imagemin] 执行失败：", err)
    process.exit(1)
  })
}
