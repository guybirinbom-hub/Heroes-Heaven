/*
 * BATCH 15 — records whose printed text grants something we never handed over.
 *
 *   tengu-feather-fan  *"You gain a tengu feather fan: a magic item of light Bulk with a level equal
 *                      to your level and the primal trait."* We modelled the spell it casts and the
 *                      once-a-day limit, but never the ITEM — so the fan the whole feat is about was
 *                      not in the character's inventory, could not be seen, held or lost.
 *   glorious-gamtu     *"You conjure a magical Gamtu Hat, which is a magic item of light Bulk."* Same
 *                      shape, same omission; both items already ship in `items`.
 *   tip-the-scales     *"+1 circumstance bonus to checks to Escape"* reached nothing at all. The bonus
 *                      itself lives in `src/rules/situationalBonuses.ts` (a registry, not data); this
 *                      authors the second sentence, which is a triggered use of your ordinary reaction
 *                      and so is NOT `extraReaction` — that field grants an additional reaction, which
 *                      this feat does not. Their side records it as free text for the same reason.
 *
 *   node scripts/backfill-batch15.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const ROWS = [
  { category: 'feats', id: 'tengu-feather-fan', field: 'grantsItems', value: [{ itemId: 'tengu-feather-fan', quantity: 1 }] },
  { category: 'feats', id: 'glorious-gamtu', field: 'grantsItems', value: [{ itemId: 'gamtu-hat', quantity: 1 }] },
  {
    category: 'feats',
    id: 'tip-the-scales',
    field: 'note',
    value: 'After a successful Escape, you can immediately use your reaction to Step, or to Shove or Trip the creature you Escaped from.',
  },

  /*
   * *"You gain all the mechanical benefits of the dragonet heritage you selected at first level."*
   * Prerequisite: a versatile heritage — so the player HAS no dragonet heritage and this hands one
   * over. Two siblings already model exactly this (`awakened-yaoguai-heritage`, `late-awakener`) with
   * `secondHeritage` plus an open choice drawn from the ancestry's heritage list; this was the only
   * record of the three printing the clause and modelling none of it.
   */
  {
    category: 'feats',
    id: 'ascended-dragonet-heritage',
    field: 'choice',
    value: {
      flag: 'firstHeritage',
      prompt: 'The dragonet heritage you selected at 1st level',
      kind: 'open',
      from: { type: 'heritage', ancestry: 'dragonet' },
    },
  },
  { category: 'feats', id: 'ascended-dragonet-heritage', field: 'secondHeritage', value: true },

  /*
   * *"You gain the Hefty Hauler skill feat, and your maximum Bulk limit further increases by 3, for a
   * total of 2 to your encumbered limit and 5 to your maximum limit."* Neither half reached anything.
   * The +3 is `bulkMaxBonus`, not `bulkLimitBonus` — the sentence states the encumbered total in the
   * same breath, and the symmetric field would have printed +5 there.
   */
  { category: 'feats', id: 'embodied-dreadnought-subjectivity', field: 'grantsFeats', value: ['hefty-hauler'] },
  { category: 'feats', id: 'embodied-dreadnought-subjectivity', field: 'bulkMaxBonus', value: 3 },

  /*
   * *"You gain the Steady Balance skill feat, even if you aren't trained in Acrobatics, and you can use
   * the Anchor action."* Two things were wrong and they are the same mistake twice:
   *
   *   · Anchor was never GRANTED, so the action the sentence hands over did not appear anywhere.
   *   · The feat stored Anchor's 1-action cost as its OWN. There is nothing in that sentence to spend
   *     an action on — the feat is passive and the action it grants is the thing that costs one.
   *
   * ⚠ NOT inferred from AoN's badge, which is empty here: an empty badge is also what a page looks like
   * when the scrape lost the glyph, and that direction is not evidence (see the action-cost guard). The
   * evidence is the printed sentence plus Anchor existing as its own record with its own cost.
   *
   * `call-gun` is the same shape and outside this batch; fixed with it because it is the same defect,
   * and `scripts/granted-action-cost-check.mjs` now holds the pair at zero.
   */
  { category: 'feats', id: 'anchoring-roots', field: 'grantsActions', value: ['anchor'] },
  { category: 'feats', id: 'anchoring-roots', field: 'actionCost', value: { type: 'passive' } },
  { category: 'feats', id: 'call-gun', field: 'grantsActions', value: ['call-gun'] },
  { category: 'feats', id: 'call-gun', field: 'actionCost', value: { type: 'passive' } },

  /*
   * TWO RECORDS WHOSE WHOLE CONTENT IS "THE THING YOU ALREADY HAVE GETS BETTER", and which said it to
   * nobody. Both modify another record's grant, which is what `modifiesGrant` is for.
   *
   * ⚠ Strong of Wing is NOT a standing `speeds: { fly: 25 }`. Take Flight grants its fly Speed *"for
   * this movement"* — a temporary speed inside a 1-action activity — so a standing grant would hand the
   * character permanent flight at 5th level. The rider annotates the activity instead, which is exactly
   * the case `actionRider` exists for: an addition that changes no number the sheet holds.
   */
  {
    category: 'feats',
    id: 'strong-of-wing',
    field: 'modifiesGrant',
    value: [{ from: 'take-flight', actionRider: { note: 'The fly Speed you gain from Take Flight is 25 feet.' } }],
  },
  {
    category: 'feats',
    id: 'loud-singer',
    field: 'modifiesGrant',
    value: [{ from: 'goblin-song', actionRider: { note: "Goblin Song's range is 60 feet, and it targets one additional enemy." } }],
  },

  /*
   * "IF YOU ALSO HAVE <FEAT>, YOUR CLIMB SPEED INCREASES TO YOUR LAND SPEED" — four records, one gate
   * nobody could express.
   *
   * `speedsIf` gated on a skill rank (Quick Climb) or a heritage (Prodigious Climber) and not on a
   * FEAT, so the second sentence of each of these reached nothing at all. The value itself was already
   * expressible — a Speed grant may be a formula, and Quick Climb has used `@actor.speed.land` all along.
   *
   * ⚠ Three of the four restrict the upgrade to particular terrain ("when climbing trees", "trees or
   * cavern walls"), which no sheet state knows. The number is granted and the restriction is STATED —
   * the alternative was delivering nothing at all, and a climb Speed that is right in the case the feat
   * is taken for beats one that is always the base 10 with a rule the player has to apply by hand.
   */
  { category: 'feats', id: 'uncanny-suction', field: 'speedsIf', value: [{ feat: 'quick-climb', speeds: { climb: '@actor.speed.land' } }] },
  { category: 'feats', id: 'tree-climber-goblin', field: 'speedsIf', value: [{ feat: 'cave-climber', speeds: { climb: '@actor.speed.land' } }] },
  { category: 'feats', id: 'tree-climber-goblin', field: 'note', value: 'The climb Speed from Cave Climber applies when climbing trees.' },
  { category: 'feats', id: 'skilled-climber', field: 'speedsIf', value: [{ feat: 'scuttle-up', speeds: { climb: '@actor.speed.land' } }] },
  { category: 'feats', id: 'skilled-climber', field: 'note', value: 'The climb Speed from Scuttle Up applies when climbing trees or cavern walls.' },
  /* The record's text calls it "Climber's Tail"; the Archives print the feat as CLIMBING TAIL
   * (feat-4001) — same vanara 1st-level feat, so the id is the referent despite the name. */
  { category: 'feats', id: 'skillful-climber', field: 'speedsIf', value: [{ feat: 'climbing-tail', speeds: { climb: '@actor.speed.land' } }] },
  { category: 'feats', id: 'skillful-climber', field: 'note', value: 'The climb Speed from Climbing Tail applies when climbing trees.' },

  /*
   * CRIT SPEC WITH A PER-TARGET CLAUSE — said, rather than shown as always-on.
   *
   * Three features grant critical specialization only against a particular target, and the strike card
   * printed the effect with nothing beside it: *"…when attacking your HUNTED PREY"* (Ranger Weapon
   * Expertise, batch 15), *"…and the target has the OFF-GUARD condition"* (Avenger), *"…against an
   * OFF-GUARD creature"* (Weapon Tricks). Unlike Brutality's "while raging" these cannot be enforced —
   * whether they hold depends on the creature being struck, which no sheet state knows — so they are
   * annotated. Shown only when EVERY source reaching that strike carries one, so a character who also
   * has an unconditional grant is not told their crit spec is narrower than it is.
   */
  { category: 'classFeatures', id: 'ranger-weapon-expertise', field: 'critSpecCondition', value: 'when attacking your hunted prey' },
  { category: 'classFeatures', id: 'avenger', field: 'critSpecCondition', value: 'when the target is off-guard' },
  { category: 'classFeatures', id: 'weapon-tricks', field: 'critSpecCondition', value: 'against an off-guard creature' },

  /*
   * SPIRITUAL ECHO — five innate spells granted at once where the text gives you ONE.
   *
   * *"You gain the ability to Cast a Spell as a 4th-rank occult innate spell once per day. The TYPE of
   * spell is DETERMINED BY THE CLAN of the sarangay to whom the head gem belonged, WHICH YOU CHOOSE
   * when you take this feat."* — then the five clans, each naming its spell. All five shipped as
   * unconditional grants, so the feat handed over five different 4th-rank spells a day instead of one.
   *
   * Surfaced by the innate-frequency sweep, which capped each of them at 1/day and made the shape
   * visible: five separate once-a-day spells is not what a sentence with one "once per day" in it says.
   * Found while reading batch 15; the record itself is from another batch.
   */
  {
    category: 'feats',
    id: 'spiritual-echo',
    field: 'effectChoices',
    value: [
      {
        id: 'sarangay-clan',
        prompt: "The clan of the sarangay whose head gem you carry — it determines your once-a-day spell",
        options: [
          { value: 'full-moon', label: 'Full Moon — Spirit Sense', grant: { innateSpells: [{ spellId: 'spirit-sense', tradition: 'occult', rank: 4, usesPerDay: 1 }] } },
          { value: 'half-moon', label: 'Half Moon — Status', grant: { innateSpells: [{ spellId: 'status', tradition: 'occult', rank: 4, usesPerDay: 1 }] } },
          { value: 'new-moon', label: 'New Moon — Darkness', grant: { innateSpells: [{ spellId: 'darkness', tradition: 'occult', rank: 4, usesPerDay: 1 }] } },
          { value: 'waning-moon', label: 'Waning Moon — Creation', grant: { innateSpells: [{ spellId: 'creation', tradition: 'occult', rank: 4, usesPerDay: 1 }] } },
          { value: 'waxing-moon', label: 'Waxing Moon — Blood Vendetta', grant: { innateSpells: [{ spellId: 'blood-vendetta', tradition: 'occult', rank: 4, usesPerDay: 1 }] } },
        ],
      },
    ],
  },
  /* `value: null` REMOVES the field — the five unconditional grants go away, replaced by the answer. */
  { category: 'feats', id: 'spiritual-echo', field: 'innateSpells', value: null },

  /*
   * VENOM SPIT — the granted strike shipped named "StrikeLabel", an unsubstituted Foundry template.
   * A leshy with this feat had a Strike on their sheet literally called StrikeLabel. The printed name
   * is in the sentence that grants it: *"You gain a venomous spit ranged unarmed attack…"*
   */
  {
    category: 'feats',
    id: 'venom-spit',
    field: 'grantedStrikes',
    value: [{ name: 'Venomous Spit', die: 'd4', damageType: 'poison', traits: ['unarmed'], group: 'brawling', range: 10 }],
  },

  /*
   * WILD WITCH'S ARMAMENTS — the same template name, and two wrong fields under it.
   *
   * The strike comes from the Living Hair branch: *"You gain a QUILLS ranged unarmed strike that deals
   * 1d4 PIERCING damage with a range of 15 feet. Your quills are in the DART group."* It shipped as
   * bludgeoning damage in the brawling group, named StrikeLabel — so the damage type was wrong, the
   * critical specialization was the wrong one, and the sheet named it after a template.
   *
   * Outside batch 15, fixed with Venom Spit because it is the same defect; the guard covers both.
   */
  {
    category: 'feats',
    id: 'wild-witchs-armaments',
    field: 'grantedStrikes',
    value: [{ name: 'Quills', die: 'd4', damageType: 'piercing', traits: ['unarmed'], group: 'dart', range: 15 }],
  },

  /*
   * *"WHILE RAGING, you have the critical specialization benefits for melee weapons and unarmed
   * attacks."* Ours granted it unconditionally, so a barbarian carried the benefit out of combat.
   * Their side gates it on the rage mode; keyed here by exclusive GROUP so every instinct's spelling
   * of Rage counts. Bard Weapon Expertise carries the same clause for compositions.
   */
  { category: 'classFeatures', id: 'brutality', field: 'critSpecRequiresModeGroup', value: 'barbarian-rage' },
  { category: 'classFeatures', id: 'bard-weapon-expertise', field: 'critSpecRequiresModeGroup', value: 'bard-composition' },

  /*
   * *"You gain the alternate form of a kitsune heritage other than your own, adding it to the options
   * for your Change Shape."* The record carried nothing, so the form was never chosen or recorded.
   *
   * Their side asks the same question and answers it with descriptive text on each option — the form
   * itself is prose in both projects, because what it changes is what you look like. What matters is
   * that the pick is MADE and kept, so Change Shape has the option the feat bought. The list is left
   * at all six with the restriction stated: excluding the character's own heritage would need the
   * menu to read the ancestry's answer, and menu narrowing is the one call the parity rule leaves to us.
   */
  {
    category: 'feats',
    id: 'myriad-forms',
    field: 'choice',
    value: {
      flag: 'myriadForm',
      prompt: 'The alternate form you gain — a kitsune heritage other than your own',
      kind: 'array',
      options: [
        { value: 'celestial-envoy-kitsune', label: 'Celestial Envoy' },
        { value: 'dark-fields-kitsune', label: 'Dark Fields' },
        { value: 'earthly-wilds-kitsune', label: 'Earthly Wilds' },
        { value: 'empty-sky-kitsune', label: 'Empty Sky' },
        { value: 'frozen-wind-kitsune', label: 'Frozen Wind' },
        { value: 'palace-echoes-kitsune', label: 'Palace Echoes' },
      ],
    },
  },

  /*
   * *"When wielding a weapon you aren't proficient with, treat your level as your proficiency bonus.
   * At 11th level, you become trained in all weapons."* Neither sentence reached anything: the
   * untrained-proficiency lane covered skills only, so a character with this feat still swung an
   * unfamiliar weapon at a flat +0 for ten levels and never became trained in anything.
   */
  { category: 'feats', id: 'martial-experience', field: 'untrainedWeaponProficiency', value: { levelMinus: 0, trainedAtLevel: 11 } },

  /*
   * *"You can cast either Illusory Object or Invisible Item as an occult innate spell once per day."*
   * The record modelled neither spell, so the whole feat was inert. Their side asks the same question.
   */
  {
    category: 'feats',
    id: 'the-moon-weavers-art',
    field: 'effectChoices',
    value: [
      {
        id: 'moon-weavers-spell',
        prompt: "The Moon Weaver's Art: choose the occult innate spell you can cast once per day",
        options: [
          { value: 'illusory-object', label: 'Illusory Object', grant: { innateSpells: [{ spellId: 'illusory-object', tradition: 'occult', usesPerDay: 1 }] } },
          { value: 'invisible-item', label: 'Invisible Item', grant: { innateSpells: [{ spellId: 'invisible-item', tradition: 'occult', usesPerDay: 1 }] } },
        ],
      },
    ],
  },
];

/*
 * Two more placeholder strike names, found by the guard rather than by my own scan — which searched
 * for "StrikeLabel" and missed the bare "Label". Rewritten by TRANSFORM rather than transcribed,
 * because an overlay row replaces the whole field and Animal Instinct's array is 29 entries: retyping
 * 28 correct ones to fix the 29th is how a fix introduces a defect.
 */
const renameStrike = (bucket, id, from, to, choiceValue) => {
  const list = core[bucket]?.[id]?.grantedStrikes;
  if (!Array.isArray(list)) { console.error(`${bucket}/${id}: no grantedStrikes`); process.exit(2); }
  const match = (s, name) => s.name === name && (choiceValue == null || s.choiceValue === choiceValue);
  const hit = list.filter((s) => match(s, from));
  /* IDEMPOTENT. This script is re-run whenever any row in it changes, and it reads the BAKED core —
   * so on the second run the rename has already happened and `from` is gone. Treating that as an error
   * aborted the whole script before it wrote anything, and every other row in the file silently did not
   * land. (Which is how it was found: a row authored, `npm run data` green, and the record unchanged.) */
  if (!hit.length && list.some((s) => match(s, to))) return { category: bucket, id, field: 'grantedStrikes', value: list };
  if (hit.length !== 1) { console.error(`${bucket}/${id}: expected exactly 1 "${from}" strike, found ${hit.length}`); process.exit(2); }
  return { category: bucket, id, field: 'grantedStrikes', value: list.map((s) => (s === hit[0] ? { ...s, name: to } : s)) };
};
/* The ape's unarmed attack is a Fist (d10 bludgeoning, grapple) — every other animal in the list is
 * already named for its own attack, so this one entry read "Label" on the sheet. */
ROWS.push(renameStrike('classFeatures', 'animal-instinct', 'Label', 'Fist', 'ape'));
/* *"You have replaced one of your forearms with one made of clay…"* — the strike is the clay fist. */
ROWS.push(renameStrike('feats', 'accursed-clay-fist', 'Label', 'Clay Fist'));

/* An item id that does not exist grants nothing and says nothing — check before authoring. */
for (const r of ROWS) {
  for (const g of r.field === 'grantsItems' ? r.value : []) {
    if (!core.items[g.itemId]) { console.error(`${r.id}: no such item ${g.itemId}`); process.exit(2); }
  }
}

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replaced.`);
for (const r of ROWS) console.log(`  ${r.id}.${r.field}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
