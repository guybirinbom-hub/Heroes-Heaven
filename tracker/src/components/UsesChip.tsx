// ── Limited-use counter chip ──────────────────────────────────────────────
// Compact pill showing remaining/max uses with spend (−), refund (+) and
// reset (↺) controls. Greys out when fully spent. Used for limited abilities,
// prepared / innate spell uses, spontaneous slot pools and focus points.

interface Props {
  /** Uses already consumed. */
  used: number
  /** Total uses available. */
  max: number
  /** Called with the new consumed count (caller clamps + persists). */
  onChange: (used: number) => void
  /** Small italic hint after the pill, e.g. "1/day", "3 slots". */
  hint?: string
  /** Render slightly smaller (used inline in dense spell lists). */
  small?: boolean
}

export function UsesChip({ used, max, onChange, hint, small }: Props) {
  const remaining = Math.max(0, max - used)
  const spent = remaining === 0
  const btn: React.CSSProperties = {
    background: 'transparent', border: 'none',
    color: spent ? 'var(--text-faded)' : 'var(--accent)',
    width: small ? 15 : 17, cursor: 'pointer',
    fontSize: small ? 11 : 13, fontWeight: 700, lineHeight: 1, padding: 0,
    display: 'grid', placeItems: 'center',
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'middle' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'stretch',
        height: small ? 18 : 20,
        background: spent ? 'rgba(94,82,74,0.14)' : 'var(--accent-soft)',
        border: `var(--app-bw) solid ${spent ? 'var(--border)' : 'var(--accent-line)'}`,
        borderRadius: 'var(--radius-full)', overflow: 'hidden',
        fontFamily: 'var(--font-mono)', fontSize: small ? 10 : 11,
      }}>
        <button style={btn} title="Spend one use"
          onClick={() => onChange(Math.min(max, used + 1))}
          disabled={spent}>−</button>
        <span style={{
          display: 'inline-flex', alignItems: 'center', padding: small ? '0 5px' : '0 7px',
          color: spent ? 'var(--text-faded)' : 'var(--accent)', fontWeight: 700,
          borderLeft: `var(--app-bw) solid ${spent ? 'var(--border)' : 'var(--accent-line)'}`,
          borderRight: `var(--app-bw) solid ${spent ? 'var(--border)' : 'var(--accent-line)'}`,
        }}>
          {remaining}<span style={{ color: 'var(--text-faded)', fontWeight: 500 }}>/{max}</span>
        </span>
        <button style={btn} title="Refund one use"
          onClick={() => onChange(Math.max(0, used - 1))}
          disabled={used === 0}>+</button>
        <button style={{ ...btn, color: 'var(--text-muted)', fontSize: small ? 10 : 11 }}
          title="Reset to full"
          onClick={() => onChange(0)}>↺</button>
      </span>
      {hint && <span style={{ fontSize: small ? 9.5 : 10.5, color: 'var(--text-faded)', fontStyle: 'italic' }}>{hint}</span>}
    </span>
  )
}
