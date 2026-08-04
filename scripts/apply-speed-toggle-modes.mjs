/*
 * The toggles that the first authoring pass had to skip, now that a mode can carry a Speed.
 *
 * Six needed a Speed lane. Four are siccatite shields whose resistance TYPE depends on which
 * siccatite the shield is made of — hot or cold — which the item record does not say. Rather than
 * guess (a wrong resistance type is worse than none), each ships as TWO modes, one per variant, and
 * the player switches on the one matching their shield.
 *
 * Every value below is quoted from the record's own text in the comment beside it.
 *
 * Usage: node scripts/apply-speed-toggle-modes.mjs [--dry]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

/** "whichever is greater" of your land Speed and 20 → max(20, land). */
const FLY_GREATER_OF_LAND_OR_20 = 'max(20,@actor.speed.land)';
/** "25 feet or your land Speed, whichever is slower" → min(25, land). */
const FLY_SLOWER_OF_25_OR_LAND = 'min(25,@actor.speed.land)';

const MODES = [
  // "You gain a fly Speed of 40 feet and fire resistance 5 for 1 minute."
  {
    id: 'item-thousand-year-dragonroot', name: 'Dragonroot Flight', fromItemId: 'thousand-year-dragonroot',
    duration: '1 minute', modifiers: [],
    speeds: { fly: 40 }, resistances: [{ type: 'fire', value: 5 }],
    note: 'Fly Speed 40 feet and fire resistance 5 for 1 minute.',
  },
  // "You gain a fly Speed equal to either your land Speed or 20 feet, whichever is greater."
  {
    id: 'item-soaring-wings-major', name: 'Soaring Wings', fromItemId: 'soaring-wings-major',
    duration: '10 minutes', modifiers: [], speeds: { fly: FLY_GREATER_OF_LAND_OR_20 },
    note: 'Fly Speed equal to your land Speed or 20 feet, whichever is greater.',
  },
  // "granting you a fly Speed of 25 feet or your land Speed, whichever is slower."
  {
    id: 'item-winged', name: 'Take to the Skies', fromItemId: 'winged',
    duration: '1 minute', modifiers: [], speeds: { fly: FLY_SLOWER_OF_25_OR_LAND },
    note: 'Fly Speed of 25 feet or your land Speed, whichever is slower. Once per hour.',
  },
  // "Ghostly draconic wings grant you a fly Speed equal to your Speed or 20 feet, whichever is greater."
  {
    id: 'item-wyrms-flight', name: "Wyrm's Flight", fromItemId: 'wyrms-flight',
    duration: '1 minute', modifiers: [], speeds: { fly: FLY_GREATER_OF_LAND_OR_20 },
    note: 'Fly Speed equal to your Speed or 20 feet, whichever is greater. Once per day.',
  },
  // "You gain a Fly speed of 30 feet and can only take Strike and Fly actions…"
  {
    id: 'klingegeist', name: 'Possess a Blade', feats: ['klingegeist'],
    duration: 'while possessing the blade', modifiers: [], speeds: { fly: 30 },
    note: 'Fly Speed 30 feet while possessing the blade. You can take only Strike and Fly actions, and they do not trigger reactions.',
  },
];

// The siccatite shields: the resistance is to the OPPOSING energy type, and which one depends on
// whether the shield is hot or cold siccatite — not recorded on the item. Two modes each, so the
// player picks the true one instead of the app guessing.
for (const [id, value] of [
  ['siccatite-buckler-standard-grade', 5],
  ['siccatite-shield-standard-grade', 5],
  ['siccatite-buckler-high-grade', 10],
  ['siccatite-shield-high-grade', 10],
]) {
  const label = id.includes('buckler') ? 'Buckler' : 'Shield';
  for (const [kind, resist] of [['Hot', 'cold'], ['Cold', 'fire']]) {
    MODES.push({
      id: `item-${id}-${kind.toLowerCase()}`,
      name: `${kind} Siccatite ${label}`,
      fromItemId: id,
      duration: 'while the shield is Raised',
      modifiers: [],
      resistances: [{ type: resist, value }],
      note: `While Raised, a ${kind.toLowerCase()} siccatite ${label.toLowerCase()} grants resistance ${value} to ${resist} — the opposing energy type. Switch on the one matching your shield.`,
    });
  }
}

const problems = [];
const out = [];
for (const m of MODES) {
  if (core.modes?.[m.id]) { problems.push(`${m.id}: already exists — not overwriting`); continue; }
  if (m.fromItemId && !core.items[m.fromItemId]) { problems.push(`${m.id}: fromItemId "${m.fromItemId}" is not an item`); continue; }
  for (const f of m.feats ?? []) if (!core.feats[f] && !core.classFeatures[f]) problems.push(`${m.id}: gate "${f}" not found`);
  if (!m.duration) { problems.push(`${m.id}: no duration`); continue; }
  out.push(m);
}

console.log(`speed/variant modes: writing ${out.length} of ${MODES.length}`);
for (const m of out) console.log(`   ${m.id.padEnd(40)} ${m.speeds ? 'speed ' + JSON.stringify(m.speeds) : 'resist ' + JSON.stringify(m.resistances)}`);
if (problems.length) { console.log('\nNOT WRITTEN:'); for (const s of problems) console.log('   ' + s); }

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

core.modes = core.modes ?? {};
for (const m of out) core.modes[m.id] = m;
writeFileSync(p('public/core.json'), JSON.stringify(core));

const SRC = p('scripts/data/toggle-modes.json');
const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
for (const m of out) prev[m.id] = m;
writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
console.log(`\nwritten: public/core.json (core.modes now ${Object.keys(core.modes).length}), scripts/data/toggle-modes.json`);
