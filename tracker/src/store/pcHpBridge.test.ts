// Owner's list 2026-10-14, item 5 ("two tracker HP syncs still match players by name instead of id").
//
// The tracker keeps a party card's HP bar and a PC row's HP in step both ways: damage or healing on the
// row reaches the card (combatStore syncPcHp → partyStore.syncCurrentHp), and a card's max HP reaches the
// row (partyStore.updatePcStats / importCharacter → combatStore.setPcMaxHP). Both matched by NAME, so two
// same-named characters wrote each other's HP. Both now ask one join, partyStore.partyCardOfRow: the row's
// party stamp first, then its character id, and its name only when neither side has an id and exactly
// one card answers. Neither is a GM vitals gesture (vitalsGesture.test.ts). Synthetic names only.
//
// Each leg names the line whose removal makes it fail.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCombatStore, invalidateEncounterCache } from './combatStore'
import { usePartyStore, addPartyMemberToOrder, type Party, type PartyPlayer } from './partyStore'

const st = () => useCombatStore.getState()
const party = () => usePartyStore.getState()

function resetBoard() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}
const card = (over: Partial<PartyPlayer> & { id: string; name: string }): PartyPlayer =>
  ({ notes: '', memberType: 'pc', pcStats: { maxHP: 40, hpCurrent: 40 }, ...over })
const partyOf = (id: string, players: PartyPlayer[], extra: Partial<Party> = {}): Party =>
  ({ id, name: `Party ${id}`, level: 3, isFavorite: false, players, ...extra })
/** A card as the store holds it now. */
const cardNow = (id: string) => party().parties.flatMap(p => p.players).find(p => p.id === id)!
const rowOf = (pred: (c: ReturnType<typeof st>['combatants'][number]) => boolean) => st().combatants.find(pred)!

describe('the tracker’s party-card HP bridge matches a PC by identity, never by a shared name', () => {
  beforeEach(() => { localStorage.clear(); invalidateEncounterCache(); resetBoard(); usePartyStore.setState({ parties: [], activePartyId: null }) })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache(); usePartyStore.setState({ parties: [], activePartyId: null }) })

  it('two same-named characters (two character ids): damage on one’s row reaches ONLY that one’s card', () => {
    /*
     * The rows are added the way the campaign card's "+" adds them: the character id, no party stamp.
     * MUTATION (tried 2026-10-14): in partyCardOfRow (partyStore.ts) make the character-id branch match by
     * name — `hits = pcs.filter(x => x.name.trim().toLowerCase() === row.name.trim().toLowerCase())` — and
     * this fails at “her own card” (expected 40 to be 31): both cards answer, so the bridge cannot tell.
     */
    usePartyStore.setState({
      parties: [partyOf('camp-party', [
        card({ id: 'pl-alpha-1', name: 'Synth Alpha', charId: 'char-alpha-1' }),
        card({ id: 'pl-alpha-2', name: 'Synth Alpha', charId: 'char-alpha-2' }),
      ], { campaignId: 'camp-probe' })],
      activePartyId: 'camp-party',
    })
    st().addCombatant(null, { name: 'Synth Alpha', isPC: true, maxHP: 40, charId: 'char-alpha-1' })
    st().addCombatant(null, { name: 'Synth Alpha', isPC: true, maxHP: 40, charId: 'char-alpha-2' })
    expect(st().combatants, 'fixture: two rows, two characters').toHaveLength(2)

    st().applyDamage(rowOf(c => c.charId === 'char-alpha-1').id, 9)
    expect(cardNow('pl-alpha-1').pcStats!.hpCurrent, 'her own card').toBe(31)
    expect(cardNow('pl-alpha-2').pcStats!.hpCurrent, 'the other Synth Alpha’s card is untouched').toBe(40)
  })

  it('the party stamp decides: a row added from the party reaches its own card even after a rename, never a namesake', () => {
    /*
     * Standalone cards carry no character id. The GM adds Probe Wren from the party, renames that card, and
     * adds another player called Probe Wren: the row's NAME now matches only the newcomer.
     * MUTATION (tried 2026-10-14): drop the `if (row.partyMemberId !== undefined) { … }` stamp branch at the
     * top of partyCardOfRow (partyStore.ts) → fails at “the card it was added for” (expected 40 to be 33).
     */
    const wren = card({ id: 'pl-wren', name: 'Probe Wren' })
    usePartyStore.setState({ parties: [partyOf('home', [wren])], activePartyId: 'home' })
    addPartyMemberToOrder(wren)
    party().updatePlayer('home', 'pl-wren', { name: 'Wren Ashford' })
    usePartyStore.setState(s => ({ parties: s.parties.map(p => ({ ...p, players: [...p.players, card({ id: 'pl-namesake', name: 'Probe Wren' })] })) }))

    st().applyDamage(rowOf(c => c.isPC).id, 7)
    expect(cardNow('pl-wren').pcStats!.hpCurrent, 'the card it was added for').toBe(33)
    expect(cardNow('pl-namesake').pcStats!.hpCurrent, 'never the namesake').toBe(40)
  })

  it('a max-HP change on one card never touches the other same-named character’s row', () => {
    /*
     * MUTATION (tried 2026-10-14): setPcMaxHP back to the first PC row of the card's NAME
     * (`combatants.find(c => c.isPC && c.name.toLowerCase() === <the card's name>)`, combatStore.ts) →
     * fails at “card B’s row” (expected 40 to be 55: card A's row took it); the two legs below fail too.
     */
    const a = card({ id: 'pl-alpha-1', name: 'Synth Alpha', charId: 'char-alpha-1' })
    const b = card({ id: 'pl-alpha-2', name: 'Synth Alpha', charId: 'char-alpha-2' })
    usePartyStore.setState({ parties: [partyOf('camp-party', [a, b], { campaignId: 'camp-probe' })], activePartyId: 'camp-party' })
    addPartyMemberToOrder(a)
    addPartyMemberToOrder(b)
    expect(st().combatants, 'fixture: two rows').toHaveLength(2)
    const rowA = () => rowOf(c => c.charId === 'char-alpha-1')
    const rowB = () => rowOf(c => c.charId === 'char-alpha-2')

    party().updatePcStats('camp-party', 'pl-alpha-2', { maxHP: 55 })   // card B, the SECOND of the two
    expect(rowB().maxHP, 'card B’s row').toBe(55)
    expect(rowA().maxHP, 'card A’s row is untouched').toBe(40)

    party().updatePcStats('camp-party', 'pl-alpha-1', { maxHP: 48 })   // and card A
    expect(rowA().maxHP).toBe(48)
    expect(rowB().maxHP, 'card B’s row keeps its own').toBe(55)
  })

  it('an old unlinked row (no ids) with a unique name still syncs both ways', () => {
    // Typed in by hand before Quick add linked, or saved before ids were kept: the name is all there is.
    usePartyStore.setState({ parties: [partyOf('home', [card({ id: 'pl-quill', name: 'Probe Quill' })])], activePartyId: null })
    st().addCombatant(null, { name: 'probe quill ', isPC: true, maxHP: 40 })
    const row = () => rowOf(c => c.isPC)
    expect([row().charId, row().partyMemberId], 'fixture: no ids').toEqual([undefined, undefined])

    st().applyDamage(row().id, 5)
    expect(cardNow('pl-quill').pcStats!.hpCurrent).toBe(35)
    party().updatePcStats('home', 'pl-quill', { maxHP: 50 })
    expect(row().maxHP).toBe(50)
  })

  it('two unlinked same-named cards and an unlinked row: nothing is written either way', () => {
    /*
     * The row is either card's, so it is neither's.
     * MUTATION (tried 2026-10-14): `return hits[0]` in place of `return hits.length === 1 ? hits[0] : undefined`
     * at the end of partyCardOfRow (partyStore.ts) → fails at “neither card” (expected [ 34, 40 ] to deeply
     * equal [ 40, 40 ]).
     */
    usePartyStore.setState({
      parties: [partyOf('home', [card({ id: 'pl-twin-1', name: 'Probe Twin' }), card({ id: 'pl-twin-2', name: 'Probe Twin' })])],
      activePartyId: 'home',
    })
    st().addCombatant(null, { name: 'Probe Twin', isPC: true, maxHP: 40 })
    const row = () => rowOf(c => c.isPC)

    st().applyDamage(row().id, 6)
    expect([cardNow('pl-twin-1').pcStats!.hpCurrent, cardNow('pl-twin-2').pcStats!.hpCurrent], 'neither card').toEqual([40, 40])
    party().updatePcStats('home', 'pl-twin-2', { maxHP: 60 })
    party().updatePcStats('home', 'pl-twin-1', { maxHP: 61 })
    expect(row().maxHP, 'and neither card’s max HP reaches the row').toBe(40)
  })

  it('a card with a character id is never matched by a row’s name alone', () => {
    // The rule's other half: by name ONLY when neither side has an id.
    usePartyStore.setState({ parties: [partyOf('camp-party', [card({ id: 'pl-alpha-1', name: 'Synth Alpha', charId: 'char-alpha-1' })], { campaignId: 'camp-probe' })], activePartyId: 'camp-party' })
    st().addCombatant(null, { name: 'Synth Alpha', isPC: true, maxHP: 40 })     // typed in by hand
    st().applyDamage(rowOf(c => c.isPC).id, 3)
    expect(cardNow('pl-alpha-1').pcStats!.hpCurrent).toBe(40)
  })
})
