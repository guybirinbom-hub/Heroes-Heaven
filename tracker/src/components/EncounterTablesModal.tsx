import { XIcon } from './Icons'

interface Props {
  /** Current encounter difficulty, highlighted in the budget table if given. */
  current?: string
  onClose: () => void
}

// PF2e GM Core encounter-building reference tables.
const BUDGET: [string, string, string][] = [
  ['Trivial', '40 or less', '10 or less'],
  ['Low', '60', '20'],
  ['Moderate', '80', '20'],
  ['Severe', '120', '30'],
  ['Extreme', '160', '40'],
]
const ROLES: [string, string, string][] = [
  ['Party Level −4', '10', 'Low-threat lackey'],
  ['Party Level −3', '15', 'Low- or moderate-threat lackey'],
  ['Party Level −2', '20', 'Any lackey or standard creature'],
  ['Party Level −1', '30', 'Any standard creature'],
  ['Party Level', '40', 'Any standard creature or low-threat boss'],
  ['Party Level +1', '60', 'Low- or moderate-threat boss'],
  ['Party Level +2', '80', 'Moderate- or severe-threat boss'],
  ['Party Level +3', '120', 'Severe- or extreme-threat boss'],
  ['Party Level +4', '160', 'Extreme-threat solo boss'],
]

const th: React.CSSProperties = {
  textAlign: 'left', padding: '7px 10px',
  fontFamily: 'var(--font-ui)', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)',
  borderBottom: 'var(--app-bw) solid var(--border-strong)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '6px 10px', fontFamily: 'var(--font-ui)', fontSize: 12.5,
  color: 'var(--text)', borderBottom: 'var(--app-bw) solid var(--border)', verticalAlign: 'top',
}
const tdNum: React.CSSProperties = { ...td, fontFamily: 'var(--font-mono)', color: 'var(--linked)', whiteSpace: 'nowrap' }

export function EncounterTablesModal({ current, onClose }: Props) {
  const cur = (current ?? '').toLowerCase()
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 660, maxHeight: '88vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="page-title-display" style={{ fontSize: 19, fontWeight: 500, margin: 0, letterSpacing: '-0.015em' }}>
            Encounter Building
          </h2>
          <button className="ico-btn" style={{ width: 30, height: 30 }} onClick={onClose} title="Close">
            <XIcon size={16} />
          </button>
        </div>

        {/* Encounter Budget */}
        <div>
          <div className="pf-label" style={{ marginBottom: 6 }}>XP Budget by Threat</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Threat</th>
                <th style={{ ...th, textAlign: 'right' }}>XP Budget</th>
                <th style={{ ...th, textAlign: 'right' }}>Character Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {BUDGET.map(([threat, xp, adj]) => {
                const on = threat.toLowerCase() === cur
                return (
                  <tr key={threat} style={on ? { background: 'var(--accent-soft)' } : undefined}>
                    <td style={{ ...td, fontWeight: on ? 700 : 600, color: on ? 'var(--accent)' : 'var(--text)' }}>{threat}</td>
                    <td style={{ ...tdNum, textAlign: 'right' }}>{xp}</td>
                    <td style={{ ...tdNum, textAlign: 'right', color: 'var(--text-muted)' }}>{adj}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 7, fontFamily: 'var(--font-ui)', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            “Character Adjustment” is how much to raise or lower the XP budget for each player above or below a party of 4.
          </div>
        </div>

        {/* Creature XP & Role */}
        <div>
          <div className="pf-label" style={{ marginBottom: 6 }}>Creature XP by Level</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Creature Level</th>
                <th style={{ ...th, textAlign: 'right' }}>XP</th>
                <th style={th}>Suggested Role</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map(([lvl, xp, role]) => (
                <tr key={lvl}>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{lvl}</td>
                  <td style={{ ...tdNum, textAlign: 'right' }}>{xp}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
