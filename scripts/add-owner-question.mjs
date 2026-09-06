/*
 * Append a contested record to work/owner-questions.json.
 *
 * The owner's standing rule is that our implementation matches Wanderer's Guide exactly, and that
 * where their encoding looks to contradict the printed text I do NOT decide — verbatim: *"if you think
 * that the way wg does things is not according to the text then ask me dont make that desion by
 * yourself, your job is to endsure that we doing the same as them."*
 *
 * So a contested record gets recorded rather than resolved, and the batch's parity verdict stays OPEN
 * until he rules. This exists so that recording one is a single command instead of a hand-edit of a
 * file that the parity gate reads — a hand-edit is how a question ends up half-written and silently
 * dropped from the list he is shown at the end.
 *
 * docs/wg-batch-pipeline.md, section B, makes this the ONLY writer the batch pipeline uses — *"the
 * existing writer — no sixth writer"* — and gives it four guards, because from here on an AGENT calls
 * it rather than a person who has just read the record:
 *   · it allocates the desk number `n` as *"max(n) + 1"* over all four arrays, never from a position:
 *     positions shift when an entry moves from `open` to `ruled`, and a shifted number is a ruling
 *     landing on the wrong record;
 *   · it *"refuses an existing id (a follow-up gets its own `n`)"* — a second question about the same
 *     record is a NEW entry (`--id <id>-2 --follow-up-of <id>`), never an overwrite of one he may
 *     already have been shown;
 *   · it *"refuses an entry whose `printed` names no AoN doc id"* — a printed text nobody can look up
 *     is not answerable;
 *   · it *"refuses an entry whose `theirs` quotes no op that `wg-show.mjs --raw` prints"* — the guard
 *     against a WG side described from memory, which is the failure this whole file exists to prevent.
 *
 *   node scripts/add-owner-question.mjs --id <id> --batch <n> --printed "..." --theirs "..." --ours "..." --question "..." [--follow-up-of <id>] [--name "<WG record name>"] [--write]
 *   node scripts/add-owner-question.mjs --from work/.bNNN-queue.json [--write]
 *
 * The batch pipeline uses the second form: the closer never edits owner-questions.json, it writes
 * work/.bNNN-queue.json and the driver's `gaps` stage feeds it through here.
 *
 * THE ALLOCATOR IS EXPORTED (`appendQuestions`) so that the OTHER queueing script in this repo,
 * scripts/queue-owner-questions.mjs, mints its numbers here instead of `doc.open.push(...)`. A question
 * queued through that script used to land with no `n` at all, which is the same "sixth writer" the plan
 * forbids wearing a different hat. Everything below the allocator is the CLI, and runs only when this
 * file is the entry point — importing it must not start a run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'work/owner-questions.json');
const NUMBERS = join(ROOT, 'work/rulings-numbering.json');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const ARRAYS = ['open', 'deferred', 'ruled', 'authorisedExceptions'];
const REQUIRED = ['id', 'batch', 'printed', 'theirs', 'ours', 'question'];
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * THE desk-number allocator. Mutates `doc` (pushing onto `open`) and, when given, `numbers.numbers`.
 *
 * `n = max(n over all four arrays ∪ rulings-numbering.json) + 1`, never a position: an entry moving from
 * `open` to `ruled` shifts every position after it, and the owner answers by NUMBER.
 *
 * Returns { added, refused }. A duplicate id is REFUSED rather than merged — the owner may already have
 * been shown the first one, and a second question about the same record is a new entry with its own n
 * (`--id <id>-2 --follow-up-of <id>`).
 */
export function appendQuestions(doc, entries, numbers = null) {
  for (const a of ARRAYS) doc[a] ??= [];
  const whereIs = new Map();
  for (const a of ARRAYS) for (const e of doc[a]) if (e.id) whereIs.set(e.id, a);
  let next = Math.max(
    0,
    ...ARRAYS.flatMap((a) => doc[a].map((e) => Number(e.n) || 0)),
    ...Object.values(numbers?.numbers ?? {}).map(Number),
  ) + 1;

  const added = [];
  const refused = [];
  for (const e of entries) {
    const at = whereIs.get(e.id);
    if (at) {
      refused.push(`${e.id}: already on the desk in \`${at}\` (n=${doc[at].find((q) => q.id === e.id)?.n}). A follow-up is a NEW entry: --id ${e.id}-2 --follow-up-of ${e.id}.`);
      continue;
    }
    const entry = { n: next++, id: e.id, batch: Number(e.batch), printed: e.printed, theirs: e.theirs, ours: e.ours, question: e.question };
    if (e.followUpOf) entry.followUpOf = e.followUpOf;
    doc.open.push(entry);
    whereIs.set(entry.id, 'open');
    if (numbers) { numbers.numbers ??= {}; numbers.numbers[entry.id] = entry.n; }
    added.push(entry);
  }
  return { added, refused };
}

/* ================================================================================================= *
 *  CLI — runs only as the entry point.
 * ================================================================================================= */
function cli() {
  const WRITE = process.argv.includes('--write');
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

  /* ---------- the entries to add ---------- */
  const from = arg('--from');
  const incoming = from
    ? JSON.parse(readFileSync(isAbsolute(from) ? from : join(ROOT, from), 'utf8'))
    : [{
        id: arg('--id'),
        batch: Number(arg('--batch')),
        printed: arg('--printed'),
        theirs: arg('--theirs'),
        ours: arg('--ours'),
        question: arg('--question'),
        ...(arg('--follow-up-of') ? { followUpOf: arg('--follow-up-of') } : {}),
        ...(arg('--name') ? { name: arg('--name') } : {}),
      }];
  if (!Array.isArray(incoming)) { console.error(`--from ${from} must hold a JSON ARRAY of queue entries.`); process.exit(2); }

  const refusals = [];
  const refuse = (id, why) => refusals.push(`${id ?? '(no id)'}: ${why}`);

  /* ---------- guard 1: every field present ---------- */
  for (const e of incoming) {
    for (const k of REQUIRED) {
      const v = e[k];
      if (v === null || v === undefined || v === '' || (k === 'batch' && Number.isNaN(Number(v))))
        refuse(e.id, `missing ${k}. Every field is required: a half-written question cannot be ruled on.`);
    }
  }

  /* ---------- guard 2: no id already on the desk, and no id twice in one run ---------- */
  const doc = JSON.parse(readFileSync(PATH, 'utf8'));
  for (const a of ARRAYS) doc[a] ??= [];
  const whereIs = new Map();
  for (const a of ARRAYS) for (const e of doc[a]) if (e.id) whereIs.set(e.id, a);
  const seenHere = new Set();
  for (const e of incoming) {
    const at = whereIs.get(e.id);
    if (at) refuse(e.id, `already on the desk in \`${at}\` (n=${doc[at].find((q) => q.id === e.id)?.n}). A follow-up is a NEW entry: --id ${e.id}-2 --follow-up-of ${e.id}.`);
    if (e.id && seenHere.has(e.id)) refuse(e.id, 'appears twice in this run.');
    if (e.id) seenHere.add(e.id);
    if (e.followUpOf && !whereIs.has(e.followUpOf)) refuse(e.id, `followUpOf "${e.followUpOf}" is not an entry in this file.`);
  }

  /* ---------- guard 3: `printed` names a real AoN doc id ---------- */
  /* `<category>-<number>` is the mirror's own filename, so the check is the FILE existing rather than a
   * shape that looks about right — "feat-99999" has the shape and answers nothing. */
  for (const e of incoming) {
    const ids = [...String(e.printed ?? '').matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-(\d+)\b/g)].map((m) => `${m[1]}-${m[2]}`);
    if (!ids.length) { refuse(e.id, 'printed names no AoN doc id (<category>-<number>), so the printed text cannot be checked.'); continue; }
    if (!existsSync(MIRROR)) { console.log(`  (no AoN mirror at ${MIRROR} — ${e.id}: "${ids[0]}" accepted on shape alone)`); continue; }
    const real = ids.filter((id) => existsSync(join(MIRROR, id.slice(0, id.lastIndexOf('-')), `${id}.json`)));
    if (!real.length) refuse(e.id, `printed names ${ids.map((i) => `"${i}"`).join(', ')}, and no such document exists in the AoN mirror.`);
  }

  /* ---------- guard 4: `theirs` quotes an op their dump really carries ---------- */
  const collect = (ops, out) => {
    for (const op of ops ?? []) {
      if (!op || typeof op !== 'object') continue;
      if (op.type) out.add(String(op.type));
      const d = op.data ?? {};
      if (d.variable) out.add(String(d.variable));
      collect(d.trueOperations, out); collect(d.falseOperations, out); collect(d.operations, out);
      for (const o of d.optionsPredefined ?? []) collect(o.operations, out);
    }
  };
  function theirOps(name) {
    let out;
    try {
      out = execFileSync(process.execPath, [join(ROOT, 'scripts/wg-show.mjs'), name, '--raw'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    } catch (err) {
      return { ok: false, why: `wg-show.mjs failed for "${name}": ${String(err.message).split('\n')[0]}` };
    }
    const ops = new Set();
    for (const block of out.split('--- raw ---').slice(1)) {
      const end = block.indexOf('\n=== ');
      try { collect(JSON.parse(block.slice(0, end === -1 ? undefined : end).trim()), ops); } catch { /* a later block may still parse */ }
    }
    return { ok: true, ops, none: /No ability_block row|encode nothing mechanical/.test(out) };
  }
  for (const e of incoming) {
    if (!e.theirs || !e.id) continue;
    const r = theirOps(e.name ?? e.id);
    if (!r.ok) { refuse(e.id, r.why); continue; }
    if (!r.ops.size) {
      /* Nothing of theirs to quote. "They carry no row" / "they encode nothing mechanical" is itself a
       * legitimate question and there is no op it could name, so this reports instead of refusing. */
      console.log(`  (${e.id}: wg-show prints no operations${r.none ? ' — they encode nothing here' : ''}; the THEIRS check has nothing to compare against)`);
      continue;
    }
    const t = String(e.theirs).toLowerCase();
    if (![...r.ops].some((op) => t.includes(op.toLowerCase())))
      refuse(e.id, `theirs quotes none of the ops wg-show.mjs --raw prints for "${e.name ?? e.id}" (${[...r.ops].slice(0, 12).join(', ')}${r.ops.size > 12 ? ', …' : ''}). Name the op type or variable you actually read.`);
  }

  if (refusals.length) {
    console.error(`REFUSED — ${refusals.length} entr${refusals.length === 1 ? 'y' : 'ies'}; nothing written:`);
    for (const r of refusals) console.error(`  ${r}`);
    process.exit(2);
  }

  /* ---------- allocate the desk number and append ---------- */
  const num = JSON.parse(readFileSync(NUMBERS, 'utf8'));
  const { added, refused } = appendQuestions(doc, incoming, num);
  if (refused.length) {
    console.error(`REFUSED — ${refused.length}; nothing written:`);
    for (const r of refused) console.error(`  ${r}`);
    process.exit(2);
  }
  for (const entry of added) console.log(`#${entry.n}  ${entry.id}  (batch ${entry.batch})`);
  console.log(`\n${doc.open.length} open question(s); ${added.length} added.`);
  if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
  writeFileSync(PATH, JSON.stringify(doc, null, 1) + '\n');
  writeFileSync(NUMBERS, JSON.stringify(num, null, 1) + '\n');
  console.log('written: work/owner-questions.json + work/rulings-numbering.json.');
}

if (IS_MAIN) cli();
