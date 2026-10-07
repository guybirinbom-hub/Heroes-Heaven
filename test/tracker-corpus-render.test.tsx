// @vitest-environment jsdom
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderDom } from './_render'
import fixture from './fixtures/corpus-render-samples.json'
import { parseCreature, parseHazard } from '../tracker/src/utils/parseCreature'
import { StatBlock } from '../tracker/src/components/StatBlock'
import { StatBlockBuilder } from '../tracker/src/components/StatBlockBuilder'
import { CombatantDetail } from '../tracker/src/components/CombatantDetail'
import { creatureToText } from '../tracker/src/utils/creatureToText'
import { parseStatBlockText } from '../tracker/src/utils/parseStatBlockText'
import type { Combatant, Creature, RawCreature, RawHazard } from '../tracker/src/types/pf2e'

/*
 * THE TRACKER'S STAT BLOCK, END TO END, AGAINST THE ARCHIVES PAGE.
 *
 * Every record below is a verbatim copy of a verified-bestiary corpus record
 * (hh-bestiary-corpus data/, _aon.markdown kept): named picks for each defect class in the corpus's
 * docs/APP-DEFECTS.md, plus 5 random creatures and 3 random hazards (fixed seed; see the fixture's
 * _note). Each one goes through the real adapter (parseCreature / parseHazard) and the real
 * StatBlock (react-dom/server, default layout), and the RENDERED text is compared with what the PAGE
 * prints. The page side is read here, from _aon.markdown alone; it never looks at the record, so an
 * adapter that reads a field wrongly cannot agree with itself.
 *
 * Checks per record (each one a counted assertion; a failure names the record, the heading, the
 * expected and the rendered value):
 *   - every ability the page prints as a bold entry label is drawn as an ability heading, in page
 *     order, and on the same side of the AC box, the HP line and the first strike as on the page;
 *   - the Languages line reads as the page's (or is absent when the page's is empty);
 *   - every HP pool number the page prints is on the HP line, with the pool's own label ("Joint",
 *     "head") and never in doubled brackets;
 *   - Hardness is drawn iff the page prints it; a hazard's AC box iff its page prints AC; each
 *     hazard save iff the page prints it (with the page's value); a hazard's printed Speed;
 *   - the Recall Knowledge row iff the page has the sidebar, with every DC the sidebar prints;
 *   - one strike per Melee/Ranged line on a hazard's page, by name;
 *   - a hazard Routine's "(N actions)" is drawn, and "N action(s)" in its prose stays words;
 *   - every constant spell under its "Constant (Nth)" rank, every cantrip under a Cantrips rank;
 *   - every spell block under the name the page prints ("Champion Devotion Spells");
 *   - a spell block whose page line prints "N Focus Points" draws a pool of N pips;
 *   - every Hardness the page prints is drawn, a second component's ("Joint Hardness 16") too;
 *   - each ability's own opening words are drawn exactly once (not lost, not repeated in a hazard's
 *     Description, Disable or Routine prose as well as in its ability entry);
 *   - a hazard's Description, Disable and Reset text is drawn whole (not cut at "(see Routine)");
 *   - no markup (cost tokens, link or bold markers, unpaired brackets) reaches the rendered text.
 *
 * The page oracle reads only bold entry labels; an unbolded header is not checked. Measured against
 * the adapter and StatBlock of the base commit (7cfb323), an earlier revision of this file (before the
 * HP-label, Speed, Routine-prose and doubled-bracket checks were added) failed 53 of its 57 tests.
 *
 * Round 2 (END TO END) adds, below the per-record tests, the same oracle over the record the tracker
 * SERVES, carried through every path a GM takes (loader, board, Elite / Weak / scale, reload, saved
 * encounter, export → import, builder), with a mutation proof that the oracle sees each loss a path
 * could cause.
 *
 * Round 3 (END TO END vs the page, the SURFACE the GM reads) adds: the combat panel (CombatantDetail,
 * the only place the board shows a bestiary stat block: it hides the stat block's HP line for a
 * creature and prints HP as a bar plus the first pool's note), opening by name (prose links, random
 * encounters), the portable encounter file (export → import), Edit → Save over the homebrew store
 * (TextConverter: toStatBlock → saveCustomCreature → a reload of the list), and the TextConverter's
 * text pane (creatureToText → Parse). It also checks that no HP pool label prints more often than the
 * page prints it on its HP line.
 */

type Sample = { id: string; class: string; kind: 'creature' | 'hazard'; twinOf?: string; record: Record<string, unknown> }
const SAMPLES = (fixture as unknown as { samples: Sample[] }).samples

// ── the page side ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { '&amp;': '&', '&#x27;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }
const decode = (s: string) => s.replace(/&(?:amp|#x27|#39|quot|lt|gt|nbsp);/g, m => ENTITIES[m])

/** Plain text of a piece of page markdown: links unwrapped, tags, emphasis and markers dropped. */
function plain(s: string): string {
  return decode(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<actions\b[^>]*>/gi, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/(^|[\s(])_+|_+(?=[\s),;.:]|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Comparable form of a name: case, quotes, glyphs and punctuation folded. */
const norm = (s: string) => decode(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()

interface PageBlock { pre: string; body: string }

/** The stat block this record is: from its own title (right="Creature N" / "Hazard N") to the next one. */
function pageBlock(md: string, hazard: boolean, name: string): PageBlock {
  const titles = [...md.matchAll(/<title level="(\d)"([^>]*)>([\s\S]*?)<\/title>/g)]
  const want = hazard ? /right="Hazard/ : /right="Creature/
  const blocks = titles.filter(t => want.test(t[2]))
  if (!blocks.length) return { pre: '', body: md }
  const pick = blocks.find(t => norm(plain(t[3])) === norm(name)) ?? blocks[0]
  const start = pick.index! + pick[0].length
  const next = titles.find(t => t.index! > pick.index! && /right="(?:Creature|Hazard)/.test(t[2]))
  return {
    pre: md.slice(0, pick.index),
    body: md.slice(start, next ? next.index : md.length)
      .replace(/<aside>[\s\S]*?<\/aside>/g, '')
      .replace(/<li>[\s\S]*?<\/li>/g, m => ' '.repeat(m.length)), // list options are never entries
  }
}

const STAT_LABELS = new Set([
  'source', 'perception', 'languages', 'skills', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'items',
  'ac', 'fort', 'fortitude', 'ref', 'reflex', 'will', 'hp', 'hardness', 'bt', 'immunities', 'resistances',
  'weaknesses', 'speed', 'melee', 'ranged', 'damage', 'rituals', 'stealth', 'disable', 'routine', 'reset',
  'complexity', 'description', 'unspecific lore', 'specific lore',
])
const CLAUSES = new Set([
  'trigger', 'requirements', 'requirement', 'frequency', 'effect', 'critical success', 'success', 'failure',
  'critical failure', 'saving throw', 'onset', 'maximum duration', 'cost', 'duration', 'range', 'area',
  'targets', 'target', 'defense', 'special', 'prerequisites', 'access', 'activate', 'note', 'heightened',
  'critical', 'critical effect',
])
const DEF_COMPONENT = /\s(?:HP|AC|Hardness|BT|Fort|Fortitude|Ref|Reflex|Will)$/
const RANK = /^(?:cantrips?|constant|\d+(?:st|nd|rd|th))\b/i
// A spell block's bold label; a page may print its pool inside the bold ("**Champion Devotion Spells
// 2 Focus Points,**", Einherji).
const SPELL_BLOCK = /(?:Spells?|Cantrips|Hexes)(?:\s+\d+\s+Focus Points?)?$/
/** A spell block's label is followed by its DC, attack or pool; "**Release Spell** <reaction> Trigger…"
 *  (Glyph of Warding) is an ability whose name merely ends in "Spell". */
const isSpellBlock = (b: Bold, body: string) => SPELL_BLOCK.test(b.label)
  && (/Focus Points?$/i.test(b.label) || /^\s*,?\s*(?:DC\s*\d|attack\b|\(?\d+\s+Focus)/i.test(body.slice(b.end, b.end + 40)))
/** A bold HP label: "HP", a component's "Joint HP", or one with its qualifier inside the bold ("HP (per mannequin)"). */
const HP_LABEL = /(?:^|\s)HP(?:\s*\([^)]*\))?$/

/** Every bold label with its position; lineStart when it opens a line (or follows <br />, a list dash or a closed list). */
interface Bold { label: string; at: number; end: number; lineStart: boolean }
function bolds(body: string): Bold[] {
  const out: Bold[] = []
  const re = /\[\*\*(.+?)\*\*\]\([^)]*\)|\*\*\[([^\]]+)\]\([^)]*\)\s*\*\*|\*\*([^*\n]+?)\*\*/g
  for (const m of body.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3]
    const label = plain(raw).replace(/[:;,.]$/, '').trim()
    if (!label) continue
    const before = body.slice(Math.max(0, m.index! - 12), m.index!)
    // A label right after a closing list starts an entry too ("…</ul> **Shield Block**", Aasimar Redeemer).
    const lineStart = /(?:^|\n|<br\s*\/?>|<\/(?:ul|ol)>)\s*(?:-\s*)?$/.test(before) || m.index === 0
    out.push({ label, at: m.index!, end: m.index! + m[0].length, lineStart })
  }
  return out
}

/** The part of an ability label that is its name: a cost token or a trait list is not. */
const abilityName = (label: string) =>
  label.replace(/\s*\[(?:reaction|free-action|one-action|two-actions|three-actions)\]?.*$/i, '')
    .replace(/\s*\(.*$/, '').trim()

interface PageFacts {
  abilities: Array<{ name: string; at: number }>
  ac: number; hp: number; firstStrike: number
  languages: string | null
  hpPools: number[]
  hpLabels: string[]
  /** The page's HP text: from its first HP label to the end of that row ("HP 90 (body, head regrowth),
   *  regeneration hydra HP (head) 15"). How often a pool label may print. */
  hpText: string
  speeds: string[]
  hardness: number[]
  acValue: number | null
  saves: Partial<Record<'fort' | 'ref' | 'will', number>>
  recall: number[] | null
  strikes: string[]
  constants: Array<{ label: string; spells: string[] }>
  /** Every spell the page lists under a "Cantrips (Nth)" rank: at will, never a slot of rank N. */
  cantrips: string[]
  /** The spell blocks' own names, as the page prints them ("Champion Devotion Spells"). */
  spellBlocks: string[]
  focus: Array<{ block: string; points: number }>
  /** The opening words of each ability's own text (traits and cost dropped). */
  abilityOpenings: Array<{ name: string; words: string }>
  /** A hazard's Disable / Reset text and the flavor line above its first entry, as the page prints them. */
  disable: string | null
  reset: string | null
  flavor: string | null
}

/** The text a bold section label opens ("**Disable**\n…"), up to the next section, rule or entry. */
function sectionText(body: string, b: Bold | undefined): string | null {
  if (!b) return null
  const rest = body.slice(b.end)
  const stop = rest.search(/\n\s*\n|<column\b|\n---|<br\s*\/?>\s*-?\s*\*\*|\n\s*\*\*/)
  return plain(stop >= 0 ? rest.slice(0, stop) : rest) || null
}

/** The first N words of an ability's own text: cost tokens, a trait list and clause labels dropped. */
function openingWords(body: string, from: number, n = 8): string {
  const rest = body.slice(from)
  // Ends at the next entry: a bold label opening a line or following a break ("…DC 37<br />**Attack of Opportunity**").
  const stop = rest.search(/\n\s*\n|(?:\n|<br\s*\/?>)\s*-?\s*\*\*[A-Z]|\n---|<\/column>/)
  const t = plain((stop >= 0 ? rest.slice(0, stop) : rest).replace(/<actions\b[^>]*>/gi, ' '))
    .replace(/^[\s;:,.]*(?:\[[^\]]*\]\s*)?(?:\([^)]*\)\s*[;,]?\s*)?/, '')
  return t.split(/\s+/).slice(0, n).join(' ')
}

function strikeNameAfter(body: string, from: number): string {
  // "**Melee** <actions/> fangs +16 (…)" — the name may sit on the same line or the next ones.
  let text = body.slice(from, from + 400)
  const stop = text.search(/\*\*Damage\*\*|\bDamage\b|\n\s*\n/)
  if (stop >= 0) text = text.slice(0, stop)
  const t = plain(text).replace(/^[\s;:,\])]+/, '')
  const m = t.match(/^(.+?)\s*[+−–-]\s?\d+(?=[\s(,;]|$)/)
  return (m ? m[1] : t.split(/\s+\(|,/)[0]).trim()
}

/** A hazard page's stat-block body (its own title onward). */
const body = (md: string, name: string) => pageBlock(md, true, name).body

function pageFacts(md: string, hazard: boolean, name: string): PageFacts {
  const { pre, body } = pageBlock(md, hazard, name)
  const bs = bolds(body)
  const first = (re: RegExp) => bs.find(b => re.test(b.label))?.at ?? -1
  const ac = first(/^AC$/)
  const hp = first(/^HP$/)
  const firstStrike = bs.find(b => /^(?:Melee|Ranged)$/.test(b.label))?.at ?? -1

  const abilities: PageFacts['abilities'] = []
  const abilityOpenings: PageFacts['abilityOpenings'] = []
  for (const b of bs) {
    if (!b.lineStart) continue
    const l = b.label
    const lc = l.toLowerCase()
    if (!/^[A-Z]/.test(l)) continue
    if (STAT_LABELS.has(lc) || STAT_LABELS.has(abilityName(l).toLowerCase()) || CLAUSES.has(lc) || /^stage \d/.test(lc)) continue
    if (DEF_COMPONENT.test(l) || RANK.test(l) || isSpellBlock(b, body)) continue
    if (/^Recall Knowledge/.test(l)) continue
    // "**Rituals** DC 36" is the rituals block; "**Green Rituals** A green man…" is an ability.
    if (/Rituals$/.test(l) && /^\s*DC\s*\d/.test(body.slice(b.end, b.end + 12))) continue
    abilities.push({ name: abilityName(l), at: b.at })
    const words = openingWords(body, b.end)
    if (words.split(' ').length >= 6) abilityOpenings.push({ name: abilityName(l), words })
  }

  const langB = bs.find(b => b.label === 'Languages')
  let languages: string | null = null
  if (langB) {
    const rest = body.slice(langB.end)
    const stop = rest.search(/\n\s*(?:\*\*|<|---)/)
    languages = plain(stop >= 0 ? rest.slice(0, stop) : rest) || null
  }

  const numAfter = (b: Bold) => {
    const m = body.slice(b.end, b.end + 80).match(/^\s*(?:\([^)]*\)\s*)?[+]?(\d+)/)
    return m ? parseInt(m[1], 10) : null
  }
  const hpPools = bs.filter(b => HP_LABEL.test(b.label)).map(numAfter).filter((n): n is number => n != null)
  // A further pool the page prints UNBOLDED after a break: "<br /> HP (head) 60" (Orochi),
  // "<br /> HP 20 (tentacle)" (Trighoul).
  const unboldedPoolLabels: string[] = []
  for (const m of body.matchAll(/<br\s*\/?>\s*HP\s*(?:\(([^)]*)\)\s*)?(\d+)/g)) {
    hpPools.push(parseInt(m[2], 10))
    if (m[1]) unboldedPoolLabels.push(plain(m[1]))
  }
  // A pool's own label: a component ("**Joint HP** 64") or a qualifier ("**HP** (head) 15").
  const hpLabels: string[] = [...unboldedPoolLabels]
  for (const b of bs.filter(x => HP_LABEL.test(x.label))) {
    const comp = b.label.match(/^(.+)\sHP$/)
    if (comp) { hpLabels.push(comp[1]); continue }
    const inBold = b.label.match(/HP\s*\(([^)]*)\)$/)
    if (inBold) { hpLabels.push(plain(inBold[1])); continue }
    const q = body.slice(b.end, b.end + 60).match(/^\s*\(([^)]*)\)\s*\d/)
    if (q) { hpLabels.push(plain(q[1])); continue }
    // Round 4: a creature's first pool names itself AFTER its number, "**HP** 90\n(body, head regrowth)"
    // (Hydra), "**HP** 135\n(4 segments)" (troops). Read up to the next break, so a qualifier holding a
    // link ("(coffin restoration, [fast healing](…) 5, …)") is read whole. A hazard's "(BT 30)" or
    // "(44)" after its number is a Broken Threshold, not a label: creatures only.
    if (!hazard) {
      const after = plain(body.slice(b.end, b.end + 400).split(/\n\s*\n|<br\s*\/?>|<\/row>/)[0])
      const t = after.match(/^(\d+)\s*\(([^)]*)\)/)
      if (t && /[a-z]/i.test(t[2])) hpLabels.push(t[2].replace(/^\(/, '').trim())
    }
  }
  const firstHp = bs.find(x => HP_LABEL.test(x.label))
  let hpText = ''
  if (firstHp) {
    const rest = body.slice(firstHp.at)
    const stop = rest.search(/\n\s*\n|<\/row>|\n---|\n\s*\*\*(?:Immunities|Resistances|Weaknesses)\b/)
    hpText = plain(stop >= 0 ? rest.slice(0, stop) : rest)
    // Round 4: a further pool the page prints on a line of its own, outside that row ("<br /> **HP** 35
    // (head), head regrowth; …", Mocking Chorus), is HP text too: its own line is added.
    const firstEnd = firstHp.at + (stop >= 0 ? stop : rest.length)
    for (const b of bs.filter(x => HP_LABEL.test(x.label) && x.at >= firstEnd)) {
      const line = body.slice(b.at)
      const end = line.search(/\n\s*\n|<br\s*\/?>|<\/row>|\n---/)
      hpText += ` ${plain(end >= 0 ? line.slice(0, end) : line)}`
    }
  }
  const speeds = hazard
    ? bs.filter(b => b.label === 'Speed').map(b => plain(body.slice(b.end).split(/<br\s*\/?>|\n|\*\*/)[0])).filter(Boolean)
    : []
  const hardness = bs.filter(b => /(?:^|\s)Hardness$/.test(b.label)).map(numAfter).filter((n): n is number => n != null)
  const acB = bs.find(b => /(?:^|\s)AC$/.test(b.label))
  const acValue = acB ? numAfter(acB) : null
  const saves: PageFacts['saves'] = {}
  for (const [k, re] of [['fort', /^(?:Fort|Fortitude)$/], ['ref', /^(?:Ref|Reflex)$/], ['will', /^Will$/]] as const) {
    const b = bs.find(x => re.test(x.label))
    if (!b) continue
    const m = body.slice(b.end, b.end + 20).match(/^\s*([+−–-])\s?(\d+)/)
    if (m) saves[k] = (m[1] === '+' ? 1 : -1) * parseInt(m[2], 10)
  }

  const rkText = plain(pre)
  const recall = /Recall Knowledge/.test(rkText)
    ? [...rkText.matchAll(/DC\s*(\d+)/g)].map(m => parseInt(m[1], 10))
    : null

  // One strike per Melee/Ranged line. A page that doubles the label ("**Melee** <actions …/>**Melee**
  // ghostly arms", Arms of the Drowned) prints one line: the run is read from its last label.
  const strikeLabels: Bold[] = []
  for (const b of bs.filter(x => /^(?:Melee|Ranged)$/.test(x.label))) {
    const prev = strikeLabels[strikeLabels.length - 1]
    if (prev && /^(?:\s|<actions\b[^>]*>)*$/.test(body.slice(prev.end, b.at))) strikeLabels[strikeLabels.length - 1] = b
    else strikeLabels.push(b)
  }
  // Round 4: a creature's strikes are read too (checked by name, "creature strikes"), so a text edit or
  // any other path that drops or renames a strike is seen.
  const strikes = strikeLabels.map(b => strikeNameAfter(body, b.end))

  const constants: PageFacts['constants'] = []
  const cantrips: PageFacts['cantrips'] = []
  for (const b of bs.filter(x => /^Cantrips\b/.test(x.label))) {
    const rest = body.slice(b.end)
    const stop = rest.search(/\n\s*-?\s*\*\*|\n\s*\n\s*\*\*|<\/column>/)
    const seg = stop >= 0 ? rest.slice(0, stop) : rest
    for (const m of seg.matchAll(/\[([^\]]+)\]\(\/Spells/g)) cantrips.push(plain(m[1]))
  }
  for (const b of bs.filter(x => /^Constant\b/.test(x.label))) {
    const rest = body.slice(b.end)
    const stop = rest.search(/\n\s*-?\s*\*\*|\n\s*\n\s*\*\*|<\/column>/)
    const seg = stop >= 0 ? rest.slice(0, stop) : rest
    const spells = [...seg.matchAll(/\[([^\]]+)\]\(\/Spells/g)].map(m => plain(m[1]))
    constants.push({ label: b.label, spells })
  }

  const focus: PageFacts['focus'] = []
  const spellBlocks = bs.filter(x => x.lineStart && isSpellBlock(x, body) && !RANK.test(x.label))
    .map(x => x.label.replace(/\s+\d+\s+Focus Points?$/i, ''))
  for (const b of bs.filter(x => isSpellBlock(x, body) && !RANK.test(x.label))) {
    const line = body.slice(b.end).split('\n')[0]
    const m = `${b.label} ${plain(line)}`.match(/(\d+)\s+Focus Points?/i)
    if (m) focus.push({ block: b.label.replace(/\s+\d+\s+Focus Points?$/i, ''), points: parseInt(m[1], 10) })
  }

  const disable = hazard ? sectionText(body, bs.find(b => b.label === 'Disable')) : null
  const reset = hazard ? sectionText(body, bs.find(b => b.label === 'Reset')) : null
  // The flavor line: after the Source/Complexity column, up to the first rule or bold entry.
  let flavor: string | null = null
  if (hazard) {
    const after = body.slice(body.indexOf('</column>') + '</column>'.length)
    const stop = after.search(/\n---|<br\s*\/?>\s*\*\*|\n\s*\*\*/)
    flavor = plain(stop >= 0 ? after.slice(0, stop) : after) || null
  }

  return { abilities, ac, hp, firstStrike, languages, hpPools, hpLabels, hpText, speeds, hardness, acValue, saves, recall, strikes, constants, cantrips, spellBlocks, focus, abilityOpenings, disable, reset, flavor }
}

// ── the rendered side ─────────────────────────────────────────────────────────

function combatantOf(c: Creature): Combatant {
  return {
    id: 'cb-1', name: c.name, creature: c, isPC: false, isAlly: false, initiative: null,
    currentHP: c.defenses.hp, maxHP: c.defenses.hp, tempHP: 0, conditions: [],
    isElite: false, isWeak: false, notes: '', isDefeated: false,
  }
}

const AB_ROW = '<div class="stat-line"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-bottom:2px">'
const STRIKE_LABEL = /<span class="stat-label" style="text-transform:capitalize">(?:Melee|Ranged)<\/span>[\s\S]*?<span style="font-weight:600;color:var\(--text\)">([^<]*)<\/span>/g

interface Rendered {
  html: string
  text: string
  abilities: Array<{ name: string; at: number }>
  strikes: Array<{ name: string; at: number }>
  ac: number; hp: number
}

/** Tokens are put in the html, then the tags stripped, so every position is in one text. */
function rendered(html: string): Rendered {
  let h = html
  h = h.split(AB_ROW).map((part, i) => {
    if (i === 0) return part
    const m = part.match(/^(?:<[^>]+>|\s)*([^<]*)/)
    return `⟦AB:${decode(m?.[1] ?? '').trim()}⟧` + part
  }).join('')
  h = h.replace(STRIKE_LABEL, (_m, n: string) => `⟦STRIKE:${decode(n).trim()}⟧`)
  h = h.replace('<div class="def-box-label">AC</div>', '⟦AC⟧')
  h = h.replace('<span class="stat-label">HP</span>', '⟦HP⟧')
  const text = decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  const tokens = (kind: string) => [...text.matchAll(new RegExp(`⟦${kind}:([^⟧]*)⟧`, 'g'))]
    .map(m => ({ name: m[1], at: m.index! }))
  return {
    html, text,
    abilities: tokens('AB'),
    strikes: tokens('STRIKE'),
    ac: text.indexOf('⟦AC⟧'),
    hp: text.indexOf('⟦HP⟧'),
  }
}

/** The text of the row an html label opens: from the label to the end of its row. */
function rowText(html: string, labelHtml: string): string | null {
  const i = html.indexOf(labelHtml)
  if (i < 0) return null
  const end = html.indexOf('</div>', i)
  return decode(html.slice(i + labelHtml.length, end < 0 ? undefined : end).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}
/** Text as react-dom/server escapes it. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
const defBoxValue = (html: string, label: string): string | null => {
  const m = html.match(new RegExp(`<div class="def-box-label">${label}</div><div class="def-box-val">([\\s\\S]*?)</div>`))
  return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : null
}
/** The combat panel's HP bar maximum ("90 / 90" → "90"), or '' when the panel draws no bar. */
function panelHpMax(html: string): string {
  const i = html.indexOf('flex-shrink:0">HP</span>')
  if (i < 0) return ''
  const seg = decode(html.slice(i, html.indexOf('</span></span>', i)).replace(/<[^>]+>/g, ' '))
  return seg.match(/\/\s*(\d+)/)?.[1] ?? ''
}
/** The note the combat panel prints under its HP bar (defenses.hpNote), or ''. */
function panelHpNote(html: string): string {
  const m = html.match(/<div style="font-size:11px;color:var\(--text-muted\);margin-top:2px">([\s\S]*?)<\/div>/)
  return m ? decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : ''
}
/** How often `word` appears in `text` as whole words, case and punctuation folded. */
function wordCount(text: string, word: string): number {
  const w = norm(word)
  if (!w) return 0
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (norm(text).match(new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'g')) ?? []).length
}

// ── the comparison ───────────────────────────────────────────────────────────

interface Failure { id: string; name: string; path: string; heading: string; expected: unknown; rendered: unknown }
const failures: Failure[] = []
let assertions = 0

/*
 * How the record reached the stat block. 'base' is the fixture record through the adapter. The
 * end-to-end paths (below) take the record the tracker SERVES and carry it the way a GM does: the
 * real loader, the board, a reload, a saved encounter, export → import, the builder, Elite / Weak /
 * a level scale. An adjusted path (Elite, Weak, scaled) moves numbers on purpose, so it skips the
 * printed-value checks (AC, saves, HP), compares prose with its digits folded, and expects every
 * printed Recall Knowledge DC moved by the level-DC table's difference (decision D3).
 */
/** `surface: 'panel'` draws the combatant the way the board does (CombatantDetail), not the bare StatBlock. */
interface Mode { path: string; adjustedLevel?: number; count?: boolean; surface?: 'panel' }
const BASE: Mode = { path: 'base' }
/** The DC-by-level table (GM Core), copied here so the expected shift does not come from the code under test. */
const DC_BY_LEVEL: Record<number, number> = {
  [-1]: 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26, 10: 27, 11: 28, 12: 30,
  13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40, 21: 42, 22: 44, 23: 46, 24: 48, 25: 50,
  26: 52, 27: 54, 28: 56, 29: 58, 30: 60,
}

/*
 * Accepted residues: a check that fails because the renderer's fixed layout cannot follow this
 * page's order (decision D5), or a defect the orchestrator left out of this lane (D9, listed per
 * record under D14). Each entry names the record, the
 * exact heading and the page order it exempts, quoted. An entry whose check no longer fails is
 * stale and fails the "allow-list is live" test below, so the list can only shrink.
 */
const ALLOW: Array<{ id: string; heading: string; premise: string }> = [
  {
    id: 'hazard-55',
    heading: 'ability "Earth Vulnerability" vs AC',
    premise: 'D5: the page prints "**Disable** DC 38 Arcana … **Earth Vulnerability** The Elemental Plane of Air is opposed … <column> **AC** 35, **Fort** +30" — a hazard ability BEFORE the defences; the tracker draws a hazard\'s abilities after its Defense strip.',
  },
  // D9 / D14 residue, not this lane's work: a component's own Hardness beyond the first (the tracker
  // holds one defenses.hardness and draws the first component's), and an "N action(s)" count inside
  // a Routine sentence, which the shared glyph pass (ActionGlyph) turns into an action glyph.
  ...([
    ['hazard-13', 16, '**Hammer Hardness** 22  **Hammer HP** 88 (44); **Joint Hardness** 16, **Joint HP** 64 (BT 32)'],
    ['hazard-472', 16, '**Hammer Hardness** 22  **Hamer HP** 88 (BT 44); **Joint Hardness** 16; **Joint HP** 64 (BT 32)'],
    ['hazard-21', 8, '**Trapdoor Hardness** 15  **Trapdoor HP** 60 (BT 30); **Spout Hardness** 8, **Spout HP** 32 (BT 16)'],
    ['hazard-489', 8, '**Trapdoor Hardness** 15  **Trapdoor HP** 60 (BT 30); **Spout Hardness** 8; **Spout** HP 32 (BT 16)'],
    ['hazard-23', 5, '**Pillar Hardness** 12  **Pillar HP** 48 (BT 24); **Panel Hardness** 5, **Panel HP** 20 (BT 10)'],
    ['hazard-494', 5, '**Pillar Hardness** 12  **Pillar HP** 48 (BT 24); **Panel Hardness** 5; **Panel HP** 20 (BT 10)'],
  ] as const).map(([id, n, quote]) => ({
    id, heading: `Hardness ${n} drawn`,
    premise: `D9: the page prints a second component's own Hardness, "${quote}"; the tracker draws only the first component's.`,
  })),
  ...([
    ['hazard-21', '1 action', '**Routine** (4 actions) The trap loses 1 action each turn for each disabled water spout.'],
    ['hazard-489', '1 action', '**Routine** (4 actions) The trap loses 1 action each turn for each disabled water spout.'],
    ['hazard-72', '1 action', '**Routine** (4 actions) The lathe attempts four sharpened fragment attacks … The trap loses 1 action each turn as its springs wind down'],
    ['hazard-774', '1 action', '**Routine** (6 actions) Each Rune Sentry grants the hazard 1 action; a Rune Sentry that’s plummeted …'],
    ['hazard-130', '1 action', '**Routine** (1 action) The hazard fires one bolt at every creature in a 30-foot-by-30-foot area in front of the gate as 1 action.'],
    ['hazard-428', '3 actions', '**Routine** (3 actions) Ghostly arms flail about … Each round, the haunt uses 3 actions to attempt to grapple a PC'],
    ['hazard-654', '3 actions', '**Routine** (3 actions) Ghostly arms flail about … Each round, the haunt uses 3 actions to attempt to grapple a PC'],
    ['hazard-47', '3 actions', '**Routine** (3 actions) The tornado of blades uses 3 actions to move, traveling up to 30 feet'],
    ['hazard-491', '3 actions', '**Routine** (3 actions) The tornado of blades uses 3 actions to move, traveling up to 30 feet'],
  ] as const).map(([id, ph, quote]) => ({
    id, heading: `Routine prose "${ph}"`,
    premise: `D9: the page prints "${ph}" as words inside the Routine sentence, "${quote}"; the glyph pass draws it as an action glyph.`,
  })),
]
const allowHits = new Set<string>()
const allowKey = (id: string, heading: string) => `${id}\u0000${heading}`

const parseSample = (s: Sample): Creature => s.kind === 'hazard'
  ? parseHazard(s.record as unknown as RawHazard)
  : parseCreature(s.record as unknown as RawCreature)

function compare(s: Sample): Failure[] {
  return compareWith(s, combatantOf(parseSample(s)), BASE)
}

/** The page oracle: `cb` rendered by the real StatBlock, against the page of the fixture record `s`. */
function compareWith(s: Sample, cb: Combatant, mode: Mode): Failure[] {
  const out: Failure[] = []
  const raw = s.record
  const name = String(raw.name)
  const md = String((raw._aon as { markdown: string }).markdown)
  const hazard = s.kind === 'hazard'
  const panel = mode.surface === 'panel'
  const html = renderToStaticMarkup(panel ? <CombatantDetail combatant={cb} /> : <StatBlock combatant={cb} />)
  const r = rendered(html)
  const p = pageFacts(md, hazard, name)
  const adjusted = mode.adjustedLevel !== undefined
  /** Prose as compared on an adjusted path: its numbers (DCs, damage) are allowed to move. */
  const fold = (t: string) => (adjusted ? t.replace(/\d+/g, '#') : t)
  const check = (ok: boolean, heading: string, expected: unknown, got: unknown) => {
    if (mode.count !== false) assertions++
    if (ok) return
    if (ALLOW.some(a => a.id === s.id && a.heading === heading)) { allowHits.add(allowKey(s.id, heading)); return }
    out.push({ id: s.id, name, path: mode.path, heading, expected, rendered: got })
  }

  // Abilities: drawn as headings, in page order, on the page's side of AC / HP / first strike.
  const used = new Set<number>()
  let lastAt = -1
  const firstStrikeR = r.strikes.length ? r.strikes[0].at : -1
  for (const a of p.abilities) {
    const k = r.abilities.findIndex((x, i) => !used.has(i) && norm(x.name) === norm(a.name))
    check(k >= 0, `ability "${a.name}"`, 'drawn as an ability heading', r.abilities.map(x => x.name))
    if (k < 0) continue
    used.add(k)
    const at = r.abilities[k].at
    check(at > lastAt, `ability "${a.name}" order`, 'after the previous page ability', 'drawn before it')
    lastAt = Math.max(lastAt, at)
    if (p.ac >= 0 && r.ac >= 0) {
      const pageBefore = a.at < p.ac
      check(pageBefore === at < r.ac, `ability "${a.name}" vs AC`, pageBefore ? 'before AC' : 'after AC', at < r.ac ? 'before AC' : 'after AC')
    }
    if (p.hp >= 0 && r.hp >= 0 && a.at > p.ac) {
      const pageBefore = a.at < p.hp
      check(pageBefore === at < r.hp, `ability "${a.name}" vs HP`, pageBefore ? 'before HP' : 'after HP', at < r.hp ? 'before HP' : 'after HP')
    }
    if (p.firstStrike >= 0 && firstStrikeR >= 0) {
      const pageBefore = a.at < p.firstStrike
      check(pageBefore === at < firstStrikeR, `ability "${a.name}" vs first strike`,
        pageBefore ? 'before the first strike' : 'after the first strike', at < firstStrikeR ? 'before the first strike' : 'after the first strike')
    }
  }

  // Languages line.
  if (!hazard) {
    const got = rowText(html, '<span class="stat-label">Languages</span>')
    check(norm(got ?? '') === norm(p.languages ?? '') && (got == null) === (p.languages == null),
      'Languages', p.languages, got)
  }

  // HP pools: every number, and every pool's own label ("Joint HP 64", "HP (head) 15").
  // On the panel the HP a GM reads is the bar's maximum, the note under the bar and (a hazard's) the
  // stat block's own HP line.
  const hpLine = rowText(html, '<span class="stat-label">HP</span>') ?? ''
  const hpRow = panel ? [panelHpMax(html), panelHpNote(html), hpLine].filter(Boolean).join(' ; ') : hpLine
  const hpNums = (hpRow.match(/\d+/g) ?? []).map(Number)
  if (!adjusted) for (const n of p.hpPools) check(hpNums.includes(n), `HP pool ${n}`, n, hpRow || '(no HP line)')
  // Every pool stays on the line when Elite / Weak / a scale moves its numbers.
  else check(hpNums.length >= p.hpPools.length, 'HP pool count', `${p.hpPools.length} pool number(s)`, hpRow || '(no HP line)')
  for (const q of p.hpLabels) check(norm(hpRow).includes(norm(q)), `HP pool label "${q}"`, q, hpRow || '(no HP line)')
  // The page prints a pool's note in one pair of brackets ("100 (body)"); never "((body))".
  check(!/\(\s*\(/.test(hpRow), 'HP line doubled brackets', 'one pair of brackets per pool note', hpRow)
  // A pool's label prints no more often than the page's HP text prints it: "Trapdoor" once, not under
  // the panel's HP bar AND on the HP line.
  for (const q of new Set(p.hpLabels)) {
    const want = wordCount(p.hpText, q)
    const got = wordCount(hpRow, q)
    check(got <= Math.max(1, want), `HP pool label "${q}" printed once`, `${Math.max(1, want)}× (page: "${p.hpText}")`, `${got}× in "${hpRow}"`)
  }

  // Round 4: a hazard whose page prints no HP draws no Hit Points anywhere (the stat block's HP line, a
  // panel bar): one with no HP made Elite must not read "HP 20" — the page has no Hit Points to adjust.
  if (hazard && p.hpPools.length === 0) {
    check(!hpNums.some(n => n > 0), 'HP drawn with no page HP', 'no HP (the page prints none)', hpRow)
  }

  // A hazard that moves prints its Speed ("Speed 10 feet", Spinning Blade Pillar).
  if (hazard) {
    for (const sp of p.speeds) check(norm(r.text).includes(norm(`Speed ${sp}`)), 'hazard Speed', `Speed ${sp}`, (r.text.match(/Speed[^⟦]{0,40}/) ?? ['none'])[0])
  }

  // Hardness iff printed (and its value).
  const hardR = defBoxValue(html, 'Hardness')
  check((hardR != null) === (p.hardness.length > 0), 'Hardness', p.hardness.length ? `Hardness ${p.hardness.join('/')}` : 'none', hardR ?? 'none')
  if (hardR != null && p.hardness.length) check(p.hardness.includes(parseInt(hardR, 10)), 'Hardness value', p.hardness, hardR)
  // Every Hardness the page prints, a component's too ("Hammer Hardness 22 … Joint Hardness 16").
  {
    const shown = [...(hardR ?? '').matchAll(/\d+/g), ...hpRow.matchAll(/Hardness\s*(\d+)/gi)].map(m => parseInt(m[1] ?? m[0], 10))
    for (const n of new Set(p.hardness)) check(shown.includes(n), `Hardness ${n} drawn`, n, `Hardness box ${hardR ?? 'none'}; HP line "${hpRow}"`)
  }

  // Each ability's own text is drawn once: neither lost nor printed twice (once in a hazard's
  // Description or Disable prose and again as an ability entry).
  {
    const vis = fold(norm(r.text.replace(/⟦[^⟧]*⟧/g, ' ')))
    for (const a of p.abilityOpenings) {
      const w = fold(norm(a.words))
      const n = w ? vis.split(w).length - 1 : 1
      check(n === 1, `ability "${a.name}" text drawn once`, `1× "${a.words}"`, `${n}×`)
    }
  }

  // A hazard's Description, Disable and Reset read as the page prints them (nothing cut off).
  if (hazard) {
    const vis = fold(norm(r.text.replace(/⟦[^⟧]*⟧/g, ' ')))
    for (const [label, want] of [['Description', p.flavor], ['Disable', p.disable], ['Reset', p.reset]] as const) {
      if (!want) continue
      check(vis.includes(fold(norm(want))), `hazard ${label} text`, want, (r.text.match(new RegExp(`${label}[^⟦]{0,260}`)) ?? ['(none)'])[0])
    }
  }

  if (hazard) {
    // Hazard AC iff printed, with its value; each save iff printed, with its value.
    const acR = defBoxValue(html, 'AC')
    check((acR != null) === (p.acValue != null), 'hazard AC', p.acValue ?? 'none', acR ?? 'none')
    if (!adjusted && acR != null && p.acValue != null) check(parseInt(acR, 10) === p.acValue, 'hazard AC value', p.acValue, acR)
    for (const [k, label] of [['fort', 'Fort'], ['ref', 'Ref'], ['will', 'Will']] as const) {
      const v = defBoxValue(html, label)
      const pv = p.saves[k]
      check((v != null) === (pv != null), `hazard ${label}`, pv ?? 'none', v ?? 'none')
      if (!adjusted && v != null && pv != null) check(parseInt(v.replace(/[−–]/, '-'), 10) === pv, `hazard ${label} value`, pv, v)
    }
    // One strike per Melee/Ranged line, by name.
    const got = r.strikes.map(x => norm(x.name)).sort()
    const want = p.strikes.map(norm).sort()
    check(JSON.stringify(got) === JSON.stringify(want), 'hazard strikes', p.strikes, r.strikes.map(x => x.name))
  } else {
    // Round 4: one strike per Melee/Ranged line, by name, for a creature too.
    const got = r.strikes.map(x => norm(x.name)).sort()
    const want = p.strikes.map(norm).sort()
    check(JSON.stringify(got) === JSON.stringify(want), 'creature strikes', p.strikes, r.strikes.map(x => x.name))
    // Recall Knowledge iff the page has the sidebar, with every DC it prints.
    const rk = rowText(html, '<span class="stat-label">Recall Knowledge</span>')
    check((rk != null) === (p.recall != null), 'Recall Knowledge', p.recall ? `DCs ${p.recall.join(', ')}` : 'none', rk ?? 'none')
    if (rk != null && p.recall) {
      const dcs = [...rk.matchAll(/DC\s*(\d+)/g)].map(m => parseInt(m[1], 10))
      // Elite / Weak / scaled: every printed DC moves by DC(adjusted level) − DC(printed level) (D3).
      const lv = Number(raw.level)
      const to = mode.adjustedLevel
      if (adjusted && DC_BY_LEVEL[to!] === undefined) {
        // A level the table does not print (Weak on a level −1 creature reads −2). No number to expect,
        // but the direction is certain: a weaker creature is never HARDER to identify, a stronger one
        // never easier. The rendered line is the page's line with its DCs moved, in the page's order.
        p.recall.forEach((dc, i) => {
          const got = dcs[i]
          check(got !== undefined && (to! < lv ? got <= dc : got >= dc), `Recall Knowledge DC ${dc} at level ${to}`,
            to! < lv ? `≤ ${dc} (level ${lv} → ${to})` : `≥ ${dc} (level ${lv} → ${to})`, rk)
        })
      } else {
        const delta = adjusted ? DC_BY_LEVEL[to!] - DC_BY_LEVEL[lv] : 0
        for (const dc of new Set(p.recall)) {
          check(dcs.includes(dc + delta), `Recall Knowledge DC ${dc}${delta ? ` ${delta > 0 ? '+' : ''}${delta}` : ''}`, dc + delta, rk)
        }
      }
    }
  }

  // Constant spells under their rank.
  for (const c of p.constants) {
    const i = html.indexOf(`<span class="spell-rank-label">${c.label}</span>`)
    check(i >= 0, `spells "${c.label}"`, c.label, i >= 0 ? c.label : 'no such rank')
    if (i < 0) continue
    const next = html.indexOf('<div class="spell-rank"', i)
    const seg = norm(html.slice(i, next < 0 ? undefined : next).replace(/<[^>]+>/g, ' '))
    for (const sp of c.spells) check(seg.includes(norm(sp)), `constant spell "${sp}"`, sp, seg)
  }
  // Cantrips under a Cantrips rank (at will), not under a numbered rank.
  if (p.cantrips.length) {
    const segs: string[] = []
    for (const m of html.matchAll(/<span class="spell-rank-label">Cantrips\b/g)) {
      const next = html.indexOf('<div class="spell-rank"', m.index!)
      segs.push(norm(html.slice(m.index!, next < 0 ? undefined : next).replace(/<[^>]+>/g, ' ')))
    }
    const all = segs.join(' | ')
    for (const sp of new Set(p.cantrips)) check(all.includes(norm(sp)), `cantrip "${sp}"`, `${sp} under a Cantrips rank`, segs.length ? all : 'no Cantrips rank drawn')
  }

  // The page shows no markup: a cost token, a link or bold marker left in the rendered text is a
  // loss (the page draws a glyph or a link there). Brackets must pair.
  const visible = r.text.replace(/⟦[^⟧]*⟧/g, ' ')
  const debris = visible.match(/\]\(|\*\*|<\/?actions|<%|\[?(?:one|two|three)-actions?\]|\[(?:one|two|three)-actions?\]?|\[(?:reaction|free-action)\]?/)
  check(!debris, 'markup in the rendered text', 'none', debris ? visible.slice(Math.max(0, debris.index! - 40), debris.index! + 40) : null)
  const opens = (visible.match(/\[/g) ?? []).length
  const closes = (visible.match(/\]/g) ?? []).length
  check(opens === closes, 'unpaired [ ] in the rendered text', 'paired', `${opens} "[" vs ${closes} "]"`)

  // A hazard Routine's printed action count ("(6 actions)") is drawn: a glyph for 1–3, the words above.
  if (hazard) {
    const routine = body(md, name).match(/\*\*Routine\*\*\s*\(\s*(\d+)\s+actions?\s*\)/)
    if (routine) {
      const n = parseInt(routine[1], 10)
      const i = html.indexOf('>Routine<')
      const head = i >= 0 ? html.slice(i, i + 900) : ''
      const ok = n <= 3
        ? head.includes(`<span class="pf2-action-glyph">${'ADT'[n - 1]}</span>`)
        : decode(head.replace(/<[^>]+>/g, ' ')).includes(`${n} actions`)
      check(ok, 'Routine action count', `(${n} action${n === 1 ? '' : 's'})`, i < 0 ? 'no Routine section' : decode(head.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 120))
    }
    // "N action(s)" inside the Routine's prose is a count in a sentence ("The trap loses 1 action each
    // turn"), printed as words on the page; it must not come out as an action glyph.
    const prose = plain((body(md, name).split(/\*\*Routine\*\*/)[1] ?? '').split(/\n---|\*\*Reset\*\*/)[0])
      .replace(/^\s*\(\s*\d+\s+actions?\s*\)/, '')
    const phrases = prose.match(/\b\d+ actions?\b/g) ?? []
    const renderedRoutine = (() => {
      const i = html.indexOf('>Routine<')
      const j = html.indexOf('>Reset<', i)
      return i < 0 ? '' : decode(html.slice(i, j < 0 ? undefined : j).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
    })()
    const count = (t: string, ph: string) => t.split(ph).length - 1
    for (const ph of new Set(phrases)) {
      const want = phrases.filter(x => x === ph).length
      check(count(renderedRoutine, ph) >= want, `Routine prose "${ph}"`, `${want}× "${ph}"`, renderedRoutine.slice(0, 140))
    }
  }

  // Every spell block is drawn under the name the page prints ("Champion Devotion Spells").
  for (const b of p.spellBlocks) {
    check(html.includes(`>${esc(b)}<`), `spell block "${b}"`, b, (html.match(/class="spell-block-name"[^>]*>[^<]*/g) ?? []).join(' | ') || [...r.text.matchAll(/\b[\w ]{0,30}Spells\b/g)].map(m => m[0].trim()).join(' | '))
  }
  // A spell block printing "N Focus Points" draws a pool of N pips in its own heading row.
  for (const f of p.focus) {
    const at = html.indexOf(`>${esc(f.block)}<`)
    const rowEnd = at >= 0 ? html.indexOf('</div>', at) : -1
    const row = at >= 0 ? html.slice(at, rowEnd < 0 ? undefined : rowEnd) : ''
    const pool = row.match(/<span class="spell-pips[^"]*" title="Focus Points">([\s\S]*?)<\/span><span style/)
    const pips = pool ? (pool[1].match(/class="spell-pip[ "]/g) ?? []).length : 0
    check(pips === f.points, `focus pool "${f.block}"`, `${f.points} focus pip(s)`, at < 0 ? 'block not drawn' : `${pips} focus pip(s)`)
  }
  // Debugging aid: CORPUS_RENDER_DUMP=<id,id> CORPUS_RENDER_DUMP_FILE=<path> writes the rendered text
  // and the page facts of those records to that file.
  if (process.env.CORPUS_RENDER_DUMP_FILE && (process.env.CORPUS_RENDER_DUMP ?? '').split(',').includes(s.id)) {
    appendFileSync(process.env.CORPUS_RENDER_DUMP_FILE, `DUMP ${s.id} [${mode.path}]\n${r.text}\n${JSON.stringify(p, null, 1)}\n${process.env.CORPUS_RENDER_DUMP_HTML ? html + '\n' : ''}`)
  }
  return out
}

describe('tracker stat block vs the Archives page (verified corpus records)', () => {
  it('has the selection the test was written for', () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(38)
    expect(SAMPLES.filter(s => s.class === 'random' && s.kind === 'creature')).toHaveLength(5)
    expect(SAMPLES.filter(s => s.class === 'random' && s.kind === 'hazard')).toHaveLength(3)
    for (const s of SAMPLES) expect(typeof (s.record._aon as { markdown?: string })?.markdown, s.id).toBe('string')
  })

  for (const s of SAMPLES) {
    it(`${s.id} ${String(s.record.name)} [${s.class}]`, () => {
      const f = compare(s)
      failures.push(...f)
      expect(f, f.map(x => `${x.heading}: expected ${JSON.stringify(x.expected)}, rendered ${JSON.stringify(x.rendered)}`).join('\n')).toEqual([])
    })
  }

  it('allow-list is live: every exempted check still fails (a fixed one must leave the list)', () => {
    for (const a of ALLOW) {
      const s = SAMPLES.find(x => x.id === a.id)
      expect(s, `${a.id} is in the fixture`).toBeDefined()
      expect(a.premise.length, `${a.id} quotes its page order`).toBeGreaterThan(40)
      if (!allowHits.has(allowKey(a.id, a.heading))) compare(s!)
      expect(allowHits.has(allowKey(a.id, a.heading)), `${a.id} ${a.heading} no longer fails`).toBe(true)
    }
  })
})

// ── end to end: the record the tracker SERVES, carried the way a GM carries it ─────────────
/*
 * The adapter-level check above reads the fixture record. A GM never holds that object: they open an
 * index row (the real loader, against the lane's public/data, a byte copy of the corpus), put it on the
 * board, Elite / Weak / scale it, reload the page, save and load an encounter, export and import it as
 * homebrew, and open it in the builder. Each of those hands StatBlock a different object, and every one
 * of them is drawn against the same PAGE here.
 *
 * Only a SERVED sample walks the paths: one whose own printing has an index row. 26 of the round-1
 * picks are legacy printings the index never offers (R12: the newest printing wins); the fixture
 * carries, for each, the printing the tracker serves in its place ("twinOf"), and that twin walks the
 * paths instead. A path test fails on what the path LOSES: a page check that passes for the fixture
 * record and fails after the path. A check that already fails for the fixture record is reported once,
 * by the base test above, not again on every path.
 */
const ROOT = join(__dirname, '..')
const DATA = join(ROOT, 'public/data')
type Row = { name: string; level: number; source: string; file: string; isHazard?: boolean }
const INDEX: Row[] = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'))
const noPage = (s: unknown) => String(s ?? '').replace(/\s*(?:pg\.|p\.)\s*\d+.*$/i, '').trim()
/** The index row naming this very printing (name, kind, level and source), if the tracker serves it. */
const rowOf = (s: Sample): Row | undefined => INDEX.find(r => r.name === s.record.name
  && !!r.isHazard === (s.kind === 'hazard') && r.level === s.record.level && noPage(r.source) === noPage(s.record.source))
const SERVED = SAMPLES.filter(s => rowOf(s))
const LEGACY = SAMPLES.filter(s => !rowOf(s))
const aonIdOf = (c: Creature | null | undefined) => ((c?.raw as unknown as { _aon?: { id?: string } } | undefined)?._aon?.id) ?? null

const PATHS = [
  'loader', 'board', 'board elite', 'board weak', 'board scaled +2',
  'reload', 'reload elite', 'reload weak', 'reload scaled +2', 'saved encounter', 'export → import', 'builder',
  // Round 3: the surface the GM reads, and the remaining ways a record reaches it.
  'panel', 'panel elite', 'panel reload', 'by name', 'encounter file', 'saved encounter elite',
  'encounter file elite', 'edit → save',
  // Round 4: Weak and a level scale through the same two load routes (D19), and the text pane's
  // full route: Parse, then Save (JSON → toStatBlock → the homebrew store, read back), drawn as the
  // stat block and as the combat panel, and a second edit of what the first one saved.
  'saved encounter weak', 'saved encounter scaled +2', 'encounter file weak', 'encounter file scaled +2',
  'text edit → save', 'text edit → save (panel)', 'text edit twice',
] as const
type PathName = typeof PATHS[number]
interface Walked { cb?: Combatant; adjustedLevel?: number; problem?: string; surface?: 'panel' }
const walked = new Map<string, Walked>()
/** The board's own HP maximum per record and adjustment ("<id>\0elite"), taken right after the board
 *  made it (round 4: what a load must give back, D19). */
const boardMax = new Map<string, number>()
const wkey = (id: string, path: PathName) => `${id}\u0000${path}`
const e2eNumbers = { combatSnapshotChars: 0, encounterChars: 0, importedEncounterChars: 0, oldNames: 0, oldNamesFoundBySearch: 0 }

const baseHeadings = new Map<string, Set<string>>()
function headingsAtBase(s: Sample): Set<string> {
  if (!baseHeadings.has(s.id)) {
    baseHeadings.set(s.id, new Set(compareWith(s, combatantOf(parseSample(s)), { ...BASE, count: false }).map(f => f.heading)))
  }
  return baseHeadings.get(s.id)!
}

describe('end to end: the served record, through every path a GM takes, vs its Archives page', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const p = join(DATA, decodeURIComponent(String(url).replace(/^\/data\//, '')))
      if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}) }
      const body = readFileSync(p, 'utf8')
      return { ok: true, status: 200, json: async () => JSON.parse(body) }
    })
    try { localStorage.clear() } catch { /* jsdom always has it */ }

    // 1. The real loader, by the index row.
    const ds = await import('../tracker/src/data/dataStore')
    const loaded = new Map<string, Creature>()
    for (const s of SERVED) {
      try {
        const c = await ds.loadCreature(rowOf(s)! as never)
        loaded.set(s.id, c)
        walked.set(wkey(s.id, 'loader'), aonIdOf(c) === s.id
          ? { cb: combatantOf(c) }
          : { cb: combatantOf(c), problem: `the row opens ${aonIdOf(c)}, not ${s.id}` })
      } catch (e) {
        walked.set(wkey(s.id, 'loader'), { problem: `loadCreature threw: ${(e as Error).message}` })
      }
    }

    // 2. The board: added, saved as an encounter, then Elite / Weak / scaled copies beside it.
    const store = await import('../tracker/src/store/combatStore')
    const st = () => store.useCombatStore.getState()
    st().clearAllCombatants()
    const ids = new Map<string, string>()
    const add = (s: Sample, tag: PathName) => {
      st().addCombatant(loaded.get(s.id)!)
      const all = st().combatants
      ids.set(wkey(s.id, tag), all[all.length - 1].id)
      return all[all.length - 1].id
    }
    const live = SERVED.filter(s => loaded.has(s.id))
    for (const s of live) add(s, 'board')
    st().saveEncounter('corpus-e2e')
    const level = (s: Sample) => Number(s.record.level)
    const adjustedOf: Partial<Record<PathName, (s: Sample) => number>> = {
      'board elite': s => level(s) + 1, 'board weak': s => level(s) - 1, 'board scaled +2': s => level(s) + 2,
    }
    for (const s of live) st().setEliteWeak(add(s, 'board elite'), 'elite')
    for (const s of live) st().setEliteWeak(add(s, 'board weak'), 'weak')
    for (const s of live) st().setScaledLevel(add(s, 'board scaled +2'), level(s) + 2)
    const onBoard = (id: string) => st().combatants.find(c => c.id === id)
    for (const s of live) {
      for (const tag of ['board', 'board elite', 'board weak', 'board scaled +2'] as const) {
        const cb = onBoard(ids.get(wkey(s.id, tag))!)
        walked.set(wkey(s.id, tag), cb ? { cb, adjustedLevel: adjustedOf[tag]?.(s) } : { problem: 'not on the board' })
      }
      // The combat panel: what the GM reads when the combatant is selected (CombatantDetail).
      for (const [from, to] of [['board', 'panel'], ['board elite', 'panel elite']] as const) {
        const w = walked.get(wkey(s.id, from))!
        walked.set(wkey(s.id, to), { ...w, surface: 'panel' })
      }
    }

    // 1b. By name: a creature mention in prose, a random-encounter pick (loadCreatureByName).
    for (const s of SERVED) {
      const c = await ds.loadCreatureByName(String(s.record.name))
      walked.set(wkey(s.id, 'by name'), !c ? { problem: `"${String(s.record.name)}" opens nothing` }
        : aonIdOf(c) === s.id ? { cb: combatantOf(c) }
        : { cb: combatantOf(c), problem: `"${String(s.record.name)}" opens ${aonIdOf(c)}, not ${s.id}` })
    }
    store.flushPersist()
    e2eNumbers.combatSnapshotChars = (localStorage.getItem('pf2e-current-combat') ?? '').length
    e2eNumbers.encounterChars = (localStorage.getItem('pf2e-encounters') ?? '').length

    // 3. A reload: a fresh module graph reads the persisted board back.
    vi.resetModules()
    const store2 = await import('../tracker/src/store/combatStore')
    const st2 = () => store2.useCombatStore.getState()
    const reloaded = store2.useCombatStore.getState().combatants
    const pairs = [['board', 'reload'], ['board elite', 'reload elite'], ['board weak', 'reload weak'], ['board scaled +2', 'reload scaled +2']] as const
    for (const s of live) {
      for (const [from, to] of pairs) {
        const cb = reloaded.find(c => c.id === ids.get(wkey(s.id, from)))
        walked.set(wkey(s.id, to), cb ? { cb, adjustedLevel: adjustedOf[from]?.(s) } : { problem: `not on the reloaded board (${reloaded.length} combatants came back)` })
      }
      walked.set(wkey(s.id, 'panel reload'), { ...walked.get(wkey(s.id, 'reload'))!, surface: 'panel' })
    }

    // 4. The export → import round trip, from the board's copy (the one a GM saves as homebrew).
    const dt = await import('../tracker/src/utils/dataTransfer')
    for (const s of live) {
      const cb = walked.get(wkey(s.id, 'reload'))?.cb
      if (!cb?.creature) { walked.set(wkey(s.id, 'export → import'), { problem: 'no reloaded copy to export' }); continue }
      const r = dt.parseCreaturesFromText(JSON.stringify([cb.creature]))
      walked.set(wkey(s.id, 'export → import'), r.ok && r.creatures[0]
        ? { cb: combatantOf(r.creatures[0]) }
        : { problem: `import refused it: ${r.error ?? (r.skipped ?? []).join('; ')}` })
    }

    // 5. The saved encounter, loaded on the reloaded app (same order as saved).
    store2.useCombatStore.getState().loadEncounter('corpus-e2e', new Map())
    const enc = store2.useCombatStore.getState().combatants
    live.forEach((s, i) => {
      const cb = enc[i]
      walked.set(wkey(s.id, 'saved encounter'), cb && cb.creature?.name === s.record.name
        ? { cb }
        : { problem: `encounter slot ${i} holds ${cb?.creature?.name ?? 'nothing'} (${enc.length} loaded)` })
    })

    // 5b. The portable encounter file: exported (names only), imported on the reloaded app, loaded.
    // Run before any homebrew exists, so a name resolves to the bestiary, as on a fresh install.
    const et = await import('../tracker/src/utils/encounterTransfer')
    const ds2 = await import('../tracker/src/data/dataStore')
    const file = et.buildExportPayload(['corpus-e2e'])
    for (const e of file.encounters) e.name = 'corpus-e2e-file'
    const encChars = () => (localStorage.getItem('pf2e-encounters') ?? '').length
    const beforeImport = encChars()
    const imp = await et.importEncountersFromText(JSON.stringify(file))
    e2eNumbers.importedEncounterChars = encChars() - beforeImport
    store2.useCombatStore.getState().loadEncounter('corpus-e2e-file', new Map())
    const fromFile = store2.useCombatStore.getState().combatants
    live.forEach((s, i) => {
      const cb = fromFile[i]
      const miss = imp.missing.find(m => m.creature === s.record.name)
      walked.set(wkey(s.id, 'encounter file'), !imp.ok ? { problem: `the file import failed: ${imp.error}` }
        : miss ? { problem: `the import found no stat block for "${miss.creature}"` }
        : cb && cb.creature?.name === s.record.name
          ? (aonIdOf(cb.creature) && aonIdOf(cb.creature) !== s.id ? { cb, problem: `the file reopened ${aonIdOf(cb.creature)}, not ${s.id}` } : { cb })
          : { problem: `file slot ${i} holds ${cb?.creature?.name ?? 'nothing'} (${fromFile.length} loaded)` })
    })

    st2().deleteSavedEncounter('corpus-e2e-file')

    // 5d. Elite combatants through a saved encounter (read back from storage) and through the
    // encounter file: a board of each served record's reloaded copy made Elite. Round 4: the same for
    // Weak and for a scale to level + 2; the board's own maximum is kept beside each (D19).
    const variants = [
      { tag: 'elite', adjust: (id: string) => st2().setEliteWeak(id, 'elite'), to: (s: Sample) => level(s) + 1,
        is: (cb: Combatant, _s: Sample) => cb.isElite, saved: 'saved encounter elite', file: 'encounter file elite' },
      { tag: 'weak', adjust: (id: string) => st2().setEliteWeak(id, 'weak'), to: (s: Sample) => level(s) - 1,
        is: (cb: Combatant, _s: Sample) => cb.isWeak, saved: 'saved encounter weak', file: 'encounter file weak' },
      { tag: 'scaled +2', adjust: (id: string, s: Sample) => st2().setScaledLevel(id, level(s) + 2), to: (s: Sample) => level(s) + 2,
        is: (cb: Combatant, s: Sample) => cb.scaledToLevel === level(s) + 2, saved: 'saved encounter scaled +2', file: 'encounter file scaled +2' },
    ] as const
    for (const v of variants) {
      st2().clearAllCombatants()
      for (const s of live) {
        const c = walked.get(wkey(s.id, 'reload'))?.cb?.creature
        if (!c) continue
        st2().addCombatant(c)
        const added = st2().combatants
        v.adjust(added[added.length - 1].id, s)
        boardMax.set(`${s.id}\u0000${v.tag}`, st2().combatants[added.length - 1].maxHP)
      }
      st2().saveEncounter(`corpus-e2e-${v.tag}`)
      st2().clearAllCombatants()
      store2.invalidateEncounterCache()
      const slot = (list: Combatant[], s: Sample, i: number, path: PathName): Walked => {
        const cb = list[i]
        return cb && cb.creature?.name === s.record.name && v.is(cb, s)
          ? { cb, adjustedLevel: v.to(s) }
          : { problem: `${path} slot ${i} holds ${cb?.creature?.name ?? 'nothing'}${cb && !v.is(cb, s) ? ` (not ${v.tag})` : ''}` }
      }
      st2().loadEncounter(`corpus-e2e-${v.tag}`, new Map())
      const fromSave = st2().combatants
      live.forEach((s, i) => walked.set(wkey(s.id, v.saved), slot(fromSave, s, i, v.saved)))
      const fileV = et.buildExportPayload([`corpus-e2e-${v.tag}`])
      for (const e of fileV.encounters) e.name = `corpus-e2e-${v.tag}-file`
      const impV = await et.importEncountersFromText(JSON.stringify(fileV))
      st2().loadEncounter(`corpus-e2e-${v.tag}-file`, new Map())
      const fromFileV = st2().combatants
      live.forEach((s, i) => walked.set(wkey(s.id, v.file), impV.ok
        ? slot(fromFileV, s, i, v.file)
        : { problem: `the file import failed: ${impV.error}` }))
      st2().deleteSavedEncounter(`corpus-e2e-${v.tag}-file`)
    }

    // 5c. Edit → Save on the board (TextConverter on the reloaded combatant, nothing changed): the JSON
    // pane holds the combatant's creature, Save reads it with toStatBlock and overwrites the homebrew
    // entry with that id; the homebrew list is then read back from storage, as after a restart.
    for (const s of live) {
      const existing = walked.get(wkey(s.id, 'reload'))?.cb?.creature
      if (!existing) { walked.set(wkey(s.id, 'edit → save'), { problem: 'no reloaded copy to edit' }); continue }
      const c = ds2.toStatBlock(JSON.parse(JSON.stringify(existing, null, 2)))
      if (!c) { walked.set(wkey(s.id, 'edit → save'), { problem: `Save refused it: ${ds2.statBlockProblem(JSON.parse(JSON.stringify(existing)))}` }); continue }
      c.id = typeof existing.id === 'string' && existing.id ? existing.id : `corpus-${s.id}`
      if (!ds2.saveCustomCreature(c)) { walked.set(wkey(s.id, 'edit → save'), { problem: 'saveCustomCreature refused it' }); continue }
    }
    ds2.reloadCustomCreatures()
    const brews = ds2.loadCustomCreatures()
    for (const s of live) {
      if (walked.has(wkey(s.id, 'edit → save'))) continue
      const id = walked.get(wkey(s.id, 'reload'))!.cb!.creature!.id
      const c = brews.find(b => b.id === (id || `corpus-${s.id}`))
      walked.set(wkey(s.id, 'edit → save'), c ? { cb: combatantOf(c) } : { problem: `the homebrew list read back has no entry ${id}` })
    }

    // 5e. Round 4: Edit on the board, text pane (TextConverter as written): the pane opens with
    // creatureToText(toStatBlock(combatant.creature)); Parse keeps id and source (handleParse); the JSON
    // pane holds JSON.stringify(parsed); Save reads it with toStatBlock and writes it over the entry
    // with the existing id (handleOverwrite: ownId(existing.id)); the homebrew list is read back.
    // "text edit twice" edits what that save stored, the same way again.
    const textEdit = (existing: Creature, fallbackId: string): { c?: Creature; problem?: string } => {
      const seed = ds2.toStatBlock(existing)
      if (!seed) return { problem: `the text pane opens empty: ${ds2.statBlockProblem(existing)}` }
      const { creature, errors } = parseStatBlockText(creatureToText(seed))
      if (!creature) return { problem: `Parse read no creature: ${errors.join('; ')}` }
      creature.id = existing.id
      creature.source = existing.source
      const c = ds2.toStatBlock(JSON.parse(JSON.stringify(creature, null, 2)))
      if (!c) return { problem: `Save refused the parsed JSON: ${ds2.statBlockProblem(JSON.parse(JSON.stringify(creature)))}` }
      c.id = typeof existing.id === 'string' && existing.id ? existing.id : fallbackId
      if (!ds2.saveCustomCreature(c)) return { problem: 'saveCustomCreature refused it' }
      ds2.reloadCustomCreatures()
      const back = ds2.loadCustomCreatures().find(b => b.id === c.id)
      return back ? { c: back } : { problem: `the homebrew list read back has no entry ${c.id}` }
    }
    for (const s of live) {
      const existing = walked.get(wkey(s.id, 'reload'))?.cb?.creature
      if (!existing) { walked.set(wkey(s.id, 'text edit → save'), { problem: 'no reloaded copy to edit' }); continue }
      const once = textEdit(existing, `text-${s.id}`)
      const w1: Walked = once.c ? { cb: combatantOf(once.c) } : { problem: once.problem }
      walked.set(wkey(s.id, 'text edit → save'), w1)
      walked.set(wkey(s.id, 'text edit → save (panel)'), { ...w1, surface: 'panel' })
      const twice = once.c ? textEdit(once.c, `text-${s.id}`) : { problem: `the first edit failed: ${once.problem}` }
      walked.set(wkey(s.id, 'text edit twice'), twice.c ? { cb: combatantOf(twice.c) } : { problem: twice.problem })
    }

    // 6. The builder, opened on the loaded record and left unchanged: what it emits is what it saves.
    for (const s of live) {
      let last = null as Creature | null
      try {
        renderDom(<StatBlockBuilder initial={loaded.get(s.id)!} onChange={c => { last = c }} />).stop()
      } catch (e) {
        walked.set(wkey(s.id, 'builder'), { problem: `builder threw: ${(e as Error).message}` })
        continue
      }
      walked.set(wkey(s.id, 'builder'), last ? { cb: combatantOf(last) } : { problem: 'the builder emitted nothing' })
    }
  }, 600_000)

  afterAll(() => {
    vi.unstubAllGlobals()
    try { localStorage.clear() } catch { /* nothing to clear */ }
  })

  it('the selection: every legacy pick has its served twin in the fixture, and every twin is served', () => {
    expect(SERVED.length).toBeGreaterThanOrEqual(30)
    for (const s of LEGACY) {
      const twin = SAMPLES.find(t => t.twinOf === s.id)
      expect(twin, `${s.id} ${String(s.record.name)} has no served twin in the fixture`).toBeDefined()
      expect(rowOf(twin!), `${twin!.id} (twin of ${s.id}) has no index row of its own`).toBeDefined()
    }
  })

  it('a legacy pick\'s name opens its served twin (loadCreatureByName, D11)', async () => {
    const ds = await import('../tracker/src/data/dataStore')
    const wrong: string[] = []
    for (const s of LEGACY) {
      const twin = SAMPLES.find(t => t.twinOf === s.id)!
      const c = await ds.loadCreatureByName(String(s.record.name))
      if (aonIdOf(c) !== twin.id) wrong.push(`${s.id} "${String(s.record.name)}" opens ${aonIdOf(c) ?? 'nothing'}, its served printing is ${twin.id} "${String(twin.record.name)}"`)
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  /*
   * Round 4 (D15, END TO END): every name the old index offered (test/fixtures/bestiary-legacy-names-
   * 2026-10-06.json, 142 names) opens the record that stands in for it, by name and from an old
   * portable encounter file loaded onto the board. The expected record comes from the fixture's own
   * remaster links, and for the two pages the Archives renamed in place ("Greedspawn Soldiers",
   * "Trinity Initiates", no remaster link) from the Archives document id the base record carried —
   * never from the alias file under test. A loaded slot's HP maximum is the opened stat block's, not the
   * file's stale number (D19). How many old names the Add Combatants search box finds is measured and
   * printed (CORPUS-RENDER-SEARCH), not asserted: D15 did not ask for search.
   */
  it('every old name opens its stand-in, by name and from an old encounter file (D11, D15)', async () => {
    const legacy = (JSON.parse(readFileSync(join(ROOT, 'test/fixtures/bestiary-legacy-names-2026-10-06.json'), 'utf8')) as {
      names: Array<{ name: string; source: string; level: number; hazard: boolean; remaster: string[] }>
    }).names
    expect(legacy).toHaveLength(142)
    const RENAMED_IN_PLACE: Record<string, string> = { 'Greedspawn Soldiers': 'creature-4266', 'Trinity Initiates': 'creature-4267' }
    const ds = await import('../tracker/src/data/dataStore')
    const opens = (n: typeof legacy[number], c: Creature | null | undefined): string | null => {
      if (!c) return 'opens nothing'
      if (RENAMED_IN_PLACE[n.name]) return aonIdOf(c) === RENAMED_IN_PLACE[n.name] ? null : `opens ${aonIdOf(c)} "${c.name}", not ${RENAMED_IN_PLACE[n.name]}`
      if (!n.remaster.length) return `no expected record for "${n.name}" (no remaster link, not renamed in place)`
      return n.remaster.includes(c.name) ? null : `opens "${c.name}", not one of ${JSON.stringify(n.remaster)}`
    }
    const wrong: string[] = []
    let searchFinds = 0
    for (const n of legacy) {
      assertions++
      const c = await ds.loadCreatureByName(n.name)
      const bad = opens(n, c)
      if (bad) {
        wrong.push(`by name: "${n.name}" ${bad}`)
        failures.push({ id: n.name, name: n.name, path: 'old name by name', heading: 'old name opens its stand-in', expected: RENAMED_IN_PLACE[n.name] ?? n.remaster, rendered: bad })
      }
      if (c && (await ds.searchCreatures(n.name, 500)).some(r => r.name === c.name)) searchFinds++
    }
    // An encounter file exported before the update: names only, the old source, a stale maxHP.
    const et = await import('../tracker/src/utils/encounterTransfer')
    const store = await import('../tracker/src/store/combatStore')
    const file = {
      version: 1, exportedAt: '2026-09-01T00:00:00.000Z',
      encounters: [{
        name: 'corpus-e2e-old-names', savedAt: '2026-09-01T00:00:00.000Z',
        combatants: legacy.map(n => ({ name: n.name, creatureName: n.name, creatureSource: n.source, isPC: false, maxHP: 10, isElite: false, isWeak: false, notes: '' })),
      }],
    }
    const imp = await et.importEncountersFromText(JSON.stringify(file))
    expect(imp.ok, imp.error).toBe(true)
    store.useCombatStore.getState().loadEncounter('corpus-e2e-old-names', new Map())
    const board = store.useCombatStore.getState().combatants
    expect(board).toHaveLength(legacy.length)
    legacy.forEach((n, i) => {
      const cb = board[i]
      assertions += 2
      const bad = opens(n, cb?.creature)
      if (bad) {
        wrong.push(`encounter file: "${n.name}" ${bad}`)
        failures.push({ id: n.name, name: n.name, path: 'old name encounter file', heading: 'old name opens its stand-in', expected: RENAMED_IN_PLACE[n.name] ?? n.remaster, rendered: bad })
      }
      if (cb?.creature && cb.maxHP !== cb.creature.defenses.hp) {
        wrong.push(`encounter file: "${n.name}" HP max ${cb.maxHP}, its stat block ${cb.creature.defenses.hp}`)
        failures.push({ id: n.name, name: n.name, path: 'old name encounter file', heading: 'HP max', expected: cb.creature.defenses.hp, rendered: cb.maxHP })
      }
    })
    store.useCombatStore.getState().deleteSavedEncounter('corpus-e2e-old-names')
    e2eNumbers.oldNames = legacy.length
    e2eNumbers.oldNamesFoundBySearch = searchFinds
    expect(wrong, `${wrong.length} old-name routes differ:\n${wrong.slice(0, 30).join('\n')}`).toEqual([])
  })

  /*
   * Mutation proof for the path tests: each loss a path could cause (the field a round trip drops) is
   * applied by hand to a served record, and the page oracle must name it. A path test that passes is
   * then evidence the path kept the field, not that the oracle cannot see it.
   */
  it('the oracle sees each loss a path could cause (mutation proof)', () => {
    const clone = (c: Creature): Creature => JSON.parse(JSON.stringify(c))
    const factsOf = (s: Sample) => pageFacts(String((s.record._aon as { markdown: string }).markdown), s.kind === 'hazard', String(s.record.name))
    const mutations: Array<{ what: string; pick: (s: Sample, c: Creature) => boolean; mutate: (c: Creature) => void; heading: RegExp; surface?: 'panel' }> = [
      { what: 'the panel loses the note under its HP bar (round 3)',
        surface: 'panel',
        pick: (s, c) => s.kind === 'creature' && !!c.defenses.hpNote && factsOf(s).hpLabels.length > 0,
        mutate: c => { delete c.defenses.hpNote },
        heading: /^HP pool label "[^"]*"$/ },
      { what: 'the panel gives a hazard with no page HP Hit Points (round 4)',
        surface: 'panel',
        pick: (s, c) => s.kind === 'hazard' && c.defenses.hp === 0 && factsOf(s).hpPools.length === 0,
        mutate: c => { c.defenses.hp = 20 },
        heading: /^HP drawn with no page HP$/ },
      { what: 'a round trip drops a creature\'s last strike (round 4)',
        pick: (s, c) => s.kind === 'creature' && c.attacks.length > 1,
        mutate: c => { c.attacks.pop() },
        heading: /^creature strikes$/ },
      { what: 'an HP pool label printed twice (round 3)',
        pick: (s, c) => s.kind === 'hazard' && factsOf(s).hpLabels.some(l => norm(l) === norm(c.defenses.hpPools?.[0]?.name ?? '')),
        mutate: c => { const p0 = c.defenses.hpPools![0]; p0.name = `${p0.name}, ${p0.name}` },
        heading: /printed once$/ },
      { what: 'persist slimming drops the page marker (D3)',
        pick: (s, c) => s.kind === 'creature' && !c.recallKnowledge,
        mutate: c => { delete c.rawMarkdown; delete c.fromArchivesPage },
        heading: /^Recall Knowledge$/ },
      { what: 'a round trip drops languageAbilities',
        pick: (_s, c) => (c.languageAbilities ?? []).length > 0,
        mutate: c => { delete c.languageAbilities },
        heading: /^Languages$/ },
      { what: 'a round trip drops Ability.slot',
        pick: (_s, c) => c.abilities.some(a => a.slot === 'top'),
        mutate: c => { for (const a of c.abilities) delete a.slot },
        heading: /^ability ".*" vs (AC|HP|first strike)$/ },
      { what: 'a round trip keeps only the first HP pool',
        pick: (_s, c) => (c.defenses.hpPools ?? []).length > 1,
        mutate: c => { c.defenses.hpPools = c.defenses.hpPools!.slice(0, 1) },
        heading: /^HP pool (\d+|label ".*")$/ },
      { what: 'a round trip drops a hazard\'s savesPrinted',
        pick: (s, c) => s.kind === 'hazard' && (c.defenses.savesPrinted ?? []).length > 0 && (c.defenses.savesPrinted ?? []).length < 3,
        mutate: c => { delete c.defenses.savesPrinted },
        heading: /^hazard (Fort|Ref|Will)$/ },
      { what: 'a round trip drops isConstant and the "Constant" label',
        pick: (_s, c) => c.spellcasting.some(b => b.spellsByLevel.some(r => r.isConstant)),
        mutate: c => { for (const b of c.spellcasting) for (const r of b.spellsByLevel) if (r.isConstant) { delete r.isConstant; r.label = `Level ${r.level}` } },
        heading: /^spells "Constant/ },
      { what: 'a round trip drops a hazard strike\'s page place (Attack.afterAbility)',
        // A page that prints an ability AFTER the strike, so the default place (after every ability) differs.
        pick: (s, c) => {
          if (s.kind !== 'hazard' || !c.attacks.some(a => a.afterAbility !== undefined)) return false
          const p = pageFacts(String((s.record._aon as { markdown: string }).markdown), true, String(s.record.name))
          return p.firstStrike >= 0 && p.abilities.some(a => a.at > p.firstStrike)
        },
        mutate: c => { for (const a of c.attacks) delete a.afterAbility },
        heading: /^ability ".*" vs first strike$/ },
    ]
    for (const m of mutations) {
      const s = SERVED.find(x => m.pick(x, parseSample(x)))
      expect(s, `no served sample to try "${m.what}" on`).toBeDefined()
      const c = clone(parseSample(s!))
      const before = compareWith(s!, combatantOf(c), { path: 'mutation', count: false, surface: m.surface }).filter(f => m.heading.test(f.heading))
      expect(before, `${s!.id}: the unmutated record already fails ${m.heading}`).toEqual([])
      m.mutate(c)
      const after = compareWith(s!, combatantOf(c), { path: 'mutation', count: false, surface: m.surface }).filter(f => m.heading.test(f.heading))
      expect(after.length, `${s!.id}: "${m.what}" went unseen`).toBeGreaterThan(0)
    }
  })

  /*
   * The TextConverter's text pane (round 3). Edit on a board combatant fills the text pane with
   * creatureToText(the creature); a GM who corrects a number there presses Parse, and Save then stores
   * what parseStatBlockText read back (id and source kept, TextConverter.handleParse). This is the one
   * edit route that goes through text, so every page check it loses is lost to a GM who edits that way.
   * One test for all served records: the losses are listed by check, with the records that lose each.
   */
  it('text edit → Parse keeps what the page prints (TextConverter text pane)', async () => {
    const ds = await import('../tracker/src/data/dataStore')
    const byHeading = new Map<string, string[]>()
    let records = 0
    for (const s of SERVED) {
      const existing = parseSample(s)
      const seed = ds.toStatBlock(JSON.parse(JSON.stringify(existing)))
      const { creature } = parseStatBlockText(creatureToText(seed ?? existing))
      const base = headingsAtBase(s)
      const lost = creature
        ? compareWith(s, combatantOf({ ...creature, id: existing.id, source: existing.source }), { path: 'text edit → parse' }).filter(f => !base.has(f.heading))
        : [{ id: s.id, name: String(s.record.name), path: 'text edit → parse', heading: 'Parse read no creature', expected: 'a creature', rendered: null }]
      if (lost.length) records++
      for (const f of lost) {
        const k = f.heading.replace(/"[^"]*"/g, '"…"').replace(/\b\d+\b/g, 'N')
        byHeading.set(k, [...(byHeading.get(k) ?? []), s.id])
      }
      failures.push(...lost.map(f => ({ ...f, path: 'text edit → parse' })))
    }
    const report = [...byHeading].sort((a, b) => b[1].length - a[1].length)
      .map(([k, ids]) => `${k}: ${new Set(ids).size} record(s) — ${[...new Set(ids)].slice(0, 8).join(', ')}`)
    expect(report, `${records} of ${SERVED.length} served records lose a page check through text edit → Parse:\n${report.join('\n')}`).toEqual([])
  })

  // Round 4: the same text round trip for the fixture's legacy printings (26 records the index never
  // serves, but an old saved encounter's snapshot or an imported homebrew copy still carries), twice in
  // a row, so a second edit of a first edit's result keeps the page too.
  it('text edit → Parse, twice, keeps what the page prints for the legacy printings too', async () => {
    const ds = await import('../tracker/src/data/dataStore')
    const lost: string[] = []
    for (const s of LEGACY) {
      const existing = parseSample(s)
      let c: Creature | null = existing
      for (let round = 1; round <= 2 && c; round++) {
        const seed = ds.toStatBlock(JSON.parse(JSON.stringify(c)))
        const parsed: Creature | null = parseStatBlockText(creatureToText(seed ?? c)).creature
        c = parsed ? { ...parsed, id: existing.id, source: existing.source } : null
      }
      if (!c) { lost.push(`${s.id}: Parse read no creature`); continue }
      const base = headingsAtBase(s)
      const f = compareWith(s, combatantOf(c), { path: 'text edit twice (legacy)' }).filter(x => !base.has(x.heading))
      failures.push(...f)
      for (const x of f) lost.push(`${s.id} ${x.heading}: expected ${JSON.stringify(x.expected)}, rendered ${JSON.stringify(x.rendered)}`)
    }
    expect(LEGACY.length).toBeGreaterThanOrEqual(20)
    expect(lost, lost.join('\n')).toEqual([])
  })

  /*
   * The creature card (round 3): global search lists every index row, hazards included, and a creature
   * mention in prose or a random-encounter pick opens the same card (FloatingWindow CreatureCard, via
   * PopupPreview). It is a compact summary by design, so only what it does print is held to the page:
   * a hazard's AC and each save appear iff the page prints them.
   */
  it('the creature card (global search, prose link) shows a hazard\'s AC and saves only as printed', async () => {
    const { PopupPreview } = await import('../tracker/src/components/FloatingWindow')
    const { act } = await import('react')
    const wrong: string[] = []
    let cards = 0
    for (const s of SERVED.filter(x => x.kind === 'hazard')) {
      const name = String(s.record.name)
      const view = renderDom(<PopupPreview type="creature" ref_={name.toLowerCase()} title={name} />)
      for (let k = 0; k < 50 && /Loading…/.test(view.host.textContent ?? ''); k++) {
        await act(async () => { await new Promise(r => setTimeout(r, 0)) })
      }
      const html = view.host.innerHTML
      view.stop()
      const shown = new Map([...html.matchAll(/>(AC|Fort|Ref|Will)<\/span><span[^>]*>([^<]*)<\/span>/g)].map(m => [m[1], decode(m[2]).trim()]))
      if (!/Hazard \d/.test(decode(html.replace(/<[^>]+>/g, ' ')))) { wrong.push(`${s.id} ${name}: the card did not open as a hazard`); continue }
      cards++
      const p = pageFacts(String((s.record._aon as { markdown: string }).markdown), true, name)
      const want: Array<[string, number | null | undefined]> = [['AC', p.acValue], ['Fort', p.saves.fort], ['Ref', p.saves.ref], ['Will', p.saves.will]]
      for (const [label, pv] of want) {
        assertions++
        const got = shown.get(label)
        if ((got != null) !== (pv != null)) {
          const f: Failure = { id: s.id, name, path: 'creature card', heading: `hazard ${label}`, expected: pv ?? 'none', rendered: got ?? 'none' }
          failures.push(f)
          wrong.push(`${s.id} ${name}: ${label} expected ${pv ?? 'none'}, card shows ${got ?? 'none'}`)
        }
      }
    }
    expect(cards, 'hazard cards opened').toBeGreaterThan(0)
    expect(wrong, `${new Set(wrong.map(w => w.split(':')[0])).size} of ${cards} hazard cards print an AC or save the page does not:\n${wrong.join('\n')}`).toEqual([])
  })

  // The HP bar of an Elite combatant after its encounter is loaded (saved in the app, or from a file)
  // reads the Elite maximum it had on the board, not the printed one (round 3; not a page check: the
  // page prints the base HP, Elite adds to it).
  it('a loaded Elite combatant keeps its Elite HP maximum (saved encounter, encounter file)', () => {
    const wrong: string[] = []
    for (const s of SERVED) {
      const board = walked.get(wkey(s.id, 'board elite'))?.cb
      if (!board) continue
      for (const path of ['saved encounter elite', 'encounter file elite'] as const) {
        const cb = walked.get(wkey(s.id, path))?.cb
        if (cb && cb.maxHP !== board.maxHP) wrong.push(`${s.id} ${String(s.record.name)} [${path}]: HP max ${cb.maxHP}, on the board ${board.maxHP}`)
      }
    }
    expect(wrong, `${wrong.length} loaded Elite combatants lost their Elite HP:\n${wrong.slice(0, 20).join('\n')}`).toEqual([])
  })

  /*
   * Round 4 (D19): every adjusted combatant — Elite, Weak, scaled to level + 2 — comes back from a
   * saved encounter, an encounter file and a reload with the maximum the board gave it. And the board's
   * Elite / Weak maximum is the PAGE's HP moved by GM Core's Elite / Weak table (copied here, not taken
   * from weakElite.ts): Elite +10 at level 1 or lower, +15 at 2–4, +20 at 5–19, +30 at 20 or higher;
   * Weak −10 at 1–2, −15 at 3–5, −20 at 6–20, −30 at 21 or higher (creatures; Weak below level 1 and
   * hazards are not in the table).
   */
  it('a loaded or reloaded Elite, Weak or scaled combatant keeps the board\'s maximum, and the board\'s is the page HP ± GM Core\'s table', () => {
    const wrong: string[] = []
    const eliteDelta = (lv: number) => (lv <= 1 ? 10 : lv <= 4 ? 15 : lv <= 19 ? 20 : 30)
    const weakDelta = (lv: number) => (lv <= 2 ? 10 : lv <= 5 ? 15 : lv <= 20 ? 20 : 30)
    let checked = 0
    for (const s of SERVED) {
      const tagOf = { elite: ['board elite', 'reload elite', 'saved encounter elite', 'encounter file elite'],
        weak: ['board weak', 'reload weak', 'saved encounter weak', 'encounter file weak'],
        'scaled +2': ['board scaled +2', 'reload scaled +2', 'saved encounter scaled +2', 'encounter file scaled +2'] } as const
      for (const [tag, paths] of Object.entries(tagOf)) {
        const board = boardMax.get(`${s.id}\u0000${tag}`)
        if (board === undefined) continue
        for (const path of paths) {
          const cb = walked.get(wkey(s.id, path as PathName))?.cb
          if (!cb) continue
          checked++
          assertions++
          if (cb.maxHP !== board) {
            wrong.push(`${s.id} ${String(s.record.name)} [${path}]: HP max ${cb.maxHP}, the board gave ${board}`)
            failures.push({ id: s.id, name: String(s.record.name), path, heading: `${tag} HP max`, expected: board, rendered: cb.maxHP })
          }
        }
      }
      if (s.kind !== 'creature') continue
      const lv = Number(s.record.level)
      const pageHp = pageFacts(String((s.record._aon as { markdown: string }).markdown), false, String(s.record.name)).hpPools[0]
      if (pageHp === undefined) continue
      for (const [tag, want] of [['elite', pageHp + eliteDelta(lv)], ['weak', lv >= 1 ? pageHp - weakDelta(lv) : null]] as const) {
        const board = boardMax.get(`${s.id}\u0000${tag}`)
        if (want === null || board === undefined) continue
        checked++
        assertions++
        if (board !== want) {
          wrong.push(`${s.id} ${String(s.record.name)} [board ${tag}]: HP max ${board}, the page's ${pageHp} with GM Core's ${tag} table gives ${want}`)
          failures.push({ id: s.id, name: String(s.record.name), path: `board ${tag}`, heading: `${tag} HP vs GM Core`, expected: want, rendered: board })
        }
      }
    }
    expect(checked, 'adjusted combatants checked').toBeGreaterThan(100)
    expect(wrong, `${wrong.length} adjusted HP maxima differ:\n${wrong.slice(0, 30).join('\n')}`).toEqual([])
  })

  /*
   * Round 4 (D17, END TO END): the card is opened the way a GM opens it (PopupPreview by name, the real
   * loader) for EVERY served record. A creature's card prints its AC and all three saves with the page's
   * values (D17: creatures unchanged); a hazard's prints the page's value for each one it shows.
   */
  it('the creature card prints the page\'s AC and save values (creatures all four, hazards the printed ones)', async () => {
    const { PopupPreview } = await import('../tracker/src/components/FloatingWindow')
    const { act } = await import('react')
    const wrong: string[] = []
    let cards = 0
    for (const s of SERVED) {
      const name = String(s.record.name)
      const view = renderDom(<PopupPreview type="creature" ref_={name.toLowerCase()} title={name} />)
      for (let k = 0; k < 50 && /Loading…/.test(view.host.textContent ?? ''); k++) {
        await act(async () => { await new Promise(r => setTimeout(r, 0)) })
      }
      const html = view.host.innerHTML
      view.stop()
      const shown = new Map([...html.matchAll(/>(AC|Fort|Ref|Will)<\/span><span[^>]*>([^<]*)<\/span>/g)].map(m => [m[1], decode(m[2]).trim()]))
      cards++
      const p = pageFacts(String((s.record._aon as { markdown: string }).markdown), s.kind === 'hazard', name)
      const want: Array<[string, number | null | undefined]> = [['AC', p.acValue], ['Fort', p.saves.fort], ['Ref', p.saves.ref], ['Will', p.saves.will]]
      for (const [label, pv] of want) {
        if (pv == null && s.kind === 'hazard') continue // presence is the test above's
        assertions++
        const got = shown.get(label)
        const n = got == null ? null : parseInt(got.replace(/[−–]/, '-'), 10)
        if (n !== pv) {
          failures.push({ id: s.id, name, path: 'creature card', heading: `card ${label} value`, expected: pv ?? 'none', rendered: got ?? 'none' })
          wrong.push(`${s.id} ${name}: ${label} page ${pv ?? 'none'}, card ${got ?? 'none'}`)
        }
      }
    }
    expect(cards).toBe(SERVED.length)
    expect(wrong, `${wrong.length} card values differ from the page:\n${wrong.join('\n')}`).toEqual([])
  })

  for (const s of SERVED) {
    for (const path of PATHS) {
      it(`${s.id} ${String(s.record.name)} — ${path}`, () => {
        const w = walked.get(wkey(s.id, path))
        expect(w?.problem ?? (w?.cb ? null : 'never reached this path'), `${s.id} ${path}`).toBeNull()
        const base = headingsAtBase(s)
        const got = compareWith(s, w!.cb!, { path, adjustedLevel: w!.adjustedLevel, surface: w!.surface })
        const lost = got.filter(f => !base.has(f.heading))
        failures.push(...lost)
        expect(lost, lost.map(x => `[${path}] ${x.heading}: expected ${JSON.stringify(x.expected)}, rendered ${JSON.stringify(x.rendered)}`).join('\n')).toEqual([])
      })
    }
  }
})

afterAll(() => {
  // The measurement the refute round reports: records, assertions, failures.
  console.log(`CORPUS-RENDER records=${SAMPLES.length} served=${SERVED.length} paths=${PATHS.length} assertions=${assertions} failures=${failures.length} snapshotChars=${e2eNumbers.combatSnapshotChars} encounterChars=${e2eNumbers.encounterChars} importedEncounterChars=${e2eNumbers.importedEncounterChars} oldNames=${e2eNumbers.oldNames} oldNamesFoundBySearch=${e2eNumbers.oldNamesFoundBySearch}`)
  for (const f of failures) console.log(`CORPUS-RENDER-FAIL ${f.id} ${f.name} | ${f.path} | ${f.heading} | expected ${JSON.stringify(f.expected)} | rendered ${JSON.stringify(f.rendered)}`)
})
