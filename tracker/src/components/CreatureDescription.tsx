import type { Creature } from '../types/pf2e'
import { TagRenderer } from './TagRenderer'
import { useGameData, CreatureLinksCtx } from '../data/gameDataContext'

// Renders a creature's AoN flavor blurb + its creature-family description.
// The stored text is light markdown: `### ` headings, `• ` bullets, blank-line
// separated paragraphs. Prose runs go through TagRenderer so trait / spell /
// condition mentions stay hoverable.

// The flavor blurb ends with a structured "Recall Knowledge - <Type>
// (<skills>): DC … / Unspecific Lore / Specific Lore" block. That info already
// lives on the stat block (its Recall Knowledge row), so strip it here to avoid
// showing it twice. The `[-(]` guard keeps us from cutting a prose sentence
// that merely mentions recall knowledge.
function stripRecallKnowledge(text: string): string {
  return text
    .replace(/(?:^|\n)[ \t]*Recall Knowledge[ \t]*[-(][\s\S]*$/i, '')
    .replace(/(?:^|\n)[ \t]*(?:Unspecific|Specific) Lore:[^\n]*/gi, '')
    .trim()
}

// `dir="auto"` on each block lets Hebrew/Arabic paragraphs flip to RTL on their
// own (per the first strong character) while English stays LTR — so mixed or
// fully right-to-left descriptions read correctly.
function renderRich(text: string, keyBase: string) {
  return text.split('\n').map((raw, i) => {
    const line = raw.trim()
    if (!line) return null
    const h = line.match(/^#{1,6}\s+(.+)/)
    if (h) {
      return (
        <div key={`${keyBase}-${i}`} dir="auto" style={{
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15,
          color: 'var(--text)', margin: i === 0 ? '0 0 6px' : '12px 0 6px',
        }}>{h[1]}</div>
      )
    }
    const b = line.match(/^•\s*(.+)/)
    if (b) {
      return (
        <div key={`${keyBase}-${i}`} dir="auto" style={{ display: 'flex', gap: 7, margin: '3px 0', paddingLeft: 4 }}>
          <span style={{ color: 'var(--accent)' }}>•</span>
          <span style={{ flex: 1 }}><TagRenderer text={b[1]} /></span>
        </div>
      )
    }
    return <p key={`${keyBase}-${i}`} dir="auto" style={{ margin: '0 0 9px' }}><TagRenderer text={line} /></p>
  })
}

export function CreatureDescription({ creature, familyText }: { creature: Creature; familyText?: string }) {
  // Recall Knowledge lives on the stat block, so drop it from the blurb here.
  const flavor = creature.flavor ? stripRecallKnowledge(creature.flavor) : ''
  const hasAny = !!(flavor || familyText)
  const { creatureLinks } = useGameData()
  return (
    <CreatureLinksCtx.Provider value={creatureLinks.get(creature.name.toLowerCase())}>
    <div style={{ padding: '16px 24px 24px', fontSize: 13.5, lineHeight: 1.62, color: 'var(--text)' }}>
      {flavor && <div>{renderRich(flavor, 'flavor')}</div>}

      {familyText && (
        <div style={{ marginTop: flavor ? 18 : 0, paddingTop: flavor ? 16 : 0, borderTop: flavor ? 'var(--app-bw) solid var(--border)' : 'none' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 2,
          }}>Creature Family</div>
          {creature.family && (
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>
              {creature.family}
            </div>
          )}
          {renderRich(familyText, 'family')}
        </div>
      )}

      {!hasAny && (
        <div style={{ color: 'var(--text-faded)', fontStyle: 'italic' }}>No description available for this creature.</div>
      )}
    </div>
    </CreatureLinksCtx.Provider>
  )
}
