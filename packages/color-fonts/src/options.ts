import { isAbsolute, resolve } from 'node:path'

import type { ColorfontItem, ResolvedOptions } from './types.ts'

const DEFAULT_PA_START = 0xe000

/** 填充默认值,规范化路径(单字体实例)。 */
export function resolveOptions(o: ColorfontItem): ResolvedOptions {
  if (!o.sources) throw new Error('colorfont: 缺少 sources')
  if (!o.output?.dir) throw new Error('colorfont: 缺少 output.dir')
  if (!o.output?.fontName) throw new Error('colorfont: 缺少 output.fontName')
  if (!o.output?.name) throw new Error('colorfont: 缺少 output.name')

  const unitsPerEm = o.unitsPerEm ?? 1000
  const ascender = o.ascender ?? Math.round(unitsPerEm * 0.8)
  const descender = o.descender ?? ascender - unitsPerEm
  const dir = resolve(o.output.dir)
  const sources = (Array.isArray(o.sources) ? o.sources : [o.sources]).map((p) =>
    isAbsolute(p) ? p : resolve(p),
  )
  const name = o.output.name

  return {
    sources,
    dir,
    fontName: o.output.fontName,
    name,
    // 脚本入口默认产 .ts;ts:false 产等价 .js(无任何 TS 类型)。
    ts: o.output.ts !== false,
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
    // 缓存默认开启(布尔);具体缓存文件 + 命中/复用由 buildAndWrite 的 groupCache 持有。false 关闭。
    cache: o.cache !== false,
    // 码位锁固定派生 = `<dir>/<name>.codepoints.json`(不可配置;多字体共用 dir 时按 name 唯一)。建议 commit。
    codepointsFile: resolve(dir, `${name}.codepoints.json`),
    paStart: o.paStart ?? DEFAULT_PA_START,
  }
}
