// TTF(glyf)→ WOFF2,用 ttf2woff2(纯 Rust)→ wasm,**可调 brotli 质量 1..=11**。
// 替代固定 q11 的 woff2-encoder:同 q11 体积一致还略快,q9 比 q11 快 ~31×(体积 +6%)。
// 无损透传所有表(含 COLR/CPAL/'SVG ' 彩色表)。glyf 字体(本引擎已全 glyf)。
import { pathToFileURL } from 'node:url'

interface Woff2Module {
  ttf_to_woff2(data: Uint8Array, quality: number): Uint8Array
}

let cached: Woff2Module | undefined

function pick(m: Record<string, unknown>): Woff2Module | null {
  const mod = (typeof m.ttf_to_woff2 === 'function' ? m : (m.default as Record<string, unknown> | undefined)) as
    | Woff2Module
    | undefined
  return mod && typeof mod.ttf_to_woff2 === 'function' ? mod : null
}

async function tryImport(spec: string): Promise<Woff2Module | null> {
  try {
    return pick((await import(spec)) as Record<string, unknown>)
  } catch {
    return null
  }
}

/**
 * 惰性加载 woff2-writer wasm(wasm-bindgen --target nodejs)。候选:
 *   ① env COLORFONT_WOFF2_WASM(路径或包名);② 随插件发布的 ./woff2/woff2_writer.js;
 *   ③ monorepo 开发期相对路径;④ 包名。
 */
async function loadWasm(): Promise<Woff2Module> {
  if (cached) return cached
  const candidates: string[] = []
  const env = process.env.COLORFONT_WOFF2_WASM
  if (env) candidates.push(/[\\/]/.test(env) ? pathToFileURL(env).href : env)
  try {
    candidates.push(new URL('./woff2/woff2_writer.js', import.meta.url).href)
  } catch {
    /* import.meta.url 不可用 */
  }
  try {
    candidates.push(new URL('../../../woff2-wasm/pkg/woff2_writer.js', import.meta.url).href)
  } catch {
    /* 忽略 */
  }
  candidates.push('woff2-writer')
  for (const c of candidates) {
    const m = await tryImport(c)
    if (m) {
      cached = m
      return m
    }
  }
  throw new Error(
    'woff2 wasm 未找到。请设环境变量 COLORFONT_WOFF2_WASM 指向 woff2_writer.js,或在 packages/woff2-wasm 构建 pkg。',
  )
}

/** TTF(glyf)→ WOFF2。quality 1..=11(默认 11;dev 用 9 提速)。无损透传彩色表。 */
export async function toWoff2(ttf: Uint8Array, quality = 11): Promise<Uint8Array> {
  const mod = await loadWasm()
  const q = Math.max(1, Math.min(11, Math.round(quality)))
  return mod.ttf_to_woff2(ttf, q)
}
