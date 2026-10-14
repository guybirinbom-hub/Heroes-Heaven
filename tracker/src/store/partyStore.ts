import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Creature } from '../types/pf2e'
import type { PcStats, PcSkill, PcDetailConfig, ImportedSheet } from '../utils/pcDetail'
import type { ImportedCharacter } from '../utils/wanderersGuide'
import { useCombatStore } from './combatStore'
import { notifyPersist } from './persistBus'
import { isRowOfPartyNpc } from '../utils/encounter'

let _pid = 0, _plid = 0
const npid = () => `party-${Date.now()}-${++_pid}`
const nplid = () => `player-${Date.now()}-${++_plid}`

export interface PartyPlayer {
  id: string
  name: string
  notes: string
  memberType: 'pc' | 'npc'
  /** Stable Heroes Heaven character id, set for PCs mirrored from a campaign (see syncCampaignParty).
   *  Matching on this instead of the name is what lets a PC be renamed without losing its turn history
   *  and keeps two same-named PCs distinct. Undefined for hand-made standalone players. */
  charId?: string
  creature?: Creature | null   // NPCs only — linked stat block
  /** NPCs only: at 0 HP this member goes DOWN LIKE A PLAYER (Unconscious + Dying, keeps its turn)
   *  instead of being a defeated monster — "a party NPC keeps the setting until undone" (owner's list
   *  2026-10-01, item 2). Every row added for this member reads it LIVE (combatStore.downsAsPC), so
   *  the card's switch and the row menu's are one setting. Absent = off. */
  downsLikePC?: boolean
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
  /** Set when this party MIRRORS a Heroes Heaven campaign (embedded tracker). Its PC roster is
   *  kept in sync with the campaign's characters by `syncCampaignParty`; it exists so the tracker's
   *  own machinery (Add-to-Initiative, turn-timer "Save to Averages", per-player turn history) has a
   *  real party to work against. Undefined for hand-made standalone parties. */
  campaignId?: string
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
  /** Switch an NPC member's "at 0 HP: dying like a player" (keyed by player id alone — a row knows its
   *  member, not its party). Saved with the parties. Switched ON, every live row of that member that is
   *  already down is knocked out now (combatStore.knockOutPartyMember) — unless `knockOut` is false,
   *  which is the combat store's Undo / Redo putting the setting back with a board it restores whole.
   *  A PC member is left alone: a player character always goes down like one. */
  setPlayerDownsLikePC: (playerId: string, on: boolean, knockOut?: boolean) => void
  getSortedParties: () => Party[]
  findPlayerByName: (combatantName: string) => { party: Party; player: PartyPlayer } | null
  /** Cumulatively fold a batch of turn times into every party member whose
   *  name matches (case-insensitive). Used by the turn timer's Save to
   *  Averages. */
  addTurnsToPlayerByName: (name: string, sumSeconds: number, count: number) => void
  /** Push a PC row's CURRENT hp from the combat tracker back onto the party card that row IS
   *  (`partyCardOfRow`: its party stamp, then its character id, its name only when neither side has an
   *  id and exactly one card answers). Keeps the card's HP live as they take damage in a fight. No-op
   *  when no card answers, or the one that does has no stat sheet. */
  syncCurrentHp: (row: PcRowIds, hpCurrent: number) => void
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
  /** Mirror a Heroes Heaven campaign's PCs into the party tagged with `campaignId` (creating it if
   *  needed), so the tracker's own features have a party to act on. Upserts one PC player per member
   *  matched case-insensitively by name — PRESERVING any accumulated turnAvg/turnCount/turnHistory —
   *  sets each PC's maxHP, prunes PCs who left (keeping hand-added NPCs), makes it the active party,
   *  and returns its id. Called by the embed from the live campaign roster. */
  syncCampaignParty: (campaignId: string, campaignName: string, members: CampaignMember[]) => string
  /** The entry the campaign mirror keeps for this member, in the party of the campaign it last mirrored
   *  (`syncCampaignParty` — the campaign open in the host). When it is missing (the parties a GM device
   *  adopted from his other one predate the member, say) it is made NOW, exactly as the mirror makes it
   *  (`mirrorMember`; the party too, should that be the one missing), never anywhere else. Null when no
   *  campaign has been mirrored — the standalone tracker. For Quick add, so a member's name goes into the
   *  order the one way a party member does (`addPartyMemberToOrder`). */
  ensureCampaignMember: (member: CampaignMember) => PartyPlayer | null
  /** Re-read the parties out of localStorage — another of this GM's devices wrote a newer copy and the
   *  mirror (src/data/trackerSync.ts) put it there. Keeps the active party selected when it survived. */
  reloadFromStorage: () => void
}

/**
 * THE ONE WAY a party member enters the initiative order. The party page's "Add to Initiative" and
 * the Add-combatants dialog's "Party Members" rows both call this, so the two routes can't disagree
 * again: the dialog's copy left the ally flag off, and a party NPC added from it was rated as an
 * ENEMY (its XP added to the fight, left out of the party) while the same NPC added from the party
 * page was rated as one of the party (owner's list 2026-10-01, item 5).
 *
 *  - NPC: one row per party member — skipped when its row is already in the order
 *    (encounter.isRowOfPartyNpc: a row stamped with this member, or an older unstamped row of its
 *    name that is plainly it — never a hostile copy of the creature it is named after). Added as an
 *    ALLY, stamped with the member's id. Its level is its stat block's (encounter.partyOf).
 *  - PC: addCombatant's own dedupe decides (isSamePc: charId first, the name only when a side has
 *    none); stamped with the member's id too.
 *
 * Reads the order fresh on every call, so a batch (the whole party, a cart) sees its own adds.
 */
export function addPartyMemberToOrder(pl: PartyPlayer): void {
  const combat = useCombatStore.getState()
  if (pl.memberType === 'npc') {
    const already = combat.combatants.some(c => isRowOfPartyNpc(c, pl))
    if (already) return
    combat.addCombatant(pl.creature ?? null, { name: pl.name, isPC: false, isAlly: true, partyMemberId: pl.id })
  } else {
    combat.addCombatant(null, { name: pl.name, isPC: true, maxHP: pl.pcStats?.maxHP, charId: pl.charId, partyMemberId: pl.id })
  }
}

/** A PC row's identity, as the board keeps it (a Combatant has all three). */
export interface PcRowIds { name: string; charId?: string; partyMemberId?: string }

/**
 * WHICH PARTY CARD A PC ROW IS — for the tracker's own HP bridge between the board and the party cards:
 * combatStore's syncPcHp (the row's HP onto the card, `syncCurrentHp`) and setPcMaxHP (a card's max HP
 * onto its row) both ask THIS, so a card and a row can never disagree about whose HP they share.
 *  1. The row's party stamp (`partyMemberId`, set on every add from the party): that member, in
 *     whichever party holds it.
 *  2. Else its character id: the one PC card carrying that id, in the active party (in every party
 *     while none is active) — none when two answer.
 *  3. Else, for a row with NO id at all (typed in by hand, saved before ids were kept), its name — only
 *     against a card with no character id either, and only when exactly ONE card answers.
 * Anything else answers nothing, and nothing is written. It used to be the name alone, so two
 * same-named characters wrote each other's HP bars (owner's list item 5, 2026-10-14).
 */
export function partyCardOfRow(row: PcRowIds, parties: readonly Party[], activePartyId: string | null): PartyPlayer | undefined {
  if (row.partyMemberId !== undefined) {
    for (const p of parties) {
      const pl = p.players.find(x => x.id === row.partyMemberId)
      if (pl) return pl.memberType === 'npc' ? undefined : pl
    }
    // A stamp whose member left every party: the character id below may still say who it is.
  }
  const scope = activePartyId ? parties.filter(p => p.id === activePartyId) : parties
  const pcs = scope.flatMap(p => p.players).filter(x => x.memberType !== 'npc')
  let hits: PartyPlayer[]
  if (row.charId !== undefined) hits = pcs.filter(x => x.charId === row.charId)
  else if (row.partyMemberId !== undefined) return undefined   // a stamped row is nobody's by name
  else {
    const lower = row.name.trim().toLowerCase()
    hits = pcs.filter(x => x.charId === undefined && x.name.trim().toLowerCase() === lower)
  }
  return hits.length === 1 ? hits[0] : undefined
}

/** Where a card sits in `parties` ([party, player]), by identity — so a write lands on that very card. */
function locate(parties: readonly Party[], card: PartyPlayer): [number, number] | null {
  for (let i = 0; i < parties.length; i++) {
    const j = parties[i].players.indexOf(card)
    if (j >= 0) return [i, j]
  }
  return null
}

/** A Heroes Heaven campaign's player character, as the host hands it to the mirror. */
export interface CampaignMember { charId: string; name: string; maxHP?: number }

/** The campaign `syncCampaignParty` mirrored last — the one open in the host, which runs it as the
 *  campaign opens and whenever its roster changes — for `ensureCampaignMember`. */
let _mirrored: { campaignId: string; campaignName: string } | null = null

/**
 * THE ONE WAY the campaign mirror makes or updates a member's entry in the campaign's party `p` (an immer
 * draft): matched on the stable character id, so a RENAMED PC keeps its turn history and two PCs that
 * share a name stay distinct; else a pre-charId PC of that name adopted once and stamped with the id;
 * else made. Takes the member's current name and max HP. syncCampaignParty runs it for every member,
 * ensureCampaignMember for one.
 */
function mirrorMember(p: Party, m: CampaignMember): PartyPlayer {
  const lower = m.name.trim().toLowerCase()
  let pl = p.players.find(x => x.memberType !== 'npc' && x.charId === m.charId)
  if (!pl) pl = p.players.find(x => x.memberType !== 'npc' && x.charId === undefined && x.name.trim().toLowerCase() === lower)
  if (!pl) {
    pl = { id: nplid(), name: m.name, notes: '', memberType: 'pc', charId: m.charId }
    p.players.push(pl)
  } else {
    pl.charId = m.charId
    pl.name = m.name // adopt the current name in place (handles a rename)
  }
  if (typeof m.maxHP === 'number') pl.pcStats = { ...(pl.pcStats ?? {}), maxHP: m.maxHP }
  return pl
}

/** A campaign's mirrored party, made the way syncCampaignParty makes it (and made active, as it is). */
function newCampaignParty(campaignId: string, campaignName: string): Party {
  return { id: npid(), name: campaignName, level: 1, players: [], isFavorite: false, campaignId }
}

function saveToStorage(parties: Party[]) {
  try { localStorage.setItem('pf2e-parties', JSON.stringify(parties)) } catch { /**/ }
  notifyPersist('pf2e-parties')
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

  setPlayerDownsLikePC(playerId, on, knockOut = true) {
    let changed = false
    set(s => {
      for (const p of s.parties) {
        for (const pl of p.players) {
          if (pl.id !== playerId || pl.memberType !== 'npc' || !!pl.downsLikePC === on) continue
          if (on) pl.downsLikePC = true
          else delete pl.downsLikePC
          changed = true
        }
      }
    })
    if (!changed) return
    saveToStorage(get().parties)
    if (on && knockOut) useCombatStore.getState().knockOutPartyMember(playerId)
  },

  getSortedParties() { return sortParties(get().parties) },

  findPlayerByName(combatantName) {
    const lower = combatantName.toLowerCase()
    // Prefer a real PC over a hand-added NPC that happens to share the name (an NPC "Kyra" must not
    // shadow the PC "Kyra" and bind the combat-detail panel to the wrong one). Fall back to an NPC
    // match only if no PC matches.
    let npcFallback: { party: Party; player: PartyPlayer } | null = null
    for (const party of get().parties) {
      for (const player of party.players) {
        if (player.name.toLowerCase() !== lower) continue
        if (player.memberType !== 'npc') return { party, player }
        npcFallback ??= { party, player }
      }
    }
    return npcFallback
  },

  addTurnsToPlayerByName(name, sumSeconds, count) {
    if (count <= 0) return
    const lower = name.trim().toLowerCase()
    set(s => {
      // Scope to the ACTIVE party when there is one, so a PC name that also exists in another party
      // (e.g. a standalone party + the campaign mirror) doesn't get the same turn batch folded in twice.
      // Falls back to all parties only when nothing is active (a standalone with no active selection).
      const parties = s.activePartyId ? s.parties.filter(p => p.id === s.activePartyId) : s.parties
      for (const party of parties) {
        for (const pl of party.players) {
          // Turn averages are a PC stat — a hand-added NPC that happens to share a PC's name must not
          // absorb the PC's turns.
          if (pl.memberType === 'npc') continue
          if (pl.name.trim().toLowerCase() !== lower) continue
          const oldAvg = pl.turnAvgSeconds ?? 0
          const oldCount = pl.turnCount ?? 0
          const newCount = oldCount + count
          pl.turnAvgSeconds = (oldAvg * oldCount + sumSeconds) / newCount
          pl.turnCount = newCount
          // Append this session's average as a dated timeline point, capped so a long-lived party's
          // blob can't grow without bound (the per-day graph only ever shows a handful of recent days).
          if (!pl.turnHistory) pl.turnHistory = []
          pl.turnHistory.push({ at: Date.now(), avgSeconds: sumSeconds / count, turnCount: count })
          if (pl.turnHistory.length > 500) pl.turnHistory = pl.turnHistory.slice(-500)
        }
      }
    })
    saveToStorage(get().parties)
  },

  syncCurrentHp(row, hpCurrent) {
    // The ONE card this row is (partyCardOfRow) — never every card that shares its name. Only a PC that
    // already has a stat sheet shows an HP bar to update.
    const { parties, activePartyId } = get()
    const card = partyCardOfRow(row, parties, activePartyId)
    if (!card?.pcStats || card.pcStats.hpCurrent === hpCurrent) return
    const at = locate(parties, card)
    if (!at) return
    set(s => {
      const pl = s.parties[at[0]].players[at[1]]
      if (pl.pcStats) pl.pcStats.hpCurrent = hpCurrent
    })
    saveToStorage(get().parties)
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
    let found = false
    set(s => {
      const pl = s.parties.find(p => p.id === partyId)?.players.find(pl => pl.id === playerId)
      if (!pl) return
      pl.pcStats = { ...(pl.pcStats ?? {}), ...patch }
      found = true
    })
    saveToStorage(get().parties)
    // Keep an in-combat copy of this PC's HP bar in step with the sheet — the row that IS this card
    // (partyCardOfRow), never another character's row of the same name.
    if (found && typeof patch.maxHP === 'number') useCombatStore.getState().setPcMaxHP({ id: playerId }, patch.maxHP)
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
    // If this PC is already in the tracker, refresh its HP bar from the import — the row that IS this
    // card (partyCardOfRow), never another character's row of the same name.
    if (result.playerId && typeof parsed.pcStats?.maxHP === 'number') useCombatStore.getState().setPcMaxHP({ id: result.playerId }, parsed.pcStats.maxHP)
    return result
  },

  syncCampaignParty(campaignId, campaignName, members) {
    let partyId = ''
    _mirrored = { campaignId, campaignName }
    set(s => {
      let p = s.parties.find(pp => pp.campaignId === campaignId)
      if (!p) {
        p = newCampaignParty(campaignId, campaignName)
        s.parties.push(p)
      } else {
        p.name = campaignName
      }
      partyId = p.id
      /*
       * TWO DEVICES, ONE CAMPAIGN, TWO PARTIES.
       *
       * Each device minted its own id for this campaign's party (npid() above), so when the GM mirror
       * meets `pf2e-parties` for the first time and unions the two copies BY ID, both survive with the
       * same campaignId. Everything that resolves a campaign to its party takes the first match —
       * `partyId` in the seam, and the find above — so the other device's NPCs, per-player notes and
       * turn history sat in storage where nothing could reach them.
       *
       * Fold them into the one we keep rather than dropping them: a player already here (by charId, or
       * by name for hand-added NPCs) wins, everyone else comes across. This runs on every open, so a
       * device heals itself the next time the GM opens the campaign.
       */
      const party = p
      const dupes = s.parties.filter(pp => pp.campaignId === campaignId && pp.id !== party.id)
      for (const d of dupes) {
        for (const pl of d.players) {
          const lower = pl.name.trim().toLowerCase()
          const here = party.players.find(x =>
            pl.charId !== undefined && x.charId !== undefined
              ? x.charId === pl.charId
              : x.memberType === pl.memberType && x.name.trim().toLowerCase() === lower)
          if (!here) party.players.push(pl)
        }
      }
      if (dupes.length) s.parties = s.parties.filter(pp => pp.campaignId !== campaignId || pp.id === party.id)
      const wantedIds = new Set(members.map(m => m.charId))
      // Prune PCs whose character left the campaign — matched by stable charId, NOT name. Keep any NPCs
      // the GM added by hand, and (back-compat) any PC player that predates charId tracking, so a first
      // sync after upgrading doesn't discard its accumulated turn history.
      p.players = p.players.filter(pl => pl.memberType === 'npc' || pl.charId === undefined || wantedIds.has(pl.charId))
      for (const m of members) mirrorMember(p, m)
      s.activePartyId = partyId
    })
    saveToStorage(get().parties)
    return partyId
  },

  ensureCampaignMember(m) {
    const mirror = _mirrored
    if (!mirror) return null
    const entry = () => get().parties.find(pp => pp.campaignId === mirror.campaignId)
      ?.players.find(x => x.memberType !== 'npc' && x.charId === m.charId) ?? null
    const have = entry()
    if (have) return have
    set(s => {
      let p = s.parties.find(pp => pp.campaignId === mirror.campaignId)
      if (!p) {
        p = newCampaignParty(mirror.campaignId, mirror.campaignName)
        s.parties.push(p)
        s.activePartyId = p.id
      }
      mirrorMember(p, m)
    })
    saveToStorage(get().parties)
    return entry()
  },

  reloadFromStorage() {
    const parties = loadFromStorage()
    set(s => {
      s.parties = parties
      if (s.activePartyId && !parties.some(p => p.id === s.activePartyId)) s.activePartyId = null
    })
  },
})))
