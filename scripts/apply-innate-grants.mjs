/*
 * Feats and backgrounds that promise an innate spell and granted nothing.
 *
 * A scan for "cast X once per day as an innate spell" flagged 31 records as uncovered. The verify
 * pass showed that was over-counted, twice over. `effectChoices` ALSO grants innate spells, in two
 * shapes the scan didn't check — `spellFilter` with `grantAs: 'innate'` (17 records) and per-option
 * `grant.innateSpells` (avenging-runelord-dedication, wired since v0.1.16). So the grant lanes are
 * four, not one: innateSpells, effectChoices.spellFilter, effectChoices.options[].grant, and
 * featCantripGrants.ts. Thirteen records were genuinely bare; this closes nine.
 *
 * Every spellId below was checked to exist in core.json `spells`. A hallucinated id produces a feat
 * that silently grants nothing, which is the exact bug being fixed.
 *
 * Still open, each for a stated reason:
 *   • magical-adept, magical-master, angel-eidolon — the spells are the EIDOLON's, not the
 *     character's, and there is no eidolon spell pool to put them in.
 *   • sign-bound — a 13-row constellation table pairing a spell with a frequency AND an attribute
 *     boost per row; not a pick from a filterable pool, and the boost has nowhere to go.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Records that NAME their spell(s) outright. */
const FIXED = {
  feats: {
    'kizidhar-magic': [
      { spellId: 'entangling-flora', tradition: 'arcane' },
      { spellId: 'one-with-plants', tradition: 'arcane' },
    ],
    'horn-and-bone-incantation': [
      { spellId: 'animal-form', tradition: 'primal' },
      { spellId: 'humanoid-form', tradition: 'primal' },
    ],
    // Printed as an EITHER/OR sharing one daily use, and only inside your demiplane, targeting only
    // yourself. Two 1/day grants is therefore slightly generous; the alternative is granting neither.
    'seat-of-power': [
      { spellId: 'cleanse-affliction', tradition: 'divine', rank: 4 },
      { spellId: 'sound-body', tradition: 'divine', rank: 4 },
    ],
    'more-real-than-real': [{ spellId: 'fabricated-truth', tradition: 'occult' }],
    'may-death-itself-reconsider': [{ spellId: 'breath-of-life', tradition: 'divine', usesPerDay: 3 }],
    // "at 18th level it heightens to 8th rank, and at 20th to 9th" — a custom ladder, not half-level.
    'fey-life': [{ spellId: 'summon-fey', tradition: 'primal', rank: 7, heightenAt: [{ level: 18, rank: 8 }, { level: 20, rank: 9 }] }],
  },
  backgrounds: {
    'blight-survivor': [{ spellId: 'cleanse-affliction', tradition: 'primal', heightenHalfLevel: true }],
  },
};

/**
 * Records that BRANCH: the spell depends on a choice, so each option carries its own grant.
 * `effectChoices` is the lane that both records the pick and applies it; `Feat.choice` only records.
 */
const BRANCHES = {
  feats: {
    'fey-ascension': [
      {
        id: 'fey-ascension-branch',
        prompt: 'Fey Ascension — the same fey or animal you chose for Fey Influence',
        options: [
          { value: 'anteater', label: 'Anteater', grant: { innateSpells: [{ spellId: 'slow', tradition: 'primal' }] } },
          { value: 'cat-sith', label: 'Cat Sith', note: 'Save against misfortune effects targeting you (no spell).' },
          { value: 'cursed-bluebird', label: 'Cursed Bluebird', grant: { innateSpells: [{ spellId: 'pest-form', tradition: 'primal', rank: 4 }] } },
          { value: 'dryad', label: 'Dryad', note: 'Leaves ranged unarmed attack, 1d6 slashing (dart group).' },
          {
            value: 'faun',
            label: 'Faun',
            grant: {
              innateSpells: [
                { spellId: 'charm', tradition: 'primal' },
                { spellId: 'sleep', tradition: 'primal' },
                { spellId: 'triple-time', tradition: 'primal' },
              ],
            },
          },
          { value: 'gremlin', label: 'Gremlin', grant: { innateSpells: [{ spellId: 'mad-monkeys', tradition: 'primal' }] } },
          { value: 'monarch', label: 'Monarch', note: 'Manifest butterfly wings 1/day for 10 minutes: fly Speed equal to your Speed.' },
          { value: 'unicorn', label: 'Unicorn', grant: { skills: { medicine: 'trained' } }, note: '+2 status to saves vs poison and charm.' },
        ],
      },
    ],
    'speakers-defense': [
      {
        id: 'speaker-kind',
        prompt: 'Are you a Faithspeaker or a Greenspeaker?',
        options: [
          {
            value: 'faithspeaker',
            label: 'Faithspeaker (divine)',
            grant: {
              innateSpells: [
                { spellId: 'share-life', tradition: 'divine' },
                { spellId: 'status', tradition: 'divine' },
              ],
            },
          },
          {
            value: 'greenspeaker',
            label: 'Greenspeaker (primal)',
            grant: {
              innateSpells: [
                { spellId: 'entangling-flora', tradition: 'primal' },
                { spellId: 'environmental-endurance', tradition: 'primal' },
              ],
            },
          },
        ],
      },
    ],
  },
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];
let fixed = 0;
let branched = 0;

const checkSpell = (id, owner) => {
  if (!db.spells[id]) throw new Error(`${owner}: spell '${id}' is not in core.json`);
};

for (const [category, entries] of Object.entries(FIXED)) {
  for (const [id, spells] of Object.entries(entries)) {
    const rec = db[category]?.[id];
    if (!rec) throw new Error(`${category}/${id} not found`);
    if ((rec.innateSpells ?? []).length) throw new Error(`${category}/${id} already grants — refusing to overwrite`);
    for (const s of spells) checkSpell(s.spellId, `${category}/${id}`);
    rec.innateSpells = spells;
    patches.push({ category, id, field: 'innateSpells', value: spells });
    fixed++;
  }
}

for (const [category, entries] of Object.entries(BRANCHES)) {
  for (const [id, choices] of Object.entries(entries)) {
    const rec = db[category]?.[id];
    if (!rec) throw new Error(`${category}/${id} not found`);
    if ((rec.effectChoices ?? []).length) throw new Error(`${category}/${id} already has effectChoices — refusing to overwrite`);
    for (const ch of choices) {
      if ((ch.options ?? []).length < 2) throw new Error(`${category}/${id}: branch with <2 options`);
      for (const o of ch.options) for (const s of o.grant?.innateSpells ?? []) checkSpell(s.spellId, `${category}/${id}/${o.value}`);
    }
    rec.effectChoices = choices;
    patches.push({ category, id, field: 'effectChoices', value: choices });
    branched++;
  }
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`innate grants: ${fixed} records named their spells, ${branched} branch on a choice.`);
