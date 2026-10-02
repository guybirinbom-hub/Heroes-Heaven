// tracker 2026-10-01: store — GM vitals gestures
//
// Heroes Heaven's campaign seam (src/integration/pcSheetTruth.ts) publishes a PC row to the player's
// own sheet ONLY when the combat store says the GM did something to that row's vitals. These pin the
// store's half of that contract: which actions are gestures, that a gesture is takeable once and only
// while its own action dispatches, and that nothing which REPLACES rows — Undo and Redo included —
// ever carries one. The seam's half (what it pushes, and what it never pushes) is
// test/bug-tracker-seam-never-overwrite.test.tsx.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCombatStore, takeVitalsGesture, flushPersist, scopeKey, invalidateEncounterCache } from './combatStore'

function resetCombat() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}
const store = () => useCombatStore.getState()
const rowOf = (name: string) => store().combatants.find(c => c.name === name)

/**
 * How many gestures a host subscriber would TAKE for `name`'s row while `act` runs — exactly the shape
 * of the seam: a store subscriber that asks once per dispatch it is called for.
 */
function takenDuring(name: string, act: () => void): number {
  let taken = 0
  const unsub = useCombatStore.subscribe(s => {
    const c = s.combatants.find(x => x.name === name)
    if (c && takeVitalsGesture(c.id)) taken++
  })
  try { act() } finally { unsub() }
  return taken
}

const PC = 'Wren Halloway'      // synthetic
const MONSTER = 'Cave Lurker'   // synthetic

describe('GM vitals gestures', () => {
  beforeEach(() => {
    resetCombat()
    localStorage.clear()
    store().addCombatant(null, { name: PC, isPC: true, maxHP: 30, charId: 'char-wren' })
    store().addCombatant(null, { name: MONSTER, maxHP: 20 })
  })
  afterEach(() => { localStorage.clear() })

  // [label, setup (runs unwatched), the ONE GM action under test]. Removing `markGesture(c)` from
  // that action's recipe in combatStore.ts fails its row — the setup's own gestures are made outside
  // the watch, so they cannot stand in for it.
  const pcId = () => rowOf(PC)!.id
  const condId = () => rowOf(PC)!.conditions[0].id
  const frightened = () => store().addCondition(pcId(), { name: 'frightened', value: 1, isPermanent: false })
  const gm: [string, () => void, () => void][] = [
    ['applyDamage', () => undefined, () => store().applyDamage(pcId(), 4)],
    ['applyHealing', () => store().applyDamage(pcId(), 4), () => store().applyHealing(pcId(), 2)],
    ['setTempHP', () => undefined, () => store().setTempHP(pcId(), 5)],
    ['setDefeated (Mark defeated)', () => undefined, () => store().setDefeated(pcId(), true)],
    ['setDefeated (Restore)', () => store().setDefeated(pcId(), true), () => store().setDefeated(pcId(), false)],
    ['setMaxHP', () => undefined, () => store().setMaxHP(pcId(), 20)],
    ['addCondition', () => undefined, frightened],
    ['removeCondition', frightened, () => store().removeCondition(pcId(), condId())],
    ['updateConditionValue', frightened, () => store().updateConditionValue(pcId(), condId(), 3)],
    ['updateConditionDuration', frightened, () => store().updateConditionDuration(pcId(), condId(), 2)],
  ]

  for (const [label, setup, act] of gm) {
    it(`${label} on a PC row is a gesture, handed out once`, () => {
      setup()
      expect(takenDuring(PC, act)).toBe(1)
    })
  }

  it('is handed out ONCE: a second ask inside the same dispatch gets nothing', () => {
    // MUTATION: make takeVitalsGesture answer `_gesture.has(id)` instead of `_gesture.delete(id)` and
    // this fails — expected [ true, true ] to deeply equal [ true, false ].
    const asks: boolean[] = []
    const unsub = useCombatStore.subscribe(s => {
      const c = s.combatants.find(x => x.name === PC)!
      asks.push(takeVitalsGesture(c.id), takeVitalsGesture(c.id))
    })
    try { store().applyDamage(rowOf(PC)!.id, 3) } finally { unsub() }
    expect(asks).toEqual([true, false])
  })

  it('does not outlive its own dispatch — an untaken gesture is gone once the action returns', () => {
    // MUTATION: drop the `finally { _gesture = outer }` from asGesture (combatStore.ts) and this
    // fails — expected true to be false — and so do the reloadFromStorage, setScope and turn engine
    // legs below: a later, unrelated dispatch hands the old damage out as a gesture.
    store().applyDamage(rowOf(PC)!.id, 3)              // nobody subscribed: nobody took it
    expect(takeVitalsGesture(rowOf(PC)!.id)).toBe(false)
    expect(takenDuring(PC, () => store().addCombatant(null, { name: 'Torchbearer' }))).toBe(0)
  })

  it('never marks a monster row — only PC rows mirror onto a sheet', () => {
    // MUTATION: drop `c?.isPC &&` from markGesture and this fails — expected 1 to be +0.
    expect(takenDuring(MONSTER, () => store().applyDamage(rowOf(MONSTER)!.id, 5))).toBe(0)
  })

  // Nothing that REPLACES or re-derives a row is the GM editing the player. Each of these was a way
  // a stale or fresh full-HP row reached a player's sheet while the seam pushed on any difference.
  // [label, setup (runs unwatched — a GM gesture made here must not leak into the act), act]
  const notGestures: [string, () => void, () => void][] = [
    // Undo and Redo never push (the seam's rule A): putting an older board back is a load. MUTATION:
    // wrap undo's `set(…)` in `asGesture(() => …)` with `for (const c of prev.combatants) markGesture(c)`
    // inside, as round 5 had it, and this fails — expected [ true ] to deeply equal [] — with the
    // seam's leg (2) in test/bug-tracker-seam-never-overwrite.test.tsx.
    ['Undo, then Redo', () => store().applyDamage(rowOf(PC)!.id, 6), () => { store().undo(); store().redo() }],
    ['addCombatant (Remove, then re-add)', () => store().removeCombatant(rowOf(PC)!.id),
      () => store().addCombatant(null, { name: PC, isPC: true, maxHP: 30, charId: 'char-wren' })],
    ['clearAllCombatants, then re-add', () => store().applyDamage(rowOf(PC)!.id, 5),
      () => { store().clearAllCombatants(); store().addCombatant(null, { name: PC, isPC: true, maxHP: 30 }) }],
    ['removeCombatant', () => undefined, () => store().removeCombatant(rowOf(MONSTER)!.id)],
    ['loadEncounter', () => { invalidateEncounterCache(); store().saveEncounter('Gesture test'); store().applyDamage(rowOf(PC)!.id, 5) },
      () => store().loadEncounter('Gesture test', new Map())],
    ['reloadFromStorage (a board from the GM’s other device)', () => { store().applyDamage(rowOf(PC)!.id, 9); flushPersist() },
      () => store().reloadFromStorage()],
    ['setScope', () => store().applyDamage(rowOf(PC)!.id, 1),
      () => { store().setScope('camp-gesture'); store().setScope(null) }],
    ['setPcMaxHP (the party bridge)', () => undefined, () => store().setPcMaxHP(PC, 40)],
    ['startCombat / nextTurn (the turn engine)', () => store().addCondition(rowOf(PC)!.id, { name: 'frightened', value: 2, isPermanent: false }),
      () => { store().startCombat(); store().nextTurn(); store().nextTurn() }],
    ['renameCombatant', () => undefined, () => store().renameCombatant(rowOf(PC)!.id, 'Wren the Bold')],
  ]

  for (const [label, setup, act] of notGestures) {
    it(`${label} is NOT a gesture`, () => {
      setup()
      const taken: boolean[] = []
      const unsub = useCombatStore.subscribe(s => {
        for (const c of s.combatants) if (takeVitalsGesture(c.id)) taken.push(true)
      })
      try { act() } finally { unsub() }
      expect(taken).toEqual([])
    })
  }

  it('Next Turn is on the Undo timeline — which is why an Undo can predate a player’s own change', () => {
    // MUTATION (tried 2026-10-01, round 7): drop `record(s)` from nextTurn (combatStore.ts) and this
    // fails — expected false to be true. The doc on `undo` said turn navigation was not part of the
    // history; Next Turn is, and the seam's leg (2) is the door that opens.
    const before = store().activeIndex
    store().nextTurn()
    expect(store().canUndo, 'a turn advance can be undone').toBe(true)
    store().undo()
    expect(store().activeIndex).toBe(before)
  })

  it('nothing about a gesture reaches the persisted board', () => {
    store().applyDamage(rowOf(PC)!.id, 2)
    store().addCondition(rowOf(PC)!.id, { name: 'frightened', value: 2, isPermanent: false })
    flushPersist()
    const raw = localStorage.getItem(scopeKey('pf2e-current-combat')) ?? ''
    expect(raw).toContain(PC)
    expect(raw.toLowerCase()).not.toContain('gesture')
  })
})
