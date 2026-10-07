import type { Creature, Attack, Ability, SpellBlock, SpellSlotEntry, Defenses, RitualBlock, HazardExtra } from '../types/pf2e'

let _uid = 0
const uid = () => `custom-${Date.now()}-${++_uid}`

const ALIGNMENTS = new Set(['LG', 'LN', 'LE', 'NG', 'N', 'NE', 'CG', 'CN', 'CE'])
const SIZES = new Set(['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'])

// Lines we always skip — they're metadata that lives outside the stat block proper.
const SKIP_LINES = [
  /^Legacy\s+Content$/i,
  /^Remaster\s+Content$/i,
  /^PFS\s+Note$/i,
]

// Known keywords that indicate a stat-block "field" line. Anything starting
// with one of these is NOT a trait line.
const FIELD_KEYWORDS = [
  'Perception', 'Languages', 'Language', 'Skills', 'Skill',
  'Str', 'Strength',
  'Items', 'Item',
  'AC', 'HP', 'Speed',
  'Melee', 'Ranged',
  'Source', 'Recall',
  'Creature', 'Hazard',
  'Immunities', 'Immunity',
  'Weaknesses', 'Weakness',
  'Resistances', 'Resistance',
  'Rituals', 'Ritual',
  'Saving',
  'Stealth',
  'Trigger', 'Effect', 'Requirements', 'Frequency',
  'Traits', 'Family', 'Archives', 'Hardness', 'BT', 'Fort', 'Ref', 'Will',
  'Description', 'Disable', 'Routine', 'Reset', 'Complexity',
]

function startsWithField(line: string): boolean {
  return FIELD_KEYWORDS.some(k => new RegExp(`^${k}\\b`, 'i').test(line))
}

export function normalizeTrait(w: string): string {
  const u = w.toUpperCase().replace(/[^A-Z]/g, '')
  if (ALIGNMENTS.has(u)) return u
  if (SIZES.has(u)) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  return w.split(/[-\s]/).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

function parseBonus(s: string): number {
  const m = s.match(/([+-]\d+)/)
  return m ? parseInt(m[1]) : 0
}

/** Split on `sep` where it is outside every ( ) and [ ] pair: "a (b, c), d" → ["a (b, c)", " d"]. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    else if ((ch === ')' || ch === ']') && depth > 0) depth--
    if (ch === sep && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

/** A balanced "( … )" group at the very start of `s` → its inside and what follows it. */
function leadingParen(s: string): { inner: string; rest: string } | null {
  if (!s.startsWith('(')) return null
  let depth = 0
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '(') depth++
    else if (s[k] === ')') {
      depth--
      if (depth === 0) return { inner: s.slice(1, k), rest: s.slice(k + 1).trim() }
    }
  }
  return null
}

/** A balanced "( … )" group at the very end of `s` → what precedes it and its inside. */
function trailingParen(s: string): { head: string; inner: string } | null {
  if (!s.endsWith(')')) return null
  let depth = 0
  for (let k = s.length - 1; k >= 0; k--) {
    if (s[k] === ')') depth++
    else if (s[k] === '(') {
      depth--
      if (depth === 0) return { head: s.slice(0, k).trim(), inner: s.slice(k + 1, -1) }
    }
  }
  return null
}

/** A note's own outer brackets dropped, the way the adapter stores a pool name ("(body)" → "body"). */
const stripOuter = (s: string) => s.trim().replace(/^\(([^()]*)\)$/, '$1').trim()

// AoN uses both [one action] and [one-action]. Accept either.
// Returns the unicode action symbol that ActionGlyph + activitySymbol use
// elsewhere in the app (◆ / ◆◆ / ◆◆◆ / ◇ / ↺) — NOT a letter/number.
const COST_WORD = '(?:one|two|three)[\\s-]actions?|free[\\s-]action|reaction'
const COST_GLYPH: Record<string, string> = {
  'one action': '◆', 'one actions': '◆',
  'two actions': '◆◆', 'two action': '◆◆',
  'three actions': '◆◆◆', 'three action': '◆◆◆',
  'free action': '◇', 'reaction': '↺',
}
const costGlyph = (w: string) => COST_GLYPH[w.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ')]

/** A cost at the very start of `s`: "[reaction]", "[two-actions]", a range "[one-action] to
 *  [three-actions]" (→ "◆ to ◆◆◆", as activitySymbol prints a range). */
function leadingCost(s: string): { activity?: string; rest: string } {
  const m = s.match(new RegExp(`^\\[(${COST_WORD})\\](?:\\s+(to|or)\\s+\\[(${COST_WORD})\\])?\\s*`, 'i'))
  if (!m) return { rest: s }
  const a = costGlyph(m[1])
  const b = m[3] ? costGlyph(m[3]) : undefined
  return { activity: b ? `${a} ${m[2].toLowerCase()} ${b}` : a, rest: s.slice(m[0].length) }
}

type SpellEntry = SpellSlotEntry['spells'][number]

/** "Fireball (×3), Invisibility (at will; self only), Plane Shift (self only)" → spells. The
 *  trailing bracket is a use count ("×3", "3"), "at will", or a note; a count or "at will" may be
 *  followed by "; note". */
function parseSpellList(s: string): SpellEntry[] {
  return splitTop(s, ',').flatMap(chunk => {
    let sp = chunk.trim()
    if (!sp) return []
    let atWill = false
    let uses: number | undefined
    let note: string | undefined
    const tp = trailingParen(sp)
    if (tp && tp.head) {
      const inner = tp.inner.trim()
      const semi = inner.indexOf(';')
      const first = (semi >= 0 ? inner.slice(0, semi) : inner).trim()
      const after = semi >= 0 ? inner.slice(semi + 1).trim() : ''
      const count = first.match(/^(?:×|x)?\s*(\d+)$/i)
      if (/^at\s*will$/i.test(first)) { atWill = true; note = after || undefined }
      else if (count) { uses = parseInt(count[1], 10); note = after || undefined }
      else note = inner || undefined
      sp = tp.head
    }
    if (!sp) return []
    const out: SpellEntry = { name: sp }
    if (atWill) out.atWill = true
    else if (uses !== undefined) out.uses = uses
    if (note) out.note = note
    return [out]
  })
}

interface SpellState {
  name: string
  type: string
  tradition: string
  DC?: number
  attack?: number
  focusPoints?: number
  slots: SpellSlotEntry[]
}

export interface ParseResult {
  creature: Creature | null
  errors: string[]
  warnings: string[]
}

// Decide whether a line looks like a creature-trait line (size/alignment/type/etc).
// Traits lines are short, all-Title-case (or all-caps alignment), no descriptive text.
export function looksLikeTraitsLine(line: string): boolean {
  if (!line || startsWithField(line)) return false
  const words = line.split(/\s+/)
  if (words.length > 10) return false   // descriptions are longer
  // Every word must be either:
  //   - all-caps (alignment like CE)
  //   - Title-case (Beast, Gargantuan)
  //   - hyphenated Title-case (Cold-Iron)
  return words.every(w => {
    if (!w) return false
    if (/^[A-Z]{1,3}$/.test(w)) return ALIGNMENTS.has(w)
    return /^[A-Z][a-zA-Z'-]*$/.test(w)
  })
}

// Extract the ability name from a line. Handles:
//   "Carapace Tarrasque is immune to..."  → name="Carapace", rest="Tarrasque is..."
//   "Frightful Presence (aura) 300 ft, DC 39" → name="Frightful Presence", rest="(aura) 300 ft, DC 39"
//   "Attack of Opportunity [reaction]"  → name="Attack of Opportunity", rest="[reaction]"
//   "Reflect [reaction] Trigger ..."  → name="Reflect", rest="[reaction] Trigger ..."
function extractAbilityName(
  line: string,
  creatureName: string,
): { name: string; rest: string } {
  // 1. If line contains [ or ( before any description, name is everything before.
  const bracketIdx = line.search(/[[(]/)
  if (bracketIdx > 0) {
    return {
      name: line.substring(0, bracketIdx).trim(),
      rest: line.substring(bracketIdx).trim(),
    }
  }

  // 2. Look for the creature's name (or its first word) — description usually starts there.
  const creatureFirst = creatureName.split(/\s+/)[0]
  if (creatureFirst) {
    // Search for the creature's first name word — but only AFTER position 1
    // (to skip cases where the ability itself is named after the creature, e.g. "Tarrasque Bite").
    const re = new RegExp(`\\b${escapeRegex(creatureFirst)}\\b`, 'i')
    const m = line.substring(1).match(re)
    if (m && m.index !== undefined) {
      const idx = m.index + 1
      return {
        name: line.substring(0, idx).trim().replace(/[,;]\s*$/, ''),
        rest: line.substring(idx).trim(),
      }
    }
  }

  // 3. Greedy capture of leading Title-Case words (1–4), stop at common pronouns.
  const words = line.split(/\s+/)
  const STOP = new Set(['The', 'It', 'A', 'An', 'This', 'That', 'Each', 'When', 'On', 'Once', 'If', 'While', 'After', 'Before'])
  const nameWords: string[] = [words[0]]
  for (let j = 1; j < Math.min(5, words.length); j++) {
    const w = words[j]
    if (!w) break
    if (STOP.has(w)) break
    if (!/^[A-Z]/.test(w)) break          // first lower-case word ends the name
    nameWords.push(w)
  }
  return {
    name: nameWords.join(' '),
    rest: words.slice(nameWords.length).join(' '),
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * One ability's opening line. Two forms:
 *   - pasted / plain: "Frightful Presence (aura, fear) 90 feet, DC 33" — the name is found by
 *     extractAbilityName, a cost bracket and a trait bracket right after it are read, the rest
 *     (double spaces collapsed) is the text;
 *   - "**Name** [reaction] (traits) text" — the name exactly as written between the stars, the
 *     text verbatim. creatureToText writes this form whenever the plain one would read back a
 *     different name, cost, trait list or text (a name with a lower-case word, one whose text
 *     names the creature, a name that is also a stat label).
 */
function parseAbilityHead(line: string, creatureName: string): Ability {
  const bold = line.match(/^\*\*(.+?)\*\*(.*)$/)
  let name: string
  let rest: string
  if (bold) { name = bold[1].trim(); rest = bold[2].trim() }
  else ({ name, rest } = extractAbilityName(line, creatureName))
  const cost = leadingCost(rest)
  rest = cost.rest
  let traits: string[] = []
  const tp = leadingParen(rest)
  if (tp) {
    traits = splitTop(tp.inner, ',').map(s => s.trim()).filter(Boolean)
    rest = tp.rest
  }
  let entries = rest.trim()
  // Tidy up a pasted line: collapse double spaces and stray leading punctuation.
  if (!bold) entries = entries.replace(/\s{2,}/g, ' ').replace(/^[,;:]\s*/, '').trim()
  return { name, activity: cost.activity, traits, entries }
}

/** A depth-0 search: the first match of `re` in `s` that is outside every bracket pair. */
function topLevelIndex(s: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  for (const m of s.matchAll(g)) {
    let depth = 0
    for (let k = 0; k < m.index!; k++) {
      if (s[k] === '(' || s[k] === '[') depth++
      else if ((s[k] === ')' || s[k] === ']') && depth > 0) depth--
    }
    if (depth === 0) return m.index!
  }
  return -1
}

const SAVE_KEY: Record<string, 'fort' | 'ref' | 'will'> = { fort: 'fort', fortitude: 'fort', ref: 'ref', reflex: 'ref', will: 'will' }

/** "Fort +11, Ref +13, Will +7; +1 status to all saves vs. magic" → the saves in it and the note
 *  after the last one. Each save is read once; the first text that is not a save ends the run. A
 *  save's own bracket ("Ref +22 (+24 vs. traps)", ~1 % of creature pages) is read with it and kept
 *  in the note as "Ref (+24 vs. traps)" (Defenses has one save note), before the note after the
 *  saves: round 4 ended the run there and every later save read 0. */
function readSaves(s: string): { saves: Partial<Record<'fort' | 'ref' | 'will', number>>; note?: string } {
  const saves: Partial<Record<'fort' | 'ref' | 'will', number>> = {}
  const own: string[] = []
  let rest = s
  for (;;) {
    const m = rest.match(/^[\s;,]*(Fort|Fortitude|Ref|Reflex|Will)\s+([+-]\d+)/i)
    if (!m) break
    const k = SAVE_KEY[m[1].toLowerCase()]
    if (saves[k] !== undefined) break
    saves[k] = parseInt(m[2], 10)
    rest = rest.slice(m[0].length)
    const lp = leadingParen(rest.trimStart())
    if (lp) {
      own.push(`${m[1]} (${lp.inner.trim()})`)
      rest = lp.rest
    }
  }
  const note = [...own, rest.replace(/^[\s;,]+/, '').trim()].filter(Boolean).join('; ')
  return { saves, ...(note ? { note } : {}) }
}

/** A strike's damage. "3d12+15 piercing" → formula + types; a damage that says more than a formula
 *  and its types ("1 piercing plus cladis poison", "… plus Grab") stays whole, as the adapter
 *  stores it (stripping its types read "1 plus cladis" with "piercing poison" drawn after it). */
export function readDamage(raw: string): { damage: string; types: string[] } {
  // creatureToText writes a strike's own types apart ("2d8+6 plus Grab; types piercing", "…; types
  // none") whenever the plain form would read back different: a record pasted before round 4 holds
  // damage "2d8+6 plus Grab" with types ["piercing"], and appending the type read it back whole
  // with no types (the builder's Damage types field blank, Monster Parts without the record's types).
  const own = raw.match(/^(.*?)\s*;\s*types(?:\s+(.*?))?\s*$/i)
  if (own) {
    const list = (own[2] ?? '').trim()
    return {
      damage: own[1].trim(),
      types: /^none$/i.test(list) ? [] : splitTop(list, ',').map(t => t.trim()).filter(Boolean),
    }
  }
  const rawDam = raw.trim()
  const TYPES = /\b(bludgeoning|piercing|slashing|acid|cold|electricity|fire|force|negative|positive|sonic|mental|poison|bleed|spirit|vitality|void)\b/gi
  const damTypes: string[] = []
  const damFormula = rawDam
    .replace(TYPES, (_, t) => { damTypes.push(t); return '' })
    .replace(/\s+plus\s+$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const pure = damTypes.length > 0 && /^[\dd+\-−\s]+$/i.test(damFormula)
  return pure ? { damage: damFormula, types: damTypes } : { damage: rawDam, types: [] }
}

/** "fire 10, physical 5 (except silver), pain sensitivity" → [{ name, amount, note }]. */
function readIwr(s: string): Array<{ amount: number | null; name: string; note?: string }> {
  const out: Array<{ amount: number | null; name: string; note?: string }> = []
  for (const part of splitTop(s, ',')) {
    let p = part.trim()
    if (!p) continue
    let note: string | undefined
    const tp = trailingParen(p)
    if (tp && tp.head) { note = tp.inner.trim() || undefined; p = tp.head }
    const m = p.match(/^(.*?)\s+(\d+)$/)
    const name = (m ? m[1] : p).trim()
    if (!name) continue
    out.push({ name, amount: m ? parseInt(m[2], 10) : null, ...(note ? { note } : {}) })
  }
  return out
}

interface Line { text: string; raw: number; indented: boolean; cont: string; escaped: boolean }

type HazardKey = 'stealth' | 'description' | 'disable' | 'routine' | 'reset'

type Cont =
  | { kind: 'ability'; ab: Ability; head: string; lines: string[] }
  | { kind: 'hazard'; key: HazardKey; lines: string[] }
  | { kind: 'strike'; atk: Attack }

function ordSuffix(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return 'th'
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
}

/** One rank of a spell block: "4th fireball (×3), haste", "3rd (2 slots) …", "Cantrips (6th) …",
 *  "Constant (5th) tongues" — or null. */
function rankSlot(text: string): SpellSlotEntry | null {
  const constM = text.match(/^Constant\s*\((\d+)(?:st|nd|rd|th)\)\s*(.+)$/i)
  if (constM) {
    const lvl = parseInt(constM[1], 10)
    return { label: `Constant (${lvl}${ordSuffix(lvl)})`, level: lvl, spells: parseSpellList(constM[2]), isConstant: true }
  }
  const lvlM = text.match(/^(\d+)(?:st|nd|rd|th)\s+(?:\((\d+)\s+slots?\)\s*)?(.+)/i)
  if (lvlM) {
    const lvl = parseInt(lvlM[1], 10)
    return { label: `Level ${lvl}`, level: lvl, spells: parseSpellList(lvlM[3]), ...(lvlM[2] ? { slots: parseInt(lvlM[2], 10) } : {}) }
  }
  const cantM = text.match(/^Cantrips?\s*(?:\((\d+)(?:st|nd|rd|th)\)\s*)?(.+)/i)
  if (cantM) return { label: 'Cantrips', level: cantM[1] ? parseInt(cantM[1], 10) : 0, spells: parseSpellList(cantM[2]), isCantrip: true }
  return null
}

/** A spell block's heading line, or null. The name ends in Spells / Spell / Cantrips / Hexes and
 *  is followed by at least one of: "DC n", "attack +n", "; n Focus Points", "; type X". A name
 *  that does not end so is written "Spellcasting <name> …" (creatureToText), read the same way.
 *  The AoN one-line form "… DC 25, attack +17; 4th dimension door; Cantrips (4th) light" reads its
 *  ranks too; after a DC or attack any other segment is ignored, as the old heading regex did. */
function readSpellHeader(line: string): SpellState | null {
  const explicit = line.match(/^Spellcasting\s+(.+)$/i)
  const m = explicit
    ? explicit[1].match(/^(.+?)(\s+DC\s+\d+)?(,?\s*attack\s+[+-]\d+)?((?:\s*;\s*[^;]*)*)$/i)
    : line.match(/^(.+?\b(?:Spells?|Cantrips|Hexes))(\s+DC\s+\d+)?(,?\s*attack\s+[+-]\d+)?((?:\s*;\s*[^;]*)*)$/i)
  if (!m) {
    // Anything else after "… Spells DC n" (the old heading regex took the DC, an attack anywhere
    // after it, and ignored the rest): still a heading.
    const loose = explicit ? null : line.match(/^(.+?\b(?:Spells?|Cantrips|Hexes))\s+DC\s+(\d+)(.*)$/i)
    if (!loose) return null
    const atk = loose[3].match(/attack\s+([+-]\d+)/i)
    const typeWord = loose[1].match(/\b(Prepared|Spontaneous|Innate|Focus)\b/i)?.[1]
    const named = loose[1].match(/^(\w+)\s+(Prepared|Spontaneous|Innate|Focus)\s+Spells?$/i)
    const titled = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    return {
      name: loose[1].trim(), type: typeWord ? titled(typeWord) : '', tradition: named ? titled(named[1]) : '',
      DC: parseInt(loose[2], 10), attack: atk ? parseInt(atk[1], 10) : undefined, slots: [],
    }
  }
  const [, blockName, dcPart, atkPart, segPart] = m
  if (!explicit && !dcPart && !atkPart && !segPart) return null
  let focusPoints: number | undefined
  let typeOverride: string | undefined
  let traditionOverride: string | undefined
  const slots: SpellSlotEntry[] = []
  for (const seg of splitTop(segPart ?? '', ';').map(s => s.trim()).filter(Boolean)) {
    const fp = seg.match(/^(\d+)\s+Focus\s+Points?$/i)
    if (fp) { focusPoints = parseInt(fp[1], 10); continue }
    const ty = seg.match(/^type\b\s*(.*)$/i)
    if (ty) { typeOverride = ty[1].trim(); continue }
    const tr = seg.match(/^tradition\b\s*(.*)$/i)
    if (tr) { traditionOverride = tr[1].trim(); continue }
    const rank = rankSlot(seg)
    if (rank) { slots.push(rank); continue }
    // A segment this format does not write: after a DC or an attack it is ignored (the heading
    // regex before fix round 4 read the heading and nothing after it); without one, not a heading.
    if (!dcPart && !atkPart && !explicit) return null
  }
  const named = blockName.match(/^(\w+)\s+(Prepared|Spontaneous|Innate|Focus)\s+Spells?$/i)
  const typeWord = blockName.match(/\b(Prepared|Spontaneous|Innate|Focus)\b/i)?.[1]
  const titled = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  const type = typeOverride ?? (typeWord ? titled(typeWord) : focusPoints !== undefined ? 'Focus' : '')
  const tradition = traditionOverride ?? (named ? titled(named[1]) : '')
  return {
    name: blockName.trim(),
    type, tradition,
    DC: dcPart ? parseInt(dcPart.replace(/\D/g, ''), 10) : undefined,
    attack: atkPart ? parseInt(atkPart.match(/[+-]\d+/)![0], 10) : undefined,
    focusPoints,
    slots,
  }
}

/** How creatureToText writes a spell block's heading: the plain "<name> DC 28, attack +24; 2 Focus
 *  Points" when readSpellHeader reads it back as this very block, the explicit "Spellcasting <name>"
 *  form otherwise, each with "; type X" / "; tradition Y" when the name does not imply them. */
export function spellHeaderLine(sb: { name: string; type?: string; tradition?: string; DC?: number; attack?: number; focusPoints?: number }): string {
  const fmtN = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
  const base = `${sb.DC != null ? ` DC ${sb.DC}` : ''}${sb.attack != null ? `, attack ${fmtN(sb.attack)}` : ''}`
    + (sb.focusPoints != null ? `; ${sb.focusPoints} Focus Points` : '')
  const same = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
  for (const prefix of ['', 'Spellcasting ']) {
    let line = `${prefix}${sb.name}${base}`
    const derived = readSpellHeader(line) ?? readSpellHeader(`${line}; type ${sb.type ?? ''}`)
    if (!derived || derived.name !== sb.name.trim()) continue
    if (!same(derived.type, sb.type) || !readSpellHeader(line)) line += `; type ${sb.type ?? ''}`
    if (!same(derived.tradition, sb.tradition)) line += `; tradition ${sb.tradition ?? ''}`
    const back = readSpellHeader(line)
    if (back && back.name === sb.name.trim() && same(back.type, sb.type) && same(back.tradition, sb.tradition)
      && back.DC === sb.DC && back.attack === sb.attack && back.focusPoints === sb.focusPoints) return line
  }
  return `Spellcasting ${sb.name}${base}; type ${sb.type ?? ''}; tradition ${sb.tradition ?? ''}`
}

/**
 * The TextConverter's text format, read back. It is the AoN copy-paste format, plus what
 * creatureToText writes so that a stat block survives a text edit whole (D18):
 *   - "Traits a, b" (a trait list a plain traits line cannot carry), "Family x", "Archives page"
 *     (the record IS a page: its Recall Knowledge row prints only what the page prints);
 *   - "Recall Knowledge <the page's line>", verbatim;
 *   - "Languages a, b; telepathy 100 feet" — after ';' the language abilities;
 *   - "Perception +17 (note); sense; sense", "AC 23 (note); Fort +1, Ref +2, Will +3; save note";
 *   - "Hardness 22; HP 90 note; 15 (head); BT 44" — every HP pool, its note, hardness and BT;
 *   - a hazard prints AC and saves only as its text does ("Fort +10" alone is one save, no AC);
 *   - "---" separators: abilities before the first are the page's top section, between the two
 *     the mid section (after HP), after the second the bottom section (Ability.slot);
 *   - indented lines (two spaces or a tab) continue the line above: an ability's further text
 *     lines and its "Trigger", a hazard field's further lines, a strike's "Effects"; a "\" at the
 *     start of an indented line takes the rest literally. The indent every line after the first
 *     shares is stripped first (a block pasted indented throughout is no continuation);
 *   - "Fort +20, Ref +22 (+24 vs. traps), Will +18": a save's own bracket is kept in the save note;
 *   - "Damage 2d8+6 plus Grab; types piercing": a strike's types apart from its damage text
 *     ("; types none": no types), where the plain form would read back different;
 *   - hazards: "Stealth", "Description <text>", "Disable", "Routine", "Reset", "Complexity";
 *     a hazard strike line sits among the abilities where the page prints it (afterAbility).
 */
export function parseStatBlockText(text: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ── Pre-process: split, trim, drop blanks + skip markers ───────────────
  const fullLines = text.split('\n').map(l => l.replace(/\r$/, ''))
  // A block pasted with every line indented (a code block, a quoted mail, a PDF, a forum post) reads
  // as it does unindented: the indent every line after the first shares is no continuation, only a
  // line indented deeper than that is (round 4 read every such line as the ability above it). The
  // first line is left out of the measure: a selection that starts mid-line loses its indent.
  const indentOf = (l: string) => l.match(/^[ \t]*/)![0]
  const shared = fullLines.filter(l => l.trim()).slice(1).map(indentOf)
    .reduce<string | null>((acc, ind) => {
      if (acc === null) return ind
      let k = 0
      while (k < acc.length && k < ind.length && acc[k] === ind[k]) k++
      return acc.slice(0, k)
    }, null) ?? ''
  const rawLines = fullLines.map(l => (shared && l.startsWith(shared) ? l.slice(shared.length) : l))
  const lines: Line[] = []
  rawLines.forEach((rawLine, raw) => {
    const t = rawLine.trim()
    if (!t) return
    if (SKIP_LINES.some(re => re.test(t))) return
    const noIndent = rawLine.replace(/^\s+/, '')
    const escaped = noIndent.startsWith('\\')
    lines.push({
      text: t, raw,
      indented: /^(?:\t|\s{2,})/.test(rawLine),
      cont: escaped ? noIndent.slice(1) : noIndent.trimEnd(),
      escaped,
    })
  })

  if (lines.length < 2) {
    errors.push('Not enough content — need a name and at least a few stat lines.')
    return { creature: null, errors, warnings }
  }

  // ── Name + Creature/Level ─────────────────────────────────────────────
  // Format 1 (one line):  "Goblin CREATURE 1"
  // Format 2 (two lines): "Tarrasque" / "Creature 25"  (the AoN copy-paste format)
  let i = 0
  let name = ''
  let level = 0
  let isHazard = false

  const combinedM = lines[i].text.match(/^(.+?)\s+(?:CREATURE|HAZARD)\s+(-?\d+)\s*$/i)
  if (combinedM) {
    name = combinedM[1].trim()
    level = parseInt(combinedM[2])
    isHazard = /hazard/i.test(lines[i].text)
    i++
  } else if (i + 1 < lines.length) {
    const lvlM = lines[i + 1].text.match(/^(Creature|Hazard)\s+(-?\d+)\s*$/i)
    if (lvlM) {
      name = lines[i].text.trim()
      level = parseInt(lvlM[2])
      isHazard = /hazard/i.test(lvlM[1])
      i += 2
    }
  }
  if (!name) {
    errors.push(`Couldn't find the creature name and level. Expected "Name\\nCreature N" (AoN format) or "Name CREATURE N", got: "${lines[i].text}"${lines[i + 1] ? ` + "${lines[i + 1].text}"` : ''}`)
    return { creature: null, errors, warnings }
  }

  // ── State ──────────────────────────────────────────────────────────────
  let source = 'Homebrew'
  let recallKnowledge: string | undefined
  let fromArchivesPage = false
  let family: string | undefined
  let traits: string[] = []
  /** The traits line is read only in the header (before the first stat line or ability): an
   *  ability line of Title-case words ("Shield Block") was read as the traits of a record with none. */
  let inHeader = true
  let perception = 0
  let perceptionNote: string | undefined
  const senses: string[] = []
  const languages: string[] = []
  const languageAbilities: string[] = []
  const skills: Record<string, number> = {}
  let str = 0, dex = 0, con = 0, int = 0, wis = 0, cha = 0
  const items: string[] = []
  let speed: Creature['speed'] = isHazard ? {} : { walk: 25 }
  let speedNote: string | undefined
  // A hazard has no AC and no HP until its text prints them (an "AC 10" / "HP 10" default would
  // draw as numbers no page printed). A creature keeps the old seed defaults.
  let ac = isHazard ? 0 : 10, fort = 0, ref = 0, will = 0, hp = isHazard ? 0 : 10
  let acNote: string | undefined
  let saveNote: string | undefined
  let hardness: number | undefined
  let bt: number | undefined
  const pools: Array<{ hp: number; note: string }> = []
  // What a pasted HAZARD prints (decision D4): its AC box and save boxes draw only when its text
  // has them.
  let acPrinted = false
  const savesSeen = new Set<'fort' | 'ref' | 'will'>()
  const immunities: string[] = []
  const resistances: Defenses['resistances'] = []
  const weaknesses: Defenses['weaknesses'] = []
  const attacks: Attack[] = []
  const abilities: Ability[] = []
  let rituals: RitualBlock | undefined
  let flavor: string | undefined
  const spellBlocks: SpellBlock[] = []
  const hazardFields: Partial<Record<HazardKey, string>> = {}
  let complex: boolean | undefined
  let sawHazardField = false

  // "---" separators place the abilities in the page's sections (only when the text has them, so a
  // pasted block without separators keeps its abilities slot-less, drawn where they always were).
  const descAt = lines.findIndex(l => /^Description\s*$/i.test(l.text))
  const slotted = !isHazard && lines.slice(i, descAt < 0 ? undefined : descAt).some(l => /^---+$/.test(l.text))
  let section = 0

  let currentSpell: SpellState | null = null
  let cont: Cont | null = null

  const finalizeSpell = () => {
    if (!currentSpell) return
    const spellsByLevel = [...currentSpell.slots]
    spellsByLevel.sort((a, b) => {
      if (a.isCantrip && !b.isCantrip) return -1
      if (b.isCantrip && !a.isCantrip) return 1
      if (a.isConstant && !b.isConstant) return 1
      if (b.isConstant && !a.isConstant) return -1
      return a.level - b.level
    })
    spellBlocks.push({
      name: currentSpell.name,
      type: currentSpell.type,
      tradition: currentSpell.tradition,
      DC: currentSpell.DC,
      ...(currentSpell.attack !== undefined ? { attack: currentSpell.attack } : {}),
      ...(currentSpell.focusPoints !== undefined ? { focusPoints: currentSpell.focusPoints } : {}),
      spells: '',
      spellsByLevel,
    })
    currentSpell = null
  }

  const closeCont = () => {
    if (!cont) return
    if (cont.kind === 'ability') {
      cont.ab.entries = [...(cont.head ? [cont.head] : []), ...cont.lines].join('\n')
    } else if (cont.kind === 'hazard') {
      if (cont.lines.length) hazardFields[cont.key] = [hazardFields[cont.key] ?? '', ...cont.lines].join('\n')
    }
    cont = null
  }

  /** An indented line under an ability, a hazard field or a strike. False: not this context's. */
  const takeCont = (l: Line): boolean => {
    if (!cont) return false
    if (cont.kind === 'ability') {
      const tm = !l.escaped && cont.ab.trigger === undefined ? l.cont.match(/^Trigger\s+(.*)$/) : null
      if (tm) cont.ab.trigger = tm[1]
      else cont.lines.push(l.cont)
      return true
    }
    if (cont.kind === 'hazard') { cont.lines.push(l.cont); return true }
    const em = !l.escaped ? l.cont.match(/^Effects?\s+(.*)$/i) : null
    if (em) {
      cont.atk.effects = splitTop(em[1], ',').map(s => s.trim()).filter(Boolean)
      return true
    }
    // A strike line wrapped before its damage ("Melee … (agile, finesse),\n  Damage 1d6-1 slashing").
    const dm = !l.escaped && !cont.atk.damage && !cont.atk.types.length ? l.cont.match(/^Damage\s+(.+)$/i) : null
    if (dm) {
      const dam = readDamage(dm[1])
      cont.atk.damage = dam.damage
      cont.atk.types = dam.types
      return true
    }
    return false
  }

  /** "Hardness 22; HP 90 note; 15 (head); BT 44; Immunities …" — the depth-0 ';' segments. */
  const readDefenseLine = (line: string) => {
    for (const segRaw of splitTop(line, ';')) {
      let seg = segRaw.trim()
      if (!seg) continue
      // AoN joins hardness and HP with a comma: "Hardness 6, HP 24 (BT 12)".
      const hm = seg.match(/^Hardness\s+(\d+)\s*,?\s*(.*)$/i)
      if (hm) { hardness = parseInt(hm[1], 10); seg = hm[2].trim(); if (!seg) continue }
      const hpM = seg.match(/^HP\s+(\d+)\s*(.*)$/i)
      if (hpM) { pools.push({ hp: parseInt(hpM[1], 10), note: hpM[2].replace(/^[,\s]+/, '').trim() }); continue }
      const btM = seg.match(/^BT\s+(\d+)$/i)
      if (btM) { bt = parseInt(btM[1], 10); continue }
      if (/^Immunit(?:y|ies)\b/i.test(seg)) {
        immunities.push(...splitTop(seg.replace(/^Immunit(?:y|ies)\s*/i, ''), ',').map(s => s.trim()).filter(Boolean))
        continue
      }
      if (/^Resistances?\b/i.test(seg)) { resistances.push(...readIwr(seg.replace(/^Resistances?\s*/i, ''))); continue }
      if (/^Weakness(?:es)?\b/i.test(seg)) { weaknesses.push(...readIwr(seg.replace(/^Weakness(?:es)?\s*/i, ''))); continue }
      const poolM = seg.match(/^(\d+)\b\s*(.*)$/)
      if (poolM && pools.length) { pools.push({ hp: parseInt(poolM[1], 10), note: poolM[2].trim() }); continue }
      // Anything else belongs to the note before it ("regeneration 20; deactivated by fire").
      if (pools.length) {
        const last = pools[pools.length - 1]
        last.note = last.note ? `${last.note}; ${seg}` : seg
      }
    }
  }

  const readSaveRun = (s: string) => {
    const r = readSaves(s)
    if (r.saves.fort !== undefined) { fort = r.saves.fort; savesSeen.add('fort') }
    if (r.saves.ref !== undefined) { ref = r.saves.ref; savesSeen.add('ref') }
    if (r.saves.will !== undefined) { will = r.saves.will; savesSeen.add('will') }
    if (r.note) saveNote = r.note
  }
  const readAcRest = (rest: string) => {
    const at = topLevelIndex(rest, /\b(?:Fort|Fortitude|Ref|Reflex|Will)\s+[+-]\d+/i)
    const before = at < 0 ? rest : rest.slice(0, at)
    const note = before.replace(/^[\s;,]+|[\s;,]+$/g, '')
    if (note) acNote = note
    if (at >= 0) readSaveRun(rest.slice(at))
  }

  // ── Main pass ──────────────────────────────────────────────────────────
  while (i < lines.length) {
    const L = lines[i]
    const line = L.text

    // An indented line continues the ability / hazard field / strike above it.
    if (L.indented && cont && takeCont(L)) { i++; continue }
    closeCont()

    // "Description" on its own line marks the creature's lore blurb (emitted
    // last by creatureToText). Everything after it is flavor; it's the final
    // section, so capture the rest (blank lines kept) and stop.
    if (/^Description\s*$/i.test(line)) {
      finalizeSpell()
      const rest = rawLines.slice(L.raw + 1).join('\n').trim()
      if (rest) flavor = rest
      break
    }

    // Inside spellcasting block — collect rank lines first.
    if (currentSpell) {
      const slot = rankSlot(line)
      if (slot) { currentSpell.slots.push(slot); i++; continue }
      finalizeSpell()
      // re-process this line below
    }

    i++ // consume

    if (/^---+$/.test(line)) { section++; inHeader = false; continue }

    // ── Source ────────────────────────────────────────────────────────────
    if (/^Source\s+/i.test(line)) {
      source = line.replace(/^Source\s+/i, '').trim()
      continue
    }

    // ── Recall Knowledge — store verbatim if present, else we'll compute ───
    if (/^Recall\s+Knowledge\b/i.test(line)) {
      recallKnowledge = line.replace(/^Recall\s+Knowledge\s*/i, '').trim() || undefined
      continue
    }

    // ── The record is an Archives page (creatureToText writes it for one) ─
    if (/^Archives\s+page$/i.test(line)) { fromArchivesPage = true; continue }

    // ── Header: the traits line, a "Traits a, b" list, the family ─────────
    if (inHeader) {
      const tl = line.match(/^Traits\b\s*(.*)$/i)
      if (tl) {
        traits = splitTop(tl[1], ',').map(s => s.trim()).filter(Boolean)
        continue
      }
      const fm = line.match(/^Family\s+(.+)$/i)
      if (fm) { family = fm[1].trim(); continue }
      if (!traits.length && looksLikeTraitsLine(line)) {
        traits = line.split(/\s+/).map(normalizeTrait).filter(Boolean)
        continue
      }
    }
    inHeader = false

    // ── Hazard sections ───────────────────────────────────────────────────
    if (isHazard) {
      const hf = line.match(/^(Stealth|Description|Disable|Routine|Reset)\s+(.+)$/i)
      if (hf) {
        const key = hf[1].toLowerCase() as HazardKey
        hazardFields[key] = hf[2].startsWith('\\') ? hf[2].slice(1) : hf[2]
        sawHazardField = true
        cont = { kind: 'hazard', key, lines: [] }
        continue
      }
      const cx = line.match(/^Complexity\s+(Complex|Simple)\b/i)
      if (cx) { complex = /complex/i.test(cx[1]); sawHazardField = true; continue }
    }

    // ── Perception ────────────────────────────────────────────────────────
    if (/^Perception\s/i.test(line)) {
      const m = line.match(/Perception\s+([+-]?\d+)(.*)/i)
      if (m) {
        perception = parseInt(m[1])
        let rest = m[2].trim()
        const pn = leadingParen(rest)
        if (pn) { perceptionNote = pn.inner.trim() || undefined; rest = pn.rest }
        rest = rest.replace(/^[;,\s]+/, '')
        if (rest) senses.push(...splitTop(rest, ';').map(s => s.trim()).filter(Boolean))
      }
      continue
    }

    // ── Languages ("Common, Draconic; telepathy 100 feet") ────────────────
    if (/^Languages?\s/i.test(line)) {
      const rest = line.replace(/^Languages?\s+/i, '')
      const [langs, ...abil] = splitTop(rest, ';')
      languages.push(...splitTop(langs, ',').map(s => s.trim()).filter(Boolean))
      languageAbilities.push(...splitTop(abil.join(';'), ',').map(s => s.trim()).filter(Boolean))
      continue
    }

    // ── Skills ────────────────────────────────────────────────────────────
    if (/^Skills?\s/i.test(line)) {
      const rest = line.replace(/^Skills?\s+/i, '')
      for (const m of rest.matchAll(/([A-Za-z][\w ()'’-]*?)\s+([+-]\d+)/g)) {
        skills[m[1].trim()] = parseInt(m[2])
      }
      continue
    }

    // ── Ability modifiers ─────────────────────────────────────────────────
    if (/^Str\s+[+-]/i.test(line)) {
      str  = parseBonus(line.match(/Str\s+([+-]\d+)/i)?.[1] ?? '+0')
      dex  = parseBonus(line.match(/Dex\s+([+-]\d+)/i)?.[1] ?? '+0')
      con  = parseBonus(line.match(/Con\s+([+-]\d+)/i)?.[1] ?? '+0')
      int  = parseBonus(line.match(/Int\s+([+-]\d+)/i)?.[1] ?? '+0')
      wis  = parseBonus(line.match(/Wis\s+([+-]\d+)/i)?.[1] ?? '+0')
      cha  = parseBonus(line.match(/Cha\s+([+-]\d+)/i)?.[1] ?? '+0')
      continue
    }

    // ── Items ─────────────────────────────────────────────────────────────
    if (/^Items?\s/i.test(line)) {
      const rest = line.replace(/^Items?\s+/i, '')
      // Split on commas EXCEPT ones inside a parenthetical (e.g. a "(2,400 gp)"
      // price) so such an item isn't broken into two bogus entries.
      items.push(...splitTop(rest, ',').map(s => s.trim()).filter(Boolean))
      continue
    }

    // ── Speed ("40 feet, fly 40 feet; troop movement", "fly 20 feet", "—") ─
    if (/^Speed\s+(?:\d|(?:fly|swim|burrow|climb)\s+\d|—|none\b)/i.test(line)) {
      const [sp, ...note] = splitTop(line.replace(/^Speed\s+/i, ''), ';')
      speed = {}
      const walkM = sp.match(/^\s*(\d+)/)
      if (walkM) speed.walk = parseInt(walkM[1])
      const flyM   = sp.match(/fly\s+(\d+)/i);    if (flyM)  speed.fly    = parseInt(flyM[1])
      const swimM  = sp.match(/swim\s+(\d+)/i);   if (swimM) speed.swim   = parseInt(swimM[1])
      const burM   = sp.match(/burrow\s+(\d+)/i); if (burM)  speed.burrow = parseInt(burM[1])
      const clmM   = sp.match(/climb\s+(\d+)/i);  if (clmM)  speed.climb  = parseInt(clmM[1])
      const n = note.join(';').trim()
      if (n) speedNote = n
      continue
    }

    // ── AC + saves ("AC 23 (19 when broken); Fort +11, Ref +13, Will +7; +1 status vs. magic") ─
    if (/^AC\s+\d+/i.test(line)) {
      const m = line.match(/^AC\s+(\d+)(.*)$/i)!
      ac = parseInt(m[1], 10)
      acPrinted = true
      readAcRest(m[2])
      continue
    }
    // A save line without an AC (a hazard that prints saves but no AC).
    if (/^(?:Fort|Fortitude|Ref|Reflex|Will)\s+[+-]\d+/i.test(line)) {
      readSaveRun(line)
      continue
    }

    // ── Hardness / HP / BT + immunities / resistances / weaknesses on one line ─
    if (/^(?:HP|Hardness|BT)\s+\d+/i.test(line)) {
      readDefenseLine(line)
      continue
    }

    // ── Separate Immunities / Resistances / Weaknesses lines ─────────────
    if (/^Immunit(?:y|ies)\s/i.test(line)) {
      immunities.push(...splitTop(line.replace(/^Immunit(?:y|ies)\s+/i, ''), ',').map(s => s.trim()).filter(Boolean))
      continue
    }
    if (/^Resistances?\s/i.test(line)) {
      resistances.push(...readIwr(line.replace(/^Resistances?\s+/i, '')))
      continue
    }
    if (/^Weakness(?:es)?\s/i.test(line)) {
      weaknesses.push(...readIwr(line.replace(/^Weakness(?:es)?\s+/i, '')))
      continue
    }

    // ── Melee / Ranged attacks ────────────────────────────────────────────
    // "Melee [one-action] jaws +45 [+40/+35] (reach 20 feet), Damage 4d12+19 piercing"; the cost
    // bracket is optional (a strike without one has no cost).
    // Without a cost bracket the name is at most four words, or a Damage clause follows: an ability
    // such as "Melee Mastery The creature gains +2 …" stays an ability.
    const strikeM = line.match(/^(Melee|Ranged)\s+(.*)$/i)
    const isStrike = !!strikeM && (
      /^(?:\[[^\]]*\]\s*)+[^+[(]*?\s[+-]\d+/.test(strikeM[2])
      || /^[^\s+[(]+(?:\s[^\s+[(]+){0,3}\s[+-]\d+(?=[\s,([]|$)/.test(strikeM[2])
      || /^[^+[(]*?\s[+-]\d+.*,\s*Damage\s/i.test(strikeM[2]))
    if (strikeM && isStrike) {
      const range = /^Melee/i.test(strikeM[1]) ? 'Melee' : 'Ranged' as 'Melee' | 'Ranged'
      const cost = leadingCost(strikeM[2])
      // Any other bracket before the name (an unknown cost word) is dropped as before.
      let afterAct = cost.rest.replace(/^(?:\[[^\]]*\]\s*)*/, '')
      // Name + bonus: "jaws +45" (stops at the first MAP bracket like [+40/+35])
      const nameAtkM = afterAct.match(/^([^+([]+?)\s+([+-]\d+)/)
      const atkName  = nameAtkM ? nameAtkM[1].trim() : 'attack'
      const atkBonus = nameAtkM ? parseInt(nameAtkM[2]) : 0
      if (nameAtkM) afterAct = afterAct.slice(nameAtkM[0].length).trim()
      afterAct = afterAct.replace(/^\[[^\]]*\]\s*/, '')       // a MAP bracket "[+40/+35]"
      let atkTraits: string[] = []
      const tp = leadingParen(afterAct)
      if (tp) { atkTraits = splitTop(tp.inner, ',').map(s => s.trim()).filter(Boolean); afterAct = tp.rest }
      const damM     = afterAct.match(/^[,;\s]*Damage\s+(.+)$/i)
      const dam      = readDamage(damM ? damM[1] : '')
      const atk: Attack = {
        range, name: atkName, attack: atkBonus, traits: atkTraits,
        damage: dam.damage, types: dam.types, effects: [],
        isAgile: atkTraits.some(t => t.toLowerCase() === 'agile'),
        ...(cost.activity ? { activity: cost.activity } : {}),
        // A hazard's strike is drawn where its text prints it among the abilities.
        ...(isHazard ? { afterAbility: abilities.length } : {}),
      }
      attacks.push(atk)
      cont = { kind: 'strike', atk }
      continue
    }

    // ── Rituals ───────────────────────────────────────────────────────────
    // e.g. "Rituals DC 28; 2nd consecrate, heartbond; 4th atone, rest eternal"
    if (/^Rituals?\b/i.test(line)) {
      const dcM = line.match(/DC\s+(\d+)/i)
      const dc = dcM ? parseInt(dcM[1], 10) : undefined
      const body = line.replace(/^Rituals?\b\s*/i, '').replace(/^DC\s+\d+\s*;?\s*/i, '')
      const casts: RitualBlock['casts'] = []
      for (const grp of body.split(';')) {
        const g = grp.trim()
        if (!g) continue
        const rm = g.match(/^(\d+(?:st|nd|rd|th))\s+(.*)/i)
        const rank = rm ? rm[1] : ''
        const level = rm ? parseInt(rm[1], 10) : 0
        const names = (rm ? rm[2] : g).split(',').map(s => s.replace(/[_*]/g, '').trim()).filter(Boolean)
        if (names.length) casts.push({ rank, level, names })
      }
      if (casts.length || dc != null) rituals = { dc, casts }
      continue
    }

    // ── Spellcasting header ───────────────────────────────────────────────
    // "Divine Innate Spells DC 28, attack +24", "Champion Devotion Spells DC 29; 2 Focus Points",
    // optionally "; type Focus" / "; tradition divine" when the name does not say them.
    if (!line.startsWith('**')) {
      const head = readSpellHeader(line)
      if (head) {
        finalizeSpell()
        currentSpell = head
        continue
      }
    }

    // ── Abilities (everything else) ───────────────────────────────────────
    if (line.length > 2) {
      const ab = parseAbilityHead(line, name)
      if (slotted) ab.slot = section === 0 ? 'top' : section === 1 ? 'mid' : 'bot'
      abilities.push(ab)
      cont = { kind: 'ability', ab, head: ab.entries, lines: [] }
    }
  }

  closeCont()
  finalizeSpell()

  if (pools.length) hp = pools[0].hp
  const hpNote = pools[0]?.note || undefined
  // One unnamed pool is the plain HP: a page creature (the adapter writes hpPools for every HP line)
  // keeps it, a hand-built or pasted creature gains none (round 4 gave every builder record a pool on
  // its first text edit). A hazard keeps it always: the adapter marks no hazard as a page record, so
  // the text cannot tell a served hazard from a built one (one unnamed pool draws as the plain HP).
  const hpPools = pools.length > 1 || pools.some(p => stripOuter(p.note)) || fromArchivesPage || isHazard
    ? pools.map(p => {
      const n = stripOuter(p.note)
      return { hp: p.hp, ...(n ? { name: n } : {}) }
    })
    : []
  const savesPrinted = (['fort', 'ref', 'will'] as const).filter(k => savesSeen.has(k))

  const defenses: Defenses = {
    ac, fort, ref, will, hp,
    ...(hpNote ? { hpNote } : {}),
    ...(hpPools.length ? { hpPools } : {}),
    ...(saveNote ? { saveNote } : {}),
    ...(acNote ? { acNote } : {}),
    ...(isHazard ? { acPrinted, savesPrinted } : {}),
    ...(hardness !== undefined ? { hardness } : {}),
    ...(bt !== undefined ? { bt } : {}),
    immunities, resistances, weaknesses,
  }

  const hazardData: HazardExtra | undefined = isHazard && sawHazardField ? {
    ...(hazardFields.stealth !== undefined ? { stealth: hazardFields.stealth } : {}),
    description: hazardFields.description ?? '',
    disable: hazardFields.disable ?? '',
    routine: hazardFields.routine ?? '',
    reset: hazardFields.reset ?? '',
    complex: complex ?? false,
  } : undefined

  const creature: Creature = {
    id: uid(),
    name,
    source,
    level,
    traits,
    perception,
    senses,
    ...(perceptionNote ? { perceptionNote } : {}),
    languages,
    ...(languageAbilities.length ? { languageAbilities } : {}),
    skills,
    str, dex, con, int, wis, cha,
    items,
    speed,
    ...(speedNote ? { speedNote } : {}),
    attacks,
    spellcasting: spellBlocks,
    rituals,
    abilities,
    defenses,
    isHazard,
    ...(hazardData ? { hazardData } : {}),
    recallKnowledge,
    flavor,
    ...(family ? { family } : {}),
    ...(fromArchivesPage ? { fromArchivesPage: true } : {}),
    raw: {} as Creature['raw'],
  }

  return { creature, errors, warnings }
}
