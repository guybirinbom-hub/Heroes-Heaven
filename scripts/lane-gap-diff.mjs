/*
 * ONE-WAY VOCABULARY DIFF — systems another implementation models that this app has no route for.
 *
 * Foundry's pf2e system attaches machine-executable "rule elements" to 2,409 of our live feats. Each
 * rule element type is a claim that a character sheet must be able to express something. Comparing
 * that vocabulary to ours yields a sized list of missing systems without reading 6,179 feats.
 *
 * ⚠ READ IT IN ONE DIRECTION ONLY.
 *   - "Foundry models X, we carry nothing"  -> a real candidate gap.
 *   - "Foundry is silent"                   -> NO INFORMATION. 3,537 of our feats exist in Foundry with
 *     zero rule elements, because a VTT assumes a human GM adjudicates. This app has no such luxury,
 *     so Foundry's silence says nothing about whether we need a system.
 *   - "Neither models it"                   -> invisible here, and that is exactly where this app's
 *     more ambitious subsystems live. Only reading the text finds those.
 *
 * Foundry's PROSE is never used — only its rule elements. Specification comes from our own text.
 *
 *   npx jiti scripts/lane-gap-diff.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const FOUNDRY = join(root, '.import-src/pf2e/packs/pf2e');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : (e.name.endsWith('.json') && e.name !== '_folders.json' ? [join(d, e.name)] : []));

/* ── Our side ─────────────────────────────────────────────────────────────────────────────────── */
const core = JSON.parse(read('public/core.json'));
const desc = JSON.parse(read('public/core-descriptions.json'));
const hidden = new Set([...(core.duplicateIds ?? []), ...(core.umbrellaIds ?? [])]);
const textDefects = new Set(JSON.parse(read('scripts/audit/feat-text-defects.json')).featIds ?? []);

const liveById = new Map();
for (const coll of ['feats', 'classFeatures']) {
  for (const [id, r] of Object.entries(core[coll] ?? {})) {
    if (!r?.name || hidden.has(id) || id.startsWith('aon-') || r.edition === 'superseded') continue;
    if (coll === 'feats' && (textDefects.has(id) || !String(desc.feats?.[id]?.d ?? '').trim())) continue;
    liveById.set(norm(r.name), { id, coll, rec: r });
  }
}

/* Registries that can carry a feat's mechanics outside its own record. */
const REGISTRY_FILES = ['situationalBonuses', 'featGrantsAuto', 'featFeatGrants', 'featPickGrants',
  'featCantripGrants', 'companionGrants', 'featUses', 'modes', 'companions', 'classResources'];
const registrySrc = REGISTRY_FILES.map((f) => { try { return read(`src/rules/${f}.ts`); } catch { return ''; } }).join('\n');
const inRegistry = (id) => registrySrc.includes(`'${id}'`) || registrySrc.includes(`"${id}"`);

/**
 * ⚠ Search at ANY depth, not just top level plus passiveEffects.
 *
 * A first version checked only those two places and reported Natural Senses and Magical Resistance as
 * carrying nothing. Both carry `effectChoices`, and the mechanic lives inside each option's nested
 * `grant` — invisible to a shallow check, so the bare counts came out inflated. Deep search is the
 * conservative direction here: it can only ever move a record from "bare" to "covered", so what
 * survives is a floor rather than a guess.
 */
const nonEmpty = (v) =>
  v != null && (!Array.isArray(v) || v.length) && (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length);

const deepHas = (node, keys, depth = 0) => {
  if (node == null || depth > 6) return false;
  if (Array.isArray(node)) return node.some((x) => deepHas(x, keys, depth + 1));
  if (typeof node !== 'object') return false;
  for (const [k, v] of Object.entries(node)) {
    if (keys.has(k) && nonEmpty(v)) return true;
    if (deepHas(v, keys, depth + 1)) return true;
  }
  return false;
};

/** `passiveEffects.resistances` in the map means "a key named resistances, wherever it sits". */
const has = (rec, mapped) => deepHas(rec, new Set(mapped.map((k) => (k.includes('.') ? k.split('.').pop() : k))));

/**
 * Foundry rule-element type -> the fields in THIS app that would express it.
 * `null` means we have identified no route at all. `vtt` means it is map/token rendering with no
 * character-sheet meaning, so its absence is correct rather than a gap.
 */
const MAP = {
  Resistance: ['resistances', 'passiveEffects.resistances'],
  Weakness: ['passiveEffects.weaknesses'],
  Immunity: ['immunities', 'passiveEffects.immunities'],
  Sense: ['senses', 'vision', 'conditionalSenses', 'darkvisionIfAncestryLowLight'],
  BaseSpeed: ['speeds', 'landSpeedBonus', 'passiveEffects.speeds', 'passiveEffects.speedBonus'],
  CreatureSize: ['size'],
  MartialProficiency: ['proficiencies'],
  CriticalSpecialization: ['critSpec', 'critSpecWeapons', 'critSpecLevel'],
  Strike: ['grantedStrikes', 'strikeDamage', 'unarmedTraits'],
  DexterityModifierCap: ['dexCap'],
  GrantItem: ['grantsFeats', 'grantedFeatId', 'grantedFeatByChoice', 'grantsClassFeatures', 'grantsActions', 'grantsRituals', 'featureIds'],
  ChoiceSet: ['choice', 'effectChoices'],
  FlatModifier: ['passiveEffects', 'situational', 'focusPoolBonus', 'maxHpBonus', 'spellSlotBonus'],
  Note: ['note', 'situational'],
  RollOption: ['modes', 'situational'],
  SpecialResource: ['limitedUses', 'counters', 'focusPool'],
  CraftingAbility: ['advancedAlchemy'],
  DamageDice: ['weaponTraits', 'strikeDamage', 'grantedStrikes'],
  DamageAlteration: ['weaponTraits', 'strikeDamage'],
  AdjustStrike: ['weaponTraits', 'unarmedTraits'],
  ItemAlteration: ['weaponTraits'],
  AdjustModifier: ['situational', 'passiveEffects'],
  ActiveEffectLike: ['passiveEffects', 'situational', 'proficiencies', 'speeds', 'senses'],
  SubstituteRoll: ['skillSubstitutions'],
  Aura: null,
  AdjustDegreeOfSuccess: null,
  RollTwice: null,
  FastHealing: null,
  TempHP: null,
  MultipleAttackPenalty: null,
  ActorTraits: null,
  SpecialStatistic: null,
  EphemeralEffect: null,
  TokenLight: 'vtt',
  TokenEffectIcon: 'vtt',
};

/* ── Foundry side ─────────────────────────────────────────────────────────────────────────────── */
const byType = {};
for (const f of [...walk(join(FOUNDRY, 'feats')), ...walk(join(FOUNDRY, 'class-features'))]) {
  let j;
  try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const mine = liveById.get(norm(j.name));
  if (!mine) continue; // not one of OUR live records — out of scope
  for (const r of j.system?.rules ?? []) {
    if (!r?.key) continue;
    ((byType[r.key] ??= new Map())).set(mine.id, mine);
  }
}

/* ── The diff ─────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⚠ Foundry-internal PLUMBING, not Pathfinder concepts. Their counts must NOT be quoted as missing
 * mechanics — inspection of real examples shows most carry no character-sheet meaning at all:
 *   ItemAlteration    — mostly adds match-tags to spells, or appends description text. But a minority
 *                       IS real: Consistent Surge downgrades another feat's frequency to 10 minutes,
 *                       which is our `modifiesGrant` lane.
 *   ActiveEffectLike  — writes Foundry flags (Internal Respirator sets flags.system.remainingAir).
 *   RollOption        — roll-time toggles. Many are our `modes` lane (Web Hunter gates tremorsense
 *                       15ft -> 60ft), many are VTT-only.
 * Each needs per-record triage before any of it counts as a gap.
 */
const PLUMBING = new Set(['ItemAlteration', 'ActiveEffectLike', 'RollOption']);

const rows = [];
for (const [type, recs] of Object.entries(byType)) {
  const target = MAP[type];
  if (PLUMBING.has(type)) {
    const ours = [...recs.values()];
    const covered = ours.filter(({ rec, id }) => (target && has(rec, target)) || inRegistry(id));
    rows.push({ type, foundryUses: ours.length, status: 'plumbing — needs triage', covered: covered.length,
      bare: ours.length - covered.length, note: 'Foundry-internal; a minority maps to a real lane. Do not quote as a gap.' });
    continue;
  }
  const ours = [...recs.values()];
  if (target === 'vtt') {
    rows.push({ type, foundryUses: ours.length, status: 'not-applicable', note: 'VTT map/token rendering — no character-sheet meaning' });
    continue;
  }
  if (target === null) {
    rows.push({ type, foundryUses: ours.length, status: 'NO LANE', covered: 0,
      examples: ours.slice(0, 6).map((x) => x.rec.name) });
    continue;
  }
  const covered = ours.filter(({ rec, id }) => has(rec, target) || inRegistry(id));
  const bare = ours.filter((x) => !covered.includes(x));
  rows.push({ type, foundryUses: ours.length, status: 'has lane', lane: target.join(' | '),
    covered: covered.length, bare: bare.length,
    examples: bare.slice(0, 6).map((x) => x.rec.name) });
}

rows.sort((a, b) => {
  const rank = (s) => (s.status === 'NO LANE' ? 0 : s.status === 'has lane' ? 1 : 2);
  return rank(a) - rank(b) || (b.bare ?? b.foundryUses) - (a.bare ?? a.foundryUses);
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`our live feats + class features: ${liveById.size}`);
console.log(`Foundry rule-element types touching them: ${Object.keys(byType).length}\n`);
console.log('SYSTEMS WITH NO ROUTE IN THIS APP');
for (const r of rows.filter((x) => x.status === 'NO LANE')) {
  console.log(`  ${pad(r.type, 24)} ${String(r.foundryUses).padStart(4)} of our records need it   e.g. ${r.examples.slice(0, 4).join(', ')}`);
}
console.log('\nLANE EXISTS — records Foundry gives the mechanic but ours carries nothing');
for (const r of rows.filter((x) => x.status === 'has lane' && x.bare > 0)) {
  console.log(`  ${pad(r.type, 24)} ${String(r.bare).padStart(4)} bare of ${String(r.foundryUses).padStart(4)}   e.g. ${r.examples.slice(0, 3).join(', ')}`);
}
console.log('\nFOUNDRY PLUMBING — counts are NOT gaps, each needs per-record triage');
for (const r of rows.filter((x) => x.status === 'plumbing — needs triage')) {
  console.log(`  ${pad(r.type, 24)} ${String(r.bare).padStart(4)} unmatched of ${String(r.foundryUses).padStart(4)}`);
}
console.log('\nNOT APPLICABLE');
for (const r of rows.filter((x) => x.status === 'not-applicable')) console.log(`  ${pad(r.type, 24)} ${r.note}`);

mkdirSync(join(root, 'scripts/audit'), { recursive: true });
writeFileSync(join(root, 'scripts/audit/lane-gaps.json'), JSON.stringify({
  measured: '2026-08-08',
  direction: 'ONE-WAY. Foundry silence carries no information; 3,537 of our feats exist there with zero rule elements.',
  ourRecords: liveById.size,
  rows,
}, null, 1));
console.log('\nwrote scripts/audit/lane-gaps.json');
