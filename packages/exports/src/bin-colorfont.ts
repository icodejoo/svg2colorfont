#!/usr/bin/env node
/**
 * color-fonts —— 彩色图标 webfont CLI（Vite 之外构建/校验码位）。
 * color-fonts — the color-icon webfont CLI (build / verify codepoints outside Vite).
 *
 * 复用 @codejoo/colorfont 的 runCli（已随本包打包）。用法见 colorfont CLI（build / watch / check 子命令）。
 * Reuses @codejoo/colorfont's runCli (bundled). See the colorfont CLI (build / watch / check subcommands).
 * 编程调用见库导出 `gColorfont(argv?)`。/ For programmatic use, import `gColorfont(argv?)` from the package root.
 */
import { runCli } from '@codejoo/colorfont'

runCli(process.argv.slice(2)).then(
  (code: number) => process.exit(code),
  (err: unknown) => {
    console.error('[color-fonts] 失败:', err)
    process.exit(1)
  },
)
