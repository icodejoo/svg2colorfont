import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildAndWrite } from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '../fixtures')
const out = resolve(here, '../.smoke-out')

await rm(out, { recursive: true, force: true })

const result = await buildAndWrite({
  input: fixtures,
  outDir: out,
  fontName: 'SmokeIcons',
  formats: ['woff2', 'woff', 'ttf'],
  colorFormat: 'auto',
})

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
}

const monoWoff2 = result.assets.find((a) => a.color === 'mono' && a.format === 'woff2')
assert(monoWoff2, 'mono woff2 资产存在')
assert(String.fromCharCode(...monoWoff2.source.slice(0, 4)) === 'wOF2', 'mono woff2 magic')

assert(result.assets.some((a) => a.color === 'colrv0' && a.format === 'woff2'), 'colrv0 woff2 资产存在')
assert(result.assets.some((a) => a.color === 'otsvg' && a.format === 'woff2'), 'otsvg woff2 资产存在')

assert(result.metadata.glyphs.length === 5, `应有 5 个字形,实为 ${result.metadata.glyphs.length}`)
const logo = result.metadata.glyphs.find((g) => g.name === 'logo-color')
const badge = result.metadata.glyphs.find((g) => g.name === 'badge-grad')
const home = result.metadata.glyphs.find((g) => g.name === 'home')
assert(logo?.color === true, 'logo-color 多色')
assert(badge?.color === true, 'badge-grad(渐变)标记为彩色')
assert(home?.color === false, 'home 单色')

// CSS tech() 回退链检查
const css = result.emitCss((a) => `./${a.fileName}`)
const faceCount = (css.match(/@font-face\s*\{/g) ?? []).length
assert(faceCount === 2, `应有 2 个 @font-face(保底 + tech 链),实为 ${faceCount}`)
assert(css.includes('tech(color-svg)'), 'CSS 含 tech(color-svg)')
assert(css.includes('tech(color-colrv0)'), 'CSS 含 tech(color-colrv0)')
assert(/\.icon-home::before\s*\{\s*content:\s*"\\e002"/.test(css), 'CSS 含 .icon-home::before content')

// dts 多色标记
assert(result.dts.includes("export const colorIcons = {"), 'dts 含 colorIcons(对象形式)')
assert(/colorIcons = \{[^}]*"logo-color": true/.test(result.dts), 'colorIcons 含 logo-color: true')

console.log('=== SMOKE: mono + colrv0 + otsvg + tech() CSS ===')
console.log('glyphs  :', result.metadata.glyphs.map((g) => `${g.name}=U+${g.codepoint.toString(16).toUpperCase()}${g.color ? '*' : ''}`).join(', '))
console.log('flavors :', [...new Set(result.assets.map((a) => a.color))].join(', '))
for (const a of result.assets) console.log(`  asset : ${a.fileName}  (${a.source.length} B)`)
if (result.warnings.length) console.log('warnings:', result.warnings.map((w) => w.message).join('; '))
console.log('--- CSS tech() chain (the 2nd @font-face src) ---')
console.log(css.slice(css.indexOf('/* 现代'), css.indexOf('}\n', css.indexOf('/* 现代')) + 1))
console.log('\n✅ SMOKE OK')
