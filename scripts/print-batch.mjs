/*
 * PRINT BATCH — cut a read packet for records Wanderer's Guide never encoded.
 *
 * The WG parity batches (wg-batch.mjs) stop where their dump stops. Everything else a level-1..7 player
 * can take (8,735 records measured 2026-09-05: items 3,823 · feats 1,924 · spells 1,379 · class features
 * 640 · …) is read against PRINT alone: our record beside the Archives page its aonId names. This cuts
 * that packet, one bucket at a time, oldest-unread first, skipping anything a WG batch already carries.
 *
 *   node scripts/print-batch.mjs --bucket classFeatures --maxLevel 7 --out work/print-batch-P01.json
 *   node scripts/print-batch.mjs --bucket feats --maxLevel 7 --count 150 --skipDone --out work/print-batch-P02.json
 *
 * Each record: { bucket, id, name, level, aonId, printed (the page's text), ourFields (every non-prose
 * field), owners (the classes whose feature table grants it, for class features) }. --skipDone leaves out
 * ids already in any work/print-batch-*.json.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const bucket = arg('--bucket', 'classFeatures');
const maxLevel = Number(arg('--maxLevel', 7));
const count = Number(arg('--count', 100000));
const out = arg('--out', null);
/* --ids "bucket/id,bucket/id,…" (or a path to a JSON array of them) cuts exactly those records, across
 * buckets and at any level — the records a WG batch found no packet for are handed back this way. */
const idsArg = arg('--ids', null);
const wanted = idsArg
  ? (existsSync(idsArg) ? JSON.parse(readFileSync(idsArg, 'utf8')) : idsArg.split(',')).map((s) => String(s).trim()).filter(Boolean)
  : null;
if (!out) { console.error('usage: node scripts/print-batch.mjs (--bucket <bucket> --maxLevel N [--count N] [--skipDone] | --ids "bucket/id,…") --out work/print-batch-PNN.json'); process.exit(2); }

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
const descOf = (b, id) => { const v = descs[b]?.[id]; return typeof v === 'string' ? v : (v?.d ?? ''); };

const inWg = new Set();
const inPrint = new Set();
for (const f of readdirSync(join(ROOT, 'work'))) {
  if (/^wg-batch-\d+\.json$/.test(f)) for (const r of JSON.parse(readFileSync(join(ROOT, 'work', f), 'utf8'))) inWg.add(r.bucket + '/' + r.id);
  if (/^print-batch-P\d+\.json$/.test(f) && has('--skipDone')) for (const r of JSON.parse(readFileSync(join(ROOT, 'work', f), 'utf8'))) inPrint.add(r.bucket + '/' + r.id);
}

/* Chassis rows every class shares (ability boosts, skill increases, feat slots) carry no rules of their
 * own to read; they are the level table's bookkeeping. */
const GENERIC = /^(ability-boosts?|skill-increases?|skill-feats?|general-feats?|ancestry-feats?|class-feats?|attribute-boosts?|initial-proficiencies|ancestry-and-background|attribute-apex)(-\d+)?$/;

const owners = {};
for (const [cid, cls] of Object.entries(core.classes ?? {})) for (const f of cls.features ?? []) (owners[f.featureId] ??= []).push(`${cid}@${f.level}`);

const levelOf = (rec, b = bucket) => {
  if (b === 'spells') { const r = rec.rank ?? rec.level; return typeof r === 'number' ? (r === 0 ? 1 : r * 2 - 1) : null; }
  if (['heritages', 'backgrounds', 'languages', 'deities', 'ancestries'].includes(b)) return 1;
  return typeof rec.level === 'number' ? rec.level : null;
};
const page = (aonId) => {
  if (!aonId) return null;
  const cat = String(aonId).replace(/-\d+.*$/, '');
  const p = join(MIRROR, cat, `${String(aonId).replace(/(-\d+).*$/, '$1')}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const PROSE = new Set(['description', 'summary', 'name', 'id']);

/* The records to read: every record of --bucket at or under --maxLevel, or exactly the --ids pairs
 * (no level cap — the owner picked them). An --ids pair that names no record is an error, never a
 * silent skip: a hand-back list must cut whole. */
const sources = wanted
  ? wanted.map((key) => {
      const slash = key.indexOf('/');
      const b = key.slice(0, slash), id = key.slice(slash + 1);
      const rec = core[b]?.[id];
      if (!rec) { console.error(`--ids: no record ${key}`); process.exit(2); }
      return [b, rec];
    })
  : Object.values(core[bucket] ?? {}).map((rec) => [bucket, rec]);

const rows = [];
let skippedGeneric = 0, skippedWg = 0, noPage = 0;
for (const [b, rec] of sources) {
  const level = levelOf(rec, b);
  if (!wanted && (level == null || level > maxLevel)) continue;
  const key = b + '/' + rec.id;
  if (inWg.has(key)) { skippedWg++; continue; }
  if (inPrint.has(key)) continue;
  if (b === 'classFeatures' && GENERIC.test(rec.id)) { skippedGeneric++; continue; }
  const doc = page(rec.aonId);
  if (!doc) noPage++;
  const ourFields = {};
  for (const [k, v] of Object.entries(rec)) if (!PROSE.has(k) && v !== undefined) ourFields[k] = v;
  rows.push({
    bucket: b, id: rec.id, name: rec.name, level: level ?? 0, aonId: rec.aonId ?? null,
    printed: doc ? String(doc.text ?? doc.markdown ?? '').replace(/\r\n/g, '\n').trim() : null,
    ourDescription: descOf(b, rec.id).slice(0, 4000),
    ourFields,
    ...(b === 'classFeatures' ? { owners: owners[rec.id] ?? [] } : {}),
  });
}
rows.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
const cut = rows.slice(0, count);
writeFileSync(join(ROOT, out), JSON.stringify(cut, null, 1));
const byLevel = {};
for (const r of cut) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
console.log(`${wanted ? `--ids (${wanted.length})` : bucket}: ${rows.length} eligible${wanted ? '' : ` at level <= ${maxLevel}`} (skipped ${skippedWg} in WG batches, ${skippedGeneric} generic chassis rows${has('--skipDone') ? `, ${inPrint.size} already in a print batch` : ''}); ${noPage} without a mirror page`);
console.log(`cut ${cut.length} -> ${out}  by level ${JSON.stringify(byLevel)}`);
