/*
 * One-shot codemod: point every overlay writer at the shared formatter.
 *
 * `scripts/data/effect-backfill.json` is stored 1-space + CRLF, no trailing newline. Forty-four of the
 * forty-five scripts that write it used `JSON.stringify(rows, null, 2) + '\n'`, so re-running any one
 * of them reformatted all 6,841 rows — a 276 KB diff hiding a two-line change, on the only overlay that
 * survives `npm run data`.
 *
 *   node scripts/lib/fix-backfill-writers.mjs [--apply]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const SCRIPTS = join(root, 'scripts');

// The serialisation, not the writeFileSync call — the path expression varies between scripts and is
// none of this codemod's business.
const BAD = /JSON\.stringify\(\s*([^,]+?)\s*,\s*null\s*,\s*2\s*\)\s*\+\s*'\\n'/;
const IMPORT = "import { formatBackfill } from './lib/write-backfill.mjs';";

const fixed = [];
const alreadyOk = [];
for (const f of readdirSync(SCRIPTS).filter((x) => x.endsWith('.mjs'))) {
  const p = join(SCRIPTS, f);
  let s = readFileSync(p, 'utf8');
  if (!s.includes('effect-backfill')) continue;
  if (!BAD.test(s)) { alreadyOk.push(f); continue; }

  s = s.replace(BAD, 'formatBackfill($1)');
  if (!s.includes('write-backfill.mjs')) {
    const lines = s.split('\n');
    let last = -1;
    lines.forEach((l, i) => { if (/^import .* from ['"]/.test(l)) last = i; });
    lines.splice(last + 1, 0, IMPORT);
    s = lines.join('\n');
  }
  fixed.push(f);
  if (APPLY) writeFileSync(p, s);
}

console.log(`${APPLY ? 'rewritten' : 'would rewrite'}: ${fixed.length}`);
console.log(`already writing the stored format (or read-only): ${alreadyOk.length}`);
if (!APPLY) console.log('\n(dry run — pass --apply)');
