import type React from 'react'
import { traitBaseName, traitDisplay } from '../utils/tags'
import { useGameData } from '../data/gameDataContext'
import { useWindowStore } from '../store/windowStore'
import { SIZES } from '../data/glossary'
import { GlossaryTerm } from './GlossaryTerm'

// ── Trait pill colour ──────────────────────────────────────────────────────
// Size traits get the gold accent treatment; everything else (rarity, type,
// alignment …) shares the muted pill so colour only encodes size.
function traitColorStyle(traitName: string): React.CSSProperties {
  const name = traitBaseName(traitName).toLowerCase()
  if (SIZES.has(name)) {
    return {
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      border: 'var(--app-bw) solid var(--accent-line)',
    }
  }
  return {
    background: 'var(--bg-elevated)',
    color: 'var(--text-muted)',
    border: 'var(--app-bw) solid var(--border)',
  }
}

// ── Color-coded creature trait pills ───────────────────────────────────────
// Renders a bare run of pills (the caller supplies the flex container). Size
// pills show their grid space (ft + m) on hover and open a reference window on
// click; other known traits open the trait reference. `compact` shrinks them
// for inline use in the HP / action bar.
export function TraitTags({ traits, compact, elite, weak }: {
  traits: string[]; compact?: boolean
  /** Show the Elite / Weak adjustment as a same-sized pill alongside traits. */
  elite?: boolean; weak?: boolean
}) {
  const { traits: traitsMap } = useGameData()
  const openWin = useWindowStore(s => s.open)
  if (!traits.length && !elite && !weak) return null

  const pillStyle = (colors: React.CSSProperties, cursor: string): React.CSSProperties => ({
    display: 'inline-block',
    fontFamily: 'var(--font-ui)',
    fontSize: compact ? 8 : 9, fontWeight: 700,
    padding: compact ? '1px 5px' : '2px 7px', borderRadius: 3,
    letterSpacing: '.05em', textTransform: 'uppercase',
    cursor,
    whiteSpace: 'nowrap',
    ...colors,
  })

  // Elite (green) / Weak (blue) adjustment pills — match label-elite/weak.
  const ELITE = { background: '#4a7a30', color: '#fff', border: 'var(--app-bw) solid #3a6024' }
  const WEAK = { background: '#3a6a9a', color: '#fff', border: 'var(--app-bw) solid #2a5278' }

  return (
    <>
      {elite && <span style={pillStyle(ELITE, 'default')}>Elite</span>}
      {weak && <span style={pillStyle(WEAK, 'default')}>Weak</span>}
      {traits.map(t => {
        const base = traitBaseName(t).toLowerCase()
        const display = traitDisplay(t)
        const colors = traitColorStyle(t)

        // Size pills — framed hover popup (grid space) + click-to-open window.
        if (SIZES.has(base)) {
          return <GlossaryTerm key={t} gkey={base} label={display} linkStyle={pillStyle(colors, 'pointer')} />
        }

        const tip = traitsMap.get(base)
        return (
          <span key={t}
            title={tip ? `Click to open ${display}` : undefined}
            onClick={tip ? e => { e.stopPropagation(); openWin('trait', base, display, e.clientX, e.clientY) } : undefined}
            style={pillStyle(colors, tip ? 'pointer' : 'default')}
          >{display}</span>
        )
      })}
    </>
  )
}
