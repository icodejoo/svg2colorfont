---
name: bitmap-icons
description: 在 D:\workspaces\colorfont 上维护 bitmap-icons 时参考。位图雪碧图引擎:用 sharp + maxrects-packer 把 png/jpg/webp/avif 打成单张图集,产出自适应样式、入口脚本(含 IconName 类型)与可选坐标 JSON。双形态(引擎 bitmapIcons + CLI runCli + 内部 Vite 插件工厂,经发布包 graphics-icon 的子路径 graphics-icon/bitmap 与 bitmap-icons CLI 对外)。多实例 items[],按实例 cache/throwable。涉及共享 @codejoo/utils、buildStamp 指纹、共享缓存目录 .cache.graphics(统一 groupCache)、sharp 按需动态导入、单 bin 与不旋转约束、幂等写入等关键考量时阅读本文。
---

# bitmap-icons

## 目的

`bitmap-icons`(私有内部包)把一个目录下的位图(png/jpg/jpeg/webp/avif)打包成「一张」雪碧图集,并自动生成调用方直接可用的边车文件。它是 graphics-icon monorepo 中四个引擎之一,与 colorfont、svg-icons、imagemin 共享 `@codejoo/utils`,经发布包 `graphics-icon`(packages/exports)的子路径 `graphics-icon/bitmap` 与 CLI `bitmap-icons` 对外。

**双形态**(与 imagemin 对齐):
- 引擎 `bitmapIcons(options)`(Vite 之外一次性生成所有图集;经子路径 `graphics-icon/bitmap` 导入)。
- CLI `runCli`(经发布包 bin `bitmap-icons --config <file>`)。
- 内部 Vite 插件工厂 `bitmapIconsVite(opts): Plugin`(经 `graphicsIcon({ bitmapIcons })` 集成,不单独对外导出)。

## 功能

- 枚举源图 → sharp 量测尺寸 → 内容指纹缓存判定 → maxrects-packer 打包 → sharp 合成到透明 RGBA 画布 → 编码(webp/png)。
- 产边车:
  - 样式(.css/.scss):基类 `.${prefix}` + 每图类 `.${prefix}-${name}`,带 px 默认尺寸 + `aspect-ratio` + 百分比 `background-size`/`background-position`,改 width 即按容器自适应。
  - 入口脚本(.ts/.js):相对 `import` 样式(副作用注入)与图(Vite 解析为带 hash 的 URL),导出 `iconsImage`、`iconsName`;`.ts` 额外产 `IconName` 字面量联合类型。
  - 可选坐标 JSON:`{ image, width, height, pixelRatio, frames }`,供 canvas/运行时。
- 多实例 `{ ...公共, items: [...] }` 可生成多张独立图集(公共参数合并进每项,每实例独立缓存/产物)。
- Vite 钩子:`buildStart`(build/dev 启动都跑)、`watchChange` / `handleHotUpdate`(仅当变更落在某 `inputDir` 内才重生成)。失败行为由每实例 `throwable` 决定(默认 true 抛错中止,false 告警续跑)。

## 用法(示例)

```ts
// vite.config.ts —— 经伞包统一出口(单个插件)
import graphicsIcon from "graphics-icon/vite"

export default {
  plugins: [
    graphicsIcon({
      // 省略 cacheName → .cache.graphics/<派生名>.json;cache:false 删缓存重建;throwable:false 告警续跑
      bitmapIcons: { items: [
        {
          inputDir: "src/sprites/common",
          prefix: "icon",
          padding: 2,
          pixelRatio: 1, // 源图为 @2x/@3x 时改 2/3
          output: {
            image: "src/sprites/common.sprite.webp",
            style: "src/sprites/common.sprite.css",
            script: "src/sprites/common.sprite.ts",
            json: "src/sprites/common.sprite.json",
          },
        },
      ] },
    }),
  ],
}
```

单独使用(Vite 之外):`import { bitmapIcons } from "graphics-icon/bitmap"`（私有包名 `bitmap-icons` 仅 monorepo 内部用）。

调用方:

```ts
import { iconsImage, type IconName } from "@/sprites/common.sprite.ts"
// 样式已被脚本副作用注入;按 IconName 用类名 <i class="icon icon-foo" />
```

## 关键考量

- **共享 utils**:`buildStamp`(`@codejoo/utils/fingerprint`,缓存指纹约定,与 svg-icons 同源)、`toGlobList`/`matchesAnyGlob`、`writeTextIfChanged`/`writeBufferIfChanged`,以及统一的 **`groupCache`**(`@codejoo/utils`,管多实例缓存)全部来自 `@codejoo/utils`(`workspace:*`)。不要在本包重新实现这些原语。跨包导入「不带」文件扩展名;包内相对导入「必须」带 `.ts`。
- **按实例缓存 + 共享缓存目录 `.cache.graphics`**:每个 `items[]` 项一套独立缓存,经统一 `groupCache` 管理。缓存文件名 Vite 用 `cacheName`(仅文件名,落 `.cache.graphics/`)、独立用 `cacheFilename`(全路径);省略则按 `output.image` 派生。`cache:false` 删该实例缓存 + 旧产物并重建。(旧的插件级 `cacheDir`、全路径 `cacheFile`、`resolveCacheFile`/`pruneCache` 三件套已被 `groupCache` 取代。)
- **sharp 按需动态导入**:`sharp` 与 `maxrects-packer` 用 `await import()` 在 `generateSheet` 内部加载,绝不在模块顶层。仅 `import { bitmapIconsVite }` 不会拉起/分配这些重依赖。
- **`allowRotation: false`**:CSS background 切片不能旋转,打包器强制不旋转。
- **单 bin 约束**:必须落「一个」bin;单图超 `maxWidth×maxHeight` 或总量放不下 → 明确报错,绝不静默拆成多张。
- **幂等写入**:图与文本边车都「内容/字节未变则跳过」,避免无谓 mtime/git 抖动与 dev HMR 循环。

## 易踩的点

- 产物命名约定 `*.sprite.{webp,png}` 会被自动排除出源扫描,所以产物可与源图放同目录;别给源图取这个名字。
- 源图按文件名排序后再打包,保证跨机器布局可复现;改名会改布局/缓存。
- 精灵名须匹配 `/^[a-zA-Z_][\w-]*$/`,且不能重名,否则抛错。
- `output.image` 扩展名只接受 `.webp` 或 `.png`,其余报错。
- `GENERATOR_VERSION` 控制产物结构版本:改了样式/脚本生成逻辑要 +1 让旧缓存失效。
- TS 产物导出名固定为 `iconsImage`/`iconsName`/`IconName`,不随 `prefix` 变。
- `pixelRatio` 只影响固定 px 类(逻辑尺寸 = 源尺寸 / pixelRatio);自适应类天然与密度无关。
- 改动需经 monorepo 中心校验(`pnpm install`/build/tsc 由父级统一跑),本包不单独装/构建。
