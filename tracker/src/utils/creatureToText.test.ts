import { describe, expect, it } from 'vitest'
import { creatureToText } from './creatureToText'
import { parseStatBlockText } from './parseStatBlockText'
import { parseCreature, parseHazard } from './parseCreature'
import { toStatBlock } from '../data/dataStore'
import renderSamples from '../../../test/fixtures/corpus-render-samples.json'
import type { Ability, Creature, Defenses, RawCreature, RawHazard } from '../types/pf2e'

/*
 * D18 — the TextConverter's text path. Every text edit of a board combatant or a homebrew record is
 * creatureToText → (the GM's edit) → parseStatBlockText, so whatever the pair drops is lost from the
 * stat block on the first edit, even when the GM changed nothing. Each test below names what it
 * guards and what the code at cc7ff45 (before this round) did with it.
 */

type Sample = { id: string; kind: 'creature' | 'hazard'; record: Record<string, unknown> }
const SAMPLES = (renderSamples as unknown as { samples: Sample[] }).samples

/** The record the tracker serves (adapter + toStatBlock, as TextConverter seeds its text pane). */
const served = (s: Sample): Creature =>
  toStatBlock(JSON.parse(JSON.stringify(s.kind === 'hazard'
    ? parseHazard(s.record as unknown as RawHazard)
    : parseCreature(s.record as unknown as RawCreature))))!

const throughText = (c: Creature): Creature => {
  const res = parseStatBlockText(creatureToText(c))
  expect(res.creature, res.errors.join('; ')).not.toBeNull()
  return res.creature!
}

/**
 * A record as the stat block draws it. Left out: what a text edit does not carry and the stat block
 * does not draw from the record (id, source — kept by TextConverter.handleParse — raw, rawMarkdown,
 * aonUrl, image), a spell block's `spells` fallback string and a spell's `amount` (no renderer reads
 * either), and the tradition's case (not drawn). Folded: an action cost's surrounding spaces (the
 * adapter writes " ◆", ActionGlyph trims) and a strike's damage with its types (drawn side by side:
 * "2d6+7 piercing" either way).
 */
function drawn(c: Creature): unknown {
  const x = JSON.parse(JSON.stringify(c)) as Creature & Record<string, unknown>
  for (const k of ['id', 'source', 'raw', 'rawMarkdown', 'aonUrl', 'image']) delete x[k]
  for (const a of [...x.abilities, ...x.attacks]) a.activity = (a.activity ?? '').trim() || undefined
  for (const a of x.attacks) { a.damage = [a.damage, ...a.types].filter(Boolean).join(' '); a.types = [] }
  for (const sb of x.spellcasting) {
    sb.spells = ''
    sb.tradition = (sb.tradition ?? '').toLowerCase()
    for (const sl of sb.spellsByLevel) for (const sp of sl.spells) delete sp.amount
  }
  return JSON.parse(JSON.stringify(x))
}

/** Every path where two values differ ("defenses.hpPools.1.name: …"). */
function differences(a: unknown, b: unknown, path = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return [`${path}: ${a.length} item(s) → ${b.length}`]
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    return [...keys].flatMap(k => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k))
  }
  return [`${path}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`]
}

describe('a text edit keeps every verified corpus record whole (render fixture, 82 records)', () => {
  it('each record reads back field for field as the stat block draws it', () => {
    // Fails at cc7ff45 on every record: the text carried no HP pools, language abilities, Recall
    // Knowledge, page marker, ability sections, triggers, hazard sections, spell ranks / constants /
    // focus pools, notes (AC, saves, HP, speed), hardness or BT; multi-line ability text split into
    // extra abilities; a hazard grew "AC 0; Fort +0, Ref +0, Will +0" and "Speed 25 feet".
    const lost: string[] = []
    for (const s of SAMPLES) {
      const c = served(s)
      for (const d of differences(drawn(c), drawn(throughText(c)))) lost.push(`${s.id} ${c.name}: ${d}`)
    }
    expect(lost).toEqual([])
  })

  it('the comparison sees a lost field (mutation proof)', () => {
    const c = served(SAMPLES.find(s => s.id === 'creature-3064')!) // Hydra: two HP pools
    const back = throughText(c)
    back.defenses.hpPools = back.defenses.hpPools!.slice(0, 1)
    expect(differences(drawn(c), drawn(back)).join('\n')).toMatch(/defenses\.hpPools/)
    const back2 = throughText(c)
    back2.abilities[0] = { ...back2.abilities[0], slot: undefined }
    expect(differences(drawn(c), drawn(back2)).join('\n')).toMatch(/abilities\.0\.slot/)
  })
})

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'ct', name: 'Synthetic Warden', source: 'Test', level: 1,
    traits: ['Medium', 'Humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
    str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...DEF }, isHazard: false, raw: {} as Creature['raw'], ...over,
  }
}
const hazard = (def: Partial<Defenses>, over: Partial<Creature> = {}): Creature => creature({
  name: 'Synthetic Trap', traits: ['Mechanical', 'Trap'], isHazard: true, languages: [], speed: {},
  perception: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
  defenses: { ac: 0, fort: 0, ref: 0, will: 0, hp: 0, immunities: [], resistances: [], weaknesses: [], ...def },
  hazardData: { stealth: 'DC 20 (trained)', description: 'A synthetic trap.', disable: 'Thievery DC 20', routine: '', reset: '', complex: false },
  ...over,
})

describe('what the text carries (D18)', () => {
  it('language abilities after ";" on the Languages line', () => {
    // cc7ff45: languageAbilities was not written; telepathy vanished from the Languages line.
    const back = throughText(creature({ languageAbilities: ['telepathy 100 feet'] }))
    expect(back.languages).toEqual(['Common'])
    expect(back.languageAbilities).toEqual(['telepathy 100 feet'])
    const only = throughText(creature({ languages: [], languageAbilities: ['truespeech'] }))
    expect(only.languages).toEqual([])
    expect(only.languageAbilities).toEqual(['truespeech'])
  })

  it('every HP pool with its note, hardness and BT', () => {
    // cc7ff45: "HP 90" only — the head pool, the notes, Hardness and BT were dropped.
    const text = creatureToText(creature({
      defenses: { ...DEF, hp: 90, hardness: 5, bt: 45, hpNote: 'body, hydra regeneration',
        hpPools: [{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }] },
    }))
    expect(text).toContain('Hardness 5; HP 90 body, hydra regeneration; 15 (head, head regrowth); BT 45')
    const d = parseStatBlockText(text).creature!.defenses
    expect(d.hpPools).toEqual([{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }])
    expect([d.hp, d.hpNote, d.hardness, d.bt]).toEqual([90, 'body, hydra regeneration', 5, 45])
  })

  it('a pool note holding ";" and brackets stays one note', () => {
    const pools = [{ hp: 340, name: 'body' }, { hp: 35, name: 'head, head regrowth; Immunities area damage; Weakness slashing 10' }, { hp: 20, name: 'tentacle, (tentacle regrowth)' }]
    const back = throughText(creature({ defenses: { ...DEF, hp: 340, hpNote: '(body)', hpPools: pools } }))
    expect(back.defenses.hpPools).toEqual(pools)
    expect(back.defenses.hpNote).toBe('(body)')
    expect(back.defenses.immunities).toEqual([])
  })

  it('the page Recall Knowledge line and the page marker', () => {
    // cc7ff45: neither was written, so the row was recomputed from level (a DC the page never printed),
    // and a page record whose page prints no Recall Knowledge grew a computed row.
    const back = throughText(creature({ fromArchivesPage: true, recallKnowledge: 'DC 18 • Humanoid (Society)' }))
    expect(back.recallKnowledge).toBe('DC 18 • Humanoid (Society)')
    expect(back.fromArchivesPage).toBe(true)
    const none = throughText(creature({ fromArchivesPage: true }))
    expect(none.recallKnowledge).toBeUndefined()
    expect(none.fromArchivesPage).toBe(true)
    // A hand-built record stays page-less: its row is computed, as before.
    expect(throughText(creature()).fromArchivesPage).toBeUndefined()
  })

  it('a hazard with no AC line reads back with no AC (acPrinted false, ac 0) and only its printed saves', () => {
    // cc7ff45: every hazard was written "AC 0; Fort +0, Ref +0, Will +0" and read back as printed.
    const text = creatureToText(hazard({ hp: 30, fort: 12, ref: 8, acPrinted: false, savesPrinted: ['fort', 'ref'] }))
    expect(text).not.toMatch(/^AC /m)
    const d = parseStatBlockText(text).creature!.defenses
    expect(d.acPrinted).toBe(false)
    expect(d.ac).toBe(0)
    expect(d.savesPrinted).toEqual(['fort', 'ref'])
    expect([d.fort, d.ref]).toEqual([12, 8])
    const bare = throughText(hazard({ acPrinted: false, savesPrinted: [] })).defenses
    expect([bare.acPrinted, bare.ac, bare.savesPrinted, bare.hp, bare.hpPools]).toEqual([false, 0, [], 0, undefined])
  })

  it('a hazard printing AC and only Fort keeps exactly those', () => {
    const d = throughText(hazard({ ac: 20, hp: 30, fort: 10, acPrinted: true, savesPrinted: ['fort'] })).defenses
    expect([d.acPrinted, d.ac, d.savesPrinted]).toEqual([true, 20, ['fort']])
  })

  it("a hazard's Stealth, Description, Disable, Routine, Reset and complexity, and no Speed / Perception", () => {
    // cc7ff45: hazardData was not written at all; the hazard came back with "Speed 25 feet".
    const h = hazard({ hp: 24, bt: 12, hardness: 6, acPrinted: true, ac: 15, savesPrinted: ['fort'], fort: 8 }, {
      hazardData: { stealth: '—', description: 'Line one.\nLine two.', disable: 'Thievery DC 17', routine: '(2 actions) The trap swings.\nMelee blade +12, Damage 1d8', reset: 'It resets.', complex: true },
    })
    const back = throughText(h)
    expect(back.hazardData).toEqual(h.hazardData)
    expect(back.speed).toEqual({})
    expect(back.perception).toBe(0)
    expect(back.attacks).toEqual([])
  })

  it('ability sections ("---") come back in the same sections and order; a slot-less record stays slot-less', () => {
    // cc7ff45: Ability.slot was dropped; every ability moved to the bottom after a text edit.
    const ab = (name: string, slot?: Ability['slot']): Ability => ({ name, traits: [], entries: `${name} body text.`, ...(slot ? { slot } : {}) })
    const page = throughText(creature({ abilities: [ab('Topaura', 'top'), ab('Midreact', 'mid'), ab('Botpower', 'bot'), ab('Botsecond', 'bot')] }))
    expect(page.abilities.map(a => [a.name, a.slot, a.entries])).toEqual([
      ['Topaura', 'top', 'Topaura body text.'], ['Midreact', 'mid', 'Midreact body text.'],
      ['Botpower', 'bot', 'Botpower body text.'], ['Botsecond', 'bot', 'Botsecond body text.'],
    ])
    const hand = throughText(creature({ abilities: [ab('Firstone'), ab('Secondone')] }))
    expect(hand.abilities.map(a => a.slot)).toEqual([undefined, undefined])
  })

  it('an ability keeps its name, cost, traits, trigger and every text line', () => {
    // cc7ff45: a name with a lower-case word and no bracket after it ("Breath of Fire The warden …")
    // read back as "Breath", a text naming the creature cut the name there ("Camouflage The"), the
    // trigger was dropped, and each further text line became an ability of its own ("Stage 1 …").
    const abilities: Ability[] = [
      { name: 'Breath of Life', activity: '↺', traits: ['divine', 'healing'], trigger: 'An ally dies.', entries: 'Frequency once per day\nEffect The warden revives it.' },
      { name: 'Breath of Fire', traits: [], entries: 'The warden exhales a cone of flame.' },
      { name: 'Camouflage', activity: '', traits: [], entries: 'The synthetic warden can Hide in plain sight.' },
      { name: 'Cladis Poison', traits: ['poison'], entries: 'Saving Throw DC 19 Fortitude\nMaximum Duration 4 hours\nStage 1 1d6 poison damage\n\n  indented line\nTrigger is a word here' },
      { name: 'Reactive Strike', activity: ' ↺', traits: [], entries: '(see reactive heads)' },
      { name: 'Speed Burst', activity: ' ◆ to ◆◆◆', traits: [], entries: 'Speed 30 feet is how it starts.' },
      { name: 'Description', traits: [], entries: 'An ability named like a stat label.' },
    ]
    const back = throughText(creature({ abilities }))
    expect(back.abilities.map(a => ({ ...a, activity: (a.activity ?? '').trim() || undefined }))).toEqual(
      abilities.map(a => ({ ...a, activity: (a.activity ?? '').trim() || undefined })))
  })

  it('spell blocks keep their name, type, DC, attack, focus pool, cantrip rank, constants, slots and notes', () => {
    // cc7ff45: "Champion Devotion Spells" was not a spell heading (read as an ability), constants and
    // cantrip ranks were lost, notes ("self only") were dropped and an absent attack read as +0.
    const spellcasting: Creature['spellcasting'] = [
      { name: 'Divine Innate Spells', type: 'Innate', tradition: 'Divine', DC: 29, spells: '', spellsByLevel: [
        { label: 'Cantrips', level: 3, isCantrip: true, spells: [{ name: 'Light' }] },
        { label: 'Level 2', level: 2, spells: [{ name: 'Invisibility', atWill: true, note: 'self only' }] },
        { label: 'Level 4', level: 4, spells: [{ name: 'Heal', uses: 3 }, { name: 'Plane Shift', note: 'self only; to or from the Shadow Plane only' }] },
        { label: 'Constant (5th)', level: 5, isConstant: true, spells: [{ name: 'Tongues' }] },
      ] },
      { name: 'Champion Devotion Spells', type: 'Focus', tradition: '', DC: 20, focusPoints: 2, spells: '', spellsByLevel: [
        { label: 'Level 3', level: 3, spells: [{ name: 'Lay on Hands' }] },
      ] },
      { name: 'Primal Spontaneous Spells', type: 'Spontaneous', tradition: 'Primal', DC: 17, attack: 9, spells: '', spellsByLevel: [
        { label: 'Level 1', level: 1, slots: 3, spells: [{ name: 'Heal' }] },
      ] },
      { name: 'Witch Hexes', type: 'Focus', tradition: 'occult', DC: 18, spells: '', spellsByLevel: [
        { label: 'Level 1', level: 1, spells: [{ name: 'Evil Eye' }] },
      ] },
    ]
    const back = throughText(creature({ spellcasting }))
    expect(back.spellcasting).toEqual(spellcasting)
    expect(back.abilities).toEqual([])
  })

  it("a strike's cost, traits, damage, effects; a hazard's strike stays at its place among the abilities", () => {
    // cc7ff45: every strike was written "[one action]" and read back with no cost, a damage note in
    // brackets became the strike's traits, effects were dropped, and a hazard's strike lost its place.
    const h = hazard({ hp: 10 }, {
      abilities: [{ name: 'Spring', activity: '↺', traits: [], trigger: 'A creature opens it.', entries: 'Effect A spine attacks.' }, { name: 'Cladis Poison', traits: [], entries: 'Stage 1 1d6 poison' }],
      attacks: [
        { range: 'Melee', name: 'spine', attack: 13, traits: [], damage: '1 piercing plus cladis poison (on a critical hit, doubled)', types: [], effects: [], isAgile: false, afterAbility: 1 },
        { range: 'Melee', name: 'jaws', attack: 17, activity: '◆', traits: ['reach 10 feet'], damage: '', types: [], effects: ['devour'], isAgile: false, afterAbility: 2 },
      ],
    })
    expect(throughText(h).attacks).toEqual(h.attacks)
  })

  it('the description keeps its blank lines', () => {
    // cc7ff45: blank lines were dropped, so paragraphs ran together.
    expect(throughText(creature({ flavor: 'First paragraph.\n\nSecond paragraph.' })).flavor).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('perception, AC, save and speed notes; IWR with notes and no amount; multi-word and lower-case traits', () => {
    // cc7ff45: all of these were dropped (traits "No Alignment" split in two, "uncommon" read as an
    // ability, a weakness with no number lost, "except silver" lost).
    const c = creature({
      traits: ['No Alignment', 'uncommon', 'Medium'], perceptionNote: '+2 when rolling initiative', senses: ['darkvision', 'scent (imprecise) 30 feet'],
      speed: { fly: 20 }, speedNote: 'troop movement',
      skills: { 'lore (all)': 28, 'brevoy lore': 6, Athletics: 9 },
      defenses: { ...DEF, acNote: '(26 when broken); construct armor', saveNote: '+1 status to all saves vs. magic',
        immunities: ['critical hits'], resistances: [{ amount: 5, name: 'physical', note: 'except silver' }], weaknesses: [{ amount: null, name: 'vampire weaknesses' }] },
    })
    const back = throughText(c)
    expect(back.traits).toEqual(c.traits)
    expect([back.perceptionNote, back.senses, back.speed, back.speedNote, back.skills]).toEqual([c.perceptionNote, c.senses, c.speed, c.speedNote, c.skills])
    // Fix round 5: no invented { hpPools: [{ hp: 40 }] } (round 4 gave a builder record a pool).
    expect(back.defenses).toEqual(c.defenses)
  })
})

describe('fix round 5: the round-4 refuter findings on the text path', () => {
  // Each test fails on the round-4 files (named per test).
  const BLOCK = [
    'Synthetic Bog Lurker', 'Creature 3', 'Medium Beast', 'Perception +9; darkvision', 'Languages Common',
    'Str +4, Dex +1, Con +3, Int -2, Wis +1, Cha +0', 'Swamp Reek (aura) 10 feet. A creature in the aura is sickened 1.',
    'AC 19; Fort +12, Ref +7, Will +9', 'HP 50', 'Speed 20 feet, swim 30 feet',
    'Melee [one-action] jaws +12, Damage 1d10+6 piercing', 'Drag Under [two-actions] The lurker pulls a creature down.',
  ]
  const facts = (c: Creature) => ({
    ac: c.defenses.ac, hp: c.defenses.hp, saves: [c.defenses.fort, c.defenses.ref, c.defenses.will], speed: c.speed,
    strikes: c.attacks.map(a => [a.name, a.attack, a.damage, a.types]), abilities: c.abilities.map(a => [a.name, a.entries]),
  })
  const read = (t: string) => parseStatBlockText(t).creature!

  it('a block indented on every line (spaces, a tab, or all but a first line cut mid-line) reads as unindented', () => {
    // Round 4: every line after "Swamp Reek" continued that ability (AC 10, HP 10, no strike).
    const plain = facts(read(BLOCK.join('\n')))
    expect(plain.ac).toBe(19)
    expect(plain.strikes).toEqual([['jaws', 12, '1d10+6', ['piercing']]])
    expect(facts(read(BLOCK.map(l => `    ${l}`).join('\n')))).toEqual(plain)
    expect(facts(read(BLOCK.map(l => `\t${l}`).join('\n')))).toEqual(plain)
    expect(facts(read(BLOCK.map((l, k) => (k ? `  ${l}` : l)).join('\n')))).toEqual(plain)
  })

  it('a line indented deeper than the shared indent still continues the ability above it', () => {
    // Guard for the fix: the shared indent is stripped, a deeper one is still a continuation.
    const lines = [...BLOCK.slice(0, -1), 'Drag Under [two-actions] The lurker pulls a creature down.', '  It holds its breath.']
    const indented = read(lines.map(l => `  ${l}`).join('\n'))
    expect(indented.abilities.map(a => [a.name, a.entries])).toEqual([
      ['Swamp Reek', '10 feet. A creature in the aura is sickened 1.'],
      ['Drag Under', 'The lurker pulls a creature down.\nIt holds its breath.'],
    ])
  })

  it('a save with its own bracket keeps the saves after it; the bracket stays in the save note', () => {
    // Round 4: "Ref +22 (+24 vs. traps), Will +18" read Will 0 with the rest as the save note.
    const d = read('Synthetic Sentinel CREATURE 6\nPerception +12\nAC 30; Fort +20, Ref +22 (+24 vs. traps), Will +18; +1 status vs. magic\nHP 90').defenses
    expect([d.fort, d.ref, d.will, d.saveNote]).toEqual([20, 22, 18, 'Ref (+24 vs. traps); +1 status vs. magic'])
    const h = read('Synthetic Rust Trap HAZARD 3\nStealth DC 20 (trained)\nFort +10 (+12 vs. rust), Ref +5\nHP 30').defenses
    expect([h.fort, h.ref, h.savesPrinted, h.acPrinted]).toEqual([10, 5, ['fort', 'ref'], false])
    // The note survives a text edit unchanged.
    const c = creature({ defenses: { ...DEF, saveNote: 'Ref (+24 vs. traps); +1 status vs. magic' } })
    expect(throughText(c).defenses).toEqual(c.defenses)
  })

  it("a strike's separate damage types survive a text edit whatever its damage text says", () => {
    // Round 4: "2d8+6 plus Grab" typed piercing came back as "2d8+6 plus Grab piercing", types [].
    const strike = (damage: string, types: string[]) => ({ range: 'Melee' as const, name: 'jaws', attack: 10, traits: [], damage, types, effects: [], isAgile: false })
    for (const [damage, types] of [
      ['2d8+6 plus Grab', ['piercing']], ['1d8+4 plus 1d6 fire', ['slashing']], ['2d6+4', ['piercing']],
      ['1 piercing plus cladis poison', []], ['2d6 fire', []], ['', ['piercing']], ['1d4', ['cold', 'fire']],
    ] as Array<[string, string[]]>) {
      const back = throughText(creature({ attacks: [strike(damage, types)] })).attacks[0]
      expect([back.damage, back.types], `${damage} / ${types}`).toEqual([damage, types])
    }
    // The plain AoN form is kept whenever it reads back the same.
    expect(creatureToText(creature({ attacks: [strike('2d6+4', ['piercing'])] }))).toContain('Damage 2d6+4 piercing')
    expect(creatureToText(creature({ attacks: [strike('2d8+6 plus Grab', ['piercing'])] }))).toContain('Damage 2d8+6 plus Grab; types piercing')
  })

  it('one unnamed HP pool: a page record keeps it, a hand-built record gains none', () => {
    // Round 4: every HP line wrote hpPools, so a builder record grew [{ hp }] on its first text edit.
    expect(throughText(creature()).defenses.hpPools).toBeUndefined()
    expect(throughText(creature({ fromArchivesPage: true, defenses: { ...DEF, hpPools: [{ hp: 40 }] } })).defenses.hpPools).toEqual([{ hp: 40 }])
    // A hazard keeps it (served hazards carry no page marker; the render-fixture test above holds 13).
    expect(throughText(hazard({ hp: 30, hpPools: [{ hp: 30 }] })).defenses.hpPools).toEqual([{ hp: 30 }])
  })
})
