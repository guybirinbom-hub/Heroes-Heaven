/*
 * STUB NAMES — the generator of src/data/stub-names.json (card step 14b; the rules are in
 * scripts/lib/stub-names.mjs). Each embedded page stub whose aon id names no record gets the page's own
 * name from the local Archives mirror and the record it is, when one exists, so the card draws a name link
 * (or a plain name) where the page embeds a page this app does not ship.
 *
 *   npx jiti scripts/stub-names.mjs            # counts + what would change
 *   npx jiti scripts/stub-names.mjs --write    # write src/data/stub-names.json (needs the mirror)
 *   npx jiti scripts/stub-names.mjs --check    # exit 1 when the file is not the shipped data (two-way;
 *                                              # with the mirror, recomputed whole)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_MIRROR, STUB_NAMES_FILE, STUB_NAME_NOTES, computeStubNames, stubNamesProblems } from './lib/stub-names.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The file's `_notes` (known mirror-data defects; checked two ways inside stubNamesProblems). */
const NOTES = STUB_NAME_NOTES;
const MIRROR = process.env.AON_MIRROR || DEFAULT_MIRROR;
const argv = process.argv.slice(2);
const db = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const trees = {};
for (const f of readdirSync(join(ROOT, 'public/ast')).filter((x) => x.endsWith('.json.gz')))
  trees[f.replace(/\.json\.gz$/, '')] = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/ast', f))).toString('utf8'));
const path = join(ROOT, STUB_NAMES_FILE);
const file = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { names: {} };

const problems = stubNamesProblems(file, db, trees);
const haveMirror = existsSync(MIRROR);
let computed;
if (haveMirror) {
  computed = computeStubNames(db, trees, MIRROR);
  const occ = [...computed.unresolved.values()].reduce((a, b) => a + b, 0);
  const vals = Object.values(computed.names);
  console.log(`stub names: ${occ} unresolved stub occurrences, ${computed.unresolved.size} distinct ids; ${vals.filter((v) => v.ref).length} ids link a record, ${vals.filter((v) => !v.ref).length} stay a plain name; ${computed.missing.length} not in the mirror.`);
  if (JSON.stringify(computed.names) !== JSON.stringify(file.names ?? {})) problems.push('STUB-NAMES-DIFFER|the file is not the recomputation (re-run with --write)');
} else console.log(`stub names: no mirror at ${MIRROR}; checking the file against the shipped data only.`);

if (argv.includes('--write')) {
  if (!computed) { console.error('stub names: --write needs the mirror'); process.exit(1); }
  if (computed.missing.length) { console.error(`stub names: not in the mirror: ${computed.missing.join(', ')}`); process.exit(1); }
  const vals = Object.values(computed.names);
  const out = {
    _generated: 'scripts/stub-names.mjs --write — never hand-edit; the name of each embedded page stub whose aon id names no record (Archives mirror), and the record that page is (by the mirror\'s printing link, from either side, in the page\'s own category; never by name); two-way checked by test/card-stubs.test.tsx',
    _counts: { ids: vals.length, linked: vals.filter((v) => v.ref).length, plain: vals.filter((v) => !v.ref).length },
    _notes: NOTES,
    names: computed.names,
  };
  writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
  console.log(`stub names: wrote ${STUB_NAMES_FILE}.`);
  process.exit(0);
}
for (const p of problems) console.log(p);
if (argv.includes('--check') && problems.length) process.exit(1);
