/*
 * GIVE EVERY CONDITION ITS FULL PRINTED TEXT, in both apps.
 *
 * Owner, 2026-09-15: "the descriptions are shortened versions I don't like; I want the full Archives
 * description so I know exactly what it does."
 *
 * WHERE THE SHORT TEXT CAME FROM. Heroes Heaven's conditions are an OVERLAID bucket: they existed in
 * the Foundry reference, so `overlayContent` in import-core-v2.mjs adopts the Archives NAME and facets
 * and keeps the old body — descriptions are never overlaid. Every regen therefore re-shipped Foundry's
 * abridgement, which drops the Archives sidebars whole (`Persistent Damage`: 596 characters of a
 * 3,433-character entry, losing the entire "Persistent Damage Rules" aside) and lost its inline
 * `@Check[flat|dc:15]` to the cleaner class of project_hh_dropped_inline_values ("roll a to see if you
 * recover"). `sickened` shipped with NO description at all.
 *
 * WHY AN OVERLAY ROW RATHER THAN A NEW STEP IN `npm run data`. The overlay IS a step of that chain:
 * import-core-v2.mjs calls applyBackfill() before split-descriptions.mjs, so a `description` row lands
 * in core.json and the split moves it into core-descriptions.json — the same route the 289 rows already
 * there take. Nothing new runs, nothing re-orders, and the prose survives the next regen, which a fix
 * living only in a side script would not.
 *
 * ⚠ WRITES BOTH FILES, for the reason repair-topup-prose.mjs documents: an overlay row alone never
 * materialises today's artefact, and core-descriptions.json alone does not survive `npm run data`.
 *
 * THE TRACKER's public/data/conditions.json is ALREADY the full Archives text — measured, 98 of 98
 * records carry the printed entry — so it is not rewritten. Four of them (Persistent Damage and
 * Unconscious, in both printings) ship RAW `<ul><li>` markup that the tracker's TagRenderer prints
 * verbatim, and that is repaired here by running the shared plain() over the stored text: it is a
 * no-op on the other 94, which is the property that makes it safe to apply to all of them.
 *
 *   node scripts/backfill-condition-prose.mjs            # report only
 *   node scripts/backfill-condition-prose.mjs --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain } from './lib/aon-plain.mjs';
import { conditionProse, openMirror } from './lib/condition-prose.mjs';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.env.HH_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.env.HH_CORE || join(ROOT, 'public/core.json');
const DESCS = process.env.HH_DESCS || join(ROOT, 'public/core-descriptions.json');
const TRACKER = process.env.HH_TRACKER_CONDITIONS || join(ROOT, 'public/data/conditions.json');
const WRITE = process.argv.includes('--write');

const mirror = openMirror();

// ── Heroes Heaven ───────────────────────────────────────────────────────────
const core = JSON.parse(readFileSync(CORE, 'utf8')).conditions ?? {};
const descFile = JSON.parse(readFileSync(DESCS, 'utf8'));
const descs = (descFile.conditions ??= {});

const hh = [];
const unresolved = [];
for (const [id, rec] of Object.entries(core)) {
  const md = mirror.markdownForRecord(rec);
  if (!md) { unresolved.push(`${id} (aonId ${rec.aonId ?? 'none'})`); continue; }
  const after = conditionProse(md);
  const entry = descs[id];
  const before = (typeof entry === 'string' ? entry : entry?.d) ?? '';
  if (after && after !== before) hh.push({ id, before, after });
}

// ── The tracker ─────────────────────────────────────────────────────────────
const trackerFile = JSON.parse(readFileSync(TRACKER, 'utf8'));
const tracker = [];
for (const rec of trackerFile.condition ?? []) {
  const after = plain(rec.text ?? '');
  if (rec.text && after !== rec.text) tracker.push({ rec, before: rec.text, after });
}

const short = (s) => JSON.stringify(s.length > 90 ? s.slice(0, 90) + '…' : s);
console.log(`Heroes Heaven: ${hh.length} of ${Object.keys(core).length} condition descriptions differ from the printed entry`);
for (const c of hh) console.log(`  ${c.id.padEnd(24)} ${String(c.before.length).padStart(5)} -> ${String(c.after.length).padEnd(5)}  ${short(c.after)}`);
for (const u of unresolved) console.log(`  no mirror document — left alone: ${u}`);
console.log(`\ntracker: ${tracker.length} of ${(trackerFile.condition ?? []).length} stored texts carry markup the renderer prints verbatim`);
for (const c of tracker) console.log(`  ${c.rec.name} [${c.rec.source}]  ${c.before.length} -> ${c.after.length}`);

if (!WRITE) { console.log('\nreport only — pass --write to apply.'); process.exit(0); }
if (!hh.length && !tracker.length) { console.log('\nnothing to write.'); process.exit(0); }

if (hh.length) {
  const rows = readBackfill(ROOT);
  for (const c of hh) {
    const entry = descs[c.id];
    if (entry == null) descs[c.id] = { d: c.after };
    else if (typeof entry === 'string') descs[c.id] = c.after;
    else entry.d = c.after;
    const i = rows.findIndex((r) => r.category === 'conditions' && r.id === c.id && r.field === 'description');
    const row = { category: 'conditions', id: c.id, field: 'description', value: c.after };
    if (i >= 0) rows[i] = row; else rows.push(row);
  }
  writeFileSync(DESCS, JSON.stringify(descFile));
  writeBackfill(ROOT, rows);
  console.log(`\nwrote ${DESCS} and the effect-backfill overlay (${hh.length} descriptions, overlay ${rows.length} rows)`);
}

if (tracker.length) {
  for (const c of tracker) c.rec.text = c.after;
  writeFileSync(TRACKER, JSON.stringify(trackerFile));
  console.log(`wrote ${TRACKER} (${tracker.length} texts de-marked-up)`);
}
