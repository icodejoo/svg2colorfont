import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import colorfont from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '../../core/fixtures')
const tmpOut = resolve(here, '../.test-out')

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
}

const baseOpts = {
  input: fixtures,
  outDir: tmpOut,
  fontName: 'PlugIcons',
  colorFormat: 'auto' as const,
  formats: ['woff2', 'woff'] as const,
}

// ============================ BUILD MODE ============================
{
  const p = colorfont({ ...baseOpts })
  await p.configResolved!({ command: 'build', base: '/' })
  await p.buildStart!.call({} as never)

  assert(p.resolveId!('virtual:colorfont.css') === '\0virtual:colorfont.css', 'resolveId css')
  assert(p.resolveId!('virtual:colorfont') === '\0virtual:colorfont', 'resolveId api')
  assert(p.resolveId!('something-else') === undefined, 'resolveId 其它返回 undefined')

  const cssMod = (await p.load!.call({} as never, '\0virtual:colorfont.css')) as string
  assert(cssMod.includes('@font-face'), 'css 模块返回真 CSS(@font-face)')
  assert(cssMod.includes('tech(color-svg)'), 'css 含 tech(color-svg)')
  assert(cssMod.includes('/colorfont/PlugIcons.'), 'build 模式字体 URL 走 /colorfont/')

  const apiMod = (await p.load!.call({} as never, '\0virtual:colorfont')) as string
  assert(apiMod.includes('export const icons ='), 'api 模块导出 icons')
  assert(apiMod.includes('export const colorIcons'), 'api 模块导出 colorIcons')

  const emitted: { type: string; fileName: string; source: Uint8Array }[] = []
  p.generateBundle!.call({ emitFile: (f: never) => emitted.push(f) })
  const fonts = emitted.filter((f) => f.fileName.startsWith('colorfont/'))
  assert(fonts.length >= 2, `应 emit 多个字体资产,实为 ${fonts.length}`)
  assert(
    fonts.some((f) => f.fileName.endsWith('.woff2') && f.source.length > 100),
    'emit 了非空 woff2',
  )
  console.log('[build] emitted:', fonts.map((f) => f.fileName).join(', '))
}

// ============================ DEV MODE ============================
{
  const p = colorfont({ ...baseOpts })
  await p.configResolved!({ command: 'serve', base: '/' })
  await p.buildStart!.call({} as never)

  // 从 dev CSS 模块里取一个字体 URL
  const cssMod = (await p.load!.call({} as never, '\0virtual:colorfont.css')) as string
  assert(cssMod.includes('/@colorfont/'), 'dev 模式字体 URL 走 /@colorfont/')
  // dev 极速档:dev 用 woff2 q9(格式与生产一致、比 woff 更快),仍引用 .woff2
  const m = cssMod.match(/\/@colorfont\/([^"'?)]+\.woff2)/)
  assert(m, '能从 dev CSS 提取一个 woff2 字体路径')
  const fontPath = '/@colorfont/' + m![1]

  // mock dev server
  let middleware: ((req: { url?: string }, res: ResMock, next: () => void) => void) | undefined
  const watched: string[] = []
  const events: string[] = []
  const server = {
    middlewares: { use: (fn: typeof middleware) => (middleware = fn) },
    watcher: { add: (d: string) => watched.push(d), on: (ev: string) => events.push(ev) },
    moduleGraph: { getModuleById: () => null, invalidateModule: () => {} },
    ws: { send: () => {} },
  }
  p.configureServer!(server as never)
  assert(middleware, 'configureServer 注册了中间件')
  assert(watched.length === 1, 'watcher 监听了图标目录')
  assert(events.includes('change'), 'watcher 注册了 change 事件')

  // 模拟字体请求
  interface ResMock {
    headers: Record<string, string>
    body?: Uint8Array
    setHeader(k: string, v: string): void
    end(chunk?: Uint8Array): void
  }
  const res: ResMock = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(chunk) {
      this.body = chunk
    },
  }
  let nextCalled = false
  await middleware!({ url: fontPath }, res, () => (nextCalled = true))
  assert(!nextCalled, '字体请求被中间件处理(未 next)')
  assert(res.body && res.body.length > 100, '中间件返回非空字体字节')
  assert(res.headers['Content-Type'] === 'font/woff2', 'Content-Type 为 font/woff2')

  // 非字体请求应 next
  let passed = false
  await middleware!({ url: '/index.html' }, res, () => (passed = true))
  assert(passed, '非字体请求被放行')

  console.log('[dev] served:', fontPath, `(${res.body!.length} B)`, 'ct=' + res.headers['Content-Type'])
}

console.log('\n✅ VITE-PLUGIN TEST OK (build emit + dev middleware + virtual modules)')
