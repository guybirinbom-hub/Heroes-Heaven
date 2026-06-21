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

/** Archetype spell slots: one of each available rank. A rank is available when its tier
 * feat is taken and the character is high enough level. */
export function archetypeSlots(level: number, tier: Tier): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [rank, minLevel, t] of RANK_UNLOCKS) if (tier[t] && level >= minLevel) out[rank] = 1;
  return out;
}

/** Trained from the dedication; expert/master from the Expert/Master Spellcasting feats. */
export function archetypeProficiency(tier: Tier): ProficiencyRank {
  if (tier.master) return 'master';
  if (tier.expert) return 'expert';
  return 'trained';
}
