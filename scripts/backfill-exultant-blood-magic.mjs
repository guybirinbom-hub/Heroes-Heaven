/*
 * Exultant Blood Magic's second clause.
 *
 * The feat is the bloodrager archetype's MASTER rung (wired in casterArchetypes.ts), and it also says
 * "Increase the spell slots you gain from the bloodrager archetype feats by 1 for each spell rank" —
 * a flat +1 at every rank on top of the ladder.
 *
 * `entryId` is mandatory here: with none, the applier falls back to the character's OWN class caster,
 * so a bloodrager wizard would have had the bonus land on their wizard slots instead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const ID = 'exultant-blood-magic';
const ENTRY = 'bloodrager-dedication-casting';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};

const rec = core.feats[ID];
if (!rec) fail(`feats/${ID} does not ship`);
const t = String(rec.description ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\*/g, ' ')
  .replace(/\s+/g, ' ');

const m = t.match(/Increase the spell slots you gain from the bloodrager archetype feats by (\d+) for each spell rank/i);
if (!m) fail(`${ID} no longer states its per-rank slot increase: ${t.slice(0, 200)}`);
if (!core.feats['rising-blood-magic']) fail('the bloodrager ladder is missing — wire casterArchetypes first');

const value = { perRank: Number(m[1]), entryId: ENTRY };
rec.spellSlotBonus = value;

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const row = { category: 'feats', id: ID, field: 'spellSlotBonus', value };
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const next = [...backfill.filter((e) => key(e) !== key(row)), row];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`  ${ID} → +${value.perRank} slot per rank on ${ENTRY} (backfill ${backfill.length} → ${next.length})`);
