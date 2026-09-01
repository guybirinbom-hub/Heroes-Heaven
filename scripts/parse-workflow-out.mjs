/*
 * Pull the structured result out of a workflow's .output file and write it to work/ as JSON.
 *
 * The file is not pure JSON — it is a task notification wrapping the return value — so the object is
 * located by brace-matching from the first `{"survived"` rather than by slicing to the end.
 *
 *   node scripts/parse-workflow-out.mjs <path-to-.output>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/parse-workflow-out.mjs <file>'); process.exit(2); }

const raw = readFileSync(src, 'utf8');
const start = raw.indexOf("\"survived\"") >= 0 ? raw.lastIndexOf("{", raw.indexOf("\"survived\"")) : -1;
if (start < 0) { console.error('no {"survived" object in that file'); process.exit(2); }

/* Brace-match, respecting strings and escapes, so a trailing wrapper does not break the parse. */
let depth = 0;
let inStr = false;
let esc = false;
let end = -1;
for (let i = start; i < raw.length; i++) {
  const ch = raw[i];
  if (esc) { esc = false; continue; }
  if (ch === '\\') { esc = true; continue; }
  if (ch === '"') { inStr = !inStr; continue; }
  if (inStr) continue;
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
if (end < 0) { console.error('the object is truncated — the .output file does not contain a complete result'); process.exit(2); }

const j = JSON.parse(raw.slice(start, end));
writeFileSync(join(ROOT, 'work/residual-workflow-out.json'), JSON.stringify(j, null, 1) + '\n');

for (const k of ['survived', 'refuted', 'alreadyBuilt', 'unclear']) console.log(`${k.padEnd(13)}: ${(j[k] ?? []).length}`);

const by = {};
for (const s of j.survived ?? []) by[s.field || s.verdict || '?'] = (by[s.field || s.verdict || '?'] ?? 0) + 1;
console.log('\nsurviving fixes by field:');
for (const [f, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`);

const conf = {};
for (const s of j.survived ?? []) conf[s.confidence ?? '?'] = (conf[s.confidence ?? '?'] ?? 0) + 1;
console.log(`\nconfidence: ${JSON.stringify(conf)}`);
