/**
 * findUnused —— 不依赖 vite 的「未使用资产」静态检测(供 CLI / 非 bundler 流水线)。
 *
 * 思路:搜集源文件文本(sources glob),若某候选资产的「文件名(basename)」在任一源文件中出现,
 * 即视为被引用(保守:宁可多留也不误删)。候选(listCandidates)中未被引用者 → 写入清单表。
 * 与 unusedVite 产同样的清单表,交由 removeUnused / remove-unused 删除。
 *
 * 局限:基于 basename 子串的启发式 —— 偏向「保留」(同名 basename 出现即保留),误删风险低;
 * 反过来同名资产可能彼此「互保」。清单仅供核对,删除前务必检查。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCacheFile } from '@codejoo/utils/cache'
import { writeTextIfChanged } from '@codejoo/utils/fs-write'
import { toGlobList } from '@codejoo/utils/glob'

import { listCandidates, repoRel } from './shared.ts'
import { DEFAULT_SOURCE_GLOBS } from './types.ts'

import type { FindUnusedOptions, UnusedManifest } from './types.ts'

const SKIP_SOURCE = /(^|[\\/])(node_modules|\.git|\.cache\.graphics)([\\/]|$)|[\\/]dist[\\/]/

export async function findUnused(options: FindUnusedOptions = {}): Promise<UnusedManifest> {
  const outputFile = resolveCacheFile('unused', options.output)
  const candidates = listCandidates(options)

  // 搜集源文件文本(剪除 node_modules/dist/.cache)。
  const srcRoot = resolve(options.sourceRoot ?? process.cwd())
  const srcPatterns = toGlobList(options.sources)
  const patterns = srcPatterns.length ? srcPatterns : DEFAULT_SOURCE_GLOBS
  let srcRels: string[]
  try {
    srcRels = globSync(patterns, { cwd: srcRoot, exclude: (p: string) => SKIP_SOURCE.test(p) })
  } catch {
    srcRels = []
  }
  const haystacks: string[] = []
  for (const rel of srcRels) {
    if (SKIP_SOURCE.test(rel)) continue
    try {
      haystacks.push(readFileSync(resolve(srcRoot, rel), 'utf8'))
    } catch {
      /* 读不到就略过 */
    }
  }

  // 被引用 = 其 basename 在任一源文件中出现(保守启发式)。
  const unused = candidates.filter((rr) => {
    const base = rr.split('/').pop() ?? rr
    return !haystacks.some((h) => h.includes(base))
  })

  const manifest: UnusedManifest = { mode: 'scan', root: repoRel(resolve(options.root ?? 'src')), unused }
  writeTextIfChanged(outputFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `[unused] (scan) 扫描 ${haystacks.length} 个源文件,检出 ${unused.length} 个疑似未使用资产 → ${repoRel(outputFile)}` +
      `（删除前请先核对;remove-unused 执行删除,remove-unused --dry-run 先预览）`,
  )
  return manifest
}
