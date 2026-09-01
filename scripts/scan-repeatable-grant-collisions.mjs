/*
 * WHEN TWO GRANTERS HAND OVER THE SAME REPEATABLE FEAT, HOW OFTEN IS THAT TWO TAKINGS?
 *
 * The feat->feat expansion in build.ts drops a grant whose feat the character already holds:
 *
 *     if (takenFeats.has(gid) && !distinctTaking) continue;
 *
 * `distinctTaking` today means exactly one thing — a grant BOUND to a named Lore. Its own comment
 * says the rule it is defending is "two granters of one NON-REPEATABLE feat grant it once", which is
 * a narrower claim than the code makes: a REPEATABLE feat granted by two different records is two
 * takings, and the second is silently swallowed.
 *
 * A sage jotunborn who takes Jotunborn Lore is the case that surfaced it — their heritage prints
 * "you also gain the Additional Lore general feat" and the feat prints another one — but widening the
 * rule touches every granter, so this counts the blast radius first. Nothing is decided by a rule you
 * have not measured.
 *
 *   node scripts/scan-repeatable-grant-collisions.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { interopDefault: true });
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const { FEAT_FEAT_GRANTS, FEAT_FEAT_GRANTS_LEVELED, FEAT_RANK_FEAT_GRANTS, CHOICE_FEAT_GRANTS, FEAT_GRANT_BOUND_CHOICE } =
  await jiti.import(join(ROOT, 'src/rules/featFeatGrants.ts'));

/** Every (granter -> granted) pair the engine can produce, from every table plus the records' own field. */
const pairs = [];
for (const [g, list] of Object.entries(FEAT_FEAT_GRANTS ?? {})) for (const f of list) pairs.push([g, f, 'FEAT_FEAT_GRANTS']);
for (const [g, list] of Object.entries(FEAT_FEAT_GRANTS_LEVELED ?? {})) for (const r of list) pairs.push([g, r.feat, 'LEVELED']);
for (const [g, list] of Object.entries(FEAT_RANK_FEAT_GRANTS ?? {})) for (const r of list) pairs.push([g, r.feat, 'RANK']);
for (const [g, byChoice] of Object.entries(CHOICE_FEAT_GRANTS ?? {}))
  for (const list of Object.values(byChoice)) for (const f of list) pairs.push([g, f, 'CHOICE']);
for (const bucket of ['feats', 'heritages', 'classFeatures', 'items', 'backgrounds']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    for (const f of rec.grantsFeats ?? []) pairs.push([id, f, `${bucket}.grantsFeats`]);
  }
}

const repeatable = (id) => core.feats[id]?.maxTakable === null || (core.feats[id]?.maxTakable ?? 1) > 1;

/** granted feat -> the distinct granters that hand it over. */
const granters = new Map();
for (const [g, f] of pairs) {
  if (!core.feats[f]) continue;
  if (!granters.has(f)) granters.set(f, new Set());
  granters.get(f).add(g);
}

const contested = [...granters.entries()].filter(([, gs]) => gs.size > 1).sort((a, b) => b[1].size - a[1].size);
const repeatContested = contested.filter(([f]) => repeatable(f));

console.log(`${pairs.length} grant pair(s); ${granters.size} distinct granted feat(s).`);
console.log(`${contested.length} feat(s) are granted by more than one record; ${repeatContested.length} of those are REPEATABLE.\n`);

console.log('REPEATABLE + MULTIPLE GRANTERS — every pair here is a second taking the dedupe can swallow:');
for (const [f, gs] of repeatContested) {
  const bound = [...gs].filter((g) => FEAT_GRANT_BOUND_CHOICE?.[g]?.[f]);
  console.log(`   ${f}  (maxTakable ${core.feats[f].maxTakable === null ? 'unlimited' : core.feats[f].maxTakable})  <- ${gs.size} granter(s)`);
  console.log(`      ${[...gs].join(', ')}`);
  if (bound.length) console.log(`      already exempt (bound to a named Lore): ${bound.join(', ')}`);
}

/* The ones that would NOT change: a non-repeatable feat with several granters is exactly what the
 * dedupe exists for, and widening the rule must leave every one of them alone. */
console.log(`\nNOT REPEATABLE, several granters (unchanged by any widening): ${contested.length - repeatContested.length}`);
for (const [f, gs] of contested.filter(([f2]) => !repeatable(f2)).slice(0, 12)) console.log(`   ${f} <- ${gs.size}`);
