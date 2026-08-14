/*
 * SKILL-SUBSTITUTION ROWS THE DESCRIPTION PARSER CANNOT REACH.
 *
 * `scripts/backfill-skill-substitutions.mjs` PARSES every row it writes out of the record's own
 * description — the pair AND the condition — because a substitution typed by hand is a rule nobody
 * checked against the book. A handful of records say the same thing in wording the parser's `PAIR`
 * regex cannot see, and those are written here instead, each one quoted from its printed text.
 *
 * It lives in its own module, not inside the applier, for one reason: the applier is a top-level
 * script that WRITES public/core.json and the overlay the moment it is imported, so nothing else —
 * including the test that checks these rows actually reached the data — could read the table without
 * running it. One table, two readers:
 *   • scripts/backfill-skill-substitutions.mjs merges it after its parse (a parsed row still wins)
 *   • test/authoring-guards.test.ts fails if a row here is missing from core.json or the overlay
 *
 * READER for the value itself: `skillSubstitutions` (src/rules/derive.ts) → `authoredSituational`
 * (src/rules/explain.ts), which turns a CONDITIONAL substitution into a `*` on `forSkill`. A row with
 * no `when` would instead MOVE the number (deriveSkill), so every row here carries one.
 */
export const MANUAL_SKILL_SUBSTITUTIONS = {
  /*
   * Acrobatic Performer (AoN feat-6458, Player Core 2 p.226): "You can ROLL an Acrobatics check
   * instead of a Performance check when using the Perform action."
   *
   * The PAIR regex requires the literal verb "use" before the skill, so this record has never been
   * seen by the parser and its substitution reached no surface at all. Widening the regex to
   * `use|roll` across 6,312 records is a corpus-wide change that needs its own measured pass.
   */
  'feats/acrobatic-performer': [{ use: 'acrobatics', forSkill: 'performance', when: 'when using the Perform action' }],
};
