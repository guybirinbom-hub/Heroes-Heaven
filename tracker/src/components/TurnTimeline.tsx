import { useEffect, useMemo, useState } from 'react'
import type { PartyPlayer } from '../store/partyStore'
import { formatTurnTime } from '../utils/turnTimer'
import { XIcon } from './Icons'

// ── Turn-time timeline ─────────────────────────────────────────────────────
// Modal line chart of a player's (or the DM's) average turn time over time.
// Points are grouped BY DAY — multiple fights saved on the same day collapse
// into one averaged point; clicking a multi-fight day expands it into its
// individual fights. Opened by clicking a ⏱ average chip.

interface Props {
  // Only these fields are read, so the DM can reuse this with a synthetic object.
  player: Pick<PartyPlayer, 'name' | 'turnHistory' | 'turnAvgSeconds' | 'turnCount'>
  onClose: () => void
}

interface Pt {
  at: number
  avg: number
  count: number
  /** Calendar-day bucket this point belongs to. */
  dayKey: string
  /** How many saved fights this point represents (>1 ⇒ an aggregate). */
  fights: number
  aggregate: boolean
}

/** Round the Y-axis ceiling up to a tidy value and pick a clean tick step. */
function niceAxis(maxSec: number): { yMax: number; step: number } {
  const padded = Math.max(10, maxSec * 1.2)
  let step: number
  if (padded <= 20) step = 5
  else if (padded <= 60) step = 10
  else if (padded <= 120) step = 30
  else if (padded <= 600) step = 60
  else step = 300
  const yMax = Math.ceil(padded / step) * step
  return { yMax, step }
}

const fmtDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const fmtTime = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const dayKeyOf = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function TurnTimeline({ player, onClose }: Props) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const toggleDay = (k: string) =>
    setExpandedDays(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Total saved fights (across all days) — drives the "Sessions" stat regardless
  // of how the chart is currently grouped/expanded.
  const totalFights = (player.turnHistory?.length ?? 0)
    || ((player.turnAvgSeconds != null && (player.turnCount ?? 0) > 0) ? 1 : 0)

  // Points: one per DAY by default (same-day fights averaged together, weighted
  // by turn count); an expanded day yields one point per individual fight.
  const pts: Pt[] = useMemo(() => {
    const h = (player.turnHistory ?? []).map(x => ({ at: x.at, avg: x.avgSeconds, count: x.turnCount }))
    h.sort((a, b) => a.at - b.at)
    if (h.length === 0 && player.turnAvgSeconds != null && (player.turnCount ?? 0) > 0) {
      // Legacy: cumulative average only, no history → a single point.
      return [{ at: Date.now(), avg: player.turnAvgSeconds, count: player.turnCount ?? 0, dayKey: 'legacy', fights: 1, aggregate: false }]
    }
    const order: string[] = []
    const groups = new Map<string, typeof h>()
    for (const e of h) {
      const k = dayKeyOf(e.at)
      if (!groups.has(k)) { groups.set(k, []); order.push(k) }
      groups.get(k)!.push(e)
    }
    const out: Pt[] = []
    for (const k of order) {
      const g = groups.get(k)!
      if (g.length > 1 && expandedDays.has(k)) {
        for (const e of g) out.push({ at: e.at, avg: e.avg, count: e.count, dayKey: k, fights: 1, aggregate: false })
      } else {
        const turns = g.reduce((s, e) => s + e.count, 0)
        const wavg = turns > 0
          ? g.reduce((s, e) => s + e.avg * e.count, 0) / turns
          : g.reduce((s, e) => s + e.avg, 0) / g.length
        out.push({ at: g[0].at, avg: wavg, count: turns, dayKey: k, fights: g.length, aggregate: g.length > 1 })
      }
    }
    return out
  }, [player.turnHistory, player.turnAvgSeconds, player.turnCount, expandedDays])

  const stats = useMemo(() => {
    const hs = (player.turnHistory ?? []).map(x => x.avgSeconds)
    const avgs = hs.length ? hs : (player.turnAvgSeconds != null && (player.turnCount ?? 0) > 0 ? [player.turnAvgSeconds] : [])
    if (!avgs.length) return null
    return {
      lifetime: player.turnAvgSeconds ?? (avgs.reduce((a, c) => a + c, 0) / avgs.length),
      fastest: Math.min(...avgs),
      slowest: Math.max(...avgs),
      sessions: totalFights,
    }
  }, [player.turnHistory, player.turnAvgSeconds, player.turnCount, totalFights])

  const canExpandAny = pts.some(p => p.aggregate) || expandedDays.size > 0

  // ── Chart geometry ──
  const W = 540, H = 250
  const xStart = 62, xEnd = 516, plotTop = 22, plotBottom = 212
  const maxAvg = pts.length ? Math.max(...pts.map(p => p.avg)) : 10
  const { yMax, step } = niceAxis(maxAvg)
  const yOf = (v: number) => plotBottom - (v / yMax) * (plotBottom - plotTop)
  const xOf = (i: number) => pts.length <= 1 ? (xStart + xEnd) / 2 : xStart + (xEnd - xStart) * (i / (pts.length - 1))

  const gridVals: number[] = []
  for (let v = 0; v <= yMax + 0.001; v += step) gridVals.push(v)

  const showValueLabels = pts.length <= 8
  const labelEvery = pts.length <= 8 ? 1 : Math.ceil(pts.length / 6)

  const linePoints = pts.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.avg).toFixed(1)}`).join(' ')
  const areaPath = pts.length
    ? `M${xOf(0).toFixed(1)},${plotBottom} ` +
      pts.map((p, i) => `L${xOf(i).toFixed(1)},${yOf(p.avg).toFixed(1)}`).join(' ') +
      ` L${xOf(pts.length - 1).toFixed(1)},${plotBottom} Z`
    : ''

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{
        padding: 0, overflow: 'hidden', maxWidth: 600, width: '100%',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: 'var(--app-bw) solid var(--border)',
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          <h2 className="page-title-display" style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
            {player.name || 'Player'}
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 500, fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
              turn-time history
            </span>
          </h2>
          <button className="ico-btn" style={{ width: 28, height: 28 }} onClick={onClose}><XIcon size={14} /></button>
        </div>

        {!stats ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-faded)', fontSize: 13, fontStyle: 'italic' }}>
            No turn-time data saved yet. Run combat with the turn timer on, then press
            “Save to Averages”.
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div style={{ display: 'flex', borderBottom: 'var(--app-bw) solid var(--border)' }}>
              {[
                { v: formatTurnTime(stats.lifetime), l: 'Lifetime avg', good: false },
                { v: formatTurnTime(stats.fastest), l: 'Fastest', good: true },
                { v: formatTurnTime(stats.slowest), l: 'Slowest', good: false },
                { v: String(stats.sessions), l: stats.sessions === 1 ? 'Fight' : 'Fights', good: false },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, padding: '11px 14px', textAlign: 'center', borderRight: i < 3 ? 'var(--app-bw) solid var(--border)' : 'none' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: s.good ? 'var(--hp-full)' : 'var(--accent)' }}>{s.v}</div>
                  <div style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-faded)', marginTop: 3 }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div style={{ padding: '16px 14px 6px' }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'var(--font-mono)' }}>
                {/* gridlines + y labels */}
                {gridVals.map((v, i) => {
                  const y = yOf(v)
                  const isBase = v === 0
                  return (
                    <g key={i}>
                      <line x1={xStart - 18} y1={y} x2={xEnd} y2={y}
                        stroke={isBase ? 'var(--border-strong)' : 'var(--border)'} strokeWidth={1} />
                      <text x={xStart - 22} y={y + 3} textAnchor="end" fill="var(--text-faded)" fontSize={9}>{formatTurnTime(v)}</text>
                    </g>
                  )
                })}

                {/* lifetime average dashed line */}
                {stats.sessions > 1 && (
                  <>
                    <line x1={xStart - 18} y1={yOf(stats.lifetime)} x2={xEnd} y2={yOf(stats.lifetime)}
                      stroke="var(--text-faded)" strokeWidth={1} strokeDasharray="3 3" />
                    <text x={xEnd} y={yOf(stats.lifetime) - 4} textAnchor="end" fill="var(--text-faded)" fontSize={9}>avg {formatTurnTime(stats.lifetime)}</text>
                  </>
                )}

                {/* area fill */}
                <defs>
                  <linearGradient id="tl-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--accent)" stopOpacity={0.22} />
                    <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {pts.length > 1 && <path d={areaPath} fill="url(#tl-fill)" />}

                {/* line */}
                {pts.length > 1 && (
                  <polyline fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" points={linePoints} />
                )}

                {/* points + labels */}
                {pts.map((p, i) => {
                  const x = xOf(i), y = yOf(p.avg)
                  const last = i === pts.length - 1
                  const expanded = expandedDays.has(p.dayKey)
                  const clickable = p.aggregate || expanded
                  const tip = p.aggregate
                    ? `${formatTurnTime(p.avg)} · ${p.fights} fights · ${p.count} turn${p.count === 1 ? '' : 's'} · ${fmtDate(p.at)} — click to expand`
                    : expanded
                      ? `${formatTurnTime(p.avg)} · ${p.count} turn${p.count === 1 ? '' : 's'} · ${fmtDate(p.at)} ${fmtTime(p.at)} — click to collapse`
                      : `${formatTurnTime(p.avg)} · ${p.count} turn${p.count === 1 ? '' : 's'} · ${fmtDate(p.at)}`
                  const xLabel = (expanded && !p.aggregate) ? fmtTime(p.at) : fmtDate(p.at)
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y} r={p.aggregate ? 5.5 : (last ? 4.5 : 4)}
                        fill={p.aggregate ? 'var(--accent-soft)' : (last ? 'var(--accent)' : 'var(--bg-panel)')}
                        stroke="var(--accent)" strokeWidth={2}
                        style={{ cursor: clickable ? 'pointer' : 'default' }}
                        onClick={clickable ? () => toggleDay(p.dayKey) : undefined}>
                        <title>{tip}</title>
                      </circle>
                      {/* small inner dot marks a multi-fight (expandable) day */}
                      {p.aggregate && <circle cx={x} cy={y} r={1.6} fill="var(--accent)" pointerEvents="none" />}
                      {showValueLabels && (
                        <text x={x} y={y - 10} textAnchor="middle" fill="var(--text)" fontSize={9} fontWeight={600} pointerEvents="none">{formatTurnTime(p.avg)}</text>
                      )}
                      {(i % labelEvery === 0 || last) && (
                        <text x={x} y={H - 12} textAnchor="middle" fill="var(--text-muted)" fontSize={9} pointerEvents="none">{xLabel}</text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>

            <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', padding: '4px 12px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 18, height: 2, background: 'var(--accent)' }} /> daily average
              </span>
              {stats.sessions > 1 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 18, height: 0, borderTop: '2px dashed var(--text-faded)' }} /> lifetime average
                </span>
              )}
              {canExpandAny && (
                <span style={{ color: 'var(--text-faded)', fontStyle: 'italic' }}>
                  ◉ a filled day had several fights — click it to see each one
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
