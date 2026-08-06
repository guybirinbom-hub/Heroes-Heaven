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
  /** The Basic/Expert/Master Spellcasting feat ids that unlock slot ranks.
   *
   *  OPTIONAL because two archetypes get their slots elsewhere — Magaambyan Attendant grants a single
   *  innate cantrip (`innateCantrip`) and Halcyon Speaker uses `customUnlocks` — and mk() had been
   *  minting them ids like `basic-halcyon-speaker-spellcasting` for feats that do not exist. Harmless
   *  today because both paths return before reading them, and a trap for whoever touches this next. */
  basicId?: string;
  expertId?: string;
  masterId?: string;
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
  /** Captivator: its ranked spells are LEARNED and cast as INNATE spells — one spell of each unlocked
   *  rank, 1/day each — not as prepared or spontaneous slots. Pair with `customUnlocks`, which then
   *  describes when each rank is learned rather than when a slot appears. */
  innateRanked?: boolean;
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
  // Captivator: NOT a slot caster, however much it looks like one. Every captivator spellcasting feat
  // says "You Cast these Spells as occult innate spells" — you learn ONE spell of each rank and cast it
  // from nothing, 1/day. Its ladder is also two levels ahead of the standard one from Expert onward and
  // is the only archetype that reaches rank 9: 1st@4, 2nd@6, 3rd@8 (Basic) · 4th@10, 5th@12, 6th@14
  // (Expert) · 7th@16, 8th@18, 9th@20 (Master). Each spell must be enchantment or illusion — a school
  // restriction the Remaster data can no longer express, so it is left to the player.
  'captivator-dedication': {
    ...mk('occult', 'cha', 2, 'captivator'),
    innateRanked: true,
    customUnlocks: [
      { rank: 1, level: 4, featId: 'basic-captivator-spellcasting' },
      { rank: 2, level: 6, featId: 'basic-captivator-spellcasting' },
      { rank: 3, level: 8, featId: 'basic-captivator-spellcasting' },
      { rank: 4, level: 10, featId: 'expert-captivator-spellcasting' },
      { rank: 5, level: 12, featId: 'expert-captivator-spellcasting' },
      { rank: 6, level: 14, featId: 'expert-captivator-spellcasting' },
      { rank: 7, level: 16, featId: 'master-captivator-spellcasting' },
      { rank: 8, level: 18, featId: 'master-captivator-spellcasting' },
      { rank: 9, level: 20, featId: 'master-captivator-spellcasting' },
    ],
    // customUnlocks otherwise pins proficiency at trained (correct for Halcyon Speaker); the captivator
    // does advance, on its own two feats.
    profExpertFeat: 'expert-captivator-spellcasting',
    profMasterFeat: 'master-captivator-spellcasting',
  },
  'prophet-of-kalistrade-dedication': mk('occult', 'cha', 3, 'prophet'),
  'rivethun-involutionist-dedication': mk('divine', 'wis', 2, 'rivethun'),
  // Bloodrager: a spontaneous repertoire of 2 cantrips from EITHER the arcane or divine list (player's
  // choice), Cha key, trained spell attack/DC.
  //
  // ITS LADDER EXISTS — it is simply not named after the archetype. `basic-bloodrager-spellcasting`
  // and its siblings genuinely do not ship, which is why this was read as cantrips-only; the three
  // feats whose text is "You gain the benefits" are Rising Blood Magic (4), Surging Blood Magic (12)
  // and Exultant Blood Magic (18). Without them the archetype never gained a single spell slot.
  'bloodrager-dedication': {
    ...mk('arcane', 'cha', 2, 'bloodrager', true),
    basicId: 'rising-blood-magic',
    expertId: 'surging-blood-magic',
    masterId: 'exultant-blood-magic',
    traditionOptions: ['arcane', 'divine'],
    repertoire: true,
  },
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
    // No Basic/Expert/Master feats exist for this archetype — mk() had minted ids for three feats
    // that do not ship. Cleared so nothing reads a name that resolves to nothing.
    basicId: undefined,
    expertId: undefined,
    masterId: undefined,
    traditionOptions: ['arcane', 'primal'],
    keyByTradition: true,
    innateCantrip: true,
  },
  // Halcyon Speaker: spontaneous "halcyon" caster (spells shared by the arcane + primal lists). The
  // DEDICATION grants 2 cantrips + a 1st-rank slot at L6; Initiate (10) adds ranks 2-3, Adept (14) adds
  // 4-5 (→ expert), Sage (18) adds 6-7 (→ master). Tradition (arcane/primal) sets the key + label.
  'halcyon-speaker-dedication': {
    ...mk('arcane', 'int', 2, 'halcyon-speaker', true),
    // Slots come from customUnlocks below, not from Basic/Expert/Master feats — those do not exist
    // for this archetype, and mk()'s derived ids pointed at nothing.
    basicId: undefined,
    expertId: undefined,
    masterId: undefined,
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
  // ---- Found by the full feat audit: three caster archetypes missing from this table entirely, so
  // their Basic/Expert/Master feats granted no slots at all and "You gain the benefits" pointed at
  // nothing. None of the three fits mk() — each names its progression feats something other than
  // "basic-<slug>-spellcasting", which is presumably how they were missed.
  //
  // "You learn to cast spontaneous spells and gain a spell repertoire with one cantrip of your choice,
  // from a spell list of your choice… Your key spellcasting ability for these spells is Charisma."
  'cathartic-mage-dedication': {
    tradition: 'occult',
    keyAbility: 'cha',
    cantrips: 1,
    basicId: 'basic-cathartic-spellcasting',
    expertId: 'expert-cathartic-spellcasting',
    masterId: 'master-cathartic-spellcasting',
    choiceTradition: true, // "a spell list of your choice" — genuinely any of the four
    repertoire: true,
  },
  // "You can prepare two common cantrips each day from the divine spell list… Your key spellcasting
  // attribute for the Red Mantis archetype spells is Charisma, and they are divine." Prepared, and
  // the key attribute is printed on Basic Red Mantis Magic rather than on the dedication.
  'red-mantis-assassin-dedication': {
    tradition: 'divine',
    keyAbility: 'cha',
    cantrips: 2,
    basicId: 'basic-red-mantis-magic',
    expertId: 'expert-red-mantis-magic',
    masterId: 'master-red-mantis-magic',
  },
  // Gelid Shard ships no feat carrying the dedication trait — First Frost is the level-2 entry point:
  // "You learn to cast arcane spontaneous spells, and you gain a spell repertoire with the Frostbite
  // and Frost's Touch cantrips… Your key spellcasting attribute is Charisma."
  'first-frost': {
    tradition: 'arcane',
    keyAbility: 'cha',
    cantrips: 2,
    basicId: 'snowcaster',
    expertId: 'expert-snowcasting',
    masterId: 'master-snowcasting',
    repertoire: true,
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
      tier: {
        basic: !!config.basicId && taken.has(config.basicId),
        expert: !!config.expertId && taken.has(config.expertId),
        master: !!config.masterId && taken.has(config.masterId),
      },
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
