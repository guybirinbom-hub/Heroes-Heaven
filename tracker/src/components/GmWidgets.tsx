import { useState, useEffect } from 'react'
import { useCombatStore } from '../store/combatStore'
import { useGameData } from '../data/gameDataContext'
import { CONDITION_META } from '../utils/conditionEffects'
import { rollDamageExpr } from '../utils/dice'
import { stripTags } from '../utils/tags'
import { ClockIcon, NotesIcon, DiceIcon, TableIcon, ShieldIcon, CoinIcon, SkullIcon } from './Icons'
import { RandomEncounterWidget } from './RandomEncounterWidget'
import { DowntimeWidget } from './DowntimeWidget'

// ─────────────────────────────────────────────────────────────────────────────
// GM-screen tool widgets. Each one is a self-contained pane body rendered by
// GmWidgetBody (routed from WinContent for type 'widget'). They dock / tab /
// resize like reference popups because they ride the same PaneLayout chrome.
//
// Identity: a widget tab is a PopupRef { type:'widget', ref:`${kind}-${uid}` }.
// Per-instance state (timer value, notes text, treasure selectors) self-persists
// to localStorage keyed by the ref, so it survives reloads independently of the
// layout store.
// ─────────────────────────────────────────────────────────────────────────────

let _wid = 0
export const newWidgetRef = (kind: string) => `${kind}-${Date.now().toString(36)}${(++_wid).toString(36)}`

// `Icon` is a monochrome outline component (inherits color); `keywords` feed
// the global search so widgets are findable by synonyms (e.g. "stopwatch", "xp").
export interface GmWidgetDef { kind: string; label: string; Icon: React.ComponentType<{ size?: number }>; keywords: string }
export const GM_WIDGETS: GmWidgetDef[] = [
  { kind: 'timer', label: 'Timer / stopwatch', Icon: ClockIcon, keywords: 'timer stopwatch clock countdown' },
  { kind: 'notes', label: 'Notes', Icon: NotesIcon, keywords: 'notes scratchpad text reminders' },
  { kind: 'dice', label: 'Dice roller', Icon: DiceIcon, keywords: 'dice roller roll d20 damage' },
  { kind: 'dcs', label: 'DCs by level', Icon: TableIcon, keywords: 'dcs difficulty class by level simple table' },
  { kind: 'conditions', label: 'Conditions', Icon: ShieldIcon, keywords: 'conditions status effects cheat sheet' },
  { kind: 'treasure', label: 'Treasure & XP', Icon: CoinIcon, keywords: 'treasure xp budget gold encounter loot' },
  { kind: 'encounter', label: 'Random Encounter', Icon: SkullIcon, keywords: 'random encounter table monster hazard roll travel exploration' },
  { kind: 'downtime', label: 'Downtime (Craft / Earn Income)', Icon: CoinIcon, keywords: 'downtime crafting craft earn income rune etching formula cost days calculator' },
]

// ── persisted per-widget state ───────────────────────────────────────────────
function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem(key); return r != null ? (JSON.parse(r) as T) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota / private mode */ } }, [key, v])
  return [v, setV]
}

// ── canonical PF2e reference tables ──────────────────────────────────────────
const DC_BY_LEVEL: Record<number, number> = { 0:14,1:15,2:16,3:18,4:19,5:20,6:22,7:23,8:24,9:26,10:27,11:28,12:30,13:31,14:32,15:34,16:35,17:36,18:38,19:39,20:40,21:42,22:44,23:46,24:48,25:50 }
const SIMPLE_DCS: [string, number][] = [['Untrained',10],['Trained',15],['Expert',20],['Master',30],['Legendary',40]]
const DC_ADJUST: [string, number][] = [['Incredibly easy',-10],['Very easy',-5],['Easy',-2],['Hard',2],['Very hard',5],['Incredibly hard',10]]
const RARITY_ADJUST: [string, number][] = [['Uncommon',2],['Rare',5],['Unique',10]]
// [name, budget for 4 players, adjustment per extra/fewer player]
const XP_BUDGET: [string, number, number][] = [['Trivial',40,10],['Low',60,15],['Moderate',80,20],['Severe',120,30],['Extreme',160,40]]
const TREASURE_BY_LEVEL: Record<number, number> = { 1:175,2:300,3:500,4:850,5:1350,6:2000,7:2900,8:4000,9:5700,10:8000,11:11500,12:16500,13:25000,14:36500,15:54500,16:82500,17:128000,18:208000,19:355000,20:490000 }

// ── shared styles ────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { height: '100%', overflowY: 'auto', padding: '12px 14px', fontFamily: 'var(--font-ui)', color: 'var(--text)', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faded)', margin: '14px 0 6px' }
const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, padding: '2px 8px', color: 'var(--text-muted)' }
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600 }

// ── Timer / stopwatch ────────────────────────────────────────────────────────
function fmtTime(ms: number) {
  const t = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
interface TimerState { mode: 'up' | 'down'; ms: number; target: number; running: boolean }
function TimerWidget({ id }: { id: string }) {
  const [st, setSt] = usePersistentState<TimerState>(`gmw:${id}`, { mode: 'up', ms: 0, target: 300000, running: false })
  useEffect(() => {
    if (!st.running) return
    const iv = window.setInterval(() => {
      setSt(p => {
        if (!p.running) return p
        if (p.mode === 'up') return { ...p, ms: p.ms + 1000 }
        const next = Math.max(0, p.ms - 1000)
        return next === 0 ? { ...p, ms: 0, running: false } : { ...p, ms: next }
      })
    }, 1000)
    return () => window.clearInterval(iv)
  }, [st.running, setSt])

  const setMode = (mode: 'up' | 'down') => setSt(p => ({ ...p, mode, running: false, ms: mode === 'down' ? p.target : 0 }))
  const adjust = (deltaMin: number) => setSt(p => { const target = Math.max(60000, p.target + deltaMin * 60000); return { ...p, target, ms: target } })
  const reset = () => setSt(p => ({ ...p, running: false, ms: p.mode === 'down' ? p.target : 0 }))

  const tabBtn = (m: 'up' | 'down'): React.CSSProperties => ({
    flex: 1, padding: '5px 0', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
    background: st.mode === m ? 'var(--accent-soft)' : 'transparent',
    color: st.mode === m ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none', borderBottom: st.mode === m ? '2px solid var(--accent)' : '2px solid transparent',
  })

  return (
    <div style={{ ...wrap, display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'center' }}>
      <div style={{ display: 'flex', width: '100%', borderBottom: 'var(--app-bw) solid var(--border)', marginBottom: 18 }}>
        <button style={tabBtn('up')} onClick={() => setMode('up')}>Stopwatch</button>
        <button style={tabBtn('down')} onClick={() => setMode('down')}>Timer</button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 46, fontWeight: 600, letterSpacing: '0.02em', color: st.mode === 'down' && st.ms === 0 ? 'var(--danger)' : 'var(--text)', lineHeight: 1.1 }}>
        {fmtTime(st.ms)}
      </div>
      {st.mode === 'down' && !st.running && (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => adjust(-1)}>−1m</button>
          <button className="btn btn-secondary btn-sm" onClick={() => adjust(1)}>+1m</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSt(p => ({ ...p, target: 300000, ms: 300000 }))}>5m</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSt(p => ({ ...p, target: 600000, ms: 600000 }))}>10m</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" onClick={() => setSt(p => ({ ...p, running: !p.running }))} disabled={st.mode === 'down' && st.ms === 0}>
          {st.running ? '❚❚ Pause' : '▶ Start'}
        </button>
        <button className="btn btn-secondary" onClick={reset}>↺ Reset</button>
      </div>
    </div>
  )
}

// ── Notes ────────────────────────────────────────────────────────────────────
function NotesWidget({ id }: { id: string }) {
  const [text, setText] = usePersistentState<string>(`gmw:${id}`, '')
  return (
    <textarea
      value={text}
      onChange={e => setText(e.target.value)}
      placeholder="Session notes — names, plot threads, reminders…"
      spellCheck={false}
      style={{ width: '100%', height: '100%', resize: 'none', border: 'none', outline: 'none', background: 'var(--bg-base)', color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.65, padding: '12px 14px', boxSizing: 'border-box' }}
    />
  )
}

// ── DCs by level ───────────────────────────────────────────────────────────────
function DcsWidget() {
  return (
    <div style={wrap}>
      <div style={{ ...lbl, marginTop: 0 }}>Simple DCs</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {SIMPLE_DCS.map(([k, v]) => <span key={k} style={pill}>{k} <span style={mono}>{v}</span></span>)}
      </div>
      <div style={lbl}>DC by level</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {Object.entries(DC_BY_LEVEL).map(([lv, dc]) => (
          <div key={lv} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
            <span style={{ color: 'var(--text-faded)' }}>{lv}</span><span style={{ color: 'var(--accent)' }}>{dc}</span>
          </div>
        ))}
      </div>
      <div style={lbl}>Difficulty adjustment</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {DC_ADJUST.map(([k, v]) => <span key={k} style={pill}>{k} <span style={mono}>{v > 0 ? `+${v}` : v}</span></span>)}
      </div>
      <div style={lbl}>Rarity adjustment</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {RARITY_ADJUST.map(([k, v]) => <span key={k} style={pill}>{k} <span style={mono}>+{v}</span></span>)}
      </div>
    </div>
  )
}

// ── Conditions cheat-sheet ─────────────────────────────────────────────────────
function ConditionsWidget() {
  const { conditions } = useGameData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)   // single-open accordion
  const ql = q.trim().toLowerCase()
  const entries = Object.entries(CONDITION_META)
    .filter(([k, m]) => !ql || m.name.toLowerCase().includes(ql) || k.includes(ql))
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
  return (
    <div style={wrap}>
      <input
        value={q} onChange={e => setQ(e.target.value)} placeholder="Search conditions…" spellCheck={false}
        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, color: 'var(--text)', fontSize: 12.5, padding: '6px 9px', outline: 'none', marginBottom: 4 }}
      />
      {entries.map(([k, m]) => {
        const isOpen = open === k
        const full = conditions.get(k)
        return (
          <div key={k} style={{ borderTop: 'var(--app-bw) solid var(--border)' }}>
            <div
              onClick={() => setOpen(o => (o === k ? null : k))}
              style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 2px', cursor: 'pointer' }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 2, background: m.bg, border: `var(--app-bw) solid ${m.border}`, flexShrink: 0, marginTop: 3 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: isOpen ? 'var(--accent)' : 'var(--text)' }}>{m.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 6 }}>{m.summary}</span>
              </div>
              <span style={{ flexShrink: 0, color: 'var(--text-faded)', fontSize: 10, marginTop: 4, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>▸</span>
            </div>
            {isOpen && (
              <div style={{ padding: '0 2px 11px 20px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {full
                  ? stripTags(full).split('\n').filter(l => l.trim()).map((line, i) => (
                      <p key={i} style={{ margin: i === 0 ? 0 : '5px 0 0' }}>{line}</p>
                    ))
                  : <em>No further description.</em>}
              </div>
            )}
          </div>
        )
      })}
      {entries.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', padding: '8px 0' }}>No matching condition.</div>}
    </div>
  )
}

// ── Treasure & XP budget ───────────────────────────────────────────────────────
function TreasureWidget({ id }: { id: string }) {
  const [st, setSt] = usePersistentState<{ level: number; players: number }>(`gmw:${id}`, { level: 1, players: 4 })
  const level = Math.max(1, Math.min(20, st.level))
  const players = Math.max(1, Math.min(8, st.players))
  const diff = players - 4
  const treasure = Math.round((TREASURE_BY_LEVEL[level] ?? 0) * (players / 4))
  const fmtGp = (n: number) => n.toLocaleString('en-US')
  const stepper = (label: string, val: number, set: (v: number) => void, min: number, max: number) => (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-faded)', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, overflow: 'hidden' }}>
        <button className="ico-btn" style={{ width: 26, height: 26 }} onClick={() => set(Math.max(min, val - 1))}>−</button>
        <span style={{ ...mono, minWidth: 28, textAlign: 'center' }}>{val}</span>
        <button className="ico-btn" style={{ width: 26, height: 26 }} onClick={() => set(Math.min(max, val + 1))}>+</button>
      </div>
    </div>
  )
  return (
    <div style={wrap}>
      <div style={{ display: 'flex', gap: 16 }}>
        {stepper('Party level', level, v => setSt(p => ({ ...p, level: v })), 1, 20)}
        {stepper('Players', players, v => setSt(p => ({ ...p, players: v })), 1, 8)}
      </div>
      <div style={lbl}>Encounter XP budget</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {XP_BUDGET.map(([name, base, per]) => (
          <span key={name} style={pill}>{name} <span style={mono}>{base + per * diff}</span></span>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-faded)', marginTop: 6 }}>Per-creature XP: −4 lvl = 10 · −1 = 30 · same = 40 · +1 = 60 · +4 = 160</div>
      <div style={lbl}>Treasure for level {level}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--accent)', fontWeight: 600 }}>{fmtGp(treasure)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>gp · full party budget for the level</span>
      </div>
    </div>
  )
}

// ── Dice roller ────────────────────────────────────────────────────────────────
const DICE = [4, 6, 8, 10, 12, 20, 100]
function DiceWidget({ id }: { id: string }) {
  const addDiceResult = useCombatStore(s => s.addDiceResult)
  const [formula, setFormula] = usePersistentState<string>(`gmw:${id}`, '2d6+3')
  const [log, setLog] = useState<{ label: string; total: number; crit?: boolean; fumble?: boolean }[]>([])
  const roll = (expr: string, label: string) => {
    const norm = expr.trim().replace(/^d/i, '1d')
    const res = rollDamageExpr(norm, label)
    addDiceResult(res)
    setLog(l => [{ label, total: res.total, crit: res.isCrit, fumble: res.isFumble }, ...l].slice(0, 10))
  }
  return (
    <div style={wrap}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 8 }}>
        {DICE.map(n => (
          <button key={n} className="btn btn-secondary btn-sm" style={{ fontFamily: 'var(--font-mono)' }} onClick={() => roll(`1d${n}`, `d${n}`)}>d{n}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={formula} onChange={e => setFormula(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && roll(formula, formula)}
          placeholder="2d6+3" spellCheck={false}
          style={{ flex: 1, boxSizing: 'border-box', background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '6px 9px', outline: 'none' }}
        />
        <button className="btn btn-primary btn-sm" onClick={() => roll(formula, formula)}>Roll</button>
      </div>
      <div style={lbl}>Recent</div>
      {log.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>No rolls yet.</div>}
      {log.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '4px 0', borderTop: 'var(--app-bw) solid var(--border)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
          <span style={{ color: r.crit ? 'var(--hp-full)' : r.fumble ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>{r.total}</span>
        </div>
      ))}
    </div>
  )
}

// ── Router ─────────────────────────────────────────────────────────────────────
export function GmWidgetBody({ refId }: { refId: string }) {
  const kind = refId.split('-')[0]
  switch (kind) {
    case 'timer': return <TimerWidget id={refId} />
    case 'notes': return <NotesWidget id={refId} />
    case 'dice': return <DiceWidget id={refId} />
    case 'dcs': return <DcsWidget />
    case 'conditions': return <ConditionsWidget />
    case 'treasure': return <TreasureWidget id={refId} />
    case 'encounter': return <RandomEncounterWidget id={refId} />
    case 'downtime': return <DowntimeWidget id={refId} />
    default: return <div style={wrap}>Unknown widget.</div>
  }
}
