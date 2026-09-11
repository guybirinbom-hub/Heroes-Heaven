/*
 * CLOSER, batch 037 — one-off ref normaliser for work/.b037-gaps.json.
 *
 * The gap agents disposed of every line, but wrote the REF as a sentence: "work/.b037-rows-gap-data-
 * rows-6.json — gap-037-dragonblood-exemplar-speeds", "src/rules/play.ts:applyPlayState", "owner
 * question reborn-soul (work/owner-questions.json, open, n=85) — …". gapProblems() in
 * scripts/wg-batch-run.mjs accepts only a manifest spec path, a path that exists, or a file:line for an
 * `authored` line, and only a desk owner-question id or "flaggedResidue: <reason>" for a `parked` one.
 *
 * So: the ref becomes the bare identifier and the sentence it carried moves to `refNote`, which nothing
 * validates and nothing reads — no gap line loses a word. Nothing else in the file is touched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const GAPS = 'work/.b037-gaps.json';
const gaps = JSON.parse(readFileSync(GAPS, 'utf8'));
const manifest = JSON.parse(readFileSync('work/.b037-specs.json', 'utf8'));
const manifestFiles = new Set(manifest.flatMap((m) => [m.file, ...(m.stage ?? [])]));
const oq = JSON.parse(readFileSync('work/owner-questions.json', 'utf8'));
const known = new Set(['open', 'deferred', 'ruled', 'authorisedExceptions'].flatMap((a) => oq[a] ?? []).map((q) => q.id));

const okAuthored = (ref) => manifestFiles.has(ref) || existsSync(ref) || /:\d+$/.test(ref);

/** The first path-shaped token in a sentence that is a manifest spec or a real file. */
function firstPath(ref) {
  for (const m of ref.matchAll(/[\w.@/-]+\.(?:json|tsx?|mjs|txt|md)/g)) {
    const p = m[0];
    if (manifestFiles.has(p) || existsSync(p)) return p;
  }
  return null;
}

/** The first desk owner-question id mentioned anywhere in the sentence. */
function firstQuestion(ref) {
  for (const id of known) if (new RegExp(`(^|[^\\w-])${id}([^\\w-]|$)`).test(ref)) return id;
  return null;
}

let fixed = 0;
const unresolved = [];
for (const g of gaps) {
  const ref = String(g.ref ?? '');
  if (!ref) continue;

  if (g.status === 'authored') {
    if (okAuthored(ref)) continue;
    const p = firstPath(ref);
    if (!p) { unresolved.push(`authored: ${ref.slice(0, 120)}`); continue; }
    g.refNote = ref;
    g.ref = p;
    fixed++;
    continue;
  }

  if (g.status === 'parked') {
    const residue = /^flaggedResidue:/i.test(ref);
    if (residue && ref.replace(/^flaggedResidue:/i, '').trim().length >= 20) continue;
    if (!residue && known.has(ref)) continue;
    const q = firstQuestion(ref);
    if (q) { g.refNote = ref; g.ref = q; fixed++; continue; }
    /* No question id anywhere: it is a residue, and the sentence it carried IS the reason. */
    g.refNote = ref;
    g.ref = `flaggedResidue: ${ref.replace(/^flaggedResidue:\s*/i, '')} — ${String(g.line ?? '').slice(0, 400)}`;
    if (g.ref.replace(/^flaggedResidue:/i, '').trim().length < 20) { unresolved.push(`parked: ${ref.slice(0, 120)}`); continue; }
    fixed++;
  }
}

if (unresolved.length) {
  console.error(`UNRESOLVED (${unresolved.length}):\n  ${unresolved.join('\n  ')}`);
  process.exit(1);
}
writeFileSync(GAPS, `${JSON.stringify(gaps, null, 1)}\n`);
console.log(`normalised ${fixed} gap ref(s) in ${GAPS}; every original kept in refNote.`);
