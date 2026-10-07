// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ItemDetail, itemStatRows } from '../src/sheet/ItemDetail';
import { RecordCard } from '../src/sheet/RecordCard';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { StrikeDetailModal } from '../src/sheet/StrikeDetailModal';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { cardOn } from '../src/sheet/cardSurfaces';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { aonIndex, embedsPage, printedWeaponGroups, resolveStubs, stubIds, stubRefs, type StubbedNode } from '../src/sheet/astStubs';
import { cardStatHeadMask, recordTree, withoutItemLists } from '../src/sheet/astVisibility';
import { printedSet } from '../src/sheet/cardScope';
import { CRIT_SPEC, critSpecPageRef } from '../src/rules/critSpec';
import { deriveStrikes } from '../src/rules/derive';
import { unresolvedStubs } from '../scripts/lib/card-scope.mjs';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';
import type { DescNode } from '../src/sheet/descref';

/** The item switch, read through a mock so one case can turn it back (section 9: "Turning a surface back
 *  is therefore one line, and its tests still hold") without editing src/sheet/cardSurfaces.ts — the
 *  pattern of test/card-action.test.tsx. Undefined = the real CARD_ON.itemDetail. */
const sw = vi.hoisted(() => ({ itemDetail: undefined as boolean | undefined }));
vi.mock('../src/sheet/cardSurfaces', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sheet/cardSurfaces')>();
  return { ...real, cardOn: (s: Parameters<typeof real.cardOn>[0]) => (s === 'itemDetail' && sw.itemDetail !== undefined ? sw.itemDetail : real.cardOn(s)) };
});

/**
 * Card step 14 (docs/card-design.md section 9 row 14; section 2 rules 4–6; section 5 "Item controls and
 * computed rows" and "Crit-spec block"): the item popup's description is the SHOWN record's 'mine' card
 * (CARD_ON.itemDetail, RecordCard chrome 'inset'), inside ItemDetail's own frame.
 *
 *  - Embedded page stubs (src/sheet/astStubs.ts): a weapon's page draws its group's page under "Critical
 *    Specialization Effects", an armor's its specialization — one level deep, with a visited set, so a
 *    page that embeds itself (or a page embedding a page that embeds it back) never loops.
 *  - The critical specialization is drawn ONCE: where the page draws the group's page, the popup's own
 *    sentence (src/rules/critSpec.ts) leaves; where it does not, the sentence stays, marked ours.
 *  - Activate / Access / Craft Requirements come from the PAGE by the printed-set rule (the frame's stat
 *    block, itemStatRows, prints the rest): Price, Bulk, Usage, Damage … are printed once.
 *  - The frame keeps every control and the phone Remove bar outside the scrolling body.
 *  - The browse card of an item page draws its stubs too; the strike card keeps its "only if you have it"
 *    gate (it draws no stub).
 *
 * Fixtures: shipped records only (longsword, full plate, healing potion, a 1st-rank scroll, Abadar's
 * Flawless Scale, ablative armor plating, the dwarven thrower, the alchemical crossbow, the axe musket's melee
 * half, the fighter kit) and
 * synthesized trees; the characters are
 * synthesized through build() (name 't'). None is the owner's.
 *
 * MUTATION LINES (each measured red on 2026-10-07, then restored byte-exact from a scratch copy):
 *  - astStubs.ts resolveStubs: `if (visited.has(ref)) return n;` → `if (false) return n;` → the
 *    self-embedding / duplicate-stub tests red.
 *  - astStubs.ts resolveStubs: `c: demoted(page.c ?? [], …)` → `c: page.c ?? []` → the heading test red
 *    (the embedded page's level-1 title is swallowed: no "Sword" heading).
 *  - astStubs.ts resolveStubs: `c: demoted(page.c ?? [], …)` → `c: demoted(walk(page, depth + 1).c ?? [], …)`
 *    (resolve inside the embedded page) → the "one level deep" A2 → B2 → DEEP test red.
 *  - RecordCard.tsx InsetRecordCard no-page lane: the #152 note, the "Homebrew" line or the no-page line
 *    replaced by other words → the agate / homebrew / Abrogail I Script footer tests red.
 *  - ItemDetail.tsx: the inset card's `stubs` prop removed → longsword / full plate / browse-equals-card red.
 *  - ItemDetail.tsx: `const showCrit = !!critText && (!itemCard || …)` → `const showCrit = !!critText` → the
 *    longsword "once" test red (the effect in two wordings).
 *  - astVisibility.ts cardDropsPrintedP: `return leads.length > 0 && …` → `return false &&` → the
 *    healing potion / longsword stat-line tests red (Price, Usage, Damage printed twice).
 *  - astVisibility.ts cardStatHeadMask: the variant-run loop removed → the ablative armor plating test red.
 *  - RecordCard.tsx browse lane: `node={browseTree ?? astNode}` → `node={astNode}` → the browse test red.
 * Added by the step-14 fixer (each measured red on 2026-10-07 through scratch card-step14-fx-mutate.mjs,
 * restored byte-exact, the file green again):
 *  - M7 ItemDetail.tsx pageDrawsCrit: the pending branch `stubRefs(…).some(refInBucket …)` → the resolved
 *    check `embedsFromBucket(drawnPage, …)` only → the loading cases (a)/(b) and (c) red (ours flashes in
 *    while the Sword bucket loads).
 *  - M7b ItemDetail.tsx: `(!itemCard || (!pageLoading && !pageDrawsCrit))` → `(!itemCard || !pageDrawsCrit)`
 *    → the loading case (c) red (ours drawn before the item page is known).
 *  - (decision C, withdrawn in round 2 — replaced by the two rule C2 lines below.)
 * Added by the step-14 fixer, round 2 (rule C2; each measured red on 2026-10-08 through scratch
 * card-step14-fx2-mutate.mjs, restored byte-exact, the file green again):
 *  - C2-own ItemDetail.tsx: `const pageDrawsCrit = pageDrawsOwnGroup || …` → `pageDrawsAGroup || …` (the
 *    'own group' test dropped to 'any group') → the axe musket test red (our axe sentence hidden).
 *  - C2-print ItemDetail.tsx: `pageDrawsOwnGroup || (pageDrawsAGroup && !pagePrintsOwnGroup)` →
 *    `pageDrawsOwnGroup` (the 'prints no group' branch removed) → the alchemical crossbow test red (our
 *    crossbow sentence beside the page's Bow effect).
 *  - C2-label astStubs.ts printedWeaponGroups: `if (k.t !== 'b' || flat(k).trim() !== 'Group') return;` →
 *    `if (k.t !== 'b') return;` (any bold label read as a group) → the drift-file, axe musket, longsword and
 *    synthetic printedWeaponGroups tests red.
 *  - E-pin scripts/data/card-truth-baseline.json: a fourth itemDetail CUT-IN-SENTENCE entry added → the
 *    CUT-IN-SENTENCE pin test red.
 *
 * CUT-IN-SENTENCE (orchestrator decision E, round 2): the card truth baseline keeps three itemDetail entries
 * (scripts/data/card-truth-baseline.json "CUT-IN-SENTENCE") for silver armor — aon-silver-armor, silver-armor
 * and silver-armor-low-grade. They are PAGE-side, not ours: equipment-2803 prints the Low-Grade paragraph as
 * "silver worth at least 70 sp + 7 sp per Bulk" without the opening clause the Standard- and High-Grade
 * paragraphs carry ("The initial raw materials must include …"). The baseline has no per-entry reason field
 * and --write-baseline rewrites the file from the ledger alone (scripts/card-truth-check.mjs, the `out`
 * object: _measured, the sections, legacy), so a `_why` sidecar there would be dropped at the next re-stamp;
 * the reason lives here instead, beside the test that pins those three ids so the list cannot grow silently.
 *  - astVisibility.ts cardStatHeadMask no-rule branch: `mask[k] = true;` → `void lead;` → the class kit
 *    test red (Price and Bulk printed twice).
 *  - astStubs.ts browseResolvesStubs: `cardOn('itemDetail') &&` removed → the turned-back test red (the
 *    browse card keeps drawing the Sword page with the switch off).
 */
const db: ContentDatabase = content();
const AST_DIR = 'public/ast';
const trees: Record<string, Record<string, AstNode>> = {};
const treeOf = (b: string): Record<string, AstNode> | undefined => {
  if (trees[b]) return trees[b];
  try { trees[b] = JSON.parse(gunzipSync(readFileSync(`${AST_DIR}/${b}.json.gz`)).toString('utf8')); } catch { return undefined; }
  return trees[b];
};
const INDEX = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (/ast-index\.json$/.test(url)) return new Response(JSON.stringify(INDEX), { status: 200 });
    const m = /ast\/([A-Za-z0-9_-]+)\.json$/.exec(url);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? new Response(JSON.stringify(t), { status: 200 }) : new Response('', { status: 404 });
  }) as typeof fetch;
  await loadAstIndex();
  for (const b of ['items', 'weaponGroup', 'armorGroup', 'actions', 'trait', 'conditions']) await loadBucketAst(b);
}, 120_000);

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const pin: PinDescApi = { has: () => false, toggle: () => undefined };
let stops: (() => void)[] = [];
afterEach(() => { for (const s of stops) s(); stops = []; sw.itemDetail = undefined; });
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
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const invOf = (itemId: string, over: Partial<InventoryItem> = {}): InventoryItem => ({ instanceId: `i-${itemId}`, itemId, quantity: 1, ...over }) as InventoryItem;
/** The item popup as the Inventory tab opens it. */
async function itemPopup(itemId: string, opts: { onPlay?: () => void; mobile?: boolean; character?: Character } = {}): Promise<HTMLElement> {
  const inv = invOf(itemId);
  const el = <ItemDetail inv={inv} item={db.items[itemId]} content={db} inventory={[inv]} character={opts.character} onPlay={opts.onPlay as never} onClose={() => undefined} />;
  return mount(opts.mobile === undefined ? el : <ForceMobileContext.Provider value={opts.mobile}>{el}</ForceMobileContext.Provider>);
}
/** The card body inside the popup (RecordCard chrome 'inset'). */
const cardBody = (host: HTMLElement) => host.querySelector('.picker.spell-detail .sd-body > .sd-desc.card-inset');

/* Decision E (see the CUT-IN-SENTENCE paragraph in the header): the item popup's cut-in-sentence entries in
 * the card truth baseline are exactly the three silver armor rows, page-side. A fourth fails here before it
 * can sit in the baseline unexplained. */
describe('card step 14: the itemDetail CUT-IN-SENTENCE baseline is the three page-side silver armor rows', () => {
  // batch card premise: equipment-2803 "silver worth at least 70 sp + 7 sp per Bulk"
  it('pins the three ids, and the Low-Grade page prints its paragraph without the opening clause', () => {
    const base = JSON.parse(readFileSync('scripts/data/card-truth-baseline.json', 'utf8')) as Record<string, unknown>;
    const cut = (base['CUT-IN-SENTENCE'] as string[]).filter((e) => e.startsWith('itemDetail|'));
    expect(cut).toEqual([
      'itemDetail|items:aon-silver-armor|silver worth at least 70 sp + 7 sp per Bulk',
      'itemDetail|items:silver-armor-low-grade|silver worth at least 70 sp + 7 sp per Bulk',
      'itemDetail|items:silver-armor|silver worth at least 70 sp + 7 sp per Bulk',
    ]);
    for (const id of ['aon-silver-armor', 'silver-armor', 'silver-armor-low-grade']) expect(db.items[id].aonId?.startsWith('equipment-2803'), id).toBe(true);
    const flat = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flat).join(' '));
    const page = flat(treeOf('items')!['silver-armor-low-grade']).replace(/\s+/g, ' ');
    expect(page).toContain('silver worth at least 70 sp + 7 sp per Bulk');
    expect(page, 'the Low-Grade paragraph has no opening clause on the page').not.toMatch(/must include silver worth at least 70 sp/);
    expect(page, 'the Standard-Grade one does').toContain('The initial raw materials must include silver worth at least 150 gp + 15 gp per Bulk');
  });
});

describe('card step 14: embedded page stubs (astStubs.ts)', () => {
  const t = (v: string): AstNode => ({ t: 'text', v });
  const p = (v: string): AstNode => ({ t: 'p', c: [t(v)] });
  const stub = (id: string): AstNode => ({ t: 'document', level: 2, id } as AstNode);
  const page = (name: string, ...body: AstNode[]): AstNode => ({ t: 'doc', c: [{ t: 'title', level: 1, c: [p(name)] }, { t: 'hr' }, ...body] });
  const A = page('Page A', p('Words of A.'), stub('aon-b'), stub('aon-a'));
  const B = page('Page B', p('Words of B.'), stub('aon-a'));
  // A chain A2 → B2 → DEEP where DEEP is no page already drawn: only the depth limit keeps it out.
  const A2 = page('Page A2', p('Words of A2.'), stub('aon-b2'));
  const B2 = page('Page B2', p('Words of B2.'), stub('aon-deep'));
  const DEEP = page('Page Deep', p('Words of Deep.'));
  const synthetic: Record<string, AstNode> = { 'x:a': A, 'x:b': B, 'x:a2': A2, 'x:b2': B2, 'x:deep': DEEP };
  const SLUG_OF: Record<string, string> = { 'aon-a': 'a', 'aon-b': 'b', 'aon-a2': 'a2', 'aon-b2': 'b2', 'aon-deep': 'deep' };
  const candidates = (id: string) => (SLUG_OF[id] ? [{ bucket: 'x', slug: SLUG_OF[id] }] : undefined);
  const synthTree = (b: string, s: string) => synthetic[`${b}:${s}`];
  const flat = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flat).join(' '));

  it('a page that embeds itself, and a page that embeds a page embedding it back, never loop (visited set)', () => {
    const out = resolveStubs(A, 'x:a', candidates, synthTree);
    // The B stub draws B; A's own stub (the host) draws nothing; B's stub back to A stays empty.
    const embedded = (out.c ?? []).filter((n) => (n as StubbedNode).stubOf);
    expect(embedded.map((n) => (n as StubbedNode).stubOf)).toEqual(['x:b']);
    const self = (out.c ?? []).find((n) => (n as StubbedNode).id === 'aon-a')!;
    expect(self.c ?? [], 'the host page is never embedded in itself').toEqual([]);
    const inner = embedded[0].c!.find((n) => (n as StubbedNode).id === 'aon-a')!;
    expect(inner.c ?? [], 'the embedded page\'s stub back to the host stays empty').toEqual([]);
    expect(flat(out)).toContain('Words of B.');
    expect(count(flat(out), 'Words of A.'), 'A is drawn once').toBe(1);
    // Two stubs naming one page: the second draws nothing.
    const twice = page('Page C', stub('aon-b'), stub('aon-b'));
    expect(resolveStubs(twice, 'x:c', candidates, synthTree).c!.filter((n) => (n as StubbedNode).stubOf).length).toBe(1);
    // And it renders: the real AstRenderer draws the self-embedding page once, with B inside [data-stub].
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<AstRenderer node={out} bodyOnly onOpenRef={() => undefined} card={{ printed: printedSet([]) }} />); });
    expect(count(txt(host), 'Words of A.')).toBe(1);
    expect(txt(host.querySelector('[data-stub="x:b"]'))).toContain('Words of B.');
    act(() => root.unmount());
    host.remove();
  });

  it('one level deep: an embedded page\'s own stub stays empty even when it names a page not yet drawn (depth 1)', () => {
    const out = resolveStubs(A2, 'x:a2', candidates, synthTree);
    const b2 = (out.c ?? []).find((n) => (n as StubbedNode).stubOf === 'x:b2');
    expect(b2, 'A2 draws B2').toBeTruthy();
    expect(flat(out)).toContain('Words of B2.');
    const deep = b2!.c!.find((n) => (n as StubbedNode).id === 'aon-deep');
    expect(deep, 'B2 keeps its stub node').toBeTruthy();
    expect(deep!.c ?? [], 'the second level is never resolved').toEqual([]);
    expect((deep as StubbedNode).stubOf).toBeUndefined();
    expect(flat(out)).not.toContain('Words of Deep.');
    // The same page drawn as the host resolves its own stub: the limit is depth, not the page.
    expect(flat(resolveStubs(B2, 'x:b2', candidates, synthTree))).toContain('Words of Deep.');
  });

  it('the embedded page\'s name prints as the stub\'s heading (its level-1 title moved down to level 2)', () => {
    const out = resolveStubs(A, 'x:a', candidates, synthTree);
    const b = (out.c ?? []).find((n) => (n as StubbedNode).stubOf === 'x:b')!;
    expect(b.c![0]).toMatchObject({ t: 'title', level: 2 });
    const lone = page('Lone', p('no stub'));
    expect(resolveStubs(lone, 'x:l', candidates, synthTree), 'a page with no stub is the very same tree').toBe(lone);
  });

  it('every stub on every item page resolves exactly where the guard says it does (STUBS agreement)', () => {
    const idx = aonIndex(db);
    const items = treeOf('items')!;
    const aonIds = new Set([...idx.keys()]);
    let resolved = 0;
    let pagesWithStubs = 0;
    for (const [slug, tree] of Object.entries(items)) {
      const ids = stubIds(tree);
      if (!ids.length) continue;
      pagesWithStubs++;
      for (const b of new Set(ids.flatMap((id) => (idx.get(id) ?? []).map((x) => x.bucket)))) treeOf(b);
      const out = resolveStubs(tree, `items:${slug}`, (id) => idx.get(id), (b, s) => trees[b]?.[s]);
      // What stays empty after resolution is the guard's unresolved list (scripts/lib/card-scope.mjs
      // unresolvedStubs, the STUBS section), plus a repeat of a page already drawn (the visited set).
      const left = stubIds(out);
      const guard = new Set((unresolvedStubs(tree, aonIds) as string[]).filter((g) => g !== '(no id)'));
      const drawn = new Set<string>();
      (function walk(n: AstNode) { const s = n as StubbedNode; if (s.stubOf && s.id) drawn.add(String(s.id)); for (const c of n.c ?? []) walk(c); })(out);
      for (const g of guard) expect(left, `items:${slug} keeps ${g} empty`).toContain(g);
      for (const l of left) expect(guard.has(l) || drawn.has(l), `items:${slug}: ${l} left empty only when the guard lists it or it repeats`).toBe(true);
      resolved += ids.length - left.length;
      // Every page the stubs name is drawn (none of them is the host page itself on the shipped data).
      for (const ref of stubRefs(tree, idx)) expect(embedsPage(out, ref), `items:${slug} draws ${ref}`).toBe(true);
    }
    // Measured 2026-10-07: 419 stubs on 418 item pages, 418 resolve (the one left names no record).
    expect(pagesWithStubs).toBeGreaterThan(400);
    expect(resolved).toBeGreaterThan(400);
  });
});

/* Section 9: a landed surface's switch turns back in one line and its tests still hold — the card's
 * assertions run while CARD_ON.itemDetail is on, the legacy popup's below while it is off. */
describe.skipIf(!cardOn('itemDetail'))('card step 14: the item popup is the record\'s card (CARD_ON.itemDetail)', () => {
  it('the description is the inset mine card', async () => {
    const host = await itemPopup('longsword');
    expect(cardBody(host), 'the inset card draws the description').toBeTruthy();
    expect(cardBody(host)!.querySelector('.ast-body.ast-embed')).toBeTruthy();
  });

  // batch card premise: weapon-group-15 "becoming off-guard until the start of your next turn"
  it('longsword: its group\'s effect is drawn from the Sword page, ONCE — not again in our own words', async () => {
    const host = await itemPopup('longsword');
    const pop = host.querySelector('.picker.spell-detail')!;
    const stubEl = cardBody(host)!.querySelector('[data-stub="weaponGroup:sword"]');
    expect(stubEl, 'the Sword page is embedded where the longsword page names it').toBeTruthy();
    expect(count(txt(pop), 'becoming off-guard until the start of your next turn')).toBe(1);
    expect(txt(pop)).not.toContain(CRIT_SPEC.sword);
    expect(pop.querySelector('.sd-critspec'), 'our sentence leaves when the page prints the effect').toBeNull();
    // batch card premise: weapon-386 "The exact effect depends on which weapon group your weapon belongs to, as listed below"
    expect(txt(cardBody(host))).toContain('as listed below');
    // The embedded page's own name and badge head it, as the Archives draws it.
    expect(txt(stubEl!.querySelector('.ast-h2'))).toMatch(/^Sword\s*Weapon Critical Specialization/);
  });

  // batch card premise: armor-group-4 "You gain resistance to slashing damage equal to 1 + the value of the armor’s potency rune for medium armor"
  it('full plate: the plate resistance is printed (it was printed nowhere before)', async () => {
    const host = await itemPopup('full-plate');
    const stubEl = cardBody(host)!.querySelector('[data-stub="armorGroup:plate"]');
    expect(stubEl).toBeTruthy();
    expect(txt(stubEl)).toContain('You gain resistance to slashing damage equal to 1 + the value of the armor’s potency rune for medium armor');
  });

  it('the embedded words are the target page\'s own: the same text as the Sword page\'s browse card', async () => {
    const item = await itemPopup('longsword');
    const embedded = txt(cardBody(item)!.querySelector('[data-stub="weaponGroup:sword"]'));
    const browse = await mount(<RecordCard record={{ bucket: 'weaponGroup', id: 'sword' }} mode="browse" chrome="popup" onExit={() => undefined} />);
    const name = txt(browse.querySelector('.ast-head .ast-name'));
    const body = txt(browse.querySelector('.ast-pop > .ast-body'));
    expect(name).toBe('Sword');
    expect(embedded.replace(/\s+/g, '')).toBe(`${name}WeaponCriticalSpecialization${body}`.replace(/\s+/g, ''));
  });

  // batch card premise: equipment-384 "Base Weapon Warhammer"
  it('a weapon whose page draws no group page keeps the sentence — marked as ours', async () => {
    const tree = recordTree('items', 'dwarven-thrower', (b, s) => trees[b]?.[s]);
    expect(stubRefs(tree, aonIndex(db)), 'the dwarven thrower page names no group page').toEqual([]);
    const host = await itemPopup('dwarven-thrower');
    const crit = host.querySelector('.sd-critspec');
    expect(crit, 'our sentence stays').toBeTruthy();
    expect(crit!.getAttribute('data-ours')).toBe('');
    expect(crit!.getAttribute('data-ours-kind')).toBe('critSpec');
    expect(txt(crit)).toContain(CRIT_SPEC.hammer);
    expect(critSpecPageRef('hammer')).toBe('weaponGroup:hammer');
  });

  /* Rule C2 (orchestrator round 2, 2026-10-08; replaces decision C): the page is the truth, read whole.
   * Our sentence leaves only where (i) the page draws the record's OWN group page, or (ii) the page draws
   * a group page and prints no "Group" line naming the record's group (true drift). Otherwise it stays,
   * marked ours, beside whatever page the item embeds. work/card-step14-weapon-group-drift.json lists the
   * 23 weapons whose page embeds another group's page: 5 `drift`, 18 `combination` (melee halves). */
  type GroupRow = { id: string; recordGroup: string; pagePrintedGroups: string[]; embeddedGroupPages: string[] };
  const driftFile = () => JSON.parse(readFileSync('work/card-step14-weapon-group-drift.json', 'utf8')) as { drift: GroupRow[]; combination: GroupRow[] };

  it('the drift file matches the shipped pages: 5 drift (prints only the page\'s group), 18 combination (prints the record\'s group too)', () => {
    const f = driftFile();
    const idx = aonIndex(db);
    expect(f.drift.map((r) => r.id)).toEqual(['alchemical-crossbow', 'repeating-crossbow', 'rotary-bow', 'taw-launcher', 'tri-bladed-katar']);
    expect(f.combination.length).toBe(18);
    for (const r of [...f.drift, ...f.combination]) {
      const page = withoutItemLists(recordTree('items', r.id, (b, s) => trees[b]?.[s])!);
      const printed = [...new Set(printedWeaponGroups(page))];
      const embedded = [...new Set(stubRefs(page, idx).filter((x) => x.startsWith('weaponGroup:')).map((x) => x.slice('weaponGroup:'.length)))];
      expect(db.items[r.id].group, r.id).toBe(r.recordGroup);
      expect(printed, `${r.id} prints`).toEqual(r.pagePrintedGroups);
      expect(embedded, `${r.id} embeds`).toEqual(r.embeddedGroupPages);
      expect(embedded, `${r.id} never embeds its record's group page`).not.toContain(r.recordGroup);
    }
    for (const r of f.drift) expect(r.pagePrintedGroups, `${r.id}: true drift prints only the embedded group`).toEqual(r.embeddedGroupPages);
    for (const r of f.combination) {
      expect(r.id, 'every combination row is a melee half').toMatch(/-melee$/);
      expect(r.pagePrintedGroups, `${r.id}: the page prints the record's group`).toContain(r.recordGroup);
    }
  });

  // batch card premise: weapon-213 "Group Axe"
  it('(1) a combination weapon\'s melee half (axe musket): our axe sentence marked ours AND the embedded Firearm page\'s effect, each once', async () => {
    expect(db.items['axe-musket-melee'].group).toBe('axe');
    expect(printedWeaponGroups(withoutItemLists(recordTree('items', 'axe-musket-melee', (b, s) => trees[b]?.[s])!))).toEqual(['axe', 'firearm']);
    const host = await itemPopup('axe-musket-melee');
    const pop = host.querySelector('.picker.spell-detail')!;
    const crit = pop.querySelectorAll('.sd-critspec');
    expect(crit.length, 'our sentence stays: the page prints Group Axe but embeds only the Firearm page').toBe(1);
    expect(crit[0].getAttribute('data-ours')).toBe('');
    expect(crit[0].getAttribute('data-ours-kind')).toBe('critSpec');
    expect(count(txt(pop), CRIT_SPEC.axe), 'the axe effect, once, in our words').toBe(1);
    const stubs = [...cardBody(host)!.querySelectorAll('[data-stub]')].map((e) => e.getAttribute('data-stub'));
    expect(stubs, 'the page embeds the Firearm page, as the Archives draws it').toEqual(['weaponGroup:firearm']);
    // batch card premise: weapon-group-16 "must succeed at a Fortitude save against your class DC or be stunned"
    expect(count(txt(pop), 'must succeed at a Fortitude save against your class DC or be stunned'), 'the firearm effect, once, in the page\'s words').toBe(1);
    expect(txt(pop)).not.toContain(CRIT_SPEC.firearm);
    expect(txt(pop), 'the Axe page itself is not drawn').not.toContain('Choose one creature adjacent to the initial target');
  });

  // batch card premise: weapon-118 "Group Bow"
  it('(2) true drift (alchemical crossbow, the page prints only Group Bow): one crit effect, the page\'s; ours hidden', async () => {
    expect(db.items['alchemical-crossbow'].group, 'the record says crossbow').toBe('crossbow');
    expect(driftFile().drift.find((d) => d.id === 'alchemical-crossbow')).toMatchObject({ recordGroup: 'crossbow', pagePrintedGroups: ['bow'], embeddedGroupPages: ['bow'] });
    const host = await itemPopup('alchemical-crossbow');
    const pop = host.querySelector('.picker.spell-detail')!;
    expect(pop.querySelector('.sd-critspec'), 'our crossbow sentence stays out').toBeNull();
    expect(txt(pop)).not.toContain(CRIT_SPEC.crossbow);
    const stubs = [...cardBody(host)!.querySelectorAll('[data-stub]')].map((e) => e.getAttribute('data-stub'));
    expect(stubs, 'one group page, the one the page embeds').toEqual(['weaponGroup:bow']);
    // batch card premise: weapon-group-3 "it gets stuck to that surface by the missile"
    expect(count(txt(pop), 'it gets stuck to that surface by the missile')).toBe(1);
  });

  // batch card premise: weapon-386 "Group Sword"
  it('(3) the page draws its own group page (longsword): the Sword effect once, ours hidden', async () => {
    expect(printedWeaponGroups(withoutItemLists(recordTree('items', 'longsword', (b, s) => trees[b]?.[s])!))).toEqual(['sword']);
    const host = await itemPopup('longsword');
    const pop = host.querySelector('.picker.spell-detail')!;
    expect(pop.querySelector('.sd-critspec')).toBeNull();
    expect([...cardBody(host)!.querySelectorAll('[data-stub]')].map((e) => e.getAttribute('data-stub'))).toEqual(['weaponGroup:sword']);
    // batch card premise: weapon-group-15 "becoming off-guard until the start of your next turn"
    expect(count(txt(pop), 'becoming off-guard until the start of your next turn')).toBe(1);
  });

  it('printedWeaponGroups reads the bold "Group" label and the word or link after it, only on the tree given', () => {
    const t = (v: string): AstNode => ({ t: 'text', v });
    const b = (v: string): AstNode => ({ t: 'b', c: [t(v)] });
    const tree: AstNode = { t: 'doc', c: [
      { t: 'p', c: [b('Group'), t(' '), { t: 'link', ref: 'weaponGroup:pick', c: [t('Pick')] } as AstNode] },
      { t: 'p', c: [b('Group'), t(' Shield ')] },
      { t: 'p', c: [b('Base Weapon'), t(' Warhammer')] },
      { t: 'p', c: [t('Group Hammer, said in passing')] },
    ] };
    expect(printedWeaponGroups(tree)).toEqual(['pick', 'shield']);
    expect(printedWeaponGroups(undefined)).toEqual([]);
  });

  // batch card premise: class-kit-20 "Money Left Over 9 gp, 2 sp"
  it('a class kit (a page with no rule): Price and Bulk printed once, by the stat block (cardStatHeadMask)', async () => {
    const tree = recordTree('items', 'fighter-kit', (b, s) => trees[b]?.[s])!;
    expect(tree.c!.some((n) => n.t === 'hr'), 'the kit page has no rule').toBe(false);
    const host = await itemPopup('fighter-kit');
    const pop = host.querySelector('.picker.spell-detail')!;
    const statKeys = [...pop.querySelectorAll('.sd-stat-k')].map(txt);
    const bodyLabels = [...cardBody(host)!.querySelectorAll('.ast-body strong')].map(txt);
    for (const label of ['Price', 'Bulk']) {
      expect(statKeys.filter((k) => k === label).length, `${label} is a stat row`).toBe(1);
      expect(bodyLabels.filter((k) => k === label).length, `${label} is not printed again in the body`).toBe(0);
    }
    // The rest of the kit's header stays, in the page's words.
    expect(bodyLabels).toContain('Money Left Over');
    expect(bodyLabels).toContain('Armor');
  });

  // batch card premise: equipment-2943 "A healing potion is a vial of a ruby-red liquid"
  it('healing potion: Activate from the page once; Price, Usage and Bulk printed once (the stat block)', async () => {
    const host = await itemPopup('healing-potion-minor');
    const pop = host.querySelector('.picker.spell-detail')!;
    const body = cardBody(host)!;
    const lines = [...body.querySelectorAll('.ast-body p')].map(txt);
    expect(lines.filter((l) => /^Activate\b/.test(l)).length, 'the page\'s Activate line, once').toBe(1);
    for (const label of ['Price', 'Usage', 'Bulk']) {
      expect([...pop.querySelectorAll('.sd-stat-k')].map(txt), `${label} is a stat row`).toContain(label);
      expect(lines.filter((l) => l.startsWith(label)).length, `${label} is not printed again in the body`).toBe(0);
    }
    expect(txt(body)).toContain('A healing potion is a vial of a ruby-red liquid');
  });

  it('longsword: Damage, Category, Group and Hands are the stat block\'s, never repeated by the page; Type stays', async () => {
    const host = await itemPopup('longsword');
    const lines = [...cardBody(host)!.querySelectorAll('.ast-body p')].map(txt);
    for (const label of ['Damage', 'Category', 'Group', 'Hands', 'Price', 'Bulk']) expect(lines.some((l) => l.startsWith(label)), label).toBe(false);
    // batch card premise: weapon-386 "Type Melee"
    expect(lines.some((l) => l.startsWith('Type Melee'))).toBe(true);
    // Source is kept, dimmed (section 2 rule 5).
    expect(cardBody(host)!.querySelector('p.card-dim')?.textContent).toMatch(/^Source/);
  });

  // batch card premise: equipment-1102 "Price 70 gp Bulk 1"
  it('a variant on a family page: its own Price and Bulk are the stat block\'s (cardStatHeadMask)', async () => {
    const tree = recordTree('items', 'ablative-armor-plating-greater', (b, s) => trees[b]?.[s])!;
    expect(cardStatHeadMask(tree.c ?? []).filter(Boolean).length, 'the family header and the variant header').toBeGreaterThan(3);
    const host = await itemPopup('ablative-armor-plating-greater');
    const lines = [...cardBody(host)!.querySelectorAll('.ast-body p')].map(txt);
    expect(lines.some((l) => /^Price\b/.test(l))).toBe(false);
    expect(lines.some((l) => /^Bulk\b/.test(l))).toBe(false);
    expect(txt(cardBody(host))).toContain('The wearer gains 20 temporary Hit Points');
  });

  // batch card premise: equipment-562 "Access follower of Abadar"
  it('Access and Craft Requirements come from the page, dimmed', async () => {
    const scale = await itemPopup('abadars-flawless-scale');
    expect([...cardBody(scale)!.querySelectorAll('p.card-dim')].map(txt)).toContain('Access follower of Abadar');
    // batch card premise: equipment-2962 "Craft Requirements Supply a listed-rank casting of the spell."
    const scroll = await itemPopup('1st-rank-scroll');
    expect([...cardBody(scroll)!.querySelectorAll('p.card-dim')].map(txt)).toContain('Craft Requirements Supply a listed-rank casting of the spell.');
  });

  /* The no-page footer (section 2 rule 4.6; RecordCard.tsx InsetRecordCard's no-page lane): desk #152's
   * empty note, then "Homebrew" or the no-page line — all marked as ours, never as printed text. */
  const NO_TEXT = 'The book prints no rules text for this item.';
  const NO_PAGE = 'No Archives page — text from our older import';
  it('an item with no rules text and no page (agate): desk #152\'s note, then the no-page line, both ours', async () => {
    expect(recordTree('items', 'agate', (b, s) => trees[b]?.[s]), 'agate ships no page').toBeUndefined();
    const host = await itemPopup('agate');
    const body = cardBody(host)!;
    expect(body, 'the inset card draws the no-page lane').toBeTruthy();
    expect(body.querySelector('.ast-body')).toBeNull();
    const note = body.querySelector('.sd-unprinted');
    expect(txt(note)).toBe(NO_TEXT);
    const line = body.querySelector('.card-nopage');
    expect(txt(line)).toBe(NO_PAGE);
    expect(line!.getAttribute('data-ours')).toBe('');
    expect(line!.getAttribute('data-ours-kind')).toBe('noPage');
    expect(count(txt(host), NO_TEXT), 'the note once').toBe(1);
  });

  it('an item with old text and no page (Abrogail I Script): the old text, no #152 note, the no-page line', async () => {
    expect(recordTree('items', 'abrogail-i-script', (b, s) => trees[b]?.[s])).toBeUndefined();
    const host = await itemPopup('abrogail-i-script');
    const body = cardBody(host)!;
    expect(txt(body.querySelector('.card-inset-text')).length, 'the old import\'s words').toBeGreaterThan(20);
    expect(body.querySelector('.sd-unprinted')).toBeNull();
    expect(txt(body.querySelector('.card-nopage'))).toBe(NO_PAGE);
  });

  it('a homebrew item: its own words and "Homebrew", never the no-page line', async () => {
    const HB = {
      id: 'custom-test-lantern-aaa', itemType: 'gear', name: 'Test Lantern', level: 0, rarity: 'common',
      traits: [], price: { sp: 1 }, bulk: 0.1, description: 'A synthesized test lantern.', source: { license: 'homebrew' },
    } as unknown as ContentDatabase['items'][string];
    const hdb = { ...db, items: { ...db.items, [HB.id]: HB } } as ContentDatabase;
    const inv = invOf(HB.id);
    const host = await mount(<ItemDetail inv={inv} item={HB} content={hdb} inventory={[inv]} onClose={() => undefined} />, hdb);
    const body = cardBody(host)!;
    expect(txt(body.querySelector('.card-inset-text'))).toContain('A synthesized test lantern.');
    const line = body.querySelector('.card-nopage');
    expect(txt(line)).toBe('Homebrew');
    expect(line!.getAttribute('data-ours-kind')).toBe('noPage');
    expect(txt(host)).not.toContain(NO_PAGE);
    expect(body.querySelector('.sd-unprinted')).toBeNull();
  });

  it('an item with a page prints none of the no-page footer lines', async () => {
    const host = await itemPopup('longsword');
    expect(host.querySelector('.card-nopage')).toBeNull();
    expect(host.querySelector('.sd-unprinted')).toBeNull();
  });

  it('a linked word opens the browse card over the item; Back returns to the item', async () => {
    const host = await itemPopup('longsword');
    const link = cardBody(host)!.querySelector('a.ast-lk') as HTMLElement;
    expect(link, 'the longsword page carries a link').toBeTruthy();
    await act(async () => { link.click(); });
    await settle();
    const drilled = host.querySelector('.ast-modal');
    expect(drilled, 'the browse card opened').toBeTruthy();
    await act(async () => { (drilled!.querySelector('.info-back') as HTMLElement).click(); });
    await settle();
    expect(host.querySelector('.ast-modal')).toBeNull();
    expect(host.querySelector('.picker.spell-detail .sd-head-name')?.textContent).toBe('Longsword');
  });
});

describe.skipIf(cardOn('itemDetail'))('card step 14, switched off: the legacy item popup', () => {
  it('draws the description through DescBody (no card) and our crit sentence for every weapon with a known group', async () => {
    const host = await itemPopup('longsword');
    expect(host.querySelector('.card-inset')).toBeNull();
    expect(host.querySelector('[data-stub]')).toBeNull();
    expect(txt(host.querySelector('.sd-critspec .sd-critspec-text'))).toBe(CRIT_SPEC.sword);
    expect(host.querySelector('.sd-critspec')!.hasAttribute('data-ours')).toBe(false);
  });
});

/* Section 9: the switch turns the WHOLE step back in one line — the item popup and the item page's browse
 * card (astStubs.ts browseResolvesStubs) — read through the mocked cardOn, so this runs either way. */
describe('card step 14, turned back (CARD_ON.itemDetail off): the item popup and the browse card are the old ones', () => {
  it('the item popup draws DescBody and our sentence unmarked; the longsword\'s browse card draws no stub', async () => {
    sw.itemDetail = false;
    const item = await itemPopup('longsword');
    expect(item.querySelector('.card-inset')).toBeNull();
    expect(item.querySelector('[data-stub]')).toBeNull();
    expect(txt(item.querySelector('.sd-critspec .sd-critspec-text'))).toBe(CRIT_SPEC.sword);
    expect(item.querySelector('.sd-critspec')!.hasAttribute('data-ours')).toBe(false);
    const browse = await mount(<RecordCard record={{ bucket: 'items', id: 'longsword' }} mode="browse" chrome="popup" onExit={() => undefined} />);
    expect(browse.querySelector('.ast-pop > .ast-body'), 'the longsword page is drawn').toBeTruthy();
    expect(browse.querySelector('[data-stub]'), 'its stubs draw nothing, as before step 14').toBeNull();
    expect(txt(browse)).not.toContain('becoming off-guard until the start of your next turn');
    // Switched on again, the same browse card draws the Sword page (the switch is the only difference).
    sw.itemDetail = true;
    const on = await mount(<RecordCard record={{ bucket: 'items', id: 'longsword' }} mode="browse" chrome="popup" onExit={() => undefined} />);
    expect(on.querySelector('.ast-pop > .ast-body [data-stub="weaponGroup:sword"]')).toBeTruthy();
  });
});

describe('card step 14: the frame and its controls are unchanged', () => {
  it('the phone Remove bar stays outside the scrolling body, the same markup, and still removes', async () => {
    let played = 0;
    const host = await itemPopup('longsword', { onPlay: () => { played++; }, mobile: true });
    const pop = host.querySelector('.picker.spell-detail')!;
    const bar = pop.querySelector(':scope > .sd-remove');
    expect(bar, 'a sibling of .sd-body, not inside it').toBeTruthy();
    expect(pop.querySelector('.sd-body .sd-remove')).toBeNull();
    expect(pop.lastElementChild).toBe(bar);
    expect(bar!.outerHTML).toBe('<div class="sd-remove"><button class="sd-remove-btn" aria-label="Remove Longsword"><i class="ti ti-trash" aria-hidden="true"></i> Remove item</button></div>');
    await act(async () => { (bar!.querySelector('button') as HTMLElement).click(); });
    await settle();
    const confirm = [...document.querySelectorAll('.confirm-modal .btn-danger')].find((b) => txt(b) === 'Remove') as HTMLElement;
    expect(confirm, 'the same confirm dialog').toBeTruthy();
    await act(async () => { confirm.click(); });
    await settle();
    expect(played).toBe(1);
    // Desktop draws no bar (the header's trash icon is the one control).
    const desk = await itemPopup('longsword', { onPlay: () => undefined, mobile: false });
    expect(desk.querySelector('.sd-remove')).toBeNull();
    expect(desk.querySelector('.sd-head-remove')).toBeTruthy();
  });

  it('the stat block still prints exactly itemStatRows, and the star pins {items, slug, title, mine}', async () => {
    const toggled: DescNode[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const inv = invOf('longsword');
    await act(async () => {
      root.render(<ContentContext.Provider value={db}><PinContext.Provider value={{ has: () => false, toggle: (n) => void toggled.push(n) }}>
        <ItemDetail inv={inv} item={db.items.longsword} content={db} onClose={() => undefined} />
      </PinContext.Provider></ContentContext.Provider>);
    });
    await settle();
    const rows = [...host.querySelectorAll('.sd-stats .sd-stat')].map((s) => [txt(s.querySelector('.sd-stat-k')), txt(s.querySelector('.sd-stat-v'))]);
    expect(rows).toEqual(itemStatRows(db.items.longsword, db).map((r) => [r.k, String(r.v)]));
    await act(async () => { (host.querySelector('.sd-head-actions .info-star') as HTMLElement).click(); });
    expect(toggled.map((n) => ({ key: n.key, slug: n.slug, title: n.title, mode: (n as { mode?: string }).mode }))).toEqual([{ key: 'items', slug: 'longsword', title: 'Longsword', mode: 'mine' }]);
    act(() => root.unmount());
    host.remove();
  });
});

describe('card step 14: the browse card draws an item page\'s stubs; the strike card keeps its gate', () => {
  it('the search popup of the longsword draws the Sword page, as the item card does', async () => {
    const host = await mount(<RecordCard record={{ bucket: 'items', id: 'longsword' }} mode="browse" chrome="popup" onExit={() => undefined} />);
    expect(txt(host.querySelector('.ast-pop > .ast-body [data-stub="weaponGroup:sword"]'))).toContain('becoming off-guard until the start of your next turn');
  });

  it('the strike card (Strikes tab) draws no stub: its crit spec is still only shown when the character has it', async () => {
    const ch = build('fighter', 1);
    const inv = invOf('longsword', { equipped: true });
    const c = { ...ch, inventory: [inv] } as Character;
    const strike = deriveStrikes(c, db).find((s) => s.instanceId === inv.instanceId)!;
    expect(strike).toBeTruthy();
    const host = await mount(<StrikeDetailModal strike={strike} character={c} content={db} onClose={() => undefined} />);
    expect(host.querySelector('[data-stub]')).toBeNull();
    expect(txt(host)).not.toContain('becoming off-guard');
  });
});

/*
 * The crit gate while pages load (ItemDetail.tsx showCrit / pageDrawsCrit): the item page or the group
 * bucket still on its way must never draw our sentence for a beat and then take it away. The rest of this
 * file preloads every bucket in beforeAll, so these cases mount the popup from a FRESH module graph
 * (vi.resetModules: a new astStore with nothing cached) whose fetch holds the named buckets behind a
 * deferred promise the test releases itself. Last in the file, so nothing after it shares the reset.
 */
describe.skipIf(!cardOn('itemDetail'))('card step 14: the crit gate while the page or its group page is loading', () => {
  type Fresh = { host: HTMLElement; release: (bucket: string) => void };
  const realFetch = () => globalThis.fetch;
  let restoreFetch: (() => void) | undefined;
  afterEach(() => { restoreFetch?.(); restoreFetch = undefined; });

  /** Wait (inside act) until `cond` holds; fails the test after `ms`. */
  async function until(cond: () => boolean, what: string, ms = 60_000) {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
  }

  /** The longsword popup from a fresh module graph, with `held` buckets' fetch waiting on release(). */
  async function freshPopup(itemId: string, held: string[]): Promise<Fresh> {
    const gates = new Map<string, { p: Promise<void>; open: () => void }>();
    for (const b of held) {
      let open!: () => void;
      const p = new Promise<void>((r) => { open = r; });
      gates.set(b, { p, open });
    }
    const before = realFetch();
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const m = /ast\/([A-Za-z0-9_-]+)\.json(?:\.gz)?$/.exec(String(input));
      if (m && gates.has(m[1])) await gates.get(m[1])!.p;
      return before(input as RequestInfo, init as RequestInit);
    }) as typeof fetch;
    restoreFetch = () => { for (const g of gates.values()) g.open(); globalThis.fetch = before; };
    vi.resetModules();
    const [{ ItemDetail: FreshItemDetail }, { ContentContext: FreshContent }, { PinContext: FreshPin }, store] = await Promise.all([
      import('../src/sheet/ItemDetail'), import('../src/sheet/ContentContext'), import('../src/sheet/PinContext'), import('../src/sheet/astStore'),
    ]);
    await store.loadAstIndex();
    expect(store.isBucketLoaded('items'), 'a fresh store holds no bucket').toBe(false);
    for (const b of held) expect(store.isBucketLoaded(b)).toBe(false);
    const inv = invOf(itemId);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<FreshContent.Provider value={db}><FreshPin.Provider value={pin}>
        <FreshItemDetail inv={inv} item={db.items[itemId]} content={db} inventory={[inv]} onClose={() => undefined} />
      </FreshPin.Provider></FreshContent.Provider>);
    });
    stops.push(() => { act(() => root.unmount()); host.remove(); });
    return { host, release: (b) => gates.get(b)!.open() };
  }
  const SWORD_WORDS = 'becoming off-guard until the start of your next turn';

  // batch card premise: weapon-group-15 "becoming off-guard until the start of your next turn"
  it('(a) the Sword page\'s bucket pending: the page is drawn with its stub still empty and our sentence absent; (b) once it arrives, the effect shows once and ours stays out', async () => {
    const { host, release } = await freshPopup('longsword', ['weaponGroup']);
    // The longsword page arrives (its own bucket is not held); the group bucket is still on its way.
    await until(() => !!cardBody(host)?.querySelector('.ast-body'), 'the longsword page');
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const pop = host.querySelector('.picker.spell-detail')!;
    expect(cardBody(host)!.querySelector('[data-stub]'), 'the stub draws nothing while its bucket loads').toBeNull();
    expect(txt(pop)).not.toContain(SWORD_WORDS);
    expect(pop.querySelector('.sd-critspec'), 'no flash of our sentence while the group page loads').toBeNull();
    expect(txt(pop)).not.toContain(CRIT_SPEC.sword);
    // (b) The bucket arrives: the page's effect, once; ours never appears.
    release('weaponGroup');
    await until(() => !!cardBody(host)?.querySelector('[data-stub="weaponGroup:sword"]'), 'the Sword page');
    expect(count(txt(pop), SWORD_WORDS)).toBe(1);
    expect(pop.querySelector('.sd-critspec')).toBeNull();
    expect(txt(pop)).not.toContain(CRIT_SPEC.sword);
  });

  it('(c) the item page itself pending: the card shows its loading placeholder and no crit sentence of ours', async () => {
    const { host, release } = await freshPopup('longsword', ['items', 'weaponGroup']);
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const pop = host.querySelector('.picker.spell-detail')!;
    expect(host.querySelector('.sd-desc.card-inset.ast-loading[aria-busy="true"]'), 'the quiet placeholder').toBeTruthy();
    expect(pop.querySelector('.sd-critspec'), 'no sentence of ours before the page is known').toBeNull();
    expect(txt(pop)).not.toContain(CRIT_SPEC.sword);
    // The page arrives with its group bucket still held: still no sentence of ours (the stub names the group page).
    release('items');
    await until(() => !!cardBody(host)?.querySelector('.ast-body'), 'the longsword page');
    expect(pop.querySelector('.sd-critspec')).toBeNull();
    release('weaponGroup');
    await until(() => !!cardBody(host)?.querySelector('[data-stub="weaponGroup:sword"]'), 'the Sword page');
    expect(pop.querySelector('.sd-critspec')).toBeNull();
  });
});
