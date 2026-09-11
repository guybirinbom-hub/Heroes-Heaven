/*
 * WHY THIS GUARD EXISTS.
 *
 * The trust gate turns a record's mechanics off by stripping FIELDS off the record. A few dozen
 * mechanics are not on a record at all — they are written into the engine, keyed by a record id
 * (`if (owned.has('sneak-attack'))`). Field-stripping cannot reach those, so they are turned off
 * through `lanes.engine` in the ledger and `engineLaneOff(id)` in src/rules/trustLanes.ts, and the
 * inventory of them is scripts/data/trust-lanes.json (docs/trust-gate.md section 3).
 *
 * An inventory nobody checks goes stale the first time somebody adds a lane. So this script reads
 * src/rules/*.ts, finds every QUOTED id that is a key of a public/core.json bucket and is used as a
 * lane key (an equality, a set membership, a bucket index, a Set literal, or a table key), and goes
 * red on one that has no entry in trust-lanes.json. It prints every id it matched and where.
 *
 * An entry may say `"gated": false` — several of these ids are read for something the gate must
 * NEVER touch (a LIMIT, a prerequisite, the recovery of a player's own recorded pick, a chassis
 * identity test). That is a decision, recorded with its reason, not an exemption from being listed.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT SEE, both named in trust-lanes.json so they cannot be lost:
 *   · an id compared against an arbitrary DATA field (`x.resistanceLevelUpgrade === 'inventor-initial'`);
 *   · a registry FILE's keys — those tables are gated by their own lane (`lanes.featGrants`,
 *     `lanes.situational`, `lanes.modes`), which the ledger builds by scraping the file itself, so
 *     listing their several hundred ids here would say nothing. They are in `registryFiles`.
 *
 * Usage: node scripts/trust-lanes-check.mjs   (part of `npm run verify`)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => join(ROOT, p);
const die = (msg) => { console.error(`trust-lanes-check FAILED: ${msg}`); process.exit(1); };

const core = JSON.parse(readFileSync(R('public/core.json'), 'utf8'));
/* The 8 buckets the gate can reach, plus modes and stances — a mode id IS a lane key
 * (`mode.id === 'cat-raise-shield'`) even though its payload is gated by the ledger. */
const BUCKETS = ['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'ancestries', 'classes', 'actions', 'modes', 'stances'];
const recordIds = new Map();
for (const b of BUCKETS) for (const id of Object.keys(core[b] ?? {})) recordIds.set(id, [...(recordIds.get(id) ?? []), b]);
/* classes / ancestries / backgrounds are the character CHASSIS and are all-on by construction (plan
 * section 2 step 3): a lane keyed on one of them can never be off, so `cls.id === 'fighter'` needs no
 * entry. An id with a twin in any other bucket still does. */
const CHASSIS = new Set(['classes', 'ancestries', 'backgrounds']);
for (const [id, buckets] of recordIds) if (buckets.every((b) => CHASSIS.has(b))) recordIds.delete(id);

const lanesFile = JSON.parse(readFileSync(R('scripts/data/trust-lanes.json'), 'utf8'));
const known = new Set((lanesFile.lanes ?? []).map((e) => e.id));
const notIds = new Set((lanesFile.notIds ?? []).map((e) => e.id));
const skipFiles = new Set((lanesFile.registryFiles ?? []).map((e) => e.file));

/* Blank comments, keeping line numbers: an id in a comment is prose, not a lane. */
const blank = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');

const ID = "([a-z0-9][a-z0-9-]{2,})";
const PATTERNS = [
  // an equality against a quoted id: `f.featId === 'sneak-attack'`, `mode.id !== 'cat-raise-shield'`
  new RegExp(`(?:===|!==)\\s*'${ID}'`, 'g'),
  // set/array membership: `takenFeats.has('inventor-dedication')`, `[...ids].includes('living-rune')`,
  // and the prefix form the weapon-specialization family is read with (`id.startsWith('greater-…')`)
  new RegExp(`\\.(?:has|includes|startsWith)\\(\\s*'${ID}'`, 'g'),
  // an index by literal id: `content.feats['intense-implement']`, `c.classResources?.['hunt-prey']`
  new RegExp(`\\[\\s*'${ID}'\\s*\\]`, 'g'),
];
/* A TABLE keyed by record id inside an engine file — RAGE_DAMAGE's instincts. Only the engine files:
 * everywhere else in src/rules a table keyed by record id IS a registry (see registryFiles). */
const TABLE_KEY = new RegExp(`^\\s{2}'?${ID}'?\\s*:\\s*[{[]`, 'gm');
const ENGINE_FILES = new Set(['src/rules/build.ts', 'src/rules/derive.ts']);
/* …and the ids inside a `new Set([…])` literal — NOT_YOUR_SANCTIFICATION, ABILITY_OR_FEATS,
 * BODY_RUNE_EXCLUDED. Run over the whole file because the literal spans lines. */
const SET_LITERAL = /new Set\(\[([^\]]*)\]\)/g;

const hits = new Map();          // id -> Set("file:line")   — the ENGINE files, id by id
const undeclared = new Map();    // file -> Set(id)           — any other file that keys on record ids
for (const f of readdirSync(R('src/rules')).sort()) {
  if (!f.endsWith('.ts')) continue;
  const rel = `src/rules/${f}`;
  const engine = ENGINE_FILES.has(rel);
  if (!engine && skipFiles.has(rel)) continue;
  const text = blank(readFileSync(R(rel), 'utf8'));
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  const note = (id, index) => {
    if (!recordIds.has(id) || notIds.has(id)) return;
    if (engine) hits.set(id, (hits.get(id) ?? new Set()).add(`${rel}:${lineAt(index)}`));
    else undeclared.set(rel, (undeclared.get(rel) ?? new Set()).add(id));
  };
  for (const re of PATTERNS) for (const m of text.matchAll(re)) note(m[1], m.index);
  if (!engine) continue;
  for (const m of text.matchAll(TABLE_KEY)) note(m[1], m.index);
  for (const m of text.matchAll(SET_LITERAL)) {
    for (const q of m[1].matchAll(new RegExp(`'${ID}'`, 'g'))) note(q[1], m.index + q.index);
  }
}

const missing = [...hits].filter(([id]) => !known.has(id)).sort();
console.log(`trust-lanes-check: ${hits.size} record ids used as lane keys in ${[...ENGINE_FILES].join(' + ')} (${skipFiles.size} registry files declared, ${notIds.size} ambiguous words excluded)`);
for (const [id, where] of [...hits].sort()) {
  console.log(`  ${known.has(id) ? '·' : '!'} ${id} [${recordIds.get(id).join('+')}] ${[...where].slice(0, 4).join(' ')}`);
}
if (missing.length) {
  die(`${missing.length} id-keyed lane(s) in the engine files with no entry in scripts/data/trust-lanes.json:\n`
    + missing.map(([id, where]) => `  ${id} — ${[...where].join(' ')}`).join('\n')
    + '\n\nAdd each one to that file with its kind and what it does — `"gated": false` with a `why` if the'
    + '\ngate must not touch it (a limit, a prerequisite, a recorded pick, a chassis identity test) — or,'
    + '\nif the word is an ordinary value that merely collides with a record id, add it to `notIds`.');
}
/* A file that is neither an engine file nor a declared registry, yet keys on record ids, is the shape
 * this guard exists to catch: a NEW home for hard-coded lanes nobody has classified. */
if (undeclared.size) {
  die(`${undeclared.size} src/rules file(s) key on core.json record ids and are neither an engine file nor a declared registry:\n`
    + [...undeclared].map(([f, ids]) => `  ${f} — ${[...ids].slice(0, 8).join(', ')}${ids.size > 8 ? `, +${ids.size - 8} more` : ''}`).join('\n')
    + '\n\nEither add the file to `registryFiles` with one line saying which lane gates its table, or move'
    + '\nits ids into `lanes` and gate their readers through engineLaneOff() (src/rules/trustLanes.ts).');
}
/* An entry for an id nobody reads any more is an inventory that has drifted the other way. */
const stale = [...known].filter((id) => !hits.has(id) && !(lanesFile.lanes.find((e) => e.id === id)?.invisibleToGuard));
if (stale.length) die(`trust-lanes.json lists ${stale.length} id(s) no src/rules file reads as a lane key: ${stale.join(', ')}`
  + '\n(delete the entry, or mark it "invisibleToGuard": true with the reason the match cannot see it)');
console.log('trust-lanes-check: OK');
