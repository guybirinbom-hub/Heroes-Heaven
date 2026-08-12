/**
 * AUTHORS THE `battleForm` LANE — the field shipped built and EMPTY (0 of 429 modes carried one).
 *
 * Owner ruling Q3: *"a battle form gets a mode that really overrides the stats it names — and must
 * make plain that a mode is active and what changed."* The overriding half is `BattleForm` in
 * types.ts, consumed by deriveAc / deriveStrikes / deriveSpeeds / deriveDefenses. The "make plain"
 * half is the mode itself: it appears in the active-mode list with its name, its printed duration and
 * its `note`, the AC breakdown names the form instead of printing parts that no longer sum, and every
 * Strike it grants is flagged `fromBattleForm`.
 *
 * ── The one rule this file follows ─────────────────────────────────────────────────────────────
 * **Author what the text states and nothing more.** A field the text does not state stays ABSENT,
 * because absent means "keep the character's own value" — writing a guess would silently overwrite a
 * real statistic. That is why Dragon Transformation carries speeds and senses but no `ac` and no
 * `attackMod`: its text says *"you use your own AC and attack modifier"*.
 *
 * ── Why so few, when the audit counted 44 records ──────────────────────────────────────────────
 * Most battle-form feats do not state statistics — they say "add the shapes in Insect Form to your
 * Untamed Form list", or "cast Animal Form", leaving BOTH the variant and the rank to the player at
 * cast time. A mode is a fixed set of numbers; it cannot ask a question. Only a record that pins the
 * form AND its rank AND its variant has a determinate stat block, and those are the ones here. The
 * rest are listed in NOT_AUTHORED with the reason, rather than authored with invented numbers.
 *
 * Modes land in public/core.json AND scripts/data/toggle-modes.json — the importer merges that file
 * back over the `modes` bucket on every `npm run data` (see import-core-v2.mjs), which is what makes
 * them durable. `degreeShifts` needs the effect-backfill overlay; modes have their own carrier.
 *
 * Run: node scripts/apply-battle-forms.mjs [--dry]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

/** Two forms can never run at once, so they share one exclusive group. */
const GROUP = 'battle-form';
const LOW_LIGHT = { name: 'low-light-vision' };
const SCENT30 = { name: 'scent', range: 30, acuity: 'imprecise' };
const DARKVISION = { name: 'darkvision' };

/**
 * PEST FORM's printed statistics (1st rank). "AC = 15 + your level" is a FORMULA, not a number —
 * which is why `BattleForm.ac` accepts a string: authored as the flat 15 it printed, a 10th-level
 * druid would have walked around at AC 15.
 */
const PEST_FORM = {
  ac: '15+@actor.level',
  speeds: { land: 20 },
  senses: [LOW_LIGHT, SCENT30],
  size: 'Tiny',
};
const PEST_NOTE =
  'Pest form: AC = 15 + your level (ignore your armor’s check penalty and Speed reduction), Speed 20 feet, ' +
  'weakness 5 to physical damage, low-light vision and imprecise scent 30 feet, Acrobatics and Stealth +10 ' +
  'unless yours are higher, Athletics −4. ⚠ You cannot make Strikes in this form — the app cannot take your ' +
  'Strikes away without replacing them, so ignore the Strikes list while this is on.';

const MODES = {
  /* ── PEST FORM, 1st rank ─────────────────────────────────────────────────────────────────────── */
  'critter-shape': {
    name: 'Critter Shape',
    feats: ['critter-shape'],
    duration: 'up to 10 minutes, once per hour',
    battleForm: PEST_FORM,
    note: `Critter Shape: the effect of a 1st-rank pest form, in an animal matching your inherent animal. ${PEST_NOTE}`,
  },
  'rat-form': {
    name: 'Rat Form',
    feats: ['rat-form'],
    battleForm: PEST_FORM,
    note: `Rat Form: the effect of a 1st-rank pest form, as a Tiny rat. ${PEST_NOTE}`,
  },
  'crawling-form': {
    name: 'Crawling Form',
    feats: ['crawling-form'],
    battleForm: PEST_FORM,
    note: `Crawling Form: the effect of a 1st-rank pest form, in a shape matching your heritage. ${PEST_NOTE}`,
  },
  /* ── PEST FORM, 4th rank — the only difference the spell states is the fly Speed ─────────────── */
  'bat-form': {
    name: 'Bat Form',
    feats: ['bat-form'],
    duration: 'once per hour',
    // 4th-rank pest form is the 1st-rank block plus "a fly Speed of 20 feet". `speeds` REPLACES the
    // block outright, so the land Speed has to be restated or the bat would lose it.
    battleForm: { ...PEST_FORM, speeds: { land: 20, fly: 20 } },
    note: `Bat Form: the effect of a 4th-rank pest form, as a bat. ${PEST_NOTE} At 14th level you can spend 2 actions instead to gain a 4th- or 5th-rank aerial form (bat only) — those statistics are not this mode.`,
  },
  'form-of-the-bat': {
    name: 'Form of the Bat',
    feats: ['form-of-the-bat'],
    duration: 'once per hour',
    battleForm: { ...PEST_FORM, speeds: { land: 20, fly: 20 } },
    note: `Form of the Bat: the effect of a 4th-rank pest form, always a bat. ${PEST_NOTE}`,
  },
  /* ── A record with its OWN printed stat block ────────────────────────────────────────────────── */
  'a-little-bird-told-me': {
    name: 'A Little Bird Told Me',
    feats: ['a-little-bird-told-me'],
    battleForm: { ac: '20+@actor.level', speeds: { fly: 25 }, senses: [LOW_LIGHT, SCENT30], size: 'Tiny' },
    note:
      'A Little Bird Told Me: AC = 20 + your level, fly Speed 25 feet, weakness 5 to physical damage, low-light ' +
      'vision and imprecise scent 30 feet, Acrobatics and Stealth +10 unless yours are higher, Athletics −4. ' +
      '⚠ You cannot make Strikes in this form. You resume your normal shape automatically at 0 Hit Points.',
  },
  /* ── ANIMAL FORM at a rank and variant the FEAT pins ─────────────────────────────────────────── */
  // 5th rank: Huge, 15-foot reach, 20 temp HP, AC = 18 + level, attack +18, damage +7 and DOUBLE the
  // number of damage dice, Athletics +20. Canine is Speed 40 with jaws 2d8 piercing, so the doubled
  // dice give 4d8+7 — the arithmetic is stated in the note so a reader can check it.
  'ancestors-rage': {
    name: 'Ancestors’ Rage (canine)',
    feats: ['ancestors-rage'],
    duration: 'once per day, 5th-rank animal form',
    battleForm: {
      ac: '18+@actor.level',
      attackMod: 18,
      strikes: [{ name: 'Jaws', damage: '4d8+7 piercing', traits: ['unarmed', 'reach-15'] }],
      speeds: { land: 40 },
      senses: [LOW_LIGHT, SCENT30],
      size: 'Huge',
      tempHp: 20,
    },
    note:
      'Ancestors’ Rage: a 5th-rank animal form, canine only, as an enormous otherworldly hyena. AC = 18 + your ' +
      'level, 20 temporary Hit Points, attack modifier +18, Athletics +20 unless yours is higher, Huge with ' +
      '15-foot reach. The jaws print 2d8 piercing with a +7 damage bonus; 5th rank doubles the damage dice, so ' +
      'it deals 4d8+7. You gain the animal trait and must have room to expand into Huge.',
  },
  'form-of-the-beloved-mother': {
    name: 'Form of the Beloved Mother (snake)',
    feats: ['form-of-the-beloved-mother'],
    duration: 'once per day, 5th-rank animal form',
    battleForm: {
      ac: '18+@actor.level',
      attackMod: 18,
      strikes: [{ name: 'Fangs', damage: '4d4+7 piercing plus 1d6 poison', traits: ['unarmed', 'reach-15'] }],
      speeds: { land: 20, climb: 20, swim: 20 },
      senses: [LOW_LIGHT, SCENT30],
      size: 'Huge',
      tempHp: 20,
    },
    note:
      'Form of the Beloved Mother: a 5th-rank animal form, snake only. AC = 18 + your level, 20 temporary Hit ' +
      'Points, attack modifier +18, Athletics +20 unless yours is higher, Huge with 15-foot reach. Snake fangs ' +
      'print 2d4 piercing plus 1d6 poison with a +7 damage bonus; 5th rank doubles the printed damage dice, so ' +
      'the piercing becomes 4d4+7 (the rider poison die is left as printed — the spell doubles "the number of ' +
      'damage dice", and the conservative reading is that the rider is not part of the form’s listed damage). ' +
      'Spending an extra action also casts 5th-rank slither, which never harms you.',
  },
  /* ── ELEMENTAL FORM at the rank and element the FEAT pins ────────────────────────────────────── */
  // 7th rank: Huge, 15-foot reach, AC = 22 + level, 20 temp HP, attack +25, damage +11, double dice.
  // Air is fly 80 with a gust of 1d4 bludgeoning → 2d4+11.
  'storm-form': {
    name: 'Storm Form (air elemental)',
    feats: ['storm-form'],
    duration: 'once per day, 7th-rank elemental form',
    battleForm: {
      ac: '22+@actor.level',
      attackMod: 25,
      strikes: [{ name: 'Gust', damage: '2d4+11 bludgeoning', traits: ['unarmed', 'reach-15'] }],
      speeds: { fly: 80 },
      senses: [DARKVISION],
      size: 'Huge',
      tempHp: 20,
    },
    note:
      'Storm Form: a 7th-rank elemental form, air only. AC = 22 + your level, 20 temporary Hit Points, attack ' +
      'modifier +25, Acrobatics +25 unless yours is higher, darkvision, Huge with 15-foot reach. Your movement ' +
      'does not trigger reactions. The gust prints 1d4 bludgeoning with a +11 damage bonus; 7th rank doubles the ' +
      'damage dice, so it deals 2d4+11. You have hands and can take manipulate actions.',
  },
  /* ── COSMIC FORM is a rank-7 spell and the feat casts it at rank 7, so the printed block is exact */
  'transcend-the-azimuth-sun': {
    name: 'Transcend the Azimuth (sun)',
    feats: ['transcend-the-azimuth'],
    duration: 'once per day, 7th-rank cosmic form',
    battleForm: {
      ac: '21+@actor.level',
      attackMod: 25,
      strikes: [
        { name: 'Fist', damage: '2d6+10 fire plus 1d6 persistent fire', traits: ['agile', 'unarmed', 'reach-10'] },
        { name: 'Sunbeam', damage: '1d6+10 fire plus 1d6 persistent fire', traits: ['range-90'], ranged: true },
      ],
      speeds: { land: 30, fly: 50 },
      senses: [DARKVISION],
      size: 'Large',
      tempHp: 20,
    },
    note:
      'Transcend the Azimuth, sun form: AC = 21 + your level, 20 temporary Hit Points, darkvision, attack ' +
      'modifier +25, Athletics +25 unless yours is higher, Large. On a critical hit with either Strike the ' +
      'target is dazzled for 1 round. You have hands and can take manipulate actions. Sustaining lets you switch ' +
      'to the moon form once per turn — switch the mode over when you do.',
  },
  'transcend-the-azimuth-moon': {
    name: 'Transcend the Azimuth (moon)',
    feats: ['transcend-the-azimuth'],
    duration: 'once per day, 7th-rank cosmic form',
    battleForm: {
      ac: '21+@actor.level',
      attackMod: 25,
      strikes: [
        { name: 'Fist', damage: '2d4+10 bludgeoning plus 1d6 fire', traits: ['agile', 'unarmed', 'reach-10'] },
        { name: 'Moonbeam', damage: '2d4+10 fire', traits: ['range-90'], ranged: true },
      ],
      speeds: { land: 30, fly: 50 },
      senses: [DARKVISION],
      size: 'Large',
      tempHp: 20,
    },
    note:
      'Transcend the Azimuth, moon form: AC = 21 + your level, 20 temporary Hit Points, darkvision, attack ' +
      'modifier +25, Athletics +25 unless yours is higher, Large. This form’s fire damage counts as silver for ' +
      'resistances and weaknesses. On a critical hit with either Strike the target is stupefied 2 for 1 round. ' +
      'Sustaining lets you switch to the sun form once per turn — switch the mode over when you do.',
  },
  /* ── WORM FORM prints its own block, and prints TWO shapes ───────────────────────────────────── */
  'worm-form-purple-worm': {
    name: 'Worm Form (purple worm)',
    feats: ['worm-form'],
    battleForm: {
      ac: '20+@actor.level',
      attackMod: 25,
      strikes: [
        { name: 'Jaws', damage: '3d10+15 piercing', traits: ['unarmed', 'deadly-2d10', 'reach-15'] },
        { name: 'Stinger', damage: '2d12+15 piercing plus 2d6 persistent poison', traits: ['agile', 'poison', 'unarmed', 'reach-15'] },
        { name: 'Body', damage: '1d10+13 bludgeoning', traits: ['unarmed', 'reach-15'] },
      ],
      speeds: { land: 40, burrow: 30, swim: 20 },
      senses: [DARKVISION],
      size: 'Huge',
      tempHp: 40,
    },
    note:
      'Worm Form, purple worm: AC = 20 + your level, 40 temporary Hit Points, darkvision, attack modifier +25, ' +
      'Athletics +30 unless yours is higher, Huge — you must have room to expand into. You gain the animal trait ' +
      'and can Dismiss the form.',
  },
  'worm-form-hybrid': {
    name: 'Worm Form (humanoid-worm hybrid)',
    feats: ['worm-form'],
    battleForm: {
      ac: '20+@actor.level',
      attackMod: 25,
      strikes: [
        { name: 'Stinger', damage: '2d12+15 piercing plus 1d6 persistent poison', traits: ['agile', 'poison', 'unarmed', 'reach-10'] },
        { name: 'Body', damage: '1d10+13 bludgeoning', traits: ['unarmed', 'reach-10'] },
      ],
      speeds: { land: 40 },
      senses: [DARKVISION],
      size: 'Huge',
      tempHp: 40,
    },
    note:
      'Worm Form, hybrid: your own head on a worm’s body. AC = 20 + your level, 40 temporary Hit Points, ' +
      'darkvision, attack modifier +25, Athletics +30 unless yours is higher, Huge. You keep the ability to ' +
      'speak — see the feat for what else the hybrid retains.',
  },
  /* ── Forms that state what they DO NOT replace. The absent fields are the whole point. ───────── */
  'dragon-transformation': {
    name: 'Dragon Transformation',
    feats: ['dragon-transformation'],
    duration: 'while raging',
    // No `ac` and no `attackMod`: the feat says "you use your own AC and attack modifier", and an
    // absent field is the only way to say "keep yours". No `strikes` either — the dragon Strikes are
    // rolled at YOUR attack modifier, and `deriveStrikes` reads a form's strikes at `attackMod ?? 0`,
    // so authoring them without a modifier would print +0 on every one of them.
    battleForm: { speeds: { land: 40, fly: 100 }, senses: [DARKVISION, { name: 'scent', range: 60, acuity: 'imprecise' }], size: 'Large' },
    note:
      'Dragon Transformation: a 6th-rank dragon form, except you keep your own AC and attack modifier, add your ' +
      'Rage damage, and your Dragon Breath uses your class DC. 10 temporary Hit Points (they stack with rage’s). ' +
      'Strikes: jaws 2d12 piercing plus 2d6 of your breath’s damage type; claw (agile) 3d10 slashing; tail ' +
      '(reach 10 feet) 3d10 bludgeoning — all rolled with YOUR attack modifier, so they are left off the Strikes ' +
      'list rather than printed at +0. Resistance 10 to your Dragon Breath’s damage type. At 18th level: +20-foot ' +
      'status bonus to fly Speed, dragon Strike damage bonus +12, and +14 status to Dragon Breath damage.',
  },
  'animal-rage': {
    name: 'Animal Rage',
    feats: ['animal-rage'],
    duration: 'while raging',
    // Animal Rage explicitly keeps your statistics, temporary HP and unarmed attacks, so the only
    // things the form really overrides are the senses animal form grants. Speed is per-animal and the
    // feat does not pin the animal, so it stays absent — you keep your own.
    battleForm: { senses: [LOW_LIGHT, SCENT30] },
    note:
      'Animal Rage: a 3rd-rank animal form, except you use your OWN statistics, temporary Hit Points and unarmed ' +
      'attacks, and keep the constant abilities of your gear — so only the form’s senses actually replace ' +
      'anything. Your animal’s own Speed from the animal form list applies; the feat does not pin which animal, ' +
      'so your Speed is left alone here. If your animal is a frog, your tongue’s reach becomes 15 feet. ' +
      'Dismissing the transformation has the rage trait.',
  },
  'bone-swarm': {
    name: 'Bone Swarm',
    feats: ['bone-swarm'],
    duration: 'up to 1 minute, once per day',
    // The text states a size and a fly Speed and nothing else about AC or attacks, so nothing else is
    // written: your AC stays yours, which is what the ability means by saying nothing about it.
    battleForm: { speeds: { fly: 40 }, size: 'Huge' },
    note:
      'Bone Swarm: you become Huge, gain the swarm trait and a fly Speed of 40 feet. Immune to grabbed, prone ' +
      'and restrained; weakness 5 to area and splash damage. You can share a space with other creatures, and as ' +
      'a 2-action activity deal 10d6 damage to everything in your space (basic save against the higher of your ' +
      'class DC and spell DC). You cannot speak, Cast Spells, use manipulate actions, Activate items, or Strike. ' +
      'You do not gain swarm mind. Spend a single action to return to your normal shape.',
  },
};

/* Records the audit counted as battle forms that this pass does NOT author, each with the reason. */
const NOT_AUTHORED = [
  ['untamed-form / insect-shape / ferocious-shape / soaring-shape / elemental-shape / plant-shape / dragon-shape / monstrosity-shape',
   'these ADD shapes to the Untamed Form list. The statistics belong to the shape the player picks at cast time, at a rank that scales with level — a mode is a fixed set of numbers and cannot ask either question'],
  ['animal-shape', 'a 5th-rank casting of a form the PLAYER chose when taking the feat, in whichever animal is their inherent animal — neither is pinned by the text'],
  ['skeletal-transformation', 'animal form at 3rd, 4th or 5th rank, player’s choice at cast time, in an unnamed animal'],
  ['form-of-the-dragon', '8th-rank dragon form; the spell prints its block at 6th and this import does not carry the 8th-rank heightening line'],
  ['heart-of-the-kaiju', 'a kaiju variant of a 9th-rank Monstrosity Shape; the 9th-rank AC and attack modifier are not in the imported text, and the feat states only the per-shape abilities'],
  ['rampaging-form', 'both a 5th-rank canine animal form AND a 7th-rank fiery body at once; fiery body is not a battle form and its half has no BattleForm field'],
  ['true-shapeshifter / greater-physical-evolution / form-retention / malleable-form', 'these change HOW you cast a form (rank, duration, which form), not what the form’s statistics are'],
  ['dire-growth', 'applies Enlarge to whatever animal shape you are already in'],
  ['sanguine-evasion', 'the effects of vapor form, which prints no battle-form statistics'],
  ['long-nosed-form / landscape-form / rolling-white-bottle-form / polymorphic-escape / crawling shapes with no block',
   'a disguise or a movement trick, not a stat-replacing battle form'],
];
/* Two BattleForm fields are authored here and read by nothing yet: `size` and `tempHp`. They are
 * written because they are part of what the text states and the field exists for them, and repeated
 * in each mode's `note` — which IS displayed — so the player is not relying on a silent field. */
const NO_READER = ['BattleForm.size', 'BattleForm.tempHp'];

/* ---------------------------------------------------------------------------------- apply ------ */
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
core.modes ??= {};

const written = [];
const skipped = [];
for (const [id, def] of Object.entries(MODES)) {
  const gate = def.feats?.[0];
  // A mode gated to a feat that does not exist can never be shown — better a loud skip than a mode
  // nobody will ever see in the Modes panel.
  if (gate && !core.feats[gate]) { skipped.push(`${id}: no feat "${gate}"`); continue; }
  core.modes[id] = { id, modifiers: [], exclusiveGroup: GROUP, category: 'Battle forms', predefined: true, ...def };
  written.push(id);
}

console.log(`battle-form modes ${written.length}${skipped.length ? ` · skipped ${skipped.length}` : ''}`);
for (const s of skipped) console.log('   SKIP ' + s);
console.log(`\nnot authored (${NOT_AUTHORED.length} groups):`);
for (const [who, why] of NOT_AUTHORED) console.log(`   ${who}\n      → ${why}`);
console.log(`\nauthored but read by nothing yet: ${NO_READER.join(', ')} (each is also spelled out in the mode's note)`);

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

writeFileSync(p('public/core.json'), JSON.stringify(core));
// toggle-modes.json is what carries these through `npm run data`: import-core-v2 merges it back over
// the modes bucket, because CARRY_WHOLESALE copies from the frozen Foundry backup, which has none.
const SRC = p('scripts/data/toggle-modes.json');
const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
for (const id of written) prev[id] = core.modes[id];
writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
console.log(`\nwritten: public/core.json (core.modes now ${Object.keys(core.modes).length}), scripts/data/toggle-modes.json`);
