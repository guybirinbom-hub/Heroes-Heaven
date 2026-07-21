import { describe, it, expect } from 'vitest'
import { parseStatBlockText } from './parseStatBlockText'
import type { ParseResult } from './parseStatBlockText'
import { creatureToText } from './creatureToText'
import { SAMPLE_COMBATANT } from '../data/sampleStatBlock'

// The sample lives as a fully-structured Creature; the text parser only takes a
// string, so we round-trip it through creatureToText (the inverse serializer the
// app pairs with this parser) and assert what parseStatBlockText recovers.
const sampleText = creatureToText(SAMPLE_COMBATANT.creature!)

function parse(text: string): ParseResult {
  return parseStatBlockText(text)
}

describe('parseStatBlockText — sample stat block round-trip', () => {
  const res = parse(sampleText)

  it('returns a creature with no errors', () => {
    expect(res.errors).toEqual([])
    expect(res.creature).not.toBeNull()
  })

  it('parses the name and level from the "Name CREATURE N" header', () => {
    expect(res.creature!.name).toBe('Emberscale Wyrm')
    expect(res.creature!.level).toBe(14)
    expect(res.creature!.isHazard).toBe(false)
  })

  it('parses AC', () => {
    expect(res.creature!.defenses.ac).toBe(38)
  })

  it('parses HP', () => {
    expect(res.creature!.defenses.hp).toBe(300)
  })

  it('parses the three saves (Fort / Ref / Will)', () => {
    expect(res.creature!.defenses.fort).toBe(28)
    expect(res.creature!.defenses.ref).toBe(25)
    expect(res.creature!.defenses.will).toBe(27)
  })

  it('parses all six ability modifiers', () => {
    const c = res.creature!
    expect(c.str).toBe(8)
    expect(c.dex).toBe(5)
    expect(c.con).toBe(7)
    expect(c.int).toBe(4)
    expect(c.wis).toBe(5)
    expect(c.cha).toBe(6)
  })

  it('parses perception and senses', () => {
    expect(res.creature!.perception).toBe(27)
    expect(res.creature!.senses).toEqual([
      'darkvision',
      'scent (imprecise) 60 feet',
      'smoke vision',
    ])
  })

  it('parses the traits line', () => {
    expect(res.creature!.traits).toEqual(['Uncommon', 'CE', 'Large', 'Dragon', 'Fire'])
  })

  it('parses languages and skills', () => {
    expect(res.creature!.languages).toEqual(['Common', 'Draconic', 'Ignan'])
    expect(res.creature!.skills).toMatchObject({
      Acrobatics: 24,
      Arcana: 25,
      Athletics: 28,
      Deception: 26,
      Intimidation: 27,
      Stealth: 24,
    })
  })

  it('parses the speeds', () => {
    expect(res.creature!.speed).toEqual({ walk: 40, fly: 120, swim: 40 })
  })

  it('parses at least one attack/action, with the first attack intact', () => {
    expect(res.creature!.attacks.length).toBeGreaterThanOrEqual(1)
    const jaws = res.creature!.attacks[0]
    expect(jaws.name).toBe('jaws')
    expect(jaws.range).toBe('Melee')
    expect(jaws.attack).toBe(30)
    expect(jaws.damage).toBe('3d12+15')
    expect(jaws.types).toContain('piercing')
  })

  it('parses all three attacks and flags the agile one', () => {
    const atk = res.creature!.attacks
    expect(atk.map(a => a.name)).toEqual(['jaws', 'claw', 'wing buffet'])
    const claw = atk.find(a => a.name === 'claw')!
    expect(claw.isAgile).toBe(true)
    expect(claw.traits).toContain('agile')
    const wing = atk.find(a => a.name === 'wing buffet')!
    expect(wing.range).toBe('Ranged')
    expect(wing.attack).toBe(28)
  })

  it('parses immunities / resistances / weaknesses off the HP line', () => {
    const d = res.creature!.defenses
    expect(d.immunities).toEqual(['fire', 'paralyzed', 'sleep'])
    expect(d.resistances).toEqual([{ name: 'physical', amount: 15 }])
    expect(d.weaknesses).toEqual([{ name: 'cold', amount: 15 }])
  })

  it('parses the innate spellcasting block (title-casing type and tradition)', () => {
    expect(res.creature!.spellcasting.length).toBe(1)
    const sb = res.creature!.spellcasting[0]
    // The parser Title-cases the captured words from "Arcane Innate Spells".
    expect(sb.type).toBe('Innate')
    expect(sb.tradition).toBe('Arcane')
    expect(sb.DC).toBe(35)
    expect(sb.attack).toBe(27)
    // Cantrips come first and are normalized to level 0.
    const cantrips = sb.spellsByLevel.find(s => s.label === 'Cantrips')!
    expect(cantrips.level).toBe(0)
    expect(cantrips.spells.map(s => s.name)).toEqual(['detect magic', 'light'])
    // Ranked entries get a "Level N" label and carry their use counts.
    const lvl4 = sb.spellsByLevel.find(s => s.label === 'Level 4')!
    expect(lvl4.level).toBe(4)
    expect(lvl4.spells).toEqual([
      { name: 'fireball', uses: 3 },
      { name: 'wall of fire', uses: 1 },
    ])
  })

  it('parses ability/action prose blocks with their traits', () => {
    const abilities = res.creature!.abilities
    expect(abilities.length).toBeGreaterThanOrEqual(1)
    const frightful = abilities.find(a => a.name === 'Frightful Presence')!
    expect(frightful).toBeDefined()
    expect(frightful.traits).toEqual(['aura', 'emotion', 'fear'])
    expect(frightful.entries).toContain('DC 33 Will save')
    const breath = abilities.find(a => a.name === 'Breath Weapon')!
    expect(breath).toBeDefined()
    expect(breath.traits).toEqual(['arcane', 'evocation', 'fire'])
    expect(breath.entries).toContain('40-foot cone')
  })

  it('defaults source to Homebrew and exposes empty warnings', () => {
    expect(res.creature!.source).toBe('Homebrew')
    expect(res.warnings).toEqual([])
  })

  // ── Characterized BUGS (asserted against current behavior, not fixed) ──────

  it('keeps an item with a comma inside parentheses intact (gp amount)', () => {
    // "hoarded gemstones (2,400 gp)" stays ONE item — the split ignores commas
    // inside a parenthetical.
    expect(res.creature!.items).toEqual([
      '+2 greater striking flaming greataxe',
      'breastplate',
      'hoarded gemstones (2,400 gp)',
    ])
  })

  it('round-trips the reaction "Attack of Opportunity" with its action cost', () => {
    // creatureToText serializes the "↺" activity as a "[reaction]" bracket, so
    // the bracket delimits the multi-word name and the cost survives.
    const names = res.creature!.abilities.map(a => a.name)
    expect(names).toContain('Attack of Opportunity')
    expect(names).not.toContain('Attack')
    const aoo = res.creature!.abilities.find(a => a.name === 'Attack of Opportunity')!
    expect(aoo.activity).toBe('↺')
    expect(aoo.entries).toBe(
      'The wyrm makes a melee Strike against the triggering creature.',
    )
  })
})

describe('parseStatBlockText — combined one-line header format', () => {
  it('parses "Name CREATURE N" all on one line', () => {
    const res = parse('Goblin Warrior CREATURE 1\nPerception +5\nAC 16; Fort +7, Ref +5, Will +3\nHP 13')
    expect(res.creature).not.toBeNull()
    expect(res.creature!.name).toBe('Goblin Warrior')
    expect(res.creature!.level).toBe(1)
    expect(res.creature!.isHazard).toBe(false)
  })

  it('parses a HAZARD header and flags isHazard', () => {
    const res = parse('Spike Trap HAZARD 3\nStealth +10\nAC 20; Fort +12, Ref +8, Will +5\nHP 0')
    expect(res.creature).not.toBeNull()
    expect(res.creature!.isHazard).toBe(true)
    expect(res.creature!.level).toBe(3)
    expect(res.creature!.name).toBe('Spike Trap')
  })

  it('handles a negative creature level', () => {
    const res = parse('Tiny Critter CREATURE -1\nPerception +0\nAC 12; Fort +2, Ref +4, Will +1\nHP 6')
    expect(res.creature).not.toBeNull()
    expect(res.creature!.level).toBe(-1)
  })

  it('parses the two-line AoN header format', () => {
    const res = parse('Tarrasque\nCreature 25\nPerception +44\nAC 49; Fort +43, Ref +35, Will +41\nHP 540')
    expect(res.creature).not.toBeNull()
    expect(res.creature!.name).toBe('Tarrasque')
    expect(res.creature!.level).toBe(25)
  })
})

describe('parseStatBlockText — degrades gracefully on bad input', () => {
  it('empty string does not throw and yields no creature + an error', () => {
    let res!: ParseResult
    expect(() => { res = parse('') }).not.toThrow()
    expect(res.creature).toBeNull()
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors[0]).toMatch(/Not enough content/i)
  })

  it('whitespace-only input is treated like empty', () => {
    const res = parse('   \n\n  \t  \n')
    expect(res.creature).toBeNull()
    expect(res.errors[0]).toMatch(/Not enough content/i)
  })

  it('a single non-header line is "not enough content"', () => {
    const res = parse('just one random line of text')
    expect(res.creature).toBeNull()
    expect(res.errors[0]).toMatch(/Not enough content/i)
  })

  it('multi-line prose that is not a stat block fails to find a name', () => {
    let res!: ParseResult
    expect(() => {
      res = parse('hello world this is just prose\nand a second line of nonsense\nwith a third for good measure')
    }).not.toThrow()
    expect(res.creature).toBeNull()
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors[0]).toMatch(/Couldn't find the creature name and level/i)
  })

  it('skips Legacy/Remaster/PFS metadata marker lines without throwing', () => {
    const res = parse('Legacy Content\nGoblin CREATURE 1\nPFS Note\nAC 16; Fort +7, Ref +5, Will +3\nHP 13')
    expect(res.creature).not.toBeNull()
    expect(res.creature!.name).toBe('Goblin')
    expect(res.creature!.level).toBe(1)
  })

  it('a header with no body still produces a creature with defaults', () => {
    // Two lines minimum is required; the combined header + one stat line clears it.
    const res = parse('Lonely Beast CREATURE 2\nAC 18')
    expect(res.creature).not.toBeNull()
    expect(res.creature!.name).toBe('Lonely Beast')
    // Untouched defenses fall back to the parser's seed defaults.
    expect(res.creature!.defenses.hp).toBe(10)
    expect(res.creature!.defenses.fort).toBe(0)
    expect(res.creature!.attacks).toEqual([])
  })
})
