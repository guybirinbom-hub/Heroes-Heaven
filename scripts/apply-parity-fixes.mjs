/*
 * Apply a batch of verified parity fix specs — overlay rows and code edits — with every precondition
 * checked BEFORE anything touches disk.
 *
 * The specs come from the parity workflow: each finding was produced by one agent and adversarially
 * verified by a second, and only survivors reach here. What this adds is the part no agent can do
 * safely — writing to SHARED files, one at a time, refusing anything ambiguous.
 *
 * WHY IT REFUSES SO MUCH. Every failure mode below has actually happened in this project:
 *
 *   · A code edit whose `find` is not unique replaces the wrong occurrence, or silently the first of
 *     several. Both are invisible in a diff nobody reads line by line. A `find` that does not appear
 *     EXACTLY ONCE is refused, never "best effort" applied.
 *   · An overlay row for a record that does not exist is authored data reaching nothing — the exact
 *     failure this project keeps finding late. Refused unless the row carries `create: true`.
 *   · Two fixes writing the same overlay field is a collision, not a merge. Reported, not resolved.
 *   · Nothing is written until every check on every item passes, so a bad spec in position 40 cannot
 *     leave the first 39 applied and the tree half-changed.
 *
 * `value: null` legitimately REMOVES a field and is allowed — it is the documented overlay idiom.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SIX REFUSALS BELOW ARE `docs/wg-batch-pipeline.md` §A `apply`, MOVED DOWN HERE.
 *
 * The spec puts them in the driver: "Pre-checks over the WHOLE manifest before writing anything:
 * … (2) any row whose key already exists in the overlay must carry `supersedes: true`, and the
 * old→new pair is written into the digest; (3) refuse a pathless whole-value row on a category/id/
 * field that already has `path:[…,'id=…']` rows beneath it (or vice versa) — the magus case;
 * (4) refuse a description / descRefs row with a `path`; (5) refuse a `why` that names no AoN doc
 * id, and for a description row refuse unless the restored tokens occur in that mirror doc … the
 * applier treats an edit whose `find` is gone and `replace` present as already applied
 * (resume-safe)."
 *
 * A guard that only lives in the driver is not a guard: batch 29 was applied by HAND, spec by spec,
 * and every mistake that session came from a hand step. Putting the refusals in the applier means
 * they hold for `node scripts/apply-parity-fixes.mjs <spec> --write` typed at a prompt as well as
 * for `wg-batch-run.mjs --stage apply`. The driver may still run them first; running them twice
 * costs nothing.
 *
 *   1. supersedes — a row whose category/id/path/field key already sits in the overlay is refused
 *      unless it says `supersedes: true`; the old→new pair is printed either way.
 *   2. the magus shape — a pathless whole-value row is refused when `path:[…,'id=…']` rows already
 *      amend that field (the whole value would silently swallow them), and a path row is refused
 *      when nothing it can amend exists at that path.
 *   3. a `description` / `descRefs` row with a non-empty path is refused: prose is not nested, the
 *      row would resolve to a sub-object and vanish.
 *   4. every `why` must name an AoN doc id (`equipment-2827`, `class-feature-431`, `deity-701`) —
 *      a fix with no citable source is a fix nobody can re-check. A `description` row must also
 *      prove itself: every run of 3+ words it ADDS relative to the shipped prose has to occur in
 *      that mirror doc. Authored prose that is not in the Archives is how invented rules ship.
 *      A record with genuinely no Archives page says so with the literal phrase "no AoN document".
 *   5. an edit whose `find` is gone and whose `replace` is present exactly once is already applied —
 *      reported and skipped, not a failed precondition. A half-applied batch must be resumable.
 *   6. `--expect-rows N` — after the write the overlay must hold exactly N rows or the whole write
 *      is rolled back byte-for-byte. The 10% shrink guard in write-backfill.mjs still applies.
 *
 *   node scripts/apply-parity-fixes.mjs <specs.json>            # dry run: every check, nothing written
 *   node scripts/apply-parity-fixes.mjs <specs.json> --write
 *   node scripts/apply-parity-fixes.mjs <specs.json> --write --expect-rows 13985
 *
 * The specs file is an array of findings, or { applicable: [...] }.
 * PARITY_ROOT / AON_MIRROR relocate the repo root and the Archives mirror — the refusal tests point
 * them at fixtures so no test ever reads or writes the real overlay.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill, BACKFILL_PATH } from './lib/write-backfill.mjs';

const ROOT = process.env.PARITY_ROOT
  ? resolve(process.env.PARITY_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = process.env.AON_MIRROR || 'C:/wonderers guide/aon-2e-archive/data/by-category';
const WRITE = process.argv.includes('--write');
const expectAt = process.argv.indexOf('--expect-rows');
const EXPECT_ROWS = expectAt > 0 ? Number(process.argv[expectAt + 1]) : null;
if (expectAt > 0 && !Number.isInteger(EXPECT_ROWS)) {
  console.error('usage: --expect-rows <integer>');
  process.exit(2);
}
const specPath = process.argv[2];
if (!specPath || specPath.startsWith('--')) {
  console.error('usage: node scripts/apply-parity-fixes.mjs <specs.json> [--write] [--expect-rows N]');
  process.exit(2);
}

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''));
const raw = JSON.parse(readFileSync(specPath, 'utf8'));
const findings = Array.isArray(raw) ? raw : (raw.applicable ?? raw.findings ?? []);
const core = readJson('public/core.json');
/* Prose moved out of core.json in the split — a description row's "before" lives here, not there. */
const descs = existsSync(join(ROOT, 'public/core-descriptions.json')) ? readJson('public/core-descriptions.json') : {};
const overlay = readBackfill(ROOT);

/* A verifier may have supplied corrected rows/edits; those win over the finder's originals. */
const rowsOf = (f) => (f.verification?.correctedBackfillRows?.length ? f.verification.correctedBackfillRows : f.backfillRows) ?? [];
const editsOf = (f) => (f.verification?.correctedCodeEdits?.length ? f.verification.correctedCodeEdits : f.codeEdits) ?? [];

const problems = [];
const plannedRows = [];
const plannedEdits = [];
const alreadyApplied = [];
const supersessions = [];
const fileCache = new Map();
const readOnce = (rel) => {
  if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(join(ROOT, rel), 'utf8'));
  return fileCache.get(rel);
};

/* ---------- the overlay index (refusals 1 and 2) ---------- */
const rowKey = (r) => `${r.category}/${r.id}/${r.path?.length ? r.path.join('.') + '.' : ''}${r.field ?? '(create)'}`;
const overlayByKey = new Map();
/** category/id/<field the path descends into> → the first overlay path row with an `id=` step. */
const overlayIdPaths = new Map();
overlay.forEach((r, i) => {
  overlayByKey.set(rowKey(r), { row: r, index: i });
  if (r.path?.length && r.path.some((s) => String(s).startsWith('id='))) {
    const k = `${r.category}/${r.id}/${r.path[0]}`;
    if (!overlayIdPaths.has(k)) overlayIdPaths.set(k, { row: r, index: i });
  }
});

/* ---------- the AoN citation (refusal 4) ---------- */
const mirrorCats = existsSync(MIRROR) ? readdirSync(MIRROR).filter((d) => !d.startsWith('_')) : [];
/* Built from the mirror's own directory names so `batch-29` or `pf2e-2` cannot pass as a doc id.
 * Longest first: `class-feature-431` must not match as category `class`. */
const docIdRe = mirrorCats.length
  ? new RegExp(`\\b(${[...mirrorCats].sort((a, b) => b.length - a.length).join('|')})-(\\d+(?:-\\d+)*)\\b`, 'g')
  : /\b([a-z][a-z]*(?:-[a-z]+)*)-(\d+(?:-\d+)*)\b/g;
const docIdsIn = (why) => [...String(why ?? '').matchAll(docIdRe)].map((m) => m[0]);

const mirrorCache = new Map();
function mirrorText(docId) {
  if (mirrorCache.has(docId)) return mirrorCache.get(docId);
  let text = null;
  for (const cat of mirrorCats) {
    const p = join(MIRROR, cat, `${docId}.json`);
    if (!existsSync(p)) continue;
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    text = `${doc.text ?? ''} ${doc.markdown ?? ''}`;
    break;
  }
  mirrorCache.set(docId, text);
  return text;
}

const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * The runs of words `after` adds to `before`, as token arrays.
 *
 * Common prefix and suffix are trimmed first — these rows are repairs, so the differing middle is
 * usually a handful of words — and only the remainder goes through the LCS.
 * ponytail: a remainder above ~4M cells is reported as ONE added run rather than diffed. That is the
 * refusing direction (a long run is harder to find in the mirror, not easier); raise the cap if a
 * real row ever trips it.
 */
function addedRuns(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const ar = a.slice(p, a.length - s);
  const br = b.slice(p, b.length - s);
  if (!br.length) return [];
  if (!ar.length || ar.length * br.length > 4_000_000) return [br];

  const w = br.length + 1;
  const table = new Int32Array((ar.length + 1) * w);
  for (let i = ar.length - 1; i >= 0; i--) {
    for (let j = br.length - 1; j >= 0; j--) {
      table[i * w + j] = ar[i] === br[j]
        ? table[(i + 1) * w + j + 1] + 1
        : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const runs = [];
  let cur = [];
  let i = 0;
  let j = 0;
  while (i < ar.length && j < br.length) {
    if (ar[i] === br[j]) {
      if (cur.length) { runs.push(cur); cur = []; }
      i++; j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) i++;
    else cur.push(br[j++]);
  }
  while (j < br.length) cur.push(br[j++]);
  if (cur.length) runs.push(cur);
  return runs;
}

/** null when every 3+ word run the row adds is in one of the named docs; otherwise the complaint. */
function unbackedRun(row, docIds) {
  const before = descs[row.category]?.[row.id]?.d ?? core[row.category]?.[row.id]?.description ?? '';
  const runs = addedRuns(before, row.value).filter((r) => r.length >= 3);
  if (!runs.length) return null;
  const haystacks = docIds
    .map((d) => ({ d, text: mirrorText(d) }))
    .filter((h) => h.text != null)
    .map((h) => ({ d: h.d, hay: ` ${tokens(h.text).join(' ')} ` }));
  if (!haystacks.length) return `names ${docIds.join(', ')}, which is not in the mirror`;
  for (const run of runs) {
    const needle = ` ${run.join(' ')} `;
    if (!haystacks.some((h) => h.hay.includes(needle))) {
      return `adds ${run.length} words no named doc (${docIds.join(', ')}) prints: "${run.join(' ').slice(0, 90)}"`;
    }
  }
  return null;
}

/* ---------- resolve a path against the shipped record (refusal 2) ---------- */
/** The step that failed, or null when the whole path resolves. Mirrors lib/apply-backfill backfillTarget. */
function firstUnresolvedStep(record, path) {
  let node = record;
  for (const step of path) {
    if (node == null) return step;
    if (Array.isArray(node)) {
      const [k, v] = String(step).split('=');
      node = k === 'id' ? node.find((x) => x?.id === v) : null;
    } else node = node[step];
    if (node == null) return step;
  }
  return typeof node === 'object' ? null : path[path.length - 1];
}

/* ---------- check everything first ---------- */
for (const f of findings) {
  for (const row of rowsOf(f)) {
    if (!row || !row.category || !row.id) { problems.push(`${f.id}: an overlay row is missing category/id`); continue; }
    const where = `${row.category}/${row.id}`;
    if (!core[row.category]?.[row.id] && !row.create) {
      problems.push(`${f.id}: row targets ${where}, which does not exist and has no create:true — it would reach nothing`);
      continue;
    }
    if (!row.create && !row.field) { problems.push(`${f.id}: row for ${where} has no field and no create:true`); continue; }

    /* 3 — prose is never nested. */
    if ((row.field === 'description' || row.field === 'descRefs') && row.path?.length) {
      problems.push(`${f.id}: ${where}.${row.field} carries path [${row.path.join(', ')}] — prose rows must be pathless or they resolve to a sub-object and reach nothing`);
      continue;
    }

    /* 2 — the magus shape, both directions. */
    if (!row.path?.length && row.field) {
      const shadowed = overlayIdPaths.get(`${where}/${row.field}`);
      if (shadowed) {
        problems.push(
          `${f.id}: whole-value row ${where}.${row.field} would swallow overlay row #${shadowed.index} ` +
            `(path [${shadowed.row.path.join(', ')}] field ${shadowed.row.field}) — amend the path row, or restate its value inside this one and say so`,
        );
        continue;
      }
    }
    if (row.path?.length) {
      const bad = firstUnresolvedStep(core[row.category]?.[row.id], row.path);
      const builtHere = rowsOf(f).some(
        (r) => r !== row && !r.path?.length && r.category === row.category && r.id === row.id && (r.create || r.field === row.path[0]),
      );
      if (bad && !builtHere) {
        problems.push(
          `${f.id}: path row ${where}.${row.field} does not resolve — step "${bad}" of [${row.path.join(', ')}] is absent from the shipped record, ` +
            `and no whole-value row for "${row.path[0]}" (or create:true) in this spec builds it`,
        );
        continue;
      }
    }

    /* 4 — a fix nobody can re-check. */
    const docIds = docIdsIn(row.why);
    const excused = /no AoN document/i.test(String(row.why ?? ''));
    if (!docIds.length && !excused) {
      problems.push(
        `${f.id}: row ${where}.${row.field ?? '(create)'} has a \`why\` naming no AoN doc id ` +
          '(e.g. equipment-2827, class-feature-431) — say "no AoN document" if the record genuinely has no Archives page',
      );
      continue;
    }
    if (row.field === 'description' && typeof row.value === 'string' && docIds.length) {
      if (!mirrorCats.length) {
        console.log(`   note  ${f.id}: the AoN mirror is not present — the added-prose check on ${where} was skipped.`);
      } else {
        const complaint = unbackedRun(row, docIds);
        if (complaint) { problems.push(`${f.id}: description row ${where} ${complaint}`); continue; }
      }
    }

    /* 1 — an existing key needs an explicit supersedes. */
    const prior = overlayByKey.get(rowKey(row));
    if (prior) {
      const oldV = JSON.stringify(prior.row.value ?? null);
      const newV = JSON.stringify(row.value ?? null);
      /* RESUME, mirroring pre-check (2) in scripts/wg-batch-run.mjs: a stage that refused AFTER writing
       * (batch 031's apply, on the create-row post-check) leaves this spec's OWN rows in the overlay, and
       * re-running then read every one of them as an undeclared supersession. Nothing is overwritten when
       * the row on disk is byte-identical to the one proposed. `supersedes` is spec metadata stripped
       * before storing, so it is off both sides of the comparison. */
      const { supersedes: _onDisk, ...stored } = prior.row;
      const { supersedes: _proposed, ...incoming } = row;
      const identical = JSON.stringify(stored) === JSON.stringify(incoming);
      if (!row.supersedes && !identical) {
        problems.push(
          `${f.id}: ${rowKey(row)} already sits in the overlay at row #${prior.index} — add supersedes:true if replacing it is intended.\n` +
            `        old: ${oldV.slice(0, 160)}\n        new: ${newV.slice(0, 160)}`,
        );
        continue;
      }
      if (row.supersedes) supersessions.push(`${rowKey(row)} (overlay #${prior.index})\n        old: ${oldV.slice(0, 160)}\n        new: ${newV.slice(0, 160)}`);
      else alreadyApplied.push(`${f.id}: ${rowKey(row)} is already in the overlay byte-identical (resume)`);
    } else if (row.supersedes) {
      problems.push(`${f.id}: ${rowKey(row)} declares supersedes:true but no overlay row holds that key — drop the flag or fix the key`);
      continue;
    }

    plannedRows.push({ from: f.id, row });
  }

  for (const e of editsOf(f)) {
    if (!e?.file || typeof e.find !== 'string' || typeof e.replace !== 'string') {
      problems.push(`${f.id}: a code edit is missing file/find/replace`);
      continue;
    }
    let src;
    try { src = readOnce(e.file); } catch { problems.push(`${f.id}: cannot read ${e.file}`); continue; }
    if (e.find === e.replace) { problems.push(`${f.id}: edit to ${e.file} is a no-op`); continue; }
    const n = src.split(e.find).length - 1;
    /* 5 — resume-safe: re-running a half-applied batch must not fail on the edits that landed. */
    if (n === 0 && e.replace && src.split(e.replace).length - 1 === 1) {
      alreadyApplied.push(`${f.id}: ${e.file} — \`find\` gone, \`replace\` present once; already applied, skipping`);
      continue;
    }
    if (n !== 1) {
      problems.push(`${f.id}: \`find\` occurs ${n}x in ${e.file} (must be exactly 1) — ${JSON.stringify(e.find.slice(0, 70))}`);
      continue;
    }
    plannedEdits.push({ from: f.id, ...e });
  }
}

const seen = new Map();
for (const { from, row } of plannedRows) {
  // The collision key carries the row's `path` (the overlay applier honours it — scripts/lib/apply-backfill.mjs
  // backfillTarget): eight batch-29 rows each set `spellSlotBonus` on a DIFFERENT magus subclass option via
  // path ["subclass","options","id=…"] and were refused as one collision when the key ignored the path.
  const key = rowKey(row);
  if (seen.has(key)) problems.push(`${from} and ${seen.get(key)} both write ${key} — resolve by hand`);
  else seen.set(key, from);
}

const byFile = {};
for (const e of plannedEdits) (byFile[e.file] ??= []).push(e);

console.log(`${findings.length} finding(s): ${plannedRows.length} overlay row(s), ${plannedEdits.length} code edit(s) across ${Object.keys(byFile).length} file(s).\n`);
for (const { from, row } of plannedRows) {
  console.log(`   row   ${String(from).padEnd(34)} ${row.category}/${row.id}.${row.field ?? '(create)'} = ${JSON.stringify(row.value).slice(0, 84)}`);
}
for (const e of plannedEdits) console.log(`   edit  ${String(e.from).padEnd(34)} ${e.file}: ${JSON.stringify(e.find.slice(0, 56))}`);
for (const a of alreadyApplied) console.log(`   skip  ${a}`);
if (supersessions.length) {
  console.log(`\n${supersessions.length} declared supersession(s):`);
  for (const s of supersessions) console.log(`   ${s}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — NOTHING was written:\n`);
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}
console.log('\nall preconditions pass.');
if (!WRITE) { console.log('(dry run — pass --write)'); process.exit(0); }

/* ---------- write ---------- */
if (plannedRows.length) {
  /* 6 — the rollback copy. Raw bytes, so restoring cannot be blocked by write-backfill's shrink guard. */
  const overlayFile = join(ROOT, BACKFILL_PATH);
  const before = readFileSync(overlayFile);
  const all = readBackfill(ROOT);
  const priorCount = all.length;
  let added = 0;
  let replaced = 0;
  for (const { row } of plannedRows) {
    const { supersedes: _s, ...stored } = row; // spec metadata, not overlay data
    // Path-aware, like the collision key above: eight rows setting the same field on different magus
    // subclass options (path ["subclass","options","id=…"]) used to REPLACE each other here, leaving one.
    const samePath = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
    const at = all.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field && samePath(r.path, row.path));
    if (at >= 0) { all[at] = stored; replaced++; } else { all.push(stored); added++; }
  }
  writeBackfill(ROOT, all); // the 10% shrink guard still applies — never pass allowShrink here
  const onDisk = readBackfill(ROOT).length;
  if (EXPECT_ROWS !== null && onDisk !== EXPECT_ROWS) {
    writeFileSync(overlayFile, before);
    console.error(`\n--expect-rows ${EXPECT_ROWS} but the overlay holds ${onDisk} after the write — ROLLED BACK to ${priorCount} rows, no code edit ran.`);
    console.error(`   (this spec was ${added} new + ${replaced} replaced)`);
    process.exit(1);
  }
  console.log(`overlay: ${added} new, ${replaced} replaced (${onDisk} rows).`);
} else if (EXPECT_ROWS !== null && overlay.length !== EXPECT_ROWS) {
  console.error(`\n--expect-rows ${EXPECT_ROWS} but the overlay holds ${overlay.length} and this spec writes no rows.`);
  process.exit(1);
}

for (const [file, edits] of Object.entries(byFile)) {
  let src = readFileSync(join(ROOT, file), 'utf8');
  for (const e of edits) {
    /* Re-checked per edit: an earlier edit to the SAME file can change or duplicate a later `find`. */
    const n = src.split(e.find).length - 1;
    if (n === 0 && src.split(e.replace).length - 1 === 1) {
      console.log(`${file}: ${e.from} already applied by an earlier edit in this run, skipping.`);
      continue;
    }
    if (n !== 1) {
      console.error(`\n${file}: \`find\` for ${e.from} now occurs ${n}x (an earlier edit in this file changed it). STOPPING.`);
      console.error('   Overlay rows above ARE written; re-run the remaining edits after re-reading the file.');
      process.exit(1);
    }
    src = src.replace(e.find, e.replace);
  }
  writeFileSync(join(ROOT, file), src);
  console.log(`${file}: ${edits.length} edit(s) applied.`);
}
console.log('\nNext: node scripts/apply-backfill-now.mjs && npx tsc -b && node scripts/vt.mjs run && npm run verify');
