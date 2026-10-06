import { describe, it, expect } from 'vitest'
import { parseCreature, parseHazard } from './parseCreature'
import type { RawCreature, RawHazard } from '../types/pf2e'
import samples from './__fixtures__/corpus-adapter-samples.json'
import renderSamples from '../../../test/fixtures/corpus-render-samples.json'

// Real records copied verbatim from the verified bestiary corpus (hh-bestiary-corpus). Each test
// pins one adapter field that docs/APP-DEFECTS.md (in the corpus) measured as lost or wrong, and
// says why it fails on the adapter before this change (base 7cfb323).
const C = samples.creatures as unknown as Record<string, RawCreature>
const H = samples.hazards as unknown as Record<string, RawHazard>
/** A verified corpus record from the end-to-end render fixture (test/fixtures), by its id. */
const R = (id: string): RawHazard => {
  const s = (renderSamples as unknown as { samples: Array<{ id: string; record: unknown }> }).samples.find(x => x.id === id)
  if (!s) throw new Error(`${id} is not in the render fixture`)
  return s.record as RawHazard
}

describe('parseCreature on corpus records', () => {
  it('keeps every HP pool in page order and leaves hp/hpNote on the first (Hydra)', () => {
    // Before: hpPools was never set, so the head pool (15, head regrowth) vanished.
    const c = parseCreature(C.multiPool)
    expect(c.name).toBe('Hydra')
    expect(c.defenses.hpPools).toEqual([
      { hp: 90, name: 'body, hydra regeneration' },
      { hp: 15, name: 'head, head regrowth' },
    ])
    expect(c.defenses.hp).toBe(90)
    expect(c.defenses.hpNote).toBe('body, hydra regeneration')
  })

  it('tags each ability with the page section it was printed in, in page order (Elysian Sheep)', () => {
    // Before: abilities carried no slot, so the renderer drew top and mid abilities after strikes.
    const c = parseCreature(C.topMidBot)
    expect(c.abilities.map(a => [a.name, a.slot])).toEqual([
      ['Nimble Grazer', 'top'],
      ['Cowardly', 'mid'],
      ['Trample', 'bot'],
    ])
  })

  it('keeps the slot on every part splitMergedAbility cuts out of one entry', () => {
    // Before: neither the source ability nor its split parts carried a slot.
    const raw: RawCreature = {
      ...C.topMidBot,
      abilities: {
        top: [],
        mid: [{ name: 'Fortune’s Friend', entries: ['Trigger An ally fails.\nMocking Laughter (auditory) The sheep bleats.'] }],
        bot: [],
      },
    } as RawCreature
    const c = parseCreature(raw)
    expect(c.abilities.length).toBeGreaterThan(1)
    expect(c.abilities.every(a => a.slot === 'mid')).toBe(true)
  })

  it('carries languages.abilities as languageAbilities, and none when the page prints none', () => {
    // Before: the Grandfather Mantis expectation fails (raw.languages.abilities was dropped, so
    // telepathy never reached the sheet); the Hydra guard (no empty [] on the record) held before.
    const c = parseCreature(C.languageAbilities)
    expect(c.languages).toEqual(['Arcadian'])
    expect(c.languageAbilities).toEqual(['telepathy 100 feet'])
    expect('languageAbilities' in parseCreature(C.multiPool)).toBe(false)
  })

  it('reads a creature’s Hardness (Animated Axe)', () => {
    // Before: parseCreature dropped def.hardness for creatures (only parseHazard read it).
    expect(parseCreature(C.hardness).defenses.hardness).toBe(8)
  })

  it('takes Recall Knowledge from the page sidebar, shaped like the computed row (Svetlana)', () => {
    // Before: recallKnowledge was never set for Archives records; the row was computed from level.
    expect(parseCreature(C.recallSingle).recallKnowledge)
      .toBe('DC 25 • Humanoid (Society) • Unspecific Lore DC 23 • Specific Lore DC 20')
  })

  it('keeps each creature type with its own skill when the sidebar lists several (Sigrid Jandevik)', () => {
    // Before: unset (see above).
    expect(parseCreature(C.recallMulti).recallKnowledge)
      .toBe('DC 33 • Beast (Arcana or Nature), Humanoid (Society) • Unspecific Lore DC 31 • Specific Lore DC 28')
  })

  it('sets no Recall Knowledge when the page prints none, while a page that prints one gets it', () => {
    // Before: the first expectation fails (Hydra's printed sidebar was not read); the second, the
    // guard against inventing one for Unseen Servant, held before as well.
    expect(parseCreature(C.multiPool).recallKnowledge)
      .toBe('DC 22 • Beast (Arcana or Nature) • Unspecific Lore DC 20 • Specific Lore DC 17')
    const none = parseCreature(C.noRecall)
    expect(none.rawMarkdown).toBeTruthy()
    expect(none.recallKnowledge).toBeUndefined()
    // A prose mention is not the sidebar (Brainchild: "attempts to Recall Knowledge about it can use
    // almost any skill"), nor is a DC an ability names below the stat block's own title.
    const prose = {
      ...C.noRecall,
      _aon: {
        ...(C.noRecall as unknown as { _aon: object })._aon,
        markdown: 'Attempts to Recall Knowledge about it can use almost any skill.\n'
          + '<title level="2" right="Creature -1">X</title>\n**Lore Sense** Recall Knowledge - Fey (Nature): DC 15',
      },
    } as unknown as RawCreature
    expect(parseCreature(prose).recallKnowledge).toBeUndefined()
  })

  it('marks a page record with fromArchivesPage, and a page-less one not', () => {
    // Before: the marker was never set, so a reloaded page record (rawMarkdown stripped by the
    // persist slimming) fell back to the computed Recall Knowledge row.
    expect(parseCreature(C.noRecall).fromArchivesPage).toBe(true)
    const { _aon: _drop, ...pageless } = C.noRecall as unknown as Record<string, unknown>
    void _drop
    expect('fromArchivesPage' in parseCreature(pageless as unknown as RawCreature)).toBe(false)
  })
})

describe('parseHazard Routine: the structured field wins, the prose keeps only its tail', () => {
  const HEAD = 'Stealth DC 20 (trained) Disable Thievery DC 20 (trained) AC 15, Fort +8 HP 20 (BT 10)'
  const hazard = (prose: string, routine: string[]): RawHazard =>
    ({ name: 'Test Blade', level: 1, traits: [], description: [HEAD + ' Routine ' + prose], routine }) as unknown as RawHazard

  it('prints the structured Routine when the prose carries the page’s broken markup', () => {
    // Before: the prose parse won, so the Routine read "The blade [clumsy 1 swings at a creature."
    const h = parseHazard(hazard('(1 action) The blade [clumsy 1 swings at a creature.',
      ['(1 action) The blade swings at a creature, which becomes clumsy 1.']))
    expect(h.hazardData?.routine).toBe('(1 action) The blade swings at a creature, which becomes clumsy 1.')
  })

  it('appends what the prose holds after the structured text (a Speed line)', () => {
    // Before: the prose parse won whole, one line ("… in reach. Speed 10 feet"), no line break.
    const h = parseHazard(hazard('(1 action) The blade swings at the nearest creature in reach. Speed 10 feet',
      ['(1 action) The blade swings at the nearest creature in reach.']))
    expect(h.hazardData?.routine).toBe('(1 action) The blade swings at the nearest creature in reach.\nSpeed 10 feet')
  })
})

describe('parseHazard on corpus records', () => {
  it('keeps every component HP pool and leaves hp on the first (Hammer of Forbiddance)', () => {
    // Before: only defenses.hp[0] survived; the Joint pool vanished.
    const h = parseHazard(H.components)
    expect(h.defenses.hpPools).toEqual([
      { hp: 88, name: 'Hammer (BT 44)' },
      { hp: 64, name: 'Joint (BT 32)' },
    ])
    expect(h.defenses.hp).toBe(88)
  })

  it('finds the strike the page prints after a line break (Vorpal Executioner)', () => {
    // Before: attacks was [] (the damage regex needed ". " or end of string after the rider).
    const h = parseHazard(H.strikeAfterBreak)
    expect(h.attacks).toHaveLength(1)
    expect(h.attacks[0]).toMatchObject({
      range: 'Melee', name: 'saw blade', attack: 40,
      traits: ['deadly d12', 'death'],
      damage: '6d12+25 slashing plus decapitation; no multiple attack penalty',
    })
  })

  it('reads an Effect strike with a printed action cost and makes no "Melee" ability of it (Titanic Flytrap)', () => {
    // Before: attacks was [] and the abilities held a bogus "Melee Single ◆".
    const h = parseHazard(H.singleActionEffectStrike)
    expect(h.attacks).toHaveLength(1)
    expect(h.attacks[0]).toMatchObject({ name: 'jaws', attack: 17, activity: ' ◆', damage: '', effects: ['devour'] })
    expect(h.abilities.some(a => /^(Melee|Ranged)\b/.test(a.name))).toBe(false)
  })

  it('reads a strike whose Damage follows a semicolon and does not duplicate "Spikes" (Spiked Doorframe)', () => {
    // Before: attacks was [] ("+17; Damage" did not match ", Damage"), and the prose parser named the
    // ability "Spikes Single ◆", so it did not dedupe against the structured "Spikes ◆".
    const h = parseHazard(H.semicolonStrike)
    expect(h.attacks.map(a => [a.name, a.attack, a.damage])).toEqual([['spikes', 17, '4d6+3 piercing']])
    expect(h.abilities.map(a => a.name)).toEqual(['Spikes ◆'])
  })

  it('lists no printed saves for a hazard that prints none (Glyph of Warding)', () => {
    // Before: savesPrinted was never set, so the renderer drew three +0 boxes.
    expect(parseHazard(H.noSaves).defenses.savesPrinted).toEqual([])
  })

  it('lists only the printed saves and keeps the printed AC (Web Lurker Deadfall)', () => {
    // Before: savesPrinted undefined (the ac value was already carried; the renderer hid it).
    const h = parseHazard(H.withAc)
    expect(h.defenses.savesPrinted).toEqual(['fort', 'ref'])
    expect(h.defenses.ac).toBe(19)
  })

  it('leaves AC at 0 and no saves for a hazard whose page prints neither (Shrieking Souls)', () => {
    // Before: savesPrinted undefined; ac 0 held before as well and is what keeps the AC box off.
    const h = parseHazard(H.noAc)
    expect(h.defenses.savesPrinted).toEqual([])
    expect(h.defenses.ac).toBe(0)
  })

  it('reads structured RawHazard.attacks first and merges the prose strikes it does not name', () => {
    // Before: raw.attacks on a hazard was ignored entirely.
    const raw: RawHazard = {
      ...H.semicolonStrike,
      attacks: [
        { range: 'Melee', name: 'Spikes', attack: 18, traits: ['magical'], damage: '4d6+4 piercing', activity: { number: 1, unit: 'action' } },
        { range: 'Ranged', name: 'splinter', attack: 12, damage: '1d4 piercing' },
      ],
    }
    const h = parseHazard(raw)
    expect(h.attacks.map(a => [a.range, a.name, a.attack, a.damage, a.activity])).toEqual([
      ['Melee', 'Spikes', 18, '4d6+4 piercing', ' ◆'],
      ['Ranged', 'splinter', 12, '1d4 piercing', ''],
    ])
  })
})

const bareName = (n: string) => n.replace(/[◆◇↺]/g, '').trim()

describe('parseHazard: what the page prints, decided on the record (fix round 1)', () => {
  it('sets acPrinted from the unadjusted record: true when the page prints AC, false when not', () => {
    // Before: no flag; the renderer read the (weak/elite-adjustable) ac value instead.
    expect(parseHazard(H.withAc).defenses.acPrinted).toBe(true)
    expect(parseHazard(H.noAc).defenses.acPrinted).toBe(false)
  })

  it('labels the combat pool with the first component, as a creature does (Hammer of Forbiddance)', () => {
    // Before: hpNote was never set on a hazard, so the first component's label had no home.
    expect(parseHazard(H.components).defenses.hpNote).toBe('Hammer (BT 44)')
  })

  it('places each strike among the abilities where the page prints it', () => {
    // Before: no place; the strike was drawn above every ability, so the reaction that MAKES it
    // ("Spring") read as coming after it, and its rider ("Cladis Poison") before it.
    const lock = parseHazard(R('hazard-2'))
    expect(lock.abilities.map(a => bareName(a.name))).toEqual(['Spring', 'Cladis Poison'])
    expect(lock.attacks.map(a => [a.name, a.afterAbility])).toEqual([['spine', 1]])
    const vorpal = parseHazard(R('hazard-17'))
    expect(vorpal.abilities.map(a => bareName(a.name))).toEqual(['Total Decapitation', 'Decapitation'])
    expect(vorpal.attacks.map(a => a.afterAbility)).toEqual([1])
    const flytrap = parseHazard(R('hazard-37'))
    expect(flytrap.abilities.map(a => bareName(a.name))).toEqual(['Snap Shut', 'Devour', 'Titanic Flytrap Toxin'])
    expect(flytrap.attacks.map(a => a.afterAbility)).toEqual([1])
    // A strike printed under the Routine, after the only ability: after it.
    expect(parseHazard(R('hazard-23')).attacks.map(a => a.afterAbility)).toEqual([1])
  })

  it('gives no strike a place when the record has no page to read it from', () => {
    const { _aon: _a, ...pageless } = R('hazard-2') as RawHazard & { _aon?: unknown }
    void _a
    expect(parseHazard(pageless as RawHazard).attacks.map(a => a.afterAbility)).toEqual([undefined])
  })

  it('prints the structured Disable whole, not the prose cut at its own section word', () => {
    // Before: the description[0] parse won and stopped at "(see" — Spinning Blade Pillar lost
    // "Reset below).", Swatted Like Flies lost "Routine) is increased by 4 …".
    expect(parseHazard(R('hazard-23')).hazardData?.disable).toMatch(/deactivating automatically \(see Reset below\)\.$/)
    const flies = parseHazard(R('hazard-562')).hazardData?.disable ?? ''
    expect(flies).toContain('(see Routine) is increased by 4 on a success')
    expect(flies).toMatch(/disabling the hazard\.$/)
  })

  it('draws an ability printed in the flavor paragraph once: as its entry, not in the Description (Swatted Like Flies)', () => {
    // Before: the Description ran on into "Escaping The PCs overcome this hazard …".
    const h = parseHazard(R('hazard-562'))
    expect(h.abilities.map(a => bareName(a.name))).toContain('Escaping')
    expect(h.hazardData?.description).toContain('swishes its stone tail to swat them away.')
    expect(h.hazardData?.description).not.toContain('The PCs overcome this hazard')
  })

  it('draws an ability printed under the Routine once: as its entry, not in the Routine (Spectral Archers)', () => {
    // Before: the Routine's prose tail carried "Continuous Barrage Free Action Trigger …" whole.
    const h = parseHazard(R('hazard-130'))
    expect(h.abilities.map(a => bareName(a.name))).toContain('Continuous Barrage')
    expect(h.hazardData?.routine).toContain('fires one bolt at every creature')
    expect(h.hazardData?.routine).not.toContain('A creature in front of the gate finishes an action')
  })
})
