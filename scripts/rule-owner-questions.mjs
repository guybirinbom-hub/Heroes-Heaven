/*
 * Write the owner's desk answers of 2026-09-10 INTO the rulings desk.
 *
 * WHY THIS EXISTS. On 2026-09-10 Guy went down the whole rulings desk in one sitting and answered 128
 * of the open questions (work/desk-answers-2026-09-10.json). Batch 037 applied the FIXES those answers
 * ask for, but the desk file itself was never updated: all 128 still sit in `open`, which means the
 * gates still treat them as waiting on him, gate 8 still accepts an `OWNER-QUEUED` verdict for them,
 * and the next rulings pass would put questions he has already answered back in front of him. He has
 * said twice that the volume of what he is asked is the problem, so a question answered and not
 * recorded is a real cost, not bookkeeping.
 *
 * WHY A SCRIPT AND NOT A HAND-EDIT. The desk number `n` is permanent — he answers by number ("104,
 * keep ours") — and work/owner-questions.json is read by the parity gates. A hand-edit of 128 entries
 * is how a number ends up shifted or an entry silently dropped; the same reasoning that made
 * scripts/add-owner-question.mjs the only writer for ADDING a question makes this the only writer for
 * ruling one. It MOVES the entry between arrays and adds three fields; it never rewrites a field the
 * entry already had, and never touches `n`. The ONE exception is the `quote` on an authorised exception
 * this script itself authored, which is re-synced from `EXCEPTIONS` below — see the comment there.
 *
 * WHAT IT REFUSES (exit 2, nothing written): a desk number the answers file names that is not on the
 * desk at all; a number named twice in the answers; a number that is not in `open` (it is deferred, or
 * an authorised exception, or already ruled by some OTHER pass). The one thing it tolerates is its own
 * second run: an entry already in `ruled` carrying this pass's `rulingSource` is "already applied".
 *
 *   node scripts/rule-owner-questions.mjs                    # dry run: print the plan
 *   node scripts/rule-owner-questions.mjs --write            # move the entries + add the exceptions
 *   node scripts/rule-owner-questions.mjs --reverdict --write # also write the re-verdict bulk file
 *   [--answers <path>] [--desk <path>] [--out <path>]        # for the test's temp copies
 *
 * --reverdict writes work/.desk-reverdict-2026-09-11.json: one row per (batch, record) whose parity
 * verdict is still OWNER-QUEUED and whose question he has now answered, in the shape
 * scripts/record-parity-verdict.mjs --bulk reads ({batch, id, evidence, verdict}). Those rows have to
 * be re-verdicted or gate 8 goes red the other way round — OWNER-QUEUED asserts the id is in `open`,
 * and after this script runs it no longer is.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendQuestions } from './add-owner-question.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARRAYS = ['open', 'deferred', 'ruled', 'authorisedExceptions'];
const SOURCE = 'desk pass 2026-09-10, work/desk-answers-2026-09-10.json';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const REVERDICT = argv.includes('--reverdict');
const flag = (k, dflt) => {
  const i = argv.indexOf(k);
  const v = i >= 0 ? argv[i + 1] : null;
  return v ? (isAbsolute(v) ? v : join(ROOT, v)) : join(ROOT, dflt);
};
const ANSWERS = flag('--answers', 'work/desk-answers-2026-09-10.json');
const DESK = flag('--desk', 'work/owner-questions.json');
const OUT = flag('--out', 'work/.desk-reverdict-2026-09-11.json');

/**
 * The two divergences from Wanderer's Guide he authorised in this pass. They are NOT questions — they
 * are permissions, so they go straight to `authorisedExceptions` in that array's own shape. The desk
 * number is minted by the ONE allocator (appendQuestions: max(n) over all four arrays + 1), then the
 * entry is moved out of `open` and reshaped; the allocator is reused rather than re-implemented so a
 * number can never be handed out twice.
 */
const EXCEPTIONS = [
  {
    id: 'authorised-shoanti-unifying-emblem-family',
    ruling: '2026-09-10',
    what: 'The seven Shoanti Unifying Emblems are implemented in full, past what Wanderer\'s Guide encodes: the three he read (Shundar-Quah / Thoughtful Gift, Sklar-Quah / Concordant Choir at the spell\'s own 1-3 action cost, Tamiir-Quah / Tailwind once per day) and the rest of the family with them. This is a ONE-FAMILY permission, not a licence to go past WG anywhere else.',
    records: [
      'unifying-emblem-lyrune-quah',
      'unifying-emblem-shadde-quah',
      'unifying-emblem-shriikirri-quah',
      'unifying-emblem-shundar-quah',
      'unifying-emblem-sklar-quah',
      'unifying-emblem-skoan-quah',
      'unifying-emblem-tamiir-quah',
    ],
    quote: 'for this case specifically because i went over this and approve we can implement the rest of the family',
  },
  {
    id: 'authorised-trust-gate-class-features-and-item-spells',
    ruling: '2026-09-11',
    what: 'Trust gate: core class features and item-held spells are switched back ON, against the gate\'s own rule that anything Wanderer\'s Guide does not encode goes dark. They are what makes a character playable at all — a class with its features off is not a character, and an item whose spell is off is an item that does nothing — so they are exempt until the print-read lane puts them in the ledger properly.',
    quote: '"Yes, switch them back on. I add the core class features and the item-held spells to the approvals list. A rogue gets sneak attack dice again, a barbarian gets Rage, a staff offers its spells. Everything else stays dark as ruled." (verbatim, 2026-09-11 — work/desk-answers-2026-09-10.json, key trust_gate_directive_2026-09-10.decided_2026-09-11[0])',
  },
];

/* ================================================================================================= *
 *  Read the two files and plan the moves.
 * ================================================================================================= */
const answersDoc = JSON.parse(readFileSync(ANSWERS, 'utf8'));
const desk = JSON.parse(readFileSync(DESK, 'utf8'));
for (const a of ARRAYS) desk[a] ??= [];

/** n -> { answer, note, ruling, ruledOn }. A number named twice is a refusal, not a last-one-wins. */
const byNumber = new Map();
const refusals = [];
for (const entry of answersDoc.answers ?? []) {
  for (const n of entry.ns ?? []) {
    if (byNumber.has(n)) { refusals.push(`#${n}: named twice in the answers file — which answer is his?`); continue; }
    const note = String(entry.note ?? '').trim();
    byNumber.set(n, {
      answer: String(entry.answer ?? '').trim(),
      note,
      /* He carried on ruling into the next day; the note is where that shows. */
      ruledOn: /2026-09-11/.test(note) ? '2026-09-11' : '2026-09-10',
    });
  }
}

const whereIs = new Map();
for (const a of ARRAYS) for (const e of desk[a]) whereIs.set(Number(e.n), a);

const plan = [];
const already = [];
for (const [n, ans] of byNumber) {
  const at = whereIs.get(n);
  if (at === undefined) { refusals.push(`#${n}: no entry with that desk number exists in ${DESK}.`); continue; }
  if (at === 'ruled') {
    const e = desk.ruled.find((x) => Number(x.n) === n);
    if (e?.rulingSource === SOURCE) { already.push(n); continue; }
    refusals.push(`#${n}: already in \`ruled\` from another pass (${e?.rulingSource ?? e?.ruling ?? 'no source recorded'}) — this pass must not overwrite it.`);
    continue;
  }
  if (at !== 'open') { refusals.push(`#${n}: sits in \`${at}\`, not \`open\`. Only an open question can be ruled here.`); continue; }
  plan.push({ n, ...ans });
}

if (refusals.length) {
  console.error(`REFUSED — ${refusals.length}; nothing written:`);
  for (const r of refusals.sort()) console.error(`  ${r}`);
  process.exit(2);
}

/* ================================================================================================= *
 *  Apply: move open -> ruled, keeping n and every field the entry already had.
 * ================================================================================================= */
const toRule = new Map(plan.map((p) => [p.n, p]));
const moved = [];
desk.open = desk.open.filter((e) => {
  const p = toRule.get(Number(e.n));
  if (!p) return true;
  e.ruling = `${p.answer} — ${p.note}`;
  e.ruledOn = p.ruledOn;
  e.rulingSource = SOURCE;
  desk.ruled.push(e);
  moved.push(e);
  return false;
});

/* The exceptions, through the shared allocator. `appendQuestions` pushes onto `open`; the entry is
 * pulled straight back out and rewritten in the authorisedExceptions shape ({n, ruling, what, records?,
 * quote}) — all that is borrowed is the number. `numbers` is deliberately NOT passed: an authorised
 * exception carries no id in the file, so registering one in rulings-numbering.json would leave an id
 * there that nothing in the desk matches. max(n) over the four arrays already keeps it unique. */
const addedExceptions = [];
const haveException = new Set(desk.authorisedExceptions.map((e) => e.what));
const wanted = EXCEPTIONS.filter((x) => !haveException.has(x.what));
if (wanted.length) {
  const { added, refused } = appendQuestions(
    desk,
    wanted.map((x) => ({ id: x.id, batch: 37, printed: '-', theirs: '-', ours: '-', question: '-' })),
  );
  if (refused.length) {
    console.error(`REFUSED — the exception allocator: ${refused.join(' ')}`);
    process.exit(2);
  }
  for (const stub of added) {
    desk.open = desk.open.filter((e) => e !== stub);
    const src = wanted.find((x) => x.id === stub.id);
    const entry = { n: stub.n, ruling: src.ruling, what: src.what };
    if (src.records) entry.records = src.records;
    entry.quote = src.quote;
    desk.authorisedExceptions.push(entry);
    addedExceptions.push(entry);
  }
}

/* An exception already on the desk keeps its number, its `what` and its records; its QUOTE is re-synced
 * from EXCEPTIONS above. This script AUTHORED those entries, so EXCEPTIONS is where their wording
 * lives, and a quote is the one field that legitimately improves after the fact: #157 was written with
 * a placeholder saying the owner's verbatim 2026-09-11 words were not on file. They are now
 * (work/desk-answers-2026-09-10.json, key trust_gate_directive_2026-09-10.decided_2026-09-11), and a
 * hand edit of work/owner-questions.json is exactly what this script exists to prevent. */
const requoted = [];
for (const src of EXCEPTIONS) {
  const e = desk.authorisedExceptions.find((x) => x.what === src.what);
  if (e && e.quote !== src.quote) { e.quote = src.quote; requoted.push(e.n); }
}

/* ================================================================================================= *
 *  The re-verdict rows for scripts/record-parity-verdict.mjs --bulk.
 * ================================================================================================= */
let rows = [];
if (REVERDICT) {
  const work = dirname(DESK);
  const idOf = new Map();
  for (const a of ARRAYS) for (const e of desk[a]) if (e.id) idOf.set(e.id, Number(e.n));
  const files = existsSync(work) ? readdirSync(work).filter((f) => /^wg-batch-\d+-parity\.json$/.test(f)).sort() : [];
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(work, f), 'utf8'));
    for (const r of doc.records ?? []) {
      if (r.verdict !== 'OWNER-QUEUED') continue;
      const n = idOf.get(r.id);
      const ans = n === undefined ? undefined : byNumber.get(n);
      if (!ans) continue; // still genuinely open, or deferred — leave the verdict alone
      /* Many answers are the single word "yes", which tells a later reader of the parity file nothing
       * about WHAT was ruled — so a short answer carries the head of his note with it. */
      const full = ans.answer.length < 40 && ans.note ? `${ans.answer} — ${ans.note}` : ans.answer;
      const short = full.length > 180 ? `${full.slice(0, 177)}...` : full;
      rows.push({ batch: Number(doc.batch), id: r.id, evidence: `owner ruled ${ans.ruledOn} (#${n}): ${short}`, verdict: 'OWNER-RULED' });
    }
  }
}

/* ================================================================================================= *
 *  Report, then write.
 * ================================================================================================= */
const count = (a) => desk[a].length;
console.log(`ruled:      ${moved.length} moved open -> ruled${already.length ? ` (${already.length} already applied by an earlier run of this script)` : ''}`);
console.log(`open:       ${count('open')} left${count('open') ? ` (#${desk.open.map((e) => e.n).sort((a, b) => a - b).join(', #')})` : ''}`);
console.log(`ruled now:  ${count('ruled')}`);
console.log(`deferred:   ${count('deferred')} (untouched)`);
console.log(`exceptions: ${count('authorisedExceptions')}${addedExceptions.length ? ` (+${addedExceptions.length}: #${addedExceptions.map((e) => e.n).join(', #')})` : ''}${requoted.length ? ` (re-quoted: #${requoted.join(', #')})` : ''}`);
console.log(`max n:      ${Math.max(...ARRAYS.flatMap((a) => desk[a].map((e) => Number(e.n))))}`);
if (REVERDICT) console.log(`re-verdict: ${rows.length} row(s) over ${new Set(rows.map((r) => r.batch)).size} batch file(s) -> ${OUT}`);

if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
writeFileSync(DESK, `${JSON.stringify(desk, null, 1)}\n`);
console.log(`\nwritten: ${DESK}`);
if (REVERDICT) { writeFileSync(OUT, `${JSON.stringify(rows, null, 1)}\n`); console.log(`written: ${OUT}`); }
