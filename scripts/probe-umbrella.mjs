// Why the ruling's umbrella test misses 9 of the 24 named records, and whether the 236 it DOES catch
// are really unbuyable. Hiding a real item is worse than showing a fake one, so this errs toward proof.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const items = core.items;

const MISSED = ['fixer', 'exploration-lens', 'colorful-coating', 'midnight-milk', 'antifungal-salve', 'privacy-ward-fulu', 'conrasu-coin', 'aon-magical-medals'];
const priced = (it) => !!(it?.price && Object.values(it.price).some(Boolean));

console.log('=== the 8 item records the grade-suffix test misses ===');
for (const id of MISSED) {
  const it = items[id];
  if (!it) { console.log(`${id}: NOT AN ITEM`); continue; }
  // Anything sharing this id as a prefix — whatever the suffix happens to be.
  const kin = Object.keys(items).filter((k) => k !== id && k.startsWith(id + '-'));
  console.log(`${id}: price=${priced(it) ? JSON.stringify(it.price) : 'none'} lvl=${it.level} kin=${kin.length} [${kin.slice(0, 6).join(', ')}]`);
}

console.log('\n=== do the 236 really look unbuyable? sample their shape ===');
const GRADES = ['lesser', 'moderate', 'greater', 'major', 'true'];
const umbrella = [];
for (const [id, it] of Object.entries(items)) {
  if (GRADES.some((g) => id.endsWith('-' + g))) continue;
  const graded = GRADES.filter((g) => items[`${id}-${g}`]);
  if (graded.length < 2 || priced(it)) continue;
  umbrella.push({ id, it, graded });
}
// A real umbrella has NO level of its own either — the grades carry the levels.
const withLevel = umbrella.filter((u) => u.it.level > 0);
console.log(`${umbrella.length} candidates; ${withLevel.length} of them still declare a level > 0`);
for (const u of withLevel.slice(0, 12)) {
  const kids = u.graded.map((g) => `${g}:L${items[`${u.id}-${g}`].level}`).join(' ');
  console.log(`   ${u.id} L${u.it.level} → ${kids}`);
}

console.log('\n=== counter-check: PRICED records that still have 2+ graded twins (must NOT be hidden) ===');
let realBase = 0;
for (const [id, it] of Object.entries(items)) {
  if (GRADES.some((g) => id.endsWith('-' + g))) continue;
  const graded = GRADES.filter((g) => items[`${id}-${g}`]);
  if (graded.length >= 2 && priced(it)) realBase++;
}
console.log(`${realBase} priced base items with graded twins — the price test correctly spares them`);

console.log('\n=== how many of the 236 does the app already suppress some other way? ===');
const dupes = new Set(core.duplicateIds ?? []);
console.log(`duplicateIds in core: ${dupes.size}; overlap with umbrella: ${umbrella.filter((u) => dupes.has(u.id)).length}`);
