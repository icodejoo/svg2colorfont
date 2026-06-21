# svg-icons

> 把一个目录的零散 **SVG 编译成单个雪碧图**（`<symbol>` + `<use href>`）：id 作用域化、可选颜色改写、自产带类型的入口脚本、共享磁盘缓存。
> Compile a directory of SVGs into a single sprite sheet (`<symbol>` + `<use href>`) with id scoping, color rewriting, a typed entry script and a shared cache.

本包是发布包 [`graphics-icon`](../exports)（在 `packages/exports`）的 **svgIcons 引擎**。两种用法：

- **集成进 Vite**：经 `graphicsIcon({ svgIcons: {...} })`（完整插件选项见[发布包 README](../exports/README.md#svgicons-options)）。
- **单独使用**：从 `graphics-icon/svg` import 引擎函数，或用 CLI（`svg-icons`）——见下文。

在 SVG 雪碧图基础上补齐：id 作用域化（修第三方 issue #38）、`fill/stroke → currentColor` 颜色改写（可主题化）、自产 `iconsHref + iconsName + IconName` 入口脚本，以及与 colorfont 同步的可选 normalize/缩放。

## 单独使用 / Standalone

### 引擎函数

从发布包子路径 `graphics-icon/svg` 导入引擎函数（私有包名 `svg-icons` 仅 monorepo 内部用）：

```ts
import { svgIcons } from 'graphics-icon/svg'

await svgIcons({
  // 多实例 { ...公共, items: [...] }（公共参数合并进每项）
  items: [
    { input: 'src/icons/svg', output: { svg: 'src/sprites/icons.svg', script: 'src/sprites/index.ts' }, color: true },
  ],
})
```

消费：

```ts
import { iconsHref, iconsName, type IconName } from '@/sprites'
// <use :href="`${iconsHref}#${iconsName.foo}`" />
```

### CLI

```bash
svg-icons --config ./svg.config.ts   # 配置文件 default-export 一个含 items[] 的 SvgIconsOptions
```

## 导出 API / Exports

| API | 类型 | 作用 |
| --- | --- | --- |
| `svgIcons(options)` | `(o: SvgIconsOptions) => Promise<void>` | 按 `items[]` 一次性生成所有 SVG 雪碧图 + 类型化脚本，维护每实例缓存。 |
| `svgIconsVite(options)` | `(o: SvgIconsOptions) => Plugin[]` | Vite 插件工厂（供伞插件内部使用；推荐经 `graphicsIcon` 使用）。 |
| `runCli(argv)` | `(argv: string[]) => Promise<void>` | CLI 入口（被 `svg-icons` 复用）。 |
| 类型 | `SvgIconsOptions` / `SvgIconsConfig` / `SvgIconsOutput` / `ColorOption` / `ColorFn` / `NormalizeOption` | 选项类型。 |

`SvgIconsOptions` / 每个 `items[]` 项的字段、类型与默认值见[发布包 README · svgIcons options](../exports/README.md#svgicons-options)。

## License

MIT
