import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render as domRender } from '@testing-library/react'
import { StatBlock } from './StatBlock'
import { StatBlockBuilder } from './StatBlockBuilder'
import { useSettingsStore, STATBLOCK_DEFAULT, type SbEditApi } from '../store/settingsStore'
import { useCombatStore, invalidateEncounterCache } from '../store/combatStore'
import { parseCreature } from '../utils/parseCreature'
import { parseStatBlockText } from '../utils/parseStatBlockText'
import { parseCreaturesFromText } from '../utils/dataTransfer'
import type { Ability, Combatant, Creature, Defenses, RawCreature } from '../types/pf2e'
import samples from '../utils/__fixtures__/corpus-adapter-samples.json'

/*
 * REFUTE ROUND 1, REGRESSION LENS (consumers) — the verified-bestiary adapter + renderer change,
 * walked through the paths that feed the stat block from somewhere other than the bestiary:
 * the builder (CombatantDetail → TextConverter → StatBlockBuilder), pasted text
 * (parseStatBlockText), the export → import normaliser (dataTransfer), the combat store's
 * elite / weak / scale actions and saved encounters, and the settings-page edit mode.
 *
 * The `regression:` tests fail on this lane and pass on the base commit (7cfb323), where no
 * hazard ever drew an AC box and no Archives record carried a Recall Knowledge line (checked by
 * running this file against copies of the base StatBlock.tsx and parseCreature.ts). The `gap:`
 * test fails on both: the new page rule does not survive that path. The `guard:` tests pin what
 * works on this lane (several pin the new behaviour, so they fail on the base). Every creature is
 * a corpus fixture or synthetic.
 */

const C = samples.creatures as unknown as Record<string, RawCreature>

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
const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** The page record as the board holds it after a reload: the persist slimming drops raw + rawMarkdown. */
const slimmed = (c: Creature): Creature => {
  const { raw: _r, rawMarkdown: _m, ...rest } = c
  void _r; void _m
  return { ...rest, raw: {} as Creature['raw'] }
}

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => {
  cleanup()
  useSettingsStore.setState({ statBlock: STATBLOCK_DEFAULT })
})

describe('regression: a hazard that never printed an AC grows the default AC 10', () => {
  // The renderer now draws a hazard's AC box when defenses.ac > 0. The corpus leaves ac 0 when the
  // page prints none, but the two other ways a GM makes a hazard default AC to 10:
  // parseStatBlockText starts at `ac = 10` and only changes it on an "AC n" line, and the
  // builder's AC field starts at 10. Before the change no hazard drew AC, so the 10 never showed.

  it('a pasted hazard whose text has no AC line draws no AC box', () => {
    const { creature: hz } = parseStatBlockText(
      'Synthetic Pit\nHazard 1\nTrap Mechanical\nStealth DC 18 (trained)\nHP 20; Immunities critical hits')
    expect(hz?.isHazard).toBe(true)
    expect(html(hz!)).not.toContain(defBox('AC'))
  })

  it('a hazard made in the builder without touching its AC draws no AC box', () => {
    let last: Creature | null = null
    const view = domRender(<StatBlockBuilder initial={null} onChange={c => { last = c }} />)
    fireEvent.click(view.getByText('⚠ Hazard'))
    expect(last).not.toBeNull()
    const hz = last! as Creature
    expect(hz.isHazard).toBe(true)
    expect(html(hz)).not.toContain(defBox('AC'))
  })

  it('guard: a pasted hazard that prints "AC 20" draws it', () => {
    const { creature: hz } = parseStatBlockText('Spike Trap HAZARD 3\nStealth +10\nAC 20; Fort +12, Ref +8, Will +5\nHP 30')
    const h = html(hz!)
    expect(h).toContain(defBox('AC'))
    expect(text(h)).toContain('20')
  })
})

describe('regression: a page record edited in the builder keeps a Recall Knowledge DC for its OLD level', () => {
  // CombatantDetail's Edit opens TextConverter → StatBlockBuilder on the board's creature. build()
  // spreads `...base`, so recallKnowledge and fromArchivesPage ride along unchanged while the GM
  // changes the level (the builder has no Recall Knowledge field). Before the change the adapter
  // set no recallKnowledge, so the row was computed from the edited level (and traits).
  it('Svetlana (level 1, page DC 25) raised to level 6 reads DC 32, as the computed row did', () => {
    // On this lane the record carries the page line "DC 25 • Humanoid (Society) • …"; on the
    // base commit it carried none. Either way the edited copy must not print the level-1 DC.
    const page = parseCreature(C.recallSingle)
    let last: Creature | null = null
    const view = domRender(<StatBlockBuilder initial={page} onChange={c => { last = c }} />)
    const level = view.container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
    expect(level.value).toBe('1')
    fireEvent.change(level, { target: { value: '6' } })
    const edited = last! as Creature
    expect(edited.level).toBe(6)
    // What the base commit printed for this record at level 6 (no page line on the record).
    const { recallKnowledge: _rk, fromArchivesPage: _fp, rawMarkdown: _md, ...pageless } = edited
    void _rk; void _fp; void _md
    expect(rkLine(text(html(pageless as Creature)))).toBe('Recall Knowledge DC 32')
    expect(rkLine(text(html(edited)))).toBe('Recall Knowledge DC 32')
  })
})

describe('gap (new rule does not survive the path; base showed the computed row too): export → import drops the page marker of a reloaded page record', () => {
  // normalizeCreature (parseCreaturesFromText: custom-creature import, backup restore) rebuilds the
  // record field by field and keeps rawMarkdown but not fromArchivesPage. A page record saved to
  // homebrew from the board after a reload (rawMarkdown already slimmed away) therefore loses the
  // only marker that says "print only what the page prints", and the computed DC comes back.
  it('Unseen Servant (page prints no Recall Knowledge) shows no row after export → import', () => {
    const slim = slimmed(parseCreature(C.noRecall))
    expect(slim.fromArchivesPage).toBe(true)
    expect(text(html(slim))).not.toContain('Recall Knowledge')
    const r = parseCreaturesFromText(JSON.stringify([slim]))
    expect(r.creatures.length).toBe(1)
    expect(text(html(r.creatures[0]))).not.toContain('Recall Knowledge')
  })
})

describe('guard: saved encounters keep the page Recall Knowledge rule (adapter-built records)', () => {
  // StatBlock.regression.test.tsx's reload test builds its record with rawMarkdown but without
  // fromArchivesPage, which parseCreature always sets on a page record. Built by the adapter, the
  // rule survives saveEncounter → loadEncounter, because slimCombatantForPersist keeps the marker.
  beforeEach(() => {
    localStorage.clear(); invalidateEncounterCache()
    useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null, savedSignature: null } as never)
  })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache() })

  const throughSave = (c: Creature): Combatant => {
    useCombatStore.getState().addCombatant(c, { name: c.name })
    useCombatStore.getState().saveEncounter('regression-consumers')
    useCombatStore.setState({ combatants: [] } as never)
    useCombatStore.getState().loadEncounter('regression-consumers', [])
    return useCombatStore.getState().combatants[0]
  }

  it('a page with no sidebar shows no row; a page with one shows its DC', () => {
    const none = throughSave(parseCreature(C.noRecall))
    expect(none.creature?.rawMarkdown).toBeUndefined()
    expect(text(renderToStaticMarkup(<StatBlock combatant={none} />))).not.toContain('Recall Knowledge')
    useCombatStore.setState({ combatants: [] } as never)
    const svet = throughSave(parseCreature(C.recallSingle))
    expect(rkLine(text(renderToStaticMarkup(<StatBlock combatant={svet} />)))).toBe('Recall Knowledge DC 25')
  })

  it('a saved encounter from before the change (no slot, no marker, no page line) renders as it did', () => {
    // An older snapshot: the record carries none of the new fields. Its abilities print at the
    // bottom under Abilities & Actions and its Recall Knowledge row is computed, as before.
    const old = creature({ abilities: [{ name: 'Old Aura', traits: [], entries: 'An aura.' }] })
    const cb = throughSave(old)
    const h = renderToStaticMarkup(<StatBlock combatant={cb} />)
    expect(rkLine(text(h))).toBe('Recall Knowledge DC 15')
    expect(h.indexOf('Old Aura')).toBeGreaterThan(h.indexOf('Abilities &amp; Actions'))
  })
})

describe('guard: the combat store keeps combat HP and the first printed pool equal', () => {
  beforeEach(() => {
    useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null } as never)
  })

  const hydraOnBoard = (): string => {
    useCombatStore.getState().addCombatant(parseCreature(C.multiPool), { name: 'Hydra' })
    return useCombatStore.getState().combatants[0].id
  }
  const firstPool = (cb: Combatant) => text(renderToStaticMarkup(<StatBlock combatant={cb} />)).match(/HP (\d+) \(body, hydra regeneration\); 15 \(head, head regrowth\)/)?.[1]

  it('elite, weak and scaled: maxHP is the first number on the HP line, the head pool prints as the page', () => {
    const id = hydraOnBoard()
    for (const step of [
      () => useCombatStore.getState().setEliteWeak(id, 'elite'),
      () => useCombatStore.getState().setEliteWeak(id, 'weak'),
      () => useCombatStore.getState().setScaledLevel(id, 10),
    ]) {
      step()
      const cb = useCombatStore.getState().combatants[0]
      expect(firstPool(cb)).toBe(String(cb.maxHP))
    }
  })
})

const ab = (name: string, slot?: Ability['slot']): Ability => ({ name, traits: [], entries: `${name} effect text.`, ...(slot ? { slot } : {}) })

describe('guard: every ability prints exactly once, wherever the page put it', () => {
  const mixed = () => creature({
    items: ['satchel'],
    abilities: [ab('Zeta Aura', 'top'), ab('Zeta Reaction', 'mid'), ab('Zeta Bite', 'bot'), ab('Zeta Handmade')],
  })
  const names = ['Zeta Aura', 'Zeta Reaction', 'Zeta Bite', 'Zeta Handmade']

  it('read-only stat block: once each, top before AC, mid after AC, bottom and slot-less under the header', () => {
    const h = html(mixed())
    for (const n of names) expect(count(h, `>${n}<`)).toBe(1)
    expect(h.indexOf('Zeta Aura')).toBeLessThan(h.indexOf(defBox('AC')))
    expect(h.indexOf('Zeta Reaction')).toBeGreaterThan(h.indexOf(defBox('AC')))
    expect(h.indexOf('Zeta Handmade')).toBeGreaterThan(h.indexOf('Abilities &amp; Actions'))
  })

  it('a creature with only slot-less abilities (hand-built, pasted) prints them all under Abilities & Actions, in order', () => {
    const h = html(creature({ abilities: [ab('First Knack'), ab('Second Knack')] }))
    expect(h.indexOf('First Knack')).toBeGreaterThan(h.indexOf('Abilities &amp; Actions'))
    expect(h.indexOf('First Knack')).toBeLessThan(h.indexOf('Second Knack'))
  })

  it('hiding Abilities & Actions hides every group; Compact hides every body', () => {
    // Mounted in the DOM: a server render reads the settings store's initial state, not setState.
    const live = (c: Creature) => { cleanup(); return domRender(<StatBlock combatant={combatantOf(c)} />).container.innerHTML }
    const items = STATBLOCK_DEFAULT.items.map(it => it.id === 'specials' ? { ...it, hidden: true } : it)
    useSettingsStore.setState({ statBlock: { ...STATBLOCK_DEFAULT, items } })
    const hidden = live(mixed())
    for (const n of names) expect(hidden).not.toContain(n)
    const compact = STATBLOCK_DEFAULT.items.map(it => it.id === 'specials' ? { ...it, style: 'compact' } : it)
    useSettingsStore.setState({ statBlock: { ...STATBLOCK_DEFAULT, items: compact } })
    const c = live(mixed())
    for (const n of names) {
      expect(count(c, `>${n}<`)).toBe(1)
      expect(c).not.toContain(`${n} effect text.`)
    }
  })

  it('the settings-page edit mode draws each ability once (slot-less and slotted)', () => {
    const api: SbEditApi = { selectedId: null, onSelect: () => {}, onReorder: () => {}, onPatch: () => {}, onDropMerge: () => {} }
    const h = renderToStaticMarkup(<StatBlock combatant={combatantOf(mixed())} edit={api} />)
    for (const n of names) expect(count(h, `>${n}<`)).toBe(1)
    const plain = renderToStaticMarkup(<StatBlock combatant={combatantOf(creature({ abilities: [ab('First Knack'), ab('Second Knack')] }))} edit={api} />)
    expect(count(plain, '>First Knack<')).toBe(1)
    expect(plain.indexOf('First Knack')).toBeLessThan(plain.indexOf('Second Knack'))
  })
})
