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
export function useAstNode(key: string | undefined, slug: string | undefined): { node?: AstNode; bucket?: string } {
  const [state, setState] = useState<{ node?: AstNode; bucket?: string }>({});
  useEffect(() => {
    if (!slug) { setState({}); return; }
    let alive = true;
    (async () => {
      let bucket = key;
      if (!bucket) { await loadAstIndex(); bucket = bucketOf(slug); }
      if (!bucket) { if (alive) setState({}); return; }
      const cached = getCachedAst(bucket, slug);
      if (cached) { if (alive) setState({ node: cached, bucket }); return; }
      const m = await loadBucketAst(bucket);
      if (alive) setState({ node: m[slug], bucket });
    })();
    return () => { alive = false; };
  }, [key, slug]);
  return state;
}
