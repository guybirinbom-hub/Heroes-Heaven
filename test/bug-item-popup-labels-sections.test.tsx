// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { descNodeOf } from '../src/sheet/FilterableSelect';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { withoutItemLists } from '../src/sheet/useAst';
import type { InventoryItem } from '../src/rules/types';

/**
 * bug 2026-09-15: item popup. The owner, with a screenshot of the Full Plate card:
 *
 *   1. *"there is so much space in the top so why is speed penalty in 2 lines instead of 1?"*
 *   2. *"specific magic armor doesn't need to be in the item card — the user has the item, he is not
 *      searching for more items; he does need the crit specialization rules."*
 *
 * MEASURED CAUSES. (1) `.sd-stat-k` was a fixed `width: 64px`, so "Check penalty" / "Speed penalty" /
 * "Dex cap" wrapped beside a half-empty row; the block is now a grid whose label column is
 * `max-content`, which both unwraps the labels and keeps the values in ONE column. (2) An AoN
 * armor/weapon/shield page ends with a level-2 section that is only a run of links to the specific
 * magic items built on it — 143 shipped pages, three headings: "Specific Magic Weapons" (111),
 * "Specific Magic Armor" (23), "Specific Magic Shields" (9). `withoutItemLists` (useAst.ts) cuts them,
 * applied in DescBody, so the popup of the item a character HOLDS drops them while the search popup
 * (DescriptionModal) — where the player IS shopping — keeps them.
 *
 * Everything below renders the trees that actually ship (public/ast/items.json.gz), never a fixture.
 */
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
const noop = () => undefined;
const c = () => content();
/** A node's text, joined — the shape the section headings really have (see below). */
const rawText = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(rawText).join(''));
const flat = (n: AstNode): string => rawText(n).trim();

/** The three shapes of the appended list, one per item type, each with a name only that list prints. */
const CASES = [
  { slug: 'full-plate', keep: 'Armor Specialization Effects', drop: 'Specific Magic Armor', dropLink: 'Alkenstar Phalanx', own: 'Plate mail consists of interlocking plates' },
  { slug: 'longsword', keep: 'Critical Specialization Effects', drop: 'Specific Magic Weapons', dropLink: 'Chalice of Justice', own: 'Longswords can be one-edged or two-edged' },
  { slug: 'steel-shield', keep: '', drop: 'Specific Magic Shields', dropLink: 'Clockwork Shield', own: 'steel shields come in a variety of shapes' },
];
const ARMOR = CASES[0];

/*
 * jsdom does no layout AND applies no stylesheet, so a wrapped label cannot be observed in a render.
 * The rendered half of leg (a) is therefore "the label is a .sd-stat-k cell"; the file is the other
 * half. Comments are stripped first (they contain prose braces), then every innermost rule is read —
 * which includes rules nested inside `@media (max-width: 720px)`, so a phone override that reinstates
 * the fixed column is caught by the same assertions.
 */
const CSS = readFileSync('src/sheet.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const rulesFor = (sel: string) => RULES.filter((r) => r.sel.split(',').some((s) => s.trim() === sel));
/** `width:` but not `min-width:` / `max-width:` — the fixed column that caused the wrap. */
const FIXED_WIDTH = /(^|[^-\w])width\s*:/;

let shipped: Record<string, AstNode> = {};

beforeAll(async () => {
  shipped = readGz('public/ast/items.json.gz') as Record<string, AstNode>;
  // Serve only the pages these tests open, through the loader's own raw-json fallback, so the module
  // cache is warm and `useAstNode` resolves synchronously on first render — as it does in the app once
  // a bucket has been fetched.
  const bucket: Record<string, AstNode> = {};
  for (const { slug } of CASES) bucket[slug] = shipped[slug];
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('ast/items.json') ? { ok: true, json: async () => bucket } : { ok: false },
  );
  await loadBucketAst('items');
});

/** One item's popup as a character who HOLDS it sees it. */
function heldPopup(slug: string): { text: string; headings: string[]; labels: string[] } {
  const item = c().items[slug];
  expect(item, `a shipped item record for ${slug}`).toBeTruthy();
  const inv = { instanceId: `${slug}-1`, itemId: item.id, quantity: 1 } as InventoryItem;
  const { host, stop } = renderDom(<ItemDetail inv={inv} item={item} content={c()} onClose={noop} />);
  const out = {
    text: host.textContent ?? '',
    headings: [...host.querySelectorAll('.ast-h2, .ast-h3')].map((h) => (h.textContent ?? '').trim()),
    labels: [...host.querySelectorAll('.sd-stat-k')].map((s) => (s.textContent ?? '').trim()),
  };
  stop();
  return out;
}

describe('bug 2026-09-15: item popup — one-line stat labels, and no "buy another one" list', () => {
  // bug 2026-09-15: item popup
  it('(a) every Full Plate stat label is its own .sd-stat-k cell, including the two-word ones', () => {
    const { labels } = heldPopup(ARMOR.slug);
    // The three the owner's screenshot shows wrapping, plus a short one — all four are cells of the
    // same block, which is what lets ONE column rule unwrap them without staggering the values.
    for (const l of ['Dex cap', 'Check penalty', 'Speed penalty', 'Bulk']) {
      expect(labels, `Full Plate must print a "${l}" label cell`).toContain(l);
    }
  });

  // bug 2026-09-15: item popup
  it('(a) the stat block sizes its label column to the longest label, in one shared column', () => {
    const stats = rulesFor('.sd-stats');
    expect(stats.length, 'a .sd-stats rule in src/sheet.css').toBeGreaterThan(0);
    const grid = stats.map((r) => r.body).join('\n');
    expect(grid).toMatch(/display\s*:\s*grid/);
    // `max-content` is the fix: the column is as wide as ITS OWN longest label, so nothing wraps and
    // every value still starts at the same x. `minmax(0, …)` lets the value column shrink instead of
    // pushing the value off the ≤720px popup.
    expect(grid).toMatch(/grid-template-columns\s*:\s*max-content\s+minmax\(\s*0\s*,/);
    // The row is a pass-through so that its two spans, not the row, are the grid cells — otherwise
    // each row would size its own label column again and the values would stagger.
    expect(rulesFor('.sd-stat').map((r) => r.body).join('\n')).toMatch(/display\s*:\s*contents/);
    expect(rulesFor('.sd-stat-k').map((r) => r.body).join('\n')).toMatch(/white-space\s*:\s*nowrap/);
    // The defect itself: a fixed width on the label, at ANY width — the phone rules included.
    for (const r of RULES.filter((x) => /\.sd-stat-k\b/.test(x.sel))) {
      expect(r.body, `${r.sel} must not pin the label column to a fixed width`).not.toMatch(FIXED_WIDTH);
    }
  });

  // bug 2026-09-15: item popup
  it('the shipped pages DO carry the appended item lists — the defect these tests fix', () => {
    for (const { slug, drop, dropLink } of CASES) {
      const raw = shipped[slug];
      expect(raw, `a shipped page for items/${slug}`).toBeTruthy();
      // Flattened, not JSON: the shield heading ships SPLIT across an auto-link ("Specific " + link
      // "Magic" + " Shields"), so the phrase exists only once the node's text is joined — which is
      // exactly why the filter matches on flattened heading text rather than on a raw string.
      const sections = (raw.c ?? []).filter((n) => n.t === 'title' && Number(n.level ?? 1) === 2).map(flat);
      expect(sections, `items/${slug} must ship a "${drop}" section`).toContain(drop);
      expect(flat(raw), `items/${slug} must list "${dropLink}"`).toContain(dropLink);
    }
  });

  // bug 2026-09-15: item popup
  it('(b) the Full Plate popup keeps "Armor Specialization Effects" and drops "Specific Magic Armor"', () => {
    const { text, headings } = heldPopup(ARMOR.slug);
    expect(text).toContain(ARMOR.own); // the item's own rules text is untouched
    expect(headings).toContain(ARMOR.keep);
    expect(headings, 'the held-item popup still lists other armor').not.toContain(ARMOR.drop);
    expect(text).not.toContain(ARMOR.drop);
    expect(text, 'the linked armor names survived the heading').not.toContain(ARMOR.dropLink);
  });

  // bug 2026-09-15: item popup
  it.each(CASES)('(c) the $slug popup keeps its rules text and cuts its Specific-list section', ({ slug, keep, drop, dropLink, own }) => {
    const { text, headings } = heldPopup(slug);
    expect(text).toContain(own);
    if (keep) expect(headings, `${slug} must keep "${keep}"`).toContain(keep);
    expect(text, `${slug} popup still prints "${drop}"`).not.toContain(drop);
    expect(text, `${slug} popup still lists "${dropLink}"`).not.toContain(dropLink);
  });

  // bug 2026-09-15: item popup
  it('(d) the SEARCH popup still lists them — there the player is looking for another item', () => {
    const item = c().items[ARMOR.slug];
    // Exactly the node AddItemsModal hands a row's description popup.
    const node = descNodeOf(item, 'items');
    expect(node, 'the search row must have a description node to open').toBeTruthy();
    const { host, stop } = renderDom(<DescriptionModal root={node!} onClose={noop} />);
    const text = host.textContent ?? '';
    stop();
    expect(text, 'the search popup lost its "Specific Magic Armor" list').toContain(ARMOR.drop);
    expect(text).toContain(ARMOR.dropLink);
  });

  // bug 2026-09-15: item popup
  it('a page with nothing to cut comes back by identity — no copy, no restructuring', () => {
    const once = withoutItemLists(shipped[ARMOR.slug]);
    expect(once).not.toBe(shipped[ARMOR.slug]);
    expect(withoutItemLists(once), 'a second pass must change nothing').toBe(once);
  });
});
