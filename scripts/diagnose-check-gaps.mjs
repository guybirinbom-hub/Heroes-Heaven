/*
 * WHERE does "Roll an check" come from? Answers it per record rather than in aggregate.
 *
 * AoN ships each record's prose twice: `markdown` keeps its links (`[Athletics](/Skills.aspx?ID=3)`)
 * and `text` is the same prose flattened. So for any record there are three possible stories:
 *
 *   OURS       — AoN names the skill (in text and/or markdown) and our import lost it. Our bug.
 *   AON-LINK   — AoN's `text` has the gap but `markdown` still carries the link. Recoverable from
 *                the other field; our fix simply read the wrong one.
 *   AON-BOTH   — both AoN fields have the gap. Nothing to recover; the defect is upstream.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));

const GAP = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an?\s+checks?\b/;
const NAMED = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an?\s+(?:DC\s+\d+\s+)?[A-Z][A-Za-z' -]{2,28}?\s+checks?\b/;
const LINKED = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an?\s+(?:DC\s+\d+\s+)?\[[^\]]+\]\([^)]*\)\s+checks?\b/;

const BUCKET_CAT = { feats: 'feat', items: 'equipment', spells: 'spell', actions: 'action', classFeatures: 'class-feature' };
const byName = new Map();
for (const cat of new Set(Object.values(BUCKET_CAT))) {
  const dir = path.join(MIRROR, cat);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const s = j._source ?? j;
      if (s?.name) byName.set(`${cat}|${String(s.name).toLowerCase()}`, s);
    } catch { /* ignore a malformed mirror file */ }
  }
}

const tally = { OURS: [], 'AON-LINK': [], 'AON-BOTH': [], 'NO-MIRROR': [] };
for (const [bucket, cat] of Object.entries(BUCKET_CAT)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (!GAP.test(String(rec.description ?? ''))) continue;
    const src = byName.get(`${cat}|${String(rec.name ?? '').toLowerCase()}`);
    if (!src) { tally['NO-MIRROR'].push(`${bucket}/${id}`); continue; }
    const text = String(src.text ?? '');
    const md = String(src.markdown ?? '');
    if (NAMED.test(text)) tally.OURS.push(`${bucket}/${id}`);
    else if (LINKED.test(md) || NAMED.test(md)) tally['AON-LINK'].push(`${bucket}/${id}`);
    else tally['AON-BOTH'].push(`${bucket}/${id}`);
  }
}

console.log('records still reading "Roll an check" in our data, by cause:\n');
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(10)} ${String(v.length).padStart(4)}`);

console.log('\nOURS (our bug, still unfixed):');
for (const x of tally.OURS) console.log('   ' + x);
console.log('\nNO-MIRROR (no record of that name in the mirror):');
for (const x of tally['NO-MIRROR'].slice(0, 25)) console.log('   ' + x);
if (tally['AON-LINK'].length) {
  console.log('\nRECOVERABLE from AoN markdown (our fix read the wrong field):');
  for (const x of tally['AON-LINK'].slice(0, 20)) console.log('   ' + x);
}
console.log('\nA few AON-BOTH, with what AoN actually prints:');
for (const x of tally['AON-BOTH'].slice(0, 6)) {
  const [bucket, id] = x.split('/');
  const src = byName.get(`${BUCKET_CAT[bucket]}|${String(core[bucket][id].name).toLowerCase()}`);
  const t = String(src.text ?? '');
  const m = new RegExp(GAP.source).exec(t);
  console.log(`   ${x}\n      AoN text: ${m ? JSON.stringify(t.slice(Math.max(0, m.index - 45), m.index + 45)) : '(no gap in AoN text — it is elsewhere)'}`);
}
