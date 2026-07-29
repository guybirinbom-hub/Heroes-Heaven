/*
 * Add the champion's "Blessing of the Devoted" choice group to core.json.
 *
 * `blessing-of-the-devoted` (level 3) reads "Choose one of the following blessings", but the class
 * carried no choice group, so no picker was ever shown and no blessing was ever selected. One of the
 * three options — Blessed Swiftness — grants a +5-foot status bonus to Speed that no champion could get.
 *
 * The options are discovered from `otherTags`, the same signal the importer uses.
 *
 * DURABILITY: `scripts/import-core-v2.mjs` is the canonical producer and it does NOT regenerate
 * `classes` — it carries them from the pristine reference, which has no blessing group. So an
 * EXTRA_CHOICES entry in the old import-core.mjs (added there too, for that pipeline) is not enough:
 * the group must also go into scripts/data/effect-backfill.json, which v2 applies LAST over whatever
 * the reference produced. Without that this survives exactly until the next `npm run data`.
 *
 * Written minified: pretty-printing core.json once inflated it by 4 MB.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/core.json';
const TAG = 'blessing-of-the-devoted';
const db = JSON.parse(readFileSync(FILE, 'utf8'));

const cls = db.classes.champion;
if (!cls) throw new Error('champion class missing');

const options = Object.values(db.classFeatures)
  .filter((f) => (f.otherTags ?? []).includes(TAG))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((f) => ({ id: f.id, name: f.name, description: f.description }));

if (options.length < 2) throw new Error(`only ${options.length} blessing options found — expected 3`);

cls.extraChoices = (cls.extraChoices ?? []).filter((g) => g.id !== 'blessing');
cls.extraChoices.push({ id: 'blessing', name: 'Blessing of the Devoted', pickByLevel: { 3: 1 }, options });

writeFileSync(FILE, JSON.stringify(db));

// Carry it in the import overlay too, or the next regeneration drops it (see DURABILITY above).
const OVERLAY = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(OVERLAY, 'utf8'));
const patch = { category: 'classes', id: 'champion', field: 'extraChoices', value: cls.extraChoices };
const key = (p) => `${p.category}|${p.id}|${p.field}`;
writeFileSync(OVERLAY, JSON.stringify([...existing.filter((p) => key(p) !== key(patch)), patch], null, 2));

console.log(`champion Blessing of the Devoted: ${options.length} options (${options.map((o) => o.id).join(', ')}) + overlay entry`);
