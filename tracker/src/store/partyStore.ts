import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Creature } from '../types/pf2e'
import type { PcStats, PcSkill, PcDetailConfig, ImportedSheet } from '../utils/pcDetail'
import type { ImportedCharacter } from '../utils/wanderersGuide'
import { useCombatStore } from './combatStore'

let _pid = 0, _plid = 0
const npid = () => `party-${Date.now()}-${++_pid}`
const nplid = () => `player-${Date.now()}-${++_plid}`

export interface PartyPlayer {
  id: string
  name: string
  notes: string
  memberType: 'pc' | 'npc'
  creature?: Creature | null   // NPCs only — linked stat block
  /** Cumulative turn-time average (seconds) folded in via the turn timer's
   *  "Save to Averages". Paired with turnCount so new batches weight right. */
  turnAvgSeconds?: number
  turnCount?: number
  /** One dated point per "Save to Averages" — the average of that saved
   *  session. Drives the per-player turn-time timeline. */
  turnHistory?: Array<{ at: number; avgSeconds: number; turnCount: number }>
  /** Optional PF2e stat sheet for PCs (shown per the party's detail level). */
  pcStats?: PcStats
  /** Full sheet from a Wanderer's Guide import — kept even when the detail
   *  level hides most of it, so nothing is lost. */
  pcSheet?: ImportedSheet
}

export interface Party {
  id: string
  name: string
  level: number
  players: PartyPlayer[]
  isFavorite: boolean
  /** Per-party override of the global PC detail level. Undefined = use the
   *  global default from settings. */
  pcDetail?: PcDetailConfig
}

interface PartyStore {
  parties: Party[]
  activePartyId: string | null
  addParty: (name: string, level: number) => string
  removeParty: (id: string) => void
  updateParty: (id: string, updates: Partial<Pick<Party, 'name' | 'level'>>) => void
  toggleFavorite: (id: string) => void
  setActiveParty: (id: string | null) => void
  addPlayer: (partyId: string) => void
  addNPC: (partyId: string, creature?: Creature | null) => void
  removePlayer: (partyId: string, playerId: string) => void
  updatePlayer: (partyId: string, playerId: string, updates: Partial<Pick<PartyPlayer, 'name' | 'notes' | 'creature'>>) => void
  getSortedParties: () => Party[]
  findPlayerByName: (combatantName: string) => { party: Party; player: PartyPlayer } | null
  /** Cumulatively fold a batch of turn times into every party member whose
   *  name matches (case-insensitive). Used by the turn timer's Save to
   *  Averages. */
  addTurnsToPlayerByName: (name: string, sumSeconds: number, count: number) => void
  /** Push a PC's CURRENT hp from the combat tracker back onto their party-card
   *  sheet (matched by name). Keeps the card's HP live as they take damage in a
   *  fight. No-op if no matching PC has a stat sheet. */
  syncCurrentHpByName: (name: string, hpCurrent: number) => void
  /** Clear a single player's stored turn average. */
  resetPlayerAverage: (partyId: string, playerId: string) => void
  /** Merge a patch into a PC's stat sheet. */
  updatePcStats: (partyId: string, playerId: string, patch: Partial<PcStats>) => void
  /** Merge a patch into one of a PC's skills. */
  updatePcSkill: (partyId: string, playerId: string, skill: string, patch: Partial<PcSkill>) => void
  /** Set (or clear, with null) a party's PC-detail override. */
  setPartyDetail: (partyId: string, config: PcDetailConfig | null) => void
  /** Import a parsed character into a party. If a PC with the same name (case-
   *  insensitive) already exists there, its stats/sheet are updated in place;
   *  otherwise a new PC is added. Returns whether it matched and the player id. */
  importCharacter: (partyId: string, parsed: ImportedCharacter) => { matched: boolean; playerId: string }
}

function saveToStorage(parties: Party[]) {
  try { localStorage.setItem('pf2e-parties', JSON.stringify(parties)) } catch { /**/ }
}

function loadFromStorage(): Party[] {
  try {
    const raw = JSON.parse(localStorage.getItem('pf2e-parties') ?? '[]') as Party[]
    // Back-compat: old entries have no memberType
    return raw.map(party => ({
      ...party,
      players: party.players.map(pl => ({
        ...pl,
        memberType: (pl.memberType ?? 'pc') as 'pc' | 'npc',
      })),
    }))
  } catch { return [] }
}

function sortParties(parties: Party[]): Party[] {
  const favs = parties.filter(p => p.isFavorite).sort((a, b) => a.name.localeCompare(b.name))
  const rest = parties.filter(p => !p.isFavorite).sort((a, b) => a.name.localeCompare(b.name))
  return [...favs, ...rest]
}

export const usePartyStore = create<PartyStore>()(immer((set, get) => ({
  parties: loadFromStorage(),
  activePartyId: null,

  addParty(name, level) {
    const id = npid()
    set(s => { s.parties.push({ id, name, level, players: [], isFavorite: false }) })
    saveToStorage(get().parties)
    return id
  },

  removeParty(id) {
    set(s => {
      s.parties = s.parties.filter(p => p.id !== id)
      if (s.activePartyId === id) s.activePartyId = null
    })
    saveToStorage(get().parties)
  },

  updateParty(id, updates) {
    set(s => {
      const p = s.parties.find(p => p.id === id)
      if (!p) return
      if (updates.name !== undefined) p.name = updates.name
      if (updates.level !== undefined) p.level = updates.level
    })
    saveToStorage(get().parties)
  },

  toggleFavorite(id) {
    set(s => {
      const p = s.parties.find(p => p.id === id)
      if (p) p.isFavorite = !p.isFavorite
    })
    saveToStorage(get().parties)
  },

  setActiveParty(id) {
    set(s => { s.activePartyId = s.activePartyId === id ? null : id })
  },

  addPlayer(partyId) {
    set(s => {
      const p = s.parties.find(p => p.id === partyId)
      if (p) p.players.push({ id: nplid(), name: 'New Player', notes: '', memberType: 'pc' })
    })
    saveToStorage(get().parties)
  },

  addNPC(partyId, creature) {
    set(s => {
      const p = s.parties.find(p => p.id === partyId)
      if (p) p.players.push({
        id: nplid(),
        name: creature?.name ?? 'NPC',
        notes: '',
        memberType: 'npc',
        creature: creature ?? null,
      })
    })
    saveToStorage(get().parties)
  },

  removePlayer(partyId, playerId) {
    set(s => {
      const p = s.parties.find(p => p.id === partyId)
      if (p) p.players = p.players.filter(pl => pl.id !== playerId)
    })
    saveToStorage(get().parties)
  },

  updatePlayer(partyId, playerId, updates) {
    set(s => {
      const p = s.parties.find(p => p.id === partyId)
      const pl = p?.players.find(pl => pl.id === playerId)
      if (!pl) return
      if (updates.name !== undefined) pl.name = updates.name
      if (updates.notes !== undefined) pl.notes = updates.notes
      if ('creature' in updates) pl.creature = updates.creature
    })
    saveToStorage(get().parties)
  },

  getSortedParties() { return sortParties(get().parties) },

  findPlayerByName(combatantName) {
    const lower = combatantName.toLowerCase()
    for (const party of get().parties) {
      const player = party.players.find(pl => pl.name.toLowerCase() === lower)
      if (player) return { party, player }
    }
    return null
  },

  addTurnsToPlayerByName(name, sumSeconds, count) {
    if (count <= 0) return
    const lower = name.trim().toLowerCase()
    set(s => {
      for (const party of s.parties) {
        for (const pl of party.players) {
          if (pl.name.trim().toLowerCase() !== lower) continue
          const oldAvg = pl.turnAvgSeconds ?? 0
          const oldCount = pl.turnCount ?? 0
          const newCount = oldCount + count
          pl.turnAvgSeconds = (oldAvg * oldCount + sumSeconds) / newCount
          pl.turnCount = newCount
          // Append this session's average as a dated timeline point.
          if (!pl.turnHistory) pl.turnHistory = []
          pl.turnHistory.push({ at: Date.now(), avgSeconds: sumSeconds / count, turnCount: count })
        }
      }
    })
    saveToStorage(get().parties)
  },

  syncCurrentHpByName(name, hpCurrent) {
    const lower = name.trim().toLowerCase()
    let changed = false
    set(s => {
      for (const party of s.parties) {
        for (const pl of party.players) {
          // Only PCs that already have a stat sheet show an HP bar to update.
          if (pl.memberType === 'npc' || !pl.pcStats || pl.name.trim().toLowerCase() !== lower) continue
          if (pl.pcStats.hpCurrent !== hpCurrent) { pl.pcStats.hpCurrent = hpCurrent; changed = true }
        }
      }
    })
    if (changed) saveToStorage(get().parties)
  },

  resetPlayerAverage(partyId, playerId) {
    set(s => {
      const pl = s.parties.find(p => p.id === partyId)?.players.find(pl => pl.id === playerId)
      if (!pl) return
      pl.turnAvgSeconds = undefined
      pl.turnCount = undefined
      pl.turnHistory = undefined
    })
    saveToStorage(get().parties)
  },

  updatePcStats(partyId, playerId, patch) {
    let pcName: string | undefined
    set(s => {
      const pl = s.parties.find(p => p.id === partyId)?.players.find(pl => pl.id === playerId)
      if (!pl) return
      pl.pcStats = { ...(pl.pcStats ?? {}), ...patch }
      pcName = pl.name
    })
    saveToStorage(get().parties)
    // Keep an in-combat copy of this PC's HP bar in step with the sheet.
    if (pcName && typeof patch.maxHP === 'number') useCombatStore.getState().setPcMaxHP(pcName, patch.maxHP)
  },

  updatePcSkill(partyId, playerId, skill, patch) {
    set(s => {
      const pl = s.parties.find(p => p.id === partyId)?.players.find(pl => pl.id === playerId)
      if (!pl) return
      if (!pl.pcStats) pl.pcStats = {}
      if (!pl.pcStats.skills) pl.pcStats.skills = {}
      pl.pcStats.skills[skill] = { ...(pl.pcStats.skills[skill] ?? {}), ...patch }
    })
    saveToStorage(get().parties)
  },

  setPartyDetail(partyId, config) {
    set(s => {
      const p = s.parties.find(p => p.id === partyId)
      if (!p) return
      if (config === null) p.pcDetail = undefined
      else p.pcDetail = config
    })
    saveToStorage(get().parties)
  },

  importCharacter(partyId, parsed) {
    let result = { matched: false, playerId: '' }
    set(s => {
      const p = s.parties.find(p => p.id === partyId)
      if (!p) return
      const lower = parsed.name.trim().toLowerCase()
      // Match an existing PC by name (NPCs keep their linked stat block).
      const existing = p.players.find(pl => pl.memberType !== 'npc' && pl.name.trim().toLowerCase() === lower)
      if (existing) {
        existing.name = parsed.name        // adopt the export's exact casing
        existing.memberType = 'pc'
        existing.pcStats = parsed.pcStats
        existing.pcSheet = parsed.sheet
        result = { matched: true, playerId: existing.id }
      } else {
        const id = nplid()
        p.players.push({
          id, name: parsed.name, notes: '', memberType: 'pc',
          pcStats: parsed.pcStats, pcSheet: parsed.sheet,
        })
        result = { matched: false, playerId: id }
      }
    })
    saveToStorage(get().parties)
    // If this PC is already in the tracker, refresh its HP bar from the import.
    if (typeof parsed.pcStats?.maxHP === 'number') useCombatStore.getState().setPcMaxHP(parsed.name, parsed.pcStats.maxHP)
    return result
  },
})))
