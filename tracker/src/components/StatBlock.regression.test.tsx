import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render as domRender } from '@testing-library/react'
import { StatBlock } from './StatBlock'
import { StatBlockBuilder } from './StatBlockBuilder'
import { useSettingsStore, STATBLOCK_DEFAULT } from '../store/settingsStore'
import { useCombatStore, invalidateEncounterCache } from '../store/combatStore'
import { statBlockProblem, toStatBlock } from '../data/dataStore'
import { parseCreaturesFromText } from '../utils/dataTransfer'
import type { Ability, Combatant, Creature, Defenses } from '../types/pf2e'

/*
 * REFUTE ROUND 1, REGRESSION LENS — the verified-bestiary adapter + renderer change
 * (Ability.slot, languageAbilities, hpPools, savesPrinted, hazard AC, page Recall Knowledge).
 *
 * Each `describe` is one way the change breaks something that worked before it, on a path the
 * builders' own tests do not walk: a reload / saved encounter, elite-weak-scaled combatants, the
 * homebrew JSON guard, export + import, and the builder. The `guard` tests pin what still works
 * (weak/elite HP pools, slot-less abilities through the builder) so a fix cannot break it.
 * Every creature here is synthetic.
 */

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }

function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'synth', name: 'Synthetic Raider', source: 'Test', level: 1,
    traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
    str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...DEF }, isHazard: false,
    raw: {} as Creature['raw'],
    ...over,
  }
}

function hazard(def: Partial<Defenses>, over: Partial<Creature> = {}): Creature {
  return creature({
    name: 'Synthetic Trap', traits: ['trap', 'mechanical'], isHazard: true, languages: [], speed: {},
    defenses: { ac: 0, fort: 0, ref: 0, will: 0, hp: 0, immunities: [], resistances: [], weaknesses: [], ...def },
    hazardData: { description: 'A synthetic trap.', disable: 'Thievery DC 20', complex: false },
    ...over,
  })
}

function combatantOf(c: Creature, over: Partial<Combatant> = {}): Combatant {
  return {
    id: 'cb-1', name: c.name, creature: c, isPC: false, isAlly: false, initiative: null,
    currentHP: c.defenses.hp, maxHP: c.defenses.hp, tempHP: 0, conditions: [],
    isElite: false, isWeak: false, notes: '', isDefeated: false, ...over,
  }
}

const html = (c: Creature, over: Partial<Combatant> = {}) =>
  renderToStaticMarkup(<StatBlock combatant={combatantOf(c, over)} />)
const text = (h: string) =>
  h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const defBox = (label: string) => `class="def-box-label">${label}</div>`
const rkLine = (t: string) => t.match(/Recall Knowledge[^•]*?DC \d+/)?.[0]

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => {
  cleanup()
  useSettingsStore.setState({ statBlock: STATBLOCK_DEFAULT })
})

// An Archives record whose page prints NO Recall Knowledge sidebar (47 corpus creatures: trolls,
// Unseen Servant). The renderer shows no row for it — but only while rawMarkdown is on the record.
const pageNoSidebar = () => creature({ name: 'Synthetic Troll', rawMarkdown: '# Synthetic Troll\n\nNo sidebar on this page.' })

describe('regression: the page Recall Knowledge rule does not survive a reload or a saved encounter', () => {
  beforeEach(() => {
    localStorage.clear(); invalidateEncounterCache()
    useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null, savedSignature: null } as never)
  })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache() })

  it('a page record with no sidebar shows no Recall Knowledge row after saveEncounter → loadEncounter', () => {
    // Live: no row (the new rule keys on creature.rawMarkdown).
    expect(text(html(pageNoSidebar()))).not.toContain('Recall Knowledge')
    // slimCombatantForPersist strips rawMarkdown from every saved snapshot (saved encounters AND the
    // live board persisted for a reload), so the reloaded copy falls back to the computed DC — the
    // invented number this change set out to remove comes back after the first reload.
    useCombatStore.getState().addCombatant(pageNoSidebar(), { name: 'Synthetic Troll' })
    useCombatStore.getState().saveEncounter('regression-rk')
    useCombatStore.setState({ combatants: [] } as never)
    useCombatStore.getState().loadEncounter('regression-rk', [])
    const loaded = useCombatStore.getState().combatants[0]
    expect(loaded?.creature?.name).toBe('Synthetic Troll')
    const t = text(renderToStaticMarkup(<StatBlock combatant={loaded} />))
    expect(t).not.toContain('Recall Knowledge')
  })
})

describe('regression: an elite / weak / scaled page record no longer adjusts its Recall Knowledge DC', () => {
  // Before the change 4,790 of 4,791 Archives records had no RK line on the record, so the row was
  // computed from the ADJUSTED level: an elite level-1 humanoid read DC 16, a weak one DC 14. The
  // page line is now printed verbatim for every one of them, whatever the adjustment.
  const pageRecord = () => creature({
    rawMarkdown: '# Synthetic Raider',
    recallKnowledge: 'DC 15 • Humanoid (Society) • Unspecific Lore DC 13 • Specific Lore DC 10',
  })

  it('normal shows the page DC (guard)', () => {
    expect(rkLine(text(html(pageRecord())))).toBe('Recall Knowledge DC 15')
  })

  it('elite reads DC 16 and weak DC 14, as the computed row did before the change', () => {
    expect(rkLine(text(html(pageRecord(), { isElite: true })))).toBe('Recall Knowledge DC 16')
    expect(rkLine(text(html(pageRecord(), { isWeak: true })))).toBe('Recall Knowledge DC 14')
  })
})

describe('regression: an elite or level-scaled hazard grows an AC box its page never printed', () => {
  // The renderer draws a hazard AC box when the ADJUSTED ac > 0. applyWeakElite adds 2 to every
  // hazard's ac (0 → 2) and scaleByLevel scales it; before the change no hazard ever drew AC.
  const noAc = () => hazard({ ac: 0, fort: 11, hp: 20, hardness: 5, savesPrinted: ['fort'] })

  it('normal: no AC box (guard)', () => {
    expect(html(noAc())).not.toContain(defBox('AC'))
  })

  it('elite: still no AC box', () => {
    expect(html(noAc(), { isElite: true })).not.toContain(defBox('AC'))
  })

  it('scaled to level 8: still no AC box', () => {
    expect(html(noAc(), { scaledToLevel: 8 })).not.toContain(defBox('AC'))
  })

  it('a hazard whose page prints AC keeps it when elite (guard)', () => {
    expect(text(html(hazard({ ac: 19, fort: 11, hp: 20, savesPrinted: ['fort'] }), { isElite: true }))).toContain('21')
    expect(html(hazard({ ac: 19, fort: 11, hp: 20, savesPrinted: ['fort'] }), { isElite: true })).toContain(defBox('AC'))
  })
})

describe('regression: the homebrew JSON guard no longer covers every field the stat block reads', () => {
  // test/bug-homebrew-stat-block-skipped.test.tsx (d): "a stat block is read WHOLE … a field of the
  // wrong type is refused with the reason" — because `languages: "Common"` crashed the stat block.
  // The renderer now reads languageAbilities, defenses.hpPools and defenses.savesPrinted, which
  // readStatBlock does not check. Invariant: whatever the guard ACCEPTS, StatBlock renders.
  const base = { name: 'Synthetic Brew', traits: ['beast'], defenses: { ac: 15, fort: 5, ref: 5, will: 5, hp: 20 } }
  const cases: Array<[string, Record<string, unknown>]> = [
    ['languageAbilities as text', { ...base, languageAbilities: 'telepathy 100 feet' }],
    ['hpPools as text', { ...base, defenses: { ...base.defenses, hpPools: '20; 10 (head)' } }],
    ['hpPools holding nulls', { ...base, defenses: { ...base.defenses, hpPools: [null, null] } }],
    ['savesPrinted as a number on a hazard', { ...base, isHazard: true, defenses: { ...base.defenses, savesPrinted: 5 } }],
  ]
  for (const [label, payload] of cases) {
    it(`${label}: refused with a reason, or renders`, () => {
      const problem = statBlockProblem(payload)
      if (problem !== null) { expect(problem).toBeTruthy(); return }
      const c = toStatBlock(payload)!
      expect(() => renderToStaticMarkup(<StatBlock combatant={combatantOf(c)} />)).not.toThrow()
    })
  }
})

describe('regression: export → import drops the new fields, so the copy renders the old defects', () => {
  // parseCreaturesFromText (custom-creature import, backup restore) rebuilds a creature field by field
  // in normalizeCreature; it keeps recallKnowledge and rawMarkdown but not languageAbilities,
  // defenses.hpPools or defenses.savesPrinted.
  const roundTrip = (c: Creature) => {
    const r = parseCreaturesFromText(JSON.stringify([c]))
    expect(r.creatures.length).toBe(1)
    return r.creatures[0]
  }

  it('a creature keeps telepathy and the second HP pool', () => {
    const c = creature({
      languages: ['Common'], languageAbilities: ['telepathy 100 feet'],
      defenses: { ...DEF, hp: 90, hpNote: 'body', hpPools: [{ hp: 90, name: 'body' }, { hp: 15, name: 'head' }] },
    })
    const t = text(html(roundTrip(c)))
    expect(t).toContain('Languages Common; telepathy 100 feet')
    expect(t).toContain('; 15 (head)')
  })

  it('a hazard keeps only its printed saves', () => {
    const h = hazard({ fort: 11, hp: 20, hardness: 5, savesPrinted: ['fort'] })
    const out = html(roundTrip(h))
    expect(out).toContain(defBox('Fort'))
    expect(out).not.toContain(defBox('Ref'))
    expect(out).not.toContain(defBox('Will'))
  })
})

/** Mount the builder on `initial` and return the creature its first onChange emits (unchanged form). */
function throughBuilder(initial: Creature): Creature {
  let last: Creature | null = null
  domRender(<StatBlockBuilder initial={initial} onChange={c => { last = c }} />)
  expect(last).not.toBeNull()
  return last!
}

const ab = (name: string, slot?: Ability['slot']): Ability => ({ name, traits: [], entries: `${name} effect.`, ...(slot ? { slot } : {}) })
const strike = { range: 'Melee' as const, name: 'Synthjaw', attack: 9, traits: [], damage: '1d8+3', types: ['piercing'], effects: [], isAgile: false }

describe('the builder round trip', () => {
  it('guard: slot-less abilities keep their order and all print under Abilities & Actions, after the strike', () => {
    const c = creature({ attacks: [strike], abilities: [ab('First Knack'), ab('Second Knack'), ab('Third Knack')] })
    const out = throughBuilder(c)
    expect(out.abilities.map(a => a.name)).toEqual(['First Knack', 'Second Knack', 'Third Knack'])
    const h = html(out)
    const at = (s: string) => h.indexOf(s)
    expect(at('Abilities &amp; Actions')).toBeGreaterThan(at('Synthjaw'))
    expect(at('First Knack')).toBeGreaterThan(at('Abilities &amp; Actions'))
    expect(at('First Knack')).toBeLessThan(at('Second Knack'))
    expect(at('Second Knack')).toBeLessThan(at('Third Knack'))
  })

  it('regression: a page record opened in the builder and saved UNCHANGED keeps its ability places and printed saves', () => {
    // build() rebuilds abilities without `slot` and defenses without `hpPools` / `savesPrinted`,
    // while `...base` keeps languageAbilities / recallKnowledge / rawMarkdown — so an untouched save
    // moves an aura from after Items to the bottom, and brings a hazard's unprinted "Ref +0 / Will +0"
    // back.
    const c = creature({ items: ['satchel'], attacks: [strike], abilities: [ab('Synthetic Aura', 'top'), ab('Tail Lash', 'bot')] })
    const h = html(throughBuilder(c))
    expect(h.indexOf('Synthetic Aura')).toBeLessThan(h.indexOf(defBox('AC')))

    const hz = html(throughBuilder(hazard({ fort: 11, hp: 20, hardness: 5, savesPrinted: ['fort'] })))
    expect(hz).toContain(defBox('Fort'))
    expect(hz).not.toContain(defBox('Ref'))
  })
})

describe('guard: weak / elite keep the HP pools consistent', () => {
  // applyWeakElite / scaleByLevel adjust defenses.hp only; the renderer prints defenses.hp as the
  // first pool, so combat and the first printed number agree, and the further pools print as the page.
  const hydra = () => creature({
    level: 6,
    defenses: { ...DEF, hp: 90, hpNote: 'body, hydra regeneration',
      hpPools: [{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }] },
  })

  it('elite: HP 110 first, the head pool unchanged, combat max HP 110', () => {
    expect(text(html(hydra(), { isElite: true }))).toContain('HP 110 (body, hydra regeneration); 15 (head, head regrowth)')
  })

  it('weak: HP 70 first', () => {
    expect(text(html(hydra(), { isWeak: true }))).toContain('HP 70 (body, hydra regeneration); 15 (head, head regrowth)')
  })
})
