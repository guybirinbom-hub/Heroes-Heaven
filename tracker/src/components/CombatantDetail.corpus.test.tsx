import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render as domRender } from '@testing-library/react'
import { CombatantDetail } from './CombatantDetail'
import { CreatureCardBody } from './FloatingWindow'
import { parseHazard } from '../utils/parseCreature'
import { useSettingsStore, STATBLOCK_DEFAULT } from '../store/settingsStore'
import type { Combatant, Creature, Defenses, RawHazard } from '../types/pf2e'

/*
 * Fix round 4 (owner panel), decisions D16 and D17 (2026-10-07). Every creature here is synthetic.
 *
 * D16 — the combat panel (CombatantDetail) shows every HP pool: the first is the HP bar with its note
 * under it, as before; each further pool is listed under it with its own name. A hazard's first
 * component label prints exactly once (its stat block's HP line prints it; the bar's note does not).
 * D17 — the creature card (FloatingWindow's CreatureCard, opened from global search, a creature link
 * in prose or a random-encounter pick) draws a hazard's AC only when acPrinted (or, no flag at all,
 * when the base AC is above 0) and only the saves in savesPrinted; a creature's card is unchanged.
 *
 * Each test names the change it guards and fails without it.
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

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const visible = (h: string) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const count = (t: string, w: string) => t.split(w).length - 1
const panel = (c: Creature, over: Partial<Combatant> = {}) => renderToStaticMarkup(<CombatantDetail combatant={combatantOf(c, over)} />)
/** The box under the HP bar (spans only inside it), as text; '' when the panel draws none. */
const underBar = (h: string) => {
  const m = h.match(/<div style="font-size:11px;color:var\(--text-muted\);margin-top:2px">([\s\S]*?)<\/div>/)
  return m ? visible(m[1]) : ''
}

afterEach(() => cleanup())

const hydra = () => creature({
  name: 'Synthetic Hydra', level: 6,
  defenses: { ...DEF, hp: 90, hpNote: 'body, synthetic regeneration',
    hpPools: [{ hp: 90, name: 'body, synthetic regeneration' }, { hp: 15, name: 'head, head regrowth' }, { hp: 12, name: 'tail (BT 6)' }] },
})

describe('D16: the combat panel lists every HP pool under the bar', () => {
  // Fails without D16: the panel printed only defenses.hpNote, so "15" and "head, head regrowth" never
  // reached it (the stat block's HP line is hidden for creatures on the panel).
  it('a further pool prints under the bar with its number and its own name, in one pair of brackets', () => {
    const t = underBar(panel(hydra()))
    expect(t).toContain('body, synthetic regeneration')
    expect(t).toContain('HP 15 (head, head regrowth)')
    // A pool's own Broken Threshold is pulled out of its name, as on the stat block's HP line.
    expect(t).toContain('HP 12 (tail) BT 6')
    expect(t).not.toMatch(/\(\s*\(/)
  })

  // Fails without D16 (no further pool at all) and guards the order: the bar's note first, then the
  // pools in their stored order.
  it('pools print in their stored order after the first pool\'s note', () => {
    const t = underBar(panel(hydra()))
    expect(t.indexOf('body, synthetic regeneration')).toBeLessThan(t.indexOf('HP 15'))
    expect(t.indexOf('HP 15')).toBeLessThan(t.indexOf('HP 12'))
  })

  // Guards that the first pool is not listed twice (it is the bar): one "90" only, the bar's.
  it('the first pool is the bar, not listed again', () => {
    expect(underBar(panel(hydra()))).not.toMatch(/\b90\b/)
  })

  // An Elite hydra: the bar is the store's adjusted max; further pools print as stored, as the stat
  // block's own HP line prints them (Elite / Weak adjust defenses.hp only).
  it('an Elite combatant keeps every further pool under its adjusted bar', () => {
    const h = panel(hydra(), { isElite: true, maxHP: 110, currentHP: 110 })
    expect(underBar(h)).toContain('HP 15 (head, head regrowth)')
  })

  // A pool-less creature and a single-pool creature draw what they drew before: the note only.
  it('a creature with one pool prints its note only; with no note and one pool, no box', () => {
    const one = creature({ defenses: { ...DEF, hpNote: 'negative healing', hpPools: [{ hp: 40, name: 'negative healing' }] } })
    expect(underBar(panel(one))).toBe('negative healing')
    expect(underBar(panel(creature()))).toBe('')
  })

  // A homebrew JSON can hold anything in hpPools: a string, nulls. Read defensively, never thrown on.
  it('malformed pools are skipped, not thrown on', () => {
    const bad = creature({ defenses: { ...DEF, hpPools: [{ hp: 40 }, null, 'x', { hp: '7' }, { hp: 9, name: 'wing' }] as unknown as Defenses['hpPools'] } })
    expect(underBar(panel(bad))).toBe('HP 9 (wing)')
  })

  // Fails without D16: parseHazard sets hpNote = pools[0].name (D7) and the panel printed it under the
  // bar while the hazard's own HP line printed it too ("Synthgate" twice).
  it('a hazard\'s first component label prints exactly once on the panel', () => {
    const gate = parseHazard({
      name: 'Synthetic Gate Trap', source: 'Test', level: 3, traits: ['trap', 'mechanical'],
      description: ['A synthetic gate drops.'],
      defenses: { ac: { std: 18 }, hardness: { std: 8 }, hp: [{ hp: 30, name: 'Synthgate' }, { hp: 12, name: 'Synthlatch (BT 6)' }] },
    } as unknown as RawHazard)
    const t = domRender(<CombatantDetail combatant={combatantOf(gate)} />).container.textContent ?? ''
    expect(count(t, 'Synthgate')).toBe(1)
    // ... and its further components print once too: on the stat block's HP line, not again under the bar.
    expect(count(t, 'Synthlatch')).toBe(1)
  })

  // Fix round 5 (refuter finding "With the Hit Points row hidden, the panel shows a hazard's component
  // label nowhere"). Fails without it: with Settings → stat block → Hit Points hidden, the stat block
  // draws no HP line, and the panel still suppressed the note and every further pool for a hazard —
  // "Synthgate" and "Synthlatch" printed 0 times. Now the panel is the one place: each prints once,
  // under the bar. A DOM render, so the settings store's live state is read.
  it('with the Hit Points row hidden, a hazard\'s components print once each, under the bar', () => {
    const gate = parseHazard({
      name: 'Synthetic Gate Trap', source: 'Test', level: 3, traits: ['trap', 'mechanical'],
      description: ['A synthetic gate drops.'],
      defenses: { ac: { std: 18 }, hardness: { std: 8 }, hp: [{ hp: 30, name: 'Synthgate' }, { hp: 12, name: 'Synthlatch (BT 6)' }] },
    } as unknown as RawHazard)
    useSettingsStore.setState({ statBlock: { ...STATBLOCK_DEFAULT, items: STATBLOCK_DEFAULT.items.map(it => (it.id === 'hp' ? { ...it, hidden: true } : it)) } })
    try {
      const t = domRender(<CombatantDetail combatant={combatantOf(gate)} />).container.textContent ?? ''
      expect(count(t, 'Synthgate')).toBe(1)
      expect(count(t, 'Synthlatch')).toBe(1)
      expect(t).toContain('HP 12 (Synthlatch) BT 6')
    } finally {
      useSettingsStore.setState({ statBlock: STATBLOCK_DEFAULT })
    }
  })

  // A hazard whose stat block draws no HP line (hp 0) keeps its note under the bar: the one place left.
  it('a hazard with no HP line keeps its note under the bar', () => {
    const h = hazard({ hp: 0, hpNote: 'synthetic note' })
    expect(count(visible(panel(h)), 'synthetic note')).toBe(1)
  })
})

describe('D17: the creature card prints a hazard\'s AC and saves only as printed', () => {
  const card = (c: Creature) => renderToStaticMarkup(<CreatureCardBody c={c} />)
  /** The AC / save values the card draws, by label (the oracle's own reading of the card). */
  const shown = (h: string) => new Map([...h.matchAll(/>(AC|Fort|Ref|Will)<\/span><span[^>]*>([^<]*)<\/span>/g)].map(m => [m[1], decode(m[2]).trim()]))

  // Fails without D17: the card drew "AC 0 · Fort +0 Ref +0 Will +0" for every hazard.
  it('a page hazard with no AC line and only Fort draws Fort alone', () => {
    const h = hazard({ ac: 0, fort: 12, hp: 30, acPrinted: false, savesPrinted: ['fort'] })
    expect([...shown(card(h))]).toEqual([['Fort', '+12']])
  })

  it('a page hazard printing AC and all saves draws all four', () => {
    const h = hazard({ ac: 22, fort: 12, ref: 9, will: 4, hp: 30, acPrinted: true, savesPrinted: ['fort', 'ref', 'will'] })
    expect([...shown(card(h))]).toEqual([['AC', '22'], ['Fort', '+12'], ['Ref', '+9'], ['Will', '+4']])
  })

  // Fails without D17: acPrinted false with a stored AC (an Elite-shifted 2, a stray 10) drew "AC".
  it('acPrinted false draws no AC even when ac > 0; no printed save draws no save row at all', () => {
    const h = hazard({ ac: 10, hp: 20, acPrinted: false, savesPrinted: [] })
    const out = card(h)
    expect(shown(out).size).toBe(0)
    expect(visible(out)).not.toMatch(/\bAC\b|Fort|Ref|Will/)
  })

  // The flagless rule D17 names: no acPrinted → AC when the base AC is above 0; no savesPrinted → the
  // stat block's fallback (all three when any is set, none when all are 0).
  it('a flagless hazard: AC iff ac > 0, saves all-or-none', () => {
    expect([...shown(card(hazard({ ac: 19, fort: 6, hp: 20 })))].map(x => x[0])).toEqual(['AC', 'Fort', 'Ref', 'Will'])
    expect(shown(card(hazard({ ac: 0, hp: 20 }))).size).toBe(0)
  })

  // A homebrew JSON can hold a string or a number in these flags: read defensively.
  it('malformed flags read as absent for saves and as not-true for AC', () => {
    const h = hazard({ ac: 15, fort: 3, hp: 20, acPrinted: 'yes' as unknown as boolean, savesPrinted: 'fort' as unknown as Defenses['savesPrinted'] })
    expect([...shown(card(h))].map(x => x[0])).toEqual(['Fort', 'Ref', 'Will'])
  })

  // Creatures unchanged: AC and all three saves, even a 0.
  it('a creature card is unchanged: AC and all three saves', () => {
    const c = creature({ defenses: { ...DEF, ref: 0, savesPrinted: ['fort'], acPrinted: false } })
    expect([...shown(card(c))]).toEqual([['AC', '18'], ['Fort', '+9'], ['Ref', '+0'], ['Will', '+5']])
  })
})
