/*
 * Caster archetypes (multiclass into spellcasting).
 *
 * Taking a caster Dedication (Wizard Dedication, etc.) grants a few cantrips + trained
 * spell proficiency in a tradition; the "Basic / Expert / Master Spellcasting" archetype
 * feats then grant ONE spell slot of each available rank, unlocking a new rank every two
 * levels. This is the canonical PF2e "Spellcasting Archetype" progression (sourced from
 * the rules — the feats themselves carry no slot data, just "you gain the … benefits").
 *
 * Scope: the FIXED-tradition caster archetypes. The choice-dependent ones (sorcerer
 * bloodline, witch patron, summoner eidolon, …) need a sub-choice we don't model for
 * archetypes yet, so they're omitted.
 */
import type { AbilityId, ContentDatabase, ProficiencyRank, Tradition } from './types';

export interface CasterArchetype {
  /** The tradition, or a sensible default when `choiceTradition` (the player picks one). */
  tradition: Tradition;
  keyAbility: AbilityId;
  /** Cantrips the dedication grants. */
  cantrips: number;
  basicId: string;
  expertId: string;
  masterId: string;
  /** True when the tradition is set by a sub-choice (sorcerer bloodline, witch patron). */
  choiceTradition?: boolean;
  /** Constrains the tradition choice to these options (beast-gunner = arcane/primal). */
  traditionOptions?: Tradition[];
  /** When set, the key attribute is player-chosen from these (psychic = Int/Cha). */
  choiceKeyAbility?: AbilityId[];
  /** Spontaneous caster (a known-spell repertoire + slot pool) rather than prepared. */
  repertoire?: boolean;
  /** Summoner: the tradition is set by the chosen eidolon TYPE (build.archetypeEidolonType), not free. */
  eidolonTradition?: boolean;
  /** Key attribute follows the chosen tradition: arcane → Int, primal → Wis (Magaambyan / Halcyon). */
  keyByTradition?: boolean;
  /** Magaambyan Attendant: grants a single INNATE cantrip of the chosen tradition — no spell slots. */
  innateCantrip?: boolean;
  /** A non-standard slot schedule (Halcyon Speaker): each entry unlocks one slot of `rank` at character
   *  level `level` once `featId` is taken (the dedication counts as taken while active). Overrides the
   *  standard basic/expert/master RANK_UNLOCKS. */
  customUnlocks?: { rank: number; level: number; featId: string }[];
  /** Custom proficiency advancement: the feat ids that raise spell proficiency to expert / master. */
  profExpertFeat?: string;
  profMasterFeat?: string;
}

export const CASTER_ARCHETYPES: Record<string, CasterArchetype> = {
  'wizard-dedication': mk('arcane', 'int', 4, 'wizard'),
  'bard-dedication': mk('occult', 'cha', 2, 'bard'),
  'cleric-dedication': mk('divine', 'wis', 2, 'cleric'),
  'druid-dedication': mk('primal', 'wis', 2, 'druid'),
  'oracle-dedication': mk('divine', 'cha', 2, 'oracle'),
  'magus-dedication': mk('arcane', 'int', 4, 'magus'),
  'animist-dedication': mk('divine', 'wis', 2, 'animist'),
  'captivator-dedication': mk('occult', 'cha', 2, 'captivator'),
  'prophet-of-kalistrade-dedication': mk('occult', 'cha', 3, 'prophet'),
  'rivethun-involutionist-dedication': mk('divine', 'wis', 2, 'rivethun'),
  // Choice-tradition: the tradition follows a bloodline (sorcerer) / patron (witch);
  // the builder offers a tradition picker rather than modelling the full sub-choice.
  'sorcerer-dedication': mk('arcane', 'cha', 2, 'sorcerer', true),
  'witch-dedication': mk('occult', 'int', 2, 'witch', true),
  // Guns & Gears casters: tradition of your choice (beast-gunner limited to arcane/primal), Cha key.
  'eldritch-archer-dedication': mk('arcane', 'cha', 1, 'eldritch-archer', true),
  'beast-gunner-dedication': { ...mk('arcane', 'cha', 1, 'beast-gunner', true), traditionOptions: ['arcane', 'primal'] },
  // Psychic: occult tradition, key = the attribute you qualified with (Int or Cha — player's choice).
  'psychic-dedication': { ...mk('occult', 'int', 1, 'psychic'), choiceKeyAbility: ['int', 'cha'] },
  // Summoner: a spontaneous repertoire whose tradition follows the chosen eidolon TYPE; caps at Expert
  // (no master-summoner-spellcasting feat exists). Cha key.
  'summoner-dedication': { ...mk('arcane', 'cha', 2, 'summoner'), eidolonTradition: true },
  // Magaambyan Attendant: a single INNATE cantrip from a chosen tradition (arcane → Int, primal → Wis).
  // No spell slots — the slot progression comes from the follow-on Halcyon Speaker archetype.
  'magaambyan-attendant-dedication': {
    ...mk('arcane', 'int', 1, 'magaambyan-attendant', true),
    traditionOptions: ['arcane', 'primal'],
    keyByTradition: true,
    innateCantrip: true,
  },
  // Halcyon Speaker: spontaneous "halcyon" caster (spells shared by the arcane + primal lists). The
  // DEDICATION grants 2 cantrips + a 1st-rank slot at L6; Initiate (10) adds ranks 2-3, Adept (14) adds
  // 4-5 (→ expert), Sage (18) adds 6-7 (→ master). Tradition (arcane/primal) sets the key + label.
  'halcyon-speaker-dedication': {
    ...mk('arcane', 'int', 2, 'halcyon-speaker', true),
    traditionOptions: ['arcane', 'primal'],
    keyByTradition: true,
    repertoire: true,
    customUnlocks: [
      { rank: 1, level: 6, featId: 'halcyon-speaker-dedication' },
      { rank: 2, level: 10, featId: 'halcyon-spellcasting-initiate' },
      { rank: 3, level: 10, featId: 'halcyon-spellcasting-initiate' },
      { rank: 4, level: 14, featId: 'halcyon-spellcasting-adept' },
      { rank: 5, level: 14, featId: 'halcyon-spellcasting-adept' },
      { rank: 6, level: 18, featId: 'halcyon-spellcasting-sage' },
      { rank: 7, level: 18, featId: 'halcyon-spellcasting-sage' },
    ],
    profExpertFeat: 'halcyon-spellcasting-adept',
    profMasterFeat: 'halcyon-spellcasting-sage',
  },
};

// Spontaneous caster dedications (a known-spell repertoire + slots) — everything else is prepared.
// Remaster: sorcerer/bard/oracle/psychic/summoner + the Guns & Gears archer/gunner are spontaneous;
// wizard/cleric/druid/witch/magus/animist (and the niche occult/divine ones) are prepared.
const SPONTANEOUS_DEDICATIONS = new Set([
  'sorcerer-dedication',
  'bard-dedication',
  'oracle-dedication',
  'psychic-dedication',
  'eldritch-archer-dedication',
  'beast-gunner-dedication',
  'summoner-dedication',
  'halcyon-speaker-dedication',
]);
for (const [id, cfg] of Object.entries(CASTER_ARCHETYPES)) if (SPONTANEOUS_DEDICATIONS.has(id)) cfg.repertoire = true;

function mk(
  tradition: Tradition,
  keyAbility: AbilityId,
  cantrips: number,
  slug: string,
  choiceTradition = false,
): CasterArchetype {
  return {
    tradition,
    keyAbility,
    cantrips,
    basicId: `basic-${slug}-spellcasting`,
    expertId: `expert-${slug}-spellcasting`,
    masterId: `master-${slug}-spellcasting`,
    ...(choiceTradition ? { choiceTradition: true } : {}),
  };
}

export interface Tier {
  basic: boolean;
  expert: boolean;
  master: boolean;
}

export interface ActiveCasterArchetype {
  dedicationId: string;
  config: CasterArchetype;
  tier: Tier;
  /** All taken feat ids — used by custom (Halcyon) schedules that gate ranks on specific feats. */
  taken: Set<string>;
}

/** The caster archetype a character is invested in (a taken caster dedication) + which
 * spellcasting feats they've taken. Returns the first match, or null. */
export function activeCasterArchetype(takenFeatIds: string[], _content?: ContentDatabase): ActiveCasterArchetype | null {
  const taken = new Set(takenFeatIds);
  for (const [dedicationId, config] of Object.entries(CASTER_ARCHETYPES)) {
    if (!taken.has(dedicationId)) continue;
    return {
      dedicationId,
      config,
      tier: { basic: taken.has(config.basicId), expert: taken.has(config.expertId), master: taken.has(config.masterId) },
      taken,
    };
  }
  return null;
}

// [spell rank, character level it unlocks, the feat tier that grants it]
const RANK_UNLOCKS: [number, number, keyof Tier][] = [
  [1, 4, 'basic'],
  [2, 6, 'basic'],
  [3, 8, 'basic'],
  [4, 12, 'expert'],
  [5, 14, 'expert'],
  [6, 16, 'expert'],
  [7, 18, 'master'],
  [8, 20, 'master'],
];

/** Normalize a bare Tier (standard caster, used by tests/the slot table) or a full ActiveCasterArchetype
 *  (build/Builder, custom schedules) into one shape. */
function asArch(a: Tier | ActiveCasterArchetype): ActiveCasterArchetype {
  return 'config' in a ? a : { dedicationId: '', config: {} as CasterArchetype, tier: a, taken: new Set() };
}

/** Archetype spell slots: one of each available rank. A rank is available when its tier feat is taken
 * (or, for a custom schedule, its gating feat) and the character is high enough level. Innate-cantrip
 * archetypes (Magaambyan) have no slots. Accepts a bare Tier (standard table) or a full archetype. */
export function archetypeSlots(level: number, a: Tier | ActiveCasterArchetype): Record<number, number> {
  const arch = asArch(a);
  const out: Record<number, number> = {};
  if (arch.config.innateCantrip) return out;
  if (arch.config.customUnlocks) {
    for (const u of arch.config.customUnlocks) if (arch.taken.has(u.featId) && level >= u.level) out[u.rank] = 1;
    return out;
  }
  for (const [rank, minLevel, t] of RANK_UNLOCKS) if (arch.tier[t] && level >= minLevel) out[rank] = 1;
  return out;
}

/** Trained from the dedication; expert/master from the Expert/Master Spellcasting feats (or a custom
 * archetype's own proficiency-advancing feats). */
export function archetypeProficiency(a: Tier | ActiveCasterArchetype): ProficiencyRank {
  const { config, tier, taken } = asArch(a);
  if (config.profMasterFeat && taken.has(config.profMasterFeat)) return 'master';
  if (config.profExpertFeat && taken.has(config.profExpertFeat)) return 'expert';
  if (config.customUnlocks) return 'trained';
  if (tier.master) return 'master';
  if (tier.expert) return 'expert';
  return 'trained';
}
