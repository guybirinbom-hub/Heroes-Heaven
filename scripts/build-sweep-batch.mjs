/*
 * Builds one batch of the coverage sweep: the unjustified "examined" records of the named lanes, in
 * chunks an agent can read carefully.
 *
 * Usage: node scripts/build-sweep-batch.mjs <batchName> <lane,lane> [chunkSize]
 *   e.g. node scripts/build-sweep-batch.mjs b1 choice,situational 75
 *
 * Every record carries what it ALREADY has (engineFieldsPresent + registry membership), because the
 * repeated failure in this codebase has been judging against one storage location and calling wired
 * records gaps — or missing records wired somewhere else.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const [batch, laneArg, chunkArg] = process.argv.slice(2);
if (!batch || !laneArg) {
  console.error('usage: node scripts/build-sweep-batch.mjs <batchName> <lane,lane> [chunkSize]');
  process.exit(1);
}
const LANES = laneArg.split(',').map((s) => s.trim()).filter(Boolean);
const CHUNK = Number(chunkArg) || 75;

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const examined = JSON.parse(readFileSync(p('work/examined.json'), 'utf8'));
const reasons = existsSync(p('work/examined-reasons.json')) ? JSON.parse(readFileSync(p('work/examined-reasons.json'), 'utf8')) : {};

/** Ids present in each registry — membership is what "modelled" means for these lanes. */
const REGISTRY_FILES = {
  situationalBonuses: 'src/rules/situationalBonuses.ts',
  featGrants: 'src/rules/featGrants.ts',
  featGrantsAuto: 'src/rules/featGrantsAuto.ts',
  featGrantsLane: 'src/rules/featGrantsLane.ts',
  featPickGrants: 'src/rules/featPickGrants.ts',
  featCantripGrants: 'src/rules/featCantripGrants.ts',
  featFeatGrants: 'src/rules/featFeatGrants.ts',
  companionGrants: 'src/rules/companionGrants.ts',
};
const registryOf = {};
for (const [name, file] of Object.entries(REGISTRY_FILES)) {
  let src = '';
  try { src = readFileSync(p(file), 'utf8'); } catch { /* absent is fine */ }
  registryOf[name] = new Set([...src.matchAll(/["']([a-z0-9][a-z0-9-]{2,})["']\s*:/g)].map((m) => m[1]));
}
const modeFromItem = new Set(Object.values(core.modes ?? {}).map((m) => m.fromItemId).filter(Boolean));
const modeFromFeat = new Set(Object.values(core.modes ?? {}).flatMap((m) => m.feats ?? []));

const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances', 'animalCompanions'];
const findRec = (id) => {
  for (const c of COLLECTIONS) if (core[c]?.[id]) return { collection: c, rec: core[c][id] };
  return null;
};
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const ENGINE_FIELDS = [
  'abilityBoosts', 'choice', 'counters', 'effectChoices', 'focusSpells', 'frequency', 'grantedFeatId',
  'grants', 'grantsFeats', 'heldSpells', 'immunities', 'innateSpells', 'limitedUses', 'loreChoices',
  'resistances', 'senses', 'skillChoices', 'speeds', 'spellcasting', 'spellcastingGrant', 'toggle',
  'trainedLore', 'trainedLoreChoice', 'trainedSkill', 'trainedSkillChoice', 'trainedSkills', 'uses',
  'usesUpgrade', 'weaknesses', 'whileActive', 'passiveEffects', 'situational', 'monsterPart',
  'dynamicSkillBonus', 'spellSlotBonus', 'maxHpBonus', 'grantsLanguages',
];

const all = [];
for (const lane of LANES) {
  const idsRaw = examined[lane];
  const ids = (Array.isArray(idsRaw) ? idsRaw : Object.keys(idsRaw ?? {})).slice().sort();
  const lr = reasons[lane] ?? {};
  const unjustified = ids.filter((id) => !(typeof lr[id] === 'string' && lr[id].length > 20));
  for (const id of unjustified) {
    const hit = findRec(id);
    if (!hit) continue;
    const { collection, rec } = hit;
    const inRegistries = Object.entries(registryOf).filter(([, set]) => set.has(id)).map(([n]) => n);
    if (modeFromItem.has(id)) inRegistries.push('core.modes(fromItemId)');
    if (modeFromFeat.has(id)) inRegistries.push('core.modes(feat-gated)');
    if (core.stances?.[id]) inRegistries.push('core.stances');
    all.push({
      id,
      lane,
      collection,
      name: rec.name,
      level: rec.level,
      traits: rec.traits ?? [],
      engineFieldsPresent: ENGINE_FIELDS.filter((f) => rec[f] != null && (!Array.isArray(rec[f]) || rec[f].length)),
      inRegistries,
      text: strip(rec.description).slice(0, 3200),
    });
  }
}

mkdirSync(p(`work/sweep/${batch}`), { recursive: true });
const chunks = [];
for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
chunks.forEach((c, i) => writeFileSync(p(`work/sweep/${batch}/c${i}.json`), JSON.stringify(c, null, 1)));
writeFileSync(p(`work/sweep/${batch}/manifest.json`), JSON.stringify({ batch, lanes: LANES, records: all.length, chunkSize: CHUNK, chunks: chunks.length }, null, 1));

console.log(`batch ${batch}: lanes ${LANES.join(' + ')}`);
console.log(`${all.length} records → ${chunks.length} chunks of ${CHUNK}`);
const already = all.filter((r) => r.inRegistries.length || r.engineFieldsPresent.length).length;
console.log(`${already} of them already carry a field or a registry entry — the sample said many of these are mislabelled, not gaps`);
