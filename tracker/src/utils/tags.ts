// Pf2eTools inline tag format:
//   {@tagType ref}
//   {@tagType ref|source}           ← source is NOT display, display = ref
//   {@tagType ref||display}         ← empty source, explicit display
//   {@tagType ref|source|display}   ← explicit display wins

const INTERACTIVE = new Set(['condition', 'trait', 'spell', 'ritual', 'action', 'skill', 'feat', 'creature', 'item', 'equipment', 'rule'])

function resolveTag(tagType: string, inner: string): { display: string; keep: boolean } {
  const parts = inner.split('|')
  const ref = parts[0].trim()
  // display = parts[2] if 3 parts and non-empty, else ref
  const display = (parts.length >= 3 && parts[2].trim()) ? parts[2].trim() : ref.replace(/-/g, ' ')
  return { display, keep: INTERACTIVE.has(tagType.toLowerCase()) }
}

// ── HTML entity decoding ──────────────────────────────────────────────────────
const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', emsp: ' ', ensp: ' ', thinsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…',
  times: '×', divide: '÷', deg: '°', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾',
  copy: '©', reg: '®', trade: '™',
}
/** Decode the HTML entities that leak into AoN text (&amp;, &lt;, &rsquo;, …)
 *  plus numeric &#NN; / &#xNN; so they don't render as a literal "&amp;". */
export function decodeEntities(text: string): string {
  if (!text || text.indexOf('&') < 0) return text
  return text
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(parseInt(n, 10)) } catch { return m } })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return m } })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => HTML_ENTITIES[name] ?? HTML_ENTITIES[String(name).toLowerCase()] ?? m)
}

// ── Full strip — removes all {@...} tags, replaces with display text ──────────
export function stripTags(text: string): string {
  return decodeEntities(text)
    .replace(/\{@(?:dice|damage)\s+([^|}]+)(?:\|[^}]*)?\}/gi, '$1')
    .replace(/\{@(?:as|a)\s*(\d)\}/gi, (_, n) => ['◆','◆◆','◆◆◆','◇','↺'][parseInt(n)-1] || '')
    .replace(/\{@(?:flat)?dc\s+([^|}]+)(?:\|[^}]*)?\}/gi, 'DC $1')
    // quickref: {@quickref display|source|...} — show only the display word
    .replace(/\{@quickref\s+([^|}\s][^|}]*?)(?:\|[^}]*)?\}/gi, '$1')
    // note: {@note content} — show the note content (inner text after quickrefs resolved)
    .replace(/\{@note\s+([^}]+)\}/gi, '$1')
    .replace(/\{@(\w+)\s+([^}]+)\}/gi, (_, t, inner) => resolveTag(t, inner).display)
    .replace(/\{[^}]*\}/g, '')
    .trim()
}

// ── Partial strip — keeps interactive tags intact for TagRenderer ─────────────
// Use for ability entry text that will be rendered via <TagRenderer>
export function stripTagsPartial(text: string): string {
  return decodeEntities(text)
    .replace(/\{@(?:dice|damage)\s+([^|}]+)(?:\|[^}]*)?\}/gi, '$1')
    .replace(/\{@(?:as|a)\s*(\d)\}/gi, (_, n) => ['◆','◆◆','◆◆◆','◇','↺'][parseInt(n)-1] || '')
    .replace(/\{@(?:flat)?dc\s+([^|}]+)(?:\|[^}]*)?\}/gi, 'DC $1')
    .replace(/\{@(\w+)\s+([^}]+)\}/g, (match, t, inner) => {
      const { display, keep } = resolveTag(t, inner)
      return keep ? match : display  // preserve interactive tags; strip others
    })
    .replace(/\{[^}]*\}/g, '')
    .trim()
}

// ── Convert entry arrays to plain text (full strip) ───────────────────────────
export function entriesToText(entries: (string | object)[]): string {
  if (!entries?.length) return ''
  return entries.map(e => entryToText(e)).filter(Boolean).join('\n')
}

export function entryToText(entry: string | object): string {
  if (typeof entry === 'string') return stripTags(entry)
  const obj = entry as Record<string, unknown>
  if (obj.type === 'successDegree') {
    const sd = obj.entries as Record<string, string>
    const parts: string[] = []
    if (sd?.['Critical Success']) parts.push(`Critical Success: ${stripTags(sd['Critical Success'])}`)
    if (sd?.['Success'])          parts.push(`Success: ${stripTags(sd['Success'])}`)
    if (sd?.['Failure'])          parts.push(`Failure: ${stripTags(sd['Failure'])}`)
    if (sd?.['Critical Failure']) parts.push(`Critical Failure: ${stripTags(sd['Critical Failure'])}`)
    return parts.join('\n')
  }
  if (obj.type === 'list' && Array.isArray(obj.items)) {
    return (obj.items as (string|object)[]).map(i => `• ${entryToText(i)}`).join('\n')
  }
  if (obj.type === 'item' && obj.name) {
    return `${obj.name}: ${entriesToText((obj.entries as (string|object)[]) || [])}`
  }
  if (obj.entries) return entriesToText(obj.entries as (string|object)[])
  return ''
}

// ── Convert entry arrays, keeping interactive tags for TagRenderer ─────────────
export function entriesToTagText(entries: (string | object)[]): string {
  if (!entries?.length) return ''
  return entries.map(e => entryToTagText(e)).filter(Boolean).join('\n')
}

function entryToTagText(entry: string | object): string {
  if (typeof entry === 'string') return stripTagsPartial(entry)
  const obj = entry as Record<string, unknown>
  if (obj.type === 'successDegree') {
    const sd = obj.entries as Record<string, string>
    const parts: string[] = []
    if (sd?.['Critical Success']) parts.push(`Critical Success: ${stripTagsPartial(sd['Critical Success'])}`)
    if (sd?.['Success'])          parts.push(`Success: ${stripTagsPartial(sd['Success'])}`)
    if (sd?.['Failure'])          parts.push(`Failure: ${stripTagsPartial(sd['Failure'])}`)
    if (sd?.['Critical Failure']) parts.push(`Critical Failure: ${stripTagsPartial(sd['Critical Failure'])}`)
    return parts.join('\n')
  }
  if (obj.type === 'list' && Array.isArray(obj.items)) {
    return (obj.items as (string|object)[]).map(i => `• ${entryToTagText(i)}`).join('\n')
  }
  if (obj.type === 'item' && obj.name) {
    return `${obj.name}: ${entriesToTagText((obj.entries as (string|object)[]) || [])}`
  }
  if (obj.entries) return entriesToTagText(obj.entries as (string|object)[])
  return ''
}

// ── Segment parser — for TagRenderer ──────────────────────────────────────────
export interface Segment {
  text: string
  tagType?: string
  ref?: string
}

/**
 * Rejoin success-degree labels that AoN data splits across a line break.
 * Several spells / actions store "Critical\nSuccess …" or "Critical\nFailure …"
 * with the word "Critical" stranded on its own line, which breaks the
 * degree-label detection (it sees a bare "Critical" then a "Success"/"Failure"
 * line missing its "Critical " prefix). Collapse them back to one label.
 */
export function joinCriticalDegrees(text: string): string {
  if (!text) return text
  return text.replace(/\bCritical[ \t\r]*\n[ \t\r]*(Success|Failure)\b/g, 'Critical $1')
}

export function parseSegments(raw: string): Segment[] {
  // Strip leftover AoN markup tokens (<%TRAITS%163%%>, <%END>, dangling
  // <%WORD…) that occasionally leak into body text, then tidy the whitespace
  // the removal leaves behind. Safety net for combatants saved before the
  // data was cleaned by scripts/clean-aon-tokens.mjs.
  if (raw.includes('<%')) {
    raw = raw
      .replace(/<%[^>]*>/g, '')
      .replace(/<%[A-Z][^\s>]*\s?/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.;:)])/g, '$1')
  }
  // Decode HTML entities, and resolve action-symbol / DC tags to their display
  // form before tokenizing — this also flattens the nested {@b {@as 1} …}
  // spell-component form into plain text the generic loop can handle.
  raw = decodeEntities(raw)
    .replace(/\{@(?:as|a)\s*(\d)\}/gi, (_m, n) => ['◆', '◆◆', '◆◆◆', '◇', '↺'][parseInt(n, 10) - 1] || '')
    .replace(/\{@(?:flat)?dc\s+([^|}]+)(?:\|[^}]*)?\}/gi, 'DC $1')
  const segments: Segment[] = []
  const re = /\{@(\w+)\s+([^}]+)\}/g
  let last = 0, m: RegExpExecArray | null

  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) segments.push({ text: raw.slice(last, m.index) })

    const tagType = m[1].toLowerCase()
    const parts = m[2].split('|')
    const ref = parts[0].trim()
    const display = (parts.length >= 3 && parts[2].trim()) ? parts[2].trim() : ref.replace(/-/g, ' ')

    segments.push({
      text: display,
      tagType: INTERACTIVE.has(tagType) ? tagType : undefined,
      ref,
    })
    last = m.index + m[0].length
  }

  if (last < raw.length) segments.push({ text: raw.slice(last) })
  return segments
}

// Common English words that LOOK like actions/skills but mostly aren't.
// Filter these from auto-linking to keep false positives down.
const AUTOLINK_STOPWORDS = new Set([
  'a','an','and','as','at','be','but','by','for','from','if','in','into','is',
  'it','no','not','of','on','one','or','so','that','the','this','to','up','we',
  'when','will','with','you','your','him','her','his','their','they','them',
  // Sentence-start words that are properly capitalized by grammar, not because
  // they're a PF2e term:
  'each','any','all','some','other','also','during','though','these','those',
  'when','where','what','how','why','before','after','until','while','use',
  'using','make','makes','made','take','takes','taken','can','cannot',
  // Days / common proper nouns
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
])

export type AutoLinkType = 'action' | 'skill' | 'condition' | 'trait' | 'glossary' | 'creature' | 'spell' | 'equipment'

export interface AutoLinkDict {
  conditions: Set<string>
  actions:    Set<string>
  skills:     Set<string>
  traits:     Set<string>
  /** Glossary terms (damage categories, senses, materials, …). Linked
   *  case-insensitively in prose. Optional so older callers still compile. */
  glossary?:  Set<string>
  /** Curated damage/energy-type traits (fire, cold, acid, …) worth linking in
   *  prose. Linked case-insensitively → trait popup. The full `traits` set is
   *  intentionally NOT auto-linked (every "Magical"/"Good" would match). */
  damageTraits?: Set<string>
  /** Exact bestiary creature names → link a bare mention to its stat block.
   *  Multi-word names link case-insensitively; single-word names need a capital
   *  + 4 letters so common words ("guard", "giant") don't over-link. A Map is
   *  accepted directly (it already has `.has`) to skip rebuilding a big Set. */
  creatures?: { has(key: string): boolean }
  /** The exact terms Archives of Nethys links on THIS creature's page → type.
   *  Authoritative: matched first, case-insensitively, with no capitalization
   *  guard (AoN already vetted these), so prose links exactly what AoN links.
   *  Values are AutoLinkType strings (validated when the data is generated). */
  aonLinks?: Record<string, string>
}

/**
 * Scan plain text for capitalized words / 2-word phrases that exactly match
 * a known PF2e term and return rich segments that turn each match into a
 * link. Used when the source data has plain text like "Disarm with the
 * Athletics skill" — neither term is `{@action …}`-wrapped, but we still
 * want hover/click affordances. False-positive avoidance:
 *
 *   • only match capitalized words (so verbs like "step" lowercase stay text)
 *   • require an exact case-insensitive key match
 *   • skip common English stopwords (the, when, can, …) which would otherwise
 *     match a few PF2e action names ("Stride" vs "Strode" — only the first)
 */
export function autoLinkPlainText(text: string, dict: AutoLinkDict): Segment[] {
  if (!text) return []
  const out: Segment[] = []
  // Run of 1–3 words. Both lowercase and uppercase starts are allowed so we
  // can catch unwrapped condition references in spell descriptions (e.g.
  // "the target becomes frightened 2"). Action / Skill matches still require
  // the first letter to be uppercase to limit false positives — only the
  // condition pass accepts lowercase below.
  const re = /\b([a-zA-Z][a-zA-Z']{2,}(?:\s+[a-zA-Z][a-zA-Z']{2,}){0,2})\b/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const phrase = m[1]
    const startIdx = m.index
    const words = phrase.split(/\s+/)
    const isCapitalized = /^[A-Z]/.test(words[0])
    // Try longest match first (3 words → 2 → 1) so "Recall Knowledge" wins
    // over just "Recall". Stop at the first match found.
    let matched: { len: number; words: string; key: string; type: AutoLinkType } | null = null
    for (let n = Math.min(3, words.length); n >= 1 && !matched; n--) {
      const candidate = words.slice(0, n).join(' ')
      const key = candidate.toLowerCase()
      // AoN's own links win first — exact terms it hyperlinks on this creature,
      // any case, any word (no stopword/capital guard): spells, items, creatures,
      // conditions, etc. exactly as Archives of Nethys marks them.
      const aonType = dict.aonLinks?.[key] as AutoLinkType | undefined
      if (aonType) { matched = { len: n, words: candidate, key, type: aonType }; continue }
      // Stopword filter only applies to single-word matches — multi-word
      // phrases like "Recall Knowledge" are safe.
      if (n === 1 && AUTOLINK_STOPWORDS.has(key)) continue
      // Conditions: link case-insensitively so "frightened 2" / "becomes
      // sickened" both pick up the hover link.
      if (dict.conditions.has(key)) matched = { len: n, words: candidate, key, type: 'condition' }
      // Glossary (damage categories, senses, materials): case-insensitive, no
      // uppercase guard — "physical damage", "darkvision", "cold iron" all
      // appear lowercase in prose. The caller pre-filters out the noisy generic
      // keys (sizes, "all"/"area") before passing the set.
      else if (dict.glossary?.has(key)) matched = { len: n, words: candidate, key, type: 'glossary' }
      // Damage/energy-type traits (fire, cold, acid, …): case-insensitive →
      // trait popup. A curated subset, NOT the full trait list.
      else if (dict.damageTraits?.has(key)) matched = { len: n, words: candidate, key, type: 'trait' }
      // Actions / Skills: keep the uppercase guard — verbs like "step" or
      // "step into" would auto-link "step" otherwise.
      else if (isCapitalized && dict.actions.has(key)) matched = { len: n, words: candidate, key, type: 'action' }
      else if (isCapitalized && dict.skills.has(key))  matched = { len: n, words: candidate, key, type: 'skill' }
      // Creatures: only EXACT bestiary names match. Multi-word names are
      // distinctive enough to link regardless of case; single words must be
      // capitalized and 4+ letters so a stray "Giant"/"Guard" doesn't link.
      else if (dict.creatures?.has(key) && (n >= 2 || (isCapitalized && candidate.length >= 4)))
        matched = { len: n, words: candidate, key, type: 'creature' }
      // The full traits set is intentionally not auto-linked — it'd match too
      // aggressively (every "Magical", "Lawful", "Good" in flavor text).
    }
    if (!matched) {
      // No term began at this run's first word. Advance past just that one word
      // (not the whole greedy 1–3 word run) so a linkable term LATER in the run
      // still gets a chance to lead its own run — otherwise a leading common
      // word swallows what follows: "and slashing", "can See the Unseen",
      // "use Detect Magic", "takes fire damage" would all miss the link.
      re.lastIndex = startIdx + words[0].length
      continue
    }
    if (startIdx > last) out.push({ text: text.slice(last, startIdx) })
    out.push({ text: matched.words, tagType: matched.type, ref: matched.key })
    last = startIdx + matched.words.length
    // Re-position the regex past the matched portion so we don't double-match
    // the unconsumed tail of a 3-word candidate.
    re.lastIndex = last
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

// ── Misc helpers ───────────────────────────────────────────────────────────────
export function activitySymbol(act?: { number: number; unit: string }): string {
  if (!act) return ''
  const { number, unit } = act
  if (unit === 'reaction') return ' ↺'
  if (unit === 'free') return ' ◇'
  if (unit === 'action') return ' ' + '◆'.repeat(Math.min(number, 3))
  return ''
}

export function formatSpeed(speed: Record<string, number | undefined>): string {
  const parts: string[] = []
  if (speed.walk)    parts.push(`${speed.walk} feet`)
  if (speed.fly)     parts.push(`fly ${speed.fly} feet`)
  if (speed.swim)    parts.push(`swim ${speed.swim} feet`)
  if (speed.burrow)  parts.push(`burrow ${speed.burrow} feet`)
  if (speed.climb)   parts.push(`climb ${speed.climb} feet`)
  return parts.join(', ') || '—'
}

export function fmtSave(val: number | undefined): string {
  if (val === undefined) return '—'
  return val >= 0 ? `+${val}` : `${val}`
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
export function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`
}

// ── Weapon trait helpers — data stores traits like "reach <10 feet>" ──────────
// Strip <value> for display: "reach <10 feet>" → "reach 10 feet"
export function traitDisplay(raw: string): string {
  return raw.replace(/<([^>]+)>/g, '$1').replace(/\s+/g, ' ').trim()
}
// Get base trait name for tooltip lookup: "reach <10 feet>" → "reach"
export function traitBaseName(raw: string): string {
  return raw.replace(/\s*<[^>]+>/g, '').trim()
}
