/*
 * VALUE COMPARISON — the bucket the kind-differ cannot answer.
 *
 * `wg-diff.mjs` asks "does the other side model this KIND of thing at all". That leaves a second and
 * equally binding question, and it is the one the owner's rule is mostly about:
 *
 *   "if there is a place where we do something and they do it differently we need to delete the way we
 *    did it and do it the way they did."
 *
 * A record can be in the differ's AGREE bucket and still hand out +2 where they hand out +1, or train
 * Diplomacy where they train Society. 469 records across the corpus have a numeric kind on BOTH sides,
 * and until now every one of them was flagged and none was compared.
 *
 * WHAT THIS DOES: for each requested record, extract every (variable -> value) pair their operations
 * assert, extract the equivalent assertions from ours, and print only the pairs that DISAGREE. Reading
 * 77 records' worth of prose is a day; reading 77 rows of "theirs says T, ours says nothing" is not.
 *
 * ⚠ THIS IS A SCREEN, NOT A VERDICT. It compares what each side ASSERTS, and the two vocabularies do
 * not line up perfectly — a formula (`min(@actor.speed.swim,1)*…`) cannot be compared to a literal, and
 * a value we express in a registry rather than a field looks absent. Every row it prints still has to be
 * read against the printed text before anything is changed. It exists to make the reading finite.
 *
 *   node scripts/wg-values.mjs --batch work/wg-batch-003.json
 *   node scripts/wg-values.mjs --ids sea-legs,round-ears --verbose
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, parseOps, flattenOps, wgRecord, wgRowsByBucket, wgOwnsComparison } from './lib/wg-parse.mjs';

/* `--raw` bypasses the settle registries so `wg-settle-stale.mjs` can see which of them still
 * answer a real difference. A settle that matches nothing is a trap: it will silence the NEXT
 * difference of that kind on that record, unread. */
const RAW_SETTLES = process.argv.includes('--raw');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('--verbose');

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) {
  console.error('No dump at work/wg/wg-data.sql — it is gitignored on purpose (GPL-3.0; differ only).');
  process.exit(2);
}
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const sql = readFileSync(DUMP, 'utf8');
const rows = parseCopyBlock(sql, 'ability_block').rows;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const RANK = { U: 'untrained', T: 'trained', E: 'expert', M: 'master', L: 'legendary' };

/** The sixteen skills, so a field name in a grant entry is never mistaken for a skill key. */
const SKILL_KEYS = new Set(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth',
  'survival', 'thievery']);

/**
 * Their variable -> the assertion in OUR terms. Only variables with an unambiguous counterpart are
 * listed: a variable we cannot express has nothing to disagree with, and printing it as a disagreement
 * would recreate the false-positive problem the kind-differ just spent a day shedding.
 */
const VAR = {
  SKILL_ACROBATICS: ['skill', 'acrobatics'], SKILL_ARCANA: ['skill', 'arcana'],
  SKILL_ATHLETICS: ['skill', 'athletics'], SKILL_CRAFTING: ['skill', 'crafting'],
  SKILL_DECEPTION: ['skill', 'deception'], SKILL_DIPLOMACY: ['skill', 'diplomacy'],
  SKILL_INTIMIDATION: ['skill', 'intimidation'], SKILL_MEDICINE: ['skill', 'medicine'],
  SKILL_NATURE: ['skill', 'nature'], SKILL_OCCULTISM: ['skill', 'occultism'],
  SKILL_PERFORMANCE: ['skill', 'performance'], SKILL_RELIGION: ['skill', 'religion'],
  SKILL_SOCIETY: ['skill', 'society'], SKILL_STEALTH: ['skill', 'stealth'],
  SKILL_SURVIVAL: ['skill', 'survival'], SKILL_THIEVERY: ['skill', 'thievery'],
  SAVE_FORT: ['save', 'fortitude'], SAVE_REFLEX: ['save', 'reflex'], SAVE_WILL: ['save', 'will'],
  PERCEPTION: ['perception', null],
  SPEED: ['speed', 'land'], SPEED_SWIM: ['speed', 'swim'], SPEED_CLIMB: ['speed', 'climb'],
  SPEED_FLY: ['speed', 'fly'], SPEED_BURROW: ['speed', 'burrow'],
  AC_TOTAL: ['ac', null], MAX_HEALTH: ['hp', null], MAX_HEALTH_BONUS: ['hp', null],
  BULK_LIMIT_BONUS: ['bulk', null],
  /* AC_BONUS is a scalar we hold in three places: `acBonus` on armour, `passiveEffects.ac` for an
   * item's standing bonus, and `unarmoredAc.acBonus` for natural armour. Their side has no conditional
   * verb — it writes a plain AC_BONUS and parks the trigger in the op's own text — so the number is
   * still the number. Untaught, every one of their 1,613 AC_BONUS ops read as 'nobody has taught this'. */
  AC_BONUS: ['ac', null],
  /* The attack twin of AC_BONUS, and the same reason: their side has no conditional verb, so it
   * writes a plain ATTACK_ROLLS_BONUS and parks the trigger in the op's own `text`. Numeric on eight
   * of its ten carriers (Acid Flask/Dread Ampoule majors, Weapon Potency, Hunter's Arrowhead, Fated
   * Rival, Courageous Anthem, ABP) — ours already holds those numbers, put as `attack|` below.
   * Warrior's Training Ring is the prose case: its single op carries `text` and no `value`, so
   * theirAssertions drops it and the record lands in the non-failing 'prose-only bonus' bucket; its
   * printed clauses are on FEAT_SITUATIONAL['warriors-training-ring'], and the "add your level"
   * clause is a proficiency FLOOR (untrainedWeaponProficiency), not a value on a track. */
  ATTACK_ROLLS_BONUS: ['attack', null],
};

/**
 * Their variables that this script deliberately does NOT compare, each with the reason.
 *
 * "no VAR mapping" reads like an oversight — a variable nobody has got round to teaching. For these it
 * is a decision: the OUR side of this comparer is built from numeric assertions (situational bonuses
 * and scalar record fields), and none of these is a number we hold in that currency. Teaching them a
 * mapping would not compare anything; it would manufacture a mismatch on every record that carries
 * one.
 *
 * Each was read by hand during batch 007 and its record verified through the lane that DOES carry it,
 * which is what the third column names. An entry here is a claim that another instrument covers it.
 */
const NOT_A_SCALAR = {
  PRIMARY_SHEET_TABS: 'a companion/eidolon tab, not a value — covered by wg-identity via companionGrants.ts',
  LIGHT_ARMOR: 'armour proficiency, a rank on `proficiencies.defenses` — covered by featGrants.armor',
  MEDIUM_ARMOR: 'armour proficiency, a rank on `proficiencies.defenses` — covered by featGrants.armor',
  HEAVY_ARMOR: 'armour proficiency, a rank on `proficiencies.defenses` — covered by featGrants.armor',
  SPELL_ATTACK: 'spellcasting proficiency, which our side derives from the granted spellcasting entry',
  SPELL_DC: 'spellcasting proficiency, which our side derives from the granted spellcasting entry',
  ATTACK_DAMAGE_BONUS: 'a damage rider on a Strike — carried by `situational` with a strikeDamage target',
  /*
   * Found by RE-CHECKING batches 2-7 once the label above was split. Eight records had a value nothing
   * had ever compared, and the old lumped wording made that indistinguishable from an adjudicated skip.
   * All eight were then read by hand; each is covered by the lane named here, and two were NOT covered
   * and were built (see recoveryDcReduction and conditionalSenses.increaseRangeBy).
   */
  FOCUS_POINT_BONUS: 'the focus POOL size — derived in build.ts from the point-costing focus spells known (Player Core p.298), not a per-record number',
  WEAPON_GROUP_BOW: 'weapon proficiency by group — covered by featGrantsAuto.weaponFamiliarity (monastic-archer-stance lists the bows and mirrors the best category)',
  MARTIAL_WEAPONS: 'weapon proficiency by category — covered by featGrants.weapon',
  /* Its siblings, from batch 14 (weapon-expertise, inventor-weapon-expertise, gunslinger-weapon-mastery).
   * Same lane, same reason: a rank by weapon CATEGORY or GROUP is `featGrants.weapon`, not a number on
   * the record — and the rank itself is compared through the proficiency lane, not here. */
  SIMPLE_WEAPONS: 'weapon proficiency by category — covered by featGrants.weapon',
  UNARMED_ATTACKS: 'weapon proficiency by category — covered by featGrants.weapon',
  /* Batch 15, Martial Experience. Same lane as its three siblings above — *"at 11th level, you become
   * trained in all weapons"* raises every weapon CATEGORY, which is a rank and not a number. */
  ADVANCED_WEAPONS: 'weapon proficiency by category — covered by featGrants.weapon / untrainedWeaponProficiency.trainedAtLevel',
  /* …and their marker for the same feat's FIRST clause, *"treat your level as your proficiency bonus"*.
   * Not a value on a track at all: it is a FLOOR under the proficiency contribution of a weapon you are
   * untrained with, which is `untrainedWeaponProficiency` — the weapon-side twin of the skill lane that
   * already existed. Both clauses reached nothing before batch 15; see test/batch15-parity.test.ts. */
  MARTIAL_EXPERIENCE: 'their marker for "treat your level as your proficiency bonus" — covered by `untrainedWeaponProficiency`, which is a floor rather than a rank',
  /* Batch 15, Gate's Threshold. Their side adds +1 to a running blast-dice tally on each of the four
   * takings; ours reads the same answer off the LEVEL — `1 + [5,9,13,17].filter(l => level >= l).length`
   * in deriveBlast, which is exactly the levels Gate's Threshold lands on. Same number, and it cannot
   * drift out of step with the feature the way a per-taking tally can. */
  KINETICIST_BLAST_DICE: "the Elemental Blast damage dice — derived from level in deriveBlast (5/9/13/17, the Gate's Threshold levels), not a per-record tally",
  /* Batch 1. A class DC rank is a step on the per-class ADVANCEMENT table, not a number on the record:
   * Monk Expertise's *"your proficiency rank for your monk class DC increases to expert"* is
   * `{ level: 9, track: 'classDc', rank: 'expert', source: 'monk-expertise' }` in advancement.ts. Same
   * carrier, and the same reason, as the save and armour ranks already listed above. */
  CLASS_DC: 'a class DC RANK — a step on the per-class table in src/rules/advancement.ts, not a value on the record',
  /* Their marker for Untrained Improvisation's *"treat your level as your proficiency bonus"* — the
   * SKILL side of the lane whose weapon twin batch 15 built. Covered by `untrainedProficiency`, which
   * is a floor under the proficiency contribution rather than a rank. */
  UNTRAINED_IMPROVISATION: 'their marker for "your level as your proficiency bonus" on untrained SKILLS — covered by `untrainedProficiency` (a floor, not a rank)',
  WEAPON_GROUP_CROSSBOW: 'weapon proficiency by GROUP — covered by featGrants.weapon / weaponFamiliarity',
  WEAPON_GROUP_FIREARM: 'weapon proficiency by GROUP — covered by featGrants.weapon / weaponFamiliarity',
  SIZE: 'a SIZE, not a value on a track — covered by `sizeOverride` (Mighty Dragonet: "instead of Tiny, your size is Small")',
  IMPROVED_MULTILINGUAL: 'extra languages, and extra languages FROM ANOTHER FEAT — covered by `languageChoices` + `languageChoicesBonus`',
  SENSES_IMPRECISE: 'a sense, not a value — covered by `senses` / `conditionalSenses`',
  MAX_HEALTH_CLASS_PER_LEVEL: 'HP per level — covered by `maxHpBonus.perLevel` (Toughness: "increase your maximum Hit Points by your level")',
  UNBURDENED_IRON: 'their record-named var for the Speed-penalty clauses — covered by `speedAdjust.ignoreArmorPenalty` + `reduceOtherPenalty`',
  STONE_BRAWLER_FEAT_COUNT: 'their running tally of archetype feats held — engine plumbing, computed at read time on our side',
  STONEBOUND_FEAT_COUNT: 'their running tally of archetype feats held — engine plumbing, computed at read time on our side',
  MONOLITH_FEAT_COUNT: 'their running tally of archetype feats held — engine plumbing, computed at read time on our side',
  CHAMPION_MERCIES: 'their count of mercies taken — a repeatable-feat tally, not a stat any record asserts',
  WEAPON_FAMILIARITY: 'a SET of weapons, not a scalar — compared by the `set|weapons` / `set|critspec` lane off `weaponFamiliarity` and `critSpecWeapons`',
  BLACKLIST_ABILITY_BLOCKS: 'their exclusion list for options a record forbids — a picker filter, not a value',
  /* Batch 17 values-vars. A BOOLEAN access flag, not a number on a track: "you gain the armor
   * specialization effects for all armors you are proficient with". Their three ops set one flag per
   * armour category behind a `>= T` proficiency gate; ours is `armorSpec.anyProficient` on the record,
   * read by `armorSpecAccess` (src/rules/derive.ts), whose `trained()` helper is the same
   * `!== 'untrained'` gate. The VALUE of the effect is keyed by armour group in src/rules/armorSpec.ts
   * and is not on the record at all, so there is no scalar here for this comparer to hold. */
  ARMOR_SPECIALIZATION_LIGHT: 'an armour-specialization ACCESS flag, not a value — covered by `armorSpec` (`anyProficient` / `ifTrained` / `categories`), read by armorSpecAccess in derive.ts',
  ARMOR_SPECIALIZATION_MEDIUM: 'an armour-specialization ACCESS flag, not a value — covered by `armorSpec` (`anyProficient` / `ifTrained` / `categories`), read by armorSpecAccess in derive.ts',
  ARMOR_SPECIALIZATION_HEAVY: 'an armour-specialization ACCESS flag, not a value — covered by `armorSpec` (`anyProficient` / `ifTrained` / `categories`), read by armorSpecAccess in derive.ts',
  /* Batch 17 values-vars. Their per-taking TALLY for a repeatable feat — the same shape as
   * CHAMPION_MERCIES and the *_FEAT_COUNT vars above, and the only machine-readable thing in their
   * encoding: the printed 5/6/7 servings appear on their side solely inside `injectText` prose. Ours
   * indexes the same taking count and writes the real number: `resourceMaxSet.values` →
   * build.ts resourceFloors → classResources.resourceMaxFor → AlchemyPanel/VitalsRail. */
  ADDITIONAL_SERVINGS_AMOUNT: 'their tally of how many times this repeatable feat was taken — covered by `resourceMaxSet` + `maxTakable`, which resolves the taking count to the printed daily maximum (build.ts resourceFloors → classResources.resourceMaxFor)',
  /* Batch 19 values-vars — the ANCESTRY CHASSIS. These live on the record as chassis fields the
   * engine reads directly and are asserted on BUILT characters (test/batch19-parity.test.ts + the
   * build tests) — not scalars this comparer holds per-op. */
  MAX_HEALTH_ANCESTRY: 'ancestry starting HP — the chassis field `ancestries.<id>.hp` (and `hpBySize` where the printed size choice varies it, awakened animal), read by build hpMax + deriveMaxHp',
  ATTRIBUTE_STR: 'an ancestry/background BOOST or FLAW — covered by `abilityBoosts`/`abilityFlaws` chassis (heritage swaps via `replaceAncestryBoost`/`replaceAncestryFlaw`)',
  ATTRIBUTE_DEX: 'an ancestry/background BOOST or FLAW — covered by `abilityBoosts`/`abilityFlaws` chassis (heritage swaps via `replaceAncestryBoost`/`replaceAncestryFlaw`)',
  ATTRIBUTE_CON: 'an ancestry/background BOOST or FLAW — covered by `abilityBoosts`/`abilityFlaws` chassis (heritage swaps via `replaceAncestryBoost`/`replaceAncestryFlaw`)',
  ATTRIBUTE_INT: 'an ancestry/background BOOST or FLAW — covered by `abilityBoosts`/`abilityFlaws` chassis (heritage swaps via `replaceAncestryBoost`/`replaceAncestryFlaw`)',
  ATTRIBUTE_WIS: 'an ancestry/background BOOST or FLAW — covered by `abilityBoosts`/`abilityFlaws` chassis (heritage swaps via `replaceAncestryBoost`/`replaceAncestryFlaw`)',
  ATTRIBUTE_CHA: 'an ancestry/background BOOST or FLAW — covered by `abilityBoosts`/`abilityFlaws` chassis (heritage swaps via `replaceAncestryBoost`/`replaceAncestryFlaw`)',
  CORE_LANGUAGES: 'the ancestry’s granted + choosable languages — covered by `languages.granted` and the batch-19 `languages.options` lane (LanguageEditor lists the printed pool first)',
};

/**
 * Their variable resolved to ours, including the patterned ones a flat table cannot hold.
 *
 * `SKILL_LORE_ALGHOLLTHU` is one of an open set — every Lore subject gets its own variable — and our
 * key for the same thing is `lore:alghollthu` in the ordinary `skills` map. Without this, Ancestral
 * Insight and Contract Negotiator were listed as "not value-checked" purely because their Lore had not
 * been enumerated by hand.
 *
 * ⚠ Their subject is SCREAMING_SNAKE and ours is kebab, and a multi-word subject exists on both sides
 * ("Plane of Earth"), so the transform has to be underscore→hyphen and not a bare lowercase.
 */
/*
 * A VARIABLE WHOSE MEANING DEPENDS ON THE VERB.
 *
 * `WEAPON_GROUP_BOMB` as `adjValue` sets a proficiency RANK (the alchemist's bomb proficiency) — not a
 * number this comparer holds. As `addBonusToValue` it asserts an ITEM BONUS TO ATTACK ("you gain a +1
 * item bonus to attack rolls" on a moderate alchemical bomb), which IS a scalar and is ours. A flat
 * entry would have compared the alchemist's 'expert' against a number and reported a gap on a class
 * whose bomb proficiency is fully built.
 */
const VAR_BY_VERB = { addBonusToValue: { WEAPON_GROUP_BOMB: ['attack', null] } };

function varSpec(v, verb) {
  if (verb && VAR_BY_VERB[verb]?.[v]) return VAR_BY_VERB[verb][v];
  if (VAR[v]) return VAR[v];
  const lore = /^SKILL_LORE_(.+)$/.exec(v);
  if (lore) return ['skill', `lore:${lore[1].toLowerCase().replace(/_/g, '-')}`];
  return null;
}

/** Their value literal reduced to a comparable scalar: `{"value":"T"}` -> 'trained', `5` -> 5. */
function theirValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') return theirValue(v.value);
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (RANK[s]) return RANK[s];
  if (/^[+-]?\d+$/.test(s)) return Number(s);
  return s;                                   // a formula or prose — printed, never silently compared
}

/**
 * SET-VALUED variables. Their side asserts these one operation per member, so a weapon-familiarity
 * list arrives as five separate `WEAPON_FAMILIARITY` ops. Compared as a SET, because the order is
 * meaningless on both sides.
 *
 * Worth having as a guard rather than a hand-check: a wrong weapon list is a real defect and this
 * repo has shipped one — `critSpecWeapons.bases` was updated on a familiarity remap and
 * `weaponFamiliarity.weapons` was not, which a set comparison would have caught immediately.
 */
const SET_VAR = {
  WEAPON_FAMILIARITY: 'weapons',
  WEAPON_CRITICAL_SPECIALIZATIONS: 'critspec',
  RESISTANCES: 'resistances',
  /* Their `WEAKNESSES` was mapped by nothing, so the gate reported it as a variable no comparer had
   * ever looked at. We do hold it — `weaknesses: IwrEntry[]`, on 39 records — and it reads exactly like
   * `RESISTANCES`: a "<type>, <amount>" literal whose type is the set member. Mummy Dedication's
   * *"fire weakness equal to half your level"* is the case that surfaced it. */
  WEAKNESSES: 'weaknesses',
};

/*
 * Their trait ids resolved to names. A familiarity list mixes the two — Elven Weapon Familiarity is
 * `WEAPON_FAMILIARITY = "1348"` (the elf TRAIT) alongside `"longbow"` (a base weapon) — and ours spells
 * the trait half as `traits: ['elf']`. Without the lookup the trait member is an opaque number and
 * every trait-carrying familiarity feat reads as a disagreement.
 */
const traitNameById = new Map(
  parseCopyBlock(sql, 'trait').rows.map((r) => [String(r.id), String(r.name ?? '').toLowerCase()]),
);

/** Their member literal reduced to ours: "battle axe" -> "battle-axe", "poison, {{level/2}}" -> "poison". */
const setMember = (raw, key) => {
  // NFD + strip combining marks: their ash-gown row spells its resistance type "fi̇re" — a stray
  // U+0307 COMBINING DOT ABOVE wedged into "fire" (codepoints 66 69 307 72 65). Data corruption on
  // their side, not a different type; without this the set comparison reads it as a fifth element.
  const s = String(raw ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  // the TYPE; the amount is a scalar row. Weaknesses share the shape exactly.
  if (key === 'resistances' || key === 'weaknesses') return s.split(',')[0].trim();
  /* A bare id is a TRAIT. If their own trait table does not carry it — Conrasu's 2964 — the member
   * reduces to an opaque number that can match nothing, and reporting it says only that their export
   * is incomplete. Dropped, exactly as a prose-only assertion is. */
  if (/^\d+$/.test(s)) { const n = traitNameById.get(s); return n ? `trait-name:${n}` : ''; }
  return s.replace(/\s+/g, '-');
};

/** Everything their row asserts, as `track|detail -> value`, plus `set|<key> -> Set`. */
function theirAssertions(row) {
  const out = new Map();
  const sets = new Map();
  for (const op of parseOps(row.operations).flatMap((o) => flattenOps(o))) {
    const varName = String(op.data?.variable ?? '');
    const setKey = SET_VAR[varName];
    if (setKey) {
      const v = typeof op.data?.value === 'object' ? op.data?.value?.value : op.data?.value;
      const m = setMember(v, setKey);
      if (m) {
        if (!sets.has(setKey)) sets.set(setKey, new Set());
        sets.get(setKey).add(m);
      }
      /* A resistance also asserts an AMOUNT; let the scalar path see it too. */
      if (setKey !== 'resistances' && setKey !== 'weaknesses') continue;
    }
    if (!['adjValue', 'setValue', 'addBonusToValue'].includes(op?.type)) continue;
    const spec = varSpec(varName, op.type);
    if (!spec) continue;
    const val = theirValue(op.data?.value);
    if (val === null || val === undefined || val === '') continue;   // a prose-only bonus asserts no value
    /* A PENALTY is the same rule as its magnitude: theirs writes -2, ours writes the string
     * '-2 circumstance' whose number the reader takes as an absolute. Comparing signed to unsigned
     * reported every penalty in the corpus as a disagreement. */
    const scalar = typeof val === 'number' ? Math.abs(val) : val;
    out.set(`${spec[0]}|${spec[1] ?? ''}`, scalar);
  }
  out.__sets = sets;
  return out;
}

/**
 * The same sets on OUR side.
 *
 * ⚠ MUST read the GRANT TABLES as well as the record. All three of batch 3's weapon-familiarity feats
 * keep their list in `featGrantsAuto.ts` / `featGrantsLane.ts` and carry nothing on the core.json
 * record, so a record-only reader reported "they name four weapons, we name none" on three feats whose
 * lists are complete — and in two cases longer than theirs, because ours enumerates the trait's weapons
 * (azarketi: boarding-axe, gill-hook) instead of naming the trait.
 */
function ourSets(rec, id) {
  const sets = new Map();
  const add = (key, m) => {
    if (!m) return;
    if (!sets.has(key)) sets.set(key, new Set());
    sets.get(key).add(String(m).toLowerCase());
  };
  const wf = rec.weaponFamiliarity ?? {};
  const cs = rec.critSpecWeapons ?? {};
  /* `weaponFamiliarity` and `critSpecWeapons` are two halves of the same printed sentence — "you treat
   * these as simple weapons" and "you gain the critical specialization" — and a record may carry either
   * or both. Their `WEAPON_FAMILIARITY` covers the first, so both of ours feed it. */
  for (const w of [...(wf.weapons ?? []), ...(cs.bases ?? [])]) add('weapons', w);
  for (const t of [...(wf.traits ?? []), ...(cs.traits ?? [])]) add('weapons', `trait-name:${t}`);
  for (const w of [...(cs.bases ?? []), ...(cs.names ?? [])]) add('critspec', w);
  /* …and a TRAIT-only crit-spec grant. `cs.traits` fed the `weapons` set above and nothing else, so a
   * record whose critical specialization is expressed as a trait ("you gain the critical specialization
   * effect of any weapon with the two-hand trait") contributed no critspec member at all and read as
   * granting nothing — the comparer's gap, not the data's. Same `trait-name:` shape as the weapons set,
   * so the two sides are compared as the same kind of thing. */
  for (const t of cs.traits ?? []) add('critspec', `trait-name:${t}`);
  /* …and a GROUP-only one, the same blind spot a step wider. Archer Dedication's *"you gain access to
   * the critical specialization effect"* is authored as `critSpecWeapons.groups: ['bow','crossbow']`,
   * and `groups` fed neither set — so the record read as granting no crit spec at all while their side
   * names exactly those two groups. Groups are compared bare because that is how their members read. */
  for (const g of cs.groups ?? []) add('critspec', g);
  for (const r of rec.resistances ?? []) add('resistances', r.type);
  for (const r of rec.passiveEffects?.resistances ?? []) add('resistances', r.type);
  /* A CHOICE-resistance record resists whichever type the player picks, so the comparable set is the
   * option list itself. Two homes: a Heritage carries its own options; a Background (Energy Scarred,
   * batch 23) reuses its `choice` options and declares only the formula. Their legacy energy names
   * map to the remaster ones we store — pre-rename spellings of the same two types. */
  const legacyEnergy = { vitality: 'positive', void: 'negative' };
  const addChoiceRes = (v) => { add('resistances', v); if (legacyEnergy[v]) add('resistances', legacyEnergy[v]); };
  for (const o of rec.choiceResistance?.options ?? []) addChoiceRes(o.value);
  if (rec.choiceResistance && !rec.choiceResistance.options) for (const o of rec.choice?.options ?? []) addChoiceRes(o.value);
  for (const w of rec.weaknesses ?? []) add('weaknesses', w.type);
  for (const w of rec.passiveEffects?.weaknesses ?? []) add('weaknesses', w.type);
  /* …and a resistance carried by a MODE gated on this record. A clause that applies only in a state —
   * *"While wearing medium or heavy armor, you gain resistance to physical damage equal to 1 + half
   * your level"* — is authored as a toggle rather than a field, because a field would grant it
   * unconditionally. Reading only the record's own fields called the Guardian's Armor resistance
   * missing on a record that carries it with the right number AND the right condition. */
  for (const m of Object.values(core.modes ?? {})) {
    /* BOTH mode carriers: a feat gate AND a consumable's own `fromItemId` — Blood Booster's printed
     * resistances live on `modes['item-blood-booster-lesser']`, and reading only the feat gate called
     * them missing on the item that carries them with the right numbers and duration. */
    if (m.fromItemId !== id && !(m.feats ?? []).includes(id)) continue;
    for (const r of m.resistances ?? []) add('resistances', r.type);
    for (const w of m.weaknesses ?? []) add('weaknesses', w.type);
  }
  /* …and a resistance carried by one of this record's own SUBCLASS OPTIONS. Their `select` flattens
   * every option's operations onto the selector row, so their Animistic Practice row asserts the seer's
   * spirit and void resistances as if the practice granted them; ours live on `classFeatures/seer`,
   * the option that actually prints them. Credited only where the class DECLARES this record as the
   * carrier, the same rule wg-diff.mjs and wg-identity.mjs use. */
  for (const cls of Object.values(core.classes ?? {})) {
    const lists = [
      ...(cls.subclass?.featureId === id ? [cls.subclass.options ?? []] : []),
      ...(cls.extraChoices ?? []).filter((ec) => ec.featureId === id).map((ec) => ec.options ?? []),
    ];
    for (const opts of lists) {
      for (const o of opts) {
        for (const r of core.classFeatures[o.id]?.resistances ?? []) add('resistances', r.type);
        for (const r of o.grant?.resistances ?? []) add('resistances', r.type);
      }
    }
  }
  /* A plain `choice`'s options carry `grant` in exactly the same shape, and a REPEATABLE grant has to
   * live there — `choice` is the only picker whose answer is per-taking. Wormskin's three takes moved
   * onto it (a different damage type each time, as printed), and reading only `effectChoices` reported
   * its resistances as missing the moment it did. A container must not decide whether a grant counts. */
  for (const ch of [{ options: rec.choice?.options ?? [] }, ...(rec.effectChoices ?? [])]) {
    for (const o of ch.options ?? []) {
      for (const r of o.grant?.resistances ?? []) add('resistances', r.type);
      /* …and the same lists one level deeper, under the branch's own `passive` block — which is where an
       * ITEM's per-branch resistance lives (the clay sphere's armour-or-weapon choice, the jolt coil's).
       * Reading only `grant.resistances` meant that moving a resistance INTO a branch made the record
       * regress from "has this resistance" to "has none" — the same blind spot the KINDS scan had. */
      for (const r of o.grant?.passive?.resistances ?? []) add('resistances', r.type);
      for (const w of o.grant?.passive?.weaknesses ?? []) add('weaknesses', w.type);
    }
  }
  /* …and the grant tables, read as text: `weaponFamiliarity` may be one object or a LIST of them
   * (Vishkanya's is two — the named weapons, then the trait). Both shapes are scanned the same way. */
  const entry = id ? grantEntry(id) : '';
  if (entry) {
    const wfBlock = /['"]?weaponFamiliarity['"]?\s*:\s*([\s\S]*?)(?:\n\s{2}\S|$)/.exec(entry)?.[1] ?? '';
    for (const m of wfBlock.matchAll(/['"]?weapons['"]?\s*:\s*\[([^\]]*)\]/g)) {
      for (const w of m[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) add('weapons', w[1]);
    }
    /* Familiarity by GROUP, not by weapon id — Explosive Savant grants "bombs" and "firearms". */
    for (const m of wfBlock.matchAll(/['"]?groups['"]?\s*:\s*\[([^\]]*)\]/g)) {
      for (const g of m[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) add('weapons', g[1]);
    }
    for (const m of wfBlock.matchAll(/['"]?traits['"]?\s*:\s*\[([^\]]*)\]/g)) {
      for (const t of m[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) add('weapons', `trait-name:${t[1]}`);
    }
    const csBlock = /['"]?critSpecWeapons['"]?\s*:\s*([\s\S]*?)(?:\n\s{2}\S|$)/.exec(entry)?.[1] ?? '';
    for (const m of csBlock.matchAll(/['"]?(?:bases|names)['"]?\s*:\s*\[([^\]]*)\]/g)) {
      for (const w of m[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) { add('critspec', w[1]); add('weapons', w[1]); }
    }
  }
  return sets;
}

/* ---------------------------------------------------------------- our side */
const laneText = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

/**
 * A `speeds` formula evaluated with the character having NO such speed — which recovers the base number
 * their `setValue` states.
 *
 * `min(@actor.speed.climb,1)*(@actor.speed.climb-15)+20` reads as "20 if you have no climb Speed, else
 * your existing Speed + 5", which is exactly the printed *"a climb Speed of 20 feet; if you already
 * have a base climb Speed, it increases by 5 feet"*. At zero it collapses to 20.
 *
 * Deliberately narrow: only `min`, `@actor.speed.*`, digits and arithmetic are accepted, and anything
 * else returns null and is printed as an unevaluated string rather than guessed at.
 */
function evalSpeedFormula(s) {
  if (!/^[-+*/(),.\s\d]|@actor|min/.test(s)) return null;
  const expr = String(s).replace(/@actor\.speed\.[a-z]+/g, '0');
  if (!/^[-+*/(),.\s\d]|min/.test(expr)) return null;
  if (/[a-z]/i.test(expr.replace(/min/g, ''))) return null;   // an identifier we do not model
  try {
    // eslint-disable-next-line no-new-func
    const v = Function('min', `"use strict"; return (${expr});`)(Math.min);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
const GRANT_FILES = ['src/rules/featGrantsAuto.ts', 'src/rules/featGrants.ts', 'src/rules/featGrantsLane.ts'];

/** The FeatGrant entry text for `id`, from whichever grant table holds it. */
function grantEntry(id) {
  /*
   * ⚠ CONCATENATE across every table, do not return the first match.
   *
   * A record may hold an entry in MORE THAN ONE grant table: Aldori Duelist Dedication keeps its skills
   * in featGrantsAuto and its `weaponFamiliarity` in featGrants, and returning the first made the other
   * half invisible — the feat read as granting no weapon familiarity at all.
   */
  const out = [];
  for (const f of GRANT_FILES) {
    const text = laneText(f);
    const re = new RegExp(`^\\s{2}(?:['"]${id}['"]|${id})\\s*:\\s*\\{`, 'm');
    const m = re.exec(text);
    if (!m) continue;
    /* To the next entry at the same indent. */
    const rest = text.slice(m.index + m[0].length);
    const end = /^\s{2}(?:['"][a-z0-9-]+['"]|[a-z][a-zA-Z0-9]*)\s*:/m.exec(rest);
    out.push(m[0] + rest.slice(0, end ? end.index : rest.length));
  }
  return out.join('\n');
}

/**
 * A `situational` entry's MAGNITUDE, per target track.
 *
 * This is the single biggest source of apparent disagreement, and it is not one. Their vocabulary has
 * no conditional bonus, so *"a +1 circumstance bonus to Perception checks and Will saves against
 * illusions"* is written as a flat `addBonusToValue PERCEPTION = 1` with the condition in a prose
 * field. Ours is a `situational` whose bonus is the STRING "+1 circumstance". Compared naively that
 * reads as "they grant +1, we grant nothing" on ten of batch 3's records — every one of which is
 * correctly authored, and more precisely than theirs.
 *
 * What IS worth comparing is the number: if they say +2 and we say +1, that is a real disagreement.
 * So the magnitude is pulled out of the string and filed under the same track key.
 */
function situationalMagnitudes(id, rec, put) {
  const entries = [];
  if (Array.isArray(rec.situational)) entries.push(...rec.situational);
  /* The registry copy, read as text — one entry from its key to the next at the same indent. */
  const text = laneText('src/rules/situationalBonuses.ts');
  const m = new RegExp(`^\\s{2}(?:['"]${id}['"]|${id})\\s*:\\s*\\[`, 'm').exec(text);
  if (m) {
    const rest = text.slice(m.index);
    const end = /\n\s{2}(?:['"][a-z0-9-]+['"]|[a-z][a-zA-Z0-9]*)\s*:/.exec(rest.slice(1));
    const body = rest.slice(0, end ? end.index + 1 : rest.length);
    /* Each `{ targets: [...], when: "...", bonus: "..." }` block. */
    for (const b of body.matchAll(/targets\s*:\s*\[(.*?)\][^}]*?bonus\s*:\s*['"]([^'"]*)['"]/gs)) {
      const kinds = [...b[1].matchAll(/kind:\s*['"]([a-zA-Z]+)['"]/g)].map((k) => k[1]);
      const details = [...b[1].matchAll(/detail\s*:\s*['"]([a-z:_-]+)['"]/g)].map((k) => k[1]);
      entries.push({ targets: kinds.map((k, i) => ({ kind: k, detail: details[i] })), bonus: b[2] });
    }
  }
  for (const e of entries) {
    /*
     * EVERY number in the bonus string, not the first.
     *
     * A SCALING bonus is one entry — Contract Negotiator's is *"+1 circumstance if expert in Diplomacy,
     * +2 if master, +3 if legendary"* — and their side asserts the top of the ladder. Taking only the
     * first number reported "they grant 3, we grant 1" on a record that grants all three.
     */
    const mags = [...String(e.bonus ?? '').matchAll(/([+-]?\d+)/g)].map((m) => Math.abs(Number(m[1])));
    if (!mags.length) continue;                // "you take no circumstance penalty" — no number to compare
    for (const n of mags) for (const t of e.targets ?? []) {
      const kind = t?.kind;
      if (kind === 'perception' || kind === 'initiative') put('perception|', n);
      else if (kind === 'save') put(`save|${t.detail ?? ''}`, n, /* anyDetail */ true);
      else if (kind === 'skill') put(`skill|${t.detail ?? ''}`, n, true);
      else if (kind === 'ac') put('ac|', n);
      else if (kind === 'speed') put('speed|land', n);
      /* An attack-roll star answers their ATTACK_ROLLS_BONUS the same way an AC star answers
       * AC_BONUS: their side writes the flat number and parks the trigger in the op's text, ours
       * writes the number in a star with the trigger in `when`. Hunter's Arrowhead's "+1 item …
       * against your prey" was the first to compare once the variable was taught, and read as
       * granting nothing because this map had no attack row. */
      else if (kind === 'strikeAttack' || kind === 'attack') put('attack|', n);
    }
  }
}

/** Everything WE assert for `id`, in the same `track|detail -> value` currency. */
function ourAssertions(id, rec) {
  /*
   * key -> EVERY assertion we make about it, not the last one written.
   *
   * A single record legitimately asserts two different things about one track: Earned Glory both
   * TRAINS Performance and shifts its degree of success. With a plain `set`, whichever reader ran last
   * won — the degree-shift overwrote the rank, and the record then read as "they train Performance and
   * we do not" on a record that trains it. A match against ANY assertion is agreement.
   */
  const out = new Map();
  const wildcards = new Set();
  const put = (k, v, anyDetail = false) => {
    if (v === undefined || v === null) return;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(v);
    /*
     * A conditional that names no SPECIFIC save or skill covers the whole track, and ours spells that
     * as `detail: 'all'` — "+1 circumstance to saves against emotion effects" (Undaunted). Their side
     * writes the same rule as three separate per-save operations, so without the wildcard all three
     * report as missing on a record that is correctly authored.
     */
    if (anyDetail && (k.endsWith('|') || k.endsWith('|all'))) wildcards.add(k.split('|')[0]);
  };
  out.__wildcards = wildcards;

  /* Record fields. */
  for (const [k, v] of Object.entries(rec.speeds ?? {})) {
    /* A formula encodes "N if you have none, else existing + M" — evaluate it at zero to recover the
     * base, which is the number their `setValue` states. Comparing a formula to a literal as strings
     * reported both dragonblood speed feats as disagreements when both are correct. */
    if (typeof v === 'string') {
      const base = evalSpeedFormula(v);
      put(`speed|${k}`, base ?? v);
    } else put(`speed|${k}`, Number(v));
  }
  /* …and the HERITAGE-GATED form. Gecko's Grip prints a climb Speed only for a cliffscale lizardfolk,
   * which `speedsIf` carries (read at src/rules/derive.ts:4468) — reading only the plain `speeds` map
   * reported a Speed the character really gets as missing. The gate is not a number, so only the value
   * is compared, exactly as with the unconditional form. */
  for (const g of Array.isArray(rec.speedsIf) ? rec.speedsIf : []) {
    for (const [k, v] of Object.entries(g?.speeds ?? {})) {
      const base = typeof v === 'string' ? evalSpeedFormula(v) : Number(v);
      put(`speed|${k}`, base ?? v);
    }
  }
  if (rec.landSpeedBonus) put('speed|land', Number(rec.landSpeedBonus));
  /* …and an ITEM's speeds, which live under `passiveEffects` and were not read: Boots of Bounding
   * carries `passiveEffects.speeds.land = 5` and read as granting no Speed at all. Same shape as the
   * `passiveEffects.bulkLimitBonus` hole below, and the same lesson — an item's mechanics are a level
   * deeper than a feat's, so every top-level reader needs its nested twin. */
  for (const [k, v] of Object.entries(rec.passiveEffects?.speeds ?? {})) {
    const base = typeof v === 'string' ? evalSpeedFormula(v) : Number(v);
    put(`speed|${k}`, base ?? v);
  }
  /*
   * …and `landSpeedMin`, the FLOOR form: *"You gain a land Speed of 20"* (Land Legs), *"Your Speed is
   * 30 feet"* (Quadruped). Theirs assigns the number outright and ours floors it, which is the same
   * result for every character that can exist — measured, no record carries a land-Speed floor above
   * another record's base — and the floor is the more careful ordering (floor first, then additive
   * bonuses, so Strong Tail + Fleet is 20 and not 25).
   *
   * Reading only `landSpeedBonus` reported "they grant 20, we grant nothing" on records that grant
   * exactly 20, and each one had to be settled by hand in SETTLED_VALUES below. Teaching the reader
   * settles the lane instead of the record.
   */
  if (rec.landSpeedMin) put('speed|land', Number(rec.landSpeedMin));
  /*
   * `speedAdjust` — the field for "reduce ALL your Speeds by 5" (Zombie Dedication) and "any fly Speed
   * you have increases by 5" (Winged Warrior). Neither is a `speeds` map nor a land bonus, so both
   * records read as adjusting no speed at all once authored correctly.
   */
  {
    const sa = rec.speedAdjust;
    if (sa?.add) {
      const keys = sa.key === 'all' ? ['land','fly','swim','climb','burrow'] : sa.key === 'non-land' ? ['fly','swim','climb','burrow'] : [sa.key];
      for (const k of keys) put(`speed|${k}`, Math.abs(Number(sa.add)));
    }
  }
  if (rec.acBonus) put('ac|', Number(rec.acBonus));
  /* …and the other homes of the SAME number. Teaching AC_BONUS without these would report a false gap
   * on every magic item and every natural-armour record whose bonus does not sit on `acBonus`. */
  if (rec.passiveEffects?.ac) put('ac|', Number(rec.passiveEffects.ac));
  if (rec.unarmoredAc?.acBonus) put('ac|', Number(rec.unarmoredAc.acBonus));
  if (rec.unarmoredAc?.upgradeAtLevel?.acBonus) put('ac|', Number(rec.unarmoredAc.upgradeAtLevel.acBonus));
  /* A weapon's own printed item bonus to attack — the alchemical bomb grades. */
  if (rec.attackItemBonus) put('attack|', Number(rec.attackItemBonus));
  /*
   * ⚠ `maxHpBonus` IS A STRUCTURE, NOT A NUMBER — `{ perLevel?, flat?, perArchetypeFeat?, archetype? }`
   * (types.ts) — so `Number(rec.maxHpBonus)` was **NaN on every one of the 23 records that carry one**,
   * for as long as the hp track has existed. Every `hp|` comparison this corpus has ever made was
   * against NaN: six records reported a false DIFFERENT, and worse, the `hp|` settles written by hand
   * in earlier batches were settled against a value that could not have matched anything.
   *
   * Each sub-field is put separately, because their vocabulary asserts whichever one it can see: a flat
   * +N as a literal, a per-level as MAX_HEALTH_CLASS_PER_LEVEL, and a per-archetype-feat as one +N
   * stamped onto every feat of that archetype (the Resiliency feats).
   */
  if (rec.maxHpBonus) {
    const hb = rec.maxHpBonus;
    if (hb.flat !== undefined) put('hp|', Number(hb.flat));
    if (hb.perLevel !== undefined) put('hp|', Number(hb.perLevel));
    if (hb.perArchetypeFeat !== undefined) put('hp|', Number(hb.perArchetypeFeat));
  }
  /*
   * A BACKGROUND'S OWN TRAINED SKILL, and a CLASS'S OWN CHASSIS.
   *
   * Neither was read, and neither lives anywhere else: a background states its skill in `trainedSkill`
   * and a class states perception / saves / trained skills / class DC / weapon + armour ranks in its
   * own record. So the comparer reported "they train Acrobatics and we train nothing" on nine
   * backgrounds that train exactly that, and five separate false gaps on the Alchemist — every one of
   * which matched the moment anyone looked at the record. A gap list is a claim about a QUERY.
   *
   * Batch 1 is where this surfaced, because it is the only batch cut before the level ordering and so
   * the only one holding classes and backgrounds.
   */
  if (rec.trainedSkill) put(`skill|${rec.trainedSkill}`, 'trained');
  /* A "trained in your choice of X or Y" background: every branch, because the comparison asks what
   * the record CAN grant, not which branch a character picked — the same rule `choiceGrants` follows. */
  for (const s of rec.trainedSkillChoice ?? []) put(`skill|${s}`, 'trained');
  if (typeof rec.perception === 'string') put('perception|', rec.perception);
  for (const [s, r] of Object.entries(rec.saves ?? {})) if (typeof r === 'string') put(`save|${s}`, r);
  /* Two shapes share the key: a CLASS carries { fixed, choose }, a BACKGROUND (Tech-Reliant's
   * additional Medicine, batch 21) carries a plain array. */
  for (const s of Array.isArray(rec.trainedSkills) ? rec.trainedSkills : rec.trainedSkills?.fixed ?? []) put(`skill|${s}`, 'trained');
  if (typeof rec.classDc === 'string') put('classDc|', rec.classDc);
  for (const [k, r] of Object.entries(rec.attacks ?? {})) if (typeof r === 'string') put(`weapon|${k}`, r);
  for (const [k, r] of Object.entries(rec.defenses ?? {})) if (typeof r === 'string') put(`armor|${k}`, r);

  if (rec.bulkBonus) put('bulk|', Number(rec.bulkBonus));
  if (rec.bulkLimitBonus) put('bulk|', Number(rec.bulkLimitBonus));
  /* …and the ASYMMETRIC one, a bonus to the maximum limit only (Embodied Dreadnought Subjectivity).
   * The same number their `BULK_LIMIT_BONUS` carries — they do not distinguish the two thresholds, so
   * comparing it here is right; which threshold it moves is settled on our side by the field itself. */
  if (rec.bulkMaxBonus) put('bulk|', Number(rec.bulkMaxBonus));
  /* …and its ITEM home (Lifting Belt, the Assisting rune). Reading only the top-level name reported
   * 'they raise the Bulk limit and we raise nothing' on a record that raises it. */
  if (rec.passiveEffects?.bulkLimitBonus) put('bulk|', Number(rec.passiveEffects.bulkLimitBonus));
  /* …and behind a state gate: Adrenaline Rush raises both Bulk limits only while Raging. */
  for (const w of Array.isArray(rec.whileActive) ? rec.whileActive : []) {
    if (w?.bulkLimitBonus) put('bulk|', Number(w.bulkLimitBonus));
  }
  /* A skill that climbs on its own schedule — *"At 3rd level, you become an expert in Undead Lore; at
   * 7th level, you become a master…; and at 15th level, you become legendary"*. Their side asserts the
   * TOP of the ladder as one number, so the top is what has to be compared; the intermediate steps are
   * a progression, not a disagreement. */
  for (const prog of rec.skillProgression ?? []) {
    const order = ['untrained', 'trained', 'expert', 'master', 'legendary'];
    const top = (prog.at ?? []).reduce((best, s) => (order.indexOf(s.rank) > order.indexOf(best) ? s.rank : best), 'untrained');
    if (top !== 'untrained') put(`skill|${prog.skill}`, top);
  }
  /* …and the skills granted by the OPTIONS of a choice group this class declares this record as the
   * carrier of. The Root Epithet feature prints "choose one" and the six epithets each train a
   * different skill, but those options live on `classes.exemplar.extraChoices`, not on the feature —
   * so reading only the record said the feature trained nothing. Credited ONLY where the class names
   * this record in `featureId`, the same rule wg-diff.mjs uses, so an undeclared group still reads as
   * a gap rather than being silently excused. */
  for (const cls of Object.values(core.classes ?? {})) {
    const groups = [
      ...(cls.subclass?.featureId === id ? [cls.subclass] : []),
      ...(cls.extraChoices ?? []).filter((ec) => ec.featureId === id),
    ];
    for (const g of groups) {
      for (const o of g.options ?? []) {
        for (const s of o.grants?.skills ?? []) put(`skill|${s}`, 'trained');
        for (const [k, v] of Object.entries(core.classFeatures[o.id]?.passiveEffects?.skills ?? {})) put(`skill|${k}`, v);
      }
    }
  }
  const pe = rec.passiveEffects ?? {};
  /* MAGNITUDES, matching the abs on their side's op loop: this comparer is magnitude-only BY DESIGN
   * (their -1 penalty and our -1 penalty must agree, and their side is abs'd before it gets here).
   * Shining Hackle's stealth -1 vs their "theirs=1" was a false DIFFERENT for exactly this asymmetry.
   * ⚠ pe.saves is a NUMBER on items (ItemPassiveEffects.saves), so the Object.entries line yields
   * nothing for them — it exists for the classFeatures shape that stores a map. */
  for (const [k, v] of Object.entries(pe.skills ?? {})) put(`skill|${k}`, typeof v === 'number' ? Math.abs(v) : v);
  for (const [k, v] of Object.entries(pe.saves ?? {})) put(`save|${k}`, typeof v === 'number' ? Math.abs(v) : v);
  if (pe.perception !== undefined) put('perception|', typeof pe.perception === 'number' ? Math.abs(pe.perception) : pe.perception);
  if (pe.ac !== undefined) put('ac|', Number(pe.ac));
  if (pe.speedBonus !== undefined) put('speed|land', Number(pe.speedBonus));

  /* The grant tables, read as text — the registries are TypeScript, not data. */
  const entry = grantEntry(id);
  if (entry) {
    const skills = /skills\s*:\s*\{([^}]*)\}/.exec(entry);
    for (const m of (skills?.[1] ?? '').matchAll(/['"]?([a-z:][a-z:_-]*)['"]?\s*:\s*['"]([a-z]+)['"]/g)) {
      put(`skill|${m[1]}`, m[2]);
    }
    const saves = /save\s*:\s*\{([^}]*)\}/.exec(entry);
    for (const m of (saves?.[1] ?? '').matchAll(/['"]?([a-z]+)['"]?\s*:\s*['"]([a-z]+)['"]/g)) put(`save|${m[1]}`, m[2]);
    /*
     * A rank gated on a DIFFERENT skill. Bardic Lore is trained outright and *"expert if you have
     * LEGENDARY proficiency in Occultism"* — `crossConditionalSkills` — so the flat map holds only the
     * base and their side asserts the top. Both are recorded.
     */
    /*
     * EVERY (skill, rank) PAIR IN THE ENTRY, however it nests.
     *
     * A grant entry spells a skill rank four different ways — a flat `skills` map, a
     * `conditionalSkills` base/upgraded pair, a `crossConditionalSkills` gate, and a `choiceGrants`
     * branch — and a brace-counting regex broke on the nested ones, so eight dedications read as
     * training nothing at all. The comparison only asks "can this record grant that skill at that
     * rank", so scan the whole entry: a skill key, then any rank word before the next skill key.
     */
    const RANKS = ['untrained', 'trained', 'expert', 'master', 'legendary'];
    const keyRe = /['"]?((?:lore:)?[a-z][a-z:_-]*)['"]?\s*:/g;
    /*
     * ⚠ Slice to the next SKILL key, not the next key of any kind.
     *
     * `conditionalSkills: { 'lore:fireworks': { base: 'trained', upgraded: 'expert' } }` puts `base:`
     * and `upgraded:` BETWEEN the skill key and its ranks, so slicing at "the next key" cut the ranks
     * off and eight dedications still read as training nothing. Filtering to skill keys first makes
     * each slice span the whole of that skill's value, however it nests.
     */
    const keys = [...entry.matchAll(keyRe)].filter((m) => m[1].startsWith('lore:') || SKILL_KEYS.has(m[1]));
    for (const [i, m] of keys.entries()) {
      const slice = entry.slice(m.index, keys[i + 1]?.index ?? entry.length);
      for (const r of slice.matchAll(/['"]([a-z]+)['"]/g)) {
        if (RANKS.includes(r[1])) put(`skill|${m[1]}`, r[1]);
      }
    }
    const perc = /perception\s*:\s*['"]([a-z]+)['"]/.exec(entry);
    if (perc) put('perception|', perc[1]);
    /*
     * A grant the record's own CHOICE decides. Canny Acumen's *"become an expert in your choice"* and
     * Dongun Education's two Lores are both `choiceGrants`, keyed by the answer — so the flat maps
     * above hold nothing and the record read as granting nothing. Every branch is collected, because
     * the comparison asks "can this record grant that?", not "which branch did this character pick?".
     */
    const cg = /['"]?choiceGrants['"]?\s*:\s*\{([\s\S]*?)\n\s{2}\}/.exec(entry)?.[1] ?? '';
    for (const m of cg.matchAll(/['"]?([a-z:][a-z:_-]*)['"]?\s*:\s*['"]([a-z]+)['"]/g)) {
      const [, key, rank] = m;
      if (['fortitude', 'reflex', 'will'].includes(key)) put(`save|${key}`, rank);
      else if (key === 'perception') put('perception|', rank);
      else put(`skill|${key}`, rank);
    }
    /*
     * …and a LADDER. `rankUpgrade` raises whatever this record granted at set levels — Dongun
     * Education climbs trained -> expert -> master -> legendary — and their side asserts the TOP.
     * Every rung is recorded so either end matches.
     */
    const ru = /['"]?rankUpgrade['"]?\s*:\s*(\[[\s\S]*?\]|\{[^}]*\})/.exec(entry)?.[1] ?? '';
    const rungs = [...ru.matchAll(/rank\s*:\s*['"]([a-z]+)['"]/g)].map((m) => m[1]);
    if (rungs.length) {
      for (const [k, vals] of [...out]) {
        if (!/^(skill|save|perception)\|/.test(k)) continue;
        if (!vals.some((v) => typeof v === 'string')) continue;
        for (const r of rungs) put(k, r);
      }
    }
    /* A skillChoices slot asserts its rank for whichever option is picked — record the OPTIONS so a
     * choice can be compared against a fixed grant on their side without claiming a specific skill. */
    for (const m of entry.matchAll(/options\s*:\s*\[([^\]]*)\]\s*,\s*rank\s*:\s*['"]([a-z]+)['"]/g)) {
      for (const o of m[1].matchAll(/['"]([a-z:][a-z:_-]*)['"]/g)) put(`choice-skill|${o[1]}`, m[2]);
    }
  }
  /* …and the conditional bonuses, whose magnitude is what their flat number is really asserting. */
  /*
   * A SPEED granted through a container. Sublime Mobility's climb-or-swim lives in
   * `effectChoices[].options[].grant.speeds` and Powerful Tail's climb in `enhancement.grant.speeds`;
   * reading only the top-level `speeds` map reported both as granting no speed at all.
   */
  for (const ch of [{ options: rec.choice?.options ?? [] }, ...(Array.isArray(rec.effectChoices) ? rec.effectChoices : [])]) {
    for (const o of ch?.options ?? []) {
      for (const [k, v] of Object.entries(o?.grant?.speeds ?? {})) put(`speed|${k}`, typeof v === 'string' ? v : Number(v));
      /* …and the SKILLS. A dedication's "become trained in X (or another skill if you already were)"
       * is an effect choice whose every option grants a skill, and reading only `grant.speeds` left
       * four dedications reading as training nothing at all.
       * …and a plain `choice`'s options carry `grant` in the same shape. Orc Warmask's four warmask
       * sources moved onto it (the picked source sets the trained skill AND names the tradition Mask
       * of Power casts at), and reading only `effectChoices` reported four trained skills the
       * character really gets as `ours=1` — the `skill` wildcard from the record's own +1-item
       * ceremony bonus, which is the only thing left to answer with. Same rule as ourSets above and
       * wg-diff's kinds walk: a container should not decide whether a grant counts. */
      for (const [k, v] of Object.entries(o?.grant?.skills ?? {})) put(`skill|${k}`, v);
      for (const [k, v] of Object.entries(o?.grant?.save ?? {})) put(`save|${k}`, v);
    }
  }
  for (const [k, v] of Object.entries(rec.enhancement?.grant?.speeds ?? {})) {
    put(`speed|${k}`, typeof v === 'string' ? v : Number(v));
  }
  /* …and a Speed carried by a MODE — the scalar twin of the mode loop in ourSets. A Speed the book
   * grants for a DURATION cannot be a record field (the owner's always-on rule), so it lives on
   * modes/item-*; reading only the record reported Sea Touch Elixir's swim 20 as granted by nobody.
   * Formula-valued mode speeds are pushed as their raw string — `put` is multi-assertion, and
   * evaluating @actor.speed.land here would collapse min-shaped formulas to 0 and print a misleading
   * DIFFERENT row. */
  for (const m of Object.values(core.modes ?? {})) {
    if (m.fromItemId !== id && !(m.feats ?? []).includes(id)) continue;
    for (const [k, v] of Object.entries(m.speeds ?? {})) put(`speed|${k}`, typeof v === 'string' ? v : Number(v));
  }
  situationalMagnitudes(id, rec, put);
  /* A `degreeShifts` entry asserts a shift, not a number — recorded so a numeric claim on their side
   * lands against SOMETHING rather than reading as absent. */
  for (const d of Array.isArray(rec.degreeShifts) ? rec.degreeShifts : []) {
    for (const s of d.saves ?? []) put(`save|${s}`, 'degree-shift');
    for (const s of d.skills ?? []) put(`skill|${s}`, 'degree-shift');
    if (d.perception) put('perception|', 'degree-shift');
  }
  return out;
}

/**
 * VALUE DIFFERENCES THAT HAVE BEEN READ AND SETTLED, keyed `id` -> `track|detail`.
 *
 * The screen above compares what each side ASSERTS. A handful of rows survive it and are still not
 * defects: the two vocabularies express the same rule with different arithmetic, or their number
 * disagrees with the printed one. Naming them here with the evidence stops each batch re-deriving the
 * same reading, while anything unlisted still reports.
 *
 * ⚠ The printed text is the authority — Paizo's, under the ORC licence. Their data is EVIDENCE that a
 * lane may be missing, never the source. Where their number and the book's number differ, the book wins
 * and the disagreement is recorded rather than adopted.
 */
const SETTLED_VALUES = {
  /*
   * CREATIVE PRODIGY — a NAME TWIN, not a gap. Their SKILL_DECEPTION comes from ability_block 23367,
   * the GANZI Creative Prodigy (trait 3035, content_source 18 = Ancestry Guide backport, no
   * prerequisite; AoN feat-2532, Ancestry Guide pg. 96), which grants Deception + Performance +
   * Art Lore. OUR record is the NEPHILIM one: AoN feat-7199, War of Immortals pg. 53, prereq
   * Proteankin = their ability_block 38501, and we match it op for op —
   *   adjValue SKILL_PERFORMANCE T   -> featGrantsAuto.ts + the record's own `skills` overlay
   *   giveAbilityBlock feat 20241    -> featFeatGrants.ts ['impressive-performance']
   *   addBonusToValue +1 circ.       -> situationalBonuses.ts (Make an Impression)
   * wgRowsByBucket (lib/wg-parse.mjs) keeps ONE row per normalised name and breaks ties on
   * operations LENGTH alone; the Ganzi row's encoding is 561 chars to the nephilim row's 551, so the
   * wrong twin wins by 10 characters. Neither WG row disagrees with its own printed source, so there
   * is nothing here to adjudicate against the book.
   * We do not carry feat-2532 at all — we DO ship the ganzi versatile heritage and two ganzi feats,
   * so importing feat-2532 as its own record is a fair COVERAGE question for the ganzi lane; it must
   * not be answered by grafting Deception onto feat-7199, which is the exact defect batch 4 removed.
   * ⚠ If the wgRowsByBucket tie-break is ever hardened to pair on prerequisites/traits, this entry
   * goes stale by design — scripts/wg-settle-stale.mjs will flag it and it should then be DELETED.
   */
  'creative-prodigy': ['skill|deception'],
  /*
   * GHORAN WEAPON FAMILIARITY — a TRAIT SWEEP their format cannot express, so they enumerate it.
   *
   * They list `thorn-whip` among the named weapons; we deliberately do not. Printed: *"You're trained
   * with the glaive, greatclub, hatchet, scythe, and sickle. IN ADDITION, you gain access to all uncommon
   * GHORAN weapons. For the purpose of determining your proficiency, martial ghoran weapons are simple
   * weapons…"* That is two rules, not one list: the five named weapons take a flat trained rank, and the
   * ghoran-TRAIT weapons take a category demotion that tracks the character's own proficiency.
   *
   * `thorn-whip` is the only ghoran-trait weapon in the corpus, so their enumeration and our
   * `traits: ['ghoran']` clause reach exactly the same weapon — but ours also applies the demotion,
   * which theirs cannot express. Adopting their flat list would pin a martial weapon at trained for all
   * 20 levels, which is the defect this record was just fixed for. Same shape as vanara (gada) and
   * jotunborn (bladesweeper, maul-spade); asserted in test/held-back-registry-fixes.test.ts.
   */
  'ghoran-weapon-familiarity': ['set|weapons'],

  /* ---- BATCH 15 ---------------------------------------------------------------------------------
   *
   * UNCANNY AWARENESS — a NAME COLLISION on their side. Their dump holds three rows of that name: our
   * level-5 motion-sense record, and two at level 9 carrying `PERCEPTION +2 to initiative`. The
   * Archives carry exactly ONE Uncanny Awareness (feat-2524, level 5) and nothing of that name in any
   * other category; the initiative clauses are printed on Elven Instincts and Ambush Awareness, which
   * are their own records. Full reasoning in wg-diff's VERIFIED_EQUIVALENT.
   */
  'uncanny-awareness': ['perception|'],
  /* Same record, same reading as the wg-diff settle: the +1 lives on core.runes/armor-potency-1
   * (kind: potency, value: 1) and reaches AC through attachments.ts planRune -> derive.ts acItem as an
   * item bonus. wg-values reads the items-bucket chassis, which holds no ac key by design. */
  'armor-potency-1': ['ac|'],

  /*
   * MAGICAL FORTITUDE / PRECOGNITIVE REFLEXES — a different CARRIER, not a different rank. The advance
   * lives in `src/rules/advancement.ts` (the per-class table) rather than on the record, so a comparer
   * that reads record fields sees nothing. Measured on built characters before settling — see
   * test/batch15-parity.test.ts, which steps each owning class either side of the level.
   */
  'magical-fortitude': ['save|fortitude'],
  'precognitive-reflexes': ['save|reflex'],

  /*
   * BATCH 18 — five more of the SAME advancement-table carrier as magical-fortitude above, each
   * adversarially confirmed with the reader chain (archived in the b018 adversarial record set): advancement.ts rows keyed
   * `source: '<id>'` -> advancementRows -> applyAdvancement (build.ts) -> derive. Their side writes
   * the rank as a bare adjValue on the record (SAVE_REFLEX=E / SAVE_FORT=M / PERCEPTION=E); ours
   * lives on the per-class table, so a field-reading comparer sees nothing.
   *  - reflex-expertise: SAVE_REFLEX=E on every per-class row (their 45047/26086/31221/24639/39320/
   *    39092…) — ours: the per-class reflex expert rows (guardian 7, thaumaturge 3, necromancer 5…).
   *  - reaction-time: PERCEPTION=E (their 45044 guardian L7) — ours advancement.ts guardian
   *    perception expert@7; the extra-reaction half is the record's extraReaction row (batch-18 fix).
   *  - juggernaut: SAVE_FORT=M + the success-to-crit text op (their 31234) — ours barbarian
   *    fortitude master@7 (+ magus master@15, print's other half) + the record's degreeShifts.
   *  - evasive-reflexes: SAVE_REFLEX=M + text op (their 21320) — ours rogue reflex master@7 +
   *    degreeShifts.
   *  - confident-evasion: SAVE_REFLEX=M + text op (their 33060) — ours swashbuckler reflex master@7
   *    + degreeShifts.
   */
  'reflex-expertise': ['save|reflex'],
  'reaction-time': ['perception|'],
  'juggernaut': ['save|fortitude'],
  'evasive-reflexes': ['save|reflex'],
  'confident-evasion': ['save|reflex'],

  /*
   * DEVOUT BLESSING — the champion half of the resiliency family (advanced-fury above, batch-17's
   * advanced-devotion/-glory/-kata/-defender). Their (2) op is `conditional IF FEAT_NAMES INCLUDES
   * "champion resiliency" THEN adjValue MAX_HEALTH_BONUS = 3`. Printed Devout Blessing grants
   * no Hit Point; the clause prints on Champion Resiliency, and ours holds it ONCE there —
   * feats['champion-resiliency'].maxHpBonus {perArchetypeFeat:3, archetype:'champion'} — with
   * devout-blessing counted through its archetype. Owner ruling 2026-08-22 ("the book wins"),
   * guarded by scripts/resiliency-clause-check.mjs.
   */
  'devout-blessing': ['hp|'],

  /*
   * BRUTALITY — their set is wider than the sentence.
   *
   * Verbatim: *"While raging, you have the critical specialization benefits for MELEE weapons and
   * unarmed attacks."* Theirs lists simple-weapons, martial-weapons, unarmed-attacks — the three
   * CATEGORIES raised to expert by the feature's FIRST sentence, which is a different clause. Read as
   * written, their set hands the benefit to a simple RANGED weapon, which the text does not.
   *
   * Ours is `critSpecWeapons: { melee: true }`, which is the sentence. What their row DID surface was
   * the gate: they wrap it in a conditional on the rage mode and ours applied always, so a barbarian
   * carried the benefit out of combat. That half was adopted — `critSpecRequiresModeGroup`.
   */
  brutality: ['set|critspec'],

  /*
   * Draconic Codex, feat-8077, verbatim from the AoN mirror: *"You gain a climb Speed of 20 FEET; if you
   * already have a base climb Speed, it increases by 5 feet."* Their row sets it to 15. Ours evaluates to
   * 20 with no existing climb Speed and existing+5 otherwise, which is the printed rule exactly.
   * THEIR NUMBER CONTRADICTS THE BOOK. Not adopted; recorded. (Same class as the draconic-resistance
   * value note in work/wg-lane-backlog.md.)
   */
  'summiting-dragonblood': ['speed|climb'],
  /*
   * *"Your Speed is 30 feet."* Theirs assigns 30; ours is `landSpeedMin: 30`, a FLOOR applied before any
   * additive bonus. Behaviourally identical for every character that can exist: a poppet's base land
   * Speed is 25, the feat is `onlyAtLevel: 1`, and MEASURED — no record anywhere carries a land-Speed
   * floor above 30 — so the floor can never sit under a higher base. `landSpeedMin` is also the field
   * documented for this printed wording ("increases TO N feet" / "becomes N feet"), and its ordering is
   * the more careful one: floor first, then bonuses, so Strong Tail + Fleet is 20 and not 25.
   */
  quadruped: ['speed|land'],
  /*
   * Basic Kata — the value half of the settle recorded in wg-diff's VERIFIED_EQUIVALENT.
   *
   * Their row hangs a FLAT `MAX_HEALTH_BONUS 3` off Basic Kata, gated on having picked Monk Resiliency
   * with it. The printed text of Monk Resiliency is *"You gain 3 additional Hit Points FOR EACH monk
   * archetype class feat you have… you continue to gain additional Hit Points in this way."* Ours is
   * `maxHpBonus.perArchetypeFeat: 3` on `monk-resiliency` itself, which is that sentence, and grows
   * with the archetype as it says. THEIR NUMBER CONTRADICTS THE BOOK and is on the wrong record.
   * Not adopted; recorded.
   */
  'basic-kata': ['hp|'],
  /*
   * The batch-17 ADVANCED halves of the same family — the value side of the block settle in wg-diff's
   * VERIFIED_EQUIVALENT. Their flat 3 hangs off each archetype feat; ours is
   * `maxHpBonus.perArchetypeFeat: 3` on the *-resiliency feat that PRINTS it, which scales with the
   * archetype as the book says. Not adopted; recorded. guardians-intercept quiets ONLY its hp value —
   * its Intercept Attack grant is a real mismatch fixed separately.
   */
  'advanced-devotion': ['hp|'],
  'advanced-glory': ['hp|'],
  'advanced-kata': ['hp|'],
  'advanced-defender': ['hp|'],
  'champions-reaction': ['hp|'],
  'guardians-intercept': ['hp|'],
  /* Batch 18: value half of the wg-diff advanced-fury settle. Their flat 3 vs ours on
   * `barbarian-resiliency` as maxHpBonus.perArchetypeFeat: 3 — held once, on the record that prints
   * it, scaling per archetype feat where their flat 3 cannot. Owner ruling 2026-08-22. */
  'advanced-fury': ['hp|'],
  /*
   * The batch-13 siblings of Basic Kata — same shape, same reason, recorded in full in wg-diff's
   * VERIFIED_EQUIVALENT. Their flat +3 hangs off the "Basic <X>" feat; the printed Hit Points are on
   * the RESILIENCY feat and scale — *"3 additional Hit Points for each <class> archetype class feat
   * you have"* — and ours are authored there, on `barbarian-resiliency` and `champion-resiliency`,
   * read by featHpBonus at src/rules/derive.ts:755. Verified on built characters by three refuters.
   */
  /*
   * FAST MOVEMENT — a NAME COLLISION, and a mechanic that is computed rather than stored.
   *
   * We hold two records under this id: `feats/fast-movement` (the barbarian feat, +10 land Speed —
   * which is where the `ours=10` comes from) and `familiarAbilities/fast-movement`. THEIRS is the
   * familiar ability: *"Increase one of your familiar's Speeds from 25 feet to 40 feet."*
   *
   * Their five speed lines are the five OPTIONS of that one choice, each behind its own conditional
   * testing that the Speed is currently 25 — not five speeds granted at once. Ours is the same choice,
   * built in batch 13: the answer is stored in `CompanionConfig.abilityChoices['fast-movement']` and
   * applied in `deriveFamiliar` (src/rules/companions.ts), which raises the chosen Speed 25 → 40 and
   * correctly leaves burrow at 5. Verified on built familiars: fly and climb reach 40 when chosen,
   * burrow stays 5, and land remains the default.
   *
   * A familiar's Speeds are DERIVED, never fields on the record, so the value comparer — which reads
   * numbers off core.json — has nothing to compare against and never will.
   */
  'fast-movement': ['speed|land', 'speed|swim', 'speed|fly', 'speed|climb', 'speed|burrow'],
  /*
   * BATCH 14 — three resistance SETS where their side names a category and ours names its members.
   *
   *   ghostly-resistance  *"resistance 1 to all damage except for force, vitality, and any damage done
   *       by a weapon with the ghost touch rune."* Theirs writes the exception into the TYPE STRING
   *       ("non-magical damage"); ours is `all-damage` with the exceptions carried as the entry's
   *       condition, which is the shape our IWR breakdown reads and prints.
   *   mortification  their single unnamed resistance vs our three named damage types — the printed
   *       text is *"Choose bludgeoning, piercing, or slashing… you gain resistance to the CHOSEN type"*,
   *       so three options each granting one type IS the rule; a single entry could not say which.
   *   hardened-chassis  the same, one feat along: they carry a `physical (except adamantine)` blanket
   *       beside the three, because their second select threads a later feat's upgrade through this
   *       record. Ours offers the three the feat prints; the upgrade is the upgrading record's business.
   */
  /* ghostly-resistance — settle REMOVED: divergence fixed (the base no longer reads 0 below 4th, and the non-magical band is authored). Re-report if it returns. */
  'mortification': ['set|resistances'],
  'hardened-chassis': ['set|resistances'],
  'basic-fury': ['hp|'],
  'basic-devotion': ['hp|'],
  'devout-magic': ['hp|'],
  /*
   * Not a typo on their side: `khakkara` is Paizo's legacy (APG) name and `khakkhara` the Remaster
   * one (AoN weapon-126 carries remaster_id weapon-412), and WG ships both items — their row simply
   * uses the label the printed feat text prints. Our catalogue ships only `khakkhara`, so that is
   * the id we must name; the two dead ids we did have (`khakkara`, `wakazashi`, on this feat and
   * tengu-weapon-study) were found by this comparison and are now pinned by
   * test/weapon-id-integrity.test.ts.
   */
  'tengu-weapon-familiarity': ['set|weapons'],
  /*
   * Their encoding emits a bare `RESISTANCES = "1"` beside each element option — the printed
   * *"resistance equal to half your level (minimum 1)"*, i.e. a FLOOR, not a damage type.
   * `setMember` keeps everything before the comma, so the set comparison reads that "1" as a fifth
   * member beside air/earth/fire/water. Our four elements match theirs exactly; the fifth member is
   * an artefact of their value shape.
   */
  dualborn: ['set|resistances'],

  /* mauler-dedication was settled here for a gap the comment placed in the COMPARER, not the data:
   * `ourSets` fed `critSpecWeapons.traits` into the `weapons` set only, so a trait-only crit-spec
   * record contributed no critspec member and read as granting nothing. `ourSets` now emits those
   * traits into `critspec` too, so the entry is gone. */
  /*
   * "MARTIAL COMBINATION WEAPONS." Measured: our item data has no `combination` weapon group at all,
   * so there is nothing to grant familiarity with. The bayonet, reinforced stock and martial firearms
   * halves all ship. Recorded rather than faked — a group that does not exist cannot be granted.
   */
  /*
   * Their side asserts LEGENDARY on a Lore these dedications train at trained/expert. That is the
   * ADDITIONAL LORE ladder, not the dedication's own grant: each of these grants Additional Lore for
   * that Lore, and `additional-lore` carries `rankUpgrade` to legendary at 15th. The comparer reads
   * the dedication's entry, not the granted feat's.
   */
  'blackjacket-dedication': ['skill|lore:warfare'],
  'wylderheart-dedication': ['skill|lore:demon'],
  /*
   * Ours is feat-8812 (level 2, Hellfire Dispatches): the scaling mental resistance as
   * `@actor.archetypeFeats.hellknight + 1`, the order choice, Additional Lore, and Intimidation via
   * `conditionalSkills` in featGrantsAuto.ts. The row the name-keyed pairing picks is their LEVEL-6
   * Hellknight Dedication, whose conditional/ac ops are a Sentinel-style light/medium/heavy
   * armour-proficiency ladder from that feat's own printed text — a different feat sharing the name,
   * not a rule ours omits.
   */
  'hellknight-dedication': ['skill|intimidation'],
  /*
   * Their row inlines the ADDITIONAL LORE ladder onto the dedication: Dueling Lore is created
   * trained, then three LEVEL>=3/>=7/>=15 conditionals raise it to expert/master/legendary. The
   * printed feat grants only "the Additional Lore feat for Dueling Lore" and states no rank of its
   * own; ours records trained on the dedication and carries the 3rd/7th/15th ladder on
   * `additional-lore`, which this dedication grants. The comparer reads the dedication's grant
   * entry, not the granted feat's.
   */
  'aldori-duelist-dedication': ['skill|lore:dueling'],
  /*
   * Their row inlines the ADDITIONAL LORE ladder onto the dedication: Warfare Lore created trained,
   * then LEVEL>=3/>=7/>=15 conditionals raising it to expert/master/legendary. The printed feat
   * grants only *"the Additional Lore general feat for Warfare Lore"* and states no rank of its own;
   * ours records trained on the dedication and carries the ladder on the granted Additional Lore,
   * which is where the book puts it.
   */
  'war-mage-dedication': ['skill|lore:warfare'],
  /*
   * Their only `hp` op sits inside a conditional gated on FEAT_NAMES including "barbarian
   * resiliency" and adds +3 MAX_HEALTH_BONUS — Barbarian Resiliency's Hit Points parked on the
   * dedication row, not the dedication's own. The printed Barbarian Dedication grants no HP, and we
   * carry those Hit Points on `barbarian-resiliency` itself as `maxHpBonus: { perArchetypeFeat: 3,
   * archetype: 'barbarian' }`.
   */
  'barbarian-dedication': ['hp|'],

  /* ---- batch 008, read 2026-08-19 ------------------------------------------------------------ */
  /*
   * *"You gain access to all uncommon weapons with the TRIPKEE trait … plus the blowgun, dart, hatchet,
   * scythe, and shortbow."* Their set is the single legacy trait `grippli`; ours is the remaster trait
   * `tripkee` plus the five weapons the sentence names. Tripkee is the Remaster rename of grippli, so
   * their row is the pre-Remaster printing and ours is the current one — and ours additionally carries
   * the five named weapons their row omits entirely.
   */
  /*
   * Their crit-spec member is "hungerseed horns"; ours is `critSpecWeapons.names: ['horns']`, which
   * matches by the strike's own NAME — and `heritages/hungerseed` grants a strike named exactly
   * "Horns". The printed clause names it the same way: *"or with your horns unarmed Strike"*. One
   * mechanic, two granularities of label.
   */
  'oni-weapon-familiarity': ['set|critspec'],
  /*
   * The "from dragons" half of every member — *"Double this resistance against damage of that type
   * dealt to you by dragons"* — ships as a second resistance row with `against: 'dragons'` at THEIR
   * value (`max(2,@actor.level)`), per the ruling in work/wg-lane-backlog.md. Their encoding splits
   * it into separate "<type> from dragons" members, but the set comparison's word-subset matcher
   * covers each of those against our bare type, so this key reports no gap today and the settle is
   * inert. The ten TYPES match one for one (force, mental, poison, spirit and void were added in
   * this pass).
   */
  'draconic-resistance': ['set|resistances'],

  /*
   * THEIR SEER NUMBERS ARE LEVEL-TIERED, NOT FLAT — the earlier note here claimed otherwise and was
   * wrong. Inside the Practice select's Seer option they write SAVE_FORT/REFLEX/WILL and AC_BONUS at
   * +1, with the +2 set under a `conditional LEVEL >= 9` and the +3 set under `LEVEL >= 17`, every
   * op carrying the text "against the effects of haunts and the abilities of spirits and incorporeal
   * undead". That is the same rule ours states, held as situationalBonuses["seer"] with the
   * condition and the "+1 status (+2 at 9th, +3 at 17th)" ladder. Different carrier, same reading —
   * not an over-application on their part.
   *
   * The AC half rides on the same reading and appeared only once this comparer was taught AC_BONUS
   * (batch 11): their select flattens every practice option's operations onto the selector row, so the
   * Seer option's scaling AC bonus reads as the selector's. Our entry carries the ac target beside the
   * saves, with the same ladder and the same condition. ⚠ Extended IN PLACE — a second
   * 'animistic-practice' key later in this object would win and silently drop the three save settles.
   */
  /*
   * RESTORED after the removal marker that replaced it — the removal reason ("the Medium's Dual
   * Invocation now raises the focus pool from 9th") was about the FOCUS divergence, which lives in
   * wg-diff's kinds registry; it was never a reason these four VALUE rows would stop reporting, and
   * dropping the whole key lost them as collateral. Their Seer op is not bare either: it sits inside
   * `conditional IF LEVEL >= 9 AND FEAT_NAMES NOT_INCLUDES "circle of spirits"` — their level gate
   * matches Dual Invocation's 9th and their non-stacking guard mirrors our focusSeen branch — and
   * theirAssertions keeps only the last write, so 'theirs=3' is the TOP of the ladder, not a flat
   * grant. Ours holds the identical ladder and condition as situationalBonuses['seer'], read by
   * featSituationalLines (explain.ts — the AC row and the save rows). Print (practice-3) agrees with
   * WG at every tier; nothing adopted, nothing escalated. ⚠ FOUR keys — a stale-settle sweep must
   * remove single BUCKETS, never this whole entry, or the other three re-open (the exact collateral
   * scripts/drop-fixed-settles.mjs caused here).
   * ⚠ Reproduction: wg-values defaults --ids to batch 3, so a bare run shows no animistic-practice
   * row at all. Use `node scripts/wg-values.mjs --ids animistic-practice` (--raw bypasses the settle).
   */
  'animistic-practice': ['save|fortitude', 'save|reflex', 'save|will', 'ac|'],

  /*
   * Their row carries the SAME ladder we do: SKILL_LORE_ESPIONAGE is created at trained and then
   * raised to expert, master and legendary inside three separate LEVEL >= 3 / 7 / 15 conditionals.
   * It reads as a flat `legendary` only because the differ flattens conditional branches before
   * comparing; ours reaches the same ranks through featGrantsAuto's `rankUpgrade` on the granted
   * Additional Lore (featFeatGrants binds it to Espionage). Nothing to adopt — the two sides agree.
   */
  'lion-blade-dedication': ['skill|lore:espionage'],
  /*
   * *"If you have legendary proficiency in Nature, you gain expert proficiency in Wild Mimic Lore…"*
   * Their row is not flat — it creates the Lore at trained and puts the expert inside a conditional
   * on SKILL_NATURE >= legendary, exactly as printed; the differ only flattens it. Ours holds the
   * printed trained floor (featGrantsAuto) and does not model the legendary-Nature upgrade, so their
   * value must not be adopted as the flat `expert` the comparison prints.
   */
  'wild-mimic-dedication': ['skill|lore:wild-mimic'],
  /* loremaster-dedication's skill row was settled on a comment that ended "so the value row should not
   * be settled" — and the upgrade it called unbuilt has since been built: `featGrantsAuto.ts` carries
   * `crossConditionalSkills['lore:loremaster'] = { whenSkill: ['arcana','occultism','religion',
   * 'society'], whenRank: 'legendary', rank: 'expert' }`, which is the printed *"If you have legendary
   * proficiency in a skill used to Decipher Writing…"* clause. The entry is gone; the row matches on
   * its own merits. */
  /* *"You also become trained in PATHFINDER Lore, or an expert if you were already trained."* The book
   * names Pathfinder Lore; their key says lore:pathfinder-society. Ours holds the conditional under the
   * printed name (featGrantsAuto `conditionalSkills['lore:pathfinder']`). A key-name mismatch. */
  'pathfinder-agent-dedication': ['skill|lore:pathfinder-society'],
  /* Neither dedication prints a Hit Point. Their `+3 hp` op is wrapped in a conditional gated on the
   * RESILIENCY feat — it is Monk/Exemplar Resiliency's HP parked on the dedication by their engine, and
   * we hold it where it is printed: `feats['monk-resiliency']` / `feats['exemplar-resiliency']`
   * `.maxHpBonus = { perArchetypeFeat: 3 }`. */
  'monk-dedication': ['hp|'],
  'exemplar-dedication': ['hp|'],
  /*
   * *"Your proficiency rank in Perception and your eidolon's … increase to expert"* — a level-3
   * summoner feature, held as the level-gated advancement row (advancement.ts, summoner: level 3,
   * track perception, source 'shared-vigilance'). Their `adjValue PERCEPTION → E` carries no level
   * of its own, but it sits on a class-feature row that IS `level: 3` and carries the Summoner class
   * trait, which is how their engine gates class features — so the difference is only WHERE the
   * level is recorded, not whether one exists.
   */
  'shared-vigilance': ['perception|'],
  /*
   * Their row asserts four WEAPON_FAMILIARITY members — bayonet, reinforced stock, martial firearms
   * and martial combination weapons — and only 'martial combination weapons' fails to match ours. We
   * express that one as the `combination` TRAIT narrowed to the martial category (featGrantsLane
   * weaponFamiliarity, third entry); same weapons, one named by list and one by rule.
   */
  'bullet-dancer-dedication': ['set|weapons'],
  /*
   * MERCHANT'S SCALE — owner ruling, 2026-08-19: do not adopt their +1. Both mirror docs
   * (equipment-2734, equipment-34) are stat-block stubs (`text` ends at `Bulk L ---`, `skill_mod`
   * `{}`), and their seven `addBonusToValue` ops each carry the Recall-Knowledge condition in their
   * own text, but that sentence exists only in their GPL-3.0 dump, which is a differ and never a
   * source. work/wg-lane-backlog.md records the same no-copy rule while explicitly calling the empty
   * description a still-open gap needing the physical Player Core pg. 290 — so this settle closes
   * the +1, not the description.
   */
  'merchants-scale': ['skill|arcana', 'skill|crafting', 'skill|medicine', 'skill|nature', 'skill|occultism', 'skill|religion', 'skill|society'],
  /*
   * Their paired row is the REMASTER record "Tripkee Weapon Familiarity", and its operations name
   * exactly the five weapons we ship — *"the blowgun, dart, hatchet, scythe, and shortbow"* — plus
   * BOTH the Tripkee trait and the legacy Grippli trait. The one unmatched member is that legacy
   * Grippli trait, which the owner's no-reprinted-legacy rule keeps out. (Their separate "Grippli
   * Weapon Familiarity (legacy)" row is the one carrying the composite shortbow; it is never paired
   * with this record.)
   */
  'tripkee-weapon-familiarity': ['set|weapons'],

  /* ---------------------------------------------------------------- batch 010 */

  /*
   * Their swim 25 / climb 25 / fly 10 are unconditional constants; neither half of that is the rule.
   * Printed: the terrain benefits arrive only with `unimpeded journey` (ranger 11th) and only *"while
   * you are in your favored terrain"*, and the speed is *"equal to your Speed"* — not a frozen 25,
   * which is merely a ranger's default land Speed. Ours ships the printed nine-terrain `choice` plus
   * five `situational` speed clauses, which is what types.ts says conditional effects use; folding
   * them into a number would hand every ranger a permanent swim Speed from 1st level.
   */
  'favored-terrain': ['speed|swim', 'speed|climb', 'speed|fly'],
  /*
   * Their row is one werecreature type's numbers plus four zero sentinels. 30 is the wereboar/werewolf
   * land Speed alone — five of the nine types print 25, the werebat 10 — and PF2e has no 0-foot fly or
   * swim, so the zeros are "absent", not a value (a literal 0 fly would contradict the werebat row on
   * the same page). Ours is the printed nine-row table as per-shape battle forms, which REPLACE speeds
   * rather than adding to them; this comparer reads record fields and cannot see a mode.
   */
  'werecreature-dedication': ['speed|land', 'speed|fly', 'speed|climb', 'speed|burrow', 'speed|swim'],
  /*
   * Their `legendary` is the Additional Lore ladder inlined onto the dedication row. The printed
   * dedication states no rank at all — it trains you in Warfare Lore; the 3rd/7th/15th ladder belongs
   * to Additional Lore, which this archetype binds to that Lore. Ours is the trained floor plus that
   * bound grant, whose `rankUpgrade` reaches legendary at 15. Same shape as blackjacket-,
   * aldori-duelist- and war-mage-dedication, all already settled here.
   */
  'ulfen-guard-dedication': ['skill|lore:warfare'],
  /* Identical shape with Politics Lore: the dedication states no rank, and the 3rd/7th/15th ladder
   * belongs to the Additional Lore feat it binds to that Lore. Ours is the trained floor plus that
   * bound grant, whose `rankUpgrade` reaches legendary at 15. */
  'eagle-knight-dedication': ['skill|lore:politics'],
  /*
   * Every value on their row is an implement INITIATE BENEFIT (the Regalia's saves, the Lantern's
   * Perception), and the printed dedication says you gain the implement but explicitly NOT its
   * initiate benefit. Ours carries those numbers on the implement records, where the benefit is.
   */
  'thaumaturge-dedication': ['perception|', 'skill|deception', 'skill|diplomacy', 'skill|intimidation', 'save|fortitude', 'save|reflex', 'save|will'],
  /*
   * *"Your proficiency rank for Will saves increases to expert"* is a proficiency bump, and those live
   * in `CLASS_ADVANCEMENT` — the fighter's table carries it at level 3 attributed to this very feature,
   * because that is the one place a rank may be raised. What this comparer sees on our record is the
   * degree-shift clause, which is a different sentence of the same feat. Precedent: 'shared-vigilance'.
   */
  'bravery': ['save|will'],

  /* ---------------------------------------------------------------- batch 011 */
  /* Same record and same reason as the KINDS settle in wg-diff.mjs: the Will expert rank is the
   * level-gated advancement row (advancement.ts:435 — gunslinger, level 3, source 'stubborn'), because
   * CLASS_ADVANCEMENT is the one place a proficiency rank may be raised. Their `adjValue` asserts the
   * bare scalar "E", so this comparer reports it as a missing number. Precedent: 'bravery'. */
  'stubborn': ['save|will'],
  /* *"Your proficiency rank for Will saves increases to expert"* is likewise the advancement row
   * (advancement.ts:222 — necromancer, level 3, source 'mental-wards'). What this comparer sees on our
   * record is the `degreeShifts` clause — the OTHER sentence of the same feature, which we structure
   * and they leave as free text. Precedent: 'bravery'. */
  'mental-wards': ['save|will'],
  /* Their +3 is Exemplar Resiliency's HP parked on this feat by their engine (see the KINDS settle in
   * wg-diff.mjs). Printed Basic Glory grants no Hit Points — its whole text is "You gain a 1st- or
   * 2nd-level exemplar feat." Ours sit once, on the feat that prints them, and count basic-glory among
   * the archetype feats they multiply. ⚠ The trailing pipe is required: the hp track has an empty
   * detail. Precedent: 'exemplar-dedication', 'monk-dedication', 'barbarian-dedication'. */
  'basic-glory': ['hp|'],
  /* Printed: *"You gain resistance 2 to precision damage."* Ours is exactly that — the Armor branch
   * grants `{ type: 'precision', value: 2 }`. Their set member is the AMOUNT ("2") where ours is the
   * damage TYPE, so the two sets can never intersect however correct both are. A shape difference in
   * their parse, not a difference in the rule. */
  'clay-sphere': ['set|resistances'],

  /*
   * ---- BATCH 22 ----------------------------------------------------------------------------------
   *
   * The AON- TWIN of Post Guard of All Trades ("…of All Trade", note the missing s — the name gap is
   * why wgOwnsComparison's shadow rule does not defer it). The printed +1 circumstance to
   * Deception/Diplomacy/Intimidation with Post Guards is carried as FEAT_SITUATIONAL stars on the
   * VISIBLE record ('post-guard-of-all-trades'), which is the only one the app offers — the twin is
   * dedupe-hidden and the triage-lane guard forbids filing stars on records no character can own.
   */
  'aon-post-guard-of-all-trade': ['skill|deception', 'skill|diplomacy', 'skill|intimidation'],
};

/* ---------------------------------------------------------------- compare */
const batchRows = arg('--ids') ? String(arg('--ids')).split(',').map((s) => ({ id: s.trim() })).filter((r) => r.id)
  : Object.values(JSON.parse(readFileSync(join(ROOT, arg('--batch', 'work/wg-batch-003.json')), 'utf8')));
const ids = batchRows.map((r) => r.id);
/* The bucket each id was CUT from — 'warrior' is a background AND a class feature, and resolving the
 * bare id examined the wrong one while the batch's record reached no comparer (batch 23). */
const bucketHintOf = new Map(batchRows.map((r) => [r.id, r.bucket]));

/*
 * THEIR ROWS, PER BUCKET — see `WG_PAIRING`. This was `if (r.type !== 'feat') continue`, so a class
 * feature, item, heritage, background, ancestry or class was compared against nothing at all and the
 * silence read as agreement. Type-gated rather than name-only, because 266 normalised names exist in two
 * of our buckets and matching by name alone pairs our WEAPON `clan-pistol` with their FEAT of that name.
 */
const theirByBucket = wgRowsByBucket(sql);
const theirRowFor = (bucket, name) => {
  const row = theirByBucket[bucket]?.get(norm(name));
  return row ? { row, n: parseOps(row.operations).flatMap((o) => flattenOps(o)).length } : undefined;
};

let compared = 0, clean = 0;
const conflicts = [];
/*
 * NO SILENT CAPS. A record their side flags as numeric but whose operations assert no comparable value
 * — a prose-only `addBonusToValue`, or a variable with no counterpart in VAR — is NOT verified by this
 * script. Counting it as agreement would be the "reports coverage it does not have" failure the differ
 * has already been bitten by twice, so it is listed separately and by reason.
 */
const uncomparable = [];
for (const id of ids) {
  /* ANY bucket, not just feats. Resolving with `core.feats?.[id]` meant every class feature, item,
   * heritage and background in every batch was skipped in silence — 156 of the 786 records worked in
   * batches 1-8. See wgRecord's own note. */
  const { rec, bucket } = wgRecord(core, id, bucketHintOf.get(id));
  if (!rec?.name) continue;
  /* See wgOwnsComparison: an action defers to a same-named class feature or feat. */
  if (!wgOwnsComparison(core, bucket, id)) continue;
  const t = theirRowFor(bucket, rec.name);
  if (!t) continue;
  const theirs = theirAssertions(t.row);
  /* SET comparison first — a familiarity or resistance list asserts membership, not a number. */
  const theirSets = theirs.__sets ?? new Map();
  const setRows = [];
  if (theirSets.size) {
    const mine = ourSets(rec, id);
    for (const [key, want] of theirSets) {
      const have = mine.get(key) ?? new Set();
      /*
       * Word-SUBSET, not exact. Their trait table carries both a modern and a LEGACY row for the same
       * trait, so a familiarity list can name "tengu (legacy)" where ours says "tengu" — the same
       * trait, two labels. Compared exactly, every trait-carrying familiarity feat reads as a gap.
       */
      /* A weapon GROUP is plural on their side and singular on ours ("firearms" vs "firearm"), so the
       * word sets are compared with a trailing s stripped. Not a per-record exemption: it is how the
       * two vocabularies spell every group. */
      const singular = (w) => w.replace(/s$/, '');
      const words = (s) => new Set(String(s).split(/[^a-z0-9]+/).filter(Boolean).map(singular));
      const covered = (m) => {
        if (have.has(m)) return true;
        const w = words(m);
        for (const mine of have) {
          const o = words(mine);
          if (o.size && ([...o].every((x) => w.has(x)) || [...w].every((x) => o.has(x)))) return true;
        }
        return false;
      };
      const missing = [...want].filter((m) => !covered(m));
      const extra = [...have].filter((m) => !want.has(m));
      /* EXTRA is not reported as a defect: the owner's rule reserves option-filtering to us, and ours is
       * legitimately richer in places (Foxfire's third damage type, which their encoding omits). */
      if (missing.length) setRows.push({ key, missing, have: [...have] });
      void extra;
    }
  }
  if (!theirs.size && !theirSets.size) {
    /* Why: did they assert nothing numeric at all, or nothing this script can read? */
    const vars = new Set();
    for (const op of parseOps(t.row.operations).flatMap((o) => flattenOps(o))) {
      if (['adjValue', 'setValue', 'addBonusToValue'].includes(op?.type)) vars.add(String(op.data?.variable ?? '?'));
    }
    const unmapped = [...vars].filter((v) => !varSpec(v));
    /*
     * Split the skips into "not a number we hold" (an adjudicated decision, see NOT_A_SCALAR) and
     * "nobody has taught this variable yet" (real work). Lumping them together printed six batch-007
     * records under "no VAR mapping" — which reads as an unknown, and each one had in fact been read
     * and verified through another lane.
     */
    const settled = unmapped.filter((v) => NOT_A_SCALAR[v]);
    const untaught = unmapped.filter((v) => !NOT_A_SCALAR[v]);
    const reason = untaught.length
      ? `NO VAR MAPPING — nobody has taught this yet: ${untaught.join(', ')}`
      : settled.length
        ? `not a scalar we hold: ${settled.map((v) => `${v} (${NOT_A_SCALAR[v]})`).join('; ')}`
        : 'prose-only bonus (no number asserted)';
    uncomparable.push({ id, reason });
    continue;
  }
  compared++;
  const ours = ourAssertions(id, rec);
  const rowsOut = [];
  for (const [key, tv] of theirs) {
    if (!RAW_SETTLES && (SETTLED_VALUES[id] ?? []).includes(key)) continue;   // read and settled — see above
    const [track] = key.split('|');
    const candidates = [
      ...(ours.get(key) ?? []),
      ...(ours.get(key.replace(/^skill\|/, 'choice-skill|')) ?? []),
      /* …and the whole-track conditional, when one is present. */
      ...(ours.__wildcards?.has(track) ? [...(ours.get(`${track}|`) ?? []), ...(ours.get(`${track}|all`) ?? [])] : []),
    ];
    if (!candidates.length) rowsOut.push({ key, tv, ov: '(nothing)', kind: 'MISSING' });
    else if (!candidates.some((v) => String(v) === String(tv))) {
      rowsOut.push({ key, tv, ov: candidates.join(' / '), kind: 'DIFFERENT' });
    }
  }
  for (const s of setRows) {
    if (!RAW_SETTLES && (SETTLED_VALUES[id] ?? []).includes(`set|${s.key}`)) continue;   // read and settled — see above
    rowsOut.push({ key: `set|${s.key}`, tv: s.missing.join(','), ov: s.have.join(',') || '(nothing)', kind: 'SET-GAP' });
  }
  if (!rowsOut.length) { clean++; if (VERBOSE) console.log(`ok    ${id}  (${theirs.size} values, ${theirSets.size} sets agree)`); continue; }
  conflicts.push({ id, name: rec.name, rowsOut, theirs, ours });
}

console.log(`compared ${compared} records with at least one comparable value; ${clean} agree on every one\n`);
for (const c of conflicts) {
  console.log(`--- ${c.id}  (${c.name})`);
  for (const r of c.rowsOut) {
    console.log(`      ${r.kind.padEnd(9)} ${r.key.padEnd(26)} theirs=${String(r.tv).padEnd(12)} ours=${r.ov}`);
  }
  if (VERBOSE) console.log(`      ours(all): ${[...c.ours].map(([k, v]) => `${k}=${v}`).join('  ') || '(none)'}`);
}
console.log(`\n${conflicts.length} records with at least one value to adjudicate.`);
if (uncomparable.length) {
  console.log(`\n⚠ ${uncomparable.length} records NOT value-checked by this script (not the same as "agree"):`);
  const byReason = new Map();
  for (const u of uncomparable) {
    if (!byReason.has(u.reason)) byReason.set(u.reason, []);
    byReason.get(u.reason).push(u.id);
  }
  for (const [reason, list] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${String(list.length).padStart(3)}  ${reason}`);
    if (VERBOSE) console.log(`        ${list.join(', ')}`);
  }
}
