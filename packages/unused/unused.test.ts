// @codejoo/unused 自测:vite 模块图检测 + 静态检测(findUnused)+ 排除 + include/exclude 删除闸。Node 24 直接跑 .ts。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { findUnused, removeUnused, unusedVite } from "./src/index.ts"

import type { UnusedManifest } from "./src/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const tmp = resolve(here, ".unused-test-tmp")

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) passed++
  else {
    failed++
    console.error("  ✗", msg)
  }
}

type Hook = (...a: unknown[]) => unknown
const call = (h: unknown, ...a: unknown[]): unknown => (h as Hook)(...a)
const rr = (p: string): string => relative(process.cwd(), p).replace(/\\/g, "/")

async function main(): Promise<void> {
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(resolve(tmp, "icons"), { recursive: true })
  writeFileSync(resolve(tmp, "used.png"), "u")
  writeFileSync(resolve(tmp, "orphan.png"), "o")
  writeFileSync(resolve(tmp, "icons", "keep.svg"), "<svg/>") // 模拟引擎输入(排除)
  // 源文件:仅引用 used.png(供静态检测 findUnused 标记已用)。
  writeFileSync(resolve(tmp, "app.ts"), `import img from "./used.png"\nconsole.log(img)\n`)

  const manifestPath = resolve(tmp, "manifest.json")
  // 与伞插件 engineExcludes 同形的「引擎输入目录」排除。
  const iconsExclude = `${rr(resolve(tmp, "icons"))}/**`

  // ── A) vite 模块图检测(直接驱动钩子) ──
  const plugin = unusedVite({ root: tmp, ext: [".png", ".svg"], output: manifestPath, exclude: [iconsExclude] })
  call(plugin.configResolved, { command: "build" })
  call(plugin.load, resolve(tmp, "used.png")) // 仅 used.png 进入模块图
  await call(plugin.buildEnd)
  let table = JSON.parse(readFileSync(manifestPath, "utf8")) as UnusedManifest
  assert(table.mode === "vite", "vite 模式标记")
  assert(table.unused.some((p) => p.endsWith("orphan.png")), "vite: orphan.png 被判未使用")
  assert(!table.unused.some((p) => p.endsWith("used.png")), "vite: used.png(已引用)不在清单")
  assert(!table.unused.some((p) => p.endsWith("keep.svg")), "vite: icons/keep.svg(已排除)不在清单")

  // ── B) 静态检测 findUnused(不依赖 vite) ──
  await findUnused({
    root: tmp,
    ext: [".png", ".svg"],
    exclude: [iconsExclude],
    sources: ["**/*.ts"],
    sourceRoot: tmp,
    output: manifestPath,
  })
  table = JSON.parse(readFileSync(manifestPath, "utf8")) as UnusedManifest
  assert(table.mode === "scan", "scan 模式标记")
  assert(table.unused.some((p) => p.endsWith("orphan.png")), "scan: orphan.png 被判未使用")
  assert(!table.unused.some((p) => p.endsWith("used.png")), "scan: used.png(被源码引用)不在清单")
  assert(!table.unused.some((p) => p.endsWith("keep.svg")), "scan: icons/keep.svg(已排除)不在清单")

  // ── C) 删除端 include/exclude 安全闸 ──
  // 手写一张含两项的表,exclude 命中者必须保留。
  writeFileSync(resolve(tmp, "del-a.png"), "a")
  writeFileSync(resolve(tmp, "del-b.png"), "b")
  const aRel = rr(resolve(tmp, "del-a.png"))
  const bRel = rr(resolve(tmp, "del-b.png"))
  writeFileSync(manifestPath, JSON.stringify({ mode: "scan", root: rr(tmp), unused: [aRel, bRel] }))

  await removeUnused({ manifest: manifestPath, dryRun: true })
  assert(existsSync(resolve(tmp, "del-a.png")) && existsSync(resolve(tmp, "del-b.png")), "dry-run 不实际删除")

  const res = await removeUnused({ manifest: manifestPath, exclude: [bRel] })
  assert(res.removed.some((p) => p.endsWith("del-a.png")), "include/exclude: del-a 删除")
  assert(res.skipped.some((p) => p.endsWith("del-b.png")), "include/exclude: del-b 被 exclude 跳过")
  assert(!existsSync(resolve(tmp, "del-a.png")), "del-a.png 已删除")
  assert(existsSync(resolve(tmp, "del-b.png")), "del-b.png 因 exclude 保留")

  rmSync(tmp, { recursive: true, force: true })

  if (failed === 0) console.log(`\n✅ @codejoo/unused test: ${passed} passed, 0 failed`)
  else {
    console.error(`\n❌ @codejoo/unused test: ${passed} passed, ${failed} failed`)
    process.exit(1)
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
