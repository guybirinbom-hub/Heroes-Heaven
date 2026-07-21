import { useRef, createContext, useContext, useState, useEffect } from 'react'
import { useWindowStore, type FloatingWin, type WinType, type PopupTab } from '../store/windowStore'
import { CombatantDetail } from './CombatantDetail'
import { useSettingsStore } from '../store/settingsStore'
import { beginDockDrag, beginBrowserDrag, useDockDrag } from '../store/dockDragStore'
import { useGameData, useCreatureLinks } from '../data/gameDataContext'
import { Tooltip } from './Tooltip'
import { TextWithGlyphs, ActionGlyph } from './ActionGlyph'
import type { EquipmentInfo, SpellInfo, RitualInfo } from '../data/dataStore'
import { loadCreatureByName } from '../data/dataStore'
import type { Creature } from '../types/pf2e'
import { parseSegments, autoLinkPlainText, joinCriticalDegrees, decodeEntities } from '../utils/tags'
import { formatSpellDuration } from '../utils/formatDuration'
import { GLOSSARY, PROSE_GLOSSARY_KEYS, PROSE_DAMAGE_TRAITS } from '../data/glossary'
import { heightenSpell, applyHeightenedDamage } from '../utils/heightenSpell'
import { TableAwareText } from './MarkdownTable'
import { useCombatStore } from '../store/combatStore'
import { rollDamageExpr } from '../utils/dice'
import { GmWidgetBody } from './GmWidgets'

// ── Recursive rich-text renderer ──────────────────────────────────────────
// Drop-in replacement for `TextWithGlyphs` that ALSO renders `{@trait X}` /
// `{@spell Y}` / `{@condition Z}` / `{@action W}` / `{@skill S}` segments as
// hover-tooltip + click-promote-to-window links. Used inside popup bodies so
// nested terms get the same hover/click affordance as top-level ones — pop-ups
// can spawn pop-ups recursively.
//
// Defined here (not imported from TagRenderer) so we don't create a circular
// import (TagRenderer imports PopupPreview from this file).
const RICH_LINK_STYLE: React.CSSProperties = {
  color: 'var(--linked)', cursor: 'pointer',
  borderBottom: '1px dotted var(--linked)', fontWeight: 500,
}
const RICH_SPELL_STYLE: React.CSSProperties = { ...RICH_LINK_STYLE, fontWeight: 600 }

// The subject of the popup currently being rendered. RichText reads this to
// suppress self-referential links — e.g. the word "fire" in the fire trait
// popup shouldn't be a link back to the same popup. null outside any popup
// (e.g. main stat block), where nothing is suppressed.
const SelfRefContext = createContext<{ type: WinType; ref: string } | null>(null)

// ── Rollable plain text ──────────────────────────────────────────────────────
// Wraps dice expressions (6d6, 2d4+3, …) in any popup body in a clickable
// roller that drops the result into the shared dice log. Non-dice text still
// goes through TextWithGlyphs so action glyphs keep rendering. For heightened
// spells the injected "(10d6)" is just another dice expression, so both the
// base and heightened rolls become clickable.
const DICE_RE = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/g

function RollableText({ text, label }: { text: string; label?: string }) {
  const addDiceResult = useCombatStore(s => s.addDiceResult)
  if (!text) return null
  DICE_RE.lastIndex = 0
  if (!DICE_RE.test(text)) return <TextWithGlyphs text={text} />
  DICE_RE.lastIndex = 0
  const out: React.ReactNode[] = []
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = DICE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(<TextWithGlyphs key={`t${i}`} text={text.slice(last, m.index)} />)
    const expr = m[1].replace(/\s+/g, '')
    out.push(
      <span key={`d${i}`}
        onClick={e => { e.stopPropagation(); addDiceResult(rollDamageExpr(expr, label ? `${label} — ${expr}` : expr)) }}
        title={`Roll ${expr}`}
        style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, borderBottom: '1px dotted var(--accent-line)' }}
      >{m[1]}</span>,
    )
    last = m.index + m[1].length
    i++
  }
  if (last < text.length) out.push(<TextWithGlyphs key={`t${i}`} text={text.slice(last)} />)
  return <>{out}</>
}

function RichText({ text, rollLabel }: { text: string; rollLabel?: string }) {
  const { conditions, traits, spells, actions, skills, equipment, creatures, rules } = useGameData()
  const aonLinks = useCreatureLinks()
  const openWin = useWindowStore(s => s.open)
  const self = useContext(SelfRefContext)
  if (!text) return null
  const promote = (type: WinType, ref: string, title: string) =>
    (pos: { x: number; y: number }) => openWin(type, ref, title, pos.x, pos.y, { noCascade: true })

  // Build the segment list: tag-parsed first, then auto-link any *plain*
  // chunks so "Disarm" or "Athletics" in raw description text also becomes
  // a hover/click link (the AoN data drops a lot of these unwrapped).
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

  // Pick the store the tag references; render as a non-clickable colored
  // span if the reference isn't in our data set.
  // popupTitle defaults to the visible label, but callers can pass a different
  // header title (e.g. glossary "physical" → "Physical damage") while keeping
  // the in-prose link text as the literal word.
  const renderLink = (i: number, label: string, type: WinType, ref: string, has: boolean, style = RICH_LINK_STYLE, popupTitle = label) => {
    // Don't link a term back to the popup that's describing it (the "fire" in
    // the fire trait popup, etc.) — render it as plain body text.
    if (self && self.type === type && self.ref === ref) return <span key={i}>{label}</span>
    return has
      ? (
        <Tooltip key={i}
          content={<PopupPreview type={type} ref_={ref} title={popupTitle} />}
          onActivate={promote(type, ref, popupTitle)}
        >
          <span style={style}>{label}</span>
        </Tooltip>
      )
      : <span key={i} style={{ color: 'var(--linked)', ...(style === RICH_SPELL_STYLE ? { fontWeight: 600 } : {}) }}>{label}</span>
  }

  return (
    <span>
      {segs.map((seg, i) => {
        if (!seg.tagType) return <RollableText key={i} text={seg.text} label={rollLabel} />
        const key = seg.ref?.toLowerCase() ?? ''
        const label = seg.text
        const tt = seg.tagType

        if (tt === 'condition') { const k = key.replace(/\s+\d+$/, ''); return renderLink(i, label, 'condition', k, conditions.has(k)) }
        if (tt === 'glossary')  return renderLink(i, label, 'glossary',  key, !!GLOSSARY[key], RICH_LINK_STYLE, GLOSSARY[key]?.title ?? label)
        if (tt === 'trait')     return renderLink(i, label, 'trait',     key, traits.has(key))
        if (tt === 'spell')     return renderLink(i, label, 'spell',     key, spells.has(key), RICH_SPELL_STYLE)
        if (tt === 'action')    return renderLink(i, label, 'action',    key, actions.has(key))
        if (tt === 'skill')     return renderLink(i, label, 'skill',     key, skills.has(key))
        if (tt === 'item' || tt === 'equipment')
          return renderLink(i, label, 'equipment', key, equipment.has(key))
        if (tt === 'creature')
          return renderLink(i, label, 'creature', key, creatures.has(key), RICH_LINK_STYLE, creatures.get(key)?.name ?? label)
        if (tt === 'rule')
          return renderLink(i, label, 'rule', key, rules.has(key), RICH_LINK_STYLE, rules.get(key)?.name ?? label)
        return <span key={i} style={{ color: 'var(--linked)' }}>{label}</span>
      })}
    </span>
  )
}

// ── Component icons (spell components V/S/M/F) ─────────────────────────────
function ComponentBadge({ c }: { c: string }) {
  const label = c === 'verbal' ? 'V' : c === 'somatic' ? 'S' : c === 'material' ? 'M' : c === 'focus' ? 'F' : c.charAt(0).toUpperCase()
  const title = c.charAt(0).toUpperCase() + c.slice(1)
  return (
    <Tooltip content={title}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, borderRadius: 3, fontSize: 9, fontWeight: 700,
        background: 'var(--bg-elevated)',
        border: 'var(--app-bw) solid var(--border)',
        color: 'var(--accent)',
        cursor: 'default',
      }}>{label}</span>
    </Tooltip>
  )
}

// ── Trait pill — used inside SpellTooltip ──────────────────────────────────
function TraitPill({ name }: { name: string }) {
  const { traits } = useGameData()
  const openWin = useWindowStore(s => s.open)
  const key = name.toLowerCase()
  const has = traits.has(key)
  const display = name.charAt(0).toUpperCase() + name.slice(1)
  const pill = (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 3,
        letterSpacing: '.10em', textTransform: 'uppercase',
        background: 'var(--bg-elevated)',
        border: 'var(--app-bw) solid var(--border)',
        color: 'var(--text-muted)',
        cursor: has ? 'pointer' : 'default', flexShrink: 0,
      }}
    >{display}</span>
  )
  if (!has) return pill
  // Use Tooltip's onActivate so clicking the pill promotes the *hover popup*
  // to a window at the same screen position — matching the behaviour of
  // RichText tag links inside descriptions.
  return (
    <Tooltip
      content={<PopupPreview type="trait" ref_={key} title={display} />}
      onActivate={(p) => openWin('trait', key, display, p.x, p.y, { noCascade: true })}
    >{pill}</Tooltip>
  )
}

// ── Description body — handles Success / Failure colour-coded sections ────
function DescriptionBlock({ text, rollLabel }: { text: string; rollLabel?: string }) {
  if (!text) return null
  const renderProse = (t: string) => joinCriticalDegrees(t).split('\n').map((line, i) => {
    const successMatch = line.match(/^(Critical Success|Critical Failure|Success|Failure)[:\s]+(.*)/)
    if (successMatch) {
      const [, label, rest] = successMatch
      const color = label.includes('Success') ? 'var(--hp-full)' : 'var(--danger)'
      return (
        <div key={i} style={{ marginTop: 4 }}>
          <span style={{ fontWeight: 700, color, fontSize: 11, letterSpacing: '0.04em' }}>{label}</span>{' '}
          <RichText text={rest} rollLabel={rollLabel} />
        </div>
      )
    }
    return <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}><RichText text={line} rollLabel={rollLabel} /></div>
  })
  return (
    <div style={{ lineHeight: 1.6, fontSize: 13, color: 'var(--text)' }}>
      <TableAwareText
        text={text}
        renderText={renderProse}
        renderCell={c => <RichText text={c} rollLabel={rollLabel} />}
      />
    </div>
  )
}

// ── Heightened section (collapsed below the main description) ─────────────
function HeightenedSection({ heightened, rollLabel }: { heightened: Record<string, string>; rollLabel?: string }) {
  const entries = Object.entries(heightened).sort((a, b) => {
    const aPlus = a[0].startsWith('+'), bPlus = b[0].startsWith('+')
    if (aPlus !== bPlus) return aPlus ? -1 : 1
    return parseInt(a[0]) - parseInt(b[0])
  })
  if (!entries.length) return null
  // Some scraped entries cram several ranks into one value
  // ("… Heightened (6th) …"). Split each embedded "Heightened (X)" onto its
  // own line so every rank reads separately.
  const lines: Array<{ rank: string; text: string }> = []
  for (const [key, desc] of entries) {
    const marks = [...desc.matchAll(/Heightened\s*\(([^)]+)\)\s*/g)]
    if (marks.length === 0) { if (desc.trim()) lines.push({ rank: key, text: desc.trim() }); continue }
    const head = desc.slice(0, marks[0].index).trim()
    if (head) lines.push({ rank: key, text: head })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index! + marks[i][0].length
      const end = i + 1 < marks.length ? marks[i + 1].index! : desc.length
      const text = desc.slice(start, end).trim()
      if (text) lines.push({ rank: marks[i][1], text })
    }
  }
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--app-bw) solid var(--border)' }}>
      {lines.map((ln, i) => (
        <div key={i} style={{ marginBottom: 5, fontSize: 12.5, color: 'var(--text)' }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>
            Heightened {ln.rank.startsWith('+') ? `(+${ln.rank.slice(1)})` : `(${ln.rank})`}
          </span>{' '}
          <RichText text={ln.text} rollLabel={rollLabel} />
        </div>
      ))}
    </div>
  )
}

// ── Source line ─────────────────────────────────────────────────────────────
// The book/page citation at the bottom of a popup. Shown only when the
// "Show source" setting is on (Settings → Display).
function SourceLine({ source }: { source?: string }) {
  const showSource = useSettingsStore(s => s.showSource)
  if (!source || !showSource) return null
  return (
    <div style={{
      marginTop: 12, paddingTop: 8, borderTop: 'var(--app-bw) solid var(--border)',
      fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-faded)', fontStyle: 'italic',
    }}>
      📖 {decodeEntities(source)}
    </div>
  )
}

// ── Spell display (used both in tooltip and floating window) ─────────────
export function SpellTooltip({ spell, castRank }: { spell: SpellInfo; castRank?: number }) {
  // When a creature casts this above its base rank, compute the heightened
  // numbers and surface them as "base (heightened)".
  const h = castRank != null ? heightenSpell(spell, castRank) : null
  const range = h?.range ?? spell.range
  const area = h?.area ?? spell.area
  const desc = h ? applyHeightenedDamage(spell.description, h) : spell.description
  return (
    <div style={{ minWidth: 220 }}>
      {spell.traits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {spell.traits.map(t => <TraitPill key={t} name={t} />)}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 10, fontSize: 11.5, alignItems: 'center' }}>
        {spell.cast && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>Cast</span>
            <ActionGlyph act={spell.cast} />
            {spell.components && spell.components.length > 0 && (
              <span style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
                {spell.components.map(c => <ComponentBadge key={c} c={c} />)}
              </span>
            )}
          </span>
        )}
        {range    && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Range</span> {range}</span>}
        {area     && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Area</span> {area}</span>}
        {spell.targets  && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Targets</span> {spell.targets}</span>}
        {spell.duration && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Duration</span> {formatSpellDuration(spell.duration)}</span>}
        {spell.savingThrow && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Save</span> {spell.savingThrow}</span>}
      </div>

      <div style={{ borderTop: 'var(--app-bw) solid var(--border)', marginBottom: 10 }} />

      <DescriptionBlock text={cleanDescriptionBody(desc)} rollLabel={spell.name} />

      {spell.heightened && Object.keys(spell.heightened).length > 0 && (
        <HeightenedSection heightened={spell.heightened} rollLabel={spell.name} />
      )}

      <SourceLine source={spell.source} />
    </div>
  )
}

// Ritual popup — mirrors SpellTooltip but with the ritual-specific header
// fields (Cast time, Cost, Secondary Casters, Primary/Secondary checks).
export function RitualTooltip({ ritual }: { ritual: RitualInfo }) {
  const stat = (label: string, val?: string) => val
    ? <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{label}</span> {val}</span>
    : null
  return (
    <div style={{ minWidth: 220 }}>
      {ritual.traits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {ritual.traits.map(t => <TraitPill key={t} name={t} />)}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 10, fontSize: 11.5 }}>
        {stat('Cast', ritual.cast)}
        {stat('Cost', ritual.cost)}
        {stat('Secondary Casters', ritual.secondaryCasters)}
        {stat('Primary Check', ritual.primaryCheck)}
        {stat('Secondary Checks', ritual.secondaryChecks)}
        {stat('Range', ritual.range)}
        {stat('Area', ritual.area)}
        {stat('Targets', ritual.targets)}
        {stat('Duration', ritual.duration)}
      </div>
      <div style={{ borderTop: 'var(--app-bw) solid var(--border)', marginBottom: 10 }} />
      <DescriptionBlock text={cleanDescriptionBody(ritual.description)} rollLabel={ritual.name} />
      {ritual.heightened && Object.keys(ritual.heightened).length > 0 && (
        <HeightenedSection heightened={ritual.heightened} rollLabel={ritual.name} />
      )}
      <SourceLine source={ritual.source} />
    </div>
  )
}

// ── Strip leading junk from condition/trait/action/skill descriptions ──────────
// AoN text fields begin with: "[Name] [CastTime?] Source [Book] pg. [N] [---?]"
function parseRawText(text: string, title: string): { body: string; source: string; castTime: string } {
  let s = text.trim()
  if (s.toLowerCase().startsWith(title.toLowerCase())) s = s.slice(title.length).trim()
  let castTime = ''
  const castM = s.match(/^(Single Action|Two Actions|Three Actions|Free Action|Reaction)\s+/i)
  if (castM) { castTime = castM[1]; s = s.slice(castM[0].length) }
  let source = ''
  const srcM = s.match(/^Source\s+(.+?pg\.?\s*\d+)\s*/i)
  if (srcM) { source = srcM[1].trim(); s = s.slice(srcM[0].length).trim() }
  s = s.replace(/^---\s*/, '').trim()
  // Then clean up any *embedded* AoN markup that leaked into the body —
  // <title …> wrappers used for variant items, inline "Source X pg. Y"
  // attributions for sub-rules, separator dashes.
  s = cleanDescriptionBody(s)
  return { body: s, source, castTime }
}

// Strip AoN markup artifacts that leak into description bodies — embedded
// `<title …>` wrappers (used for item variants), markdown `## Heading` captions
// (always the spell's own name, sitting just before a recovered table), inline
// "Source X pg. Y" attributions for sub-rules, and separator `---` lines.
function cleanDescriptionBody(s: string): string {
  return s
    .replace(/<title[^>]*>/gi, '\n')
    .replace(/<\/title>/gi, '')
    .replace(/<column[^>]*>/gi, '\n').replace(/<\/column>/gi, '')
    .replace(/<row[^>]*>/gi, '\n').replace(/<\/row>/gi, '')
    // Markdown `## Heading` captions (redundant table titles). Stop at a newline
    // or a table cell `|` so we never eat real prose or the table itself.
    .replace(/[ \t]*#{2,6}[ \t]*[^\n|]*/g, '')
    // Inline "Source <book name> pg. <N>" — the canonical source is shown at
    // the bottom of the popup, so swallow inline duplicates. Stop at sentence
    // boundaries or tag chars so we don't eat the next paragraph.
    .replace(/\s*Source\s+[^.<\n]{1,80}?\s+pg\.?\s*\d+/g, '')
    .replace(/\s+---\s+/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Equipment display ─────────────────────────────────────────────────────────
function EquipmentDisplay({ item }: { item: EquipmentInfo }) {
  // Strip embedded <title> wrappers / inline "Source X pg. Y" duplicates so
  // the body reads cleanly. The canonical source is shown at the bottom.
  const cleaned = cleanDescriptionBody(item.description)
  const lines = cleaned.split('\n').filter(l => l.trim())
  return (
    <div style={{ minWidth: 220 }}>
      {item.traits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {item.traits.map(t => <TraitPill key={t} name={t} />)}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 10, fontSize: 11.5, alignItems: 'center' }}>
        {item.price   && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Price</span> {item.price}</span>}
        {item.damage  && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Damage</span> <span style={{ fontFamily: 'var(--font-mono)' }}>{item.damage}</span></span>}
        {item.hands   && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Hands</span> <span style={{ fontFamily: 'var(--font-mono)' }}>{item.hands}</span></span>}
        {item.acBonus != null && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>AC Bonus</span> <span style={{ fontFamily: 'var(--font-mono)' }}>+{item.acBonus}</span></span>}
        {item.usage   && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Usage</span> {item.usage}</span>}
        {item.bulk    && <span><span style={{ color: 'var(--text)', fontWeight: 600 }}>Bulk</span> <span style={{ fontFamily: 'var(--font-mono)' }}>{item.bulk}</span></span>}
      </div>

      {lines.length > 0 && <div style={{ borderTop: 'var(--app-bw) solid var(--border)', marginBottom: 10 }} />}

      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
        <TableAwareText
          text={cleaned}
          renderText={t => t.split('\n').filter(l => l.trim()).map((line, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0' }}>
              <RichText text={line} rollLabel={item.name} />
            </p>
          ))}
          renderCell={c => <RichText text={c} rollLabel={item.name} />}
        />
      </div>

      <SourceLine source={item.source} />
    </div>
  )
}

// ── Creature reference card — a compact stat summary loaded by name, shown
// when a creature mention in prose is hovered / clicked. Deliberately NOT the
// full <StatBlock> (which imports this file — a circular import — and is too
// heavy for a hover preview). ──────────────────────────────────────────────
const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
function CreatureCard({ name }: { name: string }) {
  const [loaded, setLoaded] = useState<{ c: Creature | null; done: boolean }>({ c: null, done: false })
  useEffect(() => {
    let alive = true
    setLoaded({ c: null, done: false })
    loadCreatureByName(name).then(c => { if (alive) setLoaded({ c, done: true }) })
    return () => { alive = false }
  }, [name])

  if (!loaded.done) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Loading…</p>
  const c = loaded.c
  if (!c) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Creature not found.</p>

  const d = c.defenses
  const sp = c.speed
  const speed = [
    sp.walk && `${sp.walk} ft`, sp.fly && `fly ${sp.fly}`, sp.swim && `swim ${sp.swim}`,
    sp.burrow && `burrow ${sp.burrow}`, sp.climb && `climb ${sp.climb}`,
  ].filter(Boolean).join(', ')
  const labelStyle: React.CSSProperties = { fontWeight: 700, color: 'var(--text)', marginRight: 4 }
  const row = (label: string, val: string | null) => val
    ? <div style={{ fontSize: 12.5, lineHeight: 1.5 }}><span style={labelStyle}>{label}</span><span style={{ color: 'var(--text-muted)' }}>{val}</span></div>
    : null

  return (
    <div style={{ fontSize: 13, color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{c.isHazard ? 'Hazard' : 'Creature'} {c.level}</span>
        {c.traits.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-faded)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{c.traits.join(' · ')}</span>
        )}
      </div>
      {row('Perception', `${fmtMod(c.perception)}${c.senses.length ? ` (${c.senses.join(', ')})` : ''}`)}
      {Object.keys(c.skills).length > 0 && row('Skills', Object.entries(c.skills).map(([k, v]) => `${k} ${fmtMod(v)}`).join(', '))}
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        <span style={labelStyle}>AC</span><span style={{ color: 'var(--text-muted)' }}>{d.ac}</span>
        <span style={{ color: 'var(--text-faded)', margin: '0 6px' }}>·</span>
        <span style={labelStyle}>Fort</span><span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{fmtMod(d.fort)}</span>
        <span style={labelStyle}>Ref</span><span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{fmtMod(d.ref)}</span>
        <span style={labelStyle}>Will</span><span style={{ color: 'var(--text-muted)' }}>{fmtMod(d.will)}</span>
      </div>
      {row('HP', d.hp > 0 ? String(d.hp) : null)}
      {row('Speed', speed || null)}
      {c.attacks.length > 0 && row('Attacks', c.attacks.map(a => `${a.name} ${fmtMod(a.attack)}${a.damage ? ` (${a.damage})` : ''}`).join('; '))}
      <SourceLine source={c.source} />
    </div>
  )
}

// ── Content body — shared between hover preview and click floating window ─────
// NOTE: the reference-id prop is `refId`, NOT `ref`. React 19 (the standalone tracker) lets a
// function component take a plain prop named `ref`, but React 18 (Heroes Heaven, which embeds this)
// reserves `ref`, so passing the string id as `ref=` there throws "function components cannot have
// string refs" and crashes every docked popup. `refId` is a normal prop in both.
function WinContent({ type, refId: ref_, title, castRank }: { type: WinType; refId: string; title: string; castRank?: number }) {
  const { conditions, traits, spells, rituals, actions, actionTraits, skills, equipment, rules } = useGameData()

  // GM-screen tool widgets (timer, notes, dice, reference tables) ride the same
  // pane chrome as reference popups — the body is just routed by the ref's kind.
  if (type === 'widget') return <GmWidgetBody refId={ref_} />

  if (type === 'creature') return <CreatureCard name={ref_} />

  if (type === 'spell') {
    const spell = spells.get(ref_)
    return spell
      ? <SpellTooltip spell={spell} castRank={castRank} />
      : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Spell not found.</p>
  }

  if (type === 'ritual') {
    const ritual = rituals.get(ref_)
    return ritual
      ? <RitualTooltip ritual={ritual} />
      : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Ritual not found.</p>
  }

  if (type === 'equipment') {
    const item = equipment.get(ref_)
    return item
      ? <EquipmentDisplay item={item} />
      : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Item not found.</p>
  }

  if (type === 'glossary') {
    const g = GLOSSARY[ref_]
    return g
      ? <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{g.text}</div>
      : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>No description available.</p>
  }

  let rawText = ''
  if (type === 'condition') rawText = conditions.get(ref_) ?? ''
  if (type === 'trait')     rawText = traits.get(ref_) ?? ''
  if (type === 'action')    rawText = actions.get(ref_) ?? ''
  if (type === 'skill')     rawText = skills.get(ref_) ?? ''
  if (type === 'rule')      rawText = rules.get(ref_)?.text ?? ''

  if (!rawText) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>No description available.</p>

  const { body, source, castTime } = parseRawText(rawText, title)
  const popupTraits = type === 'action' ? actionTraits.get(ref_) : undefined

  return (
    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
      {popupTraits && popupTraits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {popupTraits.map(t => <TraitPill key={t} name={t} />)}
        </div>
      )}
      {castTime && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Cast</span>
          <ActionGlyph act={castTime} />
        </div>
      )}
      <TableAwareText
        text={body}
        renderText={t => t.split('\n').filter(l => l.trim()).map((line, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0' }}>
            <RichText text={line} rollLabel={title} />
          </p>
        ))}
        renderCell={c => <RichText text={c} rollLabel={title} />}
      />
      <SourceLine source={source} />
    </div>
  )
}

// ── Compute the small "Spell 5 / Item 3" level badge ────────────────────────
function useMetaBadge(type: WinType, ref: string, castRank?: number): string | null {
  const { spells, equipment } = useGameData()
  if (type === 'spell') {
    const sp = spells.get(ref) as SpellInfo | undefined
    if (!sp) return null
    const isCantrip = sp.traits.some(t => t.toLowerCase() === 'cantrip')
    const isFocus   = sp.traits.some(t => t.toLowerCase() === 'focus')
    const base = `${isCantrip ? 'Cantrip' : isFocus ? 'Focus' : 'Spell'} ${sp.level}`
    return (castRank != null && castRank > sp.level) ? `${base} (heightened ${castRank})` : base
  }
  if (type === 'equipment') {
    const it = equipment.get(ref) as EquipmentInfo | undefined
    if (!it || it.level === 0) return null
    return `Item ${it.level}`
  }
  return null
}

// ── Reusable header bar (used by both preview tooltip + floating window) ────
function PopupHeader({ title, meta, onClose, onMouseDown, dockHandle, tabStrip }: {
  title: string
  meta: string | null
  onClose?: () => void
  /** Drag the header = the tab/merge behaviour (the tabs button is gone). */
  onMouseDown?: (e: React.MouseEvent) => void
  /** Optional ⠿ drag-to-dock handle (block behavior), before the close button. */
  dockHandle?: React.ReactNode
  /** Chrome-style tab strip rendered IN PLACE of the title (floating windows).
   *  Empty space around the tabs still drags the window via onMouseDown. */
  tabStrip?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(title).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1100) }, () => {})
  }
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        borderBottom: 'var(--app-bw) solid var(--border)',
        cursor: onMouseDown ? 'grab' : 'default',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {tabStrip
        ? <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 3, overflowX: 'auto' }}>{tabStrip}</div>
        : <span
            onClick={copy}
            title="Click to copy · drag to combine as tabs"
            style={{
              flex: 1,
              fontFamily: 'var(--font-display)',
              fontVariationSettings: '"opsz" 72',
              fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
              color: 'var(--text)', cursor: 'pointer',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            {title}
          </span>}

      {copied && (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0,
          padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--font-ui)',
          background: 'var(--accent-soft)', color: 'var(--accent)', border: 'var(--app-bw) solid var(--accent-line)',
        }}>Copied ✓</span>
      )}

      {meta && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5, color: 'var(--accent)',
          background: 'var(--accent-soft)',
          padding: '2px 8px', borderRadius: 3,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {meta}
        </span>
      )}

      {dockHandle}

      {onClose && (
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          className="ico-btn"
          style={{ width: 24, height: 24, fontSize: 14 }}
          title="Close"
        >✕</button>
      )}
    </div>
  )
}

// ── Hover-preview panel (no close button, no drag, no resize) ───────────────
// Renders the same content as the floating window so the hover preview reads
// exactly like the click-open popup, minus the X.
export function PopupPreview({ type, ref_, title, castRank, fill, dockHandle, onHeaderDrag, onClose, hideHeader }: {
  type: WinType; ref_: string; title: string; castRank?: number
  /** Fill the parent (used when docked into a pane) instead of the fixed
   *  420 px hover/window dimensions. */
  fill?: boolean
  /** Optional ⠿ drag handle (docked panes keep one so the popup can be moved
   *  again by the same button). */
  dockHandle?: React.ReactNode
  /** Drag the header to combine this pane as tabs (replaces the tabs button). */
  onHeaderDrag?: (e: React.MouseEvent) => void
  /** Optional close button (docked single-tab popups, where no tab strip × shows). */
  onClose?: () => void
  /** Skip the title/header entirely — used by a multi-tab docked block, where
   *  the tab strip already shows the name (and hosts the drag handles). */
  hideHeader?: boolean
}) {
  const meta = useMetaBadge(type, ref_, castRank)
  // Match the floating-window dimensions exactly so the hover preview reads
  // as the same panel — only the X (and drag/resize affordances) differ.
  return (
    <div data-win-root="" style={{
      background: 'var(--bg-panel)',
      border: fill ? 'none' : 'var(--app-bw) solid var(--border-strong)',
      borderRadius: fill ? 0 : 'var(--radius)',
      boxShadow: fill ? 'none' : 'var(--shadow-lg)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      width: fill ? '100%' : 420,
      height: fill ? '100%' : undefined,
      // When rendered inside a Tooltip, the wrapper may cap our height via
      // the `--tooltip-max-h` CSS variable so we never overlap the trigger
      // text. Falls back to the standalone cap when used as a floating
      // window (where no variable is set).
      maxHeight: fill ? '100%' : 'var(--tooltip-max-h, min(88vh, 680px))',
    }}>
      {!hideHeader && <PopupHeader title={title} meta={meta} dockHandle={dockHandle} onMouseDown={onHeaderDrag} onClose={onClose} />}
      <div style={{
        padding: '14px 18px',
        overflowY: 'auto',
        color: 'var(--text)',
        flex: fill ? 1 : undefined,
        minHeight: fill ? 0 : undefined,
      }}>
        <SelfRefContext.Provider value={{ type, ref: ref_ }}>
          <WinContent type={type} refId={ref_} title={title} castRank={castRank} />
        </SelfRefContext.Provider>
      </div>
    </div>
  )
}

// ── Single draggable/resizable window (click-opened) ────────────────────────
// Holds one or more popup tabs, browser-style: a tab strip appears at 2+ tabs;
// tabs can be dragged out (detach), onto another window (merge), or into a
// layout pane (dock) — all via the mouse-driven dockDragStore.
function WinItem({ win }: { win: FloatingWin }) {
  const { close, closeTab, focusTab, toFront, resize } = useWindowStore()
  const rsz  = useRef<{ mx: number; my: number; ww: number; wh: number } | null>(null)
  const active = win.tabs[win.active] ?? win.tabs[0]
  const meta = useMetaBadge(active.type, active.ref, active.castRank)
  // A creature tab whose ref is a LIVE combatant id hosts the full interactive
  // stat block (HP, conditions, dice) — identical to a docked pane, so tearing a
  // stat-block tab off into a floating window keeps all its combat state. A
  // creature tab whose ref is a bestiary name (from a link) stays a read-only
  // card. Ids are `cmb-N`, names are words, so they never collide.
  const combatants = useCombatStore(s => s.combatants)
  const liveOf = (t: PopupTab) => (t.type === 'creature' ? combatants.find(c => c.id === t.ref) : undefined)
  const activeLive = liveOf(active)
  const labelOf = (t: PopupTab) => liveOf(t)?.name ?? t.title
  const dockable = useSettingsStore(s => s.dockablePopups)
  const showBlockBtn = useSettingsStore(s => s.showBlockDragButton)
  // While this window is being dragged by its ⠿ handle (DOCK mode), it follows
  // the cursor live and must be click-through so the panes beneath it can be
  // hit-tested. Browser-mode (title/tab) drags leave the window solid.
  const beingDocked = useDockDrag(s => s.drag?.winId === win.id)
  // While this window is being dragged in BROWSER mode (tab handle / tab chip),
  // it goes see-through + click-through so the popup it would merge into shows
  // and is hit-tested beneath it.
  const beingBrowserDragged = useDockDrag(s => s.browserWin === win.id)
  // Another popup is being dragged (browser mode) over this window →
  // it would merge in as tab(s).
  const mergeTarget = useDockDrag(s => s.mergeHover?.kind === 'win' && s.mergeHover.id === win.id)

  // ⠿ = BLOCK button: drag the whole window into the tiling layout. Always
  // docks as its own block — NEVER stacks/merges as a tab.
  const dockHandle = dockable && showBlockBtn ? (
    <span
      onMouseDown={e => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        toFront(win.id)
        beginDockDrag({
          popup: { ...active },
          allTabs: win.tabs.map(t => ({ ...t })),
          active: win.active,
          winId: win.id,
          winPos: { x: win.x, y: win.y },
        }, e.clientX, e.clientY)
      }}
      className="ico-btn"
      title="Dock as a block — drag into the layout (never tabs)"
      style={{ width: 24, height: 24, cursor: 'grab', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
    >⠿</span>
  ) : undefined

  // Dragging the HEADER itself is the tab behaviour (the dedicated tabs button
  // is gone): the window follows the cursor and merges into another popup it's
  // dropped on (Chrome-style); dropped over empty space it just stays where
  // released, so a header drag doubles as a plain move. Box docking is still
  // the ⠿ button. A click without movement copies the title (see PopupHeader).
  const onTitleDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    toFront(win.id)
    // 'tabstrip' = only merge when the cursor is over another popup's tab line /
    // header band (or a pane's top header strip); dropping over a body just
    // leaves the window there. Keeps the tab trigger small, not the whole popup.
    beginBrowserDrag(() => ({ winId: win.id, startWX: win.x, startWY: win.y }), e.clientX, e.clientY, 'tabstrip')
  }

  const onResizeDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const winEl = (e.currentTarget as HTMLElement).closest('[data-win-root]') as HTMLElement | null
    const currentH = winEl ? winEl.offsetHeight : (win.sized ? win.h : 360)
    rsz.current = { mx: e.clientX, my: e.clientY, ww: win.w, wh: currentH }
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      if (!rsz.current) return
      resize(win.id,
        Math.max(300, rsz.current.ww + ev.clientX - rsz.current.mx),
        Math.max(200, rsz.current.wh + ev.clientY - rsz.current.my),
      )
    }
    const onUp = () => {
      rsz.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      data-win-root=""
      data-float-win={win.id}
      data-float-merge={win.id}
      onMouseDown={() => toFront(win.id)}
      style={{
        position: 'fixed', left: win.x, top: win.y,
        width: win.w,
        // A live stat block fills its height (h-full), so an auto-height window
        // would collapse it — give it a definite default height until resized.
        ...(win.sized ? { height: win.h } : activeLive ? { height: 'min(82vh, 640px)' } : { maxHeight: 'min(88vh, 680px)' }),
        zIndex: win.z,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-panel)',
        border: `var(--app-bw) solid ${mergeTarget ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius)',
        boxShadow: mergeTarget ? '0 0 0 2px var(--accent), var(--shadow-lg)' : 'var(--shadow-lg)',
        userSelect: 'none',
        overflow: 'hidden',
        // Force pointer events back on — defends against any ancestor with
        // pointer-events:none (e.g. a stale Tooltip wrapper) blocking the X
        // button or drag handle. EXCEPT while this window is itself being
        // dragged (dock OR browser mode), when it must be click-through so the
        // panes / popups beneath it can be hit-tested.
        pointerEvents: beingDocked || beingBrowserDragged ? 'none' : 'auto',
        opacity: beingDocked ? 0.45 : beingBrowserDragged ? 0.55 : 1,
      }}
    >
      {/* Header + tab strip = the Chrome-style merge zone: dragging another
          popup window by its title bar over this area merges it in as tabs. */}
      {/* Chrome-style header: the tabs ARE the title. Always visible (even a
          single tab), so a popup can always be grabbed BY ITS TAB. Empty strip
          space still drags the whole window. */}
      <div data-float-merge={win.id} data-tab-win={win.id} style={{ flexShrink: 0 }}>
      <PopupHeader
        title={labelOf(active)}
        meta={meta}
        onMouseDown={onTitleDown}
        onClose={() => close(win.id)}
        dockHandle={dockHandle}
        tabStrip={win.tabs.map((t, i) => {
          const on = i === win.active
          return (
            <div key={`${t.type}:${t.ref}`}
              onMouseDown={e => {
                if (e.button !== 0) return
                e.preventDefault()   // no native text selection while dragging
                e.stopPropagation()  // don't start the empty-header window move
                toFront(win.id)
                // BROWSER (Chrome-tab) behavior — no boxes. Single-tab window:
                // drag the whole window. Multi-tab: detach this tab into its own
                // window first, then drag that. A plain click still focuses.
                const single = win.tabs.length === 1
                beginBrowserDrag(() => {
                  if (single) return { winId: win.id, startWX: win.x, startWY: win.y }
                  const id = useWindowStore.getState().detachTab(win.id, i, e.clientX - 80, e.clientY - 16)
                  return id ? { winId: id, startWX: e.clientX - 80, startWY: e.clientY - 16 } : null
                }, e.clientX, e.clientY, 'tabstrip')
              }}
              onClick={() => focusTab(win.id, i)}
              title={labelOf(t)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'grab',
                padding: '4px 9px', borderRadius: 5, maxWidth: 170, flexShrink: 0,
                fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: on ? 700 : 500,
                color: on ? 'var(--text)' : 'var(--text-muted)',
                background: on ? 'var(--bg-elevated)' : 'transparent',
                border: `var(--app-bw) solid ${on ? 'var(--border-strong)' : 'transparent'}`,
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(t)}</span>
              {win.tabs.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); closeTab(win.id, i) }}
                  onMouseDown={e => e.stopPropagation()}
                  title="Close tab"
                  style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 14, height: 14, border: 'none', borderRadius: 3, padding: 0, cursor: 'pointer',
                    background: 'transparent', color: 'var(--text-faded)', fontSize: 10,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--danger)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faded)' }}
                >✕</button>
              )}
            </div>
          )
        })}
      />
      </div>

      {/* Scrollable content — a live stat block is full-bleed (it brings its own
          padding/header); reference popups get the usual inset. */}
      <div style={{
        flex: (win.sized || activeLive) ? 1 : undefined,
        overflow: 'auto',
        padding: activeLive ? 0 : '14px 18px',
        color: 'var(--text)',
      }}>
        {activeLive ? (
          <CombatantDetail key={activeLive.id} combatant={activeLive} />
        ) : (
          <SelfRefContext.Provider value={{ type: active.type, ref: active.ref }}>
            <WinContent key={`${active.type}:${active.ref}`} type={active.type} refId={active.ref} title={active.title} castRank={active.castRank} />
          </SelfRefContext.Provider>
        )}
      </div>

      {/* Resize grip */}
      <div
        onMouseDown={onResizeDown}
        style={{
          position: 'absolute', bottom: 2, right: 2,
          width: 14, height: 14, cursor: 'se-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="9" height="9" viewBox="0 0 9 9">
          <path d="M9 3 L3 9 M9 6 L6 9 M9 0 L0 9" stroke="var(--accent-line)" strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  )
}

// ── Layer rendered at app root ────────────────────────────────────────────────
// Chip that follows the cursor during a dock drag so the user sees what
// they're carrying and that the drag is live.
function DockDragGhost() {
  const drag = useDockDrag(s => s.drag)
  const x = useDockDrag(s => s.x)
  const y = useDockDrag(s => s.y)
  if (!drag) return null
  // Dock-dragging a FLOATING window: the window itself follows the cursor, so a
  // chip would be redundant. Only docked blocks (no winId) need the chip.
  if (drag.winId) return null
  const extra = (drag.allTabs?.length ?? 1) > 1 ? ` +${drag.allTabs!.length - 1} more` : ''
  const label = drag.label ?? drag.popup?.title ?? 'Stat block'
  return (
    <div style={{
      position: 'fixed', left: x + 14, top: y + 12, zIndex: 30000,
      pointerEvents: 'none',
      background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--accent-line)',
      borderRadius: 'var(--radius-sm)', padding: '4px 10px',
      fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: 600,
      color: 'var(--text)', boxShadow: 'var(--shadow-md)',
      maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {label}{extra}
    </div>
  )
}

export function FloatingWindowLayer() {
  const wins = useWindowStore(s => s.wins)
  return (
    <>
      {wins.map(w => <WinItem key={w.id} win={w} />)}
      <DockDragGhost />
    </>
  )
}
