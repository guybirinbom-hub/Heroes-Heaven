import { useEffect, useState } from 'react';
import { loadBucketAst, getCachedAst, loadAstIndex, bucketOf, type AstNode } from './astStore';

/** The importer's slug rule, so a node with only a title can still find its ast (id = slug of name). */
export const astSlug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Resolve (and lazily load) the ast for a record — using its explicit bucket key, or the global
 * slug→bucket index when only a slug/title is known. Returns the node + the bucket it resolved to
 * (for self-link suppression). node stays undefined until loaded / when the record has no ast.
 */
export function useAstNode(key: string | undefined, slug: string | undefined): { node?: AstNode; bucket?: string; loading?: boolean } {
  // Seed synchronously from the cache/index so a record that HAS an ast never first renders its plain-text
  // fallback (the "flash of old format"): if we can tell a bucket is expected but isn't cached yet, start in
  // `loading` so the consumer shows a placeholder rather than the fallback until the ast arrives.
  const seed = (): { node?: AstNode; bucket?: string; loading?: boolean } => {
    if (!slug) return {};
    const bucket = key ?? bucketOf(slug);
    if (!bucket) return {}; // no ast known (or the index hasn't loaded yet — resolved in the effect)
    const cached = getCachedAst(bucket, slug);
    if (cached) return { node: cached, bucket, loading: false };
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
      if (cached) { if (alive) setState({ node: cached, bucket, loading: false }); return; }
      if (alive) setState((s) => (s.bucket === bucket && s.loading ? s : { bucket, loading: true }));
      const m = await loadBucketAst(bucket);
      if (alive) setState({ node: m[slug], bucket, loading: false });
    })();
    return () => { alive = false; };
  }, [key, slug]);
  return state;
}
