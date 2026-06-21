---
name: colorfont
description: >-
  @codejoo/colorfont(SVG 图标 → 彩色 webfont 引擎)的目的、结构、关键选型与维护要点。
  在 D:\workspaces\colorfont 上维护 packages/colorfont(改引擎/CLI/wasm/性能)时参考本 skill。
---

# colorfont —— SVG 图标 → 彩色 webfont(单包)

## 目的
把一个目录的 SVG 图标编译成**彩色** webfont(mono / COLRv0 / OT-SVG / COLRv1),带 `tech()` 回退链、
**实物落盘**(真实 `.css`/`.ts`/字体/码位锁,无虚拟模块)、稳定码位。纯 JS、无 node-gyp、安装期零原生编译。面向 npm 社区开源。
现为 graphics-icon 套件成员,与 bitmap-icons / svg-icons / imagemin / utils 平级,经发布包 `graphics-icon`(packages/exports)的子路径 `graphics-icon/colorfont` 对外。

## 结构(引擎-only 私有包 `@codejoo/colorfont`,Vite 插件在 `@graphics-icon/vite-umbrella` = packages/vite-plugin)
- `src/`(引擎):`index.ts` 入口(`exports["."]` = 源码,非 dist),`pipeline/`、`glyf/`、`colrv1/`、
  `flavors/`、`emit/`、`encode/`、`outline/`、`codepoints/`、`cache/`、`workers/`、`util/` 等。
- Vite 插件薄封装在私有包 `@graphics-icon/vite-umbrella`(`packages/vite-plugin`,仅含伞插件),从 `@codejoo/colorfont` 导入引擎;
  对外发布物是 `graphics-icon`(`packages/exports`),再导出伞插件为 `graphics-icon/vite`、引擎为 `graphics-icon/colorfont`。
- `src/cli/`:build/watch/check。`run(argv)` 在 `cli/cli.ts`,经 index 以 **`runCli`** 再导出(供发布包 bin
  `color-fonts` 复用)。引擎双形态:`build`/`buildAndWrite`/`colorfonts`(可编程)+ `runCli`(CLI)。
- `colrv1-writer/`(Rust→wasm):COLRv1 写表。`woff2`(Rust→wasm):可调质量 woff2 编码。
- `scripts/`、`test/cli.test.ts`、`fixtures/`、`README.md`。无 tsup(发布包 tsup 内联本包源码)。

引擎不依赖 vite;插件层在 `@graphics-icon/vite-umbrella`(`colorfont-plugin.ts` 定义插件选项类型 **`ColorfontOptions`**,
extends 引擎选项;引擎 `types.ts` 的同名类型在 import 处别名 `ColorfontEngineOptions`)。
公共第三方依赖经根 `pnpm-workspace.yaml` 的 `catalog:` 统一版本。**本包现依赖 `@codejoo/utils`**(归一化/幂等写入/统一 `groupCache`)。

## 构建管线(每次 build,要点)
loadIcons 读 SVG → assignCodepoints(码位锁 `<fontName>.codepoints.json`,默认落 `<outDir>`,PUA 0xE000,墓碑不回收)→ 构建缓存检查
(命中复用上次字节)→ prepareIcons(worker 池,封顶 8;每图标 normalizeSvg(**复用 `@codejoo/utils/scale-svg`**,
svgo×2 + viewBox 放大 1024 整数化,故 `prepareOne` 为 async)→ parseSvg → detectColor → toOutline)→
buildFlavors(mono=svg2ttf;colrv0=手写 COLRv0+CPAL 注入;otsvg=手写 `SVG ` 表注入;colrv1=write-fonts wasm)
→ 各档 toWoff2/toWoff → `buildAndWrite(item)` 用 `@codejoo/utils/fs-write` 幂等写入,把字体 + `<fontName>.css`(双 @font-face + tech 链)
+ `<fontName>.ts`(emitDts)+ `<fontName>.codepoints.json` 全部写进 `outDir`。**实物落盘,无虚拟模块**;消费方 `import './fonts/AppIcons.css'`
+ `import { icons, type IconName } from './fonts/AppIcons'`。`colorfonts({items})` 多实例批量(每 item 独立缓存/产物)。`emitDemo`/gallery 已移除。

## 关键选型(及为什么)
- 引擎全 glyf 不用 CFF(opentype.js 只能写 CFF;glyf 更小、解锁 woff2 生态),opentype.js 降为只读解析。
- COLRv1 必须 Rust→wasm(纯 JS 写不出);OT-SVG 与 COLRv1 **共存**(Safari 不渲染 COLRv1,Chromium 不渲染 OT-SVG)。
- woff2 用 ttf2woff2(Rust→wasm),质量可配(默认 dev=9 / 生产=11);q9 比 q11 快约 31×,体积仅 +6%。
- 构建缓存(参考 imagemin 内容哈希):命中复用,重复构建快约 10×;dev 冷启动 `buildStart` 不 await。
- 稳定码位:PUA 从 0xE000,墓碑策略,每字体 `<fontName>.codepoints.json` 提交。

## 维护易踩点
- 改引擎产物格式 → bump `src/cache/build-cache.ts` 的 `VERSION` 常量,否则缓存供旧产物。
- 改 wasm → 重编 + `scripts/copy-wasm.mjs`;wasm-bindgen 版本须与 crate 对齐;`pkg/package.json` 须 `{"type":"commonjs"}`。
- 发布包(`packages/exports`)tsup 内联本包源码但**不**内联第三方依赖 → 这些依赖(svg2ttf/svgo/svgpath/cubic2quad/opentype.js/ttf2woff)
  必须列在发布包 `dependencies`,vite 为 peer。**`fflate` 已移除**(未使用)。
- 本包内联 `@codejoo/utils`,而 utils 惰性 import 了 svgo/svgpath/**scale-that-svg** → 三者都要设为 external
  并声明为 deps,否则会被打进产物(尤其 svgo ~1MB;scale-that-svg 即便本引擎不调用也会被字面量 import() 打包)。
- ttf2woff2 是 glyf-only(本引擎已全 glyf,OK)。
- 从源码构建 wasm:默认工具链须 gnu;`cargo build --target wasm32-unknown-unknown` + wasm-bindgen `--target nodejs`。

## 备注
仓库 `.claude/skills/colorfont-plugin/` 是 monorepo 总览 skill(已更新为伞插件四引擎架构 + colorfont 引擎深挖);
伞层细节见 `packages/vite-plugin/SKILL.md`(name: graphics-icon;现描述私有伞包 `@graphics-icon/vite-umbrella`)。
