import { build as coreBuild } from '@colorfont/core'

import { buildGalleryHtml } from './gallery.ts'

import type { BuildResult, FontAsset, VitePluginColorfontOptions } from '@colorfont/core'

/** dev 期字体中间件挂载前缀。 */
const FONT_PREFIX = '/@colorfont/'

/**
 * 最小 Vite Plugin 形状(结构化,避免硬依赖 vite 类型;真实 vite 鸭子类型接受)。
 */
interface VitePluginLike {
  name: string
  configResolved?(config: { command?: string; base?: string }): void | Promise<void>
  buildStart?(): void | Promise<void>
  resolveId?(id: string): string | undefined
  load?(this: { emitFile?: (f: unknown) => string }, id: string): string | undefined | Promise<string | undefined>
  configureServer?(server: ViteDevServerLike): void
  generateBundle?(this: { emitFile: (f: { type: 'asset'; fileName: string; source: Uint8Array }) => void }): void
}

interface ViteDevServerLike {
  middlewares: { use(fn: (req: { url?: string }, res: ServerResponseLike, next: () => void) => void): void }
  watcher: { add(p: string): void; on(ev: string, fn: (file: string) => void): void }
  moduleGraph: { getModuleById(id: string): unknown; invalidateModule(m: unknown): void }
  ws: { send(payload: unknown): void }
}

interface ServerResponseLike {
  setHeader(k: string, v: string): void
  end(chunk?: Uint8Array): void
}

const CONTENT_TYPE: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
}

export default function colorfont(options: VitePluginColorfontOptions): VitePluginLike {
  const cssModuleId = options.cssModuleId ?? 'virtual:colorfont.css'
  const apiModuleId = options.apiModuleId ?? 'virtual:colorfont'
  const RESOLVED_CSS = '\0' + cssModuleId
  const RESOLVED_API = '\0' + apiModuleId
  const classPrefix = options.classPrefix ?? 'icon-'
  const baseClass = (options.baseSelector ?? '.icon').replace(/^\./, '')

  let result: BuildResult | undefined
  let ready: Promise<void> | undefined // 字体生成的进行中 Promise(dev 后台生成,按需 await)
  let isBuild = false
  let base = '/'

  const regenerate = async () => {
    // dev/serve 极速档:woff2 用 q9(比 q11 快 ~30×、体积 +6%)→ 格式与生产一致、dev/HMR 近乎瞬时;
    // 生产 build 用 woff2Quality(默认 11,最高压缩)。可用 devFast:false 关闭。
    if (!isBuild && (options as { devFast?: boolean }).devFast !== false) {
      result = await coreBuild({ ...options, woff2Quality: options.woff2Quality ?? 9 })
    } else {
      result = await coreBuild(options)
    }
  }

  const fontUrl = (a: FontAsset) =>
    isBuild ? `${base}colorfont/${a.fileName}` : `${FONT_PREFIX}${a.fileName}`

  // 虚拟模块 id 以 .css 结尾 → 返回真 CSS 文本,交给 Vite 的 CSS 管线
  // (build 提取成真 .css 文件 + 注入 <link>;dev 自带 CSS HMR)。字体 URL 用绝对路径,
  // Vite 不会改写绝对 url(),运行时由 emit 的资产 / dev 中间件提供。
  const cssModuleSource = () => result!.emitCss(fontUrl)

  const apiModuleSource = () => {
    const g = result!.metadata.glyphs
    const codepoints: Record<string, number> = {}
    const icons: Record<string, string> = {} // 图标名 → CSS 类名
    const colorIcons: Record<string, true> = {} // 对象形式:colorIcons[name] 判定彩色
    for (const x of g) {
      codepoints[x.name] = x.codepoint
      icons[x.name] = classPrefix + x.name
      if (x.color) colorIcons[x.name] = true
    }
    return (
      `export const codepoints = ${JSON.stringify(codepoints)};\n` +
      `export const icons = ${JSON.stringify(icons)};\n` +
      `export const baseName = ${JSON.stringify(baseClass)};\n` +
      `export const colorIcons = ${JSON.stringify(colorIcons)};\n` +
      `export function iconContent(name) { return String.fromCodePoint(codepoints[name]); }\n`
    )
  }

  return {
    name: 'vite-plugin-colorfont',

    configResolved(config) {
      isBuild = config.command === 'build'
      base = config.base ?? '/'
    },

    async buildStart() {
      // 启动字体生成。build 必须等(产物要进 bundle);dev 不 await → **不阻塞 vite 冷启动**,
      // 后台生成,首个 load()/字体请求再按需 await。
      ready = regenerate()
      if (isBuild) await ready
    },

    resolveId(id) {
      if (id === cssModuleId) return RESOLVED_CSS
      if (id === apiModuleId) return RESOLVED_API
      return undefined
    },

    async load(id) {
      if (id !== RESOLVED_CSS && id !== RESOLVED_API) return undefined
      await ready // dev:后台生成未完成则在此等待(冷启动已先放行)
      if (id === RESOLVED_CSS) return cssModuleSource()
      if (id === RESOLVED_API) return apiModuleSource()
      return undefined
    },

    configureServer(server) {
      // 内存供字体(不落盘)
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith(FONT_PREFIX)) return next()
        await ready // 后台生成未完成则等待
        const name = decodeURIComponent(url.slice(FONT_PREFIX.length).split('?')[0])
        const asset = result?.assets.find((a) => a.fileName === name)
        if (!asset) return next()
        res.setHeader('Content-Type', CONTENT_TYPE[asset.format] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(asset.source)
      })

      if (options.watch === false) return
      const dirs: string[] = Array.isArray(options.input) ? options.input : [options.input]
      dirs.forEach((d) => server.watcher.add(d))
      const onChange = async (file: string) => {
        if (!file.toLowerCase().endsWith('.svg')) return
        ready = regenerate()
        await ready
        for (const id of [RESOLVED_CSS, RESOLVED_API]) {
          const mod = server.moduleGraph.getModuleById(id)
          if (mod) server.moduleGraph.invalidateModule(mod)
        }
        server.ws.send({ type: 'full-reload' })
      }
      for (const ev of ['add', 'change', 'unlink']) server.watcher.on(ev, onChange)
    },

    generateBundle() {
      if (!result) return
      for (const a of result.assets) {
        this.emitFile({ type: 'asset', fileName: `colorfont/${a.fileName}`, source: a.source })
      }
      // emitDemo:额外产出独立 CSS + 类型化 API + 自包含画廊(file:// 直接打开、可复制)
      if ((options as { emitDemo?: boolean }).emitDemo) {
        const enc = new TextEncoder()
        const css = result.emitCss((a) => `./${a.fileName}`)
        this.emitFile({ type: 'asset', fileName: `colorfont/${options.fontName}.css`, source: enc.encode(css) })
        this.emitFile({ type: 'asset', fileName: `colorfont/${options.fontName}.ts`, source: enc.encode(result.dts) })
        this.emitFile({ type: 'asset', fileName: `colorfont/index.html`, source: enc.encode(buildGalleryHtml(result, options)) })
      }
    },
  }
}
