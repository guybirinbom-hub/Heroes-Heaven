/*
 * FEAT ACTION COSTS, against the AoN mirror.
 *
 * The encounter action list is built from records whose own `actionCost` is 1-3 actions, a reaction
 * or a free action. 58 feats that ARE actions were stored as `passive` — Endure Death's Touch is a
 * Reaction, Educated Assessment a Single Action — so a player could never find them on their turn.
 * Another 10 had the wrong count: Forestall Curse became a Free Action in the Remaster and was still
 * a Single Action here.
 *
 * The cost is printed immediately after the feat's name in the heading, which is where a reader sees
 * it, so the heading has to repeat what the structured field claims before anything moves.
 *
 * ⚠ Guards, each of which was needed:
 *   - An EMPTY `actions` field means the cost was not recorded on that record, NOT that the feat is
 *     passive; a legacy/remaster pair where only one half carries it is still settled.
 *   - The heading must be read off the record that CARRIES the cost, not list[0], which may be the
 *     half that omits it.
 *   - `legacy` / `legacy-era` records are still takeable and a reprint does not change an action
 *     cost, so they count — but only when the mirror holds exactly ONE record for the name.
 *   - For a count CHANGE (as opposed to passive -> action) the mirror record's LEVEL must match the
 *     app's, which is what rules out a name collision.
 *
 *   node scripts/action-cost-check.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/feat';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const showAll = process.argv.includes('--all');

const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const byName = new Map();
for (const f of readdirSync(MIRROR)) {
  const j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  if (!j.name) continue;
  const k = norm(j.name);
  const list = byName.get(k);
  if (list) list.push(j);
  else byName.set(k, [j]);
}
const COST = {
  'single action': 1,
  'two actions': 2,
  'three actions': 3,
  reaction: 'reaction',
  'free action': 'free',
};

let compared = 0;
const held = [];
const bad = [];
for (const [id, rec] of Object.entries(db.feats ?? {})) {
  if (!rec?.actionCost || rec.edition === 'superseded') continue;
  const list = byName.get(norm(rec.name)) ?? [];
  if (!list.length) continue;
  const isPassive = rec.actionCost.type === 'passive';
  if (['legacy', 'legacy-era'].includes(rec.edition) && list.length !== 1) {
    held.push(`${id}: legacy with ${list.length} mirror records`);
    continue;
  }
  // A count change needs the level to match; a passive record has no count to protect and takes any.
  const candidates = isPassive ? list : list.filter((m) => m.level === rec.level);
  if (!candidates.length) {
    held.push(`${id}: no mirror record at level ${rec.level}`);
    continue;
  }
  const remaster = candidates.filter((m) => !m.remaster_id);
  const pool = (remaster.length ? remaster : candidates).filter((m) => norm(m.actions ?? ''));
  const costs = new Set(pool.map((m) => norm(m.actions)));
  if (costs.size !== 1) {
    if (costs.size > 1) held.push(`${id}: prints ${[...costs].join(' / ')}`);
    continue;
  }
  const key = [...costs][0];
  const want = COST[key];
  if (want === undefined) continue;
  const carrier = pool.find((m) => norm(m.actions) === key);
  const heading = String(carrier.text ?? '').replace(/\s+/g, ' ').slice(0, 260);
  if (!new RegExp(key.replace(/ /g, '\\s+'), 'i').test(heading)) {
    held.push(`${id}: the field says "${key}" but the heading does not repeat it`);
    continue;
  }
  compared++;
  const have = rec.actionCost.type === 'actions' ? rec.actionCost.value : rec.actionCost.type;
  if (have !== want) bad.push({ id, have, want });
}

console.log(`feat action costs compared: ${compared}`);
console.log(`held back by a guard:       ${held.length}`);
if (showAll) for (const h of held) console.log(`   ${h}`);
console.log(`\nUNEXPLAINED: ${bad.length}`);
for (const b of bad) console.log(`   ${b.id.padEnd(36)} app ${JSON.stringify(b.have)} -> mirror ${JSON.stringify(b.want)}`);
if (bad.length) process.exitCode = 1;
