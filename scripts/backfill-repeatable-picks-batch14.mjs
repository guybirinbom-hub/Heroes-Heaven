/*
 * THREE MORE BATCH-14 REPEATABLE PICKS, MOVED FROM PER-RECORD TO PER-TAKING.
 *
 * `effectChoices` answers are stored once per RECORD. On a repeatable feat that means every taking
 * answers the same question and writes to the same key, so the second take grants nothing — the
 * player pays a feat and receives a duplicate. The record's own `choice` is keyed by SLOT, so moving
 * the question there is what makes a second taking a second answer. Order Magic was the first record
 * migrated and carries the tests for the shape; these are batch 14's remaining three.
 *
 * ⚠ THE SPECIAL CLAUSE IS NOT THE SAME ON ALL THREE, and that is why this is not a bulk rewrite. Two
 * say the second take gains *"the focus spell you didn't gain the first time"* — `distinctAcrossTakes`.
 * The third says *"EITHER choosing a different sense OR IMPROVING an imprecise sense granted by this
 * feat to a precise sense"*, so repeating an answer is explicitly legal there and marking it distinct
 * would forbid half of what it prints. It gets the precise options instead.
 *
 *   node scripts/backfill-repeatable-picks-batch14.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/** Lift a record's single effectChoices def into a per-taking `choice`, keeping its options verbatim. */
const lift = (id, { flag, distinct = false, extraOptions = [] }) => {
  const rec = core.feats[id];
  if (!rec) { console.error(`${id} is not in core.json`); process.exit(2); }
  const defs = rec.effectChoices ?? [];
  if (defs.length !== 1) { console.error(`${id}: expected exactly 1 effectChoices def, found ${defs.length}`); process.exit(2); }
  const def = defs[0];
  const options = [...(def.options ?? []), ...extraOptions];
  if (!options.length) { console.error(`${id}: no options to carry`); process.exit(2); }
  return [
    {
      category: 'feats',
      id,
      field: 'choice',
      value: { flag, prompt: def.prompt, kind: 'array', ...(distinct ? { distinctAcrossTakes: true } : {}), options },
    },
    /* `value: null` REMOVES the field — leaving it would be a second picker asking the same question
     * and quietly overwriting itself, which is the two-pickers defect ruling Q9 names. */
    { category: 'feats', id, field: 'effectChoices', value: null },
  ];
};

const ROWS = [
  /* *"You can take this feat a second time, gaining the focus spell that you didn't gain the first time."* */
  ...lift('special-sentinel-technique', { flag: 'sentinelTechnique', distinct: true }),
  /* *"You can take this feat a second time, gaining the focus spell you didn't gain the first time."* */
  ...lift('wyldsinger', { flag: 'wyldsingerSong', distinct: true }),
  /*
   * *"You can select this feat multiple times, either choosing a different sense OR improving an
   * imprecise sense granted by this feat to a precise sense."* The upgrade branch had no option at all,
   * so a second taking could only re-pick a sense it already had and change nothing. Both precise
   * forms are offered and say what they are for; the list stays wide rather than gated, because the
   * gate would have to read another taking's answer and menu narrowing is the one call that is ours.
   */
  ...lift('greater-animal-senses', {
    flag: 'animalAdvancedSense',
    extraOptions: [
      { value: 'echolocation-precise', label: 'Echolocation (precise) 30 feet — improves the imprecise sense from an earlier taking', grant: { senses: [{ name: 'echolocation', range: 30, acuity: 'precise' }] } },
      { value: 'tremorsense-precise', label: 'Tremorsense (precise) 30 feet — improves the imprecise sense from an earlier taking', grant: { senses: [{ name: 'tremorsense', range: 30, acuity: 'precise' }] } },
    ],
  }),
];

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replaced.`);
for (const r of ROWS) console.log(`  ${r.id}.${r.field}${r.value === null ? ' (removed)' : ''}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
