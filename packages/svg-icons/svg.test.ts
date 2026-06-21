// svg-icons 多实例 + groupCache 集成自测。Node 24 直接跑 .ts。
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { svgIcons } from "./src/create.ts"

const root = resolve(process.cwd(), ".svg-test-tmp")
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

// 捕获日志以判定命中
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

mkdirSync("icons", { recursive: true })
writeFileSync("icons/home.svg", `<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z" fill="#333"/></svg>`)
writeFileSync("icons/star.svg", `<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5 5 2 7-7-4-7 4 2-7-5-5h7z" fill="#333"/></svg>`)

const opts = (cache = true) => ({
  color: true as const, // 公共参数:合并进 item
  cache,
  items: [{ input: "icons", output: { svg: "out/icons.svg", script: "out/icons.ts" } }],
})

await capture(() => svgIcons(opts()))
check(existsSync("out/icons.svg"), "sprite svg generated")
check(existsSync("out/icons.ts"), "script generated")
const cacheFile = resolve(root, ".cache.graphics/svg-icons-icons.json")
check(existsSync(cacheFile), "per-instance cache file written (svg-icons-icons.json)")
check(!hadHit(), "1st run = miss")

await capture(() => svgIcons(opts()))
check(hadHit(), "2nd run unchanged = HIT")

// 改输入 → miss
writeFileSync("icons/extra.svg", `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333"/></svg>`)
await capture(() => svgIcons(opts()))
check(!hadHit(), "added input = miss")

// 删产物 → miss(existsSync 校验)
rmSync("out/icons.ts")
await capture(() => svgIcons(opts()))
check(!hadHit(), "deleted product = miss")
check(existsSync("out/icons.ts"), "deleted product restored")

// cache:false → 删旧产物+json,强制重建
await capture(() => svgIcons(opts(false)))
check(!hadHit(), "cache:false = miss")
check(existsSync("out/icons.svg") && existsSync(cacheFile), "cache:false rebuilt products + cache")

process.chdir(resolve(root, ".."))
rmSync(root, { recursive: true, force: true })
console.log(`\n${fail === 0 ? "✅" : "❌"} svg-icons test: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
