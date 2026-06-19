// 生成自包含的图标画廊 index.html(内联 @font-face + 图标类 + 搜索 + 点击复制)。
// 字体以 ./<file> 相对引用(与 index.html 同目录),可直接用浏览器打开预览。
import type { BuildResult, VitePluginColorfontOptions } from '@colorfont/core'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildGalleryHtml(result: BuildResult, options: VitePluginColorfontOptions): string {
  const fontName = options.fontName
  const baseClass = (options.baseSelector ?? '.icon').replace(/^\./, '')
  const classPrefix = options.classPrefix ?? 'icon-'
  // 内联字体为 data URI → 画廊 HTML 自包含,file:// 双击即可打开预览(无需 web 服务)。
  const dataUrl = new Map(
    result.assets.map((a) => [a.fileName, `data:font/${a.format};base64,${Buffer.from(a.source).toString('base64')}`]),
  )
  const fontCss = result.emitCss((a) => dataUrl.get(a.fileName) ?? `./${a.fileName}`)
  const glyphs = result.metadata.glyphs
  const colorCount = glyphs.filter((g) => g.color).length

  const cells = glyphs
    .map((g) => {
      const cls = classPrefix + g.name
      const cp = 'U+' + g.codepoint.toString(16).toUpperCase()
      const ch = String.fromCodePoint(g.codepoint)
      return (
        `<button class="cell" data-name="${esc(g.name)}" data-cls="${esc(cls)}" data-char="${esc(ch)}" title="${esc(g.name)} (${cp})">` +
        `<i class="${baseClass} ${esc(cls)}"></i>` +
        `<span class="nm">${esc(g.name)}</span>` +
        `<span class="cp">${cp}${g.color ? ' · 彩' : ''}</span>` +
        `</button>`
      )
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fontName)} · 图标画廊</title>
<style>
${fontCss}
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #0f1115; color: #e6e6e6; }
header { position: sticky; top: 0; padding: 16px 20px; background: #151823; border-bottom: 1px solid #262b38; z-index: 2; }
h1 { margin: 0 0 4px; font-size: 18px; }
.meta { color: #9aa3b2; font-size: 12px; }
.bar { margin-top: 12px; display: flex; gap: 10px; align-items: center; }
#q { flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid #2b3242; background: #0f1115; color: #e6e6e6; font-size: 14px; }
.hint { color: #6b7385; font-size: 12px; white-space: nowrap; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; padding: 20px; }
.cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px; border: 1px solid #262b38; border-radius: 10px; background: #161a24; color: #e6e6e6; cursor: pointer; transition: .12s; font: inherit; }
.cell:hover { border-color: #4c8bf5; background: #1b2130; transform: translateY(-1px); }
.cell i { font-size: 34px; line-height: 1; color: #cfd6e4; }
.cell .nm { font-size: 11px; color: #c3cad8; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell .cp { font-size: 10px; color: #6b7385; }
#toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px); background: #4c8bf5; color: #fff; padding: 10px 18px; border-radius: 8px; opacity: 0; transition: .2s; pointer-events: none; font-size: 13px; }
#toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<header>
  <h1>${esc(fontName)}</h1>
  <div class="meta">${glyphs.length} 个图标 · ${colorCount} 个彩色 · 档位 tech() 回退链(colrv1 → otsvg → colrv0 → mono)</div>
  <div class="bar">
    <input id="q" type="search" placeholder="搜索图标名…" autocomplete="off">
    <span class="hint">点击复制类名 · Shift+点击复制字符</span>
  </div>
</header>
<div class="grid" id="grid">
${cells}
</div>
<div id="toast"></div>
<script>
const toast = (msg) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1400);
};
function copy(text) {
  const done = () => toast('已复制: ' + text);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else { fallbackCopy(text, done); }
}
function fallbackCopy(text, done) {
  // file:// 下 navigator.clipboard 不可用,退回 execCommand
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-9999px';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败,请手动复制'); }
  document.body.removeChild(ta);
}
document.getElementById('grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell'); if (!cell) return;
  copy(e.shiftKey ? cell.dataset.char : cell.dataset.cls);
});
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const kw = q.value.trim().toLowerCase();
  for (const cell of document.querySelectorAll('.cell'))
    cell.style.display = !kw || cell.dataset.name.toLowerCase().includes(kw) ? '' : 'none';
});
</script>
</body>
</html>
`
}
