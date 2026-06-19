// 真实验收:用真正的 Vite(非 mock)跑一次 build + 一次 dev server。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as viteBuild, createServer } from 'vite'

import colorfont from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, 'app')
const coreFixtures = resolve(here, '../../core/fixtures')
const distDir = resolve(here, '.acc-dist')
const tmpOut = resolve(here, '.acc-tmp')

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

const pluginOpts = {
  input: coreFixtures,
  outDir: tmpOut,
  fontName: 'AccIcons',
  colorFormat: 'auto' as const,
  formats: ['woff2', 'woff'] as const,
}

await rm(distDir, { recursive: true, force: true })

// ============================ 真实 vite build ============================
await viteBuild({
  root: appRoot,
  configFile: false,
  logLevel: 'warn',
  base: '/',
  build: { outDir: distDir, emptyOutDir: true },
  plugins: [colorfont({ ...pluginOpts })],
})

const files = walk(distDir)
console.log('[build] dist files:', files.join(', '))
const fonts = files.filter((f) => f.startsWith('colorfont/') && f.endsWith('.woff2'))
assert(fonts.length >= 1, 'dist/colorfont 下有 woff2 字体')
assert(
  fonts.some((f) => /AccIcons\.(mono|colrv0|otsvg)\./.test(f)),
  '字体文件名含 flavor',
)
// 产物里(提取的 .css 或 JS)应含字体 URL 与 tech() 回退
const textFiles = files
  .filter((f) => /\.(css|js|html)$/.test(f))
  .map((f) => readFileSync(join(distDir, f), 'utf8'))
const allText = textFiles.join('\n')
assert(allText.includes('/colorfont/AccIcons'), '产物引用了 /colorfont 字体 URL')
assert(allText.includes('tech(color-svg)'), '产物含 tech() 回退 CSS')
const cssFiles = files.filter((f) => f.endsWith('.css'))
assert(cssFiles.length >= 1, '提取出独立 .css 文件')
console.log('[build] ✓ 字体 emit 到 dist/colorfont,CSS(含 tech 链)提取为', cssFiles.join(', '))

// ============================ 真实 vite dev server ============================
const server = await createServer({
  root: appRoot,
  configFile: false,
  logLevel: 'warn',
  server: { port: 5199, strictPort: false },
  plugins: [colorfont({ ...pluginOpts })],
})
await server.listen()
try {
  const addr = server.httpServer!.address()
  const port = typeof addr === 'object' && addr ? addr.port : 5199

  // 虚拟 CSS 模块应被真实 vite 解析+加载+转换
  const transformed = await server.transformRequest('virtual:colorfont.css')
  assert(transformed && transformed.code, 'dev 下虚拟 CSS 模块可被 transformRequest 解析')
  assert(transformed!.code.includes('/@colorfont/'), 'dev CSS 用 /@colorfont/ 字体路径')
  assert(transformed!.code.includes('tech(color-svg)'), 'dev CSS 含 tech() 回退')

  // 虚拟 API 模块
  const api = await server.transformRequest('virtual:colorfont')
  assert(api && api.code.includes('export const icons'), 'dev 下虚拟 API 模块导出 icons')

  // 经真实中间件 + HTTP 取字体字节
  // dev 极速档:dev 用 woff2 q9(格式与生产一致、比 woff 更快),中间件走 .woff2
  const m = transformed!.code.match(/\/@colorfont\/([^"'?\\]+\.woff2)/)
  assert(m, '能从 dev CSS 提取 woff2 路径')
  const res = await fetch(`http://localhost:${port}/@colorfont/${m![1]}`)
  assert(res.status === 200, `字体 HTTP 200(实为 ${res.status})`)
  assert(res.headers.get('content-type') === 'font/woff2', 'Content-Type=font/woff2')
  const bytes = new Uint8Array(await res.arrayBuffer())
  assert(bytes.length > 100 && String.fromCharCode(...bytes.slice(0, 4)) === 'wOF2', 'dev 返回有效 woff2')
  console.log(`[dev] ✓ 真实 server :${port} 经中间件返回 ${m![1]} (${bytes.length} B, wOF2)`)
} finally {
  await server.close()
}

console.log('\n✅ VITE ACCEPTANCE OK (真实 vite build 产物 + 真实 dev server 取字体)')
