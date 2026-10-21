import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { SpellInfo, RuleEntry } from '../data/dataStore'
import { useSettingsStore } from '../store/settingsStore'
import { MONSTER_PARTS_RULES } from '../data/monsterPartsRules'
import { buildAonPageIndex, resetAonPagesForTests, type AstPage } from '../data/aonPages'

/*
 * The Archives of Nethys button on the tracker's spell, condition, trait, action, skill and rule popups
 * (the owner, 2026-10-21: "a link to Archives of Nethys on every pop up a user opens … as a toggleable
 * setting"). Their tracker data carries no address, so data/aonPages.ts reads it off Heroes Heaven's page
 * trees (public/ast/<bucket>.json.gz, the root's stamped `url`) — only where the address is EXACT:
 *
 *  (a) each kind: a record the tracker holds whose name is the title of one page of that kind shows
 *      that page's button; a record with no such page shows none; the setting off shows none and
 *      fetches nothing;
 *  (b) a page title that leads to two addresses gives no button (never a pick); one page stored twice
 *      (an `aon-` twin) is still one; a page of another kind in the bucket (a rule page in the spells
 *      bucket) is never a spell's page; the title is matched less its action glyph, curly apostrophes
 *      read straight;
 *  (c) a name the tracker does not hold ("Spell not found") gets no button though a page has that name;
 *      an action whose popup text is the creature abilities glossary's, and a Monster Parts rule, get
 *      none (their text is not the Archives page's);
 *  (d) a floating window draws it in its header, like a pane.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - buildAonPageIndex: `if (!pageRe.test(url)) continue` dropped → (b) red (the rule page joins the
 *    title, two addresses).
 *  - buildAonPageIndex: `urls.size === 1` → `urls.size >= 1` → (b) red (a two-page title links).
 *  - useAonUrl: `show && held` → `show` → (c) red ("not held" links) and (a)'s fetch count red.
 *  - notArchivesText: the action line dropped → (c) red (the ability links).
 *  - notArchivesText: the rule line dropped → (c) red (the Monster Parts rule links).
 *  (Run 2026-10-21: the first four together turned 11 tests red; the fifth alone, 1.)
 *
 * Every record and address here is synthetic.
 */

const page = (title: string, url: string, glyph = false): AstPage => ({
  t: 'doc', url,
  c: [
    { t: 'title', c: [
      { t: 'p', c: [{ t: 'text', v: ' ' }, { t: 'link', c: [{ t: 'text', v: title }] }, { t: 'text', v: ' ' }] },
      ...(glyph ? [{ t: 'actions' }] : []),
    ] },
    { t: 'p', c: [{ t: 'text', v: 'Body text.' }] },
  ],
})

const BUCKETS: Record<string, Record<string, AstPage>> = {
  spells: {
    'synthetic-flare': page('Synthetic Flare', '/Spells.aspx?ID=90101', true),
    'aon-synthetic-flare': page('Synthetic Flare', '/Spells.aspx?ID=90101', true),
    // A rule page filed under a spell's name: never a spell's page.
    'aon-synthetic-veil': page('Synthetic Veil', '/Rules.aspx?ID=90190'),
    'synthetic-veil': page('Synthetic Veil', '/Spells.aspx?ID=90191'),
    'synthetic-ghost': page('Synthetic Ghost', '/Spells.aspx?ID=90192'),
  },
  conditions: { 'synthetic-glare': page('Synthetic Glare', '/Conditions.aspx?ID=90102') },
  trait: { 'gleamers-mark': page('Gleamer’s Mark', '/Traits.aspx?ID=90103') },
  actions: {
    'synthetic-lunge': page('Synthetic Lunge', '/Actions.aspx?ID=90104', true),
    'synthetic-grab': page('Synthetic Grab', '/Actions.aspx?ID=90194'),
  },
  skill: { 'synthetics': page('Synthetics', '/Skills.aspx?ID=90105') },
  rules: {
    'synthetic-footing': page('Synthetic Footing', '/Rules.aspx?ID=90106'),
    'synthetic-influence': page('Synthetic Influence', '/Rules.aspx?ID=90107'),
    'synthetic-influence-other-book': page('Synthetic Influence', '/Rules.aspx?ID=90108'),
    'monster-parts': page(MONSTER_PARTS_RULES[0].name, '/Rules.aspx?ID=90109'),
  },
}

const spell = (name: string): SpellInfo => ({ name, level: 1, traits: [], description: 'A synthetic spell.' })
const rule = (name: string): RuleEntry => ({ name, text: 'Source Synthetic pg. 1\n\nA synthetic rule.' })
vi.mock('../data/gameDataContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/gameDataContext')>()
  const mp = (await import('../data/monsterPartsRules')).MONSTER_PARTS_RULES[0].name
  const data = {
    conditions: new Map([['synthetic glare', 'Source Synthetic pg. 1\n\nGlare.'], ['synthetic dazzle', 'Dazzle.']]),
    traits: new Map([["gleamer's mark", 'A mark.'], ['synthetic nothing', 'No page.']]),
    spells: new Map([
      ['synthetic flare', spell('Synthetic Flare')], ['synthetic veil', spell('Synthetic Veil')],
      ['synthetic nothing', spell('Synthetic Nothing')],
    ]),
    rituals: new Map(),
    actions: new Map([['synthetic lunge', 'Lunge.'], ['synthetic grab', 'The creature ability.'], ['synthetic nothing', 'No page.']]),
    actionTraits: new Map(),
    skills: new Map([['synthetics', 'Synthetics.'], ['synthetic nothing', 'No page.']]),
    equipment: new Map(), families: new Map(), creatures: new Map(), creatureLinks: new Map(),
    rules: new Map([
      ['synthetic footing', rule('Synthetic Footing')], ['synthetic influence', rule('Synthetic Influence')],
      ['synthetic nothing', rule('Synthetic Nothing')], [mp.toLowerCase(), rule(mp)],
    ]),
  }
  return { ...real, useGameData: () => data }
})

const fetched: string[] = []
function fakeFetch(input: unknown): Promise<Response> {
  const url = String(input)
  fetched.push(url)
  const ast = /^\/ast\/(\w+)\.json\.gz$/.exec(url)
  // Served already decompressed, as a host that applies Content-Encoding does.
  if (ast && BUCKETS[ast[1]]) return Promise.resolve(new Response(JSON.stringify(BUCKETS[ast[1]])))
  if (url === '/data/abilities.json') {
    return Promise.resolve(new Response(JSON.stringify({ ability: [{ name: 'Synthetic Grab', entries: ['The creature ability.'] }] })))
  }
  return Promise.resolve(new Response('', { status: 404 }))
}

const { PopupPreview, FloatingWindowLayer } = await import('./FloatingWindow')
const { useWindowStore, BASE_Z } = await import('../store/windowStore')

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const hrefIn = (c: ParentNode) => c.querySelector('a[data-aon-link]')?.getAttribute('href') ?? null
const AON = 'https://2e.aonprd.com'

beforeEach(() => {
  resetAonPagesForTests()
  fetched.length = 0
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useSettingsStore.getState().setSetting('showAonLink', true)
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})

type Kind = 'spell' | 'condition' | 'trait' | 'action' | 'skill' | 'rule'
const CASES: { type: Kind; bucket: string; ref: string; title: string; href: string; unknown: string }[] = [
  { type: 'spell', bucket: 'spells', ref: 'synthetic flare', title: 'Synthetic Flare', href: `${AON}/Spells.aspx?ID=90101`, unknown: 'synthetic nothing' },
  { type: 'condition', bucket: 'conditions', ref: 'synthetic glare', title: 'Synthetic Glare', href: `${AON}/Conditions.aspx?ID=90102`, unknown: 'synthetic dazzle' },
  { type: 'trait', bucket: 'trait', ref: "gleamer's mark", title: "Gleamer's Mark", href: `${AON}/Traits.aspx?ID=90103`, unknown: 'synthetic nothing' },
  { type: 'action', bucket: 'actions', ref: 'synthetic lunge', title: 'Synthetic Lunge', href: `${AON}/Actions.aspx?ID=90104`, unknown: 'synthetic nothing' },
  { type: 'skill', bucket: 'skill', ref: 'synthetics', title: 'Synthetics', href: `${AON}/Skills.aspx?ID=90105`, unknown: 'synthetic nothing' },
  { type: 'rule', bucket: 'rules', ref: 'synthetic footing', title: 'Synthetic Footing', href: `${AON}/Rules.aspx?ID=90106`, unknown: 'synthetic nothing' },
]

describe('(a) each popup kind links its one page, none without one, none with the setting off', () => {
  for (const c of CASES) {
    it(`${c.type}: known page`, async () => {
      const { container } = render(<PopupPreview type={c.type} ref_={c.ref} title={c.title} />)
      await settle()
      expect(hrefIn(container)).toBe(c.href)
      expect(fetched.filter(u => u.startsWith('/ast/')), 'one bucket, its own').toEqual([`/ast/${c.bucket}.json.gz`])
    })
    it(`${c.type}: no page of its name`, async () => {
      const { container } = render(<PopupPreview type={c.type} ref_={c.unknown} title="Synthetic Nothing" />)
      await settle()
      expect(hrefIn(container)).toBeNull()
    })
    it(`${c.type}: setting off`, async () => {
      useSettingsStore.getState().setSetting('showAonLink', false)
      const { container } = render(<PopupPreview type={c.type} ref_={c.ref} title={c.title} />)
      await settle()
      expect(hrefIn(container)).toBeNull()
      expect(fetched, 'nothing fetched while the setting is off').toEqual([])
    })
  }
})

describe('(b) only an exact, single address', () => {
  it('a title with two addresses gives none; a twin of one page is one; another kind of page never counts', () => {
    const idx = buildAonPageIndex(BUCKETS.rules, 'Rules')
    expect(idx.get('synthetic influence')).toBeUndefined()
    expect(idx.get('synthetic footing')).toBe('/Rules.aspx?ID=90106')
    const spells = buildAonPageIndex(BUCKETS.spells, 'Spells')
    expect(spells.get('synthetic flare'), 'the aon- twin is the same page').toBe('/Spells.aspx?ID=90101')
    expect(spells.get('synthetic veil'), 'the rule page under a spell name is not a spell page').toBe('/Spells.aspx?ID=90191')
    expect(buildAonPageIndex(BUCKETS.trait, 'Traits').get("gleamer's mark")).toBe('/Traits.aspx?ID=90103')
  })
  it('the two-page rule popup draws no button', async () => {
    const { container } = render(<PopupPreview type="rule" ref_="synthetic influence" title="Synthetic Influence" />)
    await settle()
    expect(hrefIn(container)).toBeNull()
  })
  it('a spell beside a rule page of its name links the spell page', async () => {
    const { container } = render(<PopupPreview type="spell" ref_="synthetic veil" title="Synthetic Veil" />)
    await settle()
    expect(hrefIn(container)).toBe(`${AON}/Spells.aspx?ID=90191`)
  })
})

describe('(c) only for text that is the Archives record', () => {
  it('a spell the tracker does not hold gets none, though a page has its name', async () => {
    const { container } = render(<PopupPreview type="spell" ref_="synthetic ghost" title="Synthetic Ghost" />)
    await settle()
    expect(container.textContent).toContain('Spell not found')
    expect(hrefIn(container)).toBeNull()
  })
  it('an action shown from the creature abilities glossary gets none', async () => {
    const { container } = render(<PopupPreview type="action" ref_="synthetic grab" title="Synthetic Grab" />)
    await settle()
    expect(hrefIn(container)).toBeNull()
  })
  it('a Monster Parts rule gets none', async () => {
    const name = MONSTER_PARTS_RULES[0].name
    const { container } = render(<PopupPreview type="rule" ref_={name.toLowerCase()} title={name} />)
    await settle()
    expect(hrefIn(container)).toBeNull()
  })
})

describe('(d) a floating window', () => {
  it('draws it in its header', async () => {
    render(<FloatingWindowLayer />)
    act(() => useWindowStore.getState().open('spell', 'synthetic flare', 'Synthetic Flare'))
    await settle()
    const win = document.querySelector('[data-float-win]')!
    expect(hrefIn(win)).toBe(`${AON}/Spells.aspx?ID=90101`)
  })
})

describe('(e) a failed first fetch is not kept', () => {
  it('a popup opened while offline shows none, and the next one after the network is back links', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const first = render(<PopupPreview type="spell" ref_="synthetic flare" title="Synthetic Flare" />)
    await settle()
    expect(hrefIn(first.container)).toBeNull()
    first.unmount()
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    const second = render(<PopupPreview type="spell" ref_="synthetic flare" title="Synthetic Flare" />)
    await settle()
    expect(hrefIn(second.container)).toBe(`${AON}/Spells.aspx?ID=90101`)
  })
})
