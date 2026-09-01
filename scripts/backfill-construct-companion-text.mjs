/*
 * The construct companion had no text to read.
 *
 * readable-record-check.mjs found two records in the whole corpus with no description, no ast and no
 * `note`. This is one of them. Its stat block is complete — abilities, speeds, two attacks — but the
 * prose that says what a construct companion IS was missing, so opening it on the Companions tab
 * showed numbers and nothing else.
 *
 * ⚠ RECOVERED, NOT WRITTEN, and the join is the interesting part. The record has no aonId, so there is
 * no page to join on: the Archives file this prose as a RULES page (rules-1600, Guns & Gears
 * Remastered pg. 32) rather than on the companion itself, which is why the ordinary mirror join in
 * restore-empty-descriptions.mjs cannot reach it. The text below is that page's, verbatim — it is
 * asserted against the live mirror at run time rather than trusted, so a mirror refresh that changes
 * the wording fails loudly instead of leaving a stale hand-copy behind.
 *
 * Its empty `support` and `maneuver` are left exactly as they are: those are ANIMAL companion features
 * and a construct companion has neither, so empty is correct. CompanionsTab renders both behind a
 * truthiness check, so nothing shows.
 *
 *   node scripts/backfill-construct-companion-text.mjs [--write]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const MIRROR_PAGE = 'C:/wonderers guide/aon-2e-archive/data/by-category/rules/rules-1600.json';

const TEXT =
  'A construct companion is a loyal, semi-sentient construct who follows your orders obediently and ' +
  'is roughly as intelligent as an animal. Your construct companion has the minion trait, and you ' +
  'gain the Command a Construct action. If your companion is destroyed, you can spend 1 day of ' +
  'downtime and attempt a Crafting check with a high DC for your level. On a success, you rebuild ' +
  'your companion. You can have only one construct companion at a time, and you can have either a ' +
  'construct companion or an animal companion, but not both.';

/* Assert the hand-copy still matches the mirror. A quoted paragraph that nothing checks is a paragraph
 * that drifts silently away from its source. */
if (!existsSync(MIRROR_PAGE)) {
  console.error(`mirror page missing: ${MIRROR_PAGE} — cannot verify the text, refusing to write.`);
  process.exit(2);
}
const mirror = JSON.parse(readFileSync(MIRROR_PAGE, 'utf8'));
const flat = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
if (!flat(mirror.text).includes(flat(TEXT))) {
  console.error('construct-companion: the mirror no longer contains this text verbatim.\n');
  console.error(`mirror: ${flat(mirror.text).slice(0, 400)}\n`);
  console.error('Re-copy from the page rather than editing the assertion away.');
  process.exit(1);
}
console.log(`verified against ${MIRROR_PAGE} ("${mirror.name}")`);

const row = { category: 'animalCompanions', id: 'construct-companion', field: 'description', value: TEXT };
const rows = readBackfill(ROOT);
const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
console.log(at >= 0 ? 'row already present — will replace' : 'row is new');
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
if (at >= 0) rows[at] = row; else rows.push(row);
writeBackfill(ROOT, rows);
console.log(`wrote (${rows.length} rows).`);
