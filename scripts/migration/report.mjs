/*
 * Renders scripts/migration/out/join.json's unmatched list as a browsable page.
 *
 * 963 names in a flat markdown file is not reviewable, and reviewing them is the whole point: the user
 * knows this data far better than we do and needs to spot, category by category, where things like
 * `Agate` and `Accept Echo` actually live in the Archives. So: grouped, counted, filterable, with the
 * records Heroes Heaven generates itself marked so they are not mistaken for gaps.
 *
 * Re-runnable:  node scripts/migration/report.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const j = JSON.parse(readFileSync('scripts/migration/out/join.json', 'utf8'));
const groups = Object.entries(j.unmatched).sort((a, b) => b[1].length - a[1].length);
const total = groups.reduce((n, [, l]) => n + l.length, 0);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Records Heroes Heaven synthesises per implement — the archive never had them and should not. */
const isSynth = (n) => /^(Adept|Paragon) Benefit \(/.test(n);

const t = j.totals || {};
const stats = [
  ['records in core.json', t.records],
  ['matched to an archive doc', (t.idmap || 0) + (t.slug || 0) + (t['slug-any'] || 0) + (t['slug-noparen'] || 0)],
  ['hand-authored (correct)', t.authored],
  ['not found', t.none],
];

const body = groups.map(([g, list]) => `
  <section class="grp" data-g="${esc(g)}">
    <h2>${esc(g)} <span class="n">${list.length}</span></h2>
    <ul>${list.map((x) => {
      const n = x.name || x.key;
      return `<li data-n="${esc(n.toLowerCase())}"${isSynth(n) ? ' class="synth"' : ''}>${esc(n)}${isSynth(n) ? '<em>Heroes Heaven generates this</em>' : ''}</li>`;
    }).join('')}</ul>
  </section>`).join('');

const html = `<title>Not found in the Archives — ${total} records</title>
<style>
  :root{--bg:#14161f;--card:#1c1f2b;--line:#333a4d;--soft:#262a3a;--tx:#e6e8f0;--dim:#9aa0b4;--faint:#6b7186;--ac:#6366f1;--warn:#fbbf24}
  @media (prefers-color-scheme:light){:root{--bg:#eef0f6;--card:#fff;--line:#d5d9e8;--soft:#f4f5fa;--tx:#1a1d2a;--dim:#565d75;--faint:#808799;--ac:#4f52d9;--warn:#a3690a}}
  :root[data-theme=light]{--bg:#eef0f6;--card:#fff;--line:#d5d9e8;--soft:#f4f5fa;--tx:#1a1d2a;--dim:#565d75;--faint:#808799;--ac:#4f52d9;--warn:#a3690a}
  :root[data-theme=dark]{--bg:#14161f;--card:#1c1f2b;--line:#333a4d;--soft:#262a3a;--tx:#e6e8f0;--dim:#9aa0b4;--faint:#6b7186;--ac:#6366f1;--warn:#fbbf24}
  body{background:var(--bg);color:var(--tx);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 20px 72px}
  h1{font-size:26px;font-weight:680;letter-spacing:-.02em;margin-bottom:8px}
  .lede{color:var(--dim);max-width:64ch;margin-bottom:20px}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
  .stat{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--dim)}
  .stat b{color:var(--tx)}
  .bar{position:sticky;top:0;background:var(--bg);padding:10px 0 12px;border-bottom:1px solid var(--line);margin-bottom:18px;z-index:5}
  input{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 12px;color:var(--tx);font:inherit;font-size:14px}
  input:focus{outline:2px solid var(--ac);outline-offset:1px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .chips button{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;padding:4px 9px;border-radius:20px;border:1px solid var(--line);background:var(--card);color:var(--dim);cursor:pointer}
  .chips button.on{background:var(--ac);border-color:var(--ac);color:#fff}
  .chips button span{opacity:.7;margin-left:4px}
  section{margin-bottom:26px}
  h2{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ac);padding-bottom:8px;border-bottom:1px solid var(--line);margin-bottom:10px;display:flex;gap:8px;align-items:baseline}
  h2 .n{color:var(--faint);font-size:11.5px}
  ul{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 14px}
  li{font-size:13.5px;padding:3px 0;color:var(--tx);border-bottom:1px solid var(--soft)}
  li.synth{color:var(--faint)}
  li em{color:var(--warn);font-size:11px;font-style:normal;margin-left:6px}
  .hidden{display:none}
  footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--faint);font-size:13px;max-width:70ch}
  code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.87em;background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
</style>
<div class="wrap">
  <h1>Not found in the Archives</h1>
  <p class="lede">${total} Heroes Heaven records with no matching Archives document, after matching by id,
  by slug across all 93 categories, by slug without a trailing <code>(…)</code>, and by word order.
  These are questions for you — none of them will be filled from Foundry.</p>
  <div class="stats">${stats.map(([k, v]) => `<span class="stat">${esc(k)} <b>${v ?? '?'}</b></span>`).join('')}</div>
  <div class="bar">
    <input id="q" type="search" placeholder="Search all ${total} names…" autocomplete="off">
    <div class="chips" id="chips"><button data-f="" class="on">all <span>${total}</span></button>${
      groups.map(([g, l]) => `<button data-f="${esc(g)}">${esc(g)} <span>${l.length}</span></button>`).join('')
    }</div>
  </div>
  ${body}
  <footer>Generated by <code>scripts/migration/report.mjs</code> from <code>out/join.json</code>.
  Names in grey are ones Heroes Heaven generates itself — the Archives never had them and should not.</footer>
</div>
<script>
  const q = document.getElementById('q');
  const secs = [...document.querySelectorAll('.grp')];
  let filter = '';
  function apply() {
    const term = q.value.trim().toLowerCase();
    for (const s of secs) {
      const on = !filter || s.dataset.g === filter;
      let shown = 0;
      for (const li of s.querySelectorAll('li')) {
        const hit = on && (!term || li.dataset.n.includes(term));
        li.classList.toggle('hidden', !hit);
        if (hit) shown++;
      }
      s.classList.toggle('hidden', shown === 0);
      const n = s.querySelector('.n');
      if (n) n.textContent = term || filter ? shown : n.dataset.all ?? (n.dataset.all = n.textContent, n.textContent);
    }
  }
  q.addEventListener('input', apply);
  document.getElementById('chips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.f;
    for (const x of document.querySelectorAll('#chips button')) x.classList.toggle('on', x === b);
    apply();
  });
</script>`;

writeFileSync('scripts/migration/out/unmatched.html', html);
console.log(`wrote scripts/migration/out/unmatched.html — ${total} records in ${groups.length} groups`);
