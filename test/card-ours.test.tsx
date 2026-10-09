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
import { FeatsTab, featEntries } from '../src/sheet/FeatsTab';
import type { FeatPinNode } from '../src/sheet/FeatDetail';
import { applyOverrides } from '../src/rules/build';
import { togglePinnedDesc, type PlayState } from '../src/rules/play';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { recordTree } from '../src/sheet/astVisibility';
import type { Character, ContentDatabase, Feat } from '../src/rules/types';

/**
 * Card step 8 (docs/card-design.md section 4 and row F2; section 9 row 8): OUR LINES REACH THE POPUP.
 *
 * FeatsTab's featEntries used to append the player's pick ("Your choice: …"), another record's marker
 * (principles A / C) and the record's own note to the row's description as HTML. On a record with an
 * Archives page DescBody draws the page and discards that string, so 90 of the 91 record notes never
 * reached the popup; on a markdown body one appended `<p>` flipped DescBody into its rich-HTML lane, so a
 * table printed as raw `| --- |` (the kineticist gates once a junction was picked, T3). Now every one of
 * them is an OURS LINE, drawn by FeatDetail in one box marked `data-ours` after the body, on both lanes.
 *
 * Every case renders the REAL components — FeatsTab, its row click, FeatDetail, its PinStar — over the
 * shipped page trees (public/ast/*.json.gz, served through a fetch stub), for characters synthesized
 * through build() (name 't'); none is the owner's.
 *
 * MUTATION LINES (each measured red on 2026-10-06 under scripts/vt.mjs, then the file restored from the
 * scratch copy, sha1 checked):
 *  - FeatDetail.tsx: `<OursBox lines={ours.box} />` disabled → 6 of 8 red here (Bloodline, Air Gate,
 *    caustic-nectar, Reliable Luck, override, enhancement) and 2 in test/batch001-surfaces.test.tsx.
 *  - OursBox.tsx: `data-ours=""` on the box deleted → the same 6 red.
 *  - FeatsTab.tsx search: `oursSearchText(e)` dropped from the filter → the search case red.
 *  - FeatsTab.tsx choice rows: the junction pick appended to the description as `<p><strong>Your
 *    choice:</strong> …</p>` (the old concatenation) → the Air Gate case red: "| Air Gate Junction |
 *    | --- | | **Cri…" on screen (T3 reproduced).
 *  - FeatDetail.tsx featOursSplit: the `!!page.ast` condition on `override` dropped → the override case
 *    red (the no-page popup drew the edited text twice).
 *  - FeatDetail.tsx: `<OursUseLines …/>` replaced by a print-styled `.sd-stats` row → the homebrew case red.
 *  - FeatDetail.tsx featStatRows: `&& entry.ours === undefined` dropped → the enhancement case red (the
 *    Enhancement stat row came back).
 *  - (fixer round 1) FeatDetail.tsx featPinNode `description: pinDescriptionOf(entry)` →
 *    `entry.description` → the Bloodline case and the no-page pin case red (the reopened
 *    dedication-to-the-five pin lost "Note: …", the HEAD regression the refuter measured).
 *  - (fixer round 1) FeatDetail.tsx pinDescriptionOf: `if (PIN_HTML_TAG.test(…))` → `if (true)` (every
 *    pin gets `<p>` lines, the old concatenation) → the no-page pin case red on the Air Gate description.
 *  - (fixer round 2) FeatsTab.tsx usesRetune: the `unlimited` branch returns [] → the Eternal Wings case
 *    red; the maxByLevel branch returns [] → the Fulu Familiar case red.
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
/** One stored tree, for recordTree (src/sheet/astVisibility.ts): the tree the card reads, slice or own page. */
const readTree = (b: string, s: string): AstNode | undefined => treeOf(b)?.[s];

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, cdb: ContentDatabase = db, pin: PinDescApi | null = null): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={cdb}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
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

/** FeatsTab for a character, with the popup of the row named `name` opened by clicking it. */
async function openRow(ch: Character, name: string, cdb: ContentDatabase = db, pin: PinDescApi | null = null) {
  const m = await mount(<FeatsTab character={ch} content={cdb} />, cdb, pin);
  const row = [...m.host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
  // batch card: #card-NOT-VACUOUS — the case measures something
  expect(row, `FeatsTab lists a row named ${name}`).toBeTruthy();
  await click(row);
  const pop = m.host.querySelector('.picker.spell-detail');
  expect(pop, `${name}: the popup opened`).toBeTruthy();
  return { ...m, pop: pop!, ours: txt(pop!.querySelector('.card-ours[data-ours]')), body: pop!.querySelector('.sd-body > .sd-desc') };
}

/** A pin as the Main-tab Pinned list reopens it: the node stored by play.ts togglePinnedDesc (which keeps
 *  title / description / descRefs / key), opened in DescriptionModal exactly as MainTab does. */
async function reopenPin(node: FeatPinNode) {
  const stored = togglePinnedDesc({} as PlayState, node).pinnedDescs![0];
  return mount(<DescriptionModal root={stored} onClose={noop} />);
}

let base: Character;
const withFeats = (ch: Character, ...featIds: string[]): Character => ({
  ...ch,
  feats: featIds.map((featId) => ({ featId, level: db.feats[featId]?.level ?? 1, source: 'class' as const })),
} as Character);

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
  for (const b of ['feats', 'classFeatures', 'heritages']) await loadBucketAst(b);
  base = build('fighter', 20);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

/**
 * FeatsTab for a character with the row named `name` clicked, read off the 'mine' card it opens (card step
 * 11): `page` = the page lane (.ast-modal) or the no-page lane (.picker.info-modal); `own` = the record's
 * own words on screen (the page body or the old text) with every node of ours taken out; `ours` = the box.
 */
async function openCard(ch: Character, name: string, cdb: ContentDatabase = db, pin: PinDescApi | null = null) {
  const m = await mount(<FeatsTab character={ch} content={cdb} />, cdb, pin);
  const row = [...m.host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
  // batch card: #card-NOT-VACUOUS — the row the case drives exists
  expect(row, `FeatsTab lists a row named ${name}`).toBeTruthy();
  await click(row);
  const card = m.host.querySelector('.card-mine') as HTMLElement | null;
  expect(card, `${name}: the row opened its mine card`).toBeTruthy();
  const page = card!.matches('.ast-modal');
  const ownEl = card!.querySelector(page ? '.ast-pop > .ast-body' : '.info-body .sd-desc');
  const ownCopy = ownEl?.cloneNode(true) as HTMLElement | undefined;
  ownCopy?.querySelectorAll('[data-ours]').forEach((e) => e.remove());
  return {
    ...m, card: card!, page, ownEl, own: txt(ownCopy),
    ours: txt(card!.querySelector('.card-ours[data-ours]')),
    star: card!.querySelector(page ? '.ast-head .info-star' : '.picker-head .info-star'),
  };
}

// Card step 11: the ours lines on the card the row opens (card step 22 removed the legacy popup's block). test/card-feat.test.tsx
// proves the Bloodline marker, the Reliable Luck retune, an Overrides edit over a page, the enhancement tier,
// Caustic Nectar's note and the first homebrew case on the card; this block proves the rest of step 8's cases.
// batch card premise: feat-5544 "Frequency once per day"
describe('card step 11: the ours box on the Feats-tab card', () => {
  // batch card premise: feat-1810 "You gain your blood magic effect when you cast a non-cantrip spell you gained from a heritage or an ancestry feat"
  it('Bloodline: the star\'s node carries the marker (and the stored-pin bridge its words); without the feat, no marker anywhere on the card', async () => {
    let pinned: FeatPinNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
    const v = await openCard(withFeats(build('sorcerer', 3), 'ancestral-blood-magic'), 'Bloodline', db, pin);
    // batch card premise: feat-1810 "a heritage or an ancestry feat"
    expect(v.page, 'the Bloodline card draws its Archives page').toBe(true);
    expect(v.ours.match(/Ancestral Blood Magic/g)).toHaveLength(1);
    expect(v.own).not.toContain('Ancestral Blood Magic');
    await click(v.star);
    const mark = pinned!.ours?.find((l) => l.kind === 'mark');
    // batch card premise: feat-1810 "a heritage or an ancestry feat"
    expect(mark?.from).toEqual({ bucket: 'feats', id: 'ancestral-blood-magic', name: 'Ancestral Blood Magic' });
    expect(pinned!.description).toContain(`Ancestral Blood Magic: ${mark!.text}`);
    v.stop();
    const w = await openCard(build('sorcerer', 3), 'Bloodline');
    // batch card premise: feat-1810 "a heritage or an ancestry feat"
    expect(txt(w.card)).not.toContain('Ancestral Blood Magic');
    w.stop();
  });

  // batch card premise: element-1 "Gate Junction"
  it('Air Gate with a junction picked (kineticist 5): its run of the Air element page with every junction of the old table, the pick in the box', async () => {
    const gate = db.classes.kineticist.extraChoices?.find((g) => g.options?.some((o) => o.id === 'air-gate'));
    const choice = (db.classFeatures['air-gate'] as { effectChoices?: { id: string; options: { label: string; note?: string }[] }[] }).effectChoices![0];
    const ch0 = build('kineticist', 5, { extraChoices: { [gate!.id]: ['air-gate'] } } as never);
    const opt = choice.options[0];
    const ch = { ...ch0, effectPicks: [...(ch0.effectPicks ?? []), { recordId: 'air-gate', choiceId: choice.id, label: opt.label, note: opt.note }] } as Character;
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'air-gate' || e.featureId === 'air-gate');
    // batch card premise: element-1 "Gate Junction"
    expect(entry, 'a kineticist with the Air gate lists an Air Gate row').toBeTruthy();
    const v = await openCard(ch, entry!.name);
    expect(v.page, 'Air Gate reads its slice of the Air element page').toBe(true);
    expect(v.ownEl?.querySelector('table'), 'the Archives page prints no table for the gate').toBeNull();
    expect(v.own).not.toMatch(/\|\s*-{3}/);
    expect(v.own).not.toContain('**');
    // batch card premise: element-1 "Before or after the other effects of the impulse, you can either Stride up to half your Speed or Step"
    expect(v.own).toContain('Impulse Junction (Single Gate)');
    const rows = String(db.classFeatures['air-gate'].description ?? '').split('\n')
      .map((l) => /^\|\s*\*\*(.+?)\*\*\s*(.*?)\s*\|$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m);
    // batch card premise: element-1 "Gate Junction"
    expect(rows.length, 'the old table\'s junction rows').toBe(5);
    for (const [, label, words] of rows) {
      expect(v.own, `the card keeps "${label}"`).toContain(label);
      expect(v.own, `the card keeps the words of "${label}"`).toContain(words.replace(/\.$/, ''));
    }
    // batch card premise: element-1 "Gate Junction"
    expect(v.own).not.toContain('pre-filtered list');
    expect(v.ours).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    v.stop();
  });

  // batch card: #card-N2 — a note is ours, in the box
  it('a record with NO page: the no-page card draws the note in the box, the star\'s pin keeps it when reopened, and a no-page table with a pick stays a table', async () => {
    const id = 'dedication-to-the-five';
    const note = db.feats[id].note!;
    // batch card: #card-S7 — no page: our text, marked
    expect(recordTree('feats', id, readTree), `${id} reads no tree (no page, no slice)`).toBeUndefined();
    let pinned: FeatPinNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
    const v = await openCard(withFeats(base, id), db.feats[id].name, db, pin);
    // batch card: #card-N2 — a note is ours, never in the record's own text
    expect(v.page, 'the no-page lane').toBe(false);
    expect(v.ours).toContain(`Note: ${note}`);
    expect(v.own, 'never inside the record\'s own text').not.toContain(note);
    // batch card: #card-PIN — the reopened pin keeps the note
    await click(v.star);
    v.stop();
    const r = await reopenPin(pinned!);
    expect(r.host.querySelector('.ast-body'), 'the reopened pin has no page either').toBeNull();
    expect(txt(r.host)).toContain(`Note: ${note}`);
    r.stop();
    // The synthesized no-page record with a markdown table (the legacy case above says why it is synthesized).
    // batch card premise: element-1 "Gate Junction"
    const tid = 't-card-step11-no-page-table';
    const table = '| T Gate Junction |\n| --- |\n| **Critical Blast** Synthesized blast words. |\n| **Skill Junction** Athletics |';
    const tdb = { ...db, feats: { ...db.feats, [tid]: { ...db.feats[id], id: tid, name: 'T No Page Table', description: table, note: undefined, descRefs: undefined } } } as ContentDatabase;
    const opt = { label: 'T Junction', note: 'synthesized junction note' };
    const ch = { ...withFeats(base, tid), effectPicks: [{ recordId: tid, choiceId: 't-junction', label: opt.label, note: opt.note }] } as Character;
    const entry = featEntries(ch, tdb).find((e) => e.featId === tid)!;
    pinned = null;
    const w = await openCard(ch, entry.name, tdb, pin);
    // batch card: #card-N2 — the pick is ours, in the box
    expect(w.page, 'the card has no page').toBe(false);
    expect(w.ownEl?.querySelector('table'), 'the card draws its table as a table').toBeTruthy();
    expect(w.ours).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    await click(w.star);
    w.stop();
    // batch card: #card-PIN — the pin keeps the pick and the table
    expect(pinned!.description).not.toMatch(/<(p|strong|br|div)\b/i);
    expect(pinned!.description).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    const g = await reopenPin(pinned!);
    expect(g.host.querySelector('table'), 'its table is a table').toBeTruthy();
    expect(txt(g.host)).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    g.stop();
  });

  // batch card premise: feat-5544 "Frequency once per day"
  it('an Overrides content edit on a record with no page: the card\'s text IS the edit, with no second copy in the box; Cat\'s Luck alone has no retune line', async () => {
    const noPage = Object.keys(db.feats).filter((id) => !treeOf('feats')![id] && db.feats[id].description && !db.duplicateIds?.has(id) && !recordTree('feats', id, readTree)).sort()[0];
    // batch card premise: feat-5544 "Frequency once per day"
    expect(noPage, 'a feat with no page and no slice ships').toBeTruthy();
    const ch = { ...withFeats(base, noPage), overrides: { contentEdits: { feats: { [noPage]: { description: 'Synthesized override words.\n\nA second paragraph.' } } } } } as unknown as Character;
    const cdb = applyOverrides(db, ch.overrides);
    const v = await openCard(ch, featEntries(ch, cdb).find((e) => e.featId === noPage)!.name, cdb);
    expect(v.page, `${noPage}: no page`).toBe(false);
    // batch card premise: feat-5544 "Frequency once per day"
    expect(v.own).toContain('Synthesized override words');
    expect(v.card.querySelector('.card-ours-override'), 'no second copy in the box').toBeNull();
    v.stop();
    const w = await openCard(withFeats(base, 'cats-luck'), "Cat's Luck");
    // batch card premise: feat-5544 "Frequency once per day"
    expect(w.page).toBe(true);
    expect(w.card.querySelector('.card-ours-usesRetune')).toBeNull();
    w.stop();
  });

  // batch card: #card-PRINTED-SET — a label the text prints is not drawn again as our use line
  it('a homebrew feat whose own text prints a Trigger: only the label it does not print (Frequency) is drawn as our use line', async () => {
    const hb = {
      id: 'hb-card-step11-b', name: 'Synthesized Homebrew B', level: 1, traits: ['general'], rarity: 'common', category: 'general',
      description: '**Trigger** Y happens\n\nA homebrew body.', trigger: 'X happens', frequency: 'once per day', source: { book: 'Homebrew', license: 'homebrew' },
    } as unknown as Feat;
    const cdb = { ...db, feats: { ...db.feats, [hb.id]: hb } } as ContentDatabase;
    const v = await openCard(withFeats(base, hb.id), hb.name, cdb);
    // batch card: #card-PRINTED-SET — a label the text prints is not drawn again as our use line
    expect(v.page).toBe(false);
    expect([...v.card.querySelectorAll('.card-ours-useLine')].map(txt)).toEqual(['Frequency once per day']);
    v.stop();
  });

  // batch card premise: feat-4566 "You gain the effects of Divine Wings at all times, rather than just once per day for 10 minutes"
  it('Eternal Wings on Divine Wings, and Fulu Familiar at 20 (maxByLevel): each retune is an ours line in the card\'s box; none without the upgrade / at level 6', async () => {
    const wings = db.feats['divine-wings'].name;
    const v = await openCard(withFeats(base, 'divine-wings', 'eternal-wings'), wings);
    // batch card premise: feat-4566 "You gain the effects of Divine Wings at all times, rather than just once per day for 10 minutes"
    expect(txt(v.card.querySelector('.card-ours[data-ours] .card-ours-usesRetune'))).toBe(`${db.feats['eternal-wings'].name}: removes this limit; there is no use counter.`);
    v.stop();
    const w = await openCard(withFeats(base, 'divine-wings'), wings);
    expect(w.card.querySelector('.card-ours-usesRetune')).toBeNull();
    w.stop();
    // batch card premise: feat-7097 "You can imprint your familiar’s spiritual essence"
    const fulu = db.feats['fulu-familiar'].name;
    const f = await openCard(withFeats(base, 'fulu-familiar'), fulu);
    expect(txt(f.card.querySelector('.card-ours[data-ours] .card-ours-usesRetune'))).toBe('At your level (20): 3/day; your use counter follows it.');
    f.stop();
    // batch card premise: feat-7097 "You can imprint your familiar’s spiritual essence"
    const g = await openCard(withFeats(build('fighter', 6), 'fulu-familiar'), fulu);
    expect(g.card.querySelector('.card-ours-usesRetune')).toBeNull();
    g.stop();
  });

  // The Feats-tab search reads the rows, not the popup; with the switch on it still finds a pick note.
  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  it('a search for a pick note finds the row, and the row preview keeps the pick words', async () => {
    const ch = { ...withFeats(base, 'caustic-nectar', 'toughness'), effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid', note: 'zebrafish marker words' }] } as Character;
    const m = await mount(<FeatsTab character={ch} content={db} />);
    const input = m.host.querySelector('.ff-bar .search input') as HTMLInputElement;
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect(input, 'the Feats-tab search box').toBeTruthy();
    const preview = [...m.host.querySelectorAll('.ff-row')].find((r) => /Caustic Nectar/.test(txt(r.querySelector('.ff-name'))))?.querySelector('.ff-desc');
    expect(txt(preview)).toContain('Your choice: Acid — zebrafish marker words');
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, 'zebrafish');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect([...m.host.querySelectorAll('.ff-row .ff-name')].map(txt)).toEqual(['Caustic Nectar (Acid)']);
    m.stop();
  });
});
