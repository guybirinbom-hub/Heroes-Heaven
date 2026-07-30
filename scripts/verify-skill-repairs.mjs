/*
 * Checks the 140 repairs actually match AoN, rather than trusting that they did.
 *
 * fix-stripped-skill-names.mjs substituted labels IN ORDER: the first gap got AoN's first named check,
 * the second got the second. That is only sound when the gaps and the named checks line up one to one.
 * If a record had two gaps and AoN named a skill for only one of them, the wrong label could land in
 * the wrong sentence — so every repaired phrase is compared against AoN's own wording here.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const overlay = JSON.parse(readFileSync(path.join(ROOT, 'scripts/data/effect-backfill.json'), 'utf8'));

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
    } catch { /* ignore */ }
  }
}

// The records this repair touched are exactly the description patches in the overlay.
const CHECK = /\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an?\s+((?:DC\s+\d+\s+)?[A-Za-z][A-Za-z' -]{0,28}?)\s+checks?\b/g;
const phrases = (t) => [...String(t).matchAll(CHECK)].map((m) => m[1].trim());

// Records where we deliberately differ from AoN because AoN's own text has a typo. Listed rather than
// pattern-matched so each one is a decision someone made, not a hole in the check.
const INTENTIONAL = new Map([
  ['feats/spelunker', 'AoN prints "a success on an Survival check" — we correct the article'],
]);

let ok = 0;
const mismatched = [];
const unchecked = [];

for (const patch of overlay) {
  if (patch.field !== 'description') continue;
  const cat = BUCKET_CAT[patch.category];
  const rec = core[patch.category]?.[patch.id];
  if (!cat || !rec) continue;
  const src = byName.get(`${cat}|${String(rec.name ?? '').toLowerCase()}`);
  if (!src) { unchecked.push(`${patch.category}/${patch.id} (no mirror)`); continue; }

  const ours = phrases(rec.description);
  const theirs = phrases(src.text);
  // Every label we now print must appear among AoN's, in the same order, ignoring the ones AoN leaves
  // blank (those are the deliberately-open rules and we did not touch them).
  const oursNamed = ours.filter(Boolean);
  const theirsNamed = theirs.filter(Boolean);
  const matches = oursNamed.every((label, i) => theirsNamed[i] === label);
  const key = `${patch.category}/${patch.id}`;
  if (INTENTIONAL.has(key)) { ok++; continue; }
  if (matches && oursNamed.length <= theirsNamed.length) ok++;
  else mismatched.push({ id: key, ours: oursNamed, theirs: theirsNamed });
}

console.log(`repairs verified against AoN : ${ok} (incl. ${INTENTIONAL.size} deliberate corrections of AoN typos)`);
console.log(`MISMATCHED                   : ${mismatched.length}`);
for (const m of mismatched.slice(0, 20)) {
  console.log(`   ${m.id}\n      ours:   ${JSON.stringify(m.ours)}\n      AoN:    ${JSON.stringify(m.theirs)}`);
}
if (unchecked.length) console.log(`\nnot checkable: ${unchecked.length}`);
