/**
 * WANDERER'S GUIDE, USED AS A DIFFER.
 *
 * Wanderer's Guide (GPL-3.0) encodes the same game we do, with a different vocabulary: 16 generic
 * operation verbs carrying a variable NAME in a string, against our ~190 named typed fields. Where
 * the two disagree about a feat, one of us is wrong, and that disagreement is a work list nobody had
 * to read 6,000 feats to produce.
 *
 * ⚠ THIS READS THEIR DATA. IT NEVER COPIES IT. Their encodings are their copyrighted work under
 * GPL-3.0 and this app ships proprietary; `work/wg/` is gitignored for that reason. The output here
 * is a list of RECORDS TO LOOK AT — the fix for each is then authored from the printed rules text,
 * which is Paizo's under the ORC licence and already our source.
 *
 * FOUR BUCKETS, and only the first two are work:
 *
 *   THEY-ONLY   they encode a mechanic on this feat and we encode nothing of that kind.
 *               The high-value bucket: a rule we silently do not apply.
 *   DISAGREE    we both encode the same kind of mechanic and the VALUES differ.
 *               Cheap to adjudicate — one line of printed text settles it.
 *   WE-ONLY     we encode something they do not. Expected to be large and mostly NOT a defect:
 *               759 of their 3,936 encoded feats (19.3%) fall back to prose, and their vocabulary
 *               has no degree-of-success operation at all, so 140 of our feats have no counterpart
 *               they could express. Reported, never actioned blindly.
 *   AGREE       both encode the same kind, values compatible. The denominator.
 *
 * ⚠ KIND, NOT VALUE, DECIDES THE BUCKET. A first draft compared raw JSON and called every feat a
 * disagreement, because `{"trainedSkill":"stealth"}` and `adjValue(SKILL_STEALTH,"T")` share no
 * bytes. The comparison has to happen in a shared vocabulary or it measures the vocabularies, not
 * the content. That vocabulary is KIND_OF below.
 *
 *   node scripts/wg-diff.mjs                 # the counts
 *   node scripts/wg-diff.mjs --bucket they-only --list
 *   node scripts/wg-diff.mjs --out work/wg-diff.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, wgAllRecords, wgRowsByBucket, wgOwnsComparison, WG_PAIRING } from './lib/wg-parse.mjs';

/* `--raw` bypasses the settle registries so `wg-settle-stale.mjs` can see which of them still
 * answer a real difference. A settle that matches nothing is a trap: it will silence the NEXT
 * difference of that kind on that record, unread. */
const RAW_SETTLES = process.argv.includes('--raw');


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) {
  console.error(`No Wanderer's Guide dump at work/wg/wg-data.sql.\nIt is gitignored on purpose — see the header of this file.`);
  process.exit(2);
}

/* ---------------------------------------------------------------- their side */
/* The dump escapes TWICE: pg_dump writes a TSV (backslash -> \\), and inside that sits a Postgres
 * json[] literal {"<json>","<json>"} whose elements are double-quoted with \" inside. Undo the TSV
 * escape first; the array is then literally a JSON array once { } become [ ]. Two earlier parsers
 * that undid only one layer silently returned zero operations for every row. */
const sql = readFileSync(DUMP, 'utf8');
const head = /^COPY public\.ability_block \(([^)]*)\) FROM stdin;$/m.exec(sql);
const cols = head[1].split(',').map((s) => s.trim().replace(/"/g, ''));
const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
const bodyStart = head.index + head[0].length + 1;
const rows = sql.slice(bodyStart, sql.indexOf('\n\\.\n', bodyStart)).split('\n').filter(Boolean).map((l) => l.split('\t'));

const untsv = (s) => s.replace(/\\\\/g, '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(//g, '\\');
function parseOps(raw) {
  if (!raw || raw === '\\N' || raw.length < 5) return [];
  const s = untsv(raw).trim();
  if (!s.startsWith('{')) return [];
  let arr;
  try { arr = JSON.parse('[' + s.slice(1, -1) + ']'); } catch { return []; }
  return arr.map((e) => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; } }).filter(Boolean);
}
/** Their operations nest — conditional carries true/false branches, select carries per-option ops. */
const flatten = (op, out = [], inOption = false) => {
  /* `__inOption` marks an op that lives inside a select's OWN option. It is not part of their data —
   * it is added here so `kindOfTheirOp` can tell "this is what the option does" from "this record is
   * writing down WHICH option you picked". See the SELECT-ANSWER BOOKKEEPING note in the mapper. */
  out.push(inOption ? Object.assign(Object.create(Object.getPrototypeOf(op)), op, { __inOption: true }) : op);
  const d = op.data ?? {};
  for (const k of ['operations', 'trueOperations', 'falseOperations']) for (const c of d[k] ?? []) flatten(c, out, inOption);
  for (const o of d.optionsPredefined ?? []) for (const c of o.operations ?? []) flatten(c, out, true);
  return out;
};

/*
 * THEIR UNARMED ATTACKS ARE ITEMS. Ours are `grantedStrikes` on the record.
 *
 * Seedpod is the plain case: their feat row carries one `giveItem`, and item 9279 "Seedpod" is a
 * WEAPON-group item with the Unarmed trait. Ours is a `grantedStrikes` entry with the same die,
 * damage type, group and range. Same mechanic; only the vocabulary differs — so mapping every
 * `giveItem` to `grantsItem` reported six batch-3 records as gaps when all six were already built.
 *
 * Not a special case for six records: MEASURED across the whole dump, 236 of the 339 `giveItem`
 * operations point at an item carrying the Unarmed trait (id 2398). Seven in ten.
 *
 * The other 103 are real items — Spellbook (Blank), Solar Weapon, Tengu Feather Fan — and still map
 * to `grantsItem`, which is what `grantsItems` on our side holds.
 */
/*
 * AND THEIR SENSES AND MODES ARE RECORDS TOO.
 *
 * `ability_block` holds six types, and `giveAbilityBlock` mapped all of them to `grantsRecord`. But
 * a sense is our `senses` field and a mode is our `modes` registry — neither is a granted record.
 * MEASURED over the dump: of 1,552 giveAbilityBlock operations, 226 target a `sense` (Darkvision,
 * Low-Light Vision) and 38 a `mode` (Rage, Panache, Arcane Cascade — our modes, by name).
 *
 * `physical-feature` (35) stays `grantsRecord`: Fangs, Prehensile Tail, Light Blindness and Change
 * Shape are ancestry features, and ours are records too.
 */
const BLOCK_TYPE_KIND = { sense: 'sense', mode: 'conditional' };
/* Physical-feature blocks compared by CONTENTS — see the giveAbilityBlock case. Lazily filled and
 * cycle-guarded (a block's ops could in principle grant a block). */
const physicalFeatureKindsById = new Map();
let abilityBlockRowsById = null;
const physicalFeatureKinds = (bid) => {
  if (physicalFeatureKindsById.has(bid)) return physicalFeatureKindsById.get(bid);
  physicalFeatureKindsById.set(bid, []); // cycle guard while computing
  abilityBlockRowsById ??= new Map(parseCopyBlock(sql, 'ability_block').rows.map((b) => [String(b.id), b]));
  const row = abilityBlockRowsById.get(bid);
  const ops = row?.operations ? parseOps(row.operations).flatMap((o) => flatten(o)) : [];
  const kinds = [...new Set(ops.flatMap((o) => { const k = kindOfTheirOp(o); return Array.isArray(k) ? k : k ? [k] : []; }))];
  physicalFeatureKindsById.set(bid, kinds);
  return kinds;
};
const blockTypeById = new Map();
{
  const bhead = /^COPY public\.ability_block \(([^)]*)\) FROM stdin;$/m.exec(sql);
  const bcols = bhead[1].split(',').map((s) => s.trim().replace(/"/g, ''));
  const bId = bcols.indexOf('id');
  const bType = bcols.indexOf('type');
  const bStart = bhead.index + bhead[0].length + 1;
  for (const line of sql.slice(bStart, sql.indexOf('\n\\.\n', bStart)).split('\n')) {
    if (!/^\d+\t/.test(line)) continue;
    const f = line.split('\t');
    if (f.length > Math.max(bId, bType)) blockTypeById.set(String(f[bId]), f[bType]);
  }
}

const UNARMED_TRAIT_ID = '2398';
const unarmedItemIds = new Set();
{
  const ihead = /^COPY public\.item \(([^)]*)\) FROM stdin;$/m.exec(sql);
  if (ihead) {
    const icols = ihead[1].split(',').map((s) => s.trim().replace(/"/g, ''));
    const iId = icols.indexOf('id');
    const iTraits = icols.indexOf('traits');
    const iStart = ihead.index + ihead[0].length + 1;
    for (const line of sql.slice(iStart, sql.indexOf('\n\\.\n', iStart)).split('\n')) {
      if (!line) continue;
      const f = line.split('\t');
      if (f.length <= Math.max(iId, iTraits)) continue;
      const traits = String(f[iTraits] ?? '').replace(/[{}]/g, '').split(',');
      if (traits.includes(UNARMED_TRAIT_ID)) unarmedItemIds.add(String(f[iId]));
    }
  }
}

/* ---------------------------------------------------------------- the shared vocabulary */
/**
 * KIND is the currency both sides are converted into. Deliberately COARSE: the question this script
 * answers is "does the other side model this KIND of thing at all", and a finer vocabulary would
 * report every difference of style as a difference of substance.
 */
const kindOfTheirOp = (op) => {
  const v = String(op.data?.variable ?? '');
  switch (op.type) {
    case 'adjValue':
    case 'setValue':
    case 'addBonusToValue': {
      if (/^SKILL_|^LORE_/.test(v)) return 'skill';
      if (/^SAVE_/.test(v)) return 'save';
      if (/^PERCEPTION/.test(v)) return 'perception';
      if (/^AC|ARMOR/.test(v)) return 'ac';
      if (/^SPEED/.test(v)) return 'speed';
      if (/^RESIST|^IMMUNITIES|^WEAKNESS/.test(v)) return 'defense';
      if (/^MAX_HEALTH|^HEALTH/.test(v)) return 'hp';
      if (/^SPELL_ATTACK|^SPELL_DC|^CASTING/.test(v)) return 'spellcasting';
      if (/^ATTRIBUTE_|^ATTR_/.test(v)) return 'attribute';
      /*
       * ⚠ ATTACK is deliberately NOT anchored. `^ATTACK` missed MELEE_ATTACK_DAMAGE_BONUS and
       * RANGED_ATTACK_ROLLS_BONUS, which fell through to the old default and mapped to no field —
       * reported as understood, silently unreachable.
       */
      if (/WEAPON|ATTACK|^UNARMED/.test(v)) return 'weapon';
      if (/^SENSE|VISION|DARKVISION/.test(v)) return 'sense';
      if (/^SIZE/.test(v)) return 'size';
      if (/^CLASS_DC/.test(v)) return 'classDc';
      if (/^FOCUS_POINT/.test(v)) return 'focus';
      if (/^BULK_LIMIT|^IMPLANT_LIMIT/.test(v)) return 'carry';
      if (/^LANGUAGE|MULTILINGUAL/.test(v)) return 'language';
      /* Their ancestry rows write the printed "Choose from …" additional-language pool as
       * CORE_LANGUAGES (58 ops, found teaching batch 19). Ours is `languages.options` on the
       * ancestry, surfaced list-first by the LanguageEditor. */
      if (/^CORE_LANGUAGES/.test(v)) return 'language';
      /* AWAKENED_ANIMAL_HERITAGE is their engine writing down which heritage was picked so later
       * conditionals can read it back — select-answer bookkeeping, the CHAMPION_MERCIES class. */
      if (/^AWAKENED_ANIMAL_HERITAGE/.test(v)) return null;
      if (/^PRIMARY_SHEET_TABS|^PAGE_/.test(v)) return null; // pure UI plumbing, not a game rule
      /*
       * Which options a picker OFFERS is the one thing the owner reserved for us: "the only place where
       * we have the last word is filtering the options when giving a user selection menu." Their
       * blacklist verbs are therefore not a disagreement to act on.
       */
      if (/^BLACKLIST_|^WHITELIST_/.test(v)) return null;
      /* …and a _FEAT_COUNT. Their engine keeps a running tally of how many feats of an archetype the
       * character holds so its conditionals can read it; it is plumbing, not a rule any record states,
       * and our equivalent is computed at read time. Quoting one as a gap would be quoting their
       * bookkeeping back at them. */
      if (/_FEAT_COUNT$/.test(v)) return null;
      /*
       * SELECT-ANSWER BOOKKEEPING. Their Mercy declares `CHAMPION_MERCIES` and each of its three
       * options writes its own name into that list — `adjValue CHAMPION_MERCIES value="body"`. That is
       * not a mechanic; it is their engine writing down which option the player chose so later
       * conditionals can read it. Ours records the same answer as the choice itself, under the choice's
       * flag, which is why `select` already maps to `choice` and matches.
       *
       * Deliberately narrow, because a bespoke statistic is ALSO created and then adjusted, and those
       * adjustments are real numbers we must not hide. Both must hold:
       *   · the write sits inside the select's own option (`__inOption`, set by `flatten`), and
       *   · the value written is a NON-NUMERIC string — an option name, not an amount.
       * A numeric adjustment inside an option (a resistance value, a bonus) still reports.
       */
      if (op.__inOption && typeof op.data?.value === 'string' && op.data.value !== '' && !Number.isFinite(Number(op.data.value))) return null;
      /*
       * ⚠ THE FALLBACK IS NAMED, NOT SILENT. It used to be `'value'` — which is not a key in OUR_KINDS,
       * so 642 operations across 41 variables were counted as translated and then mapped to nothing.
       * A differ that reports coverage it does not have is worse than one that reports a gap.
       * Anything reaching here has no field on our side; scripts/wg-vocabulary.mjs lists them by
       * frequency, and work/wg-lane-backlog.md is where they go until a lane exists.
       */
      return 'unmapped';
    }
    case 'conditional': return 'conditional';
    case 'giveSpell': return 'spell';
    case 'giveSpellSlot': return 'spellSlot';
    case 'defineCastingSource': return 'spellcasting';
    case 'select': return 'choice';
    case 'giveAbilityBlock': {
      const bid = String(op.data?.abilityBlockId);
      /* A PHYSICAL-FEATURE block is a CONTAINER, not a record either side ships: their ancestry rows
       * hand out "Clan Dagger" or "Blunt Snout" as a block whose OWN operations carry the mechanics
       * (48 of 110 do; the other 62 are prose-only). Naming the container `grantsRecord` made every
       * such ancestry report a permanent style gap — ours models the CONTENTS (grantsItems,
       * degreeShifts, stars…). So the block is compared by its contents, exactly as a `conditional`
       * is; an op-less block asserts nothing mechanical on their side either. */
      if (blockTypeById.get(bid) === 'physical-feature') return physicalFeatureKinds(bid);
      return BLOCK_TYPE_KIND[blockTypeById.get(bid)] ?? 'grantsRecord';
    }
    /* An unarmed attack is a `grantedStrikes` entry on our side, not an inventory item. */
    case 'giveItem': return unarmedItemIds.has(String(op.data?.itemId)) ? 'weapon' : 'grantsItem';
    case 'giveTrait': return 'trait';
    case 'giveLanguage': return 'language';
    /* `createValue` makes a NEW variable — usually a bespoke statistic, but their Lores are created
     * this way too (`createValue SKILL_LORE_AXIS`). A Lore is a skill on our side, held in the same
     * `skills` map as any other, so three of batch 3's rows reported a missing `specialStat` for a
     * `lore:axis` we already train. */
    case 'createValue': return /^SKILL_|^LORE_/.test(v) ? 'skill' : 'specialStat';
    case 'bindValue': return 'modifiesGrant';
    case 'injectText': return 'note';
    case 'injectSelectOption': return 'choice';
    default: return 'value';
  }
};

/** Our fields, in the same currency. A field may answer more than one kind (passiveEffects). */
const OUR_KINDS = {
  /* `skillProgression` is a skill grant that arrives on a schedule — the necromancer's Undead Lore and
   * the thaumaturge's Esoteric Lore climb to expert/master/legendary at 3/7/15 on their own, with no
   * skill increase spent. `skillAbilitySwap` is the other half of the same clause (Esoteric Lore runs
   * off Charisma), and is a skill fact too. */
  /*
   * ⚠ A CLASS AND A BACKGROUND STATE THEIR CHASSIS ON THEMSELVES, and none of those fields were listed.
   *
   * Batch 1 is the only batch cut before the level ordering, so it is the only one holding classes and
   * backgrounds — and every one of them reported gaps it did not have. The Alchemist read as modelling
   * no attribute, save, skill, weapon or AC while its own record carries `keyAbility`, `saves`,
   * `trainedSkills`, `attacks` and `defenses`; nine backgrounds read as offering no choice while every
   * one of them offers an ability-boost choice and most a skill choice too. Fourteen false gaps from
   * one blind spot, which is the shape this project keeps finding: a gap list is a claim about a QUERY.
   */
  /* The bare 'skills' key is what a CONTAINER grant carries — `choice.options[].grant.skills` and
   * `effectChoices[].options[].grant.skills` (51 records; 18 heritages like anvil-dwarf's trained-
   * skill branch, plus oatia-skysage-dedication's expert-occultism branch). The two container walks
   * below already credit whatever fieldToKinds knows, and this key was the one they were never
   * taught — so a grant that MOVED into a container (orc-warmask) re-opened as missing=[skill].
   * Safe: within the paired buckets a top-level `skills` map exists on one record (creative-prodigy);
   * animalCompanions' `skills` ARRAYS are outside WG_PAIRING and never reach ourKinds. */
  /* `trainedLoreOptions` — a background's "one of the following Lore skills" list, the dedicated
   * named-subject lane (batch 19 retired the duplicate `choice` blocks that used to shadow it). */
  skill: ['skills', 'trainedSkill', 'trainedSkillChoice', 'trainedLore', 'trainedLoreChoice', 'trainedLoreOptions', 'trainedSkills', 'skillSubstitutions', 'skillProgression', 'skillAbilitySwap', 'passiveEffects.skills', 'passiveEffects.loreBonus'],
  save: ['passiveEffects.saves', 'saves'],
  perception: ['passiveEffects.perception', 'perception'],
  /* `unarmoredAc` is natural armour (Scales of Steel and its three peers) — an AC item bonus while
   * unarmored. Their side grants it as an ITEM, so without this the whole lane reads as missing. */
  ac: ['acBonus', 'passiveEffects.ac', 'armorAdjust', 'armorRestat', 'unarmoredAc', 'defenses'],
  /* `speedAdjust` — "reduce ALL your Speeds by 5" (Zombie Dedication), "any fly Speed you have increases
   * by 5" (Winged Warrior). Neither is a `speeds` map nor a land bonus, so both records read as
   * adjusting no speed at all on the day they were authored correctly. */
  speed: ['speeds', 'landSpeedBonus', 'landSpeedMin', 'speedPenalty', 'speedAdjust', 'passiveEffects.speedBonus', 'passiveEffects.speedPenalty', 'passiveEffects.speeds', 'speedsIf'],
  /* ⚠ The bare `weaknesses` was missing while `passiveEffects.weaknesses` was present, so a record
   * whose defensive clause is a WEAKNESS on itself read as holding no defence at all — the Werecreature
   * Dedication's *"a weakness to silver equal to half your level"* and the Mummy Dedication's fire
   * weakness are both authored, correctly, and both read as gaps. A cost the record imposes is part of
   * its defensive profile exactly as a resistance is. */
  defense: ['resistances', 'weaknesses', 'immunities', 'passiveEffects.resistances', 'passiveEffects.immunities', 'passiveEffects.weaknesses', 'removesWeaknesses', 'choiceResistance', 'resistanceLevelUpgrade'],
  hp: ['maxHpBonus', 'hp', 'hpPerLevel'],
  /* `spellcastingGrant` is THE field an archetype dedication uses to hand over a casting entry
   * ("you gain the ability to cast divine spells; your spellcasting attribute is Charisma") — 36
   * records carry it, and it was not listed, so every one read as granting no spellcasting. */
  spellcasting: ['spellcasting', 'spellcastingGrant', 'proficiencies', 'focusPoolBonus'],
  attribute: ['abilityBoosts', 'abilityFlaws', 'apexAttribute', 'keyAbility'],
  /* `unarmedTraits` was absent: Iron Fists ("your fist unarmed attacks no longer have the nonlethal
   * trait and gain the shove trait") ships exactly that, and their side expresses it by handing over a
   * pre-modified Unarmed item — so ours read as a missing weapon. */
  /* `attackItemBonus` — a weapon's OWN printed item bonus to attack (the alchemical bomb grades). */
  weapon: ['grantedStrikes', 'critSpec', 'critSpecWeapons', 'weaponFamiliarity', 'strikeRiders', 'strikeReach', 'mapReduction', 'precisionDice', 'unarmedTraits', 'attackItemBonus', 'attacks', 'attackGroups'],
  sense: ['senses', 'vision', 'conditionalSenses', 'darkvisionIfAncestryLowLight', 'passiveEffects.senses'],
  size: ['size', 'sizeOverride'],
  /* `spellListAdditions` was absent, so Tupilaq Carver's *"Add the Summon Construct spell to your
   * spell list"* — which we ship as exactly that — read as a missing `giveSpell`. Their vocabulary
   * has no verb for "add to the list" and uses `giveSpell` for both. */
  /* `resonant.innateSpells` — an aeon stone's second spell, the one it casts *"when slotted into a
   * special magical item called a wayfinder"*. It is a real granted spell held one level down, so a
   * reader that only looks at top-level fields calls 15 stones spell-less. */
  spell: ['innateSpells', 'focusSpells', 'grantedRepertoire', 'heldSpells', 'grantsRituals', 'eidolonCantrips', 'spellListAdditions', 'resonant.innateSpells'],
  /* `spellSlotBonus` is on 42 records and was not listed — an archetype's extra slot ("you gain an
   * extra spell slot at each rank") read as granting no slot at all. */
  spellSlot: ['spellSlot', 'spellSlotBonus'],
  /*
   * A SLOT is a selection, and their `select from:LANGUAGE` / `select from:CUSTOM` says so.
   * Tangle-tongue's Wit ships `languageChoices: 2` — two pickers — and read as a missing `choice`
   * because those fields were filed under `language` alone. Same for a Lore slot and a skill slot.
   */
  /* `runesKnown` is the runesmith's repertoire table — *"At 1st level, you learn four 1st-level runes
   * of your choice"* — and a table of how many you pick IS a choice, the same way `skillChoices` is. */
  /* …and the choices a BACKGROUND or ANCESTRY makes without a `choice` field: an ability boost the
   * player picks (`abilityBoosts` carries `kind: 'choice' | 'free'`) and a "trained in your choice of
   * X or Y" skill or Lore. Their side encodes each as a `select`, which is why nine backgrounds read as
   * offering no choice at all while every one of them opens a picker in the builder. */
  choice: ['choice', 'effectChoices', 'languageChoices', 'languageChoicesAtRank', 'languageChoicesBonus', 'loreChoices', 'skillChoices', 'runesKnown', 'abilityBoosts', 'trainedSkillChoice', 'trainedLoreChoice', 'trainedLoreOptions'],
  /* `derivedGrant` is how a record hands over a class feature the character ALREADY chose on another
   * record — the barbarian instinct ability, the thaumaturge implement benefit, the gunslinger way's
   * initial deed. Their side spells it as a conditional wrapping a giveAbilityBlock, so it answers both
   * kinds. */
  grantsRecord: ['grantsFeats', 'grantsClassFeatures', 'grantsActions', 'grantedFeatId', 'grantedFeatByChoice', 'grantsFeat', 'derivedGrant'],
  /* `combinationMeleeForm` is how a COMBINATION WEAPON hands over its other usage: their side ships a
   * second "(Ranged)" item row plus one `giveItem`, ours names the `-melee` record. The same mechanic —
   * and without this all 18 read as granting nothing the moment they were correctly linked. */
  grantsItem: ['grantsItems', 'combinationMeleeForm'],
  trait: ['grantsCreatureTraits', 'grantsCreatureTraitFromChoice', 'extraAncestryFeatTraits'],
  /* ⚠ `grantsLanguages` — the record NAMING a language, as opposed to offering a choice — was absent
   * here, and only its `passiveEffects` twin was listed. Angelkin's *"You know the Empyrean language"*
   * read as missing on the day it was authored. */
  language: ['languages', 'languageChoices', 'grantsLanguages', 'passiveEffects.grantsLanguages', 'languageChoicesAtRank', 'languageChoicesBonus'],
  /*
   * Their `specialStat` is almost always a `createValue` — an engine variable their side invents to
   * remember an answer or count something. Ours are named fields, and there are two of them:
   *
   *   `choice`         a recorded PICK. GUNSLINGER_DEDICATION_WAY is `choice.flag: 'gunslingerWay'`;
   *                    ARCTIC/DESERT/MOUNTAIN/SWAMP is `choice.flag: 'terrain'`;
   *                    STERLING_DYNAMO_OPERATION is `choice.flag: 'dynamo'`.
   *   `dedicationGate` a COUNTER. STONE_BRAWLER_FEAT_COUNT and MONOLITH_FEAT_COUNT are both the
   *                    printed *"you cannot select another dedication feat until you have gained two
   *                    other feats from the … archetype"* clause, which we hold as a gate rather than
   *                    as a tally the player has to read.
   */
  specialStat: ['specialStatistic', 'passiveEffects.specialStatBonus', 'choice', 'dedicationGate'],
  /* `recordMarks` annotates ANOTHER record — "on the High Jump action, DC -10" — which is precisely
   * what their `injectText type=action` does, and it was in no kind list at all. Raging Athlete
   * carries three of them and reported `modifiesGrant` missing. */
  modifiesGrant: ['modifiesGrant', 'recordMarks'],
  /* `whileActive` was read for its CONTENTS (the loop further down maps each sub-field) but never
   * counted as a condition in its own right, so a clause that only fires while a state is on scored
   * its speed/sense/resistance and still reported `conditional` missing — on a record whose entire
   * shape is "while raging". Their encoding of the same thing is literally a `conditional` op. */
  conditional: ['situational', 'modes', 'battleForm', 'enhancement', 'degreeShifts', 'conditionalSenses', 'speedsIf', 'whileActive', 'derivedGrant'],
  note: ['note', 'spellNotes'],
  /*
   * Added 2026-08-18 after scripts/wg-vocabulary.mjs measured where their generic value verbs actually
   * point. Each of these is a variable we DO have a field for; only the pattern above failed to
   * recognise their spelling, so they were reported as translated and reached nothing.
   *   CLASS_DC 106 ops   UNARMED_ATTACKS 87   FOCUS_POINT_BONUS 29   BULK_LIMIT_BONUS 16
   *   MELEE_ATTACK_DAMAGE_BONUS 14   RANGED_ATTACK_ROLLS_BONUS 6
   */
  /* `classDcGrant` — an archetype dedication training you in ANOTHER class's DC (Alchemist Dedication:
   * "you become trained in … the alchemist class DC"). Absent here, so the record read as missing it. */
  classDc: ['classDc', 'classDcBonus', 'proficiencies', 'classDcGrant'],
  focus: ['focusPoolBonus', 'focusSpells'],
  /* ⚠ The NESTED path too. `bulkLimitBonus` has two homes — top-level on a feat (Beast of Burden) and
   * `passiveEffects.bulkLimitBonus` on an item or rune (Lifting Belt, the Assisting rune) — and only the
   * first was listed, so a correctly authored ITEM read as modelling no carrying capacity at all. */
  /* …and `bulkMaxBonus`, the asymmetric one: a bonus to the MAXIMUM limit that leaves the encumbered
   * limit alone (Embodied Dreadnought Subjectivity). Adding the field without adding it here would have
   * left the record reporting no carrying capacity the moment it was correctly authored. */
  carry: ['bulkBonus', 'bulkLimitBonus', 'bulkMaxBonus', 'passiveEffects.bulkLimitBonus'],
  /* Ours with no operation on their side at all — never counted as "they lack it", because a
   * vocabulary that cannot express something has not omitted it, it simply cannot say it. */
  _noCounterpart: ['degreeShifts', 'limitedUses', 'uses', 'companions', 'dailyChoice', 'temporaryProficiency', 'redundantFallback', 'actionCost'],
};
const fieldToKinds = new Map();
for (const [kind, fields] of Object.entries(OUR_KINDS)) {
  if (kind.startsWith('_')) continue;
  for (const f of fields) fieldToKinds.set(f, [...(fieldToKinds.get(f) ?? []), kind]);
}

/* ---------------------------------------------------------------- our side */
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * ⚠ A DATA FIELD IS NOT THE ONLY PLACE A MECHANIC LIVES.
 *
 * The first version of this script read top-level fields and `passiveEffects`, and nothing else. It
 * produced 1,329 "they model this and we do not" rows, and a 26-record sample put its precision at
 * 19.2% — 19 of 26 were mechanics we DO have, sitting in an id-keyed registry under src/rules/ where
 * no field on the record shows them.
 *
 * Officer's Education was the worked example: five things Wanderer's Guide encodes, four of them
 * already ours — three skill choices in FEAT_SKILL_GRANTS and a general-feat pick in
 * FEAT_PICK_GRANTS. Only the fifth, a language, was genuinely missing. A differ that reports all
 * five wastes four fifths of whoever works the list.
 *
 * So the registries are read as first-class carriers. They are TypeScript, not data, so they are
 * scanned as text for `'<feat-id>':` — deliberately crude, because the alternative is importing
 * src/rules into a plain .mjs script and the only question being asked is "is this id present".
 *
 * ⚠ THREE WAYS THIS SCAN UNDER-REPORTED, all found by measuring batch 3 after it was worked:
 *
 *   1. A KEY NEED NOT BE QUOTED. `gildedsoul: [...]` is a valid JS identifier and the old pattern
 *      required quotes, so a record was invisible purely because of how it was typed. The whole file
 *      then looked like a gap it was not.
 *   2. ONE FILE HOLDS SEVERAL TABLES, and they do not all mean the same thing. featFeatGrants.ts
 *      carries four, of which only FEAT_RANK_FEAT_GRANTS is conditional — a per-FILE kind list has
 *      to choose between claiming `conditional` for 300 unconditional grants or for none.
 *   3. `situationalBonuses.ts` was flattened to `conditional`, but every entry NAMES its targets
 *      (`targets: [{ kind: 'perception' }]`). Their side calls a +2 to Perception a `perception`
 *      operation, so ours read as missing: eight of batch 3's forty-four rows were this one bug,
 *      including Stonemason's Eye, whose bonus has shipped since long before the batch.
 *
 *   4. TEN REGISTRY FILES WERE NOT ON THE LIST AT ALL, holding 286 feat ids between them —
 *      companionGrants.ts (112), featGrantsLane.ts (62), featCantripGrants.ts (51),
 *      casterArchetypes.ts (22) and six smaller. Counted by scanning every file in src/rules for
 *      keys that are core.json feat ids, rather than by remembering which files exist.
 *
 * All four inflate the work list with records that are already done — the exact failure the 19.2%
 * measurement above exists to prevent.
 */
const REGISTRY_KINDS = [
  ['src/rules/featGrantsAuto.ts', ['skill', 'choice']],
  ['src/rules/featGrants.ts', ['skill', 'choice', 'grantsRecord']],
  ['src/rules/featGrantsLane.ts', ['skill', 'choice', 'grantsRecord']],
  ['src/rules/featPickGrants.ts', ['choice', 'grantsRecord']],
  ['src/rules/featFeatGrants.ts', ['grantsRecord', 'choice']],
  ['src/rules/backgroundGrants.ts', ['choice', 'grantsRecord']],
  ['src/rules/modes.ts', ['conditional']],
  ['src/rules/domains.ts', ['spell']],
  ['src/rules/featUses.ts', ['value']],
  /* Added 2026-08-18 from the measurement above. Kinds are the record's own vocabulary, read from
   * each file's header and shape, not guessed from its name. */
  ['src/rules/companionGrants.ts', ['grantsRecord', 'choice']],
  ['src/rules/featCantripGrants.ts', ['spell', 'choice']],
  ['src/rules/casterArchetypes.ts', ['spellcasting', 'spell', 'spellSlot', 'choice']],
  ['src/rules/formulaBook.ts', ['grantsItem']],
  ['src/rules/counterMods.ts', ['specialStat']],
  ['src/rules/glossary.ts', ['sense']],
];

/**
 * Per-TABLE overrides, for a file whose tables do not all model the same kind. The table's slice of
 * the file wins over the file-wide entry above.
 *
 * FEAT_RANK_FEAT_GRANTS is the case that forced this: "if you're already trained in Crafting you
 * instead gain Specialty Crafting" is a grant AND a condition, and their encoding of it is literally
 * `type: 'conditional'`. Without this the two records it holds report `conditional` as missing on the
 * day the lane was built.
 */
const TABLE_KINDS = {
  FEAT_RANK_FEAT_GRANTS: ['grantsRecord', 'conditional'],
};

/** Their kind for one of our situational `targets[].kind` values. Unlisted → `conditional` only. */
const SITUATIONAL_TARGET_KINDS = {
  skill: 'skill', skills: 'skill', save: 'save', ac: 'ac', perception: 'perception',
  speed: 'speed', hp: 'hp', classDc: 'classDc', spell: 'spell', spellDamage: 'spell',
  strikeAttack: 'weapon', strikeDamage: 'weapon', attack: 'weapon', ability: 'attribute',
  initiative: 'perception', // their INITIATIVE ops resolve against Perception, as ours do
};

/**
 * classFeature id -> the class that grants it, so a chassis feature can be credited with the mechanic
 * its CLASS record carries. Built from the classes' own feature tables; first grant wins, which matters
 * only for a feature two classes share (and then either owner answers the same question).
 */
const classOfFeature = new Map();
for (const [cid, cls] of Object.entries(core.classes ?? {})) {
  for (const f of cls.features ?? []) if (!classOfFeature.has(f.featureId)) classOfFeature.set(f.featureId, cid);
}

const registryKindsById = new Map();
const addKinds = (id, kinds) => {
  const prev = registryKindsById.get(id) ?? new Set();
  for (const k of kinds) prev.add(k);
  registryKindsById.set(id, prev);
};

/* A key at the start of an entry, quoted OR bare: `'officers-education':` and `gildedsoul:` both. */
const KEY_RE = /(?:^|[\s,{])(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:/gm;

for (const [path, kinds] of REGISTRY_KINDS) {
  let text;
  try { text = readFileSync(join(ROOT, path), 'utf8'); } catch { continue; }
  /* Split into `export const NAME` blocks so a per-table override can claim its own slice. */
  const marks = [...text.matchAll(/export\s+(?:const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g)];
  const blocks = marks.length
    ? marks.map((m, i) => [m[1], text.slice(m.index, marks[i + 1]?.index ?? text.length)])
    : [[null, text]];
  for (const [table, body] of blocks) {
    const k = (table && TABLE_KINDS[table]) ?? kinds;
    for (const m of body.matchAll(KEY_RE)) addKinds(m[1] ?? m[2], k);
  }
}

/*
 * TWO REGISTRIES DO NOT NAME THEIR RECORDS AS KEYS, AND THE SCAN ABOVE READS ONLY KEYS.
 *
 * `KEY_RE` finds `'some-feat':` — an entry keyed by the record it belongs to. Both registries below
 * reach their records another way entirely, so the scan credited them with nothing and every record
 * they cover reported its whole mechanic as missing. Neither is a handful of records:
 *
 *   1. MODE CATALOGUE (src/rules/modes.ts). A catalogue mode gates by ARRAY ELEMENT —
 *      `{ id: 'cat-invoke-offense', feats: ['invoke-offense'], grantedStrikes: [...] }`. The scan saw
 *      the keys `id`, `feats`, `grantedStrikes` and never the feat id inside the array. The
 *      `core.modes` loop further down does read gates properly, but it reads the merged
 *      scripts/data/toggle-modes.json ONLY — the TypeScript catalogue is merged into content at
 *      runtime and never lands in public/core.json, so it is invisible to a core.json reader.
 *      Batch 12 surfaced this as `invoke-offense missing=[conditional,weapon]` on a feat whose
 *      d8 spirit Strike, its traits and its 5th/12th/20th striking ladder are all authored.
 *
 *   2. CASTER ARCHETYPES (src/rules/casterArchetypes.ts). The entry is keyed by the DEDICATION, and
 *      the Basic/Expert/Master feats that actually unlock the slots are MINTED by `mk()` —
 *      `basic-${slug}-spellcasting` — so those ids appear nowhere in the file as text. Every one of
 *      them read as `missing=[spellSlot]` while the ladder works on a built character. Batch 12 hit
 *      four of them at once; the corpus holds one per tier per archetype.
 *
 * Both are read here from the source text, mirroring the same rules the app uses.
 */
{
  /* 1. Mode catalogue. Entries are sequential objects in one array, each opening with `id: '…'`, so
   * slicing between consecutive `id:` matches gives one entry's body. */
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/rules/modes.ts'), 'utf8'); } catch { text = ''; }
  const marks = [...text.matchAll(/\bid:\s*'([a-z0-9][a-z0-9-]*)'/g)];
  for (const [i, m] of marks.entries()) {
    const body = text.slice(m.index, marks[i + 1]?.index ?? text.length);
    const gates = [];
    const feats = /\bfeats:\s*\[([^\]]*)\]/.exec(body);
    if (feats) for (const g of feats[1].matchAll(/'([^']+)'/g)) gates.push(g[1]);
    const fromItem = /\bfromItemId:\s*'([^']+)'/.exec(body);
    if (fromItem) gates.push(fromItem[1]);
    if (!gates.length) continue;
    /* Same kinds the core.modes loop assigns, from the same fields. */
    const k = ['conditional'];
    if (/\bgrantedStrikes:\s*\[/.test(body)) k.push('weapon');
    if (/\b(resistances|weaknesses|immunities):\s*\[/.test(body)) k.push('defense');
    if (/\bsenses:\s*\[/.test(body)) k.push('sense');
    if (/\bspeeds:\s*\{/.test(body)) k.push('speed');
    if (/\bsize:\s*'/.test(body)) k.push('size');
    /* A gate may be `<id>` or `<id>:<answer>` — the record is the part before the colon. */
    for (const g of gates) addKinds(g.split(':')[0], k);
  }
}
{
  /* 2. Caster archetypes. `mk(tradition, keyAbility, cantrips, slug)` mints the three tier ids from
   * `slug`; explicit `basicId`/`expertId`/`masterId`, the `customUnlocks[].featId` schedule and the
   * `profExpertFeat`/`profMasterFeat` advancement name theirs outright. Read all four shapes. */
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/rules/casterArchetypes.ts'), 'utf8'); } catch { text = ''; }
  const SLOT_KINDS = ['spellcasting', 'spellSlot'];
  for (const m of text.matchAll(/\bmk\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*\d+\s*,\s*'([a-z0-9-]+)'/g)) {
    for (const tier of ['basic', 'expert', 'master']) addKinds(`${tier}-${m[1]}-spellcasting`, SLOT_KINDS);
  }
  for (const m of text.matchAll(/\b(?:basicId|expertId|masterId|profExpertFeat|profMasterFeat):\s*'([a-z0-9-]+)'/g)) {
    addKinds(m[1], SLOT_KINDS);
  }
  /* A `customUnlocks` entry is MORE than a slot: `{ rank, level, featId }` says "once you hold this
   * feat, at this LEVEL you unlock a spell of this rank" — a level gate plus a pick. The Captivator's
   * three unlocks are exactly their three level-gated `select from:SPELL` ops, so crediting only
   * spellcasting/spellSlot left `choice` and `conditional` reading as missing on a feat that models
   * both. */
  for (const m of text.matchAll(/\bfeatId:\s*'([a-z0-9-]+)'/g)) {
    addKinds(m[1], [...SLOT_KINDS, 'choice', 'conditional']);
  }
}

/*
 * The three FeatGrant-shaped tables are also read ENTRY BY ENTRY, because a FeatGrant says what it
 * grants and a per-file kind list cannot. Flattening featGrantsLane.ts to `['skill','choice']` would
 * have claimed a skill for `ironclad-fortitude` (a save) and missed the save; widening the file to
 * every kind any entry uses would credit all 305 entries with all of them. Neither is a measurement.
 */
const FEATGRANT_KEY_KINDS = {
  skills: ['skill'], skillChoices: ['skill', 'choice'], conditionalSkills: ['skill'],
  crossConditionalSkills: ['skill'], loreChoices: ['skill', 'choice'], bonusSkillFeat: ['grantsRecord'],
  save: ['save'], perception: ['perception'], armor: ['ac'], armorCascade: ['ac', 'choice'],
  weapon: ['weapon'], weaponFamiliarity: ['weapon'], choiceGrants: ['choice'],
  redundantFallback: ['choice'], rankUpgrade: [], minLevel: [],
};
for (const path of ['src/rules/featGrantsAuto.ts', 'src/rules/featGrants.ts', 'src/rules/featGrantsLane.ts']) {
  let text = '';
  try { text = readFileSync(join(ROOT, path), 'utf8'); } catch { continue; }
  const entries = [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*\{/gm)];
  for (const [i, m] of entries.entries()) {
    const body = text.slice(m.index, entries[i + 1]?.index ?? text.length);
    const kinds = new Set();
    for (const k of Object.keys(FEATGRANT_KEY_KINDS)) {
      if (new RegExp(`['"]?${k}['"]?\\s*:`).test(body)) for (const kk of FEATGRANT_KEY_KINDS[k]) kinds.add(kk);
    }
    if (kinds.size) addKinds(m[1] ?? m[2], kinds);
  }
}

/*
 * situationalBonuses.ts is read entry by entry, because the entry says what it targets. An entry runs
 * from its key to the next key at the same indent, and every `kind: '…'` inside it is one target.
 */
{
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/rules/situationalBonuses.ts'), 'utf8'); } catch { /* absent */ }
  const entries = [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*\[/gm)];
  for (const [i, m] of entries.entries()) {
    const body = text.slice(m.index, entries[i + 1]?.index ?? text.length);
    const kinds = new Set(['conditional']);
    for (const t of body.matchAll(/kind:\s*['"]([a-zA-Z]+)['"]/g)) {
      const mapped = SITUATIONAL_TARGET_KINDS[t[1]];
      if (mapped) kinds.add(mapped);
    }
    addKinds(m[1] ?? m[2], kinds);
  }
}

/* Recursive for ONE level: a subclass selector folds in its options kinds.  rather than a
 * const arrow so the recursive call below is hoisted. */
function ourKindsOf(rec, id, bucket) {
  const kinds = new Set();
  /* An ANCESTRY's own `traits` are DELIVERED, not decoration: creatureTraitsOf (src/rules/derive.ts)
   * reads them onto the character, which is what their per-row `giveTrait` ops do. Ancestries only —
   * a feat's or heritage's `traits` are record tags and grant nothing by themselves. */
  if (bucket === 'ancestries' && Array.isArray(rec.traits) && rec.traits.length) kinds.add('trait');
  for (const k of Object.keys(rec)) {
    for (const kind of fieldToKinds.get(k) ?? []) kinds.add(kind);
    if (k === 'passiveEffects' && rec.passiveEffects && typeof rec.passiveEffects === 'object') {
      for (const sub of Object.keys(rec.passiveEffects)) {
        for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
      }
    }
    /* …and `resonant`, the same shape one level down: an aeon stone's second spell, cast only while
     * the stone is slotted in a wayfinder. A reader that stops at top-level keys calls 15 stones
     * spell-less when the grant is right there. */
    if (k === 'resonant' && rec.resonant && typeof rec.resonant === 'object') {
      for (const sub of Object.keys(rec.resonant)) {
        for (const kind of fieldToKinds.get(`resonant.${sub}`) ?? []) kinds.add(kind);
      }
      /*
       * …and `resonant` IS a choice. Their side encodes "is this stone slotted in a wayfinder?" as a
       * `select` with two branches, because that is the only shape their format has for it. Ours is a
       * per-item designation the player toggles on the stone itself — a better fit for a state that
       * changes in play rather than at build time, and the same carrier an inventor's innovation uses.
       * Same question asked, same two answers; only the control differs.
       */
      kinds.add('choice');
    }
  }
  /* A TRAIT-GATED IWR ENTRY IS A CONDITIONAL. Their side wraps the Channel Protection Amulet's
   * resistance in a conditional on undead-ness; ours is `whenCreatureTrait` / `unlessCreatureTrait`
   * nested ON THE ENTRY, where a map keyed by field NAME cannot reach it — so the record read as
   * holding a plain unconditional resistance and its whole conditional half went unreported. */
  for (const e of [
    ...(rec.resistances ?? []),
    ...(rec.weaknesses ?? []),
    ...(rec.passiveEffects?.resistances ?? []),
    ...(rec.passiveEffects?.weaknesses ?? []),
  ]) {
    if (e?.whenCreatureTrait || e?.unlessCreatureTrait) kinds.add('conditional');
  }
  /*
   * A MECHANIC NESTED INSIDE A CONTAINER IS STILL A MECHANIC.
   *
   * `passiveEffects` was walked and nothing else, so two containers hid their contents entirely:
   *   · `whileActive[]` — Acute Vision's darkvision-while-raging is `whileActive[0].senses`, and the
   *     record read as having no sense at all. Eight entries across the whole database, carrying
   *     resistances / senses / weaknesses / speeds.
   *   · `effectChoices[].options[].grant` — Proteankin's three daily resistances live there, and the
   *     record read as `choice` only, so `defense` came back missing on a feat whose entire point is
   *     a resistance.
   * Both are read through the SAME `fieldToKinds` map as a top-level field, so a field only has to be
   * classified once no matter which container it sits in.
   */
  /* An ENHANCEMENT tier holds its always-on effects under `grant`; Undead Hunter's once-per-day Infuse
   * Vitality lives there, and reading only top-level fields reported the spell as missing. */
  for (const sub of Object.keys(rec.enhancement?.grant ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
  for (const w of Array.isArray(rec.whileActive) ? rec.whileActive : []) {
    for (const sub of Object.keys(w ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
  }
  /* A `choiceValue` on a granted strike means "this attack exists only if you picked that option" —
   * a condition on the record's own answer, and the exact shape their side writes as a `conditional`
   * wrapping the option's `giveItem` (Modular Dynamo gates nine configurations on whether the dynamo
   * is automatic or manual). Counted as `weapon` and never as `conditional`, so every record that
   * gates a strike on a pick reported `conditional` missing. Measured: 15 records, 95 strikes. */
  if ((rec.grantedStrikes ?? []).some((s) => s?.choiceValue)) kinds.add('conditional');
  for (const ch of Array.isArray(rec.effectChoices) ? rec.effectChoices : []) {
    for (const o of ch?.options ?? []) {
      for (const sub of Object.keys(o?.grant ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
      /* …and the kinds nested under an option's `grant.passive`. `fieldToKinds` holds only the DOTTED
       * forms (`passiveEffects.resistances`) and has no bare `passive` key, so every kind inside a branch's
       * passive block was invisible. Measured: 31 shipped records carry one and NONE has a top-level
       * `passiveEffects`, so all 31 under-reported — and moving a resistance into a branch (clay-sphere,
       * jolt-coil) made a record REGRESS from 'defense present' to missing. */
      for (const sub of Object.keys(o?.grant?.passive ?? {})) for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
      if (o?.note) kinds.add('note');
    }
  }
  /* …and a plain `choice`'s options, which carry `grant` in exactly the same shape. Sanctification is
   * the case: *"gain the champion's aura and SANCTIFICATION as described in the champion class"* ships
   * as `choice.options[].grant.grantsCreatureTraits: ['holy'|'unholy']`, and reading only top-level
   * fields reported `trait` missing on the two dedications that had just been given it. Same map, same
   * rule as the `effectChoices` block above — a container should not decide whether a grant counts. */
  for (const o of rec.choice?.options ?? []) {
    for (const sub of Object.keys(o?.grant ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
    for (const sub of Object.keys(o?.grant?.passive ?? {})) for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
    if (o?.note) kinds.add('note');
  }
  /*
   * AN INLINE `situational` NAMES ITS TARGETS TOO.
   *
   * The registry copy in situationalBonuses.ts is read target-by-target (above), but a record can carry
   * the same structure as a FIELD — and that path only ever yielded `conditional`. Storm Born ships
   * `situational: [{ targets: [{kind:'perception'}, {kind:'spell'}], … }]`, the complete printed rule,
   * and still reported a missing `perception`. One structure, two homes, one reader.
   */
  /*
   * A `choice: { kind: 'skills' }` is a picker over EVERY skill — Assurance's *"choose a skill you're
   * trained in"* — so the record models a skill even though it names none. Their side enumerates all
   * seventeen options, and without this the picker read as offering nothing.
   */
  if (rec.choice?.kind === 'skills') { kinds.add('skill'); kinds.add('choice'); }
  /*
   * WHAT A `choice` DELIVERS IS A KIND TOO, not just the asking (batch 23). buildCharacter classifies
   * the answer by what it IS (backgroundChoiceKind): options that are all feat ids GRANT the picked
   * feat (Corpse Stitcher's risky-surgery/stitch-flesh — their side writes two giveAbilityBlocks), and
   * a Lore-training pick TRAINS a skill (Elementally Infused's plane Lores — their side writes
   * SKILL_LORE_* createValues). Before this, deleting a redundant `grantedFeatId` beside the choice
   * made the record read as modelling no grant at all. `trainedLoreFromChoice` is the declared form
   * for options the label test cannot see (Energy Scarred's "Acid").
   */
  const chOpts = Array.isArray(rec.choice?.options) ? rec.choice.options : [];
  if (chOpts.length && chOpts.every((o) => core.feats?.[o?.value])) kinds.add('grantsRecord');
  if (rec.trainedLoreFromChoice || (chOpts.length && chOpts.every((o) => /lore/i.test(o?.label ?? '')))) kinds.add('skill');
  for (const s of Array.isArray(rec.situational) ? rec.situational : []) {
    kinds.add('conditional');
    for (const t of s?.targets ?? []) {
      const mapped = SITUATIONAL_TARGET_KINDS[t?.kind];
      if (mapped) kinds.add(mapped);
    }
  }
  /*
   * A `degreeShifts` ENTRY NAMES THE TRACK IT SHIFTS.
   *
   * "If you roll a success on an Acrobatics check to Balance, you get a critical success instead" is a
   * SKILL mechanic, and their side writes it as `addBonusToValue SKILL_ACROBATICS`. Ours was filed under
   * `conditional` only, so Sure Feet, Sturdy Bindings and Fire Savvy — all three fully authored, with
   * the right track named in the entry — reported a missing skill or save.
   */
  for (const d of Array.isArray(rec.degreeShifts) ? rec.degreeShifts : []) {
    kinds.add('conditional');
    if (d?.saves?.length) kinds.add('save');
    if (d?.skills?.length) kinds.add('skill');
    if (d?.perception) kinds.add('perception');
    if (d?.ac) kinds.add('ac');
  }
  for (const kind of registryKindsById.get(id) ?? []) kinds.add(kind);
  /*
   * A MODE KEYED TO THIS RECORD. An effect that applies only in a state — *"For 10 minutes you receive
   * the listed resistance to persistent bleed and persistent poison damage"* — is authored as a toggle
   * rather than a field, because a field would grant it unconditionally. The record itself therefore
   * holds nothing, and reading only the record called Blood Booster's resistances missing on an item
   * that carries them with the right number AND the right duration. Modes reach a record two ways:
   * `feats` (a feat/feature gate) and `fromItemId` (a consumable's own mode).
   */
  for (const m of Object.values(core.modes ?? {})) {
    /* A gate may be the bare record id OR `<id>:<answer>`, when the record's own answer decides which
     * modes apply — the werecreature dedication has nine types and eighteen shapes, so one gate per
     * type. An exact `includes` saw none of them and read the whole subsystem as missing. */
    const gated = (m?.feats ?? []).some((f) => f === id || String(f).startsWith(`${id}:`));
    if (m?.fromItemId !== id && !gated) continue;
    kinds.add('conditional');
    if ((m.resistances ?? []).length || (m.weaknesses ?? []).length || (m.immunities ?? []).length) kinds.add('defense');
    if ((m.grantedStrikes ?? []).length) kinds.add('weapon');
    if ((m.senses ?? []).length) kinds.add('sense');
    /* A BATTLE FORM's speeds. `battleForm.speeds` REPLACES rather than adds, which is why it is not in
     * the ordinary speed lane — but it is still a speed the record grants, and reading only the plain
     * lane called every shape-changing form speedless. `size` likewise. */
    if (Object.keys(m.battleForm?.speeds ?? m.speeds ?? {}).length) kinds.add('speed');
    if (m.battleForm?.size) kinds.add('size');
    if ((m.battleForm?.senses ?? []).length) kinds.add('sense');
    if (m.battleForm?.ac != null) kinds.add('ac');
  }
  /* …and a STANCE of the same id, which is a separate collection from `modes`. A battle form's granted
   * attacks live there (Ursine Avenger Form's jaws and claws), and their side ships them as two items. */
  const stance = core.stances?.[id];
  if (stance) {
    kinds.add('conditional');
    if ((stance.strikes ?? []).length) kinds.add('weapon');
    if ((stance.resistances ?? []).length || (stance.immunities ?? []).length) kinds.add('defense');
  }
  /*
   * A CLASS-CHASSIS FEATURE'S MECHANIC LIVES ON THE CLASS RECORD.
   *
   * A subclass selector, a spellcasting entry and a class's own focus spells are all stored on
   * `classes.<id>`, never on the class FEATURE that introduces them — so reading the feature alone
   * reported 33 of these as "they model a choice/spell slots/a focus spell and we model nothing", and
   * every one was already built. Same failure as reading a record without its registries.
   *
   * ⚠ Credited ONLY to the feature the class DECLARES as its carrier (`subclass.featureId`), never to
   * every feature the class has. Crediting broadly was measured and rejected: it would have cleared
   * `blessing-of-the-devoted` and `skillful-lessons` too, whose choices are their own and unmodelled —
   * and hiding a real gap is worse than printing a false one. Name-guessing was rejected for the same
   * reason: it identified 11 of 20 carriers, because the gunslinger's selector is "Gunslinger's Way"
   * while the subclass is "Way", and the wizard's "Arcane Thesis" is NOT its "Arcane School" selector.
   */
  const owner = classOfFeature.get(id);
  if (owner) {
    const cls = core.classes[owner];
    if (cls?.subclass?.featureId === id && (cls.subclass.options ?? []).length) {
      kinds.add('choice');
      /*
       * …and the kinds its OPTIONS carry. Their `select` FLATTENS every option's operations onto the
       * selector row, so their Mystery row asserts every mystery's curse at once while ours live on the
       * option records (`classFeatures/ancestors`, `…/ashes`). Comparing the selector against its own
       * fields alone reported the whole subclass as unmodelled.
       *
       * This attributes rather than excuses: where the options DO carry the mechanic (each arcane
       * school's `curriculum`) the selector passes; where they are empty stubs (every oracle mystery)
       * it still fails, which is correct — that work is real and simply belongs on the options.
       */
      for (const o of cls.subclass.options ?? []) {
        const opt = core.classFeatures[o.id];
        if (opt) for (const k of ourKindsOf(opt, o.id)) kinds.add(k);
        /* A subclass option's weapon/armour keystone lives on the OPTION itself — the reader is
         * `grantOptions` in build.ts, not `classFeatures`. The necromancer's Reaper is the case:
         * `grants.weapons` is real, applied and tested, and reading only the option's classFeature
         * record (which for the two Fatal Methods did not exist at all) said the subclass granted no
         * proficiency of any kind. */
        if ((o.grants?.weapons ?? []).length) kinds.add('weapon');
        if ((o.grants?.armor ?? []).length) kinds.add('defense');
        if ((o.grants?.skills ?? []).length) kinds.add('skill');
      }
    }
    /*
     * …and the same for an EXTRA CHOICE. A kineticist's six elements, a wizard's five theses, an
     * exemplar's twenty-one ikons and an animist's thirteen apparitions live on
     * `classes.<id>.extraChoices`, so the feature whose printed text says "choose one" held nothing
     * and read as offering no choice at all. Credited only where the class DECLARES the carrier —
     * same rule and same reason as `subclass.featureId` above; the six undeclared entries stay
     * uncredited, so an uncredited choice reads as a gap rather than being silently excused.
     */
    for (const ec of cls?.extraChoices ?? []) {
      if (ec.featureId !== id || !(ec.options ?? []).length) continue;
      kinds.add('choice');
      for (const o of ec.options ?? []) {
        const opt = core.classFeatures[o.id];
        if (opt) for (const k of ourKindsOf(opt, o.id)) kinds.add(k);
        if ((o.focusSpells ?? []).length) kinds.add('spell');
        /* …and the keystones carried on the OPTION itself rather than on a classFeature record — the
         * same three the subclass walk above reads. The exemplar's six root epithets each train a
         * skill this way, so the feature that prints "choose one" read as training nothing. */
        if ((o.grants?.weapons ?? []).length) kinds.add('weapon');
        if ((o.grants?.armor ?? []).length) kinds.add('defense');
        if ((o.grants?.skills ?? []).length) kinds.add('skill');
      }
    }
    /* Spell slots and the spellcasting proficiency come off the class's own progression. */
    if (cls?.spellcasting && /-spellcasting$/.test(id)) { kinds.add('spellSlot'); kinds.add('spellcasting'); }
    /* …and the class's focus spells, for the feature that introduces them (Composition Spells, Grave
     * Spells, Link Spells). Gated on the feature's name ending in "Spells" so an unrelated feature of a
     * focus-casting class is not credited. */
    if ((cls?.focusSpells ?? []).length && /-spells$/.test(id)) kinds.add('spell');
  }
  return kinds;
}

/* ---------------------------------------------------------------- match + bucket */
/*
 * THEIR ROWS, PER OUR BUCKET — `bucket -> Map(normalised name -> {kinds, ops, …})`.
 *
 * This was one flat map filtered to `type === 'feat'`, so a class feature, item, heritage, background,
 * ancestry or class was compared against nothing and appeared in no bucket of this report. Type-gated
 * through the shared `WG_PAIRING`, never by name alone: 266 normalised names exist in two of our buckets
 * and a name-only widening compared our WEAPON `clan-pistol` against their FEAT of that name.
 */
const theirByBucket = {};
for (const [bucket, rowMap] of Object.entries(wgRowsByBucket(sql))) {
  const m = new Map();
  for (const [key, r] of rowMap) {
  const name = r.name;
  const ops = parseOps(r.operations).flatMap((o) => flatten(o));
  const kinds = new Set(ops.flatMap((o) => { const k = kindOfTheirOp(o); return Array.isArray(k) ? k : k ? [k] : []; }));
  /*
   * WHAT EACH `conditional` ACTUALLY GATES. A conditional is a WRAPPER, not a mechanic, and treating
   * it as one made every "gain X, or Y if you already have it" record report a permanent gap: Sea
   * Legs' swim Speed is `IF SPEED_SWIM < 10 THEN set 10`, and we ship `speeds: {swim: 10}`, which
   * raises and never lowers — the same rule, expressed once instead of twice. Four batch-3 records
   * were this, and every future batch would meet more.
   *
   * So the branch contents are recorded per conditional, and the comparison below drops `conditional`
   * from `missing` only when EVERY conditional's contents are kinds we already model. A conditional
   * that gates something we lack still reports — which is the case worth reading.
   */
  const condGroups = parseOps(r.operations)
    .flatMap((o) => flatten(o))
    .filter((o) => o?.type === 'conditional')
    .map((o) => new Set(flatten(o).slice(1).flatMap((x) => { const k = kindOfTheirOp(x); return Array.isArray(k) ? k : k ? [k] : []; })));
    /* `wgRowsByBucket` already kept the richest row per name, so there is no contest to resolve here. */
    m.set(key, { name, kinds, ops, condGroups, opCount: ops.length });
  }
  theirByBucket[bucket] = m;
}

/**
 * KIND MISMATCHES THAT HAVE BEEN READ AND SETTLED.
 *
 * The differ compares KINDS, so a handful of rows survive every vocabulary fix and are still not
 * gaps — the mechanic is there, expressed somewhere the kind comparison structurally cannot see, or
 * their operations encode something the record does not print. Left unlisted they reappear in every
 * batch and get re-read from scratch; asserted as fixed they would hide a real regression. So they are
 * named here, per KIND, with the reason and the evidence, and anything NOT listed still reports.
 *
 * ⚠ Only for a mismatch verified by reading the printed text. Never a place to quiet a real gap.
 */
const VERIFIED_EQUIVALENT = {
  /*
   * SPELLSHIFTER DEDICATION — their grant points at a record that does not exist on our side, and the
   * one sharing its NAME is a different feat entirely.
   *
   * Printed: *"You gain the SHIFT SPELL ACTION and the Share the Burden spellshift."* That action is in
   * no bucket of our corpus. Ours used to carry `grantsFeats: ['shift-spell']`, which resolves to
   * `feats/shift-spell` — a LEVEL-14 WIZARD feat that merely shares the name — so an archetype
   * character was handed a wizard feat eleven levels early and still had no Shift Spell action.
   *
   * The grant is removed and the clause is stated on the record instead. Adopting their encoding here
   * would mean re-pointing at the wrong record, which is the defect, not the fix. Revisit if the
   * Spellshifter action records are ever imported — the whole archetype is prose-only today, which is
   * why its three feats also needed their archetype and prerequisite gates authored by hand.
   */
  'spellshifter-dedication': ['grantsRecord'],

  /*
   * ---- BATCH 1 ----------------------------------------------------------------------------------
   *
   * Batch 1 is the only batch cut before the level ordering, so it is the only one holding classes,
   * backgrounds and a great many items — and most of what it reported were blind spots in the
   * COMPARERS, fixed there (a class states its saves and skills on itself; a background states its
   * trained skill and ability-boost choice on itself; an item states its Speed under `passiveEffects`).
   * 24 kinds gaps became 13 the moment the instruments could see those fields. These are the rest.
   *
   * POWER SUIT — `createValue INVENTOR_ARMOR = true` is a MARKER their engine tests elsewhere, the same
   * shape as MARTIAL_EXPERIENCE. Ours identifies an armour innovation by the record the inventor chose,
   * so there is no value to hold.
   */
  'power-suit': ['specialStat'],

  /*
   * ULTIMATE FLEXIBILITY — *"you gain three fighter feats instead of two."* The choice is a FEAT SLOT,
   * not a record `choice`: `levelGrants` reads the character's taken feats and adds a third
   * combat-flexibility slot when this one is among them. A `choice` on the record would be a second
   * place to answer the same question.
   */
  'ultimate-flexibility': ['choice'],

  /*
   * HAFT STRIKER STANCE — the standing "their unarmed attacks are ITEMS" translation. Their `giveItem`
   * is the haft as a weapon; ours is a `stances/haft-striker-stance` record carrying its `strikes`,
   * which is where every other stance keeps the attack it grants.
   */
  'haft-striker-stance': ['grantsItem'],

  /*
   * MONK EXPERTISE — *"your proficiency rank for your monk class DC increases to expert. If you have qi
   * spells, your proficiency rank for spell attacks and spell DCs increases to expert."* Both are steps
   * on the per-class table (`{ level: 9, track: 'classDc' }` and `track: 'spellcasting'`, both sourced
   * to this feature), not fields on the record. Their `conditional` is the "if you have qi spells"
   * gate, which the spellcasting track carries by only existing for a character who has one.
   */
  'monk-expertise': ['classDc', 'conditional', 'spellcasting'],

  /*
   * UNTRAINED IMPROVISATION — their `UNTRAINED_IMPROVISATION` marker plus the level conditional around
   * it. Ours is `untrainedProficiency: { levelMinus: 2 }`, a FLOOR under the proficiency contribution of
   * an untrained skill rather than a rank — the skill-side twin of the weapon lane batch 15 built.
   */
  'untrained-improvisation': ['conditional', 'unmapped'],

  /*
   * SKILLED HERITAGE — *"You become trained in one skill of your choice. At 5th level, you become an
   * expert in the chosen skill."* Both clauses live in `build.heritageSkill`: a first-class build field
   * with its own control in the builder, and buildCharacter applies the 5th-level step beside it. The
   * record therefore carries no `choice` and no conditional for the comparer to see.
   *
   * ⚠ This was nearly "fixed" into a duplicate. A FEAT_GRANTS entry was authored for it on the strength
   * of a grep across `featGrants*.ts` alone — which is not where that lane lives — and it granted a
   * SECOND skill on top; only the reverse-build round-trip caught it. Grep the id across ALL of src/.
   */
  'skilled-human': ['choice', 'conditional'],

  /*
   * RESPITE OF LOAM AND LEAF — the cantrip pick is an `effectChoices`, and the `spellcasting` half is
   * Player Core p.298 applied to every innate entry rather than authored per record (the identical
   * settle to Labyrinthine Echoes). Their `conditional` is the level gate on the cantrip's heightening,
   * which a cantrip gets by being a cantrip.
   */
  'respite-of-loam-and-leaf': ['spellcasting', 'conditional'],

  /*
   * ONE WITH THE WILD — where the note hangs, not whether it exists.
   *
   * *"In natural terrain, you can Hide and Sneak even without cover or being concealed."* Their row is
   * `addBonusToValue SKILL_STEALTH` carrying TEXT AND NO VALUE — an annotation on the skill — plus two
   * `injectText` ops naming Hide and Sneak. Ours is two RECORD_MARKERS, one on each of those actions,
   * which is where the permission is actually used and is what their own injectText says.
   *
   * The record held nothing at all before this: the prose gate found it asserting nothing on our side.
   */
  'one-with-the-wild': ['skill'],

  /*
   * ---- BATCH 15 ---------------------------------------------------------------------------------
   *
   * UNCANNY AWARENESS — a NAME COLLISION on their side, not a gap on ours.
   *
   * Their dump holds THREE rows called "Uncanny Awareness": one at level 5 (`giveAbilityBlock
   * type=sense`, which is exactly our record) and two at level 9 carrying `addBonusToValue PERCEPTION
   * +2 circumstance to initiative`, one of them with a tie-break and a once-daily reroll as well.
   * Pairing by name matched our level-5 record against a level-9 namesake and reported `perception`.
   *
   * The Archives carry exactly ONE Uncanny Awareness — feat-2524, level 5, motion sense — and nothing
   * of that name in any other category. The clauses on their level-9 rows ARE printed, but on Elven
   * Instincts (feat-981) and Ambush Awareness (feat-2810), which are their own records. So there is no
   * printed rule behind the difference, and the printed rules are the authority: their data is a
   * differ, never a source.
   */
  'uncanny-awareness': ['perception'],

  /*
   * MAGICAL FORTITUDE / PRECOGNITIVE REFLEXES / UNBREAKABLE EXPERTISE — a different CARRIER.
   *
   * Their side writes each as a bare `adjValue` on the record (SAVE_FORT=E, SAVE_REFLEX=E,
   * MEDIUM_ARMOR=E + HEAVY_ARMOR=E). Ours live in `src/rules/advancement.ts`, the per-class table, so
   * the record itself carries no field and the comparer — which reads fields — sees nothing.
   *
   * Measured before settling, because "authored in a registry" and "reaching the sheet" are different
   * claims: `test/batch15-parity.test.ts` builds each owning class either side of the level and asserts
   * the rank actually steps (witch/sorcerer 5th, wizard/oracle 9th, psychic 5th, guardian 5th — and
   * BOTH armour tracks, since half of that sentence landing looks identical on a guardian in medium).
   */
  'magical-fortitude': ['save'],
  'precognitive-reflexes': ['save'],
  'unbreakable-expertise': ['ac'],
  /* ARMOR POTENCY (+1) — the mechanic is in the RUNES bucket, which no comparer reads.
   * Printed (GM Core p.226): "Increase the armor's item bonus to AC by 1. The armor can be etched
   * with one property rune." Their item 6719 encodes only the first clause, as addBonusToValue
   * AC_BONUS=1 type=item. Ours carries BOTH: core.runes/armor-potency-1 {kind: potency, value: 1} is
   * the carrier — the items-bucket twin is the purchasable CHASSIS and is EXPECTED to be empty,
   * because lib/wg-parse.mjs WG_BUCKETS has no runes entry, so every one of the 159 runes is compared
   * against its chassis. Reader chain: attachments.ts planRune -> hostInv.runes.potency ->
   * derive.ts acItem (an ITEM bonus), the exact clause their op asserts. */
  'armor-potency-1': ['ac'],

  /*
   * FIGHTER WEAPON MASTERY — the choice is real, it just does not live on the record.
   *
   * Their side is a bare `select from:ADJ_VALUE "Weapon Mastery"`. Ours is `build.fighterWeaponGroup`,
   * a first-class field on the build with its own surface in the builder, applied in buildCharacter —
   * so the comparer, which looks for a `choice` on the record, sees none.
   *
   * ⚠ Settled only after fixing what reading it exposed. The application was a FLAT per-group rank, and
   * the sentence is not flat: *"master with the simple weapons, martial weapons, and unarmed attacks in
   * that group, and to EXPERT with the advanced weapons in that group."* An advanced weapon of the
   * chosen group rolled at master from 5th level — one rank above the book, permanently, and visible
   * only to a fighter who actually wielded one. Now carried by `weaponGroupRanks`, which has the
   * category axis; pinned in `test/batch15-parity.test.ts`.
   */
  'fighter-weapon-mastery': ['choice'],

  /*
   * SEALED POPPET — *"You no longer have the weakness to fire from the flammable ability."* Their side
   * hands over an ability block (`grantsRecord`); ours is the direct field `removesWeaknesses: ['fire']`,
   * read in derive.ts where the weakness list is assembled. Removing a weakness is the whole content of
   * the record, so a record-shaped wrapper would add a name and nothing else.
   */
  'sealed-poppet': ['grantsRecord'],

  /*
   * ASCENDED DRAGONET HERITAGE — their `giveAbilityBlock` per option against our `secondHeritage`.
   *
   * The record now carries the choice and the grant it was missing entirely (see the backfill script);
   * what remains is only the carrier. Their side copies the heritage's effects into an ability block
   * hung on each option; ours names the HERITAGE, which is the thing the sentence points at — *"the
   * dragonet heritage you selected at first level"* — and so keeps the feats and benefits that key off
   * owning it, which is the half of the sentence a copied effect block cannot deliver. Same settle as
   * its two siblings `awakened-yaoguai-heritage` and `late-awakener`.
   */
  /* RESTORED — the removal reason (the second heritage's innate spells now reach the character) fixed
   * a DIVERGENCE; it was never a reason their giveAbilityBlock-per-option would stop reporting as a
   * kind. Their five copied dragonet effect blocks against our secondHeritage field: same mechanic,
   * and ours additionally preserves heritage IDENTITY, which a copied effect block cannot. */
  'ascended-dragonet-heritage': ['grantsRecord'],

  /*
   * LABYRINTHINE ECHOES / THE MOON WEAVER'S ART — the level gate and the innate proficiency.
   *
   * Both now carry the innate spell they print (the Moon Weaver's was missing entirely; see the
   * backfill). What is left is two vocabulary differences:
   *
   *   `conditional` — their level gate is an explicit IF LEVEL >= n wrapped around a second `giveSpell`.
   *   Ours is `heightenAt: [{ level: 7, rank: 2 }]` on the one grant, which says the same thing without
   *   a second copy of the spell to keep in step.
   *
   *   `spellcasting` — their `adjValue SPELL_DC = T` / `SPELL_ATTACK = T`. Ours is not authored per
   *   record at all: Player Core p.298 makes it a rule of innate spells ("you become trained in the
   *   spell attack modifier and spell DC statistics"), so buildCharacter applies it to every innate
   *   entry, including the 12th-level step to expert. Authoring it per record would be 300-odd copies
   *   of a rule, each able to fall out of step with it.
   */
  'labyrinthine-echoes': ['conditional', 'spellcasting'],
  /* RESTORED — the removal reason (the duplicate registry picker) fixed a CHOICE divergence; these
   * two kinds were collateral. spellcasting = their per-record adjValue SPELL_DC/SPELL_ATTACK = T;
   * conditional = their LEVEL>=12 step to E (their conditional here wraps the PROFICIENCY step, not a
   * second giveSpell as the labyrinthine-echoes paragraph above describes). Both are one general rule
   * on our side, applied to every innate entry rather than copied onto 300 records. */
  'the-moon-weavers-art': ['conditional', 'spellcasting'],
  /* SPEAKER IN TRAINING — specialStat = their createValue FAITHSPEAKER/GREENSPEAKER, a boolean marker
   * written inside the select's own option: the same bookkeeping the string-marker guard above
   * already settles (power-suit's INVENTOR_ARMOR, martial-experience, bone-magic), only boolean-typed
   * so the guard does not recognise it. conditional = their heritage gate around the pick; ours gates
   * the record itself. The pick's mechanics are featCantripGrants with per-option traditions. */
  'speaker-in-training': ['conditional', 'specialStat'],

  /*
   * MARTIAL EXPERIENCE — their `setValue MARTIAL_EXPERIENCE = true` is a MARKER, not a mechanic: a flag
   * their engine tests elsewhere, so it maps to no kind at all on their side either.
   *
   * Both printed sentences are now modelled, and neither was before — *"treat your level as your
   * proficiency bonus"* is `untrainedWeaponProficiency` (a FLOOR under the proficiency contribution of
   * a weapon you are untrained with, the weapon-side twin of the skill lane that already existed), and
   * *"at 11th level, you become trained in all weapons"* is a real rank on every weapon category.
   * Pinned in test/batch15-parity.test.ts, which measures a wizard's greatsword either side of both.
   */
  'martial-experience': ['unmapped'],

  /*
   * GATE'S THRESHOLD — the branch lives in the BUILD, not on the record.
   *
   * *"At 5th level and every 4 levels thereafter, you choose to either expand the portal or fork the
   * path."* Their side is a `select from:CUSTOM` with the two branches nested under it. Ours is two
   * first-class BuildState fields — `gateForks` (the new element) and `gateExpands` (the bonus impulse
   * feat) — keyed by the threshold level, with the builder rendering both and buildCharacter applying
   * them, so a record-level `choice` would be a third place to store the same answer.
   *
   * The record's own `effectChoices` is the GATE JUNCTION, which is the other half of Expand the Portal
   * and is a different question; the comparer compares the two lists and reports the branch missing.
   *
   * ⚠ Settled only after fixing what reading it exposed. The fork was folded into `extraOptions` — the
   * list that carries an element's grants — but not into `classChoices`, the list the character
   * DISPLAYS. So a kineticist who forked into Air had Air Gate's Stealth, its impulses and its junction,
   * and no air element anywhere on their sheet. Two readers of one answer, and only one had been told.
   * Pinned in test/batch15-parity.test.ts, which asserts both halves.
   *
   * Their `adjValue KINETICIST_BLAST_DICE = 1` is settled separately in wg-values' NOT_A_SCALAR: we
   * read the same number off the level, at exactly the four Gate's Threshold levels.
   */
  /* RESTORED — the removal reason (Fork's impulse feat) fixed a divergence; the UNMAPPED kind was
   * collateral. Their Expand/Fork branch select is BuildState on our side (gateForks/gateExpands,
   * measured live by test/batch15-parity.test.ts, including the junction now gated on the Expand
   * branch via requiresNoGateFork), not a record field this comparer could read. */
  'gates-threshold': ['unmapped'],

  /*
   * BASIC KATA — their number contradicts the book, and sits on the wrong record.
   *
   * Their Basic Kata row carries `IF FEAT_NAMES INCLUDES "monk resiliency" THEN adjValue
   * MAX_HEALTH_BONUS 3`. Two disagreements in one operation:
   *
   *   · THE CARRIER. Monk Resiliency's Hit Points belong to Monk Resiliency. Theirs hang them off
   *     Basic Kata because their `select` cannot carry effects, so the pick has to be tested from the
   *     outside. Ours are on `monk-resiliency` itself, which is where any route to that feat finds
   *     them — Basic Kata is only one of them.
   *
   *   · THE NUMBER. Verbatim from the AoN mirror: *"You gain 3 additional Hit Points FOR EACH monk
   *     archetype class feat you have. As you continue selecting monk archetype class feats, you
   *     continue to gain additional Hit Points in this way."* Ours is `maxHpBonus.perArchetypeFeat: 3`,
   *     which is that sentence. Theirs is a flat 3 that never grows. Not adopted; recorded — same
   *     class as the `summiting-dragonblood` climb Speed in SETTLED_VALUES.
   *
   * `conditional` follows the same way: their conditional exists only to test the pick from outside
   * the select. Ours has no condition to model because the feat that grants the Hit Points is the
   * feat that carries them.
   */
  'basic-kata': ['conditional', 'hp'],

  /*
   * MODULAR DYNAMO — their configurations are ITEMS, ours are the strikes those items would be.
   *
   * The standing translation (see "THEIR UNARMED ATTACKS ARE ITEMS" at the top of this file) maps a
   * `giveItem` to `weapon` when the item carries their Unarmed trait, and 236 of their 339 do. The
   * dynamo attachments are the other kind: an item row without that trait, so the mapping calls them
   * `grantsItem` — but a dynamo configuration is not something the character carries, it is what the
   * dynamo attack IS. Ours are nine `grantedStrikes` entries in the same shape
   * `sterling-dynamo-dedication` already uses, each gated by `choiceValue` on the matching option.
   *
   * Their `conditional` is the automatic/manual split, which our option VALUES carry instead
   * (`modular:auto-…` / `modular:manual-…`) — the same gate, spelled into the answer rather than
   * wrapped around it.
   */
  'modular-dynamo': ['conditional', 'grantsItem'],

  /*
   * "You also become trained in Shoony Lore." Their row grants the Additional Lore FEAT instead, which
   * also carries its 3rd/7th/15th extra skill increases — more than this feat prints. The peers whose
   * text DOES say "you also gain the Additional Lore general feat" (catfolk-lore, tengu-lore,
   * dwarven-lore) are authored that way here; this one says only "become trained", and ships
   * `skills: {'lore:shoony': 'trained'}`. Ours matches its own printed text; theirs matches catfolk's.
   */
  /*
   * BATCH 14 — THE INNATE-SPELL PROFICIENCY RULE, re-encoded on every record that grants one.
   *
   * Four records here carry `spellcasting` + `conditional` that is not their own text at all. It is
   * the GENERAL rule, AoN rules-2232 (Player Core p. 298): *"When you gain an innate spell, you become
   * trained in the spell attack modifier and spell DC statistics. At 12th level, these proficiencies
   * increase to expert."* Their engine has no general rule, so every record that grants an innate
   * spell repeats it as a pair of level-banded adjValues; ours applies it once, in build.ts, to every
   * innate caster — which is why the records themselves say nothing.
   *
   * Checked against each feat's printed text: Fey Influence, Oni's Mask, Stem the Tide and Apprentice
   * Sea Witch all print the spell and its frequency and NOTHING about proficiency. Adopting theirs
   * would mean copying one rule onto hundreds of records and then keeping the copies in step.
   */
  'fey-influence': ['spellcasting', 'conditional'],
  'onis-mask': ['spellcasting', 'conditional'],
  'stem-the-tide': ['spellcasting', 'conditional'],
  'apprentice-sea-witch': ['conditional', 'spellcasting'],
  /* Same rule again, plus the heightening ladder — *"At 7th level, the spell is heightened to 2nd rank,
   * and every 2 levels thereafter"* — which ours carries as `heightenHalfLevel` on the grant rather
   * than as three level-banded copies of the grant. */
  'colugos-traversal': ['conditional', 'spellcasting'],

  /*
   * SCALES OF THE DRAGON — their grant is a SELF-REFERENCE.
   *
   * Their feat 22302 "grants" their physical-feature 29433 of the same name, and that block carries
   * zero operations. Reproducing it would put a second row on the sheet named exactly like the feat
   * already on the Feats tab, carrying nothing. (The feat's REAL second sentence — the resistance
   * upgrade — is a separate finding, tracked in the residual list, and neither side encodes it.)
   */
  'scales-of-the-dragon': ['grantsRecord'],

  /*
   * AWAKENED YAOGUAI HERITAGE — *"You gain all the mechanical benefits of the yaoguai heritage you
   * selected at first level."* The text POINTS AT the ancestry's heritage list rather than printing
   * one, so ours resolves it from the character's own heritage. Their five enumerated options are a
   * hand-copy of that list, and a hand-copy is the thing that drifts when the list grows.
   */
  'awakened-yaoguai-heritage': ['grantsRecord'],

  /*
   * SECOND IMPLEMENT — *"You choose a second implement, which must be a different type of implement
   * than your first. You gain the initiate benefit of your new implement."* Both halves are COMPUTED
   * on our side: the option list is the implements the character does not already hold, and the
   * initiate benefit comes from the implement record. Their `select` enumerates what we derive.
   */
  'second-implement': ['choice'],

  /*
   * TACTICAL EXCELLENCE — *"You add two new mobility or offensive tactics to your folio."* Their two
   * `select from:ABILITY_BLOCK` enumerate the tactics at the moment of the feat; ours widens the
   * FOLIO by 2 (counterMods `commander-folio`) and the player picks their tactics from the folio in
   * the one place tactics are chosen. Same two tactics, asked where every other tactic is asked.
   * The feat's other half — *"increase your maximum number of tactics prepared by 1"* — is now
   * `preparedTacticsBonus`, read at build.ts:6203; neither half reached a player before.
   */
  'tactical-excellence': ['choice'],

  /*
   * THE TASTE OF MAGIC — their carrier for a sense is a granted RECORD (`giveAbilityBlock type=sense`);
   * ours is the `senses` field, which is where every other scent feat in the database puts it. The
   * 30-foot imprecise scent itself was missing and is now authored — this settles only the carrier.
   */
  'the-taste-of-magic': ['grantsRecord'],

  /*
   * BATCH 13 — the three "Basic <X>" archetype feats, all the Basic Kata case again.
   *
   * Their row hangs a FLAT +3 Max HP off the Basic feat, gated on having also picked the archetype's
   * Resiliency feat. The Basic feats print no Hit Points at all — Basic Fury (feat-6192) is one
   * sentence, *"You gain a 1st- or 2nd-level barbarian feat"*, and Basic Devotion (feat-6197) and
   * Devout Magic (feat-6199) are the same shape. The HP sentence lives on the RESILIENCY feat:
   * *"You gain 3 additional Hit Points FOR EACH <class> archetype class feat you have."*
   *
   * Ours puts it there — `barbarian-resiliency` and `champion-resiliency` both carry
   * `maxHpBonus: {perArchetypeFeat: 3}`, read by featHpBonus at src/rules/derive.ts:755 — so the
   * number a character actually gets is right and it grows with the archetype as printed. Theirs is a
   * per-feat flat 3 distributed across the archetype's feats, which reaches the same total by a
   * different route and cannot grow; either way, nothing is missing here.
   * `conditional` follows for the same reason: their conditional exists only to test the pick from
   * outside their select. Ours has no condition to model, because the feat that grants the Hit Points
   * is the feat that carries them.
   */
  'basic-fury': ['conditional', 'hp'],
  'basic-devotion': ['conditional', 'hp'],
  'devout-magic': ['conditional', 'hp'],

  /*
   * BATCH 17'S TURN AT THE RESILIENCY ROW — six more records whose only `hp` op is a *-Resiliency
   * feat's Hit Points parked on an archetype feat, exactly the family settled directly above.
   *
   * Each of their rows carries `FEAT_NAMES INCLUDES "<class> resiliency"` (some also re-testing
   * MAX_HEALTH_CLASS_PER_LEVEL against that feat's own printed d8/d10 prerequisite — the FIRST
   * condition on advanced-defender's row) → flat +3 MAX_HEALTH_BONUS, else nothing. That is how their
   * model spells *"3 additional Hit Points FOR EACH <class> archetype class feat you have"* — a flat 3
   * distributed across every feat of the archetype. The printed feats grant no Hit Point at all:
   * advanced-devotion / advanced-glory / advanced-kata / advanced-defender are *"You gain one <class>
   * feat"* plus the half-level clause, and champions-reaction is *"You can gain and use the champion's
   * reaction associated with your cause."* We hold the Hit Points ONCE, on the feat that prints them —
   * `feats['<class>-resiliency'].maxHpBonus = { perArchetypeFeat: 3, archetype: '<class>' }`, read by
   * featHpBonus (src/rules/derive.ts:779) and folded into the initial-HP seed at build.ts:6949 — and
   * each of these carries `archetype: '<class>'`, so it is counted among the feats that bonus
   * multiplies, scaling as the book says where their flat 3 cannot. Owner ruling 2026-08-22 ("the book
   * wins"), guarded by scripts/resiliency-clause-check.mjs.
   *
   * guardians-intercept's `hp` half settles for the same reason (guardian-resiliency); its
   * grantsRecord gap (Intercept Attack) is a REAL mismatch fixed separately, so only the two
   * resiliency kinds are quieted here — never the whole record.
   */
  'advanced-devotion': ['conditional', 'hp'],
  'advanced-glory': ['conditional', 'hp'],
  'advanced-kata': ['conditional', 'hp'],
  'advanced-defender': ['conditional', 'hp'],
  'champions-reaction': ['conditional', 'hp'],
  'guardians-intercept': ['conditional', 'hp'],

  /*
   * BATCH 18 — the barbarian half of the batch-17 resiliency family (advanced-devotion/-glory/-kata/
   * -defender above). Their modern row 31308 is:
   *   select {modeType:'FILTERED', optionType:'ABILITY_BLOCK', title:'Select a Feat',
   *           optionsFilters:{abilityBlockType:'feat', traits:['Barbarian'], level:{max:10}}}
   *   conditional {conditions:[{name:'FEAT_NAMES', type:'list-str', operator:'INCLUDES',
   *                            value:'barbarian resiliency'}],
   *                trueOperations:[{type:'addBonusToValue',
   *                                 data:{variable:'MAX_HEALTH_BONUS', value:'+3', text:''}}],
   *                falseOperations:[]}
   * legacy 29495 is the same two ops reversed, value 3, level:{min:1,max:10}.
   * Printed Advanced Fury (feat-6193) grants no Hit Point; the clause prints on Barbarian Resiliency
   * (feat-6191). We hold it ONCE there — feats['barbarian-resiliency'].maxHpBonus =
   * {perArchetypeFeat:3, archetype:'barbarian'} — read by featHpBonus (derive.ts:824, fold at :836)
   * and seeded at build.ts:6985; advanced-fury carries archetype:'barbarian', so it is counted and
   * scales as the book says where their flat 3 cannot. Owner ruling 2026-08-22 ("the book wins"),
   * guarded by scripts/resiliency-clause-check.mjs. The select half already matches as `choice`
   * (featPickGrants.ts:254, maxLevel:'half' — their level.max:10 is a static half-of-20).
   */
  'advanced-fury': ['conditional', 'hp'],

  /*
   * KNIGHT RECLAIMANT DEDICATION — their 25835 is [adjValue SKILL_STEALTH {"value":"E"}, adjValue
   * SKILL_SURVIVAL {"value":"E"}, defineCastingSource CASTING_SOURCES
   * "KNIGHT_RECLAIMANT:::-:::DIVINE:::ATTRIBUTE_CHA", adjValue PRIMARY_SHEET_TABS "spells"]. The
   * slot-type segment is blank and the last op is their sheet's tab list: the row grants no spell,
   * no slot and no spellcasting proficiency. It is the hanger for the archetype's later focus
   * spells — the dump holds three KNIGHT_RECLAIMANT strings, this definition plus two consumers:
   * their Invoke the Crimson Oath (29003) = [adjValue SPELL_ATTACK {"value":"T"}, adjValue SPELL_DC
   * {"value":"T"}, giveSpell {spellId 6142, type FOCUS, castingSource KNIGHT_RECLAIMANT, rank 2}],
   * and For Love, For Lightning (28533), which casts from the same source.
   * Printed, feat-1097 prints expert Stealth and Survival and the undead-save upgrade and no Cast a
   * Spell; feat-1098 prints the profile — *"your knight reclaimant focus spells are divine spells;
   * when you gain this feat, you become trained in divine spell attacks and spell DCs. Your key
   * spellcasting ability for these spells is Charisma."* We hold it on the feats that print it:
   * feats['invoke-the-crimson-oath'].spellcastingGrant {divine, cha, trained} + focusSpells (the
   * same pair on shall-not-falter-shall-not-rout and for-love-for-lightning, expert on
   * crimson-oath-devotion), read by build.ts:5818 and the featFocusGrant chain, build.ts:3739-3783.
   * The skills are featGrantsAuto.ts:460 -> FEAT_GRANTS (featGrants.ts:630) -> build.ts:4604; the
   * save upgrade is the record's own degreeShifts, read by explain.ts:311/495. This settles the
   * SPELLCASTING kind only.
   */
  'knight-reclaimant-dedication': ['spellcasting'],

  /*
   * AEON STONE (DELAYING) — their one `hp` op has NO value and NO type:
   *   {"type":"addBonusToValue","data":{"variable":"MAX_HEALTH_BONUS","text":"When you would die from
   *   the dying condition (typically at dying 4), this smooth pink stone automatically activates and
   *   reduces your dying value to 1 less than would normally kill you (typically to dying 3). … only
   *   once per day, even if you have multiple such stones."}}
   * It appears once in EACH branch of their resonant select ("Is this granting the resonant power?",
   * the "Yes" branch adding giveSpell{spellId:4656, INNATE, rank 1, DIVINE, casts 1}).
   * Contrast a REAL one — champion resiliency's MAX_HEALTH_BONUS value 3. This is prose parked on the
   * HP variable; print grants no Hit Points. Ours states the clause in core-descriptions.json
   * items/aeon-stone-delaying.d (src/data/index.ts:553 -> ItemDetail.tsx:652) and makes "only once per
   * day" LIVE as frequency {max:1,per:'day'} -> itemUses.ts:32-40 -> ItemDetail.tsx:194/402.
   * `choice` and `spell` are already credited: ourKindsOf maps `resonant` to both the
   * wayfinder-slotted designation (choice) and resonant.innateSpells (spell, granted at build.ts:6501).
   */
  'aeon-stone-delaying': ['hp'],

  /*
   * AEON STONE (NOURISHING) — same shape as Delaying above: their addBonusToValue MAX_HEALTH_BONUS has
   * no value and no type (meta_data hp=hp_max=0), carrying only the printed no-eat/no-drink week
   * clause as text in both branches of the resonant select; the "Yes" branch adds
   * giveSpell{spellId:4392 = Air Bubble, INNATE, rank 1, PRIMAL, casts 1}.
   * Ours: items['aeon-stone-nourishing'].resonant = {note "cast Air Bubble as a primal innate spell
   * once per day", innateSpells:[{spellId:'air-bubble', tradition:'primal', rank:1, usesPerDay:1}]}
   * (effect-backfill), the select mapping to the wayfinder-slotted designation
   * (ItemDetail.tsx:490-506, InventoryTab.tsx:706), giveSpell to build.ts:6501-6505, and the text op
   * to core-descriptions.json .d (data/index.ts:551 -> ItemDetail.tsx:652). Prose parked on the HP
   * variable, not Hit Points.
   */
  'aeon-stone-nourishing': ['hp'],

  /*
   * BATCH 18 — THE ADVANCEMENT-TABLE FAMILY (the magical-fortitude / precognitive-reflexes carrier
   * above, adversarially confirmed per record, evidence archived in work/b018-adversarial.json record set). Their side writes each
   * class-feature proficiency bump as bare adjValues on the record; ours live as rows in
   * src/rules/advancement.ts keyed `source: '<id>'` (advancementRows -> applyAdvancement -> derive),
   * which a field-reading comparer cannot see.
   *  - expert-spellcaster: SPELL_ATTACK=E + SPELL_DC=E on every PF2e row (their 20986 bard/druid/
   *    witch/wizard L7, 31220 oracle/sorcerer L7, 38652 animist L7, 25013 psychic L7, 25617
   *    magus/summoner L9) — ours: the per-class spellcasting-track expert rows at those same levels,
   *    and derive.ts feeds BOTH attack and DC from the one rank. The `classDc` kind is credited too:
   *    that op exists ONLY on their 35051, the Starfinder Playtest Mystic/Witchwarper printing of the
   *    same feature name — a class we do not model; AoN's PF2e printings print spell attack + DC only.
   *  - expert-necromancy: SPELL_ATTACK/SPELL_DC=E (their 57677/39093) — ours advancement.ts
   *    necromancer spellcasting expert@7.
   *  - expert-runes: CLASS_DC=E (their 57709; their stale playtest row 39319 says M — print says
   *    expert, so the shipped E row is the one that matters) — ours runesmith classDc expert@7.
   *  - kinetic-expertise: CLASS_DC=E (their 21761) — ours kineticist classDc expert@7.
   *  - reflex-expertise: SAVE_REFLEX=E per class — ours per-class reflex expert rows.
   *  - reaction-time: PERCEPTION=E (their 45044) — ours guardian perception expert@7; the extra
   *    reaction is the record's extraReaction overlay row (batch-18 fix), read at build.ts and
   *    rendered on the VitalsRail.
   *  - expert-tactician: CLASS_DC=E — ours commander classDc expert@7; the `choice` kind is their
   *    two "Select a Tactic" ABILITY_BLOCK selects (traits Tactic, level max 7), which ours delivers
   *    as the folio lanes commanderFolioMax (5+2@7) and commanderMaxTier ('expert'@7) in build.ts —
   *    the same +2-tactics-at-expert-tier the selects encode. Warfare Lore master is the record's
   *    skillProgression overlay row (batch-18 fix).
   */
  'expert-spellcaster': ['spellcasting', 'classDc'],
  'expert-necromancy': ['spellcasting'],
  'expert-runes': ['classDc'],
  'kinetic-expertise': ['classDc'],
  'reflex-expertise': ['save'],
  'reaction-time': ['perception'],
  'expert-tactician': ['classDc', 'choice'],

  /*
   * BATCH 18 — ADVANCED UNDEAD BENEFITS, unpacked. Their daywalker (feat 28681) and
   * grave-mummification (feat 28669) each run giveAbilityBlock physical-feature 28471 "Advanced
   * Undead Benefits", whose own ops are: giveAbilityBlock sense 20769 Darkvision; addBonusToValue
   * SAVE_FORT +2 circumstance "vs disease and poison"; adjValue RESISTANCES "poison, {{level/2}}";
   * +1 circumstance SAVE_FORT/REFLEX/WILL vs paralyzed/sleep. Ours delivers the SAME package on the
   * record itself (batch-18 fixes): senses [{name:'darkvision'}] + resistances
   * [{type:'poison', value:'max(1,floor(@actor.level/2))'}] overlay rows (read by the feat defence
   * lanes into derive), and the two save stars in FEAT_SITUATIONAL (the grave-mummification /
   * ghostly-grasp shape). grave-mummification additionally carries the bound-terrain resistance row.
   * The container record itself is not a thing a character owns — the benefits are.
   */
  'daywalker': ['grantsRecord'],
  'grave-mummification': ['grantsRecord'],

  /*
   * DEVOUT BLESSING — three kinds, three carriers, all confirmed live:
   *  - grantsRecord: their giveAbilityBlock class-feature 31244 "Blessing of the Devoted" is a select
   *    over the three Blessed Armament/Shield/Swiftness blocks; ours is the record's `choice`
   *    (flag divineAlly, ownsFeature:true — batch-18 fix) whose answer puts the chosen blessed-*
   *    classFeature into ownedFeatureIds (derive.ts choiceOwnedFeatureIds), where landSpeedBonus /
   *    shieldReinforcingByLevel / modeAdjust read it.
   *  - conditional + hp: their `conditional IF FEAT_NAMES INCLUDES "champion resiliency" THEN
   *    adjValue MAX_HEALTH_BONUS = 3` — the resiliency family; ours holds it once on
   *    feats['champion-resiliency'].maxHpBonus {perArchetypeFeat:3, archetype:'champion'} and
   *    devout-blessing carries archetype:'champion'. Owner ruling 2026-08-22.
   */
  'devout-blessing': ['grantsRecord', 'conditional', 'hp'],

  /*
   * MEDIUM'S AWARENESS — their three level-gated conditionals (IF LEVEL < 12 -> PERCEPTION +2
   * status "to Seek and for initiative"; 12-19 -> +3; 20 -> +4) are the LADDER inside our single
   * star: FEAT_SITUATIONAL['mediums-awareness'] targets perception with bonus
   * "+2 status (+3 at 12th, +4 at 20th)" (retargeted from initiative in the batch-18 fix — the
   * initiative popup still lists it by delegation, explain.ts builds Initiative from Perception).
   * The `unmapped` kind is their conditional wrapper, which carries no separate mechanic.
   */
  'mediums-awareness': ['unmapped'],

  /*
   * DOMAIN SPIRIT — their giveAbilityBlock -> ability_block 21087 "Domains" is a 37-option select
   * whose options' operations arrays are ALL EMPTY (reference text), plus a FILTERED spell select.
   * Ours: feats['domain-spirit'].focusPoolBonus 1 + effectChoices (16 domain options, each
   * grant.focusSpells [the domain's initial spell]) — the pick grants the actual spell where their
   * side grants prose. Same shape as the deitys-domain settle in SETTLED_IDENTITIES.
   */
  'domain-spirit': ['grantsRecord'],

  /*
   * DOMINION EPITHET — their current row 38691 is a 6-option PREDEFINED select whose options run
   * giveAbilityBlock feat grants (their stale 28637 row with Hefty Hauler / Underwater Marauder is
   * pre-errata and matches no print). Ours: classes/exemplar.extraChoices[id='dominion-epithet']
   * {pickByLevel {"7":1}} with grantedChoiceFeats mirroring their options' grants exactly
   * (born-of-the-bones-of-the-earth -> energized-spark earth/fire, dancer-in-the-seasons ->
   * cold/fire/void/wood, of-verse-unbroken -> sonic/vitality, restless-as-the-tide -> cold/water, …).
   */
  'dominion-epithet': ['choice', 'grantsRecord'],

  /*
   * SPIRIT STRIKING — their proficiency-gated ladder (conditional IF SIMPLE_WEAPONS EQUALS E/M/L ->
   * ATTACK_DAMAGE_BONUS 2/3/4 "spirit damage") is ours as a FIELD:
   * classFeatures['spirit-striking'].strikeDamage [{type:'spirit', appliesTo:'all',
   * byStrikeProficiency:{expert:2, master:3, legendary:4}}] (effect-backfill row), read by the
   * strike-damage lane per Strike proficiency.
   */
  'spirit-striking': ['conditional', 'weapon'],

  /*
   * STONEBOUND MAGIC — their block: giveSpell INNATE Scatter Scree unconditional, then THREE
   * `conditional IF LEVEL >= 8/10/12` each wrapping one giveSpell (One with Stone / Shape Stone /
   * Wall of Stone, casts 1), then `IF LEVEL >= 12 -> SPELL_ATTACK=E + SPELL_DC=E`. Ours:
   * feats['stonebound-magic'].innateSpells with minLevel 8/10/12 on the three leveled grants
   * (batch-18 fix; build.ts level-gates each grant), and build.ts already applies
   * maxRank(..., level >= 12 ? 'expert' : 'trained') to EVERY innate entry — the same T->E@12.
   */
  'stonebound-magic': ['conditional', 'spellcasting'],

  /*
   * QUICK CLIMB — their `conditional IF SKILL_ATHLETICS EQUALS L THEN bindValue SPEED_CLIMB =
   * (land Speed)` is ours as feats['quick-climb'].speedsIf
   * [{skill:'athletics', rank:'legendary', speeds:{climb:'@actor.speed.land'}}] (overlay row). The
   * modifiesGrant kind is their conditional-on-proficiency wrapper; the +5/+10-foot success rider is
   * prose on BOTH sides (their injectText, our description).
   */
  'quick-climb': ['modifiesGrant'],

  /*
   * AEON STONE (SMOOTHING) — their MAX_HEALTH_BONUS is a PROSE SLOT, not Hit Points.
   * Theirs (item 6684): select{title:"Is this granting the resonant power?",optionType:CUSTOM}
   *   "No"  -> addBonusToValue{variable:"MAX_HEALTH_BONUS", value:null, type:"", text:"You can ignore
   *            status penalties to skill checks from clumsy, enfeebled, frightened, sickened, and
   *            stupefied conditions as long as the value of that condition is 1."}
   *   "Yes" -> that same op + giveSpell{spellId:4649, type:"INNATE", rank:0, tradition:"OCCULT"}
   * value null, empty type, meta_data hp/hp_max 0: the variable carries text, not a number. GM Core
   * p.284 (equipment-3055-2978) prints no Hit Points for this stone. Their 4649 is Guidance, rank 0,
   * and carries no `casts` — at-will, where the Delaying stone's giveSpell carries casts:1.
   * Ours says both halves as fields: situational[{targets:[{kind:'skill',detail:'all'}], when:"you are
   * clumsy 1, enfeebled 1, frightened 1, sickened 1, or stupefied 1", bonus:"ignore that condition's
   * status penalty to skill checks (value 1 only)"}] and resonant{note, innateSpells:[{spellId:
   * 'guidance', tradition:'occult', rank:0}]} (effect-backfill).
   */
  'aeon-stone-smoothing': ['hp'],

  /*
   * BASE KINESIS — we hold TWO records under this id and the comparer is reading the wrong one.
   *
   * `feats/base-kinesis` is the Kineticist Dedication feat, *"You gain the Base Kinesis impulse"*, and
   * it now carries `grantsClassFeatures: ['base-kinesis']` (read by ownedFeatureIds, derive.ts:3088).
   * `classFeatures/base-kinesis` is the IMPULSE ITSELF — the thing granted — and it is what this
   * finding compares, against their archetype-feat row, because the classFeatures bucket pairs against
   * `class-feature` ∪ `feat` rows. A record cannot grant itself; the grant is on the feat, where the
   * printed sentence is.
   */
  'base-kinesis': ['grantsRecord'],

  /*
   * EXPANDED DOMAIN INITIATE — the `deitys-domain` case again (see SETTLED_IDENTITIES).
   *
   * Their `giveAbilityBlock` points at `feat/Domains`, a CONTAINER holding their domain list. Ours is
   * an `effectChoices` domain picker plus `focusPoolBonus: 1`, which is why our kinds already read
   * [spellcasting, focus, choice, spell]: the player picks the alternate domain and receives its
   * initial domain spell and the focus point. Only the carrier differs — a container on their side,
   * a resolved pick on ours.
   */
  'expanded-domain-initiate': ['grantsRecord'],

  /*
   * WORMSKIN — their carrier is an ITEM, ours is the resistance itself.
   *
   * The standing translation at the top of this file covers it: their `giveItem` hands you a skin
   * item, and ours is `effectChoices` whose three options each grant
   * `resistance max(1,floor(@actor.level/2))` of the chosen type — which is the printed clause,
   * *"resistance equal to half your level versus one of the following types"*. Our kinds already read
   * [defense], so the mechanic is present; only the vessel differs.
   */
  'wormskin': ['grantsItem'],

  /*
   * MANIPULATIVE CHARM — their `spellcasting` op is a proficiency step ours reaches another way.
   * Ours ships the innate charm plus its spell notes and the level-gated proficiency, which is why our
   * kinds read [spell, note, conditional, skill]; three independent refuters built a character and
   * watched the whole chain fire. Nothing of theirs is unmodelled.
   */
  'manipulative-charm': ['spellcasting'],

  /*
   * ⚠ SHOONY LORE IS NOT SETTLED — IT IS AN OPEN OWNER QUESTION. This entry carried no justification
   * at all, and was the ONLY one left bare once the settle audit's comment reader was fixed (it had
   * been clearing a shared block after the first entry beneath it, so 22 well-grounded settles were
   * also reporting empty). Reading this one showed the settle is not true.
   *
   * Their `giveAbilityBlock` hands over the ADDITIONAL LORE feat (their block #19873), not a bare Lore
   * training: *"Choose a Lore skill subcategory. You become trained in it. At 3rd, 7th, and 15th
   * levels, you gain an additional skill increase you can apply only to the chosen Lore subcategory."*
   * Shoony Lore's own text says only *"You also become trained in Shoony Lore."* Ours trains
   * Diplomacy, Survival and Shoony Lore — the three the text names — with `redundantFallback` for the
   * "you would already be trained" clause.
   *
   * Adopting theirs would give every shoony three skill increases the book does not grant, and would
   * let the Lore be any subcategory rather than Shoony. That is the owner's call, recorded in
   * work/owner-questions.json. The kind stays listed so the batch gate does not re-report a
   * difference already written down and awaiting a ruling — it is NOT a claim of equivalence, and it
   * comes out the moment he rules either way.
   */
  'shoony-lore': ['grantsRecord'],

  /*
   * Their carrier is a "Scaly Hide" ITEM (ac_bonus 1, dex_cap 3, plus a LEVEL>=5 conditional raising
   * AC_BONUS to 2); ours is the `unarmoredAc` field, the natural-armour lane derive.ts reads as an
   * item bonus, with the same numbers and the same bonus type. Only the CARRIER differs, which is what
   * this settles.
   *
   * (This comment used to end "the stacking exception is unbuilt". It is built: `unarmoredAc.cumulative`
   * pools the bonus apart from the competing item slot so it ADDS to a potency rune, exactly as the feat
   * prints — and `scales-of-steel` and `scales-of-the-dragon`, which print the same sentence, now carry
   * the flag too.)
   */
  'scaly-hide': ['grantsItem'],
  /*
   * "You gain a thorns unarmed attack that deals 1d6 piercing damage. Your thorns are in the knife
   * weapon group and have the finesse and unarmed traits." Their carrier is item 13068 "Hidden
   * Thorn"; ours is `grantedStrikes` with those exact dice, group and traits. Note that 13068 DOES
   * carry the Unarmed trait (2398), so the giveItem→weapon rule already maps it and the record lands
   * in AGREE — this entry currently suppresses nothing (unlike made-for-combat, whose three items
   * lack the trait).
   */
  'hidden-thorn': ['grantsItem'],
  /*
   * "For the next minute, you gain two unarmed attacks." A temporary attack cannot be a
   * `grantedStrikes` on the record, so it is a toggle: the two live on
   * `core.stances['howling-aspect']` and on the catalog mode `cat-howling-aspect` in
   * src/rules/modes.ts, both gated on this feat and asserted in test/batch8-parity.test.ts.
   * wg-diff's `ourKindsOf` already reads both carriers, so ours computes `weapon` on its own and
   * this entry no longer suppresses anything.
   */
  'howling-aspect': ['weapon'],
  /*
   * *"You gain a single arcane or occult cantrip … If you weren't already, you become trained in that
   * tradition's spell DCs and spell attack rolls."* The cantrip is a spell picker granting an at-will
   * innate; the proficiency half is ENGINE-WIDE (Player Core p.298 — gaining an innate spell trains
   * you in its DC and attack, expert at 12th), not a field on the record. Same reason as the innate
   * entry below. Their `conditional` is the tradition gate our picker's own filter applies.
   */
  /*
   * *"You gain Speak with Animals as a primal innate spell that you can cast once per day."* The innate
   * grant is authored; the spell DC and attack come from the engine, and a built samsaran really has
   * them — asserted in test/batch8-parity.test.ts at both trained and the 12th-level expert step.
   */
  'animal-soul-siblings': ['spellcasting'],
  /*
   * All three unarmed attacks ship as `grantedStrikes` with the printed dice, group and traits. Their
   * three items (16613 Blade / 16614 Spoke / 16615 Wrap) carry only the PRINTED traits and not the
   * Unarmed trait, so the giveItem→weapon rule above cannot recognise them. Measured: the trait is
   * present on 236 of their 339 giveItem targets, absent here — their data, not ours.
   */
  'made-for-combat': ['grantsItem'],
  /*
   * Their row encodes "When you roll a success against a fear effect, you get a critical success
   * instead" on all three saves — which IS printed under this name, but only in the LEGACY Order of
   * the Scourge (hellknight-order-7, Lost Omens Character Guide p. 83). Our record is the Hellfire
   * Dispatches reprint (hellknight-order-14), whose lesser order benefit was rewritten into the
   * 1-action Strike that reduces allies' frightened and prints no degree shift. Two printings of one
   * benefit, not a clause we dropped.
   */
  'fear-no-law-fear-no-one': ['save'],

  /* ---- batch 002's tail, read 2026-08-18 ---------------------------------------------------- */
  /*
   * Their `giveAbilityBlock` points at `feat/Domains` — a container record that exists to hold their
   * domain list, not a mechanic. Ours is `choice: {kind: 'domains'}` plus domains.ts resolving the
   * chosen domain's initial spell, and `focusPoolBonus: 1` for its pool point.
   */
  'deitys-domain': ['grantsRecord'],
  /*
   * Their Foxfire select offers two options — items 13814 (electricity) and 13815 (fire) — both
   * weapon-group but carrying only the Kitsune and Magical traits and no Unarmed trait, so their
   * giveItem→weapon rule cannot see them as attacks. Ours ships all THREE printed damage options as
   * `grantedStrikes`, including the cold one their feat never offers.
   */
  foxfire: ['grantsItem'],
  /*
   * Their `createValue DRAGONBLOOD_ASPECT = "claw"` is PLUMBING: a variable whose only reader is
   * feat/Deadly Aspect (measured — one reader in the whole dump). We solve the same problem without a
   * variable, because `deadly-aspect` ships `unarmedTraits: {match: ['claw','jaws','tail'], add:
   * ['deadly-d8']}` and Draconic Aspect grants only the one strike the player chose, so matching all
   * three hits exactly the one they have.
   */
  /*
   * The four facts their `defineCastingSource RANGER/PRIMAL/ATTRIBUTE_WIS` + `SPELL_ATTACK/DC = T`
   * state are produced by the engine, not written on the record, so no field can show them. Pinned by
   * test/initiate-warden-focus.test.ts: primal, wis, trained, and a pool of at least 1.
   */
  'initiate-warden': ['spellcasting'],
  /*
   * Already modelled, and more faithfully than theirs: the animist branch of the focus-pool block
   * (build.ts:3446-3457) takes the HIGHER of the 1/7/15 apparition ladder and the count of
   * focus-trait spells known, capped at 3 — the printed Special clause verbatim. Their encoding is a
   * single unconditional `adjValue FOCUS_POINT_BONUS = 1`. ⚠ The gate reads `build.featPicks`, so a
   * Liturgist animist — granted this feat by FEAT_FEAT_GRANTS['liturgist'] rather than picking it —
   * never reaches the clause.
   */
  'circle-of-spirits': ['focus'],

  /* ---- batch 004, read 2026-08-18 ------------------------------------------------------------ */
  /* Their "Awakened Animal Attacks" is a CONTAINER block listing the attacks; ours is the choice
   * itself plus the grantedStrikes behind it. */
  'tooth-and-claw': ['grantsRecord'],
  /*
   * Their "Mountain Stance" item packages the stance as gear (ARMOR/unarmored_defense, ac_bonus 4,
   * dex_cap 0), alongside a separate falling stone weapon item; ours is `grantedStrikes: Falling
   * Stone` on the feat plus `stances.mountain-stance` carrying acBonus +4 item, dexCap 0 and
   * speedPenalty 5. ⚠ Their item also writes the printed +2 circumstance bonus onto
   * SAVE_FORT/SAVE_REFLEX/SAVE_WILL; ours states it only in the stance's prose `note`, so that half
   * is displayed, not computed.
   */
  'mountain-stance': ['grantsItem'],
  /* A monk focus entry, produced by the engine rather than written on the record — the same shape as
   * initiate-warden, whose primal/Wis/trained entry is pinned by test/initiate-warden-focus.test.ts.
   * ⚠ The entry's TRADITION is no longer engine-decided: *"When you gain your first qi spell, you
   * decide whether your qi spells are divine or occult spells"* is a real player choice as of the
   * owner's 2026-08-19 ruling (`build.qiTradition`). Theirs hard-codes divine, ours hard-coded occult,
   * and the book chooses neither. Pinned by test/owner-rulings-qi-and-scale.test.ts. */
  'qi-spells': ['spellcasting'],
  /*
   * Printed: *"Choose one item of light Bulk to be your pusaka. It becomes a magic item that has the
   * occult trait."* Theirs hands over a new "Pusaka" item (item 16240, itself carrying no
   * operations); ours grants no item, because the text converts one the character already owns and
   * inventing one would put a phantom item in the bag. ⚠ Ours does not record WHICH item either —
   * the only trace is the inert note on the `pusakaLore` text choice telling the player to decide.
   */
  'inherit-the-dreaming-heirloom': ['grantsItem'],
  /* "domains" is their container record, as on deitys-domain; ours is a 4-pick domain choice. */
  'splinter-faith': ['grantsRecord'],
  /* Their scales are an ITEM; ours is `unarmoredAc`, the natural-armour field built in this batch and
   * applied as an AC item bonus while unarmored (test/natural-armour.test.ts). */
  'scales-of-steel': ['grantsItem'],
  /* Their yes/no select asks whether the automaton enhancement is active; ours is the enhancement
   * system, which gates the tier across every automaton feat rather than per record. */
  'undead-hunter': ['choice'],
  /* ---- batch 005, read 2026-08-18 ------------------------------------------------------------ */
  /* The innate spellcasting proficiency is engine-wide (Player Core p.298, "at 12th level these
   * proficiencies increase to expert"), applied in build.ts for every character — so no field on this
   * record can carry it. Same reading as pantheon-magic. */
  'awakened-magic': ['conditional', 'spellcasting'],

  /* ---- batch 006, read 2026-08-18 ------------------------------------------------------------ */
  /* Their `createValue WEAPON_LONGSWORD/BATTLE_AXE` is plumbing for their own picker; ours is the
   * record's `choice` plus a FEAT_GRANTS entry, and the Shield Block reaction is granted outright. */
  'viking-shieldbearer': ['specialStat'],
  /* Their Coerce clause is written onto SAVE_WILL, but nothing about it is a save — it changes the
   * OTHER creature's Intimidation check. Ours is a skill situational, which is what it is. */
  /* `UNBURDENED_IRON = true` is their own bespoke variable. Ours is `speedAdjust`, which states the
   * printed rule outright: ignore armour's Speed penalty, and reduce any other Speed penalty by 5. */
  'unburdened-iron': ['unmapped'],
  /* "domains" is their container record, as on deitys-domain and splinter-faith; ours is a domain
   * picker plus the focus pool point. */
  'domain-initiate': ['grantsRecord'],
  /*
   * `createValue BONE_MAGIC_TRADITION` is their own bespoke variable; the cantrip select beside it
   * hard-codes its tradition per option, and the only readers are Bone Investiture and Fossil Rider,
   * whose innate spell branches occult/primal on it — the feat's printed Special clause. Ours is the
   * record's `choice` (flag `boneMagicTradition`), read both by
   * FEAT_CANTRIP_GRANTS['bone-magic'].traditionFromChoiceFlag and by those same two downstream
   * feats.
   */
  'bone-magic': ['specialStat'],
  /* The innate spellcasting proficiency is engine-wide (Player Core p.298), so no field on the record
   * can carry it — the same reading as pantheon-magic and awakened-magic. */
  'awakened-jewel': ['spellcasting', 'conditional'],
  /* Their tail is an ITEM and their Enhancement a yes/no select; ours is a `grantedStrikes` entry and
   * the automaton enhancement system, which gates every automaton feat's tier in one place. */
  'powerful-tail': ['grantsItem', 'choice'],

  /*
   * Its text grants no casting at all: the printed feat (AoN feat-3486, Book of the Dead p.34) only
   * makes *animate dead* a signature spell for a spontaneous caster who already has it, and lets a
   * prepared caster spend 10 minutes swapping a prepared slot for it. Their row is the remaster
   * wording (*summon undead*) for the same two clauses, and their `defineCastingSource
   * REANIMATOR/ARCANE/INT` invents a casting source the feat never grants.
   */
  'reanimator-dedication': ['spellcasting'],
  /*
   * The settled `spellcasting` kind is carried by our `spellcastingGrant` (occult / Int / trained),
   * which answers their SPELL_ATTACK, SPELL_DC and defineCastingSource ops. The
   * Astronomy-or-Occultism choice and the two printed repertoire cantrips (detect magic, guidance,
   * know the way, read aura) ship as `effectChoices`, which grant them as at-will innate occult
   * spells rather than as a repertoire.
   */
  'oatia-skysage-dedication': ['spellcasting'],
  /* Their "Basic Undead Benefits" is a CONTAINER block. Ours expands it inline on the record —
   * `immunities`, `grantsCreatureTraits: ['undead','zombie']`, the -5 Speed and the jaws strike. */
  /* Their pre-modified fist ITEM vs our `unarmedTraits` rider stepping the die and adding parry, which is
   * what the feat prints ("changes to 1d6 INSTEAD OF 1d4"). */
  /*
   * SPIRIT WARRIOR DEDICATION — their pre-modified fist ITEM against our unarmed rider on the fist the
   * character already has. RE-SETTLED after a real divergence: ours used to strip nonlethal and stop,
   * leaving the fist at 1d4 with no parry. It now sets d6 and adds parry, so the two fists match and
   * only the vehicle differs. Granting a second fist item would give the character two.
   */
  'spirit-warrior-dedication': ['grantsItem'],
  /* `spellSlotBonus: { cantrips: 2 }` — exactly the printed "two additional cantrips". */
  'cantrip-expansion': ['spellSlot'],
  /*
   * Their only `hp` op sits inside a conditional gated on FEAT_NAMES including "barbarian
   * resiliency" and adds +3 MAX_HEALTH_BONUS — Barbarian Resiliency's Hit Points parked on the
   * dedication row, not the dedication's own. The printed Barbarian Dedication grants no HP, and we
   * carry those Hit Points on `barbarian-resiliency` itself as `maxHpBonus: { perArchetypeFeat: 3,
   * archetype: 'barbarian' }`.
   */
  'barbarian-dedication': ['hp'],
  /* The two skill feats are gated on the immanence being active, so they ship as a `situational` rather
   * than an unconditional grant — granting them outright would hand them over outside immanence. */
  /* The two extra tactics live in `counterMods.ts`, which the kind scan does not read for this shape. */
  'tactical-expansion': ['conditional', 'choice'],
  /*
   * Ours is feat-8812 (level 2, Hellfire Dispatches): the scaling mental resistance as
   * `@actor.archetypeFeats.hellknight + 1`, the order choice, Additional Lore, and Intimidation via
   * `conditionalSkills` in featGrantsAuto.ts. The row the name-keyed pairing picks is their LEVEL-6
   * Hellknight Dedication, whose conditional/ac ops are a Sentinel-style light/medium/heavy
   * armour-proficiency ladder from that feat's own printed text — a different feat sharing the name,
   * not a rule ours omits.
   */
  'hellknight-dedication': ['conditional', 'ac'],
  /*
   * The fly-Speed increase ships as `speedAdjust: { key: "fly", add: 5 }` and the Leap half as a
   * `situational`. Their row holds a single op — a conditional gated on `SPEED_FLY > 0` that adds 5
   * to SPEED_FLY — and encodes the Leap increase not at all.
   */
  'winged-warrior-dedication': ['speed'],
  /*
   * Their one `giveItem` is the "Pyrotechnic Versatile Vials" item; ours is `advancedAlchemy: {
   * items: 4 }` — the printed 4 are made during daily preparations, not handed over — plus the
   * Launch Fireworks action and the Fireworks Lore conditional in featGrantsAuto.ts. Their separate
   * "Quick Alchemy Benefits" block is a giveAbilityBlock container, not the item op settled here.
   */
  /*
   * FIREWORK TECHNICIAN DEDICATION — their pyrotechnic vial ITEM against our vial COUNTER. RE-SETTLED
   * after a real divergence: ours granted an Advanced Alchemy budget the feat never mentions and no
   * vials at all. Ours is now the versatile-vials counter in classResources.ts (maxBase 4, gated on
   * this feat). A daily consumable resource is a counter here and an item there.
   */
  'firework-technician-dedication': ['grantsItem'],

  /* ---- batches 002/003/005/006/008: CLASS CHASSIS, read 2026-08-19 ---------------------------
   *
   * Every entry below was read against the printed text and then traced to the code that implements
   * it. What they have in common is WHERE our implementation lives: a class resource, a toggle mode,
   * a derive-time rider, a build-time slot computation — none of which is a field on the record, and
   * none of which this comparer can see by reading `core.json`. The `subclass.featureId` and
   * `extraChoices[].featureId` crediting above covers the cases where the mechanic is DATA on the
   * class; these are the cases where it is CODE, and code has no id to match on.
   */

  /*
   * Their grants are not flat and not unconditional: a PREDEFINED select offers Single Gate / Dual
   * Gate, and the six impulse junctions appear only inside the Single Gate branch's element options
   * — Dual Gate grants elements alone, matching the printed paragraphs. Ours states the same rule
   * from `classes.kineticist.extraChoices[element]` (six *-gate options carrying the printed
   * junction) with `impulseJunctionIds()` in explain.ts gating on `gates.length === 1`, so only the
   * shape of the encoding differs and there is nothing to adopt.
   */
  'kinetic-gate': ['grantsRecord'],
  /*
   * The oracle's CURSEBOUND condition. Ours is a class resource carrying the level ladder —
   * classResources.ts `oracle`, `kind: 'counter'`, `meter: true`, `maxAtLevels:
   * [[1,2],[11,3],[17,4]]` — plus the four cursebound modes. Their row creates a bare `CURSEBOUND`
   * at 0 and grants Cursebound One and Two only, with no ladder to 3 and 4, so ours is the more
   * complete of the two.
   */
  mystery: ['specialStat'],
  /* *"While wearing medium or heavy armor, you gain resistance to physical damage equal to 1 + half
   * your level."* Ours: `modes['guardians-armor']`, from scripts/data/toggle-modes.json, with
   * `resistances: [{ type: 'physical', value: '1+floor(@actor.level/2)' }]`, `duration: "while wearing
   * medium or heavy armor"`, and the rest-in-armour clause in its note. A toggle mode rather than a
   * field on the feature, so no `defense` field exists to read. */
  'guardians-armor': ['defense'],
  /* *"Choose either shields of the spirit or a spell based on your deity's divine font … Your devotion
   * spells are divine spells. Your spellcasting attribute is Charisma."* Both halves are code:
   * `championDevotionSpell()` in build.ts resolves the choice from the deity, and the casting entry is
   * built from `champion: { tradition: 'divine', key: 'cha' }`. */
  'devotion-spells': ['spellcasting', 'choice'],
  /* *"It costs 1 Focus Point to cast a focus spell, and you start with a focus pool of 1 Focus Point."*
   * The animist's pool is computed by name in build.ts — `poolMax = 1 + (level>=7) + (level>=15)`, with
   * the Circle of Spirits branch — because it does NOT follow the general "one point per point-costing
   * focus spell" rule. A `focus` field on the record would be read by nothing. */
  'animist-apparition-spellcasting': ['focus'],
  /*
   * The animist pool is computed by name in build.ts (`poolMax = 1 + (level>=7) + (level>=15)`, then
   * the Circle of Spirits clause and `featPoolBonus`), because it does NOT follow the general
   * one-point-per-point-costing-spell rule. A `focus` field on the record would be read by nothing.
   */
  /*
   * RESTORED after a removal marker — the removal reason ("the Medium's Dual Invocation now raises
   * the focus pool from 9th") was about a DIVERGENCE that got fixed; it was never a reason their
   * FOCUS_POINT_BONUS op would stop reporting as a kind, and dropping the key made this the only
   * missing=[focus] row in the corpus. Their op sits on the Medium option inside `conditional IF
   * LEVEL >= 9 AND FEAT_NAMES NOT_INCLUDES "circle of spirits"` — their flat +1 approximation of
   * Dual Invocation, whose level gate and non-stacking guard mirror our build.ts branch. Ours
   * implements the printed "whichever is higher (maximum 3)" clause in buildCharacter's animist
   * focus-pool branch (the `subclassId === 'medium' && level >= 9` clause and the Math.min(poolMax,3)
   * cap), which is MORE faithful than their flat +1 — and a `focus` field on the core.json record
   * would be read by nothing, the same reasoning as 'animist-apparition-spellcasting' above.
   */
  'animistic-practice': ['focus'],
  /* *"You gain your choice of the Animal Empathy or Plant Empathy druid feat."* A two-way pick with its
   * own build field (`build.voiceOfNature`) and its own picker, granting the chosen feat at build.ts —
   * not an options array on the record. */
  'voice-of-nature': ['choice'],
  /* *"Healing Font: You gain 4 additional spell slots each day at your highest rank of cleric spell
   * slots … 5 at 5th level … 6 at 15th."* Ours is `entry.font = { type, slots, rank }` in build.ts with
   * `fontSlots = level>=15 ? 6 : level>=5 ? 5 : 4`, restricted to heal/harm and gated on the deity's
   * own font. All four kinds they flag are that one computation. */
  'divine-font': ['spellcasting', 'choice', 'grantsRecord', 'spellSlot'],
  /*
   * *"You begin play with a folio containing five tactics from the list"* and *"you prepare three
   * tactics from your folio"*. Ours is `build.commanderTactics` fed by `commanderTacticOptions` and
   * `commanderFolioMax` (5, +2 each at 7/15/19), with `commanderMaxTier(level)` gating which tier
   * may be learned and `preparedMax: 3` on the built entry — a prepared-list subsystem rather than
   * an options array, so there are no option labels to match.
   */
  tactics: ['choice'],
  /* Reaper's Edge *"you become an expert in martial weapons"* at 11th and the AC half at 13th are
   * level rows in advancement.ts, not fields on the record; the level-1 trained halves ARE data and are
   * credited by the subclass-option rule above. The `conditional` is their per-level branch on the
   * same two clauses. */
  'fatal-method': ['ac', 'conditional'],
  /* *"Each day, you can prepare an extra cantrip from your curriculum. You also gain an extra spell
   * slot at each spell rank …. You can prepare only spells from your school's curriculum in these
   * extra slots."* Deliberately NOT a plain +1: ours is a RESTRICTED slot per rank carrying the
   * curriculum's `allowed` list (build.ts), plus `cantripsKnown('wizard') = CANTRIPS_KNOWN + 1`. The
   * `conditional` is the School of Unified Magical Theory branch (`isUmt`), which is also code. */
  'arcane-school': ['conditional', 'spellSlot'],
  /* *"During your daily preparations, you can create a number of versatile vials up to 2 + your
   * Intelligence modifier"* — a daily-refreshed RESOURCE, not inventory. Ours: classResources.ts
   * `alchemist` → `{ id: 'versatile-vials', kind: 'counter', refresh: 'rest', maxBase: 2, maxAbility:
   * 'int' }`. Their four tiered vial items implement *"a vial you create is always the highest type you
   * could Craft"* by shipping one item per tier; that tiering is their implementation detail and the
   * printed text names no tiered items. */
  alchemy: ['conditional', 'grantsItem'],
  /* *"You deal 2 additional damage on melee Strikes."* Ours is `RAGE_DAMAGE` in derive.ts with the
   * per-instinct scaling their record lacks, applied by `rageStrikeRider()` and gated on the Rage
   * resource being active and the Strike being melee. Theirs is a flat `RAGE_DAMAGE = 2` variable. */
  rage: ['specialStat'],
  /* *"The damage die for your fist increases to 1d6 instead of 1d4. You don't take the normal –2
   * circumstance penalty when making a lethal attack…"* Ours is `fistDieUpgraded` in derive.ts, which
   * swaps the Fist profile's die to d6 and drops `nonlethal` — both printed halves. Theirs is a
   * synthetic unselectable "Powerful Fist" item standing in for the die swap. */
  'powerful-fist': ['weapon'],
  /* The inventor's armour innovation. Their "specialStat" is an engine-internal `INVENTOR_ARMOR`
   * boolean; ours is `build.inventorArmorStats`, which gates the modifications. The printed stat line
   * (Table 2-2: AC +2, Dex cap +4, check −1, Speed —, Str 0, Bulk 1, composite) is on
   * `items['subterfuge-suit']` and matches the book. */
  'subterfuge-suit': ['specialStat'],
  /*
   * MERCHANT'S SCALE — owner ruling, 2026-08-19: do not adopt their +1. Both mirror docs
   * (equipment-2734, equipment-34) are stat-block stubs (`text` ends at `Bulk L ---`, `skill_mod`
   * `{}`), and their seven `addBonusToValue` ops each carry the Recall-Knowledge condition in their
   * own text, but that sentence exists only in their GPL-3.0 dump, which is a differ and never a
   * source. work/wg-lane-backlog.md records the same no-copy rule while explicitly calling the empty
   * description a still-open gap needing the physical Player Core pg. 290 — so this settle closes
   * the +1, not the description.
   */
  'merchants-scale': ['skill'],
  /*
   * *"Choose one cantrip from the divine spell list. You can cast this cantrip as a divine innate
   * spell at will. A cantrip is heightened to a spell rank equal to half your level rounded up."*
   * Their row carries no casting-source op: the `conditional` is `LEVEL >= 12 →
   * SPELL_ATTACK/SPELL_DC expert, else trained`, and the `spellcasting` kind is those same adjValues
   * — a generic innate-caster ladder this feat does not print, which our engine already applies to
   * every innate entry in build.ts. Ours is `FEAT_CANTRIP_GRANTS['pantheon-magic']` (the whole
   * common divine cantrip list) plus the innate pipeline that heightens cantrips to half level by
   * rule.
   */
  'pantheon-magic': ['conditional', 'spellcasting'],
  /*
   * SEQUESTERED SPELL — same shape as Pantheon Magic. Their `conditional` is `LEVEL >= 12 →
   * SPELL_ATTACK/SPELL_DC expert, else trained`, and the `spellcasting` kind is those same adjValues
   * — the row carries no `defineCastingSource` — so it is one generic innate-caster ladder this feat
   * does not print, already applied engine-wide in build.ts. The one thing the feat does constrain,
   * the cantrip list, is narrowed by `effectChoices[].spellFilter.traditionFromChoiceFlag =
   * 'magiphageTradition'`, answered on the surki ancestry and read by `narrowSpellFilter`.
   */
  'sequestered-spell': ['conditional', 'spellcasting'],

  /* ---- batch 009: ARCHETYPE DEDICATIONS, read 2026-08-19 -------------------------------------- */
  /*
   * THE HP THAT IS NOT THEIRS TO GRANT. Both records' only `hp` operation is a `conditional` gated on
   * `FEAT_NAMES INCLUDES "<archetype> resiliency"` — it is the RESILIENCY feat's Hit Points parked on
   * the dedication by their engine, and neither printed dedication grants a single HP. We hold both
   * correctly on the feats that print them: `feats['monk-resiliency'].maxHpBonus` and
   * `feats['exemplar-resiliency'].maxHpBonus`, each `{ perArchetypeFeat: 3, archetype: … }`.
   * Exemplar's `conditional` is that same operation; Monk's is the Acrobatics-or-Athletics clause,
   * which now lives on the skill SLOT as `redundantFallback` rather than as a record-wide flag.
   */
  'monk-dedication': ['conditional', 'hp'],
  'exemplar-dedication': ['conditional', 'hp'],
  /*
   * Their `defineCastingSource` is `LOREMASTER:::-:::ARCANE:::ATTRIBUTE_INT` — only the slot-type
   * segment is blank; it names Arcane and Intelligence and is the hanger for the archetype's focus
   * spell (their Loremaster's Etude row casts from it), but the dedication row itself grants no
   * spell and no spellcasting proficiency, and the printed feat prints no Cast a Spell, so we hold
   * nothing here. This settles the SPELLCASTING kind only.
   *
   * (The skill half of this comment used to say the legendary-Decipher-Writing upgrade was unbuilt.
   * It has since been built — `featGrantsAuto.ts` carries `crossConditionalSkills['lore:loremaster']`
   * with `whenSkill: ['arcana','occultism','religion','society']`, `whenRank: 'legendary'`,
   * `rank: 'expert'` — and the matching settle in wg-values.mjs is gone, so that row now matches on
   * its own merits.)
   */
  'loremaster-dedication': ['spellcasting'],
  /*
   * SPELLMASTER DEDICATION — the same hanger reading as `loremaster-dedication` above. Their
   * `defineCastingSource SPELLMASTER:::-:::ARCANE:::ATTRIBUTE_INT` names Arcane and Intelligence and is
   * the hanger their model needs for the archetype's LATER focus spells: Spellmaster's Ward (their
   * 29184, `giveSpell spellId 6188 FOCUS castingSource SPELLMASTER rank 5`) and Familiar Form (their
   * 29180, `giveSpell spellId 6187 FOCUS castingSource SPELLMASTER rank 4`) both cast from it. The
   * DEDICATION row itself grants no spell, no slot and no spellcasting proficiency, and printed
   * (feat-1134, Character Guide p.114) the feat prints no Cast a Spell at all — only a +2 circumstance
   * bonus to Identify Magic with a trained skill, plus the daily cantrip swap for Wayfinder Resonance
   * Tinkerer. The caster is the PREREQUISITE ("ability to cast focus spells"), so there is nothing here
   * for us to hold. The second op, `adjValue PRIMARY_SHEET_TABS = spells`, is their sheet's tab list.
   * The hanger's actual cargo is already ours on the feats that print it: `feats['spellmasters-ward']`
   * and `feats['familiar-form']` each carry `focusSpells`, and both match on their own merits. Our +2
   * is FEAT_SITUATIONAL['spellmaster-dedication'] (src/rules/situationalBonuses.ts), read by
   * `featSituationalFor` via explain.ts. This settles the SPELLCASTING kind only.
   *
   * ⚠ Do NOT re-derive this with `grep -o "SPELLMASTER:::[^\"]*"` — that returns one line (this
   * definition) and looks like proof the source is unused. Consumers name it WITHOUT the `:::`
   * segments; a plain `grep -c SPELLMASTER` over the dump returns 3.
   */
  'spellmaster-dedication': ['spellcasting'],
  /*
   * Printed: *"You learn the summon undead spell."* Their giveSpell {spellId 4878, castingSource
   * NECROMANCER, rank 1} adds it to the necromancer's preparable list. Ours needs no record field: the
   * necromancer is a prepared OCCULT caster (classes.necromancer.spellcasting.tradition = 'occult')
   * and spells['summon-undead'].traditions includes 'occult', so SpellsTab's useTraditionSpells
   * already offers it in the prepare picker at rank 1. A spellListAdditions row would be a second,
   * redundant route to a spell the picker already lists. The restricted slot the same feat grants IS
   * authored (feats/conjurer-of-corpses.spellSlotBonus, resolved through resolveRestrictedSlots).
   */
  'conjurer-of-corpses': ['spell'],
  /*
   * BATCH 17's REMAINING SETTLES — each mechanic is delivered by a carrier this comparer cannot read.
   *
   * master-summoner: their nine 1st–9th-rank options are the printed *"designate one of your spell
   * slots"*. Ours is `spellSlotBonus.restricted.rankChoice` → resolveRestrictedSlots emits
   * `rankOptions`, and SpellsTab's spontaneous branch now renders the `ms-rank-select` (guarded by
   * test/spell-access-lanes.test.ts — the settle was REFUSED while that control did not render).
   *
   * grave-strength / ghostly-grasp-ghost / numb: their giveAbilityBlock hands over a named "Advanced
   * Undead Benefits" container (rules-1695); ours authors the container's CONTENT on each record —
   * `senses: [darkvision]` + `resistances: [poison, half level]` — which is the same two mechanics
   * without the intermediary record. Readers: deriveDefenses' senses/resistances walk.
   *
   * armor-specialist: a boolean ACCESS flag, not a kind of ours — `armorSpec.anyProficient`, read by
   * armorSpecAccess (derive.ts); the per-group values live in armorSpec.ts. Same reading as the
   * NOT_A_SCALAR entries for its three variables in wg-values.
   *
   * additional-servings: their per-taking tally + injectText prose; ours is `resourceMaxSet` +
   * `maxTakable`, resolved to the printed daily maximum (build.ts resourceFloors →
   * classResources.resourceMaxFor).
   *
   * sound-mirror: their SPELL_ATTACK/SPELL_DC 'T' ops are the innate-casting floor every innate
   * caster already has (build.ts innate entry: trained, expert at 12+, cha fallback) — a
   * spellcastingGrant row was checked and REJECTED because via the tradition-matched profile lookup
   * it can lower a multi-archetype character's innate entry from expert to trained.
   *
   * psi-development: their unique/standard two-branch select is ours as the archetype cantrip picker
   * widened by `spellListAdditions` (entryId-scoped) + the extra known cantrip
   * (`spellSlotBonus.cantrips`); which of the six unique cantrips is legal for THIS character is the
   * menu-filtering that is ours to decide.
   */
  'master-summoner': ['choice'],
  'grave-strength': ['grantsRecord'],
  'ghostly-grasp-ghost': ['grantsRecord'],
  'numb': ['grantsRecord'],
  'armor-specialist': ['conditional', 'ac'],
  'additional-servings': ['specialStat', 'unmapped'],
  'sound-mirror': ['spellcasting'],
  'psi-development': ['choice'],
  /* *"You also become trained in Fortune-Telling Lore, and you learn the harrowing ritual."* No Cast a
   * Spell grant anywhere in the feat. Their casting source exists only as a hanger for the ritual; ours
   * is `grantsRituals: [{ spellId: 'harrowing' }]`, which is what the sentence actually says. */
  'harrower-dedication': ['spellcasting'],
  /* Their `giveSpellSlot` is two rank-0 slots at every level — the PREPARED CANTRIPS PER DAY, which we
   * model as two `effectChoices` cantrip pickers. *"You can prepare two cantrips each day from your
   * spellbook."* The spellbook itself now ships as `grantsItems`. */
  'spellshot-dedication': ['spellSlot'],
  /*
   * Their four "Sterling Dynamo Prosthesis" rows are pseudo-items holding the attack — the two
   * automatic ones are `category: unarmed_attack`, the two manual ones are `category: simple`. The
   * printed text calls it *"a dynamo melee unarmed attack"* in every case, the AoN mirror holds no
   * equipment record for it, and ours is four `grantedStrikes` keyed by the same four-way choice
   * (power/percussive × automated/manual) with the printed dice (1d6/1d8/1d4/1d6).
   */
  'sterling-dynamo-dedication': ['grantsItem'],
  /* *"…and the basic undead benefits."* Their `grantsRecord` points at the "Basic Undead Benefits"
   * block; ours INLINES it — and since the 2026-08-19 flip the inlined package matches rules-1694
   * clause for clause (death-effects immunity only, +1 circumstance vs disease/poison, Necril, the
   * vision upgrade, negative healing, the Negative Survival note). There is no grantsRules field to
   * point with; the content is what matters and it is held. */
  'ghost-dedication': ['grantsRecord'],
  'zombie-dedication': ['grantsRecord'],
  /* *"Choose one of the domains associated with your mystery … You gain an initial domain spell from
   * that domain."* Their `giveAbilityBlock` points at a scaffolding feat literally named "Domains";
   * ours is `choice: { kind: 'domains' }` resolved by `applyFeatFocus` in build.ts against
   * `DOMAIN_SPELLS` in domains.ts — all 64 domains mapped. The same picker under another name. */
  'domain-acumen': ['grantsRecord'],
  /*
   * *"Your proficiency rank in Perception and your eidolon's … increase to expert"* — a level-3
   * summoner feature, held as the level-gated advancement row (advancement.ts, summoner: level 3,
   * track perception, source 'shared-vigilance'). Their `adjValue PERCEPTION → E` carries no level
   * of its own, but it sits on a class-feature row that IS `level: 3` and carries the Summoner class
   * trait, which is how their engine gates class features — so the difference is only WHERE the
   * level is recorded, not whether one exists.
   */
  'shared-vigilance': ['perception'],

  /* ---------------------------------------------------------------- batch 010 */

  /*
   * Both archetypes print the same clause — Hallowed Necromancer *"…have the same tradition as your
   * spell slots"*, Magic Warrior *"…are the same tradition as your other spells"* — so neither DEFINES
   * a casting source; each borrows the character's. Their `defineCastingSource` is the hanger their
   * model needs for the archetype's later focus spells. Ours is `focusFromSpellSlots`, read in
   * build.ts after both the class and archetype entries exist (it cannot be a `tradition` on the
   * record: the answer is not knowable until the character has one). Asserted on a built character in
   * test/batch10-parity.test.ts — a fighter casting from a wizard archetype gets ARCANE hallowed
   * ground, where a fighter's own focus default is occult.
   */
  'hallowed-necromancer-dedication': ['spellcasting'],
  'magic-warrior-dedication': ['spellcasting'],
  /*
   * *"You gain a lash melee unarmed attack that is in the flail weapon group, deals 1d4 bludgeoning
   * damage, and has the grapple and reach traits."* Their carrier is an ITEM; ours is `grantedStrikes`
   * with those exact dice, group and traits — the same reading already settled for `spine-stabber`
   * and the martial artist's fist. An unarmed attack is not a thing you can drop.
   */
  'thlipit-contestant-dedication': ['grantsItem'],
  /*
   * Every one of these is an implement INITIATE BENEFIT — the Regalia's saves, the Lantern's
   * Perception, the conditional attached to them. The printed dedication grants the implement and says
   * you do NOT gain its initiate benefit, so the numbers belong on the implement records, which is
   * where ours are. Matches the same record's settle in wg-values.mjs.
   */
  'thaumaturge-dedication': ['conditional', 'perception', 'save'],
  /*
   * Their row carries FOCUS_POINT_BONUS on the dedication. The Remaster text does not: the dedication
   * alone grants no focus spell and so no pool, and the pool arrives with Psi Development. Ours agrees
   * — measured: dedication alone -> no focus entry at all, dedication + Psi Development -> a pool of 1.
   * Registered only now that the pool is REACHABLE: the psychic's own 2 points moved off a hardcoded
   * `ownsClass('psychic')` literal onto `psi-cantrips-and-amps.focusPoolBonus`, so any record can now
   * grant points, which is what makes this a difference of edition rather than a gap.
   */
  'psychic-dedication': ['focus'],
  /*
   * *"You gain a skill feat… The feat must be one for an Intelligence-, Wisdom-, or Charisma-based
   * skill, or for the skill you gained from your methodology."*
   *
   * Their carrier is a `select` on the feat. Ours is `restrictedSkillFeatLevels` on the CLASS, because
   * the restriction is a property of those SLOTS and has to be applied while the picker lists options
   * — a select on the record cannot narrow what the slot offers. This is the one place the owner's
   * parity rule leaves us the last word: *"only place where we have the last word is filtering the
   * options when giving a user selection menu."* Measured: an investigator's restricted slot offers
   * 235 feats where a fighter's offers 295, and Cat Fall (Acrobatics) is correctly absent from it.
   */
  'skillful-lessons': ['choice'],

  /* ---------------------------------------------------------------- batch 011 */
  /*
   * *"Your proficiency rank for Will saves increases to expert"* is a proficiency BUMP, and those live
   * in CLASS_ADVANCEMENT — the gunslinger's table carries it at level 3 attributed to this very feature
   * (advancement.ts:435), because that is the one place a rank may be raised; no record-level field can.
   * Their op carries no level of its own but sits on a class-feature row that IS level 3, so only WHERE
   * the level is recorded differs. Their second op is prose-only: the controlled-condition re-save,
   * which we hold as a RECORD_MARKER on the `controlled` condition. Precedent: 'bravery'.
   */
  'stubborn': ['save'],
  /*
   * Their only `hp` op is a conditional gated on FEAT_NAMES including "exemplar resiliency" — it is
   * Exemplar Resiliency's Hit Points parked on each exemplar archetype feat, which is how their model
   * spells *"for each exemplar archetype class feat you have"*. Printed Basic Glory grants no HP at
   * all; its whole text is *"You gain a 1st- or 2nd-level exemplar feat."* We hold them ONCE, on the
   * feat that prints them (exemplar-resiliency's per-archetype-feat bonus), and basic-glory is counted
   * among the feats it multiplies by. Same settle already made for 'exemplar-dedication' in batch 9.
   */
  'basic-glory': ['conditional', 'hp'],
  /*
   * *"For 5 rounds, your entire body begins to glow… At the end of each of your turns during this time,
   * you regain 1d4 Hit Points."* Their `hp` op is that 1d4. It is not a Hit Point TOTAL and no field on
   * our side holds one: it is healing over five rounds, produced by an activation, and it belongs to
   * the Light spell the same sentence grants. Ours rides there — `spellNotes` on the granted spell, so
   * the clause is read exactly where the player triggers it. Both grades carry it.
   */
  'enveloping-light': ['hp'],
  'enveloping-light-greater': ['hp'],
  /*
   * *"You gain an additional skill increase … you also gain a skill feat, which must be for
   * Acrobatics or for the skill of your swashbuckler's style."*
   *
   * Their carrier is a `select` of skills on the record. Ours is two class-level lanes, because both
   * halves are properties of SLOTS rather than of this record: `bonusSkillIncreaseLevels` [3,7,15] adds
   * a second skill increase at each of those levels (verified on a built swashbuckler — two entries at
   * level 3, both ranks applied, and the round-trip splits them back), and `restrictedSkillFeatLevels`
   * narrows the feat slot to Acrobatics plus the style's own skill. A select on the record cannot
   * narrow what a slot offers. Same shape and same reasoning as 'skillful-lessons' above — and this is
   * the one place the owner's parity rule leaves us the last word: filtering the options in a picker.
   */
  'stylish-tricks': ['choice'],
  /* Their two ops are UNFINISHED STUBS, quoted whole so the next reader does not have to fetch them:
   *   {"type":"addBonusToValue","data":{"variable":"","text":""}} x2
   * No variable, no value, no bonus type. Only the COUNT is legible — two bonuses, which is how many
   * the printed text gives. Their GREATER grade (item 18178) encodes the same effect properly
   * (SKILL_DIPLOMACY 2 item; PERCEPTION 2 item "to Sense Motive"), which is what establishes these
   * blanks as stubs rather than a different reading. This is a THEY-ENCODE-NOTHING settle, not a
   * we-cover-it-elsewhere one. ⚠ Do NOT fix this with a blanket empty-variable guard in
   * kindOfTheirOp — ability_block 57388 (Instinctive Collaborator) carries a COMPLETE +2 circumstance
   * whose variable is also empty (the target lives in text "to Aid"), and a blanket guard would
   * silence it. */
  'bolkas-blessing': ['unmapped'],

  /*
   * ---- BATCH 19 (ancestries + backgrounds) -------------------------------------------------------
   *
   * AWAKENED ANIMAL — their row's remaining block is `feat/Awakened Animal Versatile Heritage`:
   * their app models the awakened animal as a VERSATILE HERITAGE bolted onto another ancestry, ours
   * as the full ancestry the book prints (Howl of the Wild), with its own heritages, size choice
   * (`bodySize` → `hpBySize` 6/6/8/10, adversarially confirmed against their per-size setValue table)
   * and Awakened Mind delivered as the RECORD_MARKERS diplomacy note. There is no record of ours for
   * their structural block to correspond to — the whole ancestry is the correspondence.
   */
  'awakened-animal': ['grantsRecord'],
  /*
   * CENTAUR — their remaining blocks are `feat/Mount` and `feat/Robust`, granted as records. Read in
   * the batch-19 pass: Robust's whole content is `addBonusToValue BULK_LIMIT_BONUS 2`, which ours
   * ships as `ancestries.centaur.bulkLimitBonus: 2` read by deriveBulk (guarded on a built centaur in
   * test/batch19-parity.test.ts); Mount's block carries NO operations on their side and its rider
   * rules are prose on both (our AST carries the printed paragraph). Contents delivered; only the
   * container differs.
   */
  'centaur': ['grantsRecord'],
  /*
   * KHOLO — their Bite physical-feature block grants ITEM 13753, a bite weapon their data does not
   * tag with the unarmed trait, so the op reads as `grantsItem` rather than `weapon`. Ours ships the
   * same printed attack as `grantedStrikes` (Jaws, d6 piercing, brawling) — the lane every unarmed
   * ancestry attack uses, and the shape their own tagged unarmed items map to. Same Strike, styled as
   * a strike rather than an inventory row.
   */
  'kholo': ['grantsItem'],

  /*
   * ---- BATCH 21 ----------------------------------------------------------------------------------
   *
   * ZODIAC BOUND — their row wraps each sign's spell in a defineCastingSource + a conditional on the
   * sign select; ours delivers the same table as twelve `innateSpells` rows gated by `whenChoice`
   * (built this batch, guarded on built characters in test/batch21-parity.test.ts). The casting
   * source is the pooled innate entry both sides resolve to; the conditional IS the whenChoice gate.
   */
  'zodiac-bound': ['spellcasting', 'conditional'],
};

const out = { theyOnly: [], disagree: [], weOnly: [], agree: [], noMatch: [], theirsUnencoded: [] };
/*
 * FEATS ONLY — and that is a KNOWN LIMIT, not an oversight. `scripts/wg-batch-gate.mjs` reports every
 * record a batch contains that no comparer covers, so the limit is visible per batch instead of silent.
 *
 * Widening this walk to every bucket was tried and reverted ONCE: `theirs` is keyed by NAME and filtered
 * to their `feat` rows, so our items and class features got paired against their FEATS whenever a name
 * collided. `clan-pistol` is both a feat and a weapon on our side, and the widened walk compared the
 * WEAPON against their feat and reported the feat's granted item as missing — a false gap on a record
 * that had just been fixed. Pairing by name alone across buckets manufactures wrong answers.
 *
 * ⚠ The right fix IS available and is being built: `parseCopyBlock` returns rows as OBJECTS, so
 * `row.type` reads cleanly (feat 10843, class-feature 2237, heritage 594, action 135, physical-feature
 * 110, sense 69, mode 46) and their `item` table is a separate 6,244-row block that also carries
 * `operations`. An earlier note here claimed the type column "does not survive the TSV parse" — that was
 * wrong, and it was wrong because the probe indexed an object numerically.
 */
for (const [id, rec, bucket] of wgAllRecords(core)) {
  /* An action whose class feature or feat shares its id defers to that sibling — see wgOwnsComparison. */
  if (!wgOwnsComparison(core, bucket, id)) continue;
  const t = theirByBucket[bucket]?.get(norm(rec.name));
  if (!t) { out.noMatch.push({ id, name: rec.name }); continue; }
  if (!t.opCount) { out.theirsUnencoded.push({ id, name: rec.name }); continue; }
  const ours = ourKindsOf(rec, id, bucket);
  let missing = [...t.kinds].filter((k) => !ours.has(k) && k !== 'note');
  /* A conditional whose every branch holds kinds we already model is a wrapper, not a gap. */
  const gatesOnlyWhatWeHave = (t.condGroups ?? []).every((g) => [...g].every((k) => k === 'note' || ours.has(k)));
  if (missing.includes('conditional') && gatesOnlyWhatWeHave) missing = missing.filter((k) => k !== 'conditional');
  /* Kinds read, verified and settled for this record — see VERIFIED_EQUIVALENT above. */
  const settled = RAW_SETTLES ? undefined : VERIFIED_EQUIVALENT[id];
  if (settled) missing = missing.filter((k) => !settled.includes(k));
  const shared = [...t.kinds].filter((k) => ours.has(k));
  const extra = [...ours].filter((k) => !t.kinds.has(k));
  const row = { id, name: rec.name, level: rec.level, theirKinds: [...t.kinds], ourKinds: [...ours], missing, extra, theirOps: t.opCount };
  if (missing.length) out.theyOnly.push(row);
  else if (extra.length) out.weOnly.push(row);
  else out.agree.push(row);
}

/* Where BOTH sides model the same kind, the values still have to be compared — but that needs the
 * printed text to adjudicate, so it is a separate, judged pass. Flag the candidates here. */
out.disagree = out.agree.concat(out.weOnly).filter((r) => r.theirKinds.some((k) => ['skill', 'save', 'ac', 'hp', 'speed', 'defense', 'attribute'].includes(k)));

/* ---------------------------------------------------------------- report */
const dest = arg('--out', null);
if (dest) { writeFileSync(join(ROOT, dest), JSON.stringify(out, null, 1)); console.log(`-> ${dest}`); }

const matched = out.theyOnly.length + out.weOnly.length + out.agree.length;
/* Across EVERY paired bucket now, not just feats. The denominators moved when the comparison stopped
 * being feats-only, so they are labelled as records rather than feats to keep the number honest. */
const ourRecords = Object.keys(WG_PAIRING).reduce((n, b) => n + Object.keys(core[b] ?? {}).length, 0);
const theirEncoded = Object.values(theirByBucket).reduce(
  (n, m) => n + [...m.values()].filter((t) => t.opCount).length, 0,
);
console.log(`our records (paired buckets): ${ourRecords}    theirs (encoded, summed per bucket): ${theirEncoded}\n`);
console.log(`  matched by name, both encode something : ${matched}`);
console.log(`     ${String(out.theyOnly.length).padStart(5)}  THEY-ONLY   they model a kind we do not   <- the work list`);
console.log(`     ${String(out.weOnly.length).padStart(5)}  WE-ONLY     we model a kind they do not`);
console.log(`     ${String(out.agree.length).padStart(5)}  AGREE       same kinds on both sides`);
console.log(`  ${String(out.theirsUnencoded.length).padStart(5)}  they have the feat, encode NOTHING`);
console.log(`  ${String(out.noMatch.length).padStart(5)}  we have the feat, they do not\n`);
console.log(`  ${String(out.disagree.length).padStart(5)}  numeric kinds present on BOTH sides — values need adjudicating against the book`);

const byKind = {};
for (const r of out.theyOnly) for (const k of r.missing) byKind[k] = (byKind[k] ?? 0) + 1;
console.log(`\nTHEY-ONLY, by the kind we are missing:`);
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

if (has('--list')) {
  const b = arg('--bucket', 'they-only');
  const list = { 'they-only': out.theyOnly, 'we-only': out.weOnly, agree: out.agree, disagree: out.disagree, nomatch: out.noMatch }[b] ?? [];
  console.log(`\n--- ${b} (${list.length}) ---`);
  for (const r of list.slice(0, 400)) console.log(`  ${r.id.padEnd(42)} lvl ${String(r.level ?? '?').padStart(2)}  missing=[${(r.missing ?? []).join(',')}]  ours=[${(r.ourKinds ?? []).join(',')}]`);
}
