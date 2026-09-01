/**
 * WANDERER'S GUIDE PARITY — the owning script for every field this comparison authors.
 *
 * The owner's rule, stated 2026-08-16 and deliberately absolute:
 *
 *   "if there is a place where we do something and they do it differently we need to delete the way
 *    we did it and do it the way they did … i dont care if you think they are wrong if our version
 *    dosent agree with theirs then use theirs. only place where we have the last word is filtering
 *    the options when giving a user selection menu."
 *
 * So there is no "they are wrong" escape in this pass. Where the two disagree, theirs wins — the one
 * exception being which options a picker OFFERS, where our filtering stands.
 *
 * Parity means BOTH HALVES of the mandate: the choices a player is given, and the effect on the
 * sheet. A record is not done because a field was set; it is done when the picker appears with the
 * right options AND the number moves.
 *
 * WHY THE VALUES LIVE HERE rather than in each agent's hands: `scripts/data/effect-backfill.json` is
 * the only overlay surviving `npm run data`, it has exactly one writer (`lib/write-backfill.mjs`),
 * and ten agents appending to it concurrently would corrupt it. Each batch lands as data in this
 * file, so a rerun is idempotent and the whole pass is reviewable as one diff.
 *
 *   node scripts/apply-wg-parity.mjs --dry
 *   node scripts/apply-wg-parity.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBackfill, BACKFILL_PATH } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/**
 * Batches of decided changes, appended one batch at a time.
 *
 * Each row is `{ category, id, field, value, why }` — `why` is stripped before writing and exists so
 * the next reader can see which printed clause and which of their operations produced the value.
 * `value: null` DELETES the field, which is how rule 2 ("delete the way we did it") is expressed.
 */
const BATCHES = {
  /* Filled by scripts/wg-parity-collect.mjs from the agents' decision files. */
};

const rows = Object.entries(BATCHES).flatMap(([batch, list]) => list.map((r) => ({ ...r, batch })));

/* Also accept decision files dropped by a parity run, so a batch can be applied without editing
 * this file by hand. Each is an array of the same row shape. */
const DECISIONS_DIR = join(ROOT, 'work/wg-decisions');
if (existsSync(DECISIONS_DIR)) {
  for (const f of readdirSync(DECISIONS_DIR).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const list = JSON.parse(readFileSync(join(DECISIONS_DIR, f), 'utf8'));
      for (const r of list) if (r?.category && r?.id && r?.field) rows.push({ ...r, batch: f.replace(/\.json$/, '') });
    } catch (e) {
      console.error(`!! unreadable decision file ${f}: ${e.message}`);
      process.exit(1);
    }
  }
}

if (!rows.length) {
  console.log('no parity rows to apply.');
  process.exit(0);
}

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const missing = rows.filter((r) => !core[r.category]?.[r.id]);
if (missing.length) {
  console.error(`!! ${missing.length} rows name a record that does not exist — refusing to write:`);
  for (const m of missing.slice(0, 10)) console.error(`   ${m.category}/${m.id}`);
  process.exit(1);
}

/*
 * ---------------------------------------------------------------- the situational pairing
 *
 * `situational` and `situationalReplaces` are two fields describing one decision, and batch 002 showed
 * that is a design mistake rather than an authoring one: SIX of its sixteen rejections were this pair
 * getting split, and in every case the VALUE was right and only the packaging was wrong. Four verified
 * rows were thrown away for it.
 *
 * Both halves fail silently and in opposite directions, which is why nobody caught it by reading:
 *   array without the flag -> appends, and the player reads OUR reading and THEIRS side by side
 *   flag without the array -> inert; the guard in explain.ts never has anything to replace
 *
 * So the applier settles it instead of asking the author to. Under the owner's parity rule — "delete
 * the way we did it and do it the way they did" — authoring a `situational` value on a record that
 * ALREADY ships one is always a replacement. There is no parity case where the intent is to show both.
 * The flag is therefore DERIVED, and a lone flag is refused as the inert row it is.
 */
const situationalIds = new Set(rows.filter((r) => r.field === 'situational').map((r) => `${r.category}/${r.id}`));
const orphanFlags = rows.filter((r) => r.field === 'situationalReplaces' && !situationalIds.has(`${r.category}/${r.id}`));
if (orphanFlags.length) {
  console.error(`!! ${orphanFlags.length} row(s) set situationalReplaces with no situational row for the same record.`);
  console.error('   That flag is inert on its own — explain.ts has nothing to replace. Refusing to write:');
  for (const o of orphanFlags) console.error(`   ${o.category}/${o.id}`);
  process.exit(1);
}

/* Shipped entries, read from the source of truth rather than a copy, so this cannot drift.
 *
 * ⚠ The key pattern accepts BOTH quote styles. It was written `'([^']+)':` and every one of the 2,791
 * keys in FEAT_SITUATIONAL is DOUBLE-quoted, so the set came back EMPTY and the derivation below never
 * fired once. Silent in both directions: no flag was ever derived (so authored entries APPENDED beside
 * the shipped ones the parity rule was meant to delete) and any explicitly-authored flag was dropped
 * by the `meaningless` filter for having "nothing to replace". Batch 002 shipped seven records that way
 * — covet-hoard, folk-healer, ravenings-desperation, scamper-underfoot, stone-face, straveika and the
 * shrieking-key item — each now printing two wordings of one rule in the stat popup.
 *
 * Hence the guard: a detection set that reads the whole table and finds NOTHING is a broken pattern,
 * never a true answer, and it must stop the run rather than quietly disable the feature it gates.
 */
const shippedSituational = new Set(
  [...readFileSync(join(ROOT, 'src/rules/situationalBonuses.ts'), 'utf8')
    .slice(0, readFileSync(join(ROOT, 'src/rules/situationalBonuses.ts'), 'utf8').indexOf('export const DEGREE_SHIFT_TEXT'))
    .matchAll(/^\s{2}(?:'([^']+)'|"([^"]+)"):/gm)].map((m) => m[1] ?? m[2]),
);
if (!shippedSituational.size) {
  console.error('!! read 0 keys out of FEAT_SITUATIONAL — the key pattern no longer matches the table.');
  console.error('   Every situational row would append beside the entry it is meant to replace. Refusing to write.');
  process.exit(1);
}
let derived = 0;
for (const r of [...rows]) {
  if (r.field !== 'situational') continue;
  if (!shippedSituational.has(r.id)) continue;                       // nothing to replace; append is right
  if (rows.some((x) => x.category === r.category && x.id === r.id && x.field === 'situationalReplaces')) continue;
  rows.push({ ...r, field: 'situationalReplaces', value: true, why: `derived: ${r.id} ships a FEAT_SITUATIONAL entry, and the parity rule replaces ours rather than showing both` });
  derived++;
}
if (derived) console.log(`derived situationalReplaces on ${derived} record(s) that already ship an entry\n`);

/*
 * …and the mirror case: a flag on a record with NOTHING to replace. Harmless at runtime (replacing an
 * empty shipped list equals appending to it) but it is a false statement about the data, and the next
 * person to read the overlay would reasonably conclude a shipped entry had been superseded. Batch 002
 * proposed six of these — every one on a record with no FEAT_SITUATIONAL entry at all. Dropped rather
 * than refused, because the `situational` row beside it is correct and refusing would throw it away too.
 */
const meaningless = rows.filter((r) => r.field === 'situationalReplaces' && !shippedSituational.has(r.id));
if (meaningless.length) {
  for (const m of meaningless) rows.splice(rows.indexOf(m), 1);
  console.log(`dropped ${meaningless.length} situationalReplaces row(s) on records that ship no entry to replace:`);
  for (const m of meaningless) console.log(`   ${m.category}/${m.id}`);
  console.log('');
}

const byBatch = {};
for (const r of rows) byBatch[r.batch] = (byBatch[r.batch] ?? 0) + 1;
console.log(`${rows.length} parity rows across ${Object.keys(byBatch).length} batch(es):`);
for (const [b, n] of Object.entries(byBatch)) console.log(`  ${b.padEnd(24)} ${n}`);
console.log();
for (const r of rows.slice(0, 40)) {
  const now = JSON.stringify(core[r.category][r.id][r.field]);
  console.log(`  ${`${r.category}/${r.id}`.padEnd(44)} ${r.field.padEnd(22)} ${String(now).slice(0, 26).padEnd(28)} -> ${JSON.stringify(r.value).slice(0, 40)}`);
}
if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);

if (DRY) { console.log('\n--dry: nothing written.'); process.exit(0); }

/* Merge into the overlay: replace a row addressing the same (category, id, field), append the rest.
 * `writeBackfill` takes the WHOLE overlay and refuses a delta — it caught exactly this mistake once,
 * where passing 13 rows would have dropped the other 7,332. */
const existing = JSON.parse(readFileSync(join(ROOT, BACKFILL_PATH), 'utf8'));
const key = (r) => `${r.category}|${r.id}|${r.field}`;
const mine = new Map(rows.map((r) => [key(r), { category: r.category, id: r.id, field: r.field, value: r.value }]));
const merged = existing.map((r) => mine.get(key(r)) ?? r);
const seen = new Set(existing.map(key));
for (const [k, r] of mine) if (!seen.has(k)) merged.push(r);

writeBackfill(ROOT, merged);
console.log(`\nwrote ${rows.length} rows (overlay ${existing.length} → ${merged.length})`);
console.log('Now run `npm run data` to bake them into core.json, then `npx vitest run --pool=threads`.');
