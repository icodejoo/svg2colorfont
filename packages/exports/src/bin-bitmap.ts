#!/usr/bin/env node
/**
 * bitmap-icons —— 位图雪碧图 CLI（Vite 之外一次性生成）。
 * bitmap-icons — the bitmap sprite-sheet CLI (one-off generation outside Vite).
 *
 * 复用 bitmap-icons 的 runCli（已随本包打包）。用法：bitmap-icons --config ./bitmap.config.ts
 * Reuses bitmap-icons' runCli (bundled). Usage: bitmap-icons --config ./bitmap.config.ts
 * 编程调用见库导出 `gBitmap(argv?)`。/ For programmatic use, import `gBitmap(argv?)` from the package root.
 */
import { runCli } from 'bitmap-icons'

runCli().catch((err: unknown) => {
  console.error('[bitmap-icons] 执行失败：', err)
  process.exit(1)
})
