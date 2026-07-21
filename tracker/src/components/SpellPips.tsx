import type { SpellIndicator } from '../store/settingsStore'

// A row of clickable slot pips. The rightmost `used` pips read as spent; the
// rest are available. Clicking sets the spent/available boundary at that pip:
//   • click an available pip → spend it and everything to its right
//   • click a spent pip      → refund it and everything to its left
// Shape (diamond / dot / battery / check / ring / hex) comes from CSS via the
// `ind-${indicator}` class. `lock` renders a non-interactive sample (legend).
export function SpellPips({ total, used, onChange, indicator, lock, title }: {
  total: number
  used: number
  onChange?: (used: number) => void
  indicator: SpellIndicator
  lock?: boolean
  title?: string
}) {
  const clamp = (n: number) => Math.max(0, Math.min(total, n))
  const click = (idx: number, spent: boolean) => {
    if (lock || !onChange) return
    onChange(clamp(spent ? total - idx - 1 : total - idx))
  }
  return (
    <span className={`spell-pips ind-${indicator}`} title={title}>
      {Array.from({ length: total }, (_, i) => {
        const spent = i >= total - used
        return (
          <span
            key={i}
            className={`spell-pip${spent ? ' spent' : ''}${lock ? ' lock' : ''}`}
            role={lock ? undefined : 'button'}
            tabIndex={lock ? undefined : 0}
            aria-label={spent ? 'Spent slot — click to refund' : 'Available slot — click to spend'}
            title={spent ? 'Refund' : 'Spend'}
            onClick={() => click(i, spent)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(i, spent) }
            }}
          />
        )
      })}
    </span>
  )
}
