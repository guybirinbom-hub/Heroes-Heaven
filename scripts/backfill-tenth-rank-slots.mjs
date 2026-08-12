/*
 * The three capstones that grant a 10th-rank spell slot.
 *
 * The psychic's and the animist's slot tables stop at rank 9, and the slot applier could only
 * INCREMENT a rank that already existed — so `byRank: {10: 1}` was silently inert and all three
 * granted nothing at all. `SpellSlotBonus.createRank` lets a record say the rank must be made.
 *
 * Each row is written only after the record's own text is confirmed to say "10th-rank spell slot".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};
const find = (id) => {
  for (const cat of ['feats', 'classFeatures']) if (core[cat]?.[id]) return [cat, core[cat][id]];
  fail(`${id} ships in neither feats nor classFeatures`);
};

const entries = [];
for (const id of ['infinite-mind', 'mind-over-matter', 'true-channel-spell']) {
  const [cat, rec] = find(id);
  const t = String(rec.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ');
  const m = t.match(/(?:a single|an additional|a) (\d+)(?:st|nd|rd|th)-rank spell slot/i);
  if (!m) fail(`${id} no longer states that it grants a rank-N spell slot: ${t.slice(0, 160)}`);
  const rank = Number(m[1]);
  if (rank < 1 || rank > 10) fail(`${id} names an implausible rank ${rank}`);
  // The whole point is a rank the class table does not reach; if it ever does, plain byRank suffices.
  if (rec.level < 15) fail(`${id} is level ${rec.level} — too low to imply a rank-${rank} slot`);

  const value = { byRank: { [rank]: 1 }, createRank: true };
  rec.spellSlotBonus = value;
  entries.push({ category: cat, id, field: 'spellSlotBonus', value });
  console.log(`  ${cat}/${id} (lvl ${rec.level}) → rank ${rank} × 1, createRank`);
}

if (entries.length !== 3) fail(`only ${entries.length} of 3 resolved`);

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wired ${entries.length} tenth-rank slots (backfill ${backfill.length} → ${next.length})`);
