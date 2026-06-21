import { defineConfig } from 'tsup'

export default defineConfig({
  // 6 个子路径出口 + 5 个 CLI bin。
  // /vite = 伞插件(@graphics-icon/vite-umbrella);/bitmap·/svg·/imagemin·/colorfont·/unused = 各引擎(引擎函数 + runCli + 类型)。
  entry: [
    'src/vite.ts',
    'src/bitmap.ts',
    'src/svg.ts',
    'src/imagemin.ts',
    'src/colorfont.ts',
    'src/unused.ts',
    'src/bin.ts',
    'src/bin-bitmap.ts',
    'src/bin-svg.ts',
    'src/bin-colorfont.ts',
    'src/bin-unused.ts',
  ],
  format: ['esm'],
  // 把私有 workspace 包(伞插件 + 引擎 + utils)的类型内联进本包 .d.ts,使发布后类型自包含。
  dts: { resolve: [/^@graphics-icon\//, /^bitmap-icons/, /^svg-icons/, /^@codejoo\//] },
  clean: true,
  treeshake: true,
  // 把伞插件 + 引擎 + utils 的源/产物内联进本包(自包含);vite 作为 peer 保持 external。
  noExternal: ['@graphics-icon/vite-umbrella', '@codejoo/colorfont', 'bitmap-icons', 'svg-icons', '@codejoo/imagemin', '@codejoo/unused', '@codejoo/utils'],
  external: ['vite'],
})
