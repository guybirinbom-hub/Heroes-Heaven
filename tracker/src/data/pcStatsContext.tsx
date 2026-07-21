import { createContext, useContext, type ReactNode } from 'react'
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
 * no provider `usePcStats()` returns null and every caller falls back to the party store exactly as
 * before, so the standalone tracker is unchanged.
 *
 * Keyed by lower-cased name — the same join the initiative order already uses to find a PC's party
 * entry (`partyStore` matches combatants to players by name).
 */

const Ctx = createContext<Map<string, PcStats> | null>(null)

export function CampaignPcStatsProvider({ byName, children }: { byName: Map<string, PcStats>; children: ReactNode }) {
  return <Ctx.Provider value={byName}>{children}</Ctx.Provider>
}

/** Look up a PC's host-provided stats by name, or null when running standalone. */
export function useHostPcStats(name: string): PcStats | null {
  const map = useContext(Ctx)
  if (!map) return null
  return map.get(name.trim().toLowerCase()) ?? null
}
