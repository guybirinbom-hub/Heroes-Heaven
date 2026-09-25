/*
 * Stamp every shipped description page with its Archives of Nethys address, so the popup can link to it.
 *
 * Every page tree in public/ast/<bucket>.json(.gz) carries `aon`, the export document it was built from
 * (scripts/ast-provenance-check.mjs). That id is not an address: `sidebar-1075` lives at
 * /Classes.aspx?ID=2 (the Barbarian page it is printed on), `class-feature-2` at /Classes.aspx?ID=1,
 * `equipment-257-bonus-103` at /Equipment.aspx?ID=257, and a category page has no ID at all. The export
 * document's own `url` is the address, so this copies it onto the tree root as `url`; AstRenderer
 * turns it into the header's Archives link.
 *
 * The LAST step of `npm run data`: every writer of public/ast rewrites whole buckets, so it runs after
 * all of them. A tree left without its address fails scripts/ast-provenance-check.mjs — re-run this
 * after any script that rewrites a bucket on its own (import-siege-and-gaps, fix-aonid-collisions, …).
 *
 *   node scripts/stamp-ast-urls.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_DIR } from './lib/reprint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AST = join(ROOT, 'public/ast');

const urlOf = new Map();
for (const f of readdirSync(EXPORT_DIR).filter((x) => x.endsWith('.json'))) {
  for (const [id, d] of Object.entries(JSON.parse(readFileSync(join(EXPORT_DIR, f), 'utf8')).docs ?? {})) {
    if (d?.url) urlOf.set(String(id), String(d.url));
  }
}

let pages = 0, changed = 0, noDoc = 0;
const unknown = [];
for (const f of readdirSync(AST).filter((x) => x.endsWith('.json.gz'))) {
  const bucket = f.slice(0, -8);
  const trees = JSON.parse(gunzipSync(readFileSync(join(AST, f))).toString('utf8'));
  let dirty = false;
  for (const [s, t] of Object.entries(trees)) {
    if (!t || typeof t !== 'object' || !t.aon) continue;
    pages++;
    const url = urlOf.get(String(t.aon));
    if (!url) { noDoc++; if (unknown.length < 10) unknown.push(`${bucket}/${s} (${t.aon})`); continue; }
    if (t.url !== url) { t.url = url; dirty = true; changed++; }
  }
  if (!dirty) continue;
  const json = JSON.stringify(trees);
  writeFileSync(join(AST, f), gzipSync(json, { level: 9 }));
  // The raw file beside it is the local dev fallback (astStore.ts); keep it the same page.
  if (existsSync(join(AST, `${bucket}.json`))) writeFileSync(join(AST, `${bucket}.json`), json);
}
console.log(`stamp-ast-urls: ${pages} page(s) with provenance, ${changed} address(es) written, ${noDoc} whose document the export no longer has.`);
if (unknown.length) console.log(`  e.g. ${unknown.join(', ')}`);
