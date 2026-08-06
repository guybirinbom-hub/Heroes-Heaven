/*
 * Verduran City Folk offers a two-way skill-feat choice and the FIRST OPTION'S NAME IS MISSING from
 * the data: the record reads "You gain either or Streetwise as a skill feat."
 *
 * Every sibling background in this pass got a real picker. This one cannot, because building one
 * would mean inventing the option the export lost — and a picker offering a single choice would
 * misrepresent the rule just as badly. So the player is TOLD, through the `dataWarning` lane that
 * already surfaces on the sheet, and gets to apply the missing half themselves.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const ID = 'verduran-city-folk';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};

const rec = core.backgrounds?.[ID];
if (!rec) fail(`backgrounds/${ID} does not ship`);
const text = String(rec.description ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ');

// The whole justification is that the sentence has a HOLE in it. If the data is ever repaired, this
// warning becomes a lie — so the script refuses to write once the gap closes.
if (!/gain either\s+or\s+Streetwise as a skill feat/i.test(text)) {
  fail(`${ID}'s text no longer has the missing option — build a real picker instead of this warning`);
}
if (!core.feats['streetwise']) fail('feats/streetwise does not ship');

const value =
  'The printed choice is between Streetwise and one other skill feat, whose name is missing from this ' +
  'data source. Streetwise is granted; if your table uses the other option, swap it in Overrides.';

core.backgrounds[ID].dataWarning = value;
// Streetwise is the half we can name, so it is granted outright rather than left to a broken picker.
core.backgrounds[ID].grantedFeatId = 'streetwise';

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const rows = [
  { category: 'backgrounds', id: ID, field: 'dataWarning', value },
  { category: 'backgrounds', id: ID, field: 'grantedFeatId', value: 'streetwise' },
];
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(rows.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...rows];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`  ${ID}: warning + streetwise grant (backfill ${backfill.length} → ${next.length})`);
