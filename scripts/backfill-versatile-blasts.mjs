/*
 * "Add the following damage types to those you can choose for Elemental Blasts of that element:
 *  air cold, earth poison, fire cold, metal electricity, water acid, wood poison."
 *
 * There was nothing to add to. Each element's PRINTED list of damage types ("Air 1d6 electricity or
 * slashing") was modelled as a single type, so the second printed option was already missing and a
 * feat that widens the list had no list to widen.
 *
 * The pairs are parsed from the feat's own text rather than typed in, so a data change that alters
 * the wording surfaces here instead of leaving a stale hardcoded map behind.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const ID = 'versatile-blasts';
const ELEMENTS = ['air', 'earth', 'fire', 'metal', 'water', 'wood'];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const rec = core.feats[ID];
if (!rec) {
  console.error(`${ID} is not a feat in core.json — refusing to write.`);
  process.exit(1);
}

// The clause ships as a markdown bullet list ("- **air** cold - **earth** poison …") in some
// printings and as a comma list in others; strip the markup and accept either separator.
const text = String(rec.description ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\*+/g, '')
  .replace(/\s+/g, ' ');
const listed = text.match(/damage types to those you can choose for Elemental Blasts of that element:\s*([^.]+)/i);
if (!listed) {
  console.error(`${ID}'s description does not contain the expected clause — refusing to guess:\n  ${text.slice(0, 220)}`);
  process.exit(1);
}

const additions = {};
for (const pair of listed[1].split(/,|(?:^|\s)-\s/)) {
  if (!pair.trim()) continue;
  const [el, ...rest] = pair.trim().replace(/^-\s*/, '').toLowerCase().split(/\s+/);
  const type = rest.join(' ').trim();
  if (!ELEMENTS.includes(el) || !type) {
    console.error(`could not read "${pair.trim()}" as <element> <damage type> — refusing to write.`);
    process.exit(1);
  }
  (additions[el] ??= []).push(type);
}
if (Object.keys(additions).length !== ELEMENTS.length) {
  console.error(`expected all six elements, read: ${Object.keys(additions).join(', ')} — refusing to write.`);
  process.exit(1);
}

rec.blastTypeAdditions = additions;
writeFileSync(CORE, JSON.stringify(core));

const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const entry = { category: 'feats', id: ID, field: 'blastTypeAdditions', value: additions };
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const next = [...backfill.filter((e) => key(e) !== key(entry)), entry];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`read from the feat's own text: ${JSON.stringify(additions)}`);
console.log(`(backfill ${backfill.length} → ${next.length})`);
