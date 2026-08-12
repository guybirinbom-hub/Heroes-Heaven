/*
 * AURA → MODE.  Owner ruling Q29 (docs/gold-set-answers.md, Round 9): *"Aura should be a mode."*
 *
 * ── Why a mode, and what that forces ────────────────────────────────────────────────────────────
 *   Q11  an aura can be shut down (suppressed, dismissed, the banner stowed) ⇒ mode, not a passive.
 *   Q1   it outlasts a round ⇒ it earns one at all.
 *   F    an ALLY's bonus lands on no sheet of yours. The mode says the aura is RUNNING and carries
 *        the ally half as TEXT; it never puts the ally's number anywhere.
 *   B    the mode carries the FULL text even where nothing computes.
 *   C    feats that REWRITE an aura attach to the aura's mode (`modeAdjust`), instead of each
 *        inventing its own toggle. Half the reason this lane matters.
 *   M    no positional model. Whether anyone (including you) is standing in the emanation is
 *        unknowable, so every ally/enemy-facing note says so in words and nothing is derived from it.
 *
 * ⚠ This SUPERSEDES the "Ruling M — an aura you might not be standing in" paragraph in
 *   docs/mechanic-lanes.md, which said auras get a permanent star and *"emphatically not a mode"*.
 *   The star stays (it is what the player sees on the stat row); Q29 adds the mode on top. The
 *   no-positional-model half of Ruling M is untouched and still governs.
 *
 * ── The rule this file follows for NUMBERS on your own half ─────────────────────────────────────
 * Gold answer #3 makes Shield the Faithful the precedent: where the aura's effect lands on YOU as
 * well as allies, the mode carries real numbers for your half and text for the ally half. Applied
 * mechanically, so it is checkable rather than a matter of taste:
 *
 *   REAL (unconditional modifier / resistance — the number actually moves while the mode is on)
 *       only when the text puts no further condition on your half beyond the aura running, AND no
 *       `situationalBonuses.ts` star already claims that same number.
 *   CONDITIONAL (`appliesWhen`, displays in the breakdown and underlines the stat, moves nothing)
 *       when the text restricts it to a circumstance ("against fear effects") OR a star already
 *       carries it. Restating a starred bonus as a real modifier would put the same number in two
 *       registries — the drift the `degreeShifts` field exists to prevent — and deleting the star
 *       instead would take a reminder off the sheet of any player who never opens the Modes panel.
 *   NOTHING but text
 *       when the effect lands only on allies, only on enemies, or on a stat this app does not model
 *       (temporary HP, an enemy's save DC). Ruling F and Ruling E.
 *
 * ── Radii come from the PRISTINE AoN archive, not from memory ───────────────────────────────────
 * public/core-descriptions.json has lost the radius on many of these records — Corpse Stench reads
 * *"a scent of decay in a , so putrid"* — because the importer strips `<%…%>` templates and the
 * radius sat inside one (the known ~829-doc AoN template defect). Every radius written below was
 * read back out of C:/wonderers guide/aon-2e-archive/data, which is the same publisher text with the
 * template intact. Nothing here is remembered, and nothing is taken from Foundry's prose.
 *
 * ── Durability ──────────────────────────────────────────────────────────────────────────────────
 * Modes are written to scripts/data/toggle-modes.json, which import-core-v2.mjs merges into
 * core.modes on every `npm run data` (it is NOT in CARRY_WHOLESALE — that path copies from the
 * frozen Foundry backup and used to empty the bucket). The `modeAdjust` rows go through
 * scripts/lib/write-backfill.mjs into effect-backfill.json, the only record-field overlay that
 * survives a regeneration.
 *
 *   node scripts/author-aura-modes.mjs [--dry]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');

/* ── vocabulary, derived from the repo rather than remembered ─────────────────────────────────── */
const modeDefBlock = typesSrc.slice(typesSrc.indexOf('export interface ModeDef'));
const LEGAL_MODE_FIELDS = new Set(
  [...modeDefBlock.slice(0, modeDefBlock.indexOf('\n}')).matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]),
);
const MOD_TARGETS = new Set(
  (typesSrc.match(/export type ModeTargetKind =([\s\S]*?);/)?.[1] ?? '').match(/'[a-z-]+'/g)?.map((s) => s.slice(1, -1)) ?? [],
);
const MOD_TYPES = new Set(['status', 'circumstance', 'item', 'untyped']);
const SAVES = new Set(['fortitude', 'reflex', 'will']);
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));

/** A modifier helper, so the shape is uniform and typos surface as validation errors. */
const mod = (value, type, target, extra = {}) => ({ value, type, target, ...extra });

/* ── The aura modes ──────────────────────────────────────────────────────────────────────────────
 * `feats` gates the mode to the record that PROJECTS the aura (the gate set the sheet builds is
 * character.feats ∪ ownedFeatureIds, so a class-feature id is a legal gate).
 * `id` is prefixed `aura-` so the lane is greppable and can never collide with an existing mode id.
 */
const MODES = [
  /* ---------- archetype / class auras that are simply ON ---------------------------------------- */
  {
    id: 'aura-marshal-dedication',
    name: "Marshal's Aura",
    feats: ['marshal-dedication'],
    duration: "while you're conscious",
    // The star on saves already exists (situationalBonuses.ts), so this restates it conditionally.
    modifiers: [mod(1, 'status', 'save', { appliesWhen: 'against fear effects' })],
    note:
      "A 15-foot emanation with the emotion, mental and visual traits. You and allies inside it gain a +1 status bonus to saves against fear. " +
      "Entering a marshal stance REPLACES what the aura grants — Dread Marshal, Inspiring Marshal, Strategist and Devrin's Cunning each rewrite it, and each carries its own text in the Stances list. " +
      "Allies' bonuses are not on your sheet, and the app cannot know who is standing in the emanation.",
  },
  {
    id: 'aura-overwatch-dedication',
    name: 'Overwatch Field',
    feats: ['overwatch-dedication'],
    duration: 'constant',
    modifiers: [mod(2, 'circumstance', 'perception', { appliesWhen: 'when you roll Perception for initiative' })],
    note:
      'A 30-foot emanation with the auditory and visual traits. You and allies inside it gain a +2 circumstance bonus when rolling Perception for Initiative. ' +
      'Wide Overwatch enlarges it to 60 feet.',
  },
  {
    id: 'aura-aura-of-confidence',
    name: 'Aura of Confidence',
    feats: ['aura-of-confidence'],
    duration: 'constant',
    modifiers: [mod(2, 'status', 'save', { appliesWhen: 'against mental effects' })],
    note:
      'You and all allies within 15 feet gain a +2 status bonus to saving throws against mental effects. ' +
      'The resistance to mental damage equal to half your level is NOT part of the aura — the feat grants it to you unconditionally, and it is already on your sheet.',
  },
  {
    id: 'aura-enlightened-presence',
    name: 'Enlightened Presence',
    feats: ['enlightened-presence'],
    duration: 'constant',
    modifiers: [mod(2, 'status', 'save', { detail: 'will', appliesWhen: 'against mental effects' })],
    note: 'An aura of resolve. You and allies within 15 feet gain a +2 status bonus to Will saving throws against mental effects.',
  },
  {
    id: 'aura-primal-aegis',
    name: 'Primal Aegis',
    feats: ['primal-aegis'],
    duration: 'constant',
    modifiers: [],
    // The six resistances are already a permanent `resistances` field on the feat. Repeating them
    // here would list each one twice in the resistance breakdown, once per source.
    note:
      'You and allies within 30 feet gain resistance equal to your Wisdom modifier to acid, cold, electricity, fire, vitality and void damage. ' +
      'Your own share is permanent and already in your resistances; this mode records that allies within 30 feet share it.',
  },
  {
    id: 'aura-area-armor',
    name: 'Area Armor',
    feats: ['area-armor'],
    duration: 'while you wear medium or heavy armor',
    modifiers: [],
    note:
      'Allies ADJACENT to you gain a +1 circumstance bonus to Reflex saves against area effects, or +2 if you are a master in the armor you are wearing. ' +
      'Nothing here lands on you — Ruling F keeps the ally bonus off your sheet.',
  },
  {
    id: 'aura-undying-conviction',
    name: 'Undying Conviction',
    feats: ['undying-conviction'],
    duration: 'constant',
    modifiers: [],
    note:
      'Undead under your control within a 30-foot emanation gain a +2 status bonus to saves against vitality damage and to Will saves against being controlled. ' +
      'It affects your minions, never you. The aura also gains the trait of your spellcasting tradition.',
  },
  {
    id: 'aura-consecrated-aura',
    name: 'Consecrated Aura',
    feats: ['consecrated-aura'],
    duration: 'constant',
    modifiers: [],
    note:
      'A 20-foot emanation of vitality energy. Each undead creature that ends its turn inside must succeed at a Will save against your spell DC or become frightened 1 (frightened 2 on a critical failure); a creature that succeeds is temporarily immune for 1 minute. ' +
      'The aura gains the trait of the tradition you used to qualify for Hallowed Necromancer Dedication. Enemy-side numbers stay off your sheet.',
  },
  {
    id: 'aura-corpse-stench',
    name: 'Corpse Stench',
    feats: ['corpse-stench'],
    duration: 'constant',
    modifiers: [],
    note:
      'A 10-foot emanation of decay. A creature that starts its turn inside must succeed at a Fortitude save against the higher of your class DC or spell DC or be sickened 1 (and slowed 1 on a critical failure), and while inside it takes a −2 circumstance penalty to saves against disease and to recover from sickened. ' +
      'A creature that succeeds is temporarily immune for 1 minute.',
  },
  {
    id: 'aura-empyreal-aura',
    name: 'Empyreal Aura',
    feats: ['empyreal-aura'],
    duration: 'constant',
    modifiers: [],
    note:
      'Each evil creature within 30 feet at the end of your turn must succeed at a save against the higher of your class DC or spell DC or become slowed 1 (slowed 2 on a critical failure). ' +
      'On a success it is temporarily immune for 10 minutes.',
  },
  {
    id: 'aura-frightful-aura',
    name: 'Frightful Aura',
    feats: ['frightful-aura'],
    duration: 'constant',
    modifiers: [],
    note:
      'A 15-foot emanation. An enemy that enters it or ends its turn inside must attempt a Will save against the higher of your spell DC or class DC: failure frightened 1, critical failure frightened 2, success unaffected and temporarily immune for 1 minute.',
  },
  {
    id: 'aura-shepherd-of-desolation',
    name: 'Shepherd of Desolation',
    feats: ['shepherd-of-desolation'],
    duration: 'constant',
    modifiers: [],
    note:
      'Allies within 10 feet of you gain the benefit of Survivor of Desolation. If you are a champion this counts as a champion aura even though it came from Knight Reclaimant. ' +
      'The benefit is entirely the allies\u2019 — nothing changes on your sheet.',
  },
  {
    id: 'aura-eternal-blessing',
    name: 'Eternal Blessing (bless)',
    feats: ['eternal-blessing'],
    duration: 'constant (Dismissable; it returns by itself after 1 minute)',
    // REAL: bless says "you and your allies ... gain a +1 status bonus to attack rolls" with no
    // further condition, and no star claims it. It cannot double with the Bless catalog mode —
    // poolTypedMods caps status bonuses at the best one.
    modifiers: [mod(1, 'status', 'attack')],
    note:
      'You are continuously surrounded by a bless spell of a rank equal to half your level (rounded up), in a 15-foot emanation you cannot enlarge. ' +
      'You and allies inside gain a +1 status bonus to attack rolls. You can Dismiss it; it comes back on its own after 1 minute.',
  },

  /* ---------- auras you switch on, with a printed duration --------------------------------------- */
  {
    id: 'aura-shield-the-faithful',
    name: 'Shield the Faithful',
    feats: ['shield-the-faithful'],
    duration: '1 minute',
    // Gold answer #3, verbatim: the mode carries REAL numbers for your half. Nothing else on the
    // record carries them — `situationalBonuses.ts` held only a display-only stand-in for the AC.
    modifiers: [mod(1, 'item', 'ac')],
    resistances: [{ type: 'spirit', value: '10+5*min(1,max(0,@actor.level-19))' }],
    note:
      'For 1 minute, you and all allies within 10 feet gain a +1 item bonus to AC and resistance 10 to spirit damage (15 at 20th level). ' +
      'While it runs, a creature that hits you with a melee attack from an adjacent square, touches you, or hits you with an unarmed attack takes 5 spirit damage (10 at 20th level) — that damage is dealt to the attacker, so it is not a number on your sheet. ' +
      'Once per hour.',
  },
  {
    id: 'aura-wrathful-presence',
    name: 'Wrathful Presence',
    feats: ['wrathful-presence'],
    duration: '1 minute, or until you Dismiss it',
    modifiers: [mod(3, 'status', 'damage', { appliesWhen: 'to damage with Strikes, while you are inside your own aura' })],
    note:
      'A 30-foot aura for 1 minute or until you Dismiss it, once per 10 minutes. You and your allies inside gain a +3 status bonus to damage with Strikes, and enemies who end their turn inside cannot reduce their frightened value below 1.',
  },
  {
    id: 'aura-frightening-indignation',
    name: 'Frightening Indignation',
    feats: ['frightening-indignation'],
    duration: '1 minute',
    modifiers: [],
    note:
      'For 1 minute, an enemy that ends its turn within a 15-foot emanation must save against the higher of your class DC or spell DC: success frightened 1, failure frightened 2 and it cannot drop below frightened 1 while inside, critical failure frightened 3. ' +
      'A critical success makes it temporarily immune for 1 minute. Once per day.',
  },
  {
    id: 'aura-repel-darkness',
    name: 'Repel Darkness',
    feats: ['repel-darkness'],
    duration: '1 minute, or until you Dismiss it',
    modifiers: [],
    note:
      'For 1 minute you suppress magical darkness of a rank up to half your level (rounded up) within a 10-foot emanation, restoring the area to its natural light — it provides no light of its own. ' +
      'If your horse is at least a mature animal companion you can have the aura emanate from the horse instead, as long as it is within 100 feet. Once per hour.',
  },
  {
    id: 'aura-dominion-aura',
    name: 'Dominion Aura',
    feats: ['dominion-aura'],
    duration: '1 minute',
    modifiers: [],
    note:
      'Every creature in a 10-foot emanation takes 8d6 force damage with a basic Fortitude save, and is knocked prone on a failure. For the next minute, any creature ending its turn inside takes 5d6 force damage with a basic Fortitude save. ' +
      'If you are not already drained you may become drained 2 to widen the emanation to 20 feet. Once per day.',
  },
  {
    id: 'aura-irradiate',
    name: 'Irradiate',
    feats: ['irradiate'],
    duration: 'while you exude the radiation',
    modifiers: [],
    note:
      'Every creature in a 15-foot emanation must succeed at a Fortitude save or become sickened 1, and is also fatigued for 1 minute on a critical failure. The sickened value rises by 1 for every 5 levels you have beyond 6th. ' +
      'You are immune to your own radiation.',
  },
  {
    id: 'aura-convocation-of-earth-and-moon',
    name: 'Convocation of Earth and Moon',
    feats: ['convocation-of-earth-and-moon'],
    duration: '5 minutes, or until you use the action again',
    // The Fly half is a stated benefit ("the benefits of the 4th-rank fly spell"), and fly grants a
    // fly Speed equal to your Speed — a value, not a guess. The Enlarge half stays text: it is a
    // bundle of size/reach/clumsy changes this lane has no field for.
    speeds: { fly: '@actor.speed.land' },
    modifiers: [],
    note:
      'You take a towering form for 5 minutes and gain the benefits of the 4th-rank enlarge and fly spells — enlarge makes you Large with +5-foot reach, +2 status damage on melee Strikes and clumsy 1; fly gives the fly Speed shown here. ' +
      'If you have your head gem it radiates an aura of moonlight: creatures that start their turn adjacent to you become dazzled until the beginning of their turn unless they succeed at a Will save against the higher of your class DC or spell DC. Once per day.',
  },
  {
    id: 'aura-ascended-celestial-dedication',
    name: 'Nimbus of Light',
    feats: ['ascended-celestial-dedication'],
    duration: 'until you suppress it (a single action with the concentrate trait)',
    modifiers: [],
    note:
      'You shed bright light in a 30-foot radius and dim light for 30 feet beyond it, and can suppress or re-establish it as a single action with the concentrate trait. ' +
      'While the nimbus is active, all allies in its area gain a +1 status bonus to saves against fear — an ally bonus, so no number of yours moves. Bless Ally and several other Ascended Celestial feats require the nimbus to be active.',
  },

  /* ---------- an aura that belongs to a banner / implement / ikon you carry ---------------------- */
  {
    id: 'aura-champions-aura',
    name: "Champion's Aura",
    feats: ['champions-aura', 'champion-dedication'],
    duration: 'until you suppress it; it also ends if you fall unconscious',
    modifiers: [],
    note:
      'A 15-foot emanation with the aura and divine traits. Any follower of your deity inside knows at once that you are a champion of your deity. ' +
      'This is the RANGE your champion\u2019s reaction uses, and what every "in your champion\u2019s aura" feat refers to; feats that add to it appear here as extra lines. ' +
      'You can suppress or resume it as a single action with the concentrate trait.',
  },
  {
    id: 'aura-commanders-banner',
    name: "Commander's Banner",
    feats: ['commanders-banner'],
    duration: 'while your banner is visible and in your possession',
    modifiers: [mod(1, 'status', 'save', { detail: 'will', appliesWhen: 'against fear effects (and to your DCs against fear)' })],
    note:
      'While your banner is visible and in your possession it provides a 30-foot emanation with the aura, emotion, mental and visual traits, giving you and all allies inside a +1 status bonus to Will saves and to DCs against fear effects. ' +
      'You pause or resume it with any action that stows or retrieves the banner. If the banner is destroyed or stolen, allies currently benefiting become frightened 1.',
  },
  {
    id: 'aura-initiate-benefit-regalia',
    name: 'Inspiring Aura (Regalia)',
    feats: ['initiate-benefit-regalia'],
    duration: 'while you hold your regalia implement',
    modifiers: [mod(1, 'status', 'save', { appliesWhen: 'against fear effects, while you hold your regalia' })],
    note:
      'While you hold your regalia you have an inspiring aura in a 15-foot emanation, affecting you and every ally who can SEE you, granting a +1 status bonus to saves against fear. ' +
      'At the end of your turn, when you would reduce your own frightened value by 1, you also reduce the frightened value of every ally in the aura by 1. The aura has the emotion, mental and visual traits.',
  },
  {
    id: 'aura-initiate-benefit-lantern',
    name: "Lantern's Aura",
    feats: ['initiate-benefit-lantern'],
    duration: 'while your lantern implement is lit',
    modifiers: [
      mod(1, 'status', 'perception', { appliesWhen: "on visual Perception checks to notice something inside the lantern's aura" }),
      mod(1, 'status', 'skill', { appliesWhen: "to Recall Knowledge about a creature inside the lantern's aura" }),
    ],
    note:
      'A lit lantern emits a 20-foot emanation with the light and magical traits; everything inside is bright-lit regardless of cover, and dim light extends the same distance again. Its counteract rank against magical darkness is half your level, rounded up. ' +
      'You and allies inside gain +1 status to visual Perception to notice anything also inside, and +1 status to Recall Knowledge about creatures inside. During exploration the GM rolls a secret check for you whenever a trap, hazard, haunt or secret enters the aura, even if you are not Searching.',
  },
  {
    id: 'aura-mirrored-aegis',
    name: 'Mirrored Aegis (immanence)',
    feats: ['mirrored-aegis'],
    duration: 'while your divine spark is in the mirrored aegis',
    modifiers: [mod(1, 'status', 'ac', { appliesWhen: 'while your divine spark is in the mirrored aegis' })],
    note:
      'The aegis emits a 15-foot emanation protecting you and all allies inside, granting a +1 status bonus to AC. ' +
      'If the aegis houses your divine spark for 10 uninterrupted minutes it is restored to full Hit Points.',
  },
  {
    id: 'aura-victors-wreath',
    name: "Victor's Wreath (immanence)",
    feats: ['victors-wreath'],
    duration: "while your divine spark is in the victor's wreath",
    modifiers: [mod(1, 'status', 'attack', { appliesWhen: "while your divine spark is in the victor's wreath" })],
    note: 'You and all allies in a 15-foot emanation gain a +1 status bonus to attack rolls.',
  },
  {
    id: 'aura-fetching-bangles',
    name: 'Fetching Bangles (immanence)',
    feats: ['fetching-bangles'],
    duration: 'while your divine spark is in the fetching bangles',
    modifiers: [],
    note:
      'An aura surrounds you in a 10-foot emanation. An enemy inside that tries to move away from you must succeed at a Will save against your class DC or its move action is disrupted. ' +
      'The save is the enemy\u2019s, so nothing on your sheet changes.',
  },
  {
    id: 'aura-paragon-benefit-shield',
    name: 'Shield Implement — allies within 15 feet',
    feats: ['paragon-benefit-shield'],
    duration: 'while your shield implement is raised',
    modifiers: [],
    note:
      'While your shield implement is raised, its circumstance bonuses — to AC and to saves against spells and other magic effects — also apply to every ally within 15 feet, and you can Shield Block in defense of any of them. ' +
      'Your own bonus is unchanged and already comes from Raise a Shield; this records the 15-foot reach of it, which is otherwise invisible.',
  },
  {
    id: 'aura-cavaliers-banner',
    name: "Cavalier's Banner",
    feats: ['cavaliers-banner'],
    duration: 'while the banner flies from your mount',
    modifiers: [mod(1, 'circumstance', 'save', { detail: 'will', appliesWhen: 'against fear effects (and to your DCs against fear)' })],
    note:
      'A 30-foot emanation FROM YOUR MOUNT, not from you. You and all allies inside gain a +1 circumstance bonus to Will saves and to DCs against fear effects. ' +
      'If the banner is destroyed or removed, allies within 30 feet become frightened 1.',
  },
  {
    id: 'aura-commander-dedication',
    name: "Commander's Banner (archetype)",
    feats: ['commander-dedication'],
    duration: 'while your banner is visible and in your possession',
    modifiers: [],
    // Deliberately NO Will-save modifier: the feat says the archetype banner does not grant it.
    note:
      'The banner you gain from Commander Dedication provides a 30-foot aura only for the purpose of using your tactics. ' +
      'It does NOT grant the commander\u2019s banner bonus to Will saves and DCs against fear — that is the class feature\u2019s, not the archetype\u2019s.',
  },

  /* ---------- the kineticist's aura, and the six gate Aura Junctions ------------------------------ */
  {
    id: 'aura-channel-elements',
    name: 'Kinetic Aura',
    feats: ['kinetic-aura', 'channel-elements', 'kineticist-dedication'],
    duration: 'until you are knocked out, use an overflow impulse, or Dismiss it',
    modifiers: [],
    note:
      'A 10-foot emanation of your kinetic element(s), switched on with Channel Elements. It cannot damage anything or affect the environment by itself — a gate\u2019s Aura Junction or a stance impulse is what gives it teeth. ' +
      'You cannot use new impulses while it is off, though ones already running continue and can still be Sustained, and stance impulses end with it. Aura Shaping lets you set its size anywhere from 5 to 20 feet (rising by 5 at 15th and 20th levels).',
  },
  ...[
    ['air', 'You and any ally that starts its turn in the aura gains a +10-foot status bonus to land Speed until the end of that turn, and to fly Speed if you have one.'],
    ['earth', 'Squares in the aura are difficult terrain for your enemies, but only when moving into the square would take the enemy farther away from you.'],
    ['fire', 'Enemies in your kinetic aura gain weakness to fire from your fire impulses equal to half your level (minimum 1).'],
    ['metal', 'Your enemies in the aura take a −1 status penalty to attacks with metal objects, and a −1 status penalty to AC if they are wearing metal armor, have the metal trait, or are made of metal.'],
    ['water', 'The aura becomes saturated with humidity: non-magical fires inside are extinguished, and creatures in the aura — you included — gain fire resistance equal to half your level.'],
    ['wood', 'Any ally that begins its turn in the aura gains 1 temporary Hit Point until the start of its next turn, rising to 2 at 10th level and 3 at 15th.'],
  ].map(([el, junction]) => ({
    id: `aura-${el}-gate-junction`,
    name: `${el[0].toUpperCase() + el.slice(1)} Gate — Aura Junction`,
    feats: [`${el}-gate`],
    duration: 'while your kinetic aura is active',
    // Only the water junction gives YOU a number: "creatures in the aura gain fire resistance equal
    // to half your level" includes the kineticist, and nothing else on the record carries it.
    // The air junction's +10-foot Speed is already a star on the record, so it stays text here.
    ...(el === 'water' ? { resistances: [{ type: 'fire', value: 'floor(@actor.level/2)' }] } : {}),
    modifiers: [],
    note:
      `${junction} ` +
      'Switch this on only if you took this gate\u2019s Aura Junction at a Gate\u2019s Threshold — a gate gives you its Impulse Junction automatically, but the aura one is a choice — and only while your kinetic aura is active.',
  })),
];

/* ── Principle C: records that REWRITE an aura someone else's record created ───────────────────────
 * These write `modeAdjust` onto the rewriting record, matched to the aura mode's id. `adjustModes`
 * merges the note into the live mode when it is switched on, so the champion's aura accumulates the
 * lines its feats add instead of each feat inventing a toggle of its own.
 *
 * ⚠ The four marshal stances are deliberately NOT here. They rewrite the marshal's aura, but the
 *   STANCE lane already carries each rewrite in its own `note` (core.stances). A modeAdjust row would
 *   put the same sentence in a second registry, which is the drift this project keeps paying for; the
 *   marshal mode's note points at the stances instead.
 */
const REWRITERS = [
  // The owner's own worked example — gold answer #3: "if the player also has the Healing Sanctuary
  // the mode needs to reflect it … Healing Sanctuary won't give anything in the mode because we don't
  // track rounds but we do need the text that says what it does."
  ['feats', 'healing-sanctuary', 'aura-shield-the-faithful',
    'Healing Sanctuary: an ally who begins their turn in this aura gains 10 temporary Hit Points that last 1 round. Rounds are not tracked, so it adds no number here.'],

  ['feats', 'wide-overwatch', 'aura-overwatch-dedication',
    'Wide Overwatch: your overwatch field is a 60-foot emanation instead of 30 feet.'],

  // Champion's aura — the record that most needed something to attach to.
  ['feats', 'aura-of-faith', 'aura-champions-aura',
    'Aura of Faith: each willing ally in the aura adds the holy trait to their Strikes if you are holy, or the unholy trait if you are unholy.'],
  ['feats', 'aura-of-determination', 'aura-champions-aura',
    'Aura of Determination: you and all allies in the aura gain a +1 status bonus to saves against mental, morph and polymorph effects.'],
  ['feats', 'aura-of-life', 'aura-champions-aura',
    'Aura of Life: you and all allies in the aura gain resistance 5 to void damage and a +1 status bonus to saves against void effects. Your own resistance is permanent and already on your sheet.'],
  ['feats', 'aura-of-righteousness', 'aura-champions-aura',
    'Aura of Righteousness: you and all allies in the aura gain resistance 5 to unholy spells, Strikes and other unholy effects, and the aura counteracts teleportation that would move an unholy creature out of it (using your devotion spells\u2019 rank and DC).'],
  ['feats', 'aura-of-despair', 'aura-champions-aura',
    'Aura of Despair: enemies in the aura take a −1 circumstance penalty to saves against fear, and an enemy that ends its turn inside cannot reduce its frightened value below 1.'],
  ['feats', 'aura-of-courage', 'aura-champions-aura',
    'Aura of Courage: at the end of your turn, each ally in the aura reduces its frightened value by 1. (Your own reduction is not the aura — it applies wherever you are.)'],
  ['feats', 'divine-health', 'aura-champions-aura',
    'Divine Health: allies in the aura share your bonus against diseases and poisons, but theirs is +1 rather than +2. They do not share the success-to-critical-success upgrade.'],
  ['feats', 'oath-of-the-defender', 'aura-champions-aura',
    'Oath of the Defender: allies in the aura — NOT you — get resistance 2 to damage dealt by creatures of the kind you swore against, rising to 3 at 7th, 4 at 12th and 5 at 17th, and +5 more when such a creature triggers your champion\u2019s reaction.'],
  ['feats', 'wyrmbane-aura', 'aura-champions-aura',
    'Wyrmbane Aura: you and all allies within 15 feet gain resistance equal to your Charisma modifier to acid, cold, electricity, fire and poison — half your level instead when the source is a dragon\u2019s breath. Your own resistance is permanent and already on your sheet.'],
  ['feats', 'aura-of-preservation', 'aura-champions-aura',
    'Aura of Preservation: you and all allies within 15 feet gain a +1 status bonus to Fortitude and Will saves against effects from aberrations.'],
  ['feats', 'expand-aura', 'aura-champions-aura',
    'Expand Aura: a single action expands the aura to a 30-foot radius until the start of your next turn — for 1 minute from 10th level, and until you Dismiss it from 16th.'],
  ['classFeatures', 'blessed-swiftness', 'aura-champions-aura',
    'Blessed Swiftness: when an ally\u2019s movement inside the aura triggers an enemy\u2019s reaction, that ally gains a +2 status bonus to all defenses against it. (The +5-foot Speed is yours wherever you stand and is already on your sheet.)'],

  // Commander's banner.
  ['feats', 'glorious-banner', 'aura-commanders-banner',
    'Glorious Banner: the banner now affects a 60-foot emanation (80-foot burst with Plant Banner), the allies\u2019 fear bonus rises to +2, you and affected allies gain +1 status to AC, Fortitude and Reflex saves, and enemies inside that can see the banner take a −2 status penalty to Will saves.'],
  ['feats', 'battle-tested-companion', 'aura-commanders-banner',
    'Battle-Tested Companion: while the banner is affixed to that companion the aura is 10 feet larger than normal — typically 40 feet instead of 30.'],

  // Nimbus and kinetic aura.
  ['feats', 'channel-divine-spark', 'aura-ascended-celestial-dedication',
    'Channel Your Divine Spark: the nimbus activates if it was off and its area doubles — bright light for 60 feet, dim for 60 more — and you cannot suppress it while channeling.'],
  ['feats', 'aura-shaping', 'aura-channel-elements',
    'Aura Shaping: you choose the emanation\u2019s size, any multiple of 5 from 5 feet up to 20 feet, when you Channel Elements or use a stance impulse that affects it. The maximum rises by 5 feet at 15th and 20th levels.'],

  // Thaumaturge regalia — level-scaled rewrites of the same inspiring aura.
  ['classFeatures', 'adept-benefit-regalia', 'aura-initiate-benefit-regalia',
    'Adept Benefit (7th): the +1 status bonus now applies to ALL saves against mental effects rather than only fear, and you and allies in the aura gain a +2 status bonus to damage rolls (+3 at 11th, +4 at 17th).'],
  ['classFeatures', 'paragon-benefit-regalia', 'aura-initiate-benefit-regalia',
    'Paragon Benefit (17th): allies in the aura are not off-guard from being flanked unless you are flanked too, and an ally in the aura that is clumsy, enfeebled, frightened, sickened or stupefied takes a status penalty 1 lower than the condition value — unless you have the same condition.'],
];

/* ── Validation. Nothing is written on trust ───────────────────────────────────────────────────── */
const problems = [];
const existingModeIds = new Set(Object.keys(core.modes ?? {}));
const gateExists = (id) => !!(core.feats?.[id] || core.classFeatures?.[id]);

for (const m of MODES) {
  const unknown = Object.keys(m).filter((k) => !LEGAL_MODE_FIELDS.has(k));
  if (unknown.length) problems.push(`${m.id}: field(s) not on ModeDef — ${unknown.join(', ')}`);
  if (!m.name) problems.push(`${m.id}: no name`);
  if (existingModeIds.has(m.id)) problems.push(`${m.id}: a mode with this id already exists — not overwriting`);
  const badGate = (m.feats ?? []).filter((f) => !gateExists(f));
  if (badGate.length) problems.push(`${m.id}: gate id(s) in neither feats nor classFeatures — ${badGate.join(', ')}`);
  if (!(m.feats ?? []).length) problems.push(`${m.id}: no gate — nothing would ever show it`);
  for (const mm of m.modifiers ?? []) {
    if (!MOD_TARGETS.has(mm.target)) problems.push(`${m.id}: modifier target "${mm.target}"`);
    if (!MOD_TYPES.has(mm.type)) problems.push(`${m.id}: modifier type "${mm.type}"`);
    if (typeof mm.value !== 'number') problems.push(`${m.id}: modifier value ${JSON.stringify(mm.value)}`);
    if (mm.target === 'save' && mm.detail && !SAVES.has(mm.detail)) problems.push(`${m.id}: save "${mm.detail}"`);
    if (mm.target === 'skill' && mm.detail && !SKILLS.has(mm.detail)) problems.push(`${m.id}: skill "${mm.detail}"`);
  }
  // Principle B: a mode with neither a number nor a note is an empty toggle, which is worse than none.
  const hasEffect = (m.modifiers ?? []).length || (m.resistances ?? []).length || (m.speeds && Object.keys(m.speeds).length);
  if (!hasEffect && !m.note) problems.push(`${m.id}: no effect and no note — an empty toggle`);
}
const modeIds = new Set(MODES.map((m) => m.id));
for (const [coll, id, modeId, note] of REWRITERS) {
  if (!core[coll]?.[id]) problems.push(`rewriter ${coll}/${id}: no such record`);
  if (!modeIds.has(modeId) && !existingModeIds.has(modeId)) problems.push(`rewriter ${coll}/${id}: targets unknown mode "${modeId}"`);
  if (!note) problems.push(`rewriter ${coll}/${id}: no note`);
}
if (problems.length) {
  console.error(`REFUSING TO WRITE — ${problems.length} problem(s):`);
  for (const s of problems) console.error('  ' + s);
  process.exit(1);
}

/* ── Write ────────────────────────────────────────────────────────────────────────────────────── */
const byId = Object.fromEntries(MODES.map((m) => [m.id, { ...m, category: 'Aura', modifiers: m.modifiers ?? [] }]));

// Group the rewriter rows per record: one `modeAdjust` array, however many auras it touches.
const adjustByRecord = new Map();
for (const [coll, id, modeId, note] of REWRITERS) {
  const key = `${coll}\u0000${id}`;
  if (!adjustByRecord.has(key)) adjustByRecord.set(key, []);
  adjustByRecord.get(key).push({ match: { ids: [modeId] }, note });
}

console.log(`aura modes authored: ${MODES.length}`);
console.log(`  with a real (unconditional) number: ${MODES.filter((m) => (m.modifiers ?? []).some((x) => !x.appliesWhen) || (m.resistances ?? []).length || m.speeds).length}`);
console.log(`  text only (ally- or enemy-facing): ${MODES.filter((m) => !(m.modifiers ?? []).length && !(m.resistances ?? []).length && !m.speeds).length}`);
console.log(`records rewriting an aura (modeAdjust): ${adjustByRecord.size} across ${REWRITERS.length} rows`);

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

// 1. the durable mode source, merged (never truncated — it already holds 113 authored toggles)
const SRC = p('scripts/data/toggle-modes.json');
const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
const before = Object.keys(prev).length;
for (const [id, m] of Object.entries(byId)) prev[id] = m;
writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
console.log(`\nscripts/data/toggle-modes.json: ${before} → ${Object.keys(prev).length} modes`);

// 2. the modeAdjust rows, through the ONE writer for the overlay
const rows = readBackfill(ROOT);
const kept = rows.filter((r) => !(r.field === 'modeAdjust' && adjustByRecord.has(`${r.category}\u0000${r.id}`)));
for (const [key, value] of adjustByRecord) {
  const [category, id] = key.split('\u0000');
  kept.push({ category, id, field: 'modeAdjust', value });
}
writeBackfill(ROOT, kept);
console.log(`scripts/data/effect-backfill.json: ${rows.length} → ${kept.length} rows`);

// 3. core.json, so the change is visible without a full regeneration
core.modes = { ...(core.modes ?? {}), ...byId };
for (const [key, value] of adjustByRecord) {
  const [category, id] = key.split('\u0000');
  core[category][id].modeAdjust = value;
}
writeFileSync(p('public/core.json'), JSON.stringify(core));
console.log(`public/core.json: core.modes now ${Object.keys(core.modes).length}`);
console.log('\nRe-run `node scripts/import-siege-and-gaps.mjs` after a regeneration to re-apply the backfill.');
