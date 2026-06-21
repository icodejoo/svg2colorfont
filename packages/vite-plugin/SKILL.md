---
name: graphics-icon
description: >-
  @graphics-icon/vite-umbrella(私有伞 Vite 插件 graphicsIcon:合并 colorfont + bitmap-icons + svg-icons + imagemin)的
  目的、结构、单插件合并、多实例与按实例缓存/错误处理、易踩的点。在 D:\workspaces\colorfont 上维护
  packages/vite-plugin(伞聚合层)时参考本 skill。对外发布产物是 graphics-icon(packages/exports),它再导出本包为 graphics-icon/vite。
---

# @graphics-icon/vite-umbrella —— 四引擎合一的伞 Vite 插件(私有)

## 目的
把四个引擎组合成**一个** Vite 插件 `graphicsIcon`,并**按需启用**:只有被传入且非 `false` 的子能力才会实例化。
本包是**私有的**(`private: true`,`@graphics-icon/vite-umbrella`),**不发布**——它**只含伞 Vite 插件**(`graphicsIcon` +
合并/插件壳)。对外发布物是 `graphics-icon`(在 **packages/exports**),由它把本包再导出为 `graphics-icon/vite`,并额外提供
各引擎子路径(`graphics-icon/colorfont` `/svg` `/bitmap` `/imagemin`)与 4 个 CLI。其余引擎包(`@codejoo/colorfont`、
`bitmap-icons`、`svg-icons`、`@codejoo/imagemin`、`@codejoo/utils`)都是私有内部实现,tsup 在 `packages/exports` 构建时
通过 `noExternal` 内联进发布包 `dist`。

## 功能(四子能力,均为「双形态」)
每个引擎都既能经本伞插件集成进 Vite,又能在 Vite 之外作为**引擎函数 + CLI** 单独用——但单独用是经发布包的子路径
(`graphics-icon/colorfont` 等)与 CLI bin,**不**经本私有包。
- **colorfont**:SVG 图标 → 彩色 webfont(mono/COLRv0/OT-SVG/COLRv1)。引擎 `@codejoo/colorfont`;插件壳
  `src/colorfont-plugin.ts`。**实物落盘**(见下)。
- **bitmap-icons**:位图 → 单张雪碧图集 + 样式 + 入口脚本。引擎 `bitmapIcons`;插件工厂 `bitmapIconsVite(opts): Plugin`。
- **svg-icons**:SVG 雪碧图(`<symbol>`+`<use href>`)。引擎 `svgIcons`;插件工厂 `svgIconsVite(opts): Plugin[]`。
- **imagemin**:图片压缩(sharp + svgo,哈希缓存)。引擎 `imagemin`;Vite 插件形态 `imageminVite`。

## 单插件合并(核心:`graphicsIcon` 返回**单个** Plugin)
`graphicsIcon(options): Plugin`(**不是 Plugin[]**)。内部按子键实例化各子插件(svg 工厂返回数组,会被展开),
再用 `mergePlugins(name, subs)` 把同名钩子**多路复用**到一个 Plugin 上:
- `FANOUT_HOOKS`(config/configResolved/configureServer/buildStart/buildEnd/generateBundle/closeBundle/
  watchChange/handleHotUpdate)→ 依次调用每个实现了该钩子的子插件。
- 顺序:svg → bitmap → colorfont(buildStart 产源)→ imagemin(closeBundle 压缩最终产物)。
- 消费方:`plugins: [graphicsIcon({...})]`(**不要展开**)。

## colorfont 实物落盘(无虚拟模块)
colorfont 把真实的 `<fontName>.css`、`<fontName>.ts`、字体文件、`<fontName>.codepoints.json` 写进 `outDir`,
消费方用**普通 import** 取用——**不再有 `virtual:colorfont` / `virtual:colorfont.css` 虚拟模块**,合并器也不再需要
`resolveId`/`load`:

```ts
import './fonts/AppIcons.css'                        // @font-face + .icon 类
import { icons, type IconName } from './fonts/AppIcons'  // 类型化 API
```

`emitDemo`/gallery 选项已移除。

## 统一选项 `GraphicsIconOptions`
- `colorfonts?: ColorfontOptions | false`
- `bitmapIcons?: BitmapIconsOptions | false`
- `svgIcons?: SvgIconsOptions | false`
- `imagemin?: ImageminPluginOptions | false`(`= Partial<ImageminOptions> & { enabled? }`,**单例**)
- `unused?: UnusedDetectOptions | false`(构建期经模块图检测无用文件,写 `.cache.graphics/unused.json`,**只写表不删**;自动排除四引擎输入/输出。**不限资产**——`ext`/`include` 任意后缀。删除是独立的 `removeUnused`/`remove-unused`,带 `include`/`exclude` 安全闸;不走 vite 时用 `findUnused`/`remove-unused --scan` 静态检测)

**多实例**:`colorfont`/`svgIcons`/`bitmapIcons` 均为 `{ ...公共, items: [item, …] }`——公共参数合并进每个 item
(item 覆盖公共),每个 item = 一套独立缓存 + 独立产物。`imagemin` 为单例。

## 按实例缓存 / 错误处理(替代旧的 cacheDir/cacheFile)
- ~~插件级 `cacheDir`、各引擎全路径 `cacheFile`~~ **已移除**。
- `cache?: boolean`(默认 `true`):命中(输入 + 选项 + 产物均未变)跳过整条管线;`false` 删该实例缓存 + 旧产物并重建。
- 缓存文件名按实例:Vite 用 `cacheName?: string`(**仅文件名**,落 `.cache.graphics/`);独立(子路径/CLI)用
  `cacheFilename?: string`(全路径,或裸名 → `.cache.graphics/`)。底层由 `@codejoo/utils` 的统一 `groupCache` 统管。
- `throwable?: boolean`(默认 `true`):失败时 `true` 抛错中止(Vite 报错;CLI 非零退出);`false` 告警并继续。
- imagemin(单例)仍用 `cacheFile`(默认 `.cache.graphics/imagemin.json`)。

## Vite 插件层额外项
- colorfont 键上:`watch?: boolean`(默认 true,`.svg` 变更重生成)、`devFast?: boolean`(默认 true,dev 用 WOFF2 q9)。

## 易踩的点
- `graphicsIcon` 返回**单个** Plugin:`plugins: [graphicsIcon({...})]`,别 `...` 展开(展开非可迭代对象会炸)。
- `svgIconsVite(opts)` 工厂仍返回 **Plugin[]**,但这是**内部**用法;对外只经 `graphicsIcon({ svgIcons })`。
- colorfont 插件选项类型叫 `ColorfontOptions`(在本包 `colorfont-plugin.ts`),引擎同名类型在 import 处别名为
  `ColorfontEngineOptions`;别再用旧名 `VitePluginColorfontOptions`。
- **发布相关在 `packages/exports`**:子路径出口、4 个 CLI bin、tsup `entry`/`dts.resolve`、`scripts/copy-wasm.mjs`
  (把 colorfont 的 woff2/colrv1 crate `pkg` 拷入 `dist/{woff2,colrv1}`)、以及把第三方运行时依赖列入 `dependencies`
  (svgo/svgpath/sharp/maxrects-packer/vite-plugin-icons-spritesheet/scale-that-svg/cubic2quad/opentype.js/svg2ttf/
  ttf2woff;**`fflate` 已移除**)——均在发布包,不在本私有包。`vite` 为 peer。
