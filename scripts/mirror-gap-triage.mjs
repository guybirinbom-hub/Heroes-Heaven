/**
 * THE IMPORT GAP, SPLIT INTO "WE MEANT TO" AND "WE DID NOT".
 *
 * `mirror-import-gap.mjs` says 17,324 mirror documents are absent from core.json. Quoting that as a
 * gap would be wrong, and wrong in the direction this project has been wrong five times before —
 * counting the CONDITION (absent) instead of the OUTCOME (absent AND should be present).
 *
 * Four reasons a mirror document is legitimately not in core.json:
 *
 *   SUPERSEDED   the document carries `remaster_id`, meaning Paizo reprinted it and AoN points at the
 *                replacement. We import the replacement. Dwarven Lore (feat-1) -> feat-4388.
 *   NOT A PLAYER RECORD  creatures, hazards, sidebars, category pages. A character sheet has no use
 *                for a bestiary entry, and the app has never claimed to hold one.
 *   ALREADY HELD UNDER ANOTHER BUCKET  the mirror splits `weapon`, `relic` and `vehicle` out of
 *                `equipment`; we hold all of them in `items`, so the naive per-category count
 *                double-reports them as missing.
 *   NO MECHANICS  a stub document with no rules text.
 *
 * What is left after those four is the real work list.
 *
 *   node scripts/mirror-gap-triage.mjs
 *   node scripts/mirror-gap-triage.mjs --category feat --list
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

/* Categories a character sheet actually draws from. Creatures, hazards, sidebars and the rest are
 * reference material for a GM; leaving them out is a scope decision, not an import failure. */
const PLAYER_CATEGORIES = [
  'feat', 'class-feature', 'equipment', 'weapon', 'relic', 'vehicle', 'spell', 'ritual', 'action',
  'deity', 'background', 'heritage', 'ancestry', 'archetype', 'condition', 'trait', 'language',
  'domain', 'animal-companion', 'familiar-ability',
];

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
/* ONE global set. The mirror's categories and our buckets do not line up (weapon/relic/vehicle all
 * land in `items`), so asking "is this id anywhere in core.json" is the only honest question. */
const held = new Set();
for (const records of Object.values(core)) {
  if (!records || typeof records !== 'object') continue;
  for (const rec of Object.values(records)) if (rec?.aonId != null) held.add(String(rec.aonId));
}

const rows = [];
for (const cat of PLAYER_CATEGORIES) {
  const dir = join(MIRROR, cat);
  if (!existsSync(dir)) continue;
  const buckets = { superseded: 0, noMechanics: 0, real: [] };
  let total = 0;
  for (const fn of readdirSync(dir)) {
    if (!fn.endsWith('.json') || fn === '_index.json') continue;
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, fn), 'utf8')); } catch { continue; }
    const src = doc._source ?? doc;
    const id = String(src.id ?? doc.id ?? '');
    if (!id) continue;
    total++;
    if (held.has(id)) continue;
    /* A `remaster_id` means AoN itself says "this was replaced by that". If we hold the replacement,
     * the absence is correct. If we hold NEITHER, it is still a gap — check, don't assume. */
    const remasterIds = [].concat(src.remaster_id ?? []).map(String);
    if (remasterIds.length && remasterIds.some((r) => held.has(r))) { buckets.superseded++; continue; }
    const text = String(src.text ?? src.markdown ?? '').trim();
    if (!text) { buckets.noMechanics++; continue; }
    buckets.real.push({
      aonId: id,
      name: src.name ?? '(unnamed)',
      level: src.level ?? null,
      source: [].concat(src.source ?? [])[0] ?? null,
      rarity: src.rarity ?? null,
      chars: text.length,
      supersededByMissing: remasterIds.length > 0,
    });
  }
  rows.push({ category: cat, total, superseded: buckets.superseded, noMechanics: buckets.noMechanics, real: buckets.real });
}

rows.sort((a, b) => b.real.length - a.real.length);
console.log(`${'category'.padEnd(20)} ${'mirror'.padStart(8)} ${'superseded'.padStart(11)} ${'no text'.padStart(8)} ${'REAL GAP'.padStart(9)}`);
for (const r of rows) {
  console.log(`${r.category.padEnd(20)} ${String(r.total).padStart(8)} ${String(r.superseded).padStart(11)} ${String(r.noMechanics).padStart(8)} ${String(r.real.length).padStart(9)}`);
}
const T = (k) => rows.reduce((n, r) => n + (k === 'real' ? r.real.length : r[k]), 0);
console.log(`\n${'TOTAL'.padEnd(20)} ${String(T('total')).padStart(8)} ${String(T('superseded')).padStart(11)} ${String(T('noMechanics')).padStart(8)} ${String(T('real')).padStart(9)}`);

/* Where does the real gap come from? A book we never imported is a very different problem from a
 * scatter of individual misses. */
const bySource = {};
for (const r of rows) for (const m of r.real) bySource[m.source ?? '(none)'] = (bySource[m.source ?? '(none)'] ?? 0) + 1;
console.log(`\nREAL GAP by source book (top 25):`);
for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${s}`);

const only = arg('--category', null);
if (has('--list') && only) {
  const r = rows.find((x) => x.category === only);
  console.log(`\n--- ${only}: real gap (${r?.real.length ?? 0}) ---`);
  for (const m of (r?.real ?? []).slice(0, 60)) {
    console.log(`  ${m.aonId.padEnd(14)} lvl ${String(m.level ?? '?').padStart(2)}  ${String(m.name).slice(0, 44).padEnd(44)} ${String(m.rarity ?? '').padEnd(9)} ${m.source ?? ''}`);
  }
}

const dest = arg('--out', null);
if (dest) { writeFileSync(join(ROOT, dest), JSON.stringify(rows, null, 1)); console.log(`\n-> ${dest}`); }
