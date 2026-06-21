> 高性能、多功能的前端图形构建套件
> High-performance, multi-featured graphics build toolkit

中文 ｜ [English](#english)

把「图形资源 → 可上线产物」的常见构建需求收进一个插件：SVG 图标编译为彩色 webfont、位图打包雪碧图、SVG 符号雪碧图、图片批量压缩。

## How to use
```bash
pnpm install graphics-icon
```

发布包 `graphics-icon` 在 [`packages/exports`](packages/exports)。它**仅有子路径导出**(无裸 `.`):`graphics-icon/vite`(伞插件)、`graphics-icon/colorfont`、`graphics-icon/svg`、`graphics-icon/bitmap`、`graphics-icon/imagemin`,外加 5 个 CLI:`color-fonts`/`svg-icons`/`bitmap-icons`/`image-min`/`remove-unused`。

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import graphicsIcon from 'graphics-icon/vite'

export default defineConfig({
  plugins: [
    graphicsIcon({
      // 每个子能力(colorfont/svgIcons/bitmapIcons)均为多实例 { ...公共, items: [...] };imagemin 为单例
      colorfonts: { colorFormat: 'auto', items: [{ input: 'src/icons/color', outDir: 'src/fonts', fontName: 'AppIcons' }] },
      svgIcons: { items: [{ input: 'src/icons/svg', output: { svg: 'src/sprites/icons.svg', script: 'src/sprites/icons.ts' }, color: true }] },
      bitmapIcons: { items: [{ inputDir: 'src/icons/png', output: { image: 'src/sprites/sheet.webp', style: 'src/sprites/sheet.css' } }] },
      imagemin: { enabled: true },   // 构建产物图片压缩;enabled:false 可关
    }),
  ],
})
```

省略某个键即不启用该能力(对应重依赖也不会加载)。缓存与错误处理按实例配置:`cache?: boolean`(默认 true;false 删缓存+旧产物重建)、`throwable?: boolean`(默认 true 抛错中止,false 告警续跑)。

**colorfont 实物落盘**:写真实的 `<fontName>.css` + `<fontName>.ts` + 字体 + `<fontName>.codepoints.json` 进 `outDir`(随仓库提交),用普通 import 消费,**无 `virtual:colorfont*` 虚拟模块**:

```ts
import './fonts/AppIcons.css'                       // @font-face + .icon 类
import { icons, type IconName } from './fonts/AppIcons'  // 类型化 API
```

> 完整 API——每个选项(字段、类型、默认值)、独立引擎子路径(暴露引擎函数)与 CLI——见发布包 README:[`packages/exports/README.md`](packages/exports/README.md)。

## 内部结构(均为 private)

发布物 `graphics-icon` 在 `packages/exports`;`packages/vite-plugin` 现为私有的 **`@graphics-icon/vite-umbrella`**(仅含伞插件 `graphicsIcon`,不发布,经 `graphics-icon/vite` 再导出)。各引擎包均 private。

| 功能 | 作用 |
|---|---|
| 彩色字体引擎 | `@codejoo/colorfont`:SVG 图标 → 彩色 webfont(mono/COLRv0/OT-SVG/COLRv1)引擎 + CLI。实物落盘。 |
| 位图雪碧图 | `bitmap-icons`:sharp + maxrects-packer 把位图打成图集 + 自适应样式/入口脚本。 |
| SVG 雪碧图 | `svg-icons`:`<symbol>` 雪碧图,id 作用域化、颜色主题化,可选与 colorfont 同步的 normalize。 |
| 图片压缩 | `@codejoo/imagemin`:sharp + svgo 就地压缩引擎/CLI,内容哈希缓存 + 重命名识别。 |
| 公共子模块 | `@codejoo/utils`:哈希/glob/幂等写入/共享缓存原语/SVG 缩放归一化。 |

---

<a name="english"></a>
## English

[中文](#) ｜ **English**

> High-performance, multi-featured graphics build toolkit

Bundles the common "graphic asset → shippable output" build needs into one plugin: compile SVG icons to a color webfont, pack bitmaps into sprite sheets, build SVG `<symbol>` sprites, and batch-optimize images.

### How to use
```bash
pnpm install graphics-icon
```

The published package `graphics-icon` lives in [`packages/exports`](packages/exports). It has **subpath exports only** (no bare `.`): `graphics-icon/vite` (umbrella plugin), `graphics-icon/colorfont`, `graphics-icon/svg`, `graphics-icon/bitmap`, `graphics-icon/imagemin`, plus 5 CLIs: `color-fonts`/`svg-icons`/`bitmap-icons`/`image-min`/`remove-unused`.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import graphicsIcon from 'graphics-icon/vite'

export default defineConfig({
  plugins: [
    graphicsIcon({
      // each capability (colorfont/svgIcons/bitmapIcons) is multi-instance { ...common, items: [...] }; imagemin is a singleton
      colorfonts: { colorFormat: 'auto', items: [{ input: 'src/icons/color', outDir: 'src/fonts', fontName: 'AppIcons' }] },
      svgIcons: { items: [{ input: 'src/icons/svg', output: { svg: 'src/sprites/icons.svg', script: 'src/sprites/icons.ts' }, color: true }] },
      bitmapIcons: { items: [{ inputDir: 'src/icons/png', output: { image: 'src/sprites/sheet.webp', style: 'src/sprites/sheet.css' } }] },
      imagemin: { enabled: true },   // optimize build-output images; enabled:false to turn off
    }),
  ],
})
```

Omit a key to skip that capability (its heavy deps won't load either). Cache and error handling are per-instance: `cache?: boolean` (default true; false deletes the cache + old products and rebuilds) and `throwable?: boolean` (default true throws & aborts, false warns & continues).

**colorfont is real-disk**: it writes real `<fontName>.css` + `<fontName>.ts` + fonts + `<fontName>.codepoints.json` into `outDir` (commit them); consume with normal imports — there are **no `virtual:colorfont*` modules**:

```ts
import './fonts/AppIcons.css'                       // @font-face + .icon classes
import { icons, type IconName } from './fonts/AppIcons'  // typed API
```

> Full API — every option (field, type, default), the standalone engine subpaths (which expose engine functions) and the CLIs — lives in the package README: [`packages/exports/README.md`](packages/exports/README.md).

### Internal structure (all private)

The published artifact `graphics-icon` is at `packages/exports`; `packages/vite-plugin` is now the private **`@graphics-icon/vite-umbrella`** (the umbrella plugin `graphicsIcon` only — not published, re-exported as `graphics-icon/vite`). Every engine package is private.

| Capability | Role |
|---|---|
| Color font engine | `@codejoo/colorfont`: SVG icons → color webfont (mono/COLRv0/OT-SVG/COLRv1) engine + CLI. Real-disk output. |
| Bitmap sprites | `bitmap-icons`: sharp + maxrects-packer pack bitmaps into an atlas + fluid styles / entry script. |
| SVG sprites | `svg-icons`: `<symbol>` sprites with id scoping and color theming, plus optional normalize in sync with colorfont. |
| Image optimization | `@codejoo/imagemin`: sharp + svgo in-place compression engine/CLI, content-hash cache + rename detection. |
| Shared submodule | `@codejoo/utils`: hash / glob / idempotent-write / shared-cache primitives / SVG scale-normalize. |
