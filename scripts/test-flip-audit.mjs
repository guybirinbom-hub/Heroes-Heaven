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
 * A WHOLLY NEW test file is held to the same rule (ratchet lane, 2026-09-29): it is diffed against the
 * empty string, so every it()/test() opener and every expect() in it is an added line that needs the
 * citation above. It used to be scanned only for .skip / .only / .todo, which let a batch put any
 * number of uncited assertions in a fresh file. The audit's own self-test (SELF_TEST) stays exempt.
 *
 * The failure mode it guards: an agent that cannot make the batch green quietly loosens the
 * instrument instead of fixing the data — lowers an expectation, adds a settle key, raises a ratchet,
 * parks a record in the experience limits. Every one of those is legitimate ONCE, with a citation.
 * Without the citation it is a silently widened gate, and the whole parity programme rests on those
 * gates staying honest.
 *
 * THE PREMISE FORM CITES WORDS, NOT A PAGE (card step 10's refuter, 2026-10-07): a premise citation
 * used to pass as soon as the mirror file for its doc id EXISTED. A test cited weapon-group-15 with
 * our own src/rules/critSpec.ts wording ("The target is off-guard until the start of your next turn")
 * while the page prints "The target is made off-balance by your attack, becoming off-guard until the
 * start of your next turn", and the audit passed. A premise that is not in the cited page is a false
 * premise, so checkPremise now also requires the quoted clause to appear in the document's own text
 * (clauseInDoc below — both sides normalised the same way, parsed docs cached per run). An empty
 * clause cites nothing and fails.
 *
 * Two holes the first refuter of that check found (2026-10-07), both closed in clauseInDoc:
 *   • "a" and "the" passed for weapon-group-15 — a substring of one word is in every page. A clause
 *     is evidence only from 2 words AND 8 characters (after normalisation); shorter fails as too short.
 *   • "/Feats.aspx?ID=4458", "feat-54" (legacy_id) and "2023-11-15" (release_date) passed for
 *     feat-4458, because the check read EVERY string field of the doc. It now skips the mirror's
 *     bookkeeping fields (BOOKKEEPING below — ids, urls, dates, filing categories, derived scales)
 *     and reads only what the page prints.
 *
 * Three rules from the card citation retrofit, round 2 (2026-10-09), each explained where it is coded:
 *   • a premise in a test file must cite a page the TEST DRIVES — the page of a record named in the test,
 *     its slice host, an embedded page or a reprint — never another page that prints the same words
 *     (premiseDrivenPage; it needs public/core.json under the root and refuses without it);
 *   • a finding id with an EMPTY record part ('#…') passes only when its read entry declares
 *     `scope: 'design'` and a `rule` naming an existing docs/<file>.md section (checkFinding);
 *   • a removed describe block passes only when such a design entry lists its exact title in `removed`
 *     (removalSanctioned) — card step 22's legacy-path deletion is the case it exists for.
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
 * follow the token directly. Exported so a corpus sweep reads citations with the audit's own eyes.
 * The clause's quotes may each carry a JSON escape (`\"the clause\"`): inside an experience-limits
 * `"_cite"` string that is the only way a quote can be written, and until 2026-10-07 the premise form
 * the auditLimits message offers never parsed there (found by the clause-check test). On a bare line the
 * optional backslashes match nothing and the lazy group reads exactly what the greedy one did. */
export const PREMISE_RE = /\/\/\s*batch\s+([0-9A-Za-z]+)\s+premise\s*:\s*([a-z0-9]+(?:-[a-z0-9]+)*-\d+)\s+\\?"([^"]*?)\\?"/i;
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
    if (p) {
      const res = checkPremise(p, ctx);
      if (!res.ok || titleText === null) return res;                 // a non-test file names no record
      return premiseDrivenPage({ ctx, docId: p[2], hay: driveText(ls, line, titleText) });
    }
    const c = CITE_RE.exec(raw);
    if (c) return checkFinding(c, ctx, titleText);
  }
  return { ok: false, why: `no citation in the 6 lines above` };
}

function checkPremise(m, ctx) {
  const [, batch, docId, clause] = m;
  if (normBatch(batch) !== ctx.batch) return { ok: false, why: `premise cites batch ${normBatch(batch)}, this is batch ${ctx.batch}` };
  return clauseInDoc({ aonRoot: ctx.aonRoot, docId, clause, cache: ctx.docCache });
}

// ---------------------------------------------------------------------------- the clause check

/*
 * HOW THE MIRROR STORES A PAGE (read across feat / weapon / weapon-group / spell / class-feature /
 * action / doctrine / element docs, 2026-10-07): every doc carries the page as `markdown` — AoN's own
 * tags (`<title …>`, `<trait label="…" />`, `<actions string="…" />`, `<column>`, `<row>`, `<ul><li>`,
 * `<br />`, `<document id="…" />`), links `[label](/X.aspx?ID=n)`, the newer `{{index n "label"}}`
 * cross-reference, `**bold**`, `\n` paragraphing, `&amp;`-style entities, curly quotes and em dashes —
 * plus a flattened `text`, and the same prose again under `summary`, `summary_markdown`,
 * `search_markdown`, `trigger`, `trigger_markdown` and whichever per-category fields the page has. So
 * the check reads every string value of the doc, at any depth — EXCEPT the bookkeeping fields named in
 * BOOKKEEPING below — normalises each the same way as the clause, and asks whether the clause is a
 * substring of any one of them (never of two joined — the fields are separated by a newline the
 * clause's own normalisation can never contain).
 *
 * WHY A DENY-LIST, AND WHICH KEYS (measured 2026-10-07 over 1,067 docs, 12 per category, 97
 * categories: for every string-valued key, how often its normalised value is a substring of the
 * normalised `markdown` + `text` — the page itself):
 *   • `id`, `url`, `release_date`: 0 of 970; `legacy_id` 0 of 221, `remaster_id` 0 of 195. The page
 *     links to itself as `[name](url)`, which the normaliser folds to the name, so the url string is
 *     never printed; the twin ids and the date are the mirror's own.
 *   • `category`, `primary_source_category`, `source_category`, `item_category`, `item_subcategory`,
 *     `archetype_category`, `trait_group`, `pfs`, `rarity`, `breadcrumbs`, `deity_category_order`:
 *     the mirror's FILING ("Rulebooks", "Base Weapons", "Standard", "common", "chapter 3: subsystems"),
 *     0.00–0.39 in page, the hits coincidental substrings. `rarity` prints only as a trait pill, which
 *     `trait` and the markdown carry. NOT a `*_category` glob: `weapon_category` ("Martial"),
 *     `armor_category`, `deity_category`, `plane_category`, `siege_weapon_category` are printed, 1.00.
 *   • `heighten_group` ("5th rank" — a 2-word, 8-character label the page never prints: 0 of 22),
 *     `damage_type` ("piercing" where the page prints "1d8 P": 0 of 11), the creature `*_scale` keys
 *     with `strongest_save` / `weakest_save` ("high" / "moderate" / "low": AoN's derived ratings),
 *     `legacy_name` / `remaster_name` (the OTHER printing's name), `image`, `icon_image`,
 *     `item_parent_id`, `item_child_id`: derived or cross-record, never the page's words.
 *   An ALLOW-list was the alternative and loses: the sample holds 211 string-valued keys, 145 of them
 *   in the page 0.80 or more of the time — per-category text fields (`trigger`, `cost`, `primary_check`,
 *   `usage`, `stage`, `primary_source_raw`, …) that are the page's words, and a new category
 *   brings new ones an allow-list would silently refuse. `*_raw` is NOT denied
 *   either — `primary_source_raw` "Player Core pg. 60", `price_raw` "4 gp", `duration_raw` "see text"
 *   ARE the printed forms (0.81–1.00); the parsed twin (`price: 400`) is a number and never read.
 *   `summary`, `summary_markdown` and `search_markdown` stay: for spells the one-line summary is in
 *   `search_markdown` and not in `markdown` (0.29 overall), and it is still this doc's own words —
 *   kept on the refuter's ask. Only string values are read; booleans and numbers never enter.
 *
 * Normalisation, in this order, on BOTH sides:
 *   1. `{{index n "label"}}` and `<%…%>` cross-reference templates → their label / nothing;
 *   2. `[label](url)` → label (a label may wrap across a line);
 *   3. the three tags whose ATTRIBUTE is what the page prints keep it as text — `<title right="Ritual 3">`
 *      (the level badge), `<trait label="Fortune" />` (the pill), `<actions string="Two Actions" />`
 *      (the glyph) — then every other tag `<…>` → a space (never a bare `<` in prose: the tag needs a
 *      letter or `/` after it);
 *   4. emphasis markers (`*`, and `_` at a word's edge) → removed;
 *   5. HTML entities (`&amp;` `&nbsp;` `&#39;` `&#x2019;` …) → the character;
 *   6. curly quotes → straight, every dash → `-`, `…` → `...`, NBSP and thin spaces → space,
 *      zero-width characters → removed;
 *   7. whitespace runs (including line breaks) → one space, trimmed, lower-cased.
 *
 * A match on the NORMALISED text is a match on the printed words: nothing above changes a letter,
 * a digit or the order of words, so "Frequency once per day" matches `**Frequency**\nonce per day`,
 * and our own paraphrase of a sentence still fails.
 */
const ENTITY = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', thinsp: ' ', ensp: ' ', emsp: ' ',
};

export function normalizeText(s) {
  let t = String(s ?? '');
  if (t.indexOf('{{') !== -1) t = t.replace(/\{\{[A-Za-z][A-Za-z0-9_]*\s+[^\s}]+\s+"([^"]*)"\s*\}\}/g, '$1');
  if (t.indexOf('<%') !== -1) t = t.replace(/<%[^>]*?>/g, '');
  t = t.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1');
  t = t.replace(/<(?:title|trait|actions)\b[^<>]*?\s(?:right|label|string)="([^"]*)"[^<>]*>/g, ' $1 ');
  t = t.replace(/<\/?[A-Za-z][^<>]*>/g, ' ');
  t = t.replace(/\*/g, '');
  t = t.replace(/(^|[\s(["'])_+(?=\S)/g, '$1').replace(/(?<=\S)_+(?=$|[\s)\].,;:!?"'])/g, '');
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
  t = t.replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[  -   　]/g, ' ');
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The mirror's bookkeeping keys — never the page's words (the list is justified in the comment above). */
export const BOOKKEEPING = new Set([
  'id', 'url', 'legacy_id', 'remaster_id', 'legacy_name', 'remaster_name', 'item_parent_id', 'item_child_id',
  'image', 'icon_image', 'release_date',
  'category', 'primary_source_category', 'source_category', 'item_category', 'item_subcategory',
  'archetype_category', 'trait_group', 'pfs', 'rarity', 'breadcrumbs', 'deity_category_order',
  'heighten_group', 'damage_type', 'strongest_save', 'weakest_save',
  // Filing and attribute fields the page never prints (refuter, 2026-10-07): the adventure-path or
  // series name (action-1274 "Blood Lords" prints only "Pathfinder #182: Graveclaw"), a deity's
  // symbol / sacred animal / colour (deity-374 "rolling boulder": 0 of 5 in the page), and a
  // familiar's ability list the page omits (familiar-specific-12 "Divinatory Linguist"). Where a page
  // DOES print one of these, the words are in its markdown too, so a true clause still passes.
  'source_group', 'primary_source_group', 'religious_symbol', 'sacred_animal', 'sacred_color',
  'familiar_ability', 'familiar_ability_markdown',
]);
const isBookkeeping = (key) => BOOKKEEPING.has(key) || key.endsWith('_id') || key.endsWith('_scale');

/** Every string value of a parsed mirror doc, at any depth, skipping the bookkeeping keys at every level. */
function docStrings(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const v of node) docStrings(v, out);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!isBookkeeping(k)) docStrings(v, out);
  }
  return out;
}

/*
 * A clause is evidence only from 2 words AND 8 characters, both measured on the NORMALISED clause (the
 * single spaces between words count — "by your" is 7). "a", "the", "off-guard" are substrings of
 * nearly any page, so finding them proves nothing about the premise; the order of the checks is
 * in-doc FIRST, then length, so a clause that is not on the page is reported as not on the page
 * (the truer complaint — "/Feats.aspx?ID=4458" is not the page's words, not merely short).
 */
const MIN_WORDS = 2;
const MIN_CHARS = 8;
const tooShort = (needle) => needle.split(' ').length < MIN_WORDS || needle.length < MIN_CHARS;

/**
 * The normalised text of one mirror doc: each string field normalised on its own, joined by `\n`.
 * `null` when the file is not readable JSON. Cached per audit run in `cache` (a Map keyed by file),
 * because the same doc is cited by dozens of lines in a batch and parsing it once is what keeps the
 * audit cheap. `undefined` for a file that does not exist (the caller keeps its own message for that).
 */
export function docText(file, cache) {
  if (cache?.has(file)) return cache.get(file);
  let text;
  if (!existsSync(file)) text = undefined;
  else {
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
      text = docStrings(doc, []).map(normalizeText).filter(Boolean).join('\n');
    } catch {
      text = null;
    }
  }
  cache?.set(file, text);
  return text;
}

/**
 * Is `clause` in the mirror doc `docId`, and long enough to be evidence? `{ ok: true }`, or
 * `{ ok: false, why }` where `why` names the doc id and the clause. The category folder is the id
 * minus its trailing `-<digits>` (so `weapon-group-15` lives under `weapon-group/`), exactly as
 * before the clause check existed.
 */
export function clauseInDoc({ aonRoot = AON_ROOT_DEFAULT, docId, clause, cache } = {}) {
  const dm = /^(.*)-(\d+)$/.exec(docId ?? '');
  const category = dm ? dm[1] : null;
  const file = category ? path.join(aonRoot, category, `${docId}.json`) : null;
  const text = file ? docText(file, cache) : undefined;
  if (text === undefined) return { ok: false, why: `premise doc ${docId} has no mirror file (${file ?? 'unparseable id'})` };
  if (text === null) return { ok: false, why: `premise doc ${docId} has a mirror file that is not readable JSON (${file})` };
  const needle = normalizeText(clause);
  if (!needle) return { ok: false, why: `premise cites ${docId} with an empty clause — a premise with no clause cites nothing` };
  if (!text.includes(needle)) {
    return { ok: false, why: `premise doc ${docId} does not contain the clause "${clause}" — quote the page's own words, not ours` };
  }
  if (tooShort(needle)) {
    return { ok: false, why: `premise cites ${docId} with the clause "${clause}" — too short to be evidence (a clause needs at least ${MIN_WORDS} words and ${MIN_CHARS} characters)` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------- the page-the-test-drives check

/*
 * A PREMISE CITES THE PAGE OF THE RECORD THE TEST DRIVES (card citation retrofit, round 2, 2026-10-09).
 * The clause check above proves the words are on the cited page; it never asked WHOSE page. A refuter
 * found four card premises that quoted a page which merely happens to print the same words: an
 * osteo-armaments test citing the fighter class page (class-35) for "whichever comes first.", the
 * air-gate card citing the kineticist class page for a junction line that its own element page (element-1)
 * prints, the Accept Echo slice citing an unrelated item (equipment-2337) for "Frequency once per day",
 * and the Halfling Luck Source line citing a category page. Each passed, because the words were there.
 *
 * So a premise in a TEST file must also cite a page the test can reach: the doc is the `aonId` (or the
 * `aonParentId`) of a record whose id or name appears in the test — the enclosing it()/describe()
 * titles, the open it() block from its opener down to the change, or the 6 lines above the change and
 * the changed line itself (batch citation comments excluded — a clause must not vouch for itself); or
 * the host page that record is sliced from (src/data/page-slices.json); or a page one of those embeds
 * (`<document id="…" />` in the mirror's markdown); or a reprint of one of those (the mirror's
 * `legacy_id` / `remaster_id`). Otherwise: 'premise cites a page the test does not drive'. Non-test
 * files (ratchets, registries, experience limits) have no enclosing title and are not held to it.
 *
 * WHY THE WHOLE OPEN it() BLOCK, NOT ONLY THE 6-LINE WINDOW (measured on the card batch, 2026-10-09):
 * titles + window refused 170 premise lines; 58 of them cite the page of a record the same it() block
 * names further up (`featAct('halfling-luck')` seven lines above a feat-4458 premise) — false refusals.
 * Widening to the test that drives the record ("named in the test") removes those and keeps the rule.
 *
 * WHAT IT CANNOT CATCH (said, not hidden): it is a reachability check, not a reading of the assertion.
 * A record named anywhere in that text makes its whole reachable set citable — a fighter build opened
 * at the top of the block makes the fighter class page (class-35) citable for an assertion about the
 * osteo-armaments feat card, a title naming "the kineticist class page" makes class-23 citable for a
 * line the air element page prints too, and a one-word record id that is also an English word ("aid",
 * "light") is read as that record. It catches a page nothing in the test names; it cannot tell which
 * of the named records an assertion is about.
 *
 * Names are matched as slugs: the text is lower-cased, apostrophes dropped, split on everything that is
 * not a letter or digit, and every run of up to MAX_NAME_WORDS words is looked up against each record's
 * id and slugified name (a run of under 3 characters never matches). The record index is
 * public/core.json under the audit's root; with no index the check refuses — it never passes by default.
 */
const MAX_NAME_WORDS = 12;
const slugOf = (s) => String(s ?? '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean).join('-');

/** The record index the check reads, built once per audit run; `null` when the root has no public/core.json. */
function reachIndex(ctx) {
  if (ctx.reach !== undefined) return ctx.reach;
  const raw = readIf(path.join(ctx.root, 'public', 'core.json'));
  if (raw == null) return (ctx.reach = null);
  const core = JSON.parse(raw);
  const records = new Map();                                        // 'bucket:id' -> record
  const names = new Map();                                          // slug -> Set<'bucket:id'>
  /* A bucket name is code, not a record named: every card test writes `'feats'` / `'items'`, and the
   * category pages called "Feats", "Items" … would make their page citable from any test (measured: the
   * Halfling Luck Source premise on category-page-130 passed through `openFullText('feats', …)`). */
  const bucketWords = new Set(Object.keys(core).flatMap((b) => [slugOf(b), slugOf(b.replace(/([a-z])([A-Z])/g, '$1-$2'))]));
  for (const [bucket, v] of Object.entries(core)) {
    const recs = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
    for (const r of recs) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue;
      const key = `${bucket}:${r.id}`;
      records.set(key, r);
      for (const s of new Set([slugOf(r.id), slugOf(r.name)])) {
        if (s.length < 3 || bucketWords.has(s)) continue;
        if (!names.has(s)) names.set(s, new Set());
        names.get(s).add(key);
      }
    }
  }
  const slicesRaw = readIf(path.join(ctx.root, 'src', 'data', 'page-slices.json'));
  const slices = slicesRaw ? JSON.parse(slicesRaw).slices ?? {} : {};
  return (ctx.reach = { records, names, slices });
}

/**
 * The first line (0-indexed) of the it()/test() block that is still OPEN at `line` (1-indexed), or -1 —
 * for a change in helper code, at describe level, or below a block that has already closed. Brackets
 * are counted on codeOnly() text, so a bracket in a string or a comment never closes a block.
 */
function openItStart(ls, line) {
  for (let n = Math.min(line, ls.length) - 1; n >= 0; n--) {
    const code = codeOnly(ls[n] ?? '');
    if (DESCRIBE_RE.test(code)) return -1;
    if (!IT_RE.test(code)) continue;
    let depth = 0;
    for (let k = n; k < line - 1; k++) {
      for (const ch of codeOnly(ls[k] ?? '')) { if (ch === '(' || ch === '{' || ch === '[') depth++; else if (ch === ')' || ch === '}' || ch === ']') depth--; }
      if (depth <= 0) return -1;                                   // the block closed above the change
    }
    return n;
  }
  return -1;
}

/** The last line (0-indexed) of the it()/test() block that opens on `start`: where its brackets balance. */
function itBlockEnd(ls, start) {
  let depth = 0;
  for (let k = start; k < ls.length; k++) {
    for (const ch of codeOnly(ls[k] ?? '')) { if (ch === '(' || ch === '{' || ch === '[') depth++; else if (ch === ')' || ch === '}' || ch === ']') depth--; }
    if (depth <= 0) return k;
  }
  return ls.length - 1;
}

/**
 * The text a premise's record must be named in: the enclosing titles, the whole it()/test() block open at
 * the change (the test that drives the record — a premise above an it() opener vouches for its whole
 * body), and the 6 lines above the change with the changed line itself (for a change in helper code) —
 * minus every batch citation comment, so a clause never vouches for its own page.
 */
function driveText(ls, line, titleText) {
  const start = openItStart(ls, line);
  const from = Math.min(start < 0 ? Infinity : start, Math.max(0, line - 7));
  const to = Math.max(line - 1, start < 0 ? -1 : itBlockEnd(ls, start));
  const keep = [];
  for (let n = from; n <= to && n < ls.length; n++) {
    const t = ls[n] ?? '';
    if (PREMISE_RE.test(t) || CITE_RE.test(t)) continue;
    keep.push(t);
  }
  return `${titleText}\n${keep.join('\n')}`;
}

/** Every record named in `hay`, as 'bucket:id' keys. Exported for the corpus sweep and the self-test. */
export function namedRecords(hay, reach) {
  const words = slugOf(hay).split('-').filter(Boolean);
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_NAME_WORDS && i + n <= words.length; n++) {
      const hit = reach.names.get(words.slice(i, i + n).join('-'));
      if (hit) for (const k of hit) out.add(k);
    }
  }
  return out;
}

/** A mirror doc's embedded pages and reprint twins, cached per run. */
function docLinks(ctx, docId) {
  ctx.linkCache ??= new Map();
  if (ctx.linkCache.has(docId)) return ctx.linkCache.get(docId);
  const dm = /^(.*)-(\d+)$/.exec(docId ?? '');
  const raw = dm ? readIf(path.join(ctx.aonRoot, dm[1], `${docId}.json`)) : null;
  const links = [];
  if (raw) {
    try {
      const doc = JSON.parse(raw.replace(/^﻿/, ''));
      for (const k of ['legacy_id', 'remaster_id']) for (const v of [doc[k]].flat()) if (typeof v === 'string') links.push(v);
      for (const m of String(doc.markdown ?? '').matchAll(/<document\b[^>]*?\bid="([^"]+)"/g)) links.push(m[1]);
    } catch { /* an unreadable doc links nowhere */ }
  }
  ctx.linkCache.set(docId, links);
  return links;
}

/** The docs a set of named records reaches: own page, parent page, slice host, then one hop of embeds and reprints. */
export function drivenDocs(ctx, keys) {
  const reach = reachIndex(ctx);
  const base = new Set();
  /* A variant printed on a family page carries a compound id, `<page doc>-<variant>` (2,969 aonIds in
   * core.json, e.g. 1st-rank-scroll = equipment-2962-2826): its page is the doc the prefix names. */
  const addDoc = (id) => {
    if (typeof id !== 'string' || !id) return;
    base.add(id);
    const m = /^(.*-\d+)-\d+$/.exec(id);
    if (m) base.add(m[1]);
  };
  for (const key of keys) {
    const r = reach.records.get(key);
    addDoc(r?.aonId);
    addDoc(r?.aonParentId);
    const slice = reach.slices[key];
    const host = slice ? reach.records.get(`${slice.bucket}:${slice.page}`) : null;
    addDoc(host?.aonId);
  }
  const out = new Set(base);
  for (const d of base) for (const l of docLinks(ctx, d)) out.add(l);
  return out;
}

function premiseDrivenPage({ ctx, docId, hay }) {
  const reach = reachIndex(ctx);
  if (!reach) return { ok: false, why: `premise ${docId}: no record index at public/core.json, so the page the test drives cannot be checked` };
  if (drivenDocs(ctx, namedRecords(hay, reach)).has(docId)) return { ok: true };
  return {
    ok: false,
    why: `premise cites a page the test does not drive — ${docId} is not the page (nor the slice host, an embedded page or a reprint) of any record named in the enclosing titles or the lines above; cite the driven record's own page`,
  };
}

// ---------------------------------------------------------------------------- the finding check

/*
 * A DESIGN-WIDE FINDING DECLARES ITSELF (card citation retrofit, round 2, 2026-10-09). The record part
 * of a finding id (before '#') must appear in the enclosing titles. A card ruling is about every card,
 * not one record, and round 1 wrote those ids as '#card-…' — an EMPTY record part, which every title
 * "contains", so the rule passed without being met. An empty record part is now accepted only when the
 * read entry carries `scope: 'design'` and a non-empty `rule` naming the design document section it
 * stands on (a `docs/<file>.md` path that exists under the root); anything else is refused.
 */
function designEntry(ctx, findingId) {
  const e = ctx.entries?.get(findingId);
  if (!e || e.scope !== 'design' || typeof e.rule !== 'string' || !e.rule.trim()) return null;
  const doc = /\bdocs\/[\w./-]+?\.md\b/.exec(e.rule);
  if (!doc || !existsSync(path.join(ctx.root, doc[0]))) return null;
  return e;
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
  const record = findingId.split('#')[0].toLowerCase();
  if (!record) {
    if (designEntry(ctx, findingId)) return { ok: true };
    return { ok: false, why: `finding ${findingId} names no record — a design-wide finding needs scope design in the read file (\`scope: 'design'\` and a \`rule\` naming its docs/<file>.md section)` };
  }
  if (titleText === null) return { ok: true };                     // not a test file
  const hay = titleText.toLowerCase();
  if (!hay.includes(record) && !hay.includes(record.replace(/-/g, ' '))) {
    return { ok: false, why: `record id "${record}" appears in no enclosing describe/it title` };
  }
  return { ok: true };
}

/*
 * A DESIGN-SANCTIONED DESCRIBE REMOVAL (card citation retrofit, round 2). A deleted describe block is a
 * hard fail, and stays one — except when the batch's read file holds a CONFIRMED entry with
 * `scope: 'design'`, a `rule` naming its docs/<file>.md section (as above) and a `removed` list carrying
 * the removed describe's title exactly. Card step 22 deleted the legacy DescBody page path and the
 * describe that tested it (docs/card-design.md row 22); this is the one mechanism that lets such a
 * deletion through, and only by its exact title.
 */
const describeTitle = (t) => {
  const m = /^\s*describe(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(t ?? '');
  return m ? m[2].replace(/\\(.)/g, '$1') : null;
};
function removalSanctioned(ctx, text) {
  const title = describeTitle(text);
  if (title == null) return false;
  for (const id of ctx.confirmed) {
    const e = designEntry(ctx, id);
    if (e && Array.isArray(e.removed) && e.removed.includes(title)) return true;
  }
  return false;
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
  // the confirmed entries whole, for the design-scope rule (an empty record part) and sanctioned removals
  const entries = new Map((read.confirmed ?? []).filter((f) => (f.verdict ?? 'CONFIRMED') === 'CONFIRMED').map((f) => [f.id, f]));
  const ctx = { batch: b, root, confirmed, known, entries, aonRoot, docCache: new Map() };   // one parse per cited doc per run

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
    /* A file the batch ADDED is a wholly new test file — the same file the untracked loop below
     * handles, only already committed — so it goes through the same newFileScan, never
     * `git show startSha:<rel>` (which fails for it). Since the ratchet lane of 2026-09-29 a new file is
     * NOT exempt: newFileScan diffs it against the empty string, so every it()/test() opener and every
     * expect() in it needs the batch citation, exactly like an added hunk of an existing file. (The
     * exemption this replaced was added when replaying batch 29 after its commit produced 108 violations
     * in test/batch29-data.test.ts; those were the uncited assertions a new file could carry unseen.) */
    if (st === 'A') { newFileScan({ root, rel, touched, ctx, add }); continue; }
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

  // Wholly new test files: audited like an added hunk — every it()/expect() cited, .skip/.only/.todo fail.
  for (const rel of currentUntracked) {
    if (untracked.has(rel) || rel === SELF_TEST) continue;
    newFileScan({ root, rel, touched, ctx, add });
  }

  return touched;
}

/**
 * A wholly new test file (untracked now, or committed as 'A' inside the batch window): diffed against
 * the EMPTY STRING and handed to scanTestFile, so every line of it is an added line. Every it()/test()
 * opener and every expect() needs `// batch NNN: <CONFIRMED finding id>` (record id in the enclosing
 * title) or the premise form within the 6 lines above, and .skip / .only / .todo still fail outright.
 *
 * Before the ratchet lane of 2026-09-29 a new file was only scanned for .skip / .only / .todo, so a
 * batch could park any number of uncited assertions in a fresh file — the one place the citation rule
 * never looked.
 */
function newFileScan({ root, rel, touched, ctx, add }) {
  const newText = readIf(path.join(root, rel));
  if (newText == null) return;
  touched.push(rel);
  scanTestFile({ rel, oldText: '', newText, ctx, add });
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
      if (isDescribe(r.text) && !removalSanctioned(ctx, r.text)) {
        add(rel, r.line, `describe block removed: ${r.text.trim().slice(0, 80)}`,
          `a batch never deletes a describe block — unless work/.b${ctx.batch}-read.json holds a CONFIRMED entry with scope 'design', a rule naming its docs/<file>.md section and \`removed\` listing this describe's exact title`);
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
