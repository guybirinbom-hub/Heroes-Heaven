/*
 * AST text-artifact scanner. Reproduces the AstRenderer's text cleaning + drop rules, then scans the
 * resulting RENDERED text of every shipped record for garbage a reader would see:
 *   - unsubstituted <%…%> templates
 *   - leaked HTML tags (`</ br>`, `<br>`, `<i>`, …)
 *   - a stray markdown marker (`##`, `---`) left as content
 *   - a `row` that wraps a `table` (would mash the table inline unless recursed)
 *   - `sup`/continuation fragments that split a sentence across blocks
 * Run after any AstRenderer change: node scripts/audit/ast-artifacts.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';

const AST_DIR = 'public/ast';

// Mirror of AstRenderer.clean()
function clean(s) {
  let out = String(s == null ? '' : s);
  if (out.indexOf('<%') !== -1) out = out.replace(/<%[^>]*?>/g, '').replace(/ {2,}/g, ' ');
  if (out.indexOf('<') !== -1) out = out.replace(/<\/?\s*(?:br|hr|p|div|span|i|b|em|strong|sup|sub|ul|ol|li|table|tr|td|th|a)\b[^>]*>/gi, ' ').replace(/ {2,}/g, ' ');
  if (out.indexOf('\\') !== -1) out = out.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return out;
}

const counts = { template: [], leakedTag: [], strayMarker: [], rowWrapsTable: [], splitSentence: [] };
let total = 0;

function textOf(n) { let s = ''; (function w(x){ if(x.t==='text') s+=clean(x.v||''); (x.c||[]).forEach(w); })(n); return s; }

for (const f of readdirSync(AST_DIR)) {
  if (!f.endsWith('.json')) continue;
  let map; try { map = JSON.parse(readFileSync(`${AST_DIR}/${f}`, 'utf8')); } catch { continue; }
  const bucket = f.replace('.json', '');
  for (const slug in map) {
    total++;
    const id = `${bucket}:${slug}`;
    let flaggedTemplate = false, flaggedTag = false, flaggedMarker = false, flaggedRow = false, flaggedSplit = false;
    (function walk(n, parent) {
      // structural checks
      if (n.t === 'row' && (n.c || []).some((c) => c.t === 'table')) flaggedRow = true;
      if ((n.t === 'sup' || n.t === 'sub') && parent) flaggedSplit = flaggedSplit; // counted below via siblings
      // per-text-node artifact checks on the CLEANED text
      if (n.t === 'text') {
        const raw = String(n.v || '');
        const cl = clean(raw);
        if (/<%/.test(cl)) flaggedTemplate = true;
        if (/<\/?\s*[a-z][a-z0-9]*\b[^>]*>/i.test(cl)) flaggedTag = true; // any residual tag-like sequence
      }
      // a paragraph whose entire cleaned text is a stray markdown marker
      if (n.t === 'p') { const t = textOf(n).trim(); if (/^#{1,6}$/.test(t) || /^[-*_]{3,}$/.test(t)) flaggedMarker = true; }
      (n.c || []).forEach((c) => walk(c, n));
    })(map[slug], null);
    // split-sentence: a top-level sup sibling among p's (the (F)/(R)/(W) pattern)
    const top = map[slug].c || [];
    if (top.some((c, i) => (c.t === 'sup' || c.t === 'sub') && i > 0 && i < top.length - 1)) flaggedSplit = true;

    if (flaggedTemplate) counts.template.push(id);
    if (flaggedTag) counts.leakedTag.push(id);
    if (flaggedMarker) counts.strayMarker.push(id);
    if (flaggedRow) counts.rowWrapsTable.push(id);
    if (flaggedSplit) counts.splitSentence.push(id);
  }
}

console.log(`scanned ${total} records\n`);
const show = (label, arr, note) => {
  console.log(`${label}: ${arr.length}  ${note || ''}`);
  if (arr.length) console.log('   e.g. ' + arr.slice(0, 8).join(', '));
};
show('unsubstituted <%…%> templates leaking to text', counts.template, '(clean() should strip — nonzero = bug)');
show('leaked HTML tags in cleaned text', counts.leakedTag, '(clean() should strip — nonzero = bug)');
show('stray markdown markers as a block', counts.strayMarker, '(renderer drops these — informational)');
show('row wrapping a table', counts.rowWrapsTable, '(renderer now recurses — informational)');
show('sentences split by sup/continuation', counts.splitSentence, '(renderer now coalesces — informational)');
