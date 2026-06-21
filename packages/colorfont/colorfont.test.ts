// colorfont 多实例 + groupCache + 实物落盘 集成自测(用 fixtures/)。Node 24 直接跑 .ts。
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { colorfonts } from "./src/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "fixtures") // 源图标(只读)

const root = resolve(here, ".colorfont-test-tmp")
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

let logs: string[] = []
const origLog = console.log
const capture = async (fn: () => Promise<void>): Promise<void> => {
  logs = []
  console.log = (...a: unknown[]) => {
    logs.push(a.join(" "))
  }
  try {
    await fn()
  } finally {
    console.log = origLog
  }
}
const hitCount = (): number => logs.filter((l) => l.includes("命中缓存")).length

const opts = (cache = true) => ({
  colorFormat: "auto" as const, // 公共参数:合并进每个 item
  formats: ["woff2"] as ("woff2" | "woff" | "ttf")[],
  cache,
  items: [
    { input: fixtures, outDir: "out/a", fontName: "AIcons" },
    { input: fixtures, outDir: "out/b", fontName: "BIcons", colorFormat: "mono" as const }, // 覆盖公共
  ],
})

await capture(() => colorfonts(opts()))
check(
  readdirSync("out/a").some((f) => f.endsWith(".woff2")),
  "A: woff2 font written",
)
check(existsSync("out/a/AIcons.css") && existsSync("out/a/AIcons.ts"), "A: real .css + .ts written to outDir")
check(existsSync("out/a/AIcons.codepoints.json"), "A: codepoints lock written")
check(existsSync("out/b/BIcons.css") && readdirSync("out/b").some((f) => f.endsWith(".woff2")), "B (mono): products written")
check(hitCount() === 0, "1st run = miss (both)")

await capture(() => colorfonts(opts()))
check(hitCount() === 2, "2nd run unchanged = HIT (both instances)")

// 删 A 的产物 → A miss、B 仍 hit
rmSync("out/a/AIcons.css")
await capture(() => colorfonts(opts()))
check(hitCount() === 1, "deleted A product → A miss, B hit")
check(existsSync("out/a/AIcons.css"), "A css restored")

// cache:false → 重建 + 保留码位锁(非缓存产物)
await capture(() => colorfonts(opts(false)))
check(hitCount() === 0, "cache:false = miss (both)")
check(existsSync("out/a/AIcons.codepoints.json"), "cache:false keeps codepoints lock (state, not cache product)")

process.chdir(here)
rmSync(root, { recursive: true, force: true })
console.log(`\n${fail === 0 ? "✅" : "❌"} colorfont test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
