/**
 * Point every record at the right AoN page, or at none.
 *
 * `aonId` is stamped by NAME, so a record whose name is shared with something else silently adopts that
 * thing's page:
 *
 *     items/coral         gemstone, 5 gp   ->  draconic-exemplar-8   (the Coral dragon)
 *     items/jet           gemstone, 5 gp   ->  familiar-ability-94   (the Jet familiar ability)
 *     items/sard          gemstone, 25 sp  ->  creature-792          (a creature named Sard)
 *
 * None of the three holds any prose, so nothing wrong was DISPLAYED — the damage is the "view on AoN"
 * destination, plus the standing risk that a prose top-up keyed on aonId would print dragon rules on a
 * gemstone. The archive has no gemstone entries, so these links are deleted, not repointed.
 *
 * The opposite case matters more: six records had NO usable link when the right page existed all along
 * (three barding rows, two treat rows, one meal), and were the last records in the database that could
 * draw nothing at all. Those are repointed, and the price evidence for one of them turned up a wrong
 * price on our side. Prefer a repoint over a deletion whenever the correct page can be identified.
 *
 * Writing through the overlay (`scripts/data/effect-backfill.json`) is what makes all of this survive
 * `npm run data`, which rebuilds core.json from the mirror and would otherwise re-stamp by name again.
 *
 * Two guards keep it from recurring, both in `npm run verify`:
 *   scripts/aonid-integrity.mjs  fails on a link into a category the bucket may not point into
 *   scripts/render-check.mjs     fails on a record that would draw nothing at all
 *
 *   node scripts/fix-aonid-collisions.mjs            # report only
 *   node scripts/fix-aonid-collisions.mjs --write
 *   node scripts/backfill-ast-edition.mjs --write    # then pull the newly-linked prose + trees
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { buildDocIndex } from './lib/aonid-categories.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/** Verified one at a time against the archive: no gemstone page exists to repoint these to. */
const COLLISIONS = [
  { category: 'items', id: 'coral', was: 'draconic-exemplar-8' },
  { category: 'items', id: 'jet', was: 'familiar-ability-94' },
  { category: 'items', id: 'sard', was: 'creature-792' },
];

/*
 * REPOINTS — a record with no usable provenance whose real page does exist.
 *
 * These seven were the last records in the database that could draw nothing at all: no prose, no ast,
 * and either no aonId or a wrong one. Each page below was confirmed by reading the document and
 * matching the PRICE, not the name alone:
 *
 *   light-barding                  10 gp  = equipment-2778-2558 @ 1000 cp
 *   heavy-barding-small-or-medium   25 gp  = equipment-2778-2560 @ 2500 cp
 *   heavy-barding-large            (see PRICE_FIXES — ours was wrong) = equipment-2778-2561 @ 5000 cp
 *
 * `aon-meal-poor` was in COLLISIONS on the first pass — its `trait-466` link was wrong, so deleting it
 * was right as far as it went, but the real page `equipment-2767-2537` "Meal (Poor)" exists with 458
 * characters of prose. Repointing beats deleting whenever the correct page can be identified.
 */
const REPOINTS = [
  { category: 'items', id: 'light-barding', to: 'equipment-2778-2558', page: 'Barding (Light; Small or Medium)' },
  { category: 'items', id: 'heavy-barding-small-or-medium', to: 'equipment-2778-2560', page: 'Barding (Heavy; Small or Medium)' },
  { category: 'items', id: 'heavy-barding-large', to: 'equipment-2778-2561', page: 'Barding (Heavy; Large)' },
  { category: 'items', id: 'treat-standard', to: 'equipment-1705-1524', page: 'Treats (Standard)' },
  { category: 'items', id: 'treat-unique', to: 'equipment-1705-1525', page: 'Treats (Unique)' },
  { category: 'items', id: 'aon-meal-poor', to: 'equipment-2767-2537', page: 'Meal (Poor)' },
  /*
   * The battering ram was rendering a Bestiary 3 page about herd animals (creature-family-256) — the
   * only one of 62 siege weapons whose header badge was not a siege-weapon badge.
   *
   * The target is siege-weapon-70, NOT the siege-weapon-70-6 variant and NOT the Remastered
   * siege-weapon-3: our other 58 siege weapons all use a HEAD id from the legacy Guns & Gears printing,
   * and their ids run 69, 71, 76, 82 — the ram is exactly the gap at 70. The document confirms it:
   * Guns & Gears pg. 74, "Crew 6", "portable", matching our record's crew and traits.
   */
  { category: 'siegeWeapons', id: 'ram', to: 'siege-weapon-70', page: 'Battering Ram', refreshAst: true },

  // The same five graded items: point each at its OWN variant rather than the family head, so the
  // "view on AoN" link and any future top-up read the document whose numbers the record actually holds.
  { category: 'items', id: 'talisman-cord', to: 'equipment-883-866', page: 'Talisman Cord (level 10)', refreshAst: true },
  { category: 'items', id: 'fey-dragonet-liqueur', to: 'equipment-2085-1843', page: 'Fey Dragonet Liqueur (level 12)', refreshAst: true },
  { category: 'items', id: 'furnace-of-endings', to: 'equipment-2552-2299', page: 'Furnace of Endings (level 5)', refreshAst: true },
  { category: 'items', id: 'atmospheric-staff', to: 'equipment-2576-2328', page: 'Atmospheric Staff (level 8)', refreshAst: true },
  { category: 'items', id: 'irritating-seedpod', to: 'equipment-3735-3517', page: 'Irritating Seedpod (level 7)', refreshAst: true },
];

/*
 * Prices that disagree with the page they came from. AoN stores price in COPPER.
 *   heavy-barding-large  ours 25 gp  vs  equipment-2778-2561 @ 5000 cp = 50 gp
 * Found by using the price as the evidence for the repoint above: the Heavy/Large row is 50 gp and the
 * Heavy/Small-or-Medium row is 25 gp, so ours had been given the smaller size's price.
 */
const PRICE_FIXES = [
  { category: 'items', id: 'heavy-barding-large', field: 'price', value: { gp: 50 }, was: { gp: 25 } },

  /*
   * FIVE ITEMS WEARING THE FAMILY HEAD'S LEVEL.
   *
   * AoN publishes a graded family as a head document plus one variant per grade. The head carries the
   * LESSER grade's level and no price at all. These five took their price from the un-suffixed middle
   * variant and their level from the head, so they shipped as a cheap low-level item priced like a
   * mid-grade one:
   *
   *     talisman-cord   level 4, 850 gp     equipment-883-866  is level 10 @ 85,000 cp = 850 gp
   *     atmospheric-staff  level 4, 480 gp  equipment-2576-2328 is level 8 @ 48,000 cp = 480 gp
   *
   * The price is the evidence and it already matches the variant exactly, in all five cases — so only
   * the level (and the id) were taken from the wrong document. Every grade sibling
   * (-lesser / -greater / -major) already ships with the correct level and price, which is what makes
   * the un-suffixed record's level obviously wrong rather than a judgement call.
   *
   * This is not cosmetic. itemUses.ts derives a staff's daily charges from `level`, so Atmospheric
   * Staff was giving 4 charges a day instead of 8; the level also gates slot eligibility and the
   * builder's level filter.
   */
  { category: 'items', id: 'talisman-cord', field: 'level', value: 10, was: 4 },
  { category: 'items', id: 'fey-dragonet-liqueur', field: 'level', value: 12, was: 7 },
  { category: 'items', id: 'furnace-of-endings', field: 'level', value: 5, was: 2 },
  { category: 'items', id: 'atmospheric-staff', field: 'level', value: 8, was: 4 },
  { category: 'items', id: 'irritating-seedpod', field: 'level', value: 7, was: 3 },
];

/*
 * NOT FIXED — reported so it is not mistaken for done.
 *
 * items/splendid-pyschopomp-mask: our name misspells "Psychopomp", and our price (50 gp) is ten times
 * AoN's Psychopomp Mask (equipment-964 @ 500 cp = 5 gp), which has no variants and no "Splendid"
 * version anywhere in the archive. Two mismatches means it is not that item, and guessing a link would
 * put someone else's rules on it. Left without provenance, which is the honest state.
 */
const UNRESOLVED = ['items/splendid-pyschopomp-mask'];

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const rows = readBackfill(ROOT);

/*
 * A repoint often has to replace the DISPLAY TREE as well as the id. public/ast/<bucket>.json is keyed
 * by slug, so a record that already has a tree keeps rendering the old document however its aonId
 * changes — the battering ram would still have shown a herd-animal page. Entries marked
 * `refreshAst` pull the new document's tree from the export and overwrite it.
 */
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const astDirty = new Map();   // bucket -> tree object to write
let docIndex = null;
const idMap = existsSync(join(ROOT, 'public/idmap.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'public/idmap.json'), 'utf8')) : {};
const resolveAst = (node) => {
  if (!node || typeof node !== 'object') return node;
  const out = Array.isArray(node) ? [] : {};
  for (const k in node) {
    if (k === 'to') { const h = idMap[node.to]; out.ref = h && core[h.bucket]?.[h.slug] ? `${h.bucket}:${h.slug}` : null; out.to = node.to; }
    else if (k === 'c') out.c = node.c.map(resolveAst);
    else out[k] = node[k];
  }
  return out;
};
function refreshAst(bucket, id, aonId) {
  docIndex ??= buildDocIndex(EXPORT, { readFileSync, readdirSync, join });
  const hit = docIndex.get(aonId);
  if (!hit) return `no document ${aonId}`;
  let docs;
  try { docs = JSON.parse(readFileSync(join(EXPORT, hit.cat + '.json'), 'utf8')).docs ?? {}; } catch { return 'unreadable category'; }
  const tree = docs[aonId]?.ast;
  if (!tree) return `${aonId} carries no ast`;
  if (!astDirty.has(bucket)) {
    let cur = {};
    for (const p of [`public/ast/${bucket}.json`, `public/ast/${bucket}.json.gz`]) {
      const f = join(ROOT, p);
      if (!existsSync(f)) continue;
      try { cur = JSON.parse(p.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8')); break; } catch { /* next */ }
    }
    astDirty.set(bucket, cur);
  }
  astDirty.get(bucket)[id] = resolveAst(tree);
  return null;
}

let added = 0, skipped = 0;

/** Upsert one overlay row, and mirror it onto the in-memory record so core.json is written too. */
function set(category, id, field, value, note) {
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field);
  const row = { category, id, field, value };
  if (i >= 0) {
    if (JSON.stringify(rows[i]) === JSON.stringify(row)) { console.log(`  ok   ${category}/${id} ${field} — already in the overlay`); return false; }
    rows[i] = row;
  } else rows.push(row);
  if (value === null) delete core[category][id][field];
  else core[category][id][field] = value;
  console.log(`  set  ${(category + '/' + id).padEnd(38)} ${field} -> ${JSON.stringify(value)}   ${note ?? ''}`);
  added++;
  return true;
}

console.log('collisions — no correct page exists, so the link is removed:');
for (const c of COLLISIONS) {
  const rec = core[c.category]?.[c.id];
  if (!rec) { console.log(`  skip ${c.category}/${c.id} — no such record`); skipped++; continue; }
  // Only act while the record still carries the id we diagnosed (or has already been cleared).
  if (rec.aonId != null && rec.aonId !== c.was) { console.log(`  skip ${c.category}/${c.id} — aonId is now "${rec.aonId}", expected "${c.was}"`); skipped++; continue; }
  set(c.category, c.id, 'aonId', null, `(was ${c.was})`);
}

console.log('\nrepoints — the correct page exists and was confirmed by price:');
for (const r of REPOINTS) {
  const rec = core[r.category]?.[r.id];
  if (!rec) { console.log(`  skip ${r.category}/${r.id} — no such record`); skipped++; continue; }
  if (rec.aonId === r.to) { console.log(`  ok   ${r.category}/${r.id} — already points at ${r.to}`); continue; }
  set(r.category, r.id, 'aonId', r.to, `= "${r.page}"`);
  if (r.refreshAst) {
    const err = refreshAst(r.category, r.id, r.to);
    console.log(err ? `       ast NOT refreshed — ${err}` : `       display tree refreshed from ${r.to}`);
  }
}

console.log('\nprices that disagreed with their own page:');
for (const p of PRICE_FIXES) {
  const rec = core[p.category]?.[p.id];
  if (!rec) { console.log(`  skip ${p.category}/${p.id} — no such record`); skipped++; continue; }
  if (JSON.stringify(rec[p.field]) === JSON.stringify(p.value)) { console.log(`  ok   ${p.category}/${p.id} — already ${JSON.stringify(p.value)}`); continue; }
  if (JSON.stringify(rec[p.field]) !== JSON.stringify(p.was)) {
    console.log(`  skip ${p.category}/${p.id} — ${p.field} is ${JSON.stringify(rec[p.field])}, expected ${JSON.stringify(p.was)}; re-diagnose`);
    skipped++; continue;
  }
  set(p.category, p.id, p.field, p.value, `(was ${JSON.stringify(p.was)})`);
}

if (UNRESOLVED.length) {
  console.log('\nleft unresolved on purpose (see the header for why):');
  for (const u of UNRESOLVED) console.log(`  ${u}`);
}

console.log(`\n${added} change(s), ${skipped} skipped; overlay ${rows.length} rows.`);
if (!WRITE) { console.log('report only — pass --write to apply.'); process.exit(0); }
if (added) {
  writeBackfill(ROOT, rows);
  writeFileSync(join(ROOT, 'public/core.json'), JSON.stringify(core));
  for (const [bucket, tree] of astDirty) {
    const ordered = {};
    for (const k of Object.keys(tree).sort()) ordered[k] = tree[k];
    const json = JSON.stringify(ordered);
    writeFileSync(join(ROOT, `public/ast/${bucket}.json`), json);
    writeFileSync(join(ROOT, `public/ast/${bucket}.json.gz`), gzipSync(json, { level: 9 }));
    console.log(`  rewrote public/ast/${bucket}.json(+gz)`);
  }
  console.log('wrote scripts/data/effect-backfill.json and public/core.json');
  console.log('now re-run: node scripts/backfill-ast-edition.mjs --write   (to pull the newly-linked prose + trees)');
} else console.log('nothing to write.');
