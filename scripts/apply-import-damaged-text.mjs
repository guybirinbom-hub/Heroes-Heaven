/*
 * Repair descriptions whose printed values were DELETED AT IMPORT.
 *
 * The importer dropped inline numbers and words out of a large number of descriptions, leaving
 * sentences that are grammatical and wrong: Aerial Boomerang "races away from you in a . Each creature
 * in the area takes damage with a save against your class DC", Battle Medicine "The target is then to
 * your Battle Medicine for 1 day". A player reads that and cannot tell what the feat does; the audit
 * reported four of them and the sweep behind it counted many more.
 *
 * ⚠ THE PLAIN `description` IS A LIVE PLAYER SURFACE, not a fallback. MainTab's action popup renders
 * it through RichText with no ast key at all, so this text is what a player actually reads at the
 * table for every owned feat with an action cost.
 *
 * ⚠ WHY THIS WRITES BOTH FILES. The documented shortcut — append an overlay row, then run
 * import-siege-and-gaps.mjs — does NOT materialise a `description`. That sets the value on
 * public/core.json and stops; split-descriptions.mjs then sees a handful of extractable descriptions
 * against 19k already split out, calls it a catastrophic loss and exits rather than writing. So the
 * overlay row is the DURABLE record (it survives `npm run data`) and public/core-descriptions.json is
 * written directly so the repair is live now. Both, or the fix is either invisible or temporary.
 *
 *   node scripts/apply-import-damaged-text.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };

/* The repairs, each transcribed from the AoN mirror. `find` must occur EXACTLY ONCE in the shipped
 * description — a substring that matches twice would repair one and corrupt the other. */
const REPAIRS = [
  {
    category: 'feats', id: 'aerial-boomerang',
    find: 'races away from you in a . Each creature in the area takes damage with a save against your class DC.',
    replace: 'races away from you in a 60-foot line. Each creature in the area takes 2d4 slashing damage with a basic Reflex save against your class DC.',
  },
  {
    category: 'feats', id: 'breath-of-the-dragon-dragonblood',
    find: 'energy in a or a , dealing 1d4 damage.',
    replace: 'energy in a 15-foot cone or a 30-foot line, dealing 1d4 damage.',
  },
  {
    category: 'feats', id: 'battle-medicine',
    find: 'The target is then to your Battle Medicine for 1 day.',
    replace: 'The target is then immune to your Battle Medicine for 1 day.',
  },
  {
    category: 'actions', id: 'treat-wounds',
    find: 'The target is then temporarily to Treat Wounds actions for 1 hour,',
    replace: 'The target is then temporarily immune to Treat Wounds actions for 1 hour,',
  },
];

const DESC_PATH = 'public/core-descriptions.json';
const desc = JSON.parse(readFileSync(join(root, DESC_PATH), 'utf8'));

const applied = [];
for (const r of REPAIRS) {
  const cur = desc[r.category]?.[r.id]?.d;
  if (typeof cur !== 'string') fail(`${r.category}/${r.id} has no description to repair`);
  if (cur.includes(r.replace)) { console.log(`  = ${r.category}/${r.id} already repaired`); applied.push({ ...r, text: cur }); continue; }
  const n = cur.split(r.find).length - 1;
  if (n !== 1) fail(`${r.category}/${r.id}: the damaged phrase occurs ${n} times, expected exactly 1 — re-anchor before writing`);
  const next = cur.split(r.find).join(r.replace);
  desc[r.category][r.id].d = next;
  applied.push({ ...r, text: next });
  console.log(`  ✓ ${r.category}/${r.id}`);
}

/* The overlay row carries the WHOLE repaired description, not a diff, because that is the only shape
 * `applyBackfill` understands (`target[field] = value`) and the only thing that survives a regen. */
const rows = readBackfill(root);
let added = 0, refreshed = 0;
for (const a of applied) {
  const i = rows.findIndex((x) => x.category === a.category && x.id === a.id && x.field === 'description' && !x.path);
  const row = { category: a.category, id: a.id, field: 'description', value: a.text };
  if (i >= 0) { rows[i] = row; refreshed++; } else { rows.push(row); added++; }
}

if (DRY) { console.log(`\n--dry: ${added} rows would be added, ${refreshed} refreshed; nothing written`); process.exit(0); }
writeFileSync(join(root, DESC_PATH), JSON.stringify(desc));
writeBackfill(root, rows);
console.log(`\noverlay: ${added} added, ${refreshed} refreshed (now ${rows.length} rows)`);
console.log(`written: ${DESC_PATH}, scripts/data/effect-backfill.json`);
