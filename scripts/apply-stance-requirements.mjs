/*
 * Backfills stance **Requirements** and the resistances stances grant.
 *
 * 47 of 128 stances print a Requirements line and none were modelled, so a character in full plate
 * could toggle Rain of Embers and collect its +1 status AC. `unarmored` is the machine-checkable part;
 * every other requirement is stored as text only and shown as a reminder rather than pretended to be
 * enforced.
 *
 * Resistances are deliberately NOT backfilled wholesale. Of the 8 stances whose text mentions
 * resistance, only 3 grant a plain typed resistance. The rest are conditional on the SOURCE of the
 * damage ("against damage dealt to you by animals, beasts, fey…") or depend on a trait chosen
 * elsewhere — modelling those as flat resistances would overstate them on every other hit.
 *
 * Usage: node scripts/apply-stance-requirements.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Resistances read off each stance's own text. Only unconditional, typed ones belong here. */
const RESISTANCES = {
  // "fire resistance equal to half your level (minimum 1)"
  'rain-of-embers-stance': [{ type: 'fire', value: 'max(1, floor(@actor.level/2))' }],
  // "resistance 2 to electricity and resistance 2 to sonic damage"
  'sky-and-heaven-stance': [{ type: 'electricity', value: 2 }, { type: 'sonic', value: 2 }],
  // "resistance 2 to all physical damage"
  'stunt-performer-stance': [{ type: 'physical', value: 2 }],
};

/** Conditional / choice-dependent resistances left unmodelled on purpose, with the reason. */
const RESISTANCE_SKIPPED = {
  'jesters-gambol': 'conditional on the damage SOURCE (animals, beasts, fey, fungi, plants)',
  'masquerade-of-seasons-stance': 'resistance 5 applies only to the trait chosen when entering',
  'push-back-the-dead': 'conditional on the damage source (Strikes by undead) and scales off Charisma',
  'thermal-nimbus': "type depends on the kineticist's chosen element",
  'alloy-flesh-and-steel': 'level-scaled entry whose base resistance is defined elsewhere in the text',
};

let reqUnarmored = 0;
let reqTextOnly = 0;
let resApplied = 0;
const missing = [];

/** A stance's rules text can live in feats, actions or classFeatures — Bullet Dancer Stance and
 *  Tenacious Stance are actions, and looking only in `feats` silently skipped both. */
const RECORD_BUCKETS = ['feats', 'actions', 'classFeatures'];
const textFor = (id) => {
  for (const b of RECORD_BUCKETS) {
    const t = strip(db[b]?.[id]?.description);
    if (t.includes('**Requirements**')) return t;
  }
  return strip(db.feats?.[id]?.description);
};

let reqArmored = 0;

for (const [id, stance] of Object.entries(db.stances ?? {})) {
  const text = textFor(id);
  if (text) {
    // The printed Requirements line runs to the first sentence break or the description separator.
    const m = text.match(/\*\*Requirements\*\*\s*([^*]{0,140}?)(?:\s*---|\.\s|$)/);
    if (m) {
      const printed = m[1].trim().replace(/\.$/, '');
      const unarmored = /\bunarmored\b/i.test(printed);
      // "You are wearing armor" (Tenacious Stance) is the mirror image, not a near-miss of unarmored.
      const armored = !unarmored && /\bwearing armor\b/i.test(printed);
      stance.requires = { ...(unarmored && { unarmored: true }), ...(armored && { armored: true }), text: printed };
      if (unarmored) reqUnarmored++;
      else if (armored) reqArmored++;
      else reqTextOnly++;
    }
  }
  if (RESISTANCES[id]) {
    stance.resistances = RESISTANCES[id];
    resApplied++;
  }
}

for (const id of Object.keys(RESISTANCES)) if (!db.stances?.[id]) missing.push(id);

console.log(
  `requirements : ${reqUnarmored} enforceable (unarmored) · ${reqArmored} enforceable (wearing armor) · ${reqTextOnly} reminder-only`,
);
console.log(`resistances  : ${resApplied} applied`);
console.log('resistances deliberately skipped (would overstate the benefit):');
for (const [id, why] of Object.entries(RESISTANCE_SKIPPED)) console.log(`  ${id} — ${why}`);
if (missing.length) console.log('MISSING stance entries:', missing.join(', '));
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(db)); // minified — pretty-printing once inflated this file by 4 MB
console.log('\nwritten:', PATH);
