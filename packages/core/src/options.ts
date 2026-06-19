import { isAbsolute, resolve } from 'node:path'

import type { ColorfontOptions, ResolvedOptions } from './types.ts'

const DEFAULT_PA_START = 0xe000

/** 填充默认值,规范化路径。 */
export function resolveOptions(o: ColorfontOptions): ResolvedOptions {
  if (!o.input) throw new Error('colorfont: 缺少 input')
  if (!o.outDir) throw new Error('colorfont: 缺少 outDir')
  if (!o.fontName) throw new Error('colorfont: 缺少 fontName')

  const unitsPerEm = o.unitsPerEm ?? 1000
  const ascender = o.ascender ?? Math.round(unitsPerEm * 0.8)
  const descender = o.descender ?? ascender - unitsPerEm
  const outDir = resolve(o.outDir)
  const input = (Array.isArray(o.input) ? o.input : [o.input]).map((p) =>
    isAbsolute(p) ? p : resolve(p),
  )

  return {
    input,
    outDir,
    fontName: o.fontName,
    fontFamily: o.fontFamily ?? o.fontName,
    unitsPerEm,
    ascender,
    descender,
    baseSelector: o.baseSelector ?? '.icon',
    classPrefix: o.classPrefix ?? 'icon-',
    colorFormat: o.colorFormat ?? 'auto',
    // formats 唯一来源:默认仅 woff2(所有现代浏览器);要 .woff 写 ['woff2','woff']
    formats: o.formats ?? ['woff2'],
    colrv0: o.colrv0 ?? true,
    woff2Quality: o.woff2Quality ?? 11,
    threads: o.threads ?? 'auto',
    // 缓存默认开启,放 node_modules/.cache/colorfont;false 关闭;{ dir } 自定义(可指向仓库内团队共享)
    cache:
      o.cache === false
        ? false
        : { dir: typeof o.cache === 'object' && o.cache.dir ? resolve(o.cache.dir) : resolve('node_modules/.cache/colorfont') },
    codepointsFile: o.codepointsFile
      ? resolve(o.codepointsFile)
      : resolve(outDir, 'codepoints.json'),
    paStart: o.paStart ?? DEFAULT_PA_START,
  }
}
