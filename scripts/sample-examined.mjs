/*
 * Builds a stratified sample of the 3,895 "examined" records that carry no recorded reason.
 *
 * The point is a MISS RATE, not a fix list. If agents reading the printed text find nothing wrong,
 * the previous passes were right and the claim can be made with evidence instead of confidence. If
 * they find misses, the sample size tells us roughly how many there are in the whole 3,895.
 *
 * Sampling is deterministic (every Nth record after sorting by id) so the run is reproducible and so
 * nobody can accuse the sample of being the easy ones — Date.now()/Math.random() are unavailable in
 * workflow scripts anyway.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const examined = JSON.parse(readFileSync(p('work/examined.json'), 'utf8'));
const reasons = existsSync(p('work/examined-reasons.json')) ? JSON.parse(readFileSync(p('work/examined-reasons.json'), 'utf8')) : {};

const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances', 'animalCompanions'];
const findRec = (id) => {
  for (const c of COLLECTIONS) if (core[c]?.[id]) return { collection: c, rec: core[c][id] };
  return null;
};
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/** Every field the engine actually reads, so the sample carries what the record already has. */
const ENGINE_FIELDS = [
  'abilityBoosts', 'choice', 'counters', 'effectChoices', 'focusSpells', 'frequency', 'grantedFeatId',
  'grants', 'grantsFeats', 'heldSpells', 'immunities', 'innateSpells', 'limitedUses', 'loreChoices',
  'resistances', 'senses', 'skillChoices', 'speeds', 'spellcasting', 'spellcastingGrant', 'toggle',
  'trainedLore', 'trainedLoreChoice', 'trainedSkill', 'trainedSkillChoice', 'trainedSkills', 'uses',
  'usesUpgrade', 'weaknesses', 'whileActive', 'passiveEffects', 'situational', 'monsterPart',
];

const PER_LANE = 30;
const out = {};
let total = 0;
for (const [lane, idsRaw] of Object.entries(examined)) {
  const ids = (Array.isArray(idsRaw) ? idsRaw : Object.keys(idsRaw ?? {})).slice().sort();
  const laneReasons = reasons[lane] ?? {};
  const unjustified = ids.filter((id) => !(typeof laneReasons[id] === 'string' && laneReasons[id].length > 20));
  if (!unjustified.length) continue;
  // Evenly spaced across the sorted list — a spread, not the first N.
  const step = Math.max(1, Math.floor(unjustified.length / PER_LANE));
  const picked = [];
  for (let i = 0; i < unjustified.length && picked.length < PER_LANE; i += step) picked.push(unjustified[i]);

  out[lane] = picked
    .map((id) => {
      const hit = findRec(id);
      if (!hit) return null;
      const { collection, rec } = hit;
      const has = ENGINE_FIELDS.filter((f) => rec[f] != null && (!Array.isArray(rec[f]) || rec[f].length));
      return {
        id,
        lane,
        collection,
        name: rec.name,
        level: rec.level,
        traits: rec.traits ?? [],
        // What the record ALREADY carries — the thing previous passes kept getting wrong by checking
        // only one location.
        engineFieldsPresent: has,
        text: strip(rec.description).slice(0, 3000),
      };
    })
    .filter(Boolean);
  total += out[lane].length;
  console.log(`${lane.padEnd(14)} ${String(unjustified.length).padStart(4)} unjustified → sampled ${out[lane].length}`);
}

mkdirSync(p('work/verify'), { recursive: true });
for (const [lane, list] of Object.entries(out)) writeFileSync(p(`work/verify/${lane}.json`), JSON.stringify(list, null, 1));
writeFileSync(p('work/verify/all.json'), JSON.stringify(out, null, 1));
console.log(`\n${total} records sampled across ${Object.keys(out).length} lanes → work/verify/`);
