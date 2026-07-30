// Generalising the umbrella test from "-lesser/-greater" to "any suffix", and hunting the false
// positives that would hide a real item. Read-only.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const items = core.items;
const priced = (it) => !!(it?.price && Object.values(it.price).some(Boolean));

const ids = Object.keys(items);
const kinOf = (id) => ids.filter((k) => k !== id && k.startsWith(id + '-'));

const unpriced = ids.filter((id) => !priced(items[id]));
console.log(`items: ${ids.length}; unpriced: ${unpriced.length}`);

const GRADES = ['lesser', 'moderate', 'greater', 'major', 'true'];
const strict = new Set(unpriced.filter((id) => GRADES.filter((g) => items[`${id}-${g}`]).length >= 2));
const loose = new Set(unpriced.filter((id) => kinOf(id).length >= 2));

console.log(`strict (2+ GRADE twins): ${strict.size}`);
console.log(`loose  (2+ any-suffix kin): ${loose.size}`);

const added = [...loose].filter((id) => !strict.has(id));
console.log(`\nloose adds ${added.length} beyond strict — every one, so a false positive can be spotted:`);
for (const id of added) {
  const kin = kinOf(id);
  console.log(`  ${id}  (L${items[id].level}, ${items[id].itemType})  kin: ${kin.slice(0, 5).join(', ')}${kin.length > 5 ? ` +${kin.length - 5}` : ''}`);
}

// A REAL umbrella's level matches its cheapest variant — it is the summary of that family. An item
// whose kin are all higher-level unrelated things is a base item, not a summary.
console.log('\n--- of those, which have a kin AT THE SAME LEVEL (the summary signature)? ---');
for (const id of added) {
  const kin = kinOf(id);
  const same = kin.filter((k) => items[k].level === items[id].level);
  console.log(`  ${id}: ${same.length}/${kin.length} kin share its level ${items[id].level}`);
}

console.log('\n--- unpriced items with FEWER than 2 kin (cannot be caught by any kin test) ---');
const orphans = unpriced.filter((id) => kinOf(id).length < 2);
console.log(`${orphans.length} of them; a sample:`);
for (const id of orphans.slice(0, 20)) console.log(`  ${id} (L${items[id].level}, ${items[id].itemType})`);
