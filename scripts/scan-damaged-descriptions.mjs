/*
 * FIND DESCRIPTIONS WHOSE PRINTED VALUES WERE DELETED AT IMPORT.
 *
 *   node scripts/scan-damaged-descriptions.mjs            # the count, by damage shape
 *   node scripts/scan-damaged-descriptions.mjs --list     # every record
 *   node scripts/scan-damaged-descriptions.mjs --shape gap-before-punctuation
 *
 * The importer dropped inline values out of some descriptions and left the surrounding sentence
 * intact, which is the worst possible failure: the text is grammatical, so it reads as finished, and
 * it is wrong. Aerial Boomerang shipped as "races away from you in a . Each creature in the area takes
 * damage with a save against your class DC" — no range, no dice, no save named. Battle Medicine said
 * "The target is then to your Battle Medicine for 1 day".
 *
 * This is not a fallback surface. MainTab's action popup renders `description` through RichText with
 * no ast key, so it is exactly what a player reads at the table.
 *
 * The audit found four by reading four feats. Reading all of them is a scan, not a batch of agents —
 * the damage has a SHAPE, and a shape can be searched for. Each pattern below is anchored on a
 * grammatical impossibility rather than on a guess: English does not put a space before a full stop,
 * and "is then to" is not a sentence.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LIST = process.argv.includes('--list');
const ONLY = arg('shape', null);

const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));

/* Each shape is a hole the importer left. `why` is what a reader loses, because a count with no
 * example is a number nobody can act on.
 *
 * EXPORTED so `test/authoring-guards.test.ts` ratchets against these exact definitions rather than a
 * copy. Two registries for one rule is the failure this project keeps having — a hand-copied duplicate
 * of the situational rules, a second home for battle-form traits — and it would be absurd to introduce
 * another one in the tooling built to prevent it. */
export const SHAPES = [
  { key: 'gap-before-punctuation', re: /\s+[.,;)]/, why: 'a value was removed and its space survived — "in a ." was "in a 60-foot line."' },
  { key: 'dangling-article', re: /\b(?:a|an|the)\s+(?:[.,;]|$)/i, why: 'an article with nothing after it — the noun it introduced is gone' },
  { key: 'is-then-to', re: /\bis then (?:to|for)\b/, why: '"The target is then to your Battle Medicine" — the adjective ("immune") was dropped' },
  /* Tightened: a bare "takes damage" is often CORRECT ("whenever the ward takes damage, the damage is
   * reduced by…"), so it only counts as damage where a quantity was clearly removed — the phrase ends
   * the clause, or runs straight into the save it should have been quantified before. */
  { key: 'takes-damage-unquantified', re: /\btakes\s+damage\s*(?:[.,;]|with a\b|$)/, why: 'a damage expression with no dice and no type' },
  { key: 'against-a-save', re: /\bwith a save against\b/, why: 'the save is unnamed: "a basic Reflex save" became "a save"' },
  /* Anchored on a sequence impossible in correct English (an article running straight into a
   * preposition), never on whitespace — the crackling-bubble-gum family shipped "in a with a save"
   * for months and NONE of the shapes above could see it: the article had text after it, the damage
   * had dice, and the save was nowhere near the article. */
  { key: 'article-into-preposition', re: /\b(?:a|an)\s+(?:with|against|from|into|onto|upon)\b/, why: 'an article running straight into a preposition — the noun between them was removed ("in a with a save" was "in a 15-foot cone with a DC 19 basic Fortitude save")' },
  { key: 'empty-parens', re: /\(\s*\)/, why: 'a parenthetical whose contents were removed' },
];

/* ⚠ A "double space mid-sentence" shape was tried and REMOVED. It matched 2,018 records and I spot-
 * checked two: both were ordinary blank lines between paragraphs, turned into double spaces by this
 * script's own newline normalisation. It was detecting its own preprocessing. Every shape above is
 * anchored on something that cannot occur in correct English prose — a space before a full stop, an
 * article with nothing after it — rather than on whitespace, which this pipeline mangles freely. */

/** The one place a description is normalised before matching. Markup and entities produce spacing
 *  that is not damage, so they go first. */
export const normalise = (raw) =>
  String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\r?\n/g, ' ');

export function scan(desc) {
  const hits = new Map(SHAPES.map((s) => [s.key, []]));
  let scanned = 0;
  for (const [category, recs] of Object.entries(desc)) {
    if (!recs || typeof recs !== 'object') continue;
    for (const [id, v] of Object.entries(recs)) {
      if (typeof v?.d !== 'string' || !v.d) continue;
      scanned++;
      const text = normalise(v.d);
      for (const s of SHAPES) if (s.re.test(text)) hits.get(s.key).push(category + '/' + id);
    }
  }
  return { hits, scanned, damaged: new Set([...hits.values()].flat()) };
}

const { hits, scanned, damaged: all } = scan(desc);
console.log(`scanned ${scanned} descriptions`);
console.log(`${all.size} carry at least one shape of import damage\n`);
for (const s of SHAPES) {
  const ids = hits.get(s.key);
  if (ONLY && s.key !== ONLY) continue;
  console.log(`${String(ids.length).padStart(5)}  ${s.key}`);
  console.log(`       ${s.why}`);
  if (LIST || ONLY) for (const i of ids) console.log(`         ${i}`);
  else if (ids.length) console.log(`       e.g. ${ids.slice(0, 4).join(', ')}`);
}
console.log('\nrepair one with the printed text from the AoN mirror, then add it to');
console.log('scripts/apply-import-damaged-text.mjs — that writes BOTH the overlay row (durable) and');
console.log('public/core-descriptions.json (live), which is the only combination that works for this field.');
