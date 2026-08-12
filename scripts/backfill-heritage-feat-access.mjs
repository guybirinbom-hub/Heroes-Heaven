/*
 * Heritages that open ANOTHER ancestry's feat list.
 *
 * "In addition, you can select elf, half-elf, and human feats whenever you gain an ancestry feat."
 * The slot filter took your own ancestry's feats and, for a versatile heritage, the heritage's own —
 * a third list had nowhere to be declared.
 *
 * ⚠ ONLY TRAITS THAT ACTUALLY SHIP ON FEATS ARE WRITTEN. Measured in this data:
 *     human      42 ancestry feats
 *     half-elf    0
 *     half-orc    0
 *     geniekin    0
 * The Remaster folded the half-ancestry lists into their parents, so writing `half-elf` would widen
 * the pool by nothing while recording the gap as closed — the exact failure the empty-picker guards
 * exist to stop. Ardande names `geniekin` and gets NOTHING for the same reason; its own feats
 * already arrive through the versatile lane.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};
const text = (id) => {
  const h = core.heritages[id];
  if (!h) fail(`heritages/${id} does not ship`);
  return String(h.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
/** How many ANCESTRY feats actually carry a trait. */
const featsWith = (trait) =>
  Object.values(core.feats).filter((f) => f.category === 'ancestry' && (f.traits ?? []).includes(trait)).length;

const entries = [];
const skipped = [];
for (const id of ['aon-half-elf', 'aon-half-orc', 'ardande']) {
  const t = text(id);
  // "you can select elf, half-elf, and human feats" / "You can choose from ardande feats, geniekin
  // feats, and feats from your ancestry"
  const m = t.match(/(?:you can (?:select|choose from)) ([^.]*?feats)[^.]*\./i);
  if (!m) fail(`${id} no longer states which feat lists it opens`);
  const named = [...m[1].matchAll(/([a-z][a-z-]+) feats/gi)].map((x) => x[1].toLowerCase());
  if (!named.length) fail(`${id}: could not read any trait out of "${m[1]}"`);

  const her = core.heritages[id];
  const own = new Set([her.ancestryId, her.versatile ? id : null].filter(Boolean));
  const live = named.filter((tr) => !own.has(tr) && featsWith(tr) > 0);
  const dead = named.filter((tr) => !own.has(tr) && featsWith(tr) === 0);

  if (!live.length) {
    skipped.push(`${id}: names ${named.join(', ')} — nothing to add (${dead.join(', ') || 'all already covered'} carried by 0 feats)`);
    continue;
  }
  her.extraAncestryFeatTraits = live;
  entries.push({ category: 'heritages', id, field: 'extraAncestryFeatTraits', value: live });
  console.log(`  ${id.padEnd(16)} +${live.join(', ')} (${live.map((tr) => `${tr}=${featsWith(tr)}`).join(', ')})${dead.length ? `  · skipped dead: ${dead.join(', ')}` : ''}`);
}

for (const s of skipped) console.log(`  SKIP ${s}`);
if (!entries.length) fail('nothing resolved');

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wired ${entries.length} heritages (backfill ${backfill.length} → ${next.length})`);
