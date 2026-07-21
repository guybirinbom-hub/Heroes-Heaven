import type { Creature, Attack, Ability, SpellBlock, SpellSlotEntry, Defenses, RitualBlock } from '../types/pf2e'

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
]

function startsWithField(line: string): boolean {
  return FIELD_KEYWORDS.some(k => new RegExp(`^${k}\\b`, 'i').test(line))
}

function normalizeTrait(w: string): string {
  const u = w.toUpperCase().replace(/[^A-Z]/g, '')
  if (ALIGNMENTS.has(u)) return u
  if (SIZES.has(u)) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  return w.split(/[-\s]/).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

function parseBonus(s: string): number {
  const m = s.match(/([+-]\d+)/)
  return m ? parseInt(m[1]) : 0
}

// AoN uses both [one action] and [one-action]. Accept either.
// Returns the unicode action symbol that ActionGlyph + activitySymbol use
// elsewhere in the app (◆ / ◆◆ / ◆◆◆ / ◇ / ↺) — NOT a letter/number.
function parseActivity(s: string): string | undefined {
  const m = s.match(/\[(one[\s-]action|two[\s-]actions|three[\s-]actions|free[\s-]action|reaction)\]/i)
  if (!m) return undefined
  const key = m[1].toLowerCase().replace(/-/g, ' ')
  const map: Record<string, string> = {
    'one action':    '◆',
    'two actions':   '◆◆',
    'three actions': '◆◆◆',
    'free action':   '◇',
    'reaction':      '↺',
  }
  return map[key]
}

function parseSpellList(s: string): Array<{ name: string; uses?: number; atWill?: boolean }> {
  return s.split(',').flatMap(chunk => {
    let sp = chunk.trim()
    if (!sp) return []
    let atWill = false
    let uses: number | undefined
    // A trailing "(...)" note is either "(at will)" or a use count "(×3)" / "(3)".
    const noteM = sp.match(/\(([^)]*)\)\s*$/)
    if (noteM) {
      const note = noteM[1].toLowerCase()
      if (/at\s*will/.test(note)) atWill = true
      else { const am = note.match(/(?:×|x)?\s*(\d+)/); if (am) uses = parseInt(am[1], 10) }
      sp = sp.slice(0, noteM.index).trim()
    }
    if (!sp) return []
    const out: { name: string; uses?: number; atWill?: boolean } = { name: sp }
    if (atWill) out.atWill = true
    else if (uses !== undefined) out.uses = uses
    return [out]
  })
}

interface SpellState {
  name: string
  type: string
  tradition: string
  DC: number
  attack: number
  byLevel: Map<string, Array<{ name: string; uses?: number; atWill?: boolean }>>
}

export interface ParseResult {
  creature: Creature | null
  errors: string[]
  warnings: string[]
}

// Decide whether a line looks like a creature-trait line (size/alignment/type/etc).
// Traits lines are short, all-Title-case (or all-caps alignment), no descriptive text.
function looksLikeTraitsLine(line: string): boolean {
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

export function parseStatBlockText(text: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ── Pre-process: split, trim, drop blanks + skip markers ───────────────
  const rawLines = text.split('\n').map(l => l.trim())
  const lines: string[] = []
  for (const l of rawLines) {
    if (!l) continue
    if (SKIP_LINES.some(re => re.test(l))) continue
    lines.push(l)
  }

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

  const combinedM = lines[i].match(/^(.+?)\s+(?:CREATURE|HAZARD)\s+(-?\d+)\s*$/i)
  if (combinedM) {
    name = combinedM[1].trim()
    level = parseInt(combinedM[2])
    isHazard = /hazard/i.test(lines[i])
    i++
  } else if (i + 1 < lines.length) {
    const lvlM = lines[i + 1].match(/^(Creature|Hazard)\s+(-?\d+)\s*$/i)
    if (lvlM) {
      name = lines[i].trim()
      level = parseInt(lvlM[2])
      isHazard = /hazard/i.test(lvlM[1])
      i += 2
    }
  }
  if (!name) {
    errors.push(`Couldn't find the creature name and level. Expected "Name\\nCreature N" (AoN format) or "Name CREATURE N", got: "${lines[i]}"${lines[i + 1] ? ` + "${lines[i + 1]}"` : ''}`)
    return { creature: null, errors, warnings }
  }

  // ── State ──────────────────────────────────────────────────────────────
  let source = 'Homebrew'
  let recallKnowledge: string | undefined
  let traits: string[] = []
  let perception = 0
  const senses: string[] = []
  const languages: string[] = []
  const skills: Record<string, number> = {}
  let str = 0, dex = 0, con = 0, int = 0, wis = 0, cha = 0
  const items: string[] = []
  const speed: Creature['speed'] = { walk: 25 }
  let ac = 10, fort = 0, ref = 0, will = 0, hp = 10
  const immunities: string[] = []
  const resistances: Array<{ amount: number; name: string }> = []
  const weaknesses: Array<{ amount: number; name: string }> = []
  const attacks: Attack[] = []
  const abilities: Ability[] = []
  let rituals: RitualBlock | undefined
  let flavor: string | undefined
  const spellBlocks: SpellBlock[] = []

  let currentSpell: SpellState | null = null

  const finalizeSpell = () => {
    if (!currentSpell) return
    const spellsByLevel: SpellSlotEntry[] = []
    const entries = [...currentSpell.byLevel.entries()]
    entries.sort(([a], [b]) => {
      if (a === 'Cantrips') return -1
      if (b === 'Cantrips') return 1
      if (a.startsWith('Constant')) return 1
      if (b.startsWith('Constant')) return -1
      return (parseInt(a) || 0) - (parseInt(b) || 0)
    })
    for (const [label, spells] of entries) {
      const lvl = label === 'Cantrips' ? 0 : parseInt(label) || 0
      spellsByLevel.push({
        label: label === 'Cantrips' ? 'Cantrips' : `Level ${label}`,
        level: lvl,
        spells,
      })
    }
    spellBlocks.push({
      name: currentSpell.name,
      type: currentSpell.type,
      tradition: currentSpell.tradition,
      DC: currentSpell.DC,
      attack: currentSpell.attack,
      spells: '',
      spellsByLevel,
    })
    currentSpell = null
  }

  // ── Main pass ──────────────────────────────────────────────────────────
  while (i < lines.length) {
    const line = lines[i]

    // "Description" on its own line marks the creature's lore blurb (emitted
    // last by creatureToText). Everything after it is flavor; it's the final
    // section, so capture the rest and stop.
    if (/^Description\s*$/i.test(line)) {
      finalizeSpell()
      const rest = lines.slice(i + 1).join('\n').trim()
      if (rest) flavor = rest
      break
    }

    // Inside spellcasting block — collect level lines first.
    if (currentSpell) {
      const lvlM = line.match(/^(\d+)(?:st|nd|rd|th)\s+(.+)/i)
      const cantM = line.match(/^Cantrips?\s*(?:\([^)]*\)\s*)?(.+)/i)
      if (lvlM) {
        currentSpell.byLevel.set(lvlM[1], parseSpellList(lvlM[2]))
        i++; continue
      }
      if (cantM) {
        currentSpell.byLevel.set('Cantrips', parseSpellList(cantM[1]))
        i++; continue
      }
      finalizeSpell()
      // re-process this line below
    }

    i++ // consume

    // ── Source ────────────────────────────────────────────────────────────
    if (/^Source\s+/i.test(line)) {
      source = line.replace(/^Source\s+/i, '').trim()
      continue
    }

    // ── Recall Knowledge — store verbatim if present, else we'll compute ───
    if (/^Recall\s+Knowledge\b/i.test(line)) {
      recallKnowledge = line.replace(/^Recall\s+Knowledge\s*/i, '').trim()
      continue
    }

    // ── Traits line (only the first one we see, before stat fields) ──────
    if (!traits.length && looksLikeTraitsLine(line)) {
      traits = line.split(/\s+/).map(normalizeTrait).filter(Boolean)
      continue
    }

    // ── Perception ────────────────────────────────────────────────────────
    if (/^Perception\s/i.test(line)) {
      const m = line.match(/Perception\s+([+-]?\d+)(.*)/i)
      if (m) {
        perception = parseInt(m[1])
        const rest = m[2].replace(/^[;,\s]+/, '')
        if (rest) senses.push(...rest.split(';').map(s => s.trim()).filter(Boolean))
      }
      continue
    }

    // ── Languages ─────────────────────────────────────────────────────────
    if (/^Languages?\s/i.test(line)) {
      const rest = line.replace(/^Languages?\s+/i, '')
      languages.push(...rest.split(/[,;]/).map(s => s.trim()).filter(Boolean))
      continue
    }

    // ── Skills ────────────────────────────────────────────────────────────
    if (/^Skills?\s/i.test(line)) {
      const rest = line.replace(/^Skills?\s+/i, '')
      for (const m of rest.matchAll(/([A-Z][a-zA-Z ()]+?)\s+([+-]\d+)/g)) {
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
      items.push(...rest.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean))
      continue
    }

    // ── Speed ─────────────────────────────────────────────────────────────
    if (/^Speed\s+\d+/i.test(line)) {
      const walkM = line.match(/Speed\s+(\d+)/i)
      if (walkM) speed.walk = parseInt(walkM[1])
      const flyM   = line.match(/fly\s+(\d+)/i);    if (flyM)  speed.fly    = parseInt(flyM[1])
      const swimM  = line.match(/swim\s+(\d+)/i);   if (swimM) speed.swim   = parseInt(swimM[1])
      const burM   = line.match(/burrow\s+(\d+)/i); if (burM)  speed.burrow = parseInt(burM[1])
      const clmM   = line.match(/climb\s+(\d+)/i);  if (clmM)  speed.climb  = parseInt(clmM[1])
      continue
    }

    // ── AC + saves (may include trailing "+N status vs. ..." which is ignored) ─
    if (/^AC\s+\d+/i.test(line)) {
      ac   = parseInt(line.match(/AC\s+(\d+)/i)?.[1] ?? '10')
      fort = parseBonus(line.match(/Fort\s+([+-]\d+)/i)?.[1] ?? '+0')
      ref  = parseBonus(line.match(/Ref\s+([+-]\d+)/i)?.[1]  ?? '+0')
      will = parseBonus(line.match(/Will\s+([+-]\d+)/i)?.[1] ?? '+0')
      continue
    }

    // ── HP + immunities / resistances / weaknesses (all on one line) ─────
    if (/^HP\s+\d+/i.test(line)) {
      hp = parseInt(line.match(/HP\s+(\d+)/i)?.[1] ?? '10')
      for (const part of line.split(';')) {
        const p = part.trim()
        if (/^Immunities?/i.test(p)) {
          immunities.push(...p.replace(/^Immunities?\s+/i, '').split(',').map(s => s.trim()).filter(Boolean))
        } else if (/^Resistances?/i.test(p)) {
          for (const m of p.replace(/^Resistances?\s+/i, '').matchAll(/([a-z\s]+?)\s+(\d+)/gi))
            resistances.push({ name: m[1].trim(), amount: parseInt(m[2]) })
        } else if (/^Weaknesses?/i.test(p)) {
          for (const m of p.replace(/^Weaknesses?\s+/i, '').matchAll(/([a-z\s]+?)\s+(\d+)/gi))
            weaknesses.push({ name: m[1].trim(), amount: parseInt(m[2]) })
        }
      }
      continue
    }

    // ── Separate Immunities / Resistances / Weaknesses lines ─────────────
    if (/^Immunities?\s/i.test(line)) {
      immunities.push(...line.replace(/^Immunities?\s+/i, '').split(',').map(s => s.trim()).filter(Boolean))
      continue
    }
    if (/^Resistances?\s/i.test(line)) {
      for (const m of line.replace(/^Resistances?\s+/i, '').matchAll(/([a-z\s]+?)\s+(\d+)/gi))
        resistances.push({ name: m[1].trim(), amount: parseInt(m[2]) })
      continue
    }
    if (/^Weaknesses?\s/i.test(line)) {
      for (const m of line.replace(/^Weaknesses?\s+/i, '').matchAll(/([a-z\s]+?)\s+(\d+)/gi))
        weaknesses.push({ name: m[1].trim(), amount: parseInt(m[2]) })
      continue
    }

    // ── Melee / Ranged attacks ────────────────────────────────────────────
    if (/^(Melee|Ranged)\s+\[/i.test(line)) {
      const range = /^Melee/i.test(line) ? 'Melee' : 'Ranged' as 'Melee' | 'Ranged'
      // Drop the leading "Melee/Ranged [activity]"
      const afterAct = line.replace(/^(Melee|Ranged)\s+\[[^\]]*\]\s*/i, '')
      // Name + bonus: "jaws +45" (stops at the first MAP bracket like [+40/+35])
      const nameAtkM = afterAct.match(/^([^+([]+?)\s+([+-]\d+)/)
      const atkName  = nameAtkM ? nameAtkM[1].trim() : 'attack'
      const atkBonus = nameAtkM ? parseInt(nameAtkM[2]) : 0
      const traitM   = afterAct.match(/\(([^)]+)\)/)
      const atkTraits = traitM ? traitM[1].split(',').map(s => s.trim()) : []
      const damM     = afterAct.match(/Damage\s+(.+)/i)
      const rawDam   = damM ? damM[1].trim() : ''
      const TYPES    = /\b(bludgeoning|piercing|slashing|acid|cold|electricity|fire|force|negative|positive|sonic|mental|poison|bleed|spirit|vitality|void)\b/gi
      const damTypes: string[] = []
      const damFormula = rawDam
        .replace(TYPES, (_, t) => { damTypes.push(t); return '' })
        .replace(/\s+plus\s+$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      attacks.push({
        range, name: atkName, attack: atkBonus, traits: atkTraits,
        damage: damFormula || rawDam, types: damTypes, effects: [],
        isAgile: atkTraits.some(t => t.toLowerCase() === 'agile'),
      })
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
    const spellHeadM = line.match(
      /^(\w+)\s+(Prepared|Spontaneous|Innate|Focus)\s+Spells?\s+DC\s+(\d+)(?:.*?attack\s+([+-]\d+))?/i
    )
    if (spellHeadM) {
      finalizeSpell()
      currentSpell = {
        name: `${spellHeadM[1]} ${spellHeadM[2]} Spells`,
        type: spellHeadM[2],
        tradition: spellHeadM[1],
        DC: parseInt(spellHeadM[3]),
        attack: spellHeadM[4] ? parseInt(spellHeadM[4]) : 0,
        byLevel: new Map(),
      }
      continue
    }

    // ── Abilities (everything else) ───────────────────────────────────────
    if (line.length > 2 && !/^---+$/.test(line)) {
      const activity = parseActivity(line)
      const traitM = line.match(/\(([^)]+)\)/)
      const abilityTraits = traitM ? traitM[1].split(',').map(s => s.trim()) : []
      const { name: abilityName, rest } = extractAbilityName(line, name)

      // Clean the rest: strip the action bracket and the first trait paren block,
      // since those are rendered separately by the UI.
      let entries = rest
        .replace(/^\[[^\]]*\]\s*/, '')   // leading action bracket only
        .trim()
      if (traitM) entries = entries.replace(traitM[0], '').trim()

      // Tidy up: collapse double spaces and stray leading punctuation
      entries = entries.replace(/\s{2,}/g, ' ').replace(/^[,;:]\s*/, '').trim()

      abilities.push({
        name: abilityName,
        activity,
        traits: abilityTraits,
        entries,   // may be empty for action-only abilities like "Attack of Opportunity [reaction]"
      })
    }
  }

  finalizeSpell()

  const defenses: Defenses = { ac, fort, ref, will, hp, immunities, resistances, weaknesses }

  const creature: Creature = {
    id: uid(),
    name,
    source,
    level,
    traits,
    perception,
    senses,
    languages,
    skills,
    str, dex, con, int, wis, cha,
    items,
    speed,
    attacks,
    spellcasting: spellBlocks,
    rituals,
    abilities,
    defenses,
    isHazard,
    recallKnowledge,
    flavor,
    raw: {} as Creature['raw'],
  }

  return { creature, errors, warnings }
}
