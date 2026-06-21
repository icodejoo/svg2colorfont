// bitmap-icons 多实例 + groupCache 集成自测(用 sharp 现造小 PNG)。Node 24 直接跑 .ts。
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

import { bitmapIcons } from "./src/generate-sheet.ts"

const root = resolve(process.cwd(), ".bitmap-test-tmp")
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
const hadHit = (): boolean => logs.some((l) => l.includes("命中缓存"))

const sharp = (await import("sharp")).default
mkdirSync("imgs", { recursive: true })
const png = (file: string, r: number, g: number, b: number) => sharp({ create: { width: 16, height: 16, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toFile(file)
await png("imgs/home.png", 255, 0, 0)
await png("imgs/star.png", 0, 255, 0)

const opts = (cache = true) => ({
  padding: 2,
  prefix: "icon", // 公共参数:合并进 item
  cache,
  items: [{ inputDir: "imgs", output: { image: "out/sheet.webp", style: "out/sheet.css", script: "out/sheet.ts", json: "out/sheet.json" } }],
})

await capture(() => bitmapIcons(opts()))
check(existsSync("out/sheet.webp") && existsSync("out/sheet.css") && existsSync("out/sheet.ts") && existsSync("out/sheet.json"), "all products (webp+css+ts+json) generated")
const cacheFile = resolve(root, ".cache.graphics/bitmap-icons-sheet.json")
check(existsSync(cacheFile), "per-instance cache file written (bitmap-icons-sheet.json)")
check(!hadHit(), "1st run = miss")

await capture(() => bitmapIcons(opts()))
check(hadHit(), "2nd run unchanged = HIT")

await png("imgs/extra.png", 0, 0, 255)
await capture(() => bitmapIcons(opts()))
check(!hadHit(), "added input = miss")

rmSync("out/sheet.css")
await capture(() => bitmapIcons(opts()))
check(!hadHit(), "deleted product = miss")
check(existsSync("out/sheet.css"), "deleted product restored")

await capture(() => bitmapIcons(opts(false)))
check(!hadHit(), "cache:false = miss")
check(existsSync("out/sheet.webp") && existsSync(cacheFile), "cache:false rebuilt products + cache")

process.chdir(resolve(root, ".."))
rmSync(root, { recursive: true, force: true })
console.log(`\n${fail === 0 ? "✅" : "❌"} bitmap-icons test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
