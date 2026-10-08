// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { RecordCard } from '../src/sheet/RecordCard';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { Builder } from '../src/builder/Builder';
import { featEntries } from '../src/sheet/FeatsTab';
import { featPinNode } from '../src/sheet/FeatDetail';
import { applyPlayState, initialPlay, pinForRead, pinOf, samePin, type PlayState, type PlayUpdater } from '../src/rules/play';
import { scopeOfCharacter } from '../src/sheet/cardScope';
import * as lib from '../scripts/lib/card-scope.mjs';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { flushPersist, hasPendingPersist } from '../src/data/persist';
import { ROSTER_KEY } from '../src/data/storage';
import type { Character, ContentDatabase, PinnedDesc } from '../src/rules/types';

/**
 * Card step 19 (docs/card-design.md section 7 "Old pins", section 9 row 19, section 2 rule 2): PIN
 * IDENTITY. A pin stores its record — {bucket: key, id: slug} — plus the mode it was pinned from and the
 * popup's choice / mark / note ours lines; a pin saved before step 19 ({key, title, description}) is
 * re-resolved at READ time only and never written back.
 *
 * Every case runs the REAL sheet: CharacterSheet wired the way App.tsx wires it (onPlay updates the play
 * ledger, the character is applyPlayState of it), its Feats tab row, FeatDetail's PinStar, the Main tab's
 * Pinned list and the popup it reopens, over the shipped page trees (public/ast/*.json.gz, served through
 * a fetch stub). Characters are synthesized through build() (name 't'); none is the owner's. `writes`
 * counts every call of the sheet's ONE write path (onPlay → App's update → the 400 ms schedulePersist),
 * so "0 writes" means the persist never fired from the sheet.
 *
 * MUTATION LINES: see the end of this file's report in the step-19 lane (each measured red, then the file
 * restored byte-exact from a scratch copy, sha1 checked). Fixer round 1 (2026-10-07), each red then restored:
 *  - Builder.tsx pinApi toggle stores `{title, description, descRefs, key}` instead of pinOf(node) → the two
 *    Builder new-pin cases red; Builder.tsx has() by key:title → the same-name Builder case red.
 *  - CharacterSheet.tsx has() by key:title → both sheet-star cases red.
 *  - play.ts pinForRead `canon.length ?` → `canon.length < 0 ?` → pinned-descs' twinned-name case red.
 * Merge fixer (2026-10-07, on main after steps 11/12/16; each red, then restored from a scratch copy, sha1
 * checked):
 *  - MainTab.tsx PinnedDescCard `pin.mode === 'mine'` → `… && false` (every pin reopens as browse) → the
 *    caustic-nectar, magus, no-page and Justice cases red ("the reopened pin is the 'mine' card").
 *  - MainTab.tsx PinnedDescCard `scope={scopeOfCharacter(character)}` → `scope={undefined}` → the Justice
 *    case red ("one fold": 0).
 *  - MainTab.tsx PinnedDescCard node `pinForRead(…)` → `{ ...pinForRead(…), slug: undefined }` (reopened by
 *    the slug of its title) → caustic-nectar, magus, Zombie Horde and the several-records snapshot case red.
 *  - card-scope.mjs pinReadOf: an old pin read by astSlug(title) → the ledger-model mirror case red.
 *  - card-scope.mjs samePinModel: always the legacy key:title → the ledger-model mirror case red.
 */
const db: ContentDatabase = content();
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

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The text of a popup's page body (the browse card's page lane) without anything marked ours (the box
 *  sits in the body's footer slot, AstRenderer `footer`), or null when it fell back. */
const pageText = (host: Element) => {
  const body = host.querySelector('.ast-modal .ast-body');
  if (!body) return null;
  const copy = body.cloneNode(true) as Element;
  copy.querySelectorAll('[data-ours]').forEach((e) => e.remove());
  return txt(copy);
};
/** The browse card for {bucket, id}: the record's own page, the truth a reopened search / old pin must equal. */
async function browseText(bucket: string, id: string): Promise<string | null> {
  const m = await mount(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
  const t = pageText(m.host);
  m.stop();
  return t;
}
/** The 'mine' card for {bucket, id} at `ch`'s scope (printed set empty, as FeatDetail's card draws it): the
 *  record's own page as the sheet shows it, the truth a reopened pin made from the sheet must equal. */
async function mineText(bucket: string, id: string, ch: Character): Promise<string | null> {
  const m = await mount(<RecordCard record={{ bucket, id }} mode="mine" chrome="popup" scope={scopeOfCharacter(ch)} printed={[]} onExit={noop} />);
  const t = pageText(m.host);
  m.stop();
  return t;
}

/** The sheet as App.tsx wires it. `seen.play` is the live ledger; `seen.writes` counts onPlay calls. */
function sheet(base: Character, start: PlayState, seen: { play: PlayState; writes: number }) {
  function Harness() {
    const [play, setPlay] = useState(start);
    seen.play = play;
    const onPlay: PlayUpdater = (fn) => { seen.writes += 1; setPlay((p) => fn(p)); };
    return <CharacterSheet character={applyPlayState(base, play, db)} content={db} charKey="t" onPlay={onPlay} />;
  }
  return <Harness />;
}
const tab = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('nav.tabs button.tab')].find((b) => txt(b) === label);
const pinnedRow = (host: HTMLElement, title: string) =>
  [...host.querySelectorAll('.pinned-desc')].find((r) => txt(r.querySelector('.pinned-desc-title')) === title);
/** The popup opened over the sheet (the reopened pin is RecordCard's popup: 'mine' for a pin made from the
 *  sheet, browse for any other). */
const popup = (host: HTMLElement) => host.querySelector('.picker-overlay');
/**
 * FeatDetail's popup over the sheet. Card step 11 made it the row's 'mine' RecordCard:
 * the page lane's `.ast-modal.card-mine` (its star in `.ast-head`) or the no-page lane's
 * `.picker.info-modal.card-mine` (its star in `.picker-head`) — no longer the legacy `.picker.spell-detail`.
 */
const featCard = (host: HTMLElement) => host.querySelector('.ast-modal.card-mine, .picker.info-modal.card-mine');

/** Feats tab → the row named `name` → its FeatDetail → its PinStar; the popup is closed again after. */
async function pinFromFeatsTab(host: HTMLElement, name: string) {
  await click(tab(host, 'Feats & features'));
  const row = [...host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
  expect(row, `the Feats tab lists a row named ${name}`).toBeTruthy();
  await click(row);
  const pop = featCard(host);
  // batch card premise: feat-7612 "You have specialized glands inside your throat"
  expect(pop, `${name}: FeatDetail opened (the 'mine' card)`).toBeTruthy();
  await click(pop!.querySelector('.info-star'));
  await click(pop!.querySelector('.picker-close'));
}
/** Feats tab → the row named `name` → its FeatDetail popup, left open. */
async function openFeat(host: HTMLElement, name: string) {
  await click(tab(host, 'Feats & features'));
  const row = [...host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
  expect(row, `the Feats tab lists a row named ${name}`).toBeTruthy();
  await click(row);
  const pop = featCard(host);
  // batch card premise: feat-7612 "You have specialized glands inside your throat"
  expect(pop, `${name}: FeatDetail opened (the 'mine' card)`).toBeTruthy();
  return pop!;
}
/** Main tab → the Pinned row titled `title` → its popup. */
async function reopenFromPinned(host: HTMLElement, title: string) {
  await click(tab(host, 'Main'));
  const row = pinnedRow(host, title);
  expect(row, `the Pinned list shows ${title}`).toBeTruthy();
  await click(row!.querySelector('.pinned-desc-open'));
  const pop = popup(host);
  expect(pop, `${title}: the pinned popup opened`).toBeTruthy();
  return pop!;
}

let fighter: Character;
const withFeats = (ch: Character, extra: Partial<Character>, ...featIds: string[]): Character => ({
  ...ch,
  ...extra,
  feats: [...(ch.feats ?? []), ...featIds.map((featId) => ({ featId, level: db.feats[featId]?.level ?? 1, category: (db.feats[featId]?.category ?? 'general') as never }))],
} as Character);

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    // The real App (last case) loads the shipped content the way the app does.
    const core = /(core(?:-descriptions)?\.json)$/.exec(u);
    if (core) return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${core[1]}`, 'utf8')) as unknown };
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  await loadAstIndex();
  for (const b of ['feats', 'classFeatures', 'heritages', 'items', 'spells', 'actions']) await loadBucketAst(b);
  fighter = build('fighter', 20);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('card step 19: a pin is its record', () => {
  it('"Caustic Nectar (Acid)" pinned from FeatDetail reopens from the Pinned list as caustic-nectar\'s own page, with its box (the pick)', async () => {
    // A synthesized pick WITH a note: FeatsTab withPicks turns a noted pick into the 'choice' ours line.
    const pickNote = 'synthesized pick note for card step 19';
    const ch = withFeats(fighter, { effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid', note: pickNote }] } as Partial<Character>, 'caustic-nectar');
    const entry = featEntries(ch, db).find((e) => e.featId === 'caustic-nectar');
    expect(entry?.name).toBe('Caustic Nectar (Acid)');
    const choice = entry!.ours?.find((l) => l.kind === 'choice');
    expect(choice, 'the row carries its pick as an ours line').toBeTruthy();
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, 'Caustic Nectar (Acid)');
      expect(seen.writes, 'the star wrote once').toBe(1);
      const stored = seen.play.pinnedDescs ?? [];
      expect(stored).toHaveLength(1);
      expect({ key: stored[0].key, slug: stored[0].slug, title: stored[0].title, mode: stored[0].mode })
        .toEqual({ key: 'feats', slug: 'caustic-nectar', title: 'Caustic Nectar (Acid)', mode: 'mine' });
      expect(stored[0].ours?.map((l) => l.kind)).toContain('choice');

      const pop = await reopenFromPinned(m.host, 'Caustic Nectar (Acid)');
      // A pin made from the sheet reopens as the 'mine' card (section 6), at the character's scope: the
      // truth is caustic-nectar's own page as the sheet's card draws it, by {bucket, id}.
      // batch card premise: feat-7612 "You have specialized glands inside your throat"
      expect(pop.querySelector('.ast-modal.card-mine'), 'the reopened pin is the \'mine\' card').toBeTruthy();
      const own = await mineText('feats', 'caustic-nectar', ch);
      expect(own, 'Caustic Nectar has a page').toBeTruthy();
      // batch card premise: feat-7612 "You have specialized glands inside your throat"
      expect(pageText(pop), 'the reopened pin is caustic-nectar\'s own page, not a name miss').toBe(own);
      const box = pop.querySelector('.card-ours[data-ours]');
      expect(box, 'the reopened card draws the ours box').toBeTruthy();
      expect(txt(box)).toContain(`Your choice: Acid — ${pickNote}`);
      expect(txt(box)).toContain(`Note: ${db.feats['caustic-nectar'].note}`);
      // The box is ours, after the page's words, and its words are said once.
      const words = pop.querySelector('.ast-body')!;
      const prose = [...words.querySelectorAll('p')].find((p) => !p.closest('[data-ours]') && txt(p).includes('specialized glands'));
      expect(prose, 'the page prose is drawn').toBeTruthy();
      expect(prose!.compareDocumentPosition(box!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the box follows the page prose').toBeTruthy();
      expect(txt(pop).split(`Your choice: Acid — ${pickNote}`).length - 1).toBe(1);
      expect(seen.writes, 'reopening wrote nothing').toBe(1);

      // The reopened card's own star reads pinned, and pressing it unpins the record.
      const star = pop.querySelector('.info-star');
      expect(star?.getAttribute('aria-pressed')).toBe('true');
      await click(star);
      expect(seen.play.pinnedDescs ?? []).toEqual([]);
    } finally { m.stop(); }
  });

  it('a pinned magus Weapon Expertise reopens weapon-expertise-magus by its id — not the page the name "Weapon Expertise" slugs to', async () => {
    const magus = build('magus', 9);
    const entry = featEntries(magus, db).find((e) => e.name === 'Weapon Expertise');
    expect(entry, 'a magus 9 lists Weapon Expertise').toBeTruthy();
    const named = Object.entries(db.classFeatures).filter(([, r]) => r.name === 'Weapon Expertise').map(([id]) => id);
    expect(named.length, 'the name "Weapon Expertise" names several class features').toBeGreaterThan(1);
    const seen = { play: initialPlay(magus, db), writes: 0 };
    const m = await mount(sheet(magus, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, 'Weapon Expertise');
      const stored = seen.play.pinnedDescs ?? [];
      expect({ key: stored[0]?.key, slug: stored[0]?.slug }).toEqual({ key: 'classFeatures', slug: 'weapon-expertise-magus' });
      const pop = await reopenFromPinned(m.host, 'Weapon Expertise');
      expect(await browseText('classFeatures', 'weapon-expertise-magus'), 'the magus record and the name-slug record draw different pages')
        .not.toBe(await browseText('classFeatures', 'weapon-expertise'));
      // The pin was made from the sheet, so it reopens as the 'mine' card at the magus 9's scope: the truth is
      // weapon-expertise-magus's own page (its magus slice) as that card draws it, and never the card of the
      // record the name "Weapon Expertise" slugs to.
      // batch card premise: class-feature-1269 "learning the intricacies of your weapons"
      const own = await mineText('classFeatures', 'weapon-expertise-magus', magus);
      const byName = await mineText('classFeatures', 'weapon-expertise', magus);
      expect(own, 'weapon-expertise-magus has a page').toBeTruthy();
      expect(own).toContain('learning the intricacies of your weapons');
      expect(pop.querySelector('.ast-modal.card-mine'), 'the reopened pin is the \'mine\' card').toBeTruthy();
      // batch card premise: class-feature-1269 "learning the intricacies of your weapons"
      expect(pageText(pop), 'the reopened pin is the magus record\'s page').toBe(own);
      expect(pageText(pop), 'not the name-slug record\'s card').not.toBe(byName);
    } finally { m.stop(); }
  });

  // Was test/card-parity-known.json's 'pin|feats:zombie-horde-impossible-magic' (identity true until step 19:
  // the stored pin read feats + the slug of "Zombie Horde", the Clockwork Reanimator feat). Right now, so the
  // entry left the shrink-only list and this case holds the fix on the real sheet.
  it('an Impossible Magic "Zombie Horde" pinned from the sheet reopens its own page, not the Clockwork Reanimator feat of the same name', async () => {
    const id = 'zombie-horde-impossible-magic';
    expect(db.feats['zombie-horde'].name, 'two feats share the name').toBe(db.feats[id].name);
    const ch = withFeats(fighter, {}, id);
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, db.feats[id].name);
      expect({ key: seen.play.pinnedDescs?.[0]?.key, slug: seen.play.pinnedDescs?.[0]?.slug }).toEqual({ key: 'feats', slug: id });
      const pop = await reopenFromPinned(m.host, db.feats[id].name);
      const own = await mineText('feats', id, ch);
      const other = await mineText('feats', 'zombie-horde', ch);
      expect(own && other && own !== other, 'the two records draw different pages').toBe(true);
      expect(pageText(pop), 'the reopened pin is the Impossible Magic record\'s page').toBe(own);
    } finally { m.stop(); }
  });

  // Fixer round 1 (CharacterSheet.tsx pinApi has(), play.ts samePin): a legacy key:title compare would read
  // "Caustic Nectar (Fire)" as unpinned after the pick changed, and the magus star as pinned by another
  // class feature's pin of the same name.
  it('the sheet star reads a pin by its record: the same record under another pick reads pinned', async () => {
    const stored: PinnedDesc = { title: 'Caustic Nectar (Acid)', description: 'synthesized', key: 'feats', slug: 'caustic-nectar', mode: 'mine' };
    const ch = withFeats(fighter, { effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Fire' }] } as Partial<Character>, 'caustic-nectar');
    expect(featEntries(ch, db).find((e) => e.featId === 'caustic-nectar')?.name).toBe('Caustic Nectar (Fire)');
    const start: PlayState = { ...initialPlay(ch, db), pinnedDescs: [stored] };
    const seen = { play: start, writes: 0 };
    const m = await mount(sheet(ch, start, seen));
    try {
      // Card step 11: the FeatDetail card's star is in its header (.ast-head on the page lane).
      // batch card premise: feat-7612 "You have specialized glands inside your throat"
      const star = (await openFeat(m.host, 'Caustic Nectar (Fire)')).querySelector('.info-star');
      expect(star?.getAttribute('aria-pressed'), 'the record\'s pin reads pinned under its new pick').toBe('true');
      await click(star);
      expect(seen.play.pinnedDescs, 'pressing it removed that pin, and added none').toEqual([]);
    } finally { m.stop(); }
  });

  it('the sheet star does not read another record\'s pin of the same name as its own', async () => {
    const magus = build('magus', 9);
    const other = Object.keys(db.classFeatures).filter((id) => db.classFeatures[id]?.name === 'Weapon Expertise' && id !== 'weapon-expertise-magus').sort()[0];
    expect(other, 'another class feature is named Weapon Expertise').toBeTruthy();
    const theirs: PinnedDesc = { title: 'Weapon Expertise', description: 'synthesized', key: 'classFeatures', slug: other };
    const start2: PlayState = { ...initialPlay(magus, db), pinnedDescs: [theirs] };
    const seen2 = { play: start2, writes: 0 };
    const m2 = await mount(sheet(magus, start2, seen2));
    try {
      // batch card premise: class-feature-1269 "learning the intricacies of your weapons"
      const star2 = (await openFeat(m2.host, 'Weapon Expertise')).querySelector('.info-star');
      expect(star2?.getAttribute('aria-pressed'), `${other}'s pin does not read as the magus record's`).toBe('false');
      await click(star2);
      expect((seen2.play.pinnedDescs ?? []).map((d) => d.slug), 'pressing it pinned the magus record beside the other').toEqual([other, 'weapon-expertise-magus']);
    } finally { m2.stop(); }
  });

  it('a pinned record with NO page says its note once when reopened — the stored words, no second box', async () => {
    // dedication-to-the-five: a noted feat with no page. Its stored description carries the box's words
    // (FeatDetail pinDescriptionOf, the step-8 bridge kept for older pins and devices), so the reopened
    // no-page card must not draw them a second time from the stored ours lines.
    const id = 'dedication-to-the-five';
    const note = db.feats[id].note!;
    expect(note, `${id} carries a note`).toBeTruthy();
    expect(treeOf('feats')![id], `${id} has no page`).toBeUndefined();
    const ch = withFeats(fighter, {}, id);
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, db.feats[id].name);
      expect(seen.play.pinnedDescs?.[0]?.ours?.map((l) => l.kind), 'the pin stored the note line').toEqual(['note']);
      const pop = await reopenFromPinned(m.host, db.feats[id].name);
      expect(pageText(pop)).toBeNull();
      // Made from the sheet: the 'mine' card's no-page lane, which says it has no page once.
      expect(pop.querySelector('.picker.info-modal.card-mine'), 'the reopened pin is the \'mine\' card (no-page lane)').toBeTruthy();
      expect(txt(pop).split(`Note: ${note}`).length - 1, 'the note is on screen exactly once').toBe(1);
      expect(pop.querySelectorAll('.card-ours[data-ours]'), 'no second box of the stored ours lines').toHaveLength(0);
    } finally { m.stop(); }
  });

  it('a pin made from the sheet reopens as the \'mine\' card at the character\'s level: a Justice champion 5\'s cause row folds what it does not have yet', async () => {
    // Section 6: "A pin made from the sheet reopens as mine at the character's current level". MainTab's
    // PinnedDescCard passes mode 'mine' and scopeOfCharacter(character) for a pin stored with mode 'mine'.
    const ch = build('champion', 5, { subclassId: 'justice' } as never);
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'justice' || e.featureId === 'justice');
    expect(entry, 'a Justice champion lists its cause row').toBeTruthy();
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, entry!.name);
      const stored = seen.play.pinnedDescs ?? [];
      expect({ key: stored[0]?.key, slug: stored[0]?.slug, mode: stored[0]?.mode }).toEqual({ key: 'classFeatures', slug: 'justice', mode: 'mine' });
      const pop = await reopenFromPinned(m.host, entry!.name);
      const modal = pop.querySelector('.ast-modal.card-mine');
      expect(modal, 'the reopened pin is the \'mine\' card').toBeTruthy();
      // cause-11 "Relentless Reaction" is a later level's part: folded, closed, its words inside the fold.
      const folds = [...modal!.querySelectorAll('details.card-fold')] as HTMLDetailsElement[];
      expect(folds.length, 'one fold').toBe(1);
      expect(folds[0].open, 'closed').toBe(false);
      expect(txt(folds[0].querySelector(':scope > summary'))).toMatch(/^At higher levels \(\d+\)$/);
      expect(txt(folds[0])).toMatch(/Relentless Reaction/);
      expect(pageText(pop), 'the champion\'s own card for the record').toBe(await mineText('classFeatures', 'justice', ch));
      expect(seen.writes, 'pinning wrote once, reopening nothing').toBe(1);
    } finally { m.stop(); }
  });
});

/*
 * Fixer round 1: the Builder is one of the copy sites (Builder.tsx pinApi). Its star goes through the real
 * Builder — the level page's subclass card opens Cloistered Cleric's record card, whose star node knows its
 * record — and the build is read back the way App.tsx gets it: "Save changes" → onCreate.
 */
describe('card step 19: the Builder\'s star keeps the record id and matches by record', () => {
  const cleric = (pinnedDescs: PinnedDesc[]): BuildState =>
    ({ ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', backgroundId: 'acolyte', classId: 'cleric', subclassId: 'cloistered-cleric', pinnedDescs }) as BuildState;
  const anyButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => txt(b) === label);
  /** The real Builder on `initial`, its level-1 subclass popup open; `saved()` presses Save and returns the build. */
  async function builderPopup(initial: BuildState) {
    let out: BuildState | undefined;
    const m = await mount(<Builder content={db} initial={initial} onCancel={noop} onCreate={(b) => { out = b; }} />);
    await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '1'));
    await click(m.host.querySelector('.lvl-subsel .ss-filled-body'));
    const overlays = m.host.querySelectorAll('.picker-overlay');
    const pop = overlays[overlays.length - 1];
    expect(pop, 'the subclass popup opened').toBeTruthy();
    expect(pageText(pop), 'it is Cloistered Cleric\'s record card').toBe(await browseText('classFeatures', 'cloistered-cleric'));
    const saved = async () => {
      await click(pop.querySelector('.picker-close'));
      await click([...m.host.querySelectorAll<HTMLButtonElement>('button.b-create')].find((b) => txt(b) === 'Save changes'));
      for (let i = 0; i < 4 && anyButton('Save anyway'); i++) await click(anyButton('Save anyway'));
      expect(out, 'the Builder handed back its build').toBeTruthy();
      return out!;
    };
    return { m, star: () => pop.querySelector('.info-star'), saved };
  }

  it('a new pin stores {bucket, id}; a pin of another record sharing the name does not read as this one', async () => {
    const theirs: PinnedDesc = { title: 'Cloistered Cleric', description: 'synthesized', key: 'classFeatures', slug: 'synthesized-other-record' };
    const p = await builderPopup(cleric([theirs]));
    try {
      expect(p.star()?.getAttribute('aria-pressed'), 'another record\'s pin of the same name is not this record\'s').toBe('false');
      await click(p.star());
      expect(p.star()?.getAttribute('aria-pressed')).toBe('true');
      const pins = (await p.saved()).pinnedDescs ?? [];
      expect(pins.map((d) => ({ key: d.key, slug: d.slug, title: d.title })), 'the Builder stored the record id beside the other pin')
        .toEqual([{ key: 'classFeatures', slug: 'synthesized-other-record', title: 'Cloistered Cleric' }, { key: 'classFeatures', slug: 'cloistered-cleric', title: 'Cloistered Cleric' }]);
    } finally { p.m.stop(); }
  });

  it('a new pin made in the Builder keeps its record id (no field-by-field copy)', async () => {
    const p = await builderPopup(cleric([]));
    try {
      await click(p.star());
      const pins = (await p.saved()).pinnedDescs ?? [];
      expect(pins).toHaveLength(1);
      expect(pins[0], 'the record id survives the Builder\'s store').toMatchObject({ key: 'classFeatures', slug: 'cloistered-cleric', title: 'Cloistered Cleric' });
    } finally { p.m.stop(); }
  });

  it('an old title-only pin in the build reads pinned on the Builder star and pressing it removes that pin', async () => {
    const legacy: PinnedDesc = { title: 'Cloistered Cleric', description: 'synthesized', key: 'classFeatures' };
    const p = await builderPopup(cleric([legacy]));
    try {
      expect(p.star()?.getAttribute('aria-pressed'), 'the old pin reads as pinned').toBe('true');
      await click(p.star());
      expect((await p.saved()).pinnedDescs ?? [], 'removed, and none added').toEqual([]);
    } finally { p.m.stop(); }
  });
});

describe('card step 19: a pin saved before step 19 (old shape) — read-time only, never written back', () => {
  const old = (id: string, bucket = 'feats'): PinnedDesc => {
    const r = (db as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: never }>>)[bucket][id];
    return { title: r.name, description: r.description ?? '', descRefs: r.descRefs, key: bucket };
  };

  it('an old title-only pin opens its record\'s page, unpins from the new star, and a load writes 0 times', async () => {
    const legacy = old('caustic-nectar');
    expect(Object.keys(legacy).sort(), 'the fixture is the pre-step-19 shape').toEqual(['descRefs', 'description', 'key', 'title']);
    const ch = withFeats(fighter, {}, 'caustic-nectar');
    const start: PlayState = { ...initialPlay(ch, db), pinnedDescs: [legacy] };
    const frozen = JSON.stringify(start.pinnedDescs);
    const seen = { play: start, writes: 0 };
    const m = await mount(sheet(ch, start, seen));
    try {
      await settle();
      expect(seen.writes, 'loading the sheet with an old pin wrote nothing').toBe(0);

      // An old pin stores no mode, so it reopens as the browse card it always opened as.
      const pop = await reopenFromPinned(m.host, 'Caustic Nectar');
      expect(pop.querySelector('.card-mine'), 'an old pin is not a \'mine\' card').toBeNull();
      expect(pageText(pop), 'the old pin re-resolves (key + title name one record) to its page').toBe(await browseText('feats', 'caustic-nectar'));
      expect(seen.writes, 'opening the old pin wrote nothing').toBe(0);
      expect(seen.play.pinnedDescs, 'the ledger still holds the very same pin list').toBe(start.pinnedDescs);
      expect(JSON.stringify(seen.play.pinnedDescs), 'the stored pin was never rewritten').toBe(frozen);
      await click(pop.querySelector('.picker-close'));

      // The NEW star (FeatDetail's card, whose node carries slug) reads the old pin as pinned and removes THAT pin.
      const star = (await openFeat(m.host, 'Caustic Nectar')).querySelector('.info-star');
      // batch card premise: feat-7612 "You have specialized glands inside your throat"
      expect(star?.getAttribute('aria-pressed'), 'the old pin reads as pinned on the new star').toBe('true');
      await click(star);
      expect(seen.writes).toBe(1);
      expect(seen.play.pinnedDescs, 'pressing it removed the old pin, and added none').toEqual([]);
    } finally { m.stop(); }
  });

  it('an old pin whose title names several records shows its stored snapshot, not the page its title slugs to', async () => {
    // A magus pinned "Weapon Expertise" before step 19: four class features carry that name.
    const snapshot = 'Synthesized snapshot words for an old Weapon Expertise pin.';
    const legacy: PinnedDesc = { title: 'Weapon Expertise', description: snapshot, key: 'classFeatures' };
    const magus = build('magus', 9);
    const start: PlayState = { ...initialPlay(magus, db), pinnedDescs: [legacy] };
    const seen = { play: start, writes: 0 };
    const m = await mount(sheet(magus, start, seen));
    try {
      const pop = await reopenFromPinned(m.host, 'Weapon Expertise');
      expect(pageText(pop), 'no page is guessed from the title').toBeNull();
      expect(txt(pop)).toContain(snapshot);
      // …and its star still matches the stored pin (legacy key:title) and unpins it.
      const star = pop.querySelector('.info-star');
      expect(star?.getAttribute('aria-pressed')).toBe('true');
      await click(star);
      expect(seen.writes).toBe(1);
      expect(seen.play.pinnedDescs ?? []).toEqual([]);
    } finally { m.stop(); }
  });

  it('the REAL app: loading a roster with an old pin and opening it schedules no persist and never rewrites the pin', async () => {
    // The 400 ms persist (src/data/persist.ts schedulePersist, App.tsx's roster effect). App writes the
    // roster it loaded once on mount whatever it holds (pre-existing, not a pin write); that write must
    // carry the old pin byte-identical, and opening the pin must schedule nothing at all.
    const legacy = old('caustic-nectar');
    const b = { ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'acolyte', classId: 'fighter', keyAbility: 'str' } as BuildState;
    const character = buildCharacter(b, db);
    const saved = { id: 'pins-c1', character, build: b, play: { ...initialPlay(character, db), pinnedDescs: [legacy] } };
    const seedPins = JSON.stringify(saved.play.pinnedDescs);
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved]));
    localStorage.setItem('wanderers-codex:active:v1', saved.id);
    const { default: App } = await import('../src/App');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<App />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    act(() => flushPersist());
    const rosterPins = () => JSON.stringify((JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]') as { play?: PlayState }[])[0]?.play?.pinnedDescs);
    expect(rosterPins(), 'the roster written on load carries the old pin unchanged').toBe(seedPins);

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const row = pinnedRow(host, 'Caustic Nectar');
      expect(row, 'the Main tab\'s Pinned list shows the old pin').toBeTruthy();
      await click(row!.querySelector('.pinned-desc-open'));
      expect(popup(host), 'the pin opened').toBeTruthy();
      expect(pageText(popup(host)!), 'the old pin re-resolved to its page').toBe(await browseText('feats', 'caustic-nectar'));
      await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
      expect(hasPendingPersist(), 'no persist is pending after opening the pin').toBe(false);
      act(() => flushPersist());
      expect(setItem.mock.calls.filter(([k]) => k === ROSTER_KEY), 'the roster was written 0 times').toHaveLength(0);
      expect(rosterPins()).toBe(seedPins);
    } finally {
      setItem.mockRestore();
      act(() => root.unmount());
      host.remove();
      localStorage.clear();
    }
  }, 180_000);
});

/*
 * The guard's ledger (scripts/lib/card-scope.mjs, card-truth-check's 'pin' rows) reads a stored pin the way
 * MainTab's PinnedDescCard does: its mirror of play.ts pinForRead / samePin must agree with them on every
 * shape a pin can have, and a star's node, stored through pinOf, must be the node the ledger models.
 */
describe('card step 19: the ledger\'s pin model reads a pin as play.ts does', () => {
  const pins: PinnedDesc[] = [
    { title: 'Caustic Nectar (Acid)', description: '', key: 'feats', slug: 'caustic-nectar', mode: 'mine' },
    { title: 'Caustic Nectar', description: '', key: 'feats' },
    { title: 'Caustic Nectar (Acid)', description: '', key: 'feats' },
    { title: 'Zombie Horde', description: '', key: 'feats' },
    { title: 'Zombie Horde', description: '', key: 'feats', slug: 'zombie-horde-impossible-magic' },
    { title: 'Weapon Expertise', description: '', key: 'classFeatures' },
    { title: 'Weapon Expertise', description: '', key: 'classFeatures', slug: 'weapon-expertise-magus' },
    { title: 'Gutsy Halfling', description: '', key: 'heritages' },
    { title: 'Caustic Nectar', description: '' },
    // Both know their id: the same record under another pick, and another record of the same name.
    { title: 'Caustic Nectar (Fire)', description: '', key: 'feats', slug: 'caustic-nectar', mode: 'mine' },
    { title: 'Weapon Expertise', description: '', key: 'classFeatures', slug: 'weapon-expertise' },
  ];

  it('pinReadOf equals pinForRead, and samePinModel equals samePin, on new pins, old title-only pins, twinned names and a pick in the title', () => {
    for (const p of pins) {
      const r = pinForRead(p, db);
      expect(lib.pinReadOf(p, db), `${p.key}:${p.title}${p.slug ? ` (${p.slug})` : ''}`).toEqual({ bucket: r.key ?? '', slug: r.slug });
    }
    // The cases the identity rules turn on, read off play.ts itself so the mirror cannot agree vacuously.
    expect(pinForRead(pins[1], db).slug, 'an old pin whose title names one record resolves to it').toBe('caustic-nectar');
    expect(pinForRead(pins[3], db).slug, 'an old pin whose title names two records resolves to none').toBe('');
    expect(pinForRead(pins[2], db).slug, 'an old pin whose title carries a pick resolves to none').toBe('');
    expect(samePin(pins[0], pins[9]), 'one record under two picks is one pin').toBe(true);
    expect(samePin(pins[6], pins[10]), 'two records of one name are two pins').toBe(false);
    expect(samePin(pins[1], pins[0]), 'an old pin matches the new pin of its record only by its own title').toBe(false);
    expect(samePin(pins[5], pins[6]), 'an old pin matches a new pin of the same key:title').toBe(true);
    for (const a of pins) for (const b of pins) expect(lib.samePinModel(a, b), `${a.title}/${a.slug} vs ${b.title}/${b.slug}`).toBe(samePin(a, b));
  });

  it('each star\'s stored node is the one the ledger models: the record id and, from the sheet, mode \'mine\'', () => {
    const feat = featEntries(withFeats(fighter, {}, 'caustic-nectar'), db).find((e) => e.featId === 'caustic-nectar')!;
    // FeatDetail's star node, stored through pinOf as the sheet stores it.
    const stored = pinOf(featPinNode(feat));
    const modelled = lib.pinStarNode('feats', 'caustic-nectar', db.feats['caustic-nectar']);
    expect({ key: stored.key, slug: stored.slug, mode: stored.mode }).toEqual({ key: modelled.key, slug: modelled.slug, mode: modelled.mode });
    expect(lib.pinReadOf(stored, db)).toEqual({ bucket: 'feats', slug: 'caustic-nectar' });
    // The Spells tab's star stores no mode: the ledger models a spell pin as the browse card.
    expect(lib.pinStarNode('spells', 'discomfiting-whispers', db.spells['discomfiting-whispers'])).toEqual({ title: db.spells['discomfiting-whispers'].name, key: 'spells', slug: 'discomfiting-whispers' });
  });
});
