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
import { FeatDetail, type FeatEntry } from '../src/sheet/FeatDetail';
import { featEntries } from '../src/sheet/FeatsTab';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { SpellDetail } from '../src/sheet/SpellsTab';
import { StrikeDetailModal } from '../src/sheet/StrikeDetailModal';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { cardOn } from '../src/sheet/cardSurfaces';
import { DescBody } from '../src/sheet/DescBody';
import { RecordCard } from '../src/sheet/RecordCard';
import { ChoiceDetails, hasEmptyEmbeddedPage, holdOnTitleLookup } from '../src/builder/shared';
import { astSlug } from '../src/sheet/astVisibility';
import { classFeatureDescription } from '../src/rules/featureText';
import * as lib from '../scripts/lib/card-scope.mjs';
import { descNodeOf } from '../src/sheet/FilterableSelect';
import { playerFacingContent, shownItemId } from '../src/rules/cursedItems';
import { deriveStrikes } from '../src/rules/derive';
import { descId, togglePinnedDesc, type PlayState } from '../src/rules/play';
import type { Character, ContentDatabase, DescRef, InventoryItem, PinnedDesc } from '../src/rules/types';
import type { DescNode } from '../src/sheet/descref';

/* The TrustMarker case below marks ONE record "not yet verified" to see whose line an item popup draws.
 * Today no disguise pair differs in its trust state (0 of 9), so the test makes one differ; every other
 * record reads the real gate. */
const trustMarked = vi.hoisted(() => new Set<string>());
vi.mock('../src/data/trustGate', async (orig) => {
  const real = await orig<typeof import('../src/data/trustGate')>();
  return { ...real, trustUnencoded: (bucket: string, id: string) => trustMarked.has(`${bucket}:${id}`) || real.trustUnencoded(bucket, id) };
});

/**
 * Card step 7a (docs/card-design.md section 9 row 7a; section 2 rule 2 "Identity: by {bucket,id}, never
 * by display name"; section 6 descNodeOf): every popup opens the record it was opened FROM.
 *
 *  - The PinStar of FeatDetail / SpellDetail / ItemDetail / StrikeDetailModal hands the pin a node that
 *    carries `slug` = the record's id and the record's own bucket as `key` (a heritage row: 'heritages').
 *    ⚠ The pin the player REOPENS from the Main tab's Pinned list is the STORED one. When 7a landed,
 *    togglePinnedDesc (play.ts) stored {title, description, descRefs, key} and dropped the slug, so a
 *    pick in the title ("Caustic Nectar (Acid)") or a shared name ("Zombie Horde", "Discomfiting
 *    Whisper") reopened by name. Card step 19 (committed) closed that: play.ts pinOf keeps the node's
 *    slug and mode, MainTab's PinnedDescCard reopens the record by {key, slug}, and Builder.tsx's pin
 *    toggle keeps the record id — test/card-pins.test.tsx owns those stored-pin cases (the
 *    'pin|feats:caustic-nectar' and 'pin|feats:zombie-horde-impossible-magic' entries left
 *    test/card-parity-known.json when it landed). This file asserts what 7a controls (the node objects,
 *    the cursed twin, ChoiceDetails, descNodeOf) and the heritage pin's stored key.
 *  - Never-overwrite: a heritage pinned before this step ({key:'classFeatures', title}) still shows as
 *    pinned on the heritage popup's star, and pressing it removes THAT pin, never a second one
 *    (FeatDetail featStarNode); likewise a key-less pin starred from the builder's ChoiceDetails
 *    (ChoiceDetailsModal). No stored pin is rewritten.
 *  - A hidden cursed item (playerFacingContent) resolves its disguise twin's id for its page, its pin AND
 *    its TrustMarker (cursedItems.ts shownItemId), so a hidden Bag of Devouring never prints "devours".
 *  - The builder's ChoiceDetails passes the bucket and id it receives: a background's Cascade
 *    Countermeasure opens the FEAT, not the spell of the same name. HELD until card step 14 (refuter,
 *    round 2): a page whose rules sit in an EMPTY embedded stub (Rage's class-feature page = one sentence
 *    + a stub of the Rage action) keeps the pre-step title lookup, byte for byte, when that lookup lands
 *    on another page: 21 class features today, all still counted in S5-IDENTITY.
 *    Refuter round 3 (a player must never see less than before), MEASURED on every class feature the
 *    builder lists with a page: 61 title lookups land on another page, 56 of them a different one (the
 *    re-pointed set); 21 are held (byte-equal); the other 35 open their own page, and every one of those
 *    is at least as long as the record's own description. 29 of the 35 are shorter than the pre-step
 *    popup, and in all 29 that popup was ANOTHER record's page — another class's Weapon Expertise /
 *    Perception Expertise (the thaumaturge's "increases to master" shown to a magus who gets expert), the
 *    Assassin's Surprise Attack feat, the legacy Divine Access feat, the Shield Block FEAT for the
 *    guardian's and runesmith's Shield Block class feature (whose page names and links the feat). A
 *    "page links the record its title opens" hold was tried and DROPPED: it also held the background feat
 *    Cascade Countermeasure (its page links the spell of the same name) — the exact wrong record this
 *    step fixes. The 18 class features with no page of their own are unchanged (measured 0 of 18).
 *  - descNodeOf counts the record's own page (by id, in its own bucket) as something to show.
 *
 * LEFT AS IS (refuter round 2, noted): test/card-parity-known.json kept 'pin|feats:zombie-horde-
 * impossible-magic' as a pre-existing S5 row turned guard (removed by card step 19, which made it right);
 * and the card-truth baseline's S1-MISSING moved
 * 10,464 → 10,462 and S1-UNNAMED 20,884 → 20,893 against HEAD because the nine hidden cursed items now read
 * their twin's page (re-stamped 2026-10-03 after fixer round 3: no further delta; S5-IDENTITY 1,416 → 1,047,
 * choiceDetails 56 → 21, pin 495 → 170, itemDetail 9 → 0).
 *
 * What did NOT move, by the step's scope: FeatDetail's BODY for a heritage row stays on the markdown
 * lane (its card conversion is step 11) — pinned here and proved byte-equal for all 336 heritage rows
 * when the step was built; a pin STORED earlier ({key, title}, no slug) reopens exactly as before, and
 * the title a new pin carries is unchanged, so its `key:title` identity (play.ts descId) still matches
 * an old pin of the same feat. Storing the slug with a pin came with step 19 (play.ts pinOf;
 * test/card-pins.test.tsx), which still matches such an old pin by its key and title (play.ts samePin).
 *
 * Every character is synthesized through build() (name 't'); the "(Acid)" pick on Caustic Nectar is a
 * synthesized effect pick, as any pick reaches FeatsTab's row name.
 *
 * MUTATION LINES (each measured red on 2026-10-03, then restored from a scratch copy, sha1 checked):
 *  - FeatDetail.tsx featPinNode: `...(ref.id ? { slug: ref.id } : {})` deleted → Caustic Nectar (the
 *    star's node fell back: no page), Zombie Horde (the node opened the Pathfinder #180 feat's page)
 *    and the heritage case (slug missing) red.
 *  - FeatDetail.tsx featPinNode: `key: ref.bucket ?? …` → `key: featLegacyPinKey(entry)` → the heritage
 *    case red (the stored pin found no page).
 *  - FeatDetail.tsx featStarNode: `return !pin.has(node) && pin.has(legacy) ? legacy : node;` →
 *    `return node;` → the old-heritage-pin star case red (star off; pressing it pinned a second time).
 *  - shared.tsx ChoiceDetailsModal: `has: (n) => outer.has(n) || heldAsLegacy(n)` → `has: outer.has` and
 *    toggle → `outer.toggle(n)` → the old ChoiceDetails pin case red.
 *  - cursedItems.ts: `SHOWN_ID.set(shown, twin.id);` deleted → the hidden bag case red (the popup printed
 *    "devour") and the not-disguised case red (the copy found no stamp).
 *  - ItemDetail.tsx DescBody: `astId={pageId}` → `astId={item.id}` → the hidden bag case red ("devour").
 *  - shared.tsx ChoiceDetails: the `key: bucket, slug: id` spread deleted → the cascade-countermeasure case
 *    red (the popup was the spell's page, Secrets of Magic pg. 143).
 *  - shared.tsx ChoiceDetailsModal: `const held = …` → `const held = false && …` → the Rage case red
 *    (the popup was the one-sentence class-feature page) and the every-held-row case red (explode).
 *  - card-scope.mjs choiceRow: `const held = …` → `false && …` → test/card-parity.test.tsx red (3 sampled
 *    ChoiceDetails rows: DOM vs ledger disagree; sample vs baseline differ) and card-truth-check lists the
 *    21 baseline entries as stale.
 *  - FilterableSelect.tsx descNodeOf: `&& !hasOwnPage(it.id, key)` deleted → the descNodeOf case red.
 *  - SpellsTab.tsx PinStar: `slug: spell.id` deleted → the spell case red (the pinned popup fell back).
 *  - StrikeDetailModal.tsx: the slug spread disabled → the strike case red (slug missing; the longsword's
 *    name slugs to its own id, so its page alone cannot tell).
 * Fixer round 3 (2026-10-03, scratch runner, file restored sha1 MATCH each time):
 *  - shared.tsx holdOnTitleLookup: `if (!hasEmptyEmbeddedPage(ownPage)) return false;` deleted (hold every
 *    row whose title lands elsewhere) → the Shield Block, cascade-countermeasure, old-ChoiceDetails-pin and
 *    every-held cases red.
 *  - shared.tsx ChoiceDetailsModal: `const held = …` → `const held = false && …` → the Rage, every-held
 *    and re-pointed sweep cases red.
 *  - shared.tsx ChoiceDetails: the `key: bucket, slug: id` spread → `...({})` → cascade, old pin, Shield
 *    Block, every-held and the re-pointed sweep ("not held, but not its own page") red.
 *  - ItemDetail.tsx: `<TrustMarker bucket="items" id={pageId} />` → `id={item.id}` → the TrustMarker case
 *    red (the disguise drew the cursed record's line).
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

/** The text of a popup's page body (the browse card's page lane), or null when it fell back. */
const pageText = (host: Element) => {
  const body = host.querySelector('.ast-modal .ast-body');
  return body ? txt(body) : null;
};
/** The browse card for {bucket, id}: the record's own page, the truth a pinned popup must equal. */
async function browseText(bucket: string, id: string): Promise<string | null> {
  const m = await mount(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
  const t = pageText(m.host);
  m.stop();
  return t;
}
/** A popup's PinStar: the legacy header's, or the card's page header's (card step 11). */
const STAR = '.picker-head .info-star, .ast-head .info-star';
/** Press the popup's PinStar and return the node it handed to the pin. */
async function pinnedNodeOf(el: ReactElement, cdb: ContentDatabase = db): Promise<DescNode> {
  let pinned: DescNode | null = null;
  const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
  const m = await mount(el, cdb, pin);
  // Card step 11: FeatDetail on the card carries its star in the page header (.ast-head); the legacy
  // popups (and the card's no-page lane) in .picker-head — whichever the popup drew.
  // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
  await click(m.host.querySelector(STAR));
  m.stop();
  expect(pinned, 'the star pinned a node').toBeTruthy();
  return pinned!;
}
/** The pin as STORED by the real store (play.ts togglePinnedDesc) — what MainTab's Pinned list reopens. */
function storedPinOf(node: DescNode): DescNode {
  const stored = togglePinnedDesc({} as PlayState, node).pinnedDescs?.[0];
  expect(stored, 'the store kept a pin').toBeTruthy();
  return stored!;
}
/** A pin context shaped like CharacterSheet's (descId match, togglePinnedDesc store) over a live list. */
function sheetPin(list: PinnedDesc[]): { api: PinDescApi; state: { list: PinnedDesc[] } } {
  const state = { list };
  const api: PinDescApi = {
    has: (n) => state.list.some((d) => descId(d) === descId(n)),
    toggle: (n) => { state.list = togglePinnedDesc({ pinnedDescs: state.list } as PlayState, n).pinnedDescs ?? []; },
  };
  return { api, state };
}
/** The pinned popup: DescriptionModal opened on a node (the star's node, or the stored pin). */
async function pinnedPopupText(node: DescNode, cdb: ContentDatabase = db): Promise<{ page: string | null; all: string }> {
  const m = await mount(<DescriptionModal root={node} onClose={noop} />, cdb);
  const r = { page: pageText(m.host), all: txt(m.host) };
  m.stop();
  return r;
}

/** A class feature as the builder's "You gain automatically" row hands it to ChoiceDetails. */
type ChoiceRowCase = { id: string; name: string; flavor: string; descRefs?: DescRef[] };

let base: Character;
const featRow = (id: string, extra?: Partial<Character>): FeatEntry => {
  const rec = db.feats[id];
  const ch = { ...base, feats: [{ featId: id, level: rec.level ?? 1, category: (rec.category ?? 'general') as never }], ...extra } as Character;
  const e = featEntries(ch, db).find((x) => x.featId === id);
  expect(e, `FeatsTab lists ${id}`).toBeTruthy();
  return e!;
};
const heritageRow = (id: string): FeatEntry => {
  const e = featEntries({ ...base, heritageId: id, secondHeritageId: undefined } as Character, db).find((x) => x.heritageId === id);
  expect(e, `FeatsTab lists heritage ${id}`).toBeTruthy();
  return e!;
};

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
  await loadAstIndex();
  // actions + categoryPage: where a held ChoiceDetails row's title lookup lands (Rage → actions:rage).
  for (const b of ['feats', 'classFeatures', 'heritages', 'items', 'spells', 'actions', 'categoryPage']) await loadBucketAst(b);
  base = build('fighter', 20);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('card step 7a: a pin opens the record it was made from', () => {
  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  it('"Caustic Nectar (Acid)": the star\'s node names caustic-nectar and opens its page (T4, the node; the stored pin: test/card-pins.test.tsx)', async () => {
    const e = featRow('caustic-nectar', { effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid' }] });
    expect(e.name).toBe('Caustic Nectar (Acid)');
    const node = await pinnedNodeOf(<FeatDetail entry={e} onClose={noop} />);
    const own = await browseText('feats', 'caustic-nectar');
    expect(own, 'Caustic Nectar has a page').toBeTruthy();
    expect((await pinnedPopupText(node)).page, 'the star\'s node opens the record\'s page').toBe(own);
    expect({ key: node.key, slug: node.slug, title: node.title }).toEqual({ key: 'feats', slug: 'caustic-nectar', title: 'Caustic Nectar (Acid)' });
    // Never-overwrite: the title is unchanged, so the pin's identity is the one an old pin of this row has.
    expect(descId(node)).toBe(descId({ key: 'feats', title: 'Caustic Nectar (Acid)' }));
    // The pin STORED from this node (play.ts togglePinnedDesc → pinOf) keeps its slug since card step 19
    // and reopens caustic-nectar's own page, pick "Acid" and all: test/card-pins.test.tsx, not 7a's.
  });

  // batch card premise: feat-9122 "You learn the zombie horde grave spell"
  it('"Zombie Horde" (Impossible Magic): the star\'s node opens its own page, not Clockwork Reanimator\'s (the stored pin: test/card-pins.test.tsx)', async () => {
    expect(db.feats['zombie-horde'].name).toBe(db.feats['zombie-horde-impossible-magic'].name);
    const node = await pinnedNodeOf(<FeatDetail entry={featRow('zombie-horde-impossible-magic')} onClose={noop} />);
    const own = await browseText('feats', 'zombie-horde-impossible-magic');
    const other = await browseText('feats', 'zombie-horde');
    expect(own && other && own !== other, 'the two pages differ').toBe(true);
    expect((await pinnedPopupText(node)).page, 'the star\'s node opens the record\'s page').toBe(own);
    expect(node.slug).toBe('zombie-horde-impossible-magic');
    // The STORED pin reopens this record by its slug since card step 19 (test/card-pins.test.tsx); it was
    // test/card-parity-known.json's 'pin|feats:zombie-horde-impossible-magic' until then.
  });

  // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
  it('a pinned heritage reopens the heritages page from the STORED pin (T1, pin only); the FeatDetail body is the heritages page on the card (the markdown lane with the switch off)', async () => {
    const e = heritageRow('gutsy-halfling');
    const node = await pinnedNodeOf(<FeatDetail entry={e} onClose={noop} />);
    const own = await browseText('heritages', 'gutsy-halfling');
    expect(own, 'Gutsy Halfling has a page').toBeTruthy();
    expect({ key: node.key, slug: node.slug }).toEqual({ key: 'heritages', slug: 'gutsy-halfling' });
    // What the Main tab's Pinned list reopens: the stored pin (key 'heritages', no slug).
    const stored = storedPinOf(node);
    expect({ key: stored.key, title: stored.title }).toEqual({ key: 'heritages', title: 'Gutsy Halfling' });
    expect((await pinnedPopupText(stored)).page, 'the reopened pin is the heritage\'s page').toBe(own);

    // Card step 11 moves the body: with CARD_ON.featDetail the heritage row opens its heritages page by id
    // (section 2 rule 2(a)) as a mine card. Switched off, the legacy body is DescBody's markdown lane over the
    // row's description, as below.
    // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
    if (cardOn('featDetail')) {
      const card = await mount(<FeatDetail entry={e} onClose={noop} />);
      const page = card.host.querySelector('.ast-modal.card-mine .ast-pop > .ast-body');
      const shown = txt(page);
      card.stop();
      // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
      expect(page, 'the heritage row draws its heritages page').toBeTruthy();
      expect(shown).toContain('When you roll a success on a saving throw against an emotion effect, you get a critical success instead');
      return;
    }
    const pop = await mount(<FeatDetail entry={e} onClose={noop} />);
    const body = pop.host.querySelector('.picker.spell-detail .sd-body > .sd-desc');
    const html = body?.outerHTML;
    pop.stop();
    const md = await mount(<DescBody description={e.description} descRefs={e.descRefs} onExit={noop} />);
    const want = md.host.querySelector('.sd-desc')?.outerHTML;
    md.stop();
    expect(html, 'the heritage row body is rendered').toBeTruthy();
    expect(html).toBe(want);
  });

  it('a heritage pin stored before this step ({key: classFeatures, title}, no slug) still reopens as it did', async () => {
    const h = db.heritages['gutsy-halfling'];
    const legacy: DescNode = { title: h.name, description: h.description, descRefs: h.descRefs, key: 'classFeatures' };
    const r = await pinnedPopupText(legacy);
    // No classFeatures page by that name: the stored snapshot text, as before.
    expect(r.page).toBeNull();
    expect(r.all).toContain(txt(Object.assign(document.createElement('div'), { innerHTML: h.description.split('\n')[0] })).slice(0, 40));
  });

  it('a heritage pinned before this step shows as pinned on its star, and pressing it removes THAT pin — never a second one', async () => {
    const e = heritageRow('gutsy-halfling');
    const legacy: PinnedDesc = { title: e.name, description: e.description, descRefs: e.descRefs, key: 'classFeatures' };
    const { api, state } = sheetPin([legacy]);
    const m = await mount(<FeatDetail entry={e} onClose={noop} />, db, api);
    // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
    const star = m.host.querySelector(STAR);
    expect(star?.getAttribute('aria-pressed'), 'the old pin reads as pinned').toBe('true');
    await click(star);
    m.stop();
    expect(state.list, 'pressing the star removed the old pin, and added none').toEqual([]);
    // With no old pin, the star pins the heritage under its own bucket.
    const m2 = await mount(<FeatDetail entry={e} onClose={noop} />, db, api);
    // batch card premise: heritage-21 "When you roll a success on a saving throw against an emotion effect, you get a critical success instead"
    const star2 = m2.host.querySelector(STAR);
    expect(star2?.getAttribute('aria-pressed')).toBe('false');
    await click(star2);
    m2.stop();
    expect(state.list.map((d) => `${d.key}:${d.title}`)).toEqual(['heritages:Gutsy Halfling']);
  });

  // batch card premise: spell-2139 "You are surrounded by an aura of spiteful murmurings"
  it('a spell: the star\'s node opens its own page (the stored pin keeps its slug since step 19)', async () => {
    const sp = db.spells['discomfiting-whispers'];
    expect(sp.name).toBe('Discomfiting Whisper');
    const node = await pinnedNodeOf(<SpellDetail spell={sp} onClose={noop} />);
    const own = await browseText('spells', 'discomfiting-whispers');
    expect(own, 'the spell has a page').toBeTruthy();
    expect((await pinnedPopupText(node)).page, 'the star\'s node opens the spell\'s page').toBe(own);
    expect({ key: node.key, slug: node.slug }).toEqual({ key: 'spells', slug: 'discomfiting-whispers' });
    // The STORED pin keeps the spell's slug since card step 19 (play.ts pinOf) and reopens this page by it.
  });

  it('a strike\'s pin opens its weapon\'s page by id; a strike with no item keeps the title lookup', async () => {
    const c = { ...build('fighter', 1), inventory: [{ instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true }] } as Character;
    const strikes = deriveStrikes(c, db);
    const sword = strikes.find((s) => s.instanceId === 'i-sword')!;
    const node = await pinnedNodeOf(<StrikeDetailModal strike={sword} character={c} content={db} onClose={noop} />);
    expect(node.slug).toBe('longsword');
    expect((await pinnedPopupText(node)).page).toBe(await browseText('items', 'longsword'));
    const fist = strikes.find((s) => s.instanceId === 'fist');
    expect(fist, 'the fighter has a fist strike').toBeTruthy();
    const fn = await pinnedNodeOf(<StrikeDetailModal strike={fist!} character={c} content={db} onClose={noop} />);
    expect(fn.slug).toBeUndefined();
  });
});

describe('card step 7a: a hidden cursed item is its twin, page and pin', () => {
  const inv: InventoryItem = { instanceId: 'i-bag', itemId: 'bag-of-devouring', quantity: 1, hiddenCurse: true } as InventoryItem;

  it('the hidden Bag of Devouring\'s popup and its pin show Spacious Pouch\'s page and never "devours" (T7)', async () => {
    expect(db.items['bag-of-devouring'].disguisedAs).toBe('spacious-pouch');
    const cdb = playerFacingContent(db, [inv]);
    const item = cdb.items['bag-of-devouring'];
    expect(item.name).toBe('Spacious Pouch');
    const m = await mount(<ItemDetail inv={inv} item={item} content={cdb} onClose={noop} />, cdb);
    const pop = m.host.querySelector('.picker.spell-detail');
    const words = txt(pop);
    const body = txt([...(pop?.querySelectorAll(':scope .sd-body > .sd-desc') ?? [])].slice(-1)[0]);
    m.stop();
    expect(words).not.toMatch(/devour/i);
    const twin = await browseText('items', 'spacious-pouch');
    expect(twin, 'Spacious Pouch has a page').toBeTruthy();
    expect(body.length, 'the body draws the page').toBeGreaterThan(40);
    expect(twin!.replace(/\s+/g, ' ')).toContain(body.slice(0, 40));

    const node = await pinnedNodeOf(<ItemDetail inv={inv} item={item} content={cdb} onClose={noop} />, cdb);
    const r = await pinnedPopupText(node, cdb);
    expect(r.all, 'the pinned popup').not.toMatch(/devour/i);
    expect(r.page).toBe(twin);
    expect({ key: node.key, slug: node.slug, title: node.title }).toEqual({ key: 'items', slug: 'spacious-pouch', title: 'Spacious Pouch' });
    // The stored pin (no slug) reopens by the shown name, which is the twin's: also no "devours".
    const reopened = await pinnedPopupText(storedPinOf(node), cdb);
    expect(reopened.all).not.toMatch(/devour/i);
    expect(reopened.page).toBe(twin);
    expect(shownItemId(item)).toBe('spacious-pouch');
  });

  it('the hidden item\'s TrustMarker is the SHOWN record\'s (its twin\'s), like its page and its pin (rule 2c)', async () => {
    const cdb = playerFacingContent(db, [inv]);
    const item = cdb.items['bag-of-devouring'];
    const noteOf = async (c: ContentDatabase, it: typeof item, gmView?: boolean) => {
      const m = await mount(<ItemDetail inv={inv} item={it} content={c} onClose={noop} gmView={gmView} />, c);
      const t = [...m.host.querySelectorAll('.sd-choice-note')].map((n) => txt(n)).join(' | ');
      m.stop();
      return t;
    };
    try {
      // Only the CURSED record is marked: the player's popup (the twin) draws no line; the GM's does.
      trustMarked.clear();
      trustMarked.add('items:bag-of-devouring');
      expect(await noteOf(cdb, item), 'the disguise draws the cursed record\'s line').not.toMatch(/Not yet verified/);
      expect(await noteOf(db, db.items['bag-of-devouring'], true), 'the GM sees the cursed record\'s line').toMatch(/Not yet verified/);
      // Only the TWIN is marked: the player's popup draws the twin's line.
      trustMarked.clear();
      trustMarked.add('items:spacious-pouch');
      expect(await noteOf(cdb, item), 'the disguise draws its twin\'s line').toMatch(/Not yet verified/);
    } finally {
      trustMarked.clear();
    }
  });

  it('the GM (raw database) still sees the Bag of Devouring\'s own page', async () => {
    const item = db.items['bag-of-devouring'];
    expect(shownItemId(item)).toBe('bag-of-devouring');
    const m = await mount(<ItemDetail inv={inv} item={item} content={db} onClose={noop} gmView />);
    expect(txt(m.host)).toMatch(/devour/i);
    m.stop();
  });

  it('an item that is not disguised shows its own id', () => {
    const cdb = playerFacingContent(db, [inv]);
    expect(shownItemId(cdb.items.longsword, cdb)).toBe('longsword');
    // A copy of the disguised record still finds its stamp through the database's own record.
    expect(shownItemId({ ...cdb.items['bag-of-devouring'] }, cdb)).toBe('spacious-pouch');
  });
});

describe('card step 7a: the builder and the pickers resolve by id', () => {
  it('ChoiceDetails(feats, cascade-countermeasure) renders the feat, not the same-named spell', async () => {
    const ft = db.feats['cascade-countermeasure'];
    expect(db.spells['cascade-countermeasure']?.name).toBe(ft.name);
    const feat = await browseText('feats', 'cascade-countermeasure');
    const spell = await browseText('spells', 'cascade-countermeasure');
    expect(feat && spell && feat !== spell, 'the two pages differ').toBe(true);
    const m = await mount(<ChoiceDetails name={ft.name} flavor={ft.description} descRefs={ft.descRefs} bucket="feats" id="cascade-countermeasure" />);
    await click(m.host.querySelector('.cc-det'));
    const t = pageText(m.host);
    m.stop();
    expect(t).toBe(feat);
  });

  it('a ChoiceDetails pin saved before this step (no key) shows as pinned, and pressing the star removes THAT pin', async () => {
    const ft = db.feats['cascade-countermeasure'];
    const legacy: PinnedDesc = { title: ft.name, description: ft.description, descRefs: ft.descRefs };
    const { api, state } = sheetPin([legacy]);
    const el = <ChoiceDetails name={ft.name} flavor={ft.description} descRefs={ft.descRefs} bucket="feats" id="cascade-countermeasure" />;
    const m = await mount(el, db, api);
    await click(m.host.querySelector('.cc-det'));
    const star = m.host.querySelector('.info-star');
    expect(star?.getAttribute('aria-pressed'), 'the old key-less pin reads as pinned').toBe('true');
    await click(star);
    m.stop();
    expect(state.list, 'pressing the star removed the old pin, and added none').toEqual([]);
    const m2 = await mount(el, db, api);
    await click(m2.host.querySelector('.cc-det'));
    const star2 = m2.host.querySelector('.info-star');
    expect(star2?.getAttribute('aria-pressed')).toBe('false');
    await click(star2);
    m2.stop();
    expect(state.list.map((d) => `${d.key}:${d.title}`)).toEqual([`feats:${ft.name}`]);
  });

  // Refuter, step 7a round 2: opening a class feature by id showed ONE sentence where its rules sit in an
  // embedded stub (stubs draw nothing until step 14) — rage 768 → 102 characters. Such a row is HELD on
  // the pre-step title lookup until step 14; every other class feature opens by id.
  const classFeatureRows = () => {
    const seen = new Map<string, ChoiceRowCase>();
    for (const cls of Object.values(db.classes)) {
      for (const f of cls.features ?? []) {
        const rec = db.classFeatures[f.featureId];
        const flavor = rec ? classFeatureDescription(rec.description, cls.id, db) : '';
        if (rec && flavor.trim() && !seen.has(f.featureId)) seen.set(f.featureId, { id: f.featureId, name: rec.name, flavor, descRefs: rec.descRefs });
      }
    }
    return [...seen.values()];
  };
  /** The builder's Details popup for a class feature (the real ChoiceDetails), and the popup it had
   *  before this step (DescriptionModal root {title, description, descRefs}, no key: the title lookup). */
  async function choiceNowAndBefore(r: ChoiceRowCase) {
    const m = await mount(<ChoiceDetails name={r.name} flavor={r.flavor} descRefs={r.descRefs} bucket="classFeatures" id={r.id} />);
    await click(m.host.querySelector('.cc-det'));
    await settle();
    const now = txt(m.host.querySelector('.ast-modal'));
    m.stop();
    const m2 = await mount(<DescriptionModal root={{ title: r.name, description: r.flavor, descRefs: r.descRefs }} onClose={noop} />);
    await settle();
    const before = txt(m2.host.querySelector('.ast-modal'));
    m2.stop();
    return { now, before };
  }

  /** The text the record's OWN description carries: DescBody's markdown lane over the flavor. */
  async function descriptionText(r: ChoiceRowCase): Promise<string> {
    const m = await mount(<DescBody description={r.flavor} descRefs={r.descRefs} onExit={noop} />);
    const t = txt(m.host);
    m.stop();
    return t;
  }
  /** The popup's whole text (page or fallback lane) — what the player reads. */
  async function choicePopupText(r: ChoiceRowCase): Promise<string> {
    const m = await mount(<ChoiceDetails name={r.name} flavor={r.flavor} descRefs={r.descRefs} bucket="classFeatures" id={r.id} />);
    await click(m.host.querySelector('.cc-det'));
    await settle();
    const t = txt(m.host.querySelector('.picker-overlay'));
    m.stop();
    return t;
  }
  const isHeld = (r: ChoiceRowCase) => holdOnTitleLookup(treeOf('classFeatures')?.[r.id], 'classFeatures', r.id, r.name);

  it('a class feature whose page embeds its rules as a stub keeps the pre-step popup until step 14: Rage shows the Rage action', async () => {
    const r = classFeatureRows().find((x) => x.id === 'rage')!;
    expect(hasEmptyEmbeddedPage(treeOf('classFeatures')?.rage), 'Rage\'s class-feature page embeds the action as a stub').toBe(true);
    const { now, before } = await choiceNowAndBefore(r);
    expect(now).toBe(before);
    expect(now).toContain('You aren\'t fatigued or raging');
    // Never less than its own description (refuter round 3).
    expect((await choicePopupText(r)).length).toBeGreaterThanOrEqual((await descriptionText(r)).length);
  });

  /*
   * Not held: a page that NAMES and LINKS the record its title opens, with no stub. The guardian's Shield
   * Block opened the Shield Block FEAT by name (another record); by id it is its own page, "You gain the
   * Shield Block general feat …", the feat one tap away. A link hold was tried in fixer round 3 and
   * dropped: it also held the background feat Cascade Countermeasure (its page links the spell of the
   * same name), re-opening exactly the wrong record this step fixes.
   */
  it('the guardian\'s Shield Block opens its own page (which links the feat), never less than its description', async () => {
    const r = classFeatureRows().find((x) => x.id === 'shield-block')!;
    expect(hasEmptyEmbeddedPage(treeOf('classFeatures')?.['shield-block']), 'no stub on this page').toBe(false);
    expect(isHeld(r)).toBe(false);
    const m = await mount(<ChoiceDetails name={r.name} flavor={r.flavor} descRefs={r.descRefs} bucket="classFeatures" id={r.id} />);
    await click(m.host.querySelector('.cc-det'));
    const t = pageText(m.host);
    const link = [...m.host.querySelectorAll('.ast-modal a, .ast-modal [data-ref], .ast-modal .ref-link')].map((a) => txt(a));
    m.stop();
    expect(t).toBe(await browseText('classFeatures', 'shield-block'));
    expect(t).toContain('Class Guardian');
    expect(link, 'the feat is one tap away').toContain('Shield Block');
    expect((await choicePopupText(r)).length).toBeGreaterThanOrEqual((await descriptionText(r)).length);
  });

  it('every held class feature is byte-equal to its pre-step popup; the rest open by id', async () => {
    const rows = classFeatureRows();
    const held = rows.filter(isHeld);
    // The 21 stub rows the refuter's round-2 measure named; the guard's S5 keeps counting each
    // (scripts/data/card-truth-baseline.json).
    expect(held.map((r) => r.id).sort()).toEqual([
      'arcane-cascade', 'confident-finisher', 'debilitating-strike', 'devise-a-stratagem', 'double-spellstrike', 'explode',
      'extract-element', 'flurry-of-blows', 'hunt-prey', 'inevitable-return', 'intensify-vulnerability', 'master-strike',
      'opportune-riposte', 'overdrive', 'quick-tempered', 'rage', 'reactive-strike', 'runes', 'spellstrike', 'taunt', 'unleash-psyche',
    ]);
    for (const r of held) {
      const { now, before } = await choiceNowAndBefore(r);
      expect(now, `${r.id}: the held popup is the pre-step one`).toBe(before);
    }
    // A row that is NOT held opens its own page: the summoner's Defensive Robes, which by name opened
    // the sorcerer's (Player Core 2 pg. 144).
    const robes = rows.find((x) => x.id === 'defensive-robes-summoner')!;
    expect(isHeld(robes)).toBe(false);
    const m = await mount(<ChoiceDetails name={robes.name} flavor={robes.flavor} descRefs={robes.descRefs} bucket="classFeatures" id={robes.id} />);
    await click(m.host.querySelector('.cc-det'));
    const t = pageText(m.host);
    m.stop();
    expect(t).toBe(await browseText('classFeatures', 'defensive-robes-summoner'));
    expect(t).toContain('Class Summoner');
    // …and a normal class feature whose name is its own slug (Deny Advantage) shows its page.
    const plain = rows.find((x) => x.id === 'deny-advantage')!;
    expect(plain && astSlug(plain.name), 'Deny Advantage is a class feature named by its own slug').toBe('deny-advantage');
    expect(isHeld(plain)).toBe(false);
    const m3 = await mount(<ChoiceDetails name={plain.name} flavor={plain.flavor} descRefs={plain.descRefs} bucket="classFeatures" id={plain.id} />);
    await click(m3.host.querySelector('.cc-det'));
    const t3 = pageText(m3.host);
    m3.stop();
    expect(t3, 'Deny Advantage shows its page').toBe(await browseText('classFeatures', 'deny-advantage'));
  }, 120_000);

  /*
   * Refuter round 3 (MUST-FIX 1): every class feature the step RE-POINTED (its title lookup lands on
   * another page, or none) — the builder's Details popup now:
   *   - is the pre-step popup byte for byte when held, else the record's own page by id;
   *   - where it changed, is never shorter than the record's own description; and when the id page is
   *     shorter than the pre-step popup, the pre-step popup was ANOTHER record's page (another class's
   *     Weapon Expertise, the Assassin's Surprise Attack feat, the Shield Block feat …) — the
   *     wrong-record text this step exists to stop showing, never a loss of the record's own words.
   *  (A held or unchanged row can be shorter than its description — Spellstrike, Runes — exactly as it
   *   was before this step: those popups are byte-equal to the pre-step ones.)
   */
  it('no re-pointed class feature shows less than its own description, and none loses its own words against the pre-step popup', async () => {
    const rows = classFeatureRows().filter((r) => treeOf('classFeatures')?.[r.id]);
    const moved = rows.filter((r) => { const ts = astSlug(r.name); return !(astIndex[ts] === 'classFeatures' && ts === r.id); });
    for (const b of new Set(moved.map((r) => astIndex[astSlug(r.name)]).filter(Boolean))) if (treeOf(b)) await loadBucketAst(b);
    let held = 0;
    let changed = 0;
    let shorterThanBefore = 0;
    const bad: string[] = [];
    for (const r of moved) {
      const now = await choicePopupText(r);
      const desc = await descriptionText(r);
      const b4 = await mount(<DescriptionModal root={{ title: r.name, description: r.flavor, descRefs: r.descRefs }} onClose={noop} />);
      const before = txt(b4.host.querySelector('.picker-overlay'));
      b4.stop();
      const own = await mount(<DescriptionModal root={{ title: r.name, description: r.flavor, descRefs: r.descRefs, key: 'classFeatures', slug: r.id }} onClose={noop} />);
      const byId = txt(own.host.querySelector('.picker-overlay'));
      own.stop();
      if (byId !== before) changed++;
      if (isHeld(r)) { held++; if (now !== before) bad.push(`${r.id}: held, but not the pre-step popup`); continue; }
      if (now !== byId) bad.push(`${r.id}: not held, but not its own page`);
      // Unchanged (the title lookup's page is identical to the record's own): nothing moved.
      if (now === before) continue;
      // Changed: never less than the record's own description …
      if (now.length < desc.length) bad.push(`${r.id}: ${now.length} < its description's ${desc.length}`);
      // … and shorter than the pre-step popup only where that popup was another record's page.
      if (now.length < before.length) {
        shorterThanBefore++;
        const ts = astSlug(r.name);
        // The pre-step popup was a page, and not this record's.
        if (!astIndex[ts] || (astIndex[ts] === 'classFeatures' && ts === r.id)) bad.push(`${r.id}: shorter than the pre-step popup, which was not another record's page`);
      }
    }
    console.log(`card-identity: ${moved.length} class features whose title lookup lands elsewhere; ${changed} re-pointed (id page ≠ pre-step popup); ${held} held on the pre-step popup; ${shorterThanBefore} shorter than a pre-step popup that was another record's page; ${bad.length} problems`);
    // 61 title lookups land elsewhere; 5 of them land on a page identical to the record's own.
    expect([moved.length, changed]).toEqual([61, 56]);
    expect(bad).toEqual([]);
  }, 300_000);

  it('the guard\'s stub test (card-scope.mjs) and the popup\'s (shared.tsx) agree on every classFeatures and feats page', () => {
    let pages = 0;
    for (const b of ['classFeatures', 'feats']) {
      for (const [slug, t] of Object.entries(treeOf(b) ?? {})) {
        pages++;
        expect(lib.hasEmptyEmbeddedPage(t), `${b}:${slug}`).toBe(hasEmptyEmbeddedPage(t));
      }
    }
    expect(pages).toBeGreaterThan(5000);
  });

  it('descNodeOf counts the record\'s own page as something to show, by id in its own bucket', () => {
    const chalk = db.items.chalk;
    expect(chalk.description ?? '', 'Chalk ships no description string').toBe('');
    expect(treeOf('items')?.chalk, 'Chalk has a page').toBeTruthy();
    const node = descNodeOf(chalk, 'items');
    expect(node && { key: node.key, slug: node.slug, title: node.title }).toEqual({ key: 'items', slug: 'chalk', title: 'Chalk' });
    // Never by name, never in another bucket, never without an id.
    expect(descNodeOf({ name: 'Chalk' }, 'items')).toBeNull();
    expect(descNodeOf(chalk, 'feats')).toBeNull();
    expect(descNodeOf({ id: 'no-such-record-step7a', name: 'Chalk' }, 'items')).toBeNull();
  });
});
