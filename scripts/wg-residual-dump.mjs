/*
 * DUMP A BATCH FOR THE RESIDUAL READ — printed text beside everything we model, one record per block.
 *
 * Gate 7 asks for every record to be read against its printed text, because the six comparer gates
 * only prove we agree with Wanderer's Guide and a defect both sides share survives all of them. The
 * read itself is the work; this is the packet it needs, with the noise stripped: the batch file also
 * carries their operations and the field catalogue, which are evidence for a DIFFERENT question.
 *
 * `--skip a,b,c` omits records already read, so a long read can be taken in sittings without paging
 * back through what is done.
 *
 *   node scripts/wg-residual-dump.mjs --batch work/wg-batch-015.json --from 0 --count 25
 *   node scripts/wg-residual-dump.mjs --batch work/wg-batch-015.json --skip brutality,venom-spit
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const batchPath = arg('--batch', null);
if (!batchPath) { console.error('usage: --batch work/wg-batch-0NN.json [--from N] [--count N] [--skip a,b]'); process.exit(2); }

const core = read('public/core.json');
const descs = read('public/core-descriptions.json');
const skip = new Set(String(arg('--skip', '')).split(',').map((s) => s.trim()).filter(Boolean));
const from = Number(arg('--from', 0));
const count = Number(arg('--count', 1000));

/* Fields that say nothing about whether the record's rules are modelled. */
const NOISE = new Set(['id', 'name', 'traits', 'rarity', 'source', 'level', 'category', 'edition', 'aonId', 'prerequisites', 'aonParentId', 'aonSection']);

/*
 * THE REGISTRY LINES THEMSELVES, not just the file names.
 *
 * A mechanic can live in any of these keyed by record id, and a reader who sees only the record reports
 * it absent — which is the single largest source of false findings in this project. The batch packet
 * names the files; naming them is not enough to judge, because "there is an entry" and "the entry says
 * what the sentence says" are different claims. So the matching line is carried through verbatim.
 */
const REGISTRY_FILES = [
  'src/rules/featGrants.ts',
  'src/rules/featGrantsAuto.ts',
  'src/rules/featGrantsLane.ts',
  'src/rules/featFeatGrants.ts',
  'src/rules/featPickGrants.ts',
  'src/rules/featCantripGrants.ts',
  'src/rules/situationalBonuses.ts',
  'src/rules/companionGrants.ts',
  'src/rules/modes.ts',
  'src/rules/advancement.ts',
  'src/rules/casterArchetypes.ts',
  'src/rules/kineticElements.ts',
];
const registryText = new Map();
for (const f of REGISTRY_FILES) {
  try { registryText.set(f, readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/)); } catch { /* optional */ }
}
/** Every registry line naming this record id, with its file and line number. */
const registryLines = (id) => {
  const out = [];
  const needle = `'${id}'`;
  const needle2 = `"${id}"`;
  for (const [f, lines] of registryText) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(needle) && !lines[i].includes(needle2)) continue;
      out.push(`${f}:${i + 1}  ${lines[i].trim().slice(0, 260)}`);
    }
  }
  return out;
};

const rows = Object.values(read(batchPath)).filter((r) => !skip.has(r.id));
const slice = rows.slice(from, from + count);

console.log(`${rows.length} record(s) to read (${skip.size} skipped); showing ${slice.length} from index ${from}.\n`);
for (const r of slice) {
  const rec = core[r.bucket]?.[r.id] ?? {};
  const modelled = Object.keys(rec).filter((k) => !NOISE.has(k));
  const text = String(descs[r.bucket]?.[r.id]?.d ?? r.printed ?? '').replace(/\s+/g, ' ');
  console.log(`### ${r.bucket}/${r.id}  (level ${r.level ?? '-'})`);
  console.log(text.slice(0, 700) + (text.length > 700 ? ' …' : ''));
  console.log(`  MODELLED: ${modelled.length ? modelled.join(', ') : '(nothing but the header)'}`);
  for (const line of registryLines(r.id)) console.log(`  REGISTRY: ${line}`);
  console.log();
}
