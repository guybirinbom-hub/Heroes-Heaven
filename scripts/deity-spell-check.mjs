/*
 * DEITY CLERIC-SPELL FRESHNESS — the guard for batch 24's Jaidi defect.
 *
 * The defect class: a deity's stored `spells` was taken from the LEGACY twin of the page its own
 * aonId names. Jaidi's aonId is deity-406 (Divine Mysteries: Protector Tree / Wall of Thorns /
 * Nature's Pathway) and the record shipped deity-155's Gods & Magic trio (Temporary Tool /
 * Shape Wood / Wall of Thorns). Two spells wrong out of three, and the record LOOKED sourced.
 *
 * The check, per deity with an aonId and a mirror page:
 *   FAIL when the stored list does NOT slug-match the page's own `cleric_spell` AND DOES match the
 *   `cleric_spell` of a page named by the record's `legacy_id` — i.e. provably the legacy list.
 *   Anything else (matches own page; matches neither — a hand-authored or renamed list) passes:
 *   this guard proves one specific provenance error, not general freshness.
 *
 * Exit 1 with the work list on failure. Wired into `npm run verify`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/deity';

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const slug = (s) => String(s ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const page = (aonId) => {
  const p = join(MIRROR, `${aonId}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const clericSlugs = (rec) => (Array.isArray(rec?.cleric_spell) ? rec.cleric_spell.map(slug) : []);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const bad = [];
let checked = 0;
for (const [id, d] of Object.entries(core.deities ?? {})) {
  const stored = (d.spells ?? []).map(slug);
  if (!stored.length || !/^deity-\d+$/.test(String(d.aonId ?? ''))) continue;
  const own = page(d.aonId);
  if (!own) continue;
  const ownSpells = clericSlugs(own);
  if (!ownSpells.length) continue;
  checked++;
  if (sameSet(stored, ownSpells)) continue;
  for (const leg of Array.isArray(own.legacy_id) ? own.legacy_id : []) {
    const legSpells = clericSlugs(page(leg));
    if (legSpells.length && sameSet(stored, legSpells)) {
      bad.push({ id, aonId: d.aonId, legacy: leg, stored: d.spells, printed: own.cleric_spell });
      break;
    }
  }
}

if (bad.length) {
  console.error(`deity-spell-check: ${bad.length} deity record(s) carry the LEGACY page's cleric spells instead of their own page's:`);
  for (const b of bad) console.error(`  ${b.id} (${b.aonId}, legacy ${b.legacy}): stored [${b.stored.join(', ')}] — printed [${b.printed.join(', ')}]`);
  console.error('Fix each via a scripts/data/effect-backfill.json row (the Jaidi precedent), never by hand in core.json.');
  process.exit(1);
}
console.log(`deity-spell-check: ok — ${checked} deity spell lists checked against their own AoN page, none is the legacy twin's.`);
