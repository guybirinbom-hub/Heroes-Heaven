// Bestiary corpus fix round 4, D19: Elite / Weak / scaled HP through the portable encounter file.
//
// The file carries names, not stat blocks; the importer resolves each name (homebrew first, then the
// bestiary) and stores the encounter, and Load Encounter puts it on the board. An Elite combatant
// has to come back with the Elite maximum it had on the board.
//
// Each test says what it fails without.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCombatStore, invalidateEncounterCache, readEncounterStore } from '../store/combatStore'
import { buildExportPayload, importEncountersFromText, type PortableEncounterFile } from './encounterTransfer'
import { saveCustomCreature, reloadCustomCreatures } from '../data/dataStore'
import { SAMPLE_COMBATANT } from '../data/sampleStatBlock'
import { scaleByLevel } from './weakElite'
import type { Creature } from '../types/pf2e'

const st = () => useCombatStore.getState()

function resetBoard() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}

// A homebrew stat block, so the importer resolves the name without the bestiary (fetch is stubbed
// to a 404: no index, as on a device whose data failed to load). Level 14, 300 HP: Elite 320,
// Weak 280.
const WYRM: Creature = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'transfer-wyrm', name: 'Transfer Wyrm' }
delete (WYRM as { raw?: unknown }).raw

describe('the encounter file keeps an adjusted combatant\'s HP maximum', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }))
    localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache(); resetBoard()
    expect(saveCustomCreature(WYRM)).toBe(true)
  })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache() })

  function boardOf(how: Array<'elite' | 'weak' | number | null>): number[] {
    for (const h of how) {
      st().addCombatant(WYRM)
      const id = st().combatants[st().combatants.length - 1].id
      if (h === 'elite' || h === 'weak') st().setEliteWeak(id, h)
      else if (typeof h === 'number') st().setScaledLevel(id, h)
    }
    return st().combatants.map(c => c.maxHP)
  }

  // Fails without the loadEncounter fix in combatStore.ts: the file-loaded maxima read 300 each.
  it('export → import → load: Elite, Weak and scaled combatants come back with the board maxima', async () => {
    const board = boardOf(['elite', 'weak', 17, null])
    expect(board).toEqual([320, 280, scaleByLevel(WYRM, 17).defenses.hp, 300])
    st().saveEncounter('ambush')
    const file = buildExportPayload(['ambush'])
    file.encounters[0].name = 'ambush from file'
    resetBoard(); invalidateEncounterCache()
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.ok && imp.missing.length === 0).toBe(true)
    st().loadEncounter('ambush from file', new Map())
    expect(st().combatants.map(c => [c.maxHP, c.currentHP])).toEqual(board.map(hp => [hp, hp]))
  })

  // Fails without the importer fix in encounterTransfer.ts: a file with no maxHP for an Elite
  // combatant (hand-written, or from a build that left the field out) stored the PRINTED 300 as its
  // maximum, and exporting that encounter again wrote 300 into the next file.
  it('a file without maxHP stores the adjusted maximum, and a re-export carries it', async () => {
    const file: PortableEncounterFile = {
      version: 1, exportedAt: '2026-10-07T00:00:00.000Z',
      encounters: [{
        name: 'no max', savedAt: '2026-10-07T00:00:00.000Z',
        combatants: [
          { name: 'Transfer Wyrm', creatureName: 'Transfer Wyrm', isPC: false, isElite: true, isWeak: false, notes: '' },
          { name: 'Transfer Wyrm', creatureName: 'Transfer Wyrm', isPC: false, isElite: false, isWeak: true, notes: '' },
          { name: 'Transfer Wyrm', creatureName: 'Transfer Wyrm', isPC: false, isElite: false, isWeak: false, scaledToLevel: 17, notes: '' },
        ] as never,
      }],
    }
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.ok).toBe(true)
    const want = [320, 280, scaleByLevel(WYRM, 17).defenses.hp]
    expect(readEncounterStore()['no max'].combatants.map(c => c.maxHP)).toEqual(want)
    expect(buildExportPayload(['no max']).encounters[0].combatants.map(c => c.maxHP)).toEqual(want)
    st().loadEncounter('no max', new Map())
    expect(st().combatants.map(c => c.maxHP)).toEqual(want)
  })

  // Mutation proof (round 5): a file whose resolved Elite / Weak / scaled rows carry the PRINTED 300 —
  // a save the old load made (base HP bar), saved again and exported — stores and re-exports the
  // adjusted maxima. Fails when the importer prefers the file's maxHP over the adjusted stat block
  // (the mutation `typeof sc.maxHP === 'number' ? sc.maxHP : adjusted` left every other test green).
  it('a file carrying the printed maxHP for an adjusted row stores the adjusted maximum', async () => {
    const row = (how: { isElite?: boolean; isWeak?: boolean; scaledToLevel?: number }) => ({
      name: 'Transfer Wyrm', creatureName: 'Transfer Wyrm', isPC: false, isAlly: false, maxHP: 300,
      isElite: !!how.isElite, isWeak: !!how.isWeak, scaledToLevel: how.scaledToLevel ?? null, notes: '',
    })
    const file: PortableEncounterFile = {
      version: 1, exportedAt: '2026-10-07T00:00:00.000Z',
      encounters: [{
        name: 'stale max', savedAt: '2026-10-07T00:00:00.000Z',
        combatants: [row({ isElite: true }), row({ isWeak: true }), row({ scaledToLevel: 17 }), row({})] as never,
      }],
    }
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.ok && imp.missing.length === 0).toBe(true)
    const want = [320, 280, scaleByLevel(WYRM, 17).defenses.hp, 300]
    expect(readEncounterStore()['stale max'].combatants.map(c => c.maxHP)).toEqual(want)
    expect(buildExportPayload(['stale max']).encounters[0].combatants.map(c => c.maxHP)).toEqual(want)
  })

  // Passes before and after (the edge the fix must keep): a name-only row (a PC, or a creature the
  // device cannot resolve) keeps the file's maxHP.
  it('a row with no stat block keeps the file\'s maxHP', async () => {
    const file: PortableEncounterFile = {
      version: 1, exportedAt: '2026-10-07T00:00:00.000Z',
      encounters: [{
        name: 'pcs', savedAt: '2026-10-07T00:00:00.000Z',
        combatants: [
          { name: 'Hero', creatureName: null, isPC: true, maxHP: 42, isElite: false, isWeak: false, notes: '' },
          { name: 'Ghost', creatureName: 'Nobody Knows This', isPC: false, maxHP: 77, isElite: true, isWeak: false, notes: '' },
        ],
      }],
    }
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.missing.map(m => m.creature)).toEqual(['Nobody Knows This'])
    st().loadEncounter('pcs', new Map())
    expect(st().combatants.map(c => [c.name, c.maxHP])).toEqual([['Hero', 42], ['Ghost', 77]])
  })

  // Round 5 (refute-4 finding): a hazard whose page prints no HP, exported Elite / Weak / scaled
  // and imported, stores and loads no HP (0), as the board shows it. Fails without the hp > 0 guard
  // in weakElite.ts: the importer stored Elite 15 / Weak 1 / a scaled number and the load drew a bar.
  it('a hazard with no HP comes through the file with no HP', async () => {
    const haunt: Creature = { ...JSON.parse(JSON.stringify(WYRM)), id: 'transfer-haunt', name: 'Transfer Haunt', level: 4, isHazard: true }
    haunt.defenses = { ...haunt.defenses, hp: 0, acPrinted: false, savesPrinted: ['will'] }
    expect(saveCustomCreature(haunt)).toBe(true)
    for (const h of ['elite', 'weak', 6] as const) {
      st().addCombatant(haunt)
      const id = st().combatants[st().combatants.length - 1].id
      if (h === 'elite' || h === 'weak') st().setEliteWeak(id, h)
      else st().setScaledLevel(id, h)
    }
    expect(st().combatants.map(c => c.maxHP)).toEqual([0, 0, 0])
    st().saveEncounter('haunts')
    const file = buildExportPayload(['haunts'])
    file.encounters[0].name = 'haunts from file'
    // A file that names no maxHP takes the adjusted one too.
    for (const c of file.encounters[0].combatants) delete (c as { maxHP?: number }).maxHP
    resetBoard(); invalidateEncounterCache()
    const imp = await importEncountersFromText(JSON.stringify(file))
    expect(imp.ok && imp.missing.length === 0).toBe(true)
    expect(readEncounterStore()['haunts from file'].combatants.map(c => c.maxHP)).toEqual([0, 0, 0])
    st().loadEncounter('haunts from file', new Map())
    expect(st().combatants.map(c => [c.maxHP, c.currentHP])).toEqual([[0, 0], [0, 0], [0, 0]])
  })
})
