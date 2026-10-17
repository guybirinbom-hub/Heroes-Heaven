/*
 * THE FOUNDRY PACK INDEX — one read of the Foundry packs, shared by the checks that use Foundry's rule
 * elements as EVIDENCE of where a condition existed (never as a source of text or rules: print decides).
 *
 * WHY. Walking and parsing the 16,000-odd pack files costs ~8 s on this machine, and the packs only change
 * when someone re-clones `.import-src/pf2e`. `loadPackIndex` keeps what a check needs — every document's
 * pack, path, name, slug and `system.rules` — in a cache under `node_modules/.cache/hh-foundry-rules/`,
 * keyed on the pack folder, the number of files, their total size and the newest mtime (a ~0.3 s stat
 * walk). Any edit, addition or removal under the packs changes the key, so a stale cache is never read.
 *
 * `importerDocs` replays the importer's id rules (scripts/import-core.mjs): the bucket each pack lands in,
 * `system.slug || slug(name)`, the feat slug-collision suffix (`<slug>-<archetype>` for the archetype copy),
 * and actions under `actions/class/` also landing in classFeatures.
 *
 *   import { loadPackIndex, importerDocs, atomsOf, hasPredicate } from './lib/foundry-rules.mjs';
 *   const index = loadPackIndex(PACKS);           // null when the packs are absent
 *   for (const d of importerDocs(index)) …        // { pack, rel, name, id, bucket, alsoBucket, rules }
 *
 * Read-only against the packs. Pass `{ cache: false }` to bypass the cache (it is then neither read nor
 * written), or `{ cacheDir }` (or env FOUNDRY_INDEX_CACHE) to keep it elsewhere (tests). The default cache
 * is written only when `node_modules` exists.
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Bump when the cached shape changes, so an old cache is never read as the new one. */
const INDEX_VERSION = 1;

export const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The importer's pack → bucket map (scripts/import-core.mjs). */
export const PACK_BUCKET = {
  actions: 'actions',
  ancestries: 'ancestries',
  backgrounds: 'backgrounds',
  'class-features': 'classFeatures',
  classes: 'classes',
  conditions: 'conditions',
  deities: 'deities',
  equipment: 'items',
  'familiar-abilities': 'familiarAbilities',
  feats: 'feats',
  heritages: 'heritages',
  spells: 'spells',
};

/** Every pack JSON file under `dir`, in readdir order (folder metadata `_*.json` skipped, as the importer does). */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('_')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function cacheKey(packsDir, files) {
  let size = 0;
  let mtime = 0;
  for (const f of files) {
    const s = statSync(f);
    size += s.size;
    if (s.mtimeMs > mtime) mtime = s.mtimeMs;
  }
  return { v: INDEX_VERSION, packs: packsDir.replace(/\\/g, '/'), files: files.length, size, mtime };
}

/**
 * The pack index: `{ packsDir, docs: [{ pack, rel, name, slug, rules }], cached }`, or null when `packsDir`
 * does not exist. `pack` is the top-level pack folder, `rel` the path inside it ('/'-separated), `slug` the
 * document's own `system.slug` (may be null), `rules` its `system.rules` (an empty array when it has none).
 */
export function loadPackIndex(packsDir, { cache = true, cacheDir = process.env.FOUNDRY_INDEX_CACHE || join(ROOT, 'node_modules', '.cache', 'hh-foundry-rules') } = {}) {
  if (!packsDir || !existsSync(packsDir)) return null;
  const packs = readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const files = [];
  for (const pack of packs) for (const f of listFiles(join(packsDir, pack))) files.push({ pack, f });
  const key = cacheKey(packsDir, files.map((x) => x.f));
  const cacheFile = join(cacheDir, `${createHash('sha1').update(key.packs).digest('hex').slice(0, 12)}.json`);
  if (cache && existsSync(cacheFile)) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (JSON.stringify(c.key) === JSON.stringify(key)) return { packsDir, docs: c.docs, cached: true };
    } catch {
      /* unreadable cache: rebuild */
    }
  }
  const docs = [];
  for (const { pack, f } of files) {
    let j;
    try {
      j = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    const rel = f.slice(join(packsDir, pack).length + 1).replace(/\\/g, '/');
    docs.push({ pack, rel, name: j?.name ?? null, slug: j?.system?.slug ?? null, rules: Array.isArray(j?.system?.rules) ? j.system.rules : [] });
  }
  if (cache && existsSync(dirname(dirname(cacheDir)))) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ key, docs }));
      renameSync(tmp, cacheFile);
    } catch {
      /* a cache that cannot be written only costs time */
    }
  }
  return { packsDir, docs, cached: false };
}

/**
 * The index's documents with the bucket and id the IMPORTER gave each one (scripts/import-core.mjs):
 * `{ pack, rel, name, id, bucket, alsoBucket?, archetype?, rules }`. Packs the importer does not read are
 * left out.
 */
export function importerDocs(index) {
  if (!index) return [];
  const out = [];
  const seenFeat = new Map(); // id -> doc, in import order
  for (const pack of Object.keys(PACK_BUCKET)) {
    for (const doc of index.docs) {
      if (doc.pack !== pack) continue;
      const d = { pack, rel: doc.rel, name: doc.name, id: slugify(doc.slug || doc.name), bucket: PACK_BUCKET[pack], rules: doc.rules };
      if (pack === 'feats') {
        const m = doc.rel.match(/^archetype\/([^/]+)\//);
        d.archetype = m ? m[1] : undefined;
        const ex = seenFeat.get(d.id);
        if (ex) {
          if (d.archetype) d.id = `${d.id}-${d.archetype}`;
          else if (ex.archetype) {
            ex.id = `${ex.id}-${ex.archetype}`;
            seenFeat.set(ex.id, ex);
          }
        }
        seenFeat.set(d.id, d);
      }
      if (pack === 'actions' && /^class\//.test(doc.rel)) d.alsoBucket = 'classFeatures';
      out.push(d);
    }
  }
  return out;
}

/** True when a rule (or a ChoiceSet choice) carries a non-empty `predicate`. */
export function hasPredicate(r) {
  const p = r?.predicate;
  if (p == null) return false;
  if (Array.isArray(p)) return p.length > 0;
  if (typeof p === 'object') return Object.keys(p).length > 0;
  return !!p;
}

/**
 * A predicate's atoms: `[{ atom, op, rhs?, neg, inOr }]`. `not` flips `neg`; `nor`/`nand` flip it for their
 * members; `or`/`nor`/`xor` set `inOr`; comparisons (`gte`, `gt`, `lte`, `lt`, `eq`) give the compared
 * roll option as `atom` with `op` and the other side as `rhs`.
 */
export function atomsOf(pred) {
  const out = [];
  const visit = (x, ctx) => {
    if (x == null) return;
    if (typeof x === 'string') {
      out.push({ atom: x, op: 'has', ...ctx });
      return;
    }
    if (Array.isArray(x)) {
      x.forEach((y) => visit(y, ctx));
      return;
    }
    if (typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) {
        if (k === 'or' || k === 'nor' || k === 'xor') (Array.isArray(v) ? v : [v]).forEach((y) => visit(y, { ...ctx, inOr: true, neg: ctx.neg || k === 'nor' }));
        else if (k === 'and' || k === 'nand') (Array.isArray(v) ? v : [v]).forEach((y) => visit(y, { ...ctx, neg: ctx.neg || k === 'nand' }));
        else if (k === 'not') visit(v, { ...ctx, neg: !ctx.neg });
        else if (['gte', 'gt', 'lte', 'lt', 'eq'].includes(k) && Array.isArray(v)) {
          const [l, r] = v;
          if (typeof l === 'string') out.push({ atom: l, op: k, rhs: r, ...ctx });
          if (typeof r === 'string' && typeof l !== 'string') out.push({ atom: r, op: k, rhs: l, ...ctx });
        } else visit(v, ctx);
      }
    }
  };
  visit(pred, { neg: false, inOr: false });
  return out;
}
