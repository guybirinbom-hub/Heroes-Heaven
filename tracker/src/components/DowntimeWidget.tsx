import { useState, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Downtime calculator — Earn Income + Craft (and rune etching, which is just
// Craft with a rune's level & price). Mirrors the community "Crafting / Earn
// Income" spreadsheet: level-based DCs, formula prices, the Income Earned table,
// success odds, and the day-by-day cost-reduction math for crafting.
// ─────────────────────────────────────────────────────────────────────────────

// Level-based DCs (GM Core Table 10-5).
const LEVEL_DC = [14,15,16,18,19,20,22,23,24,26,27,28,30,31,32,34,35,36,38,39,40,42,44,46,48,50]
// Formula prices by item level, in copper (Core Rulebook formula table).
const FORMULA_CP = [50,100,200,300,500,800,1300,1800,2500,3500,5000,7000,10000,15000,22500,32500,50000,75000,120000,200000,350000]
// Income Earned per day, in copper: [failure, trained, expert, master, legendary] by task level (Table 4-2).
const INCOME_CP: number[][] = [
  [1,5,5,5,5],[2,20,20,20,20],[4,30,30,30,30],[8,50,50,50,50],[10,70,80,80,80],
  [20,90,100,100,100],[30,150,200,200,200],[40,200,250,250,250],[50,250,300,300,300],
  [60,300,400,400,400],[70,400,500,600,600],[80,500,600,800,800],[90,600,800,1000,1000],
  [100,700,1000,1500,1500],[150,800,1500,2000,2000],[200,1000,2000,2800,2800],
  [250,1600,2500,3600,3600],[300,1600,3000,4500,5500],[400,2000,4500,7000,9000],
  [600,3000,6000,10000,13000],[800,4000,7500,15000,20000],
]
const PROFS = [['T','Trained',1],['E','Expert',2],['M','Master',3],['L','Legendary',4]] as const
type Prof = 'T' | 'E' | 'M' | 'L'
const profIdx = (p: Prof) => ({ T: 1, E: 2, M: 3, L: 4 }[p])

// Task-level-20 CRITICAL success income (Table 4-2's dedicated "20 (critical
// success)" row), in copper: [failure (unused), trained, expert, master, legendary].
const INCOME_CRIT20 = [800, 5000, 9000, 17500, 30000]

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const dcOf = (lvl: number) => LEVEL_DC[clamp(lvl, 0, 25)]
const incomeOf = (lvl: number, col: number) => INCOME_CP[clamp(lvl, 0, 20)][col]
/** Income on a CRITICAL success: earn as if the task level were one higher —
 *  except level 20, which uses Table 4-2's special "20 (critical success)" row. */
const critIncomeOf = (lvl: number, col: number) => lvl >= 20 ? INCOME_CRIT20[col] : incomeOf(lvl + 1, col)

/** 4-degree probabilities for a d20 + mod vs DC (with the ±10 crit bands and the
 *  nat-1 / nat-20 one-step shift). */
function degrees(mod: number, dc: number) {
  let cs = 0, s = 0, f = 0, cf = 0
  for (let r = 1; r <= 20; r++) {
    const t = r + mod
    let deg = t >= dc + 10 ? 3 : t >= dc ? 2 : t <= dc - 10 ? 0 : 1
    if (r === 20) deg = Math.min(3, deg + 1)
    if (r === 1) deg = Math.max(0, deg - 1)
    if (deg === 3) cs++; else if (deg === 2) s++; else if (deg === 1) f++; else cf++
  }
  return { cs: cs / 20, s: s / 20, f: f / 20, cf: cf / 20 }
}

function fmtCoins(cp: number): string {
  cp = Math.round(cp)
  if (cp === 0) return '0 gp'
  const gp = Math.floor(cp / 100), sp = Math.floor((cp % 100) / 10), c = cp % 10
  return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ')
}
const pct = (x: number) => `${Math.round(x * 100)}%`

// Per-instance persisted state.
function usePersisted<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem(key); return r != null ? (JSON.parse(r) as T) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota */ } }, [key, v])
  return [v, setV]
}

// ── styles ──
const wrap: React.CSSProperties = { height: '100%', overflowY: 'auto', padding: '12px 14px', fontFamily: 'var(--font-ui)', color: 'var(--text)', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faded)', margin: '12px 0 6px' }
const fieldLbl: React.CSSProperties = { fontSize: 10.5, color: 'var(--text-faded)', marginBottom: 3 }
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600 }
const inputStyle: React.CSSProperties = { background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '4px 6px', outline: 'none', boxSizing: 'border-box' }

function Num({ value, onChange, min = 0, max = 99999, w = 64 }: { value: number; onChange: (n: number) => void; min?: number; max?: number; w?: number }) {
  return <input type="number" value={value} min={min} max={max}
    onChange={e => onChange(clamp(parseInt(e.target.value || '0', 10) || 0, min, max))}
    style={{ ...inputStyle, width: w }} />
}
function ProfSel({ value, onChange }: { value: Prof; onChange: (p: Prof) => void }) {
  return (
    <select className="input-dark" value={value} onChange={e => onChange(e.target.value as Prof)}
      style={{ ...inputStyle, width: 108 }}>
      {PROFS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={fieldLbl}>{label}</div>{children}</div>
}
function Odds({ d }: { d: { cs: number; s: number; f: number; cf: number } }) {
  const seg = (v: number, color: string, title: string) => v > 0 && (
    <div title={`${title} ${pct(v)}`} style={{ width: `${v * 100}%`, background: color, height: '100%' }} />
  )
  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', border: 'var(--app-bw) solid var(--border)' }}>
        {seg(d.cs, 'var(--hp-full)', 'Crit success')}
        {seg(d.s, 'var(--accent)', 'Success')}
        {seg(d.f, 'var(--border-strong)', 'Failure')}
        {seg(d.cf, 'var(--danger)', 'Crit failure')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
        <span title="Critical success" style={{ color: 'var(--hp-full)' }}>★ {pct(d.cs)}</span>
        <span title="Success" style={{ color: 'var(--accent)' }}>✓ {pct(d.s)}</span>
        <span title="Failure">✗ {pct(d.f)}</span>
        <span title="Critical failure" style={{ color: 'var(--danger)' }}>✗✗ {pct(d.cf)}</span>
      </div>
    </div>
  )
}
const statRow = (k: string, v: React.ReactNode) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderTop: 'var(--app-bw) solid var(--border)' }}>
    <span style={{ color: 'var(--text-muted)' }}>{k}</span><span style={mono}>{v}</span>
  </div>
)

interface DowntimeState {
  mode: 'earn' | 'craft'
  // earn income
  taskLevel: number; earnProf: Prof; earnMod: number; earnDays: number
  // craft / rune etching
  itemLevel: number; priceGp: number; craftProf: Prof; craftMod: number; charLevel: number; knowFormula: boolean; extraDays: number
}
const DEFAULT: DowntimeState = {
  mode: 'earn',
  taskLevel: 5, earnProf: 'T', earnMod: 10, earnDays: 7,
  itemLevel: 5, priceGp: 160, craftProf: 'T', craftMod: 12, charLevel: 5, knowFormula: false, extraDays: 0,
}

export function DowntimeWidget({ id }: { id: string }) {
  const [st, setSt] = usePersisted<DowntimeState>(`gmw:${id}`, DEFAULT)
  const set = (patch: Partial<DowntimeState>) => setSt(p => ({ ...p, ...patch }))

  const tab = (m: DowntimeState['mode']): React.CSSProperties => ({
    flex: 1, padding: '6px 0', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    background: st.mode === m ? 'var(--accent-soft)' : 'transparent',
    color: st.mode === m ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none', borderBottom: st.mode === m ? '2px solid var(--accent)' : '2px solid transparent',
  })

  // ── Earn Income ──
  const earnDC = dcOf(st.taskLevel)
  const earnD = degrees(st.earnMod, earnDC)
  const ci = profIdx(st.earnProf)
  const earnSuccess = incomeOf(st.taskLevel, ci)
  const earnCrit = critIncomeOf(st.taskLevel, ci)
  const earnFail = incomeOf(st.taskLevel, 0)

  // ── Craft ──
  const priceCp = st.priceGp * 100
  const craftDC = dcOf(st.itemLevel)
  const craftD = degrees(st.craftMod, craftDC)
  const materials = Math.floor(priceCp / 2)
  const remaining = priceCp - materials
  // Player Core: set-up is 2 days, or 1 if you have the item's formula. The
  // formula itself is a separate optional purchase (common items don't need it),
  // so it's shown for reference rather than folded into the craft cost.
  const setupDays = st.knowFormula ? 1 : 2
  const formulaPrice = FORMULA_CP[clamp(st.itemLevel, 0, 20)] ?? 0
  const dailyReduce = incomeOf(st.charLevel, profIdx(st.craftProf))
  // On a critical success each extra day cuts cost faster (your level + 1); on a
  // critical failure you ruin 10% of the supplied raw materials (½ Price).
  const critDaily = critIncomeOf(st.charLevel, profIdx(st.craftProf))
  const critFailLoss = Math.round(materials * 0.1)
  const daysToFull = dailyReduce > 0 ? Math.ceil(remaining / dailyReduce) : 0
  const extra = clamp(st.extraDays, 0, daysToFull)
  const paidNow = materials + Math.max(0, remaining - extra * dailyReduce)
  // craft-vs-buy: earn income at your level+prof to afford the item outright
  const earnPerDay = incomeOf(st.charLevel, profIdx(st.craftProf))
  const daysToBuy = earnPerDay > 0 ? Math.ceil(priceCp / earnPerDay) : 0

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', borderBottom: 'var(--app-bw) solid var(--border)', marginBottom: 4 }}>
        <button style={tab('earn')} onClick={() => set({ mode: 'earn' })}>Earn Income</button>
        <button style={tab('craft')} onClick={() => set({ mode: 'craft' })}>Craft / Etch</button>
      </div>

      {st.mode === 'earn' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Field label="Task level"><Num value={st.taskLevel} onChange={n => set({ taskLevel: n })} min={0} max={21} w={56} /></Field>
            <Field label="Proficiency"><ProfSel value={st.earnProf} onChange={p => set({ earnProf: p })} /></Field>
            <Field label="Skill mod"><Num value={st.earnMod} onChange={n => set({ earnMod: n })} min={-5} max={60} w={56} /></Field>
          </div>

          <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between' }}>
            <span>Flat check</span><span style={{ ...mono, color: 'var(--accent)' }}>DC {earnDC}</span>
          </div>
          <Odds d={earnD} />

          <div style={lbl}>Income earned per day</div>
          {statRow('Critical success', fmtCoins(earnCrit))}
          {statRow('Success', fmtCoins(earnSuccess))}
          {statRow('Failure', fmtCoins(earnFail))}
          {statRow('Critical failure', '0 gp / fired')}

          <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Total over</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Num value={st.earnDays} onChange={n => set({ earnDays: n })} min={1} max={365} w={56} />
              <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11, color: 'var(--text-muted)' }}>days, if every day is…</span>
            </span>
          </div>
          {statRow('Critical success', <span style={{ color: 'var(--hp-full)' }}>{fmtCoins(earnCrit * st.earnDays)}</span>)}
          {statRow('Success', <span style={{ color: 'var(--accent)' }}>{fmtCoins(earnSuccess * st.earnDays)}</span>)}
          {statRow('Failure', fmtCoins(earnFail * st.earnDays))}
          {statRow('Critical failure', <span style={{ color: 'var(--danger)' }}>0 gp</span>)}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Field label="Item / rune lvl"><Num value={st.itemLevel} onChange={n => set({ itemLevel: n })} min={0} max={25} w={56} /></Field>
            <Field label="Price (gp)"><Num value={st.priceGp} onChange={n => set({ priceGp: n })} min={0} max={9999999} w={88} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
            <Field label="Your level"><Num value={st.charLevel} onChange={n => set({ charLevel: n })} min={1} max={25} w={56} /></Field>
            <Field label="Craft prof"><ProfSel value={st.craftProf} onChange={p => set({ craftProf: p })} /></Field>
            <Field label="Craft mod"><Num value={st.craftMod} onChange={n => set({ craftMod: n })} min={-5} max={60} w={56} /></Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-muted)', marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={st.knowFormula} onChange={e => set({ knowFormula: e.target.checked })} />
            Have the item's formula
            <span style={{ color: 'var(--text-faded)', fontSize: 11 }}>
              {st.knowFormula ? '— 1-day setup' : `— 2-day setup (or buy it for ${fmtCoins(formulaPrice)})`}
            </span>
          </label>

          <div style={{ ...lbl, display: 'flex', justifyContent: 'space-between' }}>
            <span>Crafting check</span><span style={{ ...mono, color: 'var(--accent)' }}>DC {craftDC}</span>
          </div>
          <Odds d={craftD} />

          <div style={lbl}>Result by degree</div>
          {statRow('Critical success', <span style={{ color: 'var(--hp-full)' }}>make it · −{fmtCoins(critDaily)}/extra day</span>)}
          {statRow('Success', <>make it · −{fmtCoins(dailyReduce)}/extra day</>)}
          {statRow('Failure', <>no item · salvage all {fmtCoins(materials)}</>)}
          {statRow('Critical failure', <span style={{ color: 'var(--danger)' }}>no item · lose {fmtCoins(critFailLoss)} (10% of materials)</span>)}

          <div style={lbl}>Setup ({setupDays} day{setupDays > 1 ? 's' : ''}) — pay up front</div>
          {statRow('Materials (½ price)', fmtCoins(materials))}

          <div style={{ ...lbl }}>On a success — finish or keep working</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 4 }}>
            Pay the remaining {fmtCoins(remaining)} now, or spend extra days at
            <span style={mono}> {fmtCoins(dailyReduce)}</span>/day (your L{st.charLevel} {st.craftProf} income) to owe less.
            Full discount in <span style={mono}>{daysToFull}</span> extra days.
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>Extra days worked</span>
            <Num value={extra} onChange={n => set({ extraDays: n })} min={0} max={daysToFull} w={56} />
          </div>
          {statRow('Total days', setupDays + extra)}
          {statRow('Total paid', <span style={{ color: 'var(--accent)' }}>{fmtCoins(paidNow)}</span>)}
          <div style={{ fontSize: 10.5, color: 'var(--text-faded)', marginTop: 4, lineHeight: 1.45 }}>
            Materials are only expended on a success. Runes: use the rune's level &amp; price.
          </div>

          <div style={lbl}>vs. Earn Income to buy it</div>
          {statRow('Earn / day (your prof)', fmtCoins(earnPerDay))}
          {statRow('Days to afford full price', daysToBuy || '—')}
        </>
      )}
    </div>
  )
}
