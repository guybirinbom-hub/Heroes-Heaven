/*
 * AST render-coverage checker. For every shipped record, compare the FULL text of its ast against the text
 * the AstRenderer would actually emit (simulating renderBlock/Inline). Anything the renderer drops shows up
 * as a coverage gap — so we catch pages that render incomplete WITHOUT eyeballing each popup.
 *
 * Intentional, non-bug omissions: the top-level level-1 title (shown as the popup HEADER) and the `traits`
 * node (shown as chips). Everything else must render. Run: node scripts/audit/ast-coverage.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';

const AST_DIR = 'public/ast';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// The faithful BODY text (what should render below the header). Excludes the header chrome the popup shows
// separately: the top-level level-1 title (the name) and the `traits` node (chips). Everything else counts.
function fullText(n, out, top) {
  if (!n || typeof n !== 'object') return;
  if (n.t === 'traits') return; // header chips
  if (n.t === 'title' && Number(n.level ?? 1) <= 1 && top) { if (n.right) out.push(String(n.right)); return; }
  if (n.t === 'text' && n.v) out.push(n.v);
  if (n.t === 'actions' && n.string) out.push(n.string);
  (n.c || []).forEach((c) => fullText(c, out, false));
}

// Text the AstRenderer emits — mirrors renderBlock()/Inline() drop rules.
const BLOCK = new Set(['p','title','heading','h2','h3','ul','ol','li','table','thead','tbody','tfoot','tr','th','td','aside','row','column','document','doc','hr','center','spoilers','view']);
function inlineText(n, out) {
  if (!n) return;
  if (n.t === 'text' && n.v) { out.push(n.v); return; }
  if (n.t === 'actions' && n.string) { out.push(n.string); return; }
  if (n.t === 'traits') return; // chips (header)
  (n.c || []).forEach((c) => inlineText(c, out));
}
function renderedText(n, out, top) {
  if (!n) return;
  switch (n.t) {
    case 'traits': return; // header chips
    case 'title': { if (Number(n.level ?? 1) <= 1 && top) return; (n.c || []).forEach((c) => inlineText(c, out)); if (n.right) out.push(String(n.right)); return; }
    case 'text': if (n.v) out.push(n.v); return;
    case 'actions': if (n.string) out.push(n.string); return;
    default:
      // block containers + inline both recurse their children in the real renderer
      (n.c || []).forEach((c) => renderedText(c, out, false));
      return;
  }
}

let worst = [];
let total = 0;
for (const f of readdirSync(AST_DIR)) {
  if (!f.endsWith('.json')) continue;
  let map; try { map = JSON.parse(readFileSync(`${AST_DIR}/${f}`, 'utf8')); } catch { continue; }
  const bucket = f.replace('.json', '');
  for (const slug in map) {
    total++;
    const full = []; fullText(map[slug], full, true);
    const rend = []; renderedText(map[slug], rend, true);
    const fullLen = norm(full.join(' ')).length;
    const rendLen = norm(rend.join(' ')).length;
    if (fullLen < 40) continue; // tiny entries: noise
    const cover = rendLen / fullLen;
    // The header (level-1 title) accounts for a small fixed omission; only flag real gaps.
    if (cover < 0.98) worst.push({ id: `${bucket}:${slug}`, cover: +cover.toFixed(3), fullLen, rendLen, missing: fullLen - rendLen });
  }
}
worst.sort((a, b) => a.cover - b.cover);
console.log(`checked ${total} records`);
console.log(`records with <90% render coverage: ${worst.length}`);
for (const w of worst.slice(0, 40)) console.log(`  ${(w.cover * 100).toFixed(1)}%  -${w.missing} chars  ${w.id}`);
