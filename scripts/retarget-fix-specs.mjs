/*
 * Re-aim fix specs whose `find` no longer matches the file byte-for-byte.
 *
 * The specs were written by agents reading the tree as it stood before a revert-and-restore cycle.
 * The restored files are the same CODE with different FORMATTING — a registry entry that read
 * `{"skillChoices":[{"options":[...]}]}` now reads `{ "skillChoices": [{ "options": [...] }] }`. The
 * applier refuses those specs, correctly: a `find` that does not appear exactly once must never be
 * applied approximately.
 *
 * So rather than loosen the applier, this repairs the SPECS: a single-line `find` is matched against
 * the file ignoring whitespace, and when exactly ONE line matches, the spec's `find` is rewritten to
 * that line's exact text. Everything else is left alone and reported, to be fixed by hand.
 *
 * ⚠ SINGLE-LINE ONLY, and ⚠ UNIQUE ONLY. A multi-line `find` would need offset mapping back through
 * the normalisation, and a whitespace-insensitive match that hits twice is ambiguous — both are cases
 * where guessing would put a real edit in the wrong place, which is the failure the applier's
 * uniqueness rule exists to prevent.
 *
 *   node scripts/retarget-fix-specs.mjs <specs.json> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const specPath = process.argv[2];
if (!specPath || specPath.startsWith('--')) { console.error('usage: node scripts/retarget-fix-specs.mjs <specs.json> [--write]'); process.exit(2); }

const specs = JSON.parse(readFileSync(specPath, 'utf8'));
/* ALL whitespace removed, not merely collapsed. The formatting difference here is spaces AFTER commas
 * and colons — `{'weapons':[…]}` vs `{ 'weapons': [ … ] }` — which collapsing runs does not touch, so a
 * run-collapsing compare found zero matches on every one of them. Safe because the caller still
 * requires the match to be UNIQUE within the file. */
const norm = (s) => s.replace(/\s+/g, '');
const cache = new Map();
const linesOf = (rel) => {
  if (!cache.has(rel)) cache.set(rel, readFileSync(join(ROOT, rel), 'utf8').split('\n'));
  return cache.get(rel);
};

let fixed = 0;
const stuck = [];
for (const f of specs) {
  const edits = f.verification?.correctedCodeEdits?.length ? f.verification.correctedCodeEdits : f.codeEdits;
  for (const e of edits ?? []) {
    let src;
    try { src = readFileSync(join(ROOT, e.file), 'utf8'); } catch { stuck.push(`${f.id}: cannot read ${e.file}`); continue; }
    const n = src.split(e.find).length - 1;
    if (n === 1) continue; // already exact

    /*
     * ⚠ LINE ENDINGS FIRST. Most files in this repo are CRLF and every agent-written `find` uses bare
     * \n, so a multi-line find matches ZERO times on text that is otherwise character-identical —
     * which reads as "the code changed" when nothing changed at all. Converting the find's newlines to
     * the file's is exact, not fuzzy: if the CRLF form matches once, that IS the text.
     */
    if (e.find.includes('\n') && !e.find.includes('\r\n')) {
      const crlf = e.find.replace(/\n/g, '\r\n');
      if (src.split(crlf).length - 1 === 1) { e.find = crlf; e.replace = e.replace.replace(/\n/g, '\r\n'); fixed++; console.log(`   retargeted ${f.id} → ${e.file} (line endings)`); continue; }
    }
    if (e.find.includes('\n')) { stuck.push(`${f.id}: ${e.file} — multi-line find, ${n} exact matches (fix by hand)`); continue; }

    const want = norm(e.find);
    const hits = linesOf(e.file).filter((l) => norm(l) === want);
    if (hits.length !== 1) { stuck.push(`${f.id}: ${e.file} — ${hits.length} whitespace-insensitive matches (fix by hand)`); continue; }
    e.find = hits[0];
    fixed++;
    console.log(`   retargeted ${f.id} → ${e.file}`);
  }
}

console.log(`\n${fixed} edit(s) retargeted; ${stuck.length} still need a hand.`);
for (const s of stuck) console.log(`   ${s}`);
if (!WRITE) { console.log('\n(dry run — pass --write)'); process.exit(0); }
writeFileSync(specPath, JSON.stringify(specs, null, 1));
console.log('specs rewritten.');
