#!/usr/bin/env node
/**
 * svg-icons —— SVG 雪碧图 CLI（Vite 之外一次性生成）。
 * svg-icons — the SVG sprite CLI (one-off generation outside Vite).
 *
 * 复用 svg-icons 的 runCli（已随本包打包）。用法：svg-icons --config ./svg.config.ts
 * Reuses svg-icons' runCli (bundled). Usage: svg-icons --config ./svg.config.ts
 * 编程调用见库导出 `gSvg(argv?)`。/ For programmatic use, import `gSvg(argv?)` from the package root.
 */
import { runCli } from 'svg-icons'

runCli().catch((err: unknown) => {
  console.error('[svg-icons] 执行失败：', err)
  process.exit(1)
})
