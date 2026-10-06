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
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** FeatsTab for a character, with the popup of the row named `name` opened by clicking it. */
async function openRow(ch: Character, name: string, cdb: ContentDatabase = db, pin: PinDescApi | null = null) {
  const m = await mount(<FeatsTab character={ch} content={cdb} />, cdb, pin);
  const row = [...m.host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
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

describe('card step 8: the ours box on FeatDetail', () => {
  it('sorcerer 3 with Ancestral Blood Magic: the Bloodline popup draws its page AND the marker inside [data-ours]; the star\'s node carries it', async () => {
    const ch = withFeats(build('sorcerer', 3), 'ancestral-blood-magic');
    let pinned: FeatPinNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
    const v = await openRow(ch, 'Bloodline', db, pin);
    expect(v.body?.querySelector('.ast-body'), 'the Bloodline popup draws its Archives page').toBeTruthy();
    expect(v.ours).toContain('Ancestral Blood Magic: ');
    expect(v.ours).toContain('heritage or an ancestry feat');
    expect(v.ours.match(/Ancestral Blood Magic/g)).toHaveLength(1);
    // Nothing of ours inside the page's own words.
    expect(txt(v.body)).not.toContain('Ancestral Blood Magic');
    await click(v.pop.querySelector('.picker-head .info-star'));
    expect(pinned, 'the star pinned a node').toBeTruthy();
    const mark = pinned!.ours?.find((l) => l.kind === 'mark');
    expect(mark?.from).toEqual({ bucket: 'feats', id: 'ancestral-blood-magic', name: 'Ancestral Blood Magic' });
    // The stored-pin bridge (FeatDetail pinDescriptionOf, until card step 19): the node's description
    // carries the box's words after the record's text, because the store keeps only the description.
    expect(pinned!.description).toContain(`Ancestral Blood Magic: ${mark!.text}`);
    v.stop();
    // NOT YET (card step 19): the REOPENED Bloodline pin. MEASURED 2026-10-06 through reopenPin below:
    // the stored pin {title 'Bloodline', key 'classFeatures'} reopens the classFeatures 'bloodline'
    // page by the slug of its title, with no [data-ours] box and no "Ancestral Blood Magic" — the store
    // drops `ours` and `slug` (play.ts:2235), and DescriptionModal hands RecordCard no `ours`. Those
    // files (types.ts PinnedDesc, play.ts togglePinnedDesc, descref.ts DescNode, DescriptionModal.tsx)
    // are outside step 8's; the reopened-pin half is owed by card step 19 (pin identity, synced shape).
    // A sorcerer without the feat: no marker anywhere in the popup.
    const w = await openRow(build('sorcerer', 3), 'Bloodline');
    expect(txt(w.pop)).not.toContain('Ancestral Blood Magic');
    w.stop();
  });

  it('Air Gate with a junction picked (kineticist 5): the gate\'s table renders as a table — no raw markdown — and the pick sits in the box', async () => {
    const gate = db.classes.kineticist.extraChoices?.find((g) => g.options?.some((o) => o.id === 'air-gate'));
    const choice = (db.classFeatures['air-gate'] as { effectChoices?: { id: string; options: { label: string; note?: string }[] }[] }).effectChoices![0];
    const ch0 = build('kineticist', 5, { extraChoices: { [gate!.id]: ['air-gate'] } } as never);
    const opt = choice.options[0];
    const ch = { ...ch0, effectPicks: [...(ch0.effectPicks ?? []), { recordId: 'air-gate', choiceId: choice.id, label: opt.label, note: opt.note }] } as Character;
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'air-gate' || e.featureId === 'air-gate');
    expect(entry, 'a kineticist with the Air gate lists an Air Gate row').toBeTruthy();
    expect(opt.note, 'the junction option carries a note').toBeTruthy();
    const v = await openRow(ch, entry!.name);
    const body = txt(v.body);
    expect(body.length, 'the body draws the gate text').toBeGreaterThan(40);
    expect(body).not.toMatch(/\|\s*-{3}/);
    expect(body).not.toContain('**');
    expect(v.body?.querySelector('table'), 'its table is a table').toBeTruthy();
    expect(v.ours).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    expect(entry!.description).not.toContain('Your choice');
    v.stop();
  });

  it('a pinned record with NO page keeps its pick / note when reopened from Pinned (dedication-to-the-five; Air Gate + junction stays a table)', async () => {
    // dedication-to-the-five: the one noted feat with no page. Before card step 8 its pin carried
    // "Note: …" in the stored description; the stored-pin bridge (pinDescriptionOf) keeps it there.
    const id = 'dedication-to-the-five';
    const note = db.feats[id].note!;
    expect(note, `${id} carries a note`).toBeTruthy();
    expect(treeOf('feats')![id], `${id} has no page`).toBeUndefined();
    let pinned: FeatPinNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
    const v = await openRow(withFeats(base, id), db.feats[id].name, db, pin);
    expect(v.ours, 'the popup draws the note in the box').toContain(`Note: ${note}`);
    expect(txt(v.body), 'never inside the record\'s own text').not.toContain(note);
    await click(v.pop.querySelector('.picker-head .info-star'));
    v.stop();
    const r = await reopenPin(pinned!);
    expect(r.host.querySelector('.ast-body'), 'the reopened pin has no page either').toBeNull();
    expect(txt(r.host)).toContain(`Note: ${note}`);
    r.stop();

    // Air Gate (no page, a markdown table) with a junction picked: the reopened pin carries the pick and
    // its table is still a table — the bridge adds markdown paragraphs, never the `<p>` that flipped the
    // lane (T3).
    const gate = db.classes.kineticist.extraChoices?.find((g) => g.options?.some((o) => o.id === 'air-gate'));
    const choice = (db.classFeatures['air-gate'] as { effectChoices?: { id: string; options: { label: string; note?: string }[] }[] }).effectChoices![0];
    const ch0 = build('kineticist', 5, { extraChoices: { [gate!.id]: ['air-gate'] } } as never);
    const opt = choice.options[0];
    const ch = { ...ch0, effectPicks: [...(ch0.effectPicks ?? []), { recordId: 'air-gate', choiceId: choice.id, label: opt.label, note: opt.note }] } as Character;
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'air-gate' || e.featureId === 'air-gate')!;
    pinned = null;
    const w = await openRow(ch, entry.name, db, pin);
    await click(w.pop.querySelector('.picker-head .info-star'));
    w.stop();
    // The stored description stays markdown: no HTML tag, so DescBody (the mine card's fallback lane,
    // RecordCard.tsx's DescBody call) cannot switch it to the rich-HTML lane. Today's browse reopen draws
    // through RichText and strips tags either way (measured 2026-10-06), so this line is the guard.
    expect(pinned!.description).not.toMatch(/<(p|strong|br|div)\b/i);
    expect(pinned!.description).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    const g = await reopenPin(pinned!);
    expect(g.host.querySelector('.ast-body'), 'Air Gate has no page').toBeNull();
    expect(g.host.querySelector('table'), 'its table is a table').toBeTruthy();
    expect(txt(g.host)).not.toMatch(/\|\s*-{3}/);
    expect(txt(g.host)).toContain(`Your choice: ${opt.label} — ${opt.note}`);
    g.stop();
  });

  it('Caustic Nectar: its own note is in the box, after the page', async () => {
    expect(db.feats['caustic-nectar'].note, 'caustic-nectar carries a note').toBeTruthy();
    const v = await openRow(withFeats(base, 'caustic-nectar'), 'Caustic Nectar');
    expect(v.body?.querySelector('.ast-body'), 'the page is drawn').toBeTruthy();
    expect(v.ours).toContain(`Note: ${db.feats['caustic-nectar'].note}`);
    // The box comes after the body.
    const box = v.pop.querySelector('.card-ours[data-ours]')!;
    expect(v.body!.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    v.stop();
  });

  it('Reliable Luck: Cat\'s Luck shows the use-counter retune as an ours line', async () => {
    const v = await openRow(withFeats(base, 'cats-luck', 'reliable-luck'), "Cat's Luck");
    expect(v.ours).toContain('Reliable Luck: changes this to 1/hour; your use counter follows it.');
    // MEASURED 2026-10-06, not asserted: today's FeatDetail still leaves the page's printed Frequency
    // (and Trigger) line off — the legacy hideMeta drop (DescBody → AstRenderer hideMeta); the body read
    // "You instinctively twist away from danger. Reroll …". The line returns in card step 11 (the
    // printed set), where this ours line then sits beside it.
    expect(v.body?.querySelector('.ast-body'), 'the page is drawn').toBeTruthy();
    v.stop();
    // Without Reliable Luck there is nothing to say.
    const w = await openRow(withFeats(base, 'cats-luck'), "Cat's Luck");
    expect(w.pop.querySelector('.card-ours-usesRetune')).toBeNull();
    w.stop();
  });

  it('an Overrides content edit: the page is drawn and "Your override" carries the edited text; with no page the body IS the edit', async () => {
    const edit = (id: string) => ({ contentEdits: { feats: { [id]: { description: 'Synthesized override words.\n\nA second paragraph.' } } } });
    const ch = { ...withFeats(base, 'caustic-nectar'), overrides: edit('caustic-nectar') } as unknown as Character;
    const cdb = applyOverrides(db, ch.overrides);
    const v = await openRow(ch, 'Caustic Nectar', cdb);
    expect(v.body?.querySelector('.ast-body'), 'the page is drawn').toBeTruthy();
    const line = v.pop.querySelector('.card-ours[data-ours] .card-ours-override');
    expect(line, 'the override line is in the box').toBeTruthy();
    expect(line!.textContent).toBe('Your override: Synthesized override words.\nA second paragraph.');
    expect(txt(v.body)).not.toContain('Synthesized override words');
    v.stop();

    const noPage = Object.keys(db.feats).filter((id) => !treeOf('feats')![id] && db.feats[id].description && !db.duplicateIds?.has(id)).sort()[0];
    expect(noPage, 'a feat with no page ships').toBeTruthy();
    const ch2 = { ...withFeats(base, noPage), overrides: edit(noPage) } as unknown as Character;
    const w = await openRow(ch2, featEntries(ch2, applyOverrides(db, ch2.overrides)).find((e) => e.featId === noPage)!.name, applyOverrides(db, ch2.overrides));
    expect(w.body?.querySelector('.ast-body'), `${noPage}: no page`).toBeNull();
    expect(txt(w.body)).toContain('Synthesized override words');
    expect(w.pop.querySelector('.card-ours-override'), 'no second copy in the box').toBeNull();
    w.stop();
  });

  it('a homebrew feat with a typed trigger shows "Trigger X happens" as OUR use line, never styled as print', async () => {
    const hb = (id: string, description: string) => ({
      id, name: `Synthesized Homebrew ${id.slice(-1)}`, level: 1, traits: ['general'], rarity: 'common', category: 'general',
      description, trigger: 'X happens', frequency: 'once per day', source: { book: 'Homebrew', license: 'homebrew' },
    }) as unknown as Feat;
    const cdb = { ...db, feats: { ...db.feats, 'hb-card-step8-a': hb('hb-card-step8-a', 'A homebrew body.'), 'hb-card-step8-b': hb('hb-card-step8-b', '**Trigger** Y happens\n\nA homebrew body.') } } as ContentDatabase;
    const v = await openRow(withFeats(base, 'hb-card-step8-a'), 'Synthesized Homebrew a', cdb);
    const lines = v.pop.querySelector('.card-uselines[data-ours]');
    expect(lines, 'the use lines are drawn, marked ours').toBeTruthy();
    const trig = [...lines!.querySelectorAll('.card-ours-useLine')].map(txt);
    expect(trig).toEqual(['Trigger X happens', 'Frequency once per day']);
    for (const p of lines!.querySelectorAll('p')) expect(p.classList.contains('sd-ours'), 'our voice (.sd-ours)').toBe(true);
    expect(v.pop.querySelector('.sd-stats'), 'not a print-styled stat row').toBeNull();
    // Above the body, where use lines go.
    expect(lines!.compareDocumentPosition(v.body!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    v.stop();
    // The record's own text prints a Trigger: that label is not drawn twice (Frequency still is).
    const w = await openRow(withFeats(base, 'hb-card-step8-b'), 'Synthesized Homebrew b', cdb);
    expect([...w.pop.querySelectorAll('.card-ours-useLine')].map(txt)).toEqual(['Frequency once per day']);
    w.stop();
  });

  it('a search for a pick note finds the row, and the row preview keeps the pick words', async () => {
    const ch = { ...withFeats(base, 'caustic-nectar', 'toughness'), effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid', note: 'zebrafish marker words' }] } as Character;
    const m = await mount(<FeatsTab character={ch} content={db} />);
    const input = m.host.querySelector('.ff-bar .search input') as HTMLInputElement;
    expect(input, 'the Feats-tab search box').toBeTruthy();
    const names = () => [...m.host.querySelectorAll('.ff-row .ff-name')].map(txt);
    const preview = [...m.host.querySelectorAll('.ff-row')].find((r) => /Caustic Nectar/.test(txt(r.querySelector('.ff-name'))))?.querySelector('.ff-desc');
    expect(txt(preview)).toContain('Your choice: Acid — zebrafish marker words');
    await act(async () => {
      // React tracks the value through the prototype's setter; set it there so onChange sees the edit.
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, 'zebrafish');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(names()).toEqual(['Caustic Nectar (Acid)']);
    m.stop();
  });

  it('the running enhancement tier is an ours line, out of the print-styled stat row', async () => {
    const ch = { ...withFeats(base, 'automaton-armament'), enhancements: [{ featId: 'automaton-armament', from: 'Lesser Augmentation' }] } as Character;
    const v = await openRow(ch, featEntries(ch, db).find((e) => e.featId === 'automaton-armament')!.name);
    expect(v.ours).toContain('Enhancement active — granted by Lesser Augmentation');
    expect([...v.pop.querySelectorAll('.sd-stat-k')].map(txt)).not.toContain('Enhancement');
    v.stop();
  });

  it('a feat that removes a use limit (Eternal Wings on Divine Wings) says so as an ours line', async () => {
    // usesRetune's `unlimited` branch (FeatsTab.tsx usesRetune). 3 shipped feats carry usesUpgrade
    // {unlimited: true}; eternal-wings targets divine-wings, whose limitedUses is 1/day.
    expect(db.feats['eternal-wings'].usesUpgrade).toEqual({ featId: 'divine-wings', unlimited: true });
    const name = db.feats['divine-wings'].name;
    const v = await openRow(withFeats(base, 'divine-wings', 'eternal-wings'), name);
    const line = v.pop.querySelector('.card-ours[data-ours] .card-ours-usesRetune');
    expect(line, 'the retune line is in the box').toBeTruthy();
    expect(txt(line)).toBe(`${db.feats['eternal-wings'].name}: removes this limit; there is no use counter.`);
    v.stop();
    // Divine Wings alone: its 1/day stands, nothing to say.
    const w = await openRow(withFeats(base, 'divine-wings'), name);
    expect(w.pop.querySelector('.card-ours-usesRetune')).toBeNull();
    w.stop();
  });

  it('a use count that grows with level (Fulu Familiar, maxByLevel) shows the count at the character\'s level', async () => {
    // usesRetune's maxByLevel branch: fulu-familiar is 1/day, 2 from level 12, 3 from level 18.
    expect(db.feats['fulu-familiar'].limitedUses?.maxByLevel).toEqual({ 12: 2, 18: 3 });
    const name = db.feats['fulu-familiar'].name;
    const v = await openRow(withFeats(base, 'fulu-familiar'), name);
    const line = v.pop.querySelector('.card-ours[data-ours] .card-ours-usesRetune');
    expect(line, 'the level line is in the box').toBeTruthy();
    expect(txt(line)).toBe('At your level (20): 3/day; your use counter follows it.');
    v.stop();
    // At level 6 the count is still the printed 1/day: no line.
    const w = await openRow(withFeats(build('fighter', 6), 'fulu-familiar'), name);
    expect(w.pop.querySelector('.card-ours-usesRetune')).toBeNull();
    w.stop();
  });
});
