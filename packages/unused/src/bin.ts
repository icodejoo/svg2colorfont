#!/usr/bin/env node
/**
 * remove-unused CLI —— 未使用资产「静态检测(--scan)」与「按表删除」。两步分离,均不依赖 vite。
 * remove-unused CLI — static detect (--scan) and delete-from-table. Both work without vite.
 *
 * 用法 / Usage：
 *   # 1) 检测(静态扫描,写清单表,不删除)
 *   remove-unused --scan [--root src] [--include "**​/*.png"] [--exclude "src/icons/**"] [--sources "src/**​/*.{ts,vue}"]
 *   # 2) 删除(读清单表;include/exclude 为删除安全闸)
 *   remove-unused                      # 按清单删除
 *   remove-unused --dry-run | -n       # 仅打印将删除项,不实际删除
 *   remove-unused --include "assets/**" --exclude "assets/keep/**"
 *   remove-unused --manifest <path>    # 指定清单表路径(默认 .cache.graphics/unused.json)
 *
 * vite 项目可改在 build 期由 graphicsIcon({ unused: {...} }) 产表(模块图更精确),再用本命令删除。
 */

import { pathToFileURL } from 'node:url'

import { findUnused } from './scan.ts'
import { removeUnused } from './remove.ts'

/** 取 `--flag <value>` 的值。 / Read the value of `--flag <value>`. */
function getArg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined
}

/** 取可重复 / 逗号分隔的 `--flag a --flag b` 或 `--flag a,b`。 / Collect repeatable / comma-separated values. */
function getMulti(argv: string[], flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(...argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean))
  }
  return out
}

/** 运行 CLI(可被 graphics-icon 的 bin 复用)。 / Run the CLI (reused by the umbrella bin). */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const manifest = getArg(argv, '--manifest')
  const include = getMulti(argv, '--include')
  const exclude = getMulti(argv, '--exclude')

  if (argv.includes('--scan')) {
    // 静态检测:写清单表,不删除(请先核对再跑删除)。
    // --ext 任意后缀(图片/字体仅是默认值,亦可 .js/.ts/.json/...);裸名自动补点。
    const ext = getMulti(argv, '--ext').map((e) => (e.startsWith('.') ? e : `.${e}`))
    await findUnused({
      root: getArg(argv, '--root'),
      include: include.length ? include : undefined,
      ext: ext.length ? ext : undefined,
      exclude: exclude.length ? exclude : undefined,
      sources: getMulti(argv, '--sources'),
      output: manifest,
    })
    console.log('[unused] 已写出清单表;核对后运行 remove-unused 执行删除（或 --dry-run 预览）。')
    return
  }

  const dryRun = argv.includes('--dry-run') || argv.includes('-n')
  await removeUnused({ manifest, dryRun, include: include.length ? include : undefined, exclude: exclude.length ? exclude : undefined })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err: unknown) => {
    console.error('[remove-unused] 执行失败：', err)
    process.exit(1)
  })
}
