/*
 * EVERY SETTLE, AUDITED FOR UNAUTHORISED DIVERGENCE FROM WANDERER'S GUIDE.
 *
 * The owner's standing rule: *"you are not allowed to do things different than them if i not allow
 * it."* A settle silences a reported difference, so each one is a claim that the difference does not
 * matter — and a wrong claim is precisely how "we do it our way" gets into the corpus unnoticed.
 *
 * This does not judge the claims (a model re-reading its own justifications would agree with itself).
 * It EXTRACTS them: every settle, its registry, the record, the kinds silenced, and the verbatim
 * justification written above it, so each can be checked against their encoding and the printed text.
 *
 * Classification is by what the justification SAYS about itself, and is deliberately crude — the three
 * buckets are a work list, not a verdict:
 *
 *   AUTHORISED   cites one of the owner's explicit rulings (book-overrides-them, menu filtering, the
 *                always-on-number rule). Permitted.
 *   CARRIER      claims the same behaviour reached by a different field. This is the process working
 *                as designed — "adopt their reading, re-expressed in our fields" — but it is also the
 *                easiest place to hide a real difference, so these need the closest reading.
 *   UNCLASSIFIED says neither. Read first.
 *
 *   node scripts/settle-divergence-audit.mjs               # summary
 *   node scripts/settle-divergence-audit.mjs --list        # every settle with its justification
 *   node scripts/settle-divergence-audit.mjs --bucket CARRIER
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIST = process.argv.includes('--list');
const WANT = arg('--bucket', null);

const FILES = [
  ['wg-diff.mjs', 'VERIFIED_EQUIVALENT', 'KINDS'],
  ['wg-values.mjs', 'SETTLED_VALUES', 'VALUES'],
  ['wg-identity.mjs', 'SETTLED_IDENTITIES', 'IDENTITY'],
];

/* The owner's explicit rulings — the only permitted grounds for differing from them. */
const AUTHORISED = [
  /contradicts the book/i,
  /the book wins/i,
  /owner ruling/i,
  /printed (?:text|rules) (?:is|are) the authority/i,
  /menu filter|filtering the options/i,
  /only when it'?s always|a condition the sheet cannot see/i,
];
/* Claims of same-behaviour-different-field. Legitimate by the process, and the place to look hardest. */
const CARRIER = [
  /different carrier/i, /same behaviour/i, /re-expressed/i, /covered by/i, /lives in|lives on/i,
  /our side ships|ours ships|we ship/i, /same shape/i, /name collision/i, /their format cannot|cannot express/i,
  /does not exist (?:on our side|in our corpus)/i, /no counterpart/i,
];

const rows = [];
for (const [file, registry, gate] of FILES) {
  const src = readFileSync(join(ROOT, 'scripts', file), 'utf8');
  const start = src.indexOf(`${registry} = {`);
  if (start < 0) { console.error(`no ${registry} in ${file}`); continue; }
  const body = src.slice(start);
  const lines = body.split(/\r?\n/);

  /*
   * Walk the registry, carrying the comment block that precedes each entry.
   *
   * ⚠ ONE COMMENT CAN COVER SEVERAL ENTRIES. Clearing the block after the first entry reported every
   * later one as having NO justification: the batch-14 resistance block names ghostly-resistance,
   * mortification AND hardened-chassis and sits above all three, so `mortification` was credited with
   * the whole comment and `hardened-chassis` came back with an empty `why` — a settle that looked
   * unjustified while its reason sat four lines above it. The audit lying about the registry is worse
   * than an unjustified settle, because it sends the next pass to re-litigate a settled question.
   *
   * The carry-over rule follows how the registries are actually laid out: a comment block covers the
   * CONTIGUOUS RUN of entries beneath it, and a blank line ends that run. This is what the source
   * means — the batch-14 resistance block sits above `mortification` and `hardened-chassis` with no
   * gap, and the proficiency-step block above `magical-fortitude`, `precognitive-reflexes` and
   * `unbreakable-expertise` names none of the three by id but plainly covers all of them. A blank line
   * is a real boundary: `shoony-lore` sits one below it and genuinely has no grounds written.
   *
   * The rule stays proximity-based rather than "assume the nearest comment applies", so an entry
   * separated from the discussion above it still reports bare instead of borrowing a justification.
   */
  let comment = [];
  let runComment = [];
  let depth = 0;
  for (const line of lines) {
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    const entry = /^\s*'([a-z0-9-]+)':\s*(\[[^\]]*\]|\[)/.exec(line);
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) { comment.push(line.replace(/^\s*(\/\*+|\*\/|\*|\/\/)\s?/, '').trimEnd()); continue; }
    if (!line.trim()) { runComment = []; comment = []; continue; } // a blank line ends the run
    if (entry) {
      const kinds = (entry[2].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
      if (comment.length) runComment = comment;
      const why = runComment.join(' ').replace(/\s+/g, ' ').trim();
      const bucket = AUTHORISED.some((re) => re.test(why)) ? 'AUTHORISED' : CARRIER.some((re) => re.test(why)) ? 'CARRIER' : 'UNCLASSIFIED';
      rows.push({ gate, registry, id: entry[1], kinds, why, bucket });
      comment = [];
      continue;
    }
    if (line.trim() && !entry) comment = []; // a non-comment, non-entry line ends the block
    if (depth <= 0 && /^\};/.test(line)) break;
  }
}

const byBucket = {};
for (const r of rows) (byBucket[r.bucket] ??= []).push(r);

console.log(`${rows.length} settle(s) across the three comparers.\n`);
for (const b of ['UNCLASSIFIED', 'CARRIER', 'AUTHORISED']) {
  const list = byBucket[b] ?? [];
  console.log(`  ${String(list.length).padStart(3)}  ${b}`);
}
console.log('\nby gate:');
const byGate = {};
for (const r of rows) byGate[r.gate] = (byGate[r.gate] ?? 0) + 1;
for (const [g, n] of Object.entries(byGate)) console.log(`  ${String(n).padStart(3)}  ${g}`);

writeFileSync(join(ROOT, 'work/settle-audit.json'), JSON.stringify(rows, null, 1) + '\n');
console.log('\n-> work/settle-audit.json');

if (LIST || WANT) {
  for (const r of rows) {
    if (WANT && r.bucket !== WANT) continue;
    console.log(`\n  [${r.bucket}] ${r.gate} ${r.id}  silences ${JSON.stringify(r.kinds)}`);
    console.log(`     ${r.why.slice(0, 260) || '(no justification written)'}`);
  }
}

/*
 * GUARD: A SETTLE WITHOUT WRITTEN GROUNDS IS AN UNDECLARED DIVERGENCE.
 *
 * Every entry in these three registries SILENCES a real difference between their encoding and ours.
 * The owner's standing rule is that we match them unless he has allowed otherwise, so a silenced
 * difference with no stated reason is precisely the thing that rule forbids — and it is invisible,
 * because the gate it silences goes quiet by design.
 *
 * `shoony-lore` is why this exists. It sat bare, and reading it showed the settle was simply wrong:
 * their giveAbilityBlock hands over the Additional Lore FEAT, which grants skill increases at 3rd,
 * 7th and 15th that the printed text never mentions. A settle nobody had to justify hid a real
 * divergence for as long as nobody looked.
 *
 * Grounds are only checked for PRESENCE here. Whether they are GOOD grounds is the audit's buckets and
 * a human read — a regex cannot judge that, and pretending it can is how the earlier "grounds" test
 * ended up being widened three times until it matched anything.
 */
const ungrounded = rows.filter((r) => !String(r.why ?? '').trim());
if (ungrounded.length) {
  console.error(`\nsettle-divergence-audit: FAIL — ${ungrounded.length} settle(s) silence a difference with no reason written:\n`);
  for (const r of ungrounded) console.error(`   ${r.gate} ${r.registry} ${r.id}  silences ${JSON.stringify(r.kinds)}`);
  console.error(
    '\nWrite the grounds in a comment above the entry (a comment covers the contiguous run beneath it),\n' +
      'or remove the settle so the gate reports the difference again. If the difference is real and needs\n' +
      "the owner's decision, record it: node scripts/add-owner-question.mjs --id <id> …",
  );
  process.exit(1);
}
console.log('\nsettle-divergence-audit: ok — every settle states why.');
