import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  // 把公共子模块 @codejoo/utils 打进本包 dist;第三方(vite)保持 external。
  // Bundle the shared @codejoo/utils into this package's dist; keep third-party external.
  noExternal: ['@codejoo/utils'],
})
