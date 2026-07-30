// Produces the umbrella candidate list for audit + the final data file the app reads.
//
// The rule, and why each part exists:
//   • no price          — AoN's summary row for an item family carries no price; the grades do.
//   • 2+ kin            — ids that extend this one. One twin could be a genuine base + upgrade pair;
//                         two or more is a family with a summary at its head.
//   • no mechanical field — the guard that spares anything the app actually does something with.
//                         Energy Robe is unpriced with four kin and would have been hidden, but it
//                         carries effectChoices: it IS the ownable item and the kin are AoN's rows
//                         for each choice. Same for `staff` and `sling`, spared by their damage.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const items = core.items;
const ids = Object.keys(items);

const priced = (it) => !!(it?.price && Object.values(it.price).some(Boolean));
const MECH = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value', 'heldSpells', 'dynamicSkillBonus', 'spellSlotBonus'];
const mechanical = (it) => MECH.some((k) => it[k] != null && (!Array.isArray(it[k]) || it[k].length));
const kinOf = (id) => ids.filter((k) => k !== id && k.startsWith(id + '-'));
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const out = [];
for (const id of ids) {
  const it = items[id];
  if (priced(it) || mechanical(it)) continue;
  const kin = kinOf(id);
  if (kin.length < 2) continue;
  out.push({
    id,
    name: it.name,
    itemType: it.itemType,
    level: it.level,
    kin: kin.map((k) => ({ id: k, name: items[k].name, level: items[k].level, price: items[k].price ?? null })),
    text: strip(it.description).slice(0, 900),
  });
}
out.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(path.join(ROOT, 'work/abc/umbrella-candidates.json'), JSON.stringify(out, null, 1));

const chunkSize = Math.ceil(out.length / 4);
for (let i = 0; i < 4; i++) {
  writeFileSync(path.join(ROOT, `work/abc/umbrella${i}.json`), JSON.stringify(out.slice(i * chunkSize, (i + 1) * chunkSize), null, 1));
}
console.log(`${out.length} umbrella candidates → work/abc/umbrella-candidates.json (+ 4 chunks)`);
console.log(`kin=2 (weakest evidence): ${out.filter((o) => o.kin.length === 2).length}`);
