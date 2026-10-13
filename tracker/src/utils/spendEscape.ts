import type { KeyboardEvent } from 'react'

/**
 * ESCAPE IN A TRACKER TEXT BOX IS SPENT IN THE BOX.
 *
 * Inside Heroes Heaven an Escape that bubbles out of the tracker reaches the host's dismiss stack, whose
 * campaign handler finds no popup on <body> for a box inside the tracker and LEAVES THE CAMPAIGN (the
 * local table: the whole page). Found 2026-10-10 in the initiative row's rename and number boxes, then
 * (2026-10-11) in the stat block's HP boxes and notes boxes and the party card's name and notes boxes.
 *
 * A box calls this from its onKeyDown: an Escape goes no further, and `then` does what Escape means in
 * that box (cancel the edit, clear it, or just leave the box). Answers whether the key was Escape.
 *
 * The general rule — the host ignoring an Escape typed in a text field — belongs in the host's base
 * handler (src/integration/CampaignTracker.tsx); until it is there, each box spends its own.
 */
export function spendEscape(e: KeyboardEvent, then?: () => void): boolean {
  if (e.key !== 'Escape') return false
  e.stopPropagation()
  then?.()
  return true
}

/** For a box whose every keystroke is already kept (a notes box): Escape just leaves the box. */
export function escapeLeavesBox(e: KeyboardEvent<HTMLElement>): void {
  const box = e.currentTarget
  spendEscape(e, () => box.blur())
}
