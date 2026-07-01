import type { ContentDatabase, DescRef } from '../rules/types';

// Common English words that are ALSO action/condition names — auto-linking every occurrence of these
// would be noise, so they stay plain (they're still linkable where the SRD wrapped them in a @UUID).
const STOP = new Set([
  'aid', 'step', 'hide', 'seek', 'leap', 'grab', 'ready', 'open', 'reach', 'press', 'crawl', 'stand',
  'mount', 'point', 'escape', 'delay', 'release', 'interact', 'sustain', 'dismiss', 'arrest', 'take',
  'drop', 'sense', 'lost', 'burn', 'cover', 'long', 'good', 'free',
]);

const cache = new WeakMap<object, DescRef[]>();

/**
 * Known terms to auto-link in EVERY rendered description, so a player can tap "frightened",
 * "off-guard", "Demoralize", etc. wherever it appears — not only where the SRD author wrapped it in a
 * link. Conditions + actions only: feats/spells/items are intentionally excluded because their names
 * collide heavily with common words (a spell named "Light", an item named "Rope") and would over-link.
 * Memoized per ContentDatabase (the merged link regex is rebuilt cheaply per render from this).
 */
export function autoRefs(content: ContentDatabase): DescRef[] {
  const hit = cache.get(content);
  if (hit) return hit;
  const refs: DescRef[] = [];
  const seen = new Set<string>();
  const add = (map: Record<string, { name?: string; description?: string }> | undefined, key: string) => {
    if (!map) return;
    for (const e of Object.values(map)) {
      const name = e?.name;
      if (!name || !e.description) continue;
      const lc = name.toLowerCase();
      if (lc.length < 4 || STOP.has(lc) || seen.has(lc)) continue;
      seen.add(lc);
      refs.push({ label: name, key });
    }
  };
  const c = content as unknown as Record<string, Record<string, { name?: string; description?: string }>>;
  add(c.conditions, 'conditions'); // conditions first so they win a name tie
  add(c.actions, 'actions');
  cache.set(content, refs);
  return refs;
}
