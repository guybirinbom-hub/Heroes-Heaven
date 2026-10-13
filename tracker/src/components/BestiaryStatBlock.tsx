import { useEffect, useMemo, useState } from 'react'
import { loadCreatureByName } from '../data/dataStore'
import { useCombatStore } from '../store/combatStore'
import type { Combatant, Creature } from '../types/pf2e'
import { StatBlock } from './StatBlock'
import { ErrorBoundary } from './ErrorBoundary'

/*
 * A BESTIARY CREATURE IN A WINDOW — the full stat block, and a way into the fight.
 *
 * The owner, 2026-10-01 (item 7): "if i search a stat block it needs to open the full stat block (and
 * there needs to be able to put it in the initiative order)". A creature opened as a window — a Search
 * result, or a click on a creature named in prose — used to show the compact card a hover preview
 * shows (AC, saves, HP, attacks). It now draws the same <StatBlock> a combatant's pane draws, with
 * every HP pool on its own line (no HP bar beside it here), its rolls, checks and reference popups.
 * A creature pinned to the GM screen, or a creature window docked into a layout, is a 'bestiary' pane
 * tab (windowStore toLayoutTab) and draws this same block.
 *
 * It is NOT a combatant: nothing here is on the board, so the block is drawn from a stand-in whose id
 * no board row can have, and as `notOnBoard` — its use trackers (an ability's "1/day", spell slots,
 * focus points) are drawn as the counts they are, not as pips and − / + / ↺ buttons that would find no
 * row to write to and do nothing, and a cooldown's dice are plain dice. Rolls go to the dice log as from
 * any stat block. The row "Add to initiative" makes is the one that tracks uses.
 *
 * "Add to initiative" adds exactly ONE row per press — the creature, through the store's own
 * addCombatant, the way the bestiary picker and the random-encounter table add one — and brings that
 * row into view in the initiative order. Pressing it again adds another (a second goblin is a real
 * request); the line beside the button says how many this window has added.
 *
 * Wrapped in the tracker's ErrorBoundary: a stat block the renderer cannot draw fails inside this
 * window, never the campaign around it (the same guard the Custom preview has).
 */

/** An id no board row can have (board ids are `cmb-N`). */
const standInId = (name: string) => `bestiary:${name}`

/** Read defensively: this runs OUTSIDE the ErrorBoundary below, and a homebrew record can hold anything. */
function standIn(c: Creature, name: string): Combatant {
  const hp = Number((c.defenses as { hp?: unknown } | undefined)?.hp) || 0
  return {
    id: standInId(name), name: String(c.name ?? name), creature: c, isPC: false, isAlly: false, initiative: null,
    currentHP: hp, maxHP: hp, tempHP: 0, conditions: [],
    isElite: false, isWeak: false, notes: '', isDefeated: false,
  }
}

/** The new row, in view: the initiative list draws the board in store order and a new row is the last. */
function revealNewRow(): void {
  const rows = document.querySelectorAll<HTMLElement>('.init-row')
  rows[rows.length - 1]?.scrollIntoView?.({ block: 'nearest' })
}

export function BestiaryStatBlock({ name }: { name: string }) {
  const [loaded, setLoaded] = useState<{ c: Creature | null; done: boolean }>({ c: null, done: false })
  const [added, setAdded] = useState(0)
  useEffect(() => {
    let alive = true
    setLoaded({ c: null, done: false })
    setAdded(0)
    loadCreatureByName(name).then(c => { if (alive) setLoaded({ c, done: true }) }, () => { if (alive) setLoaded({ c: null, done: true }) })
    return () => { alive = false }
  }, [name])
  const shown = useMemo(() => (loaded.c ? standIn(loaded.c, name) : null), [loaded.c, name])

  if (!loaded.done) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12, padding: '14px 18px', margin: 0 }}>Loading…</p>
  const c = loaded.c
  if (!c || !shown) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12, padding: '14px 18px', margin: 0 }}>Creature not found.</p>

  const label = shown.name
  const addToInitiative = () => {
    useCombatStore.getState().addCombatant(c)
    setAdded(n => n + 1)
    // After React has drawn the new row.
    setTimeout(revealNewRow, 0)
  }

  return (
    <div data-bestiary-block={name}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 14px', borderBottom: 'var(--app-bw) solid var(--border)',
        background: 'var(--bg-elevated)',
      }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={addToInitiative}
          title={`Add ${label} to the initiative order — one row per press`}>
          Add to initiative
        </button>
        {added > 0 && (
          <span role="status" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {added === 1 ? `${label} is in the initiative order.` : `${added} × ${label} added to the initiative order.`}
          </span>
        )}
      </div>
      <ErrorBoundary label="this stat block" resetKeys={[name]}>
        <StatBlock combatant={shown} notOnBoard />
      </ErrorBoundary>
    </div>
  )
}
