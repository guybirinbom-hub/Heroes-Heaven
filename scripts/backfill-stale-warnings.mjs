/*
 * Remove dataWarnings that are no longer true.
 *
 * A `dataWarning` renders as a "Missing data — N effects reference content not in the current data"
 * panel on the Feats tab. Five of the seventeen were describing mechanics the engine has since
 * gained, so alchemists, psychics, Cathartic Mages, Second-Chance Champions and captivators were all
 * being told something was broken that works.
 *
 * TWO OF THEM I RESURRECTED MYSELF TODAY: scripts/harvest-lost-fields.mjs restores fields a data regen
 * deleted, reading them from a known-good core.json — and it cannot tell a field that was lost from
 * one that was deliberately REMOVED after that snapshot. Anything intentionally deleted between the
 * snapshot and the harvest comes back. Worth remembering before running that script again.
 *
 * Each removal is checked against the record's current mechanics before it is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/** Each entry names the record, and a predicate proving the warning is now false. */
const STALE = [
  {
    cat: 'feats',
    id: 'conscious-spell-specialization',
    why: 'the warning says the app does not restrict the slots; they are now a restricted grant',
    proof: (r) => !!r.spellSlotBonus?.restricted,
  },
  {
    cat: 'feats',
    id: 'captivating-intensity',
    why: 'the warning says per-spell innate uses are not tracked; the captivator now shows them at 2/day',
    proof: (r) => typeof r.note === 'string' && /2\/day/.test(r.note),
  },
  {
    cat: 'classFeatures',
    id: 'chirurgeon',
    why: 'the warning says skill substitution does not exist; skillSubstitutions does, and deriveSkill reads it',
    proof: (r) => (r.skillSubstitutions ?? []).some((s) => s.use === 'crafting' && s.forSkill === 'medicine'),
  },
  {
    cat: 'feats',
    id: 'cathartic-focus-spell',
    why: 'the warning says no spell or Focus Point is added; it grants a focus point and every emotion names a real focus spell',
    proof: (r) =>
      r.focusPoolBonus === 1 &&
      (r.effectChoices ?? []).some((ch) => (ch.options ?? []).every((o) => (o.grant?.focusSpells ?? []).every((s) => !!db.spells[s]))),
  },
  {
    cat: 'backgrounds',
    id: 'second-chance-champion',
    // AoN: "You're trained in the Athletics skill, and the Gladiatorial Lore skill. You gain the Cat
    // Fall skill feat." The warning is wrong twice: it says Acrobatics, and all three grants are present.
    why: 'the warning names the wrong skill (Acrobatics for Athletics) and claims grants that are all present',
    proof: (r) => r.trainedSkill === 'athletics' && r.trainedLore === 'gladiatorial' && r.grantedFeatId === 'cat-fall',
  },
];

let removed = 0;
for (const s of STALE) {
  const rec = db[s.cat]?.[s.id];
  if (!rec) fail(`${s.cat}/${s.id} does not exist`);
  if (!rec.dataWarning) {
    console.log(`  (already clean) ${s.cat}/${s.id}`);
    continue;
  }
  if (!s.proof(rec)) fail(`${s.cat}/${s.id}: the mechanic that would make its warning false is NOT present — ${s.why}`);
  // Drop every backfill row that writes this warning, whatever it was harvested from.
  const before = rows.length;
  for (let i = rows.length - 1; i >= 0; i--)
    if (rows[i].category === s.cat && rows[i].id === s.id && rows[i].field === 'dataWarning' && !rows[i].path) rows.splice(i, 1);
  console.log(`  removed ${before - rows.length} row(s) for ${s.cat}/${s.id} — ${s.why}`);
  removed++;
}

if (!removed) {
  console.log('nothing to remove');
  process.exit(0);
}
writeFileSync(BF, formatBackfill(rows));
console.log(`\n${removed} stale warning(s) cleared; effect-backfill now holds ${rows.length} rows`);
