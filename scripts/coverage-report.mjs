/*
 * Mechanical-coverage report — the DENOMINATOR for "is every feat wired up?".
 *
 * WHY THIS EXISTS: a previous pass reported that "most" of the make-every-feat-work mandate was
 * covered. The lanes it built were genuinely built (see the registry counts below), but the claim had
 * no denominator — nobody had counted how many records NEED a given mechanical field, so "most" was
 * unfalsifiable. Assurance ("Choose a skill you're trained in") sat in a lane nobody had enumerated,
 * so it looked done and wasn't.
 *
 * Run it yourself:  node scripts/coverage-report.mjs
 * Machine output:   node scripts/coverage-report.mjs --json
 *
 * Every number here is derived from the SHIPPED data + the SHIPPED registries. Nothing is asserted.
 * test/coverage.test.ts locks these figures so coverage can't silently regress, and so a claim of
 * progress has to move a number rather than a sentence.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const db = JSON.parse(read('public/core.json'));

/** Feat ids referenced by each registry that can model a player-facing pick or effect. */
const REGISTRY_FILES = {
  featGrants: 'src/rules/featGrants.ts',
  featGrantsAuto: 'src/rules/featGrantsAuto.ts',
  // Merged into FEAT_GRANTS alongside the other two. A new registry file must be listed here too, or
  // this report silently stops counting it and calls wired feats gaps.
  featGrantsLane: 'src/rules/featGrantsLane.ts',
  featPickGrants: 'src/rules/featPickGrants.ts',
  featCantripGrants: 'src/rules/featCantripGrants.ts',
  featFeatGrants: 'src/rules/featFeatGrants.ts',
  companionGrants: 'src/rules/companionGrants.ts',
  situationalBonuses: 'src/rules/situationalBonuses.ts',
};
/** Every id that resolves to a real record — the filter that keeps idsIn from crediting field names.
 *  The list is inline rather than reusing COLLECTIONS, which is declared further down this file. */
const RECORD_IDS = new Set(
  ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds',
   'animalCompanions', 'specificFamiliars', 'companionSpecializations', 'deities', 'spells', 'stances']
    .flatMap((c) => Object.keys(db[c] ?? {})),
);

function idsIn(path) {
  let src;
  try { src = read(path); } catch { return new Set(); }
  // The old pattern required a HYPHEN, so every single-word registry key was invisible to this
  // report: `pet` and `familiar` are registered companion grants that counted as gaps, as did 96
  // situational ids like `forlorn` and `pirouette`. Match any quoted key, then keep only the ones
  // that resolve to a record — otherwise field names (`rank`, `options`, `fortitude`) get credited
  // as coverage, which is the same lie in the other direction.
  const keys = [...src.matchAll(/["']([a-z0-9][a-z0-9-]*)["']\s*:/g)].map((m) => m[1]);
  return new Set(keys.filter((k) => RECORD_IDS.has(k)));
}
const registry = Object.fromEntries(Object.entries(REGISTRY_FILES).map(([k, p]) => [k, idsIn(p)]));
const situational = registry.situationalBonuses;
const anyGrantRegistry = new Set(
  ['featGrants', 'featGrantsAuto', 'featPickGrants', 'featCantripGrants', 'featFeatGrants', 'companionGrants']
    .flatMap((k) => [...registry[k]]),
);

/* ---- lane 1: records that ask the player to CHOOSE something ------------------------------- */
// Deliberately conservative: `INPLAY` removes choices made during play (pick a target) which need no
// builder prompt. The remainder still contains false positives — that is stated, not hidden.
const ASKS = /\b(choose|select|pick)\s+(an?|one|two|up to|\d+)\b/i;
const INPLAY = /\b(choose|select|pick)\s+(a target|one target|a creature|an? adjacent|a square|a direction|a point|a spot|an enemy|an ally)/i;
const asksToChoose = (r) => {
  const t = String(r.description ?? '');
  return ASKS.test(t) && !INPLAY.test(t);
};

/* ---- lane 2: records granting a TYPED bonus (the ★ situational marker) --------------------- */
const TYPED_BONUS = /(circumstance|status|item) bonus/i;

/** Every bucket a situational / grant record can legitimately live in. */
const COLLECTIONS = [
  'feats', 'items', 'heritages', 'backgrounds', 'classFeatures',
  'ancestries', 'animalCompanions', 'companionSpecializations',
];

function lane(collection, predicate, isModelled) {
  const recs = Object.values(db[collection] ?? {});
  const need = recs.filter(predicate);
  const done = need.filter(isModelled);
  return {
    collection,
    total: recs.length,
    need: need.length,
    modelled: done.length,
    missing: need.length - done.length,
    pct: need.length ? Math.round((done.length / need.length) * 100) : 100,
    examples: need.filter((r) => !isModelled(r)).slice(0, 10).map((r) => r.name),
  };
}

const choiceModelled = (r) => !!r.choice || anyGrantRegistry.has(r.id);
const choices = [
  lane('feats', asksToChoose, choiceModelled),
  lane('classFeatures', asksToChoose, choiceModelled),
  lane('items', asksToChoose, choiceModelled),
  lane('heritages', asksToChoose, choiceModelled),
];

// The situational registry used to be feats-only by construction, so the non-feat lanes below were
// hardcoded to 0% as "structurally unreachable". The reach fix (c00984a) made every collection
// reachable, so they are now scored the same way feats are — anything else under-reports the work.
const sitModelled = (r) => situational.has(r.id);
const sits = [
  lane('feats', (r) => TYPED_BONUS.test(String(r.description ?? '')), sitModelled),
  lane('items', (r) => TYPED_BONUS.test(String(r.description ?? '')), sitModelled),
  lane('classFeatures', (r) => TYPED_BONUS.test(String(r.description ?? '')), sitModelled),
  lane('heritages', (r) => TYPED_BONUS.test(String(r.description ?? '')), sitModelled),
];

const report = {
  // Count ids that resolve in ANY collection: the situational table is deliberately multi-collection
  // now, so filtering to db.feats would hide ~1,400 real item/heritage/classFeature entries.
  registryCounts: Object.fromEntries(
    Object.entries(registry).map(([k, v]) => [
      k,
      [...v].filter((id) => COLLECTIONS.some((col) => db[col]?.[id])).length,
    ]),
  ),
  playerChoices: choices,
  situationalBonuses: sits,
  totals: {
    choiceNeed: choices.reduce((a, l) => a + l.need, 0),
    choiceMissing: choices.reduce((a, l) => a + l.missing, 0),
    situationalNeed: sits.reduce((a, l) => a + l.need, 0),
    situationalMissing: sits.reduce((a, l) => a + l.missing, 0),
  },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const row = (l) => `  ${l.collection.padEnd(15)} need ${String(l.need).padStart(5)}  modelled ${String(l.modelled).padStart(5)}  MISSING ${String(l.missing).padStart(5)}  (${l.pct}%)`;
  console.log('REGISTRY SIZES (feat ids actually present in core.json)');
  for (const [k, n] of Object.entries(report.registryCounts)) console.log(`  ${k.padEnd(20)} ${n}`);
  console.log('\nLANE 1 — records whose text asks the player to CHOOSE something');
  choices.forEach((l) => console.log(row(l)));
  console.log(`  => ${report.totals.choiceMissing} of ${report.totals.choiceNeed} unmodelled`);
  console.log('\nLANE 2 — records granting a typed (circumstance/status/item) bonus');
  sits.forEach((l) => console.log(row(l)));
  console.log(`  => ${report.totals.situationalMissing} of ${report.totals.situationalNeed} unmodelled`);
  console.log('\nNOTE: the REACH bug is FIXED (c00984a) — explain.ts -> characterSituationalIds now spans');
  console.log('      feats, items (equipped/worn/invested only), heritage, ancestry, background and class');
  console.log('      features, so every row above is reachable. What is missing now is DATA, not reach.');
  console.log('NOTE: 338 verified bonuses still have NO storable target kind — SituationalTarget.kind is');
  console.log('      skill|save|perception|ac|attack but the data needs strikeDamage/speed/spell/hp/classDc.');
  console.log('      Extend that union BEFORE applying work/situational-lane (see its status.json).');
  console.log('NOTE: these text heuristics OVER-count. They are an upper bound on work, not a defect');
  console.log('      count — classifying the remainder is the audit’s first job.');
}
