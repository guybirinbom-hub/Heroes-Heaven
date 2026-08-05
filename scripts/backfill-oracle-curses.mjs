/*
 * Every oracle curse marks the CURSEBOUND condition.
 *
 * All 11 curse records carry no mechanical field, and until now they were reachable by nothing at
 * all — not in any class's `features`, not subclass options, so ownedFeatureIds had no route to them
 * and everything on them rendered for nobody. Now that the chosen mystery hands its curse over
 * (SubclassOption.featureIds), a mark on the cursebound condition reaches the sheet.
 *
 * A marker is the honest lane here. What a curse does is "while you have the cursebound condition,
 * X" where X escalates with the cursebound VALUE, and the app tracks the condition but derives no
 * per-tier arithmetic from it — so the player needs to see the printed effect on the condition, not
 * a number invented for them.
 *
 * Every note below is transcribed from that record's own text in core.json. The escalating ones name
 * their tiers, because "weakness 2" and "weakness 5 + your level" are different answers.
 *
 * Usage: node scripts/backfill-oracle-curses.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const REGISTRY = p('src/rules/situationalBonuses.ts');

/** curse id → { value, note }, transcribed from each record's printed text. */
const CURSES = {
  'curse-of-ancestral-meddling': {
    value: 'clumsy = cursebound',
    note: 'Your ancestors vie for control: you are clumsy with a value equal to your cursebound value.',
  },
  'curse-of-creeping-ashes': {
    value: 'fire weakness',
    note: 'Cursebound 1: weakness 2 to fire. 2: −2 circumstance to your ranged attack rolls. 3: your fire weakness becomes 5 + your level. 4: you are consumed and die.',
  },
  'curse-of-engulfing-flames': {
    value: 'persistent fire = cursebound',
    note: 'You catch fire, taking persistent fire damage equal to your cursebound value, and any immunity or resistance you have to fire is suppressed.',
  },
  'curse-of-inclement-headwinds': {
    value: 'electricity weakness',
    note: 'Cursebound 1: electricity weakness 2, and metal-seeking electricity treats you as wearing metal (your immunity or resistance is suppressed). 2: −2 circumstance to your ranged attack rolls. 3: the weakness becomes 5 + your level.',
  },
  'curse-of-inevitable-rot': {
    value: 'acid + poison weakness',
    note: 'Cursebound 1: weakness 2 to acid and poison. 2: −1 status to saves against diseases and poisons. 3: the weakness becomes twice your level.',
  },
  'curse-of-outpouring-life': {
    value: 'healing reduced',
    note: 'Magical healing you receive takes a status penalty equal to your level (minimum 1) times your cursebound value to the Hit Points restored.',
  },
  'curse-of-the-living-death': {
    value: 'vitality + void weakness',
    note: 'Cursebound 1: weakness 2 to vitality and void. 2: −1 status to Fortitude saves. 3: the weakness becomes 5 + your level.',
  },
  'curse-of-the-mortal-warrior': {
    value: 'weakness to spells',
    note: 'Cursebound 1: spells wound you more easily. 2: −1 status to saves against spells. 3: your weakness to spells equals your level.',
  },
  'curse-of-the-skys-call': {
    value: 'enfeebled = cursebound',
    note: 'You are enfeebled with a value equal to your cursebound value, and take that as a status penalty to saves and DCs against all forms of forced movement.',
  },
  'curse-of-torrential-knowledge': {
    value: '−cursebound to Perception + Will',
    note: 'Status penalty to Perception checks and Will saves equal to your cursebound value. At cursebound 4 you also cannot speak, use linguistic effects, or otherwise communicate with allies.',
  },
  'curse-of-turbulent-moments': {
    value: '−cursebound vs reactions',
    note: 'Status penalty equal to your cursebound value to AC against attacks from reactions or free actions, and to saves against effects that would make you fatigued or slowed.',
  },
};

const problems = [];
if (!core.conditions?.cursebound) problems.push('there is no `cursebound` condition to mark');
for (const id of Object.keys(CURSES)) if (!core.classFeatures[id]) problems.push(`${id} is not a class feature`);
/** A curse no mystery hands over is still unreachable, so a marker on it would render for nobody. */
const handedOver = new Set(
  (core.classes?.oracle?.subclass?.options ?? []).flatMap((o) => o.featureIds ?? []),
);
for (const id of Object.keys(CURSES)) if (!handedOver.has(id)) problems.push(`${id} is not handed over by any mystery — a marker on it is unreachable`);
for (const id of handedOver) if (!CURSES[id]) problems.push(`a mystery hands over ${id}, which has no marker here`);

console.log(`curses: ${Object.keys(CURSES).length} · mysteries hand over: ${handedOver.size}`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const x of problems) console.log('  ' + x);
  process.exit(1);
}
console.log('every curse resolves, is handed over by a mystery, and the cursebound condition exists');

if (!WRITE) { console.log('\n--write to apply'); process.exit(0); }

const TAG = '  // ---- oracle curses: what each one does while you are cursebound ----';
let src = readFileSync(REGISTRY, 'utf8').replace(/\r\n/g, '\n');
const at = src.indexOf(TAG);
if (at >= 0) src = src.slice(0, src.lastIndexOf('\n', at - 1) + 1) + src.slice(src.indexOf('\n};', at) + 1);

const open = src.indexOf('export const RECORD_MARKERS');
const close = src.indexOf('\n};', open);
const body = Object.entries(CURSES)
  .map(([id, m]) => `  '${id}': [{ on: 'condition', id: 'cursebound', value: ${JSON.stringify(m.value)}, note: ${JSON.stringify(m.note)} }],`)
  .join('\n');
const banner = `${TAG}\n  // Transcribed from each record's own text. Reachable only because the chosen mystery now hands\n  // its curse over (SubclassOption.featureIds); before that these records had no route to a sheet.\n`;
src = `${src.slice(0, close)}\n\n${banner}${body}${src.slice(close)}`;

// Refuse to write a file whose shape changed — a line-ending bug once duplicated 780 lines here.
const braces = (s) => (s.match(/^\};$/gm) ?? []).length;
const before = readFileSync(REGISTRY, 'utf8').replace(/\r\n/g, '\n');
if (braces(src) !== braces(before)) throw new Error('top-level "};" count changed — refusing to write');
writeFileSync(REGISTRY, src);
console.log(`\nwrote ${Object.keys(CURSES).length} cursebound markers to src/rules/situationalBonuses.ts`);
