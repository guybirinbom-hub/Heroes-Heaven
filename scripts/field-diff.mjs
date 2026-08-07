/*
 * STRUCTURED FIELDS, app vs the AoN mirror.
 *
 * The price sweep found 34 real defects in a field nobody had ever compared. This does the same for
 * every other field the mirror carries structurally, across items, feats and spells.
 *
 * Reported as counts per field first, because a field where thousands disagree means the two sides
 * spell it differently — that is a mapping problem, not thousands of bugs — while a field where a
 * handful disagree is a list of defects.
 *
 * ⚠ TWO TRAPS, both of which produced wrong "fixes" before they were understood:
 *
 *   NAME COLLISIONS. "Breath of the Dragon" is a level-1 dragonblood ancestry feat AND a level-8
 *   archetype feat; "Touch Focus" exists at 14 and at 16; "Death from Above" is a level-16 Mythic
 *   feat and a level-8 uncommon archetype one. Matching on the name alone picks whichever record the
 *   loader happened to keep, so nothing may be changed unless the name resolves to exactly ONE
 *   distinct mirror record. 22 rarity edits and 31 level edits were withdrawn on this rule.
 *
 *   FAMILY HEADS AND CANTRIPS. A heading of `right="Item 4+"` is a RANGE, and a mirror level of 0 on
 *   a graded family (runes, armour materials) is the family, not the record. A cantrip prints
 *   "Cantrip 1" and is rank 0 here by design.
 *
 *   node scripts/field-diff.mjs                 # summary
 *   node scripts/field-diff.mjs --field level   # the rows for one field
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const only = (() => {
  const i = process.argv.indexOf('--field');
  return i > -1 ? process.argv[i + 1] : null;
})();

const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const lower = (a) => [...new Set((Array.isArray(a) ? a : [a]).filter(Boolean).map((x) => norm(x)))].sort();

/** collection in the app -> mirror category, and the fields worth comparing. */
const SETS = [
  {
    app: 'items',
    dirs: ['equipment', 'weapon', 'armor', 'shield'],
    fields: {
      level: (m) => m.level,
      rarity: (m) => (m.rarity ? norm(m.rarity) : undefined),
      traits: (m) => (m.trait ? lower(m.trait) : undefined),
    },
    appValue: {
      level: (r) => r.level,
      rarity: (r) => (r.rarity ? norm(r.rarity) : undefined),
      traits: (r) => (r.traits?.length ? lower(r.traits) : undefined),
    },
  },
  {
    app: 'feats',
    dirs: ['feat'],
    fields: {
      level: (m) => m.level,
      rarity: (m) => (m.rarity ? norm(m.rarity) : undefined),
      traits: (m) => (m.trait ? lower(m.trait) : undefined),
    },
    appValue: {
      level: (r) => r.level,
      rarity: (r) => (r.rarity ? norm(r.rarity) : undefined),
      traits: (r) => (r.traits?.length ? lower(r.traits) : undefined),
    },
  },
  {
    app: 'spells',
    dirs: ['spell'],
    fields: {
      level: (m) => m.level,
      rarity: (m) => (m.rarity ? norm(m.rarity) : undefined),
      traits: (m) => (m.trait ? lower(m.trait) : undefined),
    },
    appValue: {
      level: (r) => r.rank,
      rarity: (r) => (r.rarity ? norm(r.rarity) : undefined),
      traits: (r) => (r.traits?.length ? lower(r.traits) : undefined),
    },
  },
];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const set of SETS) {
  /* name -> the mirror record, preferring the REMASTER half of a pair. */
  const byName = new Map();
  for (const d of set.dirs) {
    let files;
    try { files = readdirSync(join(MIRROR, d)); } catch { continue; }
    for (const f of files) {
      const j = JSON.parse(readFileSync(join(MIRROR, d, f), 'utf8'));
      if (!j.name) continue;
      const k = norm(j.name);
      const prev = byName.get(k);
      if (!prev || (prev.remaster_id && !j.remaster_id)) byName.set(k, j);
    }
  }
  const counts = {};
  const rows = {};
  let compared = 0;
  for (const [id, rec] of Object.entries(db[set.app] ?? {})) {
    if (!rec?.name) continue;
    // A superseded / legacy record is SUPPOSED to differ from the remaster mirror entry.
    if (['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
    const m = byName.get(norm(rec.name));
    if (!m) continue;
    compared++;
    for (const [field, fromMirror] of Object.entries(set.fields)) {
      const want = fromMirror(m);
      const have = set.appValue[field](rec);
      if (want === undefined || have === undefined) continue;
      if (eq(want, have)) continue;
      counts[field] = (counts[field] ?? 0) + 1;
      (rows[field] ??= []).push({ id, have, want });
    }
  }
  console.log(`\n${set.app}: ${compared} compared against the mirror`);
  for (const [f, n] of Object.entries(counts).sort((a, b) => a[1] - b[1])) {
    console.log(`   ${f.padEnd(10)} ${String(n).padStart(5)} differ  (${((n / compared) * 100).toFixed(1)}%)`);
  }
  if (only && rows[only]) {
    console.log(`\n   --- ${set.app}.${only} ---`);
    for (const r of rows[only].slice(0, 60)) {
      console.log(`   ${r.id.padEnd(40)} app ${JSON.stringify(r.have)}  mirror ${JSON.stringify(r.want)}`);
    }
    if (rows[only].length > 60) console.log(`   …and ${rows[only].length - 60} more`);
  }
}
