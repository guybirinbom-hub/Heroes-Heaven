import { useEffect, useState } from 'react';
import { loadBucketAst, getCachedAst, loadAstIndex, bucketOf, type AstNode } from './astStore';

/** The importer's slug rule, so a node with only a title can still find its ast (id = slug of name). */
export const astSlug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Raw text of a node — only ever fed to astSlug, which drops everything but letters and digits, so
 *  it deliberately skips AstRenderer's `clean()` template hygiene. */
const flatText = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatText).join(''));

const isSection = (n: AstNode) => n.t === 'title' && Number(n.level ?? 1) === 2;

/**
 * bug 2026-09-12 #6: variant-list — cut a family page down to the ONE variant that was asked for.
 *
 * An AoN family page is a single document shared by every variant record inside it: the ast stored
 * under `magic-wand-2nd-rank-spell` IS the whole "Magic Wand" page, so the popup of the wand a
 * character is holding listed all nine ranks ("Magic Wand (1st-rank Spell) Item 3 … (9th-rank Spell)
 * Item 19") under its description, and the search popup for one rank did the same. Measured on the
 * shipped artefact: 3,068 of 7,537 item asts are such pages (plus 362 itemBonus, 3 siegeWeapons and
 * 1 classFeature).
 *
 * A top-level level-2 section whose title slugs to the record's OWN slug is that record's block, and
 * proves the document is a family page. Keep the shared header + prose that precedes the first
 * section, keep that one block, drop every sibling, and retitle the page after the variant so the
 * popup header reads "Magic Wand (2nd-rank Spell) · Item 5" rather than the family's "Magic Wand ·
 * Item 3+". No matching section — an ordinary record, or the family HEAD, whose page IS the overview
 * — returns the node untouched.
 */
export function variantSection(node: AstNode, slug: string): AstNode {
  const top = node.c ?? [];
  let sections = 0;
  let first = -1;
  let mine = -1;
  for (let i = 0; i < top.length; i++) {
    if (!isSection(top[i])) continue;
    sections++;
    if (first < 0) first = i;
    if (mine < 0 && astSlug(flatText(top[i])) === slug) mine = i;
  }
  if (mine < 0 || sections < 2) return node;
  let end = top.length;
  for (let i = mine + 1; i < top.length; i++) if (isSection(top[i])) { end = i; break; }
  // The family's own level-1 title is dropped — the variant's title takes its place (and its badge).
  const shared = top.slice(0, first).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1));
  return { ...node, c: [{ ...top[mine], level: 1 }, ...shared, ...top.slice(mine + 1, end)] };
}

/**
 * Resolve (and lazily load) the ast for a record — using its explicit bucket key, or the global
 * slug→bucket index when only a slug/title is known. Returns the node + the bucket it resolved to
 * (for self-link suppression). node stays undefined until loaded / when the record has no ast.
 */
export function useAstNode(key: string | undefined, slug: string | undefined): { node?: AstNode; bucket?: string; loading?: boolean } {
  // bug 2026-09-12 #6: variant-list — every read of a stored tree goes through this hook, which is why
  // both the held-item popup (DescBody) and the search popup (DescriptionModal) are fixed at once.
  const own = (n: AstNode | undefined) => (n && slug ? variantSection(n, slug) : n);
  // Seed synchronously from the cache/index so a record that HAS an ast never first renders its plain-text
  // fallback (the "flash of old format"): if we can tell a bucket is expected but isn't cached yet, start in
  // `loading` so the consumer shows a placeholder rather than the fallback until the ast arrives.
  const seed = (): { node?: AstNode; bucket?: string; loading?: boolean } => {
    if (!slug) return {};
    const bucket = key ?? bucketOf(slug);
    if (!bucket) return {}; // no ast known (or the index hasn't loaded yet — resolved in the effect)
    const cached = getCachedAst(bucket, slug);
    if (cached) return { node: own(cached), bucket, loading: false };
    return { bucket, loading: true };
  };
  const [state, setState] = useState(seed);
  useEffect(() => {
    if (!slug) { setState({}); return; }
    let alive = true;
    (async () => {
      let bucket = key;
      if (!bucket) { await loadAstIndex(); bucket = bucketOf(slug); }
      if (!bucket) { if (alive) setState({}); return; }
      const cached = getCachedAst(bucket, slug);
      if (cached) { if (alive) setState({ node: own(cached), bucket, loading: false }); return; }
      if (alive) setState((s) => (s.bucket === bucket && s.loading ? s : { bucket, loading: true }));
      const m = await loadBucketAst(bucket);
      if (alive) setState({ node: own(m[slug]), bucket, loading: false });
    })();
    return () => { alive = false; };
  }, [key, slug]);
  return state;
}
