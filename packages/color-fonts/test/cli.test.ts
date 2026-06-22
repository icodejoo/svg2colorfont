import { readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { run } from '../src/cli/cli.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '../fixtures')
const out = resolve(here, '../.test-out')
const missingCpDir = resolve(here, '../.test-out-missing')

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
}

const logs: string[] = []
const log = (m: string) => logs.push(m)

await rm(out, { recursive: true, force: true })
await rm(missingCpDir, { recursive: true, force: true })

const baseArgs = ['--sources', fixtures, '--dir', out, '--font-name', 'CliIcons', '--name', 'CliIcons', '--format', 'woff2,woff', '--color', 'auto']

// 1) help
{
  const code = await run(['help'], log)
  assert(code === 0, 'help 退出码 0')
  assert(logs.join('\n').includes('colorfont — SVG'), 'help 打印用法')
}

// 2) build
{
  const code = await run(['build', ...baseArgs], log)
  assert(code === 0, 'build 退出码 0')
  const files = readdirSync(out)
  assert(files.some((f) => f.endsWith('.woff2')), 'build 产出 woff2')
  assert(files.includes('CliIcons.css'), 'build 产出 css')
  assert(files.includes('CliIcons.ts'), 'build 产出 ts 入口')
  assert(files.includes('CliIcons.codepoints.json'), 'build 产出 <fontName>.codepoints.json')
}

// 3) check —— 已有锁文件,应通过
{
  const code = await run(['check', ...baseArgs], log)
  assert(code === 0, 'check(锁文件已存在且稳定)退出码 0')
}

// 4) check —— 锁文件缺失,应漂移失败(退出码 1)
{
  const code = await run(
    ['check', '--sources', fixtures, '--dir', missingCpDir, '--font-name', 'CliIcons', '--name', 'CliIcons', '--color', 'auto'],
    log,
  )
  assert(code === 1, 'check(锁文件缺失)退出码 1')
}

// 5) 缺必填参数 → 退出码 2
{
  const code = await run(['build', '--dir', out], log)
  assert(code === 2, '缺 --sources/--font-name/--name 退出码 2')
}

// 6) 未知命令 → 退出码 2
{
  const code = await run(['frobnicate'], log)
  assert(code === 2, '未知命令退出码 2')
}

console.log('=== CLI test ===')
console.log(logs.filter((l) => l.startsWith('[colorfont]')).join('\n'))
console.log('\n✅ CLI TEST OK (help/build/check-pass/check-drift/missing-args/unknown-cmd)')
