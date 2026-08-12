/**
 * FIXES THE TWELVE `grantsCreatureTraits` DEFECTS confirmed in scripts/audit/authored-verification.json.
 *
 * Every one of them is the same mistake made in four ways: `DefenseGrants.grantsCreatureTraits` is a
 * flat, unconditional, unchosen `string[]`, and it was used for clauses that are none of those things.
 * Four of the twelve are simply short — the printed sentence names traits the array does not — and are
 * fixed by writing what the text says. The other eight could NOT be written correctly in that field,
 * so the field grew two siblings first (see src/rules/types.ts):
 *
 *   EffectGrant.grantsCreatureTraits    a trait belonging to ONE BRANCH of a choice
 *   grantsCreatureTraitFromChoice       a choice whose ANSWER is the trait
 *   ModeDef.creatureTraits              a trait that is only true while something is running
 *
 * ── the twelve ─────────────────────────────────────────────────────────────────────────────────
 * short list, text names more traits than the array does:
 *   heritages/aiuvarin      "the elf trait, the aiuvarin trait"      ["elf"]  → ["elf","aiuvarin"]
 *   heritages/dromaar       "the orc trait, the dromaar trait"       ["orc"]  → ["orc","dromaar"]
 *   heritages/undine        "the undine trait" + "the amphibious trait" in the NEXT sentence
 *   feats/ghost-dedication  "the ghost, spirit, and undead traits" + "also … the incorporeal trait"
 *
 * one branch of a choice (→ EffectGrant.grantsCreatureTraits on that option):
 *   heritages/swimming-animal  aquatic belongs to the Aquatic branch; the Water-dwelling branch
 *                              exists BECAUSE that character still breathes air
 *   classFeatures/deity-champion  holy belongs to the Holy branch. Unholy is the OPPOSING trait
 *                              ("if you … gain the opposing trait in some way, you lose the previous
 *                              trait until you atone"), and a "none" deity grants neither
 *   feats/elemental-apotheosis  "and the trait of your chosen element" — the record already asked
 *                              which element, for its Speeds; the answer now also carries the trait
 *
 * the answer IS the trait (→ grantsCreatureTraitFromChoice):
 *   feats/celestial-form    "the trait appropriate to the type of servitor you've become (archon,
 *                           angel, or azata, FOR EXAMPLE)" — an open list, so allowCustom
 *   feats/fiendish-form     "…(SUCH AS daemon, demon, or devil)" — likewise open
 *   feats/celestial-rebirth "the agathion, angel, archon, or azata trait" — a closed four, and the
 *                           record already carried that picker with nothing reading its answer
 *
 * only while it is running (→ ModeDef.creatureTraits):
 *   feats/worm-form  "WHILE IN THIS FORM, you gain the animal trait." Filed on the feat, it made a
 *                    worm caller standing in a tavern an animal. It moves onto the two battle-form
 *                    modes that already exist for it
 *   feats/fey-life   "The FIRST TIME YOU DIE after gaining this feat … you revive … and you gain the
 *                    fey trait." The feat's own prerequisite is "you're not a fey", so the authored
 *                    value made the character fey at the instant the record says they are not. A mode
 *                    the player switches on when it happens — principle M2, the app supplies the
 *                    capability and the player supplies the timing
 *
 * Both carriers are written, because either alone is lost: effect-backfill.json is the only overlay
 * that survives `npm run data`, and toggle-modes.json is what carries modes through it. public/core.json
 * is updated in place so the change is live without a regeneration.
 *
 * Run: node scripts/apply-creature-trait-lanes.mjs [--dry]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const rows = readBackfill(ROOT);

/** Set (or clear, with `null`) one field on one record, in BOTH carriers. */
function put(category, id, field, value) {
  const rec = core[category]?.[id];
  if (!rec) throw new Error(`no ${category}/${id} in core.json`);
  if (value === null) delete rec[field];
  else rec[field] = value;
  const row = rows.find((r) => r.category === category && r.id === id && r.field === field && !r.path?.length);
  if (row) row.value = value;
  else rows.push({ category, id, field, value });
  changed.push(`${category}/${id}.${field}`);
}
const changed = [];

/* ── 1. the four short lists ───────────────────────────────────────────────────────────────────
 * Nothing new is needed to say these: the sentence names N traits and the array held fewer. The
 * record's own `traits` array (aiuvarin, dromaar, amphibious all appear there) is NOT a substitute —
 * `creatureTraitsOf` never reads it, so those traits reached the heritage card and never the Details
 * tab, which is the surface owner ruling Q6 is about.
 */
put('heritages', 'aiuvarin', 'grantsCreatureTraits', ['elf', 'aiuvarin']);
put('heritages', 'dromaar', 'grantsCreatureTraits', ['orc', 'dromaar']);
put('heritages', 'undine', 'grantsCreatureTraits', ['undine', 'amphibious']);
put('feats', 'ghost-dedication', 'grantsCreatureTraits', ['ghost', 'spirit', 'undead', 'incorporeal']);

/* ── 2. Swimming Animal — the trait belongs to one branch ─────────────────────────────────────── */
put('heritages', 'swimming-animal', 'grantsCreatureTraits', null);
put('heritages', 'swimming-animal', 'effectChoices', [
  {
    id: 'aquatic-or-water-dwelling',
    prompt: 'Choose whether you are aquatic or water-dwelling',
    options: [
      {
        value: 'aquatic',
        label: 'Aquatic (gain the aquatic trait; swim Speed 30 ft)',
        note: 'The aquatic trait means you breathe water but not air, and your bludgeoning and slashing unarmed Strikes don’t take the usual –2 penalty for being underwater.',
        grant: { speeds: { swim: 30 }, grantsCreatureTraits: ['aquatic'] },
      },
      {
        value: 'water-dwelling',
        label: 'Water-dwelling (hold breath 10 min; swim Speed 20 ft, land Speed 20 ft)',
        note: 'You can hold your breath underwater for 10 minutes before needing air — so you do NOT gain the aquatic trait, which would mean breathing water and not air.',
        grant: { speeds: { swim: 20 } },
      },
    ],
  },
]);

/* ── 3. the champion's sanctification ──────────────────────────────────────────────────────────
 * The record already asked the question and threw the answer away. Its three branches are holy,
 * unholy and NEITHER, so no single array can be right for all three; "holy" was right for one.
 */
put('classFeatures', 'deity-champion', 'grantsCreatureTraits', null);
put('classFeatures', 'deity-champion', 'choice', {
  flag: 'sanctification',
  prompt: 'Sanctification',
  kind: 'array',
  options: [
    {
      value: 'holy',
      label: 'Holy — gain the holy trait; add it to your Strikes',
      grant: { grantsCreatureTraits: ['holy'] },
    },
    {
      value: 'unholy',
      label: 'Unholy — gain the unholy trait; add it to your Strikes',
      grant: { grantsCreatureTraits: ['unholy'] },
    },
    {
      value: 'none',
      label: 'None — take no sanctification',
      description: 'Your deity lists “none”: you take neither trait, and can choose only options that don’t require holy or unholy.',
    },
  ],
});

/* ── 4. Elemental Apotheosis — "and the trait of your chosen element" ──────────────────────────
 * The six options already existed, for the Speeds each element's Elemental Form grants. The second
 * half of the sentence now rides the same answer, so the element cannot be one thing for Speed and
 * another for the trait.
 */
put('feats', 'elemental-apotheosis', 'effectChoices', [
  {
    id: 'elemental-apotheosis-element',
    prompt: 'Elemental Apotheosis — your element (its Speeds from Elemental Form, and its creature trait)',
    options: [
      { value: 'air', label: 'Air — fly 80 feet; the air trait', grant: { speeds: { fly: 80 }, grantsCreatureTraits: ['air'] } },
      { value: 'earth', label: 'Earth — burrow 20 feet; the earth trait', grant: { speeds: { burrow: 20 }, grantsCreatureTraits: ['earth'] } },
      {
        value: 'fire',
        label: 'Fire — the fire trait',
        note: 'Elemental Form (fire) lists only a 50-foot land Speed.',
        grant: { grantsCreatureTraits: ['fire'] },
      },
      { value: 'metal', label: 'Metal — fly 20 feet; the metal trait', grant: { speeds: { fly: 20 }, grantsCreatureTraits: ['metal'] } },
      { value: 'water', label: 'Water — swim 60 feet; the water trait', grant: { speeds: { swim: 60 }, grantsCreatureTraits: ['water'] } },
      { value: 'wood', label: 'Wood — climb 30 feet; the wood trait', grant: { speeds: { climb: 30 }, grantsCreatureTraits: ['wood'] } },
    ],
  },
]);

/* ── 5. the three servitor traits — the answer IS the trait ────────────────────────────────────
 * "for example" and "such as" make the printed lists ILLUSTRATIVE, so a closed option list would be
 * authoring a value we know may be wrong. `allowCustom` (gold-set principle I) lets the player name
 * the servitor their GM's cosmology actually has; the listed three are what the book prints.
 */
const SERVITOR = (values, label, placeholder) => ({
  flag: 'servitorTrait',
  prompt: 'The type of servitor you have become',
  kind: 'array',
  allowCustom: { label, placeholder },
  options: values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
});
put('feats', 'celestial-form', 'choice', SERVITOR(['archon', 'angel', 'azata'], 'Another kind of celestial', 'e.g. agathion'));
put('feats', 'celestial-form', 'grantsCreatureTraitFromChoice', 'servitorTrait');
put('feats', 'fiendish-form', 'choice', SERVITOR(['daemon', 'demon', 'devil'], 'Another kind of fiend', 'e.g. asura'));
put('feats', 'fiendish-form', 'grantsCreatureTraitFromChoice', 'servitorTrait');

// Celestial Rebirth's list is CLOSED ("the agathion, angel, archon, or azata trait"), so no custom
// row. Its picker already shipped and its answer reached nothing — `celestialTrait` has zero readers
// in src/. This is the reader.
put('feats', 'celestial-rebirth', 'choice', {
  flag: 'celestialTrait',
  prompt: 'Whose ranks are you joining?',
  kind: 'array',
  options: [
    { value: 'agathion', label: 'Agathion' },
    { value: 'angel', label: 'Angel' },
    { value: 'archon', label: 'Archon' },
    { value: 'azata', label: 'Azata' },
  ],
});
put('feats', 'celestial-rebirth', 'grantsCreatureTraitFromChoice', 'celestialTrait');

/* ── 6. the two that are only true while something is running ─────────────────────────────────── */
put('feats', 'worm-form', 'grantsCreatureTraits', null);
put('feats', 'fey-life', 'grantsCreatureTraits', null);

const MODE_PATCHES = {
  'worm-form-purple-worm': { creatureTraits: ['animal'] },
  'worm-form-hybrid': { creatureTraits: ['animal'] },
};
const NEW_MODES = {
  'fey-life-revived': {
    id: 'fey-life-revived',
    name: 'Fey Life (revived)',
    category: 'Aftermath',
    modifiers: [],
    predefined: true,
    feats: ['fey-life'],
    creatureTraits: ['fey'],
    duration: 'permanent — once you have died the first time',
    note:
      'Fey Life: “The first time you die after gaining this feat… Immediately after dying, you revive, becoming conscious (and wounded as normal) at 27 Hit Points, and you gain the fey trait.” ' +
      'Switch this on the first time it happens — until then the feat’s own prerequisite says “you’re not a fey”. ' +
      'The visual aspect you take on (wings, horns, a plantlike body) has no mechanical effect.',
  },
};

core.modes ??= {};
for (const [id, patch] of Object.entries(MODE_PATCHES)) {
  if (!core.modes[id]) throw new Error(`no mode ${id} in core.json`);
  core.modes[id] = { ...core.modes[id], ...patch };
  changed.push(`modes/${id}`);
}
for (const [id, def] of Object.entries(NEW_MODES)) {
  if (!core.feats[def.feats[0]]) throw new Error(`no feat ${def.feats[0]}`);
  core.modes[id] = def;
  changed.push(`modes/${id} (new)`);
}

for (const line of changed) console.log('  ' + line);
console.log(`\n${changed.length} writes · ${rows.length} backfill rows`);

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

writeFileSync(p('public/core.json'), JSON.stringify(core));
writeBackfill(ROOT, rows);
const SRC = p('scripts/data/toggle-modes.json');
const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
for (const id of [...Object.keys(MODE_PATCHES), ...Object.keys(NEW_MODES)]) prev[id] = core.modes[id];
writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
console.log('written: public/core.json, scripts/data/effect-backfill.json, scripts/data/toggle-modes.json');
