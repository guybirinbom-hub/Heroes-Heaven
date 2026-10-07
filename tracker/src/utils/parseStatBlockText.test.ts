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

  it('parses immunities / resistances / weaknesses, a resistance keeping its note', () => {
    const d = res.creature!.defenses
    expect(d.immunities).toEqual(['fire', 'paralyzed', 'sleep'])
    // D18: the sample's own resistance is "physical 15 (except cold iron)". Until fix round 4 this
    // test pinned the note being DROPPED ({ name, amount } only) — the text path lost it, and the
    // stat block drew "physical 15" after a text edit. It now asserts the record's own value.
    expect(d.resistances).toEqual([{ name: 'physical', amount: 15, note: 'except cold iron' }])
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
    // Cantrips come first, at the rank they are heightened to. D18: the sample's cantrips are
    // heightened to rank 4 ("Cantrips (4th)"); until fix round 4 this test pinned them flattened to
    // level 0 with no isCantrip flag, so a text edit turned them into tracked rank-0 spells.
    const cantrips = sb.spellsByLevel.find(s => s.label === 'Cantrips')!
    expect(cantrips.level).toBe(4)
    expect(cantrips.isCantrip).toBe(true)
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

// ── D18 (fix round 4): what a PASTED block now reads, and what it still reads as before ──────────
describe('parseStatBlockText — pasted AoN blocks (D18)', () => {
  it('reads the help dialog example: an indented Damage line, an indented line continuing an ability', () => {
    // cc7ff45: "Damage 1d6-1 slashing" became an ability named "Damage" and the strike had no damage;
    // "action adjacent to the goblin; …" became an ability of its own.
    const c = parse(`Goblin Warrior CREATURE 1
CE SMALL GOBLIN HUMANOID
Perception +3; darkvision
AC 16; Fort +6, Ref +8, Will +3
HP 12
Speed 25 feet
Melee [one action] dogslicer +7 (agile, finesse),
  Damage 1d6-1 slashing

Goblin Scuttle [reaction] Trigger An ally ends a move
  action adjacent to the goblin; Effect The goblin Steps.`).creature!
    expect(c.attacks).toHaveLength(1)
    expect([c.attacks[0].damage, c.attacks[0].types, c.attacks[0].activity]).toEqual(['1d6-1', ['slashing'], '◆'])
    expect(c.abilities.map(a => a.name)).toEqual(['Goblin Scuttle'])
    expect(c.abilities[0].entries).toBe('Trigger An ally ends a move\naction adjacent to the goblin; Effect The goblin Steps.')
  })

  it('a hazard defence line in the AoN form: "Hardness 6, HP 24 (BT 12); Immunities …"', () => {
    // cc7ff45: a line starting "Hardness" was read as an ability; hardness and HP were lost.
    const d = parse('Poison Lock HAZARD 1\nStealth DC 17 (trained)\nAC 15; Fort +8, Ref +4\nHardness 6, HP 24 (BT 12); Immunities critical hits, object immunities').creature!.defenses
    expect([d.hardness, d.hp, d.immunities]).toEqual([6, 24, ['critical hits', 'object immunities']])
    expect(d.hpPools).toEqual([{ hp: 24, name: 'BT 12' }])
  })

  it('a pasted hazard with a save line and no AC line has no AC (no "AC 10" default)', () => {
    // cc7ff45: ac stayed 10 and the save line "Fort +8, Ref +4" was read as an ability.
    const c = parse('Haunted Bell HAZARD 2\nStealth +10\nFort +8, Ref +4\nHP 10').creature!
    expect([c.defenses.acPrinted, c.defenses.ac, c.defenses.savesPrinted, c.defenses.fort, c.defenses.ref]).toEqual([false, 0, ['fort', 'ref'], 8, 4])
    expect(c.abilities).toEqual([])
    expect(c.hazardData?.stealth).toBe('+10')
  })

  it('an HP note, a save note, an AC note, a speed note and language abilities', () => {
    // cc7ff45: each of these was dropped (the regeneration note, "+1 status …", "(19 when broken)",
    // "air walk"); "telepathy 100 feet" was read as a language.
    const c = parse(`Troll Sample CREATURE 5
Perception +11; darkvision
Languages Common, Jotun; telepathy 100 feet
AC 20 (19 when broken); Fort +17, Ref +11, Will +7; +1 status to all saves vs. magic
HP 115, regeneration 20 (deactivated by acid or fire); Weaknesses fire 10, cold iron
Speed 30 feet, fly 30 feet; air walk`).creature!
    expect(c.languages).toEqual(['Common', 'Jotun'])
    expect(c.languageAbilities).toEqual(['telepathy 100 feet'])
    expect([c.defenses.acNote, c.defenses.saveNote, c.defenses.hpNote]).toEqual(['(19 when broken)', '+1 status to all saves vs. magic', 'regeneration 20 (deactivated by acid or fire)'])
    expect(c.defenses.weaknesses).toEqual([{ name: 'fire', amount: 10 }, { name: 'cold iron', amount: null }])
    expect([c.speed, c.speedNote]).toEqual([{ walk: 30, fly: 30 }, 'air walk'])
  })

  it('a record with no traits line does not take an ability as its traits', () => {
    // cc7ff45: "Shield Block" (Title-case words) was read as the traits of a record with none.
    const c = parse('Plain Guard CREATURE 1\nPerception +5\nAC 16; Fort +7, Ref +5, Will +3\nHP 13\nShield Block\nAttack of Opportunity [reaction]').creature!
    expect(c.traits).toEqual([])
    expect(c.abilities.map(a => a.name)).toEqual(['Shield Block', 'Attack of Opportunity'])
  })

  it('the AoN one-line spell block reads its ranks; any heading "… Spells DC n …" is still a spell block', () => {
    // cc7ff45: the heading was read but its inline ranks ("; 4th dimension door") were dropped.
    const c = parse('Caster CREATURE 7\nPerception +12\nArcane Innate Spells DC 25, attack +17; 4th dimension door (×2); Cantrips (4th) light, mage hand\nArcane Prepared Spells DC 27 (Int), attack +19\n3rd fireball').creature!
    expect(c.spellcasting.map(s => [s.name, s.type, s.DC, s.attack])).toEqual([
      ['Arcane Innate Spells', 'Innate', 25, 17], ['Arcane Prepared Spells', 'Prepared', 27, 19],
    ])
    expect(c.spellcasting[0].spellsByLevel).toEqual([
      { label: 'Cantrips', level: 4, isCantrip: true, spells: [{ name: 'light' }, { name: 'mage hand' }] },
      { label: 'Level 4', level: 4, spells: [{ name: 'dimension door', uses: 2 }] },
    ])
    expect(c.spellcasting[1].spellsByLevel.map(s => s.label)).toEqual(['Level 3'])
    expect(c.abilities).toEqual([])
  })

  it('guard: an ability whose name starts with "Melee" or "Ranged" is not read as a strike', () => {
    // A strike without a cost bracket is read since fix round 4 ("Melee spine +13, Damage 1"); the
    // name is then at most four words or a Damage clause follows, so this stays an ability.
    const c = parse('Sword Saint CREATURE 3\nPerception +8\nMelee Mastery The saint gains a +2 circumstance bonus to attack rolls with melee weapons.\nMelee spine +13, Damage 1d6 piercing').creature!
    expect(c.abilities.map(a => a.name)).toEqual(['Melee Mastery'])
    expect(c.attacks.map(a => [a.name, a.attack, a.activity])).toEqual([['spine', 13, undefined]])
  })

  it('guard: a pasted block without "---" keeps its abilities slot-less (drawn at the bottom, as before)', () => {
    const c = parse('Plain Guard CREATURE 1\nMedium Humanoid\nPerception +5\nAura of Calm (aura) 10 feet.\nAC 16; Fort +7, Ref +5, Will +3\nHP 13\nAttack of Opportunity [reaction]').creature!
    expect(c.abilities.map(a => [a.name, a.slot])).toEqual([['Aura of Calm', undefined], ['Attack of Opportunity', undefined]])
  })

  it('guard: text written by the previous creatureToText (cc7ff45) still reads the same', () => {
    const c = parse(`Old Text Brute CREATURE 3
N MEDIUM
Perception +9; darkvision
Languages Common
Skills Athletics +11
Str +4, Dex +1, Con +3, Int -1, Wis +1, Cha +0
Items club

AC 18; Fort +12, Ref +7, Will +9
HP 50; Immunities fire; Resistances cold 5; Weaknesses acid 5

Speed 25 feet

Melee [one action] club +12, Damage 1d6+6 bludgeoning
Arcane Innate Spells DC 20, attack +12
Cantrips light
2nd darkness (×2)

Attack of Opportunity [reaction] The brute strikes.`).creature!
    expect(c.traits).toEqual(['N', 'Medium'])
    expect([c.defenses.ac, c.defenses.hp, c.defenses.immunities, c.defenses.resistances, c.defenses.weaknesses])
      .toEqual([18, 50, ['fire'], [{ name: 'cold', amount: 5 }], [{ name: 'acid', amount: 5 }]])
    expect([c.attacks[0].name, c.attacks[0].damage, c.attacks[0].types]).toEqual(['club', '1d6+6', ['bludgeoning']])
    expect(c.spellcasting[0].spellsByLevel.map(s => [s.label, s.spells])).toEqual([
      ['Cantrips', [{ name: 'light' }]], ['Level 2', [{ name: 'darkness', uses: 2 }]],
    ])
    expect(c.abilities.map(a => [a.name, a.activity, a.entries])).toEqual([['Attack of Opportunity', '↺', 'The brute strikes.']])
  })
})
