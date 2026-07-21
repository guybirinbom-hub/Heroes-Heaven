import {
  PROF_LABEL, PC_SKILLS, ABILITIES,
  type ProfRank, type PcDetailConfig, type PcStats,
} from '../utils/pcDetail'
import { TagRenderer } from './TagRenderer'

// ── Read-only PC stat sheet for the detail panel (large screen) ────────────
// Shows the same stats as the party card, laid out spaciously. Respects the
// active detail level. Themed with CSS vars so it tracks every palette.

function profColor(p: ProfRank): string {
  return p === 'U' ? 'var(--text-faded)' : p === 'T' ? 'var(--linked)' : 'var(--accent)'
}
function ProfBadge({ p }: { p?: ProfRank }) {
  if (!p || p === 'U') return null
  return (
    <span title={PROF_LABEL[p]} style={{
      fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 800,
      color: profColor(p), background: p === 'T' ? 'var(--linked-soft)' : 'var(--accent-soft)',
      border: `var(--app-bw) solid ${p === 'T' ? 'var(--linked)' : 'var(--accent-line)'}`,
      borderRadius: 3, padding: '0 4px', marginLeft: 5, verticalAlign: 'middle',
    }}>{p}</span>
  )
}

const fmt = (n: number | undefined) => n == null ? '—' : (n >= 0 ? `+${n}` : `${n}`)
const plain = (n: number | undefined) => n == null ? '—' : String(n)

function Tile({ label, value, prof, big }: { label: string; value: string; prof?: ProfRank; big?: boolean }) {
  return (
    <div style={{
      minWidth: big ? 92 : 78, background: 'var(--bg-elevated)',
      border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius-sm)',
      padding: '10px 12px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: big ? 22 : 18, fontWeight: 600, color: 'var(--text)' }}>
        {value}<ProfBadge p={prof} />
      </div>
      <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faded)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

const sectionHdr: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase',
  color: 'var(--accent)', borderBottom: 'var(--app-bw) solid var(--border-strong)',
  paddingBottom: 6, marginBottom: 12,
}

export function PcStatsDisplay({ stats, detail }: { stats: PcStats; detail: PcDetailConfig }) {
  const st = stats
  // Skills the DM has actually filled in.
  const enteredSkills = PC_SKILLS.filter(sk => {
    const s = st.skills?.[sk]
    return s && (s.mod != null || (s.prof && s.prof !== 'U'))
  })

  // Top "key stats" tiles (defenses / perception / saves / speed+DCs).
  const tiles: { label: string; value: string; prof?: ProfRank }[] = []
  if (detail.defenses) {
    tiles.push({ label: 'AC', value: plain(st.ac) })
    // Once this PC has taken damage in a tracked fight, show live current/max.
    tiles.push(st.hpCurrent != null && st.maxHP != null
      ? { label: 'HP', value: `${st.hpCurrent} / ${st.maxHP}` }
      : { label: 'Max HP', value: plain(st.maxHP) })
  }
  if (detail.perception) tiles.push({ label: 'Perception', value: fmt(st.perceptionMod), prof: st.perceptionProf })
  if (detail.saves) {
    tiles.push({ label: 'Fortitude', value: fmt(st.fortMod), prof: st.fortProf })
    tiles.push({ label: 'Reflex', value: fmt(st.refMod), prof: st.refProf })
    tiles.push({ label: 'Will', value: fmt(st.willMod), prof: st.willProf })
  }
  if (detail.speedDCs) {
    tiles.push({ label: 'Speed', value: st.speed == null ? '—' : `${st.speed} ft` })
    tiles.push({ label: 'Class DC', value: plain(st.classDC) })
    tiles.push({ label: 'Spell DC', value: plain(st.spellDC) })
  }

  const anything = tiles.length || detail.abilities || (detail.skills && enteredSkills.length)
    || (detail.sensesLangs && (st.senses || st.languages)) || (detail.ancestry && (st.ancestryClass || st.level != null))

  if (!anything) {
    return (
      <div style={{ color: 'var(--text-faded)', fontSize: 12.5, fontStyle: 'italic' }}>
        No character stats recorded yet — add them on this player's party page.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {detail.ancestry && (st.ancestryClass || st.level != null) && (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {st.ancestryClass}
          {st.ancestryClass && st.level != null && <span style={{ color: 'var(--text-faded)' }}> · </span>}
          {st.level != null && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>Level {st.level}</span>}
        </div>
      )}

      {tiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {tiles.map((t, i) => <Tile key={i} {...t} big />)}
        </div>
      )}

      {detail.abilities && (
        <div>
          <div style={sectionHdr}>Ability Modifiers</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
            {ABILITIES.map(({ key, label }) => (
              <Tile key={key} label={label} value={fmt(st[key] as number | undefined)} />
            ))}
          </div>
        </div>
      )}

      {detail.skills && (
        <div>
          <div style={sectionHdr}>Skills</div>
          {enteredSkills.length === 0 ? (
            <div style={{ color: 'var(--text-faded)', fontSize: 12, fontStyle: 'italic' }}>None recorded.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px 16px' }}>
              {enteredSkills.map(sk => {
                const s = st.skills![sk]
                return (
                  <div key={sk} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, borderBottom: 'var(--app-bw) solid var(--border)', paddingBottom: 5 }}>
                    <span style={{ color: 'var(--text)' }}>{sk}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fmt(s.mod)}<ProfBadge p={s.prof} /></span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {detail.sensesLangs && (st.senses || st.languages) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {st.senses && <div><span style={{ fontWeight: 700, color: 'var(--text)' }}>Senses</span> <span style={{ color: 'var(--text-muted)' }}><TagRenderer text={st.senses} /></span></div>}
          {st.languages && <div><span style={{ fontWeight: 700, color: 'var(--text)' }}>Languages</span> <span style={{ color: 'var(--text-muted)' }}>{st.languages}</span></div>}
        </div>
      )}
    </div>
  )
}
