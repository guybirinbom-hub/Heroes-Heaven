/*
 * REMOVE THE SECOND PROMPT for an "if you would already be trained" clause.
 *
 * The clause has one correct implementation, and the app already has it: `redundantFallback: true` on
 * the record's FeatGrant. buildCharacter reports each TRIGGERED replacement in `skillFallbacks`, and
 * Builder.tsx renders the replacement picker from that list — so the question is asked only when the
 * grant really was redundant, which is what the sentence says.
 *
 * Some records ALSO carry an `effectChoices` skill picker for the same clause. Measured, that second
 * picker grants nothing (a rogue taking Barbarian Dedication and answering it "Arcana" comes away
 * untrained in Arcana), so this is not a double-grant — it is a second prompt that changes nothing,
 * which is worse than useless: the player answers a question that has no effect and is then asked the
 * real one somewhere else. Wanderer's Guide asks once.
 *
 * ⚠ VERIFIED BEFORE REMOVING, not assumed. For each record this checks that `redundantFallback` is
 * actually set on its grant — the lane that survives. A record whose only surface is the effectChoices
 * picker is left alone, because removing it would delete the only place the answer can be given.
 *
 *   node scripts/drop-duplicate-fallback-pickers.mjs           # report
 *   node scripts/drop-duplicate-fallback-pickers.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const grantSrc = ['featGrantsAuto.ts', 'featGrants.ts', 'featGrantsLane.ts']
  .map((f) => { try { return readFileSync(join(ROOT, 'src/rules', f), 'utf8'); } catch { return ''; } })
  .join('\n');
const withFallback = new Set();
for (const m of grantSrc.matchAll(/^\s*'([a-z0-9-]+)':\s*\{[^\n]*redundantFallback:\s*true/gm)) withFallback.add(m[1]);

const ROWS = [];
const kept = [];
for (const id of withFallback) {
  for (const bucket of ['feats', 'heritages', 'classFeatures']) {
    const rec = core[bucket]?.[id];
    if (!rec?.effectChoices?.length) continue;
    /*
     * Only groups that duplicate the FALLBACK — and the test is the RANK, not merely "it grants a
     * skill". Automaton Lore carries an Enhancement-gated picker whose options grant the chosen skill
     * at EXPERT; dropping it as a duplicate deleted a real mechanic and three tests caught it. A
     * fallback replacement always grants `trained`, because that is the rank the redundant grant would
     * have given. Anything else is a different clause wearing the same shape.
     *
     * Also skipped: a group the record's `enhancement` block points at, whatever rank it grants.
     */
    const enhanced = new Set([].concat(rec.enhancement?.choiceIds ?? []));
    const skillGroups = rec.effectChoices.filter(
      (ec) =>
        !enhanced.has(ec.id) &&
        (ec.options ?? []).some((o) => o?.grant?.skills && Object.values(o.grant.skills).every((r) => r === 'trained')) &&
        (ec.options ?? []).every((o) => !o?.grant?.skills || Object.values(o.grant.skills).every((r) => r === 'trained')),
    );
    if (!skillGroups.length) continue;
    const rest = rec.effectChoices.filter((ec) => !skillGroups.includes(ec));
    if (rest.length) {
      /* Keep the other groups; drop only the duplicated skill one. */
      ROWS.push({ category: bucket, id, field: 'effectChoices', value: rest });
      kept.push(`${bucket}/${id}: dropped ${skillGroups.length} skill group(s), kept ${rest.length} other(s)`);
    } else {
      ROWS.push({ category: bucket, id, field: 'effectChoices', value: null });
      kept.push(`${bucket}/${id}: dropped the whole effectChoices block (it held only the duplicate)`);
    }
  }
}

console.log(`${withFallback.size} record(s) carry redundantFallback; ${ROWS.length} also carry a duplicate skill picker:\n`);
for (const k of kept) console.log(`   ${k}`);
if (!ROWS.length) process.exit(0);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
