// ---------------------------------------------------------------------------
// Raw Pf2eTools JSON types (matching the actual repo format)
// ---------------------------------------------------------------------------

export interface RawCreature {
  name: string
  source: string
  page?: number
  level: number
  traits?: string[]
  perception?: { std?: number; [key: string]: number | undefined }
  senses?: Array<{ name: string; range?: number }>
  /** AoN's qualifier on the Perception modifier — "+27 to detect lies" (Kolyarut), "26 vs traps"
   *  (Kuworsys), "expert" (Valerie). 105 creatures. It used to ride at the head of `senses[0]`
   *  and render as a pseudo-sense; parseSenses now splits it out here. */
  perceptionNote?: string
  languages?: { languages?: string[]; abilities?: string[] }
  skills?: Record<string, { std?: number; [k: string]: number | string | undefined }>
  abilityMods?: { str: number; dex: number; con: number; int: number; wis: number; cha: number }
  items?: string[]
  speed?: { walk?: number; fly?: number; swim?: number; burrow?: number; climb?: number }
  /** AoN's Speed line after the ';' — "trailblazing stride, troop movement". 497 creatures name
   *  movement abilities there, and five optional numbers have nowhere to put them. */
  speedNote?: string
  attacks?: RawAttack[]
  spellcasting?: RawSpellcasting[]
  /** Rituals the creature can cast (added by scripts/add-rituals.mjs). */
  rituals?: RitualBlock
  abilities?: { top?: RawAbility[]; mid?: RawAbility[]; bot?: RawAbility[] }
  defenses?: RawDefenses
  /** AoN flavor blurb shown above the stat block. */
  flavor?: string
  /** AoN creature-family name (its description lives in creature-families.json). */
  family?: string
}

export interface RawAttack {
  range: 'Melee' | 'Ranged'
  name: string
  attack: number
  /* AoN prints an action cost on every Melee/Ranged line and the parser was reading it, then
   * discarding it — 9,487 strikes across 4,546 creatures. Same shape as RawAbility.activity so the
   * one `activitySymbol` converts both. 29 strikes carry an EMPTY cost on purpose; those stay
   * undefined rather than defaulting to one action. */
  activity?: { number: number; unit: string; to?: number; sep?: 'to' | 'or' }
  traits?: string[]
  damage?: string
  types?: string[]
  note?: string
  effects?: string[]
}

export interface RawDefenses {
  ac?: { std?: number; [key: string]: number | undefined }
  /** AoN's qualifier beside the AC — "all-around vision", "(19 when broken)",
   *  "(29 with shield raised)". 272 creatures. Kept OUT of `ac` so that object stays
   *  numeric-only: widening its index signature breaks every numeric helper that reads it. */
  acNote?: string
  savingThrows?: {
    fort?: { std?: number; [k: string]: number | undefined }
    ref?: { std?: number; [k: string]: number | undefined }
    will?: { std?: number; [k: string]: number | undefined }
    /** AoN's note after the three saves — "+1 status to all saves vs. magic", "construct armor".
     *  Markdown-only: every save facet is a bare integer, so this had nowhere to come from. */
    note?: string
  }
  hp?: Array<{ hp: number; name?: string; abilities?: string[] }>
  hardness?: { std?: number }
  bt?: { std?: number }
  immunities?: string[]
  /* `amount` is NULL for the ones AoN prints with no value — "light vulnerability",
   * "vampire weaknesses", "axe vulnerability". Requiring a number dropped 113 of them, and where it
   * was the only weakness the array shipped empty, asserting the creature had none. */
  resistances?: Array<{ amount: number | null; name: string; note?: string }>
  weaknesses?: Array<{ amount: number | null; name: string; note?: string }>
}

export interface RawAbility {
  name: string
  /* A VARIABLE action cost needs `to`. AoN writes 171 abilities as a range —
   * `<actions string="Single Action to Three Actions" />` (153 of them), plus the `or` forms
   * ("Single Action or Two Actions") — and a bare {number, unit} cannot say that, so those costs
   * had nowhere to land and were dropped on import. `to` is the upper bound; `sep` keeps AoN's own
   * wording rather than normalising "or" into "to". */
  activity?: { number: number; unit: string; to?: number; sep?: 'to' | 'or' }
  traits?: string[]
  trigger?: string
  requirements?: string
  entries: (string | object)[]
  frequency?: { number: number; unit: string }
}

export interface RawSpellcasting {
  name?: string
  type: string
  tradition?: string
  DC?: number
  attack?: number
  /** Size of the focus pool, written by scripts/enrich-spell-usage.mjs. */
  focusPoints?: number
  entry?: Record<string, {
    level?: number
    /** Spontaneous rank slot count (enrich-spell-usage.mjs). */
    slots?: number
    /* `note` is AoN's per-spell parenthetical with the usage token removed — "self only",
     * "cave bear or woolly rhinoceros only", "Dimension of Time and Universe only". 584 of them
     * over the corpus; written by harvestSpells in scripts/lib/creature-markdown.mjs. */
    spells?: Array<{ name: string; amount?: string | number; atWill?: boolean; note?: string }>
  }>
  fp?: number
}

/** A creature's ritual list: a shared DC and one or more rank groups, each
 *  naming the rituals castable at that rank (names match the rituals index). */
export interface RitualCast { rank: string; level: number; names: string[] }
export interface RitualBlock { dc?: number; casts: RitualCast[] }

export interface RawCondition {
  name: string
  source: string
  page?: number
  entries: (string | object)[]
  group?: string
}

export interface RawHazard {
  name: string
  source: string
  page?: number
  level: number
  traits?: string[]
  stealth?: { bonus?: number; dc?: number; minProf?: string }
  description?: (string | object)[]
  disable?: { entries: (string | object)[] }
  defenses?: RawDefenses
  actions?: RawAbility[]
  abilities?: { mid?: RawAbility[] }
  routine?: (string | object)[]
  reset?: (string | object)[]
  complex?: boolean
}

export interface RawTrait {
  name: string
  entries: (string | object)[]
  categories?: string[]
}

// ---------------------------------------------------------------------------
// Runtime types used in the tracker
// ---------------------------------------------------------------------------

export interface Creature {
  id: string
  name: string
  source: string
  level: number
  image?: string   // base64 data URL
  traits: string[]
  perception: number
  senses: string[]
  /** Qualifier shown beside the Perception modifier (see RawCreature.perceptionNote). */
  perceptionNote?: string
  languages: string[]
  skills: Record<string, number>
  str: number; dex: number; con: number; int: number; wis: number; cha: number
  items: string[]
  speed: { walk?: number; fly?: number; swim?: number; burrow?: number; climb?: number }
  /** Movement abilities AoN prints after the Speed value (see RawCreature.speedNote). */
  speedNote?: string
  attacks: Attack[]
  spellcasting: SpellBlock[]
  /** Rituals the creature can cast (see RitualBlock); names link the rituals index. */
  rituals?: RitualBlock
  abilities: Ability[]
  defenses: Defenses
  isHazard: boolean
  hazardData?: HazardExtra
  /** AoN flavor blurb shown above the stat block (group description + Recall
   *  Knowledge DCs). */
  flavor?: string
  /** AoN creature-family name; its description is looked up in the family data. */
  family?: string
  /** Pasted/imported Recall Knowledge line (overrides computed display when set) */
  recallKnowledge?: string
  /** AoN URL for linking to the original page */
  aonUrl?: string
  /**
   * Full markdown/text from AoN ES — used as fallback display when structured
   * data (attacks, abilities) was not fully parsed.
   */
  rawMarkdown?: string
  raw: RawCreature | RawHazard
}

export interface Attack {
  range: 'Melee' | 'Ranged'
  name: string
  attack: number
  /** The strike's action cost as a glyph string (see activitySymbol). Optional, like
   *  Ability.activity: hand-built strikes (the editor, hazards, the sample block) have no AoN
   *  markdown behind them and legitimately carry no cost. */
  activity?: string
  traits: string[]
  damage: string
  types: string[]
  effects: string[]
  isAgile: boolean
}

export interface Defenses {
  ac: number
  fort: number
  ref: number
  will: number
  hp: number
  /** What AoN prints beside the HP — "(4 segments)", "(3 heads)", regeneration. 808 creatures. */
  hpNote?: string
  /** AoN's note after the saves — "+1 status to all saves vs. magic". 942 creatures. */
  saveNote?: string
  /** AoN's qualifier beside the AC — "all-around vision", "(19 when broken)". 272 creatures. */
  acNote?: string
  hardness?: number
  bt?: number
  immunities: string[]
  resistances: Array<{ amount: number | null; name: string; note?: string }>
  weaknesses: Array<{ amount: number | null; name: string; note?: string }>
}

export interface Ability {
  name: string
  activity?: string
  traits: string[]
  trigger?: string
  entries: string
}

export interface SpellSlotEntry {
  label: string         // "Cantrips", "Level 3", "Constant (2nd)", etc.
  level: number         // actual spell level for tooltip lookup
  /** Spontaneous casters: number of spell slots for this rank (the whole
   *  rank shares the pool). Undefined for prepared / innate / cantrips. */
  slots?: number
  /** Cantrips are at-will — flagged so the UI skips usage tracking. */
  isCantrip?: boolean
  /** Constant spells are always active — flagged to skip tracking. */
  isConstant?: boolean
  spells: Array<{
    name: string
    /** Display amount string ("×2") for the old fallback renderer. */
    amount?: string
    /** Number of casts this specific spell gets (prepared ×N or innate
     *  uses). Undefined = the rank/default rule applies. */
    uses?: number
    /** Innate at-will spell — unlimited, no counter shown. */
    atWill?: boolean
    /** AoN's per-spell restriction, minus the usage token: the Solar's Invisibility is
     *  "self only", the Zebub's Summon Animal is "swarm creatures only". */
    note?: string
  }>
}

export interface SpellBlock {
  name: string
  type: string
  tradition?: string
  DC?: number
  attack?: number
  /** Focus blocks: size of the focus pool (1–3). The whole block shares it. */
  focusPoints?: number
  spells: string                  // fallback formatted string
  spellsByLevel: SpellSlotEntry[]
}

export interface HazardExtra {
  stealth?: string
  description: string
  disable: string
  routine?: string
  reset?: string
  complex: boolean
}

// ---------------------------------------------------------------------------
// Combat tracker runtime state
// ---------------------------------------------------------------------------

export interface AppliedCondition {
  id: string
  name: string
  value?: number
  /** When true, the condition reduces itself by 1 at end of each turn (matches
   *  Frightened / Stunned behaviour for advanced custom conditions). Mirrors
   *  the built-in `ConditionMeta.autoDecrement` flag. */
  autoDecrement?: boolean
  duration?: number
  /** Combatant id of the creature that CREATED the effect. Player Core p. 426: a duration in rounds
   *  *"decreases by 1 at the start of each turn of the creature that created the effect"* — so the
   *  clock belongs to the source, not to whoever is wearing the condition. Absent means the other
   *  printed family, *"until the end of the target's next turn"*: it ticks at the end of the
   *  affected creature's own turn (also what every pre-source saved snapshot means). */
  source?: string
  isPermanent: boolean
  /** Optional free-form description shown when hovering the condition badge.
   *  Used by custom user-added conditions and by auto-generated ability
   *  cooldowns (where this carries the ability's body text). */
  description?: string
  /** Maximum value for hasValue conditions — copied off the source template
   *  so the +/− buttons can clamp without looking up the saved definition. */
  maxValue?: number
  /** Stat modifier table for advanced custom conditions. When present,
   *  `computeConditionMods` uses these numbers instead of the built-in
   *  switch. Partial — only set keys contribute. */
  mods?: Partial<{
    ac: number; fort: number; ref: number; will: number
    attackBonus: number; meleeAttack: number; rangedAttack: number
    perception: number; allChecks: number
    spellAttack: number; spellDC: number; classDC: number
    speed: number
    acrobatics: number; arcana: number; athletics: number; crafting: number
    deception: number; diplomacy: number; intimidation: number; medicine: number
    nature: number; occultism: number; performance: number; religion: number
    society: number; stealth: number; survival: number; thievery: number
  }>
  /** When true, the stored `mods` are multiplied by the current `value`
   *  (Frightened-style scaling — −1 AC per Frightened point). */
  scalesByValue?: boolean
  /** Bonus/penalty type per flat-mod stat (circumstance / status / item /
   *  untyped). Drives PF2e typed stacking. Absent → untyped (stacks). */
  modTypes?: Record<string, string>
  /** Situational modifiers that only apply in a specific circumstance (e.g.
   *  "+2 to Will saves against fear"). Unlike `mods`, these are NOT folded
   *  into the displayed number — the stat block shows a "*" next to the
   *  matching check whose tooltip reveals the adjusted value + circumstance,
   *  and clicking it rolls with the modifier applied. Keyed by the same stat
   *  names as `mods`. */
  condMods?: Record<string, { value: number; when: string; type?: string }>
  /** Optional badge tinting from the source template. */
  bg?: string
  border?: string
  /** Persistent-damage condition only: the damage expression (e.g. "2d6" or
   *  "4") and its type (e.g. "fire", "bleed"). Triggers a reminder/auto-roll at
   *  the end of the affected creature's turn (see combatStore.nextTurn). */
  pdAmount?: string
  pdType?: string
}

export interface Combatant {
  id: string
  name: string
  creature: Creature | null
  isPC: boolean
  isAlly: boolean    // true = allied NPC (counts with players for XP purposes)
  initiative: number | null
  currentHP: number
  maxHP: number
  tempHP: number
  conditions: AppliedCondition[]
  isElite: boolean
  isWeak: boolean
  scaledToLevel?: number
  notes: string
  isDefeated: boolean
  /** Delayed: out of the turn order (skipped by nextTurn) until the GM brings it back in after
   *  someone's turn. Cleared when a new combat starts. */
  isDelayed?: boolean
  /** Consumed count for each tracked limited-use resource, keyed by the
   *  helpers in utils/limitedUses.ts (abilities, spell slots, prepared /
   *  innate spell uses, focus pool). Absent / 0 = fully available. */
  resourceUses?: Record<string, number>
}

export interface SavedEncounter {
  name: string
  savedAt: string
  combatants: Array<{
    name: string
    creature: Creature | null
    creatureId: string | null  // kept for legacy saved data
    isPC: boolean
    isAlly?: boolean    // optional for back-compat with older saves
    maxHP: number
    isElite: boolean
    isWeak: boolean
    scaledToLevel?: number
    notes: string
  }>
}

export interface DiceResult {
  id: string
  label: string
  rolls: number[]
  total: number
  modifier: number
  isCrit: boolean
  isFumble: boolean
  isAttack: boolean
  timestamp: number
  /** 'reminder' renders as a warning card (no big number) — used by the
   *  persistent-damage end-of-turn reminder. Default/absent = a normal roll. */
  kind?: 'roll' | 'reminder'
  /** Body text for reminder cards. */
  note?: string
}
