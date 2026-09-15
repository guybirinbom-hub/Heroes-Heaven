// tracker 2026-09-15: store
//
// The combat store's state transitions — campaign scoping, condition durations, the printed
// condition table, and the turn-engine actions the 2026-09-15 review found untested.
//
// Every condition row below quotes the Player Core (remaster) sentence it encodes, fetched from the
// live Archives rather than recalled: the rows that were wrong were wrong because they carried an
// older printing's wording or a play-aid's shorthand instead of the sentence on the page.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCombatStore } from './combatStore'
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
    //   FAILS at line 123 — "expected { id: 'leaf2', kind: 'leaf', … tabs: [ cmb-1 ] } to be null"
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
    //   FAILS at line 235 — "expected 3 to be 2" (the count froze where the wizard left it).
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
    //   FAILS at line 266 — "expected 1 to be 2" (the wizard's round-2 count credited twice, which
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

  it('a source that Delays and NEVER returns holds its own effects open', () => {
    // The consequence of the line above, recorded rather than left to be found: the delayed source
    // is still on the board, so hasSource() keeps its targets off the turn-end clock, and its own
    // count never comes up — so nothing ticks for as long as it stays delayed. The tracker doesn't
    // model "Delay ends at the end of the round" (Player Core p. 421); a GM leaving a creature
    // delayed is holding its turn open. Un-delay it and the clock runs again (the test above).
    // Same reason as above for delaying on the ROUND-2 turn: a round-1 delay leaves a count that was
    // never credited, so the skip guard can't be told from its absence.
    // MUTATION (`if (skipped && !skipped.isDelayed)` → `if (skipped)` in nextTurn's skip loop):
    //   FAILS at line 296 — "expected undefined to be 2" (three credited skips ran the 3-round
    //   effect out entirely).
    twoCreatureFight()                                // Wizard 20, Goblin 10
    useCombatStore.getState().addCondition(idOf('Goblin'), {
      name: 'slowed', value: 1, duration: 3, source: idOf('Wizard'), isPermanent: false,
    })
    useCombatStore.getState().nextTurn()              // → Goblin, round 1
    useCombatStore.getState().nextTurn()              // → Wizard, round 2: 3 → 2
    useCombatStore.getState().delayCombatant(idOf('Wizard'))    // delays on its own turn → turn passes
    useCombatStore.getState().nextTurn()
    useCombatStore.getState().nextTurn()
    useCombatStore.getState().nextTurn()
    expect(useCombatStore.getState().round).toBe(5)   // three more rounds of goblin turns
    expect(durOn('Goblin')).toBe(2)                   // and the wizard's clock never moved again
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
    useCombatStore.getState().nextTurn()
    expect(activeName()).toBe('B')                        // and skipped again on the wrap
    expect(useCombatStore.getState().round).toBe(2)

    useCombatStore.getState().returnFromDelay(idOf('A'))
    expect(names()).toEqual(['B', 'A', 'C'])              // back in, right after the acting creature
    expect(activeName()).toBe('B')
    expect(useCombatStore.getState().combatants.find(c => c.name === 'A')!.isDelayed).toBe(false)
    expect(useCombatStore.getState().combatants.find(c => c.name === 'A')!.initiative).toBe(20)
    useCombatStore.getState().nextTurn()
    expect(activeName()).toBe('A')
  })

  it('a creature that returned from Delay stays behind the one it returned after when the order re-sorts', () => {
    // Returning copies that creature's initiative EXACTLY, so the numeric compare ties and the
    // "monster beats PC" tie rule would float the monster back in front of the PC it returned
    // after. Mid-combat that rule is off (initSort's `settled`) and the stable sort holds the pair.
    // MUTATION (`initSort(true)` → `initSort(false)` in setInitiative's mid-combat re-sort):
    //   FAILS at line 549 — "expected [ 'Goblin', 'Hero', 'Ogre' ] to deeply equal
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
    //   FAILS at line 576 — "expected [ 'Mon', 'Pc1', 'Pc2' ] to deeply equal
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
    //   FAILS at line 595 — "expected [ 'Hero', 'Goblin' ] to deeply equal [ 'Goblin', 'Hero' ]"
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
    //   FAILS at line 612 — "expected [ 'Goblin', 'Hero', 'Orc' ] to deeply equal
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
