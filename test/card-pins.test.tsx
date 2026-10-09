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
import { applyPlayState, initialPlay, pinForRead, pinOf, samePin, togglePinnedDesc, type PlayState, type PlayUpdater } from '../src/rules/play';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { PinnedDescCard } from '../src/sheet/MainTab';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { InfoTerm } from '../src/sheet/InfoTerm';
import { ChoiceDetails } from '../src/builder/shared';
import { classFeatureDescription } from '../src/rules/featureText';
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
  // batch card: #card-NOT-VACUOUS — the control a case clicks exists
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
  // batch card: #card-NOT-VACUOUS — the Feats tab lists the row the case pins
  expect(row, `the Feats tab lists a row named ${name}`).toBeTruthy();
  await click(row);
  const pop = featCard(host);
  // batch card: #card-NOT-VACUOUS — the row opened its FeatDetail card, the popup the case drives
  expect(pop, `${name}: FeatDetail opened (the 'mine' card)`).toBeTruthy();
  await click(pop!.querySelector('.info-star'));
  await click(pop!.querySelector('.picker-close'));
}
/** Feats tab → the row named `name` → its FeatDetail popup, left open. */
async function openFeat(host: HTMLElement, name: string) {
  await click(tab(host, 'Feats & features'));
  const row = [...host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
  // batch card: #card-NOT-VACUOUS — the Feats tab lists the row the case opens
  expect(row, `the Feats tab lists a row named ${name}`).toBeTruthy();
  await click(row);
  const pop = featCard(host);
  // batch card: #card-NOT-VACUOUS — the row opened its FeatDetail card, the popup the case drives
  expect(pop, `${name}: FeatDetail opened (the 'mine' card)`).toBeTruthy();
  return pop!;
}
/** Main tab → the Pinned row titled `title` → its popup. */
async function reopenFromPinned(host: HTMLElement, title: string) {
  await click(tab(host, 'Main'));
  const row = pinnedRow(host, title);
  // batch card: #card-NOT-VACUOUS — the Pinned list shows the row and its popup opens
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
  // batch card: #card-PIN — a pin made from the sheet reopens its own record's page, with its box
  it('"Caustic Nectar (Acid)" pinned from FeatDetail reopens from the Pinned list as caustic-nectar\'s own page, with its box (the pick)', async () => {
    // A synthesized pick WITH a note: FeatsTab withPicks turns a noted pick into the 'choice' ours line.
    const pickNote = 'synthesized pick note for card step 19';
    const ch = withFeats(fighter, { effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid', note: pickNote }] } as Partial<Character>, 'caustic-nectar');
    const entry = featEntries(ch, db).find((e) => e.featId === 'caustic-nectar');
    // batch card: #card-NOT-VACUOUS — the row is caustic-nectar under its pick and carries the pick as an ours line
    expect(entry?.name).toBe('Caustic Nectar (Acid)');
    const choice = entry!.ours?.find((l) => l.kind === 'choice');
    expect(choice, 'the row carries its pick as an ours line').toBeTruthy();
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, 'Caustic Nectar (Acid)');
      // batch card: #card-PIN — one write stores the record {feats, caustic-nectar}, its title, mode 'mine' and its pick line
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
      // batch card: #card-N2 — the reopened card draws its ours box: the pick and the record's note, marked ours
      expect(box, 'the reopened card draws the ours box').toBeTruthy();
      expect(txt(box)).toContain(`Your choice: Acid — ${pickNote}`);
      expect(txt(box)).toContain(`Note: ${db.feats['caustic-nectar'].note}`);
      // The box is ours, after the page's words, and its words are said once.
      const words = pop.querySelector('.ast-body')!;
      const prose = [...words.querySelectorAll('p')].find((p) => !p.closest('[data-ours]') && txt(p).includes('specialized glands'));
      // batch card premise: feat-7612 "You have specialized glands inside your throat"
      expect(prose, 'the page prose is drawn').toBeTruthy();
      // batch card: #card-ORDER — the ours box follows the page's words and says its pick once
      expect(prose!.compareDocumentPosition(box!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the box follows the page prose').toBeTruthy();
      expect(txt(pop).split(`Your choice: Acid — ${pickNote}`).length - 1).toBe(1);
      // batch card: #card-PIN — reopening a pin is a read: no write
      expect(seen.writes, 'reopening wrote nothing').toBe(1);

      // The reopened card's own star reads pinned, and pressing it unpins the record.
      const star = pop.querySelector('.info-star');
      // batch card: #card-PIN — the reopened card's star reads its own pin and removes it
      expect(star?.getAttribute('aria-pressed')).toBe('true');
      await click(star);
      expect(seen.play.pinnedDescs ?? []).toEqual([]);
    } finally { m.stop(); }
  });

  // batch card: #card-IDENTITY — a pin reopens its record by id, never by the page its name slugs to
  it('a pinned magus Weapon Expertise reopens weapon-expertise-magus by its id — not the page the name "Weapon Expertise" slugs to', async () => {
    const magus = build('magus', 9);
    const entry = featEntries(magus, db).find((e) => e.name === 'Weapon Expertise');
    // batch card: #card-NOT-VACUOUS — the magus lists the row, and its name names several class features
    expect(entry, 'a magus 9 lists Weapon Expertise').toBeTruthy();
    const named = Object.entries(db.classFeatures).filter(([, r]) => r.name === 'Weapon Expertise').map(([id]) => id);
    expect(named.length, 'the name "Weapon Expertise" names several class features').toBeGreaterThan(1);
    const seen = { play: initialPlay(magus, db), writes: 0 };
    const m = await mount(sheet(magus, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, 'Weapon Expertise');
      const stored = seen.play.pinnedDescs ?? [];
      // batch card: #card-IDENTITY — the pin stores the magus record's id; the two records draw different pages
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
  // batch card: #card-IDENTITY — a pin reopens its own record, not a namesake's page
  it('an Impossible Magic "Zombie Horde" pinned from the sheet reopens its own page, not the Clockwork Reanimator feat of the same name', async () => {
    const id = 'zombie-horde-impossible-magic';
    // batch card: #card-NOT-VACUOUS — two feats share the name, so the case measures identity
    expect(db.feats['zombie-horde'].name, 'two feats share the name').toBe(db.feats[id].name);
    const ch = withFeats(fighter, {}, id);
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, db.feats[id].name);
      // batch card: #card-IDENTITY — the pin stores the Impossible Magic id and reopens its page, not the namesake's
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
  // batch card: #card-PIN — the sheet star reads a pin by its record
  it('the sheet star reads a pin by its record: the same record under another pick reads pinned', async () => {
    const stored: PinnedDesc = { title: 'Caustic Nectar (Acid)', description: 'synthesized', key: 'feats', slug: 'caustic-nectar', mode: 'mine' };
    const ch = withFeats(fighter, { effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Fire' }] } as Partial<Character>, 'caustic-nectar');
    // batch card: #card-NOT-VACUOUS — the row is the same record under another pick
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

  // batch card: #card-IDENTITY — another record's pin of the same name is not this record's
  it('the sheet star does not read another record\'s pin of the same name as its own', async () => {
    const magus = build('magus', 9);
    const other = Object.keys(db.classFeatures).filter((id) => db.classFeatures[id]?.name === 'Weapon Expertise' && id !== 'weapon-expertise-magus').sort()[0];
    // batch card: #card-NOT-VACUOUS — another class feature carries the name
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

  // batch card: #card-S7 — a record with no page shows our words once, with no second box
  it('a pinned record with NO page says its note once when reopened — the stored words, no second box', async () => {
    // dedication-to-the-five: a noted feat with no page. Its stored description carries the box's words
    // (FeatDetail pinDescriptionOf, the step-8 bridge kept for older pins and devices), so the reopened
    // no-page card must not draw them a second time from the stored ours lines.
    const id = 'dedication-to-the-five';
    const note = db.feats[id].note!;
    // batch card: #card-NOT-VACUOUS — the fixture carries a note and has no page
    expect(note, `${id} carries a note`).toBeTruthy();
    expect(treeOf('feats')![id], `${id} has no page`).toBeUndefined();
    const ch = withFeats(fighter, {}, id);
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, db.feats[id].name);
      // batch card: #card-PIN — the pin stored its record's note line
      expect(seen.play.pinnedDescs?.[0]?.ours?.map((l) => l.kind), 'the pin stored the note line').toEqual(['note']);
      const pop = await reopenFromPinned(m.host, db.feats[id].name);
      // batch card: #card-S7 — no page: the mine card's no-page lane says the note once, with no second box
      expect(pageText(pop)).toBeNull();
      // Made from the sheet: the 'mine' card's no-page lane, which says it has no page once.
      expect(pop.querySelector('.picker.info-modal.card-mine'), 'the reopened pin is the \'mine\' card (no-page lane)').toBeTruthy();
      expect(txt(pop).split(`Note: ${note}`).length - 1, 'the note is on screen exactly once').toBe(1);
      expect(pop.querySelectorAll('.card-ours[data-ours]'), 'no second box of the stored ours lines').toHaveLength(0);
    } finally { m.stop(); }
  });

  // batch card: #card-Q1A — a pin reopens at the character's level, its later part folded
  it('a pin made from the sheet reopens as the \'mine\' card at the character\'s level: a Justice champion 5\'s cause row folds what it does not have yet', async () => {
    // Section 6: "A pin made from the sheet reopens as mine at the character's current level". MainTab's
    // PinnedDescCard passes mode 'mine' and scopeOfCharacter(character) for a pin stored with mode 'mine'.
    const ch = build('champion', 5, { subclassId: 'justice' } as never);
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'justice' || e.featureId === 'justice');
    // batch card: #card-NOT-VACUOUS — the Justice champion lists its cause row
    expect(entry, 'a Justice champion lists its cause row').toBeTruthy();
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await pinFromFeatsTab(m.host, entry!.name);
      const stored = seen.play.pinnedDescs ?? [];
      // batch card: #card-PIN — the pin stores {classFeatures, justice, mine} and reopens as the mine card
      expect({ key: stored[0]?.key, slug: stored[0]?.slug, mode: stored[0]?.mode }).toEqual({ key: 'classFeatures', slug: 'justice', mode: 'mine' });
      const pop = await reopenFromPinned(m.host, entry!.name);
      const modal = pop.querySelector('.ast-modal.card-mine');
      expect(modal, 'the reopened pin is the \'mine\' card').toBeTruthy();
      // cause-11 "Relentless Reaction" is a later level's part: folded, closed, its words inside the fold.
      const folds = [...modal!.querySelectorAll('details.card-fold')] as HTMLDetailsElement[];
      // batch card: #card-Q1A — one closed "At higher levels" fold holds the later part; the card is the champion's own
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
    // batch card: #card-R1 — the subclass popup opened, and it is Cloistered Cleric's record card
    expect(pop, 'the subclass popup opened').toBeTruthy();
    expect(pageText(pop), 'it is Cloistered Cleric\'s record card').toBe(await browseText('classFeatures', 'cloistered-cleric'));
    const saved = async () => {
      await click(pop.querySelector('.picker-close'));
      await click([...m.host.querySelectorAll<HTMLButtonElement>('button.b-create')].find((b) => txt(b) === 'Save changes'));
      for (let i = 0; i < 4 && anyButton('Save anyway'); i++) await click(anyButton('Save anyway'));
      // batch card: #card-NOT-VACUOUS — the Builder handed back the build the case reads
      expect(out, 'the Builder handed back its build').toBeTruthy();
      return out!;
    };
    return { m, star: () => pop.querySelector('.info-star'), saved };
  }

  // batch card: #card-IDENTITY — the Builder star stores {bucket, id} and matches a pin by its record
  it('a new pin stores {bucket, id}; a pin of another record sharing the name does not read as this one', async () => {
    const theirs: PinnedDesc = { title: 'Cloistered Cleric', description: 'synthesized', key: 'classFeatures', slug: 'synthesized-other-record' };
    const p = await builderPopup(cleric([theirs]));
    try {
      // batch card: #card-IDENTITY — another record's pin of the same name is not this one; the new pin keeps its id
      expect(p.star()?.getAttribute('aria-pressed'), 'another record\'s pin of the same name is not this record\'s').toBe('false');
      await click(p.star());
      expect(p.star()?.getAttribute('aria-pressed')).toBe('true');
      const pins = (await p.saved()).pinnedDescs ?? [];
      expect(pins.map((d) => ({ key: d.key, slug: d.slug, title: d.title })), 'the Builder stored the record id beside the other pin')
        .toEqual([{ key: 'classFeatures', slug: 'synthesized-other-record', title: 'Cloistered Cleric' }, { key: 'classFeatures', slug: 'cloistered-cleric', title: 'Cloistered Cleric' }]);
    } finally { p.m.stop(); }
  });

  // batch card: #card-PIN — a pin made in the Builder keeps the record it was made from
  it('a new pin made in the Builder keeps its record id (no field-by-field copy)', async () => {
    const p = await builderPopup(cleric([]));
    try {
      await click(p.star());
      const pins = (await p.saved()).pinnedDescs ?? [];
      // batch card: #card-PIN — the record id survives the Builder's store
      expect(pins).toHaveLength(1);
      expect(pins[0], 'the record id survives the Builder\'s store').toMatchObject({ key: 'classFeatures', slug: 'cloistered-cleric', title: 'Cloistered Cleric' });
    } finally { p.m.stop(); }
  });

  // batch card: #card-PIN — an old pin is re-resolved at read time: the Builder star reads it and removes it
  it('an old title-only pin in the build reads pinned on the Builder star and pressing it removes that pin', async () => {
    const legacy: PinnedDesc = { title: 'Cloistered Cleric', description: 'synthesized', key: 'classFeatures' };
    const p = await builderPopup(cleric([legacy]));
    try {
      // batch card: #card-PIN — the old pin reads pinned, and pressing it removes it and adds none
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

  // batch card: #card-PIN — an old pin is re-resolved at read time only and never written back
  it('an old title-only pin opens its record\'s page, unpins from the new star, and a load writes 0 times', async () => {
    const legacy = old('caustic-nectar');
    // batch card: #card-NOT-VACUOUS — the fixture is the pre-step-19 pin shape
    expect(Object.keys(legacy).sort(), 'the fixture is the pre-step-19 shape').toEqual(['descRefs', 'description', 'key', 'title']);
    const ch = withFeats(fighter, {}, 'caustic-nectar');
    const start: PlayState = { ...initialPlay(ch, db), pinnedDescs: [legacy] };
    const frozen = JSON.stringify(start.pinnedDescs);
    const seen = { play: start, writes: 0 };
    const m = await mount(sheet(ch, start, seen));
    try {
      await settle();
      // batch card: #card-PIN — loading the sheet with an old pin writes nothing
      expect(seen.writes, 'loading the sheet with an old pin wrote nothing').toBe(0);

      // An old pin stores no mode, so it reopens as the browse card it always opened as.
      const pop = await reopenFromPinned(m.host, 'Caustic Nectar');
      // batch card: #card-PIN — the old pin re-resolves to its record's browse page at read time
      expect(pop.querySelector('.card-mine'), 'an old pin is not a \'mine\' card').toBeNull();
      expect(pageText(pop), 'the old pin re-resolves (key + title name one record) to its page').toBe(await browseText('feats', 'caustic-nectar'));
      // batch card: #card-PIN — opening it writes nothing: the very same stored list, never rewritten
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

  // batch card: #card-PIN — an old pin whose title names several records shows its stored snapshot
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
      // batch card: #card-IDENTITY — no page is guessed from a name several records share; the stored snapshot shows
      expect(pageText(pop), 'no page is guessed from the title').toBeNull();
      expect(txt(pop)).toContain(snapshot);
      // …and its star still matches the stored pin (legacy key:title) and unpins it.
      const star = pop.querySelector('.info-star');
      expect(star?.getAttribute('aria-pressed')).toBe('true');
      await click(star);
      // batch card: #card-PIN — its star unpins the old pin with one write
      expect(seen.writes).toBe(1);
      expect(seen.play.pinnedDescs ?? []).toEqual([]);
    } finally { m.stop(); }
  });

  // batch card: #card-PIN — the real app never writes an old pin back
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
    // batch card: #card-PIN — the roster written on load carries the old pin unchanged
    expect(rosterPins(), 'the roster written on load carries the old pin unchanged').toBe(seedPins);

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const row = pinnedRow(host, 'Caustic Nectar');
      // batch card: #card-PIN — the old pin opens, re-resolves to its page and schedules no persist
      expect(row, 'the Main tab\'s Pinned list shows the old pin').toBeTruthy();
      await click(row!.querySelector('.pinned-desc-open'));
      expect(popup(host), 'the pin opened').toBeTruthy();
      expect(pageText(popup(host)!), 'the old pin re-resolved to its page').toBe(await browseText('feats', 'caustic-nectar'));
      await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
      expect(hasPendingPersist(), 'no persist is pending after opening the pin').toBe(false);
      act(() => flushPersist());
      // batch card: #card-PIN — the roster was written 0 times and still holds the old pin byte-identical
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
 * Polish round (docs/card-design.md section 6: "A pin made from the sheet reopens as mine at the
 * character's current level"; section 7: "new pins store bucket + id + mode"). The stars that stored no
 * mode — RecordCard's built-in star on the action card and on StatDetailModal's full text, and the Spells
 * tab's star — store mode 'mine' with {key, slug, title}, and MainTab's PinnedDescCard reopens each as the
 * SAME popup the record opens from its own tab, scoped to the character: the action / full-text record as
 * its 'mine' card, a spell as SpellDetail itself (the cast-at rank included). A pin made in browse mode
 * (search) keeps reopening as browse. Characters synthesized through build() (name 't').
 *
 * MUTATION LINES (polish lane, each measured red, then the file restored byte-exact from a scratch copy,
 * sha1 checked):
 *  - RecordCard.tsx pinNode `{ ...cur, mode: 'mine' }` → `cur` (the mode dropped) → the action-card and
 *    full-text cases red.
 *  - SpellsTab.tsx SpellDetail's PinStar node without `mode: 'mine'` → the Spells-tab case red.
 *  - MainTab.tsx PinnedDescCard `maxRank={character ? spellMaxRank(character) : undefined}` → `maxRank={undefined}`
 *    → the Spells-tab case red (the reopened body has no "Cast at 3rd").
 *  - MainTab.tsx PinnedDescCard `if (spell)` → `if (spell && false)` (the spell's mine card instead) → the
 *    Spells-tab case red.
 *  - RecordCard.tsx pinNode `mode === 'mine' && stack.length === 1` → `stack.length === 1` (a browse card's
 *    star stores 'mine') → the browse case red.
 *  - scripts/lib/card-scope.mjs pinStarNode back to "no mode for spells" → the ledger-model case below red.
 */
describe('polish round: every sheet star stores mode \'mine\' and its pin reopens as the record\'s own popup', () => {
  const seg = (host: HTMLElement, label: string) => [...host.querySelectorAll('.seg-btn')].find((b) => txt(b) === label);
  const stab = (host: HTMLElement, label: string) => [...host.querySelectorAll('.stab')].find((b) => txt(b) === label);
  /** Main tab → the action chip named `name`, in whichever mode / sub-tab lists it → its popup. */
  async function openAction(host: HTMLElement, name: string) {
    await click(tab(host, 'Main'));
    const chip = () => [...host.querySelectorAll('.action-chip')].find((c) => txt(c.querySelector('.action-chip-name')) === name);
    for (const mode of ['Encounter', 'Exploration', 'Downtime', 'Camping']) {
      const b = seg(host, mode);
      if (b) await click(b);
      for (const s of mode === 'Encounter' ? ['Actions', 'Skills', 'Items'] : ['']) {
        const t = s ? stab(host, s) : undefined;
        if (s && !t) continue;
        if (t) await click(t);
        if (chip()) { await click(chip()); return popup(host); }
      }
    }
    expect.fail(`the Main tab lists an action chip named ${name}`);
  }
  /** A stub pin API that keeps what togglePinnedDesc would store (pinOf), for a popup mounted on its own. */
  const recorder = () => {
    const out: { stored: PinnedDesc | null } = { stored: null };
    const api: PinDescApi = { has: () => false, toggle: (n) => { out.stored = togglePinnedDesc({} as PlayState, n).pinnedDescs?.[0] ?? null; } };
    return { out, api };
  };
  const shape = (p: PinnedDesc | null | undefined) => ({ key: p?.key, slug: p?.slug, title: p?.title, mode: p?.mode });

  // batch card: #card-PIN — the action card's star stores the record with mode 'mine'; the pin reopens as that card
  it('the action card\'s star stores {actions, seek, Seek, mine}; the pin reopens as Seek\'s own mine card', async () => {
    const ch = build('fighter', 3);
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      const pop = await openAction(m.host, 'Seek');
      const card = pop!.querySelector('.ast-modal.card-mine');
      // batch card: #card-R1 — the Seek chip opens its record's mine card, which has a page
      expect(card, 'the Seek chip opened its record\'s mine card').toBeTruthy();
      const own = pageText(pop!);
      expect(own, 'Seek has a page').toBeTruthy();
      // The card's built-in star (in its page header), not the action pin beside it (.pin-star).
      await click(card!.querySelector('.ast-head .info-star'));
      // batch card: #card-PIN — one pin stored {actions, seek, Seek, mine}; it reopens as the same mine card
      expect(seen.play.pinnedDescs ?? []).toHaveLength(1);
      expect(shape(seen.play.pinnedDescs?.[0])).toEqual({ key: 'actions', slug: 'seek', title: 'Seek', mode: 'mine' });
      await click(card!.querySelector('.picker-close'));
      const again = await reopenFromPinned(m.host, 'Seek');
      expect(again.querySelector('.ast-modal.card-mine'), 'the reopened pin is the mine card').toBeTruthy();
      expect(pageText(again), 'the action card\'s own body').toBe(own);
      const star = again.querySelector('.info-star');
      // batch card: #card-PIN — the reopened card's star reads its pin and unpins the record
      expect(star?.getAttribute('aria-pressed')).toBe('true');
      await click(star);
      expect(seen.play.pinnedDescs ?? [], 'pressing it unpinned the record').toEqual([]);
    } finally { m.stop(); }
  });

  // batch card: #card-PIN — the full-text star stores the record with mode 'mine'; the pin reopens as that card
  it('StatDetailModal\'s full-text star stores the record with mode \'mine\'; the pin reopens as that same mine card', async () => {
    const ch = build('fighter', 3);
    const id = 'halfling-luck';
    const { out, api } = recorder();
    const breakdown = { title: 'Stat', totalText: '+0', parts: [], timeline: [], situational: [{ text: 'a situational line', sourceId: id, sourceCollection: 'feats' as never }] };
    const m = await mount(<PinContext.Provider value={api}><StatDetailModal breakdown={breakdown} character={ch} content={db} onClose={noop} /></PinContext.Provider>);
    let own: string | null;
    try {
      await click(m.host.querySelector('.sd-sit-more'));
      const card = m.host.querySelector('.ast-modal.card-mine');
      // batch card: #card-R1 — the full text is the record's mine card; its star stores the record with mode 'mine'
      expect(card, 'the full text is the record\'s mine card').toBeTruthy();
      own = pageText(card!.parentElement!);
      expect(own, `${id} has a page`).toBeTruthy();
      await click(card!.querySelector('.info-star'));
      expect(shape(out.stored)).toEqual({ key: 'feats', slug: id, title: db.feats[id].name, mode: 'mine' });
    } finally { m.stop(); }
    const p = await mount(<PinnedDescCard pin={out.stored!} content={db} character={ch} onClose={noop} />);
    try {
      // batch card: #card-PIN — the pin reopens as the same mine card, with the same body
      expect(p.host.querySelector('.ast-modal.card-mine'), 'the reopened pin is the mine card').toBeTruthy();
      expect(pageText(p.host), 'the full text\'s own body').toBe(own);
    } finally { p.stop(); }
  });

  // batch card: #card-HEIGHTEN — the Spells-tab pin reopens as SpellDetail, heightened to the character's rank
  it('the Spells tab\'s star stores {spells, daze, Daze, mine}; the pin reopens as the Spells-tab popup itself, heightened to the character\'s rank', async () => {
    // A sorcerer 5 casts 3rd-rank spells: its cantrip Daze auto-heightens to 3rd ("Cast at 3rd").
    const ch = build('sorcerer', 5);
    // batch card: #card-NOT-VACUOUS — the synthesized sorcerer knows Daze
    expect(ch.spellcasting.find((e) => e.type === 'spontaneous')?.cantrips, 'the synthesized sorcerer knows Daze').toContain('daze');
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await click(tab(m.host, 'Spells'));
      await click([...m.host.querySelectorAll('.spell-card.clickable')].find((c) => txt(c.querySelector('.spell-name')) === 'Daze'));
      const pop = m.host.querySelector('.picker.spell-detail');
      // batch card: #card-HEIGHTEN — the Spells tab opens SpellDetail, cast at the sorcerer's 3rd rank
      expect(pop, 'the Spells tab opened SpellDetail').toBeTruthy();
      const body = txt(pop!.querySelector('.sd-body'));
      expect(txt(pop!.querySelector('.sd-rank-sel .sd-rank-lbl'))).toBe('Cast at');
      expect(txt(pop!.querySelector('.sd-rank-sel .sd-rank-chip.on')), 'the Spells-tab popup heightens Daze to the sorcerer\'s 3rd rank').toBe('3rd');
      await click(pop!.querySelector('.info-star'));
      // batch card: #card-PIN — the Spells-tab star stores {spells, daze, Daze, mine}
      expect(shape(seen.play.pinnedDescs?.[0])).toEqual({ key: 'spells', slug: 'daze', title: 'Daze', mode: 'mine' });
      await click(pop!.querySelector('.picker-close'));
      await reopenFromPinned(m.host, 'Daze');
      const again = m.host.querySelector('.picker.spell-detail');
      // batch card: #card-HEIGHTEN — the reopened spell pin is SpellDetail itself, with the same heightened body
      expect(again, 'the reopened spell pin is SpellDetail, the Spells tab\'s popup').toBeTruthy();
      expect(m.host.querySelector('.card-mine'), 'not the spell\'s mine card').toBeNull();
      expect(txt(again!.querySelector('.sd-body')), 'the same body as the Spells-tab popup').toBe(body);
      const star = again!.querySelector('.info-star');
      // batch card: #card-PIN — its star reads the pin and unpins the spell
      expect(star?.getAttribute('aria-pressed')).toBe('true');
      await click(star);
      expect(seen.play.pinnedDescs ?? [], 'pressing it unpinned the spell').toEqual([]);
    } finally { m.stop(); }
  });

  /*
   * Fixer round 2 (the must-fix): an `actions` pin made from the action card reopens as ActionDetailModal
   * itself — the action card — not a bare mine card of the record: the same ours box (actionOursLines), the
   * same skill label and the same cost glyph (ours, marked) in its header. Treat Wounds is the skill-tier
   * case (a fighter 3 trained in Medicine: "Your rank (trained): DC 15"); High Jump under Quick Jump is the
   * record-marker case (the marked one-action glyph and the Quick Jump note).
   * MUTATION LINES (each measured red, then MainTab.tsx restored byte-exact from a scratch copy, sha1 checked):
   *  - MainTab.tsx PinnedDescCard `if (action && character)` → `if (action && character && false)` (the
   *    reopened pin is the bare mine card: no ours box, no skill label) → this case red.
   *  - MainTab.tsx pinnedActionDetail `const def = ACTIVITIES.find(…)` → `const def = undefined` (the Act
   *    built without its curated row: no skill) → this case red.
   * Fixer round 3: the header's "Pin to top" toggle is compared too — Treat Wounds (exploration) and
   * Organize Watch (camping, Kingmaker on) draw none in the tab; High Jump (encounter) draws it, pinned to
   * the top first so its pressed state and label must follow the sheet's pin keys. MUTATION LINES (each
   * measured red, then MainTab.tsx restored byte-exact from a scratch copy, sha1 388a6358 checked):
   *  - pinnedActionDetail `pinnable: def.mode === 'encounter'` → `pinnable: true` → red (Treat Wounds).
   *  - pinnedActionDetail `def.mode === 'encounter'` → `def.mode !== 'encounter'` → red (Treat Wounds).
   *  - pinnedActionDetail `pinnable: !camping` → `pinnable: camping` → red (Organize Watch).
   *  - MainTab's PinnedDescCard call without `onPlay={onPlay} pinned={pinned}` → red (High Jump); without
   *    only `pinned={pinned}` → red (High Jump: drawn but not pressed).
   */
  // batch card: #card-N2 — the reopened action pin is the action card: its ours lines, skill label, marked glyph and toggle
  it('an action pin reopens as the action card itself: the same ours lines, skill label, cost glyph and Pin-to-top toggle as the Main tab\'s popup', async () => {
    const ch = { ...build('fighter', 3, { featPicks: { '2:skill': 'quick-jump' }, classSkills: ['medicine'] } as never), kingmakerEnabled: true };
    // batch card: #card-NOT-VACUOUS — the fighter is trained in Medicine and Organize Watch is a camping action
    expect(ch.proficiencies.skills?.medicine, 'the synthesized fighter is trained in Medicine').toBe('trained');
    expect(db.actions['organize-watch']?.traits, 'Organize Watch is a camping action').toContain('camping');
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    /** What the action card shows of ours: the box's lines, the header's skill label and cost glyph, and the
     *  header's "Pin to top" toggle (.pin-star: drawn or not; pressed or not, normalised — PinToggle carries
     *  no aria-pressed, so its `on` class stands in when the attribute is absent — and its label). */
    const oursOf = (pop: Element) => {
      const toggle = pop.querySelector('.ast-head .pin-star');
      return {
        lines: [...pop.querySelectorAll('.card-ours[data-ours] [data-ours-kind]')].map((l) => txt(l)),
        skill: txt(pop.querySelector('.ast-head .action-skill')),
        glyph: pop.querySelector('.ast-head .card-ours-cost[data-ours]')?.innerHTML ?? null,
        toggle: toggle ? { pressed: toggle.getAttribute('aria-pressed') ?? String(toggle.classList.contains('on')), label: toggle.getAttribute('aria-label') } : null,
      };
    };
    try {
      for (const [name, slug, want] of [
        // An exploration activity: the Main tab offers no "Pin to top" on it (pinnedActionDetail: encounter only).
        ['Treat Wounds', 'treat-wounds', { lines: ['Your rank (trained): DC 15'], skill: 'Medicine', toggle: false }],
        // The marker line opens with its record's name (OursBox: "Quick Jump: …"). An encounter activity:
        // the toggle is drawn.
        ['High Jump', 'high-jump', { from: 'Quick Jump:', skill: 'Athletics', toggle: true }],
        // A camping action (Kingmaker on): the Camping list's row — no skill, no ours lines, no toggle
        // (pinnedActionDetail's non-activity branch: pinnable only when it is not a camping action).
        ['Organize Watch', 'organize-watch', { lines: [], skill: '', toggle: false, camping: true }],
      ] as const) {
        const pop = await openAction(m.host, name);
        const card = pop!.querySelector('.ast-modal.card-mine');
        // batch card: #card-NOT-VACUOUS — the chip opened the action card the case reads
        expect(card, `${name}: the chip opened the action card`).toBeTruthy();
        // High Jump is pinned to the top first, so the reopened toggle must show the sheet's pin keys too
        // (pressed, "Unpin"), not only be drawn.
        if (want.toggle) {
          await click(card!.querySelector('.ast-head .pin-star'));
          // batch card: #card-NOT-VACUOUS — the toggle pinned the action to the top, so its pressed state is measured
          expect(card!.querySelector('.ast-head .pin-star')?.getAttribute('aria-label'), `${name}: the toggle pinned it to the top`).toBe('Unpin');
        }
        const fromTab = oursOf(pop!);
        // batch card: #card-N2 — the action card's ours box, skill label, marked cost glyph and toggle
        if ('lines' in want) expect(fromTab.lines, `${name}: the action card's ours box`).toEqual(want.lines);
        if ('from' in want) expect(fromTab.lines.some((l) => l.startsWith(want.from)), `${name}: the record marker's note is in the box`).toBe(true);
        expect(fromTab.skill, `${name}: the action card's skill label`).toBe(want.skill);
        if (!('camping' in want)) expect(fromTab.glyph, `${name}: the action card draws its cost glyph, marked ours`).toBeTruthy();
        expect(!!fromTab.toggle, `${name}: the Main tab's popup ${want.toggle ? 'draws' : 'draws no'} "Pin to top" toggle`).toBe(want.toggle);
        const own = pageText(pop!);
        await click(card!.querySelector('.ast-head .info-star'));
        // batch card: #card-PIN — the star stored {actions, slug, name, mine}
        expect(shape(seen.play.pinnedDescs?.at(-1))).toEqual({ key: 'actions', slug, title: name, mode: 'mine' });
        await click(card!.querySelector('.picker-close'));
        const again = await reopenFromPinned(m.host, name);
        // batch card: #card-R1 — the reopened pin is the action card: the same ours, the same page body
        expect(again.querySelector('.ast-modal.card-mine'), `${name}: the reopened pin is a mine card`).toBeTruthy();
        expect(oursOf(again), `${name}: the reopened pin is the action card — the same ours lines, skill label, cost glyph and "Pin to top" toggle`).toEqual(fromTab);
        expect(pageText(again), `${name}: the same page body`).toBe(own);
        await click(again.querySelector('.picker-close'));
      }
    } finally { m.stop(); }
  });

  /*
   * Section 6 ("A pin made from the sheet reopens as mine at the character's current level"): the Builder's
   * ChoiceDetails star (a granted row, with a build) and InfoTerm's mine card (the Details-tab terms) store
   * mode 'mine' with the record's {key, slug}, and the pin reopens as that record's mine card.
   * MUTATION LINES (each measured red, then the files restored byte-exact from scratch copies, sha1 checked):
   *  - MainTab.tsx PinnedDescCard `if (pin.mode === 'mine')` → `if (false)` (every pin reopens as browse) →
   *    both halves red ("the reopened pin is the mine card").
   *  - RecordCard.tsx pinNode → `cur`, with shared.tsx ChoiceDetailsModal's cardNode without `mode: 'mine'`
   *    → the ChoiceDetails half red; with InfoTerm.tsx mineTermPin's mark → `n` → the InfoTerm half red.
   */
  // batch card: #card-PIN — the ChoiceDetails and InfoTerm stars store mode 'mine'; each pin reopens as the mine card
  it('the Builder ChoiceDetails star and InfoTerm\'s mine card store mode \'mine\'; each pin reopens as the record\'s mine card', async () => {
    const cleric = build('cleric', 3, { subclassId: 'cloistered-cleric' });
    const cfId = 'second-doctrine-cloistered-cleric';
    const cf = db.classFeatures[cfId];
    const f3 = build('fighter', 3);
    const cases: { label: string; ch: Character; el: ReactElement; opener: string; want: { key: string; slug: string; title: string } }[] = [
      {
        label: 'ChoiceDetails',
        ch: cleric,
        el: <ChoiceDetails name={cf.name} flavor={classFeatureDescription(cf.description, 'cleric', db)} descRefs={cf.descRefs} bucket="classFeatures" id={cfId} character={cleric} />,
        opener: '.cc-det',
        want: { key: 'classFeatures', slug: cfId, title: cf.name },
      },
      {
        label: 'InfoTerm',
        ch: f3,
        el: <InfoTerm title={db.feats['halfling-luck'].name} description={db.feats['halfling-luck'].description} descKey="feats" descSlug="halfling-luck" mine={{ scope: scopeOfCharacter(f3) }}>term</InfoTerm>,
        opener: '.info-term',
        want: { key: 'feats', slug: 'halfling-luck', title: db.feats['halfling-luck'].name },
      },
    ];
    for (const c of cases) {
      const { out, api } = recorder();
      const m = await mount(<PinContext.Provider value={api}>{c.el}</PinContext.Provider>);
      let own: string | null;
      try {
        await click(m.host.querySelector(c.opener));
        const card = m.host.querySelector('.ast-modal.card-mine');
        // batch card: #card-R1 — the popup is the record's mine card, and the record has a page
        expect(card, `${c.label}: the popup is the record's mine card`).toBeTruthy();
        own = pageText(m.host);
        expect(own, `${c.label}: the record has a page`).toBeTruthy();
        await click(card!.querySelector('.ast-head .info-star'));
      } finally { m.stop(); }
      // batch card: #card-PIN — the star stored the record with mode 'mine'
      expect(shape(out.stored), `${c.label}: the star stored the record with mode 'mine'`).toEqual({ ...c.want, mode: 'mine' });
      const p = await mount(<PinnedDescCard pin={out.stored!} content={db} character={c.ch} onClose={noop} />);
      try {
        // batch card: #card-PIN — the pin reopens as the record's mine card, with the same page body
        expect(p.host.querySelector('.ast-modal.card-mine'), `${c.label}: the reopened pin is the mine card`).toBeTruthy();
        expect(pageText(p.host), `${c.label}: the same page body`).toBe(own);
      } finally { p.stop(); }
    }
  });

  // batch card: #card-PIN — a pin made in browse mode stores no mode and reopens as the browse card it was made from
  it('a pin made in browse mode (search) stores no mode and keeps reopening as the browse card', async () => {
    const ch = build('fighter', 3);
    const { out, api } = recorder();
    const m = await mount(<PinContext.Provider value={api}><RecordCard record={{ bucket: 'actions', id: 'seek' }} mode="browse" chrome="popup" onExit={noop} /></PinContext.Provider>);
    try {
      await click(m.host.querySelector('.ast-head .info-star'));
    } finally { m.stop(); }
    // batch card: #card-PIN — the browse star stored no mode; the pin reopens as the record's browse card
    expect(shape(out.stored)).toEqual({ key: 'actions', slug: 'seek', title: 'Seek', mode: undefined });
    const p = await mount(<PinnedDescCard pin={out.stored!} content={db} character={ch} onClose={noop} />);
    try {
      expect(p.host.querySelector('.card-mine'), 'a browse pin is not a mine card').toBeNull();
      expect(pageText(p.host), 'the browse card of the record').toBe(await browseText('actions', 'seek'));
    } finally { p.stop(); }
  });
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

  // batch card: #card-GUARD — the ledger's pin model computes what play.ts computes, on every pin shape
  it('pinReadOf equals pinForRead, and samePinModel equals samePin, on new pins, old title-only pins, twinned names and a pick in the title', () => {
    for (const p of pins) {
      const r = pinForRead(p, db);
      // batch card: #card-GUARD — the ledger's pinReadOf equals play.ts pinForRead
      expect(lib.pinReadOf(p, db), `${p.key}:${p.title}${p.slug ? ` (${p.slug})` : ''}`).toEqual({ bucket: r.key ?? '', slug: r.slug });
    }
    // The cases the identity rules turn on, read off play.ts itself so the mirror cannot agree vacuously.
    // batch card: #card-IDENTITY — an old pin resolves only when its title names exactly one record
    expect(pinForRead(pins[1], db).slug, 'an old pin whose title names one record resolves to it').toBe('caustic-nectar');
    expect(pinForRead(pins[3], db).slug, 'an old pin whose title names two records resolves to none').toBe('');
    expect(pinForRead(pins[2], db).slug, 'an old pin whose title carries a pick resolves to none').toBe('');
    // batch card: #card-PIN — one record under two picks is one pin, two records of one name are two, old pins match by key:title
    expect(samePin(pins[0], pins[9]), 'one record under two picks is one pin').toBe(true);
    expect(samePin(pins[6], pins[10]), 'two records of one name are two pins').toBe(false);
    expect(samePin(pins[1], pins[0]), 'an old pin matches the new pin of its record only by its own title').toBe(false);
    expect(samePin(pins[5], pins[6]), 'an old pin matches a new pin of the same key:title').toBe(true);
    for (const a of pins) for (const b of pins) expect(lib.samePinModel(a, b), `${a.title}/${a.slug} vs ${b.title}/${b.slug}`).toBe(samePin(a, b));
  });

  // batch card: #card-GUARD — each star's stored node is the node the ledger models
  it('each star\'s stored node is the one the ledger models: the record id and, from the sheet, mode \'mine\'', () => {
    const feat = featEntries(withFeats(fighter, {}, 'caustic-nectar'), db).find((e) => e.featId === 'caustic-nectar')!;
    // FeatDetail's star node, stored through pinOf as the sheet stores it.
    const stored = pinOf(featPinNode(feat));
    const modelled = lib.pinStarNode('feats', 'caustic-nectar', db.feats['caustic-nectar']);
    // batch card: #card-GUARD — FeatDetail's stored pin equals the ledger's model and reads back as its record
    expect({ key: stored.key, slug: stored.slug, mode: stored.mode }).toEqual({ key: modelled.key, slug: modelled.slug, mode: modelled.mode });
    expect(lib.pinReadOf(stored, db)).toEqual({ bucket: 'feats', slug: 'caustic-nectar' });
    // Polish round: the Spells tab's star stores mode 'mine' (SpellsTab SpellDetail), and so does the action
    // card's built-in star (RecordCard pinNode): the ledger models both pins as made from the sheet.
    // batch card: #card-GUARD — the ledger models the Spells-tab and action-card stars as pins made from the sheet
    expect(lib.pinStarNode('spells', 'discomfiting-whispers', db.spells['discomfiting-whispers'])).toEqual({ title: db.spells['discomfiting-whispers'].name, key: 'spells', slug: 'discomfiting-whispers', mode: 'mine' });
    expect(lib.pinStarNode('actions', 'seek', db.actions.seek)).toEqual({ title: 'Seek', key: 'actions', slug: 'seek', mode: 'mine' });
    // The pin rows built from this model (actions, the stat lines' records, spells as the spellDetail row)
    // are measured against the DOM by test/card-parity.test.tsx renderPin.
    expect(lib.pinReadOf(pinOf({ ...lib.pinStarNode('actions', 'seek', db.actions.seek), description: '' }), db)).toEqual({ bucket: 'actions', slug: 'seek' });
  });
});
