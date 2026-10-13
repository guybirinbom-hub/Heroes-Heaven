// tracker 2026-10-13: store — players' conditions step with the turn (owner's list 2026-10-01, item 3)
//
// The owner's answer: "the tracker should do that for players [step conditions down each turn] but have
// a setting for it not to do that". So a PLAYER character's Frightened goes down by 1 at the end of
// their turn and their Stunned is used up at the start of it — exactly as a monster's — while the
// "Step players' conditions each turn" setting (settingsStore.pcConditionTicks, on by default) is on,
// and nothing of a player's moves while it is off. A monster's step never depends on the setting.
//
// Whether the step is a GM gesture (and so reaches a campaign player's sheet) is pinned in
// vitalsGesture.test.ts; what the campaign seam does with it, in
// test/bug-tracker-seam-never-overwrite.test.tsx. Every name here is synthetic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCombatStore, takeVitalsGesture, releaseSteps, flushPersist, scopeKey } from './combatStore'
import { useSettingsStore } from './settingsStore'
import { conditionKey, conditionMetaOf, CONDITION_META } from '../utils/conditionEffects'

const PC = 'Tamsin Reedwater'   // synthetic
const MONSTER = 'Bog Strider'   // synthetic
const store = () => useCombatStore.getState()
const rowOf = (name: string) => store().combatants.find(c => c.name === name)!
const valueOf = (name: string, cond: string) => rowOf(name).conditions.find(c => c.name === cond)?.value

function board(pcFirst: boolean) {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
  store().addCombatant(null, { name: PC, isPC: true, maxHP: 30, charId: 'char-tamsin' })
  store().addCombatant(null, { name: MONSTER, maxHP: 20 })
  store().setInitiative(rowOf(PC).id, pcFirst ? 20 : 10)
  store().setInitiative(rowOf(MONSTER).id, pcFirst ? 10 : 20)
}
const give = (name: string, cond: string, value: number, isPermanent = false) =>
  store().addCondition(rowOf(name).id, { name: cond, value, isPermanent })

describe('a player character’s conditions step with the turn', () => {
  beforeEach(() => { localStorage.clear(); useSettingsStore.setState({ pcConditionTicks: true }) })
  afterEach(() => { localStorage.clear(); useSettingsStore.setState({ pcConditionTicks: true }) })

  it('is ON by default, and a save from before the setting existed reads ON', async () => {
    // MUTATION (tried 2026-10-13): `pcConditionTicks: false` in settingsStore's DEFAULTS → fails.
    localStorage.clear()
    vi.resetModules()
    const fresh = await import('./settingsStore')
    expect(fresh.useSettingsStore.getState().pcConditionTicks).toBe(true)
    // An older build's saved settings carry no such key: the default fills it in.
    localStorage.setItem('pf2e-settings', JSON.stringify({ showInitAC: false }))
    vi.resetModules()
    const older = await import('./settingsStore')
    expect(older.useSettingsStore.getState().pcConditionTicks).toBe(true)
  })

  it('turned OFF, it stays off after a restart — the owner’s “setting for it not to do that” is kept', async () => {
    /*
     * The G3 refuter (2026-10-13): deleting the line that saves the switch left the whole tracker suite
     * green, while an “off” silently came back ON at the next start.
     * MUTATION (tried 2026-10-13): drop `pcConditionTicks: next.pcConditionTicks,` from setSetting's saved
     * object (settingsStore.ts) → fails at “after a restart” (expected true to be false).
     */
    localStorage.clear()
    vi.resetModules()
    const before = await import('./settingsStore')
    before.useSettingsStore.getState().setSetting('pcConditionTicks', false)
    // Another setting saved later must not bring it back either.
    before.useSettingsStore.getState().setSetting('showInitLevel', false)
    vi.resetModules()
    const after = await import('./settingsStore')
    expect(after.useSettingsStore.getState().pcConditionTicks, 'after a restart').toBe(false)
    // …and back ON is kept the same way.
    after.useSettingsStore.getState().setSetting('pcConditionTicks', true)
    vi.resetModules()
    const again = await import('./settingsStore')
    expect(again.useSettingsStore.getState().pcConditionTicks).toBe(true)
  })

  it('Frightened 2 → 1 at the end of the PC’s own turn, then gone the round after', () => {
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()                         // the PC acts first
    expect(valueOf(PC, 'frightened')).toBe(2)    // a turn START is no Frightened step
    store().nextTurn()                            // the PC's turn ends
    expect(valueOf(PC, 'frightened')).toBe(1)
    store().nextTurn()                            // the monster's turn ends: not the PC's
    expect(valueOf(PC, 'frightened')).toBe(1)
    store().nextTurn()                            // the PC's turn ends again
    expect(valueOf(PC, 'frightened')).toBeUndefined()
  })

  it('Stunned is used up at the START of the PC’s turn', () => {
    board(false)
    give(PC, 'stunned', 2)
    store().startCombat()                         // the monster acts first
    expect(valueOf(PC, 'stunned')).toBe(2)
    store().nextTurn()                            // the PC's turn begins
    expect(valueOf(PC, 'stunned')).toBeUndefined()
  })

  it('with the setting OFF nothing of a player’s moves — and a monster’s still does', () => {
    // MUTATION (tried 2026-10-13): make stepsConditions answer `true` for every row → this one fails
    // (expected 1 to be 2).
    useSettingsStore.setState({ pcConditionTicks: false })
    board(true)
    give(PC, 'frightened', 2)
    give(PC, 'stunned', 1)
    give(MONSTER, 'frightened', 2)
    store().startCombat()
    store().nextTurn()                            // PC's turn ends, monster's begins
    store().nextTurn()                            // monster's turn ends, PC's begins
    expect(valueOf(PC, 'frightened')).toBe(2)
    expect(valueOf(PC, 'stunned')).toBe(1)
    expect(valueOf(MONSTER, 'frightened')).toBe(1)
  })

  it('a pinned (“until removed”) condition still never steps — on a player or a monster', () => {
    board(true)
    give(PC, 'frightened', 2, true)
    store().startCombat()
    store().nextTurn()
    expect(valueOf(PC, 'frightened')).toBe(2)
  })
})

/*
 * SPENT STEPS (combatStore's gesture block). The G3 refuter (2026-10-13): in a campaign the step is the
 * GM's gesture and goes to the player's own sheet, Undo puts back only the BOARD (the seam's rule A) —
 * and it also put back the turn flags, so Next pressed again ran the same turn end twice: Frightened
 * 2 → 1 → gone on the player's sheet for ONE turn end. A step a host TOOK is now spent for that row's
 * turn, across an Undo; one nobody took (the standalone tracker) is not. The seam's own legs, with the
 * real usePcSheetTruth and the pushes counted, are in test/bug-tracker-seam-never-overwrite.test.tsx.
 */
describe('a player’s step a host took is spent — Undo, then Next, never steps them twice', () => {
  beforeEach(() => { localStorage.clear(); useSettingsStore.setState({ pcConditionTicks: true }) })
  afterEach(() => { localStorage.clear(); useSettingsStore.setState({ pcConditionTicks: true }) })

  /** A host on the store, as the campaign seam is: it takes every PC row's gesture, every dispatch. */
  function host() {
    let taken = 0
    const off = useCombatStore.subscribe(s => {
      for (const c of s.combatants) if (c.isPC && takeVitalsGesture(c.id)) taken++
    })
    return { taken: () => taken, off }
  }

  it('end of turn: Next (taken), Ctrl+Z, Next → no second step and no second gesture', () => {
    /*
     * The board's own Frightened goes back to 2 with the Undo (in a campaign the seam then writes the
     * player's sheet over it — 1, the step his Next sent); the repeated turn end leaves it alone.
     * MUTATION (tried 2026-10-13): drop `&& !stepTaken(c.id, 'end', s.round)` from endTurnPass
     * (combatStore.ts) → fails at “the same turn end, again” (expected 2 to be 1).
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const h = host()
    try {
      store().nextTurn()                        // the PC's turn ends: 2 → 1, taken
      expect(valueOf(PC, 'frightened')).toBe(1)
      expect(h.taken()).toBe(1)
      store().undo()                            // the board back on their turn
      expect(store().combatants[store().activeIndex].name).toBe(PC)
      expect(valueOf(PC, 'frightened'), 'Undo puts the BOARD back').toBe(2)
      store().nextTurn()                        // the same turn end, again
      expect(h.taken(), 'the same turn end, again').toBe(1)
      expect(valueOf(PC, 'frightened'), 'not stepped a second time').toBe(2)
      // Their NEXT turn end is a new one and steps as always.
      store().nextTurn()                        // the monster's turn ends
      store().nextTurn()                        // the PC's turn ends, round 2
      expect(valueOf(PC, 'frightened')).toBe(1)
      expect(h.taken()).toBe(2)
    } finally { h.off() }
  })

  it('start of turn: Stunned used up (taken), Ctrl+Z, Next → not used up again', () => {
    /*
     * Stunned 4: a turn start takes 3 (CONDITION_META decrementBy), leaving 1 — so a second start of
     * the same turn would take the last point.
     * MUTATION (tried 2026-10-13): drop `|| stepTaken(c.id, 'start', round)` from tickConditionsAtStart
     * (combatStore.ts) → fails at “the same turn start, again” (expected 2 to be 1).
     */
    board(false)
    give(PC, 'stunned', 4)
    store().startCombat()                       // the monster acts first
    const h = host()
    try {
      store().nextTurn()                        // the PC's turn starts: 4 → 1, taken
      expect(valueOf(PC, 'stunned')).toBe(1)
      expect(h.taken()).toBe(1)
      store().undo()
      expect(valueOf(PC, 'stunned')).toBe(4)
      store().nextTurn()                        // the same turn start, again
      expect(h.taken(), 'the same turn start, again').toBe(1)
      expect(valueOf(PC, 'stunned')).toBe(4)
    } finally { h.off() }
  })

  it('a step the host hands BACK (it never reached the player) is stepped again when the turn comes round', () => {
    /*
     * The campaign seam hands a step back when it is dropped without reaching the sheet (pcSheetTruth:
     * owed and taken off by a load, or lost to the sheet winning).
     * MUTATION (tried 2026-10-13): make `releaseSteps` do nothing (combatStore.ts) → fails at “handed back:
     * stepped again” (expected 2 to be 1), with the seam's five “handed back” legs.
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const keys: string[] = []
    const off = useCombatStore.subscribe(s => {
      for (const c of s.combatants) if (c.isPC) takeVitalsGesture(c.id, keys)
    })
    try {
      store().nextTurn()
      expect(keys, 'the host is told which step it took').toHaveLength(1)
      releaseSteps(keys)
      store().undo()
      store().nextTurn()
      expect(valueOf(PC, 'frightened'), 'handed back: stepped again').toBe(1)
    } finally { off() }
  })

  it('with NO host (the standalone tracker) Undo puts the condition back and Next steps it again — as a monster’s', () => {
    /*
     * MUTATION (tried 2026-10-13): spend the step where it is MADE instead of where a host takes it (add
     * `_stepsTaken.add(key)` to markStep, combatStore.ts) → fails at “stepped again” (expected 2 to be 1).
     */
    board(true)
    give(PC, 'frightened', 2)
    give(MONSTER, 'frightened', 2)
    store().startCombat()
    store().nextTurn()                          // the PC's turn ends: nobody takes the step
    expect(valueOf(PC, 'frightened')).toBe(1)
    store().undo()
    expect(valueOf(PC, 'frightened')).toBe(2)
    store().nextTurn()
    expect(valueOf(PC, 'frightened'), 'stepped again').toBe(1)
  })

  it('a fresh fight starts with nothing spent', () => {
    /*
     * The same PC row stays on the board between fights, and every fight has a round 1.
     * MUTATION (tried 2026-10-13, round 1's code): drop `_stepsTaken.clear()` from startCombat → fails at
     * “the new fight’s first turn end” (expected 2 to be 1).
     * MUTATION (tried 2026-10-13, round 2's code): drop `newFight()` from startCombat (combatStore.ts) →
     * fails the same way (the new fight's round 1 is the old one's), with the “NEW fight” leg below.
     */
    board(true)
    give(PC, 'frightened', 1)
    store().startCombat()
    const h = host()
    try {
      store().nextTurn()                        // round 1 turn end: 1 → gone, taken
      expect(valueOf(PC, 'frightened')).toBeUndefined()
      store().endCombat()
      give(PC, 'frightened', 2)
      store().startCombat()                     // a new fight, the PC first again
      store().nextTurn()
      expect(valueOf(PC, 'frightened'), 'the new fight’s first turn end').toBe(1)
    } finally { h.off() }
  })

  /*
   * …BUT START IS NO UNDO STEP (the G3 refuter, round 2). Round 1's startCombat CLEARED the record, while
   * the undo history survived it: one Ctrl+Z after a fresh Start went back to the board before the last
   * fight's last Next, and the next Next stepped that turn end — already on the player's sheet — a second
   * time (two pushes for one turn end at the seam: test/bug-tracker-seam-never-overwrite.test.tsx). A
   * fresh fight now gets a new NUMBER, and every undo / redo board carries its own fight's.
   */
  const acting = () => store().combatants[store().activeIndex]?.name

  it('Next (taken), End, Start, Ctrl+Z, Next → the last fight’s turn end is still spent', () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone, in combatStore.ts) — each fails at “the last fight’s turn end,
     * again” (expected 2 to be 1):
     *  - drop `_fight = prev.fight` from undo (the restored board stays in the new fight);
     *  - put round 1's `_stepsTaken.clear()` back in startCombat in place of `newFight()` (the Redo leg
     *    below fails too);
     *  - drop the `_undoStack` loop from newFight's live set (the last fight's spent steps let go).
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const h = host()
    try {
      store().nextTurn()                        // the PC's round-1 turn end: 2 → 1, taken
      expect(h.taken()).toBe(1)
      store().endCombat()                       // End by mistake…
      store().startCombat()                     // …Start…
      store().undo()                            // …and Ctrl+Z to get back
      expect(acting()).toBe(PC)
      expect(store().round).toBe(1)
      expect(valueOf(PC, 'frightened'), 'Undo puts the BOARD back').toBe(2)
      store().nextTurn()                        // the same turn end, again
      expect(h.taken(), 'the last fight’s turn end, again').toBe(1)
      expect(valueOf(PC, 'frightened')).toBe(2)
      // Their NEXT turn end is a new one, and steps as always.
      store().nextTurn()
      store().nextTurn()
      expect(valueOf(PC, 'frightened')).toBe(1)
      expect(h.taken()).toBe(2)
    } finally { h.off() }
  })

  it('…and a board Redo brings back across a Start keeps its fight’s spent steps too', () => {
    /*
     * Two Undos leave the board from BEFORE the PC's turn end on the Redo stack only; End and Start, and Redo
     * brings it back.
     * MUTATION (tried 2026-10-13): drop the `_redoStack` loop from newFight's live set (combatStore.ts) →
     * fails at “the redone board’s turn end” (expected 2 to be 1).
     * MUTATION (tried 2026-10-13): drop `_fight = next.fight` from redo → fails the same way.
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const h = host()
    try {
      store().applyDamage(rowOf(MONSTER).id, 3)  // an undo step before the PC's turn ends (no PC gesture)
      store().nextTurn()                        // the PC's round-1 turn end: taken
      expect(h.taken()).toBe(1)
      store().undo()                            // the Next back
      store().undo()                            // and the hit: the board before the Next is on the Redo stack
      store().endCombat()
      store().startCombat()                     // a fresh fight…
      store().redo()                            // …and the hit redone: the last fight's board, on the PC's turn
      expect(acting()).toBe(PC)
      expect(rowOf(MONSTER).currentHP).toBe(17)
      store().nextTurn()
      expect(h.taken(), 'the redone board’s turn end').toBe(1)
    } finally { h.off() }
  })

  it('a fight started after undoing back across a Start is a NEW fight: nothing of the undone one is spent in it', () => {
    /*
     * The fight number is never handed out twice (`_fightSeq`): Undo can put an OLDER number back on screen,
     * and the next Start must not land on the number of the fight that Undo stepped out of.
     * MUTATION (tried 2026-10-13): `_fight = _fight + 1` in newFight in place of `_fight = ++_fightSeq`
     * (combatStore.ts) → fails at “the new fight’s first turn end” (expected 2 to be 1).
     */
    board(true)
    give(PC, 'frightened', 2)                   // an undo step recorded under the fight on screen, N
    store().startCombat()                       // a new fight: N + 1
    const keys: string[] = []
    const off = useCombatStore.subscribe(s => {
      for (const c of s.combatants) if (c.isPC) takeVitalsGesture(c.id, keys)
    })
    try {
      store().nextTurn()                        // its round-1 turn end: taken
      expect(keys).toHaveLength(1)
      store().undo()                            // the Next back
      store().undo()                            // and the Frightened: the board from before that fight, its number N
      expect(valueOf(PC, 'frightened')).toBeUndefined()
      store().endCombat()
      give(PC, 'frightened', 2)
      store().startCombat()                     // a NEW fight
      store().nextTurn()
      expect(valueOf(PC, 'frightened'), 'the new fight’s first turn end').toBe(1)
    } finally { off() }
  })

  it('a board loaded from storage (the GM’s other device, a campaign switch) starts with nothing spent', () => {
    /*
     * A loaded board has no undo history here, and can be a new fight on the same rows — so it is a
     * fresh record too.
     * MUTATION (tried 2026-10-13): drop `_stepsTaken.clear()` from reloadFromStorage (combatStore.ts) →
     * fails at “the loaded board’s turn end” (expected 2 to be 1).
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    flushPersist()
    const saved = localStorage.getItem(scopeKey('pf2e-current-combat'))!
    expect(saved, 'fixture: the board was saved').toBeTruthy()
    const h = host()
    try {
      store().nextTurn()                        // the PC's turn end, taken
      expect(h.taken()).toBe(1)
      localStorage.setItem(scopeKey('pf2e-current-combat'), saved)
      store().reloadFromStorage()               // that saved board arrives: the PC's turn again
      expect(valueOf(PC, 'frightened')).toBe(2)
      store().nextTurn()
      expect(valueOf(PC, 'frightened'), 'the loaded board’s turn end').toBe(1)
    } finally { h.off() }
  })
})

describe('the tracker’s key for a condition another app spells differently', () => {
  it('reads Heroes Heaven’s `persistent-damage` as the tracker’s Persistent Damage — for the badge only', () => {
    // MUTATION (tried 2026-10-13): delete the `'persistent-damage'` entry from CONDITION_ALIASES → fails
    // (undefined is not the meta).
    expect(conditionKey('Persistent-Damage ')).toBe('persistent damage')
    expect(conditionMetaOf('persistent-damage')).toBe(CONDITION_META['persistent damage'])
    // Everything else is its own key, trimmed and lower-cased, as the badge always read it.
    expect(conditionMetaOf('Frightened')).toBe(CONDITION_META.frightened)
    expect(conditionMetaOf('no such condition')).toBeUndefined()
  })
})
