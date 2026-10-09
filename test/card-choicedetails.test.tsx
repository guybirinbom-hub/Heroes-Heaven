// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { RecordCard } from '../src/sheet/RecordCard';
import { ChoiceDetails } from '../src/builder/shared';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { classFeatureDescription } from '../src/rules/featureText';
import type { Character, ContentDatabase } from '../src/rules/types';
import type { DescNode } from '../src/sheet/descref';

/**
 * Card step 15, part 1 (docs/card-design.md section 9 row 15; section 6 "Builder rows: ChoiceDetails,
 * scoped to the build's level, subclass and picks"; owner rulings Q1 = A, Q2 = A, no Full page button).
 *
 * The builder's "You gain automatically" rows (a class feature the level grants, a feat the background
 * hands out) open their record's 'mine' card, scoped by scopeOfCharacter over the character being built
 * (Builder's featPrereqChar: buildCharacter over the in-progress build at its current level):
 *  - a pointer row shows its subclass section — folded under "At higher levels" while the build is below
 *    that section's level, open at it (cardScope pointerOf / withPointer, the ledger's rule);
 *  - the per-variant record (second-doctrine-cloistered-cleric) shows its own doctrine only;
 *  - the step-7a hold stays: a row whose own page embeds an empty stub (Rage) keeps the title lookup's
 *    browse popup, byte for byte;
 *  - the PinStar node is {key: bucket, slug: id, title, mode: 'mine'};
 *  - with no character (every caller but the builder's granted rows) the popup is the browse popup it
 *    was: the same markup DescriptionModal draws for the same root.
 *
 * Measured (lane scratch, every class × subclass × level-grant row against scripts/data/level-folds.json):
 * no row of a class's own feature list folds by its own page's level sections; the rows that fold are the
 * 9 pointer rows (champion relentless / exalted reaction, barbarian raging resistance, alchemist field
 * discovery / advanced vials / greater field discovery, gunslinger advanced / greater deed, ranger
 * masterful hunter). The fighter's level-9 rows (battle-hardened, combat-flexibility) have pages with no
 * level-titled section, so a fighter 1 sees them whole; the champion's pointer row is the fold case here.
 * Fixtures are synthesized through build() / emptyBuild() (name 't'); none is the owner's.
 *
 * Mutation proofs (each run red, then restored byte-exact and green):
 *  - shared.tsx ChoiceDetails `{ scope: scopeOfCharacter(character) }` → `{ scope: undefined }` (fold and
 *    pointer disabled) → the Justice 5 fold case and the Builder champion 9 case red.
 *  - Builder.tsx `character={featPrereqChar}` (class-feature row) → `character={{ ...featPrereqChar, level: 1 }}`
 *    (scope from the wrong level) → the Builder champion 9 case red.
 *  - Builder.tsx background-granted feat row `id={gid} character={featPrereqChar} />` → `id={gid} />` → the
 *    acolyte Student of the Canon case red.
 *  - shared.tsx ChoiceDetailsModal `if (mine && !held && byId.key)` → `if (mine && byId.key)` (hold broken)
 *    → the Rage case red.
 *  - shared.tsx `{ ...byId, mode: 'mine' }` → `{ ...byId }` → the PinStar case red.
 *  - shared.tsx ChoiceDetails `mine={bucket && id && character ? … : undefined}` → `mine={bucket && id ? … }`
 *    (mine without a build) → the browse-unchanged case red.
 *  (The switch-turned-back case and its mutation left with the switch in card step 22.)
 * The guard sees the same path: scripts/lib/card-scope.mjs models the 455 granted rows that are not held
 * as 'mine' (21 held rows stay browse), and test/card-parity.test.tsx opens its sampled rows WITH a
 * character — `rows.push(false && choiceCard && !held …` (every row browse) → 49 disagreements, red; the
 * renderer without `character={CHOICE_CHAR}` → "the ledger's mine row opens the mine card", red.
 */

const db: ContentDatabase = content();
const noop = () => undefined;
/** feat-2860 (Cascade Countermeasure) prints this sentence. */
const FEAT_CLAUSE = 'When in Arcane Cascade, you can make yourself resistant to magic';
const trees: Record<string, Record<string, AstNode>> = {};
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
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
  // batch card: #card-NOT-VACUOUS — the case measures something
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The text a page body shows (folded text excluded: a closed <details> keeps it in the DOM). */
function shownText(el: Element | null): string {
  if (!el) return '';
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('.card-fold').forEach((e) => e.remove());
  return txt(copy);
}

/** A granted class-feature row, as Builder hands it to ChoiceDetails. */
function featureRow(classId: string, id: string, character?: Character | null): ReactElement {
  const r = db.classFeatures[id];
  // batch card: #card-NOT-VACUOUS — the case measures something
  expect(r, `classFeatures:${id} exists`).toBeTruthy();
  return <ChoiceDetails name={r.name} flavor={classFeatureDescription(r.description, classId, db)} descRefs={r.descRefs} bucket="classFeatures" id={id} character={character} />;
}
/** Open a ChoiceDetails row's popup; returns the host and the popup element. */
async function openRow(el: ReactElement, pin: PinDescApi | null = null) {
  const m = await mount(el, pin);
  await click(m.host.querySelector('.cc-det'));
  return { ...m, pop: m.host.querySelector('.picker-overlay') };
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
  for (const b of ['feats', 'classFeatures', 'actions', 'categoryPage', 'backgrounds', 'ancestries', 'heritages', 'classes']) await loadBucketAst(b);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('card step 15: the builder\'s granted rows open the record\'s mine card', () => {
  // batch card: #card-OWNER-3 — Second Doctrine is its own line
  it('L3 cloistered cleric: Second Doctrine\'s variant record shows "Fortitude" and no other doctrine', async () => {
    const cleric = build('cleric', 3, { subclassId: 'cloistered-cleric' });
    const p = await openRow(featureRow('cleric', 'second-doctrine-cloistered-cleric', cleric));
    try {
      const page = p.pop?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      expect(page, 'the mine card draws the page').toBeTruthy();
      // doctrine-4 (Cloistered Cleric, Player Core) prints the second doctrine as this sentence.
      // batch card premise: doctrine-4 "Your proficiency rank for Fortitude saves increases to expert."
      expect(shownText(page)).toContain('Your proficiency rank for Fortitude saves increases to expert.');
      // batch card premise: doctrine-4 "Fourth Doctrine"
      for (const other of ['First Doctrine', 'Third Doctrine', 'Fourth Doctrine', 'Fifth Doctrine', 'Final Doctrine']) expect(shownText(page)).not.toContain(other);
      // batch card: #card-NO-FULL-PAGE — there is no Full page button
      expect(txt(p.pop), 'no Full page button (owner ruling, section 13)').not.toMatch(/Full page/i);
    } finally { p.stop(); }
  });

  // batch card: #card-Q1A — later-level parts fold under one line
  it('a Justice champion 5: the level-9 Relentless Reaction row folds its cause section; at 9 it is open', async () => {
    // cause-11 (Justice): "If your Strike hits, the target takes persistent spirit damage equal to your Charisma modifier."
    const clause = 'If your Strike hits, the target takes persistent spirit damage equal to your Charisma modifier';
    const at5 = await openRow(featureRow('champion', 'relentless-reaction', build('champion', 5, { subclassId: 'justice' })));
    try {
      const page = at5.pop?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      // batch card: #card-Q1A — later-level parts fold under one line
      expect(page, 'the mine card draws the page').toBeTruthy();
      const fold = page!.querySelector('details.card-fold[data-fold="future"]');
      expect(fold, 'the cause section is folded at 5').toBeTruthy();
      expect(txt(fold!.querySelector('summary'))).toBe('At higher levels (1)');
      expect(txt(fold), 'the folded text stays reachable').toContain(clause);
      expect(shownText(page)).not.toContain(clause);
    } finally { at5.stop(); }
    const at9 = await openRow(featureRow('champion', 'relentless-reaction', build('champion', 9, { subclassId: 'justice' })));
    try {
      const page = at9.pop?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      // batch card: #card-Q1A — later-level parts fold under one line
      expect(page?.querySelector('.card-fold'), 'nothing folds at 9').toBeNull();
      expect(txt(page?.querySelector('.card-pointer')), 'the cause section shows at 9').toContain(clause);
    } finally { at9.stop(); }
  });

  // batch card: #card-R1 — one card per record
  it('the step-7a hold stays: a barbarian\'s Rage row keeps the title lookup\'s browse popup (the Rage action\'s rules)', async () => {
    const barb = build('barbarian', 1);
    const withBuild = await openRow(featureRow('barbarian', 'rage', barb));
    const html = withBuild.pop?.outerHTML ?? '';
    const shown = txt(withBuild.pop);
    const isMine = !!withBuild.pop?.querySelector('.card-mine');
    withBuild.stop();
    const without = await openRow(featureRow('barbarian', 'rage'));
    const before = without.pop?.outerHTML ?? '';
    without.stop();
    // batch card: #card-R1 — one card per record
    expect(isMine, 'a held row is not the mine card').toBe(false);
    expect(html, 'byte for byte the popup the row had').toBe(before);
    // The Rage action page (action-2802) is what the title lookup lands on.
    // batch card premise: action-2802 "You tap into your inner fury and begin raging"
    expect(shown).toContain('You tap into your inner fury and begin raging');
  });

  // batch card: #card-PIN — a pin reopens the record it was made from
  it('the PinStar node is {key: bucket, slug: id, title, mode: \'mine\'}', async () => {
    let pinned: DescNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
    const p = await openRow(featureRow('cleric', 'second-doctrine-cloistered-cleric', build('cleric', 3, { subclassId: 'cloistered-cleric' })), pin);
    try {
      await click(p.pop?.querySelector('.info-star'));
    } finally { p.stop(); }
    // batch card: #card-PIN — a pin reopens the record it was made from
    expect(pinned, 'the star pinned a node').toBeTruthy();
    const n = pinned as unknown as DescNode & { mode?: string };
    expect({ key: n.key, slug: n.slug, title: n.title, mode: n.mode }).toEqual({
      key: 'classFeatures', slug: 'second-doctrine-cloistered-cleric', title: db.classFeatures['second-doctrine-cloistered-cleric'].name, mode: 'mine',
    });
  });

  // batch card: #card-SNAPSHOT — a step changes only its own surface
  it('with no build (a feat being chosen, any caller but the granted rows) the popup is unchanged: DescriptionModal\'s markup for the same root', async () => {
    for (const id of ['toughness', 'cascade-countermeasure', 'assurance']) {
      const f = db.feats[id];
      const root: DescNode = { title: f.name, description: f.description, descRefs: f.descRefs, key: 'feats', slug: id };
      const row = await openRow(<ChoiceDetails name={f.name} flavor={f.description} descRefs={f.descRefs} bucket="feats" id={id} />);
      const got = row.pop?.outerHTML;
      row.stop();
      const ref = await mount(<DescriptionModal root={root} onClose={noop} />);
      const want = ref.host.querySelector('.picker-overlay')?.outerHTML;
      ref.stop();
      // batch card: #card-SNAPSHOT — a step changes only its own surface
      expect(got, `${id}: a browse popup`).toBeTruthy();
      expect(got, `${id}: byte for byte DescriptionModal`).toBe(want);
      expect(got).not.toContain('card-mine');
    }
  });

  // batch card: #card-R1 — one card per record
  it('a background-granted feat row with a build opens the feat\'s mine card (its page, by id)', async () => {
    const f = db.feats['cascade-countermeasure'];
    const p = await openRow(<ChoiceDetails name={f.name} flavor={f.description} descRefs={f.descRefs} bucket="feats" id="cascade-countermeasure" character={build('fighter', 1)} />);
    try {
      const page = p.pop?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      expect(page, 'the feat\'s page as a mine card').toBeTruthy();
      // The mine card reads the same page the browse card does (by {bucket, id}, never the same-named spell).
      const browse = await mount(<RecordCard record={{ bucket: 'feats', id: 'cascade-countermeasure' }} mode="browse" chrome="popup" onExit={noop} />);
      const browseBody = txt(browse.host.querySelector('.ast-modal .ast-body'));
      browse.stop();
      // batch card: #card-R1 — one card per record
      expect(browseBody.length).toBeGreaterThan(0);
      expect(browseBody).toContain(FEAT_CLAUSE);
      expect(txt(page)).toContain(FEAT_CLAUSE);
    } finally { p.stop(); }
  });
});

describe('card step 15 through the real Builder', () => {
  const champion9 = (): BuildState =>
    ({ ...emptyBuild(), name: 't', level: 9, ancestryId: 'human', backgroundId: 'acolyte', classId: 'champion', subclassId: 'justice' }) as BuildState;

  // batch card: #card-Q1A — later-level parts fold under one line
  it('a Justice champion built to 9: the level-9 page\'s Relentless Reaction Details is the mine card with the cause section open', async () => {
    const m = await mount(<Builder content={db} initial={champion9()} onCancel={noop} onCreate={noop} />);
    try {
      await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '9'));
      const block = [...m.host.querySelectorAll('.lvl-gain-block')].find((b) => txt(b.querySelector('.lvl-gain-name')) === 'Relentless Reaction');
      expect(block, 'the level-9 page grants Relentless Reaction').toBeTruthy();
      await click(block!.querySelector('.cc-det'));
      const overlays = m.host.querySelectorAll('.picker-overlay');
      const pop = overlays[overlays.length - 1];
      const page = pop?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      // batch card: #card-Q1A — later-level parts fold under one line
      expect(page, 'the row opens the mine card').toBeTruthy();
      expect(page!.querySelector('.card-fold'), 'scoped to the build\'s level (9): nothing folds').toBeNull();
      // batch card premise: cause-11 "If your Strike hits, the target takes persistent spirit damage equal to your Charisma"
      expect(txt(page!.querySelector('.card-pointer'))).toContain('If your Strike hits, the target takes persistent spirit damage equal to your Charisma modifier');
    } finally { m.stop(); }
  });

  // batch card: #card-R1 — one card per record
  it('an acolyte\'s level-1 page: the background-granted Student of the Canon row opens the feat\'s mine card', async () => {
    const acolyte1 = { ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', backgroundId: 'acolyte', classId: 'fighter' } as BuildState;
    const m = await mount(<Builder content={db} initial={acolyte1} onCancel={noop} onCreate={noop} />);
    try {
      await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '1'));
      const name = db.feats['student-of-the-canon'].name;
      const block = [...m.host.querySelectorAll('.lvl-gain-block')].find((b) => txt(b.querySelector('.lvl-gain-name')) === name);
      // batch card: #card-R1 — one card per record
      expect(block, 'the level-1 page lists the background-granted feat').toBeTruthy();
      expect(txt(block!.querySelector('.lvl-gain-tag'))).toBe('skill feat · granted');
      await click(block!.querySelector('.cc-det'));
      const overlays = m.host.querySelectorAll('.picker-overlay');
      const page = overlays[overlays.length - 1]?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      expect(page, 'the granted feat row opens the mine card').toBeTruthy();
      // feat-5219 (Student of the Canon, Player Core) prints this clause.
      // batch card premise: feat-5219 "researched many faiths enough to recognize notions about them that are unlikely to be"
      expect(txt(page)).toContain('researched many faiths enough to recognize notions about them that are unlikely to be true');
    } finally { m.stop(); }
  });
});
