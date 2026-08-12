/*
 * Tensile Absorption — an inventor ARMOR innovation modification granting resistance to bludgeoning
 * equal to half your level — was missing `armor-innovation-modification` from its `otherTags`.
 *
 * That tag is exactly what the modification picker filters on, so the record shipped complete (level
 * 7, a real `resistances` entry) and could never be selected by anybody. Its 21 siblings carry it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const ID = 'tensile-absorption';
const TAG = 'armor-innovation-modification';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const rec = core.classFeatures[ID];
if (!rec) {
  console.error(`${ID} is not a class feature — refusing to write.`);
  process.exit(1);
}
if ((rec.otherTags ?? []).includes(TAG)) {
  console.log('already tagged.');
  process.exit(0);
}
// Only tag it if its siblings really are tagged that way, and it looks like one of them.
const siblings = Object.values(core.classFeatures).filter((f) => (f.otherTags ?? []).includes(TAG));
if (siblings.length < 5) {
  console.error(`only ${siblings.length} records carry "${TAG}" — that is not an established tag. Refusing.`);
  process.exit(1);
}
if (!/armor/i.test(String(rec.description ?? ''))) {
  console.error(`${ID}'s text does not mention armor — refusing to tag it as an armor modification.`);
  process.exit(1);
}

const value = [...(rec.otherTags ?? []), TAG];
rec.otherTags = value;
writeFileSync(CORE, JSON.stringify(core));

const entry = { category: 'classFeatures', id: ID, field: 'otherTags', value };
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const next = [...backfill.filter((e) => key(e) !== key(entry)), entry];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`tagged ${ID} (${siblings.length} siblings carry "${TAG}"); backfill ${backfill.length} -> ${next.length}`);
