import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render as domRender } from '@testing-library/react'
import { StatBlock } from './StatBlock'
import { useSettingsStore, STATBLOCK_DEFAULT } from '../store/settingsStore'
import type { Ability, Combatant, Creature, Defenses } from '../types/pf2e'

/*
 * THE RENDERER SIDE OF THE VERIFIED-BESTIARY ADAPTER (docs/APP-DEFECTS.md in the corpus).
 *
 * The adapter (parseCreature / parseHazard) fills Ability.slot, Creature.languageAbilities,
 * Defenses.hpPools, Defenses.savesPrinted, hazard AC and Creature.recallKnowledge from the page.
 * These tests pin what StatBlock DRAWS from those fields, on hand-made records typed to the
 * interface (never through the adapter, which is built separately). Every creature is synthetic.
 *
 * renderToStaticMarkup with no providers: the game-data context falls back to its empty default
 * and the settings store starts at STATBLOCK_DEFAULT (the classic layout).
 */

const EMPTY_DEF: Defenses = {
  ac: 18, fort: 9, ref: 7, will: 5, hp: 40,
  immunities: [], resistances: [], weaknesses: [],
}

function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'synth', name: 'Synthetic Beast', source: 'Test', level: 1,
    traits: ['beast'], perception: 6, senses: [], languages: [], skills: {},
    str: 3, dex: 2, con: 2, int: -4, wis: 1, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...EMPTY_DEF }, isHazard: false,
    raw: {} as Creature['raw'],
    ...over,
  }
}

function hazard(def: Partial<Defenses>): Creature {
  return creature({
    name: 'Synthetic Trap', traits: ['trap', 'mechanical'], isHazard: true,
    speed: {},
    defenses: { ac: 0, fort: 0, ref: 0, will: 0, hp: 0, immunities: [], resistances: [], weaknesses: [], ...def },
    hazardData: { description: 'A synthetic trap.', disable: 'Thievery DC 20', complex: false },
  })
}

function combatantOf(c: Creature): Combatant {
  return {
    id: 'cb-1', name: c.name, creature: c, isPC: false, isAlly: false, initiative: null,
    currentHP: c.defenses.hp, maxHP: c.defenses.hp, tempHP: 0, conditions: [],
    isElite: false, isWeak: false, notes: '', isDefeated: false,
  }
}

function render(c: Creature): string {
  return renderToStaticMarkup(<StatBlock combatant={combatantOf(c)} />)
}

/** Visible text, tags stripped, whitespace collapsed. */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

const defBox = (label: string) => `class="def-box-label">${label}</div>`

const ability = (name: string, slot: Ability['slot'], entries = 'Synthetic effect.'): Ability =>
  ({ name, traits: [], entries, ...(slot ? { slot } : {}) })

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ statBlock: STATBLOCK_DEFAULT })
})

describe('StatBlock — abilities print where the page printed them', () => {
  const c = creature({
    items: ['synthetic satchel'],
    attacks: [{ range: 'Melee', name: 'Synthjaw', attack: 9, traits: [], damage: '1d8+3 piercing', types: [], effects: [], isAgile: false }],
    abilities: [
      // Page order: top, mid, bot — one flat array, as the adapter delivers it.
      ability('Warding Hum', 'top', 'Once per day the creature hums for 1d6 rounds.'),
      ability('Snapback', 'mid'),
      ability('Tail Lash', 'bot'),
      ability('Loose Note', undefined),
    ],
  })

  it('a top ability sits after Items and before the Defense strip; mid after HP and before the first strike', () => {
    // Without the change: all four abilities render under "Abilities & Actions", after Synthjaw,
    // so "Warding Hum" comes after the AC box and "Snapback" after the strike.
    const html = render(c)
    const at = (s: string) => {
      const i = html.indexOf(s)
      expect(i, `"${s}" is drawn`).toBeGreaterThanOrEqual(0)
      return i
    }
    const items = at('class="stat-label">Items</span>')
    const top = at('Warding Hum')
    const ac = at(defBox('AC'))
    const hp = at('class="stat-label">HP</span>')
    const mid = at('Snapback')
    const strike = at('Synthjaw')
    const bot = at('Tail Lash')
    const loose = at('Loose Note')

    expect(items).toBeLessThan(top)
    expect(top).toBeLessThan(ac)
    expect(hp).toBeLessThan(mid)
    expect(mid).toBeLessThan(strike)
    expect(strike).toBeLessThan(bot)
    expect(bot).toBeLessThan(loose)
    // Each ability is drawn once — moving it up must not leave a copy at the bottom.
    for (const n of ['Warding Hum', 'Snapback', 'Tail Lash', 'Loose Note']) {
      expect(html.split(n).length - 1, n).toBe(1)
    }
  })

  it('a top ability keeps its uses chip and inline dice roller', () => {
    // Without the change the same features exist only in the bottom section, so the chip and the
    // roller are found AFTER the AC box rather than before it.
    const html = render(c)
    const ac = html.indexOf(defBox('AC'))
    const chip = html.indexOf('title="Spend one use"')
    const roller = html.indexOf('title="Click to roll 1d6 — will apply a cooldown condition')
    expect(chip).toBeGreaterThanOrEqual(0)
    expect(roller).toBeGreaterThanOrEqual(0)
    expect(chip).toBeLessThan(ac)
    expect(roller).toBeLessThan(ac)
  })

  it('hiding Abilities & Actions hides the top and mid abilities too', () => {
    // Guard (passes before and after): before the change every ability lived in the hidden item;
    // this pins that the abilities moved out of it still follow that switch.
    // Rendered in jsdom, not on the server: zustand's server snapshot is the store's INITIAL
    // state, so a setState is invisible to renderToStaticMarkup. jsdom has no ResizeObserver
    // (the Speed cube's auto-fit uses one), so a no-op stands in.
    if (!('ResizeObserver' in globalThis)) {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    }
    const items = STATBLOCK_DEFAULT.items.map(it => it.id === 'specials' ? { ...it, hidden: true } : it)
    useSettingsStore.setState({ statBlock: { ...STATBLOCK_DEFAULT, items } })
    const { container } = domRender(<StatBlock combatant={combatantOf(c)} />)
    const t = container.textContent ?? ''
    expect(t).toContain('Synthjaw') // the block itself rendered
    for (const n of ['Warding Hum', 'Snapback', 'Tail Lash', 'Loose Note']) expect(t).not.toContain(n)
  })
})

describe('StatBlock — Languages line carries the language abilities', () => {
  it("prints 'Common, Sylvan; telepathy 100 feet'", () => {
    // Without the change: "Languages Common, Sylvan" — the telepathy after the ';' is dropped.
    const t = text(render(creature({ languages: ['Common', 'Sylvan'], languageAbilities: ['telepathy 100 feet'] })))
    expect(t).toContain('Languages Common, Sylvan; telepathy 100 feet')
  })

  it('a creature with language abilities but no languages prints just the abilities', () => {
    // Without the change: no Languages line at all (languages.length === 0 returned null).
    const t = text(render(creature({ languages: [], languageAbilities: ['telepathy 60 feet'] })))
    expect(t).toContain('Languages telepathy 60 feet')
    expect(t).not.toContain('Languages ;')
  })
})

describe('StatBlock — every HP pool prints', () => {
  it('a creature HP line shows both pools', () => {
    // Without the change: "HP 90 body, hydra regeneration" — the head's 15 HP is gone.
    const t = text(render(creature({
      defenses: { ...EMPTY_DEF, hp: 90, hpNote: 'body, hydra regeneration',
        hpPools: [{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }] },
    })))
    expect(t).toContain('HP 90 (body, hydra regeneration); 15 (head, head regrowth)')
  })

  it('a hazard HP line shows both pools', () => {
    // Without the change: only the first component's pool prints.
    const t = text(render(hazard({
      hp: 30, hpNote: 'per panel', hardness: 8,
      hpPools: [{ hp: 30, name: 'per panel' }, { hp: 60, name: 'core' }],
    })))
    expect(t).toContain('HP 30 (per panel); 60 (core)')
  })

  it('a single pool prints as it always did', () => {
    // Guard (passes before and after): one pool keeps the old, unbracketed form.
    const t = text(render(creature({ defenses: { ...EMPTY_DEF, hp: 40, hpNote: 'regeneration 5', hpPools: [{ hp: 40, name: 'regeneration 5' }] } })))
    // (The note is spaced by a CSS margin, so the stripped text has no space before it.)
    expect(t).toMatch(/HP 40\s*regeneration 5/)
    expect(t).not.toContain('(regeneration 5)')
    expect(t).not.toContain(';')
  })
})

describe('StatBlock — hazard AC and saves follow the page', () => {
  it('draws a hazard AC box when its record prints one (acPrinted)', () => {
    // Without the change: no hazard ever drew AC (a `!isHazard` guard), so the first expect fails.
    expect(render(hazard({ ac: 21, acPrinted: true, hardness: 9, hp: 36 }))).toContain(defBox('AC'))
    expect(render(hazard({ ac: 0, acPrinted: false, hardness: 9, hp: 36 }))).not.toContain(defBox('AC'))
  })

  it('a hazard with no acPrinted (made before the flag) draws no AC box, whatever its ac', () => {
    // D4 replaced the interface's "ac > 0" rule with the flag, and every writer sets it now. A hazard
    // without it was made before, when no hazard drew AC and the old builder / paste parser
    // stored an untyped ac 10: an "ac > 0" fallback grew an "AC 10" box on nearly every one
    // (StatBlock.regression2.test.tsx). Without the fix the first expect fails.
    expect(render(hazard({ ac: 10, hardness: 5, hp: 20 }))).not.toContain(defBox('AC'))
    expect(render(hazard({ ac: 21, hardness: 9, hp: 36 }))).not.toContain(defBox('AC'))
    // Read defensively: a homebrew JSON's "yes" is not true.
    expect(render(hazard({ ac: 21, acPrinted: 'yes' as unknown as boolean, hp: 36 }))).not.toContain(defBox('AC'))
  })

  it('acPrinted decides the hazard AC box, not the ac value (decided on the unadjusted record)', () => {
    // Without the flag the box followed ac > 0, so a hazard whose page prints no AC but whose ac
    // is non-zero (elite / weak / scaled, or a value the page never printed) drew one.
    expect(render(hazard({ ac: 12, acPrinted: false, hp: 20 }))).not.toContain(defBox('AC'))
    expect(render(hazard({ ac: 21, acPrinted: true, hp: 20 }))).toContain(defBox('AC'))
    const elite = { ...combatantOf(hazard({ ac: 0, acPrinted: false, hp: 20 })), isElite: true }
    expect(renderToStaticMarkup(<StatBlock combatant={elite} />)).not.toContain(defBox('AC'))
  })

  it('draws only the saves in savesPrinted', () => {
    // Without the change: a hazard with any save drew all three ("Ref +0", "Will +0").
    const html = render(hazard({ ac: 0, fort: 11, ref: 0, will: 0, hp: 20, savesPrinted: ['fort'] }))
    expect(html).toContain(defBox('Fort'))
    expect(html).not.toContain(defBox('Ref'))
    expect(html).not.toContain(defBox('Will'))
    // None printed: no save boxes, and the section still shows for its Hardness.
    const none = render(hazard({ ac: 0, fort: 4, ref: 4, will: 4, hardness: 6, hp: 24, savesPrinted: [] }))
    expect(none).toContain(defBox('Hardness'))
    for (const s of ['Fort', 'Ref', 'Will']) expect(none).not.toContain(defBox(s))
  })

  it('creatures keep all three saves and draw Hardness when set', () => {
    // Guard (passes before and after): creatures are unaffected by savesPrinted, and the strip
    // already drew a creature's Hardness — the adapter only has to fill it.
    const html = render(creature({ defenses: { ...EMPTY_DEF, hardness: 10, savesPrinted: [] } }))
    for (const s of ['AC', 'Hardness', 'Fort', 'Ref', 'Will']) expect(html).toContain(defBox(s))
  })
})

describe('StatBlock — Recall Knowledge comes from the page', () => {
  it('a record with a page shows the page line, and nothing when the page prints none', () => {
    // Without the change: the page-less branch computed "DC 15 • Beast (Arcana or Nature)" for a
    // record whose page printed no Recall Knowledge, so the second expect fails.
    const withLine = text(render(creature({ rawMarkdown: '# Synthetic Beast', recallKnowledge: 'Beast (Arcana, Nature): DC 17' })))
    expect(withLine).toContain('Recall Knowledge Beast (Arcana, Nature): DC 17')
    const without = text(render(creature({ rawMarkdown: '# Synthetic Beast' })))
    expect(without).not.toContain('Recall Knowledge')
  })

  it('a record with no page keeps the computed fallback', () => {
    // Guard (passes before and after): hand-built / pasted / homebrew still get a computed DC.
    const t = text(render(creature({ level: 1 })))
    expect(t).toContain('Recall Knowledge DC 15')
  })

  it('a record carrying its page but no recallKnowledge reads the sidebar off that page', () => {
    // Homebrew saved from a bestiary combatant before the adapter filled recallKnowledge keeps
    // rawMarkdown (the builder spreads the record). Without the fix it showed NO row: "has a page"
    // was read as "the page prints none" (StatBlock.regression2.test.tsx).
    const t = text(render(creature({
      traits: ['humanoid'],
      attacks: [{ range: 'Melee', name: 'synthclub', attack: 7, traits: [], damage: '1d6+3', types: [], effects: [], isAgile: false }],
      rawMarkdown: '**[Recall Knowledge - Humanoid](/Rules.aspx?ID=563)**\n([Society](/Skills.aspx?ID=48)): DC 17\n\n<title level="2" right="Creature 1">Synthetic Beast</title>',
    })))
    expect(t).toContain('Recall Knowledge DC 17')
  })

  it('weak on a level −1 creature never raises a Recall Knowledge DC (the table prints no level −2)', () => {
    // rkDcAt(−2) was 14 + max(0, −2) = 14, above level −1's 13, so the delta was +1: a weak Ether
    // Sprite read "DC 14 … Unspecific Lore DC 12 … Specific Lore DC 9" against the page's 13/11/8.
    const weak = (c: Creature) => text(renderToStaticMarkup(<StatBlock combatant={{ ...combatantOf(c), isWeak: true }} />))
    const page = creature({
      level: -1, rawMarkdown: '# Synthetic Sprite',
      recallKnowledge: 'DC 13 • Fey (Nature) • Unspecific Lore DC 11 • Specific Lore DC 8',
    })
    const dcs = [...weak(page).matchAll(/DC (\d+)/g)].map(m => Number(m[1]))
    expect(dcs).toEqual([12, 10, 7])
    // The computed row of a page-less level −1 creature moves the same way.
    expect(weak(creature({ level: -1, traits: ['fey'] }))).toContain('Recall Knowledge DC 12')
  })
})

describe('StatBlock — a hazard strike prints where the page prints it', () => {
  const hz = (attacks: Creature['attacks'], routine?: string): Creature => ({
    ...hazard({ ac: 15, hp: 24, fort: 8, savesPrinted: ['fort'] }),
    abilities: [
      { name: 'Synthetic Spring', activity: ' ↺', traits: [], trigger: 'A creature opens the lid.', entries: 'Effect A spine extends.' },
      { name: 'Synthetic Venom', traits: ['poison'], entries: 'Saving Throw DC 19 Fortitude.' },
    ],
    attacks,
    hazardData: { description: 'A synthetic trap.', disable: 'Thievery DC 17', complex: !!routine, ...(routine ? { routine } : {}) },
  })
  const spine = { range: 'Melee' as const, name: 'synthspine', attack: 13, traits: [], damage: '1 piercing', types: [], effects: [], isAgile: false }

  it('a strike with a page place sits between the ability that makes it and its rider', () => {
    // Without the change the strikes printed above every ability ("Attacks" came before
    // "Abilities & Actions"), so "Synthetic Spring" read as coming after its own strike.
    const html = render(hz([{ ...spine, afterAbility: 1 }]))
    const at = (s: string) => html.indexOf(s)
    expect(at('Synthetic Spring')).toBeGreaterThan(-1)
    expect(at('Synthetic Spring')).toBeLessThan(at('synthspine'))
    expect(at('synthspine')).toBeLessThan(at('Synthetic Venom'))
    for (const n of ['Synthetic Spring', 'Synthetic Venom', 'synthspine']) expect(html.split(n).length - 1, n).toBe(1)
  })

  it('a strike with no page place (hand-built, pasted) prints after every ability and before the Routine', () => {
    const html = render(hz([spine], '(1 action) The synthetic trap strikes.'))
    const at = (s: string) => html.indexOf(s)
    expect(at('Synthetic Venom')).toBeLessThan(at('synthspine'))
    expect(at('synthspine')).toBeLessThan(at('>Routine<'))
  })

  it('a hidden Attacks item hides the hazard strikes too', () => {
    useSettingsStore.setState({ statBlock: { ...STATBLOCK_DEFAULT, items: STATBLOCK_DEFAULT.items.map(i => i.id === 'attacks' ? { ...i, hidden: true } : i) } })
    const view = domRender(<StatBlock combatant={combatantOf(hz([{ ...spine, afterAbility: 1 }]))} />)
    expect(view.container.innerHTML).not.toContain('synthspine')
    expect(view.container.innerHTML).toContain('Synthetic Venom')
  })
})

describe('StatBlock — an ability prints its clauses in the page order', () => {
  it('Frequency (and Requirements) print before the Trigger, as the page prints them', () => {
    // Without the change the Trigger row was drawn first and "Frequency once per day" after it,
    // so the page's "Frequency once per day; Trigger An allied creature …" read out of order.
    const c = creature({
      abilities: [{
        name: 'Synthetic Recall', activity: ' ↺', traits: ['divine'], slot: 'mid',
        trigger: 'An allied creature is reduced to 0 Hit Points',
        entries: 'Frequency once per day\nEffect The synthetic beast restores 5d10 Hit Points to the target.',
      }],
    })
    const t = text(render(c))
    expect(t.indexOf('Frequency once per day')).toBeGreaterThan(-1)
    expect(t.indexOf('Frequency once per day')).toBeLessThan(t.indexOf('Trigger An allied creature'))
    expect(t.indexOf('Trigger An allied creature')).toBeLessThan(t.indexOf('restores'))
    expect(t.split('Frequency once per day').length - 1).toBe(1)
  })
})
