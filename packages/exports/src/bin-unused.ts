#!/usr/bin/env node
/**
 * remove-unused —— 按 vite build 产出的「未使用资产清单表」(.cache.graphics/unused.json)删除文件。
 * remove-unused — delete files listed in the unused-asset manifest produced by `vite build`.
 *
 * 复用 @codejoo/unused 的 runCli(已随本包打包)。用法 / Usage：
 *   remove-unused                    # 按清单删除
 *   remove-unused --dry-run | -n     # 仅打印将删除项,不实际删除
 *   remove-unused --manifest <path>  # 指定清单表路径
 *
 * 检测(写表)在 vite build 期由伞插件 graphicsIcon({ unused: {...} }) 完成;本命令只负责删除。
 */
import { runCli } from '@codejoo/unused'

runCli().catch((err: unknown) => {
  console.error('[remove-unused] 执行失败：', err)
  process.exit(1)
})
