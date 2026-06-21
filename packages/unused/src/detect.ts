/**
 * unusedVite —— 构建期「未使用资产」检测插件(基于 vite/rollup 模块图,只产表不删除)。
 *
 * 思路(参考 gatsbylabs/vite-plugin-unused):
 *   · `load(id)`：记录每个进入模块图的真实文件(= 被源码引用到的)。
 *   · `buildEnd`：候选资产(listCandidates: include/ext + exclude)减去模块图中出现过的 → 「疑似未使用」。
 *   · 结果写入清单表(.cache.graphics/unused.json),交由 removeUnused / remove-unused 显式删除。
 * 安全:只在 build 期工作(configResolved 判定);public/、build.outDir 自动排除。
 *
 * 不经 vite 的项目请改用静态检测 `findUnused`(见 scan.ts)——同样的清单表格式。
 */

import { isAbsolute, resolve } from 'node:path'

import { resolveCacheFile } from '@codejoo/utils/cache'
import { writeTextIfChanged } from '@codejoo/utils/fs-write'

import { listCandidates, repoRel } from './shared.ts'

import type { UnusedDetectOptions, UnusedManifest } from './types.ts'
import type { Plugin } from 'vite'

export function unusedVite(options: UnusedDetectOptions = {}): Plugin {
  const outputFile = resolveCacheFile('unused', options.output)
  const used = new Set<string>()
  const autoExclude: string[] = [] // 运行期补充:publicDir / build.outDir
  let isBuild = false

  return {
    name: 'graphics-icon:unused',
    apply: 'build',
    configResolved(config: { publicDir?: string; root?: string; command?: string; build?: { outDir?: string } }) {
      isBuild = config.command === 'build'
      const addDir = (p?: string): void => {
        if (p) autoExclude.push(`${repoRel(resolve(p)).replace(/\/+$/, '')}/**`)
      }
      addDir(config.publicDir) // public/ 原样拷贝,从不被 import → 永不算未使用
      if (config.build?.outDir) addDir(resolve(config.root ?? process.cwd(), config.build.outDir))
    },
    load(id) {
      const clean = id.split('?')[0] // 去掉 ?url / ?raw 等 query
      if (clean && isAbsolute(clean)) used.add(resolve(clean))
      return null // 仅观察,不接管加载
    },
    async buildEnd() {
      if (options.enabled === false || !isBuild) return
      const candidates = listCandidates(options, autoExclude)
      const unused = candidates.filter((rr) => !used.has(resolve(rr)))
      const manifest: UnusedManifest = { mode: 'vite', root: repoRel(resolve(options.root ?? 'src')), unused }
      writeTextIfChanged(outputFile, `${JSON.stringify(manifest, null, 2)}\n`)
      console.log(
        `[unused] (vite) 检出 ${unused.length} 个疑似未使用资产 → ${repoRel(outputFile)}` +
          `（删除前请先核对;remove-unused 执行删除,remove-unused --dry-run 先预览）`,
      )
    },
  }
}
