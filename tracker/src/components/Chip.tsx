import type { CSSProperties, ReactNode } from 'react'

// ── Chip / pill primitive ───────────────────────────────────────────────────
// One small status badge used across the app (PC / NPC / Elite / level / AC …)
// so every badge recolours with the theme instead of reimplementing the same
// inline styles. Tone maps to a token pair; `mono` switches to the mono font
// for numeric badges (level, AC).
type Tone = 'accent' | 'linked' | 'muted' | 'danger'

export function Chip({ tone = 'muted', mono, title, style, children }: {
  tone?: Tone
  mono?: boolean
  title?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <span className={`chip chip-${tone}${mono ? ' chip-mono' : ''}`} title={title} style={style}>
      {children}
    </span>
  )
}
