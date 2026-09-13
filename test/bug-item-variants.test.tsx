// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { descNodeOf } from '../src/sheet/FilterableSelect';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { variantSection } from '../src/sheet/useAst';
import type { InventoryItem } from '../src/rules/types';

/**
 * bug 2026-09-12 #6: variant-list. Owner, with a screenshot of the Magic Wand popup: *"i dont like
 * that in the inventory it shows all of the lv variations, the player has the item in a certain lv he
 * doesnt care about the other lvs now, in the search each version of an item needs to be a different
 * entry not showing every version on every one because they are different items."*
 *
 * MEASURED CAUSE: an AoN family page is ONE document shared by every variant record in it. The tree
 * stored under `magic-wand-2nd-rank-spell` is the whole "Magic Wand" page — a shared header and prose,
 * then a level-2 section per rank — so the popup of the wand a character is holding printed all nine
 * ranks, and so did the search popup for any one of them. 3,068 of the 7,537 shipped item pages are
 * family pages (plus 362 itemBonus, 3 siegeWeapons, 1 classFeature).
 *
 * Fixed in `variantSection` (useAst.ts), applied inside `useAstNode` — the one chokepoint BOTH popups
 * read a stored tree through (DescBody for the held item, DescriptionModal for a search result).
 *
 * Everything here renders the trees that actually ship (public/ast/items.json.gz), never a fixture.
 */
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
const noop = () => undefined;
const c = () => content();

/**
 * The four records the owner's note points at: a rank list, a grade list, a numbered list, and a
 * 25-section aeon stone page.
 *
 * `own` is text only this variant prints (plus the shared prose above the sections, which it keeps);
 * `siblings` is text only the OTHER variants print. Sibling markers are deliberately SECTION TITLES
 * rather than prices — a detail view hides meta lines, so the titles are what the owner's screenshot
 * actually shows ("Magic Wand (1st-rank Spell) Item 3 … (9th-rank Spell) Item 19") — and each is
 * chosen so it cannot be a substring of this variant's own name (hence "Necklace of Fireballs VII",
 * never "…I").
 */
const MEASURED = [
  {
    slug: 'magic-wand-2nd-rank-spell',
    name: 'Magic Wand (2nd-rank Spell)',
    badge: 'Item 5',
    price: '160 gp',
    own: ['This baton is about a foot long'],
    siblings: ['(1st-rank Spell)', '(3rd-rank Spell)', '(9th-rank Spell)'],
  },
  {
    slug: 'screech-shooter-greater',
    name: 'Screech Shooter (Greater)',
    badge: 'Item 13',
    price: '3,000 gp',
    own: ['greater striking harmona gun', 'Built from the larynx'],
    siblings: ['(Major)', '50-foot emanation'],
  },
  {
    slug: 'necklace-of-fireballs-iii',
    name: 'Necklace of Fireballs III',
    badge: 'Item 9',
    price: '300 gp',
    own: ['One 10d6, two 8d6, two 6d6', 'This string of beads'],
    siblings: ['Necklace of Fireballs VII', 'One 6d6, two 4d6', 'One 18d6'],
  },
  {
    slug: 'aeon-stone-black-pearl',
    name: 'Aeon Stone (Black Pearl)',
    badge: 'Item 12',
    price: '2,000 gp',
    own: ['This black pearl sparkles with light', 'Over millennia'],
    siblings: ['(Dull Gray)', '(Tourmaline Sphere)', '(Pink Rhomboid)'],
  },
];

/** The one the owner screenshotted — used for the two component-wiring tests below. */
const WAND = MEASURED[0];

let shipped: Record<string, AstNode> = {};

beforeAll(async () => {
  shipped = readGz('public/ast/items.json.gz') as Record<string, AstNode>;
  // Serve only the pages these tests open, through the loader's own raw-json fallback, so the module
  // cache is warm and `useAstNode` resolves synchronously on first render — as it does in the app once
  // a bucket has been fetched.
  const bucket: Record<string, AstNode> = {};
  for (const slug of [...MEASURED.map((m) => m.slug), 'aeon-stone', 'longsword']) bucket[slug] = shipped[slug];
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('ast/items.json') ? { ok: true, json: async () => bucket } : { ok: false },
  );
  await loadBucketAst('items');
});

/** One record's page as the app renders it in a search popup (full chrome: name, badge, meta, prose). */
function renderedPage(node: AstNode): { text: string; name: string; badge: string } {
  const { host, stop } = renderDom(<AstRenderer node={node} onOpenRef={noop} />);
  const out = {
    text: host.textContent ?? '',
    name: (host.querySelector('.ast-name')?.textContent ?? '').trim(),
    badge: (host.querySelector('.ast-badge')?.textContent ?? '').trim(),
  };
  stop();
  return out;
}

describe('bug 2026-09-12 #6: variant-list — a variant popup shows that variant, not its whole family', () => {
  // bug 2026-09-12 #6: variant-list
  it('the shipped page for a variant IS the whole family page — the defect these tests fix', () => {
    const raw = shipped[WAND.slug];
    expect(raw, `a shipped page for items/${WAND.slug}`).toBeTruthy();
    const before = renderedPage(raw);
    // Every rank, on the page of ONE rank: what the owner screenshotted.
    for (const s of WAND.siblings) expect(before.text).toContain(s);
    // …and it is titled after the family, carrying the family's "3+" badge.
    expect(before.name).toBe('Magic Wand');
    expect(before.badge).toBe('Item 3+');
  });

  // bug 2026-09-12 #6: variant-list
  it.each(MEASURED)('keeps only $name and the shared prose above it', ({ slug, name, badge, price, own, siblings }) => {
    const raw = shipped[slug];
    expect(raw, `a shipped page for items/${slug}`).toBeTruthy();
    const after = renderedPage(variantSection(raw, slug));
    for (const t of [...own, price]) expect(after.text, `${slug} must keep its own "${t}"`).toContain(t);
    for (const t of siblings) expect(after.text, `${slug} must drop its sibling "${t}"`).not.toContain(t);
    // Retitled after the variant, so a search result opens under the name that was clicked and carries
    // that variant's own item level rather than the family's "N+".
    expect(after.name).toBe(name);
    expect(after.badge).toBe(badge);
  });

  // bug 2026-09-12 #6: variant-list
  it('leaves a family HEAD and an ordinary item exactly as they ship', () => {
    // The head's page IS the overview — no level-2 section is titled "Aeon Stone", so nothing is cut
    // and every stone stays listed.
    const head = variantSection(shipped['aeon-stone'], 'aeon-stone');
    expect(head).toBe(shipped['aeon-stone']);
    const headText = renderedPage(head).text;
    expect(headText).toContain('(Amplifying)');
    expect(headText).toContain('(Delaying)');
    // A record with no sections at all comes back by identity — no copy, no restructuring.
    expect(shipped['longsword'], 'a shipped page for items/longsword').toBeTruthy();
    expect(variantSection(shipped['longsword'], 'longsword')).toBe(shipped['longsword']);
  });

  // bug 2026-09-12 #6: variant-list
  it('(a) the popup of the item the character HOLDS lists no other rank', () => {
    const item = c().items[WAND.slug];
    const inv = { instanceId: 'wand-1', itemId: item.id, quantity: 1 } as InventoryItem;
    const { host, stop } = renderDom(<ItemDetail inv={inv} item={item} content={c()} onClose={noop} />);
    const text = host.textContent ?? '';
    stop();
    // The wand's own rules text is there…
    for (const t of WAND.own) expect(text).toContain(t);
    // …and every other rank is gone. This is the WIRING assertion: `variantSection` can exist and be
    // right while `useAstNode` never calls it, and then this popup is exactly as broken as before.
    for (const s of WAND.siblings) expect(text, `held-item popup still lists "${s}"`).not.toContain(s);
  });

  // bug 2026-09-12 #6: variant-list
  it('(b) a search result opens as its own entry, not as the family page', () => {
    const item = c().items[WAND.slug];
    // Exactly the node AddItemsModal hands a row's description popup — no slug, so it resolves its
    // page by slugging the NAME, which is what makes one row per variant reach one page per variant.
    const node = descNodeOf(item, 'items');
    expect(node, 'the search row must have a description node to open').toBeTruthy();
    const { host, stop } = renderDom(<DescriptionModal root={node!} onClose={noop} />);
    const text = host.textContent ?? '';
    const title = (host.querySelector('.ast-name')?.textContent ?? '').trim();
    stop();
    expect(title).toBe(WAND.name);
    expect(text).toContain(WAND.price);
    for (const s of WAND.siblings) expect(text, `search popup still lists "${s}"`).not.toContain(s);
  });
});
