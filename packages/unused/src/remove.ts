/**
 * removeUnused —— 按 unusedVite/findUnused 产出的「清单表」删除文件(检测与删除分离的删除端)。
 * removeUnused — delete files listed in the manifest table produced by the detectors.
 *
 * 删除前再过一道 include/exclude 安全闸(独立于产表方式):
 *   · include 给出 → 仅删命中者;省略 → 不限制。
 *   · exclude  命中 → 一律保留(优先级最高)。
 * dryRun 时仅打印不删。清单中已不存在的文件计入 missing。
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCacheFile } from '@codejoo/utils/cache'
import { matchesAnyGlob, toGlobList } from '@codejoo/utils/glob'

import type { RemoveUnusedOptions, RemoveUnusedResult, UnusedManifest } from './types.ts'

export async function removeUnused(options: RemoveUnusedOptions = {}): Promise<RemoveUnusedResult> {
  const manifestFile = resolveCacheFile('unused', options.manifest)
  const include = toGlobList(options.include)
  const exclude = toGlobList(options.exclude)
  /** include(若给)命中 且 未命中 exclude,才允许删除。 / Allowed only if include-match (when set) and not exclude-match. */
  const allowed = (rel: string): boolean => (include.length === 0 || matchesAnyGlob(rel, include)) && !matchesAnyGlob(rel, exclude)

  let table: UnusedManifest
  try {
    table = JSON.parse(readFileSync(manifestFile, 'utf8')) as UnusedManifest
  } catch {
    console.warn(`[unused] 找不到或无法解析清单表:${manifestFile}（请先经 vite build 或 remove-unused --scan 生成）`)
    return { removed: [], skipped: [], missing: [] }
  }

  const files = Array.isArray(table.unused) ? table.unused : []
  const removed: string[] = []
  const skipped: string[] = []
  const missing: string[] = []

  for (const rel of files) {
    if (!allowed(rel)) {
      skipped.push(rel)
      continue
    }
    const abs = resolve(rel) // 清单路径为仓库根相对 → 以 cwd 解析
    if (!existsSync(abs)) {
      missing.push(rel)
      continue
    }
    if (options.dryRun) {
      console.log(`[unused] (dry-run) 将删除:${rel}`)
    } else {
      rmSync(abs, { force: true })
      console.log(`[unused] 已删除:${rel}`)
    }
    removed.push(rel)
  }

  const tag = options.dryRun ? '(dry-run) ' : ''
  console.log(
    `[unused] ${tag}完成:${options.dryRun ? '待删除' : '已删除'} ${removed.length} 个` +
      `${skipped.length ? `，被 include/exclude 跳过 ${skipped.length} 个` : ''}，清单中已不存在 ${missing.length} 个`,
  )
  return { removed, skipped, missing }
}
