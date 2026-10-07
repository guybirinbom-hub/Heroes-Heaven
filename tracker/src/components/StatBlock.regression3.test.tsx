import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatBlock } from './StatBlock'
import { useSettingsStore, STATBLOCK_DEFAULT, type SbEditApi } from '../store/settingsStore'
import { useCombatStore, invalidateEncounterCache, writeEncounterStore } from '../store/combatStore'
import { creatureToText } from '../utils/creatureToText'
import { parseStatBlockText } from '../utils/parseStatBlockText'
import { parseCreature, parseHazard } from '../utils/parseCreature'
import { toStatBlock } from '../data/dataStore'
import renderSamples from '../../../test/fixtures/corpus-render-samples.json'
import type { Ability, Combatant, Creature, Defenses, RawCreature, RawHazard, SavedEncounter } from '../types/pf2e'

/*
 * REFUTE ROUND 3, REGRESSION LENS — the verified-bestiary adapter + renderer change, walked through
 * the consumers the earlier rounds did not: the TextConverter's TEXT path (creatureToText →
 * parseStatBlockText, what every text edit of a board combatant or homebrew record runs through),
 * the Settings stat-block editor (StatBlock edit mode), and an encounter saved BEFORE the change
 * (a snapshot with no slot, no fromArchivesPage, no recallKnowledge, no acPrinted / savesPrinted).
 * `regression` = worked before the change, broken now. `gap` = a field the change added that this
 * consumer drops (before the change the field did not exist, so nothing visible got worse there).
 * `guard` = still works; pinned so a fix cannot break it. Every record here is synthetic.
 *
 * FIX ROUND 4 (D18): the text format now carries every field these tests name (creatureToText /
 * parseStatBlockText); the six `regression` / `gap` tests below failed at cc7ff45 and pass with it,
 * unchanged. The last describe adds the same check over the 82 verified corpus records of the render
 * fixture: the stat block drawn after a text edit reads exactly as the one drawn before it.
 */

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }

// Title-case traits on purpose: parseStatBlockText reads a traits line only when every word is
// Title-case, so a lower-case traits line comes back as an ABILITY named after the trait — an older
// defect of the text path (creatureToText / looksLikeTraitsLine, untouched by this change) that
// would otherwise hide what these tests measure.
function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'synth3', name: 'Synthetic Warden', source: 'Test', level: 1,
    traits: ['Medium', 'Humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
    str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...DEF }, isHazard: false,
    raw: {} as Creature['raw'],
    ...over,
  }
}

function hazard(def: Partial<Defenses>, over: Partial<Creature> = {}): Creature {
  return creature({
    name: 'Synthetic Haunt', traits: ['Haunt'], isHazard: true, languages: [], speed: {},
    perception: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    defenses: { ac: 0, fort: 0, ref: 0, will: 0, hp: 0, immunities: [], resistances: [], weaknesses: [], ...def },
    hazardData: { description: 'A synthetic haunt.', disable: 'Religion DC 20', complex: false },
    ...over,
  })
}

function combatantOf(c: Creature, over: Partial<Combatant> = {}): Combatant {
  return {
    id: 'cb-3', name: c.name, creature: c, isPC: false, isAlly: false, initiative: null,
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

/** What the TextConverter does on any text edit: the record → its text → the record parsed back. */
const throughText = (c: Creature): Creature => {
  const res = parseStatBlockText(creatureToText(c))
  expect(res.creature, res.errors.join('; ')).not.toBeNull()
  return res.creature!
}

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => {
  useSettingsStore.setState({ statBlock: STATBLOCK_DEFAULT })
})

describe('TextConverter text path (creatureToText → parseStatBlockText) on a hazard', () => {
  // A haunt whose page prints no AC and no saves (348 corpus hazards print no save; 348 no AC).
  const haunt = () => hazard({ hp: 0, acPrinted: false, savesPrinted: [] })

  it('guard: the hazard as loaded draws no AC box and no save box', () => {
    const h = html(haunt())
    expect(h).not.toContain(defBox('AC'))
    expect(h).not.toContain(defBox('Fort'))
  })

  it('regression: edited as text, a hazard with no AC and no saves grows "AC 0" and three "+0" save boxes', () => {
    // creatureToText always writes "AC 0; Fort +0, Ref +0, Will +0" for a hazard. Before the change
    // the stat block never drew a hazard AC box and drew saves only when one was non-zero, so this
    // line was invisible. parseStatBlockText now reads that line as a PRINTED AC and three printed
    // saves (acPrinted: true, savesPrinted: all three), so the edited haunt shows "AC 0", "Fort +0",
    // "Ref +0", "Will +0" — numbers no page and no GM ever wrote.
    const back = throughText(haunt())
    expect(back.isHazard).toBe(true)
    const h = html(back)
    expect(h).not.toContain(defBox('AC'))
    expect(h).not.toContain(defBox('Fort'))
    expect(h).not.toContain(defBox('Will'))
  })

  it('regression: edited as text, a hazard that prints saves but no AC grows an "AC 0" box', () => {
    const back = throughText(hazard({ hp: 30, fort: 12, ref: 8, acPrinted: false, savesPrinted: ['fort', 'ref'] }))
    expect(html(back)).not.toContain(defBox('AC'))
  })

  it('gap: edited as text, a hazard that prints only Fort draws Ref +0 and Will +0 beside it', () => {
    // Before the change every hazard with any save drew all three, so this is not worse than the
    // base; it is the savesPrinted field lost on the text path.
    const back = throughText(hazard({ ac: 20, hp: 30, fort: 10, acPrinted: true, savesPrinted: ['fort'] }))
    const h = html(back)
    expect(h).toContain(defBox('AC'))
    expect(h).toContain(defBox('Fort'))
    expect(h).not.toContain(defBox('Ref'))
    expect(h).not.toContain(defBox('Will'))
  })
})

describe('TextConverter text path on an Archives creature: the page fields the change added', () => {
  it('gap: the page Recall Knowledge line is replaced by a computed DC after a text edit', () => {
    // A level-1 uncommon page creature whose page prints DC 18. creatureToText writes no Recall
    // Knowledge line (parseStatBlockText reads one when it is there), and the parsed record has no
    // page marker, so the row is computed from level: DC 15, a number the page does not print.
    const page = creature({ fromArchivesPage: true, recallKnowledge: 'DC 18 • Humanoid (Society)' })
    expect(rkLine(text(html(page)))).toBe('Recall Knowledge DC 18')
    expect(rkLine(text(html(throughText(page))))).toBe('Recall Knowledge DC 18')
  })

  it('gap: telepathy (languageAbilities) is gone from the Languages line after a text edit', () => {
    const page = creature({ fromArchivesPage: true, recallKnowledge: 'DC 15 • Humanoid (Society)', languageAbilities: ['telepathy 100 feet'] })
    expect(text(html(page))).toContain('telepathy 100 feet')
    expect(text(html(throughText(page)))).toContain('telepathy 100 feet')
  })

  it('gap: the second HP pool (a hydra head) is gone from the HP line after a text edit', () => {
    const hydra = creature({
      fromArchivesPage: true, recallKnowledge: 'DC 15 • Beast (Arcana or Nature)', traits: ['Huge', 'Beast'],
      defenses: { ...DEF, hp: 90, hpNote: 'body, hydra regeneration', hpPools: [{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }] },
    })
    expect(text(html(hydra))).toContain('15 (head, head regrowth)')
    expect(text(html(throughText(hydra)))).toContain('15 (head, head regrowth)')
  })
})

describe('fix round 4 (D18): a text edit of a verified corpus record draws the same stat block', () => {
  type Sample = { id: string; kind: 'creature' | 'hazard'; record: Record<string, unknown> }
  const SAMPLES = (renderSamples as unknown as { samples: Sample[] }).samples
  /** The record the tracker serves, as the TextConverter seeds its text pane with it. */
  const served = (s: Sample): Creature => toStatBlock(JSON.parse(JSON.stringify(s.kind === 'hazard'
    ? parseHazard(s.record as unknown as RawHazard)
    : parseCreature(s.record as unknown as RawCreature))))!
  /** The drawn text with all whitespace removed: a strike's "2d6+7 piercing" may come back as the
   *  formula and its type in two spans ("2d6+7" + "piercing"), the same words in the same order. */
  const flat = (c: Creature) => text(html(c)).replace(/\s+/g, '')

  it('every record: the drawn text after creatureToText → Parse equals the drawn text before', () => {
    // Fails at cc7ff45 on 82 of 82 records (HP pools, Recall Knowledge, language abilities, ability
    // sections, hazard sections, spell ranks … all lost). Compared: the record as the board carries it
    // after a save (rawMarkdown / aonUrl / raw are not part of a text edit), against what Parse reads
    // back with the record's id and source kept (TextConverter.handleParse).
    const differ: string[] = []
    for (const s of SAMPLES) {
      const c = served(s)
      const before: Creature = { ...c, rawMarkdown: undefined, aonUrl: undefined, raw: {} as Creature['raw'] }
      const back: Creature = { ...throughText(c), id: c.id, source: c.source }
      const a = flat(before)
      const b = flat(back)
      if (a !== b) {
        let k = 0
        while (k < a.length && a[k] === b[k]) k++
        differ.push(`${s.id} ${c.name}: …${a.slice(Math.max(0, k - 40), k + 40)}… vs …${b.slice(Math.max(0, k - 40), k + 40)}…`)
      }
    }
    expect(differ).toEqual([])
  })
})

describe('guard: the Settings stat-block editor (StatBlock edit mode) draws each ability once', () => {
  const editApi: SbEditApi = {
    selectedId: null, onSelect: () => {}, onReorder: () => {}, onPatch: () => {}, onDropMerge: () => {},
  }
  const ab = (name: string, slot?: Ability['slot']): Ability =>
    ({ name, traits: [], entries: `${name} body text.`, ...(slot ? { slot } : {}) })

  it('a page record with top, mid and bot abilities: each once, top before the Defense strip, mid after it', () => {
    const c = creature({ abilities: [ab('Topaura', 'top'), ab('Midreact', 'mid'), ab('Botpower', 'bot')] })
    const h = renderToStaticMarkup(<StatBlock combatant={combatantOf(c)} edit={editApi} />)
    for (const n of ['Topaura', 'Midreact', 'Botpower']) expect(count(h, `${n} body text.`)).toBe(1)
    expect(h.indexOf('Topaura body')).toBeLessThan(h.indexOf(defBox('AC')))
    expect(h.indexOf(defBox('AC'))).toBeLessThan(h.indexOf('Midreact body'))
    expect(h.indexOf('Midreact body')).toBeLessThan(h.indexOf('Botpower body'))
  })

  it('a hand-built record with slot-less abilities: each once, in their order, after the Defense strip', () => {
    const c = creature({ abilities: [ab('Firstone'), ab('Secondone')] })
    const h = renderToStaticMarkup(<StatBlock combatant={combatantOf(c)} edit={editApi} />)
    expect(count(h, 'Firstone body text.')).toBe(1)
    expect(count(h, 'Secondone body text.')).toBe(1)
    expect(h.indexOf(defBox('AC'))).toBeLessThan(h.indexOf('Firstone body'))
    expect(h.indexOf('Firstone body')).toBeLessThan(h.indexOf('Secondone body'))
  })
})

describe('guard: an encounter saved BEFORE the change loads and draws as it did', () => {
  beforeEach(() => {
    localStorage.clear(); invalidateEncounterCache()
    useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null, savedSignature: null } as never)
  })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache() })

  // The old snapshot shape: slimmed (no rawMarkdown, no raw), flat abilities with no slot, no page
  // marker, no recallKnowledge, a hazard with no acPrinted / savesPrinted / hpPools.
  const oldCreature = creature({
    name: 'Old Snapshot Brute', level: 3,
    abilities: [{ name: 'Oldaura', traits: ['aura'], entries: 'Oldaura body text.' }, { name: 'Oldreact', activity: 'R', traits: [], entries: 'Oldreact body text.' }],
  })
  const oldHazard = hazard({ ac: 20, fort: 10, ref: 6, will: 0, hp: 24, bt: 12 }, { name: 'Old Snapshot Trap' })
  const saved: SavedEncounter = {
    name: 'old-shape', savedAt: '2026-09-01T00:00:00.000Z',
    combatants: [
      { name: 'Old Snapshot Brute', creature: oldCreature, creatureId: oldCreature.id, isPC: false, maxHP: 40, isElite: false, isWeak: false, notes: '' },
      { name: 'Old Snapshot Trap', creature: oldHazard, creatureId: oldHazard.id, isPC: false, maxHP: 24, isElite: false, isWeak: false, notes: '' },
    ],
  } as SavedEncounter

  it('the creature keeps its computed Recall Knowledge row and draws each slot-less ability once, after the Defense strip', () => {
    writeEncounterStore({ 'old-shape': saved })
    invalidateEncounterCache()
    useCombatStore.getState().loadEncounter('old-shape', new Map())
    const brute = useCombatStore.getState().combatants.find(c => c.name === 'Old Snapshot Brute')!
    const h = renderToStaticMarkup(<StatBlock combatant={brute} />)
    // Level 3, no page → computed: DC 18 (the by-level table), as before the change.
    expect(rkLine(text(h))).toBe('Recall Knowledge DC 18')
    expect(count(h, 'Oldaura body text.')).toBe(1)
    expect(count(h, 'Oldreact body text.')).toBe(1)
    expect(h.indexOf(defBox('AC'))).toBeLessThan(h.indexOf('Oldaura body'))
  })

  it('the hazard draws no AC box (none did before the flag) and keeps its saves (old rule: any save → all three)', () => {
    writeEncounterStore({ 'old-shape': saved })
    invalidateEncounterCache()
    useCombatStore.getState().loadEncounter('old-shape', new Map())
    const trap = useCombatStore.getState().combatants.find(c => c.name === 'Old Snapshot Trap')!
    const h = renderToStaticMarkup(<StatBlock combatant={trap} />)
    expect(h).not.toContain(defBox('AC'))
    expect(h).toContain(defBox('Fort'))
    expect(h).toContain(defBox('Ref'))
    expect(h).toContain(defBox('Will'))
    expect(text(h)).toContain('24')
  })
})
