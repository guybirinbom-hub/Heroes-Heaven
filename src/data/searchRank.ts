/**
 * bug 2026-09-13: search-rank — ONE ranking rule for every search box in the app.
 *
 * Owner (2026-09-13, Add items, searching "waterskin"): *"when i search for a waterskin it is all the
 * way down instead of the first option … that means that water skin needs to be the first thing that
 * appears"*. MEASURED: 19 rows matched, ordered by level-then-name, with Waterskin 16th — behind
 * Adventurer's Pack and 14 class kits whose DESCRIPTION lists a waterskin. Every box in the app
 * filters correctly and none of them ORDER; this module is the missing half.
 *
 * The rule, best first (lower number = better match):
 *
 *   0  the name IS the query
 *   1  the name starts with the query
 *   2  the query appears in the name as a whole word
 *   3  the query appears anywhere in the name
 *   4  multi-word query: every token appears in the name
 *   5  the query appears in another field (traits, description, a kit's contents)
 *   6  multi-word query: every token appears in the name or another field
 *   NO_MATCH  nothing matched
 *
 * Ties keep the caller's EXISTING order — alphabetical, by level, the player's own inventory order.
 * `rankBySearch` sorts on (tier, original index), so ranking only ever lifts the better matches and
 * never reshuffles equals; a box with no query is returned untouched, the same array it passed in.
 *
 * Comparison is case-, diacritic- and whitespace-insensitive, and reads a curly apostrophe as a
 * straight one (the content carries both).
 *
 * A record that does not match at all sorts LAST rather than being dropped: every caller has already
 * applied its own filter, and this must not second-guess it (FeatsTab also matches rarity, the tracker
 * matches creature stats). Ranking is presentation; filtering stays the caller's.
 */

/** Tier for "this record does not match the query at all" — sorts last, is never dropped. */
export const NO_MATCH = 99;

/** Fold a string to the form every comparison here happens in. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does `needle` occur in `hay` on both-side word boundaries? (Both already normalised.) */
function hasWord(hay: string, needle: string): boolean {
  const word = (c: string) => c !== '' && /[a-z0-9]/.test(c);
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!word(hay[i - 1] ?? '') && !word(hay[i + needle.length] ?? '')) return true;
  }
  return false;
}

/**
 * Match quality of one record against a search query. See the tier table above.
 *
 * `other` is everything the box searches BESIDES the name (description, traits, a group label). Pass
 * it as a thunk when producing it is expensive: it is only consulted once a name match has been ruled
 * out, so on a broad query ("a") it is never built at all.
 */
export function searchTier(query: string, name: string, other?: string | (() => string)): number {
  const q = norm(query);
  if (!q) return 0; // no query — every record is equally good, so nothing reorders
  const n = norm(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (hasWord(n, q)) return 2;
  if (n.includes(q)) return 3;
  const toks = q.split(' ');
  if (toks.length > 1 && toks.every((t) => n.includes(t))) return 4;
  if (other === undefined) return NO_MATCH;
  const o = norm(typeof other === 'function' ? other() : other);
  if (o.includes(q)) return 5;
  if (toks.length > 1 && toks.every((t) => n.includes(t) || o.includes(t))) return 6;
  return NO_MATCH;
}

/**
 * Does a record survive the box's own FILTER? The other half of the same rule.
 *
 * adversarially confirmed 2026-09-13: ranking alone left the owner's literal query broken. He wrote
 * *"i searched for water skin"*, and `water skin` typed into Add items matched NOTHING — 0 rows —
 * because every box filters with a plain substring `includes`, which "Waterskin" fails on the space.
 * Ranking cannot lift a row the filter already threw away.
 *
 * A single-word query is exactly `includes`, byte for byte, so nothing about the boxes' existing
 * behaviour moves. A multi-word one also matches when EVERY token is somewhere in the text — the same
 * condition `searchTier` scores as tier 4/6, so the filter can no longer drop a row the ranking was
 * built to rank.
 *
 * `other` is everything the box searches BESIDES the name, the same string the caller hands
 * `rankBySearch` as its `otherOf` — so a box's filter and its ranking read exactly the same fields.
 * With a single-word query `searchMatches(q, name, other)` is `name.includes(q) || other.includes(q)`,
 * i.e. the OR of includes every box already wrote.
 */
export function searchMatches(query: string, text: string, other = ''): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = text.toLowerCase();
  const oth = other.toLowerCase();
  if (hay.includes(q) || oth.includes(q)) return true;
  const toks = q.split(/\s+/);
  return toks.length > 1 && toks.every((t) => hay.includes(t) || oth.includes(t));
}

/**
 * Order an already-filtered list by match quality, best first, ties in the order they arrived.
 *
 * Returns the SAME array reference when there is nothing to rank, so a caller can keep it in a memo
 * without forcing a re-render on every keystroke that clears the box.
 */
export function rankBySearch<T>(
  list: T[],
  query: string,
  nameOf: (t: T) => string,
  otherOf?: (t: T) => string,
): T[] {
  if (!norm(query)) return list;
  return list
    .map((it, i) => ({ it, i, tier: searchTier(query, nameOf(it), otherOf && (() => otherOf(it))) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((s) => s.it);
}

/**
 * Split a picker's search text into name + everything else.
 *
 * FilterableSelect's primary text filter is declared once per spec as `` `${x.name}\n${x.description}` ``
 * (filterSpecs.ts), i.e. the FIRST LINE is the record's name. That convention is what lets one ranking
 * rule serve nine pickers without every spec growing a second accessor — see the note on
 * `FilterField`'s `text` variant, which is where it is enforced.
 */
export function splitNameText(text: string): { name: string; other: string } {
  const nl = text.indexOf('\n');
  return nl < 0 ? { name: text, other: '' } : { name: text.slice(0, nl), other: text.slice(nl + 1) };
}
