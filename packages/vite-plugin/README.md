# vite-plugin-colorfont

> Compile a folder of **SVG icons → a color icon webfont** at build time, with a `tech()` fallback `@font-face`, a typed virtual module, and stable codepoints. **JS API + prebuilt portable wasm — no `node-gyp`, no native compile on install.**

One `colorFormat: 'auto'` turns a directory of SVGs into up to four font "flavors" that coexist in one `@font-face` fallback chain — modern browsers pick the best they support:

| flavor | what | browsers | produced by |
|---|---|---|---|
| `mono` | single‑color `glyf` outlines (always emitted, ultimate fallback) | all | `svg2ttf` (glyf, pure JS) |
| `colrv0` | flat‑color `COLR`/`CPAL` layers | all (incl. old Safari) | hand‑written `COLR`v0+`CPAL`, injected into glyf |
| `otsvg` | embedded `SVG ` table (gradients, full SVG) | Safari / iOS | hand‑written `SVG ` table, injected into glyf |
| `colrv1` | gradient/transform `COLR` v1 — **opt‑in** | Chrome/Edge 98+, Firefox 107+ | Rust `write-fonts` → **wasm** (prebuilt, bundled) |

The container (`woff2`) is encoded by **`ttf2woff2` (Rust) → wasm** (prebuilt, bundled), with a configurable Brotli quality.

> COLRv1 and OT‑SVG are **complementary**: Safari doesn't render COLRv1, Chromium never renders OT‑SVG. The generated `@font-face` lists `tech(color-colrv1) → tech(color-svg) → tech(color-colrv0) → mono`, each `url(...)` annotated with the browser it targets. A browser that supports none of the color tables (or doesn't understand `tech()`) falls back to a plain **mono** `@font-face` and shows the single‑color silhouette in the CSS `color`.

## Install

```bash
npm i -D vite-plugin-colorfont
# vite is a peer dependency (^5 || ^6 || ^7 || ^8)
```

The published package **bundles the prebuilt wasm** (woff2 encoder + COLRv1 writer). Consumers need nothing beyond Node + Vite — no Rust, no `node-gyp`, no install‑time compile.

## Quick start

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import colorfont from 'vite-plugin-colorfont'

export default defineConfig({
  plugins: [
    colorfont({
      input: 'src/icons',        // folder of *.svg
      outDir: 'src/.colorfont',  // where codepoints.json is kept (commit it!)
      fontName: 'MyIcons',
      colorFormat: 'auto',       // mono + (colrv0 + otsvg) when any icon is multicolor
    }),
  ],
})
```

```ts
// app entry
import 'virtual:colorfont.css'                 // injects @font-face + .icon-* rules
import { icons, type IconName } from 'virtual:colorfont'

const name: IconName = 'home'                  // type-safe; a typo is a compile error
el.className = `icon ${icons[name]}`           // <i class="icon icon-home"></i>
```

```html
<i class="icon icon-home"></i>           <!-- mono: colorable via CSS `color` -->
<i class="icon icon-logo-color"></i>     <!-- color where supported, mono silhouette elsewhere -->
```

## Coloring

- **Mono icons are plain glyf outlines** → fully colorable with CSS `color` (like any icon font).
- **Color icons** use a fixed palette; layers authored with `currentColor` follow CSS `color`, and `@font-palette-values` can re‑theme `COLR` fonts (a COLR‑only perk; OT‑SVG generally isn't recolorable).
- On a browser without color‑font support, a color icon degrades to its **mono silhouette in the text color** — never blank.

## Options

| option | type | default | notes |
|---|---|---|---|
| `input` | `string \| string[]` | — | icon source dir(s) (`*.svg`) |
| `outDir` | `string` | — | where `codepoints.json` is written |
| `fontName` | `string` | — | OpenType family / `@font-face` family |
| `colorFormat` | `'auto'\|'mono'\|'colrv0'\|'otsvg'\|'colrv1'` | `'auto'` | per‑icon detection; see flavors |
| `formats` | `('woff2'\|'woff'\|'ttf')[]` | `['woff2']` | output containers (woff2 covers all modern browsers) |
| `woff2Quality` | `number` (1–11) | `11` (prod) | Brotli quality. Dev auto‑uses **9** (~30× faster, +6% size). Lower = faster build, slightly larger |
| `colrv0` | `boolean` | `true` | emit the COLRv0 flavor (turn off if you only target COLRv1+OT‑SVG) |
| `threads` | `boolean \| 'auto'` | `'auto'` | worker pool for per‑icon prep (≥200 icons) + one worker per flavor |
| `cache` | `boolean \| { dir }` | `true` | skip the whole pipeline when icons+options+codepoints are unchanged (see below) |
| `devFast` | `boolean` | `true` | dev/serve uses `woff2Quality:9` for near‑instant HMR; `build` keeps your quality |
| `emitDemo` | `boolean` | `false` | also emit `colorfont/<name>.css` + `<name>.ts` + a self‑contained `index.html` gallery |
| `baseSelector` | `string` | `'.icon'` | base class carrying `font-family` |
| `classPrefix` | `string` | `'icon-'` | per‑icon class prefix → `.icon-home` |
| `unitsPerEm` | `number` | `1000` | em grid |
| `codepointsFile` | `string` | `<outDir>/codepoints.json` | **commit this** for stable codepoints |
| `cssModuleId` / `apiModuleId` | `string` | `virtual:colorfont.css` / `virtual:colorfont` | virtual module ids |
| `watch` | `boolean` | `true` | dev: rebuild + HMR on icon change |

## Build cache

When `input` SVGs, the relevant options, and assigned codepoints are unchanged, the plugin **reuses the previous fonts** instead of re‑running svgo / svg2ttf / woff2 — making dev restarts, HMR and CI near‑instant (~10× on a 1000‑icon set). Default cache dir is `node_modules/.cache/colorfont` (local, not committed). Point `cache: { dir: 'build/.colorfont-cache' }` at a committed folder to **share the cache across a team / CI**, the way an imagemin hash cache is committed.

## Virtual module typing

```ts
declare module 'virtual:colorfont.css'
declare module 'virtual:colorfont' {
  export const codepoints: Record<string, number>
  export const icons: Record<string, string>        // name → CSS class
  export const baseName: string                      // base class (no dot)
  export const colorIcons: Record<string, true>      // colorIcons[name] === true if multicolor
  export function iconContent(name: string): string  // the PUA char
}
```

## Stable codepoints

Icons get Unicode PUA codepoints (from `0xE000`) recorded in `codepoints.json`. **Commit this file** — new icons take the next free codepoint, removed icons keep theirs (tombstoned, never recycled), so a glyph's codepoint never changes meaning across releases. Use `@colorfont/cli check` in CI to fail on uncommitted drift.

## COLRv1 (opt‑in, gradients)

`colorFormat: 'colrv1'` additionally emits a COLRv1 flavor (gradients/transforms) written by a bundled Rust→wasm module (`write-fonts`). It's **off by default**; when off, that wasm is never loaded. When on but the wasm can't load, the plugin warns and falls back to `colrv0 + otsvg`.

## Notes

- Fonts are emitted to `dist/colorfont/*`; the extracted CSS references them by absolute URL, so Vite logs a benign "didn't resolve at build time … resolved at runtime" — expected.
- Icons should be single fills for `mono`/`colrv0`; **stroke icons should be outlined to fills first**. Gradients are preserved only in `otsvg`/`colrv1` (COLRv0 uses a flat fallback).
- For plain monochrome icon fonts, lightweight mono‑only plugins are leaner; this plugin's reason to exist is **color** (COLRv1 / OT‑SVG / COLRv0) with a robust mono fallback.

## Building from source (contributors only)

> End users do **not** need any of this — the npm package ships prebuilt wasm.

The two wasm modules are **Rust**, compiled to `wasm32-unknown-unknown` and bundled into `dist/` by `npm run build`:

- `packages/woff2-wasm` — `ttf2woff2` (pure‑Rust Brotli) → quality‑configurable woff2 encoder.
- `packages/colrv1-writer` — `write-fonts` (fontations) → COLRv1/CPAL writer.

To rebuild them you need a **non‑Node toolchain**:

1. **Rust** via [rustup](https://rustup.rs).
2. The **`x86_64-pc-windows-gnu` toolchain** (on Windows) — the MSVC toolchain needs Visual Studio's `link.exe`; if you don't have it, use gnu:
   ```bash
   rustup toolchain install stable-x86_64-pc-windows-gnu
   rustup default stable-x86_64-pc-windows-gnu
   rustup target add wasm32-unknown-unknown
   ```
   The gnu toolchain's bundled linker is sufficient for these crates (they pull no `windows-sys`), so an external MinGW is **not** required.
3. **`wasm-bindgen-cli`** matching the `wasm-bindgen` crate version. On the gnu toolchain `cargo install wasm-bindgen-cli` can fail to build (its `windows-sys` dep needs `as`/`dlltool`); install a **prebuilt** `wasm-bindgen` instead (download from its GitHub releases) and put it on `PATH`.

Then per crate:
```bash
cd packages/woff2-wasm   # or packages/colrv1-writer
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/woff2_writer.wasm --out-dir pkg --target nodejs
# pkg/package.json must be {"type":"commonjs"} (repo root is type:module)
```
`packages/vite-plugin` then `npm run build` runs `tsup` + `scripts/copy-wasm.mjs`, which copies both `pkg/` into `dist/woff2` and `dist/colrv1`.

## License

MIT
