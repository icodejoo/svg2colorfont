// 把预编译 wasm 产物拷进 dist,随插件发布:
//   woff2(核心,所有构建都用 → 必需);colrv1(opt-in,colorFormat:'colrv1' 才用)。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function copyPkg(pkgDir, outDir, mainJs, label, essential) {
  if (!existsSync(resolve(pkgDir, mainJs))) {
    const msg = `[copy-wasm] 未找到 ${label} pkg(${mainJs})`
    if (essential) {
      console.error(`${msg} —— woff2 是核心必需!发布前请在 packages/woff2-wasm 构建 pkg(cargo build --target wasm32 + wasm-bindgen)。`)
      process.exit(1)
    }
    console.warn(`${msg},跳过(opt-in,未构建)。`)
    return
  }
  mkdirSync(outDir, { recursive: true })
  const base = mainJs.replace(/\.js$/, '')
  let n = 0
  for (const f of [mainJs, `${base}_bg.wasm`, 'package.json', `${base}.d.ts`]) {
    const src = resolve(pkgDir, f)
    if (existsSync(src)) {
      copyFileSync(src, resolve(outDir, f))
      n++
    }
  }
  console.log(`[copy-wasm] ${label}: 拷贝 ${n} 个文件 → dist/${label}`)
}

copyPkg(resolve(here, '../../woff2-wasm/pkg'), resolve(here, '../dist/woff2'), 'woff2_writer.js', 'woff2', true)
copyPkg(resolve(here, '../../colrv1-writer/pkg'), resolve(here, '../dist/colrv1'), 'colrv1_writer.js', 'colrv1', false)
