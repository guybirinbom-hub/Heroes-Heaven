import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * scripts/rule-owner-questions.mjs — the writer that moved the owner's 128 desk answers of 2026-09-10
 * from `open` into `ruled`.
 *
 * WHAT IS BEING PROTECTED. The desk number `n` is permanent: he answers by number ("104, keep ours"),
 * so a number that shifts is a ruling landing on the wrong record, and an entry that disappears is a
 * question he answered and nobody recorded. Those two, plus the three refusals, are all this file
 * asserts. Every case runs against a TEMP COPY of the desk file — never work/owner-questions.json,
 * which the parity gates read.
 *
 * The script is re-runnable by design (a second run reports "already applied" instead of refusing),
 * so these cases hold whether or not the real desk file has been written yet.
 */

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/rule-owner-questions.mjs');
const ARRAYS = ['open', 'deferred', 'ruled', 'authorisedExceptions'] as const;

type Entry = { n?: number; id?: string; ruling?: string; ruledOn?: string; rulingSource?: string; what?: string; records?: string[]; quote?: string };
type Unruled = { n: number; id: string | null; status: string };
type Desk = Record<string, Entry[]>;
type Answers = { answers: { ns: number[]; answer: string; note?: string }[] };

const DESK_SRC = JSON.parse(readFileSync(path.join(ROOT, 'work/owner-questions.json'), 'utf8')) as Desk;
const ANSWERS_SRC = JSON.parse(readFileSync(path.join(ROOT, 'work/desk-answers-2026-09-10.json'), 'utf8')) as Answers;
/**
 * The desk as it stood BEFORE the pass, so the cases read the same however often the script has run.
 *
 * EVERY desk pass is reverted, not just 2026-09-10's: the owner went down the desk again on
 * 2026-09-12 (#151/#152/#154/#155 and #158-#161), and a filter naming one pass would leave those eight
 * entries sitting in `ruled` while this file's fixture only feeds the script the 2026-09-10 answers —
 * so "what is still open afterwards" would be measured against a desk that had already moved. The
 * numbers ruled by passes that are NOT desk passes stay where they are, which is what the refusal case
 * below reads.
 */
const BEFORE: Desk = (() => {
  const d = JSON.parse(JSON.stringify(DESK_SRC)) as Desk;
  const back = (d.ruled ?? []).filter((e) => /^desk pass \d{4}-\d{2}-\d{2}/.test(e.rulingSource ?? ''));
  if (back.length) {
    d.ruled = (d.ruled ?? []).filter((e) => !back.includes(e));
    for (const e of back) { delete e.ruling; delete e.ruledOn; delete e.rulingSource; }
    d.open = [...back, ...(d.open ?? [])];
    d.authorisedExceptions = (d.authorisedExceptions ?? []).filter((e) => Number(e.n) < 156);
  }
  return d;
})();

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const flat = (d: Desk) => ARRAYS.flatMap((a) => (d[a] ?? []).map((e) => ({ ...e, arr: a })));
const ANSWERED = new Set(ANSWERS_SRC.answers.flatMap((a) => a.ns));
/** Two answered records and one DEFERRED one, so the parity fixture can prove the deferred is skipped. */
const ANSWERED_IDS = flat(BEFORE).filter((e) => e.arr === 'open' && ANSWERED.has(Number(e.n))).slice(0, 2).map((e) => e.id!);
const DEFERRED_ID = (BEFORE.deferred ?? [])[0].id!;

/** A throwaway work/ dir holding a copy of the desk + the answers, and optionally one parity file. */
function fixture(desk: Desk = BEFORE, answers: Answers = ANSWERS_SRC, withParity = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'desk-rule-'));
  roots.push(root);
  writeFileSync(path.join(root, 'desk.json'), `${JSON.stringify(desk, null, 1)}\n`);
  writeFileSync(path.join(root, 'answers.json'), `${JSON.stringify(answers, null, 1)}\n`);
  /* Authored, not copied from work/: the real parity files have already been re-verdicted, so a copy
   * would carry no OWNER-QUEUED row and the case would pass by being empty. */
  if (withParity) {
    writeFileSync(path.join(root, 'wg-batch-012-parity.json'), `${JSON.stringify({
      batch: 12,
      records: [
        ...ANSWERED_IDS.map((id) => ({ id, verdict: 'OWNER-QUEUED', evidence: 'awaiting his ruling' })),
        { id: DEFERRED_ID, verdict: 'OWNER-QUEUED', evidence: 'parked until after batching' },
        { id: 'a-record-that-matched', verdict: 'MATCHES', evidence: 'same shape both sides' },
      ],
    }, null, 1)}\n`);
  }
  return root;
}

function run(root: string, args: string[] = []) {
  return runRaw([SCRIPT, '--answers', path.join(root, 'answers.json'), '--desk', path.join(root, 'desk.json'), '--out', path.join(root, 'out.json'), ...args]);
}

/** The whole argv, for the case that supplies its own --answers (the flag parser takes the first). */
function runRaw(argv: string[]) {
  try {
    return { code: 0, out: execFileSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status: number; stdout?: string; stderr?: string };
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
const readDesk = (root: string) => JSON.parse(readFileSync(path.join(root, 'desk.json'), 'utf8')) as Desk;

describe('rule-owner-questions.mjs applies the desk pass', () => {
  it('moves every answered number to `ruled` and leaves the unanswered ones open', () => {
    const root = fixture();
    const r = run(root, ['--write']);
    expect(r.code).toBe(0);
    const after = readDesk(root);

    const stillOpen = (after.open ?? []).map((e) => Number(e.n)).sort((a, b) => a - b);
    expect(stillOpen).toEqual((BEFORE.open ?? []).map((e) => Number(e.n)).filter((n) => !ANSWERED.has(n)).sort((a, b) => a - b));
    /* The five batch-037 questions the owner has NOT seen stay on the desk, and so do the four the
     * 2026-09-12 newest-printing repoint filed after the desk pass closed (#158-#161). */
    expect(stillOpen).toEqual([151, 152, 153, 154, 155, 158, 159, 160, 161]);
    expect((after.ruled ?? []).length).toBe((BEFORE.ruled ?? []).length + ANSWERED.size);

    for (const n of ANSWERED) {
      const e = (after.ruled ?? []).find((x) => Number(x.n) === n)!;
      expect(e, `#${n} should now be ruled`).toBeTruthy();
      expect(e.ruling!.length).toBeGreaterThan(0);
      expect(['2026-09-10', '2026-09-11']).toContain(e.ruledOn);
      expect(e.rulingSource).toBe('desk pass 2026-09-10, work/desk-answers-2026-09-10.json');
    }
  });

  it('keeps every desk number exactly where it was — no renumbering, nothing lost', () => {
    const root = fixture();
    run(root, ['--write']);
    const before = flat(BEFORE);
    const after = flat(readDesk(root));

    /* Nothing lost: every id and every number that went in comes out.
     * Counted against the numbers that actually WENT IN rather than a `< 156` ceiling: that constant
     * meant "everything on the desk when this was written" and silently rotted the moment the desk
     * grew past it (the 2026-09-12 reprint lane filed #158-#161). The set cannot rot. */
    const wentIn = new Set(before.map((e) => e.n));
    expect(after.filter((e) => wentIn.has(e.n)).length).toBe(before.length);
    for (const e of before) {
      const now = after.find((x) => (e.id ? x.id === e.id : x.n === e.n));
      expect(now, `${e.id ?? `#${e.n}`} vanished from the desk`).toBeTruthy();
      expect(now!.n, `${e.id ?? `#${e.n}`} was renumbered`).toBe(e.n);
    }
    /* No number handed out twice, including the two new exceptions. */
    expect(new Set(after.map((e) => e.n)).size).toBe(after.length);
  });

  it('leaves `deferred` byte-for-byte untouched', () => {
    const root = fixture();
    run(root, ['--write']);
    expect(readDesk(root).deferred).toEqual(BEFORE.deferred);
  });

  it('adds the two authorised exceptions with fresh numbers above the old maximum', () => {
    const root = fixture();
    run(root, ['--write']);
    const ex = readDesk(root).authorisedExceptions ?? [];
    expect(ex.length).toBe((BEFORE.authorisedExceptions ?? []).length + 2);
    const added = ex.slice(-2);
    const maxBefore = Math.max(...flat(BEFORE).map((e) => Number(e.n)));
    expect(added.map((e) => Number(e.n))).toEqual([maxBefore + 1, maxBefore + 2]);
    for (const e of added) {
      expect(e.id, 'an authorised exception carries no id — only n, ruling, what, records?, quote').toBeUndefined();
      expect(typeof e.what).toBe('string');
      expect(typeof e.quote).toBe('string');
    }
    expect(added[0].records).toEqual([
      'unifying-emblem-lyrune-quah',
      'unifying-emblem-shadde-quah',
      'unifying-emblem-shriikirri-quah',
      'unifying-emblem-shundar-quah',
      'unifying-emblem-sklar-quah',
      'unifying-emblem-skoan-quah',
      'unifying-emblem-tamiir-quah',
    ]);
    expect(added[1].ruling).toBe('2026-09-11');
  });

  /*
   * The `quote` on an authorised exception is the one field this script re-writes on an entry it
   * already created, because this script AUTHORED the entry and EXCEPTIONS is where its wording lives.
   * #157 shipped with a placeholder ("his verbatim words are not on file"); they went on file the next
   * day, and the alternative to re-syncing is a hand edit of work/owner-questions.json — the exact
   * thing this script exists to prevent. The number, the `what` and the records must not move with it.
   */
  it('re-syncs an exception\'s quote from the script, without renumbering or reshaping it', () => {
    const root = fixture();
    run(root, ['--write']);
    const before = readDesk(root).authorisedExceptions!.slice(-1)[0];
    const realQuote = before.quote!;
    expect(realQuote, 'the 2026-09-11 exception must carry his verbatim words').toContain(
      'I add the core class features and the item-held spells to the approvals list',
    );

    /* A desk file carrying the OLD placeholder — the state batch 037's closer left behind. */
    const stale = readDesk(root);
    stale.authorisedExceptions!.slice(-1)[0].quote = '(his verbatim words are not on file)';
    writeFileSync(path.join(root, 'desk.json'), `${JSON.stringify(stale, null, 1)}\n`);

    const r = run(root, ['--write']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`re-quoted: #${before.n}`);
    const after = readDesk(root).authorisedExceptions!.slice(-1)[0];
    expect(after.quote).toBe(realQuote);
    expect(after.n).toBe(before.n);
    expect(after.what).toBe(before.what);
  });

  /*
   * desk 158/160/161/152: a SECOND desk pass, under its own label.
   *
   * `rulingSource` is what the script's "already applied" check compares against, so running the
   * 2026-09-12 answers under the 2026-09-10 label would read as a re-run of the first pass and move
   * nothing. `--source` is the label; the ruling DATE comes from the answers file's own name, because
   * it used to be the hard-coded string '2026-09-10' and would have back-dated every ruling by two
   * days. `--approvals` moves the same numbers in scripts/data/trust-approvals.json, whose `unruled`
   * entries repeat the desk array each number sits in — one writer for both files, or
   * test/trust-approvals.test.ts goes red and the repair is the hand edit this script prevents.
   */
  it('--source labels a later pass, dates it from the answers file, and moves the approvals roster with it', () => {
    const root = fixture();
    const later = { answers: [{ ns: [153], answer: 'yes', note: 'ruled on the second pass' }] };
    writeFileSync(path.join(root, 'answers-2026-09-12.json'), `${JSON.stringify(later, null, 1)}\n`);
    writeFileSync(
      path.join(root, 'approvals.json'),
      `${JSON.stringify({ unruled: [{ n: 153, id: 'timewracked-dedication-speed-clause', status: 'open' }, { n: 1, id: 'x', status: 'ruled' }] }, null, 1)}\n`,
    );
    const r = runRaw([
      SCRIPT,
      '--answers', path.join(root, 'answers-2026-09-12.json'),
      '--desk', path.join(root, 'desk.json'),
      '--out', path.join(root, 'out.json'),
      '--source', 'desk pass 2026-09-12, work/desk-answers-2026-09-12.json',
      '--approvals', path.join(root, 'approvals.json'),
      '--write',
    ]);
    expect(r.code).toBe(0);
    const e = (readDesk(root).ruled ?? []).find((x) => Number(x.n) === 153)!;
    expect(e, '#153 moved to ruled').toBeTruthy();
    expect(e.rulingSource).toBe('desk pass 2026-09-12, work/desk-answers-2026-09-12.json');
    expect(e.ruledOn, 'dated from the answers file, not from the 2026-09-10 default').toBe('2026-09-12');

    const approvals = JSON.parse(readFileSync(path.join(root, 'approvals.json'), 'utf8')) as { unruled: Unruled[] };
    expect(approvals.unruled.find((u) => u.n === 153)!.status).toBe('ruled');
    /* MEMBERSHIP is untouched — `unruled` means "the answers file does not speak for this number",
     * which a later pass does not change — and a number this pass did not name keeps its disposition. */
    expect(approvals.unruled.map((u) => u.n)).toEqual([153, 1]);
    expect(approvals.unruled.find((u) => u.n === 1)!.status).toBe('ruled');
  });

  it('is safe to run twice: the second run moves nothing and adds no second copy', () => {
    const root = fixture();
    run(root, ['--write']);
    const once = readFileSync(path.join(root, 'desk.json'), 'utf8');
    const r = run(root, ['--write']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('already applied');
    expect(readFileSync(path.join(root, 'desk.json'), 'utf8')).toBe(once);
  });

  it('--reverdict writes OWNER-RULED rows in the shape record-parity-verdict.mjs --bulk reads', () => {
    const root = fixture(BEFORE, ANSWERS_SRC, true);
    run(root, ['--reverdict', '--write']);
    const rows = JSON.parse(readFileSync(path.join(root, 'out.json'), 'utf8')) as { batch: number; id: string; evidence: string; verdict: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual([...ANSWERED_IDS].sort());
    /* A record he has NOT ruled on keeps its OWNER-QUEUED verdict: `deferred` is honored by the gates
     * exactly like `open`, so re-verdicting one would be a false claim that he decided it. */
    expect(rows.some((r) => r.id === DEFERRED_ID)).toBe(false);
    for (const row of rows) {
      expect(row.verdict).toBe('OWNER-RULED');
      expect(row.batch).toBe(12);
      expect(row.evidence).toMatch(/^owner ruled 2026-09-1[01] \(#\d+\):/);
      /* Only records whose question he actually answered may be re-verdicted. */
      const n = flat(BEFORE).find((e) => e.id === row.id)!.n!;
      expect(ANSWERED.has(n)).toBe(true);
    }
  });
});

describe('rule-owner-questions.mjs refuses rather than guesses', () => {
  const withAnswers = (ns: number[]) => ({ answers: [{ ns, answer: 'yes', note: 'a note' }] });

  it('refuses a desk number that is on no array', () => {
    const r = run(fixture(BEFORE, withAnswers([99999])));
    expect(r.code).toBe(2);
    expect(r.out).toContain('#99999: no entry with that desk number');
  });

  it('refuses a number the answers file names twice', () => {
    const twice = { answers: [{ ns: [3], answer: 'yes', note: 'one' }, { ns: [3], answer: 'no', note: 'two' }] };
    const r = run(fixture(BEFORE, twice));
    expect(r.code).toBe(2);
    expect(r.out).toContain('#3: named twice');
  });

  it('refuses a number that is deferred rather than open', () => {
    const deferredN = Number(BEFORE.deferred![0].n);
    const r = run(fixture(BEFORE, withAnswers([deferredN])));
    expect(r.code).toBe(2);
    expect(r.out).toContain(`#${deferredN}: sits in \`deferred\``);
  });

  it('refuses a number another pass already ruled, rather than overwriting his earlier word', () => {
    const ruledN = Number(BEFORE.ruled![0].n);
    const r = run(fixture(BEFORE, withAnswers([ruledN])));
    expect(r.code).toBe(2);
    expect(r.out).toContain(`#${ruledN}: already in \`ruled\` from another pass`);
  });

  it('writes nothing when it refuses', () => {
    const root = fixture(BEFORE, withAnswers([99999]));
    const before = readFileSync(path.join(root, 'desk.json'), 'utf8');
    run(root, ['--write']);
    expect(readFileSync(path.join(root, 'desk.json'), 'utf8')).toBe(before);
  });
});
