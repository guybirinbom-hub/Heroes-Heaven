import { useEffect, useMemo, useState } from 'react';
import { getCachedAst, isBucketLoaded, loadBucketAst, type AstNode } from './astStore';
import { cardOn } from './cardSurfaces';
import STUB_NAMES_JSON from '../data/stub-names.json';

/**
 * Card step 14 (docs/card-design.md section 2 rule 6, section 9 row 14): EMBEDDED PAGE STUBS.
 *
 * An Archives page can embed another page: the shipped tree carries an EMPTY document node
 * (`{t:'document', id:'weapon-group-15', level:2}`) where AoN draws the other page inline. 5,856 such
 * stubs ship, 5,583 of them name a record by its aon id (measured 2026-10-07: every one of those has a
 * tree whose root `aon` is that id). Until this step every popup drew each stub as nothing, so a
 * longsword's page said "the exact effect depends on which weapon group your weapon belongs to, as listed
 * below" and listed nothing, and full plate's plate resistance was printed nowhere in the app.
 *
 * Resolution, the same everywhere it is switched on:
 *  - a stub is an empty `document` / `doc` node below the root carrying an `id`;
 *  - its candidates are the records whose `aonId` is that id (aonIndex: records with an ordinary id
 *    before `aon-`-prefixed duplicates, then content order); the first candidate whose page ships is
 *    the one drawn;
 *  - ONE level deep: the embedded page's own stubs stay empty (they draw nothing), so a page can never
 *    pull in a chain of pages;
 *  - a VISITED set: the host page and every page already embedded on it are never embedded (again), so
 *    a page that embeds itself, or two stubs naming one page, draws nothing for the repeat — no loop;
 *  - the embedded page's titles move down to the stub's level (its name, a level-1 title the popup
 *    header would otherwise swallow, prints as the stub's level-2 heading with its badge, as AoN draws it);
 *  - the resolved node keeps its stub's type and id and gains `stubOf` ("bucket:slug"), so AstRenderer
 *    wraps it in `[data-stub]` and a reader can tell another record's page from the host's own words.
 *
 * Where it is switched on (step 14): pages of the buckets in STUB_HOST_BUCKETS ('items') on the browse
 * card (RecordCard mode 'browse', a page opened from a link inside any card included) and on ItemDetail's
 * card — both behind CARD_ON.itemDetail (browseResolvesStubs), so the switch turns both back.
 * Step 14b (docs/card-design.md section 2 rule 6, section 9 row 14b) widens STUB_HOST_BUCKETS to every
 * bucket whose pages carry a stub, on the browse card and on the 'mine' POPUP cards (mineResolvesStubs:
 * StatDetail's full text, FeatDetail, the action popup, the builder's granted rows, a pinned card — every
 * bucket but items, so the Strike card keeps its "only if you have it" gate for the critical
 * specialization, and spells, whose stubs draw on the browse card only), and adds three ways a stub is drawn:
 *  - an archetype page's feat stubs (2,664 on the archetype pages) as ONE compact linked list — the feat's
 *    name as a link to its card and its level badge, never the feat's body (`stubKind: 'list'`);
 *  - a stub whose aon id names no record (273 occurrences) as its page's name, a link when a record
 *    exists for it, plain text when none does (`stubKind: 'name'`, src/data/stub-names.json);
 *  - an embedded page's own trait chips, inside it (AstRenderer, ctx.inStub).
 * A 'mine' card resolves its stubs AFTER scoping its host page (RecordCard), so the folds apply to the
 * host page only and an embedded page is drawn as it ships — it is not the character's record; and
 * AstRenderer draws it AS PRINTED: the card walk (S-furniture cuts, dim / use classes, the printed-set
 * drops) never reaches inside a [data-stub], so its spoiler banner and its "click here" line stay.
 *
 * The card guard (scripts/lib/card-scope.mjs) judges a record's OWN page: an embedded page is another
 * record's, drawn verbatim by this rule, so the ledger never resolves stubs and test/card-parity.test.tsx
 * reads past `[data-stub]` on both sides. test/card-item.test.tsx checks the embedded words against the
 * target page itself. Stubs that resolve nothing stay listed in the guard's STUBS section.
 */

/** One candidate page of a stub: a record's bucket and id (its page is `bucket:slug` in public/ast). */
export interface StubTarget {
  bucket: string;
  slug: string;
}

/**
 * A resolved stub: the stub node with the embedded page's children and the page it came from.
 * Card step 14b adds the stubs drawn WITHOUT the page's body (`stubKind`):
 *  - 'list': an entry of an archetype page's compact feat list — the feat's printed name as a link that
 *    opens its record's card, and the level badge (the stub's own "Feat 4*" where the page overrides it,
 *    else the feat page's), never the feat's body; consecutive entries draw as one list;
 *  - 'name': a stub whose aon id names no record (STUB_NAMES, src/data/stub-names.json) — the embedded
 *    page's name where its heading would be, a link when a record exists for it (`stubLink`), plain text
 *    when none does.
 */
export type StubbedNode = AstNode & {
  stubOf?: string;
  id?: string;
  stubKind?: 'list' | 'name';
  /** 'list' / 'name': the name drawn. */
  stubName?: string;
  /** 'list' / 'name': the level badge drawn after it. */
  stubRight?: string;
  /** 'list' / 'name': the record the name opens ("bucket:slug"); absent = a plain name. */
  stubLink?: string;
};

/**
 * Buckets whose pages resolve their stubs (card step 14: 'items'; card step 14b: every bucket whose
 * shipped pages carry a stub — measured 2026-10-08 on the lane's data: 5,856 stubs on 1,657 pages of 23
 * buckets). Each bucket is here behind its own case in test/card-stubs.test.tsx (STUB_BUCKET_CASES:
 * the two lists must be equal), and that file fails when a shipped page of a bucket NOT listed carries a
 * resolvable stub, so a new bucket is added with its test or not at all.
 */
export const STUB_HOST_BUCKETS: ReadonlySet<string> = new Set([
  'actions', 'ancestries', 'animalCompanions', 'archetype', 'backgrounds', 'cause', 'classes', 'classFeatures',
  'deviantAbilityClassification', 'familiarAbilities', 'feats', 'heritages', 'implement', 'innovation', 'items',
  'methodology', 'rules', 'sidebar', 'skill', 'skillGeneralAction', 'spells', 'subconsciousMind', 'way',
]);

/**
 * Does the browse card draw the page stubs of a page in this bucket? An item page's are tied to the item
 * popup's switch (docs/card-design.md section 9: a landed surface turns back in one line): with
 * CARD_ON.itemDetail off the browse card of an item page is the one it was before step 14, its stubs drawn
 * as nothing. Every other bucket's (step 14b) turn back by leaving STUB_HOST_BUCKETS.
 */
export function browseResolvesStubs(bucket: string): boolean {
  return STUB_HOST_BUCKETS.has(bucket) && (bucket !== 'items' || cardOn('itemDetail'));
}

/**
 * Does a 'mine' POPUP card (StatDetail's full text, FeatDetail, the action popup, the builder's granted
 * rows, a pinned card) draw the page stubs of the record it opened? Every listed bucket but 'items' and
 * 'spells': an item's 'mine' card is ItemDetail's inset card, which asks for its stubs itself
 * (RecordCardProps `stubs`), and the one 'mine' popup of an item page is the Strike card, which keeps its
 * "only if you have it" gate on the critical specialization (card step 10) — so the Strike card never
 * draws a stub. A spell page's stubs draw on its BROWSE card only (docs/card-design.md section 9 row 14b
 * names the mine cards StatDetail, FeatDetail and the action popup; a spell's own card is SpellDetail's,
 * which its own steps own).
 */
export function mineResolvesStubs(bucket: string): boolean {
  return bucket !== 'items' && bucket !== 'spells' && STUB_HOST_BUCKETS.has(bucket);
}

/** The name and record of a stub whose aon id names no record (src/data/stub-names.json). */
export interface StubName { name: string; ref: string | null; right?: string }
/** Card step 14b: the shipped names of the unresolved stubs, by aon id (scripts/stub-names.mjs). */
export const STUB_NAMES: Readonly<Record<string, StubName>> = (STUB_NAMES_JSON as { names: Record<string, StubName> }).names;

/** An archetype page (its tree's root `aon` is "archetype-N") — its feat stubs draw as a compact list. */
export function isArchetypePage(tree: AstNode | undefined): boolean {
  return /^archetype-\d+$/.test(String((tree as { aon?: unknown } | undefined)?.aon ?? ''));
}
/** A stub an archetype page lists compactly: a feat ("feat-N"). */
export function isListStubId(id: unknown): boolean {
  return /^feat-\d+$/.test(String(id ?? ''));
}

/** The printed name of a page (its level-1 title's first link or text) and its title's badge. */
export function pageHead(tree: AstNode | undefined): { name: string; right?: string } {
  const top = tree?.c ?? [];
  const title = top.find((n) => n.t === 'title' && Number(n.level || 1) <= 1) || top.find((n) => n.t === 'title');
  if (!title) return { name: '' };
  const flat = (n: AstNode): string => (n.t === 'text' ? String(n.v ?? '') : (n.c ?? []).map(flat).join(''));
  const first = (function find(n: AstNode): AstNode | undefined {
    for (const c of n.c ?? []) {
      if (c.t === 'link' || (c.t === 'text' && String(c.v ?? '').trim())) return c;
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  })(title);
  return { name: flat(first ?? title).trim(), ...(title.right ? { right: String(title.right) } : {}) };
}

/** Is this node an empty embedded-page stub (below the root, no children, an aon id)? */
export function isEmptyStub(n: AstNode, depth: number): boolean {
  return (n.t === 'document' || n.t === 'doc') && depth > 0 && !(n.c && n.c.length) && !!(n as StubbedNode).id;
}

/** A content database (or null while none is mounted); read as bucket → id → record. */
type Db = unknown;
const indexCache = new WeakMap<object, Map<string, StubTarget[]>>();

/**
 * aonId → its records, for one content database (cached per database object). Records with an ordinary
 * id come before `aon-`-prefixed duplicates of the same page; otherwise content order (bucket, then
 * record), so the choice is deterministic for a given database.
 */
export function aonIndex(content: Db): Map<string, StubTarget[]> {
  if (!content || typeof content !== 'object') return new Map();
  const hit = indexCache.get(content);
  if (hit) return hit;
  const out = new Map<string, StubTarget[]>();
  for (const [bucket, recs] of Object.entries(content as Record<string, unknown>)) {
    if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
    for (const [slug, r] of Object.entries(recs as Record<string, unknown>)) {
      const aon = r && typeof r === 'object' ? (r as { aonId?: unknown }).aonId : undefined;
      if (typeof aon !== 'string') continue;
      const list = out.get(aon) ?? [];
      list.push({ bucket, slug });
      out.set(aon, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => Number(a.slug.startsWith('aon-')) - Number(b.slug.startsWith('aon-')));
  indexCache.set(content, out);
  return out;
}

/** The ids of every empty stub in a tree (below its root), in document order. */
export function stubIds(tree: AstNode | undefined): string[] {
  const out: string[] = [];
  if (!tree) return out;
  (function walk(n: AstNode, d: number) {
    if (isEmptyStub(n, d)) out.push(String((n as StubbedNode).id));
    for (const c of n.c ?? []) walk(c, d + 1);
  })(tree, 0);
  return out;
}

/** Every bucket a tree's stubs may draw from (all candidates', so the choice never depends on load order). */
export function stubBuckets(tree: AstNode | undefined, index: Map<string, StubTarget[]>): string[] {
  const out = new Set<string>();
  for (const id of stubIds(tree)) for (const t of index.get(id) ?? []) out.add(t.bucket);
  return [...out].sort();
}

/** The page each stub is expected to draw before any bucket has loaded: its first candidate, "bucket:slug". */
export function stubRefs(tree: AstNode | undefined, index: Map<string, StubTarget[]>): string[] {
  return stubIds(tree).map((id) => index.get(id)?.[0]).filter((t): t is StubTarget => !!t).map((t) => `${t.bucket}:${t.slug}`);
}

/** The embedded page's titles moved down to the stub's level: level L becomes L + (stubLevel - 1). */
function demoted(nodes: AstNode[], stubLevel: number): AstNode[] {
  const shift = Math.max(0, stubLevel - 1);
  if (!shift) return nodes;
  const walk = (n: AstNode): AstNode => {
    const c = n.c ? n.c.map(walk) : undefined;
    if (n.t === 'title') return { ...n, level: Number(n.level ?? 1) + shift, ...(c ? { c } : {}) };
    return c ? { ...n, c } : n;
  };
  return nodes.map(walk);
}

/** Card step 14b: how resolveStubs names a stub that draws no page. */
export interface ResolveOptions {
  /** The name and record of a stub id no record's page answers (absent: the stub stays empty). */
  nameOf?: (id: string) => StubName | undefined;
}

/**
 * The tree with its stubs resolved (see the header): one level deep, never the host page or a page
 * already embedded. `hostRef` is the host page's "bucket:slug". Returns the input object when nothing
 * resolved, so a page with no stub is drawn from the very same tree. Card step 14b: on an archetype page
 * a feat stub becomes a compact list entry (`stubKind: 'list'`), and a stub no page answers takes its
 * name from `opts.nameOf` (`stubKind: 'name'`, or a list entry on an archetype page).
 */
export function resolveStubs(
  tree: AstNode,
  hostRef: string,
  candidatesOf: (id: string) => readonly StubTarget[] | undefined,
  treeOf: (bucket: string, slug: string) => AstNode | undefined,
  opts: ResolveOptions = {},
): AstNode {
  const visited = new Set<string>([hostRef]);
  // Card step 14b: an archetype page lists its feats compactly (name + badge, no body).
  const listHost = isArchetypePage(tree);
  const walk = (n: AstNode, depth: number): AstNode => {
    if (isEmptyStub(n, depth)) {
      const stub = n as StubbedNode;
      const id = String(stub.id);
      const list = listHost && isListStubId(id);
      const override = (stub as { 'override-title-right'?: unknown })['override-title-right'];
      const right = (fallback?: string) => {
        const r = override != null && String(override).trim() ? String(override) : fallback;
        return r ? { stubRight: r } : {};
      };
      for (const t of candidatesOf(id) ?? []) {
        const page = treeOf(t.bucket, t.slug);
        if (!page) continue;
        const ref = `${t.bucket}:${t.slug}`;
        if (visited.has(ref)) return n;
        visited.add(ref);
        if (list) {
          const head = pageHead(page);
          return { ...stub, stubOf: ref, stubKind: 'list', stubName: head.name || t.slug, stubLink: ref, ...right(head.right) } as StubbedNode;
        }
        // The embedded page's children as they ship: its own stubs stay empty (one level deep).
        return { ...stub, stubOf: ref, c: demoted(page.c ?? [], Number(stub.level ?? 2)) } as StubbedNode;
      }
      // Card step 14b: no record's page for this id — its name, linked when a record exists for it.
      const named = opts.nameOf?.(id);
      if (named?.name) return { ...stub, stubKind: list ? 'list' : 'name', stubName: named.name, ...(named.ref ? { stubLink: named.ref } : {}), ...right(named.right) } as StubbedNode;
      return n;
    }
    if (!n.c || !n.c.length) return n;
    let changed = false;
    const c = n.c.map((k) => {
      const r = walk(k, depth + 1);
      if (r !== k) changed = true;
      return r;
    });
    return changed ? { ...n, c } : n;
  };
  return walk(tree, 0);
}

/** Does a (resolved) tree draw the page "bucket:slug" through one of its stubs? */
export function embedsPage(tree: AstNode | undefined, ref: string): boolean {
  if (!tree) return false;
  let found = false;
  (function walk(n: AstNode) {
    if (found) return;
    if ((n as StubbedNode).stubOf === ref) { found = true; return; }
    for (const c of n.c ?? []) walk(c);
  })(tree);
  return found;
}

/** Is "bucket:slug" a page of this bucket? */
export function refInBucket(ref: string, bucket: string): boolean {
  return ref.startsWith(`${bucket}:`);
}

/** Does a (resolved) tree draw any page of this bucket through one of its stubs? */
export function embedsFromBucket(tree: AstNode | undefined, bucket: string): boolean {
  if (!tree) return false;
  let found = false;
  (function walk(n: AstNode) {
    if (found) return;
    const from = (n as StubbedNode).stubOf;
    if (from && refInBucket(from, bucket)) { found = true; return; }
    for (const c of n.c ?? []) walk(c);
  })(tree);
  return found;
}

/**
 * The weapon groups a page PRINTS on its own "Group …" lines (card step 14, rule C2), lowercased, in page
 * order. A line is a bold label whose words are exactly "Group" followed by the group's name — a link
 * `weaponGroup:<slug>` where the page links it (every shipped weapon page does), else the next word. A
 * combination weapon prints one line per mode (axe musket: "Group Axe" under Melee, "Group Firearm" under
 * Ranged). Only the tree as given is read: pass the item's OWN page, never a resolved one, so an embedded
 * page's words are not the item's.
 */
export function printedWeaponGroups(tree: AstNode | undefined): string[] {
  const out: string[] = [];
  if (!tree) return out;
  const flat = (n: AstNode): string => (n.t === 'text' ? String(n.v ?? '') : (n.c ?? []).map(flat).join(''));
  (function walk(n: AstNode) {
    const kids = n.c ?? [];
    kids.forEach((k, i) => {
      if (k.t !== 'b' || flat(k).trim() !== 'Group') return;
      for (const next of kids.slice(i + 1)) {
        const ref = (next as { ref?: unknown }).ref;
        if (next.t === 'link' && typeof ref === 'string' && ref.startsWith('weaponGroup:')) { out.push(ref.slice('weaponGroup:'.length)); return; }
        const word = flat(next).trim();
        if (!word) continue;
        const m = /^([A-Za-z][A-Za-z-]*)/.exec(word);
        if (m) out.push(m[1].toLowerCase());
        return;
      }
    });
    for (const c of kids) walk(c);
  })(tree);
  return out;
}

/**
 * A page's tree with its stubs resolved, for a component. `enabled` false → the tree as given. While a
 * bucket a stub may draw from is still loading, the tree is returned as it ships (`pending` true: its
 * stubs draw nothing yet) and the hook re-renders once every such bucket has arrived — the page never
 * waits on another page. A bucket that fails to load arrives empty, and its stubs stay empty.
 */
export function useStubbedTree(
  tree: AstNode | undefined,
  hostRef: string,
  content: Db,
  enabled: boolean,
): { tree: AstNode | undefined; pending: boolean } {
  const index = enabled && tree ? aonIndex(content) : undefined;
  const missing = index ? stubBuckets(tree, index).filter((b) => !isBucketLoaded(b)) : [];
  const key = missing.join(',');
  const [, setArrived] = useState(0);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(key.split(',').map((b) => loadBucketAst(b))).then(() => { if (alive) setArrived((n) => n + 1); });
    return () => { alive = false; };
  }, [key]);
  const resolved = useMemo(
    // The embedded page is read AS IT SHIPS (getCachedAst): never scoped, never cut — it is another
    // record's page, not the character's (card step 14b; a 'mine' card scopes its host page BEFORE this).
    () => (index && tree && !key ? resolveStubs(tree, hostRef, (id) => index.get(id), getCachedAst, { nameOf: (id) => stubNameOf(id, index, content) }) : tree),
    [index, tree, key, hostRef, content],
  );
  return { tree: resolved, pending: !!key };
}

/**
 * Card step 14b: the name a stub draws when no record's page answers it — the shipped STUB_NAMES entry
 * (an aon id no record carries), else, for an id a record carries whose page does not ship, that
 * record's name and link.
 */
export function stubNameOf(id: string, index: Map<string, StubTarget[]>, content: Db): StubName | undefined {
  const named = STUB_NAMES[id];
  if (named) return named;
  for (const t of index.get(id) ?? []) {
    const rec = (content as Record<string, Record<string, { name?: unknown } | undefined> | undefined> | null)?.[t.bucket]?.[t.slug];
    if (rec && typeof rec.name === 'string' && rec.name) return { name: rec.name, ref: `${t.bucket}:${t.slug}` };
  }
  return undefined;
}
