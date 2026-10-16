/*
 * ONE-OFF REPAIR: links to a class feature that opened the class page instead (package M, 2026-10-16).
 *
 * The cause is fixed in the importer (scripts/import-core-v2.mjs resolveTo, rule in scripts/lib/ast-link-ref.mjs):
 * a sub-page's `superseded_by` names the reprint of the page it is printed on, so a link to it never follows
 * that pointer: it opens the feature's own newest printing, else its own record, else nothing. The next full
 * `npm run data` writes every tree that way by itself, and this script then finds nothing to do.
 *
 * Until then the shipped trees in public/ast/*.json.gz still carry the old refs, and a full regen is a
 * 10-minute, silently-abortable job that would also move everything else the export has changed since. This
 * rewrites ONLY the `ref` of the links the fixed importer would resolve differently, and nothing else:
 *   • the fixed resolver (newResolve below — resolveTo with the sub-page rule) answers differently from the
 *     old one (oldResolve — resolveTo as it was), which only a page-link pointer can cause, and
 *   • the link's current `ref` is exactly what the OLD resolver answered (so a tree some other writer built,
 *     whose resolver never hops — import-siege-and-gaps, backfill-ast-edition, … — is left alone).
 * The new `ref` may be null (nothing of the feature's own ships): that is how every unresolvable link is
 * written, and AstRenderer draws it as inert text.
 * Every other byte of every tree is kept: the file is parsed and re-serialised with JSON.stringify, the way
 * every writer of public/ast writes it, and the raw .json beside the .gz is rewritten too when it exists
 * (as scripts/stamp-ast-urls.mjs does).
 *
 * Both resolvers are modelled over the SHIPPED core.json (the importer reads its own `db` mid-run) and, for
 * the own-slug step, over the three sub-page kinds only — enough for every pointer the rule can touch.
 *
 * Reads public/core.json, public/idmap.json (import-core-v2's own idMap, written by nothing else) and the
 * Archives export (AON_EXPORT, as every importer does). Deterministic and idempotent: a second run plans 0.
 *
 *   node scripts/repair-subpage-link-refs.mjs           # dry run: prints the plan
 *   node scripts/repair-subpage-link-refs.mjs --write   # rewrites the affected public/ast trees
 *
 * Run 2026-10-16: see scripts/lib/ast-link-ref.mjs for what it moved. scripts/ast-link-carrier-check.mjs
 * (npm run verify) holds the result.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReprintIndex, EXPORT_DIR } from './lib/reprint.mjs';
import { isPageLink, subPageRef, SUBPAGE_BUCKET, SUBPAGE_KINDS } from './lib/ast-link-ref.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AST_DIR = process.env.AST_DIR || join(ROOT, 'public/ast');
const WRITE = process.argv.includes('--write');

const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

if (!existsSync(EXPORT_DIR)) {
  console.error(`repair-subpage-link-refs: no Archives export at ${EXPORT_DIR} (set AON_EXPORT)`);
  process.exit(2);
}
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const idMap = JSON.parse(readFileSync(join(ROOT, 'public/idmap.json'), 'utf8'));
const live = (h) => !!h && !!core[h.bucket]?.[h.slug];

/* Every export document's category, name and supersession pointer (the fields resolveTo reads). */
const meta = new Map();
for (const f of readdirSync(EXPORT_DIR).filter((x) => x.endsWith('.json'))) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(EXPORT_DIR, f), 'utf8')); } catch { continue; }
  for (const [id, d] of Object.entries(raw.docs ?? {})) {
    if (!meta.has(id)) meta.set(id, { category: d?.category ?? raw.category, name: d?.name ?? '', by: d?.superseded_by ?? null });
  }
}
const reprints = loadReprintIndex(EXPORT_DIR);

/* import-core-v2 supIdInfo, for the documents this repair can touch: a pruned sub-page, keyed by its own
 * bucket and name slug. */
const ownOf = (to) => {
  const m = meta.get(String(to));
  return m && m.by && SUBPAGE_KINDS.has(String(m.category))
    ? { id: String(to), bucket: SUBPAGE_BUCKET[m.category], slug: slugify(m.name), by: String(m.by) } : null;
};

/* The resolver as it was before the fix (import-core-v2 resolveTo, steps 1-3), over the shipped core.json. */
const oldResolve = (to) => {
  const hit = idMap[to];
  if (hit) return `${hit.bucket}:${hit.slug}`;
  let by = meta.get(String(to))?.by ?? null;
  for (let guard = 0; by && guard < 8; guard++) {
    const win = idMap[by];
    if (live(win)) return `${win.bucket}:${win.slug}`;
    by = meta.get(String(by))?.by ?? null;
  }
  const own = ownOf(to);
  return own && live(own) ? `${own.bucket}:${own.slug}` : null;
};

/* The resolver as it is now (import-core-v2 resolveTo with the sub-page rule): a page-link pointer is never
 * followed, at the first hop or later. */
const pageLink = (id) => isPageLink(meta.get(String(id)), meta.get(String(meta.get(String(id))?.by ?? '')));
const newResolve = (to) => {
  const hit = idMap[to];
  if (hit) return `${hit.bucket}:${hit.slug}`;
  const own = ownOf(to);
  if (own && pageLink(to)) return subPageRef(to, own, { idMap, live, reprints });
  let id = meta.get(String(to))?.by ? String(to) : null;
  for (let guard = 0; id && guard < 8 && !pageLink(id); guard++) {
    const by = meta.get(id).by;
    const win = idMap[by];
    if (live(win)) return `${win.bucket}:${win.slug}`;
    id = meta.get(String(by))?.by ? String(by) : null;
  }
  return own && live(own) ? `${own.bucket}:${own.slug}` : null;
};

const plan = new Map(); // "to from -> to" -> { n, where }
let changed = 0;
const dirty = [];
for (const f of readdirSync(AST_DIR).filter((x) => x.endsWith('.json.gz')).sort()) {
  const bucket = f.slice(0, -'.json.gz'.length);
  const trees = JSON.parse(gunzipSync(readFileSync(join(AST_DIR, f))).toString('utf8'));
  let here = 0;
  for (const [key, tree] of Object.entries(trees)) {
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.to != null && 'ref' in n) {
        const next = newResolve(n.to);
        if (next !== n.ref && n.ref === oldResolve(n.to)) {
          const k = `${n.to}  ${n.ref} -> ${next}`;
          const e = plan.get(k) ?? plan.set(k, { n: 0, where: [] }).get(k);
          e.n++;
          if (e.where.length < 6) e.where.push(`${bucket}/${key}`);
          n.ref = next;
          here++;
        }
      }
      if (n.c) walk(n.c);
    };
    walk(tree);
  }
  if (here) {
    changed += here;
    dirty.push(`${bucket} (${here})`);
    if (WRITE) {
      const json = JSON.stringify(trees);
      writeFileSync(join(AST_DIR, f), gzipSync(json, { level: 9 }));
      if (existsSync(join(AST_DIR, `${bucket}.json`))) writeFileSync(join(AST_DIR, `${bucket}.json`), json);
    }
  }
}

for (const [k, e] of [...plan].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) console.log(`  ${String(e.n).padStart(3)}  ${k}   @ ${e.where.join(', ')}`);
console.log(`repair-subpage-link-refs: ${changed} link(s), ${plan.size} target document(s), trees: ${dirty.join(', ') || 'none'}${WRITE ? ' — WRITTEN' : ' — dry run (pass --write)'}`);
