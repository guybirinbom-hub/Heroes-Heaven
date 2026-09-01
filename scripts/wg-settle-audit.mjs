/*
 * A SETTLE MUST BE A DECISION, NOT A DOUBT.
 *
 * The three comparers each carry a registry of differences that have been read and deliberately NOT
 * adopted — `VERIFIED_EQUIVALENT` (wg-diff), `SETTLED_VALUES` (wg-values), `SETTLED_IDENTITIES`
 * (wg-identity). Every entry silences a real difference for good, in every future batch.
 *
 * That makes a hedged justification the most dangerous thing in the project. "Probably equivalent",
 * "I think this is fine", "assuming their row means X" — each reads like a closed question and is an
 * open one, and unlike an unsettled difference it will never be raised again. Batch 10 found five of
 * them by hand; a grep found in minutes what a batch would never have surfaced.
 *
 * So it is a check, run before cutting a new batch and after touching any registry.
 *
 * FAILS on a hedge word in the justification. Passes silently otherwise.
 *
 *   node scripts/wg-settle-audit.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REGISTRIES = [
  ['scripts/wg-diff.mjs', 'VERIFIED_EQUIVALENT'],
  ['scripts/wg-values.mjs', 'SETTLED_VALUES'],
  ['scripts/wg-identity.mjs', 'SETTLED_IDENTITIES'],
];

/*
 * Words that turn a ruling back into a question. Deliberately narrow — a justification may well
 * contain "if", "may" or "could" while stating something definite ("a deity that allows both fonts
 * may take either"), and flagging those would train the reader to skim the output.
 *
 * `\bassume` is included but `assumed to be N` is not the same as "we assume": the phrasing that
 * matters is the author hedging about THEIR data, and every real instance found so far read like one
 * of these.
 */
const HEDGES = [
  /\bprobably\b/i,
  /\bpresumably\b/i,
  /\bpossibly\b/i,
  /\bI think\b/i,
  /\bnot (?:entirely )?sure\b/i,
  /\bunclear\b/i,
  /\bunsure\b/i,
  /\bseems? to\b/i,
  /\bappears? to\b/i,
  /\bassuming\b/i,
  /\bwe assume\b/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bverify\b/i,
  /\bneeds? checking\b/i,
  /\bworth (?:a )?(?:re-?)?check/i,
];

/*
 * …AND A SETTLE MUST STATE ITS GROUNDS.
 *
 * The owner's standing rule, verbatim: *"you are not allowed to do things different then them if i not
 * allow it."* A settle is the one place this app can quietly diverge from Wanderer's Guide, because it
 * silences the very check that would report the divergence — in every future batch, permanently.
 *
 * A hedge-free justification is not enough. It must also say WHY the difference is allowed, and there
 * are only three legitimate grounds:
 *
 *   SAME THING, DIFFERENT FIELD  — the player gets the same result and ours lives elsewhere. The
 *                                  justification has to SAY where.
 *   THE OWNER RULED IT           — he decided this case (their data contradicting the printed text, a
 *                                  menu-filter choice, a conditional shown as a star).
 *   THEY POINT AT NOTHING        — their grant names a record our corpus does not contain, so adopting
 *                                  it would produce a dangling reference.
 *
 * A settle whose prose states none of these is an UNDECLARED DIVERGENCE, which is the exact thing that
 * is not allowed. Failing here is cheap; finding it in the app a year later is not.
 *
 * ⚠ THIS CHECK IS DELIBERATELY OBJECTIVE, NOT SEMANTIC. My first version tried to detect the grounds
 * by matching phrases ("ours lives in…", "the book wins"), and spent three rounds widening the pattern
 * because real justifications say it every way English allows — "now ships as", "we grant it", "the
 * CONTENT is what matters and it is held". A regex that needs constant widening is not a guard; it is a
 * source of false alarms that trains the reader to ignore it.
 *
 * So the mechanical test is only: IS THERE A SUBSTANTIVE JUSTIFICATION AT ALL. Whether the reasoning is
 * actually true is a question for a reader with both encodings in front of them, which is what
 * `settle-divergence-audit.mjs` and its workflow exist to do.
 */
const MIN_JUSTIFICATION = 40;

let findings = 0;
let entries = 0;
const ungrounded = [];

for (const [file, table] of REGISTRIES) {
  let text;
  try { text = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
  const start = text.indexOf(`const ${table} = {`);
  if (start < 0) {
    console.log(`⚠ ${file}: no \`const ${table} = {\` — the audit did not read what it claims to.`);
    findings++;
    continue;
  }
  /* The registry ends at the first line that closes it at column 0. */
  const end = text.indexOf('\n};', start);
  const body = text.slice(start, end < 0 ? text.length : end);

  /* Each entry is a run of comment lines followed by the `'id': [...]` it justifies. */
  const lines = body.split(/\r?\n/);
  let comment = [];
  /** The last real justification seen, carried across a grouped run of entries. */
  let lastProse = '';
  for (const line of lines) {
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) { comment.push(line); continue; }
    const m = /^\s*'([^']+)'\s*:/.exec(line);
    if (m) {
      entries++;
      const prose = comment.join(' ');
      /*
       * ⚠ A COMMENT BLOCK JUSTIFIES THE WHOLE RUN THAT FOLLOWS IT, not just the first entry. Several
       * settles are grouped under one justification — the undead dedications share a single block above
       * `ghost-dedication` — and resetting the prose after each entry reported 81 settles as having no
       * grounds when most of them were simply the 2nd, 3rd and 4th line of a group. `lastProse` carries
       * the block forward until a genuinely new one appears.
       */
      if (prose.trim()) lastProse = prose;
      const justification = (prose.trim() ? prose : lastProse).replace(/^[\s*/-]+/, '').trim();
      if (justification.length < MIN_JUSTIFICATION) ungrounded.push(`${table}['${m[1]}']`);
      const hit = HEDGES.filter((h) => h.test(prose));
      if (hit.length) {
        findings++;
        console.log(`\n${file} → ${table}['${m[1]}']`);
        for (const h of hit) {
          const w = prose.match(h);
          const at = prose.indexOf(w[0]);
          console.log(`   hedge: "${w[0]}"  …${prose.slice(Math.max(0, at - 90), at + 110).replace(/\s+/g, ' ').trim()}…`);
        }
      }
    }
    if (line.trim() !== '' && !/^\s*(\/\*|\*|\/\/)/.test(line)) comment = [];
  }
}

console.log(`\n${entries} settle(s) read across ${REGISTRIES.length} registries.`);
if (ungrounded.length) {
  console.log(
    `\n${ungrounded.length} settle(s) carry no substantive justification.\n` +
      `A settle is the one place this app can quietly diverge from Wanderer's Guide, and the owner's rule\n` +
      `is that it may not without his say-so. Write why this difference is allowed — the same thing in a\n` +
      `different field (and WHERE ours lives), a ruling he gave, or a grant of theirs pointing at a record\n` +
      `our corpus does not contain:\n`,
  );
  for (const u of ungrounded) console.log(`   ${u}`);
  findings += ungrounded.length;
}
if (findings) {
  console.log(
    `\n${findings} settle(s) justified with a hedge. A settle silences a difference in EVERY future` +
      `\nbatch, so an open question written as a closed one never comes back. Read the record again and` +
      `\neither justify it definitely or remove the entry.`,
  );
  process.exit(1);
}
console.log('Every settle states a decision.');
