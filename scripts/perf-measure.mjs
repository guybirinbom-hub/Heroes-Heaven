/*
 * A measurement pass over the operations a player actually waits on.
 *
 * Written because the audit's "perf profiling" item had no artifact behind it: the two concrete
 * symptoms it named were already fixed (a 400 ms persist debounce, a react-vendor chunk) and nobody
 * had ever put a number on the rest. Deliberately a SCRIPT rather than a test — a timing assertion in
 * CI is a flake generator — so it reports and leaves judging to a human.
 *
 * Run: node scripts/perf-measure.mjs
 */
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/trying ai 2/pf2e codex/';
process.chdir(ROOT);

const ms = (n) => `${n.toFixed(1)} ms`;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** Median of N runs — the mean is dominated by the first, cold run. */
function timed(label, fn, runs = 20) {
  fn(); // warm
  const t = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    fn();
    t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  const med = t[Math.floor(t.length / 2)];
  const p95 = t[Math.min(t.length - 1, Math.floor(t.length * 0.95))];
  console.log(`  ${label.padEnd(44)} median ${ms(med).padStart(10)}   p95 ${ms(p95).padStart(10)}`);
  return med;
}

console.log('\nPAYLOAD — what the browser has to fetch\n');
console.log(`  public/core.json${' '.repeat(28)}${mb(statSync('public/core.json').size).padStart(10)}`);
let astRaw = 0;
let astGz = 0;
for (const f of readdirSync('public/ast')) {
  const s = statSync('public/ast/' + f).size;
  if (f.endsWith('.gz')) astGz += s;
  else astRaw += s;
}
console.log(`  public/ast (lazy, per bucket)${' '.repeat(15)}${mb(astRaw).padStart(10)}   gz ${mb(astGz)}`);
console.log('  core.json is fetched on EVERY load; ast buckets only when a description is opened.');

console.log('\nPARSE + MERGE — paid once, before anything renders\n');
let raw;
timed('read core.json from disk', () => (raw = readFileSync('public/core.json', 'utf8')), 5);
let parsed;
timed('JSON.parse core.json', () => (parsed = JSON.parse(raw)), 5);

const { seedContent } = await import(pathToFileURL(ROOT + 'src/rules/seed.ts').href);
const { findDuplicateIds } = await import(pathToFileURL(ROOT + 'src/data/index.ts').href);
let db;
timed(
  'merge with seed + findDuplicateIds',
  () => {
    db = {};
    for (const k of new Set([...Object.keys(seedContent), ...Object.keys(parsed)]))
      db[k] = { ...(seedContent[k] ?? {}), ...(parsed[k] ?? {}) };
    db.duplicateIds = findDuplicateIds(db);
  },
  5,
);

console.log('\nBUILD + DERIVE — every builder keystroke and every sheet render pays this\n');
const { buildCharacter, emptyBuild } = await import(pathToFileURL(ROOT + 'src/rules/build.ts').href);
const derive = await import(pathToFileURL(ROOT + 'src/rules/derive.ts').href);
const { explainStat } = await import(pathToFileURL(ROOT + 'src/rules/explain.ts').href);

const mk = (classId, level) => ({
  ...emptyBuild(),
  name: 'perf',
  level,
  classId,
  keyAbility: 'str',
  ancestryId: 'human',
  heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'human')?.id ?? null,
  backgroundId: Object.keys(db.backgrounds)[0],
  subclassId: db.classes[classId]?.subclass?.options?.[0]?.id ?? null,
});

timed('buildCharacter - fighter 1', () => buildCharacter(mk('fighter', 1), db));
timed('buildCharacter - fighter 20', () => buildCharacter(mk('fighter', 20), db));
timed('buildCharacter - wizard 20 (spell tables)', () => buildCharacter(mk('wizard', 20), db));

const ch = buildCharacter(mk('fighter', 20), db);
timed('deriveStrikes', () => derive.deriveStrikes(ch, db));
timed('deriveAc', () => derive.deriveAc(ch, db));
timed('all 16 skills', () => {
  for (const k of [
    'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine',
    'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
  ])
    derive.deriveSkill(ch, k, db);
});
timed('explainStat(ac) - one stat popup', () => explainStat(ch, db, { kind: 'ac' }));

console.log('\nWORST CASE — every class at 20, which is what the standing sweeps do\n');
timed(
  'buildCharacter x every class at 20',
  () => {
    for (const id of Object.keys(db.classes)) buildCharacter(mk(id, 20), db);
  },
  3,
);

console.log(
  '\nRead this as a BASELINE, not a pass/fail. What matters for feel is buildCharacter (it runs on\n' +
    'every builder keystroke) and the derive calls (every sheet render). Tens of milliseconds there is\n' +
    'worth looking at; the parse cost is paid once per load.\n',
);
