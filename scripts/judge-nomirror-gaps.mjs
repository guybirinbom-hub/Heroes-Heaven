/*
 * The 22 records with no mirror match: broken, or deliberately open?
 *
 * The mirror can't answer (no record of that name), but the SENTENCE can. A gap that reads as complete
 * English — "attempt a check to Escape", "a check to Recall Knowledge" — names a task the rules leave
 * to whichever skill applies. A gap mid-clause — "Roll an check against its Fortitude DC" — is a
 * missing word.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const GAP = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an?\s+checks?\b/;

const BUCKET_CAT = { feats: 'feat', items: 'equipment', spells: 'spell', actions: 'action', classFeatures: 'class-feature' };
const names = new Set();
for (const cat of new Set(Object.values(BUCKET_CAT))) {
  const dir = path.join(MIRROR, cat);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const src = s._source ?? s;
      if (src?.name) names.add(`${cat}|${String(src.name).toLowerCase()}`);
    } catch { /* ignore */ }
  }
}

// "Roll an check" is only ever broken; the article was left dangling. "attempt a check to <Task>" or
// "a check with a skill …" is complete: the rules name the task, not the skill.
const BROKEN = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an\s+checks?\b/;
const OPEN_SHAPE = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+a\s+checks?\s+(?:to|with|using|against(?: the)? DC|for)\b/;

const rows = [];
for (const [bucket, cat] of Object.entries(BUCKET_CAT)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const d = String(rec.description ?? '');
    if (!GAP.test(d)) continue;
    if (names.has(`${cat}|${String(rec.name ?? '').toLowerCase()}`)) continue; // the mirror covers it
    const m = GAP.exec(d);
    const snippet = d.slice(Math.max(0, m.index - 55), m.index + 60).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    rows.push({
      id: `${bucket}/${id}`,
      verdict: BROKEN.test(d) ? 'BROKEN (dangling "an")' : OPEN_SHAPE.test(d) ? 'OPEN (rules name the task, not the skill)' : 'UNCLEAR — read it',
      snippet,
    });
  }
}

const by = {};
for (const r of rows) (by[r.verdict] ??= []).push(r);
console.log(`${rows.length} records with no mirror match:\n`);
for (const [v, list] of Object.entries(by)) {
  console.log(`--- ${v}: ${list.length}`);
  for (const r of list) console.log(`   ${r.id}\n      …${r.snippet}…`);
}
