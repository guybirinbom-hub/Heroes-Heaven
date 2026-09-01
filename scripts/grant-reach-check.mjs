/*
 * WHICH GRANT-TABLE KEYS CAN THE ENGINE ACTUALLY REACH?
 *
 * `FEAT_FEAT_GRANTS` is iterated from a queue seeded with the character's FEATS and owned CLASS
 * FEATURES (build.ts). A key that is neither — a heritage id, an ancestry id, a background — is
 * authored, committed, covered by nothing, and fires for nobody. That is the write-only shape this
 * project keeps rediscovering: the entry exists, so every "is it modelled?" query says yes.
 *
 * jotunborn-lore surfaced ONE of them (`FEAT_FEAT_GRANTS['sage-jotunborn']`). This script asks how
 * many more there are before anyone builds a lane for the one — a count is the difference between a
 * one-record fix and a systemic one.
 *
 *   node scripts/scan-heritage-grant-reach.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { interopDefault: true });
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const { FEAT_FEAT_GRANTS, FEAT_FEAT_GRANTS_LEVELED, FEAT_RANK_FEAT_GRANTS, CHOICE_FEAT_GRANTS, EXTRA_FEAT_TAKINGS, FEAT_SUBSTITUTE_GRANTS } =
  await jiti.import(join(ROOT, 'src/rules/featFeatGrants.ts'));
const { FEAT_GRANTS } = await jiti.import(join(ROOT, 'src/rules/featGrants.ts'));

/** Where an id lives in the data. The order matters only for reporting — no id collides in practice. */
const bucketOf = (id) => {
  for (const b of ['feats', 'classFeatures', 'heritages', 'ancestries', 'backgrounds', 'items', 'classes', 'spells']) {
    if (core[b]?.[id]) return b;
  }
  return 'NOWHERE';
};

/* The buckets the queue is seeded from (build.ts: `feats.map(f => f.featId)`, the character's two
 * HERITAGES, and `classFeatureIdsOwned(...)`). Everything else in a feat->feat table is unreachable BY
 * CONSTRUCTION, not by accident of a particular character's choices.
 *
 * ⚠ Heritages joined this list only when the seeding was fixed — 34 entries had been sitting here
 * firing for nobody. Adding a bucket to this set without adding it to the seed turns the guard into a
 * rubber stamp, which is the failure mode it exists to prevent. */
const REACHABLE = new Set(['feats', 'classFeatures', 'heritages']);

const TABLES = [
  ['FEAT_FEAT_GRANTS', FEAT_FEAT_GRANTS],
  ['FEAT_FEAT_GRANTS_LEVELED', FEAT_FEAT_GRANTS_LEVELED],
  ['FEAT_RANK_FEAT_GRANTS', FEAT_RANK_FEAT_GRANTS],
  ['CHOICE_FEAT_GRANTS', CHOICE_FEAT_GRANTS],
  ['EXTRA_FEAT_TAKINGS', EXTRA_FEAT_TAKINGS],
  ['FEAT_SUBSTITUTE_GRANTS', FEAT_SUBSTITUTE_GRANTS],
];

let unreachable = 0;
for (const [name, table] of TABLES) {
  const rows = Object.keys(table ?? {}).map((id) => [id, bucketOf(id)]);
  const bad = rows.filter(([, b]) => !REACHABLE.has(b));
  const counts = {};
  for (const [, b] of rows) counts[b] = (counts[b] ?? 0) + 1;
  console.log(`\n${name}: ${rows.length} key(s) — ${Object.entries(counts).map(([b, n]) => `${b} ${n}`).join(', ')}`);
  for (const [id, b] of bad) {
    const grants = JSON.stringify(table[id]);
    console.log(`   UNREACHABLE  ${id}  [${b}]  -> ${grants.length > 90 ? grants.slice(0, 90) + '…' : grants}`);
    /* A heritage that ALSO carries the grant in its own record is already delivered by the live
     * `grantsFeats` lane — the table entry is redundant rather than a missing grant. Worth separating:
     * the two need opposite fixes. */
    if (b === 'heritages' && core.heritages[id]?.grantsFeats?.length) {
      console.log(`                 …but heritages/${id}.grantsFeats = ${JSON.stringify(core.heritages[id].grantsFeats)} — the live lane already delivers it.`);
    }
  }
  unreachable += bad.length;
}

/* FEAT_GRANTS (proficiencies/skills, not feats) is iterated over the built feat list AND owned class
 * features. Same question, different table — and it is the one that carries a heritage's "you are
 * trained in Society". */
const fgRows = Object.keys(FEAT_GRANTS ?? {}).map((id) => [id, bucketOf(id)]);
const fgBad = fgRows.filter(([, b]) => !REACHABLE.has(b));
const fgCounts = {};
for (const [, b] of fgRows) fgCounts[b] = (fgCounts[b] ?? 0) + 1;
console.log(`\nFEAT_GRANTS: ${fgRows.length} key(s) — ${Object.entries(fgCounts).map(([b, n]) => `${b} ${n}`).join(', ')}`);
for (const [id, b] of fgBad) console.log(`   NOT A FEAT/FEATURE  ${id}  [${b}]  -> ${JSON.stringify(FEAT_GRANTS[id]).slice(0, 90)}`);

console.log(`\n${unreachable} feat-granting key(s) the queue can never reach; ${fgBad.length} FEAT_GRANTS key(s) outside the reachable buckets.`);
if (unreachable || fgBad.length) {
  console.error('\ngrant-reach: FAILED — an authored grant that no character can reach is a grant delivered to nobody,');
  console.error('while every "is it modelled?" query still answers yes. Either seed the bucket in build.ts or move the row.');
  process.exit(1);
}
console.log('grant-reach: ok — every grant-table key sits in a bucket the engine seeds.');
