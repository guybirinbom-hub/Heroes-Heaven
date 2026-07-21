import type { Creature } from '../types/pf2e'

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

const ACT: Record<string, string> = {
  '1': 'one action', '2': 'two actions', '3': 'three actions',
  'F': 'free action', 'R': 'reaction',
}

// Glyph → action-cost label — the inverse of the parser's parseActivity. Some
// creatures store an ability's action cost as an Actions-font glyph (or, for
// abilities sourced from the hazard parser, a glyph baked onto the end of the
// name like "Attack of Opportunity ↺"). Mapping these back to a "[reaction]"
// bracket lets the cost survive a creatureToText → parseStatBlockText round-trip.
const ACT_GLYPHS: Record<string, string> = {
  '◆': 'one action', '◆◆': 'two actions', '◆◆◆': 'three actions',
  '◇': 'free action', '↺': 'reaction',
}

/** Split a trailing action glyph off an ability name. */
function stripTrailingGlyph(name: string): { name: string; glyph?: string } {
  const m = name.match(/\s*([◆◇↺]+)\s*$/)
  if (m && m.index !== undefined) return { name: name.slice(0, m.index).trim(), glyph: m[1] }
  return { name: name.trim() }
}

export function creatureToText(c: Creature): string {
  const lines: string[] = []

  // Line 1: name + type + level
  lines.push(`${c.name} ${c.isHazard ? 'HAZARD' : 'CREATURE'} ${c.level}`)

  // Line 2: traits
  lines.push(c.traits.join(' ') || 'N MEDIUM')

  // Perception + senses
  {
    let line = `Perception ${fmt(c.perception)}`
    if (c.senses.length) line += `; ${c.senses.join('; ')}`
    lines.push(line)
  }

  // Languages
  if (c.languages.length) lines.push(`Languages ${c.languages.join(', ')}`)

  // Skills
  {
    const entries = Object.entries(c.skills)
    if (entries.length) {
      lines.push(`Skills ${entries.map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`)
    }
  }

  // Ability mods
  lines.push(`Str ${fmt(c.str)}, Dex ${fmt(c.dex)}, Con ${fmt(c.con)}, Int ${fmt(c.int)}, Wis ${fmt(c.wis)}, Cha ${fmt(c.cha)}`)

  // Items
  if (c.items.length) lines.push(`Items ${c.items.join(', ')}`)

  lines.push('')

  // AC + saves
  lines.push(`AC ${c.defenses.ac}; Fort ${fmt(c.defenses.fort)}, Ref ${fmt(c.defenses.ref)}, Will ${fmt(c.defenses.will)}`)

  // HP + immunities/resistances/weaknesses
  {
    let line = `HP ${c.defenses.hp}`
    if (c.defenses.immunities.length) line += `; Immunities ${c.defenses.immunities.join(', ')}`
    if (c.defenses.resistances.length)
      line += `; Resistances ${c.defenses.resistances.map(r => `${r.name} ${r.amount}`).join(', ')}`
    if (c.defenses.weaknesses.length)
      line += `; Weaknesses ${c.defenses.weaknesses.map(w => `${w.name} ${w.amount}`).join(', ')}`
    lines.push(line)
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
    if (parts.length) lines.push(`Speed ${parts.join(', ')}`)
  }

  lines.push('')

  // Attacks
  for (const atk of c.attacks) {
    const actLabel = '[one action]'
    const traits = atk.traits.length ? ` (${atk.traits.join(', ')})` : ''
    const types = atk.types.length ? ` ${atk.types.join(' ')}` : ''
    lines.push(`${atk.range} ${actLabel} ${atk.name} ${fmt(atk.attack)}${traits}, Damage ${atk.damage}${types}`)
  }

  // Spellcasting
  for (const sb of c.spellcasting) {
    const atkPart = sb.attack ? `, attack ${fmt(sb.attack)}` : ''
    lines.push(`${sb.name} DC ${sb.DC ?? 0}${atkPart}`)
    for (const slot of sb.spellsByLevel) {
      const spellList = slot.spells.map(s =>
        s.atWill ? `${s.name} (at will)`
        : s.uses != null ? `${s.name} (×${s.uses})`
        : s.amount ? `${s.name} (×${s.amount.replace('×', '')})`
        : s.name
      ).join(', ')
      if (slot.label === 'Cantrips') {
        lines.push(`Cantrips ${spellList}`)
      } else {
        const lvl = slot.level
        const suffix = lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'
        lines.push(`${lvl}${suffix} ${spellList}`)
      }
    }
    lines.push('')
  }

  // Abilities
  for (const ab of c.abilities) {
    // Action cost arrives three ways — ab.activity as an ACT key ('R'), as a
    // glyph ('↺'), or as a glyph baked onto the name. Normalize all three to a
    // re-parseable "[reaction]"-style bracket.
    const { name: abName, glyph } = stripTrailingGlyph(ab.name)
    const cost = (ab.activity && ACT[ab.activity])
      || (ab.activity && ACT_GLYPHS[ab.activity])
      || (glyph && ACT_GLYPHS[glyph])
    const actLabel = cost ? ` [${cost}]` : ''
    const traits = ab.traits.length ? ` (${ab.traits.join(', ')})` : ''
    const body = ab.entries ? ` ${ab.entries}` : ''
    lines.push(`${abName}${actLabel}${traits}${body}`)
  }

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
