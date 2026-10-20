// Item 3 (2026-10-20): the turn timer's "Save to Averages" was the last join left on the NAME
// (combatStore.saveTurnsToAverages → partyStore.addTurnsToPlayerByName). Two same-named PCs in one
// campaign both took the merged batch, and turns taken before a rename missed the renamed card. A turn
// now keeps its row's charId / partyMemberId, and each row's turns land on the ONE card that row is
// (partyStore.addTurnsToRow → partyCardOfRow, the HP bridge's join). Synthetic names only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCombatStore } from './combatStore'
import { usePartyStore, addPartyMemberToOrder } from './partyStore'
import { useSettingsStore } from './settingsStore'
import type { TurnRecord } from '../utils/turnTimer'

const st = () => useCombatStore.getState()
const card = (charId: string) =>
  usePartyStore.getState().parties.flatMap(p => p.players).find(p => p.charId === charId)!

function reset() {
  localStorage.clear()
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null, turns: [], turnTimer: null,
  } as never)
  usePartyStore.setState({ parties: [], activePartyId: null })
}

describe('Save to Averages lands each row’s turns on the card that row is', () => {
  beforeEach(() => { reset(); vi.useFakeTimers(); useSettingsStore.setState({ turnTimerEnabled: true }) })
  afterEach(() => { useSettingsStore.setState({ turnTimerEnabled: false }); vi.useRealTimers(); reset() })

  // On HEAD both cards read avg 20, count 2 (grouped by the shared name, folded into both).
  it('two PCs both named Kyra keep their own averages', () => {
    usePartyStore.getState().syncCampaignParty('camp-t', 'Test Camp', [
      { charId: 'a', name: 'Kyra' }, { charId: 'b', name: 'Kyra' },
    ])
    addPartyMemberToOrder(card('a'))
    addPartyMemberToOrder(card('b'))
    expect(st().combatants).toHaveLength(2)
    const rowA = st().combatants.find(c => c.charId === 'a')!
    const rowB = st().combatants.find(c => c.charId === 'b')!
    st().setInitiative(rowA.id, 20)
    st().setInitiative(rowB.id, 10)
    st().startCombat()
    expect(st().combatants[st().activeIndex].charId).toBe('a')
    vi.advanceTimersByTime(10_000)
    st().nextTurn()
    expect(st().combatants[st().activeIndex].charId).toBe('b')
    vi.advanceTimersByTime(30_000)
    st().nextTurn()
    // The records carry the row's ids (combatStore beginTurn → commitTurn).
    expect(st().turns.map(t => [t.charId, t.partyMemberId, t.seconds]))
      .toEqual([['a', card('a').id, 10], ['b', card('b').id, 30]])
    st().saveTurnsToAverages()
    expect([card('a').turnAvgSeconds, card('a').turnCount]).toEqual([10, 1])
    expect([card('b').turnAvgSeconds, card('b').turnCount]).toEqual([30, 1])
    expect(st().turns).toEqual([])
  })

  // On HEAD the batch is folded by the old name 'Kyra', which no card carries any more: dropped.
  it('a turn taken before the card was renamed still reaches it', () => {
    usePartyStore.getState().syncCampaignParty('camp-t', 'Test Camp', [{ charId: 'a', name: 'Kyra' }])
    const turn: TurnRecord = { id: 'turn-x', combatantId: 'row-gone', name: 'Kyra', isPC: true, charId: 'a', seconds: 12 }
    useCombatStore.setState({ turns: [turn] } as never)
    usePartyStore.getState().syncCampaignParty('camp-t', 'Test Camp', [{ charId: 'a', name: 'Kira' }])
    expect(card('a').name).toBe('Kira')
    st().saveTurnsToAverages()
    expect([card('a').turnAvgSeconds, card('a').turnCount]).toEqual([12, 1])
  })

  // A record saved before the ids were kept: its row, still on the board, says whose it was.
  // On HEAD both Kyras take it.
  it('an older record with no ids follows its row on the board when the row is still there', () => {
    usePartyStore.getState().syncCampaignParty('camp-t', 'Test Camp', [
      { charId: 'a', name: 'Kyra' }, { charId: 'b', name: 'Kyra' },
    ])
    addPartyMemberToOrder(card('a'))
    addPartyMemberToOrder(card('b'))
    const rowB = st().combatants.find(c => c.charId === 'b')!
    useCombatStore.setState({ turns: [{ id: 'turn-old', combatantId: rowB.id, name: 'Kyra', isPC: true, seconds: 8 }] } as never)
    st().saveTurnsToAverages()
    expect(card('a').turnCount).toBeUndefined()
    expect([card('b').turnAvgSeconds, card('b').turnCount]).toEqual([8, 1])
  })

  // Back-compat: an older record with no ids and no row left still lands by the name, as it always did.
  it('an older record with no ids and no row falls back to the name', () => {
    usePartyStore.getState().syncCampaignParty('camp-t', 'Test Camp', [{ charId: 'a', name: 'Kyra' }])
    useCombatStore.setState({ turns: [{ id: 'turn-old', combatantId: 'row-gone', name: 'Kyra', isPC: true, seconds: 15 }] } as never)
    st().saveTurnsToAverages()
    expect([card('a').turnAvgSeconds, card('a').turnCount]).toEqual([15, 1])
  })
})
