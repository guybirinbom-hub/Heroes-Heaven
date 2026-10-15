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
  /**
   * The DEDICATION grants no casting at all — the Basic Spellcasting feat is what brings the casting
   * source, the repertoire and the cantrips. Summoner Dedication's printed text says nothing about
   * spells and Wanderer's Guide defines no casting source on it; *"You gain a spell repertoire and two
   * cantrips"* is Basic Summoner Spellcasting's own sentence. Until that feat is taken the archetype
   * is not an active caster, so no spellcasting entry, no cantrip rail, no spell proficiency.
   */
  castsFromBasic?: boolean;
  /**
   * Hedge Mage: the tradition is set by the SKILL the dedication asked for, not picked directly —
   * *"hedge mage spells of a tradition associated with the skill chosen for this dedication (arcane for
   * Arcana, primal for Nature, occult for Occultism, and divine for Religion)"*. Keyed by the skill
   * answer stored in `build.featSkillChoices['<featId>:0']`. Same shape as `eidolonTradition`: one
   * answer deciding another.
   */
  traditionBySkill?: Record<string, Tradition>;
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
  /** Spells KNOWN beyond the slot count, per rank — the Halcyon Speaker dedication prints "2 common
   *  1st-rank halcyon spells" over ONE 1st-rank slot. Read where the spontaneous repertoire is
   *  sliced from the picks; the slot pool itself stays at the schedule's count. */
  extraKnown?: Record<number, number>;
  /**
   * Feats that WIDEN the tradition choice. Cascade Bearer's Spellcasting lets a Magaambyan pick
   * halcyon spells "from the divine or occult spell lists in addition to the arcane or primal".
   * `traditionOptions` alone is fixed at the dedication and cannot grow.
   */
  traditionOptionFeats?: { featId: string; add: Tradition[] }[];
  /**
   * The dedication names the cantrips it grants, so the picker must offer those and nothing else —
   * Oatia Skysage Dedication: *"You gain a spell repertoire with two of the following cantrips of
   * your choice: detect magic, guidance, know the way, or read aura."* (feat-8112). Every other
   * archetype here says "cantrips from that tradition", which is what the tradition filter already
   * computes; this is the exception, and without it a skysage was offered all 38 occult cantrips.
   *
   * Read at BOTH cantrip surfaces (the archetype card in shared.tsx when the class is itself a
   * caster, the class picker in Builder.tsx when it is not) and again where the entry is built, so a
   * pick stored before the restriction existed stops being delivered instead of being silently kept
   * (owner 2026-09-10 #113). The stored id is left alone rather than migrated: builds live in
   * localStorage, in Supabase and in exported `.codex` files, so this project narrows on READ.
   */
  cantripOptions?: string[];
  /**
   * The dedication prepares out of a small BOOK of its own — a spellbook, a familiar, a dirge, a
   * keepsake — not off its whole tradition. Six dedications print one; see `ArchetypeBook`. Absent on
   * every other archetype, whose prepared slots keep reading the tradition.
   */
  book?: ArchetypeBook;
}

/**
 * AN ARCHETYPE'S BOOK — the same rule the class book casters follow (d01fe33), at the dedication's size.
 *
 * Print, newest printing:
 *   · Wizard Dedication — *"a spellbook with four common arcane cantrips of your choice … You can prepare
 *     two cantrips each day from your spellbook"* (feat-5106); Basic Wizard Spellcasting — *"Each time
 *     you gain a spell slot of a new rank from the wizard archetype, add two common spells of that rank
 *     to your spellbook"* (feat-5109).
 *   · Witch Dedication — *"a familiar with two common cantrips … You can prepare one cantrip each day
 *     from your familiar"* (feat-5099); Basic Witch Spellcasting adds *"two common spells of that rank
 *     to your familiar"* (feat-5100).
 *   · Magus Dedication — four cantrips, prepare two (feat-9284); Basic Magus Spellcasting adds *"two
 *     common spells of that rank or lower"* (feat-9285). The older Secrets of Magic dedication's own
 *     "add a spell" sentence is not in the Impossible Magic printing (R12: the newest printing, whole) —
 *     the record's plain description text still carries it, a known leftover
 *     (scripts/data/moved-prose-baseline.json: "feat-9284 reads like feat-2945").
 *   · Necromancer Dedication — *"a dirge with four common occult cantrips … prepare two cantrips each
 *     day from your dirge"* (feat-9292); Basic Necromancer Spellcasting adds *"two common spells of that
 *     rank or lower to your dirge"* (feat-9294).
 *   · Hedge Mage Dedication — *"Your keepsake holds 4 common cantrips … You can prepare two cantrips from
 *     your keepsake each day"* (feat-9326); Basic Hedge Mage Spellcasting adds *"three common 1st-rank
 *     spells to your keepsake"* (feat-9327), Expert lets those additions be 2nd-rank (feat-9335) and
 *     Master 3rd-rank (feat-9337) — the keepsake never holds a higher rank, though the slots go to 8th.
 *   · Spellshot Dedication — a wizard's spellbook in all but name (feat-3267), on the wizard ladder.
 *
 * `holds` is the BOOK's cantrip count; `CasterArchetype.cantrips` stays the number PREPARED from it each
 * morning (scripts/archetype-cantrip-check.mjs holds that one against print, and reads the first
 * `cantrips: N` of an entry — which is why this field is not called `cantrips`). test/dedication-books
 * holds every number here against the record's own sentence.
 */
export interface ArchetypeBook {
  /** What player text calls it: "spellbook", "familiar", "dirge", "keepsake". */
  noun: 'spellbook' | 'familiar' | 'dirge' | 'keepsake';
  /** Cantrips the book holds at the dedication. */
  holds: number;
  /** Leveled spells the Basic feat adds each time the archetype gains a slot of a new rank. */
  perRank: number;
  /** "of that rank" (`exact`) or "of that rank or lower" (`orLower`). */
  rankRule: 'exact' | 'orLower';
  /** The highest rank an addition may be, by the tier that unlocked the slot's rank (Hedge Mage: 1st
   *  under Basic, 2nd under Expert, 3rd under Master) — and so the highest rank the book can hold. */
  maxRankByTier?: Record<keyof Tier, number>;
}

/** Is `spellId` a cantrip this archetype may take? True for every archetype without `cantripOptions`. */
export function archetypeCantripAllowed(a: ActiveCasterArchetype | null | undefined, spellId: string): boolean {
  const opts = a?.config.cantripOptions;
  return !opts || opts.includes(spellId);
}

/** The tradition list an archetype offers, once its widening feats are counted. */
export function archetypeTraditionOptions(a: Tier | ActiveCasterArchetype): Tradition[] | undefined {
  const { config, taken } = asArch(a);
  if (!config.traditionOptions) return undefined;
  const out = [...config.traditionOptions];
  for (const w of config.traditionOptionFeats ?? [])
    if (taken.has(w.featId)) for (const t of w.add) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * Dedications that PRINT that they count as another archetype's — the dedication feat id each one
 * stands in for, and THE FEATS THAT PERMISSION REACHES.
 *
 * Spellshot Dedication: *"This counts as the wizard archetype for the benefits of Basic Wizard
 * Spellcasting"* (feat-3267) — its whole slot ladder is the wizard one (see the table entry). The
 * prerequisite lane resolves "Wizard Dedication" to a real feat and so enforces it, which left every
 * rung of that ladder — Basic Arcana, Basic Wizard Spellcasting — unreachable for the one archetype
 * whose text hands it over. Read by `checkPrerequisites` in build.ts.
 *
 * ⚠ `forFeats` IS THE WHOLE POINT, and it is not a convenience. A blanket "holder of A also holds B"
 * token opens EVERY record whose prerequisite names B. Thirteen ship with prerequisite "Wizard
 * Dedication"; ten are the level-20 masks (*"Druid Dedication or Wizard Dedication"*, never enforced)
 * and the three that resolve are Basic Wizard Spellcasting, Basic Arcana — both on the spellshot's own
 * archetype list (archetype-122) — and **Arcane School Spell**, which is not on it and which carries a
 * focus point plus a real wizard school focus spell. The printed permission names one benefit; naming
 * the two ids the archetype actually lists keeps the ladder reachable and closes that hole.
 *
 * ⚠ NOT archetype MEMBERSHIP. A spellshot has not "started" the wizard archetype, so nothing here may
 * reach `belongsToArchetype` or the `started` half of `dedicationBlock`.
 *
 * `forFeats` has a SECOND reader, and it is the counting half of `dedicationBlock` rather than the
 * membership half: the rungs this permission reaches are printed on the BORROWER's own feat list too
 * (archetype-122 carries Basic Arcana and Basic Wizard Spellcasting; the Archives tag both
 * `archetype: ["Wizard","Spellshot"]`), so taking one counts toward the borrower's *"two other feats
 * from the … archetypes"* clause. Read the note there — this list is the whole reason that credit can
 * be given without a blanket token crediting feats neither archetype prints.
 *
 * ⚠ AND THE WALL AT THE TOP OF THE BORROWED LADDER — `notOnItsList`. Opening the bottom rung opens
 * everything above it whose OWN prerequisite line names a rung rather than the dedication: Expert
 * Wizard Spellcasting asks for *"Basic Wizard Spellcasting, master in Arcana"* and Master Wizard
 * Spellcasting for *"Expert Wizard Spellcasting, legendary in Arcana"*, neither of which mentions a
 * dedication at all. Expert IS on archetype-122 and is meant to be reachable; Master is not on it, and
 * with no `masterId` on the table entry taking it would grant a level-18 class feat's worth of nothing
 * — a silent dead pick, which is the failure mode this whole lane exists to remove. Listed feats are
 * blocked outright (`forbiddenFeatReason`) unless the character actually holds the borrowed
 * dedication, in which case they are a real member of that archetype and it is theirs.
 */
export const DEDICATION_COUNTS_AS: Record<string, { forFeats: string[]; countsAs: string[]; notOnItsList?: string[] }> = {
  'spellshot-dedication': {
    // The only two feats on archetype-122 whose prerequisite line names Wizard Dedication; the rest of
    // the ladder (Advanced Arcana, Arcane Breadth, Expert Wizard Spellcasting) hangs off these two.
    forFeats: ['basic-wizard-spellcasting', 'basic-arcana'],
    countsAs: ['wizard-dedication'],
    // archetype-122 ends at Expert Wizard Spellcasting — the spellshot's ladder stops at rank 6.
    notOnItsList: ['master-wizard-spellcasting'],
  },
};

export const CASTER_ARCHETYPES: Record<string, CasterArchetype> = {
  /*
   * ⚠ `cantrips` IS THE PREPARED-PER-DAY CAP, NOT THE SPELLBOOK SIZE. Every cantrip the player selects
   * for an archetype is castable (Builder.tsx `cantripCap`), so the number here is what the text says
   * you may PREPARE. Five entries held the other number — *"gaining a spellbook with FOUR common arcane
   * cantrips of your choice … You can PREPARE TWO cantrips each day from your spellbook"* — and let the
   * character cast all four. The batches 5–16 parity read found it on Witch and Magus; their side
   * allows one and two. Wizard, Necromancer and Hedge Mage carried it too.
   *
   * The spellbook / dirge / keepsake / familiar size lives in `book.holds` (see ArchetypeBook): the
   * cantrips the player chooses into the book, of which the first `cantrips` are the standing
   * preparation and the rest can be prepared on the sheet instead.
   * scripts/archetype-cantrip-check.mjs reads each record's own sentence and holds this in place.
   */
  'wizard-dedication': { ...mk('arcane', 'int', 2, 'wizard'), book: { noun: 'spellbook', holds: 4, perRank: 2, rankRule: 'exact' } }, // spellbook of 4, prepare 2
  'bard-dedication': mk('occult', 'cha', 2, 'bard'),
  'cleric-dedication': mk('divine', 'wis', 2, 'cleric'),
  'druid-dedication': mk('primal', 'wis', 2, 'druid'),
  'oracle-dedication': mk('divine', 'cha', 2, 'oracle'),
  'magus-dedication': { ...mk('arcane', 'int', 2, 'magus'), book: { noun: 'spellbook', holds: 4, perRank: 2, rankRule: 'orLower' } }, // spellbook of 4, prepare 2
  /* *"You can cast spells like a necromancer, gaining a dirge with four common occult cantrips of your
   * choice … You can prepare two cantrips each day from your dirge … Your key spellcasting attribute
   * for necromancer archetype spells is Intelligence, and they are occult necromancer spells."*
   * Four known, two prepared — the wizard-dedication shape. The record carried nothing at all.
   * The field holds the PREPARED number; the dirge's four are `book.holds` (see the header note). */
  'necromancer-dedication': { ...mk('occult', 'int', 2, 'necromancer'), book: { noun: 'dirge', holds: 4, perRank: 2, rankRule: 'orLower' } }, // dirge of 4, prepare 2
  /*
   * *"…they are hedge mage spells of a TRADITION ASSOCIATED WITH THE SKILL chosen for this dedication
   * (arcane for Arcana, primal for Nature, occult for Occultism, and divine for Religion)"* and *"your
   * choice of Intelligence or Wisdom"*, with *"4 common cantrips … prepare two cantrips each day"*.
   *
   * The only archetype whose tradition is decided by a SKILL answer rather than picked directly, so it
   * carries both the four options and the skill that selects among them — see `traditionForSkill`.
   */
  'hedge-mage-dedication': {
    /* ⚠ NO trailing `true`: `choiceTradition` would add a FREE tradition picker beside the skill
     * answer that is supposed to decide it, and measured, the free pick WON — skill=religion + pick=occult
     * gave occult, and with the skill unanswered the pick alone decided, which is not the printed rule.
     * `traditionBySkill` below is the whole mechanism. Same correction already made to bloodrager. */
    ...mk('arcane', 'int', 2, 'hedge-mage'), // keepsake holds 4, prepare 2
    traditionOptions: ['arcane', 'primal', 'occult', 'divine'],
    choiceKeyAbility: ['int', 'wis'],
    traditionBySkill: { arcana: 'arcane', nature: 'primal', occultism: 'occult', religion: 'divine' },
    book: { noun: 'keepsake', holds: 4, perRank: 3, rankRule: 'orLower', maxRankByTier: { basic: 1, expert: 2, master: 3 } },
  },
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
  /* SPONTANEOUS, not prepared. Basic Prophet Spellcasting prints *"add a common occult spell of the
   * appropriate rank… TO YOUR REPERTOIRE"*, which is the spontaneous shape, and their side defines the
   * casting source as a spontaneous repertoire. Ours handed the player prepared occult slots. */
  'prophet-of-kalistrade-dedication': { ...mk('occult', 'cha', 3, 'prophet'), repertoire: true },
  /* SPONTANEOUS, not prepared: measured, a level-8 taker built as `prepared` with no slots at all. */
  'rivethun-involutionist-dedication': { ...mk('divine', 'wis', 2, 'rivethun'), repertoire: true },
  // Bloodrager: a spontaneous repertoire of 2 cantrips from EITHER the arcane or divine list (player's
  // choice), Cha key, trained spell attack/DC.
  //
  // ITS LADDER EXISTS — it is simply not named after the archetype. `basic-bloodrager-spellcasting`
  // and its siblings genuinely do not ship, which is why this was read as cantrips-only; the three
  // feats whose text is "You gain the benefits" are Rising Blood Magic (4), Surging Blood Magic (12)
  // and Exultant Blood Magic (18). Without them the archetype never gained a single spell slot.
  /* The tradition follows the record's OWN bloodline pick (Arcane -> arcane, Divine -> divine) — the
   * same answer that decides the trained skill — so it uses `traditionBySkill`, keyed by that answer,
   * rather than `choiceTradition`. Under `choiceTradition` the builder rendered a SECOND "Tradition"
   * picker beside the feat's own bloodline question: one printed choice asked twice, with nothing
   * keeping the two answers in step. */
  'bloodrager-dedication': {
    ...mk('arcane', 'cha', 2, 'bloodrager'),
    basicId: 'rising-blood-magic',
    expertId: 'surging-blood-magic',
    masterId: 'exultant-blood-magic',
    traditionBySkill: { arcana: 'arcane', religion: 'divine' },
    repertoire: true,
  },
  // Choice-tradition: the tradition follows a bloodline (sorcerer) / patron (witch);
  // the builder offers a tradition picker rather than modelling the full sub-choice.
  'sorcerer-dedication': mk('arcane', 'cha', 2, 'sorcerer', true),
  'witch-dedication': { ...mk('occult', 'int', 1, 'witch', true), book: { noun: 'familiar', holds: 2, perRank: 2, rankRule: 'exact' } }, // familiar knows 2, prepare 1
  // Guns & Gears casters: tradition of your choice (beast-gunner limited to arcane/primal), Cha key.
  'eldritch-archer-dedication': mk('arcane', 'cha', 1, 'eldritch-archer', true),
  // Their four options are tradition × KEY ATTRIBUTE ("Arcane - Charisma" / "Primal - Intelligence", …):
  // *"Your key spellcasting ability for these spells is either Charisma or Intelligence, chosen when you
  // take this feat."* Only the tradition half was modelled, so an Intelligence beast gunner was unbuildable.
  'beast-gunner-dedication': { ...mk('arcane', 'cha', 1, 'beast-gunner', true), traditionOptions: ['arcane', 'primal'], choiceKeyAbility: ['cha', 'int'] },
  /*
   * SPELLSHOT (Guns & Gears) — a gunslinger CLASS archetype whose dedication is a wizard in all but
   * name: *"You cast arcane spells like a wizard, gaining a spellbook with four common arcane cantrips
   * of your choice … You can prepare two cantrips each day from your spellbook. You're trained in the
   * spell attack modifier and spell DC statistics. Your key spellcasting attribute for spellshot
   * archetype spells is Intelligence, and they are arcane spells. … This counts as the wizard archetype
   * for the benefits of Basic Wizard Spellcasting."* (feat-3267).
   *
   * Its slot ladder is therefore the WIZARD one — no `basic-spellshot-spellcasting` exists — which is
   * why mk() could not mint it and the archetype was missing from this table altogether. Measured at
   * levels 2, 4 and 8, a spellshot had NO spellcasting entry at all and Basic Wizard Spellcasting
   * granted nothing; the record's own `note` told the player to take that feat through an Override.
   *
   * ⚠ IT SITS AFTER beast-gunner-dedication ON PURPOSE, and moving it up is a live regression.
   * `activeCasterArchetype` returns the FIRST key the character matches and the app models ONE
   * archetype caster. Spellshot + Beast Gunner is the one dedication pairing the record itself
   * legalises — *"You can't select another dedication feat OTHER THAN BEAST GUNNER DEDICATION until…"*
   * — and a character holding both has been getting the beast gunner's spontaneous repertoire since it
   * shipped. Placed first, this entry replaced that repertoire, its cantrips and its slots with a
   * prepared arcane entry the moment the app updated: a player's spells vanishing off the sheet with
   * nothing asked. Measured both ways; the pairing keeps the beast gunner, and a lone spellshot is
   * unaffected because it matches nothing earlier. Owner question: two archetype casters at once.
   *
   * ⚠ NO masterId, deliberately. The archetype's printed feat list (archetype-122) is Spellshot
   * Dedication · Basic Arcana · Basic Wizard Spellcasting · Spell-Woven Shot · Advanced Arcana ·
   * Fulminating Shot · Arcane Breadth · Call Gun · Expert Wizard Spellcasting · Phase Bullet · Black
   * Powder Embodiment. Master Wizard Spellcasting is not on it, so the ladder stops at expert (ranks
   * 1-6). Owner question: allow the master rung anyway for a spellshot who takes it?
   */
  'spellshot-dedication': {
    tradition: 'arcane',
    keyAbility: 'int',
    cantrips: 2, // spellbook of 4, prepare 2 — see the header note above
    basicId: 'basic-wizard-spellcasting',
    expertId: 'expert-wizard-spellcasting',
    // Basic Wizard Spellcasting's book sentence, which this dedication borrows: two spells of that rank.
    book: { noun: 'spellbook', holds: 4, perRank: 2, rankRule: 'exact' },
  },
  // Psychic: occult tradition, key = the attribute you qualified with (Int or Cha — player's choice).
  'psychic-dedication': { ...mk('occult', 'int', 1, 'psychic'), choiceKeyAbility: ['int', 'cha'] },
  // Summoner: a spontaneous repertoire whose tradition follows the chosen eidolon TYPE; caps at Expert
  // (no master-summoner-spellcasting feat exists). Cha key.
  'summoner-dedication': { ...mk('arcane', 'cha', 2, 'summoner'), eidolonTradition: true, castsFromBasic: true },
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
    // Cascade Bearer's Spellcasting is what turns the Attendant from a one-cantrip innate caster into
    // a halcyon caster: "You gain a halcyon cantrip and a halcyon 1st-rank spell", and the halcyon
    // list widens to divine and occult. The extra cantrip rides on the feat's own spellSlotBonus.
    customUnlocks: [{ rank: 1, level: 10, featId: 'cascade-bearers-spellcasting' }],
    repertoire: true,
    traditionOptionFeats: [{ featId: 'cascade-bearers-spellcasting', add: ['divine', 'occult'] }],
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
    // "…two common 1st-rank halcyon spells" over ONE 1st-rank slot (feat-1115): one known beyond the
    // slot count. The slot pool stays at the schedule's 1.
    extraKnown: { 1: 1 },
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
  /*
   * Oatia Skysage (Gatewalkers). A SPONTANEOUS occult repertoire — *"You gain a spell repertoire with
   * two of the following cantrips of your choice"*, Intelligence key, trained — whose progression feats
   * are named "… Skysage DIVINATION" rather than "… Spellcasting", which is presumably how the whole
   * archetype came to be missing from this table.
   *
   * Absent from here, a skysage got two at-will cantrips and NOTHING else: measured at levels 4/8/14/20,
   * the character had no spellcasting entry at all. Basic Skysage Divination contributed nothing.
   *
   * Its ladder runs TWO LEVELS AHEAD of the standard one from Expert on, because Expert Skysage
   * Divination is a 10th-level feat rather than a 12th (verified against the shipped feat levels:
   * dedication 2, basic 4, expert 10, master 16). Only the captivator otherwise reaches rank 9.
   */
  'oatia-skysage-dedication': {
    tradition: 'occult',
    keyAbility: 'int',
    cantrips: 2,
    repertoire: true,
    /* *"…two of the following cantrips of your choice: detect magic, guidance, know the way, or read
     * aura"* (feat-8112). All four are on the occult list, so the restriction is a narrowing of the
     * 38 the tradition filter offers, never a widening. */
    cantripOptions: ['detect-magic', 'guidance', 'know-the-way', 'read-aura'],
    customUnlocks: [
      { rank: 1, level: 4, featId: 'basic-skysage-divination' },
      { rank: 2, level: 6, featId: 'basic-skysage-divination' },
      { rank: 3, level: 8, featId: 'basic-skysage-divination' },
      { rank: 4, level: 10, featId: 'expert-skysage-divination' },
      { rank: 5, level: 12, featId: 'expert-skysage-divination' },
      { rank: 6, level: 14, featId: 'expert-skysage-divination' },
      { rank: 7, level: 16, featId: 'master-skysage-divination' },
      { rank: 8, level: 18, featId: 'master-skysage-divination' },
      { rank: 9, level: 20, featId: 'master-skysage-divination' },
    ],
    /* `customUnlocks` otherwise pins proficiency at trained (right for the Halcyon Speaker, whose feats
     * grant no advancement); these two feats DO advance it, so they are named explicitly. */
    profExpertFeat: 'expert-skysage-divination',
    profMasterFeat: 'master-skysage-divination',
  },

  /*
   * THE GENERIC SPELLCASTING LADDER — `basic-` / `expert-` / `master-spellcasting`.
   *
   * These three are the archetype-agnostic feats the Spellcasting Archetypes rules describe (AoN
   * rules-170): *"Basic Spellcasting Feat: usually gained at 4th level, these feats grant a 1st-level
   * spell slot. At 6th level, they grant you a 2nd-level spell slot… At 8th level, they grant you a
   * 3rd-level spell slot."* NOTHING in the app read them — `activeCasterArchetype` had no key they
   * could match, so a character holding all three received no slots at any level.
   *
   * Keyed on `cantrip-casting`, the root feat the ladder hangs off (precedent: `first-frost` above is
   * likewise keyed on something other than a Dedication). ⚠ MUST STAY LAST in this object:
   * `activeCasterArchetype` returns the FIRST key the character matches, and a real caster dedication
   * has to win over the generic ladder when a character holds both.
   *
   * Spontaneous with a free tradition and a free key attribute, because the ladder is shared by
   * several trait-gated archetypes rather than naming one.
   */
  'cantrip-casting': {
    tradition: 'arcane',
    keyAbility: 'cha',
    cantrips: 0,
    basicId: 'basic-spellcasting',
    expertId: 'expert-spellcasting',
    masterId: 'master-spellcasting',
    choiceTradition: true,
    repertoire: true,
    choiceKeyAbility: ['int', 'wis', 'cha'],
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
  /** Extra entry ids this archetype answers for. A MERGED archetype (Magaambyan Attendant + Halcyon
   *  Speaker are one caster when both are held) keeps the Attendant's entry id, and the shipped rows
   *  that name `halcyon-speaker-dedication-casting` must still fire — see archetypeEntryIds. */
  entryIdAliases?: string[];
}

/** The spellcasting entry ids that target this archetype's pool — the canonical
 *  `<dedicationId>-casting` plus any alias a merged archetype answers for. */
export function archetypeEntryIds(arch: ActiveCasterArchetype): Set<string> {
  return new Set([`${arch.dedicationId}-casting`, ...(arch.entryIdAliases ?? [])]);
}

/** The caster archetype a character is invested in (a taken caster dedication) + which
 * spellcasting feats they've taken. Returns the first match, or null. */
export function activeCasterArchetype(takenFeatIds: string[], _content?: ContentDatabase): ActiveCasterArchetype | null {
  const taken = new Set(takenFeatIds);
  /*
   * Magaambyan Attendant + Halcyon Speaker are ONE caster when both are held — the Attendant is the
   * Halcyon Speaker's printed prerequisite, so the first-match loop below always resolved the
   * Attendant's innate-cantrip config and a legal L6 halcyon speaker got 1 innate cantrip, 0 slots
   * and 0 halcyon spells. Owner ruling R4 (docs/gold-set-answers.md): merge into the ATTENDANT's
   * entry id (its tradition/key answers and Cascade Bearer's divine/occult widening keep reading),
   * alias the Halcyon entry id so the shipped rows aimed at it still fire, and grow the pool:
   * 3 cantrips (1 Attendant + 2 Halcyon), the halcyon slot schedule, and one extra KNOWN 1st-rank
   * spell ("two common 1st-rank halcyon spells" over one slot).
   */
  if (taken.has('magaambyan-attendant-dedication') && taken.has('halcyon-speaker-dedication')) {
    const mag = CASTER_ARCHETYPES['magaambyan-attendant-dedication'];
    const hal = CASTER_ARCHETYPES['halcyon-speaker-dedication'];
    return {
      dedicationId: 'magaambyan-attendant-dedication',
      config: {
        ...mag,
        cantrips: mag.cantrips + hal.cantrips,
        innateCantrip: undefined, // the halcyon pool absorbs the innate cantrip
        repertoire: true,
        customUnlocks: [...(mag.customUnlocks ?? []), ...(hal.customUnlocks ?? [])],
        profExpertFeat: hal.profExpertFeat,
        profMasterFeat: hal.profMasterFeat,
        extraKnown: hal.extraKnown,
      },
      tier: { basic: false, expert: false, master: false },
      taken,
      entryIdAliases: ['halcyon-speaker-dedication-casting'],
    };
  }
  for (const [dedicationId, config] of Object.entries(CASTER_ARCHETYPES)) {
    if (!taken.has(dedicationId)) continue;
    // Bounded casters whose dedication carries no casting: not a caster until the Basic feat is taken.
    if (config.castsFromBasic && !(config.basicId && taken.has(config.basicId))) continue;
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
  // customUnlocks is tested FIRST: the Magaambyan Attendant is an innate-cantrip archetype that gains
  // a real 1st-rank slot from Cascade Bearer's Spellcasting, and the early return below would have
  // discarded it before the schedule was ever read.
  if (arch.config.customUnlocks) {
    for (const u of arch.config.customUnlocks) if (arch.taken.has(u.featId) && level >= u.level) out[u.rank] = 1;
    return out;
  }
  // An innate-cantrip archetype with no schedule of its own has no slots at all.
  if (arch.config.innateCantrip) return out;
  for (const [rank, minLevel, t] of RANK_UNLOCKS) if (arch.tier[t] && level >= minLevel) out[rank] = 1;
  return out;
}

/** The archetype's BOOK, or null — a prepared archetype that prints one (see ArchetypeBook). A spontaneous
 *  or innate pool never has one, whatever its config says. */
export function archetypeBook(a: ActiveCasterArchetype | null | undefined): ArchetypeBook | null {
  const book = a?.config.book;
  if (!book || a!.config.repertoire || a!.config.innateCantrip || a!.config.innateRanked) return null;
  return book;
}

/** One rank of an archetype book: the spells the Basic feat adds when the archetype's slot of `rank`
 *  arrives, and the ranks those spells may be. */
export interface ArchetypeBookRank {
  rank: number;
  /** How many spells this rank adds to the book. */
  places: number;
  /** The lowest and highest rank a spell added here may be. */
  minSpellRank: number;
  maxSpellRank: number;
}

/**
 * The ranks an archetype's book has GROWN at by `level`: *"Each time you gain a spell slot of a new rank
 * from the … archetype, add two common spells …"*. A rank counts once its slot exists — the standard
 * ladder's tier feat taken and the level reached (`RANK_UNLOCKS`) — and Arcane or Patron's Breadth, which
 * add slots at ranks the archetype already has, add nothing to the book. The Basic feat is what adds
 * spells: before it the book holds cantrips only.
 */
export function archetypeBookRanks(level: number, a: ActiveCasterArchetype | null | undefined): ArchetypeBookRank[] {
  const book = archetypeBook(a);
  if (!book || !a) return [];
  const out: ArchetypeBookRank[] = [];
  for (const [rank, minLevel, t] of RANK_UNLOCKS) {
    if (!a.tier[t] || level < minLevel) continue;
    const ceiling = Math.min(rank, book.maxRankByTier?.[t] ?? rank);
    out.push({ rank, places: book.perRank, minSpellRank: book.rankRule === 'exact' ? rank : 1, maxSpellRank: ceiling });
  }
  return out;
}

const ordinal = (r: number) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`);

/** What a book rank's row adds, beside its "Nth rank" heading — "" where the spells are of that rank
 *  (wizard, witch, spellshot; any book's 1st rank), "1st-rank spells" for a hedge mage's 2nd and 3rd
 *  ranks under Basic, "2nd rank or lower" for a magus's or necromancer's 2nd rank. Without it a hedge
 *  mage's "2nd rank" row offered only 1st-rank spells with nothing saying why. */
export function archetypeBookRankNote(r: ArchetypeBookRank): string {
  if (r.minSpellRank === r.maxSpellRank) return r.maxSpellRank === r.rank ? '' : `${ordinal(r.maxSpellRank)}-rank spells`;
  return `${ordinal(r.maxSpellRank)} rank or lower`;
}

/** The book's rule as one sentence, for the rank `r` the player is filling: "Each new spell rank adds 2
 *  spells of that rank to your spellbook." — "of that rank or lower" (magus, necromancer), "3 1st-rank
 *  spells" / "3 spells of 2nd rank or lower" (hedge mage, by tier). One sentence for both builder surfaces. */
export function archetypeBookSentence(book: ArchetypeBook, r: ArchetypeBookRank | undefined): string {
  const what = !r
    ? book.rankRule === 'exact' ? 'spells of that rank' : 'spells of that rank or lower'
    : book.maxRankByTier
      ? r.maxSpellRank === 1
        ? '1st-rank spells'
        : `spells of ${ordinal(r.maxSpellRank)} rank or lower`
      : book.rankRule === 'exact' || r.maxSpellRank === 1
        ? 'spells of that rank'
        : 'spells of that rank or lower';
  return `Each new spell rank adds ${book.perRank} ${what} to your ${book.noun}.`;
}

/** The highest rank a spell in this archetype's book may be, where the BOOK caps it below the slots —
 *  a hedge mage's keepsake (*"Your keepsake can also hold 1st-rank spells"*, 2nd with Expert, 3rd with
 *  Master); 0 while only the dedication is held. Undefined for every other book: it holds whatever rank
 *  its slots reach. */
export function archetypeBookMaxRank(a: ActiveCasterArchetype | null | undefined): number | undefined {
  const book = archetypeBook(a);
  if (!book?.maxRankByTier || !a) return undefined;
  if (a.tier.master) return book.maxRankByTier.master;
  if (a.tier.expert) return book.maxRankByTier.expert;
  if (a.tier.basic) return book.maxRankByTier.basic;
  return 0;
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
