/*
 * Proves batch 2's array merge did not destroy anything.
 *
 * The merge is the one genuinely dangerous operation in this batch: `resistances`, `immunities`,
 * `senses` and `speeds` are LISTS, and a record that already resists fire and gains cold resistance
 * must end up with both. An overwrite would delete the fire entry silently — core.json would still
 * parse, the app would still boot, and a character would just quietly stop resisting something. That
 * is invisible to tests that only check the new value arrived.
 *
 * So: snapshot every array-field entry before applying, then assert every one of them is still there
 * afterwards. Additive-only, verified rather than assumed.
 *
 *   node scripts/verify-sweep-b2.mjs --snapshot     (BEFORE apply)
 *   node scripts/verify-sweep-b2.mjs --check        (AFTER apply)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const SNAP = p('work/sweep/b2/pre-apply-snapshot.json');
const FIELDS = ['immunities', 'resistances', 'weaknesses', 'senses', 'speeds'];
const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances'];

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

/** { "feats/gloomseer/senses": ["low-light-vision"], ... } — one sorted key list per array field. */
function capture() {
  const out = {};
  for (const coll of COLLECTIONS) {
    for (const [id, rec] of Object.entries(core[coll] ?? {})) {
      for (const f of FIELDS) {
        const v = rec?.[f];
        if (!Array.isArray(v) || !v.length) continue;
        out[`${coll}/${id}/${f}`] = v.map((e) => JSON.stringify(e)).sort();
      }
    }
  }
  return out;
}

if (process.argv.includes('--snapshot')) {
  const snap = capture();
  writeFileSync(SNAP, JSON.stringify(snap));
  console.log(`snapshot: ${Object.keys(snap).length} array fields, ${Object.values(snap).reduce((n, a) => n + a.length, 0)} entries`);
  process.exit(0);
}

if (!existsSync(SNAP)) { console.log('no snapshot — run --snapshot BEFORE applying'); process.exit(1); }
const before = JSON.parse(readFileSync(SNAP, 'utf8'));
const after = capture();

let lost = 0, grew = 0, added = 0, vanished = 0;
const examples = [];
for (const [key, wasEntries] of Object.entries(before)) {
  const now = after[key];
  if (!now) {
    vanished++;
    if (examples.length < 10) examples.push(`FIELD GONE   ${key}`);
    continue;
  }
  const nowSet = new Set(now);
  const missing = wasEntries.filter((e) => !nowSet.has(e));
  if (missing.length) {
    lost += missing.length;
    if (examples.length < 10) examples.push(`ENTRY LOST   ${key}  ${missing[0].slice(0, 70)}`);
  }
  if (now.length > wasEntries.length) { grew++; added += now.length - wasEntries.length; }
}
const brandNew = Object.keys(after).filter((k) => !before[k]).length;

console.log(`fields before : ${Object.keys(before).length}`);
console.log(`fields after  : ${Object.keys(after).length}   (+${brandNew} records gained an array field they had none of)`);
console.log(`fields grown  : ${grew}  (+${added} entries merged into lists that already had one)`);
console.log(`entries LOST  : ${lost}`);
console.log(`fields VANISHED: ${vanished}`);
if (examples.length) { console.log('\nexamples:'); for (const e of examples) console.log('   ' + e); }

const ok = lost === 0 && vanished === 0;
console.log(ok ? '\nOK — the merge was purely additive; no pre-existing entry was removed.' : '\nFAIL — the merge DESTROYED data. Revert core.json.');
process.exit(ok ? 0 : 1);
