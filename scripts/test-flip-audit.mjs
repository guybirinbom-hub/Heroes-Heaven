#!/usr/bin/env node
/*
 * WHY THIS EXISTS — docs/wg-batch-pipeline.md, section B ("Guards that make agent judgement
 * checkable"):
 *
 *   "scripts/test-flip-audit.mjs --batch NNN — diffs test/, the ratchet constants, the three settle
 *    registries (VERIFIED_EQUIVALENT / SETTLED_VALUES / NOT_A_SCALAR / SETTLED_IDENTITIES) and
 *    experience-instrument-limits.json against the .bNNN-testbase/ snapshot. Every changed or
 *    removed it( / expect( / registry entry / baseline constant must sit under
 *    `// batch NNN: <finding id>` (a CONFIRMED finding in .bNNN-read.json whose record id appears in
 *    the enclosing describe/it text) or `// batch NNN premise: <AoN doc id> \"<clause>\"`. Fails on any
 *    new .skip / .only / .todo, a deleted test file or describe block, or a changed numeric literal
 *    inside an otherwise unchanged it(. A settle or comparer teach added without a mutation-proof
 *    test (the batch-29 stunted-table pattern) fails the audit."
 *
 * The failure mode it guards: an agent that cannot make the batch green quietly loosens the
 * instrument instead of fixing the data — lowers an expectation, adds a settle key, raises a ratchet,
 * parks a record in the experience limits. Every one of those is legitimate ONCE, with a citation.
 * Without the citation it is a silently widened gate, and the whole parity programme rests on those
 * gates staying honest.
 *
 * Usage:  node scripts/test-flip-audit.mjs --batch NNN [--root DIR] [--json]
 * Exit 1 on any violation (each one names the file, the line, what changed and what was expected).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AON_ROOT_DEFAULT = 'C:/wonderers guide/aon-2e-archive/data/by-category';

/*
 * RULING (2026-09-06): a batch token is ALPHANUMERIC — `029` (the WG lane) and `P01` (the print-read
 * lane) are both batches, and both name a work/.b<token>-read.json. The token is therefore matched as
 * `[0-9A-Za-z]+` and compared as a NORMALISED STRING, never through Number(): `Number('P01')` is NaN,
 * NaN !== NaN, so every citation in a print-lane batch read as "names batch NaN" and the whole lane
 * refused. Normalising = zero-pad a numeric token to three digits (29 → 029), upper-case an
 * alphanumeric one (p01 → P01), on BOTH sides of the comparison.
 */
export const normBatch = (t) => (/^\d+$/.test(String(t ?? '')) ? String(t).padStart(3, '0') : String(t ?? '').toUpperCase());

/* `// batch 030 premise: item-1234 "the clause"` — checked BEFORE the plain form, whose colon must
 * follow the token directly. */
const PREMISE_RE = /\/\/\s*batch\s+([0-9A-Za-z]+)\s+premise\s*:\s*([a-z0-9]+(?:-[a-z0-9]+)*-\d+)\s+"([^"]*)"/i;
/* The id stops at whitespace or a quote so the JSON form (`"_cite": "// batch 030: a#b"`) parses. */
const CITE_RE = /\/\/\s*batch\s+([0-9A-Za-z]+)\s*:\s*([^\s"'`,;]+)/i;

/*
 * A test-block OPENER is the first token of a statement — never text inside a quote.
 *
 * The old shape was `/(^|[^\w.])(it|test)\s*[(.]/`, which matched anywhere on the line, including
 * inside a string literal: `const out = 'work/.wg-diff-b027-test.json';` contains "-test." and so
 * read as an it() header. Two failures came out of that, in both directions. enclosingTitles()
 * returned that literal as the enclosing it( title, so the record-id-in-title half of the citation
 * rule became UNSATISFIABLE for any flip sitting under such a line (batch 031's closer had to fall
 * back to the premise form); and, worse, a nearer fake "title" that happens to contain a record id
 * SATISFIES the check for a flip whose real it( never names the record — a hole in the gate.
 *
 * So: blank the line's string and comment bodies first, then require the opener at the start of the
 * statement, with any chain in between (`it.skip(`, `describe.each(`, `it.each\``).
 */
const OPENER = String.raw`^\s*(?:%s)(?:\.[A-Za-z_$][\w$]*)*\s*[(\`]`;
const BLOCK_RE = new RegExp(OPENER.replace('%s', 'it|test|describe'));
const IT_RE = new RegExp(OPENER.replace('%s', 'it|test'));
const DESCRIBE_RE = new RegExp(OPENER.replace('%s', 'describe'));
const EXPECT_RE = /\bexpect\s*\(/;

/**
 * One line with the BODY of every string literal and comment blanked to spaces, same length.
 *
 * Deliberately single-line, with ONE residual hole, measured rather than assumed. An unterminated
 * `'`/`"` blanks the rest of the line — safe, it can only hide an opener. A MULTI-LINE template
 * literal is not safe in that direction: this function starts each of its inner lines outside any
 * quote, so a line of literal data reading `it('<record id>…` at column 0 is still taken for an
 * opener, and can still be handed to enclosingTitles as the nearest title. Proven by fixture: real
 * it( "opens the gate", a template literal below it carrying `it('ring-of-wizardry-type-i fake'…`,
 * a cited flip under both — reported as a violation when the fake is a single-line string, NOT
 * reported when it spans lines.
 *
 * Left open because the incidence is zero and closing it costs more than it buys: carrying quote
 * state across lines needs block-comment handling too (`/* … `it(` … *\/` spans lines and this
 * function only blanks a comment to end-of-line), and an odd backtick in one of those prose comments
 * would then blank the rest of the FILE — a failure mode with real incidence, traded for one with
 * none. Scan of test/ at the time of writing: 0 non-self-test files contain a multi-line template
 * literal whose inner line starts with it( / test( / describe(. Re-measure before relying on that.
 */
export function codeOnly(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; ) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { const n = Math.min(2, line.length - i); out += ' '.repeat(n); i += n; continue; }
      if (ch === quote) { quote = null; out += ch; i++; continue; }
      out += ' '; i++; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i++; continue; }
    if (ch === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) { out += ' '.repeat(line.length - i); break; }
    out += ch; i++;
  }
  return out;
}

const isIt = (t) => IT_RE.test(codeOnly(t ?? ''));
const isDescribe = (t) => DESCRIBE_RE.test(codeOnly(t ?? ''));
const isBlock = (t) => BLOCK_RE.test(codeOnly(t ?? ''));
const DISABLED_RE = /\b(?:it|test|describe)\s*\.\s*(skip|only|todo|fails|concurrent\.skip)\b|\b(?:it|test|describe)\.(skip|only|todo)\b/;

/*
 * The audit's own test file is exempt from the test/ scan: its fixtures are STRINGS holding
 * `it.skip(`, removed describes and flipped numbers — the very shapes the audit hunts — so scanning
 * it reports its own fixtures forever. It is not unguarded: it is the file that proves this script,
 * and it must stay green (node scripts/vt.mjs test/test-flip-audit.test.ts).
 */
const SELF_TEST = 'test/test-flip-audit.test.ts';

const REGISTRIES = {
  'scripts/wg-diff.mjs': ['VERIFIED_EQUIVALENT'],
  'scripts/wg-values.mjs': ['SETTLED_VALUES', 'NOT_A_SCALAR'],
  'scripts/wg-identity.mjs': ['SETTLED_IDENTITIES'],
};

// ---------------------------------------------------------------------------- small helpers

const lines = (s) => s.split(/\r?\n/);
const stripNums = (s) => s.replace(/\d+(?:\.\d+)?/g, '#');

function git(root, args, allowFail = false) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // a tolerated failure (a path absent from startSha) must not spray `fatal:` over the report
      stdio: allowFail ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFail && err.stdout != null) return err.stdout;
    if (allowFail) return '';
    throw err;
  }
}

function readIf(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/**
 * Top-level keys of `const <name> = { … }` in a comparer, with the line each key sits on.
 * A real parse (strings, both comment forms, nesting) — the registries are 500-line objects full of
 * prose comments and apostrophes, and a regex over them lies.
 */
export function registryKeys(text, name) {
  const start = new RegExp(`(?:^|\\n)\\s*(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(text);
  if (!start) return null;
  let i = start.index + start[0].length;
  let line = lines(text.slice(0, i)).length;
  let depth = 1;
  let expectKey = true;
  const keys = [];
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i);
      const seg = text.slice(i, e < 0 ? text.length : e + 2);
      line += (seg.match(/\n/g) || []).length;
      i = e < 0 ? text.length : e + 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (depth === 1 && expectKey && c !== '}') {
      const km = /^(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:/.exec(text.slice(i));
      if (km) { keys.push({ key: km[1] ?? km[2] ?? km[3], line }); expectKey = false; i += km[0].length; continue; }
    }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; if (depth === 1) expectKey = false; continue; }
    if (c === ',') { if (depth === 1) expectKey = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '\n') line++;
        if (text[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return keys;
}

/** `const HOLE_BASELINE = 162;` anywhere in the file (three of the four sit at top level, FOOT_BASELINE does not). */
function ratchetValue(text, name) {
  const ls = lines(text);
  for (let n = 0; n < ls.length; n++) {
    const m = new RegExp(`(?:^|\\s)(?:const|let|var)\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`).exec(ls[n]);
    if (m) return { value: Number(m[1]), line: n + 1 };
  }
  return null;
}

/**
 * Added / removed lines between two blobs, numbered against the NEW file (a removal is reported at
 * the point it was removed from). Common prefix/suffix are trimmed and the middle diffed by LCS —
 * in-process, because the audit diffs a handful of files and a git spawn per file cost more than the
 * whole rest of the run.
 */
export function diffLines(oldText, newText) {
  const a = lines(oldText ?? '');
  const b = lines(newText ?? '');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const am = a.slice(s, ea);
  const bm = b.slice(s, eb);

  const ops = [];
  const n = am.length;
  const m = bm.length;
  if (n * m > 4_000_000) {                                          // pathological rewrite: one block
    for (const t of am) ops.push(['-', t]);
    for (const t of bm) ops.push(['+', t]);
  } else {
    const dp = new Int32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = am[i] === bm[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { ops.push(['=', am[i]]); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { ops.push(['-', am[i]]); i++; }
      else { ops.push(['+', bm[j]]); j++; }
    }
    while (i < n) ops.push(['-', am[i++]]);
    while (j < m) ops.push(['+', bm[j++]]);
  }

  const hunks = [];
  let cur = null;
  let newLine = s + 1;
  for (const [op, text] of ops) {
    if (op === '=') { cur = null; newLine++; continue; }
    if (!cur) { cur = { added: [], removed: [] }; hunks.push(cur); }
    if (op === '+') cur.added.push({ line: newLine++, text });
    else cur.removed.push({ line: newLine, text });
  }
  return hunks;
}

// ---------------------------------------------------------------------------- citation checking

/** The nearest enclosing it()/test() and describe() titles above `line` (1-indexed). */
function enclosingTitles(ls, line) {
  const titles = [];
  let sawIt = false;
  let sawDescribe = false;
  for (let n = Math.min(line, ls.length) - 1; n >= 0; n--) {
    const t = ls[n];
    if (!sawIt && isIt(t)) { sawIt = true; titles.push(t); }
    if (!sawDescribe && isDescribe(t)) { sawDescribe = true; titles.push(t); }
    if (sawIt && sawDescribe) break;
  }
  return titles.join(' \u2014 ');
}

/**
 * Is the change at `line` cited? Looks at the 6 lines above it, per the spec ("must sit within 6
 * lines below a comment"). `titleText` is '' for non-test files, where the record-id-in-title rule
 * does not apply.
 */
function citationFor(ls, line, ctx, titleText) {
  for (let n = line - 2; n >= Math.max(0, line - 7); n--) {
    const raw = ls[n];
    if (raw == null) continue;
    const p = PREMISE_RE.exec(raw);
    if (p) return checkPremise(p, ctx);
    const c = CITE_RE.exec(raw);
    if (c) return checkFinding(c, ctx, titleText);
  }
  return { ok: false, why: `no citation in the 6 lines above` };
}

function checkPremise(m, ctx) {
  const [, batch, docId] = m;
  if (normBatch(batch) !== ctx.batch) return { ok: false, why: `premise cites batch ${normBatch(batch)}, this is batch ${ctx.batch}` };
  const dm = /^(.*)-(\d+)$/.exec(docId);
  const category = dm ? dm[1] : null;
  const file = category ? path.join(ctx.aonRoot, category, `${docId}.json`) : null;
  if (!file || !existsSync(file)) return { ok: false, why: `premise doc ${docId} has no mirror file (${file ?? 'unparseable id'})` };
  return { ok: true };
}

function checkFinding(m, ctx, titleText) {
  const [, batch, findingId] = m;
  if (normBatch(batch) !== ctx.batch) return { ok: false, why: `citation names batch ${normBatch(batch)}, this is batch ${ctx.batch}` };
  if (!ctx.confirmed.has(findingId)) {
    const why = ctx.known.has(findingId)
      ? `finding ${findingId} is in .b${ctx.batch}-read.json but is not CONFIRMED`
      : `finding ${findingId} is not a CONFIRMED finding in work/.b${ctx.batch}-read.json`;
    return { ok: false, why };
  }
  if (titleText === null) return { ok: true };                     // not a test file
  const record = findingId.split('#')[0].toLowerCase();
  const hay = titleText.toLowerCase();
  if (!hay.includes(record) && !hay.includes(record.replace(/-/g, ' '))) {
    return { ok: false, why: `record id "${record}" appears in no enclosing describe/it title` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------- the audit

export function auditBatch({ root = REPO_ROOT, batch, aonRoot = AON_ROOT_DEFAULT } = {}) {
  const b = normBatch(batch);                                        // '29' -> '029', 'p01' -> 'P01'
  const V = [];
  const add = (file, line, change, expected) => V.push({ file, line, change, expected });

  const basePath = path.join(root, 'work', `.b${b}-testbase.json`);
  const baseRaw = readIf(basePath);
  if (!baseRaw) {
    add(`work/.b${b}-testbase.json`, 0, 'missing', 'the driver writes the testbase at the baseline stage; the audit cannot run without it');
    return { batch: b, violations: V, counts: { violations: V.length } };
  }
  const base = JSON.parse(baseRaw);

  const readRaw = readIf(path.join(root, 'work', `.b${b}-read.json`));
  const read = readRaw ? JSON.parse(readRaw) : { confirmed: [], refuted: [], askOwner: [] };
  const confirmed = new Set(
    (read.confirmed ?? []).filter((f) => (f.verdict ?? 'CONFIRMED') === 'CONFIRMED').map((f) => f.id),
  );
  const known = new Set([...(read.confirmed ?? []), ...(read.refuted ?? []), ...(read.askOwner ?? [])].map((f) => f.id));
  const ctx = { batch: b, confirmed, known, aonRoot };

  const snapDir = path.join(root, 'work', `.b${b}-testbase`);
  const testFiles = auditTests({ root, b, base, ctx, snapDir, add });
  auditRatchets({ root, base, ctx, add });
  const addedKeys = auditRegistries({ root, base, ctx, add });
  auditLimits({ root, base, ctx, add });
  auditMutationProofs({ root, addedKeys, testFiles, add, b });

  return { batch: b, violations: V, counts: { violations: V.length, testFiles: testFiles.length, addedRegistryKeys: addedKeys.length } };
}

/** test/ vs startSha (tracked and clean at the start) and vs the baseline snapshot (untracked OR dirty). */
function auditTests({ root, b, base, ctx, snapDir, add }) {
  const startSha = base.startSha;
  const untracked = new Set((base.untrackedTests ?? []).map((p) => p.replace(/\\/g, '/')));
  /* ORCHESTRATOR RULING (2026-09-08): a batch is judged only against what changed since ITS start. A test
   * file another effort had already modified has a blob at startSha, but that blob is not what this batch
   * inherited — diffing against it reports that effort's edits as this batch's uncited flips (this is what
   * stalled every batch over test/umbrella-items.test.ts). The driver's baseline stage byte-copies these
   * into .bNNN-testbase/ and lists them here, so they diff against the copy, exactly like an untracked one. */
  const dirty = new Set((base.dirtyTests ?? []).map((p) => p.replace(/\\/g, '/')));
  const touched = [];

  const status = startSha ? git(root, ['diff', '--name-status', startSha, '--', 'test/'], true) : '';
  const tracked = new Map();                                        // path -> status letter
  for (const l of lines(status)) {
    const m = /^([A-Z])\d*\t(.+?)(?:\t(.+))?$/.exec(l.trim());
    if (m) tracked.set((m[3] ?? m[2]).replace(/\\/g, '/'), m[1]);
  }

  const currentUntracked = new Set(
    lines(git(root, ['ls-files', '--others', '--exclude-standard', '--', 'test/'], true))
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean),
  );

  for (const [rel, st] of tracked) {
    if (rel === SELF_TEST) continue;
    if (st === 'D') {
      add(rel, 0, 'test file deleted', 'a batch never deletes a test file — restore it, or the removal needs an owner ruling');
      continue;
    }
    /* A file the batch ADDED is a wholly new test file — the same exemption the untracked branch below
     * gives, and the same file, only already committed. Without this, `git show startSha:<rel>` fails,
     * the whole file reads as added lines, and every assertion in it demands a citation (batch 29
     * replayed after its commit: 108 phantom violations in test/batch29-data.test.ts alone, burying
     * the three real ones in test/build.test.ts). Still scanned for .skip / .only / .todo. */
    if (st === 'A') { newFileScan({ root, rel, touched, add }); continue; }
    // dirty at the batch's start → the byte copy is the baseline; clean at the start → startSha is.
    const oldText = dirty.has(rel) ? readIf(path.join(snapDir, rel)) : git(root, ['show', `${startSha}:${rel}`], true);
    const newText = readIf(path.join(root, rel));
    if (newText == null) {
      add(rel, 0, 'test file missing on disk', 'restore the file');
      continue;
    }
    if (oldText == null) {
      add(rel, 0, 'no baseline copy to diff against', `the baseline stage must snapshot it to work/.b${ctx.batch}-testbase/${rel}`);
      continue;
    }
    touched.push(rel);
    scanTestFile({ rel, oldText, newText, ctx, add });
  }

  for (const rel of untracked) {
    if (rel === SELF_TEST) continue;
    const snap = path.join(snapDir, rel);
    const newText = readIf(path.join(root, rel));
    if (newText == null) {
      add(rel, 0, 'test file (untracked at baseline) deleted', 'a batch never deletes a test file');
      continue;
    }
    const oldText = readIf(snap);
    if (oldText == null) {
      add(rel, 0, 'no baseline copy to diff against', `the baseline stage must snapshot it to work/.b${ctx.batch}-testbase/${rel}`);
      continue;
    }
    touched.push(rel);
    scanTestFile({ rel, oldText, newText, ctx, add });
  }

  // Wholly new test files: no citation needed, but a new .skip/.only/.todo in one still fails.
  for (const rel of currentUntracked) {
    if (untracked.has(rel) || rel === SELF_TEST) continue;
    newFileScan({ root, rel, touched, add });
  }

  return touched;
}

/** A wholly new test file: nothing to diff it against, so only the never-citable shapes are checked. */
function newFileScan({ root, rel, touched, add }) {
  const newText = readIf(path.join(root, rel));
  if (newText == null) return;
  touched.push(rel);
  lines(newText).forEach((t, i) => {
    if (DISABLED_RE.test(t)) add(rel, i + 1, `disabled test: ${t.trim().slice(0, 80)}`, 'no batch may add .skip / .only / .todo — fix or delete the test');
  });
}

function scanTestFile({ rel, oldText, newText, ctx, add }) {
  const ls = lines(newText);
  const hunks = diffLines(oldText, newText);
  const changedNew = new Set();
  for (const h of hunks) for (const a of h.added) changedNew.add(a.line);
  const seen = new Set();

  const cite = (line, change, expected) => {
    const key = `${line}|${change}`;
    if (seen.has(key)) return;
    seen.add(key);
    const res = citationFor(ls, line, ctx, enclosingTitles(ls, line));
    if (!res.ok) add(rel, line, change, `${expected} — ${res.why}. Expected \`// batch ${ctx.batch}: <CONFIRMED finding id>\` or \`// batch ${ctx.batch} premise: <aon-doc-id> "<clause>"\` within the 6 lines above.`);
  };

  for (const h of hunks) {
    // Hard fails first — these are never citable.
    for (const a of h.added) {
      if (DISABLED_RE.test(a.text)) {
        add(rel, a.line, `disabled test: ${a.text.trim().slice(0, 80)}`, 'no batch may add .skip / .only / .todo — fix or delete the test');
      }
    }
    for (const r of h.removed) {
      if (isDescribe(r.text)) {
        add(rel, r.line, `describe block removed: ${r.text.trim().slice(0, 80)}`, 'a batch never deletes a describe block');
      }
    }

    // A numeric literal quietly flipped inside an it( block nothing else in the batch touched.
    const pairs = Math.min(h.added.length, h.removed.length);
    for (let i = 0; i < pairs; i++) {
      const a = h.added[i];
      const r = h.removed[i];
      if (a.text === r.text) continue;
      if (stripNums(a.text) !== stripNums(r.text)) continue;
      if (isBlock(a.text)) continue;
      const [from, to] = itBlockRange(ls, a.line);
      const otherChanges = [...changedNew].filter((n) => n >= from && n <= to && n !== a.line);
      if (otherChanges.length === 0) {
        add(rel, a.line, `numeric literal changed inside an otherwise unchanged it(): "${r.text.trim().slice(0, 70)}" -> "${a.text.trim().slice(0, 70)}"`,
          'a silent expectation flip — the it( must state what changed and carry the batch citation');
      }
    }

    for (const a of h.added) {
      if (DISABLED_RE.test(a.text)) continue;
      if (EXPECT_RE.test(a.text)) cite(a.line, `expect() changed/added: ${a.text.trim().slice(0, 80)}`, 'a changed assertion');
      else if (isIt(a.text)) cite(a.line, `it()/test() changed/added: ${a.text.trim().slice(0, 80)}`, 'a changed test block');
    }
    for (const r of h.removed) {
      if (isDescribe(r.text)) continue;                             // already a hard fail
      // A rewritten line is reported once, on its added half (which is what must carry the citation);
      // only an assertion the batch DROPPED outright is reported from the removed side.
      if (isIt(r.text) && !h.added.some((a) => isIt(a.text))) {
        cite(r.line, `it()/test() removed: ${r.text.trim().slice(0, 80)}`, 'a removed test block');
      } else if (EXPECT_RE.test(r.text) && !h.added.some((a) => EXPECT_RE.test(a.text))) {
        cite(r.line, `expect() removed: ${r.text.trim().slice(0, 80)}`, 'a removed assertion');
      }
    }
  }
}

/** The enclosing it()/test() block of `line`, approximated by the next block header. */
function itBlockRange(ls, line) {
  let from = 1;
  for (let n = Math.min(line, ls.length) - 1; n >= 0; n--) {
    if (isIt(ls[n])) { from = n + 1; break; }
  }
  let to = ls.length;
  for (let n = from; n < ls.length; n++) {
    if (isBlock(ls[n])) { to = n; break; }
  }
  return [from, to];
}

function auditRatchets({ root, base, ctx, add }) {
  for (const [rel, consts] of Object.entries(base.ratchets ?? {})) {
    const text = readIf(path.join(root, rel));
    if (text == null) { add(rel, 0, 'ratchet file missing', 'restore it'); continue; }
    const ls = lines(text);
    for (const [name, was] of Object.entries(consts)) {
      const now = ratchetValue(text, name);
      if (!now) { add(rel, 0, `ratchet ${name} removed (was ${was})`, 'a ratchet constant is never deleted'); continue; }
      if (now.value === was) continue;
      const dir = now.value > was ? 'raised' : 'lowered';
      const res = citationFor(ls, now.line, ctx, null);
      if (!res.ok) {
        add(rel, now.line, `ratchet ${name} ${dir} ${was} -> ${now.value}`,
          `${res.why}. Expected \`// batch ${ctx.batch}: <CONFIRMED finding id>\` or \`// batch ${ctx.batch} premise: <aon-doc-id> "<clause>"\` within the 6 lines above.`);
      }
    }
  }
}

function auditRegistries({ root, base, ctx, add }) {
  const added = [];
  for (const [rel, names] of Object.entries(REGISTRIES)) {
    const text = readIf(path.join(root, rel));
    if (text == null) { add(rel, 0, 'comparer missing', 'restore it'); continue; }
    const ls = lines(text);
    for (const name of names) {
      const now = registryKeys(text, name);
      if (now == null) { add(rel, 0, `registry ${name} not found`, 'a settle registry is never renamed or deleted mid-batch'); continue; }
      const nowKeys = new Map(now.map((k) => [k.key, k.line]));
      const wasKeys = new Set(base.registries?.[rel]?.[name] ?? []);

      for (const [key, line] of nowKeys) {
        if (wasKeys.has(key)) continue;
        added.push({ rel, name, key, line });
        const res = citationFor(ls, line, ctx, null);
        if (!res.ok) {
          add(rel, line, `${name} gained the key "${key}"`,
            `${res.why}. A new settle silences a real comparison — expected \`// batch ${ctx.batch}: <CONFIRMED finding id>\` or \`// batch ${ctx.batch} premise: <aon-doc-id> "<clause>"\` within the 6 lines above.`);
        }
      }
      for (const key of wasKeys) {
        if (nowKeys.has(key)) continue;
        // A removed key has no line of its own: the citation must name it somewhere in the file.
        const citedLine = ls.findIndex((t) => {
          const m = PREMISE_RE.exec(t) ?? CITE_RE.exec(t);
          if (!m) return false;
          return t.toLowerCase().includes(key.toLowerCase());
        });
        const ok = citedLine >= 0 && citationFor(ls, citedLine + 2, ctx, null).ok;
        if (!ok) {
          add(rel, 0, `${name} lost the key "${key}"`,
            `a removed settle must leave a citation naming it — expected a line \`// batch ${ctx.batch}: <CONFIRMED finding id whose text names ${key}>\` in ${rel}.`);
        }
      }
    }
  }
  return added;
}

function auditLimits({ root, base, ctx, add }) {
  const rel = 'work/experience-instrument-limits.json';
  const text = readIf(path.join(root, rel));
  if (text == null) { add(rel, 0, 'limits file missing', 'restore it'); return; }
  const ls = lines(text);
  const now = Object.keys(JSON.parse(text).records ?? {});
  const was = new Set(base.limits ?? []);
  for (const id of now) {
    if (was.has(id)) continue;
    // JSON carries no comments above a key: the citation may sit anywhere inside the record's block.
    const start = ls.findIndex((t) => t.includes(`"${id}"`));
    const [from, to] = jsonRecordRange(ls, start);
    let ok = false;
    let why = 'no citation inside the record';
    for (let n = from; n <= to && n < ls.length; n++) {
      const m = PREMISE_RE.exec(ls[n]);
      if (m) { const r = checkPremise(m, ctx); if (r.ok) { ok = true; break; } why = r.why; continue; }
      const c = CITE_RE.exec(ls[n]);
      if (c) { const r = checkFinding(c, ctx, null); if (r.ok) { ok = true; break; } why = r.why; }
    }
    if (!ok) {
      add(rel, start + 1, `experience limit parked a new record "${id}"`,
        `${why}. Parking a record hides it from gate 9 — the record needs \`"_cite": "// batch ${ctx.batch}: <CONFIRMED finding id>"\` (or the premise form) inside its own block.`);
    }
  }
}

function jsonRecordRange(ls, start) {
  if (start < 0) return [0, -1];
  let depth = 0;
  for (let n = start; n < ls.length; n++) {
    for (const ch of ls[n]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (n > start && depth <= 0) return [start, n];
  }
  return [start, ls.length - 1];
}

/**
 * The batch-29 pattern: a settle or comparer teach only counts once a test writes a stunted copy of
 * the record and proves the comparer still reports it. Detected by the `mutation-proof` marker.
 */
function auditMutationProofs({ root, addedKeys, testFiles, add, b }) {
  if (!addedKeys.length) return;
  const bodies = testFiles.map((rel) => ({ rel, text: readIf(path.join(root, rel)) ?? '' }));
  for (const { rel, name, key, line } of addedKeys) {
    const proof = bodies.find((f) => f.text.includes('mutation-proof') && f.text.includes(key));
    if (!proof) {
      add(rel, line, `${name} gained the key "${key}" with no mutation-proof test`,
        `batch ${b}'s test files must contain a test marked \`// mutation-proof\` that stunts "${key}" and asserts the comparer still reports it`);
    }
  }
}

// ---------------------------------------------------------------------------- CLI

function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const batch = arg('--batch');
  if (!batch) {
    console.error('usage: node scripts/test-flip-audit.mjs --batch NNN [--root DIR] [--json]');
    return 2;
  }
  const root = path.resolve(arg('--root') ?? REPO_ROOT);
  const result = auditBatch({ root, batch, aonRoot: arg('--aon') ?? AON_ROOT_DEFAULT });

  if (argv.includes('--json')) {
    const out = path.join(root, 'work', `.b${result.batch}-flip-audit.json`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`flip-audit: wrote ${path.relative(root, out).replace(/\\/g, '/')}`);
  }

  if (!result.violations.length) {
    console.log(`flip-audit: batch ${result.batch} clean — ${result.counts.testFiles} test file(s) touched, ${result.counts.addedRegistryKeys} new settle key(s), every flip cited.`);
    return 0;
  }
  console.log(`flip-audit: FAIL — ${result.violations.length} uncited or forbidden flip(s) in batch ${result.batch}:\n`);
  for (const v of result.violations) console.log(`  ${v.file}:${v.line}\n    changed:  ${v.change}\n    expected: ${v.expected}\n`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
