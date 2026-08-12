/*
 * Applies the re-triage of the 94 "no field exists" records — the ones now expressible by lanes
 * added after they were first judged (spellSlotBonus.byRank, mode grants, FEAT_PICK_GRANTS,
 * weaponFamiliarity.mirrorBestCategory).
 *
 * Same rule as every other applier here: nothing is written on trust. Referenced ids are checked
 * against core.json, field names against types.ts, and a registry key is never given a second entry
 * (the later one would silently win).
 *
 * Usage: node scripts/apply-retriage-94.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const DIR = p('work/engine94');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');
const LEGAL_FIELDS = new Set([...typesSrc.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]));

const fixes = [];
for (const f of readdirSync(DIR).filter((n) => /^retriage-\d+\.json$/.test(n)).sort()) {
  for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).records ?? []) {
    if (r.verdict === 'NOW_FIXABLE' && r.fix) fixes.push(r);
  }
}

/*
 * The adversary's rulings. An overturned fix is DROPPED — unless the adversary supplied a corrected
 * one, in which case that replaces it. dwarven-weapon-expertise was overturned for an incomplete
 * weapon list (it omitted dwarven-war-axe and the two wrecker sub-forms), not for being wrong in
 * kind, so dropping it outright would lose a real fix.
 */
const overturned = new Map();
const corrected = new Map();
if (existsSync(path.join(DIR, 'verify.json'))) {
  for (const r of JSON.parse(readFileSync(path.join(DIR, 'verify.json'), 'utf8')).rulings ?? []) {
    if (r?.upheld !== false) continue;
    if (r.correction && Object.keys(r.correction).length) corrected.set(r.id, r.correction);
    else overturned.set(r.id, r.why ?? 'overturned');
  }
}

const skipped = [];
const fieldWrites = [];
const featGrants = new Map();
const featPicks = new Map();
const companionGrants = new Map();
const modes = new Map();

const pickSrc = readFileSync(p('src/rules/featPickGrants.ts'), 'utf8');
const grantSrc = readFileSync(p('src/rules/featGrantsAuto.ts'), 'utf8');
const compSrc = readFileSync(p('src/rules/companionGrants.ts'), 'utf8');
const hasKey = (src, id) => new RegExp(`['"]${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"]\\s*:`).test(src);

for (const r of fixes) {
  const { id } = r;
  if (overturned.has(id)) { skipped.push(`${id}: overturned by the adversary — ${overturned.get(id)}`); continue; }
  const fix = corrected.get(id) ?? r.fix;
  if (corrected.has(id)) console.log(`   (using the adversary's corrected fix for ${id})`);
  const rec = core.feats[id] ?? core.classFeatures[id] ?? core.items[id] ?? core.heritages[id] ?? core.backgrounds[id];
  if (!rec) { skipped.push(`${id}: not in core.json`); continue; }

  if (fix.kind === 'field') {
    const coll = fix.collection;
    if (!core[coll]?.[id]) { skipped.push(`${id}: not in ${coll}`); continue; }
    if (!LEGAL_FIELDS.has(fix.field)) { skipped.push(`${id}: "${fix.field}" is not a field on any record type`); continue; }
    if (core[coll][id][fix.field] != null) { skipped.push(`${id}: already has ${fix.field} — not overwriting`); continue; }
    // byRank must ADD to an existing rank, never set a total, and its ranks must be plausible.
    if (fix.field === 'spellSlotBonus' && fix.value?.byRank) {
      const bad = Object.entries(fix.value.byRank).filter(([k, v]) => !(Number(k) >= 1 && Number(k) <= 10) || !(v > 0 && v <= 4));
      if (bad.length) { skipped.push(`${id}: implausible byRank ${JSON.stringify(fix.value.byRank)}`); continue; }
    }
    fieldWrites.push({ coll, id, field: fix.field, value: fix.value });
    continue;
  }

  if (fix.kind === 'featGrant') {
    if (hasKey(grantSrc, id)) { skipped.push(`${id}: already in FEAT_SKILL_GRANTS`); continue; }
    const ws = fix.grant?.weaponFamiliarity?.weapons ?? [];
    const missing = ws.filter((w) => !core.items[w]);
    if (missing.length) { skipped.push(`${id}: weapon id(s) not in core.json: ${missing.join(', ')}`); continue; }
    if (!ws.length) { skipped.push(`${id}: featGrant with no weapons`); continue; }
    featGrants.set(id, fix.grant);
    continue;
  }

  if (fix.kind === 'featPick') {
    if (hasKey(pickSrc, id)) { skipped.push(`${id}: already in FEAT_PICK_GRANTS`); continue; }
    const ids = fix.spec?.ids ?? [];
    const missing = ids.filter((x) => !core.feats[x]);
    if (missing.length) { skipped.push(`${id}: option feat id(s) not in core.json: ${missing.join(', ')}`); continue; }
    if (!ids.length && !fix.spec?.category) { skipped.push(`${id}: featPick with neither ids nor a category — it would offer everything`); continue; }
    featPicks.set(id, fix.spec);
    continue;
  }

  if (fix.kind === 'companionGrant') {
    if (hasKey(compSrc, id)) { skipped.push(`${id}: already in a companion registry`); continue; }
    companionGrants.set(id, fix.grant);
    continue;
  }

  if (fix.kind === 'mode') {
    const m = fix.mode;
    if (!m?.id) { skipped.push(`${id}: mode with no id`); continue; }
    if (core.modes?.[m.id]) { skipped.push(`${id}: core.modes already has "${m.id}"`); continue; }
    if (modes.has(m.id)) { skipped.push(`${id}: duplicate mode id "${m.id}" — the first wins`); continue; }
    const gate = (m.feats ?? []).filter((f) => !core.feats[f] && !core.classFeatures[f]);
    if (gate.length) { skipped.push(`${id}: mode gate id(s) not found: ${gate.join(', ')}`); continue; }
    if (!m.fromItemId && !(m.feats ?? []).length) { skipped.push(`${id}: mode with no gate — nothing would show it`); continue; }
    modes.set(m.id, { ...m, modifiers: m.modifiers ?? [] });
    continue;
  }

  skipped.push(`${id}: unrecognised fix kind "${fix.kind}"`);
}

console.log(`NOW_FIXABLE ${fixes.length} · writing ${fieldWrites.length} fields, ${featGrants.size} feat grants, ${featPicks.size} feat picks, ${companionGrants.size} companion grants, ${modes.size} modes`);
for (const w of fieldWrites) console.log(`   field  ${w.coll}/${w.id}.${w.field} = ${JSON.stringify(w.value)}`);
for (const [k] of featGrants) console.log(`   grant  ${k}`);
for (const [k] of featPicks) console.log(`   pick   ${k}`);
for (const [k] of companionGrants) console.log(`   comp   ${k}`);
for (const [k] of modes) console.log(`   mode   ${k}`);
if (skipped.length) { console.log(`\nNOT WRITTEN (${skipped.length}):`); for (const s of skipped) console.log('   ' + s); }

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

// ---- core.json fields + the overlay (the only thing that survives `npm run data`) ----
for (const w of fieldWrites) core[w.coll][w.id][w.field] = w.value;
for (const [mid, m] of modes) { core.modes = core.modes ?? {}; core.modes[mid] = m; }
writeFileSync(p('public/core.json'), JSON.stringify(core));

const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
for (const w of fieldWrites) {
  if (!overlay.some((x) => x.category === w.coll && x.id === w.id && x.field === w.field)) {
    overlay.push({ category: w.coll, id: w.id, field: w.field, value: w.value });
    ovAdd++;
  }
}
writeFileSync(OVERLAY, formatBackfill(overlay));

if (modes.size) {
  const SRC = p('scripts/data/toggle-modes.json');
  const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
  for (const [mid, m] of modes) prev[mid] = m;
  writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
}

// Registry entries are emitted as a patch file rather than spliced blind — they go into TypeScript
// source, and a bad splice there breaks the build for everyone.
writeFileSync(path.join(DIR, 'registry-patch.json'), JSON.stringify({
  FEAT_SKILL_GRANTS: Object.fromEntries(featGrants),
  FEAT_PICK_GRANTS: Object.fromEntries(featPicks),
  COMPANION_GRANTS: Object.fromEntries(companionGrants),
}, null, 2) + '\n');
writeFileSync(path.join(DIR, 'not-written.json'), JSON.stringify({ skipped }, null, 1));

console.log(`\noverlay: ${ovAdd} added`);
console.log('written: public/core.json, scripts/data/effect-backfill.json' + (modes.size ? ', scripts/data/toggle-modes.json' : ''));
console.log('registry entries emitted to work/engine94/registry-patch.json for review before splicing');
