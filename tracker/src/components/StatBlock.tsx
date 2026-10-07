import { useMemo, useRef, useState, useLayoutEffect, Fragment } from 'react'
import type { Ability, Attack, Creature, Combatant, SpellSlotEntry } from '../types/pf2e'
import { applyWeakElite, scaleByLevel } from '../utils/weakElite'
import { computeConditionMods, conditionalModsFor, resolveStatMod, resolveAttackMod, type ConditionalModEntry } from '../utils/conditionEffects'
import { fmtSave, traitDisplay, traitBaseName, joinCriticalDegrees } from '../utils/tags'
import { mapPenalty, rollAttack, rollDamageExpr, fmtBonus as fmt } from '../utils/dice'
import { TagRenderer } from './TagRenderer'
import { TableAwareText } from './MarkdownTable'
import { TraitTags } from './TraitTags'
import { PopupPreview } from './FloatingWindow'
import { Tooltip } from './Tooltip'
import { useCombatStore } from '../store/combatStore'
import { useGameData, CreatureLinksCtx } from '../data/gameDataContext'
import { glossaryKey, aliasTerm } from '../data/glossary'
import { GlossaryTerm } from './GlossaryTerm'
import { useWindowStore } from '../store/windowStore'
import { ActionGlyph, cleanInlineMarkup, TextWithGlyphs } from './ActionGlyph'
import { DiceIcon } from './Icons'
import { UsesChip } from './UsesChip'
import { SpellPips } from './SpellPips'
import { useSettingsStore, sbItemIsInline, lineGapPx, spellColMin, SB_ITEM_META, type SbItemId, type SbItem, type SbEditApi } from '../store/settingsStore'
import {
  parseAbilityFrequency, periodLabel,
  abilityKey, spellSlotKey, spellUseKey, focusKey,
} from '../utils/limitedUses'
import { recallKnowledgeFromPage } from '../utils/parseCreature'

// ── Trait color coding (uniform style — accent only for size) ──────────────
// ── Same-line ("merge") layout — items merged onto one row render as spaced
//    blocks (not a text separator). Three styles, chosen in Settings. ──
// The flex container for a row of merged items. The same-line spacing level
// drives the gap (columnGap for spaced, the divider padding, or the boxed gap).
const mergeContainer = (style: string, gap: number): React.CSSProperties => {
  if (style === 'boxed')   return { display: 'flex', flexWrap: 'wrap', columnGap: Math.max(6, Math.round(gap * 0.35)), rowGap: 6, alignItems: 'baseline' }
  if (style === 'divider') return { display: 'flex', flexWrap: 'wrap', rowGap: 4, alignItems: 'baseline' }
  return { display: 'flex', flexWrap: 'wrap', columnGap: gap, rowGap: 4, alignItems: 'baseline' } // spaced
}
const mergeItemStyle = (style: string, i: number, gap: number): React.CSSProperties => {
  if (style === 'boxed') return { background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)', padding: '2px 10px' }
  if (style === 'divider') { const p = Math.max(8, Math.round(gap * 0.45)); return i === 0 ? { paddingRight: p } : { paddingLeft: p, paddingRight: p, borderLeft: 'var(--app-bw) solid var(--border-strong)' } }
  return {} // 'spaced' — the container's columnGap does the spacing
}

// ── Precompiled regexes for itemLookupCandidates (hoisted out of the function
//    so we don't allocate a fresh RegExp on every render of every item row). ──
const ITEM_PAREN_TAIL_RE = /\s*\([^)]*\)\s*$/
const ITEM_QTY_PREFIX_RE = /^\d+\s+/
const ITEM_PLUS_N_RE     = /^\+\d+\s+/
const ITEM_QUALITIES_RE  = /^(major|greater|lesser|superior|minor|moderate|true)\s+/i
const ITEM_RUNES_RE      = /^(striking|resilient|fortified|reinforcing|grievous|anarchic|axiomatic|holy|unholy|corrosive|flaming|frost|shock|thundering|dancing|defending|disrupting|keen|merciful|returning|vorpal|wounding)\s+/i
const ITEM_MATERIALS_RE  = /^(cold iron|silver|adamantine|mithral|orichalcum|warpglass|sovereign steel|noqual|abysium|inubrix|peachwood|darkwood|sterling|dragonhide)\s+/i

// ── Build candidate lookup keys for an item name ───────────────────────────
// Tries multiple normalizations to match against the AoN equipment index.
// Strips, in order: trailing parens, leading quantity, leading +N rune,
// then iteratively peels off quality grades (minor/lesser/greater/major),
// rune adjectives (striking/resilient/...), and material adjectives
// (cold iron/silver/adamantine/...).  Also tries singular and plural forms
// at each step (AoN stores some items as plural — e.g. "arrows", "bolts").
function itemLookupCandidates(raw: string): string[] {
  const out: string[] = []
  const pushVariants = (s: string) => {
    const t = s.trim()
    if (!t) return
    if (!out.includes(t)) out.push(t)
    // Singular forms
    if (t.endsWith('es') && t.length > 4) {
      const v = t.slice(0, -2); if (!out.includes(v)) out.push(v)
    }
    if (t.endsWith('s') && t.length > 3) {
      const v = t.slice(0, -1); if (!out.includes(v)) out.push(v)
    }
    // Plural form (AoN stores ammo etc. as plural)
    if (!t.endsWith('s')) {
      const v = t + 's'; if (!out.includes(v)) out.push(v)
    }
  }

  let s = raw.toLowerCase().trim()
  pushVariants(s)

  // Strip trailing parenthetical (quantity, material descriptor, etc.)
  let next = s.replace(ITEM_PAREN_TAIL_RE, '').trim()
  if (next !== s) { s = next; pushVariants(s) }

  // Strip leading numeric quantity ("5 javelins")
  next = s.replace(ITEM_QTY_PREFIX_RE, '')
  if (next !== s) { s = next; pushVariants(s) }

  // Strip leading +N potency rune ("+1 ...")
  next = s.replace(ITEM_PLUS_N_RE, '')
  if (next !== s) { s = next; pushVariants(s) }

  // Iteratively strip qualities, runes, and materials in any order
  // (e.g. "+1 lesser cold iron longsword" → "cold iron longsword" → "longsword")
  let prev = ''
  while (s !== prev) {
    prev = s
    next = s.replace(ITEM_QUALITIES_RE, '')
    if (next !== s) { s = next; pushVariants(s) }
    next = s.replace(ITEM_RUNES_RE, '')
    if (next !== s) { s = next; pushVariants(s) }
    next = s.replace(ITEM_MATERIALS_RE, '')
    if (next !== s) { s = next; pushVariants(s) }
  }

  // Last-resort fallback: drop leading words one at a time until only the
  // base item word remains (handles "crossbow bolts" → "bolts").
  // Added LAST so more-specific matches earlier in the list always win.
  const words = s.split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    pushVariants(words.slice(i).join(' '))
  }

  return out
}

// ── Clickable item list for equipment in stat blocks ───────────────────────
function ItemList({ items }: { items: string[] }) {
  const { equipment, spells } = useGameData()
  const openWin = useWindowStore(s => s.open)
  const linkStyle: React.CSSProperties = { color: 'var(--linked)', cursor: 'pointer', fontWeight: 500, borderBottom: '1px dotted var(--linked)' }

  return (
    <>
      {items.map((item, i) => {
        // Display text with AoN inline markup resolved (e.g. a trailing
        // `((Hardness 10, HP 80, BT 40))` note → plain parentheses).
        const label = cleanInlineMarkup(item)

        // Scroll / wand / staff / oil "of <spell>" → link the spell itself, so
        // hovering shows the spell (the item isn't a distinct equipment entry).
        const sm = label.match(/^(.*\b(?:scrolls?|wands?|staff|staves|oils?) of )(.+?)(\s*\(\d+\))?$/i)
        if (sm) {
          const phrase = sm[2].trim()
          const cands = [phrase.toLowerCase(), phrase.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()]
          let key: string | null = null
          let sp: ReturnType<typeof spells.get>
          for (const c of cands) { const s = spells.get(c); if (s) { key = c; sp = s; break } }
          if (key && sp) {
            const spellKey = key
            const spellName = sp.name
            return (
              <span key={i}>
                {i > 0 && ', '}{sm[1]}
                <Tooltip
                  content={<PopupPreview type="spell" ref_={spellKey} title={spellName} />}
                  onActivate={pos => openWin('spell', spellKey, spellName, pos.x, pos.y, { noCascade: true })}
                >
                  <span style={linkStyle}>{phrase}</span>
                </Tooltip>
                {sm[3] ?? ''}
              </span>
            )
          }
        }

        // Try multiple normalizations of the item name
        const candidates = itemLookupCandidates(item)
        let lookupKey: string | null = null
        let info = undefined
        for (const k of candidates) {
          const e = equipment.get(k)
          if (e) { lookupKey = k; info = e; break }
        }

        if (info && lookupKey) {
          const matchKey = lookupKey
          return (
            <span key={i}>
              {i > 0 && ', '}
              <Tooltip
                content={<PopupPreview type="equipment" ref_={matchKey} title={info.name} />}
                onActivate={pos => openWin('equipment', matchKey, item, pos.x, pos.y, { noCascade: true })}
              >
                <span style={{ color: 'var(--linked)', cursor: 'pointer', fontWeight: 500, borderBottom: '1px dotted var(--linked)' }}>
                  {label}
                </span>
              </Tooltip>
            </span>
          )
        }
        return <span key={i}>{i > 0 && ', '}{label}</span>
      })}
    </>
  )
}

// ── Inline trait tag (for attacks / abilities) ─────────────────────────────
// Hover shows the same `PopupPreview` panel that clicking would pin — so the
// two views never disagree on shape/content. If `traitKey` is omitted the tag
// is rendered as static (no hover, no click).
function TraitTag({ name, traitKey }: { name: string; traitKey?: string }) {
  const openWin = useWindowStore(s => s.open)
  const display = traitDisplay(name)
  const span = (
    <span style={{ color: 'var(--text-muted)', cursor: traitKey ? 'pointer' : 'default' }}>
      {display}
    </span>
  )
  if (!traitKey) return span
  return (
    <Tooltip
      content={<PopupPreview type="trait" ref_={traitKey} title={display} />}
      onActivate={pos => openWin('trait', traitKey, display, pos.x, pos.y, { noCascade: true })}
    >{span}</Tooltip>
  )
}

// ── Defense term (immunity / resistance / weakness) ─────────────────────────
// Resolves each term to a reference so it gets a hover popup:
//   1. trait     — energy types (fire/cold/acid/…), death, disease, fear, mental
//   2. condition — paralyzed, unconscious, controlled, …
//   3. glossary  — physical / precision / bleed / critical hits / …
// Anything unresolved renders as plain text.
function DefTerm({ term }: { term: string }) {
  const { traits, conditions } = useGameData()
  const openWin = useWindowStore(s => s.open)
  const display = traitDisplay(term).replace(/_/g, ' ')
  // Strip a trailing parenthetical (e.g. golem "magic (see below)") before
  // resolving, but keep it in the displayed text.
  const norm = aliasTerm(traitBaseName(term).replace(/\s*\([^)]*\)\s*$/, ''))

  // 1. Glossary first (materials, physical types, all/area …) so e.g.
  //    "cold iron" isn't mis-resolved to the "cold" damage trait.
  const gk = glossaryKey(norm)
  if (gk) return <GlossaryTerm gkey={gk} label={display} linkStyle={{ color: 'var(--text-muted)', cursor: 'pointer' }} />

  // 2. Trait reference (energy types, death, disease, fear, mental, magical …)
  const tr = resolveAttackTrait(norm, traits)
  if (tr.tip) return <TraitTag name={display} traitKey={tr.base} />

  // 3. Condition reference (paralyzed, unconscious, confused …)
  const condKey = resolveInMap(norm, conditions)
  if (condKey) {
    return (
      <Tooltip
        content={<PopupPreview type="condition" ref_={condKey} title={display} />}
        onActivate={pos => openWin('condition', condKey, display, pos.x, pos.y, { noCascade: true })}
      ><span style={{ color: 'var(--text-muted)', cursor: 'pointer' }}>{display}</span></Tooltip>
    )
  }

  // 4. Plain text — descriptive / creature-specific terms with no reference.
  return <span style={{ color: 'var(--text-muted)' }}>{display}</span>
}

function Mod({ base, mod, signed = true }: { base: number; mod: number; signed?: boolean }) {
  const total = base + mod
  /* AC is a DC, not a modifier. The rulebooks and AoN both print "AC 27"; this rendered "+27"
   * because AC shared the save renderer, which signs everything. `plain` was not an option — it
   * shows the BASE and would drop any condition adjustment, so a +2 status bonus to AC would go
   * unshown. Hence a sign switch rather than a second code path: the number still moves with
   * conditions and still colours up/down, it just loses the leading plus. */
  const display = signed ? fmt(total) : String(total)
  if (mod < 0) return <span className="stat-down">{display}</span>
  if (mod > 0) return <span className="stat-up">{display}</span>
  return <span>{display}</span>
}

// ── Situational-modifier marker ────────────────────────────────────────────
// Renders a "*" next to a check when an applied condition grants a conditional
// bonus/penalty to it. Hovering shows the situationally-adjusted total +
// breakdown; clicking (when onRoll is given) rolls the check with the
// situational modifiers applied.
function CondStar({ entries, rollTotal, onRoll }: {
  entries: ConditionalModEntry[]
  rollTotal: number
  onRoll?: () => void
}) {
  if (!entries.length) return null
  const tip = (
    <div style={{
      background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
      borderRadius: 'var(--radius)', padding: '8px 10px', maxWidth: 280,
      boxShadow: 'var(--shadow-md)', fontFamily: 'var(--font-ui)',
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 5, fontWeight: 600 }}>
        Situational: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{fmt(rollTotal)}</span>
        {onRoll && <span style={{ color: 'var(--text-faded)', fontWeight: 400, fontSize: 11 }}> · click to roll</span>}
      </div>
      {entries.map((e, i) => (
        <div key={i} style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: i ? 3 : 0, lineHeight: 1.5 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: e.value < 0 ? 'var(--danger)' : 'var(--hp-full)' }}>
            {e.value < 0 ? '' : '+'}{e.value}
          </span>{' '}
          {e.when || 'situational'}
          <span style={{ color: 'var(--text-faded)', fontStyle: 'italic' }}> — {e.source} ({e.type})</span>
        </div>
      ))}
    </div>
  )
  return (
    <Tooltip content={tip}>
      <span
        onClick={onRoll}
        className={onRoll ? 'roll-check' : undefined}
        style={{ color: 'var(--accent)', fontWeight: 700, marginLeft: 1, fontSize: '0.95em', cursor: onRoll ? 'pointer' : 'help' }}
      >*</span>
    </Tooltip>
  )
}

// ── Defense stat box ───────────────────────────────────────────────────────
// One boxed value in the single-line Defense strip (AC / Hardness / saves).
// Big mono value over a small label so each stat is easy to spot at a glance.
// When `onRoll` is given the whole box is clickable (rolls the save); the
// situational "*" sits inline with the value and rolls its own total.
function DefBox({ label, base, mod, onRoll, title, star, plain, unit, signed = true }: {
  label: string
  base: number
  mod: number
  onRoll?: () => void
  title?: string
  star?: React.ReactNode
  plain?: boolean
  unit?: string
  /** false for AC, which the rulebooks print unsigned ("AC 27", never "+27"). */
  signed?: boolean
}) {
  return (
    <div
      className={`def-box${onRoll ? ' clickable' : ''}`}
      onClick={onRoll}
      title={title}
    >
      <div className="def-box-label">{label}</div>
      <div className="def-box-val">
        {plain ? base : <Mod base={base} mod={mod} signed={signed} />}
        {unit && <span className="def-box-unit">{unit}</span>}
        {star && <span onClick={e => e.stopPropagation()}>{star}</span>}
      </div>
    </div>
  )
}

// Scales its text down (never up past `max`) until it fits its box on ONE line,
// so a multi-speed value stays inside the fixed-size cube instead of widening
// or wrapping it. Re-fits when the box resizes.
function AutoFitText({ text, max = 22, min = 8 }: { text: string; max?: number; min?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let s = max
      el.style.fontSize = `${s}px`
      while (s > min && el.scrollWidth > el.clientWidth + 0.5) {
        s -= 0.5
        el.style.fontSize = `${s}px`
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [text, max, min])
  return <span ref={ref} style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden' }}>{text}</span>
}

type SpeedSet = { walk?: number; fly?: number; swim?: number; burrow?: number; climb?: number }
// Every movement type packed into one " · "-joined string (shared by the Speed
// cube and the inline-defense line so the two never drift).
function speedText(speed: SpeedSet): string {
  const parts: string[] = []
  if (speed.walk)   parts.push(`${speed.walk} ft`)
  if (speed.fly)    parts.push(`fly ${speed.fly}`)
  if (speed.swim)   parts.push(`swim ${speed.swim}`)
  if (speed.burrow) parts.push(`burrow ${speed.burrow}`)
  if (speed.climb)  parts.push(`climb ${speed.climb}`)
  return parts.join(' · ') || '—'
}

// The Speed cube — shows EVERY movement type (land + fly/swim/burrow/climb) in
// one fixed-size box, shrinking the text to fit rather than resizing the box.
function SpeedBox({ speed }: { speed: SpeedSet }) {
  return (
    <div className="def-box">
      <div className="def-box-label">Speed</div>
      <div className="def-box-val"><AutoFitText text={speedText(speed)} /></div>
    </div>
  )
}

// Extract sense lookup key
function senseKey(s: string): string {
  return s.replace(/\s*(\([^)]*\)\s*)?\d+\s+\w+\s*$/, '').trim().toLowerCase()
}

/** Strip leftover markdown link fragments like "[Stance](/Traits.aspx?ID=152" → "Stance" */
function stripTraitLink(raw: string): string {
  // Leftover AoN markup tokens (<%TRAITS%163%%>, <%END>, dangling <%WORD…).
  raw = raw.replace(/<%[^>]*>/g, '').replace(/<%[A-Z][^\s>]*\s?/g, '')
  // Full link: [text](url)
  raw = raw.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // Partial link (url was cut): [text](url...without closing paren
  raw = raw.replace(/\[([^\]]+)\]\([^)]*$/g, '$1')
  // Bare bracket remnants
  raw = raw.replace(/^\[|\]$/g, '')
  return raw.trim()
}

// ── Recall Knowledge DC ───────────────────────────────────────────────────────
const RK_DC_BY_LEVEL: Record<number, number> = {
  [-1]: 13, [0]: 14, [1]: 15, [2]: 16, [3]: 18, [4]: 19, [5]: 20,
  [6]: 22, [7]: 23, [8]: 24, [9]: 26, [10]: 27, [11]: 28,
  [12]: 30, [13]: 31, [14]: 32, [15]: 34, [16]: 35, [17]: 36,
  [18]: 38, [19]: 39, [20]: 40, [21]: 42, [22]: 44, [23]: 46, [24]: 48,
  [25]: 50, [26]: 52, [27]: 54, [28]: 56, [29]: 58, [30]: 60,
}

const RK_TYPE_SKILLS: Record<string, string[]> = {
  aberration: ['Occultism'], animal: ['Nature'], astral: ['Occultism'],
  beast: ['Arcana', 'Nature'], celestial: ['Religion'],
  construct: ['Arcana', 'Crafting'], dragon: ['Arcana'], dream: ['Occultism'],
  elemental: ['Arcana', 'Nature'], ethereal: ['Occultism'], fey: ['Nature'],
  fiend: ['Religion'], fungus: ['Nature'], giant: ['Arcana', 'Nature'],
  humanoid: ['Society'], monitor: ['Religion'], ooze: ['Occultism'],
  plant: ['Nature'], spirit: ['Occultism'], undead: ['Religion'],
}

interface RkInfo {
  dc: number
  skills: string[]
  type?: string
  /* AoN lists EACH creature type with its OWN skill — "Animal (Nature), Humanoid (Society)" — and
   * the Hellknight cavalry brigade is both. Collapsing them into one type plus a union of skills
   * printed "Animal (Nature or Society)", which says a Society check identifies it as an Animal.
   * Wrong, and it changes what a GM rolls. Kept as pairs so the render can stay faithful. */
  byType?: Array<{ type: string; skills: string[] }>
  unspecific?: number
  specific?: number
}

// Pull the precise Recall Knowledge block out of the AoN flavor blurb, e.g.
//   "Recall Knowledge - Fiend\n(Religion): DC 23\n
//    Unspecific Lore: DC 21\nSpecific Lore: DC 18"
// This carries the creature TYPE and the Unspecific/Specific Lore DCs that the
// level-based fallback can't know. (\bSpecific avoids matching "Unspecific".)
function parseFlavorRK(flavor?: string): RkInfo | null {
  if (!flavor) return null
  const m = flavor.match(/Recall Knowledge\s*(?:[-•]\s*([^\n(]*?))?\s*\(\s*([^)]*?)\s*\)\s*:\s*DC\s*(\d+)/i)
  if (!m) return null
  const skills = m[2].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
  if (!skills.length) return null
  const u = flavor.match(/Unspecific Lore:\s*DC\s*(\d+)/i)
  const s = flavor.match(/\bSpecific Lore:\s*DC\s*(\d+)/i)
  return {
    dc: parseInt(m[3], 10),
    type: m[1]?.trim() || undefined,
    skills,
    unspecific: u ? parseInt(u[1], 10) : undefined,
    specific: s ? parseInt(s[1], 10) : undefined,
  }
}

/** The DC-by-level table, continued past its ends at its own end slopes: one DC per level below
 *  −1 (Weak on a level −1 creature reads −2, which the table does not print; the old
 *  "14 + max(0, level)" gave DC 14 there, ABOVE level −1's 13, so weakening a creature made it
 *  harder to identify), two per level above 30 (the old rule gave level 31 DC 45, under level 30's 60). */
const rkDcAt = (level: number): number =>
  RK_DC_BY_LEVEL[level] ?? (level < -1 ? RK_DC_BY_LEVEL[-1] + (level + 1) : RK_DC_BY_LEVEL[30] + 2 * (level - 30))

function getRecallKnowledge(level: number, traits: string[]): RkInfo {
  const lowerTraits = traits.map(t => t.toLowerCase())
  let baseDC = rkDcAt(level)
  if (lowerTraits.includes('unique')) baseDC += 10
  else if (lowerTraits.includes('rare')) baseDC += 5
  else if (lowerTraits.includes('uncommon')) baseDC += 2
  const skills = new Set<string>()
  let type: string | undefined
  const byType: Array<{ type: string; skills: string[] }> = []
  for (const t of traits) {
    const s = RK_TYPE_SKILLS[t.toLowerCase()]
    if (s) {
      s.forEach(sk => skills.add(sk))
      if (!type) type = t   // keep the creature type (e.g. "Fiend")
      byType.push({ type: t, skills: s })
    }
  }
  // No creature type identified — fall back to a generic skill set so we still
  // render a usable Recall Knowledge row at the top of the stat block.
  if (!skills.size) return { dc: baseDC, skills: ['Lore'], type }
  return { dc: baseDC, skills: [...skills], type, byType }
}

/** A page's Recall Knowledge line moved to an adjusted level (elite, weak, scaled): every DC it
 *  prints shifts by the level-DC table's difference, as the computed row always did (an elite
 *  level-1 humanoid's DC 15 reads 16, a weak one 14). The lore DCs hang off the same DC. */
export function shiftRecallKnowledge(line: string, baseLevel: number, level: number): string {
  const delta = rkDcAt(level) - rkDcAt(baseLevel)
  if (!delta) return line
  return line.replace(/\bDC\s*(\d+)/g, (_m, n: string) => `DC ${parseInt(n, 10) + delta}`)
}

// ── HP pools ──────────────────────────────────────────────────────────────────
/** One HP pool as printed: its number, its own label ("Joint", "head, head regrowth") and its own
 *  Broken Threshold when the page gives one ("Joint (BT 32)" → label "Joint", bt 32). */
interface HpPoolView { hp: number; label?: string; bt?: number }

/** defenses.hpPools read defensively (a homebrew JSON can hold anything: a string, nulls), each
 *  pool's "(BT n)" pulled out of its name and a corpus name's own outer brackets dropped. */
export function hpPoolViews(pools: unknown): HpPoolView[] {
  if (!Array.isArray(pools)) return []
  const out: HpPoolView[] = []
  for (const p of pools) {
    if (!p || typeof p !== 'object' || typeof (p as { hp?: unknown }).hp !== 'number') continue
    const rawName = (p as { name?: unknown }).name
    let label = typeof rawName === 'string' ? rawName.trim() : ''
    let bt: number | undefined
    const btM = label.match(/\(\s*BT\s*(\d+)\s*\)|^BT\s*(\d+)$/)
    if (btM) {
      bt = parseInt(btM[1] ?? btM[2], 10)
      label = label.replace(btM[0], ' ')
    }
    label = label.replace(/\s{2,}/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/\s+,/g, ',')
    label = label.replace(/^\(([^()]*)\)$/, '$1').trim()
    out.push({ hp: (p as { hp: number }).hp, ...(label ? { label } : {}), ...(bt !== undefined ? { bt } : {}) })
  }
  return out
}

/** A pool label in ONE pair of brackets: "body, hydra regeneration" → "(body, hydra
 *  regeneration)". A label that already carries brackets wraps only its bare parts, so
 *  "tentacle, (tentacle regrowth)" prints as the page does, "(tentacle), (tentacle regrowth)". */
export function hpPoolLabelText(label: string): string {
  if (!/[()]/.test(label)) return `(${label})`
  return label.split(/,\s*(?![^()]*\))/).map(part => /[()]/.test(part) ? part : `(${part})`).join(', ')
}

// ── Hazard Routine ────────────────────────────────────────────────────────────
const COST_TOKEN_GLYPH: Record<string, string> = {
  'one-action': ' ◆', 'two-actions': ' ◆◆', 'three-actions': ' ◆◆◆', 'reaction': ' ↺', 'free-action': ' ◇',
}
/** "\nLightning Arc\n[one-action]\n(electricity) …" / "\n2: Nozzle Spray [one-action] …": an entry
 *  the page prints in bold, with its own cost, inside a Routine (Rune Sentries, Covetous Corridor).
 *  The name is a whole line; a strike line ("Melee [one-action]") is not an entry. */
const ROUTINE_ENTRY_RE = /(^|\n)[ \t]*([A-Z0-9][^\n[\]]{0,60}?)[ \t]*\n?[ \t]*\[(one-action|two-actions|three-actions|reaction|free-action)\][ \t]*/g

/** A Routine's text split into its opening prose and the entries printed inside it. A cost token
 *  left in the prose (a strike line's "[one-action]") becomes its glyph, never the raw token. */
export function splitRoutine(text: string): { intro: string; entries: Ability[] } {
  const heads: Array<{ at: number; end: number; name: string; cost: string }> = []
  ROUTINE_ENTRY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ROUTINE_ENTRY_RE.exec(text)) !== null) {
    const name = m[2].trim()
    if (/^(?:Melee|Ranged)$/.test(name)) continue
    heads.push({ at: m.index + m[1].length, end: ROUTINE_ENTRY_RE.lastIndex, name, cost: m[3] })
  }
  const glyphTokens = (s: string) =>
    s.replace(/\[(one-action|two-actions|three-actions|reaction|free-action)\]/g, (_x, k: string) => COST_TOKEN_GLYPH[k].trim())
  if (!heads.length) return { intro: glyphTokens(text), entries: [] }
  const entries: Ability[] = heads.map((h, i) => {
    let body = text.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : text.length).trim()
    let traits: string[] = []
    const tr = body.match(/^\(([^()]*)\)\s*/)
    if (tr) { traits = tr[1].split(/\s*,\s*/).filter(Boolean); body = body.slice(tr[0].length) }
    return { name: h.name, activity: COST_TOKEN_GLYPH[h.cost], traits, entries: glyphTokens(body.trim()) }
  })
  return { intro: glyphTokens(text.slice(0, heads[0].at).trim()), entries }
}

// Resolve attack trait with progressive key stripping
function resolveAttackTrait(raw: string, traitsMap: Map<string, string>): { base: string; tip?: string } {
  let key = traitBaseName(raw).toLowerCase()
  while (key) {
    const tip = traitsMap.get(key)
    if (tip) return { base: key, tip }
    const sp = key.lastIndexOf(' ')
    if (sp < 0) break
    key = key.slice(0, sp)
  }
  return { base: traitBaseName(raw).toLowerCase() }
}

// Resolve a term to a key present in a data map (conditions, …), peeling
// trailing words so "death effects" → "death", "paralyzed 1" → "paralyzed".
function resolveInMap(raw: string, map: Map<string, string>): string | undefined {
  let key = traitBaseName(raw).toLowerCase()
  while (key) {
    if (map.has(key)) return key
    const sp = key.lastIndexOf(' ')
    if (sp < 0) break
    key = key.slice(0, sp)
  }
  return undefined
}

// ── Section header ─────────────────────────────────────────────────────────
function SectionHdr({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  if (right) {
    return (
      <div className="stat-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{children}</span>
        {right}
      </div>
    )
  }
  return (
    <div className="stat-bar">{children}</div>
  )
}

// ── Stat row wrapper ───────────────────────────────────────────────────────
function StatRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="stat-line" style={style}>{children}</div>
}

// ── Inline damage roller — used for dice expressions inside ability text ───
// Cooldown variant: tinted sage and labeled differently, but interaction is
// the same. The roll handler applies a condition named after the ability.
function InlineDiceRoll({ formula, onRoll, isCooldown }: {
  formula: string
  onRoll: () => void
  isCooldown?: boolean
}) {
  const tint = isCooldown ? 'var(--linked)' : 'var(--accent)'
  // Cooldown dice use the theme's --linked (sage on Tavern, violet on
  // Arcane, copper on Verdant, etc.) so the green-tinted style stays
  // distinct from the gold accent across every palette.
  const tintLine = isCooldown ? 'color-mix(in srgb, var(--linked) 45%, transparent)' : 'var(--accent-line)'
  const tintSoft = isCooldown ? 'color-mix(in srgb, var(--linked) 16%, transparent)' : 'var(--accent-soft)'
  return (
    <span
      onClick={e => { e.stopPropagation(); onRoll() }}
      title={isCooldown ? `Click to roll ${formula} — will apply a cooldown condition for the rolled number of rounds` : `Click to roll ${formula}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '0 6px', margin: '0 2px',
        borderRadius: 3,
        background: 'var(--bg-elevated)',
        border: 'var(--app-bw) solid var(--border)',
        color: tint,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.92em', fontWeight: 500,
        cursor: 'pointer',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
        transition: 'all 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = tintLine; e.currentTarget.style.background = tintSoft }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
    >
      <DiceIcon size={11} style={{ flexShrink: 0 }} />
      <span>{formula}</span>
    </span>
  )
}

// Match standalone dice expressions: optional count + dN + optional +/- modifier.
// Hoisted to module level so we don't compile a fresh RegExp on every render.
const DICE_RE = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/g

// ── Long-form prose block (used by hazard sections + ability bodies) ──────
// Splits text into visual paragraphs so a wall of AoN prose reads cleanly:
//   • Real newlines     → real paragraph breaks
//   • "Success ..."     → green inline label + body
//   • "Failure ..."     → red inline label + body
//   • Critical Success/Failure → same, but bolder
//   • Numbered list items ("1. foo", "2. bar") → indented bullets
//
// Each paragraph is rendered via TagRenderer so inline tags and dice still
// behave like links / rollers.
// Inject line breaks before AoN sub-section markers so a single inline AoN
// paragraph unfolds into a properly structured block. Matches markers that
// follow a sentence end (`.` or `;`) and are the start of a labeled
// sub-section like Success / Critical Success / Failure / Critical Failure /
// Effect / Trigger / Requirements / Frequency / Routine / Reset / Special.
const PROSE_LINE_MARKERS = /(?<=[.;]\s)(?=(?:Critical Success|Critical Failure|Success|Failure|Effect|Trigger|Requirements?|Frequency|Routine|Reset|Special)\b)/g

function ProseBlock({ text, dense = false, onRoll, onCooldownRoll, onCheck, rollLabel }: {
  text: string
  dense?: boolean
  /** When provided, dice expressions in the prose become clickable rollers. */
  onRoll?: (formula: string, sourceLabel: string) => void
  onCooldownRoll?: (formula: string, abilityName: string, abilityText: string) => void
  onCheck?: (label: string, bonus: number) => void
  /** Label used when rolling a dice expression from this block. */
  rollLabel?: string
}) {
  if (!text) return null

  // Use the inline-run helper for body text when a roll callback is wired up
  // so any dice expressions (e.g. routine "Damage 1d10+11 ...") become
  // clickable rollers. Falls back to plain TagRenderer otherwise.
  const renderBody = (txt: string) => onRoll
    ? renderInlineRun(txt, rollLabel ?? '', text, onRoll, onCooldownRoll, onCheck)
    : <TagRenderer text={txt} />

  // Render one table-free run of prose: rejoin "Critical\nSuccess"-style split
  // degree labels, inject synthetic newlines before known sub-section markers,
  // then segment on real line breaks so AoN's wall-of-text reads as discrete
  // labelled paragraphs.
  const renderProse = (blockText: string) => {
    const withBreaks = joinCriticalDegrees(blockText).replace(PROSE_LINE_MARKERS, '\n')
    const lines: string[] = []
    for (const rawLine of withBreaks.split(/\n+/)) {
      const line = rawLine.trim()
      if (line) lines.push(line)
    }
    return lines.map((line, i) => {
      // Success / Failure sub-headers — colour-coded inline so the
      // success-degree structure becomes obvious in a glance.
      const sdM = line.match(/^(Critical Success|Critical Failure|Success|Failure|Effect|Trigger|Requirements?|Frequency)[:\s]+(.+)/)
      if (sdM) {
        const [, label, rest] = sdM
        const color = label.includes('Success') ? 'var(--hp-full)'
                    : label.includes('Failure') ? 'var(--danger)'
                    : 'var(--accent)'
        return (
          <div key={i} style={{ marginTop: i === 0 ? 0 : (dense ? 4 : 7) }}>
            <span style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 700, fontSize: 11,
              color, letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}>{label}</span>{' '}
            <span style={{ color: 'var(--text)' }}>
              {renderBody(rest)}
            </span>
          </div>
        )
      }
      // Numbered list item — indented bullet
      const numM = line.match(/^(\d+)\.\s+(.+)/)
      if (numM) {
        return (
          <div key={i} style={{ marginTop: i === 0 ? 0 : (dense ? 3 : 5), paddingLeft: 16, textIndent: -14 }}>
            <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600, marginRight: 6 }}>{numM[1]}.</span>
            {renderBody(numM[2])}
          </div>
        )
      }
      return (
        <div key={i} style={{ marginTop: i === 0 ? 0 : (dense ? 5 : 8) }}>
          {renderBody(line)}
        </div>
      )
    })
  }

  return (
    <div style={{ lineHeight: dense ? 1.55 : 1.65, fontSize: 13 }}>
      <TableAwareText text={text} renderText={renderProse} renderCell={renderBody} />
    </div>
  )
}
// A dice expression is treated as an *ability cooldown* if the text after it
// (within a short window) starts with "round" — this matches phrases like
// "can't use again for 1d4 rounds" / "in 1d6 rounds". Damage dice followed by
// other words (e.g. "1d6 fire damage") aren't flagged.
const COOLDOWN_AFTER_RE = /^\s*rounds?\b/i

// Markers that should start a new visual line inside an ability body when
// found mid-sentence (AoN's prose runs them all together without breaks).
const ABILITY_LINE_MARKERS = /(?<=\.\s|\;\s|^)(?=(?:Critical Success|Critical Failure|Success|Failure|Effect|Trigger|Requirements?|Frequency|Routine|Reset)\b)/g

// "counteract check +44" / "counteract +44" → clickable d20 check roller.
const COUNTERACT_RE = /counteract\s+(?:check\s+)?([+-]\d+)/gi

// Render a non-dice text segment, turning "counteract check +N" into a clickable
// d20 roll; everything else goes through TagRenderer (tags / auto-links).
function renderProseSeg(text: string, keyBase: string, label: string,
  onCheck?: (label: string, bonus: number) => void): React.ReactNode {
  if (!onCheck) return <TagRenderer text={text} />
  COUNTERACT_RE.lastIndex = 0
  if (!COUNTERACT_RE.test(text)) return <TagRenderer text={text} />
  COUNTERACT_RE.lastIndex = 0
  const out: React.ReactNode[] = []
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = COUNTERACT_RE.exec(text)) !== null) {
    if (m.index > last) out.push(<TagRenderer key={`${keyBase}-${i++}`} text={text.slice(last, m.index)} />)
    const mod = parseInt(m[1], 10)
    out.push(
      <span key={`${keyBase}-c${i++}`} className="roll-check"
        title={`Roll counteract check ${m[1]}`}
        onClick={() => onCheck(`${label} counteract`, mod)}
      >{m[0]}</span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<TagRenderer key={`${keyBase}-${i++}`} text={text.slice(last)} />)
  return <>{out}</>
}

/** Render a single inline run — dice expressions become rollers, the rest
 *  goes through TagRenderer for tag/auto-link parsing. */
function renderInlineRun(text: string, label: string, fullText: string,
  onRoll: (formula: string, sourceLabel: string) => void,
  onCooldownRoll?: (formula: string, abilityName: string, abilityText: string) => void,
  onCheck?: (label: string, bonus: number) => void,
): React.ReactNode {
  DICE_RE.lastIndex = 0
  const parts: Array<{ text: string; isDice: boolean; isCooldown?: boolean }> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = DICE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), isDice: false })
    const after = text.slice(m.index + m[1].length, m.index + m[1].length + 20)
    const isCooldown = !!onCooldownRoll && COOLDOWN_AFTER_RE.test(after)
    parts.push({ text: m[1].replace(/\s+/g, ''), isDice: true, isCooldown })
    last = m.index + m[1].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), isDice: false })

  return (
    <>
      {parts.map((p, i) =>
        p.isDice
          ? <InlineDiceRoll key={i} formula={p.text} isCooldown={p.isCooldown}
              onRoll={() => p.isCooldown && onCooldownRoll
                ? onCooldownRoll(p.text, label, fullText)
                : onRoll(p.text, label)
              } />
          : <span key={i}>{renderProseSeg(p.text, String(i), label, onCheck)}</span>
      )}
    </>
  )
}

// Renders ability/feature body text. Splits on Success/Failure/Effect/Trigger
// markers AND real newlines so each section becomes its own paragraph, then
// scans each line for dice expressions and converts them to clickable rollers.
function AbilityText({ text, label, onRoll, onCooldownRoll, onCheck }: {
  text: string
  label: string
  onRoll: (formula: string, sourceLabel: string) => void
  onCooldownRoll?: (formula: string, abilityName: string, abilityText: string) => void
  onCheck?: (label: string, bonus: number) => void
}) {
  if (!text) return null

  // Render one table-free run of ability prose. Any markdown tables recovered
  // from AoN lore/aside blocks are split out first by TableAwareText and drawn
  // as real <table>s — otherwise they'd print as raw "| … |" pipes.
  const renderProse = (blockText: string) => {
    // 1. Rejoin split "Critical\nSuccess" labels, then inject paragraph breaks
    //    before known sub-section markers so AoN's inline prose unfolds into a
    //    readable, scanable list.
    const withBreaks = joinCriticalDegrees(blockText).replace(ABILITY_LINE_MARKERS, '\n')
    // 2. Combine on real newlines (after the synthetic ones we just added).
    const rawLines = withBreaks.split(/\n+/).map(l => l.trim()).filter(Boolean)
    return rawLines.map((line, i) => {
      // Pull a leading sub-section label out if present so we can colour it.
      const sdM = line.match(/^(Critical Success|Critical Failure|Success|Failure|Effect|Trigger|Requirements?|Frequency)[:\s]+(.+)/)
      if (sdM) {
        const [, lbl, rest] = sdM
        const color = lbl.includes('Success') ? 'var(--hp-full)'
                    : lbl.includes('Failure') ? 'var(--danger)'
                    : 'var(--accent)'
        return (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 4 }}>
            <span style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 700, fontSize: 10.5,
              color, letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}>{lbl}</span>{' '}
            <span style={{ color: 'var(--text)' }}>
              {renderInlineRun(rest, label, text, onRoll, onCooldownRoll, onCheck)}
            </span>
          </div>
        )
      }
      // Numbered effect list — indented bullet
      const numM = line.match(/^(\d+)\.\s+(.+)/)
      if (numM) {
        return (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 3, paddingLeft: 16, textIndent: -14 }}>
            <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600, marginRight: 6 }}>{numM[1]}.</span>
            {renderInlineRun(numM[2], label, text, onRoll, onCooldownRoll, onCheck)}
          </div>
        )
      }
      return (
        <div key={i} style={{ marginTop: i === 0 ? 0 : 5 }}>
          {renderInlineRun(line, label, text, onRoll, onCooldownRoll, onCheck)}
        </div>
      )
    })
  }

  return (
    <div className="text-xs" style={{ lineHeight: 1.6 }}>
      <TableAwareText
        text={text}
        renderText={renderProse}
        renderCell={c => renderInlineRun(c, label, text, onRoll, onCooldownRoll, onCheck)}
      />
    </div>
  )
}

interface Props {
  combatant: Combatant
  /** Hide the HP line in the stat block — used in the detail panel where the
      HP bar already shows it, so HP isn't displayed twice. */
  hideHP?: boolean
  /** Hide the trait-tag row — used in the detail panel where the tags are
      shown in the HP/action bar instead. */
  hideTraits?: boolean
  /** When set, turns the stat block into the Settings editor: each body item
      becomes click-to-select + drag-to-reorder (rolls/popups are suppressed). */
  edit?: SbEditApi
}

export function StatBlock({ combatant, hideHP, hideTraits, edit }: Props) {
  const { addDiceResult, addCondition, setResourceUse, resetResources } = useCombatStore()
  const { traits, spells, rituals, actions, creatureLinks } = useGameData()
  const openWin = useWindowStore(s => s.open)
  const spellIndicator = useSettingsStore(s => s.spellIndicator)
  const spellLayout = useSettingsStore(s => s.spellLayout)
  // User-chosen stat-block layout (defense cubes vs one line, ability style, …). Hoisted ABOVE the
  // `if (!creature) return` further down so a name-only combatant (no creature) renders the SAME
  // number of hooks as a creature — otherwise switching a pane tab between the two, or follow-the-turn
  // reassigning a pane, throws "rendered fewer hooks than expected" and blanks the whole workspace.
  const sb = useSettingsStore(s => s.statBlock)
  // Transient drag state for the Settings editor (no effect when edit is unset).
  // dragId = the item being dragged; overZone = the drop zone under the cursor
  // ("line:<id>" to join that row, or "strip:<n>" for an own-line slot).
  const [dragId, setDragId] = useState<SbItemId | null>(null)
  const [overZone, setOverZone] = useState<string | null>(null)
  const ord = (n: number) => n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
  // Consumed-use lookup for this combatant's limited resources.
  const uses = combatant.resourceUses ?? {}
  const usedOf = (key: string) => uses[key] ?? 0
  // Situational modifiers from applied conditions, by stat key(s).
  const condFor = (keys: string[]) => conditionalModsFor(combatant.conditions, keys)
  const anyUsesSpent = Object.values(uses).some(v => v > 0)
  // Reset-all control shown on the first tracked section when something's spent.
  const resetAllBtn = (
    <button
      onClick={() => resetResources(combatant.id)}
      title="Refill every limited-use ability, spell slot, and focus point (long rest)"
      style={{
        background: 'transparent', border: 'var(--app-bw) solid var(--border-strong)',
        color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.04em', padding: '2px 8px', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >↺ Reset uses</button>
  )
  // Reserve the reset button's footprint even when nothing's spent, so the
  // header (and everything below it) doesn't jump down the moment it appears.
  const resetSlot = (active: boolean) => (
    <span style={{ visibility: active ? 'visible' : 'hidden' }} aria-hidden={active ? undefined : true}>
      {resetAllBtn}
    </span>
  )

  const creature: Creature = useMemo(() => {
    if (!combatant.creature) return null as unknown as Creature
    if (combatant.scaledToLevel !== undefined)
      return scaleByLevel(combatant.creature, combatant.scaledToLevel)
    return applyWeakElite(
      combatant.creature,
      combatant.isElite ? 'elite' : combatant.isWeak ? 'weak' : 'normal'
    )
  }, [combatant.creature, combatant.isElite, combatant.isWeak, combatant.scaledToLevel])

  const mods = useMemo(() => computeConditionMods(combatant.conditions), [combatant.conditions])

  if (!creature) return (
    <div style={{ color: 'var(--text-faded)', fontStyle: 'italic', textAlign: 'center', padding: 20, fontSize: 13 }}>
      No stat block — PC or custom combatant
    </div>
  )

  const handleAttack = (attackIdx: number, attackNumber: 1|2|3) => {
    const atk = creature.attacks[attackIdx]
    if (!atk) return
    const map = mapPenalty(attackNumber, atk.isAgile)
    const totalBonus = atk.attack + resolveAttackMod(combatant.conditions, atk.range==='Melee' ? 'melee' : 'ranged')
    const label = `${combatant.name} — ${atk.name} (${attackNumber}${attackNumber===1?'st':attackNumber===2?'nd':'rd'} attack${map?`, MAP ${map}`:''}) — ${atk.range}`
    addDiceResult(rollAttack(label, totalBonus, map))
  }

  const handleCheck = (label: string, bonus: number) => {
    addDiceResult(rollAttack(`${combatant.name} — ${label}`, bonus, 0))
  }

  const handleDamage = (attackIdx: number) => {
    const atk = creature.attacks[attackIdx]
    if (!atk || !atk.damage) return
    addDiceResult(rollDamageExpr(atk.damage, `${combatant.name} — ${atk.name} damage`))
  }

  // Generic damage roller for dice expressions embedded in ability text
  const rollAbilityDamage = (formula: string, sourceLabel: string) => {
    addDiceResult(rollDamageExpr(formula, `${combatant.name} — ${sourceLabel}`))
  }

  // Cooldown roller — roll the dice, apply a same-named condition for the
  // rolled number of rounds, and carry the ability's body text so hovering
  // the condition shows what's on cooldown.
  const rollAbilityCooldown = (formula: string, abilityName: string, abilityText: string) => {
    const result = rollDamageExpr(formula, `${combatant.name} — ${abilityName} cooldown`)
    addDiceResult(result)
    const rounds = Math.max(1, result.total)
    addCondition(combatant.id, {
      name: `${abilityName} (Cooldown)`,
      duration: rounds,
      isPermanent: false,
      description: abilityText,
    })
  }

  const isHazard = creature.isHazard
  const hd = creature.hazardData

  // Gold link style (for perception, saves, etc.)
  const goldLink: React.CSSProperties = { color: 'var(--linked)', cursor: 'pointer', fontWeight: 500, borderBottom: '1px dotted var(--linked)' }
  // Muted secondary text
  const muted: React.CSSProperties = { color: 'var(--text-muted)' }
  // Spell link
  const spellLink: React.CSSProperties = { color: 'var(--linked)', fontWeight: 500, cursor: 'pointer', borderBottom: '1px dotted var(--linked)' }

  // The HP value as the page prints it. One pool: "90 <note>" as always. Several pools (a hydra's
  // body and head, a hazard's components): every pool in page order, "90 (body, hydra
  // regeneration); 15 (head, head regrowth)". The first number is defenses.hp — the combat pool,
  // weak/elite adjusted — so combat and the first printed number never disagree.
  // (APP-DEFECTS: HP pools — the second pool was dropped.)
  // A hazard prints every pool it has, ONE pool included, each with its own label and its own BT
  // right after it: "88 (Hammer) BT 44; 64 (Joint) BT 32", "12 (Trapdoor) BT 6" — the page's
  // "Hammer HP 88 (BT 44); Joint HP 64 (BT 32)". A pool's BT comes from its name ("(BT 32)") or,
  // for the first pool, defenses.bt; the separate BT after the line is then not printed again.
  // Pools are read defensively (hpPoolViews): a homebrew JSON's string or null pools are skipped.
  const hpViews = hpPoolViews(creature.defenses.hpPools)
  const extraHpPools = hpViews.length > 1 ? hpViews.slice(1) : []
  const btInPoolLine = isHazard && hpViews.length > 0
  const hpPoolNode = (hp: number, v: HpPoolView, bt: number | undefined) => (
    <>
      {hp}
      {v.label && <>{' '}<span style={muted}>{hpPoolLabelText(v.label)}</span></>}
      {isHazard && bt !== undefined && <span style={{ marginLeft: 6 }}><span className="stat-label">BT</span> {bt}</span>}
    </>
  )
  const hpValueNodes: React.ReactNode = (btInPoolLine || extraHpPools.length > 0) ? (
    <>
      {hpViews.map((v, pi) => (
        <Fragment key={pi}>
          {pi > 0 && '; '}
          {hpPoolNode(pi === 0 ? creature.defenses.hp : v.hp, v, v.bt ?? (pi === 0 ? creature.defenses.bt : undefined))}
        </Fragment>
      ))}
    </>
  ) : (
    <>{creature.defenses.hp}{creature.defenses.hpNote && <span style={{ ...muted, marginLeft: 4 }}>{creature.defenses.hpNote}</span>}</>
  )

  // Senses rendered once here so they can sit inline after Perception, OR on
  // their own "Senses" row when Perception is pulled into a defense cube.
  // The scraped data often crams several senses (with ranges and stray text)
  // into one string, so split on commas first; each real sense then resolves to
  // its glossary/trait popup.
  const senseParts: string[] = !isHazard
    ? creature.senses.flatMap(s => s.split(',').map(x => x.trim())).filter(Boolean)
    : []

  // The PERCEPTION QUALIFIER AoN prints between the modifier and the senses —
  // "+27 to detect lies" (Kolyarut), "expert" (Valerie), "26 when rolling
  // initiative" (Wight Commander). The builder used to leave it glued to the
  // front of the senses string on 105 creatures, so this component clawed the
  // "when rolling initiative" flavour back out of senseParts and the other 103
  // rendered as pseudo-senses. Creature.perceptionNote now carries it and
  // senses[] is senses only; the initiative ones stay rollable (the same two
  // creatures as before, Wight Commander and the Palace Guard) and the rest
  // render as plain parenthesised text in that same slot.
  const percNote = isHazard ? undefined : creature.perceptionNote
  const initM = percNote?.match(/^\+?(\d+)\s+when rolling initiative$/i)
  const initiativeBonus: number | null = initM ? parseInt(initM[1]) : null

  const perceptionNoteNode: React.ReactNode = initiativeBonus != null ? (
    <span style={muted}> (
      <span className="roll-check" title="Roll initiative"
        onClick={() => handleCheck('Initiative', initiativeBonus as number)}>+{initiativeBonus}</span>
      {' when rolling initiative)'}
    </span>
  ) : percNote ? <span style={muted}> ({percNote})</span> : null

  const senseNodes: React.ReactNode = senseParts.length ? senseParts.map((s, si) => {
    const key = senseKey(s)
    const gk = glossaryKey(s)
    const traitTip = traits.get(key)
    return (
      <span key={si}>
        {si > 0 && ', '}
        {gk
          ? <GlossaryTerm gkey={gk} label={s} linkStyle={goldLink} />
          : traitTip
            ? <Tooltip
                content={<PopupPreview type="trait" ref_={key} title={s} />}
                onActivate={pos => openWin('trait', key, s, pos.x, pos.y, { noCascade: true })}
              >
                <span style={goldLink}>{s}</span>
              </Tooltip>
            : s
        }
      </span>
    )
  }) : null

  // ── Reorderable body (Perception … Abilities & Actions) ──────────────────
  // Order / style / visibility / same-line grouping all come from Settings →
  // Stat Blocks; rendered read-only here. `renderInline` returns the BARE
  // content of a joinable text row (so several can share one line); everything
  // else is a self-contained block via `renderBlock`.

  // Section divider — suppressed when the user turns headers off, but a header's
  // right-slot content (the "Reset uses" button) is preserved either way.
  const Hdr = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) =>
    sb.showSectionHeaders
      ? <SectionHdr right={right}>{children}</SectionHdr>
      : (right ? <div className="stat-line" style={{ textAlign: 'right' }}>{right}</div> : null)

  // ── One ability row ──────────────────────────────────────────────────────
  // Used in all three places an ability can print (top, mid, bottom), so the cooldown chip,
  // inline rolls, traits and tooltips behave the same wherever the page put the ability.
  // `i` is the ability's index in creature.abilities (stable key); `style` is the
  // 'specials' item's style ('compact' hides trigger and body).
  const renderAbility = (ab: Ability, i: number, style?: string): React.ReactNode => {
    // Some scraped ability names carry the action-cost markup inline
    // (e.g. "Earth Block <actions string=\"Reaction\" />"). Strip it from
    // the displayed name and turn it into the proper ◆/↺ glyph instead
    // of leaking the literal tag into the stat block.
    const costInName = ab.name.match(/<actions\b[^>]*\bstring\s*=\s*"([^"]*)"[^>]*>/i)
    const cleanName = ab.name.replace(/<actions\b[^>]*>/gi, '').replace(/\s+/g, ' ').trim()
    const displayActivity = ab.activity || (costInName ? costInName[1] : '')
    const ruleKey = cleanName.toLowerCase()
    const ruleTip = actions.get(ruleKey)
    const limit = parseAbilityFrequency(`${cleanName} ${ab.entries} ${ab.trigger ?? ''}`)
    const abKey = abilityKey(cleanName)
    // The page prints Frequency and Requirements BEFORE the Trigger ("Frequency once per day;
    // Trigger An allied creature …; Effect …", Valkyrie's Recall the Fallen); the record keeps
    // them as the opening lines of entries. With a trigger, those lines draw above it.
    let leadClauses = ''
    let bodyText = ab.entries ?? ''
    if (ab.trigger) {
      const lines = bodyText.split('\n')
      let k = 0
      while (k < lines.length - 1 && /^\s*(?:Frequency|Requirements?)\b/.test(lines[k])) k++
      if (k > 0) { leadClauses = lines.slice(0, k).join('\n'); bodyText = lines.slice(k).join('\n') }
    }
    return (
      <StatRow key={i}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          {ruleTip
            ? <Tooltip
                content={<PopupPreview type="action" ref_={ruleKey} title={cleanName} />}
                onActivate={pos => openWin('action', ruleKey, cleanName, pos.x, pos.y, { noCascade: true })}
              >
                <span style={goldLink}>{cleanName}</span>
              </Tooltip>
            : <span style={{ fontWeight: 600, color: 'var(--text)' }}>{cleanName}</span>
          }
          {displayActivity && <ActionGlyph act={displayActivity} />}
          {limit && (
            <span style={{ marginLeft: 2 }}>
              <UsesChip
                used={usedOf(abKey)}
                max={limit.max}
                onChange={v => setResourceUse(combatant.id, abKey, v)}
                hint={`${limit.max}${periodLabel(limit.period)}`}
              />
            </span>
          )}
          {ab.traits.length > 0 && (
            <span style={{ fontSize: 12, ...muted }}>(
              {ab.traits.map((t, ti) => {
                const stripped = stripTraitLink(t)
                const base = traitBaseName(stripped).toLowerCase()
                const tip = traits.get(base)
                return (
                  <span key={t}>
                    {ti > 0 && ', '}
                    <TraitTag name={stripped} traitKey={tip ? base : undefined} />
                  </span>
                )
              })}
            )</span>
          )}
        </div>
        {style !== 'compact' && leadClauses && (
          <AbilityText text={leadClauses} label={ab.name} onRoll={rollAbilityDamage} onCooldownRoll={rollAbilityCooldown} onCheck={handleCheck} />
        )}
        {style !== 'compact' && ab.trigger && (
          <div style={{ fontSize: 12, ...muted, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Trigger</span> {ab.trigger}
          </div>
        )}
        {style !== 'compact' && (
          <AbilityText text={bodyText} label={ab.name} onRoll={rollAbilityDamage} onCooldownRoll={rollAbilityCooldown} onCheck={handleCheck} />
        )}
      </StatRow>
    )
  }

  // ── Ability placement by page section ─────────────────────────────────────
  // AoN prints a creature's abilities in three places: after Items (auras, wards — 'top'),
  // after the HP / IWR line (reactions such as Attack of Opportunity — 'mid'), and after the
  // strikes and spells ('bot'). Every one of them used to print at the bottom
  // (APP-DEFECTS: ability placement). creature.abilities stays ONE flat array in page order;
  // only this renderer splits it. Slot-less abilities (hand-built, pasted, hazard) stay at the
  // bottom where they always were.
  const indexedAbilities = creature.abilities.map((ab, i) => ({ ab, i }))
  const topAbilities = indexedAbilities.filter(x => x.ab.slot === 'top')
  const midAbilities = indexedAbilities.filter(x => x.ab.slot === 'mid')
  const botAbilities = indexedAbilities.filter(x => x.ab.slot !== 'top' && x.ab.slot !== 'mid')
  const specialsItem = sb.items.find(it => it.id === 'specials')
  // Where the top / mid groups go in the user's (reorderable) body: top right after the Items
  // row; mid right after the last of the Defense strip, HP and IWR rows. Anchors are positions in
  // sb.items, so a hidden anchor row still holds its place. Sorted, top before mid on a tie.
  const slotPlan = (): Array<{ key: 'top' | 'mid'; anchor: number; list: typeof indexedAbilities }> => {
    const pos = (id: SbItemId) => sb.items.findIndex(it => it.id === id)
    const midIds: SbItemId[] = ['defense', 'hp', 'immunities', 'resistances', 'weaknesses']
    const plan: Array<{ key: 'top' | 'mid'; anchor: number; list: typeof indexedAbilities }> = []
    if (topAbilities.length) plan.push({ key: 'top', anchor: pos('items'), list: topAbilities })
    if (midAbilities.length) plan.push({ key: 'mid', anchor: Math.max(...midIds.map(pos)), list: midAbilities })
    return plan.sort((a, b) => a.anchor - b.anchor)
  }
  const renderSlotAbilities = (list: typeof indexedAbilities): React.ReactNode =>
    list.map(({ ab, i }) => renderAbility(ab, i, specialsItem?.style))

  const renderInline = (id: SbItemId): React.ReactNode => {
    switch (id) {
      case 'recall': {
        if (isHazard) return null
        // Prefer a verbatim pasted/imported RK line — for Archives records the adapter fills it from
        // the page's own Recall Knowledge sidebar. A record WITH a page (rawMarkdown) whose page
        // prints no Recall Knowledge shows none: a DC computed from level and traits was printed as
        // if the page said it (APP-DEFECTS: recall knowledge). The flavor block and the computed DC
        // stay for records with no page — hand-built, pasted, homebrew.
        // "A page record" is keyed on rawMarkdown OR fromArchivesPage: the persist slimming strips
        // rawMarkdown from saved encounters and the reloaded board, fromArchivesPage survives it.
        const fromPage = Boolean(creature.rawMarkdown || creature.fromArchivesPage)
        // A record that carries its page but no recallKnowledge (homebrew saved from a bestiary
        // combatant before the adapter filled the field: the builder kept rawMarkdown) reads the
        // sidebar off the page it carries, so its row does not vanish.
        const pageLine = creature.recallKnowledge
          || (creature.rawMarkdown ? recallKnowledgeFromPage(creature.rawMarkdown) : undefined)
        if (pageLine) {
          // A page line follows an elite / weak / level-scaled combatant the way the computed row
          // always did: every DC moves by the level-DC table's difference. A pasted line is verbatim.
          const baseLevel = combatant.creature?.level ?? creature.level
          const line = fromPage && baseLevel !== creature.level
            ? shiftRecallKnowledge(pageLine, baseLevel, creature.level)
            : pageLine
          return <><span className="stat-label">Recall Knowledge</span> <span style={{ color: 'var(--text-muted)' }}>{line}</span></>
        }
        if (fromPage) return null
        const rk = parseFlavorRK(creature.flavor) ?? getRecallKnowledge(creature.level, creature.traits)
        const lore = [
          rk.unspecific != null ? `Unspecific Lore DC ${rk.unspecific}` : null,
          rk.specific != null ? `Specific Lore DC ${rk.specific}` : null,
        ].filter(Boolean).join(' • ')
        return (
          <>
            <span className="stat-label">Recall Knowledge</span>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              DC {rk.dc} {rk.byType && rk.byType.length > 1
                ? `• ${rk.byType.map(b => `${b.type} (${b.skills.join(' or ')})`).join(', ')}`
                : `${rk.type ? `• ${rk.type} ` : ''}(${rk.skills.join(' or ')})`}
            </span>
            {lore && <span style={{ color: 'var(--text-faded)', fontSize: 11, marginLeft: 8 }}>{lore}</span>}
          </>
        )
      }
      case 'perception':
        if (isHazard) return null
        return (
          <>
            <span className="roll-check"
              onClick={() => handleCheck('Perception', creature.perception + mods.perception)}
              title="Roll Perception"
            >
              <span className="stat-label">Perception</span>{' '}
              <Mod base={creature.perception} mod={mods.perception} />
            </span>
            <CondStar entries={condFor(['perception', 'allChecks'])}
              rollTotal={creature.perception + resolveStatMod(combatant.conditions, 'perception', true)}
              onRoll={() => handleCheck('Perception (situational)', creature.perception + resolveStatMod(combatant.conditions, 'perception', true))} />
            {perceptionNoteNode}
            {senseNodes && <span style={muted}> ({senseNodes})</span>}
          </>
        )
      case 'languages': {
        // AoN prints language abilities (telepathy 100 feet, truespeech) after a ';' on the
        // Languages line; a creature with abilities but no languages prints just the abilities.
        // Read defensively: the homebrew JSON guard does not vet this field, and a string here
        // ("telepathy 100 feet") must not crash the stat block — it prints as the one ability.
        const langRaw: unknown = creature.languageAbilities
        const langAbilities = (Array.isArray(langRaw) ? langRaw : [langRaw])
          .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        if (isHazard || (creature.languages.length === 0 && langAbilities.length === 0)) return null
        const langText = [creature.languages.join(', '), langAbilities.join(', ')].filter(Boolean).join('; ')
        return <><span className="stat-label">Languages</span> {langText}</>
      }
      case 'skills': {
        if (isHazard || Object.keys(creature.skills).length === 0) return null
        return (
          <>
            <span className="stat-label">Skills</span>{' '}
            {Object.entries(creature.skills).map(([k, v], i) => {
              // The penalty SHOWN on the skill. `mods` is keyed by the 16 enumerated skills, so a
              // Lore fell through to 0 there — a Fascinated creature's "Hell Lore" displayed and
              // rolled clean while the player sheet showed −2. resolveStatMod answers for any skill
              // name and returns the identical number for the 16.
              const sk = k.toLowerCase()
              const flat = resolveStatMod(combatant.conditions, sk as keyof typeof mods, false)
              const total = v + flat
              return (
              <span key={k}>{i > 0 && ', '}
                <span className="roll-check"
                  onClick={() => handleCheck(k.charAt(0).toUpperCase() + k.slice(1), total)}
                  title={`Roll ${k}`}
                ><span className="capitalize">{k}</span>{' '}
                  {flat < 0 ? <span className="stat-down">{fmt(total)}</span>
                   : flat > 0 ? <span className="stat-up">{fmt(total)}</span>
                   : fmt(total)}</span>
                <CondStar entries={condFor([sk, 'allChecks'])}
                  rollTotal={v + resolveStatMod(combatant.conditions, sk as keyof typeof mods, true)}
                  onRoll={() => handleCheck(`${k.charAt(0).toUpperCase() + k.slice(1)} (situational)`, v + resolveStatMod(combatant.conditions, sk as keyof typeof mods, true))} />
              </span>
            )})}
          </>
        )
      }
      case 'abilities': {
        if (isHazard) return null
        const ABILS = ['str','dex','con','int','wis','cha'] as const
        const labels: Record<string, string> = { str:'Strength',dex:'Dexterity',con:'Constitution',int:'Intelligence',wis:'Wisdom',cha:'Charisma' }
        return (
          <>
            {ABILS.map(ab => (
              <span key={ab} style={{ marginRight: 12 }}>
                <span className="roll-check" style={{ fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', fontSize: 12 }}
                  onClick={() => handleCheck(labels[ab], creature[ab])}
                  title={`Roll ${labels[ab]}`}
                >{ab} {fmt(creature[ab])}</span>
                <CondStar entries={condFor(['allChecks'])}
                  rollTotal={creature[ab] + resolveStatMod(combatant.conditions, 'allChecks', true)}
                  onRoll={() => handleCheck(`${labels[ab]} (situational)`, creature[ab] + resolveStatMod(combatant.conditions, 'allChecks', true))} />
              </span>
            ))}
          </>
        )
      }
      case 'items':
        if (isHazard || creature.items.length === 0) return null
        return <><span className="stat-label">Items</span> <ItemList items={creature.items} /></>
      case 'hp': {
        if (hideHP || (isHazard && creature.defenses.hp <= 0)) return null
        const bt = creature.defenses.bt
        return (
          <>
            <span className="stat-label">HP</span> {hpValueNodes}
            {bt !== undefined && !btInPoolLine && <span style={{ marginLeft: 10 }}><span className="stat-label">BT</span> {bt}</span>}
          </>
        )
      }
      case 'immunities':
        if (creature.defenses.immunities.length === 0) return null
        return <><span className="stat-label">Immunities</span> {creature.defenses.immunities.map((im, i) => <span key={i}>{i > 0 ? ', ' : ''}<DefTerm term={im} /></span>)}</>
      case 'resistances':
        if (creature.defenses.resistances.length === 0) return null
        return <><span className="stat-label">Resistances</span> {creature.defenses.resistances.map((r, i) => <span key={i}>{i > 0 ? ', ' : ''}<DefTerm term={r.name} /> {r.amount}{r.note ? ` (${r.note})` : ''}</span>)}</>
      case 'weaknesses':
        if (creature.defenses.weaknesses.length === 0) return null
        return <><span className="stat-label">Weaknesses</span> {creature.defenses.weaknesses.map((w, i) => <span key={i}>{i > 0 ? ', ' : ''}<DefTerm term={w.name} /> {w.amount}{w.note ? ` (${w.note})` : ''}</span>)}</>
      default:
        return null
    }
  }

  // Cube rows (defense / abilities / perception / hp boxes) can take a fixed
  // width per item (Settings → Stat Blocks → "Cube box width"). Returns the
  // className + CSS-var style for a .def-strip; no width set → flex-fill default.
  const cubeProps = (id: SbItemId, base: string): { className: string; style?: React.CSSProperties } => {
    const w = sb.items.find(i => i.id === id)?.cubeWidth
    if (typeof w !== 'number') return { className: base }
    return { className: `${base} fixed-cubes`, style: { ['--cube-width']: `${w}px` } as React.CSSProperties }
  }

  // `tail`: a hazard's abilities and strikes are drawn by the hazard tail (renderHazardTail: after
  // the defenses, strikes at their page place among the abilities, before the Routine), never in
  // the reorderable body. `only` limits the rows (indices into creature.attacks / .abilities);
  // `header: false` drops the section header of a group that continues the one above it.
  const renderBlock = (id: SbItemId, style?: string, tail?: { only?: number[]; header?: boolean }): React.ReactNode => {
    switch (id) {
      case 'perception': { // cube form (text form is inline)
        if (isHazard) return null
        return (
          <Fragment>
            <div {...cubeProps('perception', 'stat-line def-strip def-strip-solo')}>
              <div className="def-box clickable" title="Roll Perception"
                onClick={() => handleCheck('Perception', creature.perception + mods.perception)}>
                <div className="def-box-label">Perception</div>
                <div className="def-box-val"><Mod base={creature.perception} mod={mods.perception} /></div>
              </div>
            </div>
            {perceptionNoteNode && <div className="stat-line" style={{ fontSize: 12 }}>{perceptionNoteNode}</div>}
            {senseNodes && <StatRow><span className="stat-label">Senses</span> <span style={muted}>{senseNodes}</span></StatRow>}
          </Fragment>
        )
      }
      case 'abilities': { // cubes form (row form is inline)
        if (isHazard) return null
        const ABILS = ['str','dex','con','int','wis','cha'] as const
        const labels: Record<string, string> = { str:'Strength',dex:'Dexterity',con:'Constitution',int:'Intelligence',wis:'Wisdom',cha:'Charisma' }
        return (
          <div {...cubeProps('abilities', 'stat-line def-strip')}>
            {ABILS.map(ab => (
              <div key={ab} className="def-box clickable"
                onClick={() => handleCheck(labels[ab], creature[ab])}
                title={`Roll ${labels[ab]}`}>
                <div className="def-box-label">{ab}</div>
                <div className="def-box-val">{fmt(creature[ab])}</div>
              </div>
            ))}
          </div>
        )
      }
      case 'defense': {
        const d = creature.defenses
        const cnd = combatant.conditions
        const hasHardness = d.hardness !== undefined
        // Which save boxes to draw. A creature: all three. A hazard: only the saves its page prints
        // (savesPrinted, filled by the adapter — a hazard printing only "Fort +10" drew "Ref +0" and
        // "Will +0" beside it, APP-DEFECTS: hazard saves). A hazard with no savesPrinted at all
        // (hand-built, pasted, an older snapshot) keeps the old rule: all three when any is set.
        // savesPrinted is read defensively (a homebrew JSON may hold a number or a string there):
        // anything but a list counts as absent and takes the old rule.
        const printed: unknown = d.savesPrinted
        const saveKeys: Array<'fort' | 'ref' | 'will'> = !isHazard
          ? ['fort', 'ref', 'will']
          : Array.isArray(printed)
            ? (['fort', 'ref', 'will'] as const).filter(k => printed.includes(k))
            : (d.fort || d.ref || d.will) ? ['fort', 'ref', 'will'] : []
        const hasSaves    = saveKeys.length > 0
        // A hazard's AC prints only when its page prints one: defenses.acPrinted, set by the adapter
        // from the UNADJUSTED record (elite / weak / level scaling move a hazard's 0 to 2 or 11,
        // which is no printed AC). Every writer sets the flag now (the adapter, the paste parser,
        // the builder); a hazard WITHOUT it was made before the change and draws no AC box, as
        // every hazard did then — the old builder and paste parser both started ac at 10, so an
        // "ac > 0" fallback grew an "AC 10" the GM never typed on nearly every stored homebrew
        // hazard. The builder starts acSet from this same rule (acPrinted === true), so an
        // untouched save never moves the box. Read defensively: anything but true is no AC box.
        const acPrinted: unknown = combatant.creature?.defenses?.acPrinted ?? d.acPrinted
        const showAc      = !isHazard || acPrinted === true
        const showSection = !isHazard || (showAc || hasHardness || hasSaves || d.hp > 0 || d.resistances.length > 0 || d.weaknesses.length > 0 || d.immunities.length > 0)
        if (!showSection) return null
        type DefEntry =
          | { kind: 'val'; key: string; label: string; base: number; mod: number; plain?: boolean; signed?: boolean; title?: string; onRoll?: () => void; star?: React.ReactNode }
          | { kind: 'speed'; key: string; sp: SpeedSet }
        const entries: DefEntry[] = []
        if (showAc) {
          entries.push({ kind: 'val', key: 'ac', label: 'AC', base: d.ac, mod: mods.ac, signed: false,
            star: <CondStar entries={condFor(['ac'])} rollTotal={d.ac + resolveStatMod(cnd, 'ac', true)} /> })
        }
        if (hasHardness) {
          entries.push({ kind: 'val', key: 'hard', label: 'Hardness', base: d.hardness!, mod: 0, plain: true })
        }
        const saveEntry: Record<'fort' | 'ref' | 'will', DefEntry> = {
          fort: { kind: 'val', key: 'fort', label: 'Fort', base: d.fort, mod: mods.fort, title: 'Roll Fortitude',
            onRoll: () => handleCheck('Fortitude', d.fort + mods.fort),
            star: <CondStar entries={condFor(['fort', 'allChecks'])} rollTotal={d.fort + resolveStatMod(cnd, 'fort', true)}
              onRoll={() => handleCheck('Fortitude (situational)', d.fort + resolveStatMod(cnd, 'fort', true))} /> },
          ref: { kind: 'val', key: 'ref', label: 'Ref', base: d.ref, mod: mods.ref, title: 'Roll Reflex',
            onRoll: () => handleCheck('Reflex', d.ref + mods.ref),
            star: <CondStar entries={condFor(['ref', 'allChecks'])} rollTotal={d.ref + resolveStatMod(cnd, 'ref', true)}
              onRoll={() => handleCheck('Reflex (situational)', d.ref + resolveStatMod(cnd, 'ref', true))} /> },
          will: { kind: 'val', key: 'will', label: 'Will', base: d.will, mod: mods.will, title: 'Roll Will',
            onRoll: () => handleCheck('Will', d.will + mods.will),
            star: <CondStar entries={condFor(['will', 'allChecks'])} rollTotal={d.will + resolveStatMod(cnd, 'will', true)}
              onRoll={() => handleCheck('Will (situational)', d.will + resolveStatMod(cnd, 'will', true))} /> },
        }
        for (const k of saveKeys) entries.push(saveEntry[k])
        {
          const sp = creature.speed
          if (!isHazard && (sp.walk || sp.fly || sp.swim || sp.burrow || sp.climb)) {
            entries.push({ kind: 'speed', key: 'speed', sp })
          }
        }
        if (entries.length === 0) return <Hdr>Defense</Hdr>
        if (style === 'inline') {
          return (
            <>
              <Hdr>Defense</Hdr>
              <StatRow>
                {entries.map(e => (
                  <span key={e.key} style={{ marginRight: 14, whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {e.kind === 'speed'
                      ? <><span className="stat-label">Speed</span> {speedText(e.sp)}</>
                      : <>
                          <span className={e.onRoll ? 'roll-check' : undefined} onClick={e.onRoll} title={e.title}>
                            <span className="stat-label">{e.label}</span>{' '}
                            {e.plain ? e.base : <Mod base={e.base} mod={e.mod} />}
                          </span>
                          {e.star && <span onClick={ev => ev.stopPropagation()}>{e.star}</span>}
                        </>}
                  </span>
                ))}
              </StatRow>
            </>
          )
        }
        return (
          <>
            <Hdr>Defense</Hdr>
            <div {...cubeProps('defense', 'stat-line def-strip')}>
              {entries.map(e => e.kind === 'speed'
                ? <SpeedBox key={e.key} speed={e.sp} />
                : <DefBox key={e.key} label={e.label} base={e.base} mod={e.mod} plain={e.plain}
                    signed={e.signed} onRoll={e.onRoll} title={e.title} star={e.star} />)}
            </div>
            {/* AoN's qualifier beside the AC — "all-around vision", "(19 when broken)",
                "(29 with shield raised)". 272 creatures; the numeric facet had no room for it. */}
            {creature.defenses.acNote && (
              <div className="stat-line">
                <span className="stat-label">AC</span>{' '}
                <TagRenderer text={creature.defenses.acNote} />
              </div>
            )}
            {/* AoN prints a qualifier after the three saves — "+1 status to all saves vs. magic",
                "construct armor". It exists only in the markdown (every save facet is a bare
                integer), and it decides saving throws, so it sits directly under the cubes it
                modifies. 942 creatures. */}
            {creature.defenses.saveNote && (
              <div className="stat-line">
                <span className="stat-label">Saves</span>{' '}
                <TagRenderer text={creature.defenses.saveNote} />
              </div>
            )}
            {/* AoN's Speed line is "40 feet; trailblazing stride, troop movement" — the movement
                abilities after the ';'. The Speed cube holds only the numbers, so they go here
                rather than being dropped (497 creatures). */}
            {creature.speedNote && (
              <div className="stat-line">
                <span className="stat-label">Speed</span>{' '}
                <TagRenderer text={creature.speedNote} />
              </div>
            )}
          </>
        )
      }
      case 'hp': { // cube form (text form is inline)
        if (hideHP || creature.defenses.hp <= 0) return null
        const bt = creature.defenses.bt
        if (isHazard) {
          return (
            <StatRow>
              <span className="stat-label">HP</span> {hpValueNodes}
              {bt !== undefined && !btInPoolLine && <span style={{ marginLeft: 10 }}><span className="stat-label">BT</span> {bt}</span>}
            </StatRow>
          )
        }
        return (
          <>
            <div {...cubeProps('hp', 'stat-line def-strip def-strip-solo')}>
              <div className="def-box">
                <div className="def-box-label">HP</div>
                <div className="def-box-val">{creature.defenses.hp}</div>
              </div>
              {bt !== undefined && (
                <div className="def-box">
                  <div className="def-box-label">BT</div>
                  <div className="def-box-val">{bt}</div>
                </div>
              )}
            </div>
            {/* The cube holds the combat pool only; every further pool (a hydra's head) is
                printed under it so the cube form loses nothing the text form shows. */}
            {extraHpPools.length > 0 && (
              <div className="stat-line" style={{ fontSize: 12 }}>
                <span className="stat-label">HP</span> {hpValueNodes}
              </div>
            )}
          </>
        )
      }
      case 'attacks': {
        if (creature.attacks.length === 0) return null
        // A hazard page prints its Melee / Ranged line inside or right after the ability (or the
        // Routine) that makes it — the reaction comes first, the strike is its effect (Hammer of
        // Forbiddance, Spinning Blade Pillar). Drawn before the abilities, every such reaction
        // read as coming after its own strike. The hazard tail draws them instead.
        if (isHazard && !tail) return null
        // Per-item overrides (set on the 'attacks' row in Settings) win over the
        // global Attacks-per-line / spacing; fall back to the globals otherwise.
        const atkItem = sb.items.find(i => i.id === 'attacks')
        const effPerLine = atkItem?.perLine ?? sb.attacksPerLine
        const effAtkGap = atkItem?.gapPx ?? lineGapPx(sb.sameLineGap, 'attacks')
        return (
          <>
            {tail?.header !== false && <Hdr>Attacks</Hdr>}
            <div
              className={effPerLine > 1 ? 'attacks-grid' : undefined}
              style={effPerLine > 1 ? { gridTemplateColumns: `repeat(${effPerLine}, minmax(0, 1fr))`, columnGap: effAtkGap } : undefined}>
            {creature.attacks.map((atk, i) => {
              if (tail?.only && !tail.only.includes(i)) return null
              // attackBonus + melee/ranged pooled in ONE typed bucket — adding the two resolved
              // numbers double-counted Frightened (see resolveAttackMod).
              const totalAtk = atk.attack + resolveAttackMod(combatant.conditions, atk.range==='Melee' ? 'melee' : 'ranged')
              return (
                <div className="stat-line" key={i}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                    <span className="stat-label" style={{ textTransform: 'capitalize' }}>{atk.range}</span>
                    {/* AoN prints the action cost on every strike line; it was parsed and thrown
                        away for 9,487 strikes before the cost reached the record. */}
                    {atk.activity && <ActionGlyph act={atk.activity} />}
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{atk.name}</span>
                    <span className={totalAtk < atk.attack ? 'stat-down' : totalAtk > atk.attack ? 'stat-up' : ''}>{fmt(totalAtk)}</span>
                    {atk.traits.length > 0 && (
                      <span style={{ fontSize: 12, ...muted }}>(
                        {atk.traits.map((t, ti) => {
                          const { base, tip } = resolveAttackTrait(t, traits)
                          const display = traitDisplay(t)
                          const suffix = tip && display.toLowerCase().startsWith(base) && display.length > base.length
                            ? display.slice(base.length) : null
                          return (
                            <span key={t}>
                              {ti > 0 && ', '}
                              {suffix !== null ? (
                                <>
                                  <Tooltip
                                    content={<PopupPreview type="trait" ref_={base} title={display.slice(0, base.length)} />}
                                    onActivate={pos => openWin('trait', base, display.slice(0, base.length), pos.x, pos.y, { noCascade: true })}
                                  >
                                    <span style={{ ...muted, cursor: 'pointer' }}>
                                      {display.slice(0, base.length)}
                                    </span>
                                  </Tooltip>
                                  <span style={muted}>{suffix}</span>
                                </>
                              ) : (
                                <TraitTag name={t} traitKey={tip ? base : undefined} />
                              )}
                            </span>
                          )
                        })}
                      )</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12 }}>
                      {/* Through TagRenderer so ability effects in the damage
                          string ("…plus Grab") link to their popup. Physical
                          damage types (piercing/slashing) aren't auto-linked, so
                          only the ability (and energy types) become links. */}
                      <span className="stat-label">Damage</span> {atk.damage ? <TagRenderer text={atk.damage} /> : '—'}
                      {atk.types.length > 0 && <span style={{ ...muted, marginLeft: 4 }}>{atk.types.join('/')}</span>}
                    </span>
                    {style !== 'compact' && (
                      <div style={{ display: 'flex', gap: 2 }}>
                        {([1,2,3] as const).map(n => {
                          const mp = mapPenalty(n, atk.isAgile)
                          const eff = totalAtk + mp
                          return (
                            <button key={n}
                              className={n === 1 ? 'attack-btn' : 'attack-btn-sec'}
                              onClick={() => handleAttack(i, n)}
                              title={`${n}${n===1?'st':n===2?'nd':'rd'} attack: ${fmt(eff)}`}
                            >
                              {n}{n===1?'st':n===2?'nd':'rd'} {fmt(eff)}
                            </button>
                          )
                        })}
                        <button className="attack-btn-sec" onClick={() => handleDamage(i)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <DiceIcon size={11} /> dmg
                        </button>
                      </div>
                    )}
                  </div>
                  {atk.effects.length > 0 && (
                    <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>
                      <span className="stat-label">Effects</span> <TagRenderer text={atk.effects.join(', ')} />
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </>
        )
      }
      case 'spells': {
        if (creature.spellcasting.length === 0) return null
        return (
          <>
            <Hdr right={resetSlot(anyUsesSpent)}>Spellcasting</Hdr>
            {creature.spellcasting.map((sc, i) => {
              const type = (sc.type || '').toLowerCase()
              const isSpontaneous = type === 'spontaneous'
              const isPrepared    = type === 'prepared'
              const isInnate      = type === 'innate'
              const isFocus       = type === 'focus'

              const spellName = (sp: { name: string; atWill?: boolean; note?: string }, slot: SpellSlotEntry, spent: boolean) => {
                const info = spells.get(sp.name.toLowerCase())
                const isCantripSpell = info?.traits?.some(t => t.toLowerCase() === 'cantrip') ?? false
                const castRank = (slot.isCantrip || isCantripSpell || isFocus)
                  ? Math.max(1, Math.ceil(creature.level / 2))
                  : slot.level
                const st: React.CSSProperties = spent
                  ? { ...spellLink, color: 'var(--text-faded)', textDecoration: 'line-through', borderBottomColor: 'transparent' }
                  : spellLink
                const label = info
                  ? <Tooltip
                      content={<PopupPreview type="spell" ref_={sp.name.toLowerCase()} title={info.name} castRank={castRank} />}
                      onActivate={pos => openWin('spell', sp.name.toLowerCase(), sp.name, pos.x, pos.y, { noCascade: true, castRank })}
                    >
                      <span style={st}>{sp.name}</span>
                    </Tooltip>
                  : <span style={spent ? { color: 'var(--text-faded)', textDecoration: 'line-through' } : { color: 'var(--linked)' }}>{sp.name}</span>
                /* AoN prints the restriction beside the spell and it changes what the spell DOES:
                 * the Solar's Invisibility is "self only", the Zebub's Summon Animal is "swarm
                 * creatures only". Both render here so per-spell rows and the inline list agree. */
                return sp.note ? <>{label}<span style={{ color: 'var(--text-faded)' }}> ({sp.note})</span></> : label
              }

              // Rank order + per-block rank spacing (Settings → Stat Blocks,
              // 'spells' row). 'desc' = highest rank first, then cantrips, then
              // constant last; default/'asc' keeps the parse order (cantrips
              // first, low→high). gapPx overrides the column gap between ranks.
              const spellItem = sb.items.find(it => it.id === 'spells')
              const spellGap = spellItem?.gapPx
              const orderedSlots = spellItem?.spellRankOrder === 'desc'
                ? [...sc.spellsByLevel].sort((a, b) => {
                    const ka = a.isConstant ? -2 : a.isCantrip ? -1 : a.level
                    const kb = b.isConstant ? -2 : b.isCantrip ? -1 : b.level
                    return kb - ka
                  })
                : sc.spellsByLevel
              return (
              <StatRow key={i}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}><TextWithGlyphs text={sc.name} /></span>
                  {isFocus && sc.focusPoints != null && sc.focusPoints > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <SpellPips total={sc.focusPoints} used={usedOf(focusKey(i))}
                        onChange={v => setResourceUse(combatant.id, focusKey(i), v)}
                        indicator={spellIndicator} title="Focus Points" />
                      <span style={{ fontSize: 10, color: 'var(--text-faded)', fontStyle: 'italic' }}>
                        focus point{sc.focusPoints === 1 ? '' : 's'}
                      </span>
                    </span>
                  )}
                </div>
                {(sc.DC || sc.attack !== undefined) && (
                  <div style={{ fontSize: 12, ...muted, marginBottom: 3 }}>
                    {sc.DC && <span>DC {sc.DC}{' '}</span>}
                    {sc.attack !== undefined && <span>Attack {fmt(sc.attack)}</span>}
                  </div>
                )}
                {sc.spellsByLevel.length > 0
                  ? <div className={`spell-ranks ${spellLayout}`} style={spellLayout === 'grid'
                      ? { fontSize: 12, gridTemplateColumns: `repeat(auto-fit, minmax(${spellColMin(sb.sameLineGap)}px, 1fr))`, columnGap: spellGap ?? lineGapPx(sb.sameLineGap, 'spells'), rowGap: 4 }
                      : { fontSize: 12 }}>
                      {orderedSlots.map((slot, si) => {
                        const untracked = slot.isCantrip || slot.isConstant
                        {/* AoN prints the rank a caster's cantrips are heightened to — "Cantrips
                            (3rd)" — and it matters, because that rank sets their damage. The rank
                            was parsed and shipped all along; this label just ignored it, on 1,273
                            creatures. */}
                        const label = slot.isCantrip
                          ? (slot.level > 0 ? <>Cantrips <b>{slot.level}{ord(slot.level)}</b></> : 'Cantrips')
                          : slot.isConstant ? slot.label
                          : slot.level > 0 ? <><b>{slot.level}{ord(slot.level)}</b> rank</>
                          : slot.label
                        const perSpellMode = (isPrepared || isInnate) && !untracked
                        return (
                          <div className="spell-rank" key={si}>
                            <div className="spell-rank-head">
                              <span className="spell-rank-label">{label}</span>
                              {slot.isCantrip && <span className="atwill">at will</span>}
                              {slot.isConstant && <span style={{ fontSize: 10, color: 'var(--text-faded)', fontStyle: 'italic' }}>constant</span>}
                              {isSpontaneous && !untracked && slot.slots != null && slot.slots > 0 && (
                                <SpellPips total={slot.slots} used={usedOf(spellSlotKey(i, slot.level))}
                                  onChange={v => setResourceUse(combatant.id, spellSlotKey(i, slot.level), v)}
                                  indicator={spellIndicator}
                                  title={`${slot.slots} slot${slot.slots === 1 ? '' : 's'}`} />
                              )}
                            </div>
                            {perSpellMode
                              ? <div className="spell-srows">
                                  {slot.spells.map((sp, spi) => {
                                    const info = spells.get(sp.name.toLowerCase())
                                    const isCantripSpell = info?.traits?.some(t => t.toLowerCase() === 'cantrip') ?? false
                                    const perSpell = !sp.atWill && !isCantripSpell
                                    const maxUses = sp.uses ?? 1
                                    const used = usedOf(spellUseKey(i, slot.level, sp.name))
                                    return (
                                      <Fragment key={spi}>
                                        <span className="spell-srow-name">{spellName(sp, slot, perSpell && used >= maxUses)}</span>
                                        {perSpell
                                          ? <SpellPips total={maxUses} used={used}
                                              onChange={v => setResourceUse(combatant.id, spellUseKey(i, slot.level, sp.name), v)}
                                              indicator={spellIndicator}
                                              title={`${maxUses} use${maxUses === 1 ? '' : 's'}`} />
                                          : <span className="atwill">at will</span>}
                                      </Fragment>
                                    )
                                  })}
                                </div>
                              : <div className="spell-list">
                                  {slot.spells.map((sp, spi) => (
                                    <span key={spi} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                      {spellName(sp, slot, false)}
                                      {sp.atWill && !slot.isCantrip && <span className="atwill" style={{ marginLeft: 4 }}>at will</span>}
                                      {spi < slot.spells.length - 1 && <span className="spell-sep">·</span>}
                                    </span>
                                  ))}
                                </div>}
                          </div>
                        )
                      })}
                    </div>
                  : <div style={{ fontSize: 12 }}><TextWithGlyphs text={sc.spells} /></div>
                }
              </StatRow>
            )})}
          </>
        )
      }
      case 'rituals': {
        const rit = creature.rituals
        // Defensive: drop any rank group with no ritual names, and show the
        // highest rank first (AoN order). Guards against partial/legacy data
        // that would otherwise render just the DC with nothing after it.
        const casts = (rit?.casts ?? []).filter(c => c.names && c.names.length)
          .slice().sort((a, b) => (b.level || 0) - (a.level || 0))
        if (!rit || (!casts.length && rit.dc == null)) return null
        return (
          <>
            <Hdr>Rituals</Hdr>
            <StatRow>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                {rit.dc != null && <><span className="stat-label">DC</span> {rit.dc}{casts.length ? '; ' : ''}</>}
                {casts.map((cast, ci) => (
                  <span key={ci}>
                    {ci > 0 && '; '}
                    {cast.rank && <b style={{ color: 'var(--accent)' }}>{cast.rank}</b>}{cast.rank ? ' ' : ''}
                    {cast.names.map((nm, ni) => {
                      const base = nm.replace(/\s*\(.*\)$/, '').trim()
                      const note = nm.slice(base.length)
                      const key = base.toLowerCase()
                      return (
                        <span key={ni}>
                          {ni > 0 && ', '}
                          {rituals.has(key) ? (
                            <Tooltip
                              content={<PopupPreview type="ritual" ref_={key} title={base} />}
                              onActivate={pos => openWin('ritual', key, base, pos.x, pos.y, { noCascade: true })}
                            ><span style={{ color: 'var(--linked)', cursor: 'pointer' }}>{base}</span></Tooltip>
                          ) : <span>{base}</span>}
                          {note && <span style={muted}>{note}</span>}
                        </span>
                      )
                    })}
                  </span>
                ))}
              </div>
            </StatRow>
          </>
        )
      }
      case 'specials': {
        // Only the abilities printed at the bottom of the page (and every slot-less one:
        // hand-built, pasted, hazard). 'top' and 'mid' abilities render at their own anchors
        // (see slotPlan) — this section is what is left.
        // A hazard's abilities are drawn by the hazard tail, with its strikes at their page places.
        if (isHazard && !tail) return null
        if (tail?.only) {
          const part = botAbilities.filter(x => tail.only!.includes(x.i))
          if (!part.length) return null
          return (
            <>
              {tail.header !== false && <Hdr right={creature.spellcasting.length === 0 ? resetSlot(anyUsesSpent) : undefined}>Abilities &amp; Actions</Hdr>}
              {part.map(({ ab, i }) => renderAbility(ab, i, style))}
            </>
          )
        }
        if (botAbilities.length === 0) {
          // Every ability sits higher up. Keep the long-rest reset reachable when this header
          // was its only home (no Spellcasting header) and something is spent.
          if (creature.abilities.length > 0 && creature.spellcasting.length === 0 && anyUsesSpent) {
            return <div className="stat-line" style={{ textAlign: 'right' }}>{resetAllBtn}</div>
          }
          return null
        }
        return (
          <>
            <Hdr right={creature.spellcasting.length === 0 ? resetSlot(anyUsesSpent) : undefined}>Abilities &amp; Actions</Hdr>
            {botAbilities.map(({ ab, i }) => renderAbility(ab, i, style))}
          </>
        )
      }
      default:
        return null
    }
  }

  // ── Hazard tail: abilities and strikes ───────────────────────────────────
  // A hazard page prints its Melee / Ranged line inside or right after the ability that makes it
  // and its riders after it (Poisoned Lock: Spring, Melee spine, Cladis Poison). A strike with a
  // page place (Attack.afterAbility, from the adapter) is drawn right there among the abilities;
  // one without (hand-built, pasted, a page whose order could not be read) after every ability.
  // All of it before the Routine. The Attacks and Abilities & Actions items keep their own
  // visibility and style; their place in the reorderable body does not apply to a hazard.
  const renderHazardTail = (): React.ReactNode => {
    const atkItem = sb.items.find(it => it.id === 'attacks')
    const abItem = specialsItem
    const atkOn = !atkItem?.hidden && creature.attacks.length > 0
    const abOn = !abItem?.hidden && botAbilities.length > 0
    const n = creature.abilities.length
    // Read defensively: a homebrew JSON can hold anything there.
    const placeOf = (a: Attack): number => {
      const k: unknown = a.afterAbility
      return typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < n ? k : n
    }
    if (!atkOn || !abOn || creature.attacks.every(a => placeOf(a) >= n)) {
      return (
        <>
          {abOn && renderBlock('specials', abItem?.style, {})}
          {atkOn && renderBlock('attacks', atkItem?.style, {})}
        </>
      )
    }
    const out: React.ReactNode[] = []
    let run: number[] = []
    let abHeader = true, atkHeader = true
    const flushRun = () => {
      if (!run.length) return
      out.push(<Fragment key={`ab:${run[0]}`}>{renderBlock('specials', abItem?.style, { only: run, header: abHeader })}</Fragment>)
      if (botAbilities.some(x => run.includes(x.i))) abHeader = false
      run = []
    }
    for (let k = 0; k <= n; k++) {
      const strikes = creature.attacks.map((a, i) => ({ a, i })).filter(x => placeOf(x.a) === k).map(x => x.i)
      if (strikes.length) {
        flushRun()
        out.push(<Fragment key={`atk:${k}`}>{renderBlock('attacks', atkItem?.style, { only: strikes, header: atkHeader })}</Fragment>)
        atkHeader = false
      }
      if (k < n) run.push(k)
    }
    flushRun()
    return out
  }

  // Group the visible items into lines: an item flagged "same line" merges onto
  // the previous line when both it and that line are inline-capable. In edit
  // mode hidden items are kept too (dimmed) so they can be toggled back, and a
  // hidden item never merges.
  const renderBody = () => {
    const lines: SbItem[][] = []
    for (const it of sb.items) {
      if (it.hidden && !edit) continue
      const prev = lines[lines.length - 1]
      const canJoin = !it.hidden && sbItemIsInline(it) && !!it.inline
        && prev && !prev[0].hidden && sbItemIsInline(prev[0])
      if (canJoin) prev.push(it)
      else lines.push([it])
    }

    if (edit) return renderEditMode(lines)

    // Top / mid abilities ride on the Abilities & Actions item: hidden with it, styled with it.
    const pending = specialsItem?.hidden ? [] : slotPlan()
    const out: React.ReactNode[] = []
    const flush = (beforeIdx: number) => {
      while (pending.length && pending[0].anchor < beforeIdx) {
        const p = pending.shift()!
        out.push(<Fragment key={`slot:${p.key}`}>{renderSlotAbilities(p.list)}</Fragment>)
      }
    }
    lines.forEach((group, gi) => {
      flush(sb.items.findIndex(it => it.id === group[0].id))
      out.push(<Fragment key={gi}>{renderLine(group)}</Fragment>)
    })
    flush(Infinity)
    return out
  }

  const renderLine = (group: SbItem[]): React.ReactNode => {
    if (!sbItemIsInline(group[0]) || group[0].hidden) {
      const it = group[0]
      return sbItemIsInline(it)
        ? <StatRow>{renderInline(it.id) ?? <span style={{ color: 'var(--text-faded)', fontStyle: 'italic' }}>({SB_ITEM_META[it.id].label})</span>}</StatRow>
        : renderBlock(it.id, it.style)
    }
    // One or more inline text items sharing a single row.
    const parts = group.map(it => ({ it, node: renderInline(it.id) })).filter(p => p.node != null)
    if (parts.length === 0) return null
    if (parts.length === 1) return <StatRow>{parts[0].node}</StatRow>
    const g = group[0].gapPx ?? lineGapPx(sb.sameLineGap, 'merged')
    return (
      <StatRow>
        <div style={mergeContainer(sb.mergeStyle, g)}>
          {parts.map((p, i) => (
            <div key={p.it.id} style={mergeItemStyle(sb.mergeStyle, i, g)}>{p.node}</div>
          ))}
        </div>
      </StatRow>
    )
  }

  // ── Settings-only editor ──────────────────────────────────────────────────
  // Mergeable text rows render as draggable CHIPS that live inside outlined
  // line-boxes. Drop a chip into another line-box to share that line; drop it on
  // one of the thin slots between rows to give it its own line. Block sections
  // (cubes / Attacks / Spellcasting / Abilities) drag as a whole to reorder.
  // This is editing scaffolding only — real stat blocks never show chips/boxes.
  const renderEditMode = (lines: SbItem[][]) => {
    const e = edit!
    const dragged = dragId ? sb.items.find(x => x.id === dragId) ?? null : null
    const draggedInline = !!dragged && sbItemIsInline(dragged) && !dragged.hidden

    const chip = (it: SbItem) => {
      const selected = e.selectedId === it.id
      return (
        <span key={it.id} draggable
          onDragStart={ev => { setDragId(it.id); ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation() }}
          onDragEnd={() => { setDragId(null); setOverZone(null) }}
          onClickCapture={ev => { ev.preventDefault(); ev.stopPropagation(); e.onSelect(it.id) }}
          title="Drag into a row to share its line · drag to a slot for its own line · click to edit"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px',
            borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)',
            border: `var(--app-bw) solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
            boxShadow: selected ? 'inset 0 0 0 1px var(--accent)' : undefined,
            cursor: 'grab', opacity: dragId === it.id ? 0.4 : (it.hidden ? 0.45 : 1),
          }}>
          <span aria-hidden style={{ color: 'var(--text-faded)', fontSize: 13, lineHeight: 1, cursor: 'grab' }}>⠿</span>
          <span style={{ minWidth: 0 }}>{renderInline(it.id) ?? <span style={{ color: 'var(--text-faded)', fontStyle: 'italic' }}>({SB_ITEM_META[it.id].label})</span>}</span>
        </span>
      )
    }

    // A thin "own line" slot. index 0 = before the first row; lines.length =
    // after the last. Visible only while dragging; highlights when hovered.
    const strip = (index: number) => {
      const key = `strip:${index}`
      const over = overZone === key
      const place = () => {
        if (!dragId) return
        if (index >= lines.length) { const last = lines[lines.length - 1]; e.onDropMerge(dragId, last[last.length - 1].id, 'stack-after') }
        else e.onDropMerge(dragId, lines[index][0].id, 'stack')
      }
      return (
        <div key={key}
          onDragOver={ev => { if (!dragId) return; ev.preventDefault(); if (overZone !== key) setOverZone(key) }}
          onDragLeave={() => { if (overZone === key) setOverZone(null) }}
          onDrop={ev => { ev.preventDefault(); place(); setDragId(null); setOverZone(null) }}
          style={{
            margin: '0 22px', borderRadius: 5, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: over ? 24 : (dragId ? 12 : 4),
            border: `1px dashed ${over ? 'var(--accent)' : (dragId ? 'var(--border-strong)' : 'transparent')}`,
            background: over ? 'var(--accent-soft)' : 'transparent',
            color: 'var(--accent)', fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.04em', transition: 'height .1s, background .1s',
          }}>{over ? '＋ own line' : ''}</div>
      )
    }

    // A line of chips — also a drop zone that joins the dragged chip onto it.
    const chipLine = (group: SbItem[]) => {
      const key = `line:${group[0].id}`
      const canDrop = draggedInline && !group.some(x => x.id === dragId)
      const over = overZone === key && canDrop
      // Multi-item lines preview their real horizontal gap so the per-line
      // spacing slider gives live feedback; single chips stay compact.
      const effGap = group.length > 1 ? (group[0].gapPx ?? lineGapPx(sb.sameLineGap, 'merged')) : 6
      return (
        <div key={key}
          onDragOver={ev => { if (!canDrop) return; ev.preventDefault(); if (overZone !== key) setOverZone(key) }}
          onDragLeave={() => { if (overZone === key) setOverZone(null) }}
          onDrop={ev => { ev.preventDefault(); if (canDrop && dragId) e.onDropMerge(dragId, group[group.length - 1].id, 'beside'); setDragId(null); setOverZone(null) }}
          style={{
            display: 'flex', flexWrap: 'wrap', columnGap: effGap, rowGap: 6, alignItems: 'center',
            margin: '0 22px', padding: '4px 6px', borderRadius: 7, minHeight: 30,
            border: `1px ${over ? 'solid' : 'dashed'} ${over ? 'var(--accent)' : 'var(--border)'}`,
            background: over ? 'var(--accent-soft)' : (dragId ? 'rgba(127,127,127,0.06)' : 'transparent'),
            transition: 'background .1s, border-color .1s',
          }}>
          {group.map(chip)}
        </div>
      )
    }

    // A block section: rendered normally, draggable to reposition via the slots.
    const blockWrap = (it: SbItem) => {
      const selected = e.selectedId === it.id
      const node = sbItemIsInline(it)
        ? <StatRow>{renderInline(it.id) ?? <span style={{ color: 'var(--text-faded)', fontStyle: 'italic' }}>({SB_ITEM_META[it.id].label})</span>}</StatRow>
        : renderBlock(it.id, it.style)
      return (
        <div key={`block:${it.id}`} draggable
          onDragStart={ev => { setDragId(it.id); ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation() }}
          onDragEnd={() => { setDragId(null); setOverZone(null) }}
          onClickCapture={ev => { ev.preventDefault(); ev.stopPropagation(); e.onSelect(it.id) }}
          className={`sb-edit-item${selected ? ' selected' : ''}`}
          title="Drag to a slot to move this section · click to edit"
          style={{ cursor: 'grab', opacity: dragId === it.id ? 0.4 : (it.hidden ? 0.45 : 1) }}>
          {node}
        </div>
      )
    }

    // Top / mid abilities in the preview: drawn where they will print, not draggable on their
    // own (they belong to Abilities & Actions — a click selects that item, and the capture
    // handler keeps their rolls and chips inert like every other preview row).
    const pending = slotPlan()
    const slotWrap = (p: ReturnType<typeof slotPlan>[number]) => (
      <div key={`slot:${p.key}`}
        onClickCapture={ev => { ev.preventDefault(); ev.stopPropagation(); e.onSelect('specials') }}
        className={`sb-edit-item${e.selectedId === 'specials' ? ' selected' : ''}`}
        title="Printed here by the page — part of Abilities & Actions · click to edit"
        style={{ opacity: specialsItem?.hidden ? 0.45 : 1 }}>
        {renderSlotAbilities(p.list)}
      </div>
    )
    const flush = (beforeIdx: number): React.ReactNode[] => {
      const nodes: React.ReactNode[] = []
      while (pending.length && pending[0].anchor < beforeIdx) nodes.push(slotWrap(pending.shift()!))
      return nodes
    }

    return (
      <div style={{ padding: '6px 0' }}>
        {strip(0)}
        {lines.map((group, li) => (
          <Fragment key={group[0].id}>
            {flush(sb.items.findIndex(it => it.id === group[0].id))}
            {sbItemIsInline(group[0]) && !group[0].hidden ? chipLine(group) : blockWrap(group[0])}
            {strip(li + 1)}
          </Fragment>
        ))}
        {flush(Infinity)}
      </div>
    )
  }

  return (
    <CreatureLinksCtx.Provider value={creatureLinks.get(creature.name.toLowerCase())}>
    <div className={`stat-block${sb.compact ? ' compact' : ''}`}>
      {/* ── Hazard banner (only shown if needed) ── */}
      {isHazard && (
        <div style={{ padding: '6px 24px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: 'var(--app-bw) solid var(--border)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 11 }}>⚠ Hazard</span>
          {/* Complexity badge — Simple / Complex per PF2e GM Core. */}
          {hd && (
            <span style={{
              fontFamily: 'var(--font-ui)', fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
              padding: '2px 7px', borderRadius: 3, textTransform: 'uppercase',
              background: hd.complex ? 'var(--danger-soft)' : 'var(--bg-elevated)',
              border: `var(--app-bw) solid ${hd.complex ? 'var(--danger)' : 'var(--border-strong)'}`,
              color: hd.complex ? 'var(--danger)' : 'var(--text-muted)',
            }}>{hd.complex ? 'Complex' : 'Simple'}</span>
          )}
        </div>
      )}

      {/* ── Color-coded trait tags (with Elite/Weak adjustment pills) ──
           Hidden in the detail panel (hideTraits), where they're shown in the
           HP/action bar instead. */}
      {!hideTraits && (creature.traits.length > 0 || combatant.isElite || combatant.isWeak) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '12px 24px 10px', borderBottom: 'var(--app-bw) solid var(--border)' }}>
          <TraitTags traits={creature.traits} elite={combatant.isElite} weak={combatant.isWeak} />
        </div>
      )}

      {/* Recall Knowledge is now the first reorderable body item (renderBody),
          so it can be moved / merged / hidden like every other row. */}

      {/* ── Hazard: Stealth → Description → Disable (AoN order) ── */}
      {isHazard && hd && (
        <>
          {hd.stealth && (
            <StatRow>
              <span className="stat-label">Stealth</span>{' '}
              <TagRenderer text={hd.stealth} />
            </StatRow>
          )}
          {hd.description && (
            <div style={{ padding: '8px 24px 4px' }}>
              <div className="pf-label" style={{ marginBottom: 4 }}>Description</div>
              <div style={{
                color: 'var(--text)',
                fontSize: 13, lineHeight: 1.6,
              }}>
                <TagRenderer text={hd.description} />
              </div>
            </div>
          )}
          {hd.disable && (
            <div style={{ padding: '8px 24px 4px' }}>
              <div className="pf-label" style={{ marginBottom: 4 }}>Disable</div>
              <ProseBlock text={hd.disable} dense
                onRoll={rollAbilityDamage} onCheck={handleCheck} rollLabel={`${creature.name} — Disable`} />
            </div>
          )}
        </>
      )}

      {/* ── Reorderable body — order / style / visibility / same-line grouping
           come from Settings → Stat Blocks (read-only here). Covers Perception
           through Abilities & Actions, including Attacks and Spellcasting. ── */}
      {renderBody()}

      {/* ── Hazard abilities and strikes, before the Routine ── */}
      {isHazard && renderHazardTail()}

      {/* ── Hazard routine / reset ── */}
      {isHazard && hd && (
        <>
          {hd.routine && (() => {
            // Detect a routine header. Two acceptable shapes:
            //   "<Name> (N actions) <body>"  — a named routine action
            //   "(N actions) <body>"         — bare action-cost prefix
            // Either way we pull the name+cost out so the body reads cleanly.
            // The body may run over several lines (the structured raw.routine keeps the page's
            // breaks), so the body capture is [\s\S]*, not .*; a cost may carry traits
            // ("(2 actions; death, divine)").
            const namedM = hd.routine.match(/^([A-Z][\w' -]{1,80}?)\s+\((\d+\s+actions?|Reaction|Free Action|action|actions)(?:;\s*([^)]*))?\)\s*([\s\S]*)$/i)
            const bareM  = !namedM ? hd.routine.match(/^\((\d+\s+actions?|Reaction|Free Action|action|actions)(?:;\s*([^)]*))?\)\s*([\s\S]*)$/i) : null
            const headName = namedM ? namedM[1].trim() : ''
            const headCost = namedM ? namedM[2].trim() : (bareM ? bareM[1].trim() : '')
            const headTraits = (namedM ? namedM[3] : bareM?.[2])?.trim() ?? ''
            const routineText = namedM ? namedM[4] : (bareM ? bareM[3] : hd.routine)
            const costGlyph = headCost === 'Reaction'    ? '↺'
                          : headCost === 'Free Action'  ? '◇'
                          : /^3\s/.test(headCost) ? '◆◆◆'
                          : /^2\s/.test(headCost) ? '◆◆'
                          : /^1?\s*action/i.test(headCost) ? '◆'
                          : ''
            // The glyph font has one to three actions; a Routine of 4, 6 or 9 actions prints its
            // count as words, as the page does ("(9 actions)"), never nothing.
            const costWords = !costGlyph && /^\d+\s+actions?$/i.test(headCost) ? `(${headCost})` : ''
            // Entries the page prints in bold inside the Routine, with their own cost ("Lightning
            // Arc [one-action] (electricity) …"), draw as ability rows after the opening prose.
            const { intro: body, entries: routineEntries } = splitRoutine(routineText)
            return (
              <>
                <SectionHdr>Routine</SectionHdr>
                <div style={{
                  padding: '10px 24px 14px',
                  background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
                  borderLeft: '2px solid var(--accent-line)',
                  marginLeft: 12, marginRight: 12,
                  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                }}>
                  {(headName || costGlyph || costWords) && (
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600, fontSize: 13.5,
                      color: 'var(--text)',
                      marginBottom: 6,
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                    }}>
                      {headName && <span>{headName}</span>}
                      {/* Use the shared ActionGlyph so the routine header
                          shows the same AoN Pathfinder2eActions font glyph
                          as everywhere else, not a raw unicode character. */}
                      {costGlyph && <ActionGlyph act={costGlyph} />}
                      {costWords && <span>{costWords}</span>}
                      {headTraits && <span style={{ fontSize: 12, fontWeight: 400, ...muted }}>({headTraits})</span>}
                    </div>
                  )}
                  <ProseBlock text={body}
                    onRoll={rollAbilityDamage}
                    onCooldownRoll={rollAbilityCooldown}
                    onCheck={handleCheck}
                    rollLabel={headName ? `${creature.name} — ${headName}` : `${creature.name} — Routine`} />
                  {/* Keys past every creature.abilities index, so a row never shares one. */}
                  {routineEntries.map((ab, ri) => renderAbility(ab, creature.abilities.length + ri))}
                </div>
              </>
            )
          })()}
          {hd.reset && (
            <>
              <SectionHdr>Reset</SectionHdr>
              <div style={{
                padding: '10px 24px 14px',
                color: 'var(--text-muted)',
              }}>
                <ProseBlock text={hd.reset}
                  onRoll={rollAbilityDamage} onCheck={handleCheck} rollLabel={`${creature.name} — Reset`} />
              </div>
            </>
          )}
        </>
      )}

      {/* ── AoN full-text fallback ──
          Last-resort raw-markdown dump when our parsers found nothing
          structured to render. Suppressed for hazards entirely — their
          content lives in `hazardData` (description / stealth / disable /
          abilities / routine / reset) and we already render every one of
          those sections above, so the raw blob would just be a duplicate
          wall of unrendered text below the proper layout.

          The "no abilities have entries" check also accepted hazards whose
          only ability was a name-only one (e.g. "Reactive Strike" with an
          empty body) — which is why some hazards were showing the dump
          even though their stat block was fully parsed. */}
      {!isHazard && creature.rawMarkdown && creature.attacks.length === 0 && creature.abilities.every(a => !a.entries) && (
        <>
          <SectionHdr>Full Text</SectionHdr>
          <StatRow>
            {/* Render line-by-line through TagRenderer so AoN markup
                (action glyphs, ((notes)), trait/spell links) resolves instead
                of dumping raw `<actions …/>` / `((…))` text. */}
            <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text)', wordBreak: 'break-word' }}>
              {creature.rawMarkdown.split('\n').map((line, i) =>
                line.trim()
                  ? <div key={i} style={{ whiteSpace: 'pre-wrap' }}><TagRenderer text={line} /></div>
                  : <div key={i} style={{ height: 6 }} />
              )}
            </div>
          </StatRow>
        </>
      )}

      {/* Bottom padding */}
      <div style={{ height: 16 }} />
    </div>
    </CreatureLinksCtx.Provider>
  )
}

export { fmtSave }
