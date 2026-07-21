import { createContext, useContext, type ReactNode } from 'react'
import type { Combatant } from '../types/pf2e'

/*
 * Let the host app render a PC's pane its own way.
 *
 * A pane tab for a creature is a CombatantDetail — the tracker's stat block, which is exactly right
 * for a monster. But a PC in a Heroes Heaven campaign is a real character HH already knows how to
 * render far better than the tracker can: the full, editable character sheet. Without this hook the
 * tab system could only ever show a PC the tracker's thin copy of them.
 *
 * DIRECTION OF DEPENDENCY (same as partyLevelContext, and for the same reason): the context is
 * declared HERE and HH merely supplies a renderer. The tracker never imports from HH, so with no
 * provider `usePcPaneRenderer()` returns null, PaneLayout falls back to CombatantDetail for
 * everyone, and the standalone tracker behaves exactly as it always has.
 *
 * Returning `null` from the renderer also falls back — so HH can decline a PC it doesn't recognise
 * (a combatant named for someone who isn't one of the campaign's characters) without the pane
 * rendering nothing.
 */

/** The pane chrome CombatantDetail would have drawn, handed over so the host can draw it instead. */
export interface PcPaneHandles {
  onClose?: () => void
  dockHandle?: ReactNode
  onHeaderDrag?: (e: React.MouseEvent) => void
}

export type PcPaneRenderer = (combatant: Combatant, handles: PcPaneHandles) => ReactNode | null

const Ctx = createContext<PcPaneRenderer | null>(null)

export function CampaignPcPaneProvider({ render, children }: { render: PcPaneRenderer; children: ReactNode }) {
  return <Ctx.Provider value={render}>{children}</Ctx.Provider>
}

/** The host's PC renderer, or null when running standalone. */
export function usePcPaneRenderer(): PcPaneRenderer | null {
  return useContext(Ctx)
}
