// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { content, firstSubclass } from './_content';
import { buildCharacter, emptyBuild, levelGrants, resolveClassArchetype, type BuildState } from '../src/rules/build';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { DetailsTab } from '../src/sheet/DetailsTab';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { PinnedDescCard } from '../src/sheet/MainTab';
import { Builder } from '../src/builder/Builder';
import { levelRowClasses } from '../src/builder/shared';
import { heldFeatureClassOf } from '../src/sheet/cardScope';
import { SHARED_FEATURE_FOOTER } from '../src/rules/featureText';
import { samePin, togglePinnedDesc, type PlayState } from '../src/rules/play';
import type { Character, ContentDatabase, PinnedDesc } from '../src/rules/types';

/**
 * Package M round 3 (2026-10-17) — three Dual Class gaps the round-2 checker found, on the REAL components
 * over the shipped page trees (fetch stub), on the GATED content the app runs. Characters are synthesized
 * (name 't'); none is the owner's.
 *
 *  (a) THE DETAILS TAB NAMES THE SECOND CLASS. The Class cell named the first class only, so a Dual Class
 *      character's second class had no class card on the Details tab at all. It now reads "Wizard /
 *      Swashbuckler", each term opening its own class card scoped to ITS class (scopeOfCharacter(character,
 *      classId)), so the swashbuckler card marks its advancement table's row for the character's level
 *      (cardScope.ts withLevelRow draws that row only on the card of the scope's own class). A pin of that
 *      card stores no class (RecordCard stores one for class features only), so heldFeatureClassOf reads
 *      the second class's own class page for it, and the pin reopens with the row.
 *  (b) LEVELGRANTS CARRIES EACH ROW'S CLASS (build.ts LevelGrants.features[].classId), and the builder's
 *      level page reads it directly (shared.tsx levelRowClasses). Round 2 rebuilt levelGrants' order and
 *      removal rules there and read the one row a class archetype removes but keeps for its question
 *      (build.ts substitutedPickFeatures) for the FIRST class: an investigator taken as the second class
 *      with Palatine Detective Dedication had its Methodology row read for the fighter.
 *  (c) HELDFEATURECLASSOF SUBTRACTS WHAT A CLASS LOST. A Warrior of Legend fighter / guardian: the
 *      archetype takes the FIGHTER's Shield Block (owner ruling 2026-10-15, "only its own class loses it"),
 *      so only the guardian holds it — but a class-less mine pin read it for the fighter (the fighter's
 *      "our text for your class" of the Guardian's page). It also reads a class's stored picks
 *      (classChoices) and the archetype's substitutes for that class, and — the Feats tab's exception — a
 *      lost feature a held record hands back stays its class's (Spellshield's Arcane Bond).
 *
 * Print (the Archives mirror, by-category; no rule changes here, only which class a row is read for):
 *  - archetype-286 (Warrior of Legend): "You don’t gain Shield Block as a class feature." — shipped as
 *    warrior-of-legend-dedication.classArchetype.suppressFeatures ['shield-block'].
 *  - class-feature-1116 (Shield Block, Class Guardian): "You gain the Shield Block general feat, a
 *    reaction…" — the page the shared shield-block record carries.
 *  - archetype-306 (Palatine Detective): "Instead of choosing a methodology from others available to the
 *    investigator class, you have the esoterica methodology." — suppressFeatures ['methodology'], the
 *    substitute option palatine-detective tagged class-archetype.
 *  - feat-7983 (Spellshield, prerequisite War Mage Dedication): "You gain the arcane bond class feature and
 *    the Drain Bonded Item action." — shipped as spellshield.grantsClassFeatures ['arcane-bond'].
 *
 * MUTATION LINES (each measured red on 2026-10-17, one at a time under the heavy-job lock, the file's
 * original bytes written back after each run, sha1 checked):
 *  - DetailsTab.tsx class2's scope → `scopeOfCharacter(character)` → (a) the level-row and phone cases red.
 *  - DetailsTab.tsx `also: class2` dropped from the desktop Class cell → (a) the level-row and pin cases red;
 *    from the phone Class box → (a) the phone case red.
 *  - cardScope.ts heldFeatureClassOf's `classes` line removed → (a) the reopened-pin case and (c) the class
 *    page unit red.
 *  - build.ts levelGrants row `classId: f.of ?? null` → `classId: classId ?? null` → all four (b) cases red.
 *  - shared.tsx levelRowClasses → `rows.map(() => null)` → (b) the Palatine Detective and rendered-page
 *    cases red.
 *  - cardScope.ts heldFeatureClassOf `own.has(id) && !removed()` → `own.has(id)` → (c) the Warrior of Legend
 *    unit, its pin case and the Spellshield case red.
 *  - cardScope.ts heldFeatureClassOf with `classChoices: []` → (c) the implement case red.
 *  - cardScope.ts heldFeatureClassOf without `added ||` → (c) the War Mage case red.
 *  - cardScope.ts heldFeatureClassOf without `&& !regranted().has(base)` → (c) the Spellshield case red.
 */

const db: ContentDatabase = content({ trustGate: true });
const noop = () => undefined;
const trees: Record<string, Record<string, AstNode>> = {};
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}

/** A synthesized build on the gated content. */
function state(classId: string, level: number, over: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
    subclassId: firstSubclass(classId),
    ...over,
  };
}
const dualState = (first: string, second: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  state(first, level, { variantRules: { dualClass: true }, classId2: second, subclassId2: firstSubclass(second), ...over });
const dual = (first: string, second: string, level: number, over: Partial<BuildState> = {}): Character =>
  buildCharacter(dualState(first, second, level, over), db);
/** The dedication in a class-feat slot at 2nd level: slot 0 = the first class's, 1 = the second's. */
const carry = (featId: string, slot: 0 | 1) => ({ featPicks: { [`2:class:${slot}`]: featId } });
const rowsOf = (b: BuildState, level: number) =>
  levelGrants(level, b.classId, db, b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, Object.values(b.featPicks ?? {}).filter(Boolean) as string[], b).features;

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, pin: PinDescApi | null = null): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={db}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const txt = (el: Element | null | undefined) => norm(el?.textContent);
const popup = (host: HTMLElement) => { const all = host.querySelectorAll('.picker-overlay'); return all[all.length - 1] ?? null; };
const term = (host: HTMLElement, name: string) => [...host.querySelectorAll('.oval.info-term')].find((e) => txt(e) === name);
/** The marked rows (first cell's words) of the open card's first table — the class advancement table. */
const markedRows = (host: HTMLElement) => {
  const table = popup(host)?.querySelector('table.ast-table');
  return [...(table?.querySelectorAll('tr') ?? [])].filter((tr) => tr.classList.contains('card-row-current')).map((tr) => txt(tr.querySelector('td, th')));
};
/** A row of the open card's first table, its cells' words joined (0 = the header). */
const rowWords = (host: HTMLElement, at: (rows: Element[]) => Element | undefined) => {
  const rows = [...(popup(host)?.querySelector('table.ast-table')?.querySelectorAll('tr') ?? [])];
  return [...(at(rows)?.querySelectorAll('td, th') ?? [])].map(txt).join(' | ');
};
function pinStore() {
  let play = {} as PlayState;
  const api: PinDescApi = {
    has: (n) => (play.pinnedDescs ?? []).some((d) => samePin(d, n)),
    toggle: (n) => { play = togglePinnedDesc(play, n); },
  };
  return { api, pins: () => play.pinnedDescs ?? [] };
}

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  await loadAstIndex();
  for (const b of ['classes', 'classFeatures', 'feats', 'actions', 'categoryPage', 'traits', 'backgrounds', 'ancestries', 'heritages']) await loadBucketAst(b);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('package M round 3 (a): the Details tab names the second class and opens its card for it', () => {
  it('wizard + swashbuckler 5: "Wizard / Swashbuckler"; the swashbuckler card marks ITS level-5 row, the wizard card its own', async () => {
    const ch = dual('wizard', 'swashbuckler', 5);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      expect(term(m.host, 'Wizard'), 'the first class\'s term').toBeTruthy();
      expect(term(m.host, 'Swashbuckler'), 'the second class\'s term').toBeTruthy();
      expect(txt(m.host.querySelector('.oval-pair'))).toBe('Wizard / Swashbuckler');
      await click(term(m.host, 'Swashbuckler'));
      expect(popup(m.host)?.querySelector('.ast-modal.card-mine'), 'the swashbuckler class record\'s mine card').toBeTruthy();
      expect(rowWords(m.host, (r) => r[0])).toBe('Your Level | Class Features');
      expect(markedRows(m.host), 'the swashbuckler advancement table marks the level-5 row').toEqual(['5']);
      // The swashbuckler's own table (class-63, Player Core 2, level 5: "Attribute boosts, ancestry feat,
      // precise strike 3 (3d6), skill increase, weapon expertise").
      expect(rowWords(m.host, (r) => r.find((tr) => tr.classList.contains('card-row-current')))).toMatch(/^5 \| .*precise strike 3 \(3d6\).*weapon expertise$/);
      await click(popup(m.host)?.querySelector('.picker-close'));
      await click(term(m.host, 'Wizard'));
      expect(markedRows(m.host), 'the wizard card, as before').toEqual(['5']);
    } finally { m.stop(); }
  }, 120_000);

  it('the phone layout (origin boxes): the Class box reads "Wizard / Swashbuckler" and the swashbuckler card marks ITS level-5 row', async () => {
    const ch = dual('wizard', 'swashbuckler', 5);
    const m = await mount(<ForceMobileContext.Provider value={true}><DetailsTab character={ch} content={db} /></ForceMobileContext.Provider>);
    try {
      expect(m.host.querySelector('.origin-boxes'), 'the phone layout drew').toBeTruthy();
      expect(txt(m.host.querySelector('.origin-boxes .oval-pair'))).toBe('Wizard / Swashbuckler');
      await click(term(m.host, 'Swashbuckler'));
      expect(markedRows(m.host)).toEqual(['5']);
      expect(rowWords(m.host, (r) => r.find((tr) => tr.classList.contains('card-row-current')))).toMatch(/precise strike 3 \(3d6\)/);
    } finally { m.stop(); }
  }, 120_000);

  it('the swashbuckler card\'s pin (no class stored) reopens from the Pinned list with the swashbuckler\'s level row', async () => {
    const ch = dual('wizard', 'swashbuckler', 5);
    const store = pinStore();
    const m = await mount(<DetailsTab character={ch} content={db} />, store.api);
    try {
      await click(term(m.host, 'Swashbuckler'));
      await click(popup(m.host)?.querySelector('.info-star'));
    } finally { m.stop(); }
    const pins = store.pins();
    expect(pins.map((p) => ({ key: p.key, slug: p.slug, mode: p.mode, classId: p.classId }))).toEqual([{ key: 'classes', slug: 'swashbuckler', mode: 'mine', classId: undefined }]);
    const p = await mount(<PinnedDescCard pin={pins[0]} content={db} character={ch} onClose={noop} />);
    try {
      expect(markedRows(p.host)).toEqual(['5']);
    } finally { p.stop(); }
  }, 120_000);

  it('one class, or a second class left behind with Dual Class off: the Class cell is the one term, as before', async () => {
    const off = buildCharacter({ ...dualState('wizard', 'swashbuckler', 5), variantRules: { dualClass: false } }, db);
    for (const ch of [buildCharacter(state('wizard', 5), db), off]) {
      const m = await mount(<DetailsTab character={ch} content={db} />);
      try {
        expect(term(m.host, 'Wizard')).toBeTruthy();
        expect(term(m.host, 'Swashbuckler')).toBeUndefined();
        expect(m.host.querySelector('.oval-pair, .oval-sep')).toBeNull();
      } finally { m.stop(); }
    }
  }, 120_000);
});

describe('package M round 3 (b): levelGrants carries each row\'s class; the builder reads it directly', () => {
  it('Palatine Detective on the SECOND class (fighter + investigator): the kept Methodology row is the investigator\'s', () => {
    const b = dualState('fighter', 'investigator', 2, { subclassId2: 'palatine-detective', ...carry('palatine-detective-dedication', 1) });
    // Not vacuous: the archetype landed on the investigator and took its methodology, which stays for its question.
    expect([...resolveClassArchetype(b, db).suppressedFor('investigator')]).toEqual(['methodology']);
    const rows = rowsOf(b, 1);
    const at = rows.findIndex((f) => f.id === 'methodology');
    expect(at, 'the methodology row is kept (its question survives)').toBeGreaterThanOrEqual(0);
    expect(rows[at].classId).toBe('investigator');
    expect(levelRowClasses(rows)[at]).toBe('investigator');
    // Every other row: its own class's table.
    for (const f of rows) expect(f.classId, f.id).toBe(db.classes.fighter.features.some((x) => x.level === 1 && x.featureId === f.id) ? 'fighter' : 'investigator');
    // The same archetype on the FIRST class: the investigator's too.
    const first = dualState('investigator', 'fighter', 2, { subclassId: 'palatine-detective', ...carry('palatine-detective-dedication', 0) });
    expect(rowsOf(first, 1).find((f) => f.id === 'methodology')?.classId).toBe('investigator');
  });

  it('fighter + guardian 1: Shield Block is two rows with distinct keys; a Warrior of Legend fighter\'s page keeps only the guardian\'s', () => {
    const fg = dualState('fighter', 'guardian', 2);
    const sb = rowsOf(fg, 1).filter((f) => f.id === 'shield-block');
    expect(sb.map((f) => f.classId)).toEqual(['fighter', 'guardian']);
    const keys = rowsOf(fg, 1).map((f) => `${f.classId ?? ''}:${f.id}`);
    expect(new Set(keys).size, 'the level page keys every row apart (Builder.tsx `${rowClassOf(f)}:${f.id}`)').toBe(keys.length);
    const wol = dualState('fighter', 'guardian', 2, carry('warrior-of-legend-dedication', 0));
    expect(rowsOf(wol, 1).filter((f) => f.id === 'shield-block').map((f) => f.classId)).toEqual(['guardian']);
    // The archetype's substitute is filed under the class it substitutes into.
    expect(rowsOf(wol, 1).find((f) => f.id === 'warrior-of-legend')?.classId).toBe('fighter');
  });

  it('the rendered level-1 page of a fighter + guardian draws both Shield Block rows, with no duplicate key', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
    try {
      const m = await mount(<Builder content={db} initial={dualState('fighter', 'guardian', 1)} onCancel={noop} onCreate={noop} />);
      try {
        await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '1'));
        const blocks = [...m.host.querySelectorAll('.lvl-gain-block')].filter((b) => txt(b.querySelector('.lvl-gain-name')) === 'Shield Block');
        expect(blocks).toHaveLength(2);
      } finally { m.stop(); }
    } finally { spy.mockRestore(); }
    expect(errors.filter((e) => /same key/i.test(e))).toEqual([]);
  }, 120_000);

  it('every row of every class\'s table, at every level, carries that class (single class, and as a second class beside a fighter)', () => {
    const bad: string[] = [];
    for (const cls of Object.values(db.classes)) {
      const one = state(cls.id, 20);
      const two = dualState('fighter', cls.id, 20);
      for (let lvl = 1; lvl <= 20; lvl++) {
        for (const f of rowsOf(one, lvl)) if (f.classId !== cls.id) bad.push(`${cls.id} ${lvl} ${f.id}: ${f.classId}`);
        if (cls.id === 'fighter') continue;
        const own = cls.features.filter((x) => x.level === lvl && !(cls.subclass?.options.find((o) => o.id === two.subclassId2)?.suppressedFeatures ?? []).includes(x.featureId)).length;
        const got = rowsOf(two, lvl).filter((f) => f.classId === cls.id).length;
        if (got !== own) bad.push(`fighter+${cls.id} ${lvl}: ${got} rows of ${own}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('package M round 3 (c): heldFeatureClassOf subtracts what a class lost and reads its picks', () => {
  const WOL = 'warrior-of-legend-dedication';
  it('a Warrior of Legend fighter / guardian: Shield Block is the guardian\'s alone; controls stay the first class\'s', () => {
    const wol = dual('fighter', 'guardian', 5, carry(WOL, 0));
    expect(wol.classArchetype?.byClass?.fighter?.suppressedFeatures, 'the archetype really took the fighter\'s').toEqual(['shield-block']);
    expect(heldFeatureClassOf(wol, db, 'classFeatures', 'shield-block')).toBe('guardian');
    // Both hold it (no archetype): the first class's.
    expect(heldFeatureClassOf(dual('fighter', 'guardian', 5), db, 'classFeatures', 'shield-block')).toBeUndefined();
    // Guardian first, the archetype on the fighter (second): the guardian, the first class, alone holds it.
    expect(heldFeatureClassOf(dual('guardian', 'fighter', 5, carry(WOL, 1)), db, 'classFeatures', 'shield-block')).toBeUndefined();
    // A feature the archetype left alone: the fighter's Reactive Strike is still the first class's.
    expect(heldFeatureClassOf(wol, db, 'classFeatures', 'reactive-strike')).toBeUndefined();
  });

  it('a class-less mine pin of Shield Block reopens for the guardian: the Guardian\'s own page, never the fighter\'s "our text for your class"', async () => {
    const old: PinnedDesc = { title: 'Shield Block', description: 'stored snapshot', key: 'classFeatures', slug: 'shield-block', mode: 'mine' };
    const read = async (ch: Character) => {
      const p = await mount(<PinnedDescCard pin={old} content={db} character={ch} onClose={noop} />);
      try { return { text: txt(popup(p.host)), footer: txt(popup(p.host)?.querySelector('.card-nopage')) }; } finally { p.stop(); }
    };
    const wol = await read(dual('fighter', 'guardian', 5, carry(WOL, 0)));
    expect(wol.text).toMatch(/You gain the Shield Block general feat/);
    expect(wol.footer, 'the Guardian\'s page, not the fighter\'s fallback').not.toBe(SHARED_FEATURE_FOOTER);
    // Control: a plain fighter / guardian (both hold it) reads it for the fighter, as before.
    expect((await read(dual('fighter', 'guardian', 5))).footer).toBe(SHARED_FEATURE_FOOTER);
  }, 120_000);

  it('a stored pick counts for its own class: a wizard / thaumaturge\'s amulet and its benefit are the thaumaturge\'s', () => {
    const wt = dual('wizard', 'thaumaturge', 5, { extraChoices: { implement: ['amulet'] } });
    expect(wt.classChoices?.map((r) => r.id)).toEqual(expect.arrayContaining(['amulet', 'initiate-benefit-amulet']));
    expect(heldFeatureClassOf(wt, db, 'classFeatures', 'amulet')).toBe('thaumaturge');
    expect(heldFeatureClassOf(wt, db, 'classFeatures', 'initiate-benefit-amulet')).toBe('thaumaturge');
    // The thaumaturge first: its pick is the first class's.
    expect(heldFeatureClassOf(dual('thaumaturge', 'wizard', 5, { extraChoices: { implement: ['amulet'] } }), db, 'classFeatures', 'amulet')).toBeUndefined();
  });

  it('a class archetype\'s substitute counts for the class it substitutes into: a fighter / War Mage wizard\'s War Magic is the wizard\'s', () => {
    const fw = dual('fighter', 'wizard', 2, { subclassId2: 'school-of-battle-magic', ...carry('war-mage-dedication', 1) });
    expect(fw.classArchetype?.byClass?.wizard?.addedFeatures?.map((a) => a.featureId)).toContain('war-magic');
    expect(heldFeatureClassOf(fw, db, 'classFeatures', 'war-magic')).toBe('wizard');
  });

  it('a record that hands a lost feature back keeps it the class\'s: a fighter / War Mage wizard with Spellshield reads Arcane Bond for the wizard', () => {
    // feat-7983 Spellshield (Feat 8, prerequisite War Mage Dedication): "You gain the arcane bond class feature".
    const over = { subclassId2: 'school-of-battle-magic', featPicks: { '2:class:1': 'war-mage-dedication', '8:class:1': 'spellshield' } };
    const with8 = dual('fighter', 'wizard', 8, over);
    expect(with8.feats.map((f) => f.featId), 'Spellshield was taken').toContain('spellshield');
    expect(with8.classArchetype?.byClass?.wizard?.suppressedFeatures, 'War Mage took the wizard\'s arcane bond').toContain('arcane-bond');
    expect(heldFeatureClassOf(with8, db, 'classFeatures', 'arcane-bond')).toBe('wizard');
    // Without Spellshield no class holds it: undefined, the first class's scope as for any record.
    const without = dual('fighter', 'wizard', 8, { ...over, featPicks: { '2:class:1': 'war-mage-dedication' } });
    expect(heldFeatureClassOf(without, db, 'classFeatures', 'arcane-bond')).toBeUndefined();
  });

  it('a class page: the second class\'s own page is read for it; any other, a single class, Dual Class off: undefined', () => {
    const ws = dual('wizard', 'swashbuckler', 5);
    expect(heldFeatureClassOf(ws, db, 'classes', 'swashbuckler')).toBe('swashbuckler');
    expect(heldFeatureClassOf(ws, db, 'classes', 'wizard')).toBeUndefined();
    expect(heldFeatureClassOf(ws, db, 'classes', 'fighter')).toBeUndefined();
    expect(heldFeatureClassOf(buildCharacter(state('swashbuckler', 5), db), db, 'classes', 'swashbuckler')).toBeUndefined();
    const off = { ...ws, variantRules: { ...ws.variantRules, dualClass: false } } as Character;
    expect(heldFeatureClassOf(off, db, 'classes', 'swashbuckler')).toBeUndefined();
  });
});
