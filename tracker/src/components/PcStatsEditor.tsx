import { useState, useEffect } from 'react'
import { usePartyStore, type PartyPlayer } from '../store/partyStore'
import {
  PROF_RANKS, PROF_LABEL, PC_SKILLS, ABILITIES,
  type ProfRank, type PcDetailConfig, type PcStats,
} from '../utils/pcDetail'

// ── Editable PF2e stat sheet for a PC card ─────────────────────────────────
// Renders only the sections enabled in `detail`. All values are live-edited
// into the party store. Themed entirely with CSS vars so it tracks every
// palette.

// Small numeric field (accepts +/-, blank = unset).
function Num({ value, onCommit, w = 46, placeholder = '—' }: {
  value: number | undefined; onCommit: (v: number | undefined) => void; w?: number | string; placeholder?: string
}) {
  const [t, setT] = useState(value == null ? '' : String(value))
  useEffect(() => { setT(value == null ? '' : String(value)) }, [value])
  return (
    <input
      value={t} placeholder={placeholder} inputMode="numeric"
      onChange={e => {
        const raw = e.target.value
        setT(raw)
        const n = parseInt(raw, 10)
        onCommit(raw.trim() === '' || isNaN(n) ? undefined : n)
      }}
      onClick={e => e.stopPropagation()}
      style={{
        width: w, textAlign: 'center', background: 'var(--bg-base)',
        border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 4,
        color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12.5,
        padding: '3px 4px', outline: 'none',
      }}
    />
  )
}

// Proficiency rank — click to cycle U → T → E → M → L.
function Prof({ value, onChange }: { value: ProfRank | undefined; onChange: (v: ProfRank) => void }) {
  const cur: ProfRank = value ?? 'U'
  const cycle = () => onChange(PROF_RANKS[(PROF_RANKS.indexOf(cur) + 1) % PROF_RANKS.length])
  const color = cur === 'U' ? 'var(--text-faded)' : cur === 'T' ? 'var(--linked)' : 'var(--accent)'
  const bg = cur === 'U' ? 'transparent' : cur === 'T' ? 'var(--linked-soft)' : 'var(--accent-soft)'
  const border = cur === 'U' ? 'var(--border-strong)' : cur === 'T' ? 'var(--linked)' : 'var(--accent-line)'
  return (
    <button onClick={e => { e.stopPropagation(); cycle() }} title={`${PROF_LABEL[cur]} — click to cycle`}
      style={{
        width: 20, height: 20, borderRadius: 4, cursor: 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800,
        background: bg, color, border: `var(--app-bw) solid ${border}`, flexShrink: 0,
      }}>{cur}</button>
  )
}

const groupTitle: React.CSSProperties = {
  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--text-faded)', marginBottom: 5,
}
const tileStyle: React.CSSProperties = {
  flex: 1, background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border)',
  borderRadius: 6, padding: '6px 8px', textAlign: 'center',
}
const tileLabel: React.CSSProperties = {
  fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--text-faded)', marginTop: 3,
}
const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border)',
  borderRadius: 5, padding: '3px 6px',
}
const pillKey: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)' }

export function PcStatsEditor({ partyId, player, detail }: {
  partyId: string; player: PartyPlayer; detail: PcDetailConfig
}) {
  const updatePcStats = usePartyStore(s => s.updatePcStats)
  const updatePcSkill = usePartyStore(s => s.updatePcSkill)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const st: PcStats = player.pcStats ?? {}
  const set = (patch: Partial<PcStats>) => updatePcStats(partyId, player.id, patch)

  const anyTiles = detail.defenses || detail.perception
  const trainedSkills = Object.values(st.skills ?? {}).filter(s => s.prof && s.prof !== 'U').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Ancestry / class + level */}
      {detail.ancestry && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={st.ancestryClass ?? ''} placeholder="Ancestry & class"
            onChange={e => set({ ancestryClass: e.target.value })}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border)',
              borderRadius: 5, color: 'var(--text)', fontSize: 11.5, padding: '4px 8px', outline: 'none',
            }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-faded)' }}>Lv</span>
          <Num value={st.level} onCommit={v => set({ level: v })} w={38} />
        </div>
      )}

      {/* AC / HP / Perception tiles */}
      {anyTiles && (
        <div style={{ display: 'flex', gap: 8 }}>
          {detail.defenses && (
            <div style={tileStyle}>
              <Num value={st.ac} onCommit={v => set({ ac: v })} w={48} />
              <div style={tileLabel}>AC</div>
            </div>
          )}
          {detail.defenses && (
            <div style={tileStyle}>
              <Num value={st.maxHP} onCommit={v => set({ maxHP: v })} w={48} />
              <div style={tileLabel}>Max HP</div>
            </div>
          )}
          {detail.perception && (
            <div style={tileStyle}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Num value={st.perceptionMod} onCommit={v => set({ perceptionMod: v })} w={40} />
                <Prof value={st.perceptionProf} onChange={v => set({ perceptionProf: v })} />
              </div>
              <div style={tileLabel}>Perception</div>
            </div>
          )}
        </div>
      )}

      {/* Saves */}
      {detail.saves && (
        <div>
          <div style={groupTitle}>Saves</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {([['Fort', 'fortMod', 'fortProf'], ['Ref', 'refMod', 'refProf'], ['Will', 'willMod', 'willProf']] as const).map(([lbl, mk, pk]) => (
              <span key={lbl} style={pill}>
                <span style={pillKey}>{lbl}</span>
                <Num value={st[mk] as number | undefined} onCommit={v => set({ [mk]: v })} w={38} />
                <Prof value={st[pk] as ProfRank | undefined} onChange={v => set({ [pk]: v })} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Ability modifiers */}
      {detail.abilities && (
        <div>
          <div style={groupTitle}>Ability modifiers</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
            {ABILITIES.map(({ key, label }) => (
              <div key={key} style={{ textAlign: 'center' }}>
                <Num value={st[key] as number | undefined} onCommit={v => set({ [key]: v })} w="100%" />
                <div style={{ ...tileLabel, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills (collapsible) */}
      {detail.skills && (
        <div>
          <button
            onClick={e => { e.stopPropagation(); setSkillsOpen(o => !o) }}
            style={{
              ...groupTitle, marginBottom: skillsOpen ? 6 : 0,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}
          >
            <span style={{ fontSize: 9, color: 'var(--text-faded)' }}>{skillsOpen ? '▾' : '▸'}</span>
            Skills
            {!skillsOpen && trainedSkills > 0 && (
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>· {trainedSkills} trained</span>
            )}
          </button>
          {skillsOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
              {PC_SKILLS.map(sk => {
                const s = st.skills?.[sk] ?? {}
                // minWidth:0 at BOTH levels (grid cell + flex name) so the name
                // ellipsizes instead of pushing the Num/Prof boxes past the
                // card's right edge.
                return (
                  <div key={sk} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sk}</span>
                    <Num value={s.mod} onCommit={v => updatePcSkill(partyId, player.id, sk, { mod: v })} w={36} />
                    <Prof value={s.prof} onChange={v => updatePcSkill(partyId, player.id, sk, { prof: v })} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Speed & DCs */}
      {detail.speedDCs && (
        <div>
          <div style={groupTitle}>Speed &amp; DCs</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <span style={pill}><span style={pillKey}>Speed</span><Num value={st.speed} onCommit={v => set({ speed: v })} w={42} /><span style={pillKey}>ft</span></span>
            <span style={pill}><span style={pillKey}>Class DC</span><Num value={st.classDC} onCommit={v => set({ classDC: v })} w={40} /></span>
            <span style={pill}><span style={pillKey}>Spell DC</span><Num value={st.spellDC} onCommit={v => set({ spellDC: v })} w={40} /></span>
          </div>
        </div>
      )}

      {/* Senses & languages */}
      {detail.sensesLangs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(['senses', 'languages'] as const).map(k => (
            <input key={k}
              value={(st[k] as string) ?? ''} placeholder={k === 'senses' ? 'Senses (e.g. darkvision)' : 'Languages'}
              onChange={e => set({ [k]: e.target.value })}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border)',
                borderRadius: 5, color: 'var(--text)', fontSize: 11, padding: '4px 8px', outline: 'none',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
