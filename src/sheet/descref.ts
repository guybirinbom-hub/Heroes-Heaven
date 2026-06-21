import type { ContentDatabase, DescRef } from '../rules/types';

/** A node in the description-navigation stack: a title + its (linkable) description. */
export interface DescNode {
  title: string;
  description: string;
  descRefs?: DescRef[];
  /** The content-map name this node resolves against ('feats'/'spells'/…). Carried into the pin
   *  identity to disambiguate cross-map name collisions (a feat + a spell sharing a name). */
  key?: string;
}

/** Same slug rule as the importer, so a ref label resolves to its content id. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Per-(content,key) lowercase-name → entry index, memoized so repeated lookups are cheap.
const nameIdxCache = new WeakMap<object, Record<string, Map<string, { name: string; description?: string; descRefs?: DescRef[] }>>>();

function nameIndex(content: ContentDatabase, key: string) {
  let perContent = nameIdxCache.get(content);
  if (!perContent) {
    perContent = {};
    nameIdxCache.set(content, perContent);
  }
  if (!perContent[key]) {
    const idx = new Map<string, { name: string; description?: string; descRefs?: DescRef[] }>();
    const map = (content as unknown as Record<string, Record<string, { name: string }>>)[key];
    if (map) for (const e of Object.values(map)) if (e?.name) idx.set(e.name.toLowerCase(), e as never);
    perContent[key] = idx;
  }
  return perContent[key];
}

/** Resolve a description cross-reference to the node it points at, or null if not found.
 *  Handles valued labels ("Frightened 2" → frightened) and parentheticals. */
export function lookupRef(content: ContentDatabase, ref: DescRef): DescNode | null {
  const map = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>>)[ref.key];
  if (!map) return null;
  const raw = ref.label.trim();
  const base = raw
    .replace(/\s*\(.*\)\s*$/, '') // drop a trailing "(...)"
    .replace(/\s+\d+$/, '') // drop a trailing condition value ("Frightened 2")
    .trim();
  const cands = base && base !== raw ? [raw, base] : [raw];
  for (const cand of cands) {
    const e = map[slugify(cand)];
    if (e) return toNode(e, ref.key);
  }
  const idx = nameIndex(content, ref.key);
  for (const cand of cands) {
    const e = idx.get(cand.toLowerCase());
    if (e) return toNode(e, ref.key);
  }
  return null;
}

function toNode(e: { name: string; description?: string; descRefs?: DescRef[] }, key?: string): DescNode {
  return { title: e.name, description: e.description ?? '', descRefs: e.descRefs, key };
}
