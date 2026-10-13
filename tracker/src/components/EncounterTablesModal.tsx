import { XIcon } from './Icons'
import { describeParty, type PartyInFight, type EncounterStats } from '../utils/encounter'
import { useEscapeCloses } from '../utils/spendEscape'

interface Props {
  /** Current encounter difficulty, highlighted in the budget table if given. */
  current?: string
  /** The party the badge rated the fight against (encounter.partyOf) — shown so the GM can see who
   *  was counted, at what level (owner's list 2026-10-01, item 5). Absent: the plain reference. */
  party?: PartyInFight
  /** That party's thresholds (computeEncounter's budget), shown beside the 4-player table. */
  budget?: EncounterStats['budget']
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

export function EncounterTablesModal({ current, party, budget, onClose }: Props) {
  // Escape closes it and goes no further — unless something is drawn over it (Search, Ctrl+K), whose
  // press it is (utils/spendEscape useEscapeCloses; the ref says which element is this modal).
  const escapeRef = useEscapeCloses(onClose)
  const cur = (current ?? '').toLowerCase()
  // This party's column: shown only when the badge handed over who it counted.
  const mine = party && budget ? budget : null
  const mineCell = (threat: string): string => {
    if (!mine) return ''
    const t = mine[threat.toLowerCase() as keyof typeof mine]
    return threat === 'Trivial' ? `${t} or less` : String(t)
  }
  return (
    <div className="modal-overlay" ref={escapeRef} onClick={e => e.target === e.currentTarget && onClose()}>
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

        {/* Who this fight was rated against */}
        {party && (
          <div data-testid="encounter-party" style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>
            <div className="pf-label" style={{ marginBottom: 4 }}>This fight is rated against</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--linked)' }}>{describeParty(party)}</div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
              Only the party members in the initiative order count, each at their own level. Party level per GM Core
              pg. 57: the highest level if only one or two are behind, otherwise the average; a member 2 or more
              levels above it counts as one more member per 2 levels.
            </div>
          </div>
        )}

        {/* Encounter Budget */}
        <div>
          <div className="pf-label" style={{ marginBottom: 6 }}>XP Budget by Threat</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Threat</th>
                <th style={{ ...th, textAlign: 'right' }}>XP Budget</th>
                <th style={{ ...th, textAlign: 'right' }}>Character Adjustment</th>
                {/* The size the badge's budget used (InitiativeTracker keeps it at least 1). */}
                {mine && party && <th style={{ ...th, textAlign: 'right' }}>This party ({Math.max(1, party.size + party.extra)})</th>}
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
                    {mine && <td style={{ ...tdNum, textAlign: 'right', fontWeight: on ? 700 : undefined }}>{mineCell(threat)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 7, fontFamily: 'var(--font-ui)', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            “Character Adjustment” is how much to raise or lower the XP budget for each party member (a PC or a party NPC with a stat block) above or below a party of 4.
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
