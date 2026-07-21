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

// Shared PC-defeat logic: sets HP to 0, applies Unconscious, reorders initiative
function applyPCDefeat(s: { combatants: Combatant[]; activeIndex: number }, id: string) {
  const c = s.combatants.find(c => c.id === id)
  if (!c || !c.isPC) return
  c.isDefeated = true
  c.currentHP = 0
  if (!c.conditions.some(x => x.name.toLowerCase() === 'unconscious')) {
    c.conditions.push({ id: ncid(), name: 'unconscious', isPermanent: true })
  }
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
      if (m?.autoDecrement && m.tickAtStart && cc.value !== undefined && cc.value > 0) {
        return { ...cc, value: Math.max(0, cc.value - (m.decrementBy ?? 1)) }
      }
      return cc
    })
    .filter(cc => {
      const m = CONDITION_META[cc.name.toLowerCase()]
      return !(m?.autoDecrement && m.tickAtStart && (cc.value ?? 1) <= 0)
    })
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
    const raw = localStorage.getItem(COMBAT_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedCombat
    if (!Array.isArray(parsed.combatants)) return null
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
function flushPersist() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
  if (!_pendingSnap) return
  try { localStorage.setItem(COMBAT_STATE_KEY, JSON.stringify(_pendingSnap())) } catch { /* quota */ }
  _pendingSnap = null
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
      // Unconscious; a monster is defeated. (cur is the active creature, so
      // applyPCDefeat does no array reorder here.)
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
      if (s.activeIndex >= s.combatants.length) s.activeIndex = Math.max(0, s.combatants.length-1)
    })
  },

  setInitiative(id, v) {
    set(s => {
      const c = s.combatants.find(c => c.id === id)
      if (!c) return
      c.initiative = v
      // Mid-combat: re-sort immediately and keep activeIndex pointing to the same combatant
      if (s.inCombat && v !== null) {
        const activeId = s.combatants[s.activeIndex]?.id
        s.combatants.sort(initSort)
        if (activeId !== undefined) {
          const newIdx = s.combatants.findIndex(c => c.id === activeId)
          if (newIdx >= 0) s.activeIndex = newIdx
        }
      }
    })
  },

  sortByInitiative() {
    set(s => { s.combatants.sort(initSort) })
  },

  rollMonsterInitiative() {
    set(s => {
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
      s.combatants.sort(initSort)
      s.inCombat = true; s.round = 1
      // First active = first combatant that's either alive or a PC (downed PCs
      // still take turns; only defeated NPCs/monsters are skipped).
      s.activeIndex = s.combatants.findIndex(c => !c.isDefeated || c.isPC)
      if (s.activeIndex < 0) s.activeIndex = 0
      // The first creature's turn begins now — consume any start-of-turn
      // conditions (Stunned) it walked into combat with.
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
      if (cur) {
        // Persistent damage resolves at the END of the creature's turn — roll &
        // apply it (if auto-roll is on) or pop a reminder, BEFORE the duration
        // tick below can expire the condition.
        firePersistentDamage(s, cur)
        cur.conditions = cur.conditions
          .map(c => {
            const meta = CONDITION_META[c.name.toLowerCase()]
            // END-of-turn auto-decrement (e.g. Frightened −1). Conditions consumed
            // at the START of a turn (Stunned) are handled below, when the next
            // creature's turn begins, so they're skipped here.
            if (meta?.autoDecrement && !meta.tickAtStart && c.value !== undefined && c.value > 0) {
              return { ...c, value: Math.max(0, c.value - (meta.decrementBy ?? 1)) }
            }
            // Normal timed conditions tick duration
            if (!c.isPermanent && c.duration !== undefined) {
              return { ...c, duration: c.duration - 1 }
            }
            return c
          })
          .filter(c => {
            const meta = CONDITION_META[c.name.toLowerCase()]
            if (meta?.autoDecrement && !meta.tickAtStart && (c.value ?? 1) <= 0) return false
            if (!c.isPermanent && c.duration !== undefined && c.duration <= 0) return false
            return true
          })
        // Refill per-round / per-turn limited-use abilities — they become
        // available again on this creature's next turn.
        if (cur.resourceUses) {
          for (const k of roundTurnAbilityKeys(cur.creature)) {
            if (cur.resourceUses[k]) delete cur.resourceUses[k]
          }
        }
      }
      // Advance, skipping defeated NPCs/monsters. Defeated PCs still take
      // their turn — a downed player can spend actions, recover, etc.
      const len = s.combatants.length
      let next = (s.activeIndex + 1) % len
      if (next === 0) s.round += 1
      let safety = 0
      while (s.combatants[next]?.isDefeated && !s.combatants[next]?.isPC && safety < len) {
        const stepped = (next + 1) % len
        if (stepped === 0) s.round += 1
        next = stepped
        safety++
      }
      s.activeIndex = next
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
      if (s.activeIndex === 0) { s.activeIndex = s.combatants.length-1; s.round = Math.max(1, s.round-1) }
      else s.activeIndex -= 1
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
      if (c.currentHP > 0) c.isDefeated = false
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
        // Restoring a PC: remove the Unconscious condition
        if (!val && c.isPC) {
          c.conditions = c.conditions.filter(x => x.name.toLowerCase() !== 'unconscious')
        }
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
    set(s => { s.combatants = []; s.round = 1; s.activeIndex = 0; s.selectedId = null; s.inCombat = false; s.diceResults = []; s.turnTimer = null; s.savedSignature = null })
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

// Sort: highest initiative first; on tie, monsters (non-PC with creature) before PCs
function initSort(a: Combatant, b: Combatant): number {
  if (a.initiative === null && b.initiative === null) return 0
  if (a.initiative === null) return 1
  if (b.initiative === null) return -1
  if (a.initiative !== b.initiative) return b.initiative - a.initiative
  // Tie: monster beats PC
  const aIsMonster = !a.isPC && !!a.creature
  const bIsMonster = !b.isPC && !!b.creature
  if (aIsMonster && !bIsMonster) return -1
  if (!aIsMonster && bIsMonster) return 1
  return 0
}
