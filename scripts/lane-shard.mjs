/** Round-robin the lane samples into N shards so each auditor gets a mix of big and tiny lanes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lanes = JSON.parse(readFileSync(join(ROOT, 'scripts/audit/lane-samples.json'), 'utf8'));
const N = Number(process.argv[2] ?? 12);

const shards = Array.from({ length: N }, () => []);
lanes.forEach((l, i) => shards[i % N].push(l));
shards.forEach((s, i) => {
  const p = `scripts/audit/lane-shard-${String(i).padStart(2, '0')}.json`;
  writeFileSync(join(ROOT, p), JSON.stringify(s, null, 1));
  console.log(`${p}  ${String(s.length).padStart(3)} lanes  ${s.reduce((n, l) => n + l.samples.length, 0)} records  ${(readFileSync(join(ROOT, p), 'utf8').length / 1024).toFixed(0)}KB`);
});
