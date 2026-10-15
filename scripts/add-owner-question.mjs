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
 *   [--desk <path>] [--numbers <path>] [--approvals <path>]   # for a test's temp copies
 *
 * The batch pipeline uses the second form: the closer never edits owner-questions.json, it writes
 * work/.bNNN-queue.json and the driver's `gaps` stage feeds it through here.
 *
 * ONE QUESTION, THREE FILES. A new desk number also needs an `unruled` line in
 * scripts/data/trust-approvals.json — test/trust-approvals.test.ts requires every desk number to have
 * exactly one disposition there, and a question filed this year is never in the closed 2026-09-10
 * answers file, so `unruled` is the only one it can have. This tool used to write the desk and the
 * numbering file only, and #171 (2026-10-15) left the suite red until the line was added by hand. It
 * writes that line itself now (addUnruledLines, below). Two more places move with every question —
 * the desk roster count in test/trust-approvals.test.ts and the PARKS table in
 * test/batch035-gate-park.test.ts — and both are hand-made pins ("nothing may widen past them
 * silently"), so this tool never edits them: it PRINTS each change as a `PIN` line (testPins, below;
 * the batch driver copies them into its digest), and refuses a record#aspect id whose record part
 * parks nothing.
 *
 * THE ALLOCATOR IS EXPORTED (`appendQuestions`) so that the OTHER queueing script in this repo,
 * scripts/queue-owner-questions.mjs, mints its numbers here instead of `doc.open.push(...)`. A question
 * queued through that script used to land with no `n` at all, which is the same "sixth writer" the plan
 * forbids wearing a different hat. Everything below the allocator is the CLI, and runs only when this
 * file is the entry point — importing it must not start a run.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { batchValue } from './lib/batch-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'scripts/wg-batch-gate.mjs');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const ARRAYS = ['open', 'deferred', 'ruled', 'authorisedExceptions'];
const REQUIRED = ['id', 'batch', 'printed', 'theirs', 'ours', 'question'];
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * A batch is either a WG-parity batch NUMBER (30) or a PRINT-lane batch TAG (P02 — work/print-batch-P02.json).
 * `Number(e.batch)` alone turned "P02" into NaN, so the gaps stage of print batch P02 could not file its
 * one owner question ("missing batch") even though the entry named its batch. A print tag is kept as the
 * string it is, through the same batchValue() every parity/residual writer uses (scripts/lib/batch-paths.mjs);
 * anything else must be a number. Returns NaN for a value that is neither, which guard 1 refuses.
 */
export const batchOf = (v) => {
  const value = batchValue(v);
  return typeof value === 'number' || /^P\d+$/.test(value) ? value : NaN;
};

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
    const entry = { n: next++, id: e.id, batch: batchOf(e.batch), printed: e.printed, theirs: e.theirs, ours: e.ours, question: e.question };
    if (e.followUpOf) entry.followUpOf = e.followUpOf;
    doc.open.push(entry);
    whereIs.set(entry.id, 'open');
    if (numbers) { numbers.numbers ??= {}; numbers.numbers[entry.id] = entry.n; }
    added.push(entry);
  }
  return { added, refused };
}

const APPROVAL_LISTS = ['approvals', 'noMechanic', 'engine', 'unruled'];
const UNRULED_ROW = /^(\s*)\{\s*"n"\s*:\s*(\d+)\s*,.*\}\s*,?\s*$/;

/**
 * The `unruled` lines of scripts/data/trust-approvals.json for entries `appendQuestions` just added.
 * Returns { text, refused }; on any refusal `text` is the input unchanged.
 *
 * ⚠ EDITED AS TEXT, NOT RE-SERIALISED — the same reason scripts/rule-owner-questions.mjs gives: the
 * file is hand-curated with one readable line per `unruled` entry, and `JSON.stringify` would explode
 * all of them. Each new line goes before the first entry with a higher `n` (or last), in the file's own
 * line ending and indent; the only other line that can change is the old last entry, which gains its
 * comma. The parse afterwards is the CHECK: every other list is unchanged, every old `unruled` entry is
 * still there in its order, and each new one holds { n, id, status: "open" }.
 *
 * Refuses a number that already has a disposition in any of the four lists — one number, one line.
 */
export function addUnruledLines(text, entries) {
  if (!entries.length) return { text, refused: [] };
  const fail = (why) => ({ text, refused: [why] });
  let before;
  try { before = JSON.parse(text); } catch (err) { return fail(`trust-approvals.json does not parse: ${err.message}`); }
  if (!Array.isArray(before.unruled)) return fail('trust-approvals.json has no `unruled` array.');
  const refused = [];
  for (const e of entries) {
    for (const k of APPROVAL_LISTS) {
      if ((before[k] ?? []).some((x) => Number(x.n) === e.n)) refused.push(`#${e.n} ${e.id}: trust-approvals.json already files #${e.n} in \`${k}\` — one number, one disposition.`);
    }
  }
  if (refused.length) return { text, refused };

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const head = lines.findIndex((l) => /^\s*"unruled"\s*:\s*\[\s*$/.test(l));
  if (head < 0) return fail('trust-approvals.json: no `"unruled": [` line — the array is not one entry per line, so the line cannot be added as text.');
  let end = head + 1;
  while (end < lines.length && !/^\s*\]/.test(lines[end])) end++;
  if (end >= lines.length) return fail('trust-approvals.json: the `unruled` array never closes on a line of its own.');
  const rows = lines.slice(head + 1, end).filter((l) => l.trim() !== '');
  const parsed = rows.map((l) => UNRULED_ROW.exec(l));
  if (!rows.length || parsed.some((m) => !m)) return fail('trust-approvals.json: an `unruled` line is not one `{ "n": … }` entry, so the line cannot be added as text.');

  const body = rows.map((l, i) => ({ line: l.replace(/,\s*$/, ''), n: Number(parsed[i][2]) }));
  const indent = parsed[0][1];
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    const line = `${indent}{ "n": ${e.n}, "id": ${JSON.stringify(e.id ?? null)}, "status": "open" }`;
    const at = body.findIndex((r) => r.n > e.n);
    body.splice(at < 0 ? body.length : at, 0, { line, n: e.n });
  }
  const out = [...lines.slice(0, head + 1), ...body.map((r, i) => (i < body.length - 1 ? `${r.line},` : r.line)), ...lines.slice(end)].join(eol);

  /* The check. */
  let after;
  try { after = JSON.parse(out); } catch (err) { return fail(`the edited trust-approvals.json does not parse (${err.message}) — nothing written.`); }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of Object.keys({ ...before, ...after })) {
    if (k !== 'unruled' && !same(before[k], after[k])) return fail(`the edit touched trust-approvals.json \`${k}\` — nothing written.`);
  }
  const newNs = new Set(entries.map((e) => e.n));
  if (!same(after.unruled.filter((x) => !newNs.has(Number(x.n))), before.unruled)) return fail('the edit moved or changed an existing `unruled` entry — nothing written.');
  for (const e of entries) {
    const got = after.unruled.filter((x) => Number(x.n) === e.n);
    if (got.length !== 1 || got[0].id !== (e.id ?? null) || got[0].status !== 'open') return fail(`the \`unruled\` line for #${e.n} did not land as intended — nothing written.`);
  }
  return { text: out, refused: [] };
}

const ARRAY_COUNT = (doc) => ARRAYS.reduce((sum, a) => sum + (doc?.[a]?.length ?? 0), 0);
/** Every pin line starts with this, so a caller that only sees the output (the batch driver) can find them. */
const PIN = '  PIN ';

/**
 * The HAND-MADE test pins that new desk entries move. This tool never edits a test — the pins exist so
 * that nothing changes silently — so it says exactly what to change, one `PIN` line each:
 *
 *   · test/trust-approvals.test.ts pins the desk roster count. Every new entry raises it.
 *   · test/batch035-gate-park.test.ts pins the PARKS table: every record a desk id parks that is not
 *     the record's own id. Asked of the gate's own resolver (`--queued-parks`) on the desk BEFORE and
 *     AFTER the append, rather than re-implemented here, so the difference is what that test will see —
 *     an added park, and also one a new entry REPLACES (open beats deferred) or REMOVES (an exact
 *     record id beats a record#aspect one). The desk copies go to a temp folder; the gate joins every
 *     path onto the repo root, so it is handed RELATIVE paths.
 *
 * Returns { pins, notes, refused }. A `record#aspect` id must park exactly its record part: one that
 * parks nothing (no such record) or parks a shorter record through the hyphen walk is a typo the gate
 * would act on silently, so it is refused.
 */
export function testPins(beforeDoc, afterDoc, added) {
  const pins = [];
  const notes = [];
  const refused = [];
  if (!added.length) return { pins, notes, refused };
  const from = ARRAY_COUNT(beforeDoc);
  const to = ARRAY_COUNT(afterDoc);
  pins.push(`${PIN}test/trust-approvals.test.ts: the desk roster grows from ${from} to ${to} — change expect(deskNumbers.length).toBe(${from}) and the count in that test's title to ${to}, with a comment naming the new desk number(s).`);

  const dir = mkdtempSync(join(tmpdir(), 'hh-owner-question-'));
  try {
    const [beforeFile, afterFile, batchFile] = ['before.json', 'after.json', 'batch.json'].map((f) => join(dir, f));
    writeFileSync(beforeFile, JSON.stringify(beforeDoc));
    writeFileSync(afterFile, JSON.stringify(afterDoc));
    writeFileSync(batchFile, '{}');
    const rel = (p) => relative(ROOT, p);
    if (isAbsolute(rel(afterFile))) return { pins, notes, refused: [`the temp folder ${dir} is on another drive than the repo, so the gate cannot be asked which records the new entries park.`] };
    const probe = (deskFile, ...extra) => execFileSync(process.execPath, [GATE, '--batch', rel(batchFile), '--queue', rel(deskFile), ...extra], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
    }).trim();
    let was;
    let now;
    try {
      const widened = (f) => new Map(probe(f, '--queued-parks').split('\n').filter(Boolean).map((l) => l.trim().split('\t')));
      was = widened(beforeFile);
      now = widened(afterFile);
    } catch (err) {
      return { pins, notes, refused: [`the gate's --queued-parks probe failed, so the PARKS pin cannot be checked: ${String(err.message).split('\n')[0]}`] };
    }
    const key = (rec) => (/^[A-Za-z_$][\w$]*$/.test(rec) ? rec : `'${rec}'`);
    const row = (rec, qid) => `${key(rec)}: '${qid}',`;
    const GP = 'test/batch035-gate-park.test.ts PARKS';
    for (const [rec, qid] of now) {
      if (!was.has(rec)) pins.push(`${PIN}${GP} — add this line (and raise the count in that test's title):      ${row(rec, qid)}`);
      else if (was.get(rec) !== qid) pins.push(`${PIN}${GP} — replace the line ${row(rec, was.get(rec))} with:      ${row(rec, qid)}`);
    }
    for (const [rec, qid] of was) {
      if (!now.has(rec)) pins.push(`${PIN}${GP} — remove the line ${row(rec, qid)} (lower the count in that test's title): a new entry now parks "${rec}" under its own id.`);
    }
    for (const e of added) {
      if (!e.id.includes('#')) continue;
      const base = e.id.split('#', 1)[0];
      const recs = [...now].filter(([, qid]) => qid === e.id).map(([rec]) => rec);
      if (recs.some((rec) => rec !== base)) refused.push(`${e.id}: "${base}" is not a record, so the gate parks "${recs.join('", "')}" instead. Check the record part of the id.`);
      else if (!recs.length) {
        const by = probe(afterFile, '--queued-for', base);
        if (!by) refused.push(`${e.id}: "${base}" is not a record in public/core.json, so the question would park nothing. Check the record part of the id.`);
        else notes.push(`${e.id}: "${base}" is already parked by desk id ${by}; no new PARKS line.`);
      }
    }
    return { pins, notes, refused };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The PIN lines out of this tool's output — for a caller that runs it as a child (scripts/wg-batch-run.mjs). */
export const testPinsFrom = (out) => String(out ?? '').split(/\r?\n/).filter((l) => l.startsWith(PIN)).map((l) => l.slice(PIN.length).trim());

/** A JSON file's new text in the line ending the file already has (CLAUDE.md: line endings are per file). */
export const jsonKeepingEol = (value, oldText) => {
  const eol = oldText.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(value, null, 1).replace(/\n/g, eol) + eol;
};

/**
 * Write several files so that a failure part-way leaves none of them changed where it can: every new
 * text goes to `<path>.tmp` first (a failure there removes the temps and changes nothing), and only
 * then is each renamed over its file. A desk number without its approvals line is the half-done state
 * this tool exists to prevent.
 */
export function writeAll(files) {
  const temps = [];
  try {
    for (const [path, text] of files) { writeFileSync(`${path}.tmp`, text); temps.push(path); }
  } catch (err) {
    for (const path of temps) rmSync(`${path}.tmp`, { force: true });
    throw err;
  }
  const done = [];
  for (const [path] of files) {
    try { renameSync(`${path}.tmp`, path); done.push(path); } catch (err) {
      /* A file held open elsewhere (an editor, a virus scan) can refuse the rename. Say exactly where
       * things stand, so the half-done state is repaired from the .tmp files rather than guessed at. */
      const left = files.map(([p]) => p).filter((p) => !done.includes(p));
      throw new Error(`rename failed (${err.code ?? err.message}). Written: ${done.join(', ') || 'none'}. NOT written — the new text is in <path>.tmp: ${left.join(', ')}`);
    }
  }
}

/* ================================================================================================= *
 *  CLI — runs only as the entry point.
 * ================================================================================================= */
function cli() {
  const WRITE = process.argv.includes('--write');
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const pathArg = (k, dflt) => { const v = arg(k); return v ? (isAbsolute(v) ? v : join(ROOT, v)) : join(ROOT, dflt); };
  const PATH = pathArg('--desk', 'work/owner-questions.json');
  const NUMBERS = pathArg('--numbers', 'work/rulings-numbering.json');
  const APPROVALS = pathArg('--approvals', 'scripts/data/trust-approvals.json');

  /* ---------- the entries to add ---------- */
  const from = arg('--from');
  const incoming = from
    ? JSON.parse(readFileSync(isAbsolute(from) ? from : join(ROOT, from), 'utf8'))
    : [{
        id: arg('--id'),
        batch: batchOf(arg('--batch')),
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
      if (v === null || v === undefined || v === '' || (k === 'batch' && Number.isNaN(batchOf(v))))
        refuse(e.id, `missing ${k}. Every field is required: a half-written question cannot be ruled on.`);
    }
  }

  /* ---------- guard 2: no id already on the desk, and no id twice in one run ---------- */
  const deskText = readFileSync(PATH, 'utf8');
  const doc = JSON.parse(deskText);
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
  const numText = readFileSync(NUMBERS, 'utf8');
  const num = JSON.parse(numText);
  const { added, refused } = appendQuestions(doc, incoming, num);

  /* ---------- the same numbers in trust-approvals.json, and what they park ---------- */
  /* Everything is computed before anything is written, so a refusal here leaves all three files as
   * they were: a desk number without its approvals line is exactly the half-done state this prevents. */
  if (!existsSync(APPROVALS)) refused.push(`${APPROVALS} does not exist — the new numbers need their \`unruled\` lines there.`);
  const approvalsText = existsSync(APPROVALS) ? readFileSync(APPROVALS, 'utf8') : '';
  const approvals = refused.length ? { text: approvalsText, refused: [] } : addUnruledLines(approvalsText, added);
  refused.push(...approvals.refused);
  const pins = refused.length ? { pins: [], notes: [], refused: [] } : testPins(JSON.parse(deskText), doc, added);
  refused.push(...pins.refused);
  if (refused.length) {
    console.error(`REFUSED — ${refused.length}; nothing written:`);
    for (const r of refused) console.error(`  ${r}`);
    process.exit(2);
  }
  for (const entry of added) console.log(`#${entry.n}  ${entry.id}  (batch ${entry.batch})`);
  console.log(`\n${doc.open.length} open question(s); ${added.length} added.`);
  if (added.length) console.log(`trust-approvals.json: ${added.length} \`unruled\` line(s) (#${added.map((e) => e.n).join(', #')}, status "open").`);
  for (const note of pins.notes) console.log(`  ${note}`);
  if (pins.pins.length) {
    console.log('\nTEST PINS — hand-made guards this tool never edits. Change them in the same commit, or the suite goes red:');
    for (const l of pins.pins) console.log(l);
  }
  /* The three paths, printed as resolved, in both modes: test/add-owner-question-bookkeeping.test.ts
   * reads them off the report-only run and refuses to pass --write unless they are its temp copies. */
  const targets = `${PATH} + ${NUMBERS} + ${APPROVALS}`;
  if (!WRITE) { console.log(`\nwould write: ${targets}\n(report only — pass --write)`); process.exit(0); }
  writeAll([[PATH, jsonKeepingEol(doc, deskText)], [NUMBERS, jsonKeepingEol(num, numText)], [APPROVALS, approvals.text]]);
  console.log(`\nwritten: ${targets}`);
}

if (IS_MAIN) cli();
