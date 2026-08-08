/*
 * GOLD SET candidate selection — the ~40 feats whose answers become the measuring stick.
 *
 * Not random. A gold set exists to measure whether a reader is DILIGENT, so it must over-represent the
 * shapes that actually break, and it must include feats that are legitimately inert so over-flagging
 * is punished as hard as under-flagging.
 *
 * Six strata:
 *   explicit-single   one clause, an unambiguous number. Baseline competence.
 *   multi-clause      3+ mechanical clauses. THE dominant failure mode — Kin Hunter delivered its
 *                     Recall Knowledge bonus but not its damage bonus; Ironblood Stance delivered
 *                     neither its Strike nor its resistance yet passed because a stance action showed.
 *   two-source-clash  Foundry attaches a mechanic, our record carries nothing. Where human judgement
 *                     is worth spending.
 *   missing-system    needs one of the nine systems with no route (degree-of-success, aura, ...).
 *   inert             flavour, GM adjudication, enemy-facing. Catches over-flagging.
 *   choice            offers the player a pick.
 *
 * ⚠ Deliberately EXCLUDES rules-ambiguous feats. The gold set must not conflate "was the reader
 * careful" with "can the reader resolve an ambiguity Paizo never clarified" — those are different
 * skills and mixing them makes the measurement meaningless. Ambiguous feats go to a hard-cases pile.
 *
 *   npx jiti scripts/gold-set-candidates.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const FOUNDRY = join(root, '.import-src/pf2e/packs/pf2e');
const SEED = 20260808;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : (e.name.endsWith('.json') && e.name !== '_folders.json' ? [join(d, e.name)] : []));

const core = JSON.parse(read('public/core.json'));
const desc = JSON.parse(read('public/core-descriptions.json'));
const hidden = new Set([...(core.duplicateIds ?? []), ...(core.umbrellaIds ?? [])]);
const textDefects = new Set(JSON.parse(read('scripts/audit/feat-text-defects.json')).featIds ?? []);
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/* Foundry rule elements keyed by normalised name — mechanics only, never their prose. */
const fRules = new Map();
for (const f of [...walk(join(FOUNDRY, 'feats')), ...walk(join(FOUNDRY, 'class-features'))]) {
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    fRules.set(norm(j.name), (j.system?.rules ?? []).map((r) => r.key));
  } catch { /* a malformed pack file is not evidence about our data */ }
}

const NO_LANE_TYPES = new Set(['AdjustDegreeOfSuccess', 'Aura', 'ActorTraits', 'EphemeralEffect',
  'SpecialStatistic', 'RollTwice', 'FastHealing', 'MultipleAttackPenalty', 'TempHP']);
const PLUMBING = new Set(['ItemAlteration', 'ActiveEffectLike', 'RollOption']);

const MECHANICAL_FIELDS = ['passiveEffects', 'situational', 'modes', 'limitedUses', 'grantsFeats',
  'grantedFeatId', 'grantsClassFeatures', 'grantsActions', 'grantsRituals', 'effectChoices', 'choice',
  'proficiencies', 'trainedSkill', 'trainedLore', 'resistances', 'immunities', 'senses', 'speeds',
  'innateSpells', 'focusSpells', 'grantedStrikes', 'skillSubstitutions', 'critSpec', 'weaponTraits',
  'spellcastingGrant', 'abilityBoosts', 'maxHpBonus', 'landSpeedBonus', 'size', 'languages'];

/* Clause counting: sentences carrying a mechanical verb. Crude on purpose — it only has to STRATIFY. */
const MECH_VERB = /\b(gain|gains|become|becomes|increase|increases|reduce|reduces|add|adds|you can|you're|you are|instead|resistance|immunity|weakness|bonus|penalty|trained|expert|master|legendary|speed|darkvision|cast|choose|select)\b/i;
const clauseCount = (t) => t.split(/(?<=[.!?])\s+/).filter((s) => MECH_VERB.test(s)).length;

/* Rules-ambiguity markers — these belong in the hard-cases pile, not the measuring stick. */
const AMBIGUOUS = /\bGM\b|at the GM's|as appropriate|reasonable|you might|could be|circumstances|the GM determines|if the GM/i;

const rows = [];
for (const [id, rec] of Object.entries(core.feats ?? {})) {
  if (!rec?.name || hidden.has(id) || id.startsWith('aon-') || rec.edition === 'superseded' || textDefects.has(id)) continue;
  const text = clean(desc.feats?.[id]?.d);
  if (text.length < 40) continue;
  const rules = fRules.get(norm(rec.name)) ?? [];
  const ourFields = MECHANICAL_FIELDS.filter((k) => {
    const v = rec[k];
    return v != null && (!Array.isArray(v) || v.length) && (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length);
  });
  rows.push({
    id, name: rec.name, level: rec.level ?? null, text,
    clauses: clauseCount(text),
    ourFields,
    foundryRules: rules,
    ambiguous: AMBIGUOUS.test(text),
    needsMissingSystem: rules.some((k) => NO_LANE_TYPES.has(k)),
    realFoundryMechanic: rules.some((k) => !PLUMBING.has(k)),
  });
}

let s = SEED >>> 0;
const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const pick = (pool, n, used) => {
  const out = [];
  const avail = pool.filter((r) => !used.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
  while (out.length < n && avail.length) {
    const [r] = avail.splice(Math.floor(rand() * avail.length), 1);
    used.add(r.id); out.push(r);
  }
  return out;
};

const usable = rows.filter((r) => !r.ambiguous);
const used = new Set();
const strata = {
  'missing-system': pick(usable.filter((r) => r.needsMissingSystem), 6, used),
  'two-source-clash': pick(usable.filter((r) => r.realFoundryMechanic && !r.ourFields.length), 8, used),
  'multi-clause': pick(usable.filter((r) => r.clauses >= 3 && r.ourFields.length), 10, used),
  'explicit-single': pick(usable.filter((r) => r.clauses === 1 && r.text.length < 220 && r.ourFields.length), 8, used),
  choice: pick(usable.filter((r) => r.ourFields.includes('choice') || r.ourFields.includes('effectChoices')), 5, used),
  inert: pick(usable.filter((r) => !r.foundryRules.length && !r.ourFields.length && r.clauses <= 1), 6, used),
};

const total = Object.values(strata).flat().length;
for (const [k, v] of Object.entries(strata)) console.log(`  ${k.padEnd(18)} ${String(v.length).padStart(2)}`);
console.log(`  ${'TOTAL'.padEnd(18)} ${total}`);
console.log(`(pool: ${rows.length} live feats, ${usable.length} after excluding ${rows.length - usable.length} rules-ambiguous)`);

/* Exemplars vs held-out test. Using the same feats for both would contaminate the measurement — a
 * reader shown the answer cannot be tested on it. Exemplars are the smaller, most explicit half. */
const flat = Object.entries(strata).flatMap(([stratum, v]) => v.map((r) => ({ stratum, ...r })));
const exemplars = flat.filter((r) => r.stratum === 'explicit-single').slice(0, 4)
  .concat(flat.filter((r) => r.stratum === 'multi-clause').slice(0, 2))
  .concat(flat.filter((r) => r.stratum === 'inert').slice(0, 2));
const exIds = new Set(exemplars.map((r) => r.id));

mkdirSync(join(root, 'scripts/audit'), { recursive: true });
writeFileSync(join(root, 'scripts/audit/gold-candidates.json'), JSON.stringify({
  seed: SEED, drawn: '2026-08-08',
  purpose: 'Candidates for the hand-adjudicated gold set. Answers are NOT filled in yet.',
  split: { exemplars: [...exIds], test: flat.filter((r) => !exIds.has(r.id)).map((r) => r.id) },
  candidates: flat.map((r) => ({ ...r, role: exIds.has(r.id) ? 'exemplar' : 'test' })),
}, null, 1));
console.log(`\nexemplars ${exemplars.length} / test ${total - exemplars.length}`);
console.log('wrote scripts/audit/gold-candidates.json');
