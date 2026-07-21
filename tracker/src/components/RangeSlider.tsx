import { useRef, useCallback, useState, useEffect } from 'react'

interface Props {
  min: number
  max: number
  /** null = no lower bound (defaults to `min`) */
  valueMin: number | null
  /** null = no upper bound (defaults to `max`) */
  valueMax: number | null
  step?: number
  /** Called with the new (min, max). Pass null to mean "unbounded on this side". */
  onChange: (min: number | null, max: number | null) => void
}

/**
 * Two-handle range slider, PF2eTools-styled.
 *
 *   [min#]  ━━●━━━━━━━━━━━━━━━━━━━━━━━━━●━━  [max#]
 *
 * The handles are draggable by mouse; the number inputs on each side allow
 * exact entry. When the user pulls a handle to its limit (min on left, max
 * on right), we set that side's value to `null` — meaning "no filter on
 * this side".
 */
export function RangeSlider({ min, max, valueMin, valueMax, step = 1, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)

  // Local "live" values used while the user is actively dragging. Decoupling
  // from the parent's filter state avoids re-running the entire creature
  // filter (5000+ entries) on every mouse move — that was the lag source.
  const [dragLo, setDragLo] = useState<number | null>(null)
  const [dragHi, setDragHi] = useState<number | null>(null)

  // Sync local drag values with props when not actively dragging
  useEffect(() => {
    if (dragLo === null && dragHi === null) return
    // Don't overwrite during drag
  }, [valueMin, valueMax])

  // Effective values: local drag values if dragging, otherwise props
  const lo = dragLo ?? valueMin ?? min
  const hi = dragHi ?? valueMax ?? max
  const loPct = max === min ? 0   : ((lo - min) / (max - min)) * 100
  const hiPct = max === min ? 100 : ((hi - min) / (max - min)) * 100

  // Convert client X to a clamped, snapped value.
  const xToValue = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return min
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = min + pct * (max - min)
    return Math.round(raw / step) * step
  }, [min, max, step])

  // Drag handler factory — updates LOCAL state every move (cheap re-render),
  // commits to parent only on mouseup.
  const startDrag = (which: 'lo' | 'hi') => (e: React.MouseEvent) => {
    e.preventDefault()
    // Snapshot current values for this drag session
    let liveLo = lo
    let liveHi = hi

    const onMove = (ev: MouseEvent) => {
      const v = xToValue(ev.clientX)
      if (which === 'lo') {
        liveLo = Math.min(v, liveHi)
        setDragLo(liveLo)
      } else {
        liveHi = Math.max(v, liveLo)
        setDragHi(liveHi)
      }
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      // Commit to parent
      const finalLo = which === 'lo' ? liveLo : (valueMin ?? min)
      const finalHi = which === 'hi' ? liveHi : (valueMax ?? max)
      onChange(
        finalLo <= min ? null : finalLo,
        finalHi >= max ? null : finalHi,
      )
      // Clear local drag state — props now reflect the new values
      setDragLo(null)
      setDragHi(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Number-input handlers
  const setLoFromInput = (v: number) => {
    if (isNaN(v)) return
    const clamped = Math.max(min, Math.min(v, hi))
    onChange(clamped <= min ? null : clamped, valueMax)
  }
  const setHiFromInput = (v: number) => {
    if (isNaN(v)) return
    const clamped = Math.max(lo, Math.min(v, max))
    onChange(valueMin, clamped >= max ? null : clamped)
  }

  // Tick marks (PF2eTools shows them) — render up to ~25 evenly spaced marks
  const span = max - min
  const tickCount = Math.min(25, Math.max(2, Math.floor(span / step) + 1))
  const ticks = Array.from({ length: tickCount }, (_, i) => i / (tickCount - 1))

  // All colours sourced from theme tokens so the slider recolours with the
  // active palette (was previously hardcoded to the Tavern gold).
  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    width: 12, height: 12, borderRadius: 3,
    background: 'var(--accent)',
    border: 'var(--app-bw) solid var(--accent-line)',
    boxShadow: 'var(--shadow-sm)',
    transform: 'translate(-50%, -50%)',
    cursor: 'grab', userSelect: 'none',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <input
        type="number"
        value={lo}
        onChange={e => setLoFromInput(parseInt(e.target.value))}
        className="input-dark"
        style={{ width: 56, padding: '2px 6px', fontSize: 11, textAlign: 'center' }}
      />

      <div ref={trackRef} style={{
        flex: 1, position: 'relative', height: 38, paddingBottom: 14,
        userSelect: 'none',
      }}>
        {/* Track — vertically centered in the upper portion (above the labels) */}
        <div style={{
          position: 'absolute', top: 12, left: 0, right: 0, height: 4,
          background: 'var(--bg-elevated)',
          border: 'var(--app-bw) solid var(--border)',
          borderRadius: 2,
        }} />
        {/* Selected range */}
        <div style={{
          position: 'absolute', top: 12, height: 4,
          left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%`,
          background: 'var(--accent)', borderRadius: 2,
        }} />
        {/* Tick marks (just below the track) */}
        {ticks.map((t, i) => (
          <div key={i} style={{
            position: 'absolute', top: 19,
            left: `${t * 100}%`, width: 1, height: 4,
            background: 'var(--border-strong)', transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }} />
        ))}
        {/* Min / Max labels well below the handles */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, fontSize: 9, color: 'var(--text-faded)',
          pointerEvents: 'none',
        }}>{min}</div>
        <div style={{
          position: 'absolute', bottom: 0, right: 0, fontSize: 9, color: 'var(--text-faded)',
          pointerEvents: 'none',
        }}>{max}</div>
        {/* Handles — positioned at the track height */}
        <div onMouseDown={startDrag('lo')} style={{ ...handleStyle, top: 14, left: `${loPct}%` }} />
        <div onMouseDown={startDrag('hi')} style={{ ...handleStyle, top: 14, left: `${hiPct}%` }} />
      </div>

      <input
        type="number"
        value={hi}
        onChange={e => setHiFromInput(parseInt(e.target.value))}
        className="input-dark"
        style={{ width: 56, padding: '2px 6px', fontSize: 11, textAlign: 'center' }}
      />
    </div>
  )
}
