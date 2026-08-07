/*
 * ORPHAN CLASS FEATURES — records `ownedFeatureIds` can never contain.
 *
 * A classFeature that no route reaches is invisible no matter what fields it carries, and it LOOKS
 * built, which makes it the most expensive failure mode in this data.
 *
 * Reachability is computed with the SHIPPED functions (classFeatureIdsOwned / choiceOwnedFeatureIds)
 * driven over every class, every subclass option, every extra choice and every feat choice, plus the
 * two grant lanes buildCharacter adds on top. Re-implementing the rules here is what let earlier
 * counts drift — a structural guess said 313 where the engine says far fewer.
 *
 *   npx jiti scripts/orphan-features.mjs                 # summary
 *   npx jiti scripts/orphan-features.mjs --out work/orphans.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classFeatureIdsOwned, choiceOwnedFeatureIds } from '../src/rules/derive';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const db = JSON.parse(read('public/core.json'));
{
  const desc = JSON.parse(read('public/core-descriptions.json'));
  for (const [bucket, records] of Object.entries(desc)) {
    if (!db[bucket]) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = db[bucket][id];
      if (rec && v.d !== undefined) rec.description = v.d;
    }
  }
}

const features = db.classFeatures ?? {};
const reachable = new Set();
const routeOf = new Map();
const mark = (id, route) => {
  if (!id || !features[id]) return;
  if (!reachable.has(id)) routeOf.set(id, route);
  reachable.add(id);
};

// ── 1. Every class × every subclass option, at level 20 (the widest set). ──
for (const cls of Object.values(db.classes ?? {})) {
  const subs = [null, ...(cls.subclass?.options ?? []).map((o) => o.id ?? o.value)];
  for (const sub of subs) {
    for (const id of classFeatureIdsOwned({ classId: cls.id, subclassId: sub, level: 20 }, db)) {
      mark(id, `class:${cls.id}${sub ? `/${sub}` : ''}`);
    }
  }
  // ── 2. Extra choices (ikons, apparitions, implements, curricula) arrive as classChoices. ──
  const extraIds = [];
  const collect = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(collect);
    for (const [k, v] of Object.entries(n)) {
      if ((k === 'id' || k === 'value') && typeof v === 'string') extraIds.push(v);
      else collect(v);
    }
  };
  collect(cls.extraChoices ?? cls.choices ?? []);
  for (const id of classFeatureIdsOwned(
    { classId: cls.id, level: 20, classChoices: extraIds.map((id) => ({ id, level: 1 })) },
    db,
  )) mark(id, `extraChoice:${cls.id}`);
}

// ── 3. Feat choices that OWN a feature, and derivedGrant chains. ──
{
  const feats = [];
  for (const f of Object.values(db.feats ?? {})) {
    for (const o of f.choice?.options ?? []) feats.push({ featId: f.id, choice: { value: o.value ?? o.id } });
    if (!f.choice?.options?.length) feats.push({ featId: f.id });
  }
  for (const id of choiceOwnedFeatureIds(feats, db)) mark(id, 'featChoice');
}

// ── 4. The two grant lanes buildCharacter applies on top of the routes above. ──
const walkGrants = (node, src) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((v) => walkGrants(v, src));
  for (const [k, v] of Object.entries(node)) {
    if (k === 'grantsClassFeatures') for (const id of Array.isArray(v) ? v : [v]) mark(id, src);
    else if (k === 'addFeatures') for (const a of Array.isArray(v) ? v : [v]) mark(a?.featureId, src);
    else walkGrants(v, src);
  }
};
for (const [bucket, records] of Object.entries(db)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [id, rec] of Object.entries(records)) walkGrants(rec, `${bucket}:${id}`);
}
// …and again from whatever those grants reached, until it stops growing.
for (let pass = 0; pass < 8; pass++) {
  const before = reachable.size;
  for (const id of [...reachable]) walkGrants(features[id], `classFeatures:${id}`);
  if (reachable.size === before) break;
}

/** Fields whose absence actually costs the player something. */
const MECHANICAL = [
  'grant', 'grants', 'effectChoices', 'choice', 'proficiencies', 'skills', 'skillChoices',
  'passiveEffects', 'situational', 'defenses', 'senses', 'resistances', 'immunities', 'weaknesses',
  'spellcasting', 'focusPool', 'innateSpells', 'spellListAdditions', 'restrictedSlots',
  'grantsActions', 'grantsRituals', 'extraReaction', 'limitedUses', 'classResource', 'modes',
  'companion', 'strikes', 'speeds', 'hpPerLevel', 'classArchetype', 'weaponGroupRanks',
  'checkPenaltyRelief', 'spellSlotBonus', 'spellcastingGrant', 'featChoices', 'uses',
];
const orphans = [];
for (const [id, rec] of Object.entries(features)) {
  if (reachable.has(id)) continue;
  const fields = MECHANICAL.filter((f) => rec[f] != null && (!Array.isArray(rec[f]) || rec[f].length));
  orphans.push({
    id,
    name: rec.name,
    level: rec.level ?? null,
    otherTags: rec.otherTags ?? [],
    traits: rec.traits ?? [],
    mechanicalFields: fields,
    description: String(rec.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  });
}
orphans.sort((a, b) => b.mechanicalFields.length - a.mechanicalFields.length || a.id.localeCompare(b.id));

const withFields = orphans.filter((o) => o.mechanicalFields.length);
console.log(`classFeatures: ${Object.keys(features).length}`);
console.log(`reachable:     ${reachable.size}`);
console.log(`ORPHANS:       ${orphans.length}   (${withFields.length} carry a live mechanical field)`);
for (const o of withFields) console.log(`  ! ${o.id.padEnd(40)} ${o.mechanicalFields.join(',')}`);

const outIdx = process.argv.indexOf('--out');
if (outIdx > -1 && process.argv[outIdx + 1]) {
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, process.argv[outIdx + 1]), JSON.stringify(orphans, null, 1));
  console.log(`\nwrote ${orphans.length} -> ${process.argv[outIdx + 1]}`);
}
