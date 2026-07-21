import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { derivePartyLevel } from '../utils/partyLevel'

/*
 * Who the party actually IS, when something outside the tracker knows better.
 *
 * Standalone, the tracker's own party store is the source of truth. Mounted inside a Heroes Heaven
 * campaign it ISN'T: the party is the campaign's characters, which have real, live levels the
 * tracker has no other way to see. Without this the tracker fell back to a typed number that
 * defaulted to 1, and rated a level-3 party's encounters against a level-1 budget.
 *
 * DIRECTION OF DEPENDENCY (the point of doing it this way): the context is declared HERE, in the
 * tracker, and Heroes Heaven merely provides a value. The tracker never imports from HH, so it
 * still builds and runs standalone with no provider at all — `useCampaignPartyLevel()` just returns
 * null and every caller keeps its existing behaviour. That's what keeps the integration removable.
 */

const Ctx = createContext<number | null>(null)

/**
 * Supply the party level from real character levels. Pass the level of each PC; the provider
 * derives the single number encounter building needs.
 */
export function CampaignPartyLevelProvider({ levels, children }: { levels: readonly number[]; children: ReactNode }) {
  // Levels is a fresh array every render, so key the memo on the values, not the identity.
  const key = levels.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const level = useMemo(() => derivePartyLevel(levels), [key])
  return <Ctx.Provider value={level}>{children}</Ctx.Provider>
}

/**
 * The party level dictated by the host app's real characters, or null when the tracker is running
 * on its own (or the campaign has no characters yet) — in which case the caller's own party data
 * stands.
 */
export function useCampaignPartyLevel(): number | null {
  return useContext(Ctx)
}
