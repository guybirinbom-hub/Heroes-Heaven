/**
 * Legacy bestiary names → the remaster the tracker serves in their place (decision D11, 2026-10-07).
 *
 * The bestiary index (public/data/index.json, a byte copy of the verified corpus) offers ONE printing per
 * creature or hazard, the newest (ruling R12: the newest printing wins, whole). A legacy page whose
 * Archives entry links a remaster is not in it, even when the remaster carries another name ("Adult Red
 * Dragon" → "Adult Inferno Dragon", "Troll" → "Forest Troll"). Saved encounter tables, portable encounter
 * files and prose links still name the old creature, so the tracker resolves an old name through the link
 * the Archives themselves print, never through a guess from names.
 *
 * Source: the owner's Archives mirror (READ-ONLY), the creature and hazard listings
 *   <mirror>/by-category/creature/_index.json and <mirror>/by-category/hazard/_index.json,
 * each read once. A legacy document carries `remaster_id` (the Elasticsearch field: the ids of its
 * remaster printings). A remaster that is itself superseded is followed the same way, until a record the
 * index serves is reached.
 *
 * Writes public/data/bestiary-aliases.json: { "<legacy name>": "<index row name>" } for every legacy
 * name the index does not hold itself (case-insensitive) and whose link reaches an index row. A legacy
 * name with no link, or whose link reaches no index row, gets no alias: it is printed here, and
 * test/bestiary-corpus-reach.test.ts names it with its Archives id.
 *
 *   node scripts/bestiary-aliases.mjs [--mirror <dir>] [--check]
 *
 * --check writes nothing and exits 1 when the shipped file differs from what the mirror gives.
 * The mirror defaults to HH_AON_MIRROR, else C:/wonderers guide/aon-2e-archive/data.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public/data');
const OUT = join(DATA, 'bestiary-aliases.json');
const HAZARD_FILE = '../hazards.json';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const mi = args.indexOf('--mirror');
const MIRROR = mi >= 0 ? args[mi + 1] : (process.env.HH_AON_MIRROR ?? 'C:/wonderers guide/aon-2e-archive/data');

function stop(msg) {
  console.error(`STOPPED: ${msg}`);
  process.exit(1);
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
/** A source without its page suffix: "GM Core pg. 102" and "GM Core p.102" both read "GM Core". */
const noPage = (s) => String(s ?? '').replace(/\s*(?:pg\.|p\.)\s*\d+.*$/i, '').trim();

/* ---- the mirror: every creature and hazard document's id, name and remaster links ---- */
const docs = new Map();
for (const cat of ['creature', 'hazard']) {
  const p = join(MIRROR, 'by-category', cat, '_index.json');
  if (!existsSync(p)) stop(`${p} is missing — no Archives mirror on this machine, so no alias can be built`);
  const list = readJson(p);
  if (!Array.isArray(list)) stop(`${p} is not a list of documents`);
  for (const d of list) if (d && typeof d.id === 'string') docs.set(d.id, d);
}
const linked = [...docs.values()].filter((d) => Array.isArray(d.remaster_id) && d.remaster_id.length);
if (!linked.length) stop('no creature or hazard document in the mirror carries remaster_id — the field this script reads');

/* ---- what the index serves: the Archives id of each row's record ---- */
const index = readJson(join(DATA, 'index.json'));
const records = [];
for (const f of readdirSync(join(DATA, 'bestiary')).filter((x) => x.endsWith('.json'))) {
  for (const r of readJson(join(DATA, 'bestiary', f)).creature ?? []) records.push({ file: f, r });
}
for (const r of readJson(join(DATA, 'hazards.json')).hazard ?? []) records.push({ file: HAZARD_FILE, r });
const byKey = new Map();
for (const { file, r } of records) {
  const k = `${file}\u0000${r.name}\u0000${r.level}\u0000${noPage(r.source)}`;
  if (!byKey.has(k)) byKey.set(k, r);
}
/** Archives id → the name of the index row that serves that record. */
const servedName = new Map();
for (const row of index) {
  const r = byKey.get(`${row.file}\u0000${row.name}\u0000${row.level}\u0000${noPage(row.source)}`);
  const id = r?._aon?.id;
  if (id && !servedName.has(id)) servedName.set(id, row.name);
}
const rowNames = new Set(index.map((r) => r.name.toLowerCase()));

/** The index row a document reaches: itself, else the first of its remasters that reaches one. */
function reach(id, seen = new Set()) {
  if (seen.has(id)) return null;
  seen.add(id);
  if (servedName.has(id)) return servedName.get(id);
  for (const next of docs.get(id)?.remaster_id ?? []) {
    const hit = reach(next, seen);
    if (hit) return hit;
  }
  return null;
}

const idNum = (id) => parseInt(String(id).replace(/\D+/g, ''), 10) || 0;
const aliases = {};
const conflicts = [];
const unreached = [];
for (const d of linked.sort((a, b) => a.category.localeCompare(b.category) || idNum(a.id) - idNum(b.id))) {
  const name = String(d.name ?? '').trim();
  if (!name || rowNames.has(name.toLowerCase())) continue; // the name opens a row of its own
  const target = reach(d.id);
  if (!target) { unreached.push(`${d.id} ${name} → ${d.remaster_id.join(', ')}`); continue; }
  if (aliases[name] === undefined) aliases[name] = target;
  else if (aliases[name] !== target) conflicts.push(`${name}: ${aliases[name]} (kept) / ${target} (${d.id})`);
}

const sorted = Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b)));
const text = `${JSON.stringify(sorted, null, 1)}\n`;
console.log(`mirror: ${docs.size} creature/hazard documents, ${linked.length} with a remaster link`);
console.log(`aliases: ${Object.keys(sorted).length}; linked but reaching no index row: ${unreached.length}; same name, two targets: ${conflicts.length}`);
for (const u of unreached) console.log(`  no row: ${u}`);
for (const c of conflicts) console.log(`  two targets: ${c}`);

if (CHECK) {
  const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (now !== text) stop(`${OUT} differs from what the mirror gives — run node scripts/bestiary-aliases.mjs`);
  console.log('bestiary-aliases.json matches the mirror');
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}
