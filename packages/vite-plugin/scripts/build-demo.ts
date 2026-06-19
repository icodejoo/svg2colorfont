// 真实构建:用 vite + colorfont 插件,把 colorfont/.bench-icons(全量)构建到 colorfont/demo-output。
// 兼作提速基线测量(打印各阶段耗时与产物大小)。
import { readdirSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as viteBuild } from 'vite'

import colorfont from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..') // colorfont 仓库根
const appRoot = resolve(here, '../test/app')
const benchIcons = resolve(repo, '.bench-icons')
const outDir = resolve(repo, 'demo-output')

const iconCount = readdirSync(benchIcons).filter((f) => f.endsWith('.svg')).length
console.log(`输入: ${benchIcons}\n图标: ${iconCount}\n输出: ${outDir}\n`)

await rm(outDir, { recursive: true, force: true })

const t0 = Date.now()
await viteBuild({
  root: appRoot,
  configFile: false,
  logLevel: 'warn',
  base: '/',
  build: { outDir, emptyOutDir: true },
  plugins: [
    colorfont({
      input: benchIcons,
      outDir,
      fontName: 'DemoIcons',
      colorFormat: 'auto',
      // 默认只产 woff2(Chrome/Safari/Firefox/Edge 全支持);dev 自动用 q9 提速
      emitDemo: true,
    } as Parameters<typeof colorfont>[0]),
  ],
})
const dt = (Date.now() - t0) / 1000

console.log(`\n=== 真实 vite 构建完成,用时 ${dt.toFixed(2)}s ===`)
const fontDir = resolve(outDir, 'colorfont')
let total = 0
for (const f of readdirSync(fontDir)) {
  const s = statSync(resolve(fontDir, f)).size
  total += s
  console.log(`  ${f}  ${(s / 1024).toFixed(1)} KB`)
}
console.log(`字体总计: ${(total / 1024).toFixed(1)} KB`)
