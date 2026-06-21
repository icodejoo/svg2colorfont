// 发布产物验收:加载已构建的 dist/vite.js(伞插件,引擎已内联),真实 vite build,
// colorFormat:'colrv1' —— 验证随包的相对 wasm 能产出 colrv1 字体(实物落盘到 outDir)。
import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as viteBuild } from 'vite'

import graphicsIcon from '../dist/vite.js'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, 'app')
const fixtures = resolve(here, '../../colorfont/fixtures')
const distDir = resolve(here, '.acc-dist-pub')
const gen = resolve(appRoot, '.gen') // colorfont 实物落盘(app/main.ts 导入 .gen/AccIcons.css)

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error('ASSERT FAILED: ' + m)
}

assert(existsSync(resolve(here, '../dist/vite.js')), '先 build:dist/vite.js 应存在')
assert(existsSync(resolve(here, '../dist/colrv1/colrv1_writer.js')), 'dist/colrv1 wasm 已随包')

await rm(distDir, { recursive: true, force: true })
await rm(gen, { recursive: true, force: true })

await viteBuild({
  root: appRoot,
  configFile: false,
  logLevel: 'error',
  build: { outDir: distDir, emptyOutDir: true },
  // 用已构建的发布插件(default 导出),开 colrv1(应触发相对 wasm 加载),实物落盘到 .gen
  plugins: [
    graphicsIcon({
      colorfonts: {
        colorFormat: 'colrv1',
        formats: ['woff2'],
        items: [{ input: fixtures, outDir: gen, fontName: 'AccIcons' }],
      },
    }),
  ],
})

const fonts = readdirSync(gen).filter((f) => f.endsWith('.woff2'))
console.log('[dist] colorfont fonts (real-disk):', fonts.join(', '))
const flavors = new Set(fonts.map((f) => f.match(/AccIcons\.([a-z0-9]+)\./)?.[1]))
assert(flavors.has('mono'), 'mono 字体')
assert(flavors.has('colrv0'), 'colrv0 字体')
assert(flavors.has('otsvg'), 'otsvg 字体')
assert(flavors.has('colrv1'), '★ colrv1 字体(发布产物内联 core + 相对 wasm 全通)')

console.log('\n✅ DIST ACCEPTANCE OK(发布形态 dist/vite.js 经真实 vite build 实物落盘四档含 colrv1)')
