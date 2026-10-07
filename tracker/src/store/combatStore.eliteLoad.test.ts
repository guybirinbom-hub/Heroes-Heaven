// Bestiary corpus fix round 4, D19: Elite / Weak / scaled HP on load.
//
// A saved encounter remembers WHICH adjustment a combatant had (isElite / isWeak / scaledToLevel)
// and the stat block it was made from. The board's HP maximum for such a combatant is the ADJUSTED
// creature's (setEliteWeak / setScaledLevel set it from applyWeakElite / scaleByLevel). Loading the
// encounter used to set it from the PRINTED stat block instead (`creature.defenses.hp`), so an Elite
// combatant came back with the Elite tag, the Elite AC and attacks, and the base HP bar. Measured at
// the base commit 7cfb323 (before the corpus work): loadEncounter there is byte-identical to the one
// this round fixes, so the loss is pre-existing, not a corpus regression.
//
// Every test below fails without the loadEncounter fix in combatStore.ts (each says which part).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCombatStore, invalidateEncounterCache, adjustedCreature } from './combatStore'
import { SAMPLE_COMBATANT } from '../data/sampleStatBlock'
import { applyWeakElite, scaleByLevel } from '../utils/weakElite'
import type { Creature, SavedEncounter } from '../types/pf2e'

const st = () => useCombatStore.getState()

function resetBoard() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}

/** A level-14 creature with 300 HP (Elite +20, Weak −20) and a level-3 one with 40 HP (Elite +15,
 *  Weak −15): two rows of the Bestiary's HP adjustment table. */
const WYRM: Creature = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'elite-load-wyrm', name: 'Elite Load Wyrm' }
const IMP: Creature = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'elite-load-imp', name: 'Elite Load Imp', level: 3 }
IMP.defenses = { ...IMP.defenses, hp: 40 }
/** A level-4 hazard whose page prints no Hit Points (synthetic; like a haunt or a rune trap). */
const HAUNT: Creature = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'elite-load-haunt', name: 'Elite Load Haunt', level: 4, isHazard: true }
HAUNT.defenses = { ...HAUNT.defenses, hp: 0, acPrinted: false, savesPrinted: ['will'] }

/** Add `c` to the board, adjust it, and return the board's HP maximum for it. */
function boardMax(c: Creature, how: { elite?: boolean; weak?: boolean; level?: number }): number {
  st().addCombatant(c)
  const id = st().combatants[st().combatants.length - 1].id
  if (how.elite) st().setEliteWeak(id, 'elite')
  if (how.weak) st().setEliteWeak(id, 'weak')
  if (how.level !== undefined) st().setScaledLevel(id, how.level)
  return st().combatants.find(x => x.id === id)!.maxHP
}

/** Save the board, empty it, drop the cache (so the save is read back from storage, as after a
 *  restart) and load it again. */
function saveAndReload(name: string) {
  st().saveEncounter(name)
  resetBoard()
  invalidateEncounterCache()
  st().loadEncounter(name, new Map())
}

describe('a loaded Elite / Weak / scaled combatant keeps the adjusted HP maximum (saved encounter)', () => {
  beforeEach(() => { resetBoard(); localStorage.clear(); invalidateEncounterCache() })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache() })

  // Fails without the fix: the loaded maxHP is the printed 300 / 40, not 320 / 55.
  it('Elite: the board maximum, at full HP, on two rows of the HP table', () => {
    const wyrm = boardMax(WYRM, { elite: true })
    const imp = boardMax(IMP, { elite: true })
    expect([wyrm, imp]).toEqual([320, 55])
    saveAndReload('elite load')
    const got = st().combatants.map(c => [c.name, c.isElite, c.maxHP, c.currentHP])
    expect(got).toEqual([['Elite Load Wyrm', true, 320, 320], ['Elite Load Imp', true, 55, 55]])
  })

  // Fails without the fix: the loaded maxHP is the printed 300 / 40, not 280 / 25.
  it('Weak: the board maximum', () => {
    const wyrm = boardMax(WYRM, { weak: true })
    const imp = boardMax(IMP, { weak: true })
    expect([wyrm, imp]).toEqual([280, 25])
    saveAndReload('weak load')
    expect(st().combatants.map(c => [c.isWeak, c.maxHP, c.currentHP])).toEqual([[true, 280, 280], [true, 25, 25]])
  })

  // Fails without the fix: the loaded maxHP is the printed 300, not the level-17 scale.
  it('scaled to a level: the board maximum', () => {
    const up = boardMax(WYRM, { level: 17 })
    const down = boardMax(WYRM, { level: 10 })
    expect(up).toBe(scaleByLevel(WYRM, 17).defenses.hp)
    expect(down).toBe(scaleByLevel(WYRM, 10).defenses.hp)
    expect(up).not.toBe(300)
    saveAndReload('scaled load')
    expect(st().combatants.map(c => [c.scaledToLevel, c.maxHP, c.currentHP])).toEqual([[17, up, up], [10, down, down]])
  })

  // Fails without the fix: the board reads 300 after the load.
  it('a save written by the old load (Elite tag, printed maxHP stored) loads with the Elite maximum', () => {
    // What the old load left behind: the GM loaded an Elite save (maxHP came back 300), then saved
    // again — the store now holds isElite with the printed maximum.
    const saved: SavedEncounter = {
      name: 'old save', savedAt: '2026-10-01T00:00:00.000Z',
      combatants: [{ name: 'Elite Load Wyrm', creature: WYRM, creatureId: WYRM.id, isPC: false, maxHP: 300, isElite: true, isWeak: false, notes: '' }],
    }
    localStorage.setItem('pf2e-encounters', JSON.stringify({ 'old save': saved }))
    invalidateEncounterCache()
    st().loadEncounter('old save', new Map())
    expect(st().combatants.map(c => [c.maxHP, c.currentHP])).toEqual([[320, 320]])
  })

  // Guards the fix's edges (pass before and after): an unadjusted creature keeps the printed HP,
  // a PC row (no stat block) keeps its stored maximum.
  it('an unadjusted creature keeps its printed HP; a PC keeps its stored maximum', () => {
    boardMax(WYRM, {})
    st().addCombatant(null, { name: 'Hero', isPC: true, maxHP: 42 })
    saveAndReload('plain load')
    expect(st().combatants.map(c => [c.name, c.maxHP, c.currentHP])).toEqual([['Elite Load Wyrm', 300, 300], ['Hero', 42, 42]])
  })

  // Fails without the fix: a hand-written save with "scaledToLevel": null loaded a combatant whose
  // scaledToLevel was null, which every reader takes as "scaled" (`!== undefined`): the panel badge
  // read "Lv null". It now loads as unscaled, with the Elite maximum it names.
  it('a save with scaledToLevel null loads as unscaled', () => {
    const saved = {
      name: 'null scale', savedAt: '2026-10-01T00:00:00.000Z',
      combatants: [{ name: 'Elite Load Wyrm', creature: WYRM, creatureId: WYRM.id, isPC: false, maxHP: 320, isElite: true, isWeak: false, scaledToLevel: null, notes: '' }],
    }
    localStorage.setItem('pf2e-encounters', JSON.stringify({ 'null scale': saved }))
    invalidateEncounterCache()
    st().loadEncounter('null scale', new Map())
    const c = st().combatants[0]
    expect(c.scaledToLevel).toBeUndefined()
    expect(c.maxHP).toBe(320)
  })

  // Round 5 (refute-4 findings): a stat block that prints no HP (a haunt, a magical trap) gains none
  // from Elite, Weak or a level scale — on the board, on the drawn stat block and on load. Fails
  // without the hp > 0 guard in weakElite.ts: applyWeakElite gave Elite 15 / Weak 1 (Math.max(1,
  // 0 ± n)), scaleByLevel gave 1–30, and the load paths copied it into maxHP.
  it('a hazard with no HP gains none from Elite, Weak or a scale: board, stat block, saved encounter', () => {
    expect(applyWeakElite(HAUNT, 'elite').defenses.hp).toBe(0)
    expect(applyWeakElite(HAUNT, 'weak').defenses.hp).toBe(0)
    expect(scaleByLevel(HAUNT, 6).defenses.hp).toBe(0)
    expect(scaleByLevel(HAUNT, 2).defenses.hp).toBe(0)
    // The other numbers still move (only HP is left alone).
    expect(applyWeakElite(HAUNT, 'elite').defenses.ac).toBe(HAUNT.defenses.ac + 2)
    const board = [boardMax(HAUNT, { elite: true }), boardMax(HAUNT, { weak: true }), boardMax(HAUNT, { level: 6 })]
    expect(board).toEqual([0, 0, 0])
    saveAndReload('haunt load')
    expect(st().combatants.map(c => [c.isElite, c.isWeak, c.scaledToLevel, c.maxHP, c.currentHP]))
      .toEqual([[true, false, undefined, 0, 0], [false, true, undefined, 0, 0], [false, false, 6, 0, 0]])
  })

  // Keeps the low-HP clamp it had (passes before and after): a creature WITH HP that Weak would drop
  // to 0 or below still keeps 1.
  it('a creature with a little HP still keeps 1 under Weak and a deep scale', () => {
    const rat: Creature = { ...JSON.parse(JSON.stringify(IMP)), id: 'elite-load-rat', name: 'Elite Load Rat', level: 1 }
    rat.defenses = { ...rat.defenses, hp: 6 }
    expect(applyWeakElite(rat, 'weak').defenses.hp).toBe(1)
    expect(scaleByLevel(rat, -1).defenses.hp).toBeGreaterThanOrEqual(1)
  })

  // The helper the load paths share reads the adjustment exactly as the board does: a level scale
  // wins over a stale Elite flag (setScaledLevel clears it; the readers check the scale first).
  it('adjustedCreature matches the board adjustments', () => {
    expect(adjustedCreature(WYRM, { isElite: true }).defenses.hp).toBe(applyWeakElite(WYRM, 'elite').defenses.hp)
    expect(adjustedCreature(WYRM, { isWeak: true }).defenses.hp).toBe(applyWeakElite(WYRM, 'weak').defenses.hp)
    expect(adjustedCreature(WYRM, { isElite: true, scaledToLevel: 17 }).defenses.hp).toBe(scaleByLevel(WYRM, 17).defenses.hp)
    expect(adjustedCreature(WYRM, { scaledToLevel: null })).toBe(WYRM)
    expect(adjustedCreature(WYRM, {})).toBe(WYRM)
  })
})
