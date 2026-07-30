// The widened umbrella rule + guards, and what survives them. Read-only.
//
// Hiding a real item is the failure that matters, so every guard here exists to spare something the
// player can actually own: a price, a resolved choice, or any mechanical field at all.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const items = core.items;
const ids = Object.keys(items);

const priced = (it) => !!(it?.price && Object.values(it.price).some(Boolean));
// Any field that means the app does something with this record. A pure AoN summary row has none.
const MECH = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value', 'heldSpells', 'dynamicSkillBonus', 'spellSlotBonus'];
const mechanical = (it) => MECH.filter((k) => it[k] != null && (!Array.isArray(it[k]) || it[k].length));

const kin = new Map(ids.map((id) => [id, ids.filter((k) => k !== id && k.startsWith(id + '-'))]));

const candidates = ids.filter((id) => !priced(items[id]) && kin.get(id).length >= 2);
console.log(`unpriced with 2+ kin: ${candidates.length}`);

const spared = candidates.filter((id) => mechanical(items[id]).length);
console.log(`\nSPARED by the mechanical-field guard: ${spared.length}`);
for (const id of spared) console.log(`  ${id} — has ${mechanical(items[id]).join(', ')}`);

const hidden = candidates.filter((id) => !mechanical(items[id]).length);
console.log(`\nWOULD HIDE: ${hidden.length}`);

// Does every grade/variant the umbrella summarises survive? Hiding a family whole would be a disaster.
let familyLost = 0;
for (const id of hidden) {
  const visible = kin.get(id).filter((k) => !hidden.includes(k));
  if (!visible.length) { console.log(`  !! ${id} — hiding it leaves NO visible variant`); familyLost++; }
}
console.log(`families with no surviving variant: ${familyLost}`);

// The owner named 24. Where does each land?
const axes = JSON.parse(readFileSync(path.join(ROOT, 'work/escalation-axes.json'), 'utf8'));
const named = axes['A. umbrella records'].map((r) => r.id);
console.log('\n=== the 24 named A records ===');
for (const id of named) {
  const where = !items[id] ? 'NOT AN ITEM' : hidden.includes(id) ? 'hidden ✓' : spared.includes(id) ? `SPARED (${mechanical(items[id]).join(',')})` : priced(items[id]) ? `PRICED ${JSON.stringify(items[id].price)}` : `kin=${kin.get(id).length}`;
  console.log(`  ${id}: ${where}`);
}
