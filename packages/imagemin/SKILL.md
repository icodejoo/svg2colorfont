---
name: imagemin
description: >-
  @codejoo/imagemin(graphics-to-font 套件的图片压缩引擎 + CLI，packages/imagemin)的目的、功能与用法。
  在 D:\workspaces\colorfont 上维护 @codejoo/imagemin 时参考本 skill：修改 sharp/svgo 压缩管线、
  内容哈希缓存与重命名检测、SVG 放大归一化、CLI 行为或默认配置时均适用。
---

# @codejoo/imagemin —— 图片压缩引擎 + CLI

## 目的
对仓库内的图片做「一次性、就地、有损但视觉近无损」的压缩，面向 Web 交付。
位图走 sharp，矢量走 svgo；用内容哈希缓存保证每张图只压一次，且对重命名/移动友好、可随源码提交团队共享。

## 功能
- 支持格式：png / jpg / jpeg / webp / avif / tif / tiff / gif（sharp）+ svg（svgo）。
- 内容哈希缓存 + 反查表：识别重命名/移动/复制（内容指纹命中即跳过，仅迁移缓存 key），并剪枝磁盘已不存在的旧条目。
- 缓存默认落共享目录 `.cache.graphics/imagemin.json`（由 `@codejoo/utils/cache` 的 `resolveCacheFile('imagemin', ...)` 解析）。
- SVG 小 viewBox 防变形：先用 `@codejoo/utils/scale-svg` 的 `scaleSvgToWidth` 等比放大到目标宽（默认 1024），再 svgo `floatPrecision:0` 整数化。
- 自带并发池 `mapPool`（默认并发 8，无第三方依赖）。

## 用法

### CLI（本包 bin: `codejoo-imagemin`；经发布包 `graphics-icon` 暴露为 `image-min`）
CLI 逻辑在 `src/bin.ts`,导出 **`runCli(argv)`**（经 index 再导出），发布包 bin `image-min` 即薄包装它——
其它三引擎(colorfont/bitmap/svg)的 CLI 也照此模式由发布包统一暴露,四者能力对齐。
- 指定文件（如 pre-commit 暂存图）：`image-min a.png b.svg`
- 全量扫描：`image-min --all [目录...]`（缺省扫描 `process.cwd()`）；`--scan` 同义。
- 自定义配置：`image-min --all --config ./imagemin.config.ts`（动态 import 后浅合并到 `defaultOptions` 之上，用户优先）。
- 只「压缩 + 更新缓存」，不碰 git。

### 编程式
```ts
import { imagemin, defaultOptions } from "graphics-icon/imagemin"

const { changed, results, cacheFile } = await imagemin(
  ["src/assets/logo.png", "src/icons/a.svg"],
  { ...defaultOptions, concurrency: 4 },
)
```

## 关键考量 / 易踩的点
- **内容哈希缓存 + 重命名检测**：缓存以「最终成品内容 hash」为准而非路径；`reverse`（hash→path）反查表识别移动/复制，启动时剪枝磁盘上已删除的 key。改逻辑务必保留正向表/反查表/剪枝三件套，只换 JSON load/save/sha256 原语（来自 `@codejoo/utils`）。
- **共享缓存目录**：`cacheFile` 是可选项；省略 → `.cache.graphics/imagemin.json`。不要在引擎里硬编码缓存路径。
- **sharp / svgo 按需动态导入**：两者必须在 `compress()` 内 `await import()`，绝不在模块顶层 import（仅 `import type` 允许，会被擦除）。这样导入引擎 API 不会拉起重依赖。
- **就地有损改写仅更小才写回**：普通压缩只有结果更小才覆盖原图（绝不放大/劣化）；唯独 SVG 归一化 `force=true`（有意变换）即使略大也写回，以统一 viewBox。需保真的母版图请加进 `exclude`。
- **SVG 放大归一化复用 utils**：用 `@codejoo/utils/scale-svg` 的 `scaleSvgToWidth`，不要在本包重建 scale-svg（旧的 `core/scale-svg.ts` 已删除）。含 `<filter>` 的复杂 SVG 不放大、走安全精度 `floatPrecision ?? 2`。
- **SVG 雪碧图陷阱**：`preset-default` 会把雪碧图（`<symbol>` 集合）里未引用的 symbol 删光、压成空 `<svg/>`。默认 `exclude` 已排除 `icons.svg` / `*.sprite.*`，新增雪碧图命名要落进这些 glob。
- **glob 语义**：include/exclude 一律以「仓库根相对路径 + 正斜杠」匹配（兼容 Windows）；`toGlobList`/`matchesAnyGlob` 从 `@codejoo/utils/glob` 来，本包仅做转发再导出。
