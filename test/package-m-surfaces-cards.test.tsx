// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { content, firstSubclass } from './_content';
import { buildCharacter, emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { RecordCard } from '../src/sheet/RecordCard';
import { DetailsTab } from '../src/sheet/DetailsTab';
import { FeatDetail, featPinNode } from '../src/sheet/FeatDetail';
import { featEntries } from '../src/sheet/FeatsTab';
import { PinnedDescCard } from '../src/sheet/MainTab';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { Builder } from '../src/builder/Builder';
import { levelRowClasses } from '../src/builder/shared';
import { heldFeatureClassOf, linkClassOf } from '../src/sheet/cardScope';
import { SHARED_FEATURE_FOOTER, classFeatureDescription } from '../src/rules/featureText';
import { pinOf, samePin, togglePinnedDesc, type PlayState } from '../src/rules/play';
import type { StatBreakdown } from '../src/rules/explain';
import type { Character, ContentDatabase, PinnedDesc } from '../src/rules/types';

/**
 * Package M round 2 (2026-10-16) — the card surfaces round 1 (9ce2591) could not reach.
 *  (a) PINS KEEP THE CLASS. A class feature's star stores the class it was read for (PinnedDesc.classId,
 *      play.ts pinOf; never part of the identity, play.ts samePin): a cleric's linked Perception Expertise
 *      reopens from the Pinned list as the cleric's "expert", not the shared record's page ("master"); a
 *      wizard / swashbuckler's swashbuckler row reopens as the swashbuckler's paragraph. A pin that stores
 *      no class reopens exactly as before (a browse pin: the record's page).
 *  (b) DUAL CLASS ON EVERY MINE SURFACE that shows a class feature: a stat breakdown's "Full text" and a
 *      'mine' pin with no stored class read a feature only the SECOND class holds for that class
 *      (cardScope heldFeatureClassOf); the builder's level page reads each "You gain automatically" row for
 *      its own class (shared.tsx levelRowClasses), its Details card included.
 *
 * REAL components (DetailsTab, RecordCard, FeatDetail, PinnedDescCard, StatDetailModal, Builder) over the
 * shipped page trees through a fetch stub, on the GATED content (what the app runs). Characters are
 * synthesized (name 't'); none is the owner's.
 *
 * The page's own words (the Archives mirror, by-category/class-feature-NNNN):
 *  - class-feature-1178 (Weapon Expertise, Class Thaumaturge): "You've learned the secret ways your weapons
 *    work most effectively."
 *  - class-feature-1019 (Weapon Expertise, Class Swashbuckler): "You gain access to the critical
 *    specialization effects of all weapons for which you have expert proficiency."
 *  - the wizard's paragraph of the shared text (class-39): "Through sheer experience".
 *  - class-33 (Cleric): "Perception Expertise … Your proficiency rank for Perception increases to expert."
 *  - the shared Perception Expertise record's page (the round-1 test's class-feature-1183): "Your
 *    proficiency rank for Perception increases to master."
 *
 * Live data names the swashbuckler's own record (weapon-expertise-swashbuckler, class-feature-1019) at 5th,
 * so on live data a swashbuckler row's truth is its own page whatever class it is read for: those cases hold
 * the screen. The planted twin `swashShared` (the swashbuckler listing the SHARED weapon-expertise, as before
 * the data lane re-pointed it — round 1's planted shape) is where the row's class decides the paragraph.
 *
 * MUTATION LINES (each measured red on 2026-10-16 under the heavy-job lock, one at a time, the file restored
 * byte-exact from its original bytes, sha1 checked — scratch pm2-mutate.mjs):
 *  - RecordCard.tsx pinNode without `...(pinClass ? { classId: pinClass } : {})` → the cleric case red (the
 *    stored pin has no class).
 *  - RecordCard.tsx viewerClass of a browse card's first node → `undefined` → the cleric case red (reopened,
 *    the "master" page).
 *  - play.ts pinOf without its `classId` line → the pinOf unit, cleric and both Dual Class pin cases red.
 *  - FeatDetail.tsx featPinNode without `classId` → both Dual Class pin cases red.
 *  - MainTab.tsx PinnedDescCard scope → `scopeOfCharacter(character)` → the wizard + swashbuckler pin case and
 *    the class-less mine pin case red.
 *  - StatDetailModal.tsx scope → `scopeOfCharacter(character)` → the Full text case red.
 *  - Builder.tsx `classId={rowClassOf(f)}` dropped → the thaumaturge + swashbuckler builder case red.
 *  - cardScope.ts heldFeatureClassOf → always `undefined` → its unit, the Full text and class-less mine pin
 *    cases red.
 *  - shared.tsx levelRowClasses without its second-class line → its unit and the builder case red.
 *  - cardScope.ts linkClassOf without `if (n?.classId) return n.classId;` → the linkClassOf unit red.
 *
 * Round 3 (2026-10-17; levelRowClasses now reads build.ts levelGrants' own `classId` per row, and the
 * builder case also reads the row's own description off the pin it stores — test/package-m-ui3-dual-class
 * holds the rest of round 3). Each measured red, one at a time, the file restored byte-exact (sha1 checked):
 *  - Builder.tsx `flavor={classFeatureDescription(…, rowClassOf(f), content)}` → `build.classId` → the
 *    builder case red (the pin's text is the thaumaturge's cut). Round 2 had no case that saw it.
 *  - shared.tsx levelRowClasses → `rows.map(() => null)` → its unit and the builder case red.
 *  - build.ts levelGrants `classId: f.of ?? null` → `classId: classId ?? null` → its unit and the builder
 *    case red.
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

/** A synthesized character on the gated content. */
function build(classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = db.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: firstSubclass(classId),
      ...over,
    },
    db,
  );
}
const dual = (first: string, second: string, level: number) =>
  build(first, level, { variantRules: { dualClass: true }, classId2: second, subclassId2: firstSubclass(second) } as Partial<BuildState>);

/** Round 1's planted shape: the swashbuckler lists the SHARED weapon-expertise at 5th. */
const swashShared = (() => {
  const s = db.classes.swashbuckler;
  return { ...db, classes: { ...db.classes, swashbuckler: { ...s, features: s.features.map((f) => (f.featureId === 'weapon-expertise-swashbuckler' ? { ...f, featureId: 'weapon-expertise' } : f)) } } } as ContentDatabase;
})();

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, value: ContentDatabase = db, pin: PinDescApi | null = null): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={value}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
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
/** The topmost open popup (the last card overlay). */
const popup = (host: HTMLElement) => { const all = host.querySelectorAll('.picker-overlay'); return all[all.length - 1] ?? null; };
const classTerm = (host: HTMLElement, name: string) => [...host.querySelectorAll('.oval.info-term')].find((e) => txt(e) === name);
const linkTo = (host: HTMLElement, words: string) => [...(popup(host)?.querySelectorAll('a.ast-lk') ?? [])].find((a) => txt(a).toLowerCase() === words);
/** The open card's star (the page lane's header or the no-page lane's head). */
const starOf = (host: HTMLElement) => popup(host)?.querySelector('.info-star');

/** A pin store the way CharacterSheet's is (play.ts samePin / togglePinnedDesc → pinOf). */
function pinStore() {
  let play = {} as PlayState;
  const api: PinDescApi = {
    has: (n) => (play.pinnedDescs ?? []).some((d) => samePin(d, n)),
    toggle: (n) => { play = togglePinnedDesc(play, n); },
  };
  return { api, pins: () => play.pinnedDescs ?? [] };
}
const shape = (p: PinnedDesc | undefined) => ({ key: p?.key, slug: p?.slug, mode: p?.mode, classId: p?.classId });

const THAUMATURGE_WE = /secret ways/;
const SWASH_CRIT = /critical specialization effects of all weapons for which you have expert proficiency/;
const WIZARD_WE = /Through sheer experience/;
const CLERIC_PE = /Perception increases to expert/;
const SHARED_PE_PAGE = /increases to master/;

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

describe('package M round 2 (a): the pin store keeps the class, never as identity', () => {
  it('pinOf stores classId when the node carries one, and only then; samePin ignores it', () => {
    const node: PinnedDesc = { title: 'Perception Expertise', description: 'd', key: 'classFeatures', slug: 'perception-expertise', classId: 'cleric' };
    expect(pinOf(node).classId).toBe('cleric');
    const { classId: _c, ...bare } = node;
    void _c;
    expect('classId' in pinOf(bare), 'a node read for no class stores the old shape').toBe(false);
    expect(samePin(node, { ...node, classId: 'wizard' }), 'same record, another class: one pin').toBe(true);
    expect(samePin(node, bare)).toBe(true);
  });

  it('linkClassOf: a node that carries its class counts as that class\'s page; a nearer class page wins', () => {
    const pinned = { key: 'classFeatures', slug: 'perception-expertise', classId: 'cleric' };
    const deeper = { key: 'classFeatures', slug: 'weapon-specialization' };
    expect(linkClassOf([pinned], undefined)).toBe('cleric');
    expect(linkClassOf([pinned, deeper], 'wizard')).toBe('cleric');
    expect(linkClassOf([pinned, { key: 'classes', slug: 'magus' }, deeper], undefined)).toBe('magus');
    expect(linkClassOf([{ key: 'classFeatures', slug: 'x' }], undefined), 'no class anywhere: none (search)').toBeUndefined();
  });
});

describe('package M round 2 (a): a cleric pins the linked Perception Expertise', () => {
  it('the star stores the class it was read for; the Main tab\'s pin reopens as the cleric\'s "expert", never the shared page\'s "master"', async () => {
    const ch = build('cleric', 5);
    const store = pinStore();
    const m = await mount(<DetailsTab character={ch} content={db} />, db, store.api);
    try {
      await click(classTerm(m.host, 'Cleric'));
      await click(linkTo(m.host, 'perception expertise'));
      expect(txt(popup(m.host))).toMatch(CLERIC_PE);
      await click(starOf(m.host));
    } finally { m.stop(); }
    const pins = store.pins();
    expect(pins).toHaveLength(1);
    // A link-followed page is a browse card: no mode — and now the class it was read for.
    expect(shape(pins[0])).toEqual({ key: 'classFeatures', slug: 'perception-expertise', mode: undefined, classId: 'cleric' });

    const p = await mount(<PinnedDescCard pin={pins[0]} content={db} character={ch} onClose={noop} />);
    try {
      const pop = popup(p.host)!;
      expect(txt(pop)).toMatch(CLERIC_PE);
      expect(txt(pop)).not.toMatch(SHARED_PE_PAGE);
      expect(txt(pop.querySelector('.card-nopage'))).toBe(SHARED_FEATURE_FOOTER);
      expect(txt(pop.querySelector('.card-source'))).toBe('Source Pathfinder Player Core');
    } finally { p.stop(); }

    // Reopened under the store: its star reads pinned (the identity ignores the class), and pressing it
    // unpins the one pin.
    const s = await mount(<PinnedDescCard pin={pins[0]} content={db} character={ch} onClose={noop} />, db, store.api);
    try {
      expect(starOf(s.host)?.getAttribute('aria-pressed')).toBe('true');
      await click(starOf(s.host));
      expect(store.pins()).toHaveLength(0);
    } finally { s.stop(); }
  });

  it('an OLD pin of it (no class stored) reopens exactly as before: the record\'s own page', async () => {
    const old: PinnedDesc = { title: db.classFeatures['perception-expertise'].name, description: 'stored snapshot', key: 'classFeatures', slug: 'perception-expertise' };
    /* Round 3: compared with the record's own browse card rather than with its words — the data lane may
       re-point which printing the shared record's page is (2026-10-17: the Thaumaturge's "master" page became
       the Exemplar's "expert" one), and this case is about the pin, not the page. */
    const b = await mount(<RecordCard record={{ bucket: 'classFeatures', id: 'perception-expertise' }} mode="browse" chrome="popup" onExit={noop} />);
    const ownPage = txt(popup(b.host)?.querySelector('.ast-modal'));
    b.stop();
    expect(ownPage, 'the record\'s own page drew').toMatch(/Perception/);
    const p = await mount(<PinnedDescCard pin={old} content={db} character={build('cleric', 5)} onClose={noop} />);
    try {
      expect(txt(popup(p.host)?.querySelector('.ast-modal'))).toBe(ownPage);
      expect(p.host.querySelector('.card-nopage')).toBeNull();
    } finally { p.stop(); }
  });

  it('a pin made from search (no class known) stores no class', async () => {
    const store = pinStore();
    const m = await mount(<RecordCard record={{ bucket: 'classFeatures', id: 'weapon-expertise' }} mode="browse" chrome="popup" onExit={noop} />, db, store.api);
    try {
      expect(txt(popup(m.host))).toMatch(THAUMATURGE_WE);
      await click(starOf(m.host));
    } finally { m.stop(); }
    expect(shape(store.pins()[0])).toEqual({ key: 'classFeatures', slug: 'weapon-expertise', mode: undefined, classId: undefined });
  });
});

/** A class-feature row of `classId`, found by the row's key (`feature:<class>:<id>`). */
const rowOf = (ch: Character, classId: string, featureId: RegExp, value: ContentDatabase = db) => {
  const e = featEntries(ch, value).find((x) => x.key.startsWith(`feature:${classId}:`) && !!x.featureId && featureId.test(x.featureId));
  expect(e, `a ${classId} row ${featureId}`).toBeTruthy();
  return e!;
};
/** Star a FeatsTab row's card, return the stored pin. */
async function pinRow(entry: ReturnType<typeof rowOf>, ch: Character, value: ContentDatabase) {
  const store = pinStore();
  const m = await mount(<FeatDetail entry={entry} character={ch} onClose={noop} />, value, store.api);
  try {
    await click(starOf(m.host));
  } finally { m.stop(); }
  expect(store.pins()).toHaveLength(1);
  return store.pins()[0];
}
async function reopen(pin: PinnedDesc, ch: Character, value: ContentDatabase) {
  const p = await mount(<PinnedDescCard pin={pin} content={value} character={ch} onClose={noop} />, value);
  const text = txt(popup(p.host));
  p.stop();
  return text;
}

describe('package M round 2 (a): a Dual Class row\'s pin keeps its class', () => {
  it('wizard + swashbuckler 11, the swashbuckler listing the shared record: the swashbuckler row\'s pin reopens as the swashbuckler\'s paragraph, the wizard row\'s as the wizard\'s', async () => {
    const ch = dual('wizard', 'swashbuckler', 11);
    const swashRow = rowOf(ch, 'swashbuckler', /^weapon-expertise$/, swashShared);
    expect(featPinNode(swashRow).classId).toBe('swashbuckler');
    const swashPin = await pinRow(swashRow, ch, swashShared);
    expect(shape(swashPin)).toEqual({ key: 'classFeatures', slug: 'weapon-expertise', mode: 'mine', classId: 'swashbuckler' });
    const swashText = await reopen(swashPin, ch, swashShared);
    expect(swashText).toMatch(SWASH_CRIT);
    expect(swashText).not.toMatch(WIZARD_WE);
    expect(swashText).not.toMatch(THAUMATURGE_WE);

    const wizPin = await pinRow(rowOf(ch, 'wizard', /^weapon-expertise$/, swashShared), ch, swashShared);
    expect(wizPin.classId).toBe('wizard');
    const wizText = await reopen(wizPin, ch, swashShared);
    expect(wizText).toMatch(WIZARD_WE);
    expect(wizText).not.toMatch(SWASH_CRIT);

    // An old mine pin of the record (no class stored), which BOTH classes hold at 11: the first class's, as before.
    const { classId: _c, ...old } = swashPin;
    void _c;
    expect(await reopen(old, ch, swashShared)).toMatch(WIZARD_WE);
  });

  it('live data: the swashbuckler row (its own record) pins and reopens as its own page', async () => {
    const ch = dual('wizard', 'swashbuckler', 11);
    const pin = await pinRow(rowOf(ch, 'swashbuckler', /^weapon-expertise/), ch, db);
    expect(pin.classId).toBe('swashbuckler');
    const text = await reopen(pin, ch, db);
    expect(text).toMatch(SWASH_CRIT);
    expect(text).not.toMatch(THAUMATURGE_WE);
  });
});

describe('package M round 2 (b): Dual Class on the surfaces that know only the record', () => {
  it('heldFeatureClassOf: the second class only where it alone holds the record', () => {
    const at5 = dual('wizard', 'swashbuckler', 5);
    const at11 = dual('wizard', 'swashbuckler', 11);
    // Planted: the swashbuckler lists the shared record at 5th; the wizard at 11th.
    expect(heldFeatureClassOf(at5, swashShared, 'classFeatures', 'weapon-expertise')).toBe('swashbuckler');
    expect(heldFeatureClassOf(at11, swashShared, 'classFeatures', 'weapon-expertise'), 'both hold it: the first class (undefined)').toBeUndefined();
    // Live: the swashbuckler's own record; the wizard's own feature.
    expect(heldFeatureClassOf(at5, db, 'classFeatures', 'weapon-expertise-swashbuckler')).toBe('swashbuckler');
    expect(heldFeatureClassOf(at11, db, 'classFeatures', 'arcane-school')).toBeUndefined();
    // Not a class feature, a single class, no character, a class turned off: undefined.
    expect(heldFeatureClassOf(at5, db, 'items', 'longsword')).toBeUndefined();
    expect(heldFeatureClassOf(build('swashbuckler', 5), db, 'classFeatures', 'weapon-expertise-swashbuckler')).toBeUndefined();
    expect(heldFeatureClassOf(null, db, 'classFeatures', 'weapon-expertise-swashbuckler')).toBeUndefined();
    const off = { ...at5, variantRules: { ...at5.variantRules, dualClass: false } } as Character;
    expect(heldFeatureClassOf(off, db, 'classFeatures', 'weapon-expertise-swashbuckler'), 'Dual Class off: no second class').toBeUndefined();
  });

  it('a stat breakdown\'s Full text of a feature only the second class holds reads that class\'s paragraph', async () => {
    const ch = dual('wizard', 'swashbuckler', 5);
    const breakdown: StatBreakdown = {
      title: 't', totalText: '+0', parts: [], timeline: [],
      situational: [{ text: 'a synthesized note', sourceId: 'weapon-expertise', sourceCollection: 'classFeatures' }],
    };
    const m = await mount(<StatDetailModal breakdown={breakdown} character={ch} content={swashShared} onClose={noop} />, swashShared);
    try {
      await click(m.host.querySelector('.sd-sit-more'));
      const text = txt(popup(m.host));
      expect(text).toMatch(SWASH_CRIT);
      expect(text).not.toMatch(WIZARD_WE);
      expect(text).not.toMatch(THAUMATURGE_WE);
    } finally { m.stop(); }
  });

  it('a mine pin with no stored class, of a feature only the second class holds, reopens read for that class', async () => {
    const ch = dual('wizard', 'swashbuckler', 5);
    const old: PinnedDesc = { title: 'Weapon Expertise', description: 'stored snapshot', key: 'classFeatures', slug: 'weapon-expertise', mode: 'mine' };
    const text = await reopen(old, ch, swashShared);
    expect(text).toMatch(SWASH_CRIT);
    expect(text).not.toMatch(WIZARD_WE);
    // A single-class wizard 11: its own paragraph, as before.
    expect(await reopen(old, build('wizard', 11), swashShared)).toMatch(WIZARD_WE);
  });
});

describe('package M round 2 (b): the builder\'s level rows are read for their own class', () => {
  const thaumSwash5 = (): BuildState => ({
    ...emptyBuild(), name: 't', level: 5, ancestryId: 'human', backgroundId: 'acolyte', classId: 'thaumaturge', subclassId: firstSubclass('thaumaturge'),
    variantRules: { dualClass: true }, classId2: 'swashbuckler', subclassId2: firstSubclass('swashbuckler'),
  }) as BuildState;

  it('levelRowClasses reads levelGrants\' rows back to their classes', () => {
    const b = thaumSwash5();
    const rowsOf = (value: ContentDatabase) => levelGrants(5, b.classId, value, b.subclassId, b.variantRules, b.classId2, b.subclassId2, false, [], b).features;
    const live = rowsOf(db);
    const liveClasses = levelRowClasses(live);
    expect(liveClasses[live.findIndex((f) => f.id === 'weapon-expertise')]).toBe('thaumaturge');
    expect(liveClasses[live.findIndex((f) => f.id === 'weapon-expertise-swashbuckler')]).toBe('swashbuckler');
    // Planted: the record both list at 5th is two rows — the first class's, then the second's.
    const planted = rowsOf(swashShared);
    const at = planted.map((f, i) => (f.id === 'weapon-expertise' ? i : -1)).filter((i) => i >= 0);
    expect(at).toHaveLength(2);
    const plantedClasses = levelRowClasses(planted);
    expect(at.map((i) => plantedClasses[i])).toEqual(['thaumaturge', 'swashbuckler']);
    // Live data, a pair that lists the same record at 1st (Shield Block): one row each.
    const fg = { ...emptyBuild(), name: 't', level: 1, classId: 'fighter', variantRules: { dualClass: true }, classId2: 'guardian' } as BuildState;
    const fgRows = levelGrants(1, 'fighter', db, null, fg.variantRules, 'guardian', null, false, [], fg).features;
    const sb = fgRows.map((f, i) => (f.id === 'shield-block' ? i : -1)).filter((i) => i >= 0);
    expect(sb).toHaveLength(2);
    expect(sb.map((i) => levelRowClasses(fgRows)[i])).toEqual(['fighter', 'guardian']);
    // A single class: every row is its class.
    const one = { ...b, variantRules: {}, classId2: null } as BuildState;
    expect(new Set(levelRowClasses(levelGrants(5, 'thaumaturge', db, one.subclassId, {}, null, null, false, [], one).features))).toEqual(new Set(['thaumaturge']));
  });

  it('thaumaturge + swashbuckler 5, the swashbuckler listing the shared record: the second Weapon Expertise row\'s Details is the swashbuckler\'s paragraph, the first the Thaumaturge\'s page', async () => {
    let saved: BuildState | undefined;
    const m = await mount(<Builder content={swashShared} initial={thaumSwash5()} onCancel={noop} onCreate={(b) => { saved = b; }} />, swashShared);
    try {
      await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '5'));
      const blocks = [...m.host.querySelectorAll('.lvl-gain-block')].filter((b) => txt(b.querySelector('.lvl-gain-name')) === 'Weapon Expertise');
      expect(blocks, 'the level-5 page lists Weapon Expertise once per class').toHaveLength(2);
      await click(blocks[1].querySelector('.cc-det'));
      const swash = txt(popup(m.host));
      expect(swash).toMatch(SWASH_CRIT);
      expect(swash).not.toMatch(THAUMATURGE_WE);
      expect(txt(popup(m.host)?.querySelector('.card-nopage'))).toBe(SHARED_FEATURE_FOOTER);
      /* Package M round 3 (d): the row's own description — Builder.tsx `flavor={classFeatureDescription(…,
         rowClassOf(f), content)}` — is the card's root text, which the shared-feature lane above does not draw
         (it reads the record for the scope's class), so the stored pin is where it shows: starring the second
         row stores the swashbuckler's paragraph as the pin's text, never the first class's. */
      await click(starOf(m.host));
      await click(popup(m.host)?.querySelector('.picker-close'));
      await click(blocks[0].querySelector('.cc-det'));
      expect(txt(popup(m.host))).toMatch(THAUMATURGE_WE);
      await click(popup(m.host)?.querySelector('.picker-close'));
      await click(m.host.querySelector('.b-create'));
      // "Save with choices left?" (the synthesized build answers nothing): save anyway.
      const anyway = [...document.querySelectorAll('.confirm-modal button')].find((b) => txt(b) === 'Save anyway');
      if (anyway) await click(anyway);
    } finally { m.stop(); }
    expect(saved, 'the build was saved').toBeTruthy();
    const pins = saved!.pinnedDescs ?? [];
    expect(pins.map(shape)).toEqual([{ key: 'classFeatures', slug: 'weapon-expertise', mode: 'mine', classId: 'swashbuckler' }]);
    /* The record's text names a paragraph per class ("**Swashbuckler** …", "**Thaumaturge** …"); the row keeps
       its own class's and drops the other held class's. (A paragraph led by a class whose book the build has
       switched off stays: the builder cuts with the classes it offers.) */
    const raw = swashShared.classFeatures['weapon-expertise'].description ?? '';
    expect(raw, 'the shared text has the thaumaturge\'s paragraph').toContain('**Thaumaturge**');
    expect(raw, 'the shared text has the swashbuckler\'s paragraph').toContain('**Swashbuckler**');
    expect(classFeatureDescription(raw, 'thaumaturge', swashShared), 'the revert\'s text would be the thaumaturge\'s').not.toMatch(SWASH_CRIT);
    expect(pins[0].description, 'the second row\'s text is the swashbuckler\'s paragraph').toMatch(SWASH_CRIT);
    expect(pins[0].description).toContain('**Swashbuckler**');
    expect(pins[0].description, 'not the first class\'s paragraph').not.toContain('**Thaumaturge**');
  }, 120_000);

  it('live data: the level-5 "Weapon Expertise (Swashbuckler)" row opens the swashbuckler\'s own page', async () => {
    const m = await mount(<Builder content={db} initial={thaumSwash5()} onCancel={noop} onCreate={noop} />, db);
    try {
      await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '5'));
      const block = [...m.host.querySelectorAll('.lvl-gain-block')].find((b) => txt(b.querySelector('.lvl-gain-name')) === db.classFeatures['weapon-expertise-swashbuckler'].name);
      expect(block, 'the swashbuckler\'s own row').toBeTruthy();
      await click(block!.querySelector('.cc-det'));
      expect(txt(popup(m.host))).toMatch(SWASH_CRIT);
      expect(txt(popup(m.host))).not.toMatch(THAUMATURGE_WE);
    } finally { m.stop(); }
  }, 120_000);
});
