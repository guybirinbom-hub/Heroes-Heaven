import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { PcStats } from '../utils/pcDetail'

/*
 * A PC's real stats, when the host app knows them.
 *
 * The initiative order can already show a PC's AC and saves (the "Show player AC & saves" setting) —
 * but only from `PartyPlayer.pcStats`, which the DM types or imports. Inside a Heroes Heaven campaign
 * the PCs are real characters that already HAVE those numbers; this hands them over so the setting
 * works without anyone re-entering a sheet.
 *
 * DIRECTION OF DEPENDENCY (as the other tracker/data contexts): declared HERE, provided by HH. With
 * no provider every hook below answers null / nothing and every caller falls back to the party store
 * exactly as before, so the standalone tracker is unchanged.
 *
 * WHICH CHARACTER. The tracker's own PC join (combatStore `isSamePc`): a row that carries a character
 * id is that character, whatever either side is called now — so a GM renaming the row, or the player
 * renaming their character, keeps the link. Only a row with no id (typed in by hand, saved before ids
 * were kept) falls back to its lower-cased name.
 *
 * Besides the numbers the host can hand over (all optional, all display only):
 *  - `badgesById`: what the player's sheet WORKS OUT rather than stores — Encumbered from Bulk, the
 *    conditions an active mode grants, and the active modes themselves. The row draws them locked;
 *    they are never written into the row's conditions (they go when their cause goes).
 *  - `folded`: does the host's stats already count this condition? A host that derives AC and saves
 *    from the live sheet has the sheet's conditions inside those numbers, so the row must not take the
 *    tracker's own penalty for the same badge a second time.
 *  - `members`: the campaign's player characters, so a name typed into Quick add is that PC, linked.
 */

/** A badge the host's sheet works out for a PC — shown on the row, locked, never a row condition. */
export interface HostPcBadge {
  kind: 'condition' | 'mode'
  /** Display name ("Encumbered", a mode's name). */
  name: string
  value?: number
  /** Where it comes from (the sheet's own cause) — the badge's tooltip. */
  title?: string
}

/** A player character of the host's campaign — for Quick add. */
export interface HostPcMember { charId: string; name: string; maxHP?: number }

interface HostPcs {
  byName: Map<string, PcStats>
  byId?: Map<string, PcStats>
  badgesById?: Map<string, HostPcBadge[]>
  folded?: (conditionName: string) => boolean
  members?: HostPcMember[]
}

const Ctx = createContext<HostPcs | null>(null)

export function CampaignPcStatsProvider({ byName, byId, badgesById, folded, members, children }: {
  byName: Map<string, PcStats>
  byId?: Map<string, PcStats>
  badgesById?: Map<string, HostPcBadge[]>
  folded?: (conditionName: string) => boolean
  members?: HostPcMember[]
  children: ReactNode
}) {
  const value = useMemo(() => ({ byName, byId, badgesById, folded, members }), [byName, byId, badgesById, folded, members])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The tracker's PC join over the host's maps: the character id when the row has one (and the host keys
 *  by id), else the lower-cased name. */
function lookup<T>(byId: Map<string, T> | undefined, byName: Map<string, T> | undefined, name: string, charId?: string): T | undefined {
  if (charId !== undefined && byId) return byId.get(charId)
  return byName?.get(name.trim().toLowerCase())
}

/** Look up a PC's host-provided stats — by its character id, else by name — or null when running
 *  standalone. */
export function useHostPcStats(name: string, charId?: string): PcStats | null {
  const h = useContext(Ctx)
  if (!h) return null
  return lookup(h.byId, h.byName, name, charId) ?? null
}

/**
 * A PC's level as the host's sheet has it, for every PC row at once — the encounter rating counts
 * each PC in the order at their own level (owner's list 2026-10-01, item 5). Joined like
 * useHostPcStats (character id first). Undefined for a character the host doesn't know and for every
 * one when running standalone, where the caller's fallback (the typed party level) stands.
 */
export function useHostPcLevel(): (name: string, charId?: string) => number | undefined {
  const h = useContext(Ctx)
  return (name: string, charId?: string) => (h ? lookup(h.byId, h.byName, name, charId)?.level : undefined)
}

const NO_BADGES: HostPcBadge[] = []

/** The locked badges the host's sheet works out for this PC (see HostPcBadge) — none standalone. Joined
 *  like useHostPcStats: the row's character id, else the member of that name. */
export function useHostPcBadges(name: string, charId?: string): HostPcBadge[] {
  const h = useContext(Ctx)
  if (!h?.badgesById) return NO_BADGES
  const lower = name.trim().toLowerCase()
  const id = charId ?? h.members?.find(m => m.name.trim().toLowerCase() === lower)?.charId
  return (id !== undefined ? h.badgesById.get(id) : undefined) ?? NO_BADGES
}

/** Does the host's stats already count this condition (by the row's condition name)? Null standalone,
 *  and for a host that did not say — then every condition is the tracker's to count. */
export function useHostConditionFolded(): ((conditionName: string) => boolean) | null {
  return useContext(Ctx)?.folded ?? null
}

/** The host campaign's player characters (Quick add links a name typed there), or null standalone. */
export function useHostPcMembers(): HostPcMember[] | null {
  return useContext(Ctx)?.members ?? null
}
