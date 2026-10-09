// Owner's list 2026-10-01, item 5: a party NPC added from the Add-combatants dialog was rated as an
// ENEMY, while the same NPC added from the party page's "Add to Initiative" was rated as one of the
// party. Both routes now go through ONE add (partyStore.addPartyMemberToOrder), which flags the NPC
// as an ally and stamps the row with the member it was added for (partyMemberId). The stamp has to
// survive everything a row goes through — save / load, the portable file — and must NOT survive a
// duplicate (the copy is another allied creature, not that member). Synthetic names only.
//
// Each test names the line whose removal makes it fail.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCombatStore, invalidateEncounterCache } from './combatStore'
import { usePartyStore, addPartyMemberToOrder, type PartyPlayer } from './partyStore'
import { buildExportPayload, importEncountersFromText } from '../utils/encounterTransfer'
import { saveCustomCreature, reloadCustomCreatures } from '../data/dataStore'
import { SAMPLE_COMBATANT } from '../data/sampleStatBlock'
import { XP_BUDGET } from '../components/GmWidgets'
import { XP_BUDGET_ROWS, sidesOf } from '../utils/encounter'
import type { Creature } from '../types/pf2e'

const st = () => useCombatStore.getState()

function resetBoard() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}

const BLADE: Creature = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'party-order-blade', name: 'Party Order Blade', level: 5 }
delete (BLADE as { raw?: unknown }).raw

const npc = (over: Partial<PartyPlayer> = {}): PartyPlayer =>
  ({ id: 'pl-blade', name: 'Hired Blade', notes: '', memberType: 'npc', creature: BLADE, ...over })
const pcPlayer = (over: Partial<PartyPlayer> = {}): PartyPlayer =>
  ({ id: 'pl-wren', name: 'Wren Ashdown', notes: '', memberType: 'pc', charId: 'char-wren', pcStats: { maxHP: 40 }, ...over })

describe('addPartyMemberToOrder — the one way a party member enters the order', () => {
  beforeEach(() => { localStorage.clear(); invalidateEncounterCache(); resetBoard(); usePartyStore.setState({ parties: [], activePartyId: null }) })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache() })

  // Fails without `isAlly: true` in addPartyMemberToOrder's NPC branch (the dialog's old copy).
  it('adds a party NPC as an ALLY, stamped with the member it stands for', () => {
    addPartyMemberToOrder(npc())
    const row = st().combatants[0]
    expect(row.isAlly).toBe(true)
    expect(row.isPC).toBe(false)
    expect(row.partyMemberId).toBe('pl-blade')
    expect(row.creature?.name).toBe('Party Order Blade')
  })

  // Fails without the `already` check in addPartyMemberToOrder.
  it('adds a party NPC once, however many times it is asked', () => {
    addPartyMemberToOrder(npc())
    addPartyMemberToOrder(npc())
    expect(st().combatants).toHaveLength(1)
  })

  it('keeps the old name dedupe for rows from before the stamp, and lets a different same-named member in', () => {
    st().addCombatant(BLADE, { name: 'Hired Blade' }) // an unstamped row of that name (old board)
    addPartyMemberToOrder(npc())
    expect(st().combatants).toHaveLength(1)
    resetBoard()
    addPartyMemberToOrder(npc())
    addPartyMemberToOrder(npc({ id: 'pl-blade-2' })) // a second hireling who happens to share the name
    expect(st().combatants.map(c => c.partyMemberId)).toEqual(['pl-blade', 'pl-blade-2'])
  })

  // Refuter P2 (round 1): an NPC named after its own stat block, and a hostile copy of that creature
  // already on the board (RandomEncounterWidget / TextConverter / the bestiary add it under the
  // creature's name). The name-only dedupe refused the real NPC and the heal then read the hostile
  // row as the party member. Fails if addPartyMemberToOrder goes back to a plain name match, or if
  // encounter.looksLikePartyNpc drops its "named after its own block" refusal.
  it('a hostile copy of the creature an NPC is named after neither blocks the NPC nor stands in for it', () => {
    const GOB: Creature = { ...BLADE, id: 'party-order-gob', name: 'Order Gremlin', level: 1 }
    const gremlinNpc = npc({ id: 'pl-gob', name: 'Order Gremlin', creature: GOB })
    st().addCombatant(GOB) // hostile, named after the creature
    addPartyMemberToOrder(gremlinNpc)
    expect(st().combatants.map(c => [c.name, c.isAlly, c.partyMemberId ?? null]))
      .toEqual([['Order Gremlin', false, null], ['Order Gremlin', true, 'pl-gob']])
    expect(sidesOf(st().combatants, [gremlinNpc])).toEqual(['enemy', 'ally'])
    // …and with the NPC still on the party page, the hostile row alone is an enemy, not the NPC.
    resetBoard()
    st().addCombatant(GOB)
    expect(sidesOf(st().combatants, [gremlinNpc])).toEqual(['enemy'])
  })

  it('adds a PC as a PC, carrying the character and the member', () => {
    addPartyMemberToOrder(pcPlayer())
    addPartyMemberToOrder(pcPlayer()) // addCombatant's own isSamePc dedupe
    expect(st().combatants).toHaveLength(1)
    const row = st().combatants[0]
    expect([row.isPC, row.isAlly, row.charId, row.partyMemberId, row.maxHP]).toEqual([true, false, 'char-wren', 'pl-wren', 40])
  })
})

describe('the party-member stamp through everything a row goes through', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }))
    localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache(); resetBoard()
    expect(saveCustomCreature(BLADE)).toBe(true)
  })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache() })

  // Fails without `partyMemberId: undefined` in combatStore.duplicateCombatant. The copy keeps the
  // ally flag on purpose: it is one more allied creature in the fight and is rated as one, like any
  // stat-blocked ally — what it loses is the claim to BE the member, so removing the original and
  // adding the member again is not refused because of the copy.
  it('a duplicate is not the party member: the copy loses the stamp, stays an allied creature', () => {
    addPartyMemberToOrder(npc())
    st().duplicateCombatant(st().combatants[0].id)
    expect(st().combatants.map(c => c.partyMemberId)).toEqual(['pl-blade', undefined])
    expect(sidesOf(st().combatants, [npc()])).toEqual(['ally', 'ally'])
    st().removeCombatant(st().combatants[0].id)
    addPartyMemberToOrder(npc())
    expect(st().combatants.map(c => c.partyMemberId ?? null)).toEqual([null, 'pl-blade'])
  })

  // Refuter round 1: a hand-written save's `"partyMemberId": null` read as a stamp, so any row
  // loaded with it was rated as a party member. Fails without the typeof check in loadEncounter.
  it('a saved `partyMemberId: null` loads as no stamp, and the row is rated by what it is', () => {
    st().addCombatant(BLADE)
    st().saveEncounter('null stamp')
    const raw = JSON.parse(localStorage.getItem('pf2e-encounters') ?? '{}')
    raw['null stamp'].combatants[0].partyMemberId = null
    localStorage.setItem('pf2e-encounters', JSON.stringify(raw))
    resetBoard(); invalidateEncounterCache()
    st().loadEncounter('null stamp', new Map())
    expect(st().combatants[0].partyMemberId).toBeUndefined()
    expect(sidesOf(st().combatants)).toEqual(['enemy'])
  })

  // Refuter round 1: the stamp column made every board saved before it read as changed, so the
  // first Clear after the update asked about an untouched board. Fails if combatSignature writes
  // the stamp column for unstamped rows (`c.partyMemberId ?? ''`): an unstamped row keeps the
  // pre-stamp fingerprint's 14 fields.
  it('an unstamped board keeps the pre-stamp fingerprint, so an old save still reads unchanged', () => {
    st().addCombatant(BLADE)
    st().saveEncounter('old shape')
    expect(st().savedSignature!.split('§')).toHaveLength(14)
    resetBoard()
    addPartyMemberToOrder(npc())
    st().saveEncounter('stamped')
    expect(st().savedSignature!.split('§')).toHaveLength(15)
  })

  // Fails without `partyMemberId: slim.partyMemberId` in saveEncounter, or `partyMemberId:
  // sc.partyMemberId` in loadEncounter (each field is written by hand; a missing one is dropped).
  it('Save / Load Encounter keeps the stamp', () => {
    addPartyMemberToOrder(npc())
    st().saveEncounter('hireling')
    resetBoard(); invalidateEncounterCache()
    st().loadEncounter('hireling', new Map())
    expect(st().combatants.map(c => [c.partyMemberId, c.isAlly])).toEqual([['pl-blade', true]])
  })

  // Saved over the stamp: the board changed, so clearing it must ask (combatSignature).
  it('the "unchanged since save" signature notices the stamp', () => {
    addPartyMemberToOrder(npc())
    st().saveEncounter('hireling')
    expect(st().isEncounterUnchanged()).toBe(true)
    useCombatStore.setState(s => ({ combatants: s.combatants.map(c => ({ ...c, partyMemberId: 'someone-else' })) }))
    expect(st().isEncounterUnchanged()).toBe(false)
  })

  // Fails without the partyMemberId lines in encounterTransfer's toPortable or its import.
  it('export → import → load keeps the stamp', async () => {
    addPartyMemberToOrder(npc())
    st().saveEncounter('hireling')
    const file = buildExportPayload(['hireling'])
    expect(file.encounters[0].combatants[0].partyMemberId).toBe('pl-blade')
    file.encounters[0].name = 'hireling from file'
    resetBoard(); invalidateEncounterCache()
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.ok).toBe(true)
    st().loadEncounter('hireling from file', new Map())
    expect(st().combatants.map(c => c.partyMemberId)).toEqual(['pl-blade'])
  })
})

describe('the GM screen Treasure & XP widget reads the rating’s own table', () => {
  // Fails if GmWidgets keeps a private copy again (it had Low ±15, the legacy Core Rulebook's).
  it('Low is 60 ±20 per character (GM Core pg. 75), the same rows as the badge', () => {
    expect(XP_BUDGET).toBe(XP_BUDGET_ROWS)
    expect(XP_BUDGET.find(r => r[0] === 'Low')).toEqual(['Low', 60, 20])
  })
})
