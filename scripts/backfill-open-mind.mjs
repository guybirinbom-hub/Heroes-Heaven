/*
 * `Feat.passiveEffects` had exactly one carrier — open-mind, with `{ loreBonus: 1 }` — and no reader,
 * so an audit flagged it as a dead field needing one.
 *
 * It does not. Open Mind's own text, in the app AND in the AoN mirror, is "Choose one cantrip from
 * the occult spell list. You can cast this spell as an occult innate spell at will." There is no Lore
 * bonus in it. The field is a mis-transcription, and writing a reader would have GRANTED a bonus the
 * feat does not have — a worse outcome than the dead field.
 *
 * Removed rather than read. `null` is how the overlay expresses "this field should not be here".
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const f = core.feats['open-mind'];
if (!f) {
  console.error('open-mind is not a feat — nothing to do.');
  process.exit(1);
}
if (/lore/i.test(String(f.description ?? ''))) {
  console.error("open-mind's description mentions Lore after all — refusing to remove the field.");
  process.exit(1);
}
if (f.passiveEffects === undefined) {
  console.log('already removed.');
  process.exit(0);
}

delete f.passiveEffects;
writeFileSync(CORE, JSON.stringify(core));

const entry = { category: 'feats', id: 'open-mind', field: 'passiveEffects', value: null };
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const next = [...backfill.filter((e) => key(e) !== key(entry)), entry];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`removed open-mind.passiveEffects (backfill ${backfill.length} -> ${next.length})`);
