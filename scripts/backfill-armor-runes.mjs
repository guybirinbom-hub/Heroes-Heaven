/*
 * The two armour property runes that ship, both of them bare registrations.
 *
 * `RuneDef` carried id/name/slot/kind/value/level/price and `damage` — and `damage` is weapon-side.
 * So an armour property rune could not do anything mechanical at all: the records existed, could be
 * etched, and changed no number on the sheet.
 *
 * Wording quoted below, from the AoN mirror.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'adamantine-echo',
    // "when incorporated into an intact suit of armor, it functions as a +1 armor potency rune."
    // NOT recorded as kind:'potency' — that would put it in the potency slot instead of a property
    // slot, and occupying a property slot is the whole point of the relic.
    field: 'actsAs',
    value: { kind: 'potency', value: 1 },
  },
  {
    id: 'assisting',
    // "You can carry Bulk equal to 6 + your Strength modifier before becoming encumbered, and you
    //  can hold and carry a total Bulk of 11 + your Strength modifier."
    // The ordinary thresholds are 5 + Str and 10 + Str, so both rise by exactly one.
    field: 'passiveEffects',
    value: { bulkLimitBonus: 1 },
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
for (const f of FIXES) {
  const rune = core.runes?.[f.id];
  if (!rune) {
    console.error(`${f.id} is not a rune in core.json — refusing to write.`);
    process.exit(1);
  }
  if (rune.slot !== 'armor' || rune.kind !== 'property') {
    console.error(`${f.id} is ${rune.slot}/${rune.kind}, expected armor/property — refusing to write.`);
    process.exit(1);
  }
  rune[f.field] = f.value;
  entries.push({ category: 'runes', id: f.id, field: f.field, value: f.value });
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`wrote ${entries.length} armour-rune payloads (backfill ${backfill.length} → ${next.length})`);
