import { useEffect, useMemo, useState } from 'react';
import { getCachedAst, isBucketLoaded, loadBucketAst, type AstNode } from './astStore';
import { cardOn } from './cardSurfaces';

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
 * card — both behind CARD_ON.itemDetail (browseResolvesStubs), so the switch turns both back. Other buckets' stubs (archetype pages' 2,664 feat stubs want a compact list first; rules, class
 * and feat pages embed actions), the other 'mine' cards and the name links for unresolved stubs are step
 * 14b (docs/card-design.md section 2 rule 6, section 9); Strike keeps its "only if you have it" gate for
 * the critical specialization in both.
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

/** A resolved stub: the stub node with the embedded page's children and the page it came from. */
export type StubbedNode = AstNode & { stubOf?: string; id?: string };

/** Buckets whose pages resolve their stubs on the browse card (card step 14). */
export const STUB_HOST_BUCKETS: ReadonlySet<string> = new Set(['items']);

/**
 * Does the browse card draw the page stubs of a page in this bucket? Tied to the item popup's switch
 * (docs/card-design.md section 9: a landed surface turns back in one line): with CARD_ON.itemDetail off
 * the browse card of an item page is the one it was before step 14, its stubs drawn as nothing.
 */
export function browseResolvesStubs(bucket: string): boolean {
  return cardOn('itemDetail') && STUB_HOST_BUCKETS.has(bucket);
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

/**
 * The tree with its stubs resolved (see the header): one level deep, never the host page or a page
 * already embedded. `hostRef` is the host page's "bucket:slug". Returns the input object when nothing
 * resolved, so a page with no stub is drawn from the very same tree.
 */
export function resolveStubs(
  tree: AstNode,
  hostRef: string,
  candidatesOf: (id: string) => readonly StubTarget[] | undefined,
  treeOf: (bucket: string, slug: string) => AstNode | undefined,
): AstNode {
  const visited = new Set<string>([hostRef]);
  const walk = (n: AstNode, depth: number): AstNode => {
    if (isEmptyStub(n, depth)) {
      const stub = n as StubbedNode;
      for (const t of candidatesOf(String(stub.id)) ?? []) {
        const page = treeOf(t.bucket, t.slug);
        if (!page) continue;
        const ref = `${t.bucket}:${t.slug}`;
        if (visited.has(ref)) return n;
        visited.add(ref);
        // The embedded page's children as they ship: its own stubs stay empty (one level deep).
        return { ...stub, stubOf: ref, c: demoted(page.c ?? [], Number(stub.level ?? 2)) } as StubbedNode;
      }
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
    () => (index && tree && !key ? resolveStubs(tree, hostRef, (id) => index.get(id), getCachedAst) : tree),
    [index, tree, key, hostRef],
  );
  return { tree: resolved, pending: !!key };
}
