/*
 * Pull the settle-divergence audit's result out of its .output file into work/ as JSON.
 *
 * Same shape problem as the residual workflow's output: the file wraps the return value, so the object
 * is brace-matched from its opening key rather than sliced to the end.
 *
 *   node scripts/parse-audit-out.mjs <path-to-.output>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/parse-audit-out.mjs <file>'); process.exit(2); }

const raw = readFileSync(src, 'utf8');
const key = raw.indexOf('"confirmed"');
if (key < 0) { console.error('no "confirmed" key in that file'); process.exit(2); }
const start = raw.lastIndexOf('{', key);

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
if (end < 0) { console.error('the object is truncated in that file'); process.exit(2); }

const j = JSON.parse(raw.slice(start, end));
writeFileSync(join(ROOT, 'work/settle-divergences.json'), JSON.stringify(j, null, 1) + '\n');

console.log(`verdicts: ${JSON.stringify(j.counts ?? {})}`);
console.log(`confirmed divergences : ${(j.confirmed ?? []).length}`);
console.log(`withdrawn on review   : ${(j.withdrawn ?? []).length}`);
console.log(`unsure                : ${(j.unsure ?? []).length}`);

console.log('\n--- CONFIRMED DIVERGENCES');
for (const c of j.confirmed ?? []) {
  console.log(`\n  ${c.id}  [${c.gate}, ${c.confidence ?? '?'}]`);
  if (c.theyDeliver) console.log(`     THEY: ${String(c.theyDeliver).replace(/\s+/g, ' ').slice(0, 190)}`);
  if (c.weDeliver) console.log(`     OURS: ${String(c.weDeliver).replace(/\s+/g, ' ').slice(0, 190)}`);
}
if ((j.unsure ?? []).length) {
  console.log('\n--- UNSURE');
  for (const u of j.unsure) console.log(`   ${u.id}: ${String(u.evidence ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
}
console.log('\n-> work/settle-divergences.json');
