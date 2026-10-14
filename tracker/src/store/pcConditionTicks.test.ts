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
     * MUTATION (tried 2026-10-13): drop `&& !stepTaken(c.id, 'end', s.round)` (since 2026-10-14
     * `stepTaken(c, …)`, keyed by the player) from endTurnPass
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
     * MUTATION (tried 2026-10-13): drop `|| stepTaken(c.id, 'start', round)` (since 2026-10-14
     * `stepTaken(c, …)`) from tickConditionsAtStart
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
   * fresh fight now gets a new ID (a number until 2026-10-14), and every undo / redo board carries its own fight's.
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
     * A fight id is never handed out twice: Undo can put an OLDER fight back on screen, and the next Start
     * must not land on the id of the fight that Undo stepped out of.
     * MUTATION (tried 2026-10-13, when fights were numbers): `_fight = _fight + 1` in newFight in place of
     * `_fight = ++_fightSeq` (combatStore.ts) → failed at “the new fight’s first turn end” (expected 2 to
     * be 1). Since 2026-10-14 the id is made fresh every Start (`freshFightId`), on any device.
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

  /*
   * A BOARD FROM THE GM'S OTHER DEVICE (the G3 refuter, 2026-10-14). The undo history is not all that can
   * bring an older turn back: the GM-device mirror adopts any board with a newer server stamp
   * (src/data/trackerSync.ts), and one edited on the second device while this one pressed Next predates
   * that Next. The load used to clear the spent steps, so Next stepped the same turn end a second time —
   * in a campaign the seam rewrites the row from the sheet (Frightened 1), and the repeated Next took it
   * to gone and pushed it. Every fight now has an id both devices agree on (it travels with the board),
   * and a load keeps the spent steps of the fight the loaded board belongs to.
   */
  const KEY = () => scopeKey('pf2e-current-combat')
  /** The board as this device saved it — what the GM's other device holds and sends back. */
  function savedBoard(): { fightId?: string; spentSteps?: string[] } & Record<string, unknown> {
    flushPersist()
    const raw = localStorage.getItem(KEY())
    expect(raw, 'fixture: the board was saved').toBeTruthy()
    return JSON.parse(raw!) as { fightId?: string; spentSteps?: string[] } & Record<string, unknown>
  }
  /** That board arrives from the other device, and the open board adopts it (as the mirror makes it). */
  function arrives(b: Record<string, unknown>) {
    localStorage.setItem(KEY(), JSON.stringify(b))
    store().reloadFromStorage()
  }

  it('FLIPPED ON PURPOSE: an older board of the SAME fight arrives, Next → that turn end is still spent', () => {
    /*
     * This leg used to say the opposite (“a board loaded from storage starts with nothing spent”) — and that
     * WAS the refuter's bug: the board below is this fight's own board from before the Next, exactly what
     * the GM's other device hands back. Taken === ['Probe Wren', 'Probe Wren'] for one real turn end.
     * MUTATION (tried 2026-10-14): `_stepsTaken.clear()` in place of `keepFight(p?.fightId ?? '')` (since
     * round 2 `keepFight(p?.fightId ?? '', p?.spentSteps)`) in reloadFromStorage (combatStore.ts) → fails
     * at “the same turn end, again” (expected 2 to be 1).
     * MUTATION (tried 2026-10-14): drop `fightId,` from the persisted board (combatStore.ts's persist
     * subscriber) → fails at “the fight id is saved with the board” (toMatch got undefined), and so does
     * the “rides with the live board only” leg below.
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const preNext = savedBoard()
    expect(preNext.fightId, 'the fight id is saved with the board').toMatch(/^fight-/)
    const h = host()
    try {
      store().nextTurn()                        // the PC's round-1 turn end, taken
      expect(h.taken()).toBe(1)
      arrives(preNext)                          // the other device's board, from before that Next
      expect(store().combatants[store().activeIndex].name, 'the PC’s turn again').toBe(PC)
      expect(valueOf(PC, 'frightened')).toBe(2)
      store().nextTurn()                        // the same turn end, again
      expect(h.taken(), 'the same turn end, again').toBe(1)
      expect(valueOf(PC, 'frightened')).toBe(2)
      // Their NEXT turn end is a new one, and steps as always.
      store().nextTurn()
      store().nextTurn()
      expect(valueOf(PC, 'frightened')).toBe(1)
      expect(h.taken()).toBe(2)
    } finally { h.off() }
  })

  it('a board of a DIFFERENT fight (the other device started a new one) steps its turn ends as always', () => {
    /*
     * MUTATION (tried 2026-10-14): drop `keepFight(p?.fightId ?? '')` from reloadFromStorage (combatStore.ts)
     * → fails at “the other fight’s turn end” (expected 2 to be 1): the loaded board's turns were counted
     * as the old fight's.
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const preNext = savedBoard()
    const h = host()
    try {
      store().nextTurn()                        // this fight's round-1 turn end, taken
      expect(h.taken()).toBe(1)
      arrives({ ...preNext, fightId: 'fight-started-on-the-other-device' })
      store().nextTurn()                        // the other fight's round-1 turn end
      expect(valueOf(PC, 'frightened'), 'the other fight’s turn end').toBe(1)
      expect(h.taken()).toBe(2)
    } finally { h.off() }
  })

  it('a board with no fight id (saved before 2026-10-14) loads with nothing spent, as every load did', () => {
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const { fightId: _old, ...preNext } = savedBoard()
    void _old
    const h = host()
    try {
      store().nextTurn()
      expect(h.taken()).toBe(1)
      arrives(preNext)
      store().nextTurn()
      expect(valueOf(PC, 'frightened'), 'stepped, as before fight ids').toBe(1)
      expect(h.taken()).toBe(2)
    } finally { h.off() }
  })

  it('a board whose fight id no build makes (a `|` in it) loads as one with no fight id: Next steps, and the next save names no fight', () => {
    /*
     * A spent-step key splits on `|` (`fight|owner|phase|round`), so only an id `freshFightId` could have
     * made names a fight (isFightId); a hand-edited or foreign value is no id, and the spent steps that
     * board lists go with it (they belong to its fight). Here they name this very turn end.
     * MUTATION (tried 2026-10-14): `false` in place of `!isFightId(parsed.fightId)` in
     * loadPersistedCombat (combatStore.ts) → fails at “no fight: the turn end steps” (expected 2 to be 1).
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const preNext = savedBoard()
    const h = host()
    try {
      arrives({ ...preNext, fightId: 'bad|id', spentSteps: ['c:char-tamsin|end|1'] })
      expect(acting(), 'the PC’s turn').toBe(PC)
      store().nextTurn()                        // the PC's round-1 turn end
      expect(valueOf(PC, 'frightened'), 'no fight: the turn end steps').toBe(1)
      expect(h.taken()).toBe(1)
      const next = savedBoard()
      expect(next.fightId, 'the next save names no fight').toBeUndefined()
      expect(next.spentSteps, 'nor any spent steps').toBeUndefined()
    } finally { h.off() }
  })

  it('an OLD board already in a fight (no fight id, no Start on this build): its step does not outlive the next id-less load', () => {
    /*
     * The leg above takes its step under a fight this build started, so the load lets it go either way.
     * Here the open fight itself is an old one: the step is spent under NO fight, and only keepFight's
     * “no fight id → clear everything” lets it go (the G3 refuter, 2026-10-14, round 2: that branch had no
     * guard).
     * MUTATION (tried 2026-10-14): drop `if (!fight) { _stepsTaken.clear(); return }` from keepFight
     * (combatStore.ts) → fails at “an old board’s load, as before” (expected 2 to be 1).
     */
    // A player of its own, so no step another leg spent under no fight can stand in for this one's.
    const OLD = 'Probe Fenwick'
    useCombatStore.setState({
      combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
      turns: [], canUndo: false, canRedo: false, savedSignature: null,
    } as never)
    store().addCombatant(null, { name: OLD, isPC: true, maxHP: 30, charId: 'char-probe-fenwick' })
    store().addCombatant(null, { name: MONSTER, maxHP: 20 })
    store().setInitiative(rowOf(OLD).id, 20)
    store().setInitiative(rowOf(MONSTER).id, 10)
    give(OLD, 'frightened', 2)
    store().startCombat()
    const { fightId: _id, ...oldBoard } = savedBoard()   // a board in a fight, saved before fight ids
    void _id
    arrives(oldBoard)                                    // the app opens on it: no Start here
    expect(store().inCombat).toBe(true)
    expect(acting()).toBe(OLD)
    const h = host()
    try {
      store().nextTurn()                                 // their turn end, taken under no fight
      expect(h.taken()).toBe(1)
      expect(valueOf(OLD, 'frightened')).toBe(1)
      expect(savedBoard().fightId, 'still a board with no fight id').toBeUndefined()
      arrives(oldBoard)
      store().nextTurn()
      expect(valueOf(OLD, 'frightened'), 'an old board’s load, as before').toBe(1)
      expect(h.taken()).toBe(2)
    } finally { h.off() }
  })

  /*
   * WHOSE STEP IT IS — THE PLAYER'S, NEVER THE ROW'S (the G3 refuter, 2026-10-14, round 2). Row ids come
   * from a counter a load resets to the loaded board's, and the GM's other device hands them out too. Once a
   * load KEEPS the spent steps, a row added after an older board of the same fight arrived could get the id
   * of a row whose step was spent — and a DIFFERENT player's turn end was skipped (Synth Quill handed Probe
   * Wren's old `cmb-N`, Frightened stuck at 2). The record is keyed by the player now (`stepOwner`).
   */
  function monsterOnlyFight() {
    useCombatStore.setState({
      combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
      turns: [], canUndo: false, canRedo: false, savedSignature: null,
    } as never)
    store().addCombatant(null, { name: MONSTER, maxHP: 20 })
    store().setInitiative(rowOf(MONSTER).id, 20)
    store().startCombat()
  }
  function joins(name: string, ids: { charId?: string }) {
    store().addCombatant(null, { name, isPC: true, maxHP: 30, ...ids })
    store().setInitiative(rowOf(name).id, 10)
    give(name, 'frightened', 2)
  }
  for (const [label, wren, quill] of [
    ['each with a character id', { charId: 'char-probe-wren' }, { charId: 'char-synth-quill' }],
    ['typed in by hand, with no ids at all', {}, {}],
  ] as const) {
    it(`a different player handed a spent row’s id still steps their own turn end — ${label}`, () => {
      /*
       * MUTATION (tried 2026-10-14): `${_fight}|${c.id}|…` in stepKey in place of `stepOwner(c)`
       * (combatStore.ts) → both legs fail at “Quill’s own turn end” (expected 2 to be 1).
       * MUTATION (tried 2026-10-14): `return \`r:${c.id}\`` in place of stepOwner's name line → the
       * no-ids leg fails the same way.
       */
      monsterOnlyFight()
      const stale = savedBoard()                // this fight's board before anyone joined: a lower id counter
      joins('Probe Wren', wren)
      const wrenId = rowOf('Probe Wren').id
      const h = host()
      try {
        store().nextTurn()                      // Bog Strider's turn ends, Wren's starts
        store().nextTurn()                      // Wren's round-1 turn end: 2 → 1, taken
        expect(valueOf('Probe Wren', 'frightened')).toBe(1)
        expect(h.taken()).toBe(1)
        arrives(stale)                          // the older board of the SAME fight
        joins('Synth Quill', quill)              // (setting Quill's Frightened is a gesture of its own)
        expect(rowOf('Synth Quill').id, 'fixture: Quill is handed Wren’s old row id').toBe(wrenId)
        const before = h.taken()
        store().nextTurn()                      // Quill's turn starts
        store().nextTurn()                      // Quill's round-1 turn end
        expect(valueOf('Synth Quill', 'frightened'), 'Quill’s own turn end').toBe(1)
        expect(h.taken() - before, 'their step went out').toBe(1)
      } finally { h.off() }
    })
  }

  it('a monster that shares a spent player’s name is never spent: only a player’s turn is', () => {
    /*
     * Keyed by name for a player with no ids, so the record must never answer for a MONSTER of that name.
     * MUTATION (tried 2026-10-14): drop `!!c.isPC &&` from stepTaken (combatStore.ts) → fails at “the
     * monster’s turn end” (expected 2 to be 1).
     */
    monsterOnlyFight()
    const stale = savedBoard()
    joins('Probe Wren', {})
    const h = host()
    try {
      store().nextTurn()
      store().nextTurn()                        // Wren's round-1 turn end, taken (keyed by the name)
      expect(h.taken()).toBe(1)
      arrives(stale)
      store().addCombatant(null, { name: 'Probe Wren', maxHP: 12 })   // a monster called that
      store().setInitiative(rowOf('Probe Wren').id, 10)
      give('Probe Wren', 'frightened', 2)
      store().nextTurn()
      store().nextTurn()                        // the monster's round-1 turn end
      expect(valueOf('Probe Wren', 'frightened'), 'the monster’s turn end').toBe(1)
    } finally { h.off() }
  })

  /*
   * THE SPENT STEPS RIDE WITH THE BOARD (the G3 refuter, 2026-10-14, round 2). They were memory on the device
   * that took them: an Undo there, mirrored to his other device, and Next on THAT device stepped the turn end
   * a second time; a restart, or a campaign switch away and back, forgot them as well.
   */
  it('the board saved after an Undo carries the spent step: a device that never took it does not step it again', () => {
    /*
     * MUTATION (tried 2026-10-14): drop `adoptSpent(fight, spent)` from keepFight (combatStore.ts) → fails at
     * “the other device’s Next” (expected 2 to be 1).
     * MUTATION (tried 2026-10-14): drop `spentSteps: spentOf(fightId ?? ''),` from the persist subscriber →
     * fails at “the step rides with the board”.
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const h = host()
    try {
      store().nextTurn()                        // the PC's round-1 turn end, taken here
      expect(h.taken()).toBe(1)
      store().undo()                            // …and Undo: the board back on their turn
      const undone = savedBoard()               // what the mirror carries to his other device
      expect(undone.spentSteps, 'the step rides with the board').toEqual(['c:char-tamsin|end|1'])
      // His other device has nothing of this fight spent: be it, by holding another fight's board first…
      arrives({ ...undone, fightId: 'fight-held-on-the-other-device', spentSteps: undefined })
      arrives(undone)                           // …then the mirror hands it this one
      expect(acting()).toBe(PC)
      expect(valueOf(PC, 'frightened')).toBe(2)
      store().nextTurn()                        // Next, on the other device
      expect(h.taken(), 'the other device’s Next').toBe(1)
      expect(valueOf(PC, 'frightened')).toBe(2)
    } finally { h.off() }
  })

  it('a campaign switch away and back keeps the fight’s spent steps: they come back with its board', () => {
    /*
     * The disclosed risk of round 1 (the G3 refuter, 2026-10-14): A, then B, then A dropped A's spent steps,
     * and an older board of A from his other device then stepped a turn end again.
     * MUTATION (tried 2026-10-14): drop `spentSteps: spentOf(fightId ?? ''),` from the persist subscriber
     * (combatStore.ts) → fails at “back in campaign A” (expected 2 to be 1).
     */
    store().setScope('synth-camp-a')
    try {
      board(true)
      give(PC, 'frightened', 2)
      store().startCombat()
      const preNext = savedBoard()
      const h = host()
      try {
        store().nextTurn()                      // taken, in campaign A
        expect(h.taken()).toBe(1)
        store().setScope('synth-camp-b')        // another campaign: a load with no fight
        store().setScope('synth-camp-a')        // …and back
        expect(valueOf(PC, 'frightened')).toBe(1)
        arrives(preNext)                        // then A's pre-Next board from his other device
        store().nextTurn()
        expect(h.taken(), 'back in campaign A').toBe(1)
        expect(valueOf(PC, 'frightened')).toBe(2)
      } finally { h.off() }
    } finally { store().setScope(null) }
  })

  it('a restart keeps the saved fight’s spent steps', async () => {
    /*
     * MUTATION (tried 2026-10-14): drop the module-level `adoptSpent(_fight, _persisted?.spentSteps)`
     * (combatStore.ts) → fails at “after a restart” (expected 1 to be 0).
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const preNext = savedBoard()
    const h = host()
    try {
      store().nextTurn()                        // taken
      expect(h.taken()).toBe(1)
      flushPersist()
    } finally { h.off() }
    vi.resetModules()
    const fresh = await import('./combatStore')  // the app, started again on the saved board
    const st = () => fresh.useCombatStore.getState()
    const fright = () => st().combatants.find(c => c.name === PC)?.conditions.find(c => c.name === 'frightened')?.value
    let taken = 0
    const off = fresh.useCombatStore.subscribe(s => {
      for (const c of s.combatants) if (c.isPC && fresh.takeVitalsGesture(c.id)) taken++
    })
    try {
      expect(fright(), 'the restarted app shows the saved board').toBe(1)
      localStorage.setItem(KEY(), JSON.stringify(preNext))
      st().reloadFromStorage()                  // the older board of the same fight from his other device
      st().nextTurn()
      expect(taken, 'after a restart').toBe(0)
      expect(fright()).toBe(2)
    } finally {
      off()
      fresh.cancelPersist()                     // the restarted copy's own pending save goes nowhere
    }
  })

  it('a step the host handed BACK is stepped again when an older board of the same fight brings the turn back', () => {
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const preNext = savedBoard()
    const keys: string[] = []
    const off = useCombatStore.subscribe(s => {
      for (const c of s.combatants) if (c.isPC) takeVitalsGesture(c.id, keys)
    })
    try {
      store().nextTurn()
      expect(keys).toHaveLength(1)
      releaseSteps(keys)                        // it never reached the player's sheet
      arrives(preNext)
      store().nextTurn()
      expect(valueOf(PC, 'frightened'), 'handed back: stepped again').toBe(1)
    } finally { off() }
  })

  it('KNOWN GAP (pinned 2026-10-14): a step handed back comes back as spent through his other device’s next save — that turn end is not stepped again', async () => {
    /*
     * releaseSteps lets go of a step on THIS device only. A board saved before the hand-back still lists
     * it; once the mirror has carried that board to the GM's other device, that device holds the step
     * spent too (keepFight keeps a fight's steps across the next board of it that device adopts) and
     * lists it again on its own next save. This device adopts that board, and the step is spent here
     * again: when the Undo has brought that turn round, the player misses that one condition step. It
     * needs the sheet offline, an Undo and both GM devices at once; nothing is overwritten, and the GM
     * steps the condition by hand (combatStore's SPENT STEPS, src/integration/README.md).
     * This leg pins TODAY's behaviour, so a change to it is deliberate: a fix (say, a list of handed-back
     * steps that travels with the board) turns it red and must flip it on purpose. Not built (2026-10-14).
     * His other device is a second copy of the store module (as the restart leg makes one), sharing the
     * saved board the way the mirror shares it.
     */
    board(true)
    give(PC, 'frightened', 2)
    store().startCombat()
    const keys: string[] = []
    const off = useCombatStore.subscribe(s => {
      for (const c of s.combatants) if (c.isPC) takeVitalsGesture(c.id, keys)
    })
    try {
      store().nextTurn()                        // the PC's round-1 turn end, taken here (owed: their sheet offline)
      expect(keys).toHaveLength(1)
      expect(savedBoard().spentSteps, 'fixture: the step rides with the board').toEqual(['c:char-tamsin|end|1'])
      vi.resetModules()
      const other = await import('./combatStore')   // his other device, opened on that board: the step spent there
      const otherStore = () => other.useCombatStore.getState()
      try {
        store().undo()                          // Undo here takes the owed step off the row…
        releaseSteps(keys)                      // …so the seam hands it back
        expect(savedBoard().spentSteps, 'handed back: this device lists it no more').toBeUndefined()
        otherStore().reloadFromStorage()        // the mirror carries the undone board there (the same fight)
        otherStore().applyDamage(otherStore().combatants.find(c => c.name === MONSTER)!.id, 1)   // any edit there
        other.flushPersist()                    // …and its save
        const theirs = JSON.parse(localStorage.getItem(KEY())!) as { spentSteps?: string[] }
        expect(theirs.spentSteps, 'his other device lists the step again').toEqual(['c:char-tamsin|end|1'])
      } finally {
        other.cancelPersist()
      }
      store().reloadFromStorage()               // the mirror carries that board back here
      expect(acting(), 'the PC’s turn again').toBe(PC)
      expect(valueOf(PC, 'frightened')).toBe(2)
      store().nextTurn()                        // that turn end, again
      expect(valueOf(PC, 'frightened'), 'KNOWN GAP: the handed-back step is spent again — not stepped').toBe(2)
      expect(keys, 'KNOWN GAP: no step went out').toHaveLength(1)
    } finally { off() }
  })

  it('the fight id rides with the live board only: never in a saved encounter, never in the encounter’s fingerprint', () => {
    board(true)
    store().startCombat()
    const first = savedBoard().fightId
    expect(first).toMatch(/^fight-/)
    store().saveEncounter('Probe Fen ambush')
    expect(store().isEncounterUnchanged(), 'the fingerprint ignores the fight').toBe(true)
    const enc = localStorage.getItem('pf2e-encounters') ?? ''
    expect(enc).toContain('Probe Fen ambush')
    expect(enc, 'a saved encounter carries no fight').not.toContain(first!)
    expect(enc).not.toContain('fightId')
    expect(enc, 'nor the fight’s spent steps').not.toContain('spentSteps')
    store().endCombat()
    store().loadEncounter('Probe Fen ambush', new Map())
    store().startCombat()                       // the loaded encounter's fight is a new one
    const second = savedBoard().fightId
    expect(second).toMatch(/^fight-/)
    expect(second).not.toBe(first)
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
