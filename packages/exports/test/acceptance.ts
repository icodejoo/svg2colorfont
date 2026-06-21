// 真实验收:用真正的 Vite 跑一次 build,验证伞插件「实物落盘」+ vite 正常打包。
//   · colorfont:buildStart 把字体 + .css + .ts 写到 outDir(app/.gen);app 导入该 .css → vite 打包字体。
//   · svgIcons :buildStart 把 sprite svg + script 写到磁盘。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as viteBuild } from 'vite'

import graphicsIcon from '../src/vite.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, 'app')
const fixtures = resolve(here, '../../colorfont/fixtures')
const distDir = resolve(here, '.acc-dist')
const gen = resolve(appRoot, '.gen') // colorfont 实物落盘(被 app/main.ts 导入)
const svgGen = resolve(here, '.acc-svg')
// unused 检测用:scan root 下放「引擎输入(icons/a.svg)」+「孤儿资产(orphan.png)」。
const unusedRoot = resolve(here, '.acc-unused')
const unusedManifest = resolve(here, '.acc-unused.json')

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error('ASSERT FAILED: ' + m)
}
function walk(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, base))
    else out.push(p.slice(base.length + 1).replace(/\\/g, '/'))
  }
  return out
}

await rm(distDir, { recursive: true, force: true })
await rm(gen, { recursive: true, force: true })
await rm(svgGen, { recursive: true, force: true })
await rm(unusedRoot, { recursive: true, force: true })
await rm(unusedManifest, { force: true })

// 准备 unused scan root:icons/a.svg 作为额外 svgIcons 实例的输入(应被自动排除);orphan.png 无人引用(应被检出)。
mkdirSync(resolve(unusedRoot, 'icons'), { recursive: true })
writeFileSync(resolve(unusedRoot, 'icons', 'a.svg'), '<svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>')
writeFileSync(resolve(unusedRoot, 'orphan.png'), 'not-referenced')

// ============================ 真实 vite build(伞插件:colorfont + svgIcons) ============================
await viteBuild({
  root: appRoot,
  configFile: false,
  logLevel: 'warn',
  base: '/',
  build: { outDir: distDir, emptyOutDir: true },
  plugins: [
    graphicsIcon({
      colorfonts: {
        colorFormat: 'auto',
        formats: ['woff2', 'woff'],
        items: [{ input: fixtures, outDir: gen, fontName: 'AccIcons' }],
      },
      svgIcons: {
        color: true,
        items: [
          { input: fixtures, output: { svg: join(svgGen, 'icons.svg'), script: join(svgGen, 'icons.ts') } },
          // 额外实例:输入在 unusedRoot/icons 下 → 其 a.svg 应被 unused 自动排除(引擎输入,不应误删)。
          { input: resolve(unusedRoot, 'icons'), output: { svg: join(svgGen, 'extra.svg'), script: join(svgGen, 'extra.ts') } },
        ],
      },
      // 未使用资产检测:扫描 unusedRoot;引擎输入(icons/**)由伞插件自动排除。
      unused: { root: unusedRoot, ext: ['.svg', '.png'], output: unusedManifest },
    }),
  ],
})

// ── colorfont 实物落盘(outDir) ──
assert(existsSync(join(gen, 'AccIcons.css')), 'colorfont 实物落盘 AccIcons.css')
assert(existsSync(join(gen, 'AccIcons.ts')), 'colorfont 实物落盘 AccIcons.ts')
assert(existsSync(join(gen, 'AccIcons.codepoints.json')), 'colorfont 码位锁落盘')
const genFonts = readdirSync(gen).filter((f) => f.endsWith('.woff2'))
assert(genFonts.length >= 1, 'colorfont 实物落盘 woff2 字体')
assert(genFonts.some((f) => /AccIcons\.(mono|colrv0|otsvg)\./.test(f)), 'colorfont 字体名含 flavor')
const genCss = readFileSync(join(gen, 'AccIcons.css'), 'utf8')
assert(genCss.includes('@font-face') && genCss.includes('tech(color-svg)'), 'colorfont CSS 含 @font-face + tech() 回退链')

// ── svgIcons 实物落盘 ──
assert(existsSync(join(svgGen, 'icons.svg')), 'svgIcons sprite svg 落盘')
assert(existsSync(join(svgGen, 'icons.ts')), 'svgIcons 入口脚本落盘')

// ── vite 正常打包(app 导入 colorfont CSS → 字体进 dist) ──
const files = walk(distDir)
console.log('[build] dist files:', files.join(', '))
const cssText = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(distDir, f), 'utf8')).join('\n')
// vite 打包字体:大字体 → 独立 .woff2 文件;小字体(本 fixture)→ 内联 data URI。两者都算成功。
const fontsBundled = files.some((f) => f.endsWith('.woff2')) || cssText.includes('font/woff2')
assert(fontsBundled, 'colorfont 字体经真实 vite build 打包进 dist(独立 .woff2 或内联 data URI)')
assert(cssText.includes('@font-face') && cssText.includes('tech('), 'dist CSS 含 @font-face + tech() 回退链')

// ── unused:检出孤儿资产、且引擎输入被自动排除(不误删图标源) ──
assert(existsSync(unusedManifest), 'unused 清单表已写出')
const manifest = JSON.parse(readFileSync(unusedManifest, 'utf8')) as { unused: string[] }
const orphanRel = relative(process.cwd(), resolve(unusedRoot, 'orphan.png')).replace(/\\/g, '/')
const engineInputRel = relative(process.cwd(), resolve(unusedRoot, 'icons', 'a.svg')).replace(/\\/g, '/')
console.log('[unused] manifest.unused:', manifest.unused.join(', ') || '(空)')
assert(manifest.unused.includes(orphanRel), 'unused 检出孤儿资产 orphan.png')
assert(!manifest.unused.includes(engineInputRel), 'unused 自动排除引擎输入 icons/a.svg(不会被误删)')

await rm(unusedRoot, { recursive: true, force: true })
await rm(unusedManifest, { force: true })

console.log('\n✅ VITE ACCEPTANCE OK(伞插件实物落盘:colorfont→outDir + svg→磁盘;字体经真实 vite build 打包进 dist;unused 检出孤儿且自动排除引擎输入)')
