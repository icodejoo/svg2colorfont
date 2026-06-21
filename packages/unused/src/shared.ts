/**
 * 候选资产解析与路径归一 —— detect(vite)与 scan(静态)共用,保证两条路径口径一致。
 * Shared candidate resolution & path normalization for both detectors.
 */

import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { matchesAnyGlob, toGlobList } from '@codejoo/utils/glob'

import { DEFAULT_ASSET_EXTS } from './types.ts'

import type { CandidateOptions } from './types.ts'

/** 绝对路径 → 仓库根(cwd)相对、正斜杠。 / Absolute path → repo-root(cwd)-relative, forward slashes. */
export const repoRel = (abs: string): string => relative(process.cwd(), abs).replace(/\\/g, '/')

/**
 * 解析候选资产为「仓库根相对路径」列表:
 *   include(默认由 ext 生成 `**​/*<ext>`)在 root 下匹配,再按 exclude(仓库相对)滤除,排序去抖。
 * Resolve candidate assets to a sorted list of repo-relative paths.
 */
export function listCandidates(opts: CandidateOptions, extraExclude: string[] = []): string[] {
  const root = resolve(opts.root ?? 'src')
  const include = toGlobList(opts.include)
  const patterns = include.length ? include : (opts.ext ?? DEFAULT_ASSET_EXTS).map((e) => `**/*${e}`)
  const exclude = [...toGlobList(opts.exclude), ...extraExclude]

  let rels: string[]
  try {
    rels = globSync(patterns, { cwd: root })
  } catch {
    rels = []
  }
  const out: string[] = []
  for (const rel of rels) {
    const rr = repoRel(resolve(root, rel))
    if (!matchesAnyGlob(rr, exclude)) out.push(rr)
  }
  out.sort()
  return out
}
