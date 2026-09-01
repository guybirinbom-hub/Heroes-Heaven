/*
 * Rebuild specific public/ast entries from the SHIPPED record's own export doc.
 *
 * bestByBucket used to pick a slug's AST by edition rank alone, so a shipped record whose same-name
 * twin ranked higher rendered the TWIN's page (the two "Zombie Horde" feats). import-core-v2.mjs now
 * prefers the shipped aonId's own doc at regen; this script applies the same preference to the
 * ALREADY-SHIPPED trees without a full (dangerous) `npm run data`.
 *
 * Link refs are resolved against the shipped corpus: a link's `to` (an AoN doc id) resolves to
 * "bucket:slug" when a shipped record carries that aonId, else ref stays null (renders as plain
 * text — the importer's own semantics for unshipped targets).
 *
 *   node scripts/rebuild-ast-entries.mjs items/cursed-dreamstone feats/zombie-horde …
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const targets = process.argv.slice(2).filter((a) => a.includes('/'));
if (!targets.length) { console.error('usage: node scripts/rebuild-ast-entries.mjs <bucket>/<slug> …'); process.exit(2); }

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

// aonId -> bucket:slug over the shipped corpus (for link-ref resolution).
const refByAon = new Map();
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  for (const [slug, r] of Object.entries(recs)) {
    if (r?.aonId && !refByAon.has(r.aonId)) refByAon.set(r.aonId, bucket + ':' + slug);
  }
}

// export doc index by id, loaded lazily per category file.
const docs = new Map();
for (const f of readdirSync(EXPORT).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(join(EXPORT, f), 'utf8')); } catch { continue; }
  for (const [id, d] of Object.entries(raw.docs ?? {})) if (!docs.has(id)) docs.set(id, d);
}

function resolveAst(node) {
  if (!node || typeof node !== 'object') return node;
  const out = Array.isArray(node) ? [] : {};
  for (const k in node) {
    if (k === 'to') { out.ref = refByAon.get(node.to) ?? null; out.to = node.to; }
    else if (k === 'c') out.c = node.c.map(resolveAst);
    else out[k] = node[k];
  }
  return out;
}

const byBucket = new Map();
let done = 0;
for (const t of targets) {
  const [bucket, slug] = [t.slice(0, t.indexOf('/')), t.slice(t.indexOf('/') + 1)];
  const rec = core[bucket]?.[slug];
  if (!rec?.aonId) { console.log('  ⚠', t, 'no shipped record/aonId'); continue; }
  const doc = docs.get(rec.aonId);
  if (!doc?.ast) { console.log('  ⚠', t, 'export has no ast for', rec.aonId); continue; }
  if (!byBucket.has(bucket)) byBucket.set(bucket, JSON.parse(readFileSync(join(ROOT, 'public/ast/' + bucket + '.json'), 'utf8')));
  byBucket.get(bucket)[slug] = resolveAst(doc.ast);
  console.log('  ✓', t, '→ rebuilt from', rec.aonId, '(' + (doc.name ?? '') + ')');
  done++;
}
for (const [bucket, ast] of byBucket) {
  const json = JSON.stringify(ast);
  writeFileSync(join(ROOT, 'public/ast/' + bucket + '.json'), json);
  writeFileSync(join(ROOT, 'public/ast/' + bucket + '.json.gz'), gzipSync(json, { level: 9 }));
}
console.log('rebuilt', done, 'entr' + (done === 1 ? 'y' : 'ies'), 'across', byBucket.size, 'bucket file(s)');
