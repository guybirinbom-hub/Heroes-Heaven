/*
 * BATCHES 1–12 RESIDUAL — the fixes the read turned up.
 *
 * 1,201 records were read against their printed text (batches 1–12 owed a residual read; 13–15 already
 * had one). Each finding was then put to an adversarial refuter before reaching this file, because the
 * dominant false positive in this project is a mechanic held in a REGISTRY the reader did not check.
 *
 * Rows are grouped by the LANE they belong to, not by batch: a defect that appears once appears fifty
 * times, and fixing by class is both faster and the only way to know the class is finished.
 *
 *   node scripts/backfill-residual-1-12.mjs           # report
 *   node scripts/backfill-residual-1-12.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const ROWS = [
  /* ---- skill substitutions ---------------------------------------------------------------------
   * *"you can use X instead of Y"* — a lane with 33 records already, and these printed the clause and
   * carried nothing. `when` is the record's own wording, because a CONDITIONAL substitution must not
   * silently replace the skill's number (Natural Medicine says so outright).
   */
  {
    category: 'feats',
    id: 'medical-researcher',
    field: 'skillSubstitutions',
    value: [{ use: 'medicine', forSkill: 'crafting', when: "to Craft healer's kits, vaccines, addiction suppressants, antidotes, antiplagues, elixirs of life, or other non-magical medical or healing items" }],
  },
  {
    category: 'feats',
    id: 'rune-singer',
    field: 'skillSubstitutions',
    value: [{ use: 'performance', forSkill: 'crafting', when: 'on Crafting checks related to runes' }],
  },
  {
    category: 'feats',
    id: 'seek-the-hidden-glyphs',
    field: 'skillSubstitutions',
    value: [{ use: 'crafting', forSkill: 'thievery', when: "to disable a magical trap, while holding or wearing an artisan's toolkit" }],
  },
  /* *"…use your Warfare Lore modifier in place of your Deception modifier for Deception checks to
   * Create a Diversion or Feint."* `use` takes a `lore:` key — the widened type exists for this. */
  {
    category: 'feats',
    id: 'deceptive-tactics',
    field: 'skillSubstitutions',
    value: [{ use: 'lore:warfare', forSkill: 'deception', when: 'to Create a Diversion or Feint' }],
  },
  /* *"You can use Diplomacy or Society, whichever you're trained in, to Track creatures in
   * settlements."* Two substitutions, because either skill may stand in and the character may be
   * trained in one, the other or both — a single entry would pick for them. */
  {
    category: 'feats',
    id: 'eyes-of-the-city',
    field: 'skillSubstitutions',
    value: [
      { use: 'diplomacy', forSkill: 'survival', when: 'to Track creatures in settlements (if trained in Diplomacy)' },
      { use: 'society', forSkill: 'survival', when: 'to Track creatures in settlements (if trained in Society)' },
    ],
  },
  /* *"Whenever you Feint with a one-handed firearm, you can choose to attempt a Performance check
   * instead of a Deception check."* */
  {
    category: 'feats',
    id: 'pistol-phenom-dedication',
    field: 'skillSubstitutions',
    value: [{ use: 'performance', forSkill: 'deception', when: 'to Feint with a one-handed firearm' }],
  },
  /* *"You can use Religion to Coerce, Gather Information, Make an Impression, or Request as long as you
   * are in a town or city with a church dedicated to your deity."* Two entries: Coerce is Intimidation
   * and the other three are Diplomacy, and one `forSkill` cannot say both. */
  {
    category: 'feats',
    id: 'vindicator-dedication',
    field: 'skillSubstitutions',
    value: [
      { use: 'religion', forSkill: 'diplomacy', when: 'to Gather Information, Make an Impression or Request, in a town or city with a church of your deity' },
      { use: 'religion', forSkill: 'intimidation', when: 'to Coerce, in a town or city with a church of your deity' },
    ],
  },
  /* *"In urban environments, you can attempt Society checks to Sense Direction."* Sense Direction is a
   * Survival action, so this is Society standing in for Survival — not a second Society clause. */
  {
    category: 'feats',
    id: 'shieldmarshal-dedication',
    field: 'skillSubstitutions',
    value: [{ use: 'society', forSkill: 'survival', when: 'to Sense Direction in urban environments' }],
  },
  /* *"You can use Politics Lore to Make an Impression on or make a Request of government officials."*
   * Both actions are Diplomacy; the stand-in is a LORE, which is why `use` had to widen past SkillId. */
  {
    category: 'feats',
    id: 'eagle-knight-dedication',
    field: 'skillSubstitutions',
    value: [{ use: 'lore:politics', forSkill: 'diplomacy', when: 'to Make an Impression on or make a Request of government officials' }],
  },

  /* ---- an ABILITY swap, not a skill substitution -------------------------------------------------
   * *"You can use Dexterity in place of Intelligence when attempting piloting checks with Driving
   * Lore."* The skill does not change — the attribute it runs off does, which is `skillAbilitySwap`
   * (Officer's Medical Training uses the same field). Filing it as a substitution would have swapped
   * the whole skill and rolled the wrong proficiency.
   */
  { category: 'feats', id: 'trick-driver-dedication', field: 'skillAbilitySwap', value: { skill: 'lore:driving', use: 'dex' } },

  /* ---- unarmed riders ---------------------------------------------------------------------------
   * *"You don't take the normal –2 circumstance penalty when making a lethal attack with your fist or
   * any other unarmed attacks."* The same clause Warrior Automaton prints, and the same shape: an
   * UNMATCHED rider, because the sentence says "or any other unarmed attacks". Removing `nonlethal` is
   * how that penalty is expressed — it is the trait the penalty comes from.
   */
  { category: 'feats', id: 'spirit-warrior-dedication', field: 'unarmedTraits', value: [{ remove: ['nonlethal'] }] },

  /* ---- clauses with no mechanical carrier, STATED on the record ----------------------------------
   * Each of these is a printed rule the sheet could not otherwise show: a rider on an action's
   * distance, a scaling line, a crit effect no strike field can express. Kept to about a line per
   * ruling H — the full text is a click away in the record's own description.
   */
  { category: 'feats', id: 'haft-striker-stance', field: 'note', value: 'The haft shares any fundamental runes etched on the main weapon, if it would normally qualify for them.' },
  { category: 'heritages', id: 'hooded-nagaji', field: 'note', value: 'On a critical hit, venomous spit deals persistent poison damage equal to its number of weapon damage dice.' },
  { category: 'items', id: 'boots-of-bounding', field: 'note', value: 'When you Leap, you can move 5 feet further horizontally or 3 feet higher vertically.' },
  { category: 'feats', id: 'climbing-tail', field: 'note', value: 'Your tail reduces the number of free hands you need to Climb or Trip by one.' },
  { category: 'feats', id: 'whitecape', field: 'note', value: 'You can Step into difficult terrain, and your hair grows back supernaturally quickly if shorn.' },
  { category: 'feats', id: 'corgi-mount', field: 'note', value: 'Your corgi familiar is Small rather than Tiny and can serve as your mount, unlike most familiars.' },
  { category: 'feats', id: 'parthenogenic-hatchling', field: 'note', value: 'You take thirst damage only every 2 hours and starvation damage only every 2 days.' },
  { category: 'feats', id: 'metal-carapace', field: 'note', value: "Level (+3): the shield's Hardness increases by 1, its HP by 4 and its BT by 2." },
  { category: 'feats', id: 'hardwood-armor', field: 'note', value: "Level (+3): the shield's Hardness increases by 1, its HP by 4 and its BT by 2." },
  { category: 'feats', id: 'tools-of-the-trade', field: 'note', value: 'You take no penalty for making a nonlethal attack with a weapon that lacks the nonlethal trait.' },
  { category: 'feats', id: 'subtle-theft', field: 'note', value: 'Observers other than your target take −2 circumstance to their Perception DCs to notice your Steal.' },
  { category: 'feats', id: 'curse-maelstrom-dedication', field: 'note', value: 'While maelstromed, other creatures in a 10-foot emanation take −1 status to saves and skill checks.' },
  { category: 'feats', id: 'reanimator-dedication', field: 'note', value: 'Animating intact remains gives the undead +1 status to attacks, AC, saves and skills for the duration.' },
  { category: 'feats', id: 'rise-my-creature', field: 'note', value: "Electricity damage gives your construct companion +1 circumstance to Athletics until its next turn ends." },

  /*
   * FAVORED TERRAIN — the two answers that delivered nothing.
   *
   * The record carried five situational clauses (Aquatic, Forest/Mountain/Underground, Plains, Sky,
   * Swamp) and skipped ARCTIC and DESERT, whose 11th-level benefits are survival clauses rather than
   * Speeds — so a ranger who chose either got nothing stated anywhere. Found while the owner reviewed
   * the WG-vs-book settle for this record. The row replaces the whole array, so all seven ride in it.
   */
  /* ---- the two archetype gates that were unenforced ----------------------------------------------
   * Both print *"Archetype <X>. Prerequisites <X> Dedication"* and carried NEITHER field, so the feats
   * were takeable with no dedication and did not count toward the archetype. Two rows each: an earlier
   * attempt nested both under `prerequisites`, which is one field holding another field's value.
   */
  { category: 'feats', id: 'basic-death-dealing', field: 'prerequisites', value: ['Necromancer Dedication'] },
  { category: 'feats', id: 'basic-death-dealing', field: 'archetype', value: 'necromancer' },
  { category: 'feats', id: 'basic-rune-magic', field: 'prerequisites', value: ['Runesmith Dedication'] },
  { category: 'feats', id: 'basic-rune-magic', field: 'archetype', value: 'runesmith' },

  /*
   * *"Once per turn you can use a single action to CREATE A SINGLE THRALL within 30 feet."* The
   * dedication granted `command-a-thrall` and nothing that makes one, so an archetype necromancer could
   * command thralls they had no way to produce.
   *
   * ⚠ I first reverted this row believing it double-paid the focus pool. That was wrong, and the code
   * says so: `costsAFocusPoint` (build.ts:3644) keys on the spell carrying the `focus` TRAIT, and
   * create-thrall is a cantrip whose traits are cantrip/concentrate/manipulate/necromancer/thrall. It
   * therefore rides this lane — the same one the necromancer CLASS uses for it — without a point.
   */
  { category: 'feats', id: 'necromancer-dedication', field: 'focusSpells', value: ['create-thrall'] },

  /* *"In addition to standard divine tradition spells, you can prepare YOUR BONDED APPARITION'S
   * apparition spells in your spell slots of the appropriate level."* The archetype shipped a fixed
   * divine pool, so the defining feature of the class it borrows from could not be prepared in it.
   * `from: 'apparition'` resolves the ladder against the apparition this character actually bonded. */
  {
    category: 'feats',
    id: 'basic-animist-spellcasting',
    field: 'spellListAdditions',
    value: [{ from: 'apparition', entryId: 'animist-dedication-casting' }],
  },

  /* ---- clauses whose carrier would have to be invented -------------------------------------------
   * `grantsActions` names an EXISTING action record on all 25 siblings that use it, and the action
   * these two describe is in no bucket. Stating the clause is the honest answer; pointing the grant at
   * an id nothing defines produces a dangling reference and shows the player nothing either way.
   */
  { category: 'heritages', id: 'ancient-scale-azarketi', field: 'note', value: 'You can activate, deactivate or rearrange your phosphorescent spots as a single action with the concentrate trait.' },
  /* *"You gain the SHIFT SPELL ACTION and the Share the Burden spellshift."* The record used to point
   * `grantsFeats` at `feats/shift-spell` — a NAME COLLISION with a level-14 WIZARD feat, not this
   * archetype's action, which exists in no bucket. Stating it beats granting the wrong record. */
  { category: 'feats', id: 'spellshifter-dedication', field: 'note', value: 'You gain the Shift Spell action and the Share the Burden spellshift, used through a held spellshifting conduit.' },
  /* The printed drawback, quoted rather than paraphrased: *"You need to spend at least an hour each
   * day assuaging the entity within you or you take a −1 penalty to Will saves for 24 hours… After a
   * full week of failing to assuage your entity, you become Doomed 1."* */
  { category: 'feats', id: 'living-vessel-dedication', field: 'note', value: 'Spend an hour a day assuaging your entity or take −1 to Will saves for 24 hours; after a week of failures you become Doomed 1.' },

  /* *"**Activate—Presence** ⟨2⟩ … **Effect** The symbol casts BANE OR BLESS."* The record carried the
   * frequency counter, the activation cost, the Religion bonus and the save star — everything except
   * the two spells the activation exists to cast, so the player was told they could activate it and
   * never shown what it does. Both are rank 1 on a divine item; `usesPerDay: 1` is the printed
   * once-per-day frequency, shared across the pair as the single activation it is. */
  {
    category: 'items',
    id: 'symbol-of-conflict',
    field: 'innateSpells',
    value: [
      { spellId: 'bane', tradition: 'divine', rank: 1, usesPerDay: 1 },
      { spellId: 'bless', tradition: 'divine', rank: 1, usesPerDay: 1 },
    ],
  },

  /* ---- a weapon that was not a weapon -------------------------------------------------------------
   * *"Base Weapon Flintlock Musket … a magic weapon used by a gunwitch as both a powerful firearm and
   * magical staff."* The record shipped as `itemType: 'equipment'` with no damage, category, group,
   * hands, range or reload, so it could not be wielded, could not Strike, and took no runes. The
   * weapon stats are the BASE WEAPON's, copied from `flintlock-musket` because that is what "Base
   * Weapon" means — nothing here is invented.
   */
  { category: 'items', id: 'musket-staff-of-the-void', field: 'itemType', value: 'weapon' },
  { category: 'items', id: 'musket-staff-of-the-void', field: 'damage', value: { dice: 1, die: 'd6', type: 'piercing' } },
  { category: 'items', id: 'musket-staff-of-the-void', field: 'category', value: 'simple' },
  { category: 'items', id: 'musket-staff-of-the-void', field: 'group', value: 'firearm' },
  { category: 'items', id: 'musket-staff-of-the-void', field: 'hands', value: 2 },
  { category: 'items', id: 'musket-staff-of-the-void', field: 'range', value: 70 },
  { category: 'items', id: 'musket-staff-of-the-void', field: 'reload', value: 1 },

  /* The Scout half of Eye of Ozem reached no surface. The initiative half is a star already; this is
   * *"when you're Scouting, you grant your allies a +2 circumstance bonus INSTEAD OF +1"* — a change to
   * an action, which is what a record mark is for. `situational` cannot hold it: the bonus lands on an
   * ALLY's initiative, which is not a stat on this character's sheet. */
  {
    category: 'feats',
    id: 'eye-of-ozem',
    field: 'recordMarks',
    value: [{ on: 'action', id: 'scout', value: '+2', note: "Eye of Ozem: while Scouting you grant your allies a +2 circumstance bonus to initiative instead of +1." }],
  },

  /* ---- the Spellshifter archetype: three feats, no gates -----------------------------------------
   * All three print *"Archetype Spellshifter"* and two print *"Prerequisites Spellshifter
   * Dedication"*, and not one carried either field — so the feats were takeable with no dedication and
   * counted toward no archetype. The `spellshift` mechanic itself is a subsystem this does not build;
   * the GATES are what the printed text settles, and they are what is authored here.
   */
  { category: 'feats', id: 'spellshifter-dedication', field: 'archetype', value: 'spellshifter' },
  { category: 'feats', id: 'spellshifter-dedication', field: 'prerequisites', value: ['Trained in Arcana'] },
  { category: 'feats', id: 'analyze-magic', field: 'archetype', value: 'spellshifter' },
  { category: 'feats', id: 'analyze-magic', field: 'prerequisites', value: ['Spellshifter Dedication'] },
  { category: 'feats', id: 'reactive-spellshift', field: 'archetype', value: 'spellshifter' },
  { category: 'feats', id: 'reactive-spellshift', field: 'prerequisites', value: ['Spellshifter Dedication'] },

  /* *"The armor is slightly bulkier, increasing the Bulk by 1."* The one armour-adjustment clause with
   * no carrier — `ArmorAdjustMode.bulk` was added for it. Any medium or heavy armour can be fashioned
   * into parade armor, which is what the two host categories say. */
  {
    category: 'items',
    id: 'parade-armor',
    field: 'armorAdjust',
    value: { modes: [{ label: 'on any medium or heavy armor', hostCategories: ['medium', 'heavy'], bulk: 1 }] },
  },

  /* ---- the acid flasks: two thirds of their damage was missing ------------------------------------
   * *"deals 1 acid damage, 2d6 PERSISTENT acid damage, and 2 acid SPLASH damage."* Every flask shipped
   * only the flat 1. Fixed as a FAMILY, not as the one record the read happened to name — all four
   * grades print the same sentence with the grade's own dice, and the dice ARE the item.
   */
  { category: 'items', id: 'acid-flask-lesser', field: 'strikeDamage', value: [{ dice: 1, die: 'd6', type: 'acid', persistent: true, note: 'Acid flask' }, { dice: 1, die: '', type: 'acid', splash: true, note: 'Acid flask splash' }] },
  { category: 'items', id: 'acid-flask-moderate', field: 'strikeDamage', value: [{ dice: 2, die: 'd6', type: 'acid', persistent: true, note: 'Acid flask' }, { dice: 2, die: '', type: 'acid', splash: true, note: 'Acid flask splash' }] },
  { category: 'items', id: 'acid-flask-greater', field: 'strikeDamage', value: [{ dice: 3, die: 'd6', type: 'acid', persistent: true, note: 'Acid flask' }, { dice: 3, die: '', type: 'acid', splash: true, note: 'Acid flask splash' }] },
  { category: 'items', id: 'acid-flask-major', field: 'strikeDamage', value: [{ dice: 4, die: 'd6', type: 'acid', persistent: true, note: 'Acid flask' }, { dice: 4, die: '', type: 'acid', splash: true, note: 'Acid flask splash' }] },

  /* Now that `recordMarksFor` walks the inventory, an ITEM can carry an action annotation. This is the
   * record that exposed the gap: *"You reduce the reload time for a repeating hand crossbow magazine
   * from the bandolier by 1, to a total of 2 actions."* */
  {
    category: 'items',
    id: 'shootist-bandolier',
    field: 'recordMarks',
    value: [{ on: 'action', id: 'interact', note: 'Shootist Bandolier: reloading a repeating hand crossbow with a magazine from the bandolier takes 2 Interact actions instead of 3. You can wear only one at a time.' }],
  },

  {
    category: 'feats',
    id: 'favored-terrain',
    field: 'situational',
    value: [
      { targets: [{ kind: 'speed' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Aquatic', bonus: 'swim Speed equal to your Speed (or +10-foot status bonus to your swim Speed if you already had one)' },
      { targets: [{ kind: 'speed' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Forest, Mountain or Underground', bonus: 'climb Speed equal to your Speed (or +10-foot status bonus to your climb Speed if you already had one)' },
      { targets: [{ kind: 'speed' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Plains', bonus: '+10-foot status bonus to your land Speed' },
      { targets: [{ kind: 'speed' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Sky', bonus: '+10-foot status bonus to your fly Speed, if you have one' },
      { targets: [{ kind: 'speed' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Swamp', bonus: 'move across bogs at full Speed, even those deep enough to be greater difficult terrain or require Swimming' },
      /* Both of these carry a MOVEMENT clause as well as an environmental one ("walk across ice and
       * snow at full Speed without needing to Balance"), so they star on the Speed row as well as on
       * Fortitude — a ranger who chose Arctic looks for it in the same place as one who chose Plains. */
      { targets: [{ kind: 'speed' }, { kind: 'save', detail: 'fortitude' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Arctic', bonus: 'eat and drink a tenth as much; unaffected by severe or extreme cold; walk ice and snow at full Speed without Balancing' },
      { targets: [{ kind: 'speed' }, { kind: 'save', detail: 'fortitude' }], when: 'while in your favored terrain, if you have the unimpeded journey class feature and chose Desert', bonus: 'eat and drink a tenth as much; unaffected by severe or extreme heat; walk sand at full Speed without Balancing' },
    ],
  },
];

for (const r of ROWS) {
  if (!core[r.category]?.[r.id]) { console.error(`${r.category}/${r.id} is not in core.json`); process.exit(2); }
}

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replaced.`);
for (const r of ROWS) console.log(`  ${r.category}/${r.id}.${r.field}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
