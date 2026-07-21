import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { MonsterPartsMode } from '../store/settingsStore'

/*
 * Whether Battlezoo Monster Parts is in play, decided by the campaign rather than by a toggle here.
 *
 * WHY: the tracker had its own "Show Monster Parts value" switch, which meant a GM whose campaign
 * already runs the variant had to remember to turn it on in a second place — and could turn it on
 * for a campaign that doesn't use the rule at all. The campaign already knows; the tracker should
 * just ask.
 *
 * The MODE travels with the flag deliberately. The three variants' yields differ by up to 4x (a
 * level-10 monster is 125 gp on Light, 500 gp on Full), so a flag without a mode would show
 * confidently wrong numbers.
 *
 * DIRECTION OF DEPENDENCY (as partyLevelContext, for the same reason): declared HERE, provided by
 * Heroes Heaven. With no provider `useCampaignMonsterParts()` returns null and callers fall back to
 * the standalone tracker's own setting — which is why that setting still exists in the standalone
 * app and only disappears from Heroes Heaven's copy of the settings.
 */

export interface CampaignMonsterParts {
  /** The campaign's Battlezoo variant rule is on. */
  enabled: boolean
  /** Which variant's table to price monsters with. */
  mode: MonsterPartsMode
}

const Ctx = createContext<CampaignMonsterParts | null>(null)

export function CampaignMonsterPartsProvider({
  enabled,
  mode,
  children,
}: {
  enabled: boolean
  mode: MonsterPartsMode
  children: ReactNode
}) {
  const value = useMemo(() => ({ enabled, mode }), [enabled, mode])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The campaign's Monster Parts rule, or null when running standalone (→ use the local setting). */
export function useCampaignMonsterParts(): CampaignMonsterParts | null {
  return useContext(Ctx)
}
