#!/usr/bin/env node
/**
 * svg-icons CLI 入口 —— 在 Vite 之外一次性生成 SVG 雪碧图（供 pre-commit / 脚本调用）。
 * svg-icons CLI — generate SVG sprite sheets outside Vite (for pre-commit / scripts).
 *
 * 用法 / Usage：
 *   <bin> --config ./svg.config.ts        # 配置文件需 default-export 一个 SvgIconsOptions（含 sprites[]）
 *
 * 只「按配置生成 + 维护缓存」，不碰 git。/ Only generate + maintain cache; never touches git.
 */

import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { svgIcons } from "./create.ts"

import type { SvgIconsOptions } from "./types.ts"

/** 取 `--config <path>` 的值。 / Read the value of `--config <path>`. */
function getConfigArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--config")
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined
}

/** 运行 CLI（可被 graphics-icon 的 bin 复用）。 / Run the CLI (reused by the umbrella bin). */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = getConfigArg(argv)
  if (!configPath) {
    console.error("[svg-icons] 需要 --config <配置文件>（default-export 一个含 sprites[] 的 SvgIconsOptions）")
    process.exitCode = 1
    return
  }
  const mod = (await import(pathToFileURL(resolve(configPath)).href)) as { default?: SvgIconsOptions } & Partial<SvgIconsOptions>
  const options = (mod.default ?? mod) as SvgIconsOptions
  await svgIcons(options)
  console.log("[svg-icons] 完成")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err: unknown) => {
    console.error("[svg-icons] 执行失败：", err)
    process.exit(1)
  })
}
