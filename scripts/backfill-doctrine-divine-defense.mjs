/*
 * The warpriest and battle-creed doctrines do not GRANT Divine Defense — they ride on it.
 *
 * Both records shipped with `grantsClassFeatures: ["divine-defense"]`, read out of this sentence:
 *
 *   "At 13th level, if you gain the Divine Defense class feature, you also gain expert proficiency
 *    in light and medium armor."
 *
 * That is a conditional RIDER on a feature the cleric class table already hands every cleric at 13th
 * (`classes.cleric.features` lists `{ level: 13, featureId: 'divine-defense' }`). The doctrine gives
 * nothing; it says what happens when the class feature arrives.
 *
 * ⚠ The bad field was INERT until `ownedFeatureIds` was fixed to resolve `grantsClassFeatures` after
 * the chosen subclass joins the owned set — the same pass that lets Exemplar Dedication's chosen ikon
 * hand over its transcendence action. With the ordering corrected, this field would have put a
 * 13th-level class feature on a 1st-level warpriest's sheet, so the field goes rather than the
 * ordering being bent back around it.
 *
 * `value: null` REMOVES the field. Written to the overlay because a plain `public/core.json` edit dies
 * at the next `npm run data`: the importer re-reads the same sentence and re-derives the same grant.
 *
 * Not fixed here, and still open: the rider itself (expert light + medium armour at 13th for these two
 * doctrines) has no lane and is unbuilt. Deleting a wrong grant does not create a right one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';

const db = JSON.parse(readFileSync(CORE, 'utf8'));
const desc = JSON.parse(readFileSync(DESC, 'utf8'));
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/**
 * The two records, each with the clause the wrong grant was read out of. Quoted per record rather
 * than pattern-matched: warpriest prints "if you gain", battle-creed prints "when you gain", and a
 * loose match on "divine defense" would also fire on a record that really does grant it.
 */
const DOCTRINES = {
  // The two doctrine/creed records the player picks…
  warpriest: 'At 13th level, if you gain the Divine Defense class feature, you also gain expert proficiency in light and medium armor.',
  'battle-creed': 'At 13th level when you gain the Divine Defense class feature, you also gain expert proficiency in light and medium armor.',
  // …and the two per-level records carrying the same sentence. THESE are the ones that were already
  // live: `first-doctrine` is a 1st-level cleric class feature, so `first-doctrine-warpriest` is owned
  // from 1st through the subclass-variant rule, and its grant put Divine Defense on a 1st-level
  // warpriest's sheet long before `ownedFeatureIds`' ordering was touched. Measured, not assumed.
  'first-doctrine-warpriest': 'At 13th level, if you gain the Divine Defense class feature, you also gain expert proficiency in light and medium armor.',
  'initial-creed': 'At 13th level when you gain the Divine Defense class feature, you also gain expert proficiency in light and medium armor.',
};

// The class table is what makes the deletion safe: without it, removing the grant would take Divine
// Defense away from a warpriest entirely instead of moving it back to 13th.
const listed = (db.classes.cleric?.features ?? []).find((f) => f.featureId === 'divine-defense');
if (!listed) fail('the cleric class table no longer lists divine-defense — deleting the doctrine grant would remove it outright');
if (listed.level !== 13) fail(`the cleric class table lists divine-defense at ${listed.level}, not 13`);

const norm = (s) => s.replace(/[\u2019']/g, "'").toLowerCase();
for (const [id, quote] of Object.entries(DOCTRINES)) {
  const rec = db.classFeatures[id];
  if (!rec) fail(`${id} is not in classFeatures`);
  // The sentence the wrong grant was read from must still be the record's own, or this is a guess.
  if (!norm(desc.classFeatures?.[id]?.d ?? '').includes(norm(quote))) fail(`${id}'s text no longer contains "${quote}"`);
  if (rec.grantsClassFeatures && rec.grantsClassFeatures.join(',') !== 'divine-defense') {
    fail(`${id}.grantsClassFeatures is ${JSON.stringify(rec.grantsClassFeatures)} — read it before deleting`);
  }
}

for (const id of Object.keys(DOCTRINES)) {
  const i = rows.findIndex((r) => r.category === 'classFeatures' && r.id === id && r.field === 'grantsClassFeatures' && !r.path);
  const row = { category: 'classFeatures', id, field: 'grantsClassFeatures', value: null };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  delete db.classFeatures[id].grantsClassFeatures;
}

writeFileSync(BF, formatBackfill(rows));
writeFileSync(CORE, JSON.stringify(db));
console.log(
  `removed the divine-defense grant from ${Object.keys(DOCTRINES).join(' and ')}; the cleric table still grants it at 13\n` +
    `written: ${BF}, ${CORE}`,
);
