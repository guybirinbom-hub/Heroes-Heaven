import { useEffect, useState } from 'react';
import { loadBucketAst, getCachedAst, loadAstIndex, bucketOf, type AstNode } from './astStore';
import { variantSection } from './astVisibility';

/* Card step 1: astSlug, variantSection (bug 2026-09-12 #6) and withoutItemLists (bug 2026-09-15) live in
 * astVisibility.ts, a plain .ts file the card's guard imports through jiti. Re-exported here so every
 * existing importer of this module keeps its import. */
export { astSlug, variantSection, withoutItemLists } from './astVisibility';

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
