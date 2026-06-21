# @codejoo/unused

找出项目里**未被引用的文件**并按需删除。默认面向静态资产(图片/字体/媒体),但**不限于此**——经 `ext` 或 `include` 可检测任意后缀(`.js` `.ts` `.json` …)。检测与删除**分离**(安全)。

两种检测后端,产出同一份**清单表** `.cache.graphics/unused.json`,删除端统一:

| 后端 | 入口 | 依赖 vite? | 适用 |
| --- | --- | --- | --- |
| 模块图(精确) | `unusedVite`(Vite 插件) | 是(`vite build`) | 走 bundler 的应用;对**代码文件**尤其可靠(可达性=模块图) |
| 静态扫描(启发式) | `findUnused()` / `remove-unused --scan` | 否 | CLI / 非 bundler 流水线(imagemin、svg-icons、bitmap-icons 等命令行场景) |

> 经 [`graphics-icon`](../exports) 伞插件 `graphicsIcon({ unused: {...} })` 集成时,四引擎(colorfonts/svgIcons/bitmapIcons)的**输入目录与产物自动并入排除**——它们被构建工具消费但不被源码 `import`,否则会被误判为未使用而误删。

## 任意后缀 / Any extension

`ext` 与 `include` 都不限制类型,资产清单只是默认值:

```ts
unusedVite({ ext: ['.js', '.ts', '.json'] })          // 改默认候选后缀
unusedVite({ include: ['**/*.ts', '!**/*.d.ts'] })    // 或直接用 glob 精确圈定
```
```bash
remove-unused --scan --ext .js,.ts,.json              # CLI 同理(裸名自动补点)
```

**代码文件注意**:静态扫描(`findUnused`)以「basename 是否在源码中出现」判定引用,**入口文件**(`main.ts`、被 HTML/配置引用者)不会被 `import`,可能被误报——请用 `exclude` 排除入口,或改用 `unusedVite`(模块图能正确识别入口与可达性)。

## 用法 / Usage

### A. 经伞插件(走 vite,推荐用于应用)

```ts
// vite.config.ts
import graphicsIcon from 'graphics-icon/vite'
export default {
  plugins: [graphicsIcon({
    svgIcons: { items: [{ input: 'src/icons', output: { svg: 'src/sprites/icons.svg' } }] },
    unused: { root: 'src', exclude: ['src/legacy/**'] }, // 引擎 input/产物自动排除
  })],
}
```
`vite build` 写出 `.cache.graphics/unused.json`,核对后删除:
```bash
remove-unused --dry-run     # 预览
remove-unused               # 删除(--include/--exclude 为删除安全闸)
```

### B. 纯 CLI(不走 vite)

```bash
remove-unused --scan --root src --exclude "src/icons/**"   # 静态检测 → 写表(不删)
remove-unused --dry-run                                    # 预览
remove-unused --exclude "src/keep/**"                      # 删除,保留白名单
```

## API

| 导出 | 形态 | 说明 |
| --- | --- | --- |
| `unusedVite(o)` | `=> Plugin` | 构建期模块图检测(`apply:'build'`),写表,**不删**。 |
| `findUnused(o)` | `(o?) => Promise<UnusedManifest>` | 静态扫描检测(不依赖 vite),写表。 |
| `removeUnused(o)` | `(o?) => Promise<{removed,skipped,missing}>` | 读表删除;`include`/`exclude` 为删除安全闸,`dryRun` 仅打印。 |
| `listCandidates(o, extra?)` | `=> string[]` | 候选文件解析(include/ext + exclude),两后端共用。 |
| `runCli(argv?)` | `=> Promise<void>` | `remove-unused` 命令实现。 |

**候选解析(`CandidateOptions`,detect/scan 共用)**:`root`(默认 `"src"`)· `include`(候选 glob,省略则由 `ext` 生成)· `ext`(默认资产后缀)· `exclude`(仓库根相对 glob)。
**`FindUnusedOptions`** 另有:`sources`(待扫描源 glob,默认常见代码/标记/样式)· `sourceRoot`(默认 cwd)。
**`RemoveUnusedOptions`**:`manifest` · `dryRun` · `include`(删除白名单)· `exclude`(删除黑名单,优先级最高)。

## CLI

```
remove-unused --scan [--root <dir>] [--ext .a,.b] [--include <glob>] [--exclude <glob>] [--sources <glob>]
remove-unused [--dry-run|-n] [--include <glob>] [--exclude <glob>] [--manifest <path>]
```
`--include`/`--exclude`/`--ext`/`--sources` 均可重复或逗号分隔。

## 局限 / Caveats

模块图/静态扫描都无法覆盖全部动态引用(`import.meta.url` 拼接、运行期字符串路径等)。**清单仅供核对**;删除前务必 `--dry-run` 过目。
