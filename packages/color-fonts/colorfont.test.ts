// colorfont 多实例 + groupCache + 实物落盘 集成自测(用 fixtures/)。Node 24 直接跑 .ts。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import opentype from "opentype.js"

import { autoGenBanner } from "@codejoo/utils/banner"

import { build, buildAndWrite, colorfonts } from "./src/index.ts"
import { assignCodepoints } from "./src/codepoints/lockfile.ts"

import type { CodepointMap } from "./src/types.ts"

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
    { sources: fixtures, output: { dir: "out/a", fontName: "AIcons", name: "AIcons" } },
    { sources: fixtures, output: { dir: "out/b", fontName: "BIcons", name: "BIcons" }, colorFormat: "mono" as const }, // 覆盖公共
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

// ───────── 公开元数据清单(恒产):{dir}/{name}.json,与码位锁并存且职责不同 ─────────
check(existsSync("out/a/AIcons.json"), "manifest: {dir}/{name}.json 产出")
// 清单与码位锁两文件并存(文件名不同、职责不同:清单=派生产物,锁=提交状态)
check(existsSync("out/a/AIcons.json") && existsSync("out/a/AIcons.codepoints.json"), "manifest: 清单与码位锁并存(不冲突)")
const manifest = JSON.parse(readFileSync("out/a/AIcons.json", "utf8")) as {
  fontName: string
  unitsPerEm: number
  glyphs: { name: string; codepoint: number; color: boolean; flavors: string[] }[]
}
check(manifest.fontName === "AIcons" && typeof manifest.unitsPerEm === "number", "manifest: 含 fontName + unitsPerEm")
check(Array.isArray(manifest.glyphs) && manifest.glyphs.length > 0, "manifest: glyphs 为非空数组")
// 字段齐全:name(string) / codepoint(十进制 int) / color(bool) / flavors(非空 string[])
check(
  manifest.glyphs.every(
    (g) =>
      typeof g.name === "string" &&
      Number.isInteger(g.codepoint) &&
      typeof g.color === "boolean" &&
      Array.isArray(g.flavors) &&
      g.flavors.length > 0,
  ),
  "manifest: 每个 glyph 字段齐全(name/codepoint/color/flavors)",
)
// 清单的图标集合应与本次构建实际产出一致(= fixtures 的图标数,见下方 fxNames)
// 且清单不含码位锁特有的 present/since 等「状态」字段(纯对外产物)。
check(
  manifest.glyphs.every((g) => !("present" in g) && !("since" in g)),
  "manifest: 不含码位锁的 present/since 状态字段(职责区分)",
)
// 清单是纯 JSON,不带 autoGenBanner(JSON 不支持注释)
check(readFileSync("out/a/AIcons.json", "utf8").trimStart().startsWith("{"), "manifest: 纯 JSON,无注释 banner")

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

// ───────── assignCodepoints:PUA 溢出 + 耗尽(纯函数,直接 unit 测) ─────────
// PUA 区间(与 lockfile.ts 一致):BMP 0xE000–0xF8FF(6400)、PUA-A 0xF0000–0xFFFFD、PUA-B 0x100000–0x10FFFD。
const inPua = (cp: number): boolean =>
  (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)

// 构造 >6400 个图标名 → BMP PUA(6400 个)填满后必跨入补充平面 PUA-A(0xF0000+)。
const N = 6500
const overflowNames = Array.from({ length: N }, (_, i) => `icon-${i}`)
const overflowLock: CodepointMap = { version: 1, paFirst: 0xe000, glyphs: {} }
const cpMap = assignCodepoints(overflowNames, overflowLock, "2026-06-22")
const cps = overflowNames.map((n) => cpMap[n])
check(cps.length === N && new Set(cps).size === N, "PUA: 全部图标分到唯一码位")
check(cps.every(inPua), "PUA: 全部码位落在 PUA 区间内(不越界到非 PUA/代理区)")
check(cps.some((cp) => cp > 0xf8ff), "PUA: 超过 6400 个后有码位 > 0xF8FF(BMP PUA 填满)")
// 超过 BMP PUA 的码位必落入补充平面 PUA-A(0xF0000+),不会落到 0xF900–0xEFFFF 的非 PUA 间隙。
check(
  cps.filter((cp) => cp > 0xf8ff).every((cp) => cp >= 0xf0000),
  "PUA: 溢出码位落入补充平面 PUA-A(0xF0000+),跳过非 PUA 间隙",
)
check(cps.filter((cp) => cp >= 0xf0000).length === N - 6400, "PUA: BMP 填满 6400 后其余进 PUA-A")

// 耗尽:把 lock 预置到 PUA-B 末尾(0x10FFFD),再分配 2 个新图标 → 第 2 个无可用码位 → throw。
const exhaustLock: CodepointMap = {
  version: 1,
  paFirst: 0xe000,
  glyphs: { last: { codepoint: 0x10fffc, present: true } }, // PUA-B 倒数第二个
}
let puaThrew = false
try {
  assignCodepoints(["last", "one-more", "overflow"], exhaustLock, "2026-06-22")
} catch {
  puaThrew = true
}
check(puaThrew, "PUA: 三段全部耗尽时 assignCodepoints 抛错(绝不静默越界)")

// ───────── 空输入:build() 默认抛错;throwable:false 仅告警不抛 ─────────
const emptyDir = resolve(root, "empty-icons")
mkdirSync(emptyDir, { recursive: true })
let emptyThrew = false
try {
  await build({ sources: [emptyDir], output: { dir: resolve(root, "out/empty"), fontName: "Empty", name: "Empty" } })
} catch {
  emptyThrew = true
}
check(emptyThrew, "空输入: build() 默认抛错(走 throwable)")

// buildAndWrite 同样抛错(经 groupCache.regenerate 向上传播)
let emptyWriteThrew = false
try {
  await buildAndWrite({ sources: [emptyDir], output: { dir: resolve(root, "out/empty"), fontName: "Empty", name: "Empty" } })
} catch {
  emptyWriteThrew = true
}
check(emptyWriteThrew, "空输入: buildAndWrite() 默认抛错")

// throwable:false → runner 告警续跑、不抛
let throwableFalseOk = true
const origWarn = console.warn
const warnLogs: string[] = []
console.warn = (...a: unknown[]) => {
  warnLogs.push(a.join(" "))
}
try {
  await colorfonts({ items: [{ sources: [emptyDir], output: { dir: resolve(root, "out/empty"), fontName: "Empty", name: "Empty" }, throwable: false }] })
} catch {
  throwableFalseOk = false
} finally {
  console.warn = origWarn
}
check(throwableFalseOk, "空输入 + throwable:false: 不抛,告警续跑")
check(warnLogs.some((l) => l.includes("生成失败")), "空输入 + throwable:false: 输出告警")

// ───────── 字体结构校验:落盘 TTF 用 opentype.js parse,断言 glyph/cmap/彩色表 ─────────
// 用 ttf(opentype.js 能 parse;woff2 是 brotli,opentype.js 不解码)。fixtures 含 5 图标:
//   mono: arrow-left/home/star;color: badge-grad(渐变)/logo-color(多 fill) → auto 产 mono+colrv0+otsvg。
const fxNames = readdirSync(fixtures)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.replace(/\.svg$/, ""))
const iconCount = fxNames.length

let structResult!: Awaited<ReturnType<typeof build>>
await capture(() =>
  build({ sources: fixtures, output: { dir: "out/struct", fontName: "Struct", name: "Struct" }, colorFormat: "auto", formats: ["ttf"] }).then(
    async (r) => {
      structResult = r
      const { writeFile, mkdir } = await import("node:fs/promises")
      await mkdir("out/struct", { recursive: true })
      for (const a of r.assets) await writeFile(resolve("out/struct", a.fileName), a.source)
      // 落盘 css/ts 供 banner 校验
      await writeFile(resolve("out/struct", "Struct.css"), r.emitCss((a) => `./${a.fileName}`))
      await writeFile(resolve("out/struct", "Struct.ts"), r.dts)
    },
  ),
)

// mono 档 = glyf 轮廓字体,parse 它断言 glyph 数与 cmap。
const monoTtf = readdirSync("out/struct").find((f) => f.endsWith(".ttf") && !/colr|otsvg|svg/i.test(f))
check(!!monoTtf, "struct: mono ttf 落盘")
// Buffer.buffer 可能是共享池;用 byteOffset/byteLength 精确切出本文件字节的 ArrayBuffer。
const monoBuf = readFileSync(resolve("out/struct", monoTtf!))
const font = opentype.parse(monoBuf.buffer.slice(monoBuf.byteOffset, monoBuf.byteOffset + monoBuf.byteLength))
// glyph 数 == 图标数 + .notdef(opentype.js 含 index 0 的 .notdef)。
check(
  font.glyphs.length === iconCount + 1,
  `struct: glyph 数 == 图标数+notdef(期望 ${iconCount + 1},实得 ${font.glyphs.length})`,
)
// cmap 含每个分配码位:用 build() 返回的码位锁,断言每个 present 码位在字体 cmap 里有 glyph。
const lock = structResult.codepoints
let allMapped = true
for (const [name, e] of Object.entries(lock.glyphs)) {
  if (!e.present) continue
  const g = font.charToGlyph(String.fromCodePoint(e.codepoint))
  if (!g || g.index === 0) {
    allMapped = false
    console.error(`    cmap 缺码位: ${name} U+${e.codepoint.toString(16)}`)
  }
}
check(allMapped, "struct: cmap 含每个已分配码位")

// 多色档:COLRv0 档的 ttf 应含 COLR+CPAL 表;OT-SVG 档应含 'SVG ' 表。
// opentype.js 不暴露任意表,直接在原始字节里查 4-byte table tag(sfnt 表目录里出现即可)。
const hasTag = (buf: Buffer, tag: string): boolean => buf.includes(Buffer.from(tag, "latin1"))
const colrTtf = readdirSync("out/struct").find((f) => /colrv0|colr/i.test(f) && f.endsWith(".ttf"))
const svgTtf = readdirSync("out/struct").find((f) => /otsvg|svg/i.test(f) && f.endsWith(".ttf"))
check(!!colrTtf, "struct: COLRv0 档 ttf 产出")
if (colrTtf) {
  const b = readFileSync(resolve("out/struct", colrTtf))
  check(hasTag(b, "COLR") && hasTag(b, "CPAL"), "struct: COLRv0 档含 COLR+CPAL 表")
}
check(!!svgTtf, "struct: OT-SVG 档 ttf 产出")
if (svgTtf) {
  const b = readFileSync(resolve("out/struct", svgTtf))
  check(hasTag(b, "SVG "), "struct: OT-SVG 档含 'SVG ' 表")
}

// ───────── banner 校验:css→block、ts→line、svg(sprite 不在本引擎,这里测 css/ts) ─────────
const cssText = readFileSync("out/struct/Struct.css", "utf8")
const tsText = readFileSync("out/struct/Struct.ts", "utf8")
check(cssText.startsWith(autoGenBanner("block")), "banner: css 首部含 block 注释 banner")
check(tsText.startsWith(autoGenBanner("line")), "banner: ts 首部含 line 注释 banner")

// ───────── 产物命名:字体 = {name}.{flavor}.{format}(flavor 段必须保留,否则多档同名覆盖) ─────────
const assetNamePat = /^Struct\.(mono|colrv0|otsvg|colrv1)\.(woff2|woff|ttf)$/
check(
  structResult.assets.length > 0 && structResult.assets.every((a) => assetNamePat.test(a.fileName)),
  "naming: 字体文件名为 {name}.{flavor}.{format}",
)
// auto 含彩色 → 至少应有 mono + colrv0(不同 flavor 段)→ 文件名彼此不同,不互相覆盖。
check(
  new Set(structResult.assets.map((a) => a.fileName)).size === structResult.assets.length,
  "naming: 多档产物文件名互不相同(flavor 段生效)",
)

// ───────── ts:false → 产 .js 且内容无任何 TS 类型;ts:true(默认)→ .ts 含 IconName ─────────
await capture(() =>
  buildAndWrite({ sources: fixtures, output: { dir: "out/js", fontName: "JsIcons", name: "JsIcons", ts: false }, colorFormat: "auto", formats: ["woff2"] }).then(() => undefined),
)
check(existsSync("out/js/JsIcons.js"), "ts:false: 产 .js 脚本入口")
check(!existsSync("out/js/JsIcons.ts"), "ts:false: 不产 .ts")
const jsText = readFileSync("out/js/JsIcons.js", "utf8")
check(!jsText.includes("export type") && !jsText.includes("IconName"), "ts:false: .js 无 export type / IconName(无 TS 类型)")
check(!jsText.includes("as const satisfies") && !jsText.includes(": string"), "ts:false: .js 无 as const satisfies / 参数类型注解")
check(jsText.includes("export const codepoints") && jsText.includes("export const icons") && jsText.includes("export const baseName") && jsText.includes("export const colorIcons") && jsText.includes("export function iconContent"), "ts:false: .js 运行时导出齐全")
check(jsText.startsWith(autoGenBanner("line")), "ts:false: .js 首部仍含 line banner")
check(existsSync("out/js/JsIcons.codepoints.json"), "ts:false: 码位锁固定派生为 {dir}/{name}.codepoints.json")
check(tsText.includes("export type IconName") && tsText.includes("as const satisfies"), "ts:true(默认): .ts 含 IconName 联合 + satisfies")

// ───────── configHash 失效:改 woff2Quality 后缓存未命中且 .css 内容随之刷新(防缓存假绿) ─────────
// 用 buildAndWrite + groupCache,代表产物 .css。改 classPrefix(进 configHash 且改变 css 内容)→ 必 miss 且 css 变。
const hashDir = "out/hash"
const baseHashOpts = { sources: fixtures, output: { dir: hashDir, fontName: "HashIcons", name: "HashIcons" }, colorFormat: "auto" as const, formats: ["woff2"] as ("woff2" | "woff" | "ttf")[] }
await capture(() => buildAndWrite({ ...baseHashOpts }).then(() => undefined))
const cssPath = resolve(hashDir, "HashIcons.css")
const css1 = readFileSync(cssPath, "utf8")
// 同配置重跑 → HIT(buildAndWrite 命中返回 null,但 colorfonts 才打印「命中缓存」;这里直接看返回值)
const hitRun = await buildAndWrite({ ...baseHashOpts })
check(hitRun === null, "configHash: 同配置重跑 = HIT(buildAndWrite 返回 null)")
// 改 woff2Quality(进 configHash)→ MISS。
const missRun = await buildAndWrite({ ...baseHashOpts, woff2Quality: 5 })
check(missRun !== null, "configHash: 改 woff2Quality → configHash 变 → MISS(返回非 null)")
// 改 classPrefix(进 configHash 且改变 css 的 ::before 选择器)→ MISS 且 css 内容变化。
const missRun2 = await buildAndWrite({ ...baseHashOpts, classPrefix: "ic2-" })
check(missRun2 !== null, "configHash: 改 classPrefix → MISS")
const css2 = readFileSync(cssPath, "utf8")
check(css1 !== css2 && css2.includes(".ic2-"), "configHash: 代表产物 .css 内容随 classPrefix 刷新(非假绿)")

// ───────── 码位墓碑/稳定性(核心契约):assignCodepoints 纯函数 ─────────
// [a,b,c] 分配 → 删 b 重跑 → b present=false 且码位不变、a/c 不动 → b 加回 → 复用原码位。
const tombLock: CodepointMap = { version: 1, paFirst: 0xe000, glyphs: {} }
const m1 = assignCodepoints(["a", "b", "c"], tombLock, "2026-06-22")
const cpA = m1["a"], cpB = m1["b"], cpC = m1["c"]
check(cpA !== cpB && cpB !== cpC && cpA !== cpC, "tomb: a/b/c 分到不同码位")

// 删 b:只传 a,c 重跑(同一 lock 对象,墓碑保留)。
assignCodepoints(["a", "c"], tombLock, "2026-06-23")
check(tombLock.glyphs["b"]?.present === false, "tomb: 删除 b → present=false")
check(tombLock.glyphs["b"]?.codepoint === cpB, "tomb: 删除 b → 码位保留不变(墓碑)")
check(tombLock.glyphs["a"]?.codepoint === cpA && tombLock.glyphs["c"]?.codepoint === cpC, "tomb: a/c 码位不动")
check(tombLock.glyphs["a"]?.present === true && tombLock.glyphs["c"]?.present === true, "tomb: a/c 仍 present")

// b 加回:复用原码位(绝不分配新的)。
const m3 = assignCodepoints(["a", "b", "c"], tombLock, "2026-06-24")
check(m3["b"] === cpB, "tomb: b 加回 → 复用原码位(不漂移)")
check(tombLock.glyphs["b"]?.present === true, "tomb: b 加回 → present 恢复 true")
check(m3["a"] === cpA && m3["c"] === cpC, "tomb: 加回 b 后 a/c 仍不动")

// ───────── worker 并行路径产物字节一致性(性能卖点,此前 0 覆盖) ─────────
// 同一输入分别走同步(threads:false)与 worker(threads:true → buildFlavors 每档一 worker)路径,
// 断言各档产物字节完全一致。svg2ttf 用 ts:0、woff2 编码确定,故字节应逐位相等;
// worker 序列化/排序/非确定性 bug 会让某档字节漂移而被此测捕获。
// 注:worker 启动失败时引擎 .catch 回退同步 —— 即便回退,本测仍守住「threads:true 配置产物正确且与同步一致」。
const buildAssetMap = async (threads: boolean): Promise<Record<string, Buffer>> => {
  const r = await build({
    sources: fixtures,
    output: { dir: `out/wt-${threads}`, fontName: "WIcons", name: "WIcons" },
    colorFormat: "auto" as const,
    formats: ["woff2", "ttf"] as ("woff2" | "woff" | "ttf")[],
    threads,
  })
  const m: Record<string, Buffer> = {}
  for (const a of r.assets) m[a.fileName] = Buffer.from(a.source)
  return m
}
const syncAssets = await buildAssetMap(false)
const workerAssets = await buildAssetMap(true)
const sk = Object.keys(syncAssets).sort()
const wk = Object.keys(workerAssets).sort()
check(sk.length > 0 && sk.join() === wk.join(), `worker: threads true/false 产物集合一致(${sk.length} 档)`)
let workerBytesEqual = true
for (const k of sk) {
  if (!workerAssets[k] || Buffer.compare(syncAssets[k], workerAssets[k]) !== 0) {
    workerBytesEqual = false
    console.error(`    worker 产物字节不一致: ${k}`)
  }
}
check(workerBytesEqual, "worker: threads:true 路径产物与同步路径字节完全一致")

process.chdir(here)
rmSync(root, { recursive: true, force: true })
console.log(`\n${fail === 0 ? "✅" : "❌"} colorfont test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
