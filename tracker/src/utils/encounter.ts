import type { Combatant } from '../types/pf2e'
import { effectiveLevel } from './weakElite'
import { partyLevelRule, extraMembers } from './partyLevel'

// ─────────────────────────────────────────────────────────────────────────────
// PF2e Encounter Building rules — verified against GM Core / Archives of Nethys
// (Encounter Design → Building Encounters).
// ─────────────────────────────────────────────────────────────────────────────

/** XP award per adversary by (effective level − party level), clamped to the
 *  PF2e table's −4 / +4 bounds. Used for creatures AND complex hazards (the
 *  complex-hazard column equals the creature column). Verified against GM Core
 *  Table 10-1 / 10-2. */
const XP_BY_DIFF: Record<number, number> = {
  [-4]: 10, [-3]: 15, [-2]: 20, [-1]: 30,
  [0]:  40, [1]:  60, [2]:  80, [3]:  120, [4]:  160,
}

/** XP award for a SIMPLE hazard by (effective level − party level). Explicit
 *  rather than computed so it matches the GM Core table exactly. */
const SIMPLE_HAZARD_XP_BY_DIFF: Record<number, number> = {
  [-4]: 2, [-3]: 3, [-2]: 4, [-1]: 6,
  [0]:  8, [1]:  12, [2]:  16, [3]:  24, [4]:  32,
}

/** Encounter budget thresholds for a party of 4 PCs.
 *
 *  Per GM Core:
 *    Trivial  ≤ 40 XP   (character adjustment ±10 per PC)
 *    Low      = 60 XP   (character adjustment ±20 per PC)
 *    Moderate = 80 XP   (character adjustment ±20 per PC)
 *    Severe   = 120 XP  (character adjustment ±30 per PC)
 *    Extreme  = 160 XP  (character adjustment ±40 per PC)
 *
 *  Note: each difficulty has its OWN per-PC adjustment value — they're not
 *  all the same. The previous implementation used 20 for every tier and the
 *  threshold values were one tier too low, so encounters were classified
 *  one step harder than they actually were. */
interface Tier { base: number; adjust: number }
const BUDGET = {
  trivial:  { base: 40,  adjust: 10 } as Tier,
  low:      { base: 60,  adjust: 20 } as Tier,
  moderate: { base: 80,  adjust: 20 } as Tier,
  severe:   { base: 120, adjust: 30 } as Tier,
  extreme:  { base: 160, adjust: 40 } as Tier,
}

export type Difficulty = 'Trivial' | 'Low' | 'Moderate' | 'Severe' | 'Extreme'

/** GM Core pg. 75 Table 10-1 as rows — [threat, XP budget for 4, Character Adjustment] — for the
 *  screens that print the table (the GM screen's Treasure & XP widget). One table: that widget kept
 *  its own copy with the legacy Core Rulebook's Low ±15 while this rating used GM Core's ±20. */
export const XP_BUDGET_ROWS: ReadonlyArray<readonly [Difficulty, number, number]> = [
  ['Trivial',  BUDGET.trivial.base,  BUDGET.trivial.adjust],
  ['Low',      BUDGET.low.base,      BUDGET.low.adjust],
  ['Moderate', BUDGET.moderate.base, BUDGET.moderate.adjust],
  ['Severe',   BUDGET.severe.base,   BUDGET.severe.adjust],
  ['Extreme',  BUDGET.extreme.base,  BUDGET.extreme.adjust],
]

/** The five thresholds for a party of `partySize` (members plus any pg. 57 extras): each tier moves
 *  by its own Character Adjustment per member above or below four (GM Core pg. 75–76). */
export function budgetFor(partySize: number): EncounterStats['budget'] {
  const extra = partySize - 4
  return {
    trivial:  BUDGET.trivial.base  + extra * BUDGET.trivial.adjust,
    low:      BUDGET.low.base      + extra * BUDGET.low.adjust,
    moderate: BUDGET.moderate.base + extra * BUDGET.moderate.adjust,
    severe:   BUDGET.severe.base   + extra * BUDGET.severe.adjust,
    extreme:  BUDGET.extreme.base  + extra * BUDGET.extreme.adjust,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WHO IS IN THE PARTY, AND WHO IS THE OPPOSITION (owner's list 2026-10-01, item 5)
//
// "the difficulty calculator needs to look at each party player and npc and calculate according to
//  their lv. the calculation is only for the ones in the tracker not the ones sitting in the party
//  dashboard. don't show calculation if there aren't any party members / npcs in the fight."
//
// One rule decides each row's side, and both the XP sum (computeEncounter) and the party (partyOf)
// read it, so the two can never count the same row twice or not at all.
// ─────────────────────────────────────────────────────────────────────────────

/** A party NPC as the party store holds it — just enough to recognise its row on the board. */
export interface PartyNpcRef {
  id: string
  name: string
  memberType?: 'pc' | 'npc'
  creature?: { id?: string; name?: string } | null
}

/** pc: a player character. ally: a party NPC (or any allied row) with a stat block — one of the
 *  party. enemy: a stat-blocked row that is neither — its XP is the encounter. ignored: a name-only
 *  non-PC row, which has no level to rate. */
export type Side = 'pc' | 'ally' | 'enemy' | 'ignored'

const sameName = (a: string | undefined, b: string | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** Is this un-stamped board row the given party NPC? Its row name is the member's name AND its stat
 *  block is the member's (same id, or the same stat-block name — the bestiary corpus merge re-ids
 *  some blocks). A legacy→remaster rename between the party snapshot and the board row (the alias
 *  map in dataStore is async) is NOT followed: such a row stays an enemy until it is re-added. */
function looksLikePartyNpc(c: Combatant, n: PartyNpcRef): boolean {
  if (!c.creature || !n.creature) return false
  if (!sameName(c.name, n.name)) return false
  // An NPC named after its own stat block ("Goblin Warrior" from addNPC) can't be told apart from a
  // hostile copy of that creature added from the bestiary, a random encounter or a text import —
  // they carry the same name and block. Healing would turn the hostile row into the party member
  // while the real NPC sits on the party page, so such an NPC heals nothing.
  if (!!n.creature.name && sameName(n.name, n.creature.name)) return false
  const sameId = !!c.creature.id && !!n.creature.id && c.creature.id === n.creature.id
  return sameId || (!!c.creature.name && sameName(c.creature.name, n.creature.name))
}

/** A stamp is a string; a JSON `null` from a hand-written save is no stamp. */
const stamped = (c: Combatant) => c.partyMemberId != null

/**
 * Is this board row ALREADY the given party NPC's (so adding it again would double it)? A row the
 * party add stamped with its id; or, for rows from before the stamp existed, an unstamped non-PC row
 * of its name that was added as an ally (the party page's old route), has no stat block, or is the
 * old dialog route's unflagged row the heal recognises. A hostile copy of a creature the NPC is named
 * after is none of these, so it never blocks the real NPC from joining.
 */
export function isRowOfPartyNpc(c: Combatant, n: PartyNpcRef): boolean {
  if (c.isPC) return false
  if (stamped(c)) return c.partyMemberId === n.id
  if (!sameName(c.name, n.name)) return false
  return c.isAlly || c.creature == null || looksLikePartyNpc(c, n)
}

/**
 * Every row's side, in board order.
 *
 * A row the party add stamped (partyMemberId) or flagged (isAlly) is an ally. The rest is the HEAL,
 * read-only, for boards saved while the Add-combatants dialog added party NPCs without the flag: an
 * unflagged stat-blocked row whose name and stat block match a party NPC (`partyNpcs` — the active
 * party's) counts as that NPC. Each party NPC heals at most ONE row, and none at all when it is
 * already on the board as an ally, so a second copy stays an enemy; an NPC named after its own stat
 * block heals nothing (looksLikePartyNpc), because its hostile copies look exactly like it. The
 * healed flag is never written back: boards are mirrored per GM, and a load-time rewrite would race
 * the mirror's pull.
 */
export function sidesOf(combatants: readonly Combatant[], partyNpcs: readonly PartyNpcRef[] = []): Side[] {
  const npcs = partyNpcs.filter(n => n.memberType !== 'pc' && n.creature)
  const open = npcs.filter(n => !combatants.some(c =>
    !c.isPC && (stamped(c) ? c.partyMemberId === n.id : c.isAlly && sameName(c.name, n.name))))
  return combatants.map(c => {
    if (c.isPC) return 'pc'
    if (c.creature == null) return 'ignored'
    // Stamped by the party add: a party member's row, whatever else it says.
    if (c.isAlly || stamped(c)) return 'ally'
    const i = open.findIndex(n => looksLikePartyNpc(c, n))
    if (i >= 0) { open.splice(i, 1); return 'ally' }
    return 'enemy'
  })
}

/** One row's side on its own (sidesOf over just that row). */
export function classify(c: Combatant, partyNpcs: readonly PartyNpcRef[] = []): Side {
  return sidesOf([c], partyNpcs)[0]
}

export interface PartyMemberInFight {
  id: string
  name: string
  isPC: boolean
  /** The level the member counts at; null for an ally whose stat block carries no usable level
   *  (it still counts as one member, it just doesn't choose the party level). */
  level: number | null
  /** At 0 HP / marked defeated: still chooses the party level, no longer in the size. */
  defeated: boolean
}

export interface PartyInFight {
  /** members.length — every PC and stat-blocked ally IN THE ORDER, defeated or not. What decides
   *  whether there is a fight to rate at all: a party knocked flat is still in the fight, and its
   *  badge stays, as a defeated enemy's XP stays (computeEncounter). */
  inOrder: number
  /** Every PC and stat-blocked ally IN THE ORDER, defeated or not, in board order. */
  members: PartyMemberInFight[]
  /** The members still standing — one each (GM Core pg. 76, 21, 205). */
  size: number
  /** The party level: GM Core pg. 57 over EVERY member's level, the defeated included, so it — and
   *  every enemy's XP — holds still as members drop. */
  level: number
  /** Additional members for anyone STANDING 2+ levels above the party level (pg. 57). */
  extra: number
}

/** The party-store player a PC row stands for, as far as the rating needs one. Structural, so this
 *  file never imports the party store (which imports it). */
export interface PartyPcRef {
  id: string
  name: string
  memberType?: 'pc' | 'npc'
  charId?: string
  pcStats?: { level?: number } | null
}

const usableLevel = (l: unknown): l is number => typeof l === 'number' && Number.isFinite(l) && l >= 1

/**
 * A PC row's own level, for partyOf's `pcLevel`. The player behind the row is the member the party
 * add stamped it with (partyMemberId), else the campaign character (charId), else the same name —
 * the tracker's own PC join. Then:
 *  1. the host's sheet (`hostLevel`) under the PLAYER's current name, then under the row's name — a
 *     character renamed after it joined the order keeps its own level (the party mirror renames the
 *     player in place; the row keeps the old name);
 *  2. the player's own stat sheet (`pcStats.level`: a Wanderer's Guide import, or typed on the PC
 *     sheet) — what the standalone tracker has;
 *  3. undefined: partyOf's fallback (the campaign's level, or the typed party level).
 */
export function pcLevelOf(
  c: Combatant,
  players: readonly PartyPcRef[],
  hostLevel: (name: string) => number | null | undefined = () => undefined,
): number | undefined {
  const pcs = players.filter(p => p.memberType !== 'npc')
  const pl = (c.partyMemberId != null ? pcs.find(p => p.id === c.partyMemberId) : undefined)
    ?? (c.charId ? pcs.find(p => p.charId === c.charId) : undefined)
    ?? pcs.find(p => sameName(p.name, c.name))
  for (const l of [pl ? hostLevel(pl.name) : undefined, hostLevel(c.name), pl?.pcStats?.level]) {
    if (usableLevel(l)) return l
  }
  return undefined
}

/**
 * The party the encounter is rated against: the PCs and stat-blocked party NPCs in the initiative
 * order — never the roster sitting on the party page. Each counts as one member; the party level is
 * GM Core pg. 57's choice over their levels (partyLevelRule), and anyone 2+ levels above it adds a
 * member per 2 levels.
 *
 *  - A PC's level is `pcLevel(c)` (pcLevelOf: the host's sheet, else the player's own stat sheet)
 *    when it is a real level (finite, >= 1); otherwise `fallback` (the campaign's derived level, or
 *    the standalone tracker's typed party level).
 *  - An ally's level is its stat block's EFFECTIVE level (weak / elite / scaled, as the XP maths
 *    reads an enemy's) — or null when the stat block has no numeric level.
 *  - The LEVEL is taken over every member in the order, defeated included: XP is scored against it,
 *    and "the XP shown must stay fixed as creatures drop to 0 HP" (computeEncounter) — a PC going
 *    down must not re-price every enemy mid-fight. The SIZE (and the extras) count only those still
 *    standing, as the party size always did (the caller keeps at least one).
 *  - With nobody in the order (`inOrder` 0) the caller shows no rating at all.
 */
export function partyOf(
  combatants: readonly Combatant[],
  levels: {
    pcLevel?: (c: Combatant) => number | null | undefined
    fallback: number
    partyNpcs?: readonly PartyNpcRef[]
  },
): PartyInFight {
  const sides = sidesOf(combatants, levels.partyNpcs)
  const members: PartyMemberInFight[] = []
  combatants.forEach((c, i) => {
    const side = sides[i]
    if (side !== 'pc' && side !== 'ally') return
    let level: number | null
    if (side === 'pc') {
      const own = levels.pcLevel?.(c)
      level = usableLevel(own) ? own : levels.fallback
    } else {
      const eff = effectiveLevel(c.creature!, c)
      level = Number.isFinite(eff) ? eff : null
    }
    members.push({ id: c.id, name: c.name, isPC: side === 'pc', level, defeated: !!c.isDefeated })
  })
  const known = (ms: readonly PartyMemberInFight[]) => ms.flatMap(m => (m.level === null ? [] : [m.level]))
  const standing = members.filter(m => !m.defeated)
  const level = partyLevelRule(known(members))?.level ?? levels.fallback
  return {
    inOrder: members.length,
    members,
    size: standing.length,
    level,
    extra: extraMembers(known(standing), level),
  }
}

/** "3 PCs (5, 5, 4) + 1 NPC (6) → party level 5, +0 extra" — what the rating counted, for the "i"
 *  table; ", 1 down" when members are defeated (they still chose the level, not the size). */
export function describeParty(p: PartyInFight): string {
  const lv = (m: PartyMemberInFight) => (m.level === null ? '?' : String(m.level))
  const pcs = p.members.filter(m => m.isPC)
  const npcs = p.members.filter(m => !m.isPC)
  const down = p.members.filter(m => m.defeated).length
  const parts: string[] = []
  if (pcs.length) parts.push(`${pcs.length} PC${pcs.length === 1 ? '' : 's'} (${pcs.map(lv).join(', ')})`)
  if (npcs.length) parts.push(`${npcs.length} NPC${npcs.length === 1 ? '' : 's'} (${npcs.map(lv).join(', ')})`)
  return `${parts.join(' + ') || 'Nobody'}${down ? `, ${down} down` : ''} → party level ${p.level}, +${p.extra} extra`
}

export interface EncounterStats {
  /** Total adjusted XP value of all participating enemies + hazards. */
  xp: number
  difficulty: Difficulty
  /** How many enemy combatants contributed to the XP total (excludes PCs and
   *  allies; defeated enemies still count toward the fixed award). Hazards
   *  count individually. */
  enemyCount: number
  /** The per-party-size budget thresholds the XP was compared against —
   *  exposed so the InitiativeTracker can show "X / Y XP" toward the next
   *  difficulty tier. */
  budget: {
    trivial:  number
    low:      number
    moderate: number
    severe:   number
    extreme:  number
  }
  /** The XP awarded to each PC at this encounter level. Per GM Core:
   *  "XP awards for the encounter don't change — you'll always award the
   *  amount of XP listed for a group of four characters." So the per-PC
   *  award is the unscaled threshold for the achieved difficulty. */
  award: number
}

/** XP award for a single enemy or hazard, given its effective level and the
 *  party's average level. Both columns are exact lookups from GM Core:
 *    - Creatures + COMPLEX hazards → XP_BY_DIFF
 *    - SIMPLE hazards → SIMPLE_HAZARD_XP_BY_DIFF
 */
function enemyXp(effLevel: number, partyLevel: number, isSimpleHazard: boolean): number {
  const diff = Math.max(-4, Math.min(4, effLevel - partyLevel))
  return isSimpleHazard ? (SIMPLE_HAZARD_XP_BY_DIFF[diff] ?? 0) : (XP_BY_DIFF[diff] ?? 0)
}

/**
 * Calculate encounter XP and difficulty for the current initiative lineup.
 *
 * - Counts as an enemy: any combatant that is not a PC, not an ally, and has
 *   a creature stat block. Defeated enemies are still counted so the XP award
 *   stays fixed for the whole encounter.
 * - `partyLevel` — the party level (partyOf: GM Core pg. 57 over the members in the order).
 * - `partySize` — the number of party members, plus partyOf's pg. 57 extras (used to scale every difficulty threshold
 *   by its own per-PC adjustment; smaller parties have proportionally
 *   smaller budgets, larger parties proportionally bigger).
 */
export function computeEncounter(
  combatants: Combatant[],
  partyLevel: number,
  partySize: number,
  /** The active party's NPCs, for the read-only heal of rows saved without the ally flag
   *  (sidesOf). Optional so every existing caller and test keeps its meaning. */
  partyNpcs: readonly PartyNpcRef[] = [],
): EncounterStats {
  // An NPC contributes to the encounter XP only when it has a stat block
  // (`c.creature != null`). A name-only NPC has no level we can plug into
  // the XP table, so we drop it from the budget entirely — same way the
  // party-size calculation drops name-only allies. The NPC's effective
  // level (for the XP table) is read straight off the stat block,
  // optionally adjusted by weak/elite/scaled-to-level.
  //
  // Defeated enemies STILL count: the XP shown is the encounter's total
  // award, which the party earns for overcoming the whole encounter. It
  // must stay fixed as creatures drop to 0 HP so the GM can read the final
  // award after the fight (and so the badge doesn't vanish once everything
  // is defeated). To exclude a creature from the award, remove it from the
  // tracker rather than defeating it.
  //
  // Who is an enemy is the ONE side rule (sidesOf) the party is built from too.
  const sides = sidesOf(combatants, partyNpcs)
  const enemies = combatants.filter((_, i) => sides[i] === 'enemy')

  let xp = 0
  for (const c of enemies) {
    // The level the board fights it at (weak / elite / scaled — combatStore.adjustedCreature's rule).
    const lvl = effectiveLevel(c.creature!, c)
    // Hazards have `isHazard: true`; their `hazardData.complex` flag tells
    // us whether to apply the simple-hazard XP discount.
    const isHazard = !!c.creature!.isHazard
    const isSimpleHazard = isHazard && c.creature!.hazardData?.complex === false
    xp += enemyXp(lvl, partyLevel, isSimpleHazard)
  }

  // Each difficulty tier scales by its own per-PC adjustment value.
  const { trivial: trivialT, low: lowT, moderate: moderateT, severe: severeT, extreme: extremeT } = budgetFor(partySize)

  let difficulty: Difficulty = 'Trivial'
  let award = BUDGET.trivial.base
  if (xp >= extremeT)        { difficulty = 'Extreme';  award = BUDGET.extreme.base }
  else if (xp >= severeT)    { difficulty = 'Severe';   award = BUDGET.severe.base }
  else if (xp >= moderateT)  { difficulty = 'Moderate'; award = BUDGET.moderate.base }
  else if (xp >= lowT)       { difficulty = 'Low';      award = BUDGET.low.base }

  return {
    xp,
    difficulty,
    enemyCount: enemies.length,
    budget: { trivial: trivialT, low: lowT, moderate: moderateT, severe: severeT, extreme: extremeT },
    award,
  }
}

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Trivial:  '#6a7a6a',
  Low:      '#4a9a55',
  Moderate: '#a89020',
  Severe:   '#c07020',
  Extreme:  '#a03030',
}
