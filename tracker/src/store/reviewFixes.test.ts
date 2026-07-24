// Regression tests for the initiative-tracker review fixes (2026-07-25). Each test reproduces the
// reported bug and asserts the fix. See project_hh_tracker memory for the full list.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCombatStore } from './combatStore'
import { usePartyStore } from './partyStore'
import { loadConditions } from '../data/dataStore'

type AnyCombatant = ReturnType<typeof useCombatStore.getState>['combatants'][number]

// Reset combat state (the undo/redo stacks are module-level, so tests establish their own sequence).
function resetCombat() {
  useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null, turns: [] } as never)
}
function names() { return useCombatStore.getState().combatants.map(c => c.name) }
function add(name: string, opts: Record<string, unknown> = {}) {
  useCombatStore.getState().addCombatant(null, { name, ...opts })
}

describe('combatStore review fixes', () => {
  beforeEach(resetCombat)

  it('#1 removeCombatant keeps the active pointer on the same creature', () => {
    add('A'); add('B'); add('C'); add('D')
    useCombatStore.setState({ activeIndex: 1, inCombat: true } as never) // B is active
    const aId = useCombatStore.getState().combatants[0].id
    useCombatStore.getState().removeCombatant(aId)                       // remove A (before active)
    expect(names()).toEqual(['B', 'C', 'D'])
    expect(useCombatStore.getState().combatants[useCombatStore.getState().activeIndex].name).toBe('B')
  })

  it('#12 nextTurn bumps the round exactly once when the whole order is defeated NPCs', () => {
    add('n1'); add('n2'); add('n3')
    const cs = useCombatStore.getState()
    useCombatStore.setState({
      combatants: cs.combatants.map(c => ({ ...c, isPC: false, isDefeated: true })) as AnyCombatant[],
      activeIndex: 2, round: 3, inCombat: true,
    } as never)
    useCombatStore.getState().nextTurn()
    expect(useCombatStore.getState().round).toBe(4) // was 5 (double-bump)
  })

  it('#5 healing a downed PC above 0 clears isDefeated AND the Unconscious condition', () => {
    add('Hero', { isPC: true, maxHP: 20 })
    const id = useCombatStore.getState().combatants[0].id
    const cs = useCombatStore.getState()
    useCombatStore.setState({
      combatants: cs.combatants.map(c => ({
        ...c, currentHP: 0, isDefeated: true,
        conditions: [{ id: 'u1', name: 'unconscious', isPermanent: true }],
      })) as AnyCombatant[],
    } as never)
    useCombatStore.getState().applyHealing(id, 10)
    const c = useCombatStore.getState().combatants[0]
    expect(c.isDefeated).toBe(false)
    expect(c.conditions.some(x => x.name.toLowerCase() === 'unconscious')).toBe(false)
  })

  it('#3 an add after Undo clears Redo (no stale-snapshot replay)', () => {
    add('A'); add('B')
    const bId = useCombatStore.getState().combatants[1].id
    useCombatStore.getState().removeCombatant(bId) // records an undo step
    useCombatStore.getState().undo()               // -> canRedo true
    expect(useCombatStore.getState().canRedo).toBe(true)
    add('C')                                       // must invalidate redo
    expect(useCombatStore.getState().canRedo).toBe(false)
  })
})

// ---- party store ---------------------------------------------------------
function mkPlayer(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, notes: '', memberType: 'pc', ...extra }
}
function resetParties() { usePartyStore.setState({ parties: [], activePartyId: null } as never) }

describe('partyStore review fixes', () => {
  beforeEach(resetParties)

  it('#6/#10 turn/HP writes are scoped to the active party (no same-name bleed)', () => {
    usePartyStore.setState({
      parties: [
        { id: 'p1', name: 'One', level: 1, isFavorite: false, players: [mkPlayer('a', 'Bob', { pcStats: { maxHP: 20 } })] },
        { id: 'p2', name: 'Two', level: 1, isFavorite: false, players: [mkPlayer('b', 'Bob', { pcStats: { maxHP: 20 } })] },
      ],
      activePartyId: 'p1',
    } as never)
    usePartyStore.getState().addTurnsToPlayerByName('Bob', 30, 3)
    usePartyStore.getState().syncCurrentHpByName('Bob', 7)
    const p1 = usePartyStore.getState().parties.find(p => p.id === 'p1')!
    const p2 = usePartyStore.getState().parties.find(p => p.id === 'p2')!
    expect(p1.players[0].turnCount).toBe(3)
    expect(p1.players[0].pcStats!.hpCurrent).toBe(7)
    expect(p2.players[0].turnCount).toBeUndefined()   // untouched
    expect(p2.players[0].pcStats!.hpCurrent).toBeUndefined()
  })

  it('#11 turn averages skip NPCs; findPlayerByName prefers a PC', () => {
    usePartyStore.setState({
      parties: [{
        id: 'p1', name: 'One', level: 1, isFavorite: false,
        players: [mkPlayer('npc', 'Kyra', { memberType: 'npc' }), mkPlayer('pc', 'Kyra')],
      }],
      activePartyId: 'p1',
    } as never)
    usePartyStore.getState().addTurnsToPlayerByName('Kyra', 30, 3)
    const party = usePartyStore.getState().parties[0]
    const npc = party.players.find(p => p.id === 'npc')!
    const pc = party.players.find(p => p.id === 'pc')!
    expect(npc.turnCount).toBeUndefined()  // NPC not credited
    expect(pc.turnCount).toBe(3)
    expect(usePartyStore.getState().findPlayerByName('Kyra')!.player.memberType).toBe('pc')
  })

  it('#14 turnHistory is capped at 500', () => {
    usePartyStore.setState({
      parties: [{ id: 'p1', name: 'One', level: 1, isFavorite: false, players: [mkPlayer('a', 'Bob')] }],
      activePartyId: 'p1',
    } as never)
    for (let i = 0; i < 600; i++) usePartyStore.getState().addTurnsToPlayerByName('Bob', 5, 1)
    expect(usePartyStore.getState().parties[0].players[0].turnHistory!.length).toBeLessThanOrEqual(500)
  })

  it('#9 syncCampaignParty matches by charId: rename keeps history, dupes stay distinct', () => {
    const id = usePartyStore.getState().syncCampaignParty('camp', 'Camp', [{ charId: 'c1', name: 'Bob', maxHP: 20 }])
    usePartyStore.getState().addTurnsToPlayerByName('Bob', 30, 3) // camp is now active
    // Rename Bob -> Bobby, same charId.
    usePartyStore.getState().syncCampaignParty('camp', 'Camp', [{ charId: 'c1', name: 'Bobby', maxHP: 20 }])
    const party = usePartyStore.getState().parties.find(p => p.id === id)!
    expect(party.players.length).toBe(1)
    expect(party.players[0].name).toBe('Bobby')     // renamed in place
    expect(party.players[0].turnCount).toBe(3)      // history preserved
    // Two members that share a name but differ by charId stay distinct.
    const id2 = usePartyStore.getState().syncCampaignParty('camp2', 'C2', [
      { charId: 'x', name: 'Twin' }, { charId: 'y', name: 'Twin' },
    ])
    const p2 = usePartyStore.getState().parties.find(p => p.id === id2)!
    expect(p2.players.filter(p => p.name === 'Twin').length).toBe(2)
  })
})

// ---- data store ----------------------------------------------------------
describe('dataStore review fix', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('#4 loadConditions degrades to an empty map on a failed fetch (does not throw)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') }) as never
    const m = await loadConditions()
    expect(m).toBeInstanceOf(Map)
    expect(m.size).toBe(0)
  })
})
