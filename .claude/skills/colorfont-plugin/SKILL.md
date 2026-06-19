---
name: colorfont-plugin
description: >-
  vite-plugin-colorfont(SVG 图标 → 彩色 webfont)项目的架构、关键选型抉择与实测结果。
  在 D:\workspaces\colorfont 这个 monorepo 上工作(改引擎/写表/wasm/打包/性能)时参考本 skill。
---

# vite-plugin-colorfont —— 项目总览 / 选型抉择 / 实测

纯 JS API + 预编译可移植 wasm 的 Vite 插件:把一个目录的 SVG 图标编译成**彩色** webfont(mono / COLRv0 / OT‑SVG / COLRv1),带 `tech()` 回退链、类型化虚拟模块、稳定码位。**面向 npm 社区开源,非自用。无 node-gyp、安装期零原生编译。**

代码在 `D:\workspaces\colorfont`(独立 pnpm monorepo,不在 let188 仓库)。包:
- `@colorfont/core` —— 引擎(纯 JS,内联进插件发布)
- `vite-plugin-colorfont` —— 唯一对外发布物(tsup 内联 core + 打包两个 wasm)
- `@colorfont/cli` —— build/watch/check
- `colrv1-writer`(Rust→wasm) —— COLRv1 写表
- `woff2-wasm`(Rust→wasm) —— 可调质量 woff2 编码

## 构建管线(每次 build)
1. `loadIcons` 读 SVG。
2. `assignCodepoints`(码位锁 `codepoints.json`,PUA 从 0xE000,墓碑不回收)。
3. **构建缓存检查**:key=sha256(引擎版本+影响产物的选项+图标内容+码位);命中直接复用上次字体字节,跳过 3–6。
4. `prepareIcons`(worker 池,线程数=CPU 一半封顶 8):每图标 `normalizeSvg`(svgo×2 + viewBox 放大到 1024 整数化)→ `parseSvg` → `detectColor`(按色拆层)→ `toOutline`(svgpath+cubic2quad,路径→glyf 二次曲线 `d`)。**单色快路径**:`colorFormat:'mono'` 时跳过每层轮廓/inner。
5. `buildFlavors`(每档一 worker 并行):
   - mono:`svg2ttf` 组装 glyf。
   - colrv0:`buildColorGlyf`(base+层命名字形)→ 手写 COLRv0+CPAL 注入(`glyf/sfnt-inject.ts`)。
   - otsvg:glyf base + 手写 `SVG ` 表注入。
   - colrv1:`buildColorGlyf` → 交 `write-fonts` wasm 加 COLR/CPAL(传 gid)。
   - 每档再 `toWoff2`(ttf2woff2 wasm,质量可配)/ `toWoff`。
6. `emitCss`(双 @font-face + tech 链,每 url 带浏览器注释)+ `emitDts`(IconName 联合 + icons/baseName/colorIcons 对象)。

## 关键选型抉择(及为什么)

- **引擎全 glyf,不用 CFF**(用户拍板):opentype.js **只能写 CFF(OTTO),写不了 glyf**;glyf 比 CFF 小约 33% 且解锁原生 woff2 生态。→ 用 `svg2ttf` 组装 glyf,**opentype.js 降为只读解析**(`glyf/glyph-map.ts` 取 name→gid)。删了 build-glyf/font-assembly。
- **color gid 按 glyph-name 解析,层字形优先 emit**:svg2ttf 会按 (advanceWidth,d) 去重并可能丢名;层优先 + 本地去重记 canonical → 层经 byName、base 经 cmap 都解析正确(`color-glyphs.ts`)。这是 color 写表的命门。
- **COLRv1 必须 Rust→wasm**:纯 JS 写不出 COLRv1(opentype.js 仅 v0;手搓=32 种 Paint+DAG 不现实)。用 fontations `write-fonts`。**OT‑SVG 不能被 COLRv1 取代,必须共存**:Safari 不渲染 COLRv1、Chromium 永不渲染 OT‑SVG。tech 链:colrv1→otsvg→colrv0→mono。
- **woff2 换成 ttf2woff2(Rust)→wasm,替掉 woff2-encoder**:woff2-encoder(Google)固定 q11、无质量旋钮。**实测 q9 比 q11 快 ~31×、体积仅 +6%;q10 快 3×、+0.8%**——所谓"woff2 1.2s 地板"只是 q11 的代价。ttf2woff2 用纯 Rust brotli(无 C 绑定)可编 wasm。质量可配:**默认 dev=9 / 生产=11**。同 q11 ttf2woff2 比 woff2-encoder 快 ~14%、同体积,但 RSS 多 ~40MB。
- **暂不全量 Rust 重写**(已评估):woff2/COLRv1 早是 wasm;**wasm 单线程**——"一个 wasm 干全部"会让 3 档 woff2 串行反而更慢;混合架构极限 ~1.5s,仅 2×,成本/风险高(usvg≠svgo、OT‑SVG 须嵌原始 SVG)。
- **构建缓存**(参考 imagemin 内容哈希):命中复用上次产物,重复构建 ~10×(1852ms→186ms)。默认 node_modules/.cache;可指向仓库内团队共享。
- **dev 冷启动不阻塞**:plugin `buildStart` 不 await(后台生成),`load`/字体中间件/HMR 按需 await → server 秒起。
- **mingw 不需要**(实测):默认 gnu 工具链自带链接器 + 预编译 import 库够编这两个 crate(无 windows-sys,不触发 dlltool/as)。当年踩坑的 dlltool/as 是 `wasm-bindgen-cli`(依赖 windows-sys)才需要,用预编译 wasm-bindgen 绕开。
- **稳定码位**:PUA 从 0xE000,墓碑策略(删图标不回收码位),`codepoints.json` 提交。

## 实测结果(1000 图标基准)
- 生产 q11 ~2.9–3.2s;dev q9 ~1.7s;单色 mono q9 ~1.35s。瓶颈在 q9 时是 ~1s 的 prepare(svgo)。
- woff2 质量(colrv0 887KB TTF,ttf2woff2 wasm):q11 852ms/264KB · q10 317ms/266KB · **q9 31ms/281KB** · q7 27ms/290KB。
- 缓存:命中 186ms(vs 全建 1852ms)。
- 多线程:flavor 并行是大头(串行 4.2s→多线程 3.15s);prepare 池 >8 worker 因 svgo 加载启动争用反变慢,故封顶 8。
- 与竞品(均**仅单色**,svgicons2svgfont):vite-svg-2-webfont 1207ms/148MB(4 格式);**我们单色更重**(svgo+放大1024+多 wasm+worker),价值在彩色(它们做不了)。@sumsolution 未发 npm、github 缺构建产物,不可开箱用。
- 8 项自测全绿:smoke / verify / colrv1-e2e / colrv1-degrade / colrv1-frontend / cli / plugin(虚拟模块+dev 中间件)/ acceptance(真实 vite build+dev)+ acceptance-dist(发布 dist 形态)。

## 从源码构建 wasm(贡献者;终端用户无需)
默认工具链须 **gnu**(MSVC 缺 link.exe 时):
```
rustup toolchain install stable-x86_64-pc-windows-gnu && rustup default stable-x86_64-pc-windows-gnu
rustup target add wasm32-unknown-unknown
```
`wasm-bindgen-cli` 在 gnu 上 `cargo install` 会因 windows-sys 缺 as/dlltool 失败 → **下载预编译 wasm-bindgen** 放 PATH(版本须匹配 wasm-bindgen crate)。每个 crate:`cargo build --release --target wasm32-unknown-unknown` + `wasm-bindgen … --target nodejs --out-dir pkg`;**pkg/package.json 必须 `{"type":"commonjs"}`**(根是 type:module)。`vite-plugin` 的 `npm run build` = tsup + `scripts/copy-wasm.mjs`(把两个 pkg 拷进 dist/woff2、dist/colrv1)。

## 易踩的点
- 改引擎产物格式 → bump `cache/build-cache.ts` 的 `VERSION` 常量,否则缓存供旧产物。
- 改 wasm → 重编 + `copy-wasm`;wasm-bindgen 版本须与 crate 对齐。
- `vite-plugin` deps 必须列全 core 的第三方运行时依赖(svg2ttf/svgo/svgpath/cubic2quad/opentype.js/ttf2woff/fflate),因 tsup 内联 core 但不内联其依赖。
- ttf2woff2 是 **glyf-only**(本引擎已全 glyf,OK);别给它喂 CFF。
- 发布前改 package.json 的 repository/homepage,`npm login` 后 `pnpm pub`(已写好 pub 脚本:build+bump+git+publish)。
