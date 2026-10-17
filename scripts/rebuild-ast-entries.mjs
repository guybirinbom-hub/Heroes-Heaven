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
 * PROVENANCE (package M round 3, 2026-10-17). Every writer of public/ast stamps the page's tree root with
 * `aon`, the archive document the tree was copied from — import-core-v2.mjs does it as
 * `astOut[s] = resolveAst(rec.ast); astOut[s].aon = rec.id` — and scripts/ast-provenance-check.mjs fails
 * an unstamped page in any bucket that carries stamps. The export's `doc.ast` carries no `aon` (nor `url`),
 * and this script used to write it as-is, so every page it rebuilt failed that check and
 * scripts/stamp-ast-urls.mjs (which only addresses stamped trees) skipped it. It now stamps the root the
 * importer's way, after the copy. Run `node scripts/stamp-ast-urls.mjs` afterwards for the `url`, exactly as
 * after any other writer that rewrites a bucket on its own.
 *
 * THE BASE IS THE TRACKED .json.gz. The raw public/ast/<bucket>.json beside it is gitignored (the dev
 * fallback); reading it as the base meant a stale raw file would overwrite every OTHER page of the bucket in
 * the shipped .gz. The raw file is read only when no .gz exists, and both are written back identical.
 *
 * THE RELINK RULE (package I lane L8, 2026-10-17). After the aonId resolve, every link goes through
 * scripts/lib/ast-link-ref.mjs planLink(), the rule scripts/relink-carried-pages.mjs applies to the shipped
 * trees: a link opens its page's own record (or its reprint), a plain auto-link never opens an `aon-` record
 * (resolving by carrier alone would light up the Kingmaker army-condition words "lost" and "destroyed"),
 * and a common word sent to another class's feature is inert. Without it a rebuilt page fails
 * scripts/ast-link-carrier-check.mjs RULE 3. The library is found beside this file, else under the working
 * directory's scripts/lib (the tests run scratch copies of this file from another directory, from the repo).
 *
 * REBUILD_ROOT relocates the repo root and AON_EXPORT the export directory (used by
 * test/package-m-data3-rebuild-ast.test.ts to run this against a scratch fixture, never the tree).
 *
 *   node scripts/rebuild-ast-entries.mjs items/cursed-dreamstone feats/zombie-horde …
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.REBUILD_ROOT ? resolve(process.env.REBUILD_ROOT) : join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const LIB = [join(dirname(fileURLToPath(import.meta.url)), 'lib'), join(process.cwd(), 'scripts/lib')].find((d) => existsSync(join(d, 'ast-link-ref.mjs')));
if (!LIB) { console.error('rebuild-ast-entries: no scripts/lib/ast-link-ref.mjs beside this file or under the working directory'); process.exit(2); }
const { loadReprintIndex } = await import(pathToFileURL(join(LIB, 'reprint.mjs')).href);
const { linkContext, planLink } = await import(pathToFileURL(join(LIB, 'ast-link-ref.mjs')).href);
const targets = process.argv.slice(2).filter((a) => a.includes('/'));
if (!targets.length) { console.error('usage: node scripts/rebuild-ast-entries.mjs <bucket>/<slug> …'); process.exit(2); }

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/*
 * A CREATED record keeps no links from a same-named record (package M round 3, 2026-10-17). The importer's
 * step 5 creates a record for an Archives page the GM Search could not reach (listed in
 * scripts/migration/out/archive-created.json — scripts/lib/archive-coverage.mjs createdRefs), and a link to
 * that page moves to it only when no other record of its bucket carries its name: "A same-named record keeps
 * its links" (scripts/import-core-v2.mjs, the idMap rule beside archiveCreated). Resolving by aonId alone
 * sent the rebuilt Perception Expertise page's "Perception" (rules-2040, Player Core's Step 9 page) to the
 * created rules/perception-player-core instead of rules/perception, the app's record of "Perception" — the
 * link scripts/archive-coverage-check.mjs fails. Inlined, not imported: the tests run scratch copies of this
 * file from another directory.
 */
const createdFile = join(ROOT, 'scripts/migration/out/archive-created.json');
const created = existsSync(createdFile) ? JSON.parse(readFileSync(createdFile, 'utf8')) : {};
const createdRefs = new Set(Object.entries(created).flatMap(([b, m]) => Object.keys(m ?? {}).map((k) => `${b}:${k}`)));
const lowerName = (r) => String(r?.name ?? '').toLowerCase();
const slugOf = (s) => String(s ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** `bucket|lower name` -> the key of a record of that name the importer did NOT create (the key that is
 *  the name's own slug first — the importer's per-slug pick — else the first). */
const holderOf = new Map();
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
  for (const [slug, r] of Object.entries(recs)) {
    if (!r?.name || createdRefs.has(`${bucket}:${slug}`)) continue;
    const nk = `${bucket}|${lowerName(r)}`;
    if (!holderOf.has(nk) || slug === slugOf(r.name)) holderOf.set(nk, slug);
  }
}

// aonId -> bucket:slug over the shipped corpus (for link-ref resolution).
const refByAon = new Map();
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  for (const [slug, r] of Object.entries(recs)) {
    if (!r?.aonId || refByAon.has(r.aonId)) continue;
    const holder = createdRefs.has(`${bucket}:${slug}`) ? holderOf.get(`${bucket}|${lowerName(r)}`) : undefined;
    refByAon.set(r.aonId, bucket + ':' + (holder ?? slug));
  }
}

// export doc index by id, loaded lazily per category file.
const docs = new Map();
for (const f of readdirSync(EXPORT).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(join(EXPORT, f), 'utf8')); } catch { continue; }
  for (const [id, d] of Object.entries(raw.docs ?? {})) if (!docs.has(id)) docs.set(id, d);
}

// The relink rule's context (see the header): page names, levels and books, the reprint index, the created set.
const linkCtx = linkContext({ core, reprints: loadReprintIndex(EXPORT), createdRefs });
/** Every link of the rebuilt page through planLink, the rule the shipped trees are held to. */
function relink(bucket, slug, tree) {
  const page = { bucket, key: slug, tree };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.t === 'link' && n.to != null) n.ref = planLink(n, page, linkCtx).ref ?? null;
    if (n.c) walk(n.c);
  };
  walk(tree);
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

/** The bucket's shipped trees: the tracked .json.gz, else (no .gz yet) the raw dev file. */
function readBucket(bucket) {
  const gz = join(ROOT, 'public/ast/' + bucket + '.json.gz');
  if (existsSync(gz)) return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));
  return JSON.parse(readFileSync(join(ROOT, 'public/ast/' + bucket + '.json'), 'utf8'));
}

const byBucket = new Map();
let done = 0;
for (const t of targets) {
  const [bucket, slug] = [t.slice(0, t.indexOf('/')), t.slice(t.indexOf('/') + 1)];
  const rec = core[bucket]?.[slug];
  if (!rec?.aonId) { console.log('  ⚠', t, 'no shipped record/aonId'); continue; }
  const doc = docs.get(rec.aonId);
  if (!doc?.ast) { console.log('  ⚠', t, 'export has no ast for', rec.aonId); continue; }
  if (!byBucket.has(bucket)) byBucket.set(bucket, readBucket(bucket));
  const tree = resolveAst(doc.ast);
  // PROVENANCE, the importer's stamp: the archive document this page was copied from (see the header).
  tree.aon = String(doc.id ?? rec.aonId);
  relink(bucket, slug, tree);
  byBucket.get(bucket)[slug] = tree;
  console.log('  ✓', t, '→ rebuilt from', tree.aon, '(' + (doc.name ?? '') + ')');
  done++;
}
for (const [bucket, ast] of byBucket) {
  const json = JSON.stringify(ast);
  writeFileSync(join(ROOT, 'public/ast/' + bucket + '.json'), json);
  writeFileSync(join(ROOT, 'public/ast/' + bucket + '.json.gz'), gzipSync(json, { level: 9 }));
}
console.log('rebuilt', done, 'entr' + (done === 1 ? 'y' : 'ies'), 'across', byBucket.size, 'bucket file(s)');
if (done) console.log('next: node scripts/stamp-ast-urls.mjs  (the rebuilt pages carry `aon` but no Archives `url` yet)');
