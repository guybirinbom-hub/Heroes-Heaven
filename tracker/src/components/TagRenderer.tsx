import { useGameData, useCreatureLinks } from '../data/gameDataContext'
import { useWindowStore, type WinType } from '../store/windowStore'
import { parseSegments, autoLinkPlainText } from '../utils/tags'
import { GLOSSARY, PROSE_GLOSSARY_KEYS, PROSE_DAMAGE_TRAITS } from '../data/glossary'
import { Tooltip } from './Tooltip'
import { TextWithGlyphs, cleanInlineMarkup } from './ActionGlyph'
import { PopupPreview } from './FloatingWindow'

// ── Generic text content with interactive tags ─────────────────────────────────
export function TagRenderer({ text, className = '' }: { text: string; className?: string }) {
  const { conditions, traits, spells, rituals, actions, skills, creatures, equipment, rules } = useGameData()
  const aonLinks = useCreatureLinks()
  const openWin = useWindowStore(s => s.open)

  if (!text) return null

  // Resolve AoN inline markup (action tags/phrases → glyph symbols, ((note)) →
  // (note)) BEFORE segmenting, so auto-linking can't split a tag mid-way.
  text = cleanInlineMarkup(text)

  // Tag-parsed segments first, then auto-link any *plain* chunks so
  // unwrapped "Disarm" / "Athletics" / "Demoralize" become hover+click links.
  const dictKeys = {
    conditions:   new Set(conditions.keys()),
    actions:      new Set(actions.keys()),
    skills:       new Set(skills.keys()),
    traits:       new Set(traits.keys()),
    glossary:     PROSE_GLOSSARY_KEYS,
    damageTraits: new Set(PROSE_DAMAGE_TRAITS.filter(t => traits.has(t))),
    creatures,  // pass the Map directly — it has `.has`, no Set rebuild needed
    aonLinks,   // AoN's exact per-creature links (term → type), matched first
  }
  const segs = parseSegments(text).flatMap(seg =>
    seg.tagType ? [seg] : autoLinkPlainText(seg.text, dictKeys)
  )

  // Click handler factory — promote the hover-preview to a permanent floating
  // window at the same position. Tooltip hides itself; `noCascade` keeps the
  // popup exactly where the hover was.
  const promote = (type: WinType, ref: string, title: string) =>
    (pos: { x: number; y: number }) => {
      openWin(type, ref, title, pos.x, pos.y, { noCascade: true })
    }

  return (
    <span className={className}>
      {segs.map((seg, i) => {
        if (!seg.tagType) return <TextWithGlyphs key={i} text={seg.text} />

        const key = seg.ref?.toLowerCase() ?? ''
        const label = seg.text

        const linkStyle: React.CSSProperties = {
          color: 'var(--linked)',
          cursor: 'pointer',
          borderBottom: '1px dotted var(--linked)',
          fontWeight: 500,
        }
        const spellLinkStyle: React.CSSProperties = {
          ...linkStyle,
          fontWeight: 600,
        }

        if (seg.tagType === 'condition') {
          // Valued conditions link by base name: "frightened 2" → Frightened.
          const ck = key.replace(/\s+\d+$/, '')
          const has = conditions.has(ck)
          return has ? (
            <Tooltip key={i}
              content={<PopupPreview type="condition" ref_={ck} title={label} />}
              onActivate={promote('condition', ck, label)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
        }
        if (seg.tagType === 'glossary') {
          const g = GLOSSARY[key]
          return g ? (
            <Tooltip key={i}
              content={<PopupPreview type="glossary" ref_={key} title={g.title} />}
              onActivate={promote('glossary', key, g.title)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
        }
        if (seg.tagType === 'trait') {
          const has = traits.has(key)
          return has ? (
            <Tooltip key={i}
              content={<PopupPreview type="trait" ref_={key} title={label} />}
              onActivate={promote('trait', key, label)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
        }
        if (seg.tagType === 'spell') {
          const spell = spells.get(key)
          return spell ? (
            <Tooltip key={i}
              content={<PopupPreview type="spell" ref_={key} title={spell.name} />}
              onActivate={promote('spell', key, spell.name)}
            >
              <span style={spellLinkStyle}>{label}</span>
            </Tooltip>
          ) : (
            <span key={i} style={{ color: 'var(--linked)', fontWeight: 600 }}>{label}</span>
          )
        }
        if (seg.tagType === 'ritual') {
          const ritual = rituals.get(key)
          return ritual ? (
            <Tooltip key={i}
              content={<PopupPreview type="ritual" ref_={key} title={ritual.name} />}
              onActivate={promote('ritual', key, ritual.name)}
            >
              <span style={spellLinkStyle}>{label}</span>
            </Tooltip>
          ) : (
            <span key={i} style={{ color: 'var(--linked)', fontWeight: 600 }}>{label}</span>
          )
        }
        if (seg.tagType === 'action') {
          const has = actions.has(key)
          return has ? (
            <Tooltip key={i}
              content={<PopupPreview type="action" ref_={key} title={label} />}
              onActivate={promote('action', key, label)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : (
            <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
          )
        }
        if (seg.tagType === 'skill') {
          const has = skills.has(key)
          return has ? (
            <Tooltip key={i}
              content={<PopupPreview type="skill" ref_={key} title={label} />}
              onActivate={promote('skill', key, label)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : (
            <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
          )
        }
        if (seg.tagType === 'creature') {
          const entry = creatures.get(key)
          const cTitle = entry?.name ?? label
          return entry ? (
            <Tooltip key={i}
              content={<PopupPreview type="creature" ref_={key} title={cTitle} />}
              onActivate={promote('creature', key, cTitle)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : <span key={i}>{label}</span>
        }
        if (seg.tagType === 'equipment' || seg.tagType === 'item') {
          const has = equipment.has(key)
          return has ? (
            <Tooltip key={i}
              content={<PopupPreview type="equipment" ref_={key} title={label} />}
              onActivate={promote('equipment', key, label)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
        }
        if (seg.tagType === 'rule') {
          const entry = rules.get(key)
          const rTitle = entry?.name ?? label
          return entry ? (
            <Tooltip key={i}
              content={<PopupPreview type="rule" ref_={key} title={rTitle} />}
              onActivate={promote('rule', key, rTitle)}
            >
              <span style={linkStyle}>{label}</span>
            </Tooltip>
          ) : <span key={i}>{label}</span>
        }
        return <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
      })}
    </span>
  )
}

// SpellTooltip moved to FloatingWindow.tsx to avoid a circular import.
// Re-export under the same name for any external callers (StatBlock etc.).
export { SpellTooltip } from './FloatingWindow'
