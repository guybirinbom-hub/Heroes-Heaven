/*
 * THE REMAINING PARITY WORK LIST — every record still open, minus the ones awaiting an owner ruling.
 *
 * After the batches 5–16 read there were 127 confirmed mismatches and 19 ASK-OWNER. Since then three
 * systemic sweeps landed (27 duplicate pickers, 5 caster-archetype cantrip caps, 2 denied weapon
 * groups), and some records they touched were never given a verdict — so the true remaining list is
 * NOT "127 minus the verdicts I wrote". It has to be recomputed from the batch files.
 *
 * A record is remaining work when: their side encodes something, it has no parity verdict, and it is
 * not queued in work/owner-questions.json.
 *
 *   node scripts/parity-worklist.mjs            # summary
 *   node scripts/parity-worklist.mjs --json     # the list, for a workflow to fan out over
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const owner = new Set(read('work/owner-questions.json').open.map((q) => q.id));

const rows = [];
for (let n = 1; n <= 16; n++) {
  const b = String(n).padStart(3, '0');
  const batchPath = `work/wg-batch-${b}.json`;
  if (!existsSync(join(ROOT, batchPath))) continue;
  const batch = read(batchPath);
  const parityPath = `work/wg-batch-${b}-parity.json`;
  const answered = new Set(
    existsSync(join(ROOT, parityPath)) ? (read(parityPath).records ?? []).map((r) => r.id) : [],
  );
  for (const rec of batch) {
    if (!(rec.theirOps ?? []).length) continue;
    if (answered.has(rec.id)) continue;
    if (owner.has(rec.id)) continue;
    rows.push({ batch: b, id: rec.id, bucket: rec.bucket ?? rec.category ?? '?', name: rec.name ?? rec.id });
  }
}

if (JSON_OUT) { console.log(JSON.stringify(rows)); process.exit(0); }

const byBatch = {};
for (const r of rows) (byBatch[r.batch] ??= []).push(r.id);
console.log(`${rows.length} record(s) remaining (open, not awaiting an owner ruling).\n`);
for (const [b, ids] of Object.entries(byBatch)) {
  console.log(`  batch ${b}  (${ids.length})`);
  console.log(`     ${ids.join(', ')}`);
}
console.log(`\n${owner.size} record(s) deliberately excluded: queued for the owner.`);
