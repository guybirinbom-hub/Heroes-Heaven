// Owner's list 2026-10-01, item 5: a party NPC added from the Add-combatants dialog was rated as an
// ENEMY, while the same NPC added from the party page's "Add to Initiative" was rated as one of the
// party. Both routes now go through ONE add (partyStore.addPartyMemberToOrder), which flags the NPC
// as an ally and stamps the row with the member it was added for (partyMemberId). The stamp has to
// survive everything a row goes through — save / load, the portable file — and must NOT survive a
// duplicate (the copy is another allied creature, not that member). Synthetic names only.
//
// Each test names the line whose removal makes it fail.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCombatStore, invalidateEncounterCache, downsAsPC, isDeadNpc, clearedByClearDefeated, downedMarker } from './combatStore'
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

// Owner's list 2026-10-01, item 2: "Right-click on a stat block → treat like a player when at 0 HP; a
// party NPC keeps the setting until undone." The setting of a party NPC lives on the MEMBER and every
// row of that member reads it live (combatStore.downsAsPC) — so the card's switch and the row menu's
// are one setting, and no Undo, Redo or board from another device can put a stale copy back. The
// row-level half (knock-out, turn order, death) is in combatStore.transitions.test.ts.
describe('"at 0 HP: dying like a player" — kept on a party NPC', () => {
  const party = (pl: PartyPlayer) => ({ id: 'party-order', name: 'Order Party', level: 5, isFavorite: false, players: [pl] })
  const member = () => usePartyStore.getState().parties[0].players[0]
  const rowOf = () => st().combatants.find(c => c.partyMemberId === 'pl-blade')!
  beforeEach(() => {
    localStorage.clear(); invalidateEncounterCache(); resetBoard()
    usePartyStore.setState({ parties: [party(npc())], activePartyId: null })
  })
  afterEach(() => { localStorage.clear(); usePartyStore.setState({ parties: [], activePartyId: null }) })

  // Fails if downsAsPC stops reading the member (`return !!c.downsLikePC` alone): the card's switch
  // never reaches the row in the fight.
  it('the switch on the card reaches the live row at once, is saved, and seeds the next add', () => {
    addPartyMemberToOrder(member())
    expect(downsAsPC(rowOf())).toBe(false)
    usePartyStore.getState().setPlayerDownsLikePC('pl-blade', true)
    expect(member().downsLikePC).toBe(true)
    expect(downsAsPC(rowOf())).toBe(true)
    expect(rowOf().downsLikePC, 'nothing is copied onto the row').toBeUndefined()
    expect(JSON.parse(localStorage.getItem('pf2e-parties') ?? '[]')[0].players[0].downsLikePC).toBe(true)
    // "keeps the setting until undone": a later fight's row goes down like a player from the start.
    st().removeCombatant(rowOf().id)
    addPartyMemberToOrder(member())
    expect(downsAsPC(rowOf())).toBe(true)
  })

  // Fails without the `if (member) { …setPlayerDownsLikePC…; return }` branch of setDownsLikePC: the
  // switch lands on the row as an undo step, the member never hears of it, and the Undo below takes
  // the SWITCH back instead of the damage.
  it('the switch on the ROW sets the member and is no undo step: Undo takes back the damage before it, never the setting', () => {
    addPartyMemberToOrder(member())
    const full = rowOf().currentHP
    st().applyDamage(rowOf().id, 3)
    st().setDownsLikePC(rowOf().id, true)
    expect(member().downsLikePC).toBe(true)
    st().undo()                                         // not a no-op: the damage comes back off…
    expect(rowOf().currentHP).toBe(full)
    expect(member().downsLikePC).toBe(true)             // …and the setting stays
    expect(downsAsPC(rowOf())).toBe(true)
    st().setDownsLikePC(rowOf().id, false)
    expect(member().downsLikePC).toBeUndefined()
    expect(downsAsPC(rowOf())).toBe(false)
  })

  // Fails without `if (on && knockOut) useCombatStore.getState().knockOutPartyMember(playerId)` in the
  // party setter: switched on from the card, a party NPC already at 0 HP stays a beaten monster.
  // Tried 2026-10-11, each alone, each FAILS here: knockOutPartyMember's `record(s, { id: memberId,
  // downsLikePC: false })` → `record(s)` ("the setting comes back off with the board: expected true to be
  // undefined"); undo() without `restoreMemberDowns(member)` (same); redo() without it ("expected undefined
  // to be true"); undo()'s redo entry without its `member` ("expected undefined to be true"); redo()'s undo
  // entry without its `member` ("expected true to be undefined", on the second Undo).
  it('switched on from the card while its row is already down, the row goes Dying now — Undo takes back both, Redo puts back both', () => {
    addPartyMemberToOrder(member())
    st().applyDamage(rowOf().id, 9999)                  // a beaten monster: no conditions
    expect(rowOf().conditions).toEqual([])
    usePartyStore.getState().setPlayerDownsLikePC('pl-blade', true)
    expect(rowOf().conditions.map(c => c.name).sort()).toEqual(['dying', 'unconscious'])
    // The switch and the knock-out it made are one gesture. Undo leaves no half of it behind — a row
    // at 0 HP with no Dying whose member still goes down like a player would have lost the knock-out
    // the switch made and kept the switch (until 2026-10-13 it even kept its turn, and Clear Defeated
    // left it; it now reads as a beaten creature — the leg "…from ANOTHER device while its row is a
    // beaten monster…" below).
    st().undo()
    expect(rowOf().conditions).toEqual([])
    expect(member().downsLikePC, 'the setting comes back off with the board').toBeUndefined()
    expect(downsAsPC(rowOf())).toBe(false)
    expect(clearedByClearDefeated(rowOf()), 'a beaten monster again: Clear Defeated takes it').toBe(true)
    expect(JSON.parse(localStorage.getItem('pf2e-parties') ?? '[]')[0].players[0].downsLikePC, 'and saved so').toBeUndefined()
    st().redo()
    expect(member().downsLikePC).toBe(true)
    expect(rowOf().conditions.map(c => c.name).sort()).toEqual(['dying', 'unconscious'])
    // …and once more round the loop: the stacks keep carrying the setting.
    st().undo()
    expect(member().downsLikePC).toBeUndefined()
    st().redo()
    expect(member().downsLikePC).toBe(true)
  })

  // Only the step the switch made carries the setting. MUTATION (undo(): take the member from ANY step on
  // the stack — `_undoStack.find(x => x.member)?.member` — tried 2026-10-11): FAILS — "expected undefined
  // to be true" (Undo of the rat's damage switched the hireling off).
  it('an unrelated Undo after the card’s knock-out leaves the setting alone', () => {
    addPartyMemberToOrder(member())
    st().addCombatant(null, { name: 'Bog Rat', maxHP: 10 })
    st().applyDamage(rowOf().id, 9999)
    usePartyStore.getState().setPlayerDownsLikePC('pl-blade', true)  // knocks the row out (one step)
    st().applyDamage(st().combatants.find(c => c.name === 'Bog Rat')!.id, 3)
    st().undo()                                                       // takes back the rat's 3 only
    expect(st().combatants.find(c => c.name === 'Bog Rat')!.currentHP).toBe(10)
    expect(member().downsLikePC).toBe(true)
    expect(rowOf().conditions.map(c => c.name).sort()).toEqual(['dying', 'unconscious'])
  })

  // MUTATION (knockOutPartyMember: drop `|| (isDeadNpc(c) && !c.isDefeated)` from its row pick; separately,
  // drop its `settleDeath(…)` — tried 2026-10-11): each FAILS — "expected false to be true".
  it('switched on from the card while its row already carries Dying at its death value, the row is dead — and defeated', () => {
    addPartyMemberToOrder(member())
    st().addCondition(rowOf().id, { name: 'dying', value: 4, isPermanent: true })  // only a badge on a monster
    expect(rowOf().isDefeated).toBe(false)
    usePartyStore.getState().setPlayerDownsLikePC('pl-blade', true)
    expect(isDeadNpc(rowOf())).toBe(true)
    expect(rowOf().isDefeated).toBe(true)
    st().undo()
    expect(rowOf().isDefeated).toBe(false)
    expect(member().downsLikePC).toBeUndefined()
  })

  // MUTATION (clearedByClearDefeated: drop `if (isDeadNpc(c)) return true`, tried 2026-10-11): FAILS —
  // "expected 'Hired Blade' to be 'Bog Rat'" (a dead row nobody settled took a turn).
  it('a setting that arrives from ANOTHER device (no switch here) still makes a row at its death value skipped and cleared', () => {
    // The parties sync in whole; nothing on this side runs the switch, so nothing settles the row. The
    // turn advance and Clear Defeated read death from the conditions themselves.
    addPartyMemberToOrder(member())
    st().setInitiative(rowOf().id, 10)
    st().addCombatant(null, { name: 'Bog Rat', maxHP: 10, initiative: 20 })
    st().addCondition(rowOf().id, { name: 'dying', value: 4, isPermanent: true })
    usePartyStore.setState({ parties: [party(npc({ downsLikePC: true }))], activePartyId: null })
    expect(isDeadNpc(rowOf())).toBe(true)
    expect(rowOf().isDefeated, 'unsettled: a load is not an edit').toBe(false)
    st().startCombat()
    expect(st().combatants[st().activeIndex].name).toBe('Bog Rat')
    st().nextTurn()                                       // Bog Rat → the dead row is skipped → wrap
    expect(st().combatants[st().activeIndex].name).toBe('Bog Rat')
    st().removeDefeated()
    expect(st().combatants.map(c => c.name)).toEqual(['Bog Rat'])
  })

  // The round-3 refuter's probe T2 (2026-10-13): the setting arrives by the party sync (or was switched
  // while another campaign's board was loaded) — nothing here knocks the row out — while the row is a
  // monster already beaten at 0 HP. It never went down like a player, so it stays a beaten creature:
  // before, it TOOK TURNS with no Dying and no marker, and Clear Defeated left it.
  // MUTATION (clearedByClearDefeated: its last line `return !c.conditions.some(…'dying'…'unconscious'…)`
  // → `return false`, tried 2026-10-13): FAILS — "expected false to be true".
  it('a setting that arrives from ANOTHER device while its row is a beaten monster at 0 HP leaves it beaten: skipped and cleared', () => {
    addPartyMemberToOrder(member())
    st().setInitiative(rowOf().id, 10)
    st().addCombatant(null, { name: 'Bog Rat', maxHP: 10, initiative: 20 })
    st().applyDamage(rowOf().id, 9999)                    // a beaten monster: no conditions
    usePartyStore.setState({ parties: [party(npc({ downsLikePC: true }))], activePartyId: null })
    expect(downsAsPC(rowOf())).toBe(true)
    expect(rowOf().conditions, 'unsettled: a load is not an edit').toEqual([])
    expect(downedMarker(rowOf()), 'no DYING marker on a creature with no Dying').toBeNull()
    expect(clearedByClearDefeated(rowOf())).toBe(true)
    st().startCombat()
    expect(st().combatants[st().activeIndex].name).toBe('Bog Rat')
    st().nextTurn()                                       // Bog Rat → the beaten row is skipped → wrap
    expect(st().combatants[st().activeIndex].name).toBe('Bog Rat')
    st().removeDefeated()
    expect(st().combatants.map(c => c.name)).toEqual(['Bog Rat'])
  })

  // The round-4 refuter's probe PD (2026-10-13): that beaten row, hit by the GM, went Unconscious + Dying 1
  // and took turns again — in its OLD seat. It never went down like a player before, so this hit is its
  // first fall, and "the tracker moves a downed creature before whoever's turn it is".
  // MUTATION (combatStore wasUpBeforeHit: its last line → `return false`, tried 2026-10-13): FAILS here alone
  // — "its first fall moves it: expected [ 'Marsh Hag', 'Bog Rat', …(1) ] to deeply equal [ 'Marsh Hag',
  // 'Hired Blade', …(1) ]".
  it('…and a hit on that beaten row is its FIRST fall: it goes Dying and moves before the acting creature, onto its count', () => {
    addPartyMemberToOrder(member())
    st().setInitiative(rowOf().id, 10)
    st().addCombatant(null, { name: 'Bog Rat', maxHP: 10, initiative: 20 })
    st().addCombatant(null, { name: 'Marsh Hag', maxHP: 10, initiative: 30 })
    st().applyDamage(rowOf().id, 9999)                    // a beaten monster: no conditions
    usePartyStore.setState({ parties: [party(npc({ downsLikePC: true }))], activePartyId: null })
    st().startCombat()                                    // the Marsh Hag acts
    st().nextTurn()                                       // → the Bog Rat acts
    expect(st().combatants[st().activeIndex].name).toBe('Bog Rat')
    st().applyDamage(rowOf().id, 5)
    expect(rowOf().conditions.map(c => c.name).sort()).toEqual(['dying', 'unconscious'])
    expect(st().combatants.map(c => c.name), 'its first fall moves it').toEqual(['Marsh Hag', rowOf().name, 'Bog Rat'])
    expect(rowOf().initiative, 'onto the Bog Rat’s count').toBe(20)
    expect(st().combatants[st().activeIndex].name).toBe('Bog Rat')
    expect(clearedByClearDefeated(rowOf()), 'down and dying: in the fight').toBe(false)
  })

  // Fails without `downsLikePC: downsAsPC(src) ? true : undefined` in duplicateCombatant (the copy
  // starts as a plain monster), or if the copy kept the member's id (its switch would change the member).
  it('a copy starts out going down like the original, and its own switch is its own', () => {
    usePartyStore.setState({ parties: [party(npc({ downsLikePC: true }))], activePartyId: null })
    addPartyMemberToOrder(member())
    st().duplicateCombatant(rowOf().id)
    const copy = st().combatants.find(c => c.partyMemberId === undefined)!
    expect(downsAsPC(copy)).toBe(true)
    st().setDownsLikePC(copy.id, false)
    expect(downsAsPC(st().combatants.find(c => c.id === copy.id)!)).toBe(false)
    expect(member().downsLikePC).toBe(true)
    expect(downsAsPC(rowOf())).toBe(true)
  })
})

describe('a row’s own "dying like a player" through everything a row goes through', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }))
    localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache(); resetBoard()
    usePartyStore.setState({ parties: [], activePartyId: null })
    expect(saveCustomCreature(BLADE)).toBe(true)
  })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache() })

  // Fails without `downsLikePC: slim.downsLikePC ? true : undefined` in saveEncounter, or the
  // `sc.downsLikePC === true` line in loadEncounter (each field is copied by hand).
  it('Save / Load Encounter keeps it', () => {
    st().addCombatant(BLADE)
    st().setDownsLikePC(st().combatants[0].id, true)
    st().saveEncounter('flagged blade')
    resetBoard(); invalidateEncounterCache()
    st().loadEncounter('flagged blade', new Map())
    expect(st().combatants[0].downsLikePC).toBe(true)
    expect(downsAsPC(st().combatants[0])).toBe(true)
  })

  // Fails without the downsLikePC lines in encounterTransfer's toPortable or its import.
  it('export → import → load keeps it', async () => {
    st().addCombatant(BLADE)
    st().setDownsLikePC(st().combatants[0].id, true)
    st().saveEncounter('flagged blade')
    const file = buildExportPayload(['flagged blade'])
    expect(file.encounters[0].combatants[0].downsLikePC).toBe(true)
    file.encounters[0].name = 'flagged blade from file'
    resetBoard(); invalidateEncounterCache()
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.ok).toBe(true)
    st().loadEncounter('flagged blade from file', new Map())
    expect(st().combatants[0].downsLikePC).toBe(true)
  })

  // Fails without the `downs-like-pc` column in combatSignature (switching it after a save reads as
  // "unchanged", so Clear would wipe it without asking); an unflagged row keeps the old 14 fields.
  it('the "unchanged since save" signature notices it, and an unflagged board keeps its old fingerprint', () => {
    st().addCombatant(BLADE)
    st().saveEncounter('plain')
    expect(st().savedSignature!.split('§')).toHaveLength(14)
    st().setDownsLikePC(st().combatants[0].id, true)
    expect(st().isEncounterUnchanged()).toBe(false)
  })
})

describe('the GM screen Treasure & XP widget reads the rating’s own table', () => {
  // Fails if GmWidgets keeps a private copy again (it had Low ±15, the legacy Core Rulebook's).
  it('Low is 60 ±20 per character (GM Core pg. 75), the same rows as the badge', () => {
    expect(XP_BUDGET).toBe(XP_BUDGET_ROWS)
    expect(XP_BUDGET.find(r => r[0] === 'Low')).toEqual(['Low', 60, 20])
  })
})
