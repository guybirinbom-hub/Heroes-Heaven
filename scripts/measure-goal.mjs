/*
 * Does every record a player can reach either let them choose what the rules give them, or change
 * the sheet correctly?
 *
 * This counts rather than claims. The last time that question was answered from memory the answer
 * was wrong in both directions, so every bucket below is derived from the shipped data and the
 * shipped registries at run time.
 *
 * Usage: node scripts/measure-goal.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const src = (f) => readFileSync(p(f), 'utf8');

/** Registry keys, read from the source files that actually ship. */
const keysIn = (text) => new Set([...text.matchAll(/^\s{2}["']?([a-z0-9-]+)["']?\s*:/gm)].map((m) => m[1]));
const reg = src('src/rules/situationalBonuses.ts');
const REGISTERED = new Set([
  ...keysIn(reg),
  ...keysIn(src('src/rules/featGrantsAuto.ts')),
  ...keysIn(src('src/rules/featGrants.ts')),
  ...keysIn(src('src/rules/featFeatGrants.ts')),
  ...keysIn(src('src/rules/featPickGrants.ts')),
  ...keysIn(src('src/rules/featCantripGrants.ts')),
  ...keysIn(src('src/rules/companionGrants.ts')),
  ...keysIn(src('src/rules/featGrantsLane.ts')),
]);
// Modes and stances are keyed by the record they belong to (or by fromItemId).
for (const m of Object.values(core.modes ?? {})) {
  if (m.fromItemId) REGISTERED.add(m.fromItemId);
  for (const f of m.feats ?? []) REGISTERED.add(f);
  REGISTERED.add(m.id);
}
for (const s of Object.keys(core.stances ?? {})) REGISTERED.add(s);
// A field patched by the overlay counts as mechanical even if the field name is unusual.
for (const x of JSON.parse(readFileSync(p('scripts/data/effect-backfill.json'), 'utf8'))) REGISTERED.add(x.id);

/** Any structured field that makes a record DO something. Derived from types.ts, not memorised. */
const types = src('src/rules/types.ts');
const MECHANICAL = new Set(
  [...types.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]).filter((f) =>
    /^(resistances|weaknesses|immunities|senses|speeds|speedPenalty|landSpeedBonus|landSpeedMin|passiveEffects|effectChoices|choice|situational|innateSpells|focusSpells|focusPoolBonus|spellcastingGrant|spellSlotBonus|grantedFeatId|grantsFeats|grantedFeatByChoice|grantedStrikes|trainedSkill|trainedLore|trainedSkillChoice|trainedLoreChoice|trainedLoreOptions|dynamicSkillBonus|classDcGrant|limitedUses|usesUpgrade|uses|heldSpells|critSpec|conditionalSenses|choiceResistance|senseIfFeat|speedsIf|negativeHealing|grantsLanguages|apexAttribute|acBonus|damage|capacity|runes|spell|spellSlot)$/.test(f),
  ),
);

const hasMechanic = (r) => MECHANICAL.size > 0 && Object.keys(r ?? {}).some((k) => MECHANICAL.has(k) && r[k] != null && (!Array.isArray(r[k]) || r[k].length));

/* ---- records a player can actually REACH -------------------------------------------------- */
const umbrella = (() => {
  const MECH = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value', 'heldSpells'];
  const KEEP = new Set(['judgement-thurible', 'spore-shepherds-staff', 'razmiri-mask', 'inspiring']);
  const ids = Object.keys(core.items).sort();
  const out = new Set(['aon-magical-medals']);
  for (let i = 0; i < ids.length; i++) {
    const it = core.items[ids[i]];
    if (KEEP.has(ids[i]) || (it.price && Object.values(it.price).some(Boolean)) || MECH.some((k) => it[k] != null && (!Array.isArray(it[k]) || it[k].length))) continue;
    let kin = 0;
    for (let j = i + 1; j < ids.length && ids[j].startsWith(ids[i] + '-'); j++) kin++;
    if (kin >= 2) out.add(ids[i]);
  }
  return out;
})();

const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'deities'];
const tally = { reachable: 0, mechanical: 0, registered: 0, inert: 0 };
const unreachable = { superseded: 0, duplicate: 0, umbrella: 0 };
const perColl = {};

for (const coll of COLLECTIONS) {
  const c = { reachable: 0, covered: 0, inert: 0 };
  for (const [id, r] of Object.entries(core[coll] ?? {})) {
    // Out of reach: a player can never take these, so they are not part of the goal.
    if (r?.edition === 'superseded') { unreachable.superseded++; continue; }
    if (id.startsWith('aon-') && core[coll][id.slice(4)]) { unreachable.duplicate++; continue; }
    if (coll === 'items' && umbrella.has(id)) { unreachable.umbrella++; continue; }

    c.reachable++;
    tally.reachable++;
    const mech = hasMechanic(r);
    const regd = REGISTERED.has(id);
    if (mech) tally.mechanical++;
    if (regd) tally.registered++;
    if (mech || regd) c.covered++;
    else { c.inert++; tally.inert++; }
  }
  perColl[coll] = c;
}

const covered = tally.reachable - tally.inert;
console.log('RECORDS A PLAYER CAN REACH');
console.log(`  total                       ${String(tally.reachable).padStart(6)}`);
console.log(`  carry a mechanical field    ${String(tally.mechanical).padStart(6)}`);
console.log(`  or a registry entry         ${String(tally.registered).padStart(6)}`);
console.log(`  COVERED (either)            ${String(covered).padStart(6)}   ${(covered / tally.reachable * 100).toFixed(1)}%`);
console.log(`  carry NEITHER               ${String(tally.inert).padStart(6)}   ${(tally.inert / tally.reachable * 100).toFixed(1)}%`);
console.log('\nby collection (reachable / covered / neither)');
for (const [k, v] of Object.entries(perColl)) {
  console.log(`  ${k.padEnd(15)} ${String(v.reachable).padStart(6)} ${String(v.covered).padStart(7)} ${String(v.inert).padStart(8)}`);
}
console.log('\nNOT COUNTED — a player cannot reach these at all');
console.log(`  superseded editions   ${unreachable.superseded}`);
console.log(`  aon- duplicate scrapes ${unreachable.duplicate}`);
console.log(`  umbrella item summaries ${unreachable.umbrella}`);
console.log('\nNOTE: "carries neither" is NOT the same as broken. Much of it is correctly inert —');
console.log('pure flavour, GM-adjudicated, or an effect that lands on a target or an ally. The sweep');
console.log('measured that distinction directly on a 3,781-record sample; this is the whole corpus.');
