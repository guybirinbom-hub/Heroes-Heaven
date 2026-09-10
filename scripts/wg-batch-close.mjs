/*
 * DERIVE the batch's parity verdicts instead of writing them by hand.
 *
 * Plan section A (`docs/wg-batch-pipeline.md`), stage `close`:
 *
 *   "`wg-batch-close.mjs` DERIVES `work/wg-batch-NNN-parity.json` and `-residual.json` from
 *    `.bNNN-read.json` + the manifest: `FIXED` requires a cited row / code edit / named test for that
 *    finding id, `MATCHES` requires a file:symbol or an instrument teach, `OWNER-QUEUED` requires the
 *    desk `n`; merges — never drops or overwrites an existing verdict; refuses on a batch whose commit
 *    already exists (`git log --grep "parity batch NNN"`)."
 *
 * The scratchpad ancestor (b029_close.py) decided FIXED-vs-MATCHES by sniffing the word "instrument"
 * in the finding's prose. That is the failure this file exists to stop: a verdict is now a claim about
 * EVIDENCE ON DISK — an overlay row in a manifest spec, a staged src edit naming the record, a staged
 * test naming the finding, a settle/comparer teach quoted from a report — and a verdict with no
 * evidence is a refusal that names the offending ids, never a sentence.
 *
 * Merging is one-way on purpose. An existing verdict is authoritative: it is never dropped and never
 * overwritten, a derived verdict that CONTRADICTS one is a refusal printing both values, and a record
 * this run cannot cite but the existing file already answers keeps the old answer (reported, not
 * refused). Only a NEW uncitable verdict stops the batch.
 *
 *   node scripts/wg-batch-close.mjs --batch 030            # dry run: prints the merge, writes nothing
 *   node scripts/wg-batch-close.mjs --batch 030 --write
 *   node scripts/wg-batch-close.mjs --batch 030 --root <dir>   # (tests) run against a fixture tree
 *   node scripts/wg-batch-close.mjs --batch 030 --write --reverdict resilient=MATCHES --reason "..."
 *
 * That last form is the one hand-held exception to the one-way merge: an orchestrator CORRECTING a
 * verdict already on disk. It is repeatable (each --reverdict takes the --reason at its own position),
 * refuses without a reason, and logs the change to `residual.reverdicts`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] ?? null : null; };

const WRITE = flag('--write');
const ROOT = arg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
/** every occurrence of a repeatable flag, in order — `--reverdict a=X --reason "..." --reverdict b=Y --reason "..."`. */
const args = (k) => argv.flatMap((v, i) => (v === k ? [argv[i + 1] ?? ''] : []));
const rawBatch = arg('--batch');
if (!rawBatch) { console.error('usage: node scripts/wg-batch-close.mjs --batch NNN [--write] [--root dir] [--reverdict id=VERDICT --reason "..."]'); process.exit(2); }

/** Numeric batches are zero-padded to three digits (029); print batches keep their P01-style id. */
const TAG = /^\d+$/.test(rawBatch) ? String(Number(rawBatch)).padStart(3, '0') : rawBatch.toUpperCase();
const BATCH = /^\d+$/.test(rawBatch) ? Number(rawBatch) : TAG;

const refusals = [];
const notes = [];
const refuse = (m) => refusals.push(m);
const p = (rel) => join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(p(rel), 'utf8'));
const textCache = new Map();
const text = (rel) => {
  if (!textCache.has(rel)) textCache.set(rel, existsSync(p(rel)) ? readFileSync(p(rel), 'utf8') : null);
  return textCache.get(rel);
};

const READ_PATH = `work/.b${TAG}-read.json`;
const SPECS_PATH = `work/.b${TAG}-specs.json`;
const GAPS_PATH = `work/.b${TAG}-gaps.json`;
const BATCH_PATH = `work/wg-batch-${TAG}.json`;
const PARITY_PATH = `work/wg-batch-${TAG}-parity.json`;
const RESIDUAL_PATH = `work/wg-batch-${TAG}-residual.json`;
const QUESTIONS_PATH = 'work/owner-questions.json';
const NUMBERING_PATH = 'work/rulings-numbering.json';
/** The comparers whose settle registries ARE the instrument teach for a MATCHES verdict. */
const COMPARERS = ['scripts/wg-diff.mjs', 'scripts/wg-values.mjs', 'scripts/wg-identity.mjs', 'scripts/wg-casting.mjs'];
const TEACH_RE = /settle|settled|teach|taught|comparer|instrument|VERIFIED_EQUIVALENT|SETTLED_VALUES|NOT_A_SCALAR|SETTLED_IDENTITIES/i;

for (const need of [READ_PATH, BATCH_PATH]) {
  if (!existsSync(p(need))) { console.error(`missing ${need} — the close stage derives its verdicts from it, it cannot invent them.`); process.exit(2); }
}

// ── the batch whose commit already exists is closed; re-deriving it can only damage history ──────
const gitQuiet = (args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
};
const committed = (() => {
  const pat = typeof BATCH === 'number' ? `parity batch 0*${BATCH}([^0-9]|$)` : `parity batch ${TAG}([^0-9]|$)`;
  return gitQuiet(['log', '--oneline', '-E', '--grep', pat]).trim();
})();

const read = readJson(READ_PATH);
const batchDoc = readJson(BATCH_PATH);
const ids = (Array.isArray(batchDoc) ? batchDoc : Object.values(batchDoc)).map((r) => r.id);
const idSet = new Set(ids);

const manifest = existsSync(p(SPECS_PATH)) ? readJson(SPECS_PATH) : [];
if (!existsSync(p(SPECS_PATH))) notes.push(`${SPECS_PATH} absent — no spec/test citations available this run.`);
const specDocs = [];
for (const m of manifest) {
  if (!m.file) { refuse(`manifest entry with no "file": ${JSON.stringify(m)}`); continue; }
  if (!existsSync(p(m.file))) { refuse(`manifest names ${m.file} (family ${m.family}) and it does not exist`); continue; }
  specDocs.push({ ...m, doc: readJson(m.file) });
}
const stagePaths = [...new Set(manifest.flatMap((m) => m.stage ?? []))];
const families = [...new Set(manifest.map((m) => m.family).filter(Boolean))];
const reportPaths = families.flatMap((f) => [`work/.b${TAG}-report-${f}.txt`, `work/.b${TAG}-verify-${f}.txt`]).filter((f) => text(f) !== null);

// ── owner questions: membership AND the desk number ──────────────────────────────────────────────
const questions = existsSync(p(QUESTIONS_PATH)) ? readJson(QUESTIONS_PATH) : { open: [], deferred: [] };
const numbering = existsSync(p(NUMBERING_PATH)) ? (readJson(NUMBERING_PATH).numbers ?? {}) : {};
/** desk n: the entry's own `n` (added by the owner-questions builder), else the permanent rulings-numbering map, else its position. */
const desk = new Map();
for (const arr of ['open', 'deferred']) {
  (questions[arr] ?? []).forEach((e, i) => {
    if (!e?.id || desk.has(e.id)) return;
    if (typeof e.n === 'number') desk.set(e.id, { n: e.n, from: 'entry.n' });
    else if (typeof numbering[e.id] === 'number') desk.set(e.id, { n: numbering[e.id], from: 'rulings-numbering.json' });
    else desk.set(e.id, { n: i + 1, from: `POSITION in ${arr}[] — no n on the entry and no rulings-numbering entry` });
  });
}

/*
 * ⚠ KNOWN DEFECT, escalated to the orchestrator by batch 035's closer rather than fixed here.
 *
 * A desk entry is keyed by QUESTION, and a question about one aspect of a record is filed as
 * `<record id>-<aspect>`: batch 035's Spider Web mechanic is desk #145 `animal-instinct-spider-web`.
 * `desk.has(<record id>)` at the OWNER-QUEUED branch below therefore misses it, and animal-instinct —
 * a record whose `#spider-web` finding is CONFIRMED, player-visible and deliberately UNBUILT while the
 * owner rules on it — falls through to the FIXED branch on its seven rowed siblings. A real gap ships
 * inside a done verdict. scripts/wg-batch-gate.mjs already carries the resolver (`RECORD_IDS` +
 * `parkMapOf` + `queuedFor`, batch 035); scripts/parity-residual-check.mjs:25/:52 and
 * scripts/held-spell-rank-check.mjs:44/:62 carry the same defect.
 *
 * NOT fixed in batch 035: the corrected derivation flips animal-instinct FIXED -> OWNER-QUEUED, which
 * this file's one-way merge refuses ("the existing verdict is not overwritten; rule it by hand"), and
 * a verdict correction is the orchestrator's `--reverdict`, not a closer's. Measured over batch 035:
 * exactly two records resolve a desk entry under the corrected rule (cultivation-order, by exact
 * match, unchanged; animal-instinct, by prefix) so the blast radius of the fix is that one verdict.
 */

/** A finding id is a record id, optionally batch-prefixed and/or '#aspect'-suffixed. Map it back. */
function rec(fid) {
  let f = String(fid).replace(/^b\d{2,3}-/, '');
  if (idSet.has(f)) return f;
  const base = f.split('#', 1)[0];
  if (idSet.has(base)) return base;
  const starts = ids.filter((i) => f.startsWith(i));
  if (starts.length) return starts.sort((a, b) => b.length - a.length)[0];
  const head = f.split('-', 1)[0];
  const byHead = ids.filter((i) => i.split('-', 1)[0] === head);
  return byHead.length === 1 ? byHead[0] : f;
}

/*
 * What a staged path GAINED in the working tree, relative to HEAD (a batch closes before it commits,
 * so the working tree IS the batch's change set). A file that merely MENTIONS a record is not evidence
 * the batch touched it: batch 29 staged src/rules/situationalBonuses.ts for five other records, and
 * every one of the ~hundreds of ids already in that registry read as a cited code edit — eleven of its
 * thirty-seven records derived FIXED where the real verdict is MATCHES (measured: unassailable-soul,
 * kinetic-durability, mysterious-resolve, natural-reflexes, battlefield-surveyor and the rest appear
 * nowhere in that commit's diff). Line-set difference, not a real diff: a moved line reads as
 * unchanged, which errs toward refusing rather than toward a false FIXED.
 */
const addedCache = new Map();
/** WHY: one spawn instead of one per path — a --root fixture tree is not a repo, so every `git show`
 *  in it fails after a slow Windows spawn and pushed the close tests past their 5 s timeout. */
const isRepo = gitQuiet(['rev-parse', '--git-dir']).trim() !== '';
function addedText(rel) {
  if (!addedCache.has(rel)) {
    const head = isRepo ? gitQuiet(['show', `HEAD:${rel}`]) : '';
    const old = new Set(head.split(/\r?\n/));
    addedCache.set(rel, (text(rel) ?? '').split(/\r?\n/).filter((l) => l.trim() && !old.has(l)).join('\n'));
  }
  return addedCache.get(rel);
}

/*
 * Evidence on disk for one finding, in three tiers of decreasing precision:
 *   `row`   — a manifest spec finding or a backfill row keyed to the record. Unambiguous FIXED.
 *   `teach` — a settle key or a report line that says the comparer was taught. MATCHES.
 *   `weak`  — the record id appears in what this batch added to a staged src/ or test/ file.
 * `teach` outranks `weak` on purpose. Batch 29 pinned EVERY instrument teach in one file,
 * test/wg-experience-lanes.test.ts, so a teach's own mutation-proof test names the record exactly the
 * way a fix's test does; ranking the test above the teach turned all eight of that batch's taught
 * records into FIXED. A row spec still wins over a teach: a batch that both authored a row and taught
 * the comparer really did change the record.
 */
function citations(fid, rid) {
  const row = new Set();
  const weak = new Set();
  const teach = new Set();
  for (const s of specDocs) {
    for (const f of s.doc.findings ?? []) {
      /* WHY: a spec entry with ZERO backfillRows authored NOTHING, so the ENTRY is not a row citation
       * — the ROWS are. Batch 30's `resilient` entry says so in its own note ("no row is authored ...
       * both comparers stopped at the items row") and still derived FIXED off "finding resilient
       * (0 row(s))". A rowless entry is a citation only when the batch made the CODE EDIT it claims
       * instead of a row: the family that authored the entry staged src/ paths and this batch really
       * changed them (batch 30's situational/engine/gap families — four FEAT_SITUATIONAL stars, the
       * ikon cap, the stance bar — all fixed in code a data row could not express). A family that
       * staged only comparers changed no behaviour, so its rowless entry is at most a TEACH: that is
       * exactly `resilient`, whose family staged wg-diff.mjs + wg-values.mjs and no src/ at all. */
      if (f.id === fid) {
        const rows = f.backfillRows ?? [];
        const codeOnly = rows.length ? [] : (s.stage ?? []).filter((path) => path.startsWith('src/') && addedText(path));
        if (rows.length) row.add(`row spec ${s.file} finding ${fid} (${rows.length} row(s))`);
        else if (codeOnly.length) row.add(`code-only spec ${s.file} finding ${fid} (0 rows; family ${s.family} changed ${codeOnly.join(', ')} in this batch)`);
        else if (TEACH_RE.test(f.note ?? '')) teach.add(`${s.file} finding ${fid} note: ${String(f.note).trim().slice(0, 160)}`);
      }
      for (const r of f.backfillRows ?? []) {
        if (r?.id === rid) row.add(`row ${r.category}/${r.id} field:${r.field} in ${s.file}`);
      }
    }
  }
  for (const path of stagePaths) {
    if (text(path) === null) continue;
    const t = addedText(path);
    if (!t) continue;
    if (/(^|\/)test\//.test(path) && (t.includes(fid) || t.includes(rid))) weak.add(`test ${path} (in what this batch added)`);
    else if (path.startsWith('src/') && t.includes(rid)) weak.add(`code ${path} (in what this batch added)`);
  }
  /* Keyed on the FINDING id, not the record: a record commonly carries an "#instrument" finding that
   * was taught beside a second finding that was fixed, and a record-wide match let the teach line
   * settle its sibling too (measured on batch 29: disciplined-mind#duplicate, quick-swim#swim-distance
   * and master-overdrive#damage-step all read as MATCHES on their #instrument sibling's line). */
  for (const path of reportPaths) {
    for (const line of (text(path) ?? '').split(/\r?\n/)) {
      if (line.includes(fid) && TEACH_RE.test(line)) teach.add(`${path}: ${line.trim().slice(0, 160)}`);
    }
  }
  for (const path of COMPARERS) {
    const t = text(path);
    if (t && (t.includes(`'${rid}'`) || t.includes(`"${rid}"`))) teach.add(`settle in ${path}`);
  }
  return { row: [...row], teach: [...teach], weak: [...weak] };
}

// ── derive ───────────────────────────────────────────────────────────────────────────────────────
const byRec = new Map();
for (const f of read.confirmed ?? []) {
  const rid = rec(f.id);
  if (!idSet.has(rid)) { refuse(`confirmed finding ${f.id} maps to no record in ${BATCH_PATH} (the closer may not settle an id outside the batch)`); continue; }
  if (!byRec.has(rid)) byRec.set(rid, []);
  byRec.get(rid).push(f);
}
const askOwnerRecs = new Set();
for (const f of read.askOwner ?? []) {
  const rid = rec(f.id);
  if (!idSet.has(rid)) refuse(`askOwner finding ${f.id} maps to no record in ${BATCH_PATH}`);
  else askOwnerRecs.add(rid);
}
for (const f of read.refuted ?? []) {
  if (!idSet.has(rec(f.id))) refuse(`refuted finding ${f.id} maps to no record in ${BATCH_PATH}`);
}

const derived = new Map(); // id -> {verdict, evidence} | null when this run cannot cite one
const uncited = [];
for (const rid of ids) {
  const findings = byRec.get(rid) ?? [];
  if (askOwnerRecs.has(rid) || desk.has(rid)) {
    if (!desk.has(rid)) { refuse(`${rid}: a read finding asks the owner but ${QUESTIONS_PATH} has no entry — OWNER-QUEUED needs the desk n`); derived.set(rid, null); continue; }
    const d = desk.get(rid);
    if (d.from.startsWith('POSITION')) notes.push(`${rid}: desk #${d.n} taken by ${d.from}`);
    derived.set(rid, { id: rid, verdict: 'OWNER-QUEUED', evidence: `WG-vs-print — Rulings Desk #${d.n} (batch ${BATCH}; n from ${d.from})` });
    continue;
  }
  if (!findings.length) {
    derived.set(rid, { id: rid, verdict: 'MATCHES', evidence: `[batch ${BATCH} read] printed text, their ops and our carriers compared by an Opus reader + adversarial verifier; no finding` });
    continue;
  }
  const cites = findings.map((f) => ({ f, ...citations(f.id, rid) }));
  const asFixed = (sel) => derived.set(rid, {
    id: rid,
    verdict: 'FIXED',
    evidence: `[batch ${BATCH} read, adversarially confirmed] ` + sel.map((c) => `${c.f.id}: ${c.f.claim.slice(0, 120)} — cited by ${[...c.row, ...c.weak].join(', ')}`).join('; '),
  });
  const rowed = cites.filter((c) => c.row.length);
  if (rowed.length) { asFixed(rowed); continue; }
  if (cites.every((c) => c.teach.length)) {
    derived.set(rid, {
      id: rid,
      verdict: 'MATCHES',
      evidence: `[batch ${BATCH} read] comparer misread settled/taught: ` + cites.map((c) => `${c.f.id} — ${c.teach[0]}`).join('; '),
    });
    continue;
  }
  const weakly = cites.filter((c) => c.weak.length);
  if (weakly.length) { asFixed(weakly); continue; }
  const uncitable = cites.filter((c) => !c.teach.length);
  derived.set(rid, null);
  uncited.push({ rid, msg: `${rid}: no row/code/test and no instrument teach cites ${uncitable.map((c) => c.f.id).join(', ')}` });
}

// ── merge: the existing file is authoritative ────────────────────────────────────────────────────
const existingParity = existsSync(p(PARITY_PATH)) ? readJson(PARITY_PATH) : null;
const existingResidual = existsSync(p(RESIDUAL_PATH)) ? readJson(RESIDUAL_PATH) : null;
const existingByIdList = new Map((existingParity?.records ?? []).map((r) => [r.id, r]));

/*
 * `--reverdict id=VERDICT --reason "..."` — the ONE door through the one-way merge.
 *
 * WHY it exists: a written verdict is never overwritten by a derivation, so when the WRITTEN one is
 * the wrong one there is no way back through the script. Batch 30's `resilient` was written FIXED off
 * a rowless spec entry; fixing the derivation only turns that into a "verdict changed" refusal, since
 * the script (correctly) will not decide by itself which of the two to believe. So the correction is
 * hand-held and leaves a trail: it names the record, the new verdict and a REASON (refused without
 * one), stamps the reason into the evidence, and lands in `residual.reverdicts` so the diff shows it.
 */
const VERDICTS = ['MATCHES', 'FIXED', 'OWNER-RULED', 'OWNER-QUEUED', 'THEY-ENCODE-NOTHING-USEFUL'];
const reasons = args('--reason');
const reverdicts = new Map();
args('--reverdict').forEach((spec, i) => {
  const at = spec.indexOf('=');
  const rid = at > 0 ? spec.slice(0, at) : '';
  const verdict = at > 0 ? spec.slice(at + 1).toUpperCase() : '';
  const reason = (reasons[i] ?? '').trim();
  if (!rid || !verdict) return refuse(`--reverdict "${spec}" is not id=VERDICT`);
  if (!VERDICTS.includes(verdict)) return refuse(`--reverdict ${rid}: "${verdict}" is not one of ${VERDICTS.join(', ')}`);
  if (!reason) return refuse(`--reverdict ${rid}=${verdict} has no --reason; a verdict rewritten without a stated reason is indistinguishable from a bug`);
  if (!idSet.has(rid)) return refuse(`--reverdict ${rid}: no such record in ${BATCH_PATH}`);
  if (!existingByIdList.has(rid)) return refuse(`--reverdict ${rid}: no verdict written yet — --reverdict CORRECTS a written verdict, it does not author one`);
  reverdicts.set(rid, { verdict, reason });
});

const reverdicted = [];
const records = [...(existingParity?.records ?? [])];
let kept = 0, added = 0;
for (const rid of ids) {
  const d = derived.get(rid);
  const old = existingByIdList.get(rid);
  if (old) {
    kept++;
    const rv = reverdicts.get(rid);
    if (rv) {
      const stamp = `[orchestrator ruling: ${rv.reason}]`;
      reverdicted.push({ id: rid, from: old.verdict, to: rv.verdict, derived: d?.verdict ?? null, reason: rv.reason });
      old.verdict = rv.verdict;
      if (!String(old.evidence ?? '').includes(stamp)) old.evidence = `${old.evidence ?? ''} ${stamp}`.trim();
      notes.push(`${rid}: REVERDICT ${reverdicted.at(-1).from} -> ${rv.verdict} (derived this run: ${d?.verdict ?? 'uncited'}) — ${rv.reason}`);
      continue;
    }
    if (d && d.verdict !== old.verdict) {
      // With no manifest this run has no rows to cite, so a derived MATCHES is an absence of evidence,
      // not a disagreement — the plan-E replay of a closed batch runs exactly that way. Say so and keep
      // the existing verdict; with a manifest present, a changed verdict is a hard stop.
      const m = `${rid}: verdict changed — existing "${old.verdict}" vs derived "${d.verdict}".`;
      if (manifest.length) refuse(`${m} The existing verdict is not overwritten; rule it by hand.`);
      else notes.push(`${m} No manifest this run, so the derivation cannot cite rows; existing kept.`);
    }
    continue;
  }
  if (!d) continue; // its uncited-refusal is already recorded below
  records.push(d);
  added++;
}
for (const u of uncited) {
  if (existingByIdList.has(u.rid)) notes.push(`kept the existing verdict; this run could not cite it — ${u.msg}`);
  else refuse(`uncited NEW verdict — ${u.msg}`);
}

// ── residual ─────────────────────────────────────────────────────────────────────────────────────
const gaps = existsSync(p(GAPS_PATH)) ? readJson(GAPS_PATH) : [];
const parked = gaps.filter((g) => g.status === 'parked');
const openGaps = gaps.filter((g) => g.status === 'open');
if (openGaps.length) refuse(`${openGaps.length} gap line(s) still "open" in ${GAPS_PATH}: ${openGaps.map((g) => `${g.family}/${(g.ref ?? g.line ?? '').slice(0, 60)}`).join(' | ')}`);

const trim = (s, n) => String(s ?? '').slice(0, n);
const derivedResidual = {
  batch: BATCH_PATH,
  examined: ids.length,
  method: `Opus readers (print + WG raw ops + every carrier) each followed by an adversarial verifier; findings applied by ${manifest.length} family spec(s), verdicts derived by scripts/wg-batch-close.mjs from the cited rows, edits, tests and teaches`,
  confirmed: (read.confirmed ?? []).map((f) => ({ id: rec(f.id), finding: f.id, severity: f.playerVisible ? 'player-visible' : 'internal', summary: trim(f.claim, 240), fixed: true })),
  refuted: (read.refuted ?? []).map((f) => ({ id: rec(f.id), finding: f.id, summary: trim(f.claim, 200), evidence: trim(f.evidence, 300) })),
  flaggedResidues: parked.map((g) => ({ id: g.ref ?? g.family, finding: g.ref ?? `${g.family} gap`, severity: 'internal', summary: trim(g.line, 600), fixed: false, family: g.family, kind: g.kind })),
  rejected: (read.refuted ?? []).length,
  askOwner: (read.askOwner ?? []).map((f) => ({ id: rec(f.id), desk: desk.get(rec(f.id))?.n ?? null, summary: trim(f.claim, 200) })),
  complete: true,
};
/* WHY only when non-empty: an always-present `reverdicts: []` would rewrite every batch's residual,
 * and the plan-E acceptance is that re-closing a closed batch is a byte-identical no-op. */
if (reverdicted.length) derivedResidual.reverdicts = reverdicted;
for (const a of derivedResidual.askOwner) if (a.desk === null) refuse(`askOwner row ${a.id} has no desk number in ${QUESTIONS_PATH} / ${NUMBERING_PATH}`);

/** Merge an array by key: existing entries keep their place and their content, new ones are appended. */
function mergeArray(existing, fresh, keyOf) {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map(keyOf));
  let n = 0;
  for (const e of fresh ?? []) if (!seen.has(keyOf(e))) { out.push(e); seen.add(keyOf(e)); n++; }
  return { out, added: n };
}
const pairKey = (e) => `${e.id}|${e.finding ?? ''}`;
const residual = { ...derivedResidual };
if (existingResidual) {
  for (const k of ['batch', 'examined', 'method', 'rejected', 'complete']) {
    if (k in existingResidual) {
      if (JSON.stringify(existingResidual[k]) !== JSON.stringify(derivedResidual[k])) notes.push(`residual.${k}: keeping existing ${JSON.stringify(existingResidual[k])} (derived ${JSON.stringify(derivedResidual[k])})`);
      residual[k] = existingResidual[k];
    }
  }
  const mergeKeys = [['confirmed', pairKey], ['refuted', pairKey], ['flaggedResidues', pairKey], ['askOwner', (e) => e.id]];
  /* WHY the `existing` half: a later close of the same batch passes no --reverdict, so without this the
   * merge would silently DROP the ruling log a previous run wrote — the one thing the residual keeps. */
  if (derivedResidual.reverdicts || existingResidual.reverdicts) mergeKeys.push(['reverdicts', (e) => `${e.id}|${e.to}`]);
  for (const [k, keyOf] of mergeKeys) {
    const m = mergeArray(existingResidual[k], derivedResidual[k], keyOf);
    residual[k] = m.out;
    if (m.added) notes.push(`residual.${k}: ${m.added} new entr(y/ies) appended, ${(existingResidual[k] ?? []).length} kept`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
const counts = records.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
console.log(`batch ${TAG}: ${ids.length} record(s), ${(read.confirmed ?? []).length} confirmed / ${(read.refuted ?? []).length} refuted / ${(read.askOwner ?? []).length} askOwner findings`);
console.log(`manifest: ${manifest.length} spec(s), ${stagePaths.length} staged path(s), reports: ${reportPaths.length}`);
console.log(`verdicts: ${JSON.stringify(counts)}  (kept ${kept}, added ${added})`);
console.log(`residual: confirmed ${residual.confirmed.length}, refuted ${residual.refuted.length}, flaggedResidues ${residual.flaggedResidues.length}, askOwner ${residual.askOwner.length}`);
for (const n of notes) console.log(`  note: ${n}`);

if (committed) {
  const line = `batch ${TAG} is already committed (${committed.split('\n')[0]})`;
  if (WRITE) { refuse(`${line} — --write refuses: a closed batch's artefacts are history.`); }
  else console.log(`  note: ${line}; --write would refuse.`);
}

if (refusals.length) {
  console.error(`\nREFUSED (${refusals.length}), nothing written:`);
  for (const r of refusals) console.error(`  - ${r}`);
  process.exit(1);
}

/** Match the file's own line endings so a re-close is a no-op diff, not a whole-file rewrite. */
const emit = (rel, obj, prior) => {
  let s = JSON.stringify(obj, null, 1);
  if (prior && prior.includes('\r\n')) s = s.replace(/\n/g, '\r\n');
  writeFileSync(p(rel), s);
  return s;
};
const priorParity = text(PARITY_PATH);
const priorResidual = text(RESIDUAL_PATH);
if (!WRITE) {
  const wouldParity = JSON.stringify({ batch: BATCH, records }, null, 1);
  const wouldResidual = JSON.stringify(residual, null, 1);
  const same = (prior, next) => prior !== null && (prior.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next) === prior;
  console.log(`\n(dry run — pass --write)`);
  console.log(`  ${PARITY_PATH}: ${priorParity === null ? 'would be created' : same(priorParity, wouldParity) ? 'byte-identical, no change' : 'would change'}`);
  console.log(`  ${RESIDUAL_PATH}: ${priorResidual === null ? 'would be created' : same(priorResidual, wouldResidual) ? 'byte-identical, no change' : 'would change'}`);
  process.exit(0);
}
emit(PARITY_PATH, { batch: BATCH, records }, priorParity);
emit(RESIDUAL_PATH, residual, priorResidual);
console.log(`\nwritten ${PARITY_PATH} + ${RESIDUAL_PATH}`);
