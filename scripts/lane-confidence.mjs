/**
 * LANE CONFIDENCE INVENTORY
 *
 * The question this answers: for each way the app has of turning printed text into sheet movement,
 * how much evidence do we actually have that it works? Not "does it exist" — evidence.
 *
 * Four independent instruments per field, because each catches a failure the others cannot:
 *
 *   1. RECORDS      how many records carry it. A lane on 4 records and a lane on 900 are not the
 *                   same risk even at the same defect rate.
 *   2. READER       is the field named anywhere in src/, and is it named in the ENGINE
 *                   (src/rules/*) rather than only in a component? A field read only by a UI file
 *                   renders somewhere but does not move a number. A field read nowhere is inert —
 *                   this project has shipped that four times with a green suite.
 *   3. TESTS        how many test files name it, and — separately — how many assert a NUMBER
 *                   changed rather than merely that a string appears. Text assertions were vacuous
 *                   twice this month (a chip test that passed on the feat's own description).
 *   4. SAMPLED      has a human-or-agent read the printed text of records in this lane and checked
 *                   the encoding against it. Structural checks cannot find a lane that is present,
 *                   read, tested, and simply WRONG about the rule.
 *
 * Confidence is the MINIMUM of these, never the average: a lane with 900 records, a reader, and 40
 * tests that nobody ever compared against the printed rules is not a confident lane.
 *
 * Usage:  node scripts/lane-confidence.mjs [--json]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ---------------------------------------------------------------- the corpus */
const core = JSON.parse(read('public/core.json'));
const COLLECTIONS = [
  'feats', 'classFeatures', 'ancestries', 'heritages', 'backgrounds', 'classes',
  'items', 'spells', 'actions', 'deities', 'archetypes', 'conditions',
];

/** Fields that describe a record rather than change the sheet. Counting them as lanes is noise. */
const INERT = new Set([
  'id', 'name', 'description', 'descRefs', 'traits', 'level', 'category', 'source', 'sourceId',
  'aonId', 'aonOrigin', 'rarity', 'edition', 'prerequisites', 'access', 'frequency', 'trigger',
  'requirements', 'cost', 'special', 'archetype', 'maxTakable', 'onlyAtLevel', 'subcategory',
  'price', 'bulk', 'usage', 'hands', 'group', 'itemType', 'craftReq', 'contract', 'school',
  'tradition', 'traditions', 'range', 'targets', 'area', 'duration', 'defense', 'heightened',
  'summary', 'text', 'type', 'key', 'slug', 'page', 'pfsLegal', 'legacy', 'remaster',
  /* Provenance from the AoN import. Deliberately read by nothing — they exist so a record can be
   * traced back to its source page, not so anything moves. Counting them as inert lanes was noise. */
  'aonParentId', 'aonSection',
]);

/* ---------------------------------------------------------------- 2. readers */
const collectSrc = (dir, filter) => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(e.name)) out.push({ path: p.slice(ROOT.length + 1).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(join(ROOT, dir));
  return out;
};
const srcFiles = collectSrc('src', (n) => /\.tsx?$/.test(n));
const engineText = srcFiles.filter((f) => f.path.startsWith('src/rules/')).map((f) => f.text).join('\n');
const uiText = srcFiles.filter((f) => !f.path.startsWith('src/rules/')).map((f) => f.text).join('\n');

/* ---------------------------------------------------------------- 3. tests */
const testFiles = existsSync(join(ROOT, 'test')) ? collectSrc('test', (n) => /\.tsx?$/.test(n)) : [];
/** A test that asserts a number/array/boolean, not that a string is on the page. */
const NUMERIC_ASSERT = /toBe\(\s*-?\d|toEqual\(\s*[[{]|toBeCloseTo|toHaveLength|toBeGreaterThan|toBeLessThan|toContainEqual/;

/* ---------------------------------------------------------------- 4. sampled */
/** Audits that read printed text and judged the encoding. Each records the ids it examined. */
const auditEvidence = () => {
  const seen = new Map(); // field -> Set of audit names
  const files = [
    'scripts/audit/audit-500-result.json',
    'scripts/audit/batch-001-applied.json',
    'scripts/audit/_reassess-final.json',
    'scripts/audit/authored-fix-recheck.json',
  ];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    let txt;
    try { txt = read(f); } catch { continue; }
    for (const field of ALL_FIELDS) {
      if (txt.includes(`"${field}"`) || txt.includes(`\`${field}\``) || txt.includes(` ${field} `)) {
        if (!seen.has(field)) seen.set(field, new Set());
        seen.get(field).add(f.split('/').pop());
      }
    }
  }
  return seen;
};

/* ---------------------------------------------------------------- count records */
const counts = new Map(); // field -> {records, collections:Set}
const bump = (field, coll) => {
  if (INERT.has(field)) return;
  if (!counts.has(field)) counts.set(field, { records: 0, collections: new Set() });
  const c = counts.get(field);
  c.records++;
  c.collections.add(coll);
};
for (const coll of COLLECTIONS) {
  const bucket = core[coll];
  if (!bucket) continue;
  for (const rec of Object.values(bucket)) {
    if (!rec || typeof rec !== 'object') continue;
    for (const k of Object.keys(rec)) bump(k, coll);
    /* passiveEffects is a lane container — its keys are the real lanes. */
    if (rec.passiveEffects && typeof rec.passiveEffects === 'object') {
      for (const k of Object.keys(rec.passiveEffects)) bump(`passiveEffects.${k}`, coll);
    }
  }
}
const ALL_FIELDS = [...counts.keys()];
const sampled = auditEvidence();

/* ---------------------------------------------------------------- score */
const rows = [];
for (const [field, { records, collections }] of counts) {
  const leaf = field.includes('.') ? field.split('.').pop() : field;
  const inEngine = engineText.includes(field) || engineText.includes(`.${leaf}`) || engineText.includes(`'${leaf}'`);
  const inUi = uiText.includes(field) || uiText.includes(`.${leaf}`) || uiText.includes(`'${leaf}'`);
  const named = testFiles.filter((t) => t.text.includes(leaf));
  const hard = named.filter((t) => NUMERIC_ASSERT.test(t.text)).length;
  rows.push({
    field, records, collections: [...collections].join('+'),
    reader: inEngine ? 'engine' : inUi ? 'ui-only' : 'NONE',
    tests: named.length, hardTests: hard,
    sampled: sampled.has(field) ? [...sampled.get(field)].length : 0,
  });
}

/* Confidence = the weakest instrument. */
const tier = (r) => {
  if (r.reader === 'NONE') return 'D · inert';
  if (r.reader === 'ui-only') return 'C · displays only';
  if (r.tests === 0) return 'C · untested';
  if (r.hardTests === 0) return 'B · text-tested only';
  if (r.sampled === 0) return 'B · never sampled';
  return 'A · read + hard-tested + sampled';
};
for (const r of rows) r.tier = tier(r);
rows.sort((a, b) => a.tier.localeCompare(b.tier) || b.records - a.records);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const byTier = new Map();
  for (const r of rows) {
    if (!byTier.has(r.tier)) byTier.set(r.tier, []);
    byTier.get(r.tier).push(r);
  }
  for (const [t, rs] of byTier) {
    const recs = rs.reduce((n, r) => n + r.records, 0);
    console.log(`\n${'='.repeat(90)}\n${t}   —   ${rs.length} fields, ${recs.toLocaleString()} record-uses\n`);
    console.log(`  ${'field'.padEnd(34)} ${'recs'.padStart(6)}  ${'reader'.padEnd(9)} ${'tests'.padStart(5)} ${'hard'.padStart(5)} ${'smpl'.padStart(5)}  where`);
    for (const r of rs.slice(0, 60)) {
      console.log(`  ${r.field.padEnd(34)} ${String(r.records).padStart(6)}  ${r.reader.padEnd(9)} ${String(r.tests).padStart(5)} ${String(r.hardTests).padStart(5)} ${String(r.sampled).padStart(5)}  ${r.collections.slice(0, 34)}`);
    }
    if (rs.length > 60) console.log(`  … and ${rs.length - 60} more`);
  }
  console.log(`\n${'='.repeat(90)}\nfields: ${rows.length}   record-uses: ${rows.reduce((n, r) => n + r.records, 0).toLocaleString()}`);
}
