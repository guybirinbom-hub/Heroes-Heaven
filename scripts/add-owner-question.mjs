/*
 * Append a contested record to work/owner-questions.json.
 *
 * The owner's standing rule is that our implementation matches Wanderer's Guide exactly, and that
 * where their encoding looks to contradict the printed text I do NOT decide — verbatim: *"if you think
 * that the way wg does things is not according to the text then ask me dont make that desion by
 * yourself, your job is to endsure that we doing the same as them."*
 *
 * So a contested record gets recorded rather than resolved, and the batch's parity verdict stays OPEN
 * until he rules. This exists so that recording one is a single command instead of a hand-edit of a
 * file that the parity gate reads — a hand-edit is how a question ends up half-written and silently
 * dropped from the list he is shown at the end.
 *
 *   node scripts/add-owner-question.mjs --id <id> --batch <n> --printed "..." --theirs "..." --ours "..." --question "..." [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'work/owner-questions.json');
const WRITE = process.argv.includes('--write');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

const entry = {
  id: arg('--id'),
  batch: Number(arg('--batch')),
  printed: arg('--printed'),
  theirs: arg('--theirs'),
  ours: arg('--ours'),
  question: arg('--question'),
};
for (const [k, v] of Object.entries(entry)) {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) {
    console.error(`missing --${k}. Every field is required: a half-written question cannot be ruled on.`);
    process.exit(2);
  }
}

const doc = JSON.parse(readFileSync(PATH, 'utf8'));
doc.open ??= [];
const at = doc.open.findIndex((q) => q.id === entry.id);
console.log(at >= 0 ? `replacing the existing question for ${entry.id}` : `adding ${entry.id}`);
if (at >= 0) doc.open[at] = entry; else doc.open.push(entry);
console.log(JSON.stringify(entry, null, 1));
console.log(`\n${doc.open.length} open question(s).`);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(doc, null, 1) + '\n');
console.log('written.');
