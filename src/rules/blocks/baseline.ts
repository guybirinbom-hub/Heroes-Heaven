/*
 * THE BOOK NUMBER UNDER A SET — `baselineFor` (plan B WP4, decision 9; work/tweaks-part-b-notes/plan.md
 * section 1 "WP4" and section 3.3).
 *
 * A tweak that SETS a number (a score, maximum HP, AC …) stores the book number it replaced as its
 * `baseline` (`overrides.meta[...].baseline`, or the stored block's own `baseline`), so the Tweaks page can say
 * "Book number changed: was X, now Y" when the book moves under the set (decision 9, WP6 / WP7). Two writers
 * stamp it, and they must agree on the number: the Builder-open stamp (blocks/save.ts `openForTweaks`, for
 * every old set it moves) and the TweakEditor when a set is created or edited (WP7). This is the ONE function
 * both call.
 *
 *   - a number target (max HP, and every other number target `numberTermsFor` builds): the PERMANENT part of
 *     the sheet's own term list (`bookTotal`: the base and book layers) — every tweak term (the set itself,
 *     a +1 block) and everything on in play (a mode, Drained) left out;
 *   - a score (`score:<ability>`): the score the boosts made, without the set and without any
 *     `attribute.add` block (build.ts `computeAbilitiesDetailed`, the step before the sets).
 *
 * A number's base line can carry a tweak that `bookTotal` cannot see as one (WP7, the guard WP4 began for max
 * HP): the attribute it adds (AC's Dexterity under a Dex set or a Dex +2), Strength where worn armor's
 * Strength entry reaches it (the check penalty of a Strength or Dexterity skill, Speed's armor penalty), the
 * attribute a skill-attribute swap could pick instead, the rank of its proficiency term (a skill under an
 * "at least" floor or an "exactly" hold, AC under an armor rank tweak, an old rank entry still applied as
 * today's `=`), and for Initiative the statistic it reads (Perception or its skill, settled into
 * its base lines WITH their own tweak terms). While any of those is live the book number is not known, so
 * nothing is returned and no baseline is stored (a later edit of the set stamps it once it can be known).
 *
 * Read only: nothing here writes, and no stored overrides key is read by hand (the live sets, score adds and
 * rank tweaks come from blocks/active.ts, the one reader). `undefined` when the target names no number this
 * phase builds, or when the answer cannot be known (a score under a live set, asked without its build; a
 * number whose base line holds a live tweak, above).
 */
import { computeAbilitiesDetailed, type BuildState } from '../build';
import { skillAbility, skillAbilitySwapFor, skillRolledAbility, skillTakesArmorPenalty } from '../derive';
import { bookTotal, numberTermsFor } from '../numberTerms';
import type { AbilityId, Character, ContentDatabase, ProficiencyKey } from '../types';
import { ABILITIES } from '../types';
import { liveAttributeSets, liveCarriers, liveLegacyRanks, numberTweakTerms, scoreAddBlocks, tweakRankLines, type SwitchHost } from './active';
import { contentFor } from './content';
import { proficiencyTarget } from './stored';
import { ARMOR_DETAILS, parseTargetRef } from './targets';

const ABILITY_SET = new Set<string>(ABILITIES);
const SAVE_ABILITY: Record<string, AbilityId> = { fortitude: 'con', reflex: 'dex', will: 'wis' };

/** A live attribute tweak (a set, an `attribute.add` block, or a tweaks p2 WP11 extra boost place answering it)
 *  on this ability. */
function abilityTweaked(c: Character, ab: AbilityId): boolean {
  return liveAttributeSets(c).some((s) => s.ability === ab) || scoreAddBlocks(c, ab).length > 0 || extraBoostOn(c, ab);
}

/** WP11: a live extra boost place (`choice.addPlace`, place 'boost') answering this ability (blocks/active.ts
 *  `liveCarriers`). The book number under a set is not known while one is live (the header's rule). */
function extraBoostOn(c: SwitchHost, ab: AbilityId): boolean {
  return liveCarriers(c, 'boost').some((t) => t.answer === ab);
}

/** A live rank tweak on this rank track (`skill:<key>`, `save:<save>`, `perception`, `class-dc`,
 *  `armor:<category>`): an "at least" floor or an "exactly" hold (the character's read-time sort included),
 *  or an old entry still applied as today's `=` (`rank.legacySet`). */
function rankTweaked(c: Character, track: string): boolean {
  const lines = tweakRankLines(c, track);
  if (lines.floors.length || lines.hold) return true;
  // WP11: a live extra skill increase place naming this skill raises its rank inside the book line.
  if (track.startsWith('skill:') && liveCarriers(c, 'skillIncrease').some((t) => `skill:${t.answer}` === track)) return true;
  return liveLegacyRanks(c).some((r) => proficiencyTarget(r.key, true) === track || proficiencyTarget(r.key, false) === track);
}

/** The skill's attribute tweaks and rank tweaks: its own attribute, the one it is rolled with, the one a
 *  skill-attribute swap could pick (Officer's Medical Training's Intelligence: the better of the two is
 *  rolled, so a tweak on either decides which), Strength for a Strength or Dexterity skill (worn armor's
 *  Strength entry removes its check penalty, a BOOK term: derive.ts `meetsArmorStrength`; read whether
 *  armor is worn or not, as the armor ranks below are), and its rank. */
function skillTweaked(c: Character, db: ContentDatabase, key: ProficiencyKey): boolean {
  if (abilityTweaked(c, skillAbility(key)) || abilityTweaked(c, skillRolledAbility(c, key, db))) return true;
  const swap = skillAbilitySwapFor(c, db, key)?.use;
  if (swap && abilityTweaked(c, swap)) return true;
  if (skillTakesArmorPenalty(key) && abilityTweaked(c, 'str')) return true;
  return rankTweaked(c, `skill:${key}`);
}

/** Is a live tweak inside `target`'s base line (see the header)? */
function tweakInsideBook(c: Character, db: ContentDatabase, target: string): boolean {
  const ref = parseTargetRef(target);
  if (!ref) return false;
  switch (ref.kind) {
    case 'max-hp':
      return abilityTweaked(c, 'con');
    case 'ac':
      return abilityTweaked(c, 'dex') || ARMOR_DETAILS.some((d) => rankTweaked(c, `armor:${d}`));
    case 'save': {
      const ab = SAVE_ABILITY[ref.detail ?? ''];
      return (!!ab && abilityTweaked(c, ab)) || rankTweaked(c, `save:${ref.detail}`);
    }
    case 'perception':
      return abilityTweaked(c, 'wis') || rankTweaked(c, 'perception');
    case 'skill':
      return !!ref.detail && skillTweaked(c, db, ref.detail as ProficiencyKey);
    case 'class-dc':
      return abilityTweaked(c, c.classDcKeyAbility ?? c.keyAbility ?? 'str') || rankTweaked(c, 'class-dc');
    case 'initiative': {
      // Initiative settles the statistic it reads into its own base lines, that statistic's tweak terms
      // included (rules/initiative.ts `initiativeTermList`).
      const stat = c.initiativeSkill;
      if (!stat) return abilityTweaked(c, 'wis') || rankTweaked(c, 'perception') || numberTweakTerms(c, 'perception').length > 0;
      return skillTweaked(c, db, stat) || numberTweakTerms(c, `skill:${stat}`).length > 0;
    }
    case 'spell-attack':
    case 'spell-dc': {
      const entry = (c.spellcasting ?? []).find((e) => e.id === ref.ownerId);
      return !!entry?.keyAbility && abilityTweaked(c, entry.keyAbility);
    }
    case 'speed':
      // No rank in its base line, but Strength: meeting worn armor's Strength entry cuts its Speed penalty
      // by 5 feet (derive.ts `meetsArmorStrength`, and an inventor's `removeSpeedPenaltyAtStr`). Read
      // whether armor is worn or not, as the armor ranks are.
      return abilityTweaked(c, 'str');
    default:
      return false;
  }
}

/**
 * The book number a set on `target` replaces (see the header). `c` is the built character; `build` is its
 * build, when the caller has it (the Builder always does): a score is then read off the boosts directly.
 * Without it, a score is the shown score minus its live `attribute.add` blocks — known only while no set
 * is live on that ability (the set REPLACED the boosted score, which the character no longer carries).
 */
export function baselineFor(c: Character, db: ContentDatabase, target: string, build?: BuildState): number | undefined {
  if (target.startsWith('score:')) {
    const ab = target.slice('score:'.length);
    if (!ABILITY_SET.has(ab)) return undefined;
    const ability = ab as AbilityId;
    // WP11: the boosts include a live extra boost place's; while one answers this ability the book score is not
    // known (pausing it would read as a book change). Asked of the build when given (the same blocks it holds).
    if (extraBoostOn(build ?? c, ability)) return undefined;
    if (build) {
      // The same content view buildCharacter computes the scores against (contentFor: the build's own
      // live content edits laid over the db; the same object back when there are none).
      const v = computeAbilitiesDetailed(build, contentFor(db, build)).scores[ability];
      return Number.isFinite(v) ? v : undefined;
    }
    if (liveAttributeSets(c).some((s) => s.ability === ability)) return undefined;
    const shown = c.abilities?.[ability];
    if (typeof shown !== 'number' || !Number.isFinite(shown)) return undefined;
    return shown - scoreAddBlocks(c, ability).reduce((n, b) => n + (b.value as number), 0);
  }
  // Max HP's base line is `(class + Con) × level` with the Con the sheet shows; AC's holds the Dex and the
  // armor rank; a skill's its attribute and rank … A live tweak there would make a later "Book number
  // changed" report the tweak's removal as a book change, so the book number is unknown while one is live.
  if (tweakInsideBook(c, db, target)) return undefined;
  const terms = numberTermsFor(c, db, target);
  if (!terms) return undefined;
  const total = bookTotal(terms);
  return Number.isFinite(total) ? total : undefined;
}
