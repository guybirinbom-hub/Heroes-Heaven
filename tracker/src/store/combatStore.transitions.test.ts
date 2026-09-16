// tracker 2026-09-15: store
//
// The combat store's state transitions — campaign scoping, condition durations, the printed
// condition table, and the turn-engine actions the 2026-09-15 review found untested.
//
// Every condition row below quotes the Player Core (remaster) sentence it encodes, fetched from the
// live Archives rather than recalled: the rows that were wrong were wrong because they carried an
// older printing's wording or a play-aid's shorthand instead of the sentence on the page.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useCombatStore } from './combatStore'
import { InitiativeTracker } from '../components/InitiativeTracker'
import { useLayoutStore, useGmLayoutStore } from './layoutStore'
import { computeConditionMods } from '../utils/conditionEffects'
import type { AppliedCondition, Creature } from '../types/pf2e'

type AnyCombatant = ReturnType<typeof useCombatStore.getState>['combatants'][number]

function resetCombat() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}
function names() { return useCombatStore.getState().combatants.map(c => c.name) }
function add(name: string, opts: Record<string, unknown> = {}) {
  useCombatStore.getState().addCombatant(null, { name, ...opts })
}
function idOf(name: string) { return useCombatStore.getState().combatants.find(c => c.name === name)!.id }
function activeName() {
  const s = useCombatStore.getState()
  return s.combatants[s.activeIndex]?.name
}
function condOn(name: string): AppliedCondition[] {
  return useCombatStore.getState().combatants.find(c => c.name === name)!.conditions
}
function durOn(name: string): number | undefined {
  return condOn(name)[0]?.duration
}
// Just enough of a stat block to make a combatant count as a MONSTER for initSort's tie rule
// (`!isPC && !!creature`); every other field is unread by these tests.
const STUB_CREATURE = { name: 'stub', defenses: { hp: 20 } } as unknown as Creature

// ───────────────────────────────────────────────────────────────────────────
// 1. Campaign scope — combat and the GM board are per-campaign, not global
// ───────────────────────────────────────────────────────────────────────────
describe('setScope', () => {
  beforeEach(() => { resetCombat(); localStorage.clear() })
  afterEach(() => { useCombatStore.getState().setScope(null); localStorage.clear() })

  it('persists the outgoing campaign, loads the incoming one, and brings the first one back intact', () => {
    useCombatStore.getState().setScope('camp-a')
    add('Goblin Boss'); add('Hero', { isPC: true, maxHP: 30 })
    useCombatStore.getState().applyDamage(idOf('Goblin Boss'), 0)  // any mutation → a persist is queued

    useCombatStore.getState().setScope('camp-b')
    // The outgoing campaign was flushed under ITS OWN key before the switch — never lose a snapshot.
    expect(localStorage.getItem('pf2e-current-combat:camp-a') ?? '').toContain('Goblin Boss')
    expect(names()).toEqual([])                                     // campaign B starts empty

    add('Ogre')
    useCombatStore.getState().setScope('camp-a')
    expect(names()).toEqual(['Goblin Boss', 'Hero'])                // A came back untouched
    expect(localStorage.getItem('pf2e-current-combat:camp-b') ?? '').toContain('Ogre')

    useCombatStore.getState().setScope('camp-b')
    expect(names()).toEqual(['Ogre'])                               // and so does B
  })

  it('a null scope is the standalone tracker: the bare key, and nothing of a campaign leaks into it', () => {
    useCombatStore.getState().setScope(null)
    add('Standalone Goblin')
    useCombatStore.getState().setScope('camp-a')
    expect(names()).toEqual([])
    expect(localStorage.getItem('pf2e-current-combat')).toContain('Standalone Goblin')
    expect(localStorage.getItem('pf2e-current-combat:camp-a') ?? '').not.toContain('Standalone Goblin')

    useCombatStore.getState().setScope(null)
    expect(names()).toEqual(['Standalone Goblin'])
  })

  it('resets undo/redo and resumes the id counters from the incoming snapshot', () => {
    useCombatStore.getState().setScope('camp-a')
    add('A'); add('B')
    useCombatStore.getState().removeCombatant(idOf('B'))            // records an undo step
    expect(useCombatStore.getState().canUndo).toBe(true)

    useCombatStore.getState().setScope('camp-b')
    expect(useCombatStore.getState().canUndo).toBe(false)           // A's history must not apply to B
    expect(useCombatStore.getState().canRedo).toBe(false)

    // Ids resumed from the restored snapshot: a newly added combatant can't collide with a restored one.
    useCombatStore.getState().setScope('camp-a')
    const restored = useCombatStore.getState().combatants.map(c => c.id)
    add('C')
    const all = useCombatStore.getState().combatants.map(c => c.id)
    expect(new Set(all).size).toBe(all.length)
    expect(all.slice(0, restored.length)).toEqual(restored)
  })

  it('reloadFromStorage adopts a board another GM device wrote under the CURRENT key', () => {
    // The GM-device mirror (src/data/trackerSync.ts) writes the newer board into localStorage and then
    // asks the store to catch up — without a scope change, which setScope refuses to do for the key
    // it is already on.
    useCombatStore.getState().setScope('camp-a')
    add('Goblin Boss')
    useCombatStore.getState().removeCombatant(idOf('Goblin Boss'))  // leaves an undo step behind
    add('Goblin Boss')
    expect(useCombatStore.getState().canUndo).toBe(true)

    localStorage.setItem('pf2e-current-combat:camp-a', JSON.stringify({
      combatants: [{ id: 'cmb-99', name: 'From The Other Device', conditions: [], currentHP: 10, maxHP: 10, tempHP: 0 }],
      round: 3, activeIndex: 0, inCombat: true, selectedId: null, cidCounter: 99, condCounter: 0,
    }))
    useCombatStore.getState().reloadFromStorage()

    expect(names()).toEqual(['From The Other Device'])
    expect(useCombatStore.getState().round).toBe(3)
    // Same cost as a scope load: the incoming board is not a state this device edited its way into,
    // so undoing into the board it replaced would be undoing someone else's fight.
    expect(useCombatStore.getState().canUndo).toBe(false)
    add('Mine')                                                     // ids resume past the adopted board
    expect(useCombatStore.getState().combatants.map(c => c.id)).toEqual(['cmb-99', 'cmb-100'])
  })

  it('one setScope call also re-keys the GM layout store', () => {
    useCombatStore.getState().setScope('camp-a')
    add('Goblin Boss')
    useGmLayoutStore.getState().open(idOf('Goblin Boss'))
    expect(localStorage.getItem('pf2e-gm-layout:camp-a')).toContain(idOf('Goblin Boss'))

    useCombatStore.getState().setScope('camp-b')
    expect(useGmLayoutStore.getState().root).toBeNull()             // campaign B's GM screen is its own
    expect(localStorage.getItem('pf2e-gm-layout:camp-a')).toBeTruthy()
  })

  it('and clears the COMBAT pane tree, which is session-only but keyed by ids that restart per scope', () => {
    // Combatant ids restart from the incoming snapshot's cidCounter, so a pane left open on cmb-1 in
    // campaign A would show campaign B's cmb-1 — a different creature under the same id, which
    // reconcile() can't prune (the id is valid in B).
    // MUTATION (layoutStore.ts: onScopeChange registration moved back inside `if (persistKey)`):
    //   FAILS at line 126 — "expected { id: 'leaf2', kind: 'leaf', … tabs: [ cmb-1 ] } to be null"
    //   (campaign B's board is empty, and the pane is still showing A's cmb-1).
    useCombatStore.getState().setScope('camp-a')
    add('Goblin Boss')
    useLayoutStore.getState().open(idOf('Goblin Boss'))
    expect(useLayoutStore.getState().root).not.toBeNull()

    useCombatStore.getState().setScope('camp-b')
    expect(useLayoutStore.getState().root).toBeNull()
    expect(useLayoutStore.getState().hoveredLeaf).toBeNull()
    expect(useLayoutStore.getState().hoveredCid).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. Condition durations — Player Core p. 426, "Duration"
//
//    "For an effect that lasts a number of rounds, the remaining duration decreases by 1 at the
//     start of each turn of the creature that created the effect. Detrimental effects often last
//     'until the end of the target's next turn' … which means that the effect's duration decreases
//     at the end of the creature's turn, rather than the start."
//
//    MEASURED BEFORE THE FIX (scratch run, Wizard init 20 / Goblin init 10): the tracker ticked
//    EVERY duration at the end of the AFFECTED creature's turn and had no notion of a source. A
//    2-round condition applied to the goblin during the goblin's own turn read 2r → 1r the instant
//    that same turn ended, leaving exactly one further goblin turn — the owner's "it actually only
//    lasts one round". A condition on a creature that never gets a turn (downed, delayed, skipped)
//    never ticked at all.
// ───────────────────────────────────────────────────────────────────────────
describe('condition durations tick on the SOURCE\'s turn', () => {
  beforeEach(resetCombat)

  function twoCreatureFight() {
    add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 10 })
    useCombatStore.getState().startCombat()
  }

  it('the owner\'s 2-round example: the clock runs on the wizard\'s turns, not the goblin\'s turn-ends', () => {
    twoCreatureFight()
    expect(activeName()).toBe('Wizard')
    // The wizard hits the goblin with a 2-round effect on the wizard's own turn.
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 2, source: idOf('Wizard'), isPermanent: false,
    })

    useCombatStore.getState().nextTurn()              // → Goblin, round 1
    expect(activeName()).toBe('Goblin')
    expect(durOn('Goblin')).toBe(2)                   // BEFORE: the goblin's own turn-end would tick it

    useCombatStore.getState().nextTurn()              // → Wizard, round 2 — the source's turn STARTS
    expect(useCombatStore.getState().round).toBe(2)
    expect(durOn('Goblin')).toBe(1)

    useCombatStore.getState().nextTurn()              // → Goblin, round 2: still slowed
    expect(activeName()).toBe('Goblin')
    expect(durOn('Goblin')).toBe(1)

    useCombatStore.getState().nextTurn()              // → Wizard, round 3 — elapsed, effect ends
    expect(condOn('Goblin')).toHaveLength(0)
  })

  it('a condition on a creature that never gets a turn still runs out', () => {
    // The pre-fix clock was the TARGET's turn-end, so a downed monster (skipped by nextTurn) wore
    // its 2-round condition for the rest of the session.
    twoCreatureFight()
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 2, source: idOf('Wizard'), isPermanent: false,
    })
    useCombatStore.setState({
      combatants: useCombatStore.getState().combatants.map(c =>
        c.name === 'Goblin' ? { ...c, isDefeated: true } : c) as AnyCombatant[],
    } as never)
    useCombatStore.getState().nextTurn()              // skips the goblin, wraps to the wizard (round 2)
    expect(activeName()).toBe('Wizard')
    expect(durOn('Goblin')).toBe(1)
    useCombatStore.getState().nextTurn()
    expect(condOn('Goblin')).toHaveLength(0)
  })

  it('a SOURCE that is skipped still has an initiative count, so its effects keep ticking', () => {
    add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 10 }); add('Hero', { initiative: 5, isPC: true, maxHP: 20 })
    useCombatStore.getState().startCombat()
    useCombatStore.getState().addCondition(idOf('Hero'), {
      name: 'slowed', value: 1, duration: 2, source: idOf('Goblin'), isPermanent: false,
    })
    // The goblin dies before its turn: its 2-round effect must not freeze on the board.
    useCombatStore.setState({
      combatants: useCombatStore.getState().combatants.map(c =>
        c.name === 'Goblin' ? { ...c, isDefeated: true } : c) as AnyCombatant[],
    } as never)
    useCombatStore.getState().nextTurn()              // Wizard → (skip Goblin) → Hero
    expect(activeName()).toBe('Hero')
    expect(durOn('Hero')).toBe(1)
  })

  it('a condition with NO source keeps the printed "until the end of the target\'s turn" clock', () => {
    // Every pre-scoping saved snapshot is in this shape, and it is the picker's explicit
    // "ends at the end of <name>'s turn" option.
    twoCreatureFight()
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 2, isPermanent: false,
    })
    useCombatStore.getState().nextTurn()              // → Goblin's turn begins
    expect(durOn('Goblin')).toBe(2)
    useCombatStore.getState().nextTurn()              // the goblin's turn ENDS → tick
    expect(durOn('Goblin')).toBe(1)
  })

  it('a source that LEAVES the board hands its effect back to the target\'s turn-end clock', () => {
    // p. 426 puts the clock on "the creature that created the effect" — one that has been removed
    // (Clear Defeated, Remove) has no turns left to give, so without the fallback the effect freezes
    // on the target at its current count for the rest of the session.
    // MUTATION (`!hasSource(s, c)` → `!c.source` at both nextTurn guards):
    //   FAILS at line 238 — "expected 3 to be 2" (the count froze where the wizard left it).
    twoCreatureFight()
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 3, source: idOf('Wizard'), isPermanent: false,
    })
    useCombatStore.getState().removeCombatant(idOf('Wizard'))   // the wizard leaves the board
    useCombatStore.getState().nextTurn()              // the goblin's turn ends → the fallback clock
    expect(durOn('Goblin')).toBe(2)
    useCombatStore.getState().nextTurn()
    expect(durOn('Goblin')).toBe(1)
    useCombatStore.getState().nextTurn()
    expect(condOn('Goblin')).toHaveLength(0)          // and it actually runs out
  })

  it('a source that Delays and returns in the same round ticks its effect exactly once', () => {
    // A creature's initiative count comes up once per round. Delay is an action taken ON your turn,
    // so the advance has already landed on you — and already ticked your effects — before you delay;
    // the landing you get on the way back is the rest of that same turn, not a second count.
    // The delay happens on a ROUND-2 turn deliberately: in round 1 the source's turn is the one
    // startCombat opened, and startCombat credits no count at all, so a round-1 delay has nothing to
    // double and the leg passes whether the guard exists or not.
    // MUTATION (creditCount: `if (!c || c.countedThisRound) return` → `if (!c) return`):
    //   FAILS at line 269 — "expected 1 to be 2" (the wizard's round-2 count credited twice, which
    //   is the 3-round effect down to 1 before the wizard has had two turns).
    twoCreatureFight()                                // Wizard 20, Goblin 10 — the wizard acts first
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 3, source: idOf('Wizard'), isPermanent: false,
    })
    useCombatStore.getState().nextTurn()              // → Goblin, round 1
    useCombatStore.getState().nextTurn()              // → Wizard, round 2: its count ticks here
    expect(useCombatStore.getState().round).toBe(2)
    expect(durOn('Goblin')).toBe(2)

    useCombatStore.getState().delayCombatant(idOf('Wizard'))    // delays on its own turn → turn passes
    expect(activeName()).toBe('Goblin')
    useCombatStore.getState().returnFromDelay(idOf('Wizard'))
    useCombatStore.getState().nextTurn()              // back in, for the rest of its round-2 turn
    expect(activeName()).toBe('Wizard')
    expect(durOn('Goblin')).toBe(2)                   // still exactly one tick for round 2

    useCombatStore.getState().nextTurn()              // → Goblin, round 3
    useCombatStore.getState().nextTurn()              // → Wizard, round 3: a new round, a new count
    expect(useCombatStore.getState().round).toBe(3)
    expect(durOn('Goblin')).toBe(1)                   // and the clock is running again, not stuck
  })

  // FINDING 4 — a Delay that is never taken back used to freeze the source's effects for the rest
  // of the session (the skip loop credited no count, and hasSource() kept the targets off the
  // turn-end clock either way). The print ends a Delay by itself, in the entry this repo ships
  // (public/data/actions.json, "Delay"):
  //   Player Core p. 416, Delay: "If you Delay an entire round without returning to the initiative
  //   order, the actions from the Delayed turn are lost, your initiative doesn't change, and your
  //   next turn occurs at your original position in the initiative order."
  it('a source that Delays and never comes back takes its turn on its own count next round', () => {
    // MUTATION (nextTurn's skip loop: delete the `skipped?.isDelayed && …` auto-return branch):
    //   FAILS at line 300 — "expected 'Goblin' to be 'Wizard'" (the wizard's position came up in
    //   round 3 and the advance stepped straight over it again).
    twoCreatureFight()                                // Wizard 20, Goblin 10
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 3, source: idOf('Wizard'), isPermanent: false,
    })
    useCombatStore.getState().nextTurn()              // → Goblin, round 1
    useCombatStore.getState().nextTurn()              // → Wizard, round 2: 3 → 2
    expect(durOn('Goblin')).toBe(2)

    useCombatStore.getState().delayCombatant(idOf('Wizard'))    // delays on its own turn → turn passes
    expect(activeName()).toBe('Goblin')
    useCombatStore.getState().nextTurn()              // the wizard's position comes up in ROUND 3
    expect(useCombatStore.getState().round).toBe(3)
    expect(activeName()).toBe('Wizard')
    expect(useCombatStore.getState().combatants.find(c => c.name === 'Wizard')!.isDelayed).toBe(false)
    expect(durOn('Goblin')).toBe(1)                   // its next turn, at its own position — one tick

    useCombatStore.getState().nextTurn()              // → Goblin, round 3
    useCombatStore.getState().nextTurn()              // → Wizard, round 4
    expect(condOn('Goblin')).toHaveLength(0)          // and the clock ran out on schedule
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2b. The once-per-round initiative count, at every entry point
//
//     The count is what tickSourceDurations spends (Player Core p. 426), and `countedThisRound` is
//     the record of having spent it. An adversarial re-read of the 2026-09-15 commit found four
//     ways in besides a nextTurn landing — the start of the fight, a step backwards, a load, and a
//     Delay nobody took back — each of which either skipped the credit or handed one out twice.
//     Finding 4 is the test directly above; findings 1, 2, 3 and 5 are here.
// ───────────────────────────────────────────────────────────────────────────
describe('the once-per-round count survives every entry point', () => {
  beforeEach(() => { resetCombat(); localStorage.clear() })
  afterEach(() => { useCombatStore.getState().setScope(null); localStorage.clear() })

  /** Wizard 20 / Goblin 15 / Orc 10, fight started — the wizard acts first. */
  function threeCreatureFight() {
    add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 15 }); add('Orc', { initiative: 10 })
    useCombatStore.getState().startCombat()
  }
  /** A 3-round effect on the orc, created by the wizard. */
  function wizardSlowsTheOrc(duration = 3) {
    useCombatStore.getState().addCondition(idOf('Orc'), {
      name: 'slowed', value: 1, duration, source: idOf('Wizard'), isPermanent: false,
    })
  }
  /** One full cycle of the order (three combatants) — back to the same creature, a round later. */
  function cycle() { for (let i = 0; i < 3; i++) useCombatStore.getState().nextTurn() }
  /** Who has already had their initiative count this round, in order. */
  function flags() {
    return useCombatStore.getState().combatants.map(c => `${c.name}:${!!c.countedThisRound}`).join(' ')
  }

  it('FINDING 1 — startCombat credits the creature it opens on, so a round-1 Delay buys no second tick', () => {
    // startCombat set activeIndex and began that creature's turn without crediting it, leaving the
    // first combatant the one creature with no count in round 1. Delay + return then landed the
    // advance on it a SECOND time inside round 1 and that landing found a free count: a 3-round
    // effect went 3 → 2 in the round it was created, and expired at the start of the wizard's 3rd
    // turn instead of its 4th.
    // MUTATION (startCombat: delete the `creditCount` + `tickSourceDurations` pair):
    //   FAILS at line 360 — "expected 2 to be 3" (the wizard's round-1 count was still on the table
    //   when it came back from the Delay); FINDING 5 below fails with it, at line 510, and so does
    //   the top-skip test that follows, at line 386.
    threeCreatureFight()
    wizardSlowsTheOrc()                               // created on the wizard's own round-1 turn

    useCombatStore.getState().delayCombatant(idOf('Wizard'))    // delays that same turn
    expect(activeName()).toBe('Goblin')
    useCombatStore.getState().returnFromDelay(idOf('Wizard'))   // back in behind the goblin
    useCombatStore.getState().nextTurn()              // lands on the wizard again — still round 1
    expect(activeName()).toBe('Wizard')
    expect(useCombatStore.getState().round).toBe(1)
    expect(durOn('Orc')).toBe(3)                      // round 1's count was spent by startCombat

    cycle(); expect(durOn('Orc')).toBe(2)             // the wizard's 2nd turn
    cycle(); expect(durOn('Orc')).toBe(1)             // its 3rd
    cycle(); expect(condOn('Orc')).toHaveLength(0)    // and it ends at the start of its 4th
  })

  it('FINDING 1, continued — startCombat credits every seat the opening advance steps OVER, and a reload agrees', () => {
    // Crediting only `combatants[activeIndex]` disagreed with loadPersistedCombat, which derives the
    // same flag as `i <= activeIndex`. A defeated NPC sorted ahead of the first actor — a corpse the
    // GM never cleared off the board — kept a free round-1 count on a live board but not on a
    // reloaded one, so a round-duration effect it left behind ran a round long, and HOW long
    // depended on whether the GM had reloaded. Its initiative count comes up like any skipped
    // creature's (nextTurn's skip loop credits exactly that); it just can't act.
    // MUTATION (startCombat: the `for (let i = 0; i <= s.activeIndex; i++) creditCount(…)` loop
    //   back to the single `creditCount(s.combatants[s.activeIndex], counts)`):
    //   FAILS at line 386 — "expected 3 to be 2" (the corpse's round-1 count was never spent, so its
    //   effect still read its full duration once the fight was under way).
    useCombatStore.getState().setScope('camp-topskip')
    add('Corpse', { initiative: 25 }); add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 15 })
    useCombatStore.getState().setDefeated(idOf('Corpse'), true)
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 3, source: idOf('Corpse'), isPermanent: false,
    })
    useCombatStore.getState().startCombat()
    expect(activeName()).toBe('Wizard')                // the corpse is stepped over, as it should be
    expect(durOn('Goblin')).toBe(2)                    // …but its count came up: 3 → 2 in round 1

    const live = flags()
    cycle(); expect(durOn('Goblin')).toBe(1)           // round 2's wrap crosses its count again
    cycle(); expect(condOn('Goblin')).toHaveLength(0)  // and it runs out in round 3, not round 4

    // The same board reloaded from a pre-commit save must read the same flags, or the clock shifts
    // by a round depending on whether the GM reopened the tracker.
    useCombatStore.getState().setScope(null)
    const key = 'pf2e-current-combat:camp-topskip'
    const raw = JSON.parse(localStorage.getItem(key)!) as { combatants: Record<string, unknown>[]; round: number; activeIndex: number }
    raw.round = 1; raw.activeIndex = 1                 // rewind the snapshot to the opening turn
    for (const c of raw.combatants) delete c.countedThisRound
    localStorage.setItem(key, JSON.stringify(raw))
    useCombatStore.getState().setScope('camp-topskip')
    expect(flags()).toBe(live)
  })

  it('FINDING 2 — prevTurn stops at the top of the order instead of un-wrapping the round', () => {
    // prevTurn is not the inverse of nextTurn: it un-ticks no duration and un-credits no count. It
    // used to step 0 → last with `round - 1`, leaving every tick applied, so the re-advance hit the
    // wrap branch again, wiped every flag and re-credited — a second tick inside one round.
    // MUTATION (prevTurn: `if (s.activeIndex === 0) return` → the old
    //   `{ s.activeIndex = s.combatants.length-1; s.round = Math.max(1, s.round-1) }`):
    //   FAILS at line 420 — "expected 'Orc' to be 'Wizard'" (the pointer walked back into round 1;
    //   the re-advance then wraps a second time and re-credits everyone, which is the tick the
    //   assertions below this one hold down).
    threeCreatureFight()
    wizardSlowsTheOrc()
    cycle()                                           // → the wizard's round-2 turn
    expect(useCombatStore.getState().round).toBe(2)
    expect(durOn('Orc')).toBe(2)

    useCombatStore.getState().prevTurn()              // at the top of the order: nothing to step back to
    expect(activeName()).toBe('Wizard')
    expect(useCombatStore.getState().round).toBe(2)
    useCombatStore.getState().nextTurn()              // → Goblin
    expect(durOn('Orc')).toBe(2)

    // Mid-round it still steps back — the clamp is only at the round boundary.
    useCombatStore.getState().prevTurn()
    expect(activeName()).toBe('Wizard')
    useCombatStore.getState().nextTurn()
    expect(activeName()).toBe('Goblin')
    expect(durOn('Orc')).toBe(2)
  })

  it('FINDING 3 — a board saved before the flag existed loads with its spent counts already spent', () => {
    // Every save written before the once-per-round commit has no `countedThisRound` at all, and
    // `undefined` reads as "not counted yet" — so re-opening ANY existing player save mid-fight put
    // a free count back on the table for everyone the order had already passed.
    // MUTATION (loadPersistedCombat: delete the `parsed.combatants.forEach(…)` default):
    //   FAILS at line 463 — "expected 1 to be 2" (the wizard's spent round-2 count came back with
    //   the save, and the Delay cashed it); the reload half of finding 1 above fails with it, at
    //   line 401 — "expected 'Corpse:false Wizard:false Goblin:false' to be
    //   'Corpse:true Wizard:true Goblin:false'".
    useCombatStore.getState().setScope('camp-flagless')
    threeCreatureFight()
    wizardSlowsTheOrc()
    cycle()                                           // → the wizard's round-2 turn, 3 → 2
    expect(durOn('Orc')).toBe(2)
    useCombatStore.getState().setScope(null)          // flushes the board under its own key

    const key = 'pf2e-current-combat:camp-flagless'
    const raw = JSON.parse(localStorage.getItem(key)!) as { combatants: Record<string, unknown>[] }
    for (const c of raw.combatants) delete c.countedThisRound      // a pre-commit save, exactly
    localStorage.setItem(key, JSON.stringify(raw))

    useCombatStore.getState().setScope('camp-flagless')
    expect(activeName()).toBe('Wizard')
    expect(useCombatStore.getState().round).toBe(2)
    expect(durOn('Orc')).toBe(2)

    useCombatStore.getState().delayCombatant(idOf('Wizard'))
    useCombatStore.getState().returnFromDelay(idOf('Wizard'))
    useCombatStore.getState().nextTurn()              // lands on the wizard again, same round
    expect(activeName()).toBe('Wizard')
    expect(durOn('Orc')).toBe(2)
  })

  it('FINDING 3, continued — a reinforcement that joins mid-fight saves the flag it has live', () => {
    // The positional default above is for saves written BEFORE the flag existed. addCombatant wrote
    // no `countedThisRound` key at all (duplicateCombatant always has), JSON drops a missing key,
    // and the default then fired for a creature that joined THIS fight — inventing its count from
    // wherever its initiative happened to sort it. A reinforcement IS a source (the GM applies its
    // aura through the same addCondition the condition panel calls), so the same board reloaded ran
    // that effect a round longer than the live one.
    // MUTATION (addCombatant: drop `countedThisRound: false` from the pushed literal):
    //   FAILS at line 491 — "expected 'Reinforcement:true Wizard:true Goblin:true Orc:false' to be
    //   'Reinforcement:false Wizard:true Goblin:true Orc:false'".
    useCombatStore.getState().setScope('camp-reinforcement')
    threeCreatureFight()                              // Wizard 20 / Goblin 15 / Orc 10
    useCombatStore.getState().nextTurn()              // → the goblin's round-1 turn
    add('Reinforcement', { initiative: 25 })          // pushed on the END of the array…
    useCombatStore.getState().setInitiative(idOf('Reinforcement'), 25)   // …and sorted to the front
    expect(names()[0]).toBe('Reinforcement')          // i.e. BEHIND the pointer
    expect(activeName()).toBe('Goblin')
    useCombatStore.getState().addCondition(idOf('Orc'), {
      name: 'slowed', value: 1, duration: 3, source: idOf('Reinforcement'), isPermanent: false,
    })
    const live = flags()
    expect(live).toContain('Reinforcement:false')     // its count is still on the table

    useCombatStore.getState().setScope(null)          // flush the board under its own key…
    useCombatStore.getState().setScope('camp-reinforcement')   // …and reopen the tracker
    expect(flags()).toBe(live)
    // …so the reloaded board spends that count exactly where the live one does.
    useCombatStore.getState().delayCombatant(idOf('Reinforcement'))
    useCombatStore.getState().returnFromDelay(idOf('Reinforcement'))
    useCombatStore.getState().nextTurn()
    expect(activeName()).toBe('Reinforcement')
    expect(durOn('Orc')).toBe(2)
  })

  it('FINDING 5 — an effect created BEFORE the fight ticks on its source\'s very first turn', () => {
    // Narrow twin of finding 1, same site: startCombat begins a turn, and a turn start is where
    // p. 426 puts the tick. A 1-round effect set up during preparations, whose creator rolls
    // highest, used to survive that first turn and expire a whole turn late.
    add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 15 }); add('Orc', { initiative: 10 })
    useCombatStore.getState().addCondition(idOf('Orc'), {
      name: 'slowed', value: 1, duration: 1, source: idOf('Wizard'), isPermanent: false,
    })
    useCombatStore.getState().startCombat()           // initiative rolled; the wizard acts first
    expect(activeName()).toBe('Wizard')
    expect(condOn('Orc')).toHaveLength(0)             // its one round ran out on that turn
  })

  it('the round turns over as the pointer crosses the top, so a count is never spent against the wrong round', () => {
    // Where findings 1 and 4 meet the wrap. The round used to be bumped (and every flag cleared)
    // AFTER the skip loop, so a creature stepped over past the top of the order was credited against
    // the round it had just left: the wizard took startCombat's round-1 count, was skipped on the
    // wrap as a defeated NPC, and its round-2 count found the round-1 flag still set and was
    // swallowed — its effects froze on the board from round 2 on.
    // MUTATION (nextTurn: `cross(next)` / `cross(stepped)` deleted and the old
    //   `if (wrapped) { s.round += 1; for (…) c.countedThisRound = false }` put back after the loop,
    //   with `wrapped` set from `next === 0` / `stepped === 0` as before):
    //   FAILS at line 530 — "expected 3 to be 2" (the wizard's round-2 count went missing); the
    //   p. 416 auto-return test fails with it at line 300, since it reads the same bumped round.
    threeCreatureFight()
    wizardSlowsTheOrc()
    useCombatStore.getState().setDefeated(idOf('Wizard'), true)   // killed on its own first turn
    cycle()                                           // Goblin, Orc, then the wrap steps over the wizard
    expect(useCombatStore.getState().round).toBe(2)
    expect(activeName()).toBe('Goblin')
    expect(durOn('Orc')).toBe(2)                      // its count came up even though it can't act
    cycle(); expect(durOn('Orc')).toBe(1)
    cycle(); expect(condOn('Orc')).toHaveLength(0)    // and it still runs out on time
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2c. The once-per-round END-of-turn pass
//
//     `countedThisRound` guards the SOURCE clock only. Everything nextTurn does for the creature
//     whose turn is ending — persistent damage, the auto-decrement step (Frightened), the
//     source-less duration tick, the per-round resource refill — had no guard of its own.
//
//     Player Core p. 416, Delay (public/data/actions.json, the entry this repo ships):
//     "When you Delay, any persistent damage or other negative effects that normally occur at the
//      start or end of your turn occur immediately when you use the Delay action."
//
//     delayCombatant hands the turn on through nextTurn, so that pass IS the "occur immediately",
//     and the print then offers the way back "as a free action triggered by the end of any other
//     creature's turn" — inside the same round. What resumes is the rest of the one turn already
//     paid for; its end used to charge for it a second time.
// ───────────────────────────────────────────────────────────────────────────
describe('the END-of-turn pass runs once per creature per round', () => {
  beforeEach(() => {
    resetCombat(); localStorage.clear()
    useCombatStore.setState({ diceResults: [] } as never)   // the reminder stack is the pass counter
  })
  afterEach(() => { useCombatStore.getState().setScope(null); localStorage.clear() })

  /** Wizard 20 / Goblin 15 / Orc 10, fight started — the wizard acts first. */
  function fight() {
    add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 15 }); add('Orc', { initiative: 10 })
    useCombatStore.getState().startCombat()
  }
  const condVal = (who: string, what: string) => condOn(who).find(c => c.name === what)?.value
  const condDur = (who: string, what: string) => condOn(who).find(c => c.name === what)?.duration
  /** One reminder card per firePersistentDamage call (the default setting is warn, not auto-roll). */
  const pdCards = () => useCombatStore.getState().diceResults.filter(d => d.label.startsWith('⚠ Persistent damage')).length
  /** Whose turn has already ended this round, in order. */
  function endFlags() {
    return useCombatStore.getState().combatants.map(c => `${c.name}:${!!c.endedThisRound}`).join(' ')
  }
  function usesOn(name: string): Record<string, number> {
    return useCombatStore.getState().combatants.find(c => c.name === name)!.resourceUses ?? {}
  }
  /** A stat block whose one ability is "once per round" — roundTurnAbilityKeys reads it as `ab:blast`. */
  const BLASTER = {
    name: 'Blaster', defenses: { hp: 40 },
    abilities: [{ name: 'Blast', entries: ['Frequency once per round'] }],
  } as unknown as Creature
  /** Advance until it is `who`'s turn in `round`, with a bound so a stuck pointer fails loudly. */
  function walkTo(round: number, who: string) {
    for (let i = 0; i < 12 && !(useCombatStore.getState().round === round && activeName() === who); i++) {
      useCombatStore.getState().nextTurn()
    }
    expect([useCombatStore.getState().round, activeName()]).toEqual([round, who])
  }

  it('an in-turn Delay and a same-round Return pay the negatives once — and again next round', () => {
    // MUTATION (nextTurn: `if (cur && !cur.endedThisRound) { cur.endedThisRound = true` back to the
    //   old `if (cur) {`):
    //   FAILS at line 614 — "expected 2 to be 1" (the wizard's one Delayed turn rolled persistent
    //   damage twice; the two assertions under it hold Frightened 4 → 3 → 2 and the source-less
    //   3-round condition 3 → 2 → 1 down the same way). The reload leg below fails with it, at
    //   line 662 — "expected 2 to be 3".
    fight()
    useCombatStore.getState().addCondition(idOf('Wizard'), {
      name: 'persistent damage', pdAmount: '1d6', pdType: 'fire', isPermanent: true,
    })
    useCombatStore.getState().addCondition(idOf('Wizard'), { name: 'frightened', value: 4, isPermanent: false })
    // No `source` → the "until the end of the target's next turn" family, i.e. this same pass.
    useCombatStore.getState().addCondition(idOf('Wizard'), { name: 'slowed', value: 1, duration: 3, isPermanent: false })

    useCombatStore.getState().delayCombatant(idOf('Wizard'))   // legal: Delay on its own turn
    expect(activeName()).toBe('Goblin')
    expect(pdCards()).toBe(1)                         // "occur immediately when you use the Delay action"
    expect(condVal('Wizard', 'frightened')).toBe(3)
    expect(condDur('Wizard', 'slowed')).toBe(2)

    useCombatStore.getState().returnFromDelay(idOf('Wizard'))   // "the end of any other creature's turn"
    useCombatStore.getState().nextTurn()              // the advance lands on it again, still round 1
    expect(activeName()).toBe('Wizard')
    expect(useCombatStore.getState().round).toBe(1)
    useCombatStore.getState().nextTurn()              // …and the REST of that same turn ends
    expect(pdCards()).toBe(1)
    expect(condVal('Wizard', 'frightened')).toBe(3)
    expect(condDur('Wizard', 'slowed')).toBe(2)

    // Per round, not once ever: the next round's turn-end charges again.
    expect(activeName()).toBe('Orc')
    useCombatStore.getState().nextTurn()              // the orc's turn ends → the wrap, round 2
    expect(useCombatStore.getState().round).toBe(2)
    useCombatStore.getState().nextTurn()              // the goblin's round-2 turn ends
    expect(activeName()).toBe('Wizard')
    useCombatStore.getState().nextTurn()              // the wizard's round-2 turn ends
    expect(pdCards()).toBe(2)
    expect(condVal('Wizard', 'frightened')).toBe(2)
    expect(condDur('Wizard', 'slowed')).toBe(1)
  })

  it('a board saved before the flag existed comes back with its spent turn-ends already spent', () => {
    // The flagless twin of finding 3. `undefined` reads as "hasn't ended yet", so re-opening any
    // existing save mid-fight put a free end-of-turn pass back on the table for everyone the pointer
    // had already passed — and a board saved with someone Delayed is exactly the board a GM reopens,
    // with "Return from delay" waiting on that row.
    // MUTATION (loadPersistedCombat: delete the `c.endedThisRound ??= …` line):
    //   FAILS at line 654 — "expected 'Wizard:false Goblin:false Orc:false' to be
    //   'Wizard:true Goblin:false Orc:false'" (the reloaded board hands the wizard's one round-1
    //   turn a second end, which is what line 662 holds down).
    useCombatStore.getState().setScope('camp-endflagless')
    fight()
    useCombatStore.getState().addCondition(idOf('Wizard'), { name: 'frightened', value: 4, isPermanent: false })
    useCombatStore.getState().delayCombatant(idOf('Wizard'))   // in-turn Delay: 4 → 3, turn to the goblin
    expect(condVal('Wizard', 'frightened')).toBe(3)
    const live = endFlags()
    expect(live).toBe('Wizard:true Goblin:false Orc:false')
    useCombatStore.getState().setScope(null)          // flushes the board under its own key

    const key = 'pf2e-current-combat:camp-endflagless'
    const raw = JSON.parse(localStorage.getItem(key)!) as { combatants: Record<string, unknown>[] }
    for (const c of raw.combatants) delete c.endedThisRound     // a pre-commit save, exactly
    localStorage.setItem(key, JSON.stringify(raw))

    useCombatStore.getState().setScope('camp-endflagless')
    expect(endFlags()).toBe(live)                     // behind the pointer = already ended
    expect(activeName()).toBe('Goblin')
    expect(useCombatStore.getState().round).toBe(1)

    useCombatStore.getState().returnFromDelay(idOf('Wizard'))
    useCombatStore.getState().nextTurn()              // the rest of the wizard's round-1 turn…
    expect(activeName()).toBe('Wizard')
    useCombatStore.getState().nextTurn()              // …and its end
    expect(condVal('Wizard', 'frightened')).toBe(3)   // still the single step this round
  })

  it('the ACTIVE creature is mid-turn, so a reload still owes it its own turn-end', () => {
    // Why the default is strictly `<` where the count's is `<=`: the pointer sits ON a creature
    // whose turn has STARTED and not ended. `<=` would mark it done and swallow the end of the very
    // turn the GM reopened the tracker in the middle of.
    // MUTATION (loadPersistedCombat: `i < parsed.activeIndex` → `i <= parsed.activeIndex`):
    //   FAILS at line 686 — "expected 4 to be 3" (the goblin's reloaded turn ended for free); the
    //   test above fails with it at line 654 — "expected 'Wizard:true Goblin:true Orc:false'".
    useCombatStore.getState().setScope('camp-endactive')
    fight()
    useCombatStore.getState().nextTurn()              // → the goblin's round-1 turn
    useCombatStore.getState().addCondition(idOf('Goblin'), { name: 'frightened', value: 4, isPermanent: false })
    useCombatStore.getState().setScope(null)

    const key = 'pf2e-current-combat:camp-endactive'
    const raw = JSON.parse(localStorage.getItem(key)!) as { combatants: Record<string, unknown>[] }
    for (const c of raw.combatants) delete c.endedThisRound
    localStorage.setItem(key, JSON.stringify(raw))

    useCombatStore.getState().setScope('camp-endactive')
    expect(activeName()).toBe('Goblin')
    useCombatStore.getState().nextTurn()              // the turn it was reopened in ends
    expect(condVal('Goblin', 'frightened')).toBe(3)
  })

  it('the per-round refill is not one of the negatives — an ability spent after the Return comes back', () => {
    // p. 416 guards "persistent damage or other negative effects". Clearing a once-per-round use is
    // the opposite: it is what puts the ability back for the creature's NEXT turn, and deleting an
    // already-deleted key costs nothing. A use spent in the RESUMED half of a Delayed turn is only
    // on the sheet after the flag is up, so guarding it left the ability locked for a whole turn.
    // MUTATION (endTurnPass: move the `if (c.resourceUses) { … }` stanza back inside the
    //   `if (!c.endedThisRound)` block):
    //   FAILS at line 710 — "expected 1 to be undefined" (the Blast spent after the Return is still
    //   marked used at the start of the round-2 turn, i.e. locked for that whole turn).
    useCombatStore.getState().addCombatant(BLASTER, { name: 'Wizard', initiative: 20, maxHP: 40 })
    add('Goblin', { initiative: 15 }); add('Orc', { initiative: 10 })
    useCombatStore.getState().startCombat()

    useCombatStore.getState().delayCombatant(idOf('Wizard'))   // in-turn Delay, round 1
    useCombatStore.getState().returnFromDelay(idOf('Wizard'))
    useCombatStore.getState().nextTurn()              // the advance lands back on it, still round 1
    expect([useCombatStore.getState().round, activeName()]).toEqual([1, 'Wizard'])
    useCombatStore.getState().setResourceUse(idOf('Wizard'), 'ab:blast', 1)   // Blasts in the resumed half
    useCombatStore.getState().nextTurn()              // …and that one turn finishes

    walkTo(2, 'Wizard')
    expect(usesOn('Wizard')['ab:blast']).toBeUndefined()
  })

  it('a defeated NPC still has a turn: its persistent damage and its Frightened keep running down', () => {
    // The sibling half of the same pass. skipsTurn() means a downed monster is never the active
    // creature, so its end-of-turn work used to stop dead the moment it dropped — its burning and
    // its Frightened frozen at whatever they were, which a GM only sees on the round they heal it
    // back up. Its initiative COUNT already came up here (creditCount, right beside it): the two
    // clocks disagreed about the same creature.
    // MUTATION (nextTurn's skip loop: `{ creditCount(skipped, counts); endTurnPass(s, skipped) }`
    //   back to the bare `creditCount(skipped, counts)`):
    //   FAILS at line 732 — "expected +0 to be 2" (two rounds of burning never rolled at all; the
    //   Frightened assertion under it is frozen at 4 the same way).
    fight()
    useCombatStore.getState().addCondition(idOf('Orc'), {
      name: 'persistent damage', pdAmount: '1d6', pdType: 'fire', isPermanent: true,
    })
    useCombatStore.getState().addCondition(idOf('Orc'), { name: 'frightened', value: 4, isPermanent: false })
    useCombatStore.getState().setDefeated(idOf('Orc'), true)   // an NPC at 0 HP — the advance steps over it

    for (let i = 0; i < 4; i++) useCombatStore.getState().nextTurn()   // two full laps
    expect([useCombatStore.getState().round, activeName()]).toEqual([3, 'Wizard'])
    expect(pdCards()).toBe(2)                         // once per round, never twice
    expect(condVal('Orc', 'frightened')).toBe(2)
  })

  it('a defeated NPC above the first actor ends its round-1 turn as the fight starts', () => {
    // Where the same skip happens with no advance to carry it: startCombat already credits every
    // seat the opening pointer stepped over (their counts came up), so their turn-ends land here
    // too, or round 1 is the one round a corpse at the top of the order never finishes.
    // MUTATION (startCombat: drop the `if (i < s.activeIndex) endTurnPass(s, s.combatants[i])` line):
    //   FAILS at line 749 — "expected 4 to be 3" (the corpse's round-1 turn never ended).
    add('Corpse', { initiative: 25 }); add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 15 })
    useCombatStore.getState().addCondition(idOf('Corpse'), { name: 'frightened', value: 4, isPermanent: false })
    useCombatStore.getState().addCondition(idOf('Wizard'), { name: 'frightened', value: 4, isPermanent: false })
    useCombatStore.getState().setDefeated(idOf('Corpse'), true)
    useCombatStore.getState().startCombat()

    expect(activeName()).toBe('Wizard')
    expect(condVal('Corpse', 'frightened')).toBe(3)   // stepped over, so its turn came and went
    expect(condVal('Wizard', 'frightened')).toBe(4)   // the lander is mid-turn — strictly `<`
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3. The condition table, against the printed text
// ───────────────────────────────────────────────────────────────────────────
describe('built-in condition rows match the Player Core text', () => {
  const mods = (name: string, value?: number) =>
    computeConditionMods([{ id: 'c1', name, value, isPermanent: true }])

  it('Prone: "You are off-guard and take a –2 circumstance penalty to attack rolls."', () => {
    const m = mods('prone')
    expect(m.ac).toBe(-2)            // the off-guard half — MISSING before the fix
    expect(m.attackBonus).toBe(-2)
    expect(m.spellAttack).toBe(-2)   // a spell attack roll is an attack roll
  })

  it('Grabbed: "…giving you the off-guard and immobilized conditions." — no attack penalty', () => {
    const m = mods('grabbed')
    expect(m.ac).toBe(-2)
    expect(m.attackBonus).toBe(0)    // the remaster prints none; the tracker applied −2
  })

  it('Restrained: "You have the off-guard and immobilized conditions…" — no attack penalty', () => {
    const m = mods('restrained')
    expect(m.ac).toBe(-2)
    expect(m.attackBonus).toBe(0)
  })

  it('Stupefied: "…on Intelligence-, Wisdom-, and Charisma-based rolls and DCs, including Will saving throws, spell attack modifiers, spell DCs, and skill checks that use these attribute modifiers."', () => {
    const m = mods('stupefied', 2)
    expect(m.will).toBe(-2)
    expect(m.perception).toBe(-2)    // Perception IS the Wisdom-based roll — missing before
    expect(m.spellAttack).toBe(-2)
    expect(m.spellDC).toBe(-2)
    expect(m.arcana).toBe(-2)        // Int
    expect(m.religion).toBe(-2)      // Wis
    expect(m.deception).toBe(-2)     // Cha
    expect(m.athletics).toBe(0)      // Str — untouched
    expect(m.stealth).toBe(0)        // Dex — untouched
    expect(m.ac).toBe(0)
  })

  it('Clumsy: "…including AC, Reflex saves, ranged attack rolls, and skill checks using Acrobatics, Stealth, and Thievery."', () => {
    const m = mods('clumsy', 1)
    expect(m.ac).toBe(-1)
    expect(m.ref).toBe(-1)
    expect(m.rangedAttack).toBe(-1)  // missing before
    expect(m.acrobatics).toBe(-1)
    expect(m.stealth).toBe(-1)
    expect(m.thievery).toBe(-1)
    expect(m.meleeAttack).toBe(0)
  })

  it('Blinded: "…if vision is your only precise sense, you take a –4 status penalty to Perception checks." — the entry prints no AC clause', () => {
    const m = mods('blinded')
    expect(m.perception).toBe(-4)
    expect(m.ac).toBe(0)             // the tracker invented a −2; off-guard is applied separately
  })

  it('Fascinated: "You take a –2 status penalty to Perception and skill checks…"', () => {
    const m = mods('fascinated')
    expect(m.perception).toBe(-2)
    expect(m.stealth).toBe(-2)
    expect(m.athletics).toBe(-2)
    expect(m.ac).toBe(0)
  })

  it('Confused / Paralyzed: "You are off-guard…" / "You have the off-guard condition…"', () => {
    expect(mods('confused').ac).toBe(-2)
    expect(mods('paralyzed').ac).toBe(-2)
  })

  it('Unconscious: "–4 status penalty to AC, Perception, and Reflex saves, and you have the blinded and off-guard conditions."', () => {
    const m = mods('unconscious')
    expect(m.ac).toBe(-6)            // −4 status + −2 circumstance (off-guard): different types stack
    expect(m.perception).toBe(-4)
    expect(m.ref).toBe(-4)
  })

  it('Fatigued: "You take a –1 status penalty to AC and saving throws."', () => {
    const m = mods('fatigued')
    expect([m.ac, m.fort, m.ref, m.will]).toEqual([-1, -1, -1, -1])
  })

  it('Prone + Off-Guard do not stack: both are circumstance penalties, so only the worst counts', () => {
    const m = computeConditionMods([
      { id: 'a', name: 'prone', isPermanent: true },
      { id: 'b', name: 'off-guard', isPermanent: true },
    ])
    expect(m.ac).toBe(-2)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4. Turn-engine gaps
// ───────────────────────────────────────────────────────────────────────────
describe('turn-engine actions', () => {
  beforeEach(() => { resetCombat(); localStorage.clear() })
  afterEach(() => localStorage.clear())

  it('Undo after Load Encounter puts the previous board back', () => {
    add('Old Fight A'); add('Old Fight B')
    useCombatStore.getState().saveEncounter('goblin ambush')
    resetCombat()
    add('Current Fight')
    useCombatStore.getState().loadEncounter('goblin ambush', new Map())
    expect(names()).toEqual(['Old Fight A', 'Old Fight B'])
    expect(useCombatStore.getState().canUndo).toBe(true)
    useCombatStore.getState().undo()
    expect(names()).toEqual(['Current Fight'])
  })

  it('Undo after Reset puts the wiped board back', () => {
    add('Ogre'); add('Hero', { isPC: true, maxHP: 20 })
    useCombatStore.getState().resetCombat()
    expect(names()).toEqual([])
    useCombatStore.getState().undo()
    expect(names()).toEqual(['Ogre', 'Hero'])
  })

  it('removeDefeated drops defeated NPCs, keeps PCs (downed or not), and clears a removed selection', () => {
    add('Goblin 1', { initiative: 20 }); add('Hero', { initiative: 15, isPC: true, maxHP: 20 })
    add('Goblin 2', { initiative: 10 }); add('Ogre', { initiative: 5 })
    useCombatStore.getState().startCombat()
    useCombatStore.getState().setDefeated(idOf('Goblin 1'), true)
    useCombatStore.getState().setDefeated(idOf('Goblin 2'), true)
    useCombatStore.getState().setDefeated(idOf('Hero'), true)       // a downed PC stays on the board
    useCombatStore.getState().selectCombatant(idOf('Goblin 2'))
    // Park the turn on the Ogre so the pointer has to follow a surviving id.
    useCombatStore.setState({ activeIndex: useCombatStore.getState().combatants.findIndex(c => c.name === 'Ogre') } as never)

    useCombatStore.getState().removeDefeated()
    expect(names().sort()).toEqual(['Hero', 'Ogre'])
    expect(activeName()).toBe('Ogre')                               // re-pointed by id, not by index
    expect(useCombatStore.getState().selectedId).toBeNull()
    useCombatStore.getState().undo()
    expect(names()).toContain('Goblin 1')                           // one undo step, not four
  })

  it('removeDefeated lands the pointer on the next survivor when the active combatant is the one removed', () => {
    add('A', { initiative: 30 }); add('Goblin', { initiative: 20 }); add('B', { initiative: 10 })
    useCombatStore.getState().startCombat()
    useCombatStore.getState().setDefeated(idOf('Goblin'), true)
    useCombatStore.setState({ activeIndex: 1 } as never)            // the goblin is "active"
    useCombatStore.getState().removeDefeated()
    expect(names()).toEqual(['A', 'B'])
    expect(activeName()).toBe('B')
  })

  it('applyDamage to 0 downs a PC: Unconscious + Dying 1, and the PC moves to just before the acting creature', () => {
    add('Hero', { initiative: 30, isPC: true, maxHP: 20 }); add('Goblin', { initiative: 20 }); add('Ogre', { initiative: 10 })
    useCombatStore.getState().startCombat()
    useCombatStore.getState().nextTurn()                            // the Goblin is acting
    expect(activeName()).toBe('Goblin')
    useCombatStore.getState().applyDamage(idOf('Hero'), 50)

    const hero = useCombatStore.getState().combatants.find(c => c.name === 'Hero')!
    expect(hero.currentHP).toBe(0)
    expect(hero.isDefeated).toBe(true)
    expect(hero.conditions.map(c => c.name).sort()).toEqual(['dying', 'unconscious'])
    expect(hero.conditions.find(c => c.name === 'dying')!.value).toBe(1)
    // Reorder branch: a PC dropped mid-round is moved to just BEFORE the acting creature, so it
    // doesn't get another turn this round — and the pointer stays on whoever is acting.
    expect(names()).toEqual(['Hero', 'Goblin', 'Ogre'])
    expect(activeName()).toBe('Goblin')
  })

  it('Dying stacks per PF2e: 1 + wounded on the first knockout, +1 if already Dying, capped by Doomed', () => {
    add('Hero', { isPC: true, maxHP: 20 })
    const id = idOf('Hero')
    useCombatStore.setState({
      combatants: useCombatStore.getState().combatants.map(c => ({
        ...c, conditions: [{ id: 'w', name: 'wounded', value: 2, isPermanent: true }],
      })) as AnyCombatant[],
    } as never)
    useCombatStore.getState().setDefeated(id, true)
    expect(condOn('Hero').find(c => c.name === 'dying')!.value).toBe(3)   // 1 + wounded 2

    // Already dying, and Doomed 1 pulls the death threshold down to 3 — the value can't pass it.
    useCombatStore.setState({
      combatants: useCombatStore.getState().combatants.map(c => ({
        ...c, conditions: [...c.conditions, { id: 'd', name: 'doomed', value: 1, isPermanent: true }],
      })) as AnyCombatant[],
    } as never)
    useCombatStore.getState().setDefeated(id, false)
    useCombatStore.getState().setDefeated(id, true)
    expect(condOn('Hero').find(c => c.name === 'dying')!.value).toBe(3)
  })

  it('healing a downed PC above 0 clears Dying + Unconscious and bumps Wounded', () => {
    // Player Core, Unconscious: "If you are restored to 1 Hit Point or more, you lose the dying and
    // unconscious conditions and can act normally on your next turn."
    add('Hero', { isPC: true, maxHP: 20 })
    const id = idOf('Hero')
    useCombatStore.getState().applyDamage(id, 20)
    expect(condOn('Hero').map(c => c.name).sort()).toEqual(['dying', 'unconscious'])
    useCombatStore.getState().applyHealing(id, 5)
    const after = condOn('Hero')
    expect(after.map(c => c.name)).toEqual(['wounded'])
    expect(after[0].value).toBe(1)

    // Knocked out again with Wounded 1 → Dying 2, and recovering takes Wounded to 2.
    useCombatStore.getState().applyDamage(id, 50)
    expect(condOn('Hero').find(c => c.name === 'dying')!.value).toBe(2)
    useCombatStore.getState().applyHealing(id, 5)
    expect(condOn('Hero').find(c => c.name === 'wounded')!.value).toBe(2)
  })

  it('Delay takes a combatant out of the order; returning re-inserts it after the current turn', () => {
    add('A', { initiative: 30 }); add('B', { initiative: 20 }); add('C', { initiative: 10 })
    useCombatStore.getState().startCombat()
    expect(activeName()).toBe('A')

    useCombatStore.getState().delayCombatant(idOf('A'))   // A delays on its own turn → the turn passes
    expect(useCombatStore.getState().combatants.find(c => c.name === 'A')!.isDelayed).toBe(true)
    expect(activeName()).toBe('B')

    useCombatStore.getState().nextTurn()
    expect(activeName()).toBe('C')                        // A is skipped, not just dimmed
    expect(useCombatStore.getState().round).toBe(1)       // still the round A delayed in

    useCombatStore.getState().returnFromDelay(idOf('A'))
    expect(names()).toEqual(['B', 'C', 'A'])              // back in, right after the acting creature
    expect(activeName()).toBe('C')
    expect(useCombatStore.getState().combatants.find(c => c.name === 'A')!.isDelayed).toBe(false)
    expect(useCombatStore.getState().combatants.find(c => c.name === 'A')!.initiative).toBe(10)
    useCombatStore.getState().nextTurn()
    expect(activeName()).toBe('A')
    expect(useCombatStore.getState().round).toBe(1)       // it took its turn inside its own round
  })

  it('a creature that returned from Delay stays behind the one it returned after when the order re-sorts', () => {
    // Returning copies that creature's initiative EXACTLY, so the numeric compare ties and the
    // "monster beats PC" tie rule would float the monster back in front of the PC it returned
    // after. Mid-combat that rule is off (initSort's `settled`) and the stable sort holds the pair.
    // MUTATION (`initSort(true)` → `initSort(false)` in setInitiative's mid-combat re-sort):
    //   FAILS at line 1002 — "expected [ 'Goblin', 'Hero', 'Ogre' ] to deeply equal
    //   [ 'Hero', 'Goblin', 'Ogre' ]" (the goblin jumped back ahead of the hero).
    useCombatStore.getState().addCombatant(STUB_CREATURE, { name: 'Goblin', initiative: 30 })
    add('Hero', { initiative: 20, isPC: true, maxHP: 20 }); add('Ogre', { initiative: 5 })
    useCombatStore.getState().startCombat()
    expect(activeName()).toBe('Goblin')

    useCombatStore.getState().delayCombatant(idOf('Goblin'))    // waits to see what the hero does
    expect(activeName()).toBe('Hero')
    useCombatStore.getState().returnFromDelay(idOf('Goblin'))
    expect(names()).toEqual(['Hero', 'Goblin', 'Ogre'])
    expect(useCombatStore.getState().combatants[1].initiative).toBe(20)   // the hero's count

    useCombatStore.getState().setInitiative(idOf('Ogre'), 5)     // any mid-combat edit re-sorts the board
    expect(names()).toEqual(['Hero', 'Goblin', 'Ogre'])
    expect(activeName()).toBe('Hero')
  })

  it('TWO creatures returning onto the same count keep the order they re-entered in', () => {
    // A single "I returned behind X" marker can't express this: both returned behind Pc1, and what
    // decides Mon vs Pc2 is which of them re-entered later. The board order already says it.
    // MUTATION (`initSort(s.inCombat)` → `initSort(false)` in sortByInitiative):
    //   FAILS at line 1029 — "expected [ 'Mon', 'Pc1', 'Pc2' ] to deeply equal
    //   [ 'Pc1', 'Pc2', 'Mon' ]" (the tie rule dragged the monster to the front of the count).
    useCombatStore.getState().addCombatant(STUB_CREATURE, { name: 'Mon', initiative: 20 })
    add('Pc1', { initiative: 20, isPC: true, maxHP: 20 }); add('Pc2', { initiative: 20, isPC: true, maxHP: 20 })
    useCombatStore.getState().startCombat()
    expect(names()).toEqual(['Mon', 'Pc1', 'Pc2'])               // fresh order: monster wins the tie

    useCombatStore.getState().delayCombatant(idOf('Mon'))        // on its own turn → the turn passes
    useCombatStore.getState().returnFromDelay(idOf('Mon'))       // back in behind Pc1
    expect(names()).toEqual(['Pc1', 'Mon', 'Pc2'])

    useCombatStore.getState().delayCombatant(idOf('Pc2'))
    useCombatStore.getState().nextTurn()                          // Pc1 → Mon
    useCombatStore.getState().nextTurn()                          // Mon → (Pc2 delayed, skipped) → Pc1
    expect(activeName()).toBe('Pc1')
    useCombatStore.getState().returnFromDelay(idOf('Pc2'))        // back in behind Pc1 too — ahead of Mon
    expect(names()).toEqual(['Pc1', 'Pc2', 'Mon'])

    useCombatStore.getState().sortByInitiative()                  // the GM presses Sort mid-fight
    expect(names()).toEqual(['Pc1', 'Pc2', 'Mon'])                // nobody moves
  })

  it('a NEW fight re-settles the order the last one ended in, and it holds through a re-sort', () => {
    // Returning from Delay copies an initiative count, and that copy outlives the fight. The fresh
    // sort is the one place the monster/PC tie rule still runs, so the new order is settled at the
    // top of the fight — not silently on whatever re-sort happens first.
    // MUTATION (`initSort(false)` → `initSort(true)` in startCombat):
    //   FAILS at line 1048 — "expected [ 'Hero', 'Goblin' ] to deeply equal [ 'Goblin', 'Hero' ]"
    //   (the new fight opened in last fight's Delay order, then flipped on the next re-sort).
    useCombatStore.getState().addCombatant(STUB_CREATURE, { name: 'Goblin', initiative: 30 })
    add('Hero', { initiative: 20, isPC: true, maxHP: 20 })
    useCombatStore.getState().startCombat()
    useCombatStore.getState().delayCombatant(idOf('Goblin'))
    useCombatStore.getState().returnFromDelay(idOf('Goblin'))
    expect(names()).toEqual(['Hero', 'Goblin'])                   // this fight: behind the hero, on 20

    useCombatStore.getState().endCombat()
    useCombatStore.getState().startCombat()
    expect(names()).toEqual(['Goblin', 'Hero'])                   // next fight: the tie rule decides again
    useCombatStore.getState().sortByInitiative()
    expect(names()).toEqual(['Goblin', 'Hero'])                   // and stays put
  })

  it('reinforcements that arrive mid-fight are PLACED by the tie rule, not left where they were pushed', () => {
    // A monster added mid-combat is pushed on the END of the array with no initiative — that spot
    // is an artifact, not an order anybody arranged. Typing its roll has to run the printed tie
    // rule (adversary before a tied PC) even though the rest of the board stays settled.
    // MUTATION (drop setInitiative's `wasUnplaced` branch, i.e. always `initSort(true)`):
    //   FAILS at line 1065 — "expected [ 'Goblin', 'Hero', 'Orc' ] to deeply equal
    //   [ 'Goblin', 'Orc', 'Hero' ]" (the new monster stayed stranded behind the hero it ties).
    useCombatStore.getState().addCombatant(STUB_CREATURE, { name: 'Goblin', initiative: 30 })
    add('Hero', { initiative: 20, isPC: true, maxHP: 20 })
    useCombatStore.getState().startCombat()
    useCombatStore.getState().addCombatant(STUB_CREATURE, { name: 'Orc' })   // no initiative yet
    useCombatStore.getState().setInitiative(idOf('Orc'), 20)                 // the GM types the roll
    expect(names()).toEqual(['Goblin', 'Orc', 'Hero'])
    expect(activeName()).toBe('Goblin')                          // the pointer stays on its creature
  })

  it('removing a combatant before the active one keeps the pointer on the same creature', () => {
    add('A'); add('B'); add('C')
    useCombatStore.setState({ activeIndex: 2, inCombat: true } as never)
    useCombatStore.getState().removeCombatant(idOf('A'))
    expect(activeName()).toBe('C')
  })

  it('removing the LAST combatant clamps the pointer instead of running off the end', () => {
    add('A'); add('B')
    useCombatStore.setState({ activeIndex: 1, inCombat: true } as never)
    useCombatStore.getState().removeCombatant(idOf('B'))
    expect(useCombatStore.getState().activeIndex).toBe(0)
    expect(activeName()).toBe('A')
  })

  it('the round bumps exactly once when the advance skips a run of defeated NPCs to wrap', () => {
    add('Hero', { initiative: 30, isPC: true, maxHP: 20 })
    add('Goblin 1', { initiative: 20 }); add('Goblin 2', { initiative: 10 })
    useCombatStore.getState().startCombat()
    useCombatStore.setState({
      combatants: useCombatStore.getState().combatants.map(c =>
        c.isPC ? c : { ...c, isDefeated: true }) as AnyCombatant[],
    } as never)
    useCombatStore.getState().nextTurn()                  // Hero → skip both goblins → wrap to Hero
    expect(activeName()).toBe('Hero')
    expect(useCombatStore.getState().round).toBe(2)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5. The Delay row action — where the button may be offered
//
//    Player Core p. 416, Delay (public/data/actions.json, the entry this repo ships):
//    "Trigger Your turn begins." and "When you Delay, any persistent damage or other negative
//    effects that normally occur at the start or end of your turn occur immediately when you use
//    the Delay action."
//
//    delayCombatant runs those negatives by handing the turn on (nextTurn owns the end-of-turn
//    pass), which it can only do for the creature that HAS the turn. The menu offered Delay on
//    EVERY row while in combat, so the ordinary GM click on some other row took the creature out of
//    the order and silently skipped its persistent damage and one step of every auto-decrementing
//    condition for that round. The store is right; the affordance was the defect.
// ───────────────────────────────────────────────────────────────────────────
describe('Delay is offered on the row whose turn it is', () => {
  beforeEach(() => { resetCombat(); localStorage.clear() })
  afterEach(() => { cleanup(); localStorage.clear() })

  const row = (name: string) => screen.getByText(name).closest('.init-row')!

  it('a row that is not acting gets no Delay item; the acting row does, and a delayed row can return', () => {
    // MUTATION (InitiativeTracker.tsx: `{inCombat && (isActiveTurn || c.isDelayed) && (` back to
    //   `{inCombat && (`):
    //   FAILS at line 1129 — "expected <button …(2)></button> to be null" (the goblin's menu offers
    //   Delay on a turn that hasn't begun).
    add('Wizard', { initiative: 20 }); add('Goblin', { initiative: 10 })
    useCombatStore.getState().startCombat()
    render(createElement(InitiativeTracker))
    expect(activeName()).toBe('Wizard')

    fireEvent.contextMenu(row('Goblin'))
    expect(screen.queryByText('Delay')).toBeNull()
    fireEvent.mouseDown(document.body)                    // close the menu

    fireEvent.contextMenu(row('Wizard'))
    expect(screen.queryByText('Delay')).not.toBeNull()
    fireEvent.mouseDown(document.body)

    // Out of the order, its turn passed to the goblin — and it can still be brought back from any
    // row, which is the half of the affordance the print does put on "the end of any other
    // creature's turn".
    act(() => { useCombatStore.getState().delayCombatant(idOf('Wizard')) })
    expect(activeName()).toBe('Goblin')
    fireEvent.contextMenu(row('Wizard'))
    expect(screen.queryByText('Return from delay')).not.toBeNull()
    expect(screen.queryByText('Delay')).toBeNull()
  })
})
