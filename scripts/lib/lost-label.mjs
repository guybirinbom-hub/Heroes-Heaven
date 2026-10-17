/*
 * THE LOST LINK LABEL — a sentence whose cross-reference lost the thing it points at.
 *
 * AoN prints "You gain revulsion and sunlight vulnerabilities detailed in the Vampire Vulnerabilities
 * sidebar and the Drink Blood ability." The de-linkifier that builds the plain-text fallback `d`
 * ate the whole link phrase and the sentence shipped as "…vulnerabilities detailed on and the Drink
 * Blood ability." (Vampire Dedication, package I item I4). A reader is told to look "on and" and is
 * never told where. The popup draws the Archives page tree and was right all along; the fallback `d`
 * (search text, tooltips, any AST-less bucket) was the damaged copy.
 *
 * The shape is a REFERENCE VERB + a preposition + nothing — the next token is a conjunction or the
 * end of a clause. Only the verbs that take a document as their object are listed. A bare
 * "<word> in and|or" is ordinary English ("blend in and", "move in or out" — dozens of honest hits
 * across the corpus), and "found in and around" / "found in or near" is ordinary too — so "found"
 * counts only before punctuation ("found in ."), where there is no honest reading at all.
 *
 * Measured 2026-10-17 over every `d` in public/core-descriptions.json: exactly one record
 * (feats/vampire-dedication). scripts/dropped-inline-check.mjs holds the count at zero.
 */
export const LOST_LABEL = new RegExp(
  '\\b(?:' +
    '(?:detailed|described|listed|presented|explained) (?:on|in) (?:and|or)\\b' +
    '|' +
    '(?:detailed|described|found|listed|presented|explained) (?:on|in) [.,;]' +
    ')',
  'i',
);

/** Every `category/id` in a core-descriptions.json-shaped object whose `d` has a lost link label. */
export function findLostLabels(descs) {
  const hits = [];
  for (const [cat, recs] of Object.entries(descs ?? {})) {
    for (const [id, e] of Object.entries(recs ?? {})) {
      if (e && typeof e.d === 'string' && LOST_LABEL.test(e.d)) hits.push(`${cat}/${id}`);
    }
  }
  return hits;
}
