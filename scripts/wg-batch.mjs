/**
 * BUILD A COMPARISON BATCH — one self-contained packet per record.
 *
 * The owner's rule, in their words: for every feature a player can get, if Wanderer's Guide encodes
 * something and we do not, do what they did; if we both encode it DIFFERENTLY, delete ours and do
 * theirs. Two exceptions: where they encode nothing, we stay as we are; and where one record does
 * several things and they only address one, adopt theirs on that part and leave the rest alone.
 *
 * What we adopt is their READING OF THE RULE, re-expressed in our own fields. Their vocabulary
 * cannot be lifted wholesale — it has no way to say "a success becomes a critical success", and 759
 * of their encoded feats fall back to prose in a field meant to hold a value — and their data is
 * GPL-3.0 while this app ships proprietary. So the packet carries their encoding as EVIDENCE beside
 * the printed rules text, which is the actual authority and is Paizo's under the ORC licence.
 *
 * Each packet is self-contained so an agent needs no further lookups for the easy majority:
 *   · the printed text (from core-descriptions.json — core.json has held no prose since the split)
 *   · every mechanical field we author on the record
 *   · every id-keyed registry in src/rules/ that names the record — the differ was 19.2% accurate
 *     until it learned to look here, because a mechanic can live in a registry with no field to show
 *   · their operations, parsed through BOTH escaping layers and flattened through conditionals
 *
 *   node scripts/wg-batch.mjs --count 100 --out work/wg-batch-001.json
 *   node scripts/wg-batch.mjs --count 100 --skip 100 --out work/wg-batch-002.json
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, parseOps, flattenOps, untsv } from './lib/wg-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
const sql = readFileSync(join(ROOT, 'work/wg/wg-data.sql'), 'utf8');

/** Their table + type -> our core.json bucket. */
const SOURCES = [
  ['ability_block', 'feat', 'feats'],
  ['ability_block', 'class-feature', 'classFeatures'],
  ['ability_block', 'heritage', 'heritages'],
  ['ability_block', 'sense', null],
  ['ability_block', 'mode', null],
  ['ability_block', 'physical-feature', null],
  ['item', null, 'items'],
  ['background', null, 'backgrounds'],
  ['ancestry', null, 'ancestries'],
  ['class', null, 'classes'],
];

/* ---------------------------------------------------------------- our side */
const INERT = new Set([
  'id', 'name', 'description', 'descRefs', 'traits', 'level', 'category', 'source', 'sourceId',
  'aonId', 'aonOrigin', 'aonParentId', 'aonSection', 'rarity', 'edition', 'prerequisites', 'access',
  'frequency', 'trigger', 'requirements', 'cost', 'special', 'archetype', 'maxTakable', 'onlyAtLevel',
  'subcategory', 'price', 'bulk', 'usage', 'hands', 'group', 'itemType', 'craftReq', 'school',
  'tradition', 'traditions', 'range', 'targets', 'area', 'duration', 'defense', 'heightened',
  'summary', 'text', 'type', 'key', 'slug', 'page', 'pfsLegal', 'legacy', 'remaster', 'url',
]);

/** Every id-keyed registry under src/rules/, read once as text. A mechanic living in one of these
 *  shows on no field, which is exactly how the first differ produced an 80%-noise work list. */
const registries = (() => {
  const out = [];
  const dir = join(ROOT, 'src/rules');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    out.push({ file: `src/rules/${f}`, text: readFileSync(join(dir, f), 'utf8') });
  }
  return out;
})();
const registryHits = (id) =>
  registries.filter((r) => r.text.includes(`'${id}'`) || r.text.includes(`"${id}"`)).map((r) => r.file);

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const printedOf = (bucket, id) => {
  const d = descs[bucket]?.[id];
  const t = typeof d === 'string' ? d : d?.d ?? d?.description ?? core[bucket]?.[id]?.description ?? '';
  return strip(t);
};

/* ---------------------------------------------------------------- their side */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** A compact, readable rendering of one operation — the shape, not their JSON. */
const describeOp = (op, depth = 0) => {
  const pad = '  '.repeat(depth);
  const d = op?.data ?? {};
  let s = `${pad}${op?.type}`;
  if (d.variable) s += ` ${d.variable}`;
  if (d.value !== undefined) s += ` = ${JSON.stringify(d.value)}`.slice(0, 90);
  if (d.optionType) s += ` from:${d.optionType}`;
  if (d.title) s += ` "${d.title}"`;
  if (d.text) s += ` text:"${strip(d.text).slice(0, 110)}"`;
  if (op?.type === 'conditional' && d.conditions) s += ` IF ${JSON.stringify(d.conditions).slice(0, 110)}`;
  const out = [s];
  for (const k of ['operations', 'trueOperations', 'falseOperations']) {
    for (const c of d[k] ?? []) out.push(...describeOp(c, depth + 1));
  }
  for (const o of d.optionsPredefined ?? []) {
    out.push(`${pad}  option "${o.title ?? o.name ?? '?'}"`);
    for (const c of o.operations ?? []) out.push(...describeOp(c, depth + 2));
  }
  return out;
};

const theirs = new Map(); // "bucket|normname" -> {name, type, ops[]}
for (const [table, type, bucket] of SOURCES) {
  let parsed;
  try { parsed = parseCopyBlock(sql, table); } catch { continue; }
  for (const r of parsed.rows) {
    if (type && r.type !== type) continue;
    const ops = parseOps(r.operations).flatMap((o) => flattenOps(o));
    if (!ops.length) continue;
    const key = `${bucket ?? type}|${norm(r.name)}`;
    const prev = theirs.get(key);
    if (!prev || ops.length > prev.ops.length) {
      theirs.set(key, { name: r.name, type: type ?? table, bucket, ops, raw: parseOps(r.operations) });
    }
  }
}

/* ---------------------------------------------------------------- pair them up */
const packets = [];
for (const [, bucket] of SOURCES.map((s) => [s[1], s[2]])) {
  if (!bucket || !core[bucket]) continue;
  for (const [id, rec] of Object.entries(core[bucket])) {
    if (!rec?.name) continue;
    const t = theirs.get(`${bucket}|${norm(rec.name)}`);
    if (!t) continue; // they encode nothing here — owner rule: leave us unchanged
    if (packets.some((p) => p.id === id && p.bucket === bucket)) continue;
    const mech = Object.fromEntries(Object.entries(rec).filter(([k]) => !INERT.has(k)));
    packets.push({
      bucket,
      id,
      name: rec.name,
      level: rec.level ?? null,
      printed: printedOf(bucket, id),
      ourFields: mech,
      ourRegistries: registryHits(id),
      theirType: t.type,
      theirOps: t.ops.map((o) => o.type),
      theirEncoding: t.raw.flatMap((o) => describeOp(o)),
    });
  }
}

/* Deterministic order so batch N is always the same 100 records. */
const h = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x / 0xffffffff; };
packets.sort((a, b) => h(a.bucket + a.id) - h(b.bucket + b.id));

const skip = Number(arg('--skip', 0));
const count = Number(arg('--count', 100));
const batch = packets.slice(skip, skip + count);

const byBucket = {};
for (const p of packets) byBucket[p.bucket] = (byBucket[p.bucket] ?? 0) + 1;
console.log(`records where BOTH sides exist and THEY encode something: ${packets.length.toLocaleString()}`);
for (const [b, n] of Object.entries(byBucket).sort((a, b2) => b2[1] - a[1])) console.log(`  ${b.padEnd(16)} ${String(n).padStart(5)}`);
console.log(`\nbatch: ${batch.length} records (skip ${skip})`);
const bb = {};
for (const p of batch) bb[p.bucket] = (bb[p.bucket] ?? 0) + 1;
console.log('  ' + Object.entries(bb).map(([k, v]) => `${k}=${v}`).join('  '));

const out = arg('--out', null);
if (out) {
  writeFileSync(join(ROOT, out), JSON.stringify(batch, null, 1));
  console.log(`\n-> ${out}  (${(readFileSync(join(ROOT, out), 'utf8').length / 1024).toFixed(0)} KB)`);
}
