import type { Ability, Attack, Creature } from '../types/pf2e'
import { looksLikeTraitsLine, normalizeTrait, parseStatBlockText, readDamage, spellHeaderLine } from './parseStatBlockText'

/*
 * A stat block as the TextConverter's text pane shows it; parseStatBlockText reads it back. Every
 * text edit of a board combatant or a homebrew record runs through the pair, so the text carries
 * what the stat block draws (D18): the page's Recall Knowledge line, language abilities, every HP
 * pool, hardness, BT, the AC / save / HP / Perception notes, a hazard's AC and saves only as
 * printed, its Stealth / Description / Disable / Routine / Reset and strike places, spell blocks
 * with their ranks, constants and focus pools, and the page section each ability is printed in
 * ("---" separators). The format is described on parseStatBlockText.
 */

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

const ACT: Record<string, string> = {
  '1': 'one action', '2': 'two actions', '3': 'three actions',
  'F': 'free action', 'R': 'reaction',
}

// Glyph → action-cost label — the inverse of the parser's cost reading. Some
// creatures store an ability's action cost as an Actions-font glyph (or, for
// abilities sourced from the hazard parser, a glyph baked onto the end of the
// name like "Attack of Opportunity ↺"). Mapping these back to a "[reaction]"
// bracket lets the cost survive a creatureToText → parseStatBlockText round-trip.
const ACT_GLYPHS: Record<string, string> = {
  '◆': 'one action', '◆◆': 'two actions', '◆◆◆': 'three actions',
  '◇': 'free action', '↺': 'reaction',
}
const WORD_GLYPH: Record<string, string> = {
  'one action': '◆', 'two actions': '◆◆', 'three actions': '◆◆◆', 'free action': '◇', 'reaction': '↺',
}

/** The trailing action glyph baked onto an ability name, if any. */
function trailingGlyph(name: string): string | undefined {
  return name.match(/\s*([◆◇↺]+)\s*$/)?.[1]
}

/** An activity ('R', '◆', ' ◆ to ◆◆◆') → its cost bracket and the glyph string it reads back as. */
function cost(activity: string | undefined): { text: string; glyph: string } {
  const a = (activity ?? '').trim()
  if (!a) return { text: '', glyph: '' }
  const word = ACT[a] ?? ACT_GLYPHS[a] ?? (WORD_GLYPH[a.toLowerCase()] ? a.toLowerCase() : undefined)
  if (word) return { text: `[${word}]`, glyph: WORD_GLYPH[word] }
  const range = a.match(/^([◆◇↺]+)\s+(to|or)\s+([◆◇↺]+)$/)
  if (range && ACT_GLYPHS[range[1]] && ACT_GLYPHS[range[3]]) {
    return { text: `[${ACT_GLYPHS[range[1]]}] ${range[2]} [${ACT_GLYPHS[range[3]]}]`, glyph: `${range[1]} ${range[2]} ${range[3]}` }
  }
  return { text: '', glyph: '' }
}

/** An indented continuation line; "\" keeps a line literal when the parser would otherwise read it
 *  as something else (an ability's Trigger, an empty line, surrounding spaces). */
function contLine(s: string): string {
  const literal = s === '' || s !== s.trim() || s.startsWith('\\') || /^Trigger\s/.test(s)
  return `  ${literal ? '\\' : ''}${s}`
}

/** A hazard field ("Disable …") with its further lines indented under it. */
function fieldLines(label: string, text: string | undefined): string[] {
  if (text == null || text === '') return []
  const [first, ...rest] = text.split('\n')
  const head = first === '' || first !== first.trim() || first.startsWith('\\') ? `\\${first}` : first
  return [`${label} ${head}`, ...rest.map(contLine)]
}

/** The ability as the text writes it: the plain AoN-style line when it reads back as this very
 *  ability, the "**Name**" form otherwise (a name with a lower-case word, text that names the
 *  creature, a name that is also a stat label); further text lines and the Trigger indented. */
function abilityLines(ab: Ability, ctx: { name: string; isHazard: boolean }): string[] {
  const glyph = trailingGlyph(ab.name)
  const c = cost(ab.activity).text ? cost(ab.activity) : cost(glyph)
  const traits: string[] = Array.isArray(ab.traits) ? ab.traits : []
  const tail = `${c.text ? ` ${c.text}` : ''}${traits.length ? ` (${traits.join(', ')})` : ''}`
  const entries = typeof ab.entries === 'string' ? ab.entries : ''
  const lines = entries === '' ? [] : entries.split('\n')
  const trigger = typeof ab.trigger === 'string' && ab.trigger !== '' ? ab.trigger : undefined

  // The page prints Frequency / Requirements before the Trigger (StatBlock draws them so too).
  let k = 0
  if (trigger) while (k < lines.length - 1 && /^\s*(?:Frequency|Requirements?)\b/.test(lines[k])) k++
  const allCont = trigger
    ? [...lines.slice(0, k).map(contLine), `  Trigger ${trigger}`, ...lines.slice(k).map(contLine)]
    : lines.map(contLine)

  const candidates: string[][] = []
  for (const head of [ab.name, `**${ab.name}**`]) {
    if (!trigger && lines.length && lines[0] !== '') candidates.push([`${head}${tail} ${lines[0]}`, ...lines.slice(1).map(contLine)])
    candidates.push([`${head}${tail}`, ...allCont])
  }
  for (const cand of candidates) {
    if (readsBackAs(cand, ab, c.glyph, traits, trigger, entries, ctx)) return cand
  }
  return candidates[candidates.length - 1]
}

/** Parse the candidate lines alone (after a spell heading, the strictest place an ability line can
 *  stand) and check they come back as this ability and nothing else. */
function readsBackAs(
  cand: string[], ab: Ability, glyph: string, traits: string[], trigger: string | undefined, entries: string,
  ctx: { name: string; isHazard: boolean },
): boolean {
  const text = [`${ctx.name || 'X'} ${ctx.isHazard ? 'HAZARD' : 'CREATURE'} 1`, 'Traits', 'Perception +0',
    'Arcane Innate Spells DC 1', ...cand].join('\n')
  const back = parseStatBlockText(text).creature
  if (!back || back.abilities.length !== 1 || back.attacks.length || back.spellcasting.some(s => s.spellsByLevel.length)) return false
  const got = back.abilities[0]
  return got.name === ab.name
    && (got.activity ?? '').trim() === glyph
    && JSON.stringify(got.traits) === JSON.stringify(traits)
    && got.trigger === trigger
    && got.entries === entries
}

/** A strike's damage as the text writes it: "2d8+6 piercing" when it reads back as this damage and
 *  these types; otherwise the types apart, "2d8+6 plus Grab; types piercing" ("; types none" for a
 *  damage that would read types out of its own text). Appending the types to a damage that says more
 *  than a formula read them back as damage text with no types (round 4). */
function damageText(a: Attack): string {
  const damage = typeof a.damage === 'string' ? a.damage : ''
  const types = strings(a.types)
  const plain = [damage, ...types].filter(Boolean).join(' ')
  if (!plain) return ''
  const back = readDamage(plain)
  if (back.damage === damage && JSON.stringify(back.types) === JSON.stringify(types)) return plain
  return `${damage}; types ${types.length ? types.join(', ') : 'none'}`
}

function strikeLines(a: Attack): string[] {
  const c = cost(a.activity)
  const traits = a.traits.length ? ` (${a.traits.join(', ')})` : ''
  const dmgText = damageText(a)
  const head = `${a.range}${c.text ? ` ${c.text}` : ''} ${a.name} ${fmt(a.attack)}${traits}${dmgText ? `, Damage ${dmgText}` : ''}`
  return a.effects.length ? [head, `  Effects ${a.effects.join(', ')}`] : [head]
}

function ordinal(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

/** Strings only, from a field a homebrew JSON may hold as anything. */
function strings(x: unknown): string[] {
  return (Array.isArray(x) ? x : [x]).filter((s): s is string => typeof s === 'string' && s.trim() !== '')
}

export function creatureToText(c: Creature): string {
  const lines: string[] = []
  const isHazard = c.isHazard
  const d = c.defenses
  const ctx = { name: c.name, isHazard }

  // Line 1: name + type + level
  lines.push(`${c.name} ${isHazard ? 'HAZARD' : 'CREATURE'} ${c.level}`)

  // Line 2: traits — the plain AoN line when it reads back unchanged, else an explicit list
  // ("No Alignment" is one trait; a lower-case trait would be Title-cased; none at all).
  {
    const plain = c.traits.join(' ')
    const plainOk = c.traits.length > 0
      && c.traits.every(t => /^\S+$/.test(t) && normalizeTrait(t) === t)
      && looksLikeTraitsLine(plain)
    lines.push(plainOk ? plain : `Traits ${c.traits.join(', ')}`.trimEnd())
  }
  if (c.family) lines.push(`Family ${c.family}`)
  if (c.fromArchivesPage) lines.push('Archives page')
  if (c.recallKnowledge) lines.push(`Recall Knowledge ${c.recallKnowledge}`)

  // A hazard's own sections, as the page prints them before its defenses.
  const hd = isHazard ? c.hazardData : undefined
  if (hd) {
    lines.push(`Complexity ${hd.complex ? 'Complex' : 'Simple'}`)
    lines.push(...fieldLines('Stealth', hd.stealth))
    lines.push(...fieldLines('Description', hd.description))
    lines.push(...fieldLines('Disable', hd.disable))
  }

  // Perception + senses
  if (!isHazard || c.perception || c.senses.length || c.perceptionNote) {
    let line = `Perception ${fmt(c.perception)}`
    if (c.perceptionNote) line += ` (${c.perceptionNote})`
    if (c.senses.length) line += `; ${c.senses.join('; ')}`
    lines.push(line)
  }

  // Languages; the language abilities (telepathy, truespeech) after ';' as the page prints them.
  {
    const abil = strings(c.languageAbilities)
    if (c.languages.length || abil.length) {
      lines.push(`Languages ${c.languages.join(', ')}${abil.length ? `; ${abil.join(', ')}` : ''}`.replace(/^Languages {2}/, 'Languages '))
    }
  }

  // Skills
  {
    const entries = Object.entries(c.skills)
    if (entries.length) {
      lines.push(`Skills ${entries.map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`)
    }
  }

  // Ability mods
  if (!isHazard || c.str || c.dex || c.con || c.int || c.wis || c.cha) {
    lines.push(`Str ${fmt(c.str)}, Dex ${fmt(c.dex)}, Con ${fmt(c.con)}, Int ${fmt(c.int)}, Wis ${fmt(c.wis)}, Cha ${fmt(c.cha)}`)
  }

  // Items
  if (c.items.length) lines.push(`Items ${c.items.join(', ')}`)

  // The page prints a creature's abilities in three sections (Ability.slot); "---" marks the
  // boundaries so the text reads them back into the same sections, in the same order.
  const slotted = !isHazard && c.abilities.some(a => a.slot === 'top' || a.slot === 'mid' || a.slot === 'bot')
  const inSlot = (s: Ability['slot']) => c.abilities.filter(a => (s === 'bot' ? a.slot !== 'top' && a.slot !== 'mid' : a.slot === s))
  if (slotted) {
    for (const ab of inSlot('top')) lines.push(...abilityLines(ab, ctx))
    lines.push('---')
  }

  lines.push('')

  // AC + saves — a hazard prints only what its page prints (acPrinted, savesPrinted).
  {
    const saveLabel = { fort: 'Fort', ref: 'Ref', will: 'Will' } as const
    const printed: unknown = d.savesPrinted
    const saveKeys: Array<'fort' | 'ref' | 'will'> = !isHazard
      ? ['fort', 'ref', 'will']
      : Array.isArray(printed)
        ? (['fort', 'ref', 'will'] as const).filter(k => printed.includes(k))
        : (d.fort || d.ref || d.will) ? ['fort', 'ref', 'will'] : []
    const showAc = !isHazard || d.acPrinted === true
    const acPart = showAc ? `AC ${d.ac}${d.acNote ? ` ${d.acNote}` : ''}` : ''
    const savePart = saveKeys.map(k => `${saveLabel[k]} ${fmt(d[k])}`).join(', ')
    const parts = [acPart, savePart].filter(Boolean)
    if (savePart && d.saveNote) parts.push(d.saveNote)
    if (parts.length) lines.push(parts.join('; '))
  }

  // Hardness, every HP pool (the first with its note), BT — one line, as a hazard's page prints it.
  {
    const pools = (Array.isArray(d.hpPools) ? d.hpPools : [])
      .filter((p): p is { hp: number; name?: string } => !!p && typeof p === 'object' && typeof p.hp === 'number')
    const wrap = (n: string) => (/[()]/.test(n) ? n : `(${n})`)
    const segs: string[] = []
    if (d.hardness !== undefined) segs.push(`Hardness ${d.hardness}`)
    if (!isHazard || d.hp > 0 || pools.length) {
      const note0 = d.hpNote ?? (pools[0]?.name ? wrap(pools[0].name) : '')
      segs.push(`HP ${d.hp}${note0 ? ` ${note0}` : ''}`)
      for (const p of pools.slice(1)) segs.push(`${p.hp}${p.name ? ` ${wrap(p.name)}` : ''}`)
    }
    if (d.bt !== undefined) segs.push(`BT ${d.bt}`)
    if (segs.length) lines.push(segs.join('; '))
  }
  if (d.immunities.length) lines.push(`Immunities ${d.immunities.join(', ')}`)
  const iwr = (xs: Array<{ amount: number | null; name: string; note?: string }>) =>
    xs.map(x => `${x.name}${x.amount != null ? ` ${x.amount}` : ''}${x.note ? ` (${x.note})` : ''}`).join(', ')
  if (d.resistances.length) lines.push(`Resistances ${iwr(d.resistances)}`)
  if (d.weaknesses.length) lines.push(`Weaknesses ${iwr(d.weaknesses)}`)

  if (slotted) {
    for (const ab of inSlot('mid')) lines.push(...abilityLines(ab, ctx))
    lines.push('---')
  }

  lines.push('')

  // Speed
  {
    const parts: string[] = []
    if (c.speed.walk != null) parts.push(`${c.speed.walk} feet`)
    if (c.speed.fly != null)    parts.push(`fly ${c.speed.fly} feet`)
    if (c.speed.swim != null)   parts.push(`swim ${c.speed.swim} feet`)
    if (c.speed.burrow != null) parts.push(`burrow ${c.speed.burrow} feet`)
    if (c.speed.climb != null)  parts.push(`climb ${c.speed.climb} feet`)
    // A creature with no Speed would read back as the paste default (25 feet): "—" says none.
    if (parts.length || !isHazard) lines.push(`Speed ${parts.length ? parts.join(', ') : '—'}${c.speedNote ? `; ${c.speedNote}` : ''}`)
  }

  lines.push('')

  if (isHazard) {
    // A hazard's strikes sit among its abilities where the page prints them (afterAbility).
    const at = (a: Attack) => (typeof a.afterAbility === 'number' ? a.afterAbility : Infinity)
    c.abilities.forEach((ab, k) => {
      for (const a of c.attacks) if (at(a) === k) lines.push(...strikeLines(a))
      lines.push(...abilityLines(ab, ctx))
    })
    for (const a of c.attacks) if (!(at(a) < c.abilities.length)) lines.push(...strikeLines(a))
    if (hd) {
      lines.push(...fieldLines('Routine', hd.routine))
      lines.push(...fieldLines('Reset', hd.reset))
    }
  } else {
    // Attacks
    for (const atk of c.attacks) lines.push(...strikeLines(atk))
  }

  // Spellcasting
  for (const sb of c.spellcasting) {
    lines.push(spellHeaderLine(sb))
    for (const slot of sb.spellsByLevel) {
      if (!slot.spells.length) continue
      const spellList = slot.spells.map(s => {
        const usage = s.atWill ? 'at will'
          : s.uses != null ? `×${s.uses}`
          : s.amount ? `×${s.amount.replace('×', '')}`
          : ''
        const inner = [usage, s.note].filter(Boolean).join('; ')
        return inner ? `${s.name} (${inner})` : s.name
      }).join(', ')
      if (slot.isCantrip || slot.label === 'Cantrips') {
        lines.push(`Cantrips${slot.level > 0 ? ` (${ordinal(slot.level)})` : ''} ${spellList}`)
      } else if (slot.isConstant) {
        lines.push(`Constant (${ordinal(slot.level)}) ${spellList}`)
      } else {
        const rank = parseInt(slot.label.match(/^Level\s+(\d+)$/)?.[1] ?? '', 10)
        const lvl = Number.isNaN(rank) ? slot.level : rank
        lines.push(`${ordinal(lvl)}${slot.slots != null ? ` (${slot.slots} slots)` : ''} ${spellList}`)
      }
    }
    lines.push('')
  }

  // Rituals
  if (c.rituals && (c.rituals.casts.length || c.rituals.dc != null)) {
    const groups = c.rituals.casts.map(r => `${r.rank ? `${r.rank} ` : ''}${r.names.join(', ')}`)
    lines.push(['Rituals' + (c.rituals.dc != null ? ` DC ${c.rituals.dc}` : ''), ...groups].join('; '))
  }

  // Abilities (a creature's bottom section, or every ability of a record without sections)
  if (!isHazard) for (const ab of slotted ? inSlot('bot') : c.abilities) lines.push(...abilityLines(ab, ctx))

  // Description / lore blurb — emitted last, as its own "Description" section,
  // so the structured fields above parse cleanly and it round-trips back into
  // Creature.flavor (see parseStatBlockText).
  if (c.flavor && c.flavor.trim()) {
    lines.push('')
    lines.push('Description')
    lines.push(c.flavor.trim())
  }

  return lines.join('\n').trimEnd()
}
