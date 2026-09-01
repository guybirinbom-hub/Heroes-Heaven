/*
 * RESTORE THE `aspect` FIELD ON EVERY RELIC GIFT — the join key the export dropped.
 *
 * A relic grows by gaining GIFTS, and which gifts it may take is decided by its ASPECTS (Air, Beast,
 * Fire, Mind…). All 219 relic pages in the pristine AoN mirror carry an `aspect`; the export at
 * hh-data-export carries it on NONE of them, so the 238 gift items shipped with no way to say which
 * relic could ever take them. Nothing connects a relic to its gifts without this.
 *
 * Exactly the shape of the bestiary `family` loss: a single load-bearing join key silently absent from
 * one import stage, leaving both sides of a real relationship stranded.
 *
 * Joined on aonId (`relic-N`), which is exact — NOT on name. 218 of 219 gift names also match an
 * existing item id, and matching on that would be a coin flip against every same-named ordinary item.
 *
 *   node scripts/backfill-relic-gift-aspects.mjs           # report
 *   node scripts/backfill-relic-gift-aspects.mjs --write
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/relic';
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\ufeff/, ''));
const core = read(join(ROOT, 'public/core.json'));

if (!existsSync(MIRROR)) { console.error(`no relic mirror at ${MIRROR}`); process.exit(2); }

/* aonId -> aspect(s), from the pristine mirror. */
const aspectByAon = new Map();
for (const f of readdirSync(MIRROR)) {
  if (!f.endsWith('.json') || f === '_index.json') continue;
  const j = read(join(MIRROR, f));
  if (!j?.id || !j.aspect) continue;
  aspectByAon.set(String(j.id), [].concat(j.aspect).map(String));
}

const ROWS = [];
const unmatched = [];
for (const [id, rec] of Object.entries(core.items ?? {})) {
  const aon = String(rec?.aonId ?? '');
  if (!/^relic-\d+$/.test(aon)) continue;
  const aspects = aspectByAon.get(aon);
  if (!aspects) { unmatched.push(`${id} (${aon})`); continue; }
  ROWS.push({ category: 'items', id, field: 'relicAspects', value: aspects });
}

console.log(`${aspectByAon.size} mirror page(s) carry an aspect; ${ROWS.length} gift item(s) matched by aonId.`);
if (unmatched.length) console.log(`  ${unmatched.length} gift item(s) with no mirror page: ${unmatched.slice(0, 5).join(', ')}`);

const byAspect = {};
for (const r of ROWS) for (const a of r.value) byAspect[a] = (byAspect[a] ?? 0) + 1;
console.log('\ngifts per aspect:');
for (const [a, n] of Object.entries(byAspect).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(3)}  ${a}`);

if (!ROWS.length) { console.error('\nnothing matched — the aonId convention changed, or the mirror moved'); process.exit(2); }
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
