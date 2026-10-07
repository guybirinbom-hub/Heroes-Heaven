import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render as domRender } from '@testing-library/react'
import { StatBlock } from './StatBlock'
import { StatBlockBuilder } from './StatBlockBuilder'
import { CombatantDetail } from './CombatantDetail'
import { useSettingsStore, STATBLOCK_DEFAULT } from '../store/settingsStore'
import { useCombatStore, invalidateEncounterCache } from '../store/combatStore'
import { loadCustomCreatures, reloadCustomCreatures, statBlockProblem } from '../data/dataStore'
import { parseHazard } from '../utils/parseCreature'
import type { Combatant, Creature, Defenses, RawHazard } from '../types/pf2e'

/*
 * REFUTE ROUND 2, REGRESSION LENS — the verified-bestiary adapter + renderer + loader change, walked
 * through data written BEFORE the change (the base commit 7cfb323): homebrew made in the old
 * builder or by pasting, homebrew saved from an old bestiary combatant, and the surfaces that show a
 * combatant other than StatBlock (CombatantDetail). Round 1 (StatBlock.regression*.test.tsx) covered
 * saved encounters of adapter-built records, elite/weak pools, export → import and the builder on
 * page records; this file covers what it did not.
 *
 * `regression:` passes on the base commit and fails on this lane. `D13:` is an orchestrator
 * decision not yet built. `gap:` fails on both (the new field does not reach that surface).
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
    perception: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    defenses: { ac: 0, fort: 0, ref: 0, will: 0, hp: 0, immunities: [], resistances: [], weaknesses: [], ...def },
    hazardData: { stealth: 'DC 20', description: 'A synthetic trap.', disable: 'Thievery DC 20', routine: '', reset: '', complex: false },
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

/** Mount the builder on `initial` and return the creature its first onChange emits (unchanged form). */
function throughBuilder(initial: Creature): Creature {
  let last: Creature | null = null
  domRender(<StatBlockBuilder initial={initial} onChange={c => { last = c }} />)
  expect(last).not.toBeNull()
  return last!
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

// ── 1 ──────────────────────────────────────────────────────────────────────────────────────────
describe('regression: homebrew saved from an OLD bestiary combatant loses its Recall Knowledge row', () => {
  // The base adapter put the Archives page on every record (rawMarkdown; every base shard carries
  // _aon.markdown, the Recall Knowledge sidebar included) but never filled recallKnowledge. A GM who
  // opened such a combatant with CombatantDetail → Edit and saved it (the base builder spread
  // `...base`, so rawMarkdown came along) holds a homebrew record with rawMarkdown and no
  // recallKnowledge. The base renderer computed its row (DC 15 for a level-1 humanoid). The new
  // rule treats "rawMarkdown present" as "a page that prints no Recall Knowledge" and shows NOTHING,
  // although the page it carries prints one; slimCombatantForPersist then stamps fromArchivesPage on
  // it, so the row stays gone after a reload too.
  // A strike, so the stat block draws the record itself and not the raw-page fallback
  // (StatBlock prints rawMarkdown verbatim for a creature with no strikes and no ability text).
  const oldHomebrew = () => creature({
    id: 'old-brew', source: 'Test',
    attacks: [{ range: 'Melee', name: 'synthclub', attack: 7, traits: [], damage: '1d6+3', types: ['bludgeoning'], effects: [], isAgile: false }],
    rawMarkdown: [
      '**[Recall Knowledge - Humanoid](/Rules.aspx?ID=563)**',
      '([Society](/Skills.aspx?ID=48)): DC 15',
      '',
      '**[Unspecific Lore](/Rules.aspx?ID=563)**: DC 13',
      '',
      '<title level="2" right="Creature 1">Synthetic Raider</title>',
    ].join('\n'),
  })

  beforeEach(() => {
    localStorage.clear(); invalidateEncounterCache()
    useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null, savedSignature: null } as never)
  })
  afterEach(() => { localStorage.clear(); invalidateEncounterCache() })

  it('live: the row still shows (DC 15, what the page prints and what the base computed)', () => {
    expect(rkLine(text(html(oldHomebrew())))).toBe('Recall Knowledge DC 15')
  })

  it('after saveEncounter → loadEncounter the row still shows', () => {
    useCombatStore.getState().addCombatant(oldHomebrew(), { name: 'Synthetic Raider' })
    useCombatStore.getState().saveEncounter('regression2-rk')
    useCombatStore.setState({ combatants: [] } as never)
    useCombatStore.getState().loadEncounter('regression2-rk', [])
    const loaded = useCombatStore.getState().combatants[0]
    expect(loaded?.creature?.name).toBe('Synthetic Raider')
    expect(rkLine(text(renderToStaticMarkup(<StatBlock combatant={loaded} />)))).toBe('Recall Knowledge DC 15')
  })
})

// ── 2 ──────────────────────────────────────────────────────────────────────────────────────────
describe('regression: a homebrew hazard stored before the change grows an "AC 10" box', () => {
  // The base builder started a hazard's AC field at 10 (`ac: initial?.defenses?.ac ?? 10`, saved as
  // `num(def.ac, 10)`) and the base text parser at `let ac = 10`, so nearly every stored homebrew
  // hazard holds ac: 10 the GM never typed — and the base renderer drew NO hazard AC box at all
  // (`if (!isHazard)` around the AC entry). Stored hazards carry no acPrinted, so the new fallback
  // ("no flag → AC box when ac > 0") draws an invented "AC 10" on every one of them after the update:
  // the defect D4/D12 fixed for new hazards, back on the GM's existing homebrew.
  // The fallback is the interface rule for in-memory records, so this test reads the hazard the way
  // the board gets it: from the homebrew store.
  const stored = {
    id: 'old-trap', name: 'Synthetic Old Trap', source: 'Homebrew', level: 2, traits: ['trap'], isHazard: true,
    perception: 0, senses: [], languages: [], skills: {}, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    items: [], speed: {}, attacks: [], spellcasting: [], abilities: [],
    defenses: { ac: 10, fort: 0, ref: 0, will: 0, hp: 20, hardness: 5, immunities: [], resistances: [], weaknesses: [] },
    hazardData: { stealth: 'DC 18', description: 'An old trap.', disable: 'Thievery DC 18', routine: '', reset: '', complex: false },
    raw: {},
  }
  beforeEach(() => { localStorage.clear(); reloadCustomCreatures() })
  afterEach(() => { localStorage.clear(); reloadCustomCreatures() })

  it('read back from the homebrew store, it draws no AC box (the base drew none)', () => {
    localStorage.setItem('pf2e-custom-creatures', JSON.stringify([stored]))
    reloadCustomCreatures()
    const c = loadCustomCreatures().find(x => x.id === 'old-trap')
    expect(c).toBeTruthy()
    const out = html(c!)
    expect(out).toContain(defBox('Hardness'))
    expect(out).not.toContain(defBox('AC'))
  })
})

// ── 3 ──────────────────────────────────────────────────────────────────────────────────────────
describe('regression: the builder flips the AC box of a hazard that carries no acPrinted', () => {
  // The renderer's rule for a hazard without the flag is "AC box when the base ac > 0"; the builder
  // starts acSet at `initial.defenses.acPrinted === true`, i.e. false for every such hazard, and
  // writes acPrinted: false. Opening one in the builder and saving it UNCHANGED removes an AC box
  // the stat block drew a moment before. Whatever the flagless rule is, an untouched save must not
  // change it.
  it('an unchanged builder save draws the AC box exactly when the stat block drew it before', () => {
    const h = hazard({ ac: 20, fort: 8, hp: 30, hardness: 6 })
    const before = html(h).includes(defBox('AC'))
    const after = html(throughBuilder(h)).includes(defBox('AC'))
    expect(after).toBe(before)
  })
})

// ── 4 ──────────────────────────────────────────────────────────────────────────────────────────
const spine = { range: 'Melee' as const, name: 'synthspine', attack: 13, traits: [], damage: '1 piercing', types: [], effects: [], isAgile: false }
const pageHazard = (afterAbility?: unknown): Creature => hazard(
  { ac: 15, hp: 24, fort: 8, savesPrinted: ['fort'], acPrinted: true },
  {
    abilities: [
      { name: 'Synthetic Spring', activity: ' ↺', traits: [], trigger: 'A creature opens the lid.', entries: 'Effect A spine extends.' },
      { name: 'Synthetic Venom', traits: ['poison'], entries: 'Saving Throw DC 19 Fortitude.' },
    ],
    attacks: [{ ...spine, ...(afterAbility !== undefined ? { afterAbility } : {}) } as Creature['attacks'][number]],
    rawMarkdown: '# Synthetic Trap', fromArchivesPage: true,
  },
)

describe('D13: the builder keeps a hazard strike\'s page place (Attack.afterAbility)', () => {
  // build() rebuilds every strike from the form fields (range, name, attack, traits, damage, types),
  // so an untouched save drops afterAbility and the strike moves from between the ability that makes
  // it and its rider to after every ability.
  it('an unchanged save keeps the strike between Spring and its Venom rider', () => {
    const out = throughBuilder(pageHazard(1))
    expect(out.attacks[0]?.afterAbility).toBe(1)
    const h = html(out)
    expect(h.indexOf('Synthetic Spring')).toBeLessThan(h.indexOf('synthspine'))
    expect(h.indexOf('synthspine')).toBeLessThan(h.indexOf('Synthetic Venom'))
  })
})

// ── 5 ──────────────────────────────────────────────────────────────────────────────────────────
describe('D13: the homebrew guard validates Attack.afterAbility', () => {
  // readStatBlock's attackOf spreads `...a` and never looks at afterAbility, so a stored strike with
  // afterAbility "1", -1, 1.5 or past the last ability is ACCEPTED (the renderer only survives it by
  // reading the field defensively).
  const bad: Array<[string, unknown]> = [['text', '1'], ['negative', -1], ['fractional', 1.5], ['past the last ability', 3]]
  for (const [what, v] of bad) {
    it(`refuses afterAbility ${what}`, () => {
      expect(statBlockProblem(JSON.parse(JSON.stringify(pageHazard(v)))) ?? 'accepted').toMatch(/attacks\[0\]\.afterAbility/)
    })
  }
  it('accepts 0 … abilities.length, and null as absent', () => {
    for (const v of [0, 1, 2, null]) expect(statBlockProblem(JSON.parse(JSON.stringify(pageHazard(v)))), String(v)).toBeNull()
  })
})

// ── 6 / 7 ──────────────────────────────────────────────────────────────────────────────────────
describe('the combat detail panel (CombatantDetail), where the GM reads a combatant during a fight', () => {
  // CombatantDetail passes hideHP to StatBlock for every creature, so the stat block's HP line — the
  // only place the further HP pools print — never renders there; the panel prints only
  // defenses.hpNote (pools[0].name) under the HP bar. For hazards the HP line does render.
  // Fixed by D16 (fix round 4, 2026-10-07): both tests below fail at cc7ff45 and pass after it; the
  // finer cases (order, BT, Elite, malformed pools, a hazard with no HP line) are in
  // CombatantDetail.corpus.test.tsx.
  const mount = (c: Creature) => domRender(<CombatantDetail combatant={combatantOf(c)} />).container.textContent ?? ''

  it('gap: a hydra\'s second pool (head) reaches the panel', () => {
    const hydra = creature({
      name: 'Synthetic Hydra', level: 6,
      defenses: { ...DEF, hp: 90, hpNote: 'body, hydra regeneration',
        hpPools: [{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }] },
    })
    const t = mount(hydra)
    expect(t).toContain('body, hydra regeneration')
    expect(t).toContain('head, head regrowth')
  })

  it('regression: a hazard\'s first component label prints once, not under the HP bar AND on the HP line', () => {
    // parseHazard now sets hpNote = pools[0].name (D7), and CombatantDetail prints hpNote under the
    // HP bar for every combatant, hazards included, while the hazard's own HP line prints the same
    // label: "Synthgate" twice (a pool named "BT 27" prints a bare "BT 27" under the bar). The base
    // set no hpNote on hazards, so the label printed once.
    const gate = parseHazard({
      name: 'Synthetic Gate Trap', source: 'Test', level: 3, traits: ['trap', 'mechanical'],
      description: ['A synthetic gate drops.'],
      defenses: { ac: { std: 18 }, hardness: { std: 8 }, hp: [{ hp: 30, name: 'Synthgate' }] },
    } as unknown as RawHazard)
    const t = mount(gate)
    expect(t.split('Synthgate').length - 1).toBe(1)
  })
})
