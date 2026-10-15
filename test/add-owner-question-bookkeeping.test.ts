import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHILD_TIMEOUT } from './_timeouts';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { addUnruledLines, testPinsFrom } from '../scripts/add-owner-question.mjs';

/* Every CLI case shells out to the tool, which runs wg-show.mjs over the WG dump and asks the gate. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

/**
 * ONE OWNER QUESTION, THREE FILES — AND THE TOOL WRITES ALL THREE.
 *
 * A new desk number needs an entry in work/owner-questions.json, its id in work/rulings-numbering.json,
 * and an `unruled` line in scripts/data/trust-approvals.json (test/trust-approvals.test.ts: every desk
 * number has exactly one disposition). scripts/add-owner-question.mjs wrote the first two only, so
 * #171 expanded-necromancy#archetype-ninth-rank (2026-10-15) left the suite red until the third was
 * added by hand. This file runs the tool on TEMP COPIES of all three (its --desk / --numbers /
 * --approvals flags) and checks the approvals copy gains the right line.
 *
 * ⚠ GUY'S REAL FILES ARE NEVER WRITTEN. --write is passed only after a report-only run has printed
 * `would write:` naming exactly the temp copies; a tool that ignores the flags fails there, before it
 * could write anything. The real files are hashed before and after as a second check.
 *
 * HH_OWNER_QUESTION_TOOL points the CLI cases at another copy of the tool. It exists for the one-time
 * proof: aimed at the 2026-10-15 tool (HEAD fa9287e) in a scratch folder, this file goes red.
 */
const ROOT = join(__dirname, '..');
const TOOL = process.env.HH_OWNER_QUESTION_TOOL ?? join(ROOT, 'scripts/add-owner-question.mjs');
const REAL = ['work/owner-questions.json', 'work/rulings-numbering.json', 'scripts/data/trust-approvals.json'].map((p) => join(ROOT, p));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const run = (args: string[]) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/* Basic Kata: a record their dump really carries (a conditional adjValue on MAX_HEALTH_BONUS) and a
 * document the AoN mirror really holds, so the tool's own guards pass and only the bookkeeping is tested. */
const question = (id: string) => [
  '--id', id, '--name', 'basic-kata', '--batch', '30',
  '--printed', 'Printed (feat-1): "You gain a monk feat."',
  '--theirs', 'A select of ABILITY_BLOCK plus a conditional adjValue on MAX_HEALTH_BONUS.',
  '--ours', 'A picker with no hit point bonus.',
  '--question', 'Do we mirror the +3 hit points?',
];

/** Temp copies of the three files, and the flags that point the tool at them. */
const sandbox = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hh-owner-question-test-'));
  const [desk, numbers, approvals] = ['owner-questions.json', 'rulings-numbering.json', 'trust-approvals.json'].map((f) => join(dir, f));
  REAL.forEach((src, i) => copyFileSync(src, [desk, numbers, approvals][i]));
  return { dir, desk, numbers, approvals, flags: ['--desk', desk, '--numbers', numbers, '--approvals', approvals] };
};
const eolOf = (t: string) => (t.includes('\r\n') ? '\r\n' : '\n');

describe('add-owner-question.mjs keeps its own bookkeeping', () => {
  it('a new question lands in the temp desk, numbering AND approvals copies — the approvals copy gains one `unruled` line', () => {
    const realBefore = REAL.map(sha);
    const s = sandbox();
    try {
      const dry = run([...question('basic-kata#hp-bonus'), ...s.flags]);
      expect(dry.code, dry.out).toBe(0);
      expect(dry.out, 'the tool must say it writes ONLY the temp copies it was given — --write is not passed otherwise')
        .toContain(`would write: ${s.desk} + ${s.numbers} + ${s.approvals}`);

      const desk0 = JSON.parse(readFileSync(s.desk, 'utf8'));
      const num0 = JSON.parse(readFileSync(s.numbers, 'utf8'));
      const n = 1 + Math.max(
        ...['open', 'deferred', 'ruled', 'authorisedExceptions'].flatMap((a) => (desk0[a] ?? []).map((e: { n: number }) => e.n)),
        ...Object.values(num0.numbers as Record<string, number>),
      );
      const text0 = readFileSync(s.approvals, 'utf8');

      const wet = run([...question('basic-kata#hp-bonus'), ...s.flags, '--write']);
      expect(wet.code, wet.out).toBe(0);

      /* The approvals copy: exactly one new line, as text, in the file's own line ending. */
      const text1 = readFileSync(s.approvals, 'utf8');
      const eol = eolOf(text0);
      const line = `{ "n": ${n}, "id": "basic-kata#hp-bonus", "status": "open" }`;
      expect(text1, 'the approvals copy gains the `unruled` line for the new number').toContain(line);
      expect(text1.split(eol).length, 'one line added, none rewritten into many').toBe(text0.split(eol).length + 1);
      if (eol === '\r\n') expect(text1.split('\r\n').join('').includes('\n'), 'CRLF kept on every line').toBe(false);
      const before = JSON.parse(text0);
      const after = JSON.parse(text1);
      expect(after.unruled.filter((e: { n: number }) => e.n !== n)).toEqual(before.unruled);
      for (const k of ['approvals', 'noMechanic', 'engine']) expect(after[k]).toEqual(before[k]);

      /* …and the other two copies, as before. */
      const desk1 = JSON.parse(readFileSync(s.desk, 'utf8'));
      expect(desk1.open.find((e: { id: string }) => e.id === 'basic-kata#hp-bonus')?.n).toBe(n);
      expect(JSON.parse(readFileSync(s.numbers, 'utf8')).numbers['basic-kata#hp-bonus']).toBe(n);

      /* The roster count and the PARKS table are hand-made pins, so the tool prints each change as a
       * PIN line and edits no test. testPinsFrom is what the batch driver uses to carry them into its digest. */
      const deskCount = ['open', 'deferred', 'ruled', 'authorisedExceptions'].reduce((s, a) => s + (desk0[a]?.length ?? 0), 0);
      const pins = testPinsFrom(wet.out);
      expect(pins).toHaveLength(2);
      expect(pins[0]).toContain(`test/trust-approvals.test.ts: the desk roster grows from ${deskCount} to ${deskCount + 1}`);
      expect(pins[1]).toContain('test/batch035-gate-park.test.ts PARKS — add this line');
      expect(pins[1].endsWith(`'basic-kata': 'basic-kata#hp-bonus',`)).toBe(true);
    } finally {
      rmSync(s.dir, { recursive: true, force: true });
    }
    expect(REAL.map(sha), 'the real desk, numbering and approvals files are untouched').toEqual(realBefore);
  });

  it('refuses a record#aspect id whose record part is no record, and writes none of the three copies', () => {
    const realBefore = REAL.map(sha);
    const s = sandbox();
    try {
      const copies = [s.desk, s.numbers, s.approvals];
      const copiesBefore = copies.map(sha);
      /* Report-only first: only a tool that already refuses here is trusted with --write below. */
      const dry = run([...question('zzqxnorecord#aspect'), ...s.flags]);
      expect(dry.code, dry.out).toBe(2);
      expect(dry.out).toContain('"zzqxnorecord" is not a record in public/core.json');
      /* The quieter typo: no such record, but the gate's hyphen walk finds a SHORTER one (`no` is a
       * record) and would park that instead. */
      const shorter = run([...question('no-such-record-zz#aspect'), ...s.flags]);
      expect(shorter.code, shorter.out).toBe(2);
      expect(shorter.out).toContain('"no-such-record-zz" is not a record, so the gate parks "no" instead');
      const wet = run([...question('zzqxnorecord#aspect'), ...s.flags, '--write']);
      expect(wet.code, wet.out).toBe(2);
      expect(wet.out).toContain('nothing written');
      expect(copies.map(sha)).toEqual(copiesBefore);
    } finally {
      rmSync(s.dir, { recursive: true, force: true });
    }
    expect(REAL.map(sha)).toEqual(realBefore);
  });

  it('names a PARKS line a new entry REPLACES (open beats deferred) or REMOVES (an exact record id beats record#aspect)', () => {
    /* Report-only runs on a temp desk with one planted entry each, so the case does not depend on which
     * real questions happen to be open: the gate's parkMapOf lets `open` win over `deferred` and an
     * exact record id win over everything, and a new entry can therefore move a park it does not add. */
    const s = sandbox();
    try {
      const plant = (arr: 'open' | 'deferred', id: string) => {
        const desk = JSON.parse(readFileSync(s.desk, 'utf8'));
        desk[arr].push({ n: 9001, id, batch: 30, printed: 'p', theirs: 't', ours: 'o', question: 'q' });
        writeFileSync(s.desk, JSON.stringify(desk));
      };
      plant('deferred', 'basic-kata#parked-before');
      const replaced = run([...question('basic-kata#parked-now'), ...s.flags]);
      expect(replaced.code, replaced.out).toBe(0);
      expect(testPinsFrom(replaced.out)).toContain(
        "test/batch035-gate-park.test.ts PARKS — replace the line 'basic-kata': 'basic-kata#parked-before', with:      'basic-kata': 'basic-kata#parked-now',",
      );

      copyFileSync(REAL[0], s.desk);
      plant('open', 'basic-kata#parked-before');
      const removed = run([...question('basic-kata'), ...s.flags]);
      expect(removed.code, removed.out).toBe(0);
      expect(testPinsFrom(removed.out).some((p) => p.includes("PARKS — remove the line 'basic-kata': 'basic-kata#parked-before',"))).toBe(true);
    } finally {
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe('addUnruledLines — the text edit itself', () => {
  const CRLF = ['{', ' "approvals": [],', ' "unruled": [', '  { "n": 1, "id": "a", "status": "ruled" },', '  { "n": 3, "id": "c", "status": "open" }', ' ]', '}', ''].join('\r\n');

  it('puts a line in n order, keeps CRLF, and changes no other line', () => {
    const { text, refused } = addUnruledLines(CRLF, [{ n: 2, id: 'b' }]);
    expect(refused).toEqual([]);
    expect(text).toBe(CRLF.replace('  { "n": 3', '  { "n": 2, "id": "b", "status": "open" },\r\n  { "n": 3'));
  });

  it('appends after the last entry, which gains its comma', () => {
    const { text, refused } = addUnruledLines(CRLF, [{ n: 4, id: 'd#x' }]);
    expect(refused).toEqual([]);
    expect(text).toBe(CRLF.replace('"status": "open" }\r\n ]', '"status": "open" },\r\n  { "n": 4, "id": "d#x", "status": "open" }\r\n ]'));
  });

  it('refuses a number that already has a disposition, and returns the text unchanged', () => {
    const { text, refused } = addUnruledLines(CRLF, [{ n: 3, id: 'other' }]);
    expect(refused.join(' ')).toContain('already files #3 in `unruled`');
    expect(text).toBe(CRLF);
  });

  it('refuses a file whose `unruled` array is not one entry per line, rather than re-serialising it', () => {
    const oneLine = '{ "approvals": [], "unruled": [ { "n": 1, "id": "a", "status": "ruled" } ] }\n';
    const { text, refused } = addUnruledLines(oneLine, [{ n: 2, id: 'b' }]);
    expect(refused.join(' ')).toContain('not one entry per line');
    expect(text).toBe(oneLine);
  });
});
