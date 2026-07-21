import { useState, useEffect, useMemo, useRef } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { useCombatStore } from '../store/combatStore'
import { elapsedMs, formatTurnTime } from '../utils/turnTimer'
import { XIcon } from './Icons'

// Tiny inline glyphs so we don't depend on icon-font availability.
const PauseGlyph = () => (
  <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor"><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></svg>
)
const PlayGlyph = () => (
  <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor"><path d="M0 0 L9 5 L0 10 Z"/></svg>
)
const ClockGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="6" cy="6" r="5"/><path d="M6 3 V6 L8 7.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
)

export function TurnTimerWidget() {
  const enabled = useSettingsStore(s => s.turnTimerEnabled)
  const turnTimer = useCombatStore(s => s.turnTimer)
  const turns = useCombatStore(s => s.turns)
  const pauseTurnTimer = useCombatStore(s => s.pauseTurnTimer)
  const resumeTurnTimer = useCombatStore(s => s.resumeTurnTimer)
  const discardCurrentTurn = useCombatStore(s => s.discardCurrentTurn)
  const removeTurn = useCombatStore(s => s.removeTurn)
  const saveTurnsToAverages = useCombatStore(s => s.saveTurnsToAverages)

  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const running = !!turnTimer && !turnTimer.paused && turnTimer.startedAt != null

  // Tick the live display 4×/s while counting.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick(t => (t + 1) % 1_000_000), 250)
    return () => clearInterval(id)
  }, [running])

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Per-name session averages for the panel footer.
  const sessionAvg = useMemo(() => {
    const pc = new Map<string, { sum: number; count: number }>()
    let dmSum = 0, dmCount = 0
    for (const t of turns) {
      if (t.isPC) {
        const e = pc.get(t.name) ?? { sum: 0, count: 0 }
        e.sum += t.seconds; e.count += 1
        pc.set(t.name, e)
      } else { dmSum += t.seconds; dmCount += 1 }
    }
    return { pc, dm: dmCount > 0 ? dmSum / dmCount : null }
  }, [turns])

  if (!enabled) return null

  const liveSec = turnTimer ? Math.floor(elapsedMs(turnTimer, Date.now()) / 1000) : 0
  const idle = !turnTimer

  const miniBtn: React.CSSProperties = {
    width: 18, height: 18, display: 'grid', placeItems: 'center',
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', borderRadius: 3, padding: 0,
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Chip */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 26, padding: '0 6px 0 8px',
        background: running ? 'var(--accent-soft)' : 'var(--bg-elevated)',
        border: `var(--app-bw) solid ${running ? 'var(--accent-line)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)', fontSize: 12,
      }}>
        <button
          onClick={() => setOpen(o => !o)}
          title="Show turn times"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: idle ? 'var(--text-faded)' : (running ? 'var(--accent)' : 'var(--text)'),
            padding: 0, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
          }}
        >
          <ClockGlyph />
          {idle ? '—:—' : formatTurnTime(liveSec)}
          {turns.length > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: 'var(--text-on-accent)',
              background: 'var(--accent)', borderRadius: 7, padding: '0 5px',
              fontFamily: 'var(--font-ui)',
            }}>{turns.length}</span>
          )}
        </button>
        {/* Pause / resume */}
        <button
          onClick={() => (turnTimer?.paused ? resumeTurnTimer() : pauseTurnTimer())}
          disabled={idle}
          title={turnTimer?.paused ? 'Resume timer' : 'Pause timer'}
          style={{ ...miniBtn, opacity: idle ? 0.4 : 1, cursor: idle ? 'default' : 'pointer', color: turnTimer?.paused ? 'var(--accent)' : 'var(--text-muted)' }}
        >{turnTimer?.paused ? <PlayGlyph /> : <PauseGlyph />}</button>
        {/* Discard current running turn */}
        <button
          onClick={() => discardCurrentTurn()}
          disabled={idle}
          title="Discard the current running turn time (restart at 0)"
          style={{ ...miniBtn, opacity: idle ? 0.4 : 1, cursor: idle ? 'default' : 'pointer' }}
          onMouseEnter={e => { if (!idle) e.currentTarget.style.color = 'var(--danger)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        ><XIcon size={11} /></button>
      </div>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 3000,
          width: 300, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '9px 12px', borderBottom: 'var(--app-bw) solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
          }}>
            <span className="page-title-display" style={{ fontSize: 14, fontWeight: 600 }}>Turn Times</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-faded)' }}>{turns.length} turn{turns.length === 1 ? '' : 's'}</span>
          </div>

          {/* Turn list */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {turns.length === 0 && (
              <div style={{ padding: '18px 12px', textAlign: 'center', color: 'var(--text-faded)', fontSize: 12, fontStyle: 'italic' }}>
                No turns recorded yet. Start combat and advance turns.
              </div>
            )}
            {turns.map(t => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 12px', fontSize: 12,
              }}>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                  {!t.isPC && (
                    <span style={{
                      marginLeft: 6, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em',
                      color: 'var(--linked)', background: 'var(--linked-soft)',
                      border: 'var(--app-bw) solid var(--linked)', borderRadius: 3, padding: '0 4px',
                    }}>DM</span>
                  )}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 11.5 }}>{formatTurnTime(t.seconds)}</span>
                <button onClick={() => removeTurn(t.id)} title="Remove this turn"
                  style={{ width: 16, height: 16, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-faded)', borderRadius: 3, padding: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faded)')}
                ><XIcon size={11} /></button>
              </div>
            ))}
          </div>

          {/* Averages + Save */}
          {turns.length > 0 && (
            <div style={{ borderTop: 'var(--app-bw) solid var(--border)', padding: '8px 12px', background: 'rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 5 }}>
                Session averages
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                {[...sessionAvg.pc.entries()].map(([name, e]) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{formatTurnTime(e.sum / e.count)}</span>
                  </div>
                ))}
                {sessionAvg.dm != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--linked)' }}>
                    <span>DM average</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{formatTurnTime(sessionAvg.dm)}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => { saveTurnsToAverages(); setOpen(false) }}
                className="btn btn-primary btn-sm"
                style={{ width: '100%', justifyContent: 'center', fontSize: 11.5 }}
                title="Fold these turns into each player's and the DM's lifetime average, then clear the list"
              >Save to Averages</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
