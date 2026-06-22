// bitmap-icons 多实例 + groupCache 集成自测(用 sharp 现造小 PNG)。Node 24 直接跑 .ts。
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"

import { autoGenBanner } from "@codejoo/utils/banner"

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

// 新 shape:output: { dir, name, ts?, format? };四类产物全部恒产,路径全派生。
const opts = (cache = true) => ({
  padding: 2,
  prefix: "icon", // 公共参数:合并进 item
  cache,
  items: [{ sources: "imgs", output: { dir: "out", name: "sheet" } }], // format 默认 webp、ts 默认 true
})

await capture(() => bitmapIcons(opts()))
check(existsSync("out/sheet.webp") && existsSync("out/sheet.css") && existsSync("out/sheet.ts") && existsSync("out/sheet.json"), "all products (webp+css+ts+json) generated")
// 恒产:json 不再可选,必产。
check(existsSync("out/sheet.json"), "json always emitted (no longer optional)")
// format 默认 webp 决定扩展名(非由 image 扩展名)。
check(existsSync("out/sheet.webp") && !existsSync("out/sheet.png"), "format default webp decides extension")
// banner 校验:css 首部含 block 注释 banner;ts 入口含 line 注释 banner。
check(readFileSync("out/sheet.css", "utf8").startsWith(autoGenBanner("block")), "banner: css 首部含 block 注释 banner")
check(readFileSync("out/sheet.ts", "utf8").includes(autoGenBanner("line").trim()), "banner: ts 含 line 注释 banner")
// ts:true 默认 → .ts 产 IconName 字符串联合(供代码提示)。
check(readFileSync("out/sheet.ts", "utf8").includes("export type IconName ="), "ts:true emits IconName union")
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

// ── 多源目录合并成一张图 ──
// 两个独立源目录 imgs-a / imgs-b,各放一张图 → 合并打进同一张 sheet,manifest 含两者。
mkdirSync("imgs-a", { recursive: true })
mkdirSync("imgs-b", { recursive: true })
await png("imgs-a/alpha.png", 12, 34, 56)
await png("imgs-b/beta.png", 78, 90, 120)
const multiOpts = {
  padding: 2,
  prefix: "icon",
  items: [{ sources: ["imgs-a", "imgs-b"], output: { dir: "out-multi", name: "sheet" } }],
}
await capture(() => bitmapIcons(multiOpts))
check(existsSync("out-multi/sheet.webp") && existsSync("out-multi/sheet.json"), "multi-source: products generated")
const multiManifest = JSON.parse(readFileSync("out-multi/sheet.json", "utf8")) as { frames: Record<string, unknown> }
const multiNames = Object.keys(multiManifest.frames)
check(multiNames.includes("alpha") && multiNames.includes("beta"), "multi-source: both dirs merged into one sheet")

// ── format: 'png' + ts: false ──
// format:png → 图集扩展名为 .png(非 .webp);ts:false → 产 .js 且无 export type。
const pngJsOpts = {
  prefix: "icon",
  items: [{ sources: "imgs-a", output: { dir: "out-pngjs", name: "sheet", format: "png" as const, ts: false } }],
}
await capture(() => bitmapIcons(pngJsOpts))
check(existsSync("out-pngjs/sheet.png") && !existsSync("out-pngjs/sheet.webp"), "format:png decides .png extension")
check(existsSync("out-pngjs/sheet.js") && !existsSync("out-pngjs/sheet.ts"), "ts:false emits .js (not .ts)")
check(existsSync("out-pngjs/sheet.css") && existsSync("out-pngjs/sheet.json"), "format:png + ts:false: css & json still always emitted")
const jsSrc = readFileSync("out-pngjs/sheet.js", "utf8")
check(!jsSrc.includes("export type"), "ts:false .js has no `export type`")
check(jsSrc.includes("iconsImage") && jsSrc.includes("iconsName"), "ts:false .js still has runtime iconsImage/iconsName")

// ── 空输入 + 清理陈旧产物 ──
// 捕获 warn,判定是否抛出
let warns: string[] = []
const origWarn = console.warn
const captureWarn = async (fn: () => Promise<void>): Promise<{ threw: boolean }> => {
  warns = []
  console.warn = (...a: unknown[]) => {
    warns.push(a.join(" "))
  }
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  } finally {
    console.warn = origWarn
  }
  return { threw }
}
const hadWarn = (kw: string): boolean => warns.some((l) => l.includes(kw))

// (c) 先有一张 sheet(此时 out/ 与 cache 已存在),清空源目录重跑 → 旧产物 + 缓存 json 被清理。
rmSync("out", { recursive: true, force: true })
await capture(() => bitmapIcons(opts())) // 重建一张全新 sheet + cache
check(existsSync("out/sheet.webp") && existsSync(cacheFile), "fresh sheet + cache before emptying")
rmSync("imgs", { recursive: true, force: true })
mkdirSync("imgs", { recursive: true }) // 空源目录
const r3 = await captureWarn(() => bitmapIcons(opts()))
check(r3.threw, "(a) empty input default throws")
check(!existsSync("out/sheet.webp") && !existsSync("out/sheet.css") && !existsSync("out/sheet.ts") && !existsSync("out/sheet.json"), "(c) stale products cleaned on empty input")
check(!existsSync(cacheFile), "(c) stale cache json cleaned on empty input")

// (b) throwable:false → warn 不抛且返回。
const optsNoThrow = { ...opts(), items: [{ ...opts().items[0], throwable: false }] }
const r5 = await captureWarn(() => bitmapIcons(optsNoThrow))
check(!r5.threw, "(b) throwable:false does not throw")
check(hadWarn("无可打包图片"), "(b) throwable:false warns")

process.chdir(resolve(root, ".."))
rmSync(root, { recursive: true, force: true })
console.log(`\n${fail === 0 ? "✅" : "❌"} bitmap-icons test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
