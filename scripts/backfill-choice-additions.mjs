/*
 * Feats whose entire content is "add these to the menu that other record already gives you".
 *
 * Both menus existed and both were daily choices the player already answered — the champion's blessed
 * armament rune, the harbinger's armament rune. Nothing let one record reach into another's option
 * list, so these feats could be taken and the menu stayed exactly the same size: the player could
 * read the new runes named in the feat's own text and could not pick one.
 *
 * The runes each feat names are quoted below, from the AoN mirror.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const label = (v) => v.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const opts = (...vals) => vals.map((v) => ({ value: v, label: label(v) }));

const FIXES = [
  {
    id: 'radiant-armament',
    // "When you choose the weapon for your blessed armament during your daily preparations, add the
    //  astral and brilliant property runes to the list of effects you can choose from. If you're
    //  holy, also add the holy rune, and if you're unholy, also add the unholy rune."
    target: 'blessed-armament',
    flag: 'blessedRune',
    add: opts('astral', 'brilliant'),
    // Never both — the character has one sanctification or none.
    addIfSanctified: [
      { sanctification: 'holy', value: 'holy', label: 'Holy' },
      { sanctification: 'unholy', value: 'unholy', label: 'Unholy' },
    ],
  },
  {
    id: 'greater-armament',
    // "Add brilliant, corrosive, flaming, frost, holy, shock, thundering, and unholy to the list of
    //  property runes you can add to your weapon during your daily preparations."
    // Holy and unholy are listed unconditionally here — unlike Radiant Armament, this feat does not
    // gate them on your own sanctification.
    target: 'harbingers-armament',
    flag: 'harbingerRune',
    add: opts('brilliant', 'corrosive', 'flaming', 'frost', 'holy', 'shock', 'thundering', 'unholy'),
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const skipped = [];

for (const f of FIXES) {
  const rec = core.feats[f.id];
  if (!rec) {
    skipped.push(`${f.id}: not a feat in core.json`);
    continue;
  }
  // The TARGET must exist and must carry the named choice, or the addition patches nothing.
  const target = core.classFeatures[f.target] ?? core.feats[f.target];
  if (!target) {
    skipped.push(`${f.id}: target ${f.target} does not exist`);
    continue;
  }
  if (target.choice?.flag !== f.flag) {
    skipped.push(`${f.id}: ${f.target} has choice flag "${target.choice?.flag}", expected "${f.flag}"`);
    continue;
  }
  // An addition that duplicates what the menu already offers is a transcription error, not a widening.
  const existing = new Set((target.choice.options ?? []).map((o) => o.value));
  const dup = f.add.filter((o) => existing.has(o.value)).map((o) => o.value);
  if (dup.length) {
    skipped.push(`${f.id}: ${dup.join(', ')} already on ${f.target}'s menu`);
    continue;
  }

  const value = [{ target: f.target, flag: f.flag, add: f.add, ...(f.addIfSanctified ? { addIfSanctified: f.addIfSanctified } : {}) }];
  rec.choiceOptionAdditions = value;
  entries.push({ category: 'feats', id: f.id, field: 'choiceOptionAdditions', value });
}

if (skipped.length) console.warn('SKIPPED:\n  ' + skipped.join('\n  '));
if (!entries.length) process.exit(1);

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wrote ${entries.length} menu wideners (backfill ${backfill.length} → ${next.length})`);
