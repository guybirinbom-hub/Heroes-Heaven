/**
 * CAN EVERY RECORD RENDER SOMETHING?
 *
 * Not "does it have a description" — different buckets are drawn by different components, and asking
 * all of them for prose reports 775 false positives:
 *
 *   most buckets   DescriptionModal — draws the `ast` when there is one, else RichText over the plain
 *                  description. Needs ONE of the two.
 *   modes          ModeDetailModal — draws `note` + `modifiers`. Has no description by design; 487 of
 *                  them are app-authored toggles, not archive records.
 *   stances        same shape: a `note` is the whole content.
 *   runes          the item editor draws `actsAs` / `slot` / `price`; equipment runes carry no prose.
 *   siegeWeapons   a stat frame (ac/hp/hardness/attacks), like a creature block.
 *
 * A record fails only when the component that draws it would find nothing at all.
 *
 *   node scripts/render-check.mjs
 *   node scripts/render-check.mjs --bucket items --list
 */
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));

const astFor = (bucket) => {
  for (const p of [`public/ast/${bucket}.json`, `public/ast/${bucket}.json.gz`]) {
    const f = join(ROOT, p);
    if (!existsSync(f)) continue;
    try { return JSON.parse(p.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8')); } catch { /* next */ }
  }
  return null;
};

const nonEmpty = (v) => v != null && (!Array.isArray(v) || v.length > 0) && String(v).trim() !== '';

/*
 * TREASURE has no prose anywhere in PF2e, so prose is the wrong thing to ask it for.
 *
 * The 148 gems and art objects are rows in GM Core's random-treasure tables. Verified in the archive:
 * rules-1111 "Gems" and rules-3229 "Art Objects" are literally `d% | name | Price` — Agate is one cell
 * next to "1d4×5 sp" and nothing else. There is no per-gem description to carry, from AoN or anywhere.
 *
 * Their content is name + level + price + bulk, and each already carries `aonParentId` pointing at the
 * table it came from, so the source is reachable. A treasure row therefore renders when it has a price.
 */
const isTreasure = (r) => r.itemType === 'treasure' || (r.aonParentId === 'rules-1111' || r.aonParentId === 'rules-3229');

/** bucket -> what its own component needs in order to draw anything. */
const RENDERS = {
  items: (r, text, ast) => !!ast || nonEmpty(text) || (isTreasure(r) && (nonEmpty(r.price) || nonEmpty(r.value))),
  modes: (r) => nonEmpty(r.note) || nonEmpty(r.modifiers) || nonEmpty(r.battleForm) || nonEmpty(r.resistances),
  stances: (r) => nonEmpty(r.note) || nonEmpty(r.modifiers),
  runes: (r) => nonEmpty(r.actsAs) || nonEmpty(r.slot) || nonEmpty(r.kind),
  siegeWeapons: (r) => nonEmpty(r.attacks) || nonEmpty(r.ac) || nonEmpty(r.hp),
  animalCompanions: (r, text, ast) => !!ast || nonEmpty(text) || nonEmpty(r.attacks) || nonEmpty(r.abilities),
  services: (r) => nonEmpty(r.price) || nonEmpty(r.note),
  // ⚠ these two spell it `notes`, plural — checking only `note` reported all 7 as blank.
  pets: (r) => nonEmpty(r.notes) || nonEmpty(r.note) || nonEmpty(r.bulk),
  followers: (r) => nonEmpty(r.notes) || nonEmpty(r.note) || nonEmpty(r.price),
};
/** The default: the DescriptionModal path — an ast, or prose to fall back on. */
const byProse = (r, text, ast) => !!ast || nonEmpty(text);

/*
 * The one record with nothing to draw and no honest way to fix it.
 *
 * items/splendid-pyschopomp-mask misspells "Psychopomp", and its 50 gp price is ten times AoN's
 * Psychopomp Mask (equipment-964 @ 500 cp = 5 gp), which has no variants and no "Splendid" version
 * anywhere in the archive. Two mismatches means it is not that item, and linking it anyway would put
 * another item's rules on it. Listed here so the check stays at zero and this stays visible, rather than
 * being papered over by a loosened predicate.
 */
const KNOWN_BLANK = new Set(['items/splendid-pyschopomp-mask']);

const rows = [];
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  const entries = Object.entries(recs).filter(([, r]) => r && typeof r === 'object');
  if (!entries.length) continue;
  const ast = astFor(bucket);
  const can = RENDERS[bucket] ?? byProse;
  const blank = [];
  for (const [id, rec] of entries) {
    const d = descs[bucket]?.[id];
    const text = (typeof d === 'string' ? d : d?.d) ?? rec.description ?? '';
    if (!can(rec, text, ast?.[id]) && !KNOWN_BLANK.has(`${bucket}/${id}`)) blank.push(id);
  }
  rows.push({ bucket, total: entries.length, blank, custom: !!RENDERS[bucket] });
}

rows.sort((a, b) => b.blank.length - a.blank.length);
const bad = rows.filter((r) => r.blank.length);
console.log(`${'bucket'.padEnd(24)} ${'records'.padStart(8)} ${'CANNOT RENDER'.padStart(14)}   drawn by`);
for (const r of rows.filter((x) => x.blank.length || x.custom)) {
  console.log(`${r.bucket.padEnd(24)} ${String(r.total).padStart(8)} ${String(r.blank.length).padStart(14)}   ${r.custom ? 'its own component' : 'DescriptionModal'}`);
}
const totalBlank = rows.reduce((n, r) => n + r.blank.length, 0);
const totalRecs = rows.reduce((n, r) => n + r.total, 0);
console.log(`\n${totalBlank} of ${totalRecs.toLocaleString()} records would draw nothing at all`
  + ` (${KNOWN_BLANK.size} known exception${KNOWN_BLANK.size === 1 ? '' : 's'} excluded — see KNOWN_BLANK).`);

const only = arg('--bucket', null);
if (has('--list') && only) {
  const r = rows.find((x) => x.bucket === only);
  console.log(`\n--- ${only}: blank (${r?.blank.length ?? 0}) ---`);
  for (const id of (r?.blank ?? []).slice(0, 40)) console.log(`  ${id.padEnd(40)} ${core[only][id]?.name ?? ''}`);
}
process.exit(totalBlank ? 1 : 0);
