# bitmap-icons

> 用 **sharp + maxrects-packer** 把一个目录的位图（png/jpg/jpeg/webp/avif）打成**单张**雪碧图集，并生成样式、入口脚本与可选坐标 JSON。
> Pack a directory of bitmaps into a single sprite-sheet atlas, emitting a stylesheet, an entry script and optional coordinate JSON.

本包是发布包 [`graphics-icon`](../exports)（在 `packages/exports`）的 **bitmapIcons 引擎**。两种用法：

- **集成进 Vite**：经 `graphicsIcon({ bitmapIcons: {...} })`（完整插件选项见[发布包 README](../exports/README.md#bitmapicons-options)）。
- **单独使用**：从 `graphics-icon/bitmap` import 引擎函数，或用 CLI（`bitmap-icons`）——见下文。

特点：无 `publicPath`（CSS 用「style→image 相对 url()」、script 用相对 import，均交 Vite 解析/带 hash）；产物 `*.sprite.{webp,png}` 命名会被自动排除出源扫描，故可与源图同目录；每组生成幂等（内容未变不写盘 → 不触发 HMR 循环）。

## 单独使用 / Standalone

### 引擎函数

从发布包子路径 `graphics-icon/bitmap` 导入引擎函数（私有包名 `bitmap-icons` 仅 monorepo 内部用）：

```ts
import { bitmapIcons } from 'graphics-icon/bitmap'

await bitmapIcons({
  // 多实例 { ...公共, items: [...] }（公共参数合并进每项）
  items: [
    { inputDir: 'src/icons/png', prefix: 'icon',
      output: { image: 'src/sprites/sheet.webp', style: 'src/sprites/sheet.css', script: 'src/sprites/sheet.ts' } },
  ],
})
```

调用方只需：`import { iconsImage, type IconName } from '<output.script>'` —— 该脚本注入样式、给出图 URL 与类型。

### CLI

```bash
bitmap-icons --config ./bitmap.config.ts   # 配置文件 default-export 一个含 items[] 的 BitmapIconsOptions
```

## 导出 API / Exports

| API | 类型 | 作用 |
| --- | --- | --- |
| `bitmapIcons(options)` | `(o: BitmapIconsOptions) => Promise<void>` | 按 `items[]` 顺序生成所有图集 + 边车，维护每实例缓存（默认 `throwable` 出错即抛出）。 |
| `bitmapIconsVite(options)` | `(o: BitmapIconsOptions) => Plugin` | Vite 插件工厂（供伞插件内部使用；推荐经 `graphicsIcon` 使用）。 |
| `runCli(argv)` | `(argv: string[]) => Promise<void>` | CLI 入口（被 `bitmap-icons` 复用）。 |
| 类型 | `BitmapIconsOptions` / `BitmapIconsConfig` / `BitmapIconsOutput` / `IconFrame` / `IconManifest` / `IconSheetMeta` | 选项与产物清单类型。 |

`BitmapIconsOptions` / 每个 `items[]` 项的字段、类型与默认值见[发布包 README · bitmapIcons options](../exports/README.md#bitmapicons-options)。

## License

MIT
