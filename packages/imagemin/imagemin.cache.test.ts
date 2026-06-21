// imagemin 新缓存集成自测:process → 命中skip → 配置变重压 → 强制报错(选项a)。
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { imagemin } from "./src/imagemin.ts"

const root = resolve(process.cwd(), ".imagemin-test-tmp")
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
process.chdir(root)

let pass = 0
let fail = 0
const check = (c: boolean, m: string): void => {
  if (c) pass++
  else {
    fail++
    console.error("  ✗", m)
  }
}

const cacheFile = resolve(root, ".cache/imagemin.json")
const base = { include: "**/*.{svg,png}", cacheFile, logStats: false, svgSize: 1024, svg: { multipass: true } }

writeFileSync("a.svg", `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="22" height="22" fill="#ff0000"/></svg>`)

let r = await imagemin([resolve("a.svg")], { ...base })
check(r.results[0].skipped === false, "svg 1st run = processed")

r = await imagemin([resolve("a.svg")], { ...base })
check(r.results[0].skipped === true, "svg 2nd run = cache HIT (skip)")

r = await imagemin([resolve("a.svg")], { ...base, svgSize: 512 })
check(r.results[0].skipped === false, "config change (svgSize) → configHash mismatch → reprocess all")

// throwable 默认 true:损坏图 → sharp 抛错 → imagemin 抛出中止
writeFileSync("bad.png", "not-a-real-png")
let threw = false
try {
  await imagemin([resolve("bad.png")], { ...base })
} catch {
  threw = true
}
check(threw, "throwable default(true): corrupt image throws")

// throwable:false → 不抛,告警并继续,结果含 error
let threw2 = false
let res2: Awaited<ReturnType<typeof imagemin>> | undefined
try {
  res2 = await imagemin([resolve("bad.png")], { ...base, throwable: false })
} catch {
  threw2 = true
}
check(!threw2, "throwable:false: corrupt image does NOT throw")
check(!!res2 && res2.results.some((x) => x.error), "throwable:false: error reported in results")

process.chdir(resolve(root, ".."))
rmSync(root, { recursive: true, force: true })
console.log(`\n${fail === 0 ? "✅" : "❌"} imagemin cache test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
