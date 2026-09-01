/*
 * PROSE PACKETS — the last unchecked surface.
 *
 * `wg-diff.mjs` compares kinds, `wg-values.mjs` numbers and sets, `wg-identity.mjs` named things. A
 * record whose only assertion is a PROSE bonus (`addBonusToValue` with a text field and no value)
 * escapes all three: both sides "model a skill", there is no number to compare and nothing is named.
 * Roughly 38 records per batch. Their wording against our authoring needs reading, not measuring.
 *
 * This builds one self-contained packet per such record so the reading is finite: the printed rule,
 * every mechanical field we author, the registry entries that name the record, and their prose.
 *
 *   node scripts/wg-prose.mjs --batch work/wg-batch-003.json --out work/wg-prose-003.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, parseOps, flattenOps, wgRecord, wgRowsByBucket, wgOwnsComparison } from './lib/wg-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) { console.error('No dump at work/wg/wg-data.sql'); process.exit(2); }
const sql = readFileSync(DUMP, 'utf8');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/* Registry files that can carry a record's mechanics, so a packet shows everything we author. */
const REGISTRIES = [
  'src/rules/featGrantsAuto.ts', 'src/rules/featGrants.ts', 'src/rules/featGrantsLane.ts',
  'src/rules/featFeatGrants.ts', 'src/rules/situationalBonuses.ts', 'src/rules/featPickGrants.ts',
  'src/rules/featCantripGrants.ts', 'src/rules/companionGrants.ts', 'src/rules/modes.ts',
  'src/rules/counterMods.ts', 'src/rules/casterArchetypes.ts',
];
const regText = new Map(REGISTRIES.map((f) => {
  try { return [f, readFileSync(join(ROOT, f), 'utf8')]; } catch { return [f, '']; }
}));

/** Every entry for `id` in every registry, verbatim, so the reader sees what we actually author. */
function ourRegistryEntries(id) {
  const out = [];
  for (const [f, text] of regText) {
    const re = new RegExp(`^\\s{2}(?:['"]${id}['"]|${id})\\s*:\\s*`, 'gm');
    for (const m of text.matchAll(re)) {
      const rest = text.slice(m.index);
      const end = /\n\s{2}(?:['"][a-z0-9-]+['"]|[a-z][a-zA-Z0-9]*)\s*:/.exec(rest.slice(1));
      out.push({ file: f.replace('src/rules/', ''), entry: rest.slice(0, end ? end.index + 1 : rest.length).trim().slice(0, 700) });
    }
  }
  return out;
}

/* THEIR ROWS, PER BUCKET — see `WG_PAIRING`. `if (r.type !== 'feat') continue` meant no item, class
 * feature, heritage, background, ancestry or class ever reached this comparer. Type-gated, because 266
 * normalised names exist in two of our buckets and a name-only match pairs the wrong pair. */
const theirByBucket = wgRowsByBucket(sql);
const theirRowFor = (bucket, name) => {
  const row = theirByBucket[bucket]?.get(norm(name));
  return row ? { row, ops: parseOps(row.operations).flatMap((o) => flattenOps(o)) } : undefined;
};

const batchRows = Object.values(JSON.parse(readFileSync(join(ROOT, arg('--batch', 'work/wg-batch-003.json')), 'utf8')));
const ids = batchRows.map((r) => r.id);
/* The bucket each id was CUT from — 'warrior' is a background AND a class feature, and resolving the
 * bare id examined the wrong one while the batch's record reached no comparer (batch 23). */
const bucketHintOf = new Map(batchRows.map((r) => [r.id, r.bucket]));

const packets = [];
for (const id of ids) {
  /* ANY bucket, not just feats — resolving with `core.feats?.[id]` skipped every class feature, item,
   * heritage and background in silence. See wgRecord's note. */
  const { rec, bucket } = wgRecord(core, id, bucketHintOf.get(id));
  if (!rec?.name) continue;
  /* See wgOwnsComparison: an action defers to a same-named class feature or feat. */
  if (!wgOwnsComparison(core, bucket, id)) continue;
  const t = theirRowFor(bucket, rec.name);
  if (!t) continue;

  /* Their PROSE assertions: a value-setting op whose value is empty and whose text carries the rule. */
  const prose = [];
  let hasNumeric = false;
  for (const op of t.ops) {
    if (!['adjValue', 'setValue', 'addBonusToValue'].includes(op?.type)) continue;
    const v = typeof op.data?.value === 'object' ? op.data?.value?.value : op.data?.value;
    const text = op.data?.text;
    if (v !== undefined && v !== null && v !== '') hasNumeric = true;
    if (text) prose.push({ variable: op.data?.variable, value: v ?? null, text: strip(text).slice(0, 400) });
  }
  if (!prose.length) continue;          // nothing to read
  if (hasNumeric && !prose.some((p) => p.value === null || p.value === '')) continue;  // fully covered by wg-values

  const ourFields = {};
  for (const [k, v] of Object.entries(rec)) {
    if (['id', 'name', 'level', 'category', 'traits', 'rarity', 'source', 'prerequisites', 'edition', 'aonId', 'aonParentId', 'aonSection', 'description'].includes(k)) continue;
    ourFields[k] = v;
  }
  packets.push({
    id,
    name: rec.name,
    level: rec.level,
    /* the record's OWN bucket — reading desc.feats for an item printed nothing */
    printed: strip(desc[bucket]?.[id]?.d ?? '').slice(0, 1400),
    ourFields,
    ourRegistries: ourRegistryEntries(id),
    theirProse: prose,
  });
}

const out = arg('--out', null);
console.log(`${packets.length} records assert something in PROSE that no other instrument checks`);
if (out) {
  writeFileSync(join(ROOT, out), JSON.stringify(packets, null, 1));
  console.log(`-> ${out} (${(readFileSync(join(ROOT, out), 'utf8').length / 1024).toFixed(0)} KB)`);
} else {
  for (const p of packets) console.log(`  ${p.id}`);
}
