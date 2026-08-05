/*
 * "You gain all the mechanical benefits of the <X> heritage you selected at 1st level."
 *
 * Both feats that say this require a VERSATILE heritage — which is exactly what the character's one
 * `heritageId` records. So the 1st-level ancestry heritage was never stored anywhere, and there was
 * nothing for the feat to dereference: it could be taken and grant nothing, forever.
 *
 * Two pieces: the picker that records which heritage it was (an open choice over that ancestry's
 * heritages, versatile ones excluded — a versatile heritage is what you took INSTEAD), and the flag
 * that says to apply it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'late-awakener',
    ancestry: 'awakened-animal',
    prompt: 'The awakened animal heritage you selected at 1st level',
  },
  {
    id: 'awakened-yaoguai-heritage',
    ancestry: 'yaoguai',
    prompt: 'The yaoguai heritage you selected at 1st level',
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];

for (const f of FIXES) {
  const feat = core.feats[f.id];
  if (!feat) {
    console.error(`${f.id} is not a feat in core.json — refusing to write.`);
    process.exit(1);
  }
  if (feat.choice) {
    console.error(`${f.id} already carries a choice (${feat.choice.flag}) — refusing to replace it.`);
    process.exit(1);
  }
  // The pool must be non-empty, or the feat gets a picker with nothing in it.
  const pool = Object.values(core.heritages).filter((h) => h.ancestryId === f.ancestry && !h.versatile);
  if (!pool.length) {
    console.error(`${f.id}: no non-versatile ${f.ancestry} heritages ship — refusing to write.`);
    process.exit(1);
  }
  // And the feat's own text must actually name that ancestry's heritage.
  const text = String(feat.description ?? '').toLowerCase();
  if (!text.includes(f.ancestry.replace('-', ' ')) || !text.includes('1st level') === !text.includes('first level')) {
    console.error(`${f.id}: its description does not read as "the ${f.ancestry} heritage you selected at 1st level" — refusing to write.`);
    process.exit(1);
  }

  const choice = {
    flag: 'firstHeritage',
    prompt: f.prompt,
    kind: 'open',
    from: { type: 'heritage', ancestry: f.ancestry },
  };
  feat.choice = choice;
  feat.secondHeritage = true;
  entries.push({ category: 'feats', id: f.id, field: 'choice', value: choice });
  entries.push({ category: 'feats', id: f.id, field: 'secondHeritage', value: true });
  console.log(`${f.id}: ${pool.length} ${f.ancestry} heritages offered (${pool.map((h) => h.id).join(', ')})`);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`wrote ${entries.length} fields (backfill ${backfill.length} → ${next.length})`);
