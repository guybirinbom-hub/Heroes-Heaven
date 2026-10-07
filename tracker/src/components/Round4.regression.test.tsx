import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render as domRender } from '@testing-library/react'
import { CombatantDetail } from './CombatantDetail'
import { parseStatBlockText } from '../utils/parseStatBlockText'
import { creatureToText } from '../utils/creatureToText'
import { useCombatStore, invalidateEncounterCache, readEncounterStore, writeEncounterStore } from '../store/combatStore'
import { useSettingsStore, STATBLOCK_DEFAULT } from '../store/settingsStore'
import { importEncountersFromText } from '../utils/encounterTransfer'
import { saveCustomCreature, reloadCustomCreatures } from '../data/dataStore'
import { applyWeakElite } from '../utils/weakElite'
import type { Combatant, Creature, Defenses, SavedEncounter } from '../types/pf2e'

/*
 * REFUTE ROUND 4, REGRESSION LENS (2026-10-07). The round-4 fixes (D16 panel, D17 card, D18 text
 * path, D19 HP on load) walked through the consumers they did not test: a paste the GM indents, a
 * save with its own note, a homebrew record made by the cc7ff45 paste parser and then text-edited, a
 * builder-made creature through the text path, a hazard with no HP loaded as Elite / Weak, a PC and
 * a name-only row in the panel, Elite toggled after a load.
 *
 * `regression` = worked at cc7ff45, broken by round 4 (each was checked against the cc7ff45 files
 * with the same input). `gap` = wrong at cc7ff45 too, still wrong. `guard` = still works; pinned.
 * Every record and text here is synthetic.
 */

const parse = (t: string) => {
  const r = parseStatBlockText(t)
  expect(r.creature, r.errors.join('; ')).not.toBeNull()
  return r.creature!
}
/** What the TextConverter does on any text edit: the record → its text → the record parsed back. */
const throughText = (c: Creature) => parse(creatureToText(c))

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'r4-synth', name: 'Synthetic Warden', source: 'Custom', level: 1,
    traits: ['Medium', 'Humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
    str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...DEF }, isHazard: false,
    raw: {} as Creature['raw'],
    ...over,
  }
}
function hazard(def: Partial<Defenses> = {}, over: Partial<Creature> = {}): Creature {
  return creature({
    id: 'r4-haunt', name: 'Synthetic Cold Haunt', level: 4, traits: ['Haunt'], isHazard: true,
    languages: [], speed: {}, perception: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    defenses: { ac: 0, fort: 0, ref: 0, will: 0, hp: 0, acPrinted: false, savesPrinted: ['will'], immunities: [], resistances: [], weaknesses: [], ...def },
    hazardData: { stealth: 'DC 22 (trained)', description: 'Cold air.', disable: 'Religion DC 22', routine: '', reset: '', complex: false },
    ...over,
  })
}

// ── D18 text path: a pasted block ────────────────────────────────────────────────────────────────
const BLOCK = `Synthetic Marsh Brute
Creature 4
Medium Humanoid
Perception +10; darkvision
Languages Common
Skills Athletics +12
Str +4, Dex +1, Con +3, Int -1, Wis +1, Cha +0
Bog Stench (aura) 10 feet. A creature in the aura is sickened 1.
AC 21; Fort +13, Ref +8, Will +10
HP 60
Attack of Opportunity [reaction]
Speed 25 feet, swim 20 feet
Melee [one-action] club +13 (agile), Damage 1d6+7 bludgeoning
Mud Slam [two-actions] The brute slams the ground.`

const facts = (c: Creature) => ({
  ac: c.defenses.ac, hp: c.defenses.hp, saves: [c.defenses.fort, c.defenses.ref, c.defenses.will],
  speed: c.speed, strikes: c.attacks.map(a => [a.name, a.attack, a.damage]), abilities: c.abilities.map(a => a.name),
})

describe('round 4 regression lens: the text path (D18)', () => {
  // regression. cc7ff45 trimmed every line, so a block pasted with every line indented (from a code
  // block, a quoted mail, a PDF, a forum post) read as it does unindented. Round 4 reads an indented
  // line as a continuation of the ability above it: after "Bog Stench" every following line is
  // swallowed into that ability — AC 10, HP 10, saves 0, speed 25, no strike, one ability. Measured
  // on 400 Archives creatures pasted indented: AC/HP/saves lost on 216, strikes changed on 308
  // (cc7ff45: 0 lost). A uniform indent is not a continuation.
  it('regression: a block pasted with every line indented (two spaces, or a tab) reads as it does unindented', () => {
    const plain = facts(parse(BLOCK))
    expect(plain).toEqual({
      ac: 21, hp: 60, saves: [13, 8, 10], speed: { walk: 25, swim: 20 },
      strikes: [['club', 13, '1d6+7']], abilities: ['Bog Stench', 'Attack of Opportunity', 'Mud Slam'],
    })
    expect(facts(parse(BLOCK.split('\n').map(l => `  ${l}`).join('\n')))).toEqual(plain)
    expect(facts(parse(BLOCK.split('\n').map(l => `\t${l}`).join('\n')))).toEqual(plain)
  })

  // regression. readSaves stops at the first text that is not a save, so a save printed with its own
  // note ("Ref +22 (+24 vs. traps)") ends the run: every later save reads 0 and the rest of the line
  // becomes the save note. cc7ff45 read each save on its own (values right, note dropped). The
  // Archives prints such a note after Fort or Ref on ~1 % of creature pages (4 of a 400-page sample).
  it('regression: a save with its own note does not zero the saves after it', () => {
    const a = parse('Synthetic Sentinel CREATURE 6\nPerception +12\nAC 30; Fort +20, Ref +22 (+24 vs. traps), Will +18\nHP 90').defenses
    expect([a.fort, a.ref, a.will]).toEqual([20, 22, 18])
    const b = parse('Synthetic Sentinel CREATURE 6\nPerception +12\nAC 25; Fort +15 (+17 vs. poison), Ref +9, Will +12\nHP 90').defenses
    expect([b.fort, b.ref, b.will]).toEqual([15, 9, 12])
    const h = parse('Synthetic Rust Trap HAZARD 3\nStealth DC 20 (trained)\nAC 18; Fort +10 (+12 vs. rust), Ref +5\nHP 30').defenses
    expect([h.fort, h.ref, h.savesPrinted]).toEqual([10, 5, ['fort', 'ref']])
  })

  // regression. The cc7ff45 paste parser stored "Damage 2d8+6 piercing plus Grab" as damage
  // "2d8+6 plus Grab" with types ["piercing"] (every homebrew record pasted before round 4 holds
  // this shape: 331 of 621 sampled Archives pastes). Round 4 writes "Damage 2d8+6 plus Grab piercing"
  // and reads a damage that is more than a formula whole, so a text edit empties `types`: the
  // builder's "Damage types" field goes blank, Monster Parts imbuements lose the record's damage
  // types, and the stat block's muted "piercing" moves into the damage text. cc7ff45's text edit
  // kept ["piercing"].
  it('regression: a text edit keeps a strike\'s separate damage types when its damage is more than a formula', () => {
    const c = creature({ attacks: [{ range: 'Melee', name: 'jaws', attack: 10, traits: [], damage: '2d8+6 plus Grab', types: ['piercing'], effects: [], isAgile: false }] })
    const back = throughText(c).attacks[0]
    expect([back.damage, back.types]).toEqual(['2d8+6 plus Grab', ['piercing']])
  })

  // gap (cc7ff45 mangled it too: damage "1d8+4 plus 1d6", types ["fire", "slashing"]). A builder
  // strike with a "plus" clause and a separate type comes back with the type glued into the text.
  it('gap: a builder strike "1d8+4 plus 1d6 fire" typed slashing keeps both through a text edit', () => {
    const c = creature({ attacks: [{ range: 'Melee', name: 'claw', attack: 9, traits: [], damage: '1d8+4 plus 1d6 fire', types: ['slashing'], effects: [], isAgile: false }] })
    const back = throughText(c).attacks[0]
    expect([back.damage, back.types]).toEqual(['1d8+4 plus 1d6 fire', ['slashing']])
  })

  // low (no drawn difference: one unnamed pool prints as the plain HP). The brief: a text round trip
  // of a hand-built creature must not invent fields. Round 4's parser writes hpPools [{ hp }] for
  // every HP line, so a builder-made creature gains a pool it never had on its first text edit.
  it('low: a text edit of a builder-made creature invents no HP pool', () => {
    const c = creature({ defenses: { ...DEF, resistances: [{ name: 'acid', amount: 5 }] } })
    expect(throughText(c).defenses).toEqual(c.defenses)
  })

  // guard: the rest of a builder-made creature survives (cc7ff45 lost its lower-case traits and
  // shifted its abilities; round 4 keeps them).
  it('guard: a builder-made creature with lower-case traits, a reaction and a trigger survives a text edit', () => {
    const c = creature({
      traits: ['uncommon', 'medium', 'aberration'],
      abilities: [
        { name: 'Mud Sense', traits: [], entries: 'It senses creatures in mud within 30 feet.' },
        { name: 'Snap Back', activity: '↺', traits: [], trigger: 'A creature moves away.', entries: 'The warden Strikes.' },
      ],
    })
    const back = throughText(c)
    expect(back.traits).toEqual(c.traits)
    expect(back.abilities.map(a => [a.name, a.activity, a.trigger, a.entries]))
      .toEqual([['Mud Sense', undefined, undefined, 'It senses creatures in mud within 30 feet.'], ['Snap Back', '↺', 'A creature moves away.', 'The warden Strikes.']])
  })
})

// ── D19: HP on load ──────────────────────────────────────────────────────────────────────────────
const st = () => useCombatStore.getState()
function resetBoard() {
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
}
function savedRow(c: Creature, how: { isElite?: boolean; isWeak?: boolean }, maxHP: number): SavedEncounter['combatants'][number] {
  return { name: c.name, creature: c, creatureId: c.id, isPC: false, isAlly: false, maxHP, isElite: !!how.isElite, isWeak: !!how.isWeak, notes: '' }
}

describe('round 4 regression lens: HP on load (D19)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }))
    localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache(); resetBoard()
  })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); reloadCustomCreatures(); invalidateEncounterCache(); resetBoard() })

  // regression. A hazard with no HP (a haunt, a magical trap) tagged Elite or Weak in a saved
  // encounter loaded at cc7ff45 with maxHP 0 (the printed stat block), so the board drew no HP bar.
  // Round 4 loads it with applyWeakElite's Math.max(1, 0 ± n): Elite 15, Weak 1 — an HP bar, and
  // damage that can drop it to 0, on a hazard that has no Hit Points. (The board's own Elite toggle
  // does the same and did at cc7ff45; load now copies it. Fix in one place: a record with no HP gains
  // none.)
  it('regression: a saved Elite / Weak hazard with no HP loads with no HP', () => {
    const h = hazard()
    expect(applyWeakElite(h, 'elite').defenses.hp).toBe(0) // round 4 fixed the source: a record with no HP gains none
    writeEncounterStore({ haunt: { name: 'haunt', savedAt: '2026-10-01T00:00:00.000Z', combatants: [savedRow(h, { isElite: true }, 0), savedRow(h, { isWeak: true }, 0)] } })
    invalidateEncounterCache()
    st().loadEncounter('haunt', new Map())
    expect(st().combatants.map(c => [c.maxHP, c.currentHP])).toEqual([[0, 0], [0, 0]])
  })

  // regression, the file path: cc7ff45 stored the file's maxHP (0); round 4 stores the adjusted one.
  it('regression: an encounter file row for an Elite / Weak hazard with no HP stores no HP', async () => {
    const h = hazard({}, { id: 'r4-haunt-file', name: 'Synthetic File Haunt' })
    delete (h as { raw?: unknown }).raw
    expect(saveCustomCreature(h)).toBe(true)
    const file = {
      version: 1, exportedAt: '2026-10-01T00:00:00.000Z',
      encounters: [{ name: 'haunt file', savedAt: '2026-10-01T00:00:00.000Z', combatants: [
        { name: h.name, creatureName: h.name, isPC: false, isAlly: false, maxHP: 0, isElite: true, isWeak: false, scaledToLevel: null, notes: '' },
        { name: h.name, creatureName: h.name, isPC: false, isAlly: false, maxHP: 0, isElite: false, isWeak: true, scaledToLevel: null, notes: '' },
      ] }],
    }
    const res = await importEncountersFromText(JSON.stringify(file))
    expect(res.ok && res.missing.length === 0).toBe(true)
    expect(readEncounterStore()['haunt file'].combatants.map(c => c.maxHP)).toEqual([0, 0])
  })

  // guard: Elite toggled off and on after a load keeps the damage taken, on the right maxima.
  it('guard: Elite toggled after a load keeps the damage taken', () => {
    const c = creature({ id: 'r4-brute', name: 'Synthetic Brute', level: 3, defenses: { ...DEF, hp: 40 } })
    writeEncounterStore({ brute: { name: 'brute', savedAt: '2026-10-01T00:00:00.000Z', combatants: [savedRow(c, { isElite: true }, 40)] } })
    invalidateEncounterCache()
    st().loadEncounter('brute', new Map())
    const id = st().combatants[0].id
    expect([st().combatants[0].maxHP, st().combatants[0].currentHP]).toEqual([55, 55])
    st().applyDamage(id, 10)
    st().setEliteWeak(id, 'normal')
    expect([st().combatants[0].maxHP, st().combatants[0].currentHP]).toEqual([40, 30])
    st().setEliteWeak(id, 'weak')
    expect([st().combatants[0].maxHP, st().combatants[0].currentHP]).toEqual([25, 15])
  })

  // guard: a save from before the corpus (no hpPools, no acPrinted / savesPrinted, no slot) with a
  // PC row and a name-only row loads; the PC and the name-only row keep their stored maxima.
  it('guard: an old-shape save with a PC and a name-only row loads with the stored maxima', () => {
    const old = creature({ id: 'r4-old', name: 'Synthetic Old Ogre', level: 3, defenses: { ...DEF, hp: 50 } })
    writeEncounterStore({ old: { name: 'old', savedAt: '2026-09-01T00:00:00.000Z', combatants: [
      savedRow(old, { isElite: true }, 50),
      { name: 'Synthetic Hero', creature: null, creatureId: null, isPC: true, maxHP: 31, isElite: false, isWeak: false, notes: '' },
      { name: 'Unknown Thing', creature: null, creatureId: 'gone', isPC: false, maxHP: 12, isElite: true, isWeak: false, notes: '' },
    ] } })
    invalidateEncounterCache()
    st().loadEncounter('old', new Map())
    expect(st().combatants.map(c => [c.name, c.maxHP])).toEqual([['Synthetic Old Ogre', 65], ['Synthetic Hero', 31], ['Unknown Thing', 12]])
  })
})

// ── D16: the panel for rows with no stat block ───────────────────────────────────────────────────
describe('round 4 regression lens: the combat panel (D16)', () => {
  const row = (over: Partial<Combatant>): Combatant => ({
    id: 'r4-row', name: 'Synthetic Hero', creature: null, isPC: true, isAlly: false, initiative: null,
    currentHP: 20, maxHP: 31, tempHP: 0, conditions: [], isElite: false, isWeak: false, notes: '', isDefeated: false, ...over,
  })

  afterEach(() => useSettingsStore.setState({ statBlock: STATBLOCK_DEFAULT }))

  // regression. D16 stops printing a hazard's note under the HP bar whenever its hp is above 0,
  // because the stat block's HP line prints the label. But "Hit Points" is a row the GM can hide in
  // Settings → stat block (canHide: true) — a natural choice on the combat panel, whose bar already
  // shows HP. With that row hidden, the hazard's first component label ("Synthgate") is printed
  // nowhere on the panel. cc7ff45 printed it under the bar (once). D16's own rule: exactly once.
  it('regression: with the Hit Points row hidden, a hazard\'s first component label still prints once', () => {
    const gate = hazard({ ac: 18, acPrinted: true, hp: 30, hpNote: '(Synthgate)', hpPools: [{ hp: 30, name: 'Synthgate' }] }, { name: 'Synthetic Gate Trap' })
    const c: Combatant = { ...row({}), name: gate.name, creature: gate, isPC: false, maxHP: 30, currentHP: 30 }
    // A DOM render: the settings store's live state (a server render reads the store's initial state).
    const labels = () => {
      const t = domRender(<CombatantDetail combatant={c} />).container.textContent ?? ''
      cleanup()
      return t.split('Synthgate').length - 1
    }
    expect(labels()).toBe(1) // the default layout: the stat block's HP line prints it (D16 guard)
    useSettingsStore.setState({ statBlock: { ...STATBLOCK_DEFAULT, items: STATBLOCK_DEFAULT.items.map(it => (it.id === 'hp' ? { ...it, hidden: true } : it)) } })
    expect(labels()).toBe(1)
  })

  // guard: a PC and a name-only monster row draw the panel with no HP-pool box and no throw.
  it('guard: a PC and a name-only row draw without an HP-pool box', () => {
    for (const c of [row({}), row({ isPC: false, name: 'Unknown Thing', maxHP: 0, currentHP: 0 })]) {
      const h = renderToStaticMarkup(<CombatantDetail combatant={c} />)
      expect(h).toContain(c.name)
      expect(h).not.toContain('data-hp-pool')
    }
  })
})
