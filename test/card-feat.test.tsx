// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { FeatsTab, featEntries } from '../src/sheet/FeatsTab';
import { FeatDetail, featPageOf, type FeatPinNode } from '../src/sheet/FeatDetail';
import { recordTree } from '../src/sheet/astVisibility';
import { descId, togglePinnedDesc, type PlayState } from '../src/rules/play';
import { applyOverrides } from '../src/rules/build';
import type { Character, ContentDatabase, Feat, PinnedDesc } from '../src/rules/types';

/**
 * Card step 11 (docs/card-design.md section 9 row 11, plan F1; section 2 rules 2(a), 4–5; section 3;
 * section 4; owner rulings section 13): the Feats-tab popup — feats, class features, heritages, choice
 * rows — is the row's record as a 'mine' RecordCard.
 *
 * Every case clicks a REAL FeatsTab row of a character synthesized through build() (name 't'; none is the
 * owner's) and reads the card it opens, over the shipped page trees (public/ast/*.json.gz, served through
 * a fetch stub):
 *  - Halfling Luck shows "Frequency once per day" and "Trigger You fail a skill check or saving throw"
 *    exactly once each, in the page's words, at full weight, before the prose; no "leads to"; Source dimmed;
 *    the star in the card header.
 *  - Shield Block shows its Trigger; Bellflower Dedication its Prerequisites once, worded as the page
 *    ("Charisma 14", where the field says "Charisma +2"); Azata Magic its Prerequisites (the field is empty).
 *  - A heritage row reads its heritages page by its id (rule 2(a)).
 *  - A level-3 cloistered cleric's Second Doctrine row shows only its own text (its slice).
 *  - A level-5 Justice champion's cause row folds Relentless Reaction under "At higher levels".
 *  - Caustic Nectar's note is in the ours box; a homebrew feat's typed use lines stay ours.
 *  - A record with neither page nor slice takes the no-page lane.
 *  (The turned-back case left with the switch and the legacy popup in card step 22.)
 *
 * MUTATION LINES (each measured red under scripts/vt.mjs on 2026-10-07, then the file restored from the
 * scratch copy, sha1 checked, and measured green again):
 *  - FeatDetail.tsx FeatCard: `printed={[]}` → `printed={['Frequency', 'Trigger', 'Prerequisites']}` → the
 *    Halfling Luck, Shield Block, Bellflower Dedication and Azata Magic cases red (4).
 *  - FeatDetail.tsx featPageOf: the heritages branch deleted → the heritage-row case red.
 *  - FeatsTab.tsx: `character={character}` dropped from <FeatDetail> → the Justice fold case red.
 *  - FeatDetail.tsx FeatCard: `ours={ours.box}` dropped → the Caustic Nectar case red.
 *  - FeatDetail.tsx featCardPin: returns `pin` unchanged → the old-heritage-pin case red ("the old pin
 *    reads as pinned": 'false').
 *  - (fixer round 1) FeatDetail.tsx FeatCard: `pickSub` forced to undefined → the Assurance (Athletics)
 *    subtitle case red ("the pick sits in the header").
 *  - (fixer round 1) RecordCard.tsx loading branch: `{mine ? oursBox : null}` → `{null}` → the loading-frame
 *    case red here, and 2 red in test/batch001-surfaces.test.tsx (its renders never settle).
 *  - (fixer round 1) FeatDetail.tsx FeatCard: the bare-entry Enhancement line dropped (`false ?`) → the
 *    "entry built without ours lines" case red.
 *  - (fixer round 2) FeatDetail.tsx FeatCard: `prerequisites !== undefined ?` → `prerequisites !== undefined
 *    && false ?` → the no-page case red ("the field Prerequisites row, exactly once": expected [] to deeply
 *    equal [ 'Order of the Godclaw' ]).
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
const readTree = (b: string, s: string): AstNode | undefined => treeOf(b)?.[s];

const mounted: (() => void)[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, cdb: ContentDatabase = db, pin: PinDescApi | null = null): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={cdb}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
async function click(el: Element | null | undefined) {
  // batch card premise: feat-4458 "Frequency once per day"
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const squash = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** FeatsTab for `ch` with the row named `name` clicked: the host holding the popup it opened. */
async function openRow(ch: Character, name: string, cdb: ContentDatabase = db, pin: PinDescApi | null = null): Promise<HTMLElement> {
  const host = await mount(<FeatsTab character={ch} content={cdb} />, cdb, pin);
  const row = [...host.querySelectorAll('.ff-row')].find((r) => squash(r.querySelector('.ff-name')?.textContent) === name);
  // batch card premise: feat-4458 "Frequency once per day"
  expect(row, `FeatsTab lists a row named ${name}`).toBeTruthy();
  await click(row);
  return host;
}
/** The open card, page lane: the modal, its body, the body's text and its block lines in order. */
function pageCard(host: HTMLElement) {
  const modal = host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  // batch card premise: feat-4458 "Frequency once per day"
  expect(modal, 'the row opens its record\'s mine card, page lane').toBeTruthy();
  const body = modal!.querySelector('.ast-pop > .ast-body')!;
  const lines = [...body.querySelectorAll('p, .ast-meta, .ast-h2, .ast-h3, li')].map((e) => squash(e.textContent));
  return { modal: modal!, body, text: squash(body.textContent), lines };
}
/** The body's paragraphs that are the page's own (not inside an ours node). */
const pageParas = (body: Element) => [...body.querySelectorAll('p')].filter((p) => !p.closest('[data-ours]'));
/** What a reader sees without opening anything: the card's text with every CLOSED fold's body removed. */
function openText(el: Element): string {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const d of copy.querySelectorAll('details:not([open])')) for (const k of [...d.children]) if (k.tagName !== 'SUMMARY') k.remove();
  return squash(copy.textContent);
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
  for (const b of ['feats', 'classFeatures', 'heritages', 'cause', 'doctrine']) if (treeOf(b)) await loadBucketAst(b);
  base = build('fighter', 20);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

// batch card premise: feat-4458 "Frequency once per day"
describe('card step 11: the Feats-tab popup is the row\'s mine card', () => {
  // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
  it('Halfling Luck shows "Frequency once per day" and its Trigger exactly once each, in the page\'s words, at full weight, before the prose; no "leads to"', async () => {
    const host = await openRow(withFeats(base, 'halfling-luck'), 'Halfling Luck');
    const { modal, body, text, lines } = pageCard(host);
    // batch card premise: feat-4458 "Frequency once per day"
    expect(count(text, 'Frequency once per day'), text).toBe(1);
    expect(count(text, 'Trigger You fail a skill check or saving throw'), text).toBe(1);
    // …and nowhere else on the card (no stat row, no ours copy).
    expect(count(squash(modal.textContent), 'Frequency'), 'one Frequency on the whole card').toBe(1);
    expect(count(squash(modal.textContent), 'Trigger'), 'one Trigger on the whole card').toBe(1);
    const para = (label: string) => pageParas(body).find((p) => squash(p.textContent).startsWith(label));
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    for (const p of [para('Frequency'), para('Trigger')]) {
      expect(p, 'the use line is a paragraph of the page').toBeTruthy();
      expect(p!.classList.contains('card-dim'), 'a use line is never dimmed').toBe(false);
      expect(p!.querySelector('strong')?.textContent?.trim(), 'the label stays bold').toMatch(/^(Frequency|Trigger)$/);
    }
    // The page's order: Source, Frequency, Trigger, then the prose.
    const at = (s: string) => lines.findIndex((l) => l.startsWith(s));
    // batch card premise: feat-4458 "Your happy-go-lucky nature makes it seem like misfortune avoids you"
    expect(at('Source')).toBeGreaterThanOrEqual(0);
    expect(at('Source')).toBeLessThan(at('Frequency'));
    expect(at('Frequency')).toBeLessThan(at('Trigger'));
    expect(at('Trigger')).toBeLessThan(at('Your happy-go-lucky nature'));
    // S-furniture: the "Halfling Luck leads to..." section and its link list leave.
    // batch card premise: feat-4458 "Your happy-go-lucky nature makes it seem like misfortune avoids you"
    expect(text).not.toMatch(/leads to/i);
    expect(text).not.toMatch(/Guiding Luck/);
    // No "Full page" button (owner ruling, section 13).
    expect(squash(modal.textContent)).not.toMatch(/Full page/i);
    // The action glyph sits in the header once: the page's own when its title prints it, ours otherwise.
    // batch card premise: feat-4458 "Frequency once per day"
    expect(modal.querySelectorAll('.ast-head .ast-ag, .ast-head .pf2-action').length, 'one cost glyph in the header').toBe(1);
  });

  // batch card premise: feat-4458 "Frequency once per day"
  it('Source is the page\'s line, once, dimmed; the PinStar and close sit in the card header, and the star pins the row\'s record', async () => {
    let pinned: FeatPinNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n as FeatPinNode; } };
    const host = await openRow(withFeats(base, 'halfling-luck'), 'Halfling Luck', db, pin);
    const { modal, body } = pageCard(host);
    const src = pageParas(body).filter((p) => squash(p.textContent).startsWith('Source'));
    // batch card premise: feat-4458 "Frequency once per day"
    expect(src.length, 'one Source line').toBe(1);
    expect(src[0].classList.contains('card-dim'), 'the Source line is dimmed').toBe(true);
    expect(squash(src[0].textContent)).toMatch(/^Source Player Core pg\. \d+/);
    const star = modal.querySelector('.ast-head .info-star');
    expect(star, 'PinStar in the card header').toBeTruthy();
    expect(modal.querySelector('.ast-head .picker-close'), 'close in the card header').toBeTruthy();
    await click(star);
    // batch card premise: feat-4458 "Frequency once per day"
    expect(pinned, 'the star pinned a node').toBeTruthy();
    expect({ key: pinned!.key, slug: pinned!.slug, title: pinned!.title }).toEqual({ key: 'feats', slug: 'halfling-luck', title: 'Halfling Luck' });
  });

  // batch card premise: feat-5212 "Trigger While you have your shield raised"
  it('Shield Block shows its Trigger once, in the page\'s words', async () => {
    // A wizard: a fighter's sheet also lists its Shield Block CLASS FEATURE row of the same name (a shared
    // feature whose page is the Guardian's — card step 12's lane), so the feat's own row is the only one here.
    const host = await openRow(withFeats(build('wizard', 1), 'shield-block'), 'Shield Block');
    const { modal, text } = pageCard(host);
    // batch card premise: feat-5212 "Trigger While you have your shield raised"
    expect(count(text, 'Trigger While you have your shield raised'), text).toBe(1);
    expect(count(squash(modal.textContent), 'Trigger'), 'one Trigger on the whole card').toBe(1);
    expect(text).not.toMatch(/leads to/i);
  });

  // batch card premise: feat-928 "Prerequisites Charisma 14"
  it('Bellflower Dedication shows Prerequisites once, worded as the page ("Charisma 14"), never the field\'s "Charisma +2"', async () => {
    expect(db.feats['bellflower-dedication'].prerequisites, 'the field is worded differently').toContain('Charisma +2');
    const host = await openRow(withFeats(base, 'bellflower-dedication'), 'Bellflower Dedication');
    const { modal, body, text } = pageCard(host);
    // batch card premise: feat-928 "Prerequisites Charisma 14"
    expect(count(squash(modal.textContent), 'Prerequisites'), 'one Prerequisites on the whole card').toBe(1);
    expect(text).toMatch(/Prerequisites Charisma 14; Expert in Stealth ?; Expert in Survival ?; member of the Bellflower Network/);
    expect(squash(modal.textContent)).not.toContain('Charisma +2');
    expect(modal.querySelector('.sd-stats'), 'no field stat row over a page').toBeNull();
    const p = pageParas(body).find((x) => squash(x.textContent).startsWith('Prerequisites'));
    // batch card premise: feat-928 "Prerequisites Charisma 14"
    expect(p!.classList.contains('card-dim'), 'Prerequisites is a use line, never dimmed').toBe(false);
  });

  // batch card premise: feat-1359 "Prerequisites Musetouched"
  it('Azata Magic shows the page\'s Prerequisites line though its field is empty', async () => {
    expect(db.feats['azata-magic'].prerequisites ?? [], 'the field is empty').toEqual([]);
    const host = await openRow(withFeats(base, 'azata-magic'), 'Azata Magic');
    const { modal, text } = pageCard(host);
    // batch card premise: feat-1359 "Prerequisites Musetouched"
    expect(count(text, 'Prerequisites Musetouched'), text).toBe(1);
    expect(count(squash(modal.textContent), 'Prerequisites')).toBe(1);
  });

  // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
  it('a heritage row reads its heritages page by its id (rule 2(a)), and its star pins the heritage', async () => {
    const ch = { ...base, heritageId: 'gutsy-halfling', secondHeritageId: undefined } as Character;
    const entry = featEntries(ch, db).find((e) => e.heritageId === 'gutsy-halfling');
    expect(entry, 'FeatsTab lists the heritage row').toBeTruthy();
    expect(featPageOf(entry!)).toEqual({ bucket: 'heritages', id: 'gutsy-halfling' });
    let pinned: FeatPinNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n as FeatPinNode; } };
    const host = await openRow(ch, entry!.name, db, pin);
    const { modal, text } = pageCard(host);
    // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
    expect(text).toMatch(/When you roll a success on a saving throw against an emotion effect, you get a critical success instead/);
    expect(text).toMatch(/^Source Player Core pg\. \d+/);
    await click(modal.querySelector('.ast-head .info-star'));
    expect({ key: pinned!.key, slug: pinned!.slug }).toEqual({ key: 'heritages', slug: 'gutsy-halfling' });
  });

  // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
  it('the card\'s star works on the row\'s own pin: a heritage pinned before card step 7a reads as pinned and pressing removes THAT pin; the ours lines ride on the pinned node', async () => {
    const ch = { ...base, heritageId: 'gutsy-halfling', secondHeritageId: undefined } as Character;
    const e = featEntries(ch, db).find((x) => x.heritageId === 'gutsy-halfling')!;
    const legacy: PinnedDesc = { title: e.name, description: e.description, descRefs: e.descRefs, key: 'classFeatures' };
    const state = { list: [legacy] as PinnedDesc[] };
    const api: PinDescApi = {
      has: (n) => state.list.some((d) => descId(d) === descId(n)),
      toggle: (n) => { state.list = togglePinnedDesc({ pinnedDescs: state.list } as PlayState, n).pinnedDescs ?? []; },
    };
    const host = await openRow(ch, e.name, db, api);
    const star = pageCard(host).modal.querySelector('.ast-head .info-star');
    // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
    expect(star?.getAttribute('aria-pressed'), 'the old pin reads as pinned').toBe('true');
    await click(star);
    expect(state.list, 'pressing the star removed the old pin, and added none').toEqual([]);
    // A feat row with a note: the node the star hands over carries the row's ours lines (the bridge
    // description keeps the note for the stored pin until card step 19).
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    let pinned: FeatPinNode | null = null;
    const h2 = await openRow(withFeats(base, 'caustic-nectar'), 'Caustic Nectar', db, { has: () => false, toggle: (n) => { pinned = n as FeatPinNode; } });
    await click(pageCard(h2).modal.querySelector('.ast-head .info-star'));
    expect(pinned!.ours?.some((l) => l.kind === 'note'), 'the node carries the note line').toBe(true);
    expect(pinned!.description).toContain(`Note: ${db.feats['caustic-nectar'].note}`);
  });

  // batch card premise: doctrine-4 "Second Doctrine (3rd)** Your proficiency rank for Fortitude saves increases to expert"
  it('a level-3 cloistered cleric\'s Second Doctrine row shows only its own text', async () => {
    const ch = build('cleric', 3, { subclassId: 'cloistered-cleric' } as never);
    const entry = featEntries(ch, db).find((e) => e.featureId === 'second-doctrine-cloistered-cleric');
    expect(entry, 'a cloistered cleric 3 lists the Second Doctrine row').toBeTruthy();
    const host = await openRow(ch, entry!.name);
    const { text } = pageCard(host);
    // batch card premise: doctrine-4 "Second Doctrine (3rd)** Your proficiency rank for Fortitude saves increases to expert"
    expect(text).toMatch(/Your proficiency rank for Fortitude saves increases to expert/);
    for (const other of ['First Doctrine', 'Third Doctrine', 'Fourth Doctrine', 'Fifth Doctrine', 'Final Doctrine']) expect(text, `no "${other}"`).not.toContain(other);
  });

  // batch card premise: cause-11 "Relentless Reaction"
  it('a level-5 Justice champion\'s cause row folds Relentless Reaction under "At higher levels"; the words stay inside the fold', async () => {
    const ch = build('champion', 5, { subclassId: 'justice' } as never);
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'justice' || e.featureId === 'justice');
    expect(entry, 'a Justice champion lists its cause row').toBeTruthy();
    expect(featPageOf(entry!)).toEqual({ bucket: 'classFeatures', id: 'justice' });
    const host = await openRow(ch, entry!.name);
    const { modal } = pageCard(host);
    const folds = [...modal.querySelectorAll('details.card-fold')] as HTMLDetailsElement[];
    // batch card premise: cause-11 "Relentless Reaction"
    expect(folds.length, 'one fold').toBe(1);
    expect(folds[0].open, 'closed').toBe(false);
    expect(squash(folds[0].querySelector(':scope > summary')?.textContent)).toMatch(/^At higher levels \(\d+\)$/);
    expect(openText(modal)).not.toMatch(/Relentless Reaction/);
    expect(squash(folds[0].textContent)).toMatch(/Relentless Reaction/);
    // The same row without the character (no scope) shows the page whole: the fold is the character's.
    // batch card premise: cause-11 "Relentless Reaction"
    const whole = await mount(<FeatDetail entry={entry!} onClose={noop} />);
    expect(whole.querySelector('.ast-modal.card-mine details.card-fold'), 'no character, no fold').toBeNull();
    expect(openText(whole)).toMatch(/Relentless Reaction/);
  });

  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  it('Caustic Nectar: its own note is in the ours box after the page, never in the page\'s words', async () => {
    const note = db.feats['caustic-nectar'].note!;
    expect(note, 'caustic-nectar carries a note').toBeTruthy();
    const host = await openRow(withFeats(base, 'caustic-nectar'), 'Caustic Nectar');
    const { modal } = pageCard(host);
    const box = modal.querySelector('.card-ours[data-ours]');
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect(squash(box?.textContent)).toContain(`Note: ${squash(note)}`);
    expect(pageParas(modal).map((p) => squash(p.textContent)).join(' ')).not.toContain(squash(note));
    const prose = pageParas(modal).find((p) => /sickened 1/.test(p.textContent ?? ''));
    expect(prose!.compareDocumentPosition(box!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the box follows the page').toBeTruthy();
  });

  // The rest of card step 8's ours lines reach the card's box too (test/card-ours.test.tsx reads them off
  // the legacy popup): a marker, a use-counter retune beside the restored printed Frequency, an Overrides
  // edit over a page, the running enhancement tier.
  // batch card premise: feat-4458 "Frequency once per day"
  it('the card\'s ours box carries a marker, a use-counter retune (beside the page\'s own Frequency), an Overrides edit and the running enhancement', async () => {
    const boxOf = (host: HTMLElement) => squash(pageCard(host).modal.querySelector('.card-ours[data-ours]')?.textContent);
    const blood = await openRow(withFeats(build('sorcerer', 3), 'ancestral-blood-magic'), 'Bloodline');
    // batch card premise: feat-4458 "Frequency once per day"
    expect(boxOf(blood)).toContain('Ancestral Blood Magic: ');
    expect(pageParas(pageCard(blood).body).map((p) => squash(p.textContent)).join(' ')).not.toContain('Ancestral Blood Magic');
    const luck = await openRow(withFeats(base, 'cats-luck', 'reliable-luck'), "Cat's Luck");
    expect(boxOf(luck)).toContain('Reliable Luck: changes this to 1/hour; your use counter follows it.');
    expect(pageParas(pageCard(luck).body).filter((p) => squash(p.textContent).startsWith('Frequency')).length, 'the page\'s Frequency line, once').toBe(1);
    const ch = { ...withFeats(base, 'caustic-nectar'), overrides: { contentEdits: { feats: { 'caustic-nectar': { description: 'Synthesized override words.' } } } } } as unknown as Character;
    const cdb = applyOverrides(db, ch.overrides);
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    const ov = await openRow(ch, 'Caustic Nectar', cdb);
    expect(boxOf(ov)).toContain('Your override: Synthesized override words.');
    expect(pageCard(ov).text).toMatch(/sickened 1/);
    const en = { ...withFeats(base, 'automaton-armament'), enhancements: [{ featId: 'automaton-armament', from: 'Lesser Augmentation' }] } as Character;
    const enh = await openRow(en, featEntries(en, db).find((e) => e.featId === 'automaton-armament')!.name);
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect(boxOf(enh)).toContain('Enhancement active — granted by Lesser Augmentation');
    expect(pageCard(enh).modal.querySelector('.sd-stats'), 'no print-styled stat row').toBeNull();
  });

  // Section 2 rule 4.1 ("the pick suffix as a subtitle, never part of the lookup"): the row's name carries
  // the pick, the page's header prints only the record's name, so the card's header shows the pick as an
  // ours subtitle — and the page is still found by the record's id.
  // batch card premise: feat-5121 "Choose a skill you're trained in"
  it('"Assurance (Athletics)" and a note-less pick ("Caustic Nectar (Acid)") show the pick as the header subtitle, marked ours, over the record\'s own page', async () => {
    const ch = { ...base, feats: [{ featId: 'assurance', level: 1, category: 'skill' as never, choice: { value: 'athletics', label: 'Athletics' } }] } as Character;
    const host = await openRow(ch, 'Assurance (Athletics)');
    const { modal, text } = pageCard(host);
    const sub = modal.querySelector('.ast-head .card-pick-sub');
    // batch card premise: feat-5121 "Choose a skill you're trained in"
    expect(sub, 'the pick sits in the header').toBeTruthy();
    expect(squash(sub!.textContent)).toBe('Athletics');
    expect(sub!.matches('[data-ours]'), 'the pick is ours').toBe(true);
    expect(squash(modal.querySelector('.ast-head .ast-name')?.textContent)).toBe('Assurance');
    expect(text, 'the page is Assurance\'s own').toMatch(/Choose a skill you're trained in/);
    // A pick with no note puts no "Your choice" line in the box, so the header is the only place it shows.
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    const nectar = { ...withFeats(base, 'caustic-nectar'), effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid' }] } as Character;
    const h2 = await openRow(nectar, 'Caustic Nectar (Acid)');
    const c2 = pageCard(h2);
    expect(squash(c2.modal.querySelector('.ast-head .card-pick-sub')?.textContent)).toBe('Acid');
    expect(c2.text).toMatch(/sickened 1/);
    // No pick, no subtitle.
    // batch card premise: feat-4458 "Frequency once per day"
    const plain = await openRow(withFeats(base, 'halfling-luck'), 'Halfling Luck');
    expect(pageCard(plain).modal.querySelector('.card-pick-sub'), 'no pick, no subtitle').toBeNull();
  });

  // Section 5 ("footer and ours slot on every branch"): while the page is still loading the card already
  // shows the row's ours box, as the legacy popup did on its loading frame.
  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  it('while the page loads, the card already draws its ours box (the note of Caustic Nectar)', async () => {
    const note = db.feats['caustic-nectar'].note!;
    const entry = featEntries(withFeats(base, 'caustic-nectar'), db).find((e) => e.featId === 'caustic-nectar')!;
    // A row with no record id whose name slug the (loaded) feats bucket does not hold: useAstNode seeds
    // `loading` and settles only after an await, so the synchronous first frame is the loading branch.
    const pending = { ...entry, featId: undefined, name: 'Caustic Nectar (Acid)', key: 'card-step11-loading' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<ContentContext.Provider value={db}><FeatDetail entry={pending} onClose={noop} /></ContentContext.Provider>); });
    mounted.push(() => { act(() => root.unmount()); host.remove(); });
    const loading = host.querySelector('.ast-modal.card-mine .ast-loading');
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect(loading, 'the card is on its loading frame').toBeTruthy();
    expect(squash(loading!.querySelector('.card-ours[data-ours]')?.textContent)).toContain(`Note: ${squash(note)}`);
  });

  // An entry built without ours lines (featStatRows gives it the Enhancement stat row the legacy popup
  // printed) keeps the running tier on the card, as the ours line featEntries makes — no stat row.
  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  it('an entry built without ours lines keeps its running enhancement tier on the card, in the ours box', async () => {
    const entry = featEntries(withFeats(base, 'caustic-nectar'), db).find((e) => e.featId === 'caustic-nectar')!;
    const bare = { ...entry, ours: undefined, enhancedBy: 'Synthesized Enhancer' };
    const host = await mount(<FeatDetail entry={bare} onClose={noop} />);
    const { modal } = pageCard(host);
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect(squash(modal.querySelector('.card-ours[data-ours]')?.textContent)).toBe('Enhancement active — granted by Synthesized Enhancer');
    expect(modal.querySelector('.sd-stats'), 'no print-styled stat row').toBeNull();
  });

  // batch card premise: feat-4458 "Frequency once per day"
  it('a record with neither page nor slice takes the no-page lane: its old text, the no-page line marked ours, the star in its header', async () => {
    const id = 'dedication-to-the-five';
    expect(treeOf('feats')![id], `${id} has no page`).toBeUndefined();
    expect(recordTree('feats', id, readTree), `${id} reads no slice either`).toBeUndefined();
    const pin: PinDescApi = { has: () => false, toggle: noop };
    const host = await openRow(withFeats(base, id), db.feats[id].name, db, pin);
    const modal = host.querySelector('.picker.info-modal.card-mine');
    // batch card premise: feat-4458 "Frequency once per day"
    expect(modal, 'the no-page lane of the mine card').toBeTruthy();
    expect(host.querySelector('.ast-modal'), 'no page drawn').toBeNull();
    expect(squash(modal!.querySelector('.info-title')?.textContent)).toBe(db.feats[id].name);
    expect(squash(modal!.querySelector('.info-body .sd-desc')?.textContent).length, 'the old text is shown').toBeGreaterThan(20);
    // With no page there is no printed Prerequisites line to replace it, so the field row stays — once,
    // and the old text does not repeat it (section 5: the fallback lane keeps the record's own rows).
    // batch card premise: rules-1431 "as long as you meet its prerequisites"
    const prereqRows = [...modal!.querySelectorAll('.card-controls .sd-stat')].filter((r) => squash(r.querySelector('.sd-stat-k')?.textContent) === 'Prerequisites');
    expect(prereqRows.map((r) => squash(r.querySelector('.sd-stat-v')?.textContent)), 'the field Prerequisites row, exactly once').toEqual(['Order of the Godclaw']);
    expect(squash(modal!.textContent).split('Order of the Godclaw').length - 1, 'the prerequisite text appears once on the card').toBe(1);
    const line = modal!.querySelector('.card-nopage');
    // batch card premise: feat-4458 "Frequency once per day"
    expect(line && squash(line.textContent)).toBe('Not from the Archives — our text');
    expect(line!.matches('[data-ours].sd-ours'), 'marked ours').toBe(true);
    expect(modal!.querySelector('.picker-head .info-star'), 'PinStar on the no-page lane').toBeTruthy();
  });

  // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
  it('a homebrew feat\'s typed trigger and frequency stay OUR use lines, above its text, never styled as print', async () => {
    const hb = {
      id: 'hb-card-step11', name: 'Synthesized Homebrew Eleven', level: 1, traits: ['general'], rarity: 'common', category: 'general',
      description: 'A homebrew body.', trigger: 'X happens', frequency: 'once per day', source: { book: 'Homebrew', license: 'homebrew' },
    } as unknown as Feat;
    const cdb = { ...db, feats: { ...db.feats, [hb.id]: hb } } as ContentDatabase;
    const host = await openRow(withFeats(base, hb.id), hb.name, cdb);
    const modal = host.querySelector('.picker.info-modal.card-mine');
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    expect(modal, 'a homebrew record takes the no-page lane').toBeTruthy();
    const lines = modal!.querySelector('.card-uselines[data-ours]');
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    expect([...(lines?.querySelectorAll('.card-ours-useLine') ?? [])].map((p) => squash(p.textContent))).toEqual(['Trigger X happens', 'Frequency once per day']);
    expect(lines!.compareDocumentPosition(modal!.querySelector('.sd-desc')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'above the text').toBeTruthy();
    expect(squash(modal!.querySelector('.card-nopage')?.textContent)).toBe('Homebrew');
  });
});
