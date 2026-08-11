/*
 * Author the CREATURE TRAITS lane into the durable overlay.
 *
 * `scripts/data/effect-backfill.json` is the only lane that survives `npm run data` — anything written
 * straight into core.json dies at the next regeneration.
 *
 * Owner ruling Q6: acquired creature traits are recorded on the sheet. A creature trait decides what
 * can target you, so "You gain the undead and zombie traits" is mechanical, not flavour.
 *
 *   node scripts/author-creature-traits.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const WRITE = process.argv.includes('--write');

const db = JSON.parse(read('public/core.json'));
const desc = JSON.parse(read('public/core-descriptions.json'));
const hidden = new Set([...(db.duplicateIds ?? []), ...(db.umbrellaIds ?? [])]);
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

/**
 * ⚠ CONTEXTUAL placeholders — the printed word is not the trait.
 *   "the appropriate trait"  (Bloodline Mutation) — depends on the sorcerer's bloodline
 *   "the opposing trait"     (deity-cleric, Mortal Herald Dedication) — holy or unholy, per the deity
 * Writing the literal word would put "You are opposing" on a sheet. They need a choice-driven grant,
 * which is a different lane; excluded here and listed at the end so they are not silently dropped.
 */
const CONTEXTUAL = new Set(['appropriate', 'opposing']);

const RE = /\byou (?:also )?gain the ((?:[a-z]+)(?: and [a-z]+)?) traits?\b/i;

const rows = [];
const skipped = [];
for (const coll of ['feats', 'classFeatures', 'heritages']) {
  for (const [id, rec] of Object.entries(db[coll] ?? {})) {
    if (!rec?.name || hidden.has(id) || id.startsWith('aon-') || rec.edition === 'superseded') continue;
    const m = clean(desc[coll]?.[id]?.d).match(RE);
    if (!m) continue;
    const traits = m[1].split(/ and /).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (traits.some((t) => CONTEXTUAL.has(t))) { skipped.push(`${coll}/${id} — "${m[0]}"`); continue; }
    rows.push({ category: coll, id, field: 'grantsCreatureTraits', value: traits });
  }
}

const backfill = JSON.parse(read('scripts/data/effect-backfill.json'));
const already = new Set(backfill.filter((e) => e.field === 'grantsCreatureTraits').map((e) => `${e.category}/${e.id}`));
const fresh = rows.filter((r) => !already.has(`${r.category}/${r.id}`));

console.log(`records granting a creature trait: ${rows.length}`);
console.log(`  already in the overlay          : ${rows.length - fresh.length}`);
console.log(`  to add                          : ${fresh.length}`);
for (const s of skipped) console.log(`  ⚠ CONTEXTUAL, excluded: ${s}`);
const byColl = {};
for (const r of fresh) byColl[r.category] = (byColl[r.category] ?? 0) + 1;
console.log('  by collection:', JSON.stringify(byColl));

if (!WRITE) { console.log('\n(dry run — pass --write to apply)'); process.exit(0); }
writeFileSync(join(root, 'scripts/data/effect-backfill.json'), JSON.stringify([...backfill, ...fresh], null, 1));
console.log(`\nwrote ${fresh.length} rows to scripts/data/effect-backfill.json`);
