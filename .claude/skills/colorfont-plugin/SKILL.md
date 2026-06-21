---
name: colorfont-plugin
description: >-
  graphics-icon monorepo(伞插件 colorfont + bitmap-icons + svg-icons + imagemin)的整体架构、
  colorfont 引擎的关键选型抉择与实测结果。在 D:\workspaces\colorfont 上工作(改引擎/写表/wasm/打包/性能/伞层)时参考本 skill。
---

# graphics-icon monorepo —— 总览 / colorfont 引擎选型 / 实测

`D:\workspaces\colorfont` 是独立 pnpm monorepo(不在 let188 仓库)。对外**唯一发布物**是 `graphics-icon`(在
`packages/exports`),它**仅有子路径导出**(无裸 `.`),把四个引擎合成一个 Vite 插件 + 暴露各引擎函数;其余包均
`private`,经 tsup `noExternal` 内联进 `packages/exports` 的 dist。

## 包结构(8 包)
- `graphics-icon`(**packages/exports**)—— **唯一发布**物。5 个子路径出口 + 4 个 CLI bin。详见 `graphics-icon` skill。
  - 子路径:`graphics-icon/vite`(伞插件 `graphicsIcon`,默认导出)、`/colorfont`(`build`/`buildAndWrite`/`colorfonts`/`runCli`)、`/svg`(`svgIcons`/`runCli`)、`/bitmap`(`bitmapIcons`/`runCli`)、`/imagemin`(`imagemin`/`defaultOptions`/`runCli`)、`/unused`(`removeUnused`/`findUnused`/`runCli`)。
  - CLI:`color-fonts`/`svg-icons`/`bitmap-icons`/`image-min`/`remove-unused`。
- `@graphics-icon/vite-umbrella`(**packages/vite-plugin**)—— **私有**,仅含伞 Vite 插件 `graphicsIcon`(钩子多路复用);不发布,经 `graphics-icon/vite` 再导出。
- `@codejoo/colorfont` —— 彩色 webfont 引擎(纯 JS,本 skill 的深挖对象)+ CLI(`runCli`)。
- `bitmap-icons` —— 位图雪碧图引擎(`bitmapIcons`)+ 内部插件工厂。
- `svg-icons` —— SVG 雪碧图引擎(`svgIcons`)+ 内部插件工厂。
- `@codejoo/imagemin` —— 图片压缩引擎(`imagemin`)+ CLI。
- `@codejoo/unused`(**packages/unused**)—— 无用**文件**检测(不限资产,`ext`/`include` 任意后缀)→ 写清单表,删除分离。两后端:`unusedVite`(模块图,`apply:'build'`,走 vite,代码可达性更准)与 `findUnused`/`remove-unused --scan`(静态扫描,不依赖 vite)。`removeUnused`/`remove-unused` 读表删除,带 `include`/`exclude` 安全闸(`dryRun` 仅打印)。经伞插件 `unused` 键集成时自动排除四引擎的输入/输出。
- `@codejoo/utils` —— 内部公共子模块(hash/fingerprint/glob/path-rel/fs-write/cache(含统一 `groupCache`)/scale-svg)。
- colorfont 内含两个 Rust→wasm crate:`colrv1-writer`(COLRv1 写表)、`woff2`(可调质量 woff2 编码,ttf2woff2)。

**统一形态**:四引擎都「双形态」——引擎函数 + CLI 可在 Vite 外单独用(各经自己的子路径导入),也经
`graphicsIcon({...})` 集成。`graphicsIcon` 返回**单个**插件(钩子多路复用),按传入子键启停。
**多实例**:`colorfont`/`svgIcons`/`bitmapIcons` 均为 `{ ...公共, items: [...] }`(公共参数合并进每项,项覆盖公共),
每实例独立缓存 + 独立产物;`imagemin` 为单例。**按实例**缓存/错误:`cache?: boolean`(默认 true;false 删缓存+旧产物重建)、
`throwable?: boolean`(默认 true 抛错中止,false 告警续跑);缓存文件名 Vite 用 `cacheName`(仅文件名)、独立用
`cacheFilename`(全路径),统一落 `.cache.graphics/`,底层由 `@codejoo/utils` 的 `groupCache` 统管。各包另有自己的 SKILL.md。

## colorfont 构建管线(每次 build)
1. `loadIcons` 读 SVG。
2. `assignCodepoints`(码位锁 `<fontName>.codepoints.json`,默认落 `<outDir>`,PUA 从 0xE000,墓碑不回收;非缓存产物,需提交)。
3. **构建缓存检查**:key=sha256(引擎版本+影响产物的选项+图标内容+码位);命中直接复用上次字体字节,跳过 3–6。
4. `prepareIcons`(worker 池,线程数=CPU 一半封顶 8):每图标 `normalizeSvg`(**复用 `@codejoo/utils/scale-svg`**,
   svgo×2 + viewBox 放大到 1024 整数化,故 `prepareOne` 为 async)→ `parseSvg` → `detectColor`(按色拆层)→
   `toOutline`(svgpath+cubic2quad,路径→glyf 二次曲线 `d`)。**单色快路径**:`colorFormat:'mono'` 时跳过每层轮廓/inner。
5. `buildFlavors`(每档一 worker 并行):
   - mono:`svg2ttf` 组装 glyf。
   - colrv0:`buildColorGlyf`(base+层命名字形)→ 手写 COLRv0+CPAL 注入(`glyf/sfnt-inject.ts`)。
   - otsvg:glyf base + 手写 `SVG ` 表注入。
   - colrv1:`buildColorGlyf` → 交 `write-fonts` wasm 加 COLR/CPAL(传 gid)。
   - 每档再 `toWoff2`(ttf2woff2 wasm,质量可配)/ `toWoff`(ttf2woff)。
6. **实物落盘**:`buildAndWrite(item)` 用 `@codejoo/utils/fs-write` 的幂等写入,把字体 + `<fontName>.css`(双 @font-face +
   tech 链)+ `<fontName>.ts`(`emitDts`:IconName 联合 + icons/baseName/colorIcons)+ `<fontName>.codepoints.json` 全部写进
   `outDir`(内容未变不写,防 mtime/git/HMR 抖动)。**无 `virtual:colorfont*` 虚拟模块**——消费方用真实 import:
   `import './fonts/AppIcons.css'` + `import { icons, type IconName } from './fonts/AppIcons'`。`emitDemo`/gallery 选项已移除。

## colorfont 关键选型抉择(及为什么)
- **引擎全 glyf,不用 CFF**:opentype.js 只能写 CFF(OTTO),写不了 glyf;glyf 比 CFF 小 ~33% 且解锁原生 woff2。
  → 用 `svg2ttf` 组装 glyf,opentype.js 降为只读解析(`glyf/glyph-map.ts` 取 name→gid)。
- **color gid 按 glyph-name 解析,层字形优先 emit**:svg2ttf 会按 (advanceWidth,d) 去重并可能丢名;层优先 + 本地
  去重记 canonical → 层经 byName、base 经 cmap 都解析正确(`color-glyphs.ts`)。color 写表的命门。
- **COLRv1 必须 Rust→wasm**(fontations `write-fonts`);**OT‑SVG 不能被 COLRv1 取代,必须共存**:Safari 不渲染
  COLRv1、Chromium 永不渲染 OT‑SVG。tech 链:colrv1→otsvg→colrv0→mono。
- **woff2 用 ttf2woff2(Rust)→wasm**:可调质量。实测 q9 比 q11 快 ~31×、体积仅 +6%。默认 dev=9 / 生产=11。
- **构建缓存**:命中复用上次产物,重复构建 ~10×(1852ms→186ms)。
- **dev 冷启动不阻塞**:plugin `buildStart` 不 await(后台生成),HMR/watch 按需 await。产物实物落盘,消费方走真实 import(无虚拟模块)。
- **稳定码位**:PUA 从 0xE000,墓碑策略,每字体 `<fontName>.codepoints.json` 提交。

## 实测(1000 图标基准)
- 生产 q11 ~2.9–3.2s;dev q9 ~1.7s;单色 mono q9 ~1.35s。
- woff2(colrv0 887KB TTF,ttf2woff2 wasm):q11 852ms/264KB · q10 317ms/266KB · **q9 31ms/281KB**。
- 缓存命中 186ms(vs 全建 1852ms)。多线程:flavor 并行是大头(串行 4.2s→3.15s);prepare 池封顶 8。
- 测试:colorfont 有 cli 自测;伞包 `test/` 有 acceptance / acceptance-dist / plugin.test(均经真实 vite build)。

## 从源码构建 wasm(贡献者;终端用户无需)
默认工具链须 **gnu**(MSVC 缺 link.exe 时):`rustup default stable-x86_64-pc-windows-gnu` + `rustup target add
wasm32-unknown-unknown`。`wasm-bindgen-cli` 在 gnu 上 `cargo install` 会因 windows-sys 缺 as/dlltool 失败 →
**下载预编译 wasm-bindgen** 放 PATH(版本须匹配 crate)。每 crate:`cargo build --release --target
wasm32-unknown-unknown` + `wasm-bindgen … --target nodejs --out-dir pkg`;**pkg/package.json 必须
`{"type":"commonjs"}`**。发布包(`packages/exports`)`build` = tsup + `scripts/copy-wasm.mjs`(把两个 pkg 拷进 dist/woff2、dist/colrv1)。

## 易踩的点
- 改 colorfont 产物格式 → bump `cache/build-cache.ts` 的 `VERSION`,否则缓存供旧产物。
- 改 wasm → 重编 + `copy-wasm`;wasm-bindgen 版本须与 crate 对齐。
- **`graphicsIcon` 返回单个 Plugin**(非数组),消费方 `plugins: [graphicsIcon({...})]` 不展开。
- colorfont 插件选项类型叫 `ColorfontOptions`(在 `@graphics-icon/vite-umbrella` 的 `colorfont-plugin.ts`),引擎同名类型在
  import 处别名 `ColorfontEngineOptions`;旧名 `VitePluginColorfontOptions` 已废弃。
- 发布包(`packages/exports`)`dependencies` 须列全各引擎的第三方运行时依赖(svg2ttf/svgo/svgpath/cubic2quad/opentype.js/ttf2woff/
  sharp/maxrects-packer/scale-that-svg/vite-plugin-icons-spritesheet);**`fflate` 已移除**(未使用)。
- ttf2woff2 是 glyf-only(本引擎已全 glyf,OK)。
- 任何内联 `@codejoo/utils` 的包(含 colorfont)须把 svgo/svgpath/scale-that-svg 设为 external 并声明为 deps,
  否则 utils 惰性 import 的重依赖会被打进产物(svgo ~1MB)。
