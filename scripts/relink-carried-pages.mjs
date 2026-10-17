/*
 * RELINK: every description link opens the record that carries its page (package I, lane L8, 2026-10-17).
 *
 * A link in public/ast/<bucket>.json.gz is `{ t: 'link', to: <Archives document>, ref: 'bucket:key' }`. The
 * importer resolves `ref` against its own id map before later chain steps mint and re-stamp the records that
 * ship, so 3,771 links opened nothing although a record carries their page (`ref: null`, or a ref naming a
 * record that does not ship: `conditions:lost` while `conditions:aon-lost` ships), and 14 live link pairs
 * opened another printing's record (Miracle -> the Wish ritual). Separately, the Archives auto-linker sends
 * common words to one class's feature from everywhere ("cause" x745 -> the Champion's Cause from kingdom and
 * army text). The rule for both is scripts/lib/ast-link-ref.mjs planLink(); this applies it to the shipped
 * trees. Links live only in public/ast, so overlay rows cannot reach them.
 *
 * Runs as a step of `npm run data`, after apply-ast-patches.mjs (the last writer of the trees) and before
 * stamp-ast-urls.mjs, so a regen keeps it. Idempotent: a second run plans nothing.
 * scripts/ast-link-carrier-check.mjs (npm run verify) fails while it would still plan a change.
 *
 *   node scripts/relink-carried-pages.mjs                 # dry run: print the plan, write nothing
 *   node scripts/relink-carried-pages.mjs --write         # apply it (.json.gz, and the raw .json beside it)
 *   node scripts/relink-carried-pages.mjs --out <file>    # also write every planned change as JSON
 *
 * AST_DIR, CORE_JSON, AON_EXPORT and CREATED_JSON override the trees, public/core.json, the export and
 * scripts/migration/out/archive-created.json (the tests and the planted-failure proofs run on scratch copies).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReprintIndex, EXPORT_DIR } from './lib/reprint.mjs';
import { linkContext, planTree, labelOf } from './lib/ast-link-ref.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AST_DIR = process.env.AST_DIR || join(ROOT, 'public/ast');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const CREATED = process.env.CREATED_JSON || join(ROOT, 'scripts/migration/out/archive-created.json');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const created = existsSync(CREATED) ? JSON.parse(readFileSync(CREATED, 'utf8')) : {};
const createdRefs = new Set(Object.entries(created).flatMap(([b, m]) => Object.keys(m ?? {}).map((k) => `${b}:${k}`)));
if (!existsSync(EXPORT_DIR)) {
  console.error(`relink-carried-pages: FAIL — no Archives export at ${EXPORT_DIR} (set AON_EXPORT)`);
  process.exit(1);
}
const ctx = linkContext({ core, reprints: loadReprintIndex(EXPORT_DIR), createdRefs });

const files = readdirSync(AST_DIR).filter((f) => f.endsWith('.json.gz')).sort();
if (!files.length) {
  console.error(`relink-carried-pages: FAIL — no <bucket>.json.gz in ${AST_DIR}`);
  process.exit(1);
}

const byWhy = {};
const groups = new Map(); // `why|to|from|ref` -> { n, where[] }
const all = [];
let written = 0;
for (const f of files) {
  const bucket = f.slice(0, -'.json.gz'.length);
  const json = gunzipSync(readFileSync(join(AST_DIR, f))).toString('utf8');
  const trees = JSON.parse(json);
  let dirty = 0;
  for (const [key, tree] of Object.entries(trees)) {
    for (const c of planTree(bucket, key, tree, ctx)) {
      byWhy[c.why] = (byWhy[c.why] ?? 0) + 1;
      const g = `${c.why}|${c.node.to}|${c.from}|${c.ref}`;
      const e = groups.get(g) ?? groups.set(g, { n: 0, where: [], label: labelOf(c.node) }).get(g);
      e.n++;
      if (e.where.length < 3) e.where.push(`${bucket}/${key}`);
      if (OUT) all.push({ page: `${bucket}/${key}`, to: String(c.node.to), label: labelOf(c.node), auto: !!c.node.auto, from: c.from, ref: c.ref, why: c.why });
      if (WRITE) { c.node.ref = c.ref; dirty++; }
    }
  }
  if (!dirty) continue;
  const out = JSON.stringify(trees);
  writeFileSync(join(AST_DIR, f), gzipSync(out, { level: 9 }));
  // The raw file beside it is the local dev fallback (src/sheet/astStore.ts); keep it the same page.
  if (existsSync(join(AST_DIR, `${bucket}.json`))) writeFileSync(join(AST_DIR, `${bucket}.json`), out);
  written++;
}

const total = Object.values(byWhy).reduce((a, b) => a + b, 0);
const nameOf = (to) => ctx.docs.get(String(to))?.name ?? '?';
const sorted = [...groups].sort((a, b) => a[0].split('|')[0].localeCompare(b[0].split('|')[0]) || b[1].n - a[1].n);
for (const [g, e] of sorted) {
  const [why, to, from, ref] = g.split('|');
  console.log(`  ${why.padEnd(16)} ${String(e.n).padStart(4)}  ${to} "${nameOf(to)}" [${e.label}]: ${from} -> ${ref}   e.g. ${e.where.join(', ')}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(all, null, 1) + '\n');
const kinds = Object.entries(byWhy).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
console.log(`relink-carried-pages: ${WRITE ? 'wrote' : 'planned'} ${total} link change(s) in ${groups.size} group(s) (${kinds})${WRITE ? `; ${written} bucket file(s) rewritten` : ' — dry run, nothing written (--write applies it)'}.`);
