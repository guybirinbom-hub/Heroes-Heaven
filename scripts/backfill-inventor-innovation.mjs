/*
 * Three inventor innovation modifications whose entire content was prose.
 *
 * All three are MODIFICATIONS, not feats: they are found by `otherTags` containing
 * `<type>-innovation-modification` and offered at the tier matching their level (initial 1,
 * breakthrough 7, revolutionary 15). Nothing in classes/feats references them by id, so a
 * reference search calls them orphans — they are not.
 *
 *   enhanced-resistance  (breakthrough, armor)  the initial modification's resistance counts the
 *                                               FULL level instead of half
 *   heavy-construction   (breakthrough, POWER SUIT only)  restat the innovation to a heavy block
 *   rune-capacity        (revolutionary, armor OR weapon)  one more property rune
 *
 * Every number written here is PARSED from the record's own text rather than typed in, so a data
 * update that changes the printed statistics fails this script instead of leaving a stale map.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const text = (id) =>
  String(core.classFeatures[id]?.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    // The stat block emphasises each label (`*Speed Penalty* -10 feet`); the asterisks sit between
    // the label and its number, so they have to go before anything can be parsed.
    .replace(/\*/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const entries = [];
const fail = (msg) => {
  console.error(`REFUSING TO WRITE — ${msg}`);
  process.exit(1);
};
const need = (id, tier) => {
  const rec = core.classFeatures[id];
  if (!rec) fail(`classFeatures/${id} does not ship`);
  if (!(rec.otherTags ?? []).some((t) => /-innovation-modification$/.test(t)))
    fail(`${id} is not tagged as an innovation modification — it may have moved collections`);
  if (rec.level !== tier) fail(`${id} is level ${rec.level}, expected the tier level ${tier}`);
  return rec;
};
const add = (id, field, value) => {
  core.classFeatures[id][field] = value;
  entries.push({ category: 'classFeatures', id, field, value });
  console.log(`  ${id.padEnd(20)} ${field} = ${JSON.stringify(value)}`);
};

/* ---- enhanced-resistance: full level instead of half ---------------------------------------- */
{
  const rec = need('enhanced-resistance', 7);
  const t = text('enhanced-resistance');
  if (!/full level,? instead of half your level/i.test(t))
    fail(`enhanced-resistance no longer says "full level instead of half your level": ${t.slice(0, 120)}`);
  if (!(rec.otherTags ?? []).includes('armor-innovation-modification'))
    fail('enhanced-resistance is no longer an ARMOR modification, but the reader gates on armor');
  add('enhanced-resistance', 'resistanceLevelUpgrade', 'inventor-initial');
}

/* ---- heavy-construction: restat the power suit to a heavy block ------------------------------ */
{
  const rec = need('heavy-construction', 7);
  const t = text('heavy-construction');
  if (!(rec.otherTags ?? []).includes('power-suit-modification'))
    fail('heavy-construction lost its power-suit-modification tag — it would become legal on the subterfuge suit');
  if (!/becomes heavy armor/i.test(t)) fail('heavy-construction no longer says the innovation becomes heavy armor');
  if (!/equal to your proficiency in medium armor/i.test(t))
    fail('heavy-construction no longer remaps proficiency to medium — without that clause AC would collapse');

  // "The armor's adjusted statistics are: AC Bonus +5; Dex Cap +1; … Speed Penalty -10 feet; … Bulk 3".
  // Parsed from the statistics clause ALONE — a bare /Strength \+?(\d+)/ over the whole description
  // would also match the earlier "if your Strength modifier is at least +3" sentence.
  const block = t.match(/adjusted statistics are:?(.*)$/i)?.[1];
  if (!block) fail('heavy-construction no longer prints an adjusted statistics block');
  const stat = (label, re) => {
    const m = block.match(re);
    if (!m) fail(`heavy-construction's adjusted statistics no longer list ${label}`);
    return Number(m[1].replace(/\s+/g, ''));
  };
  const speedPenalty = stat('a Speed Penalty', /Speed Penalty\s*(-?\s*\d+)/i);
  const bulk = stat('a Bulk', /Bulk\s*(\d+)/i);
  const acBonus = stat('an AC Bonus', /AC Bonus\s*\+?(\d+)/i);
  const strThreshold = stat('a Strength', /Strength\s*\+?(\d+)/i);

  // The feat only ever restats the POWER SUIT, so the printed AC must still match the item we would
  // be overriding — if it ever diverges, the restat is silently dropping an AC change.
  const suit = core.items['power-suit'];
  if (!suit) fail('items/power-suit does not ship');
  if (suit.acBonus !== acBonus)
    fail(`power-suit acBonus ${suit.acBonus} != the feat's printed AC Bonus +${acBonus} — the restat must carry AC too`);

  // "If your Strength modifier is at least +3, you remove the Speed penalty entirely."
  const m = t.match(/Strength modifier is at least \+?(\d+), you remove the Speed penalty entirely/i);
  if (!m) fail('heavy-construction no longer has the "remove the Speed penalty entirely" clause');
  const removeAt = Number(m[1]);
  if (removeAt !== strThreshold)
    fail(`the Speed-penalty clause triggers at Str +${removeAt} but the armor's Strength is +${strThreshold}`);

  const addTraits = ['bulwark', 'entrench'].filter((tr) => new RegExp(`\\b${tr}`, 'i').test(block));
  if (addTraits.length !== 2) fail(`expected bulwark + entrench in the armor traits, found ${addTraits.join(', ') || 'none'}`);

  // "Power Suit only" — taken from the record's own tag, not typed in. Without this the restat would
  // fire on ANY armor a player designated as their innovation, and `proficiencyAs` would hand full
  // plate the medium-armor track.
  const suitTag = (rec.otherTags ?? []).find((t) => t.endsWith('-suit-modification'));
  const only = suitTag.replace(/-modification$/, '');
  if (!core.items[only]) fail(`the record is tagged ${suitTag} but items/${only} does not ship`);

  add('heavy-construction', 'armorRestat', {
    designated: 'innovation',
    items: [only],
    set: { category: 'heavy', speedPenalty, bulk },
    addTraits,
    // THE LOAD-BEARING HALF. An inventor is never trained in heavy armor; without this the AC lookup
    // lands on an untrained column and drops by the whole proficiency bonus.
    proficiencyAs: 'medium',
    removeSpeedPenaltyAtStr: removeAt,
  });
}

/* ---- rune-capacity: one more property rune --------------------------------------------------- */
{
  need('rune-capacity', 15);
  const t = text('rune-capacity');
  if (!/one more property rune/i.test(t)) fail('rune-capacity no longer says "one more property rune"');
  const m = t.match(/maximum of (\w+) property runes/i);
  if (!m) fail('rune-capacity no longer states its maximum');
  const WORDS = { two: 2, three: 3, four: 4, five: 5 };
  const max = WORDS[m[1].toLowerCase()] ?? Number(m[1]);
  if (!Number.isFinite(max) || max < 1) fail(`could not read rune-capacity's maximum from "${m[1]}"`);
  add('rune-capacity', 'propertyRuneBonus', { designated: 'innovation', bonus: 1, max });
}

if (entries.length !== 3) fail(`only ${entries.length} of 3 records resolved`);

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`wired ${entries.length} inventor modifications (backfill ${backfill.length} → ${next.length})`);
