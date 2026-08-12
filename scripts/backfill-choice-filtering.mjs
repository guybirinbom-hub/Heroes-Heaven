/*
 * Ruling Q9's FILTERING lane, as data: the four records that narrow a choice list.
 *
 * Q9 — *"the builder shows only what the player may legally pick"*. Four records promise a narrowed
 * menu in their printed text and shipped with the full one:
 *
 *   manifold-modifications  "Your innovation gains an additional initial modification from the list
 *                            for innovations of its type."   → all 17 armour+weapon mods to everyone
 *   toymaker                "choosing Artistry, Blacksmithing, Glassmaking, Leatherworking,
 *                            Tailoring, or Woodworking as your specialty"        → 6 of 12
 *   isgeri-reclaimer        "You gain the Terrain Stalker skill feat in either rubble or underbrush."
 *                                                                                → 2 of 3
 *   reputation-seeker       "(underground if you have Darklands Lore, desert if you have Desert Lore,
 *                            or forest if you have Jungle Lore)"    → conditional, not a fixed subset
 *
 * The three backgrounds go through `choiceOptionLimits` — one record restricting ANOTHER's choice,
 * the mirror of `choiceOptionAdditions`. Manifold narrows its OWN list, so it tags each option with
 * the innovation it belongs to (`requiresAnyFeature`) instead.
 *
 * ⚠ NOTHING here is typed from memory. Every option value and label is lifted out of core.json's own
 * records — the innovation-modification class features and the two innovation choices — and the
 * script REFUSES to write if what it finds does not match what the feat already offers. A narrowing
 * built on a hand-copied list would filter against the wrong vocabulary and delete legal options.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const CORE = ROOT + 'public/core.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';
const db = JSON.parse(readFileSync(CORE, 'utf8'));
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
const desc = (bucket, id) => {
  const d = JSON.parse(readFileSync(ROOT + 'public/core-descriptions.json', 'utf8'));
  return String(d[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
};

/* ---------------------------------------------------------------- manifold modifications ------- */

/** Initial (level-1) modifications of one innovation, from the class-feature tag that already marks them. */
const initialMods = (tag) =>
  Object.values(db.classFeatures)
    .filter((f) => f.otherTags?.includes(tag) && f.level === 1)
    .map((f) => ({ value: f.id, label: f.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

const armor = initialMods('armor-innovation-modification');
// Advanced Design is the weapon innovation's OWN level-1 feature, not one of the modifications you
// choose between — which is why the feat's printed list has ten weapon entries and this tag has
// eleven. Dropped by name, and the assertion below is what proves the reading.
const weapon = initialMods('weapon-innovation-modification').filter((o) => o.value !== 'advanced-design');
// Construct and light-mortar modifications are not class features at all: they live as options on
// their innovation's own `choice`. Taken verbatim from there, labels included.
const fromInnovationChoice = (featureId) =>
  (db.classFeatures[featureId]?.choice?.options ?? []).map((o) => ({ value: o.value, label: o.label }));
const construct = fromInnovationChoice('construct-innovation');
const lightMortar = fromInnovationChoice('light-mortar-innovation');

const manifold = db.feats['manifold-modifications'];
if (!manifold?.choice) fail('manifold-modifications has no choice to narrow');
const mText = desc('feats', 'manifold-modifications');
if (!/additional initial modification from the list for innovations of its type/i.test(mText)) {
  fail('manifold-modifications no longer says "from the list for innovations of its type"');
}
const printed = new Set(manifold.choice.options.map((o) => o.value));
const derived = new Set([...armor, ...weapon].map((o) => o.value));
if (printed.size !== derived.size || [...printed].some((v) => !derived.has(v))) {
  fail(
    'the feat\'s printed options are not exactly the level-1 armour+weapon modifications — ' +
      `printed ${[...printed].sort().join(',')} vs derived ${[...derived].sort().join(',')}`,
  );
}
for (const [name, list] of [['construct', construct], ['light mortar', lightMortar]]) {
  if (!list.length) fail(`no ${name} initial modifications found — the innovation record changed shape`);
}

const tagged = [
  ...armor.map((o) => ({ ...o, requiresAnyFeature: ['armor-innovation'] })),
  ...weapon.map((o) => ({ ...o, requiresAnyFeature: ['weapon-innovation'] })),
  // Added, not merely filtered: a construct or light-mortar inventor could take this feat and every
  // one of the 17 options on it belonged to somebody else's innovation. Filtering alone would have
  // left them an empty picker, which is a worse bug than the wide one. The values come from their own
  // innovation records, so nothing here is authored.
  ...construct.map((o) => ({ ...o, requiresAnyFeature: ['construct-innovation'] })),
  ...lightMortar.map((o) => ({ ...o, requiresAnyFeature: ['light-mortar-innovation'] })),
];
for (const o of tagged) {
  const id = o.requiresAnyFeature[0];
  if (!db.classFeatures[id]) fail(`requiresAnyFeature names ${id}, which is not a class feature`);
}

const manifoldChoice = {
  // The flag is UNCHANGED: it keys every answer already stored on a saved character.
  flag: manifold.choice.flag,
  prompt: 'Additional initial modification',
  kind: 'array',
  // "an ADDITIONAL initial modification" — the one you already took is shown greyed rather than
  // hidden (ruling Q27), because that is the entry a player scans for first.
  disableIfOwned: true,
  options: tagged,
};

/* ------------------------------------------------------------------- the three backgrounds ----- */

/** Assert the printed sentence still says what the limit claims, then build the limit. */
function limitFor(bgId, phrase, limit) {
  const t = desc('backgrounds', bgId);
  if (!new RegExp(phrase, 'i').test(t)) fail(`${bgId} no longer prints "${phrase}"`);
  const target = db.feats[limit.target];
  if (!target?.choice) fail(`${limit.target} has no choice for ${bgId} to narrow`);
  if (limit.flag !== target.choice.flag) fail(`${bgId}: flag ${limit.flag} ≠ ${limit.target}'s ${target.choice.flag}`);
  const offered = new Set(target.choice.options.map((o) => o.value));
  for (const a of limit.allow) {
    if (!offered.has(a.value)) fail(`${bgId}: ${limit.target} does not offer "${a.value}" — the limit would allow nothing`);
  }
  if (limit.allow.length >= offered.size) fail(`${bgId}: the limit allows everything ${limit.target} offers — it narrows nothing`);
  return [limit];
}

const toymakerLimit = limitFor(
  'toymaker',
  'choosing Artistry, Blacksmithing, Glassmaking, Leatherworking, Tailoring, or Woodworking as your specialty',
  {
    target: 'specialty-crafting',
    flag: 'specialtyCrafting',
    allow: ['artistry', 'blacksmithing', 'glassmaking', 'leatherworking', 'tailoring', 'woodworking'].map((value) => ({ value })),
    reason: 'Toymaker names the six specialties it allows: Artistry, Blacksmithing, Glassmaking, Leatherworking, Tailoring or Woodworking.',
  },
);

const isgeriLimit = limitFor('isgeri-reclaimer', 'Terrain Stalker skill feat in either rubble or underbrush', {
  target: 'terrain-stalker',
  flag: 'choice',
  allow: [{ value: 'rubble' }, { value: 'underbrush' }],
  reason: 'Isgeri Reclaimer grants Terrain Stalker “in either rubble or underbrush”.',
});

const reputationLimit = limitFor(
  'reputation-seeker',
  'underground if you have Darklands Lore, desert if you have Desert Lore, or forest if you have Jungle Lore',
  {
    target: 'terrain-expertise',
    flag: 'terrain',
    // Not a fixed subset: which terrain is legal depends on which Lore the character ended up with.
    // The Lore keys are `loreKey()`'s normalisation of the printed subject.
    allow: [
      { value: 'underground', requiresSkillRank: { skill: 'lore:darklands', min: 'trained' } },
      { value: 'desert', requiresSkillRank: { skill: 'lore:desert', min: 'trained' } },
      { value: 'forest', requiresSkillRank: { skill: 'lore:jungle', min: 'trained' } },
    ],
    reason:
      'Reputation Seeker ties the terrain to the Lore you took: underground with Darklands Lore, desert with Desert Lore, forest with Jungle Lore.',
  },
);

/* ----------------------------------------------------------------------- the writes ------------ */

const writes = [
  { category: 'feats', id: 'manifold-modifications', field: 'choice', value: manifoldChoice },

  { category: 'backgrounds', id: 'toymaker', field: 'choiceOptionLimits', value: toymakerLimit },

  { category: 'backgrounds', id: 'isgeri-reclaimer', field: 'choiceOptionLimits', value: isgeriLimit },
  /*
   * Isgeri Reclaimer carried a SECOND, dead copy of the same question: a background-level `choice`
   * offering rubble/underbrush whose answer `backgroundChoiceKind` classifies as neither a skill nor
   * a Lore, so it was recorded, displayed with "this choice has no number of its own", and never
   * reached Terrain Stalker. Two pickers for one decision, and the one that mattered stayed open.
   * The limit above is now the real question, so the decoy goes.
   */
  { category: 'backgrounds', id: 'isgeri-reclaimer', field: 'choice', value: null },

  { category: 'backgrounds', id: 'reputation-seeker', field: 'choiceOptionLimits', value: reputationLimit },
  /*
   * …and the conditional cannot mean anything until the Lore is a real choice. The record hardcoded
   * `trainedLore: "Jungle"` where the text says *"You're trained in the Survival skill and the
   * Darklands, Desert, or Jungle Lore skill"* — so every Reputation Seeker was a jungle expert, the
   * player was never asked, and exactly one of the three terrains could ever be legal.
   *
   * (`trainedLore` also fed `skills['lore:' + trainedLore]` verbatim, storing the capitalised key
   * `lore:Jungle` where every other path uses `loreKey()`'s `lore:jungle`.)
   */
  { category: 'backgrounds', id: 'reputation-seeker', field: 'trainedLoreOptions', value: ['darklands', 'desert', 'jungle'] },
  { category: 'backgrounds', id: 'reputation-seeker', field: 'trainedLore', value: null },
];

const put = ({ category, id, field, value }) => {
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  const row = { category, id, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  // …and into the live core.json, or the change is invisible until the next full regeneration —
  // which is exactly the failure mode where a fix looks applied and is not.
  const rec = db[category]?.[id];
  if (!rec) fail(`${category}/${id} is not in core.json`);
  if (value === null) delete rec[field];
  else rec[field] = value;
};
writes.forEach(put);

writeFileSync(BF, formatBackfill(rows));
writeFileSync(CORE, JSON.stringify(db));
console.log(
  `manifold-modifications: ${tagged.length} options tagged by innovation ` +
    `(${armor.length} armour, ${weapon.length} weapon, ${construct.length} construct, ${lightMortar.length} light mortar)\n` +
    `narrowing backgrounds: toymaker (${toymakerLimit[0].allow.length}/12), isgeri-reclaimer (${isgeriLimit[0].allow.length}/3), ` +
    `reputation-seeker (${reputationLimit[0].allow.length} conditional /10)\n` +
    `written: ${BF}, ${CORE}`,
);
