/**
 * Point the mis-stamped subclass options at their real pages.
 *
 * Twenty player-selectable class features were rendering an unrelated AoN document in full — a pregen
 * "Class Sample Build", a 1 gp mirror from the equipment list, a background, a Kingmaker army action, an
 * NPC stat block. `scripts/classfeature-page-check.mjs` finds them; this repairs them.
 *
 * THE TARGET IS NOT GUESSED. Two independent facts have to agree before anything is written:
 *
 *   1. HOW THE BUILDER REACHES IT. Every one of these is offered by a class — `alchemist.subclass
 *      "Research Field"`, `rogue.subclass "Racket"`, `thaumaturge.extraChoices "Implements"`. That
 *      group name says which kind of thing the record is, and therefore which bucket holds its page.
 *      This matters: `time` has FOUR candidates (a domain, a draconic exemplar, a rules page and a
 *      sidebar) and only `oracle.subclass "Mystery"` picks the right one.
 *   2. THE PAGE'S OWN BADGE. AoN labels the target "Oracle Mystery", "Rogue Racket", "Thaumaturge
 *      Implement". If the badge does not match the group, nothing is written.
 *
 * Both the record's `aonId` AND its display tree are rewritten. Repointing the id alone would change
 * nothing a reader sees: `public/ast/classFeatures.json` is keyed by slug and still holds the wrong
 * tree, and DescBody renders the tree in preference to the description.
 *
 * The overlay row is what survives `npm run data`; core.json and the ast file are written so the fix is
 * live now. (Same both-files rule as apply-import-damaged-text.mjs.)
 *
 *   node scripts/fix-classfeature-pages.mjs            # report only
 *   node scripts/fix-classfeature-pages.mjs --write
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { buildDocIndex } from './lib/aonid-categories.mjs';
import { badgeOf, isForeignToClassFeature, GROUP_BUCKET, offeredBy } from './lib/ast-badge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const WRITE = process.argv.includes('--write');

const CORE = join(ROOT, 'public/core.json');
const core = JSON.parse(readFileSync(CORE, 'utf8'));
const idMap = existsSync(join(ROOT, 'public/idmap.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'public/idmap.json'), 'utf8')) : {};



const readAst = (b) => {
  for (const p of [`public/ast/${b}.json`, `public/ast/${b}.json.gz`]) {
    const f = join(ROOT, p);
    if (!existsSync(f)) continue;
    try { return JSON.parse(p.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8')); } catch { /* next */ }
  }
  return null;
};

const docIndex = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });
const docCache = new Map();
const fullDoc = (aonId) => {
  const hit = docIndex.get(aonId);
  if (!hit) return null;
  if (!docCache.has(hit.cat)) {
    try { docCache.set(hit.cat, JSON.parse(readFileSync(join(EXPORT, hit.cat + '.json'), 'utf8')).docs ?? {}); }
    catch { docCache.set(hit.cat, {}); }
  }
  return docCache.get(hit.cat)[aonId] ?? null;
};

const resolveTo = (to) => {
  const hit = idMap[to];
  return hit && core[hit.bucket]?.[hit.slug] ? `${hit.bucket}:${hit.slug}` : null;
};
const resolveAst = (node) => {
  if (!node || typeof node !== 'object') return node;
  const out = Array.isArray(node) ? [] : {};
  for (const k in node) {
    if (k === 'to') { out.ref = resolveTo(node.to); out.to = node.to; }
    else if (k === 'c') out.c = node.c.map(resolveAst);
    else out[k] = node[k];
  }
  return out;
};

/* The one record whose page exists but is named differently: AoN files summoner eidolons under the
 * bare type ("Beast"), while our slug is `beast-eidolon`, so name-matching reached a creature instead. */
const EIDOLON_SUFFIX = /-eidolon$/;

const cfAst = readAst('classFeatures') ?? {};
const offers = offeredBy(core);
const plan = [], skipped = [];

for (const [id, rec] of Object.entries(core.classFeatures ?? {})) {
  const node = cfAst[id];
  if (!node) continue;
  const badge = badgeOf(node);
  if (!badge) continue;
  if (!isForeignToClassFeature(badge)) continue;

  const offer = offers.get(id);
  if (!offer) { skipped.push({ id, badge, why: 'no class offers it — not a subclass option' }); continue; }
  const wantBucket = GROUP_BUCKET[offer.group.toLowerCase()];
  if (!wantBucket) { skipped.push({ id, badge, why: `group "${offer.group}" maps to no bucket` }); continue; }

  // The eidolon pages live only in the export, keyed by the bare type name.
  if (wantBucket === 'eidolon') {
    const bare = rec.name.replace(/\s+Eidolon$/i, '').trim().toLowerCase();
    let hit = null;
    for (const [docId, d] of docIndex) {
      if (d.cat === 'eidolon' && d.name.trim().toLowerCase() === bare) { hit = docId; break; }
    }
    if (!hit) { skipped.push({ id, badge, why: `no eidolon document named "${bare}"` }); continue; }
    const doc = fullDoc(hit);
    if (!doc?.ast) { skipped.push({ id, badge, why: `${hit} carries no ast` }); continue; }
    plan.push({ id, from: rec.aonId, to: hit, via: `export eidolon "${doc.name}"`, group: offer.group, cls: offer.cls, ast: resolveAst(doc.ast) });
    continue;
  }

  const alt = core[wantBucket]?.[id];
  if (!alt?.aonId) { skipped.push({ id, badge, why: `${wantBucket}/${id} does not exist` }); continue; }
  const altAst = readAst(wantBucket)?.[id];
  if (!altAst) { skipped.push({ id, badge, why: `${wantBucket}/${id} has no display tree` }); continue; }
  const altBadge = badgeOf(altAst);
  if (!altBadge) { skipped.push({ id, badge, why: `${wantBucket}/${id} tree has no badge to check` }); continue; }
  plan.push({ id, from: rec.aonId, to: alt.aonId, via: `${wantBucket}/${id}`, group: offer.group, cls: offer.cls, badge: altBadge, ast: altAst });
}

console.log(`${plan.length} repoint(s) confirmed by BOTH the offering group and the target badge`);
if (plan.length) {
  console.log(`\n${'record'.padEnd(20)} ${'was'.padEnd(20)} ${'becomes'.padEnd(20)} offered by`);
  for (const p of plan) {
    console.log(`${p.id.padEnd(20)} ${String(p.from).padEnd(20)} ${String(p.to).padEnd(20)} ${p.cls}.${p.group}${p.badge ? `  ->  ${p.badge}` : `  ->  ${p.via}`}`);
  }
}
if (skipped.length) {
  console.log(`\n${skipped.length} left alone:`);
  for (const s of skipped) console.log(`  ${s.id.padEnd(24)} ${String(s.badge).padEnd(20)} ${s.why}`);
}

if (!WRITE) { console.log('\nreport only — pass --write to apply.'); process.exit(0); }
if (!plan.length) { console.log('\nnothing to write.'); process.exit(0); }

const rows = readBackfill(ROOT);
for (const p of plan) {
  core.classFeatures[p.id].aonId = p.to;
  cfAst[p.id] = p.ast;
  const i = rows.findIndex((r) => r.category === 'classFeatures' && r.id === p.id && r.field === 'aonId');
  const row = { category: 'classFeatures', id: p.id, field: 'aonId', value: p.to };
  if (i >= 0) rows[i] = row; else rows.push(row);
}

const ordered = {};
for (const s of Object.keys(cfAst).sort()) ordered[s] = cfAst[s];
const json = JSON.stringify(ordered);
writeFileSync(join(ROOT, 'public/ast/classFeatures.json'), json);
writeFileSync(join(ROOT, 'public/ast/classFeatures.json.gz'), gzipSync(json, { level: 9 }));
writeFileSync(CORE, JSON.stringify(core));
writeBackfill(ROOT, rows);
console.log(`\nwrote public/core.json, public/ast/classFeatures.json(+gz) and the overlay (${plan.length} repoints)`);
