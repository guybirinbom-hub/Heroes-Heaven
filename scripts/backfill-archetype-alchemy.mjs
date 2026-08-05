/*
 * Three archetype dedications entitle a character to daily alchemical items and none of them said so.
 *
 * `Feat.advancedAlchemy` exists and buildCharacter reads it — but only the alchemist CLASS set a
 * budget, so an Alchemist / Herbalist / Poisoner Dedication produced `advancedAlchemy: undefined`.
 * The Alchemy panel was then gated on `classId === 'alchemist'`, which hid it from exactly the
 * characters who would go looking: entitled to the items, able to see and prepare none of them.
 *
 * Counts are PARSED from each feat's own sentence, never assumed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const num = (s) => (/^\d+$/.test(s) ? Number(s) : WORD[String(s).toLowerCase()]);

/** "create up to 4 versatile vials", "create four alchemical poison consumables each day". */
const RE = /(?:create|creating)(?: up to)? (\d+|one|two|three|four|five|six|seven|eight)\b/i;

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const rows = [];
const skipped = [];

for (const id of ['alchemist-dedication', 'herbalist-dedication', 'poisoner-dedication']) {
  const f = core.feats[id];
  if (!f) { skipped.push(`${id}: not a feat`); continue; }
  if (f.advancedAlchemy) { skipped.push(`${id}: already carries advancedAlchemy`); continue; }
  const text = String(f.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(RE);
  const items = m && num(m[1]);
  if (!items) { skipped.push(`${id}: could not read an item count from its text — not written`); continue; }
  // `addInt` is deliberately NOT set: none of these three says "+ your Intelligence modifier", unlike
  // the alchemist class's own 4 + Int. Adding it would hand an archetype more than it is owed.
  const value = { items };
  f.advancedAlchemy = value;
  entries.push({ category: 'feats', id, field: 'advancedAlchemy', value });
  rows.push(`${id}: ${items} items — "${m[0]}"`);
}

if (skipped.length) console.warn(`SKIPPED:\n  ` + skipped.join('\n  '));
if (!entries.length) { console.error('nothing written'); process.exit(1); }

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`\nwrote ${entries.length} (backfill ${backfill.length} -> ${next.length})`);
for (const r of rows) console.log('  ' + r);
