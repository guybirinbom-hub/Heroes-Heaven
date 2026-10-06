import { useEffect, useState } from 'react';
import { loadBucketAst, getCachedAst, loadAstIndex, bucketOf, type AstNode } from './astStore';
import { isNotOwnPage, pageSliceOf, sliceBucketOf, sliceOf, variantSection } from './astVisibility';

/* Card step 1: astSlug, variantSection (bug 2026-09-12 #6) and withoutItemLists (bug 2026-09-15) live in
 * astVisibility.ts, a plain .ts file the card's guard imports through jiti. Re-exported here so every
 * existing importer of this module keeps its import. */
export { astSlug, variantSection, withoutItemLists } from './astVisibility';

/**
 * Resolve (and lazily load) the ast for a record — using its explicit bucket key, or the global
 * slug→bucket index when only a slug/title is known. Returns the node + the bucket it resolved to
 * (for self-link suppression). node stays undefined until loaded / when the record has no ast.
 *
 * Card step 12 (docs/card-design.md section 9 row 12; astVisibility.ts recordTree, the same resolution
 * the card guard reads through): a record with a slice in src/data/page-slices.json reads that paragraph
 * / section of the bigger page it lives in (the page's bucket is loaded; the RECORD's bucket is
 * returned); a record listed in src/data/not-own-page.json reads NO tree, so every popup falls back to
 * its own text; every other record reads its own tree through the variantSection cut.
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
    const bucket = key ?? bucketOf(slug) ?? sliceBucketOf(slug);
    if (!bucket) return {}; // no ast known (or the index hasn't loaded yet — resolved in the effect)
    const slice = pageSliceOf(bucket, slug);
    if (slice) {
      const page = getCachedAst(slice.bucket, slice.page);
      return page ? { node: sliceOf(page, slice), bucket, loading: false } : { bucket, loading: true };
    }
    if (isNotOwnPage(bucket, slug)) return {};
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
      if (!bucket) { await loadAstIndex(); bucket = bucketOf(slug) ?? sliceBucketOf(slug); }
      if (!bucket) { if (alive) setState({}); return; }
      const slice = pageSliceOf(bucket, slug);
      if (slice) {
        const cachedPage = getCachedAst(slice.bucket, slice.page);
        if (!cachedPage && alive) setState((s) => (s.bucket === bucket && s.loading ? s : { bucket, loading: true }));
        const page = cachedPage ?? (await loadBucketAst(slice.bucket))[slice.page];
        if (alive) setState({ node: page ? sliceOf(page, slice) : undefined, bucket, loading: false });
        return;
      }
      if (isNotOwnPage(bucket, slug)) { if (alive) setState({}); return; }
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
