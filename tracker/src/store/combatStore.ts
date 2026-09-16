import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { original } from 'immer'
import type { Combatant, AppliedCondition, Creature, DiceResult, SavedEncounter } from '../types/pf2e'
import { applyWeakElite, scaleByLevel } from '../utils/weakElite'
import { CONDITION_META } from '../utils/conditionEffects'
import { roundTurnAbilityKeys } from '../utils/limitedUses'
import { rollDamageExpr } from '../utils/dice'
import { useSettingsStore } from './settingsStore'
import { usePartyStore } from './partyStore'
import { useDmAverageStore } from './dmAverageStore'
import { notifyPersist } from './persistBus'
import type { TurnRecord, TurnTimerState } from '../utils/turnTimer'

let _cid = 0, _condId = 0, _tid = 0
const nid = () => `cmb-${++_cid}`
const ncid = () => `cond-${++_condId}`
const ntid = () => `turn-${++_tid}`

// ── Turn-timer helpers (operate on the immer draft) ───────────────────────
const turnTimerOn = () => useSettingsStore.getState().turnTimerEnabled

interface TimerDraft { turnTimer: TurnTimerState | null; turns: TurnRecord[] }

/** Start timing the given combatant's turn (replaces any running timer). */
function beginTurn(s: TimerDraft, c: Combatant | undefined | null) {
  if (!c) { s.turnTimer = null; return }
  s.turnTimer = {
    combatantId: c.id, name: c.name, isPC: c.isPC,
    startedAt: Date.now(), accumMs: 0, paused: false,
  }
}

/** Bank the running timer's elapsed time as a completed TurnRecord. */
function commitTurn(s: TimerDraft) {
  const t = s.turnTimer
  if (!t) return
  const ms = t.accumMs + (t.startedAt != null && !t.paused ? Date.now() - t.startedAt : 0)
  const seconds = Math.round(ms / 1000)
  if (seconds > 0) {
    s.turns.push({ id: ntid(), combatantId: t.combatantId, name: t.name, isPC: t.isPC, seconds })
  }
}

/** On reload, drop any wall-clock gap from the app being closed: a running
 *  timer resumes counting from its banked accumMs rather than back-counting
 *  the closed period. */
function rehydrateTimer(t: TurnTimerState | null | undefined): TurnTimerState | null {
  if (!t) return null
  return { ...t, startedAt: t.paused ? null : Date.now() }
}

/** The value of a named condition on a combatant, 0 when it isn't applied. */
function condValue(c: Combatant, name: string): number {
  return c.conditions.find(x => x.name.toLowerCase() === name)?.value ?? 0
}

/**
 * Restored to 1+ Hit Points: lose Dying AND Unconscious, and become Wounded 1 (or +1 to an existing
 * Wounded). Player Core, Unconscious: *"If you are restored to 1 Hit Point or more, you lose the
 * dying and unconscious conditions and can act normally on your next turn."* The Wounded bump is
 * the recovery half, mirroring `recoverFromDying` in the player sheet's src/rules/play.ts. Capped at
 * the tracker's own Wounded slider maximum (3).
 */
function reviveConditions(c: Combatant) {
  const wasDying = c.conditions.some(x => x.name.toLowerCase() === 'dying')
  c.conditions = c.conditions.filter(x => {
    const n = x.name.toLowerCase()
    return n !== 'unconscious' && n !== 'dying'
  })
  if (!wasDying) return
  const w = c.conditions.find(x => x.name.toLowerCase() === 'wounded')
  if (w) w.value = Math.min(3, (w.value ?? 1) + 1)
  else c.conditions.push({ id: ncid(), name: 'wounded', value: 1, isPermanent: true })
}

// Shared PC-defeat logic: sets HP to 0, applies Unconscious + Dying, reorders initiative
function applyPCDefeat(s: { combatants: Combatant[]; activeIndex: number }, id: string) {
  const c = s.combatants.find(c => c.id === id)
  if (!c || !c.isPC) return
  c.isDefeated = true
  c.currentHP = 0
  if (!c.conditions.some(x => x.name.toLowerCase() === 'unconscious')) {
    c.conditions.push({ id: ncid(), name: 'unconscious', isPermanent: true })
  }
  // Dropped to 0 HP → Dying as well as Unconscious. The value gained is 1 + your Wounded value, or
  // +1 if you were already Dying, never past the death threshold (4, reduced by Doomed, min 1).
  // Mirrors applyDamage in the player sheet's src/rules/play.ts.
  const deathAt = Math.max(1, 4 - condValue(c, 'doomed'))
  const dying = c.conditions.find(x => x.name.toLowerCase() === 'dying')
  if (dying) dying.value = Math.min(deathAt, (dying.value ?? 0) + 1)
  else c.conditions.push({ id: ncid(), name: 'dying', value: Math.min(deathAt, 1 + condValue(c, 'wounded')), isPermanent: true })
  const pcIdx = s.combatants.findIndex(x => x.id === id)
  const activeIdx = s.activeIndex
  if (pcIdx !== -1 && pcIdx !== activeIdx && s.combatants.length > 1) {
    const [removed] = s.combatants.splice(pcIdx, 1)
    const adjustedActive = pcIdx < activeIdx ? activeIdx - 1 : activeIdx
    s.combatants.splice(adjustedActive, 0, removed)
    s.activeIndex = adjustedActive + 1
  }
}

// Conditions consumed at the START of a creature's turn (Stunned — it eats your
// actions as soon as your turn begins). Frightened-style conditions that fade at
// the END of the turn are handled inline in nextTurn instead. Called when a
// creature's turn begins (nextTurn lands on it, or combat starts on it).
function tickConditionsAtStart(c: Combatant | undefined | null) {
  if (!c) return
  c.conditions = c.conditions
    .map(cc => {
      const m = CONDITION_META[cc.name.toLowerCase()]
      // `isPermanent` ("until removed") pins the value: an auto-decrementing condition set this way
      // stays at its current value until someone clears it by hand.
      if (m?.autoDecrement && m.tickAtStart && !cc.isPermanent && cc.value !== undefined && cc.value > 0) {
        return { ...cc, value: Math.max(0, cc.value - (m.decrementBy ?? 1)) }
      }
      return cc
    })
    .filter(cc => {
      const m = CONDITION_META[cc.name.toLowerCase()]
      return !(m?.autoDecrement && m.tickAtStart && !cc.isPermanent && (cc.value ?? 1) <= 0)
    })
}

/**
 * Whether a timed condition's clock still has an owner on the board.
 *
 * Player Core p. 426 (Duration): *"For an effect that lasts a number of rounds, the remaining
 * duration decreases by 1 at the start of each turn of the creature that created the effect."* A
 * source that has LEFT the board (Clear Defeated, Remove) has no turns left to give, so its effects
 * would otherwise freeze on their targets for the rest of the session. Treat those as source-less
 * and fall back to the print's other family, *"until the end of the target's next turn"*.
 */
function hasSource(s: { combatants: Combatant[] }, c: AppliedCondition): boolean {
  return !!c.source && s.combatants.some(x => x.id === c.source)
}

/**
 * Tick every ROUND-DURATION condition on the board whose `source` is one of the creatures whose
 * initiative count has just come up, and drop the ones that reach 0.
 *
 * Player Core p. 426 (Duration): *"For an effect that lasts a number of rounds, the remaining
 * duration decreases by 1 at the start of each turn of the creature that created the effect."* So
 * the clock belongs to the SOURCE, not to the creature wearing the condition — one 2-round effect
 * on five targets expires for all five at the same moment, and a condition on a creature that never
 * gets a turn (downed, delayed, skipped) still runs out.
 *
 * `sourceIds` carries every combatant the turn advance passed over as well as the one it landed on:
 * a defeated or delayed source still has an initiative count, so its effects keep ticking.
 *
 * Conditions with NO source keep the old clock — they tick at the END of the affected creature's
 * turn, which is the print's other family (*"until the end of the target's next turn"*).
 */
function tickSourceDurations(s: { combatants: Combatant[] }, sourceIds: Set<string>) {
  if (!sourceIds.size) return
  for (const c of s.combatants) {
    let ticked = false
    for (const cc of c.conditions) {
      // `sourceIds` is drawn from the board, so this membership test IS hasSource() here: a source
      // that has left can never match, and nextTurn's turn-end pass picks those up instead.
      if (cc.isPermanent || cc.duration === undefined || !cc.source || !sourceIds.has(cc.source)) continue
      cc.duration -= 1
      ticked = true
    }
    if (ticked) c.conditions = c.conditions.filter(cc => cc.isPermanent || cc.duration === undefined || cc.duration > 0)
  }
}

/** Skipped by the turn advance: a defeated NPC (downed PCs still act) or anyone who Delayed. */
function skipsTurn(c: Combatant | undefined): boolean {
  return !!c && (c.isDelayed || (c.isDefeated && !c.isPC))
}

// Turn-advance bookkeeping. Declared here rather than in types/pf2e.ts because the turn engine in
// this file is the only thing that reads or writes these — they are not board state the UI or a
// saved encounter has any use for.
declare module '../types/pf2e' {
  interface Combatant {
    /** Its initiative count has already been credited in the CURRENT round (see creditCount).
     *  Cleared when the order wraps to a new round and when a fight starts. */
    countedThisRound?: boolean
    /** Its END-of-turn NEGATIVES have already run in the CURRENT round — persistent damage, the
     *  auto-decrement step and the source-less duration tick (endTurnPass). The per-round resource
     *  refill in the same function is deliberately outside this flag: it isn't a negative.
     *  Delay runs that pass as it hands the turn on, which is the print, Player Core p. 416, Delay
     *  (public/data/actions.json, the entry this repo ships): *"When you Delay, any persistent
     *  damage or other negative effects that normally occur at the start or end of your turn occur
     *  immediately when you use the Delay action."* Coming back on the end of another creature's
     *  turn in the SAME round resumes the rest of that one turn, so its end must not fire them
     *  again. Cleared alongside countedThisRound — a new round, a new turn. */
    endedThisRound?: boolean
    /** The round this creature Delayed in. Delay lasts at most until its own initiative position
     *  comes up again (Player Core p. 416) — nextTurn's skip loop reads this to end it. */
    delayedOnRound?: number
  }
}

/**
 * Credit a creature's initiative count for `tickSourceDurations` — at most ONCE per round.
 *
 * Player Core p. 426 puts the tick at the start of each of the source's turns, and a creature gets
 * one turn per round. Delay hands the same count a SECOND landing in the round it returns: Delay is
 * an action taken on your turn, so the advance already landed on you (and credited you) before you
 * delayed, and `returnFromDelay` puts you back in front of the pointer so the next advance lands on
 * you again. Crediting that second landing ticks a 3-round effect down to 1 in one round.
 */
function creditCount(c: Combatant | undefined, counts: Set<string>) {
  if (!c || c.countedThisRound) return
  counts.add(c.id)
  c.countedThisRound = true
}

interface CombatStore {
  combatants: Combatant[]
  round: number; activeIndex: number; selectedId: string | null; inCombat: boolean
  diceResults: DiceResult[]
  /** Whether the combat-edit undo / redo stacks have anything to apply. */
  canUndo: boolean; canRedo: boolean
  addCombatant: (creature: Creature | null, opts?: { name?: string; isPC?: boolean; isAlly?: boolean; initiative?: number|null; count?: number; maxHP?: number }) => void
  /** Add another copy of an existing combatant (same stat block + weak/elite/
   *  scaled state), inserted right after it with fresh HP and no conditions.
   *  No-op for PCs (a player character can't appear twice). */
  duplicateCombatant: (id: string) => void
  removeCombatant: (id: string) => void
  /** Drop every DEFEATED non-PC from the board (PCs stay, downed or not) so the next fight starts
   *  clean and the removed monsters stop counting toward its XP budget. The active pointer follows
   *  its combatant by id, or falls to the next survivor. Recorded as one undo step. */
  removeDefeated: () => void
  /** Delay: the combatant leaves the turn order (skipped like a defeated NPC) until it is brought
   *  back with `returnFromDelay`. Delaying the ACTIVE combatant ends its turn. */
  delayCombatant: (id: string) => void
  /** Re-enter the order immediately after the combatant whose turn it is, taking that creature's
   *  initiative count (PF2e: you return "after any turn"). */
  returnFromDelay: (id: string) => void
  /** Point the persisted board at a campaign: `pf2e-current-combat:<scopeId>` (bare key when null).
   *  Flushes the OUTGOING scope's pending write first, then loads the incoming scope's snapshot (or
   *  an empty board), resets undo/redo and the turn timer, and resumes the id counters. The GM
   *  layout store and the GM widgets ride the same switch — see scopeKey / onScopeChange. */
  setScope: (scopeId: string | null) => void
  /** Re-read the CURRENT scope's snapshot out of localStorage and adopt it, as a scope switch does.
   *  For the GM-device mirror: another of this GM's devices wrote a newer board, the mirror put it in
   *  localStorage, and the open board has to catch up. Same cost as a scope load — undo/redo is reset
   *  (the incoming board is not a state this device edited its way into). */
  reloadFromStorage: () => void
  /** Wipe every combatant from the initiative tracker and reset combat
   *  state. The caller is expected to confirm before invoking. */
  clearAllCombatants: () => void
  setInitiative: (id: string, v: number|null) => void
  sortByInitiative: () => void
  rollMonsterInitiative: () => void
  startCombat: () => void; endCombat: () => void
  nextTurn: () => void; prevTurn: () => void
  selectCombatant: (id: string|null) => void
  applyDamage: (id: string, amt: number) => void
  applyHealing: (id: string, amt: number) => void
  setTempHP: (id: string, amt: number) => void
  setDefeated: (id: string, val: boolean) => void
  setMaxHP: (id: string, val: number) => void
  /** Sync a PC combatant's max HP from its party sheet (matched by name).
   *  No-op if that PC isn't currently in the tracker. */
  setPcMaxHP: (name: string, maxHP: number) => void
  addCondition: (id: string, cond: Omit<AppliedCondition,'id'>) => void
  removeCondition: (id: string, condId: string) => void
  updateConditionValue: (id: string, condId: string, v: number) => void
  updateConditionDuration: (id: string, condId: string, d: number|undefined) => void
  setEliteWeak: (id: string, mode: 'normal'|'weak'|'elite') => void
  setScaledLevel: (id: string, level: number | undefined) => void
  /** Set the consumed count for a single limited-use resource key. Clamped
   *  to ≥ 0 by the caller; 0 removes the key to keep saves lean. */
  setResourceUse: (id: string, key: string, used: number) => void
  /** Reset limited-use resources for a combatant. With `keys`, only those are
   *  cleared; without, the whole map is wiped (a full rest). */
  resetResources: (id: string, keys?: string[]) => void
  renameCombatant: (id: string, name: string) => void
  setNotes: (id: string, notes: string) => void
  setCombatantImage: (id: string, image: string) => void
  addDiceResult: (r: DiceResult) => void
  clearDiceResults: () => void
  /** Revert / re-apply the last combat edit (damage, conditions, defeat, etc.).
   *  Turn navigation is not part of this history. */
  undo: () => void
  redo: () => void
  saveEncounter: (name: string) => void
  loadEncounter: (name: string, creatures: Map<string, Creature>) => void
  getSavedEncounterNames: () => string[]
  deleteSavedEncounter: (name: string) => void
  resetCombat: () => void
  /** Signature of the board captured at the last save/load; null until one
   *  happens. Lets the UI tell whether anything has changed since. */
  savedSignature: string | null
  /** True when the current board exactly matches the last saved/loaded state,
   *  so clearing it loses nothing (it can be reloaded). */
  isEncounterUnchanged: () => boolean
  // ── Turn timer ──
  /** Completed turns recorded this session (cleared by Save to Averages). */
  turns: TurnRecord[]
  /** The turn currently being timed, or null when idle. */
  turnTimer: TurnTimerState | null
  pauseTurnTimer: () => void
  resumeTurnTimer: () => void
  /** Discard the current running turn's elapsed time and restart it at 0. */
  discardCurrentTurn: () => void
  /** Remove one completed turn from the session list. */
  removeTurn: (id: string) => void
  /** Fold the session's turns into player + DM cumulative averages, then
   *  clear the session list. */
  saveTurnsToAverages: () => void
}

// ── Current-combat persistence ─────────────────────────────────────────────
// We snapshot the live initiative tracker to localStorage so reopening the app
// brings back the exact same lineup (combatants, conditions, HP, round, etc.).
const COMBAT_STATE_KEY = 'pf2e-current-combat'

// ── Scope (campaign) ───────────────────────────────────────────────────────
// Combat, the GM layout and the GM widgets are per-CAMPAIGN, not global: opening campaign B must
// not show campaign A's fight. One `setScope(id)` call from the Heroes Heaven campaign seam moves
// all three onto `<key>:<id>`; a null scope keeps the bare keys, which is the standalone tracker's
// behaviour and every pre-scoping save. Lives here (not in its own module) because `setScope` is
// the combat store's action — layoutStore and GmWidgets import these two helpers from it.
let _scopeId: string | null = null
const _scopeListeners = new Set<() => void>()
/** The scoped form of a localStorage key: `base` while unscoped, `base:<scopeId>` inside a campaign. */
export function scopeKey(base: string): string {
  return _scopeId === null ? base : `${base}:${_scopeId}`
}
/** Subscribe to scope switches. Returns the unsubscribe, so it doubles as a
 *  `useSyncExternalStore` subscriber. */
export function onScopeChange(fn: () => void): () => void {
  _scopeListeners.add(fn)
  return () => { _scopeListeners.delete(fn) }
}
/** A component-level scoped key that re-renders when the scope switches. */
export function useScopeKey(base: string): string {
  return useSyncExternalStore(onScopeChange, () => scopeKey(base), () => base)
}

function readJson<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r != null ? (JSON.parse(r) as T) : fallback } catch { return fallback }
}
/** Component state persisted under a CAMPAIGN-SCOPED localStorage key. Pass the bare key
 *  (`gmw:<ref>`); it becomes `gmw:<ref>:<scopeId>` inside a campaign and re-reads when setScope
 *  switches. The GM-screen widgets self-persist outside the layout tree, so this is how they get
 *  scoped; it lives here rather than in its own module so there is one copy, not three. */
export function useScopedState<T>(baseKey: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const key = useScopeKey(baseKey)
  const [v, setV] = useState<T>(() => readJson(key, initial))
  const lastKey = useRef(key)
  useEffect(() => {
    // A key change means the campaign switched: adopt the incoming campaign's value instead of
    // writing the outgoing one over it.
    if (lastKey.current !== key) { lastKey.current = key; setV(readJson(key, initial)); return }
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota / private mode */ }
    // `initial` is a fresh literal on nearly every caller's render — deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v])
  return [v, setV]
}

interface PersistedCombat {
  combatants: Combatant[]
  round: number
  activeIndex: number
  inCombat: boolean
  selectedId: string | null
  cidCounter: number
  condCounter: number
  turns?: TurnRecord[]
  turnTimer?: TurnTimerState | null
  savedSignature?: string | null
}

// A deterministic fingerprint of the meaningful board state — the lineup plus
// each combatant's live combat state (HP, conditions, defeated, elite/weak,
// notes, resource uses). Initiative and the round/turn pointer are deliberately
// excluded: rolling initiative or starting combat isn't "changing the
// encounter". Captured at save/load so we can tell if anything changed since.
function combatSignature(combatants: Combatant[]): string {
  return combatants.map(c => [
    c.name, c.creature?.id ?? c.creature?.name ?? '',
    c.isPC ? 1 : 0, c.isAlly ? 1 : 0,
    c.currentHP, c.maxHP, c.tempHP,
    c.isElite ? 1 : 0, c.isWeak ? 1 : 0, c.scaledToLevel ?? '', c.isDefeated ? 1 : 0,
    c.notes ?? '',
    c.conditions.map(x => `${x.name}#${x.value ?? ''}#${x.duration ?? ''}#${x.isPermanent ? 1 : 0}#${x.pdAmount ?? ''}#${x.pdType ?? ''}`).join(','),
    JSON.stringify(c.resourceUses ?? {}),
  ].join('§')).join('~~')
}

function loadPersistedCombat(): PersistedCombat | null {
  try {
    const raw = localStorage.getItem(scopeKey(COMBAT_STATE_KEY))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedCombat
    if (!Array.isArray(parsed.combatants)) return null
    // Every board saved before the once-per-round credit existed carries no flag at all, and
    // `undefined` reads as "not counted yet" — so loading one mid-fight hands everyone the order has
    // already passed a SECOND count this round (Delay, return, advance, and their effects tick
    // twice). Derive it from the pointer instead: in a running fight, everyone from the top of the
    // order through the active creature has had their count this round.
    parsed.combatants.forEach((c, i) => {
      c.countedThisRound ??= parsed.inCombat && i <= parsed.activeIndex
      // The end-of-turn pass is the same story one seat earlier: everyone the pointer has already
      // passed has had their turn END this round — but the ACTIVE creature's has not (it is mid-turn
      // when the board is saved), so this one is strictly `<`. Reading `undefined` as "not ended"
      // would hand every creature behind the pointer a second pass on the first Delay + return.
      // KNOWN COST, and only on a board saved before this flag shipped: a creature that Delayed OUT
      // of turn (the row's Delay button is offered whoever's turn it is) and was then stepped over
      // sits behind the pointer WITHOUT having had its pass, and nothing in a flagless save tells it
      // apart from the in-turn delayer, which has. It reads as already ended, so a same-round Return
      // loses that one round's negatives for it. One round, once, on the last pre-flag save — the
      // same trade countedThisRound takes above. `&& !c.isDelayed` is NOT the patch: it clears the
      // flag for the in-turn delayer too and re-opens the double-fire the tests below pin down.
      c.endedThisRound ??= parsed.inCombat && i < parsed.activeIndex
      // Same for a creature that was already Delayed when the board was saved: the round it went out
      // in wasn't recorded, and without a value its Delay never ends (p. 416, nextTurn's skip loop).
      // The saved round is the latest it can have delayed in, so it comes back a round late at worst.
      if (c.isDelayed) c.delayedOnRound ??= parsed.round
    })
    return parsed
  } catch {
    return null
  }
}

const _persisted = loadPersistedCombat()
if (_persisted) {
  // Resume id counters so newly-added combatants never clash with restored ones.
  _cid = _persisted.cidCounter ?? 0
  _condId = _persisted.condCounter ?? 0
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null
let _pendingSnap: (() => PersistedCombat) | null = null
/** Write the pending board snapshot NOW. Exported because anything that reads this key from the
 *  outside (the GM-device mirror in src/data/trackerSync.ts) must not see "everything except the last
 *  200 ms" — an edit sitting in the debounce is a real edit. */
export function flushPersist() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
  if (!_pendingSnap) return
  // scopeKey() is read HERE, at write time: setScope flushes before it swaps the scope, so the
  // outgoing campaign's board always lands under its own key (never lose a snapshot).
  const key = scopeKey(COMBAT_STATE_KEY)
  try { localStorage.setItem(key, JSON.stringify(_pendingSnap())) } catch { /* quota */ }
  _pendingSnap = null
  notifyPersist(key)
}
function schedulePersist(snap: () => PersistedCombat) {
  _pendingSnap = snap
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(flushPersist, 200)
}
// Write any pending change immediately if the window is closing — otherwise a
// close within the 200ms debounce loses the last combat mutation.
if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPersist)

// ── Undo / redo for combat edits ────────────────────────────────────────────
// Snapshots live at module scope (kept OUT of the persisted state) and share
// structure with immer's frozen state, so each one is cheap. Turn navigation is
// deliberately excluded — only state edits (damage, conditions, defeat, …) are
// recorded, matching the "undo a mis-typed number" use case.
interface CombatSnapshot { combatants: Combatant[]; round: number; activeIndex: number }
const _undoStack: CombatSnapshot[] = []
const _redoStack: CombatSnapshot[] = []
const HISTORY_MAX = 40
/** Capture the PRE-mutation state. Call at the top of a mutating recipe (after
 *  any early-return guard so no-ops don't pollute the stack). */
function record(s: CombatStore) {
  const o = original(s) as CombatStore | undefined
  if (!o) return
  _undoStack.push({ combatants: o.combatants, round: o.round, activeIndex: o.activeIndex })
  if (_undoStack.length > HISTORY_MAX) _undoStack.shift()
  _redoStack.length = 0
  s.canUndo = true
  s.canRedo = false
}
/** Drop the redo stack WITHOUT recording an undo step — for mutations that change the combatants but
 *  aren't themselves on the undo timeline (add / duplicate / set-initiative / roll-initiative). Without
 *  this, doing one of them after an Undo leaves Redo lit, and pressing Redo replays a STALE snapshot
 *  that wholesale-replaces the just-made change. */
function invalidateRedo(s: CombatStore) {
  _redoStack.length = 0
  s.canRedo = false
}
/** Push a PC's current HP back to its party-card sheet (matched by name). */
function syncPcHp(c: Combatant | undefined) {
  if (c?.isPC) usePartyStore.getState().syncCurrentHpByName(c.name, c.currentHP)
}

let _ridSeq = 0
/** A lightweight reminder card pushed into the same top-right stack as dice
 *  rolls — DiceOverlay renders kind==='reminder' as a warning (no big number). */
function makeReminder(label: string, note: string): DiceResult {
  return {
    id: `pd-${++_ridSeq}-${Math.floor(performance.now())}`,
    label, note, kind: 'reminder',
    rolls: [], total: 0, modifier: 0, isCrit: false, isFumble: false, isAttack: false,
    timestamp: Date.now(),
  }
}
function pushDice(s: CombatStore, r: DiceResult) {
  s.diceResults.unshift(r)
  if (s.diceResults.length > 8) s.diceResults.length = 8
}
/** Resolve every persistent-damage condition on the creature whose turn is
 *  ending: auto-roll & apply it (if enabled) or pop a reminder, per settings. */
function firePersistentDamage(s: CombatStore, cur: Combatant) {
  const pd = cur.conditions.filter(c => c.name.toLowerCase() === 'persistent damage' && c.pdAmount)
  if (!pd.length) return
  const st = useSettingsStore.getState()
  if (!st.persistentDamageAutoRoll && !st.persistentDamageWarn) return
  for (const c of pd) {
    const type = (c.pdType ?? '').trim()
    if (st.persistentDamageAutoRoll) {
      const res = rollDamageExpr(c.pdAmount!, `${cur.name} — persistent ${type || 'damage'}`)
      let rem = res.total
      if (cur.tempHP > 0) { const abs = Math.min(cur.tempHP, rem); cur.tempHP -= abs; rem -= abs }
      cur.currentHP = Math.max(0, cur.currentHP - rem)
      // Match applyDamage: a PC dropped to 0 by persistent damage goes
      // Unconscious; a monster is defeated. (endTurnPass also runs for seats the
      // pointer steps over, but those are skipsTurn seats = defeated NPCs, and
      // applyPCDefeat returns early for a non-PC, so no array reorder happens here.
      // A future caller passing a non-active PC would splice mid-iteration.)
      if (cur.currentHP === 0) {
        if (cur.isPC) applyPCDefeat(s, cur.id)
        else cur.isDefeated = true
      }
      pushDice(s, res)
    } else {
      const amt = `${c.pdAmount}${type ? ' ' + type : ''}`
      pushDice(s, makeReminder(`⚠ Persistent damage — ${cur.name}`, `Roll ${amt} and apply it, then a DC 15 flat check to end it.`))
    }
  }
}

/**
 * One creature's turn ENDING: the p. 416 negatives (once per round) and then the per-round refill
 * (every turn end — see the second half).
 *
 * Runs for the creature the pointer is leaving (nextTurn) AND for every defeated NPC the advance
 * steps over. A downed monster's initiative count still comes up — the tracker already credits it so
 * the effects IT created keep running down (creditCount) — so its OWN end-of-turn work runs too:
 * persistent damage, the Frightened step, its source-less durations. They used to freeze the moment
 * it dropped and stayed frozen for the rest of the fight, which a GM only sees on the round they
 * heal it back onto its feet still carrying round-one's burning.
 */
function endTurnPass(s: CombatStore, c: Combatant) {
  // ONE pass per creature per round. A creature that Delayed on its own turn has already had it:
  // delayCombatant hands the turn on through nextTurn, which is what p. 416 asks for (*"…occur
  // immediately when you use the Delay action"*). Returning on the end of another creature's turn in
  // the same round gives it the REST of that one turn — so when that turn ends, the negatives are
  // already spent. Ungated, a legal in-turn Delay + same-round Return rolled persistent damage
  // twice, stepped Frightened 4 → 2, and ran a source-less 3-round condition down to 1 in one round.
  if (!c.endedThisRound) {
    c.endedThisRound = true
    // Persistent damage resolves at the END of the creature's turn — roll &
    // apply it (if auto-roll is on) or pop a reminder, BEFORE the duration
    // tick below can expire the condition.
    firePersistentDamage(s, c)
    c.conditions = c.conditions
      .map(cd => {
        const meta = CONDITION_META[cd.name.toLowerCase()]
        // END-of-turn auto-decrement (e.g. Frightened −1). Conditions consumed
        // at the START of a turn (Stunned) are handled elsewhere, when the next
        // creature's turn begins, so they're skipped here.
        // `isPermanent` ("until removed") pins the value — see tickConditionsAtStart.
        if (meta?.autoDecrement && !meta.tickAtStart && !cd.isPermanent && cd.value !== undefined && cd.value > 0) {
          return { ...cd, value: Math.max(0, cd.value - (meta.decrementBy ?? 1)) }
        }
        // Timed conditions with NO source ON THE BOARD tick at the end of the affected
        // creature's turn — the "until the end of the target's next turn" family. A condition
        // whose creator is still here ticks on THAT creature's turn instead
        // (tickSourceDurations), one whose creator has left falls back to this clock
        // rather than freezing (hasSource).
        if (!cd.isPermanent && cd.duration !== undefined && !hasSource(s, cd)) {
          return { ...cd, duration: cd.duration - 1 }
        }
        return cd
      })
      .filter(cd => {
        const meta = CONDITION_META[cd.name.toLowerCase()]
        if (meta?.autoDecrement && !meta.tickAtStart && !cd.isPermanent && (cd.value ?? 1) <= 0) return false
        if (!cd.isPermanent && !hasSource(s, cd) && cd.duration !== undefined && cd.duration <= 0) return false
        return true
      })
  }
  // OUTSIDE the guard on purpose. Refilling per-round / per-turn limited uses is not one of p. 416's
  // "negative effects" — it is what makes the ability available again on the creature's next turn,
  // and deleting an already-deleted key costs nothing. Behind the guard, a use spent during the
  // RESUMED half of a Delayed turn (the flag is already up by then) was never cleared, so a
  // once-per-round ability stayed locked through the creature's whole next turn.
  if (c.resourceUses) {
    for (const k of roundTurnAbilityKeys(c.creature)) {
      if (c.resourceUses[k]) delete c.resourceUses[k]
    }
  }
}

export const useCombatStore = create<CombatStore>()(immer((set, get) => ({
  combatants: _persisted?.combatants ?? [],
  round:       _persisted?.round       ?? 1,
  activeIndex: _persisted?.activeIndex ?? 0,
  selectedId:  _persisted?.selectedId  ?? null,
  inCombat:    _persisted?.inCombat    ?? false,
  diceResults: [],
  canUndo: false, canRedo: false,
  turns:       _persisted?.turns       ?? [],
  turnTimer:   rehydrateTimer(_persisted?.turnTimer),
  savedSignature: _persisted?.savedSignature ?? null,

  addCombatant(creature, opts = {}) {
    set(s => {
      invalidateRedo(s)
      const count = opts.count ?? 1
      for (let i = 0; i < count; i++) {
        const suffix = count > 1 ? ` ${String.fromCharCode(65+i)}` : ''
        const name = (opts.name ?? creature?.name ?? 'PC') + suffix
        // A player character can't appear twice — skip if one with this name
        // is already in the tracker.
        if (opts.isPC && s.combatants.some(c => c.isPC && c.name.toLowerCase() === name.toLowerCase())) continue
        const hp = opts.maxHP ?? creature?.defenses.hp ?? 0
        s.combatants.push({
          id: nid(), name, creature: creature ?? null,
          isPC: opts.isPC ?? false, isAlly: opts.isAlly ?? false,
          initiative: opts.initiative ?? null,
          currentHP: hp, maxHP: hp, tempHP: 0,
          conditions: [], isElite: false, isWeak: false, notes: '', isDefeated: false,
          // Written explicitly (as duplicateCombatant does) so a reinforcement that joins mid-fight
          // ROUND-TRIPS: a missing key is dropped by JSON, and loadPersistedCombat's `??=` would
          // then invent the flag from the newcomer's position — a live board and a reload of that
          // same board disagreeing about whose count is still on the table. The positional
          // heuristic is for genuinely pre-commit saves only.
          countedThisRound: false, endedThisRound: false,
        })
      }
    })
  },

  duplicateCombatant(id) {
    set(s => {
      const idx = s.combatants.findIndex(c => c.id === id)
      if (idx < 0) return
      const src = s.combatants[idx]
      if (src.isPC) return   // PCs can't appear twice
      invalidateRedo(s)
      // Make a distinct name: append " (n)" with the lowest free n.
      let name = src.name
      if (s.combatants.some(c => c.name === name)) {
        let n = 2
        while (s.combatants.some(c => c.name === `${src.name} (${n})`)) n++
        name = `${src.name} (${n})`
      }
      const copy = {
        ...src,
        id: nid(),
        name,
        currentHP: src.maxHP,
        tempHP: 0,
        conditions: [],
        resourceUses: undefined,
        isDefeated: false,
        isDelayed: false,
        countedThisRound: false, endedThisRound: false,
      }
      s.combatants.splice(idx + 1, 0, copy)
      // Keep the active-turn pointer on the same combatant.
      if (s.activeIndex >= idx + 1) s.activeIndex += 1
    })
  },

  clearAllCombatants() {
    set(s => {
      record(s)
      s.combatants = []
      s.selectedId = null
      s.activeIndex = 0
      s.inCombat = false
      s.round = 1
      s.savedSignature = null
    })
  },

  removeCombatant(id) {
    set(s => {
      const idx = s.combatants.findIndex(c => c.id === id)
      if (idx < 0) return
      record(s)
      s.combatants.splice(idx, 1)
      if (s.selectedId === id) s.selectedId = null
      // Removing a combatant BEFORE the active one shifts every later entry down by one, so the
      // active pointer has to follow or the turn silently jumps to the next creature (skipping whose
      // turn it actually is). Decrement first, then clamp to the new length.
      if (idx < s.activeIndex) s.activeIndex -= 1
      if (s.activeIndex >= s.combatants.length) s.activeIndex = Math.max(0, s.combatants.length-1)
    })
  },

  removeDefeated() {
    set(s => {
      const doomed = new Set(s.combatants.filter(c => c.isDefeated && !c.isPC).map(c => c.id))
      if (!doomed.size) return
      record(s)
      const activeId = s.combatants[s.activeIndex]?.id
      // Where the active pointer lands if its own combatant is one of the ones going: the survivor
      // that now occupies the same place in the order (count survivors ahead of it BEFORE the cut).
      const survivorsBefore = s.combatants.slice(0, s.activeIndex).filter(c => !doomed.has(c.id)).length
      s.combatants = s.combatants.filter(c => !doomed.has(c.id))
      if (s.selectedId && doomed.has(s.selectedId)) s.selectedId = null
      const stillThere = activeId ? s.combatants.findIndex(c => c.id === activeId) : -1
      s.activeIndex = stillThere >= 0 ? stillThere : Math.min(survivorsBefore, Math.max(0, s.combatants.length - 1))
    })
  },

  delayCombatant(id) {
    // Two undo steps when you delay the creature whose turn it is (one for leaving the order, one
    // for the turn advance) — nextTurn owns the end-of-turn ticks and the timer, so it runs as
    // itself rather than being inlined here.
    const st = get()
    const wasActive = st.combatants[st.activeIndex]?.id === id
    let moved = false
    set(s => {
      const c = s.combatants.find(x => x.id === id)
      if (!c || c.isDelayed) return
      record(s)
      c.isDelayed = true
      c.delayedOnRound = s.round    // when its position next comes up, the Delay is over (p. 416)
      moved = true
    })
    if (moved && wasActive && get().inCombat) get().nextTurn()
  },

  returnFromDelay(id) {
    set(s => {
      const i = s.combatants.findIndex(c => c.id === id)
      if (i < 0 || !s.combatants[i].isDelayed) return
      record(s)
      const [c] = s.combatants.splice(i, 1)
      c.isDelayed = false
      // Removing it from earlier in the array pulls the active pointer down with it.
      const active = i < s.activeIndex ? s.activeIndex - 1 : s.activeIndex
      // You return on the initiative count of the turn you came back after — an exact tie, so the
      // array position is the only thing saying you re-entered BEHIND it (and behind anyone else
      // who already returned onto that count). initSort keeps mid-combat ties as they lie for
      // exactly that reason — see `settled` there.
      c.initiative = s.combatants[active]?.initiative ?? c.initiative
      s.combatants.splice(active + 1, 0, c)
      s.activeIndex = active
    })
  },

  setScope(scopeId) {
    if (scopeId === _scopeId) return
    flushPersist()          // the outgoing campaign's board, under the outgoing key
    _scopeId = scopeId
    get().reloadFromStorage()
    // The GM layout store and the GM widgets re-key off the same switch.
    for (const fn of _scopeListeners) fn()
  },

  reloadFromStorage() {
    const p = loadPersistedCombat()
    _cid = p?.cidCounter ?? 0
    _condId = p?.condCounter ?? 0
    _undoStack.length = 0
    _redoStack.length = 0
    set(s => {
      s.combatants = p?.combatants ?? []
      s.round = p?.round ?? 1
      s.activeIndex = p?.activeIndex ?? 0
      s.selectedId = p?.selectedId ?? null
      s.inCombat = p?.inCombat ?? false
      s.savedSignature = p?.savedSignature ?? null
      s.turns = p?.turns ?? []
      s.turnTimer = rehydrateTimer(p?.turnTimer)
      s.diceResults = []
      s.canUndo = false
      s.canRedo = false
    })
  },

  setInitiative(id, v) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c) return
      invalidateRedo(s)
      // A combatant with no initiative yet was never PLACED — reinforcements are just pushed on
      // the end of the array, so its position says nothing and the settled sort would strand it
      // behind a PC it ties. Place it by the fresh-order rule instead (adversary first on a tie
      // with a PC, Player Core "Initiative"); everyone already on the board keeps their spot.
      const wasUnplaced = c.initiative === null
      c.initiative = v
      // Mid-combat: re-sort immediately and keep activeIndex pointing to the same combatant
      if (s.inCombat && v !== null) {
        const activeId = s.combatants[s.activeIndex]?.id
        if (wasUnplaced) {
          const cmp = initSort(false)
          s.combatants.splice(s.combatants.findIndex(x => x.id === id), 1)
          const at = s.combatants.findIndex(x => cmp(c, x) < 0)
          s.combatants.splice(at < 0 ? s.combatants.length : at, 0, c)
        } else {
          s.combatants.sort(initSort(true))   // mid-combat: ties stay as the board has them
        }
        if (activeId !== undefined) {
          const newIdx = s.combatants.findIndex(c => c.id === activeId)
          if (newIdx >= 0) s.activeIndex = newIdx
        }
      }
    })
  },

  sortByInitiative() {
    set(s => { s.combatants.sort(initSort(s.inCombat)) })
  },

  rollMonsterInitiative() {
    set(s => {
      invalidateRedo(s)
      for (const c of s.combatants) {
        if (c.isPC || !c.creature) continue
        const perc = c.scaledToLevel !== undefined
          ? scaleByLevel(c.creature, c.scaledToLevel).perception
          : applyWeakElite(c.creature, c.isElite ? 'elite' : c.isWeak ? 'weak' : 'normal').perception
        c.initiative = Math.floor(Math.random() * 20) + 1 + perc
      }
    })
  },

  startCombat() {
    set(s => {
      // Delay is a within-combat position, so a fresh fight starts with everyone in the order —
      // cleared BEFORE the sort, so nothing last fight left behind can reach it.
      for (const c of s.combatants) { c.isDelayed = false; c.countedThisRound = false; c.endedThisRound = false }
      // A fresh fight settles its own order: the monster-before-PC tie rule applies here and
      // nowhere else (initSort's `settled`).
      s.combatants.sort(initSort(false))
      s.inCombat = true; s.round = 1
      // First active = first combatant that's either alive or a PC (downed PCs
      // still take turns; only defeated NPCs/monsters are skipped).
      s.activeIndex = s.combatants.findIndex(c => !skipsTurn(c))
      if (s.activeIndex < 0) s.activeIndex = 0
      // The first creature's turn begins now, and a turn start is a turn start: credit its
      // initiative count and run the round-duration clocks it owns (Player Core p. 426). Without
      // this it is the ONE creature with no count in round 1, so a Delay-and-return inside round 1
      // lands the advance on it a second time and ticks its effects a round early — and any effect
      // it created before the fight began misses its first turn's tick entirely.
      // Everything the opening advance stepped OVER (a defeated NPC the GM never cleared, sorted
      // ahead of the first actor) has had its count too — its initiative came up, it just can't act,
      // exactly as in nextTurn's skip loop. Crediting the whole run 0…activeIndex is also what
      // loadPersistedCombat derives (`i <= activeIndex`), so a reloaded board and a live one agree;
      // crediting only the lander left those seats a free count and ran their effects a round long.
      const counts = new Set<string>()
      for (let i = 0; i <= s.activeIndex; i++) {
        creditCount(s.combatants[i], counts)
        // …and the seats it stepped OVER have had their turn END as well, on the same reasoning the
        // skip loop uses — otherwise a defeated NPC at the top of the order is the one creature
        // whose round-1 turn never ends. Strictly `<`: the lander's turn is starting, not ending
        // (the same seat split loadPersistedCombat derives for a reloaded board).
        if (i < s.activeIndex) endTurnPass(s, s.combatants[i])
      }
      tickSourceDurations(s, counts)
      // …and any start-of-turn conditions (Stunned) it walked into combat with are consumed.
      tickConditionsAtStart(s.combatants[s.activeIndex])
      // selectedId intentionally NOT changed — user controls which stat block is shown
      if (turnTimerOn()) beginTurn(s, s.combatants[s.activeIndex])
      else s.turnTimer = null
    })
  },

  endCombat() {
    set(s => {
      s.inCombat = false
      // Save the final turn's time, then stop the timer.
      if (turnTimerOn()) commitTurn(s)
      s.turnTimer = null
    })
  },

  nextTurn() {
    set(s => {
      if (!s.combatants.length) return
      // Record so Ctrl+Z reverses the whole turn-advance — including the
      // condition ticks and persistent damage applied to the ending creature,
      // which prevTurn can't recreate.
      record(s)
      const cur = s.combatants[s.activeIndex]
      if (cur) endTurnPass(s, cur)
      // Advance, skipping defeated NPCs/monsters and anyone who Delayed. Defeated PCs still take
      // their turn — a downed player can spend actions, recover, etc.
      const len = s.combatants.length
      // Every initiative count the advance passes, landing one included: a skipped creature still
      // has a turn on the count, so effects IT created keep running down (Duration, above).
      const counts = new Set<string>()
      // Crossing back past the top of the order starts a new round, and a new round gives everyone
      // their count back — including anyone who Delayed across the wrap. The round turns over HERE,
      // as the pointer crosses, not after the skip loop: a creature the loop steps over PAST the top
      // is taking its turn in the NEW round, and checking it against the old round's flags spends a
      // count it doesn't own (a source credited in round 1 and skipped on the wrap then got no
      // round-2 tick at all). Guarded so the bump fires exactly once per advance even when the whole
      // order is skipped and the pointer crosses the top twice.
      let wrapped = false
      const cross = (i: number) => {
        if (i !== 0 || wrapped) return
        wrapped = true
        s.round += 1
        for (const c of s.combatants) { c.countedThisRound = false; c.endedThisRound = false }
      }
      let next = (s.activeIndex + 1) % len
      cross(next)
      let safety = 0
      while (skipsTurn(s.combatants[next]) && safety < len) {
        // A DEFEATED creature's initiative count still comes up — it just can't act — so effects it
        // created keep running down, AND its own turn ends (endTurnPass below: its persistent
        // damage, its Frightened step, its source-less durations). A DELAYED one gave its count up:
        // its turn happens later, and both clocks run then. Crediting the skip too would tick a
        // delayed source's effect twice in the round it returns (a 3-round effect ending after 2),
        // and passing its turn-end would spend the very negatives p. 416 already charged at the
        // Delay — which is why one `!skipped.isDelayed` gates both.
        const skipped = s.combatants[next]
        // Delay does not hold a turn open for ever. Player Core p. 416, Delay (the entry this repo
        // ships, public/data/actions.json): *"If you Delay an entire round without returning to the
        // initiative order, the actions from the Delayed turn are lost, your initiative doesn't
        // change, and your next turn occurs at your original position in the initiative order."*
        // Its own position has now come up in a LATER round than the one it delayed in, so the Delay
        // is spent: it re-enters here and the advance lands on it.
        if (skipped?.isDelayed && s.round > (skipped.delayedOnRound ?? s.round)) {
          skipped.isDelayed = false
          skipped.delayedOnRound = undefined
          if (!skipsTurn(skipped)) break     // its next turn, at its original position
        }
        if (skipped && !skipped.isDelayed) { creditCount(skipped, counts); endTurnPass(s, skipped) }
        const stepped = (next + 1) % len
        cross(stepped)
        next = stepped
        safety++
      }
      s.activeIndex = next
      creditCount(s.combatants[next], counts)
      // Round durations tick at the START of their SOURCE's turn (Player Core p. 426).
      tickSourceDurations(s, counts)
      // Start-of-turn conditions (Stunned) are consumed as the new creature's
      // turn begins.
      tickConditionsAtStart(s.combatants[s.activeIndex])
      // selectedId intentionally NOT changed — user controls which stat block is shown
      // Turn timer: bank the turn that just ended, start timing the new one.
      if (turnTimerOn()) { commitTurn(s); beginTurn(s, s.combatants[s.activeIndex]) }
    })
    // Keep PC party-card HP live (auto-rolled persistent damage may have hit a PC).
    get().combatants.forEach(syncPcHp)
  },

  prevTurn() {
    set(s => {
      if (!s.combatants.length) return
      // Back the pointer up WITHIN the round only. prevTurn is not the inverse of nextTurn — it
      // un-ticks no duration, un-rolls no persistent damage and un-credits no initiative count.
      // Stepping back past the top of the order used to drop the round number while leaving all of
      // that applied, so the next advance re-ran the wrap branch: every countedThisRound cleared and
      // the same counts credited a second time inside one round (a 2-round effect down to 1 on the
      // spot). The previous round's ticks have already fired and only Undo (Ctrl+Z) reverses a turn
      // advance, so at the top of the order this does nothing.
      if (s.activeIndex === 0) return
      s.activeIndex -= 1
      // selectedId intentionally NOT changed — user controls which stat block is shown
      // Going back discards the current running turn (it didn't really finish)
      // and restarts timing for the now-active combatant.
      if (turnTimerOn()) beginTurn(s, s.combatants[s.activeIndex])
    })
  },

  selectCombatant(id) { set(s => { s.selectedId = id }) },

  applyDamage(id, amt) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c) return
      record(s)
      let rem = amt
      if (c.tempHP > 0) { const abs = Math.min(c.tempHP, rem); c.tempHP -= abs; rem -= abs }
      c.currentHP = Math.max(0, c.currentHP - rem)
      if (c.currentHP === 0) {
        if (c.isPC) {
          applyPCDefeat(s, id)
        } else {
          c.isDefeated = true
        }
      }
    })
    syncPcHp(get().combatants.find(c => c.id === id))
  },

  applyHealing(id, amt) {
    set(s => {
      const c = s.combatants.find(c => c.id===id)
      if (!c) return
      record(s)
      c.currentHP = Math.min(c.maxHP, c.currentHP + amt)
      if (c.currentHP > 0) {
        c.isDefeated = false
        // Healed back above 0 → no longer knocked out. Mirror setDefeated(false): drop the Unconscious
        // and Dying conditions applyPCDefeat added (and take the Wounded bump), so a revived PC
        // doesn't keep its -4 Perception/Reflex + off-guard.
        if (c.isPC) reviveConditions(c)
      }
    })
    syncPcHp(get().combatants.find(c => c.id === id))
  },

  setTempHP(id, amt) {
    set(s => { const c = s.combatants.find(c => c.id===id); if (!c) return; record(s); c.tempHP = Math.max(0,amt) })
  },

  setDefeated(id, val) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c) return
      record(s)
      if (val && c.isPC) {
        applyPCDefeat(s, id)
      } else {
        c.isDefeated = val
        // Restoring a PC: remove Unconscious + Dying (and take the Wounded bump).
        if (!val && c.isPC) reviveConditions(c)
      }
    })
    syncPcHp(get().combatants.find(c => c.id === id))
  },

  setMaxHP(id, val) {
    set(s => {
      const c = s.combatants.find(c => c.id===id)
      if (!c) return
      record(s)
      c.maxHP = val
      if (c.currentHP > val) c.currentHP = val
    })
    syncPcHp(get().combatants.find(c => c.id === id))
  },

  setPcMaxHP(name, maxHP) {
    if (!(maxHP > 0)) return
    set(s => {
      const c = s.combatants.find(c => c.isPC && c.name.toLowerCase() === name.toLowerCase())
      if (!c) return
      // A PC sitting at full (incl. the 0/0 it's added with) refills to the new
      // max; a damaged PC keeps its damage, just clamped to the new ceiling.
      const wasFull = c.currentHP >= c.maxHP
      c.maxHP = maxHP
      c.currentHP = wasFull ? maxHP : Math.min(c.currentHP, maxHP)
    })
  },

  addCondition(id, cond) {
    set(s => {
      const c = s.combatants.find(c => c.id===id)
      if (!c) return
      record(s)
      const ei = c.conditions.findIndex(x => x.name.toLowerCase()===cond.name.toLowerCase())
      const nc = { ...cond, id: ncid() }
      if (ei >= 0) c.conditions[ei] = nc
      else c.conditions.push(nc)
    })
  },

  removeCondition(id, condId) {
    set(s => { const c = s.combatants.find(c => c.id===id); if (!c) return; record(s); c.conditions = c.conditions.filter(x => x.id!==condId) })
  },

  updateConditionValue(id, condId, v) {
    set(s => {
      const c = s.combatants.find(c => c.id===id)
      const cond = c?.conditions.find(x => x.id===condId)
      if (cond) { record(s); cond.value = v }
    })
  },

  updateConditionDuration(id, condId, d) {
    set(s => {
      const c = s.combatants.find(c => c.id===id)
      const cond = c?.conditions.find(x => x.id===condId)
      if (cond) { record(s); cond.duration = d; cond.isPermanent = d===undefined }
    })
  },

  setEliteWeak(id, mode) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c || !c.creature) return
      record(s)
      c.isElite = mode === 'elite'; c.isWeak = mode === 'weak'
      c.scaledToLevel = undefined
      const adj = applyWeakElite(c.creature, mode)
      // Keep the damage already dealt instead of healing to full — a bloodied
      // creature stays bloodied when you swap its difficulty mid-fight.
      const damage = Math.max(0, c.maxHP - c.currentHP)
      c.maxHP = adj.defenses.hp
      c.currentHP = Math.max(0, c.maxHP - damage)
    })
  },

  setScaledLevel(id, level) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c || !c.creature) return
      record(s)
      c.isElite = false; c.isWeak = false
      c.scaledToLevel = level
      const adj = level !== undefined ? scaleByLevel(c.creature, level) : c.creature
      // Preserve damage taken across a level re-scale (see setEliteWeak).
      const damage = Math.max(0, c.maxHP - c.currentHP)
      c.maxHP = adj.defenses.hp
      c.currentHP = Math.max(0, c.maxHP - damage)
    })
  },

  setResourceUse(id, key, used) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c) return
      record(s)
      if (!c.resourceUses) c.resourceUses = {}
      if (used <= 0) delete c.resourceUses[key]
      else c.resourceUses[key] = used
    })
  },

  resetResources(id, keys) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c || !c.resourceUses) return
      record(s)
      if (!keys) { c.resourceUses = {}; return }
      for (const k of keys) delete c.resourceUses![k]
    })
  },

  renameCombatant(id, name) {
    set(s => { const c = s.combatants.find(c => c.id === id); if (!c) return; record(s); c.name = name })
  },

  setNotes(id, notes) {
    set(s => { const c = s.combatants.find(c => c.id===id); if (c) c.notes = notes })
  },

  setCombatantImage(id, image) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c?.creature) return
      c.creature.image = image
    })
  },

  addDiceResult(r) {
    set(s => { s.diceResults.unshift(r); if (s.diceResults.length > 8) s.diceResults.length = 8 })
  },

  clearDiceResults() { set(s => { s.diceResults = [] }) },

  undo() {
    if (!_undoStack.length) return
    set(s => {
      const o = original(s) as CombatStore | undefined
      if (o) {
        _redoStack.push({ combatants: o.combatants, round: o.round, activeIndex: o.activeIndex })
        if (_redoStack.length > HISTORY_MAX) _redoStack.shift()
      }
      const prev = _undoStack.pop()!
      s.combatants = prev.combatants
      s.round = prev.round
      s.activeIndex = prev.activeIndex
      s.canUndo = _undoStack.length > 0
      s.canRedo = true
    })
    get().combatants.forEach(syncPcHp)
  },

  redo() {
    if (!_redoStack.length) return
    set(s => {
      const o = original(s) as CombatStore | undefined
      if (o) {
        _undoStack.push({ combatants: o.combatants, round: o.round, activeIndex: o.activeIndex })
        if (_undoStack.length > HISTORY_MAX) _undoStack.shift()
      }
      const next = _redoStack.pop()!
      s.combatants = next.combatants
      s.round = next.round
      s.activeIndex = next.activeIndex
      s.canUndo = true
      s.canRedo = _redoStack.length > 0
    })
    get().combatants.forEach(syncPcHp)
  },

  saveEncounter(name) {
    const { combatants } = get()
    const saved: SavedEncounter = {
      name, savedAt: new Date().toISOString(),
      combatants: combatants.map(c => {
        // Strip the never-read raw/rawMarkdown fields so the saved snapshot
        // stays under the localStorage quota even for big encounters.
        const slim = slimCombatantForPersist(c)
        return {
          name: slim.name, creature: slim.creature ?? null, creatureId: slim.creature?.id ?? null,
          isPC: slim.isPC, isAlly: slim.isAlly, maxHP: slim.maxHP, isElite: slim.isElite, isWeak: slim.isWeak,
          scaledToLevel: slim.scaledToLevel, notes: slim.notes,
        }
      }),
    }
    const store = { ...getEncStore(), [name]: saved }
    setEncStore(store)
    // The board now matches a save, so clearing it is safe without a prompt.
    set(s => { s.savedSignature = combatSignature(s.combatants) })
  },

  loadEncounter(name, _creatures) {
    const saved = getEncStore()[name]
    if (!saved) return
    set(s => {
      // Loading replaces the whole board — record it so Ctrl+Z puts the previous fight back
      // (the way clearAllCombatants does).
      record(s)
      s.combatants = saved.combatants.map(sc => {
        const creature = sc.creature ?? null
        const hp = creature?.defenses.hp ?? sc.maxHP
        return {
          id: nid(), name: sc.name, creature, isPC: sc.isPC, isAlly: sc.isAlly ?? false,
          initiative: null, currentHP: hp, maxHP: hp, tempHP: 0, conditions: [],
          isElite: sc.isElite, isWeak: sc.isWeak, scaledToLevel: sc.scaledToLevel,
          notes: sc.notes, isDefeated: false,
        }
      })
      s.round = 1; s.activeIndex = 0; s.inCombat = false; s.selectedId = null
      // Freshly loaded — record the baseline so a later clear skips the prompt.
      s.savedSignature = combatSignature(s.combatants)
    })
  },

  isEncounterUnchanged() {
    const s = get()
    return s.savedSignature !== null && combatSignature(s.combatants) === s.savedSignature
  },

  getSavedEncounterNames: () => Object.keys(getEncStore()),

  deleteSavedEncounter(name) {
    const store = { ...getEncStore() }
    delete store[name]
    setEncStore(store)
  },

  resetCombat() {
    // Keep recorded turns so the GM can still review / Save to Averages after
    // clearing the board; only the live running timer stops.
    // Recorded so Ctrl+Z brings the wiped board back (same as clearAllCombatants / loadEncounter).
    set(s => { record(s); s.combatants = []; s.round = 1; s.activeIndex = 0; s.selectedId = null; s.inCombat = false; s.diceResults = []; s.turnTimer = null; s.savedSignature = null })
  },

  // ── Turn timer actions ──
  pauseTurnTimer() {
    set(s => {
      const t = s.turnTimer
      if (!t || t.paused) return
      if (t.startedAt != null) t.accumMs += Date.now() - t.startedAt
      t.startedAt = null
      t.paused = true
    })
  },
  resumeTurnTimer() {
    set(s => {
      const t = s.turnTimer
      if (!t || !t.paused) return
      t.startedAt = Date.now()
      t.paused = false
    })
  },
  discardCurrentTurn() {
    set(s => {
      const t = s.turnTimer
      if (!t) return
      t.accumMs = 0
      t.startedAt = t.paused ? null : Date.now()
    })
  },
  removeTurn(id) {
    set(s => { s.turns = s.turns.filter(t => t.id !== id) })
  },
  saveTurnsToAverages() {
    const turns = get().turns
    if (!turns.length) return
    // Group PC turns by name; everything non-PC folds into the DM bucket.
    const pcByName = new Map<string, { sum: number; count: number }>()
    let dmSum = 0, dmCount = 0
    for (const t of turns) {
      if (t.isPC) {
        const e = pcByName.get(t.name) ?? { sum: 0, count: 0 }
        e.sum += t.seconds; e.count += 1
        pcByName.set(t.name, e)
      } else {
        dmSum += t.seconds; dmCount += 1
      }
    }
    const party = usePartyStore.getState()
    for (const [name, e] of pcByName) party.addTurnsToPlayerByName(name, e.sum, e.count)
    if (dmCount > 0) useDmAverageStore.getState().addTurns(dmSum, dmCount)
    set(s => { s.turns = [] })
  },
})))

// In-memory cache of the encounters store. localStorage.getItem returns
// stringified JSON; repeated `JSON.parse(...)` calls on a big payload add up.
// We invalidate whenever a save/delete writes back.
let _encStoreCache: Record<string, SavedEncounter> | null = null
function getEncStore(): Record<string, SavedEncounter> {
  if (_encStoreCache) return _encStoreCache
  try {
    _encStoreCache = JSON.parse(localStorage.getItem('pf2e-encounters') ?? '{}')
  } catch {
    _encStoreCache = {}
  }
  return _encStoreCache!
}
function setEncStore(store: Record<string, SavedEncounter>): void {
  _encStoreCache = store
  localStorage.setItem('pf2e-encounters', JSON.stringify(store))
  notifyPersist('pf2e-encounters')
}

/** Drop the in-memory cache. Call this from any code path that writes the
 *  pf2e-encounters localStorage key directly (e.g. the import helper). */
export function invalidateEncounterCache(): void {
  _encStoreCache = null
}

/** Shared read of the encounters store — exported so external helpers (e.g.
 *  encounterTransfer) can hit the same in-memory cache instead of re-parsing
 *  localStorage on every export/import. */
export function readEncounterStore(): Record<string, SavedEncounter> {
  return getEncStore()
}

/** Shared write of the encounters store — exported so the import helper can
 *  use the same cached path as combat store, keeping the cache hot. */
export function writeEncounterStore(store: Record<string, SavedEncounter>): void {
  setEncStore(store)
}

// Strip the heavy fields that are never read at runtime so the persisted
// combat snapshot doesn't blow past the localStorage quota.
// - `creature.raw`         : the entire source RawCreature (unused after parse)
// - `creature.rawMarkdown` : the AoN markdown fallback (rarely rendered, can be
//                            re-fetched if the creature is reloaded from
//                            bestiary).
// For a 10-monster fight this typically cuts the snapshot from ~1MB to <50KB.
function slimCombatantForPersist(c: Combatant): Combatant {
  if (!c.creature) return c
  const { raw: _raw, rawMarkdown: _md, ...slim } = c.creature
  void _raw; void _md
  return { ...c, creature: slim as typeof c.creature }
}

// Persist live combat state (debounced) whenever the relevant slice changes.
// Skip diceResults — those are ephemeral.
useCombatStore.subscribe((s) => {
  schedulePersist(() => ({
    combatants: s.combatants.map(slimCombatantForPersist),
    round: s.round,
    activeIndex: s.activeIndex,
    inCombat: s.inCombat,
    selectedId: s.selectedId,
    cidCounter: _cid,
    condCounter: _condId,
    savedSignature: s.savedSignature,
    turns: s.turns,
    // Bank the running window into accumMs so a reload keeps the elapsed time
    // counted so far (startedAt is re-derived on load by rehydrateTimer).
    turnTimer: s.turnTimer ? {
      ...s.turnTimer,
      accumMs: s.turnTimer.accumMs + (s.turnTimer.startedAt != null && !s.turnTimer.paused ? Date.now() - s.turnTimer.startedAt : 0),
      startedAt: null,
    } : null,
  }))
})

/**
 * Sort: highest initiative first; on tie, monsters (non-PC with creature) before PCs.
 *
 * `settled` = the board is already in an order somebody arranged, i.e. mid-combat. The
 * monster-before-PC tie rule only settles a FRESH order; once the fight is running the array
 * position IS the order — a creature back from Delay re-entered behind the one whose count it
 * returned on, possibly behind others who returned onto that same count earlier. So mid-combat a
 * tie compares equal and Array#sort (stable) leaves the pair where it lies. Re-applying the tie
 * rule instead would silently re-shuffle creatures nobody touched, on every initiative edit.
 */
function initSort(settled: boolean) {
  return (a: Combatant, b: Combatant): number => {
    if (a.initiative === null && b.initiative === null) return 0
    if (a.initiative === null) return 1
    if (b.initiative === null) return -1
    if (a.initiative !== b.initiative) return b.initiative - a.initiative
    if (settled) return 0
    const aIsMonster = !a.isPC && !!a.creature
    const bIsMonster = !b.isPC && !!b.creature
    if (aIsMonster && !bIsMonster) return -1
    if (!aIsMonster && bIsMonster) return 1
    return 0
  }
}
