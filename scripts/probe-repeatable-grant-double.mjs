/*
 * WOULD "TWO GRANTERS OF A REPEATABLE FEAT = TWO TAKINGS" DOUBLE-GRANT ANYONE?
 *
 * The blanket rule is tempting and the measurement (scan-repeatable-grant-collisions.mjs) says only
 * seven feats could move. But two of `domain-initiate`'s four granters are `cloistered-cleric` and
 * `first-doctrine-cloistered-cleric` — which look like ONE printed grant expressed twice, on a
 * doctrine and on that doctrine's first-doctrine feature. If a real cloistered cleric owns both, the
 * dedupe is the only thing stopping a second domain today, and widening it hands out a domain the
 * rules never printed.
 *
 * So: build the characters and count. A rule you have not run is a guess.
 *
 *   node scripts/probe-repeatable-grant-double.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { interopDefault: true });

const { loadContent } = await jiti.import(join(ROOT, 'test/_content.ts')).catch(() => ({}));
const { buildCharacter, emptyBuild } = await jiti.import(join(ROOT, 'src/rules/build.ts'));
const { classFeatureIdsOwned } = await jiti.import(join(ROOT, 'src/rules/derive.ts'));
const { readFileSync } = await import('node:fs');

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8').replace(/^﻿/, ''));
/* core.json ships descriptions in a sibling file (the 22.5 -> 8.4 MB split). Merged back so any
 * predicate reading a record by TEXT sees what the app sees. */
for (const [bucket, byId] of Object.entries(descs)) {
  for (const [id, d] of Object.entries(byId)) {
    if (core[bucket]?.[id] && d?.d) core[bucket][id].description = d.d;
  }
}
const content = core;

const mk = (over) => ({ ...emptyBuild(), ...over });

const show = (label, build) => {
  const c = buildCharacter(build, content);
  const counts = {};
  for (const f of c.feats) counts[f.featId] = (counts[f.featId] ?? 0) + 1;
  const interesting = ['domain-initiate', 'additional-lore', 'terrain-stalker', 'terrain-expertise', 'assurance', 'multilingual', 'qi-spells']
    .filter((id) => counts[id])
    .map((id) => `${id} x${counts[id]}`);
  console.log(`${label}: ${interesting.join(', ') || '(none of the repeatables)'}`);
  return c;
};

console.log('--- owned feature ids for a cloistered cleric ---');
const clericBuild = mk({ classId: 'cleric', subclassId: 'cloistered-cleric', level: 3, ancestryId: 'human', heritageId: 'skilled-human' });
const owned = [...classFeatureIdsOwned(clericBuild, content)];
const both = ['cloistered-cleric', 'first-doctrine-cloistered-cleric'].filter((id) => owned.includes(id));
console.log(`owns: ${both.join(' + ') || '(neither)'}  — ${both.length === 2 ? '⚠ BOTH, so the blanket rule WOULD double-grant' : 'only one, so the blanket rule is safe here'}`);

console.log('\n--- current behaviour ---');
show('cloistered cleric L3', clericBuild);
show('sage jotunborn fighter L1 + Jotunborn Lore', mk({
  classId: 'fighter', level: 1, ancestryId: 'jotunborn', heritageId: 'sage-jotunborn',
  featPicks: { '1:ancestry:0': 'jotunborn-lore' },
}));
show('sage jotunborn fighter L1, no feat', mk({
  classId: 'fighter', level: 1, ancestryId: 'jotunborn', heritageId: 'sage-jotunborn',
}));
show('anvil dwarf fighter L1 (heritage -> Specialty Crafting)', mk({
  classId: 'fighter', level: 1, ancestryId: 'dwarf', heritageId: 'anvil-dwarf',
}));
// Batch 24's widening, covered in BOTH directions: a slot take with a DIFFERENT domain than the
// doctrine grant must print x2 (two printed takings), while the plain cloistered line above must
// stay x1 (grant-vs-grant still collapses).
show('cloistered cleric L3 + slot Domain Initiate (might)', mk({
  classId: 'cleric', subclassId: 'cloistered-cleric', level: 3, ancestryId: 'human', heritageId: 'skilled-human',
  deityId: 'jaidi',
  featPicks: { '1:class:0': 'domain-initiate' },
  featChoices: { '1:class:0': 'might' },
  grantedFeatChoices: { 'domain-initiate': 'family' },
}));
