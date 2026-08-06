/**
 * Lazy per-bucket ast loader (migration Step 1). The description render trees live in
 * public/ast/<bucket>.json (too large to ship in core.json — see the migration plan). A bucket's
 * file is fetched once on first description-open and cached; subsequent opens are synchronous.
 */

/** A node in the AoN render tree (see scripts/import-core-v2.mjs / the archives' Ast.tsx). */
export interface AstNode {
  t: string;
  c?: AstNode[];
  v?: string;
  /** action-cost words, e.g. "Two Actions" (on `actions` nodes) */
  string?: string;
  /** resolved cross-ref "bucket:slug", or null when the target is an unshipped category */
  ref?: string | null;
  /** original numeric AoN id of a link target */
  to?: number;
  /** true = auto-matched term (dashed) vs author-written reference (dotted) */
  auto?: boolean;
  /** heading level on title nodes */
  level?: number;
  /** right-aligned header badge, e.g. "Spell 3" */
  right?: string;
  /** merged table cells — 288 colspan and 62 rowspan ship, mostly in the class advancement tables */
  colspan?: string | number;
  rowspan?: string | number;
  /** trait chip label / url */
  label?: string;
  url?: string;
}

type Bucket = Record<string, AstNode>;

const BASE = import.meta.env.BASE_URL || '/';
const cache = new Map<string, Bucket>();
const inflight = new Map<string, Promise<Bucket>>();

/** Fetch + parse a bucket's ast map. The buckets ship GZIPPED (`<bucket>.json.gz`) because the raw JSON is
 *  far too large for static-host per-file limits (items is ~36 MB raw, ~2.6 MB gzipped). We fetch the .gz
 *  and decompress in the browser. Robust to a host that auto-applies `Content-Encoding: gzip` (which makes
 *  the browser decompress for us): we sniff the gzip magic bytes and only decompress when it's still
 *  compressed. Falls back to the raw `.json` (present in local dev) if the .gz path fails. */
async function fetchBucketAst(bucket: string): Promise<Bucket> {
  try {
    const r = await fetch(`${BASE}ast/${bucket}.json.gz`);
    if (r.ok) {
      const buf = new Uint8Array(await r.arrayBuffer());
      const stillGzipped = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
      let text: string;
      if (stillGzipped && typeof DecompressionStream !== 'undefined') {
        const stream = new Response(buf).body!.pipeThrough(new DecompressionStream('gzip'));
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder().decode(buf); // server already decompressed it
      }
      return JSON.parse(text) as Bucket;
    }
  } catch {
    /* fall through to the raw-json fallback */
  }
  try {
    const r = await fetch(`${BASE}ast/${bucket}.json`);
    return r.ok ? ((await r.json()) as Bucket) : {};
  } catch {
    return {};
  }
}

/** Fetch (once) and cache a bucket's ast map. Resolves to {} on error so a missing file degrades
 *  gracefully to the record's plain-text description fallback. */
export function loadBucketAst(bucket: string): Promise<Bucket> {
  const hit = cache.get(bucket);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(bucket);
  if (pending) return pending;
  const p = fetchBucketAst(bucket)
    .then((map: Bucket) => {
      cache.set(bucket, map);
      inflight.delete(bucket);
      return map;
    })
    .catch(() => {
      cache.set(bucket, {});
      inflight.delete(bucket);
      return {};
    });
  inflight.set(bucket, p);
  return p;
}

/** Synchronous read of an already-loaded ast (undefined until the bucket is cached). */
export function getCachedAst(bucket: string, slug: string): AstNode | undefined {
  return cache.get(bucket)?.[slug];
}

export function isBucketLoaded(bucket: string): boolean {
  return cache.has(bucket);
}

/* ---- slug -> preferred bucket index (lets a description-opener with only a title find its ast) ---- */
let indexCache: Record<string, string> | null = null;
let indexPromise: Promise<Record<string, string>> | null = null;

export function loadAstIndex(): Promise<Record<string, string>> {
  if (indexCache) return Promise.resolve(indexCache);
  if (indexPromise) return indexPromise;
  indexPromise = fetch(`${BASE}ast-index.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((m: Record<string, string>) => { indexCache = m; return m; })
    .catch(() => { indexCache = {}; return {}; });
  return indexPromise;
}

/** Synchronous bucket lookup for a slug (undefined until the index is loaded). */
export function bucketOf(slug: string): string | undefined {
  return indexCache?.[slug];
}
