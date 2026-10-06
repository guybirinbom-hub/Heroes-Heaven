// @vitest-environment jsdom
import { appendFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import fixture from './fixtures/corpus-render-samples.json'
import { parseCreature, parseHazard } from '../tracker/src/utils/parseCreature'
import { StatBlock } from '../tracker/src/components/StatBlock'
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
 *   - every constant spell under its "Constant (Nth)" rank;
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
 */

type Sample = { id: string; class: string; kind: 'creature' | 'hazard'; record: Record<string, unknown> }
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
const SPELL_BLOCK = /(?:Spells?|Cantrips|Hexes)$/

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
  speeds: string[]
  hardness: number[]
  acValue: number | null
  saves: Partial<Record<'fort' | 'ref' | 'will', number>>
  recall: number[] | null
  strikes: string[]
  constants: Array<{ label: string; spells: string[] }>
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
    if (STAT_LABELS.has(lc) || CLAUSES.has(lc) || /^stage \d/.test(lc)) continue
    if (DEF_COMPONENT.test(l) || RANK.test(l) || SPELL_BLOCK.test(l)) continue
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
  const hpPools = bs.filter(b => /(?:^|\s)HP$/.test(b.label)).map(numAfter).filter((n): n is number => n != null)
  // A further pool the page prints UNBOLDED after a break: "<br /> HP (head) 60" (Orochi),
  // "<br /> HP 20 (tentacle)" (Trighoul).
  const unboldedPoolLabels: string[] = []
  for (const m of body.matchAll(/<br\s*\/?>\s*HP\s*(?:\(([^)]*)\)\s*)?(\d+)/g)) {
    hpPools.push(parseInt(m[2], 10))
    if (m[1]) unboldedPoolLabels.push(plain(m[1]))
  }
  // A pool's own label: a component ("**Joint HP** 64") or a qualifier ("**HP** (head) 15").
  const hpLabels: string[] = [...unboldedPoolLabels]
  for (const b of bs.filter(x => /(?:^|\s)HP$/.test(x.label))) {
    const comp = b.label.match(/^(.+)\sHP$/)
    if (comp) { hpLabels.push(comp[1]); continue }
    const q = body.slice(b.end, b.end + 60).match(/^\s*\(([^)]*)\)\s*\d/)
    if (q) hpLabels.push(plain(q[1]))
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
  const strikes = hazard ? strikeLabels.map(b => strikeNameAfter(body, b.end)) : []

  const constants: PageFacts['constants'] = []
  for (const b of bs.filter(x => /^Constant\b/.test(x.label))) {
    const rest = body.slice(b.end)
    const stop = rest.search(/\n\s*-?\s*\*\*|\n\s*\n\s*\*\*|<\/column>/)
    const seg = stop >= 0 ? rest.slice(0, stop) : rest
    const spells = [...seg.matchAll(/\[([^\]]+)\]\(\/Spells/g)].map(m => plain(m[1]))
    constants.push({ label: b.label, spells })
  }

  const focus: PageFacts['focus'] = []
  for (const b of bs.filter(x => SPELL_BLOCK.test(x.label) && !RANK.test(x.label))) {
    const line = body.slice(b.end).split('\n')[0]
    const m = plain(line).match(/(\d+)\s+Focus Points?/i)
    if (m) focus.push({ block: b.label, points: parseInt(m[1], 10) })
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

  return { abilities, ac, hp, firstStrike, languages, hpPools, hpLabels, speeds, hardness, acValue, saves, recall, strikes, constants, focus, abilityOpenings, disable, reset, flavor }
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

// ── the comparison ───────────────────────────────────────────────────────────

interface Failure { id: string; name: string; heading: string; expected: unknown; rendered: unknown }
const failures: Failure[] = []
let assertions = 0

/*
 * Accepted 'order' residues: a check that fails because the renderer's fixed layout cannot follow
 * this page's order, settled by the orchestrator (decision D5). Each entry names the record, the
 * exact heading and the page order it exempts, quoted. An entry whose check no longer fails is
 * stale and fails the "allow-list is live" test below, so the list can only shrink.
 */
const ALLOW: Array<{ id: string; heading: string; premise: string }> = [
  {
    id: 'hazard-55',
    heading: 'ability "Earth Vulnerability" vs AC',
    premise: 'D5: the page prints "**Disable** DC 38 Arcana … **Earth Vulnerability** The Elemental Plane of Air is opposed … <column> **AC** 35, **Fort** +30" — a hazard ability BEFORE the defences; the tracker draws a hazard\'s abilities after its Defense strip.',
  },
]
const allowHits = new Set<string>()
const allowKey = (id: string, heading: string) => `${id}\u0000${heading}`

function compare(s: Sample): Failure[] {
  const out: Failure[] = []
  const raw = s.record
  const name = String(raw.name)
  const md = String((raw._aon as { markdown: string }).markdown)
  const hazard = s.kind === 'hazard'
  const creature = hazard ? parseHazard(raw as unknown as RawHazard) : parseCreature(raw as unknown as RawCreature)
  const html = renderToStaticMarkup(<StatBlock combatant={combatantOf(creature)} />)
  const r = rendered(html)
  const p = pageFacts(md, hazard, name)
  const check = (ok: boolean, heading: string, expected: unknown, got: unknown) => {
    assertions++
    if (ok) return
    if (ALLOW.some(a => a.id === s.id && a.heading === heading)) { allowHits.add(allowKey(s.id, heading)); return }
    out.push({ id: s.id, name, heading, expected, rendered: got })
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
  const hpRow = rowText(html, '<span class="stat-label">HP</span>') ?? ''
  const hpNums = (hpRow.match(/\d+/g) ?? []).map(Number)
  for (const n of p.hpPools) check(hpNums.includes(n), `HP pool ${n}`, n, hpRow || '(no HP line)')
  for (const q of p.hpLabels) check(norm(hpRow).includes(norm(q)), `HP pool label "${q}"`, q, hpRow || '(no HP line)')
  // The page prints a pool's note in one pair of brackets ("100 (body)"); never "((body))".
  check(!/\(\s*\(/.test(hpRow), 'HP line doubled brackets', 'one pair of brackets per pool note', hpRow)

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
    const vis = norm(r.text.replace(/⟦[^⟧]*⟧/g, ' '))
    for (const a of p.abilityOpenings) {
      const w = norm(a.words)
      const n = w ? vis.split(w).length - 1 : 1
      check(n === 1, `ability "${a.name}" text drawn once`, `1× "${a.words}"`, `${n}×`)
    }
  }

  // A hazard's Description, Disable and Reset read as the page prints them (nothing cut off).
  if (hazard) {
    const vis = norm(r.text.replace(/⟦[^⟧]*⟧/g, ' '))
    for (const [label, want] of [['Description', p.flavor], ['Disable', p.disable], ['Reset', p.reset]] as const) {
      if (!want) continue
      check(vis.includes(norm(want)), `hazard ${label} text`, want, (r.text.match(new RegExp(`${label}[^⟦]{0,260}`)) ?? ['(none)'])[0])
    }
  }

  if (hazard) {
    // Hazard AC iff printed, with its value; each save iff printed, with its value.
    const acR = defBoxValue(html, 'AC')
    check((acR != null) === (p.acValue != null), 'hazard AC', p.acValue ?? 'none', acR ?? 'none')
    if (acR != null && p.acValue != null) check(parseInt(acR, 10) === p.acValue, 'hazard AC value', p.acValue, acR)
    for (const [k, label] of [['fort', 'Fort'], ['ref', 'Ref'], ['will', 'Will']] as const) {
      const v = defBoxValue(html, label)
      const pv = p.saves[k]
      check((v != null) === (pv != null), `hazard ${label}`, pv ?? 'none', v ?? 'none')
      if (v != null && pv != null) check(parseInt(v.replace(/[−–]/, '-'), 10) === pv, `hazard ${label} value`, pv, v)
    }
    // One strike per Melee/Ranged line, by name.
    const got = r.strikes.map(x => norm(x.name)).sort()
    const want = p.strikes.map(norm).sort()
    check(JSON.stringify(got) === JSON.stringify(want), 'hazard strikes', p.strikes, r.strikes.map(x => x.name))
  } else {
    // Recall Knowledge iff the page has the sidebar, with every DC it prints.
    const rk = rowText(html, '<span class="stat-label">Recall Knowledge</span>')
    check((rk != null) === (p.recall != null), 'Recall Knowledge', p.recall ? `DCs ${p.recall.join(', ')}` : 'none', rk ?? 'none')
    if (rk != null && p.recall) {
      const dcs = [...rk.matchAll(/DC\s*(\d+)/g)].map(m => parseInt(m[1], 10))
      for (const dc of new Set(p.recall)) check(dcs.includes(dc), `Recall Knowledge DC ${dc}`, dc, rk)
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
    appendFileSync(process.env.CORPUS_RENDER_DUMP_FILE, `DUMP ${s.id}\n${r.text}\n${JSON.stringify(p, null, 1)}\n${process.env.CORPUS_RENDER_DUMP_HTML ? html + '\n' : ''}`)
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

  afterAll(() => {
    // The measurement the refute round reports: records, assertions, failures.
    console.log(`CORPUS-RENDER records=${SAMPLES.length} assertions=${assertions} failures=${failures.length}`)
    for (const f of failures) console.log(`CORPUS-RENDER-FAIL ${f.id} ${f.name} | ${f.heading} | expected ${JSON.stringify(f.expected)} | rendered ${JSON.stringify(f.rendered)}`)
  })
})
