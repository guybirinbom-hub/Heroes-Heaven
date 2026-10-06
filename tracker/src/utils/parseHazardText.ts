/**
 * Hazard description parser.
 *
 * The AoN scrape dumps the entire hazard stat block — flavor + stealth +
 * disable + defenses + ability blocks + reset — into a single string at
 * `raw.description[0]`. The structured `disable` / `routine` / `reset`
 * fields are empty. This parser walks that blob using PF2e's well-known
 * section keywords and re-extracts each piece so the renderer can show a
 * proper hazard layout.
 *
 * The parser is intentionally tolerant — AoN spacing varies, some hazards
 * skip sections entirely (e.g. no Reset, no Routine), and ability blocks
 * have several stylistic variants. We use lookahead-driven boundary
 * detection rather than a strict grammar.
 */

import type { Attack, Ability } from '../types/pf2e'

export interface ParsedHazardText {
  flavor:   string
  stealth:  string
  disable:  string
  /** Hazard-wide "(BT N)" pulled from the HP line. */
  bt:       number | undefined
  /** "Complexity Complex" detected in the AoN prose — overrides
   *  `raw.complex` when the scraper didn't capture the flag. */
  complex:  boolean | undefined
  abilities: Ability[]
  attacks:  Attack[]
  routine:  string
  reset:    string
}

// Shared boundary pattern for prose sections. Used as a lookahead so we know
// where a Stealth / Disable run ends — anything that could start a defense
// block, an ability heading, Routine, Reset, or the end of string.
const SECTION_TERMINATOR = '(?:AC\\s+\\d|Hardness\\b|HP\\s+\\d|Immunities\\b|Resistances\\b|Weaknesses\\b|Routine\\b|---|Reset\\b|[A-Z][\\w\' -]{1,40}\\s+(?:Reaction|Two Actions|Three Actions|Free Action|Action|Activate)\\b|$)'

// Keyword regexes used both for skipping defenses and finding ability/attack
// boundaries.
//
// The activity keyword carries its own `\b` so we don't false-match "Action"
// inside a longer word (e.g. "Actionable"). The trailing optional trait
// paren `(...)` ends with `)` — a non-word char — so we DO NOT put a `\b`
// after it: in JS regex `\b` between two non-word chars (`)` then space)
// fails, which would force the engine to skip the paren capture and leave
// the trait list in the ability body. Bounded instead by a positive
// lookahead for whitespace / punctuation / end of string.
//
// "Single Action" is listed before the bare "Action": without it the lazy name
// swallowed "Single" ("Spikes Single ◆", "Constrict Single ◆") and a strike line
// "Melee Single Action jaws +17" became an ability named "Melee Single ◆".
const ABILITY_HEAD_RE = /\b([A-Z][\w' -]{1,40}?)\s+(?:\(([^)]+)\)\s+)?(Reaction|Single Action|Two Actions|Three Actions|Free Action|Action|Activate)\b(?:\s+\(([^)]+)\))?(?=\s|$|;|,)/g
const SECTION_HEAD_RE = /\b(Routine|---\s+Reset|Reset)\b/

// ── Strikes ──────────────────────────────────────────────────────────────────
// A hazard strike as the Archives print it, every variant seen in the 663
// corpus hazards: "Melee spine +13, Damage 1 piercing", "Melee spikes +17;
// Damage …" (semicolon), "Melee Single Action jaws +17, Effect devour" (action
// cost, Effect instead of Damage), "Ranged (agile, thrown 10 feet) dagger +40,
// Damage …" (traits before the name), "Melee Melee ghostly arms +12" (doubled
// label), "Melee grapple +15 Damage grapple" (no separator), "[one-action]".
// Case-SENSITIVE on purpose: the old /i regex read prose such as "ranged
// attack against each creature … Ranged spike +14" as one strike.
const STRIKE_ACTIVITY = '(?:Single Action|One Action|Two Actions|Three Actions|Free Action|Reaction|\\[(?:one|two|three|free)-actions?\\]|\\[reaction\\]|[◆◇↺]+)'
const STRIKE_HEAD_RE = new RegExp(
  "(?<![\\w'’])(Melee|Ranged)[ \\t]+(?:(?:Melee|Ranged)[ \\t]+)?"
  + `(?:(${STRIKE_ACTIVITY})[ \\t]+)?`
  // The doubled label can also sit AFTER the cost: "**Melee** <actions …/>**Melee** ghostly arms
  // +12" flattens to "Melee Single Action Melee ghostly arms +12" (Arms of the Drowned).
  + '(?:(?:Melee|Ranged)[ \\t]+)?'
  + '(?:\\(([^()\\n]*)\\)[ \\t]+)?'
  + '([^,;+()\\n.]{1,60}?)[ \\t]+([+-]\\d+)\\b'
  + '(?:[ \\t]*\\(([^()\\n]*)\\))?',
  'g',
)
const STRIKE_LABEL_RE = /^[ \t]*[,;]?[ \t]*(Damage|Effect)\b[ \t]*/
// Where a strike's Damage/Effect text stops when the page's line break was
// flattened to a space: the next ability, i.e. a Title Case run NOT introduced
// by "plus"/"and"/… (riders such as "plus Improved Grab" stay in the damage)
// and followed by an action cost, a lower-case trait list, or the start of a
// sentence ("Decapitation On a critical hit", "Cladis Poison (poison)",
// "Constrict Single Action", "Devour The target …").
const NEXT_ABILITY_ACT = 'Single Action|One Action|Two Actions|Three Actions|Free Action|Reaction|Action|Activate'
const NEXT_ABILITY_STARTERS = 'A|An|The|On|When|Whenever|If|Each|Any|This|While|Until|Trigger|Effect|Requirements|Frequency|Saving Throw'
const NEXT_ABILITY_RE = new RegExp(
  "\\s(?<!\\b(?:plus|and|or|with|DC|of|by|the)\\s)[A-Z][\\w'’-]*(?:\\s+(?:of|the|and|[A-Z][\\w'’-]*)){0,4}?\\s+"
  + `(?=(?:${NEXT_ABILITY_ACT})\\b|\\([a-z]|(?:${NEXT_ABILITY_STARTERS})\\s)`,
)

function cleanWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Pull defense-block bits out of a working string. Each match is `replace`d
 * with a single space so the remainder can be parsed for abilities. Returns
 * the stripped string plus any extracted scalars (currently just BT).
 */
function stripDefenseBlock(s: string): { text: string; bt: number | undefined } {
  let text = s
  let bt: number | undefined

  // AC + saves: "AC 18, Fort +11, Ref +3, Will +5"
  text = text.replace(/\bAC\s+\d+(?:\s*,\s*(?:Fort|Ref|Will)\s+[+-]\d+)*\s*/g, ' ')
  // Hardness — optionally prefixed by a part name like "Trapdoor Hardness 3"
  text = text.replace(/(?:\b[A-Z][\w ]*?\s+)?Hardness\s+\d+\s*/g, ' ')
  // HP with optional "(BT N)"
  const hpM = text.match(/(?:\b[A-Z][\w ]*?\s+)?HP\s+\d+\s*\(BT\s+(\d+)\)/)
  if (hpM) bt = parseInt(hpM[1], 10)
  text = text.replace(/(?:\b[A-Z][\w ]*?\s+)?HP\s+\d+\s*(?:\(BT\s+\d+\))?\s*/g, ' ')
  // Immunities / Resistances / Weaknesses — already on raw.defenses, just
  // strip from the prose so abilities surface cleanly.
  text = text.replace(/\bImmunities\s+[^.]+?(?=\s+(?:Resistances\s|Weaknesses\s|Routine\s|---\s|Reset\s|Ranged\s|Melee\s|[A-Z][\w' -]{1,40}\s+(?:Reaction|Two Actions|Three Actions|Free Action|Action|Activate)\b|$))/g, ' ')
  text = text.replace(/\bResistances\s+[^.]+?(?=\s+(?:Weaknesses\s|Routine\s|---\s|Reset\s|Ranged\s|Melee\s|[A-Z][\w' -]{1,40}\s+(?:Reaction|Two Actions|Three Actions|Free Action|Action|Activate)\b|$))/g, ' ')
  text = text.replace(/\bWeaknesses\s+[^.]+?(?=\s+(?:Routine\s|---\s|Reset\s|Ranged\s|Melee\s|[A-Z][\w' -]{1,40}\s+(?:Reaction|Two Actions|Three Actions|Free Action|Action|Activate)\b|$))/g, ' ')

  return { text: cleanWhitespace(text), bt }
}

/** Convert AoN action labels to a PF2e Actions-font glyph string. */
function activityToGlyph(activity: string): string {
  const a = activity.toLowerCase()
  if (a === 'reaction')      return ' ↺'
  if (a === 'free action')   return ' ◇'
  if (a === 'three actions') return ' ◆◆◆'
  if (a === 'two actions')   return ' ◆◆'
  if (a === 'action' || a === 'single action') return ' ◆'
  if (a === 'activate')      return ''
  return ''
}

/** A strike's printed action cost ("Single Action", "[one-action]", "◆") as
 *  the same leading-space glyph string activitySymbol gives creature strikes. */
function strikeActivityGlyph(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (/^[◆◇↺]+$/.test(raw)) return ' ' + raw
  const a = raw.toLowerCase().replace(/^\[|\]$/g, '')
  if (a === 'single action' || a === 'one action' || a === 'one-action') return ' ◆'
  if (a === 'two actions' || a === 'two-actions') return ' ◆◆'
  if (a === 'three actions' || a === 'three-actions') return ' ◆◆◆'
  if (a === 'free action' || a === 'free-action') return ' ◇'
  if (a === 'reaction') return ' ↺'
  return undefined
}

/**
 * Find all ability headings + their content windows in the working text,
 * then carve each window into the (Trigger, Effect, body) pieces we need.
 */
function extractAbilities(s: string): { abilities: Ability[]; remaining: string } {
  if (!s.trim()) return { abilities: [], remaining: '' }
  // Find every plausible ability start. We're permissive on the name (any
  // capitalized 1–6 word phrase) — false positives will be culled below if
  // the block doesn't actually contain Trigger / Effect / parseable body.
  const heads: Array<{ name: string; preParen?: string; activity: string; postParen?: string; start: number; end: number }> = []
  ABILITY_HEAD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ABILITY_HEAD_RE.exec(s)) !== null) {
    // "Melee Single Action jaws +17" is a strike line, never an ability.
    if (/^(?:Melee|Ranged)$/.test(m[1].trim())) continue
    heads.push({
      name: m[1].trim(),
      preParen: m[2]?.trim(),
      activity: m[3].trim(),
      postParen: m[4]?.trim(),
      start: m.index,
      end: ABILITY_HEAD_RE.lastIndex,
    })
  }
  if (heads.length === 0) return { abilities: [], remaining: s }

  // Find the next non-ability section so the last ability's body has a
  // proper terminator.
  const sectionEndM = s.match(SECTION_HEAD_RE)
  const terminator = sectionEndM ? sectionEndM.index! : s.length

  const abilities: Ability[] = []
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]
    const next = heads[i + 1]
    const bodyEnd = next ? next.start : terminator
    let body = s.slice(h.end, bodyEnd).trim()
    body = body.replace(/^[;,\s]+/, '').trim()

    // Pull trigger / effect markers out of the body so they render with
    // bold labels in the stat block.
    let trigger: string | undefined
    let entries = body
    const trigM = body.match(/Trigger\s+(.+?)(?:\.\s+|\s+Effect\b|$)/)
    if (trigM) {
      trigger = trigM[1].trim()
      entries = body.replace(trigM[0], '').trim()
    }
    const effM = entries.match(/^Effect\s+(.+)$/) || entries.match(/Effect\s+(.+)$/)
    if (effM) entries = effM[1].trim()

    // Build the traits list from the leading "(...)" group.
    const traits: string[] = []
    const traitsPiece = h.postParen ?? h.preParen
    if (traitsPiece) {
      for (const t of traitsPiece.split(',')) {
        const tt = t.trim()
        if (tt) traits.push(tt)
      }
    }

    // Skip false positives: a "block" with no trigger AND no effect AND no
    // body is just a stray capitalized noun the regex caught.
    if (!trigger && !entries) continue

    abilities.push({
      name: h.name + activityToGlyph(h.activity),
      activity: undefined,
      traits,
      trigger,
      entries,
    })
  }

  const remaining = sectionEndM ? s.slice(sectionEndM.index!) : ''
  return { abilities, remaining }
}

/** Index in `rest` where a strike's Damage/Effect text ends: a line break
 *  (the page's `<br />` when the scrape kept it), a `---` rule, Routine/Reset,
 *  or the next ability heading run on after a flattened break. */
function strikeTextEnd(rest: string): number {
  let end = rest.length
  const cut = (i: number) => { if (i >= 0 && i < end) end = i }
  cut(rest.indexOf('\n'))
  cut(rest.search(/\s---(?=\s|$)/))
  cut(rest.search(/\s(?=(?:Routine|Reset)\b)/))
  cut(rest.search(NEXT_ABILITY_RE))
  return end
}

/** Extract strike lines ("Ranged spear +14, Damage 2d6+6 piercing") from the
 *  hazard text. `s` keeps its line breaks: a strike printed after a break
 *  ends at the next one instead of swallowing the ability that follows. */
function extractAttacks(s: string): Attack[] {
  const heads: Array<{ m: RegExpExecArray; end: number }> = []
  STRIKE_HEAD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = STRIKE_HEAD_RE.exec(s)) !== null) heads.push({ m, end: STRIKE_HEAD_RE.lastIndex })

  const attacks: Attack[] = []
  for (let i = 0; i < heads.length; i++) {
    const { m: h, end } = heads[i]
    const nextStart = i + 1 < heads.length ? heads[i + 1].m.index : s.length
    let rest = s.slice(end, nextStart)
    const label = rest.match(STRIKE_LABEL_RE)
    if (label) rest = rest.slice(label[0].length)
    // strikeTextEnd's boundaries start with a whitespace; the leading ' ' lets a
    // boundary at the very start of `rest` be found (index 0 of the padded copy).
    const stop = strikeTextEnd(' ' + rest) - 1
    const text = rest.slice(0, Math.max(0, stop)).replace(/\s+/g, ' ').replace(/[\s;,]+$/, '').trim()

    const range = h[1] as 'Ranged' | 'Melee'
    const name = h[4].replace(/_([^_]+)_/g, '$1').trim()
    const traitsRaw = [h[3], h[6]].filter(Boolean).join(', ')
    const traits = traitsRaw ? traitsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
    const isEffect = label?.[1] === 'Effect'
    attacks.push({
      range, name, attack: parseInt(h[5], 10),
      activity: strikeActivityGlyph(h[2]),
      traits,
      damage: label && !isEffect ? text : '',
      types: [],
      effects: isEffect && text ? [text] : [],
      isAgile: traits.some(t => t.toLowerCase().includes('agile')),
    })
  }
  return attacks
}

export function parseHazardDescription(rawDesc: string, name: string): ParsedHazardText {
  const empty: ParsedHazardText = {
    flavor: '', stealth: '', disable: '', bt: undefined, complex: undefined,
    abilities: [], attacks: [], routine: '', reset: '',
  }
  if (!rawDesc) return empty

  let s = rawDesc.trim()
  // Strip AoN template markers — `<%TRAITS%120%%>...<%END>` and friends.
  // A handful of hazards (Glimpse Grave, Sarracenia's Ire) have these
  // embedded in their description blob and they'd otherwise render as raw
  // unparsed markup at the top of the stat block.
  s = s.replace(/<%[A-Z]+%\d+%%>([\s\S]*?)<%END>/g, '$1').trim()
  // A page line break survives as `<br />` or `\n`; keep it as `\n` (the strike
  // reader ends a strike there) and drop any other inline HTML ("<span
  // class="action" …>[one-action]</span>" keeps its bracketed text).
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '').trim()

  // Strip "<Name> Source <book> pg. N" header (sometimes "Name" is missing,
  // sometimes the source line has weird trailing text).
  if (s.toLowerCase().startsWith(name.toLowerCase())) {
    s = s.slice(name.length).trim()
  }
  s = s.replace(/^Source\s+[^.<]+?\bpg\.?\s*\d+\s*/i, '').trim()
  // Capture "Complexity Simple|Complex" before stripping it — the AoN scrape
  // doesn't always set raw.complex, but the text reliably says.
  let complex: boolean | undefined
  const complexM = s.match(/^Complexity\s+(Simple|Complex)\s*/i)
  if (complexM) {
    complex = complexM[1].toLowerCase() === 'complex'
    s = s.slice(complexM[0].length).trim()
  }

  // Flavor text ends at the first "---" separator OR the first "Stealth"
  // header (some hazards skip the separator). Whichever comes first.
  let flavor = ''
  const sepIdx = s.search(/(?:^|\s)---\s+/)
  const stealthIdx = s.search(/\bStealth\s+(?:DC\s+\d|[+-]\d)/i)
  let endOfFlavor = -1
  if (sepIdx === -1 && stealthIdx === -1) endOfFlavor = -1
  else if (sepIdx === -1) endOfFlavor = stealthIdx
  else if (stealthIdx === -1) endOfFlavor = sepIdx
  else endOfFlavor = Math.min(sepIdx, stealthIdx)
  // `>= 0` (not `> 0`) so a separator at the very start — e.g. after the name +
  // source header are stripped — is explicitly consumed instead of leaking the
  // bare "---" into the flavor; flavor just comes back empty in that case.
  if (endOfFlavor >= 0) {
    flavor = s.slice(0, endOfFlavor).trim()
    s = s.slice(endOfFlavor).replace(/^\s*---\s*/, '').trim()
  }

  // Strikes are read from the whole stat-block text, line breaks intact,
  // BEFORE the section cuts below: a strike inside Routine (Trapped Lathe) or
  // after a line break used to be lost to the "remaining text" scan.
  const attacks = extractAttacks(s)

  // Stealth: "Stealth DC 18 (or 0 if disabled)" / "Stealth +12 (master)" /
  // "Stealth +10 (trained); DC 22 (expert) to notice ...". The terminator
  // also covers ability headings — some hazards have NO defenses block and
  // jump straight from Disable to an ability.
  //
  // No /i flag: the terminator uses [A-Z] to spot ability headings; under
  // case-insensitive matching that would match any lowercase word too,
  // which terminates the section far too early. Section keywords in AoN
  // text are reliably capitalized, so a case-sensitive match works.
  let stealth = ''
  const stealthRe = new RegExp('\\bStealth\\s+([^]+?)(?=\\s+(?:Disable\\b|' + SECTION_TERMINATOR.slice(3) + ')')
  const stealthM = s.match(stealthRe)
  if (stealthM) {
    stealth = stealthM[1].trim()
    s = s.slice(s.indexOf(stealthM[0]) + stealthM[0].length).trim()
  }

  // Disable: free-form check description until next section header or
  // ability heading.
  let disable = ''
  // The `|\\s*$` tail lets a Disable run that ENDS the (trimmed) string match —
  // the SECTION_TERMINATOR's own `$` only fires after a mandatory `\\s+`, which a
  // trimmed string never has, so a terminal Disable would otherwise come back empty.
  const disableRe = new RegExp('^Disable\\s+([^]+?)(?=\\s+' + SECTION_TERMINATOR + '|\\s*$)')
  const disableM = s.match(disableRe)
  if (disableM) {
    disable = disableM[1].trim()
    s = s.slice(disableM[0].length).trim()
  }

  // Strip the defenses block (data lives in raw.defenses already — but the
  // text has it inline so we need to remove it before parsing abilities).
  const stripped = stripDefenseBlock(s)
  s = stripped.text
  const bt = stripped.bt

  // Reset: pulled off the END first (any leading "---" we tolerate).
  let reset = ''
  // Match "--- Reset <text>" up to end, or plain "Reset <text>" at the
  // tail with no preceding ability-block marker.
  const resetIdx = s.search(/(?:^|\s)---\s+Reset\b/)
  const plainResetIdx = s.search(/(?:^|\s)Reset\s+(?=[A-Z])/)
  let resetCut = -1
  if (resetIdx >= 0) resetCut = resetIdx
  else if (plainResetIdx >= 0) resetCut = plainResetIdx
  if (resetCut >= 0) {
    const tail = s.slice(resetCut)
    const m = tail.match(/(?:---\s+)?Reset\s+([^]+)$/)
    if (m) reset = m[1].trim()
    s = s.slice(0, resetCut).trim()
  }

  // Routine: for complex hazards. Spans until --- or end.
  let routine = ''
  const routineM = s.match(/\bRoutine\s+([^]+?)(?=\s+---\s+|\s+Reset\b|$)/i)
  if (routineM) {
    routine = routineM[1].trim()
    s = s.slice(0, s.indexOf(routineM[0])).trim()
  }

  // Remaining text is abilities (strikes were read above).
  const { abilities } = extractAbilities(s)

  return { flavor, stealth, disable, bt, complex, abilities, attacks, routine, reset }
}
