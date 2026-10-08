// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { StrikeDetailModal, strikeOursLines } from '../src/sheet/StrikeDetailModal';
import { RecordCard } from '../src/sheet/RecordCard';
import { cardOn } from '../src/sheet/cardSurfaces';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { deriveStrikes, formatMod, type Strike } from '../src/rules/derive';
import { playerFacingContent, shownItemId } from '../src/rules/cursedItems';
import type { Character, ContentDatabase, InventoryItem, Item } from '../src/rules/types';
import type { DescNode } from '../src/sheet/descref';

/**
 * Card step 10 (docs/card-design.md section 9 row 10; sections 2, 4, 6, 7): the strike popup is the
 * weapon's 'mine' card (CARD_ON.strikeDetail).
 *
 *  - The weapon's own Archives page (items bucket, by the weapon's id — the disguise twin's for a hidden
 *    cursed weapon) replaces the imported weapon text: the longsword reads weapon-386's "Longswords can be
 *    one-edged or two-edged swords", never the old import's "also known as arming swords".
 *  - Attack bonus, Damage and the gated critical specialization stay CONTROLS above the page
 *    (RecordCard leadControls → AstRenderer lead): the same buttons and numbers, on the page, loading and
 *    no-page lanes; never on a page opened from a link inside the card (a browse card, section 6).
 *  - A weapon with no own page shows its old text with the no-page line; a homebrew weapon with
 *    "Homebrew"; a strike with no weapon (Fist, blast, natural attack) looks no page up by its name and
 *    shows the app's blurb as an ours line (section 4 kind `blurb`), with no no-page line.
 *  - A seeded sample (mulberry32 20261002, 60 weapons with a page): every line the strike card draws
 *    outside its controls and its ours box is a line of the weapon's page (the browse card for the same
 *    {items, id}); the old imported text never shows where the page does not print it; the controls
 *    carry the derive's numbers.
 *
 *  - A hidden cursed weapon (synthesized: no shipped cursed weapon has a disguise twin) reads its twin's
 *    page and pins the twin's id, never the cursed record's own page (section 2 rule 2c).
 *
 * The step-4 guard judges the surface too (fixer round 1): scripts/lib/card-scope.mjs surfaceRows models
 * a 'strikeDetail' row for each of the 1,031 weapons with a page that make a Strike (0 entries on the card;
 * legacy, switch off: S1-MISSING 4,369, EXTRA 226 in scripts/data/card-truth-baseline.json), and
 * test/card-parity.test.tsx renders a seeded 60 of them through this popup against that ledger.
 *
 * Every character here is synthesized through build() (name 't'); none is the owner's.
 *
 * MUTATION LINES (each measured red on 2026-10-07, then restored byte-exact from a scratch copy, sha1
 * checked):
 *  - RecordCard.tsx page lane: `lead={lead ?? undefined}` → `lead={undefined}` → 5 of 10 red here (the
 *    loading test's page half, longsword, level-5 crit, linked page, sample) and 4 in card-strike-action.
 *  - RecordCard.tsx browse page lane: `footer={tail} />` → `footer={tail} lead={leadControls} />` → the
 *    linked-page test red (the strike controls ride the Versatile trait's page). The `mine &&` in
 *    RecordCard's `const lead` is NOT a mutation point: every lane that draws `lead` is already a mine
 *    lane, so dropping it changes nothing (measured: 10 of 10 green).
 *  - RecordCard.tsx loading lane: `{mine ? lead : null}` → `{null}` → the loading test red (1 of 10).
 *  - StrikeDetailModal.tsx StrikeCard: `{ title: strike.name, description: '', slug: '' }` →
 *    `{ title: strike.name, description: '' }` → the blast test red (the Elemental Blast ACTION page,
 *    found by the strike's name through the page index).
 *  - StrikeDetailModal.tsx strikeOursLines: `if (hasItem) return [];` → `return [];` → the Fist and blast
 *    tests red here, the Fist test in card-strike-action.
 *  - StrikeDetailModal.tsx StrikeCard: `{showsCrit && <StrikeCrit` → `{critText && <StrikeCrit` → the
 *    longsword (level-1, no crit) test red here and in card-strike-action.
 *  - StrikeDetailModal.tsx strikeParts: `...(item ? { slug: shownItemId(item, content) } : {})` → `...({})`
 *    → the by-id test red (the longsword record named "Greatsword" opens the Greatsword page) and the
 *    homebrew test (a homebrew blade named "Longsword" then opens the official page).
 *  - (fixer round 1) StrikeDetailModal.tsx strikeParts: `slug: shownItemId(item, content)` → `slug: item.id`
 *    → the hidden cursed weapon test red (the card read the Greatsword's own page); card-identity stays
 *    green, which is why this case exists.
 *  - StrikeDetailModal.tsx StrikeCard: `footer={<p>{item?.description}</p>}` (the old import drawn as
 *    print) → the longsword and sample tests red (offPage and oldShown non-empty).
 *
 * Full corpus, measured once on 2026-10-07 with the sample's own checks (scratch runner, not committed):
 * 1,036 weapons with a page, 1,031 make a strike (the 5 handwraps make none of their own), 0 lines off
 * the page, 792 whose old imported text differs from the page and 0 of them showing it, 0 wrong numbers.
 */
const db: ContentDatabase = content();
const readBucket = (b: string) => JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')) as Record<string, AstNode>;
const ITEMS = readBucket('items');
const ACTIONS = readBucket('actions');
const TRAITS = readBucket('trait');
const INDEX = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;

/* The items bucket is held back until `releaseItems()`, so the first test sees the loading lane. */
let releaseItems: () => void = () => undefined;
const itemsGate = new Promise<void>((r) => { releaseItems = r; });
const served: Record<string, unknown> = { items: ITEMS, actions: ACTIONS, trait: TRAITS };
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch =(async (input: unknown) => {
    const url = String(input);
    if (/ast-index\.json$/.test(url)) return new Response(JSON.stringify(INDEX), { status: 200, headers: { 'content-type': 'application/json' } });
    const m = /ast\/([A-Za-z0-9_-]+)\.json$/.exec(url);
    if (!m || !served[m[1]]) return new Response('', { status: 404 });
    if (m[1] === 'items') await itemsGate;
    return new Response(JSON.stringify(served[m[1]]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const toggled: DescNode[] = [];
const pin: PinDescApi = { has: () => false, toggle: (n) => void toggled.push(n) };
let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
  toggled.length = 0;
});
async function mount(el: ReactElement, cdb: ContentDatabase = db): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={cdb}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  stops.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
async function click(el: Element | null | undefined) {
  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const txt = (el: Element | null | undefined) => norm(el?.textContent);

/** A synthesized level-5 fighter wielding `itemId` (Fighter Weapon Mastery: the crit-spec source). */
const wielder = (itemId: string, level = 5, cdb: ContentDatabase = db): { c: Character; s: Strike | undefined } => {
  const inventory: InventoryItem[] = [{ instanceId: 'i-w', itemId, quantity: 1, equipped: true }];
  const c = { ...build('fighter', level), inventory } as Character;
  return { c, s: deriveStrikes(c, cdb).find((x) => x.instanceId === 'i-w') };
};
const strikeEl = (s: Strike, c: Character, cdb: ContentDatabase = db) => <StrikeDetailModal strike={s} character={c} content={cdb} onClose={() => undefined} />;
/** The card's page lane, or throws. */
const pageCard = (host: Element) => {
  const card = host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  if (!card || !card.querySelector('.ast-pop > .ast-body') || card.querySelector('.ast-loading')) throw new Error('no strike card on the page lane');
  return card;
};
const statsOf = (el: Element) => [...el.querySelectorAll('.strike-detail-stat')].map((b) => [txt(b.querySelector('.sds-label')), txt(b.querySelector('.sds-value'))]);
const LEAF = 'p, li, td, th, .ast-h1, .ast-h2, .ast-h3, .ast-h4, summary';
/** The card's own text blocks: leaf blocks in the body outside the controls and the ours box. */
const cardBlocks = (card: Element) =>
  [...card.querySelectorAll(`.ast-pop > .ast-body :is(${LEAF})`)]
    .filter((b) => !b.closest('[data-ours], .card-controls') && !b.querySelector(LEAF))
    .map((b) => txt(b))
    .filter(Boolean);

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function draw<T>(pool: T[], n: number, rng: () => number): T[] {
  const a = pool.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
describe.runIf(cardOn('strikeDetail'))('card step 10: the strike popup is the weapon\'s mine card', () => {
  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('while the page loads, Attack bonus and Damage are already on the card (loading lane); then the page replaces the placeholder', async () => {
    const { c, s } = wielder('longsword', 1);
    const host = await mount(strikeEl(s!, c));
    const loading = host.querySelector('.ast-modal.card-mine .ast-body.ast-loading') as HTMLElement | null;
    // Read before the bucket is released, judged after: a red here never holds the later tests' bucket back.
    const seen = { waiting: !!loading, stats: loading ? statsOf(loading) : [], text: txt(host) };
    releaseItems();
    await loadBucketAst('items');
    await loadAstIndex();
    await settle();
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(seen.waiting, 'the card waits for the weapon page').toBe(true);
    expect(seen.stats).toEqual([['Attack bonus', '+5'], ['Damage', '1d8 S']]);
    expect(seen.text).not.toContain('also known as arming swords');
    expect(statsOf(pageCard(host))).toEqual([['Attack bonus', '+5'], ['Damage', '1d8 S']]);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('the longsword: weapon-386\'s words, the controls first in the page body, the page\'s own lines dimmed or as print, no old import text', async () => {
    const { c, s } = wielder('longsword', 1);
    const card = pageCard(await mount(strikeEl(s!, c)));
    const body = card.querySelector('.ast-pop > .ast-body') as HTMLElement;
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(body.firstElementChild?.className).toBe('card-controls card-lead');
    expect(statsOf(body.firstElementChild!)).toEqual([['Attack bonus', formatMod(s!.attack[0])], ['Damage', s!.damage]]);
    expect(body.querySelector('.strike-detail-crit'), 'a level-1 fighter has no crit specialization').toBeNull();
    const blocks = cardBlocks(card);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(blocks).toContain("Longswords can be one-edged or two-edged swords. Their blades are heavy and they're between 3 and 4 feet in length.");
    expect(txt(card)).not.toContain('also known as arming swords');
    expect(txt(card.querySelector('.card-dim'))).toBe('Source Player Core pg. 278');
    // S-furniture and S-items: no "Click here" line, no Specific Magic Weapons list.
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(txt(card)).not.toContain('Click here');
    expect(txt(card)).not.toContain('Specific Magic Weapons');
    expect(txt(card.querySelector('.ast-name'))).toBe('Longsword');
  });

  // batch card premise: weapon-group-15 "The target is made off-balance by your attack, becoming off-guard until the start of your next turn"
  it('at level 5 the sword group\'s critical specialization is a control above the page, after the two stats', async () => {
    const { c, s } = wielder('longsword', 5);
    const card = pageCard(await mount(strikeEl(s!, c)));
    const lead = card.querySelector('.ast-pop > .ast-body > .card-lead') as HTMLElement;
    // batch card premise: weapon-group-15 "The target is made off-balance by your attack, becoming off-guard until the start of your next turn"
    expect([...lead.children].map((k) => k.className)).toEqual(['strike-detail-stats', 'strike-detail-crit']);
    expect(txt(lead.querySelector('.sd-critspec-text'))).toBe('The target is off-guard until the start of your next turn.');
    expect(card.querySelectorAll('.strike-detail-crit')).toHaveLength(1);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a page opened from a link inside the card is a browse card: no strike controls on it, and Back returns to the weapon with them', async () => {
    const { c, s } = wielder('longsword', 5);
    const host = await mount(strikeEl(s!, c));
    const link = [...pageCard(host).querySelectorAll('.ast-pop > .ast-body a, .ast-traits a')].find((a) => !a.closest('.card-controls')) ?? null;
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(link, 'the longsword page links somewhere (a trait chip at least)').toBeTruthy();
    await click(link);
    expect(host.querySelector('.info-back'), 'drilled in').not.toBeNull();
    // The linked page (the Versatile trait's) is drawn as a page — the browse card's page lane.
    expect(txt(host.querySelector('.ast-modal:not(.card-mine) .ast-name'))).toBe('Versatile');
    expect(host.querySelector('.strike-detail-stat'), 'the linked page carries no strike controls').toBeNull();
    await click(host.querySelector('.info-back'));
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(statsOf(pageCard(host))).toHaveLength(2);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('by id: a weapon whose name slugs to another page (a synthesized longsword record named "Greatsword") opens its own page and pins its id', async () => {
    // No shipped weapon's name lands on a page with other words (the 25 whose name slug is not their id
    // land on a text-identical twin, measured 2026-10-07), so the renamed record is synthesized: the
    // strike's name is the item's name, and a name can be anything.
    const cdb = { ...db, items: { ...db.items, longsword: { ...(db.items.longsword as Item), name: 'Greatsword' } } } as ContentDatabase;
    const { c, s } = wielder('longsword', 1, cdb);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(s?.name).toBe('Greatsword');
    const card = pageCard(await mount(strikeEl(s!, c, cdb), cdb));
    const blocks = cardBlocks(card);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(blocks).toContain("Longswords can be one-edged or two-edged swords. Their blades are heavy and they're between 3 and 4 feet in length.");
    expect(blocks.some((b) => b.startsWith('This immense two-handed sword')), 'not the Greatsword page').toBe(false);
    await click(card.querySelector('.info-star'));
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(toggled.map((n) => [n.title, n.key, n.slug, (n as { mode?: string }).mode])).toEqual([['Greatsword', 'items', 'longsword', 'mine']]);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a hidden cursed weapon opens its disguise twin\'s page and pins the twin\'s id — never the cursed record\'s own page (section 2 rule 2c)', async () => {
    // No shipped cursed weapon has a disguise twin (0 of db.items' weapons carry `disguisedAs`, measured
    // 2026-10-07), so the pair is synthesized: a record whose OWN page has other words (the Greatsword's)
    // is planted hidden, wearing the Longsword (playerFacingContent), as card-identity does with the real
    // Bag of Devouring. The card must read weapon-386, the page of the record it SHOWS.
    const raw = { ...db, items: { ...db.items, greatsword: { ...(db.items.greatsword as Item), disguisedAs: 'longsword' } } } as ContentDatabase;
    const inv = { instanceId: 'i-w', itemId: 'greatsword', quantity: 1, equipped: true, hiddenCurse: true } as InventoryItem;
    const cdb = playerFacingContent(raw, [inv]);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(ITEMS.greatsword, 'the cursed record has a page of its own').toBeTruthy();
    expect(shownItemId(cdb.items.greatsword, cdb)).toBe('longsword');
    const c = { ...build('fighter', 5), inventory: [inv] } as Character;
    const s = deriveStrikes(c, cdb).find((x) => x.instanceId === 'i-w');
    expect(s?.name, 'the strike wears the disguise').toBe('Longsword');
    const card = pageCard(await mount(strikeEl(s!, c, cdb), cdb));
    const blocks = cardBlocks(card);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(blocks).toContain("Longswords can be one-edged or two-edged swords. Their blades are heavy and they're between 3 and 4 feet in length.");
    expect(txt(card), 'none of the cursed record\'s own page').not.toContain('This immense two-handed sword');
    expect(txt(card.querySelector('.ast-name'))).toBe('Longsword');
    await click(card.querySelector('.info-star'));
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(toggled.map((n) => [n.title, n.key, n.slug, (n as { mode?: string }).mode])).toEqual([['Longsword', 'items', 'longsword', 'mine']]);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a weapon with no page of its own (Makeshift Staff) keeps its old text, with the controls above it and the no-page line', async () => {
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(ITEMS['makeshift-staff'], 'no page ships').toBeUndefined();
    const { c, s } = wielder('makeshift-staff');
    expect(s, 'the staff makes a strike').toBeTruthy();
    const host = await mount(strikeEl(s!, c));
    const pop = host.querySelector('.picker.info-modal.card-mine') as HTMLElement;
    expect(txt(pop.querySelector('.info-title'))).toBe(s!.name);
    const body = pop.querySelector('.info-body.card-body') as HTMLElement;
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(statsOf(body.querySelector('.card-lead')!)).toEqual([['Attack bonus', formatMod(s!.attack[0])], ['Damage', s!.damage]]);
    const old = norm(db.items['makeshift-staff'].description).slice(0, 40);
    expect(old.length).toBeGreaterThan(0);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(txt(body.querySelector('.sd-desc'))).toContain(old);
    expect(txt(body.querySelector('[data-ours-kind="noPage"]'))).toBe('Not from the Archives — our text');
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a homebrew weapon shows its own text with the controls and the "Homebrew" line, and never an official page of the same name', async () => {
    const hb: Item = { ...(db.items.longsword as Item), id: 'hb-test-blade', name: 'Longsword', description: 'A synthesized homebrew blade for this test.', source: { book: 'Homebrew', license: 'homebrew' } } as Item;
    const cdb = { ...db, items: { ...db.items, 'hb-test-blade': hb } } as ContentDatabase;
    const { c, s } = wielder('hb-test-blade', 5, cdb);
    expect(s, 'the homebrew blade makes a strike').toBeTruthy();
    const host = await mount(strikeEl(s!, c, cdb), cdb);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(host.querySelector('.ast-modal'), 'no page drawn for a homebrew record').toBeNull();
    const body = host.querySelector('.picker.info-modal.card-mine .info-body.card-body') as HTMLElement;
    expect(statsOf(body)).toEqual([['Attack bonus', formatMod(s!.attack[0])], ['Damage', s!.damage]]);
    expect(txt(body.querySelector('.sd-desc'))).toBe('A synthesized homebrew blade for this test.');
    expect(txt(body.querySelector('[data-ours-kind="noPage"]'))).toBe('Homebrew');
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('the Fist: the blurb is an ours line (kind blurb), no page, no no-page line; the star pins the key-only node it always pinned', async () => {
    const { c } = wielder('longsword', 1);
    const fist = deriveStrikes(c, db).find((x) => x.instanceId === 'fist')!;
    const host = await mount(strikeEl(fist, c));
    const pop = host.querySelector('.picker.info-modal.card-mine') as HTMLElement;
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(txt(pop.querySelector('.info-title'))).toBe('Fist');
    expect(statsOf(pop)).toEqual([['Attack bonus', formatMod(fist.attack[0])], ['Damage', fist.damage]]);
    const blurb = pop.querySelector('.card-ours[data-ours] [data-ours-kind="blurb"]');
    expect(txt(blurb)).toBe(strikeOursLines(fist, false)[0].text);
    expect(txt(blurb)).toMatch(/^An unarmed Strike with your fist/);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(pop.querySelector('.card-nopage')).toBeNull();
    expect(pop.querySelector('.sd-desc')).toBeNull();
    await click(pop.querySelector('.info-star'));
    expect(toggled.map((n) => [n.title, n.key, n.slug, (n as { mode?: string }).mode, n.description])).toEqual([['Fist', 'items', undefined, 'mine', strikeOursLines(fist, false)[0].text]]);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a kineticist blast named "Elemental Blast" looks no page up by its name (the page index maps that slug to the ACTION page)', async () => {
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(INDEX['elemental-blast'], 'the index would find the action page by this name').toBe('actions');
    const { c } = wielder('longsword', 1);
    const fist = deriveStrikes(c, db).find((x) => x.instanceId === 'fist')!;
    const blast: Strike = { ...fist, instanceId: 'blast:fire', name: 'Elemental Blast' };
    const host = await mount(strikeEl(blast, c));
    expect(host.querySelector('.ast-modal'), 'no page drawn').toBeNull();
    const pop = host.querySelector('.picker.info-modal.card-mine') as HTMLElement;
    // batch card premise: action-2125 "Elemental Blast"
    expect(txt(pop.querySelector('[data-ours-kind="blurb"]'))).toMatch(/^Your kineticist Elemental Blast/);
    expect(pop.querySelector('.card-nopage')).toBeNull();
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a seeded sample of 60 weapons with a page: every line the card draws outside its controls and ours box is the page\'s; the old import never shows where the page does not print it; the controls carry the derive\'s numbers', async () => {
    const pool = Object.values(db.items)
      .filter((i) => i.itemType === 'weapon' && ITEMS[i.id])
      .map((i) => i.id)
      .sort();
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(pool.length).toBeGreaterThan(1000);
    const sample = draw(pool, 60, mulberry32(20261002));
    let judged = 0;
    const noStrike: string[] = [];
    const offPage: string[] = [];
    const oldShown: string[] = [];
    const statsWrong: string[] = [];
    for (const id of sample) {
      const { c, s } = wielder(id);
      if (!s) { noStrike.push(id); continue; }
      const host = await mount(strikeEl(s, c));
      const card = pageCard(host);
      const browse = await mount(<RecordCard record={{ bucket: 'items', id }} mode="browse" chrome="popup" onExit={() => undefined} />);
      const page = txt(browse.querySelector('.ast-pop > .ast-body'));
      for (const b of cardBlocks(card)) for (const part of b.split('; ')) if (!page.includes(part)) offPage.push(`${id}: ${part}`);
      const old = norm(db.items[id].description);
      if (old && !page.includes(old) && txt(card).includes(old)) oldShown.push(id);
      const want = [['Attack bonus', formatMod(s.attack[0])], ['Damage', s.damage]];
      if (JSON.stringify(statsOf(card.querySelector('.card-lead')!)) !== JSON.stringify(want)) statsWrong.push(id);
      judged += 1;
      for (const st of stops.splice(0)) st();
    }
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(offPage).toEqual([]);
    expect(oldShown).toEqual([]);
    expect(statsWrong).toEqual([]);
    // Measured 2026-10-07: 59 of the 60 sampled weapons make a strike for a fighter wielding them; Dragon
    // Handwraps make none of their own (handwraps etch onto the unarmed attacks).
    expect({ judged, noStrike }).toEqual({ judged: 59, noStrike: ['dragon-handwraps'] });
  }, 120_000);
});
