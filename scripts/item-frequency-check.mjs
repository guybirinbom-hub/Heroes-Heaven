/*
 * PRINTED FREQUENCY vs TRACKED USES, on every item.
 *
 * Daily preparations reset "abilities that can be used only a certain number of times per day,
 * including magic item uses". The app does that by refilling every counter flagged `resetsOnRest`,
 * and src/rules/itemUses.ts only has a counter to refill where the record carries `counters` or a
 * legacy `frequency`. An item whose description prints "Frequency once per day" and carries neither
 * is silent in exactly the way a wrong price is: nothing crashes, no test fails, and the player's
 * once-per-day activation is simply never tracked or restored. 146 records shipped that way.
 *
 * Both directions are checked, but only one is fatal:
 *
 *   FATAL   a printed limit with nothing to track it. This is the player-visible bug, and the counter
 *           pass at the end of scripts/import-core-v2.mjs is what clears it.
 *
 *   REPORT  a counter whose limit the description never prints, and a Frequency wording the parser
 *           cannot read ("once per year", "once every 1d4 rounds" — periods ItemCounter has no room
 *           for). A disagreement is only reported, not failed, when the value is a curated row in
 *           scripts/data/effect-backfill.json: that file is the owner's ruling, it is applied last on
 *           purpose, and a guard that could only go green by overruling it would be a guard that
 *           deletes curated data. Everything else that disagrees IS fatal — the importer owns it.
 *
 *   node scripts/item-frequency-check.mjs [path/to/core.json]
 *
 * The optional path is for checking a candidate core.json without replacing the shipped one — how the
 * counter pass was confirmed before a regen was allowed to run. Descriptions are read from the
 * core-descriptions.json beside it, or from the records themselves when they still hold their text.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { printedFrequencies, trackedCounters, tracksFrequency } from './lib/aon-facets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.argv[2] || join(root, 'public/core.json');
const DESC = join(dirname(CORE), 'core-descriptions.json');

const db = JSON.parse(readFileSync(CORE, 'utf8'));
const descs = existsSync(DESC) ? JSON.parse(readFileSync(DESC, 'utf8')) : {};
const textOf = (id, rec) => String(rec?.description ?? descs.items?.[id]?.d ?? '');

/*
 * The limits the owner has RULED on, as `id -> set of max/per/every`. Read from the backfill rows for
 * items, both shapes: a `frequency` row is one value, a `counters` row is a list of them.
 */
const curated = new Map();
{
  const file = join(root, 'scripts/data/effect-backfill.json');
  const key = (c) => `${c.max}/${c.per}/${c.every ?? 1}`;
  for (const row of existsSync(file) ? Object.values(JSON.parse(readFileSync(file, 'utf8'))) : []) {
    if (row?.category !== 'items' || !row.id) continue;
    const vals = row.field === 'frequency' ? [row.value] : row.field === 'counters' ? row.value ?? [] : [];
    for (const v of vals) {
      if (!v?.per) continue;
      if (!curated.has(row.id)) curated.set(row.id, new Set());
      curated.get(row.id).add(key(v));
    }
  }
}

const untracked = [];
const disagree = [];
const unreadable = [];
let printing = 0;
let tracked = 0;

for (const [id, rec] of Object.entries(db.items ?? {})) {
  const { read, unread } = printedFrequencies(textOf(id, rec));
  // Reported whether or not the record also prints a limit the parser CAN read: five items print a
  // second activation in a period ItemCounter has no room for ("4 times per year"), and a tracked
  // sibling limit does not make that one tracked.
  if (unread.length) unreadable.push({ id, name: rec?.name ?? id, wording: unread.join(' | ') });
  if (!read.length) continue;
  printing++;
  const have = trackedCounters(rec);
  const miss = read.filter((f) => !tracksFrequency(have, f));
  // A counter with no `per` states no period, so it cannot contradict one (see tracksFrequency).
  const off = have.filter((c) => c.per && !read.some((f) => c.per === f.per && c.max === f.max && (c.every ?? 1) === (f.every ?? 1))
    && !curated.get(id)?.has(`${c.max}/${c.per}/${c.every ?? 1}`));
  const ruled = have.filter((c) => c.per && curated.get(id)?.has(`${c.max}/${c.per}/${c.every ?? 1}`)
    && !read.some((f) => c.per === f.per && c.max === f.max && (c.every ?? 1) === (f.every ?? 1)));
  if (miss.length) untracked.push({ id, name: rec?.name ?? id, miss, have });
  if (off.length) disagree.push({ id, name: rec?.name ?? id, off, read, fatal: true });
  else if (ruled.length) disagree.push({ id, name: rec?.name ?? id, off: ruled, read, fatal: false });
  if (!miss.length && !off.length) tracked++;
}

const say = (f) => `${f.max}x per ${(f.every ?? 1) > 1 ? `${f.every} ${f.per}s` : f.per}`;
const held = (c) => `${c.id ?? '?'} ${c.per ? say(c) : `${c.max} (no period)`}`;

console.log(`core.json items printing a Frequency the parser can read: ${printing}`);
console.log(`items whose counters match what they print: ${tracked}`);

if (untracked.length) {
  console.log(`\nPRINTS a Frequency with NO counter to track it: ${untracked.length}`);
  for (const b of untracked) {
    console.log(`   ${b.id.padEnd(38)} prints ${b.miss.map(say).join(', ').padEnd(22)} has ${b.have.length ? b.have.map(held).join(', ') : 'nothing'}`);
  }
}
const fatalDisagree = disagree.filter((d) => d.fatal);
if (fatalDisagree.length) {
  console.log(`\nCOUNTER the description never prints: ${fatalDisagree.length}`);
  for (const b of fatalDisagree) {
    console.log(`   ${b.id.padEnd(38)} has ${b.off.map(held).join(', ').padEnd(22)} prints ${b.read.map(say).join(', ')}`);
  }
}
const ruledDisagree = disagree.filter((d) => !d.fatal);
if (ruledDisagree.length) {
  console.log(`\nreported only — a curated effect-backfill.json row the page disagrees with: ${ruledDisagree.length}`);
  for (const b of ruledDisagree) {
    console.log(`   ${b.id.padEnd(38)} backfill ${b.off.map(held).join(', ').padEnd(22)} page prints ${b.read.map(say).join(', ')}`);
  }
}
if (unreadable.length) {
  console.log(`\nreported only — a printed Frequency in a period ItemCounter cannot hold: ${unreadable.length}`);
  for (const b of unreadable) console.log(`   ${b.id.padEnd(38)} "${b.wording}"`);
}

if (untracked.length || fatalDisagree.length) {
  console.log('\nA counter is the only thing daily preparations can refill (src/rules/itemUses.ts). Counters are');
  console.log('written from the printed Frequency at the end of scripts/import-core-v2.mjs; re-run `npm run data`.');
  process.exitCode = 1;
} else {
  console.log('\nevery item that prints a per-period Frequency carries a counter that tracks it.');
}
