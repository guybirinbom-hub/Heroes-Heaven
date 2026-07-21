/*
 * Situational (conditional) bonuses granted by feats.
 *
 * Many feats grant a bonus that only applies in specific circumstances — Intimidating Prowess gives
 * +1 to Intimidation *when you Coerce or Demoralize a target you can physically menace*. The build
 * engine can't fold these into a flat number (they're conditional), so instead the sheet FLAGS the
 * affected stat (a * next to Intimidation) and lists the condition when the player opens that stat's
 * detail — so they know they have something that applies here.
 *
 * The registry is authored from the Foundry pf2e rule elements (predicated FlatModifiers on a
 * skill/save/perception/AC selector) plus each feat's printed text. It is DISPLAY-ONLY: nothing here
 * changes a computed number. Keyed by the feat's core.json id.
 */

export interface SituationalTarget {
  /** Which stat the bonus can apply to. */
  kind: 'skill' | 'save' | 'perception' | 'ac' | 'attack';
  /**
   * For `skill`: a skill key (e.g. `intimidation`), a `lore:*` key, or `all` (any skill).
   * For `save`: `fortitude` | `reflex` | `will` | `all`.
   * Ignored for `perception` / `ac` / `attack`.
   */
  detail?: string;
}

export interface SituationalBonus {
  targets: SituationalTarget[];
  /** Short, player-facing trigger, e.g. "you Coerce or Demoralize a target you can physically menace". */
  when: string;
  /** The modifier, e.g. "+1 circumstance", or a short effect phrase. */
  bonus: string;
}

/**
 * feat id → the situational bonuses it grants. The bulk of this table is generated (see the
 * situational-author workflow output); a few are kept here as the hand-verified anchor + regression
 * examples.
 */
export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {
  "acrobatic-performer": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "when you Perform, if trained in both Acrobatics and Performance", bonus: "+1 circumstance" }],
  "adaptive-vision": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against visual effects", bonus: "+1 circumstance" }],
  "adhyabhau": [{ targets: [{ kind: 'save', detail: 'will' }], when: "against emotion effects", bonus: "+1 circumstance" }],
  "adrenaline-rush": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "while Raging, to lift heavy objects, Escape, or Force Open", bonus: "+1 status" }],
  "aegis-of-the-dissolution": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against darkness or shadow effects", bonus: "+1 circumstance" }],
  "aerobatics-mastery": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "to Maneuver in Flight", bonus: "+2 circumstance" }],
  "affliction-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against diseases and poisons", bonus: "+1 circumstance" }],
  "ageless-patience": [{ targets: [{ kind: 'perception' }, { kind: 'skill', detail: 'all' }], when: "when you spend twice as long on a check that takes 1+ actions", bonus: "+2 circumstance" }],
  "alghollthu-bound": [{ targets: [{ kind: 'save', detail: 'will' }], when: "against mental effects that would make you controlled", bonus: "+2 circumstance" }],
  "all-this-has-happened-before": [{ targets: [{ kind: 'perception' }], when: "on your initiative roll (once per day)", bonus: "+4 circumstance" }],
  "all-this-will-happen-again": [{ targets: [{ kind: 'save', detail: 'will' }], when: "reroll a failed save vs an emotion effect (keep the 2nd result)", bonus: "+1 status" }],
  "always-ready": [{ targets: [{ kind: 'perception' }], when: "on initiative when all your opponents are undead", bonus: "+1 circumstance" }],
  "ambush-awareness": [{ targets: [{ kind: 'perception' }], when: "on Perception checks rolled for initiative", bonus: "+2 circumstance" }],
  "amorphous-aspect": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }, { kind: 'skill', detail: 'athletics' }], when: "to Escape or Squeeze", bonus: "+1 circumstance" }],
  "analyze-idiolect": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate someone you studied for 10+ minutes", bonus: "+4 circumstance" }],
  "ancestral-suspicion": [{ targets: [{ kind: 'save', detail: 'all' }, { kind: 'perception' }], when: "against effects that would make you controlled (e.g. Dominate)", bonus: "+2 circumstance" }],
  "animal-actor": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate an animal of a type you have Lore about", bonus: "+2 circumstance" }],
  "animal-elocutionist": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on animals", bonus: "+1 circumstance" }],
  "animal-skin": [{ targets: [{ kind: 'ac' }], when: "while Raging and unarmored (Dex cap +3)", bonus: "+2 item (+3 with Greater Juggernaut)" }],
  "animal-soul-siblings": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Gather Information from animals", bonus: "+1 circumstance" }],
  "animal-speaker": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on animals", bonus: "+1 circumstance" }],
  "animalistic-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "to resist diseases and poisons", bonus: "+2 circumstance" }],
  "ankle-biter": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Trip while prone", bonus: "+1 circumstance" }],
  "aquatic-conversationalist": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on amphibious or aquatic animals", bonus: "+1 circumstance" }],
  "arc-of-destruction": [{ targets: [{ kind: 'ac' }], when: "against the triggering ranged Strike (spend a Mythic Point)", bonus: "+4 status" }],
  "archaeologist-dedication": [{ targets: [{ kind: 'skill', detail: 'arcana' }, { kind: 'skill', detail: 'nature' }, { kind: 'skill', detail: 'occultism' }, { kind: 'skill', detail: 'religion' }, { kind: 'skill', detail: 'society' }], when: "to Recall Knowledge about ancient history, peoples, and cultures", bonus: "+1 circumstance" }],
  "ardent-armiger": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects that could inflict controlled or frightened", bonus: "+1 circumstance" }],
  "aurochs-headed": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }, { kind: 'skill', detail: 'intimidation' }], when: "to Make an Impression or Coerce creatures with the orc trait", bonus: "+1 circumstance" }],
  "avenger-dedication": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against divine spells and effects that deal spirit damage", bonus: "+1 status" }],
  "barbarian-dedication": [{ targets: [{ kind: 'ac' }], when: "while raging", bonus: "-1 (penalty)" }],
  "bashing-charge": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Force Open an obstacle you move through", bonus: "+1 circumstance" }],
  "beast-speaker": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make a Request of animals while Speak with Animals is active", bonus: "+2 circumstance" }],
  "blessed-blood-nephilim": [{ targets: [{ kind: 'skill', detail: 'crafting' }], when: "to Craft holy water", bonus: "+4 circumstance" }],
  "bloodline-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against spells and magical effects", bonus: "+1 status" }],
  "boarding-party": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Climb a sea vehicle with both hands free", bonus: "+2 circumstance" }],
  "bouncy-goblin": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "to Tumble Through a foe's space", bonus: "+2 circumstance" }],
  "breath-control": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against inhaled threats (success becomes critical success)", bonus: "+1 circumstance" }],
  "bright-lion-dedication": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "against careful inspection, to pass yourself off as a worshipper of Walkena", bonus: "+4 circumstance" }],
  "brightsoul": [{ targets: [{ kind: 'skill', detail: 'stealth' }, { kind: 'save', detail: 'all' }], when: "vs light effects or effects that blind/dazzle (+1 save); -2 to Hide or Sneak while glowing", bonus: "+1 circumstance (saves); -2 circumstance (Stealth)" }],
  "called": [{ targets: [{ kind: 'save', detail: 'will' }], when: "on Will saves against mental effects", bonus: "+1 circumstance" }],
  "cel-rau": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects with the darkness, light, or shadow trait", bonus: "+1 circumstance" }],
  "charmed-life": [{ targets: [{ kind: 'save', detail: 'all' }], when: "on a saving throw before you roll (triggered)", bonus: "+2 circumstance" }],
  "chelaxian-scion-dedication": [{ targets: [{ kind: 'skill', detail: 'deception' }, { kind: 'skill', detail: 'diplomacy' }, { kind: 'skill', detail: 'intimidation' }], when: "against Chelaxian citizens and devils", bonus: "+1 circumstance" }],
  "chemical-trail": [{ targets: [{ kind: 'skill', detail: 'survival' }], when: "to Sense Direction or reorient yourself", bonus: "+1 circumstance" }],
  "childlike-plant": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate a human version of yourself", bonus: "+4 circumstance" }],
  "city-scavenger": [{ targets: [{ kind: 'skill', detail: 'society' }, { kind: 'skill', detail: 'survival' }], when: "to Subsist (may use Society or Survival in a settlement)", bonus: "+1 circumstance" }],
  "clan-pistol": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Gather Information or Make an Impression with Alkenstar/Dongun Hold citizens while your clan pistol is visible", bonus: "+1 circumstance" }],
  "climbing-tail": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Climb", bonus: "+2 circumstance" }],
  "cold-iron-stomach": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs olfactory or poison effects from demons or Abyssal hazards", bonus: "+2 circumstance" }],
  "cold-minded": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion effects", bonus: "+1 circumstance" }],
  "combat-assessment": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "to Recall Knowledge right after a critical hit with the Strike", bonus: "+2 circumstance" }],
  "community-knowledge": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "on a skill check of 3 actions or fewer (once per hour)", bonus: "+2 status" }],
  "community-minded": [{ targets: [{ kind: 'perception' }], when: "to Sense Motive, resist a Lie, or spot someone Impersonating another", bonus: "+1 circumstance" }],
  "construct-dynamo": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against magic", bonus: "+1 status" }],
  "coral-detoxification": [{ targets: [{ kind: 'save', detail: 'all' }], when: "on a save against a poison affecting you (once per hour)", bonus: "+2 circumstance" }],
  "coral-symbiotes": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against poisons", bonus: "+1 status" }],
  "crane-flutter": [{ targets: [{ kind: 'ac' }], when: "against a triggering attack while in Crane Stance", bonus: "+3 circumstance (vs the triggering attack)" }],
  "creative-prodigy": [{ targets: [{ kind: 'skill', detail: 'performance' }], when: "when you use Performance to Make an Impression", bonus: "+1 circumstance" }],
  "crossbow-terror": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "to Demoralize if you hit a Strike with a crossbow this turn", bonus: "+2 circumstance" }],
  "crown-of-the-saumen-kar": [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: "to Sneak or Hide in ice or snow", bonus: "+1 circumstance" }],
  "cut-from-the-air": [{ targets: [{ kind: 'ac' }], when: "against the triggering physical ranged Strike (reaction)", bonus: "+4 circumstance" }],
  "death-warden": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects with the void trait", bonus: "+1 status" }],
  "deathless-servant": [{ targets: [{ kind: 'ac' }], when: "while you have the wounded condition", bonus: "status bonus equal to your wounded value" }],
  "deaths-drums": [{ targets: [{ kind: 'save', detail: 'fortitude' }], when: "while taking persistent damage or wounded 1+", bonus: "+2 circumstance" }],
  "deflect-projectile": [{ targets: [{ kind: 'ac' }], when: "against the triggering physical ranged attack (reaction)", bonus: "+4 circumstance" }],
  "deflecting-cloud": [{ targets: [{ kind: 'ac' }], when: "against a ranged attack while your dragon wings are active", bonus: "+4 circumstance" }],
  "deflecting-jewel": [{ targets: [{ kind: 'ac' }], when: "against a ranged attack while you hold your head gem (once/hour)", bonus: "+2 circumstance" }],
  "destined-victory": [{ targets: [{ kind: 'ac' }], when: "against an enemy's next attack after it hits you with a melee Strike", bonus: "+2 status" }],
  "detectives-readiness": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against creatures or effects tied to your open Pursue a Lead investigation", bonus: "+1 circumstance (Pursue a Lead)" }],
  "devils-advocate": [{ targets: [{ kind: 'perception' }, { kind: 'save', detail: 'all' }], when: "against devils and their abilities", bonus: "+2 circumstance" }],
  "diamond-soul": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against magic", bonus: "+1 status" }],
  "different-worlds": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate as your second identity", bonus: "+4 circumstance" }],
  "disarming-intercept": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Disarm after you Intercept a melee attack", bonus: "item bonus equal to your armor's potency rune" }],
  "discerning-gaze": [{ targets: [{ kind: 'perception' }], when: "on secret Perception checks to Sense Motive", bonus: "+1 circumstance" }],
  "diverse-mystery": [{ targets: [{ kind: 'save', detail: 'all' }, { kind: 'perception' }], when: "while Cursebound 1 from this spell", bonus: "-1 status" }],
  "divine-countermeasures": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against divine effects", bonus: "+1 circumstance" }],
  "divine-disharmony": [{ targets: [{ kind: 'skill', detail: 'intimidation' }, { kind: 'skill', detail: 'deception' }], when: "you Coerce or Demoralize a faithful creature by clashing opposing divine symbols", bonus: "+2 circumstance" }],
  "divine-grace": [{ targets: [{ kind: 'save', detail: 'all' }], when: "reaction on a save against a spell, before you roll", bonus: "+2 circumstance" }],
  "divine-health": [{ targets: [{ kind: 'save', detail: 'all' }], when: "saves against diseases and poisons", bonus: "+2 status" }],
  "do-you-know-who-i-am": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "you throw your reputation around to break a foe's mind (once/hour)", bonus: "+1 circumstance" }],
  "dodge-away": [{ targets: [{ kind: 'ac' }], when: "reaction vs a melee attack when aware and not off-guard", bonus: "+1 circumstance" }],
  "draconic-arrogance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "while raging, against emotion effects", bonus: "+2 status" }],
  "draconic-sycophant": [{ targets: [{ kind: 'perception' }, { kind: 'save', detail: 'all' }], when: "against dragons", bonus: "+2 circumstance" }],
  "dragon-grip": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "Make an Impression on a creature with the dragon trait", bonus: "+2 circumstance" }],
  "dragonet-resistances": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against sleep effects and effects that would paralyze you", bonus: "+2 circumstance" }],
  "dragons-presence": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "Demoralize a foe of your size or larger", bonus: "+1 circumstance" }],
  "dream-may": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against sleep effects and effects that cause or alter dreams", bonus: "+2 circumstance" }],
  "elude-the-divine": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "against divination effects trying to discern your deity", bonus: "+2 circumstance" }],
  "elven-verve": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects that would immobilize, paralyze, or slow you", bonus: "+1 circumstance" }],
  "elysiums-cadence": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "Make an Impression or gather-information", bonus: "+1 circumstance" }],
  "emberkin": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against fire effects", bonus: "+1 circumstance" }],
  "emotional-partitions": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion effects", bonus: "+1 circumstance" }],
  "emotionless": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion or fear effects (success becomes crit success)", bonus: "+1 circumstance" }],
  "entreat-with-forebears": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }, { kind: 'skill', detail: 'deception' }, { kind: 'skill', detail: 'intimidation' }, { kind: 'save', detail: 'all' }], when: "interacting with (or resisting the tricks of) creatures of your bloodline's trait", bonus: "+1 circumstance" }],
  "exalted-greatness": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects created by enemies in your champion's aura", bonus: "+2 status" }],
  "exhort-the-faithful": [{ targets: [{ kind: 'skill', detail: 'religion' }, { kind: 'skill', detail: 'diplomacy' }, { kind: 'skill', detail: 'intimidation' }], when: "Request or Coerce members of your own faith (may use Religion for the check)", bonus: "+2 circumstance" }],
  "extra-squishy": [{ targets: [{ kind: 'save', detail: 'fortitude' }, { kind: 'save', detail: 'reflex' }], when: "to resist being forcibly moved or dislodged from a tight space", bonus: "+4 circumstance" }],
  "eye-for-masonry": [{ targets: [{ kind: 'perception' }, { kind: 'skill', detail: 'athletics' }, { kind: 'skill', detail: 'thievery' }], when: "working with stonework (spot stone features, Force Open a stone door, Disable a stone trap)", bonus: "+2 circ (Perception) / +1 circ (Athletics, Thievery)" }],
  "eye-for-numbers": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "counting or estimating the quantity of similar items you can see", bonus: "+2 circumstance" }],
  "eye-for-smugglers": [{ targets: [{ kind: 'perception' }], when: "searching for hidden panels, secret doors, or concealed objects", bonus: "+2 circumstance" }],
  "eye-for-treasure": [{ targets: [{ kind: 'skill', detail: 'crafting' }], when: "Recall Knowledge with Crafting", bonus: "+1 circumstance" }],
  "eyes-of-god": [{ targets: [{ kind: 'perception' }], when: "to Sense Motive and against attempts to Lie to you", bonus: "+4 status" }],
  "eyes-unclouded": [{ targets: [{ kind: 'perception' }], when: "to Sense Motive and against attempts to Lie to you", bonus: "+2 circumstance" }],
  "familiar-oddities": [{ targets: [{ kind: 'skill', detail: 'arcana' }, { kind: 'skill', detail: 'nature' }, { kind: 'skill', detail: 'occultism' }, { kind: 'skill', detail: 'religion' }], when: "Identify Magic on a cursed item or a curse-trait spell", bonus: "+2 circumstance" }],
  "farabellus-flip": [{ targets: [{ kind: 'ac' }], when: "an enemy targets you with a melee Strike (reaction)", bonus: "+2 circumstance" }],
  "feathered-cloak": [{ targets: [{ kind: 'skill', detail: 'deception' }, { kind: 'skill', detail: 'stealth' }], when: "Impersonate a non-strix version of yourself (Deception); conceal objects on your person (Stealth)", bonus: "+2 circumstance" }],
  "ferocious-shape": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "while in an Untamed Form shape that grants a specific Athletics modifier", bonus: "+1 status" }],
  "fey-fellowship": [{ targets: [{ kind: 'perception' }, { kind: 'save', detail: 'all' }], when: "against fey creatures", bonus: "+2 circumstance" }],
  "fey-tracker": [{ targets: [{ kind: 'skill', detail: 'survival' }, { kind: 'perception' }], when: "to Track fey, Seek hidden fey, or resist a fey's Create a Diversion", bonus: "+2 circumstance" }],
  "fey-transcendence": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against illusion or emotion effects", bonus: "+2 status" }],
  "fierce-grasp": [{ targets: [{ kind: 'ac' }], when: "against attacks from a foe you have grabbed or restrained", bonus: "+1 circumstance" }],
  "fire-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against fire effects", bonus: "+1 circumstance" }],
  "flashy-dodge": [{ targets: [{ kind: 'ac' }], when: "against a triggering attack from a creature you can see (not encumbered)", bonus: "+2 circumstance" }],
  "flashy-roll": [{ targets: [{ kind: 'save', detail: 'reflex' }], when: "on a Reflex save when you use Flashy Dodge against it", bonus: "+2 circumstance" }],
  "fluttering-misdirection": [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: "to Hide or Sneak while wielding a fan (you and adjacent allies)", bonus: "+1 circumstance" }],
  "folk-healer": [{ targets: [{ kind: 'skill', detail: 'medicine' }], when: "to Treat Wounds and similar Medicine tasks", bonus: "+1 circumstance" }],
  "forlorn": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion effects (success becomes critical success)", bonus: "+1 circumstance" }],
  "fortunes-favor": [{ targets: [{ kind: 'skill', detail: 'all' }, { kind: 'save', detail: 'all' }], when: "on a skill check or save you're about to reroll via a fortune effect", bonus: "+2 circumstance" }],
  "fresh-ingredients": [{ targets: [{ kind: 'skill', detail: 'nature' }], when: "to Treat Wounds with Natural Medicine (+2 anywhere, +4 in wilderness)", bonus: "+2/+4 circumstance" }],
  "friend-of-the-family": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression or Request with politicians or officials", bonus: "+2 circumstance" }],
  "frostbite-runes": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against evil and necromancy spells and effects", bonus: "+1 status" }],
  "furious-bully": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "for attack actions (Shove, Trip, Grapple, Disarm) while raging", bonus: "+2 circumstance" }],
  "game-hunter-dedication": [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: "against your hunted prey", bonus: "+2 circumstance" }],
  "goloma-courage": [{ targets: [{ kind: 'save', detail: 'will' }], when: "against fear effects (success becomes critical success); +2 vs Demoralize", bonus: "+1 circumstance" }],
  "graft-technician": [{ targets: [{ kind: 'skill', detail: 'medicine' }], when: "to implant grafts (+2 if master in Medicine)", bonus: "+1 circumstance" }],
  "gravel-guts": [{ targets: [{ kind: 'save', detail: 'fortitude' }], when: "against the sickened condition", bonus: "+1 circumstance" }],
  "green-empathy": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on or Request from plants and fungi", bonus: "+2 circumstance" }],
  "grit-and-tenacity": [{ targets: [{ kind: 'save', detail: 'fortitude' }, { kind: 'save', detail: 'will' }], when: "reroll once/hour after failing a Fortitude or Will save", bonus: "+2 circumstance" }],
  "grove-harbored": [{ targets: [{ kind: 'save', detail: 'fortitude' }, { kind: 'save', detail: 'reflex' }, { kind: 'save', detail: 'will' }], when: "against plant, poison, and wood effects", bonus: "+1 circumstance" }],
  "guarded-mind": [{ targets: [{ kind: 'save', detail: 'all' }], when: "reroll once/10 min after failing a save against a mental effect", bonus: "+2 circumstance" }],
  "guarded-movement": [{ targets: [{ kind: 'ac' }], when: "against reactions triggered by your movement", bonus: "+4 circumstance" }],
  "handy-with-your-paws": [{ targets: [{ kind: 'skill', detail: 'crafting' }], when: "to Repair non-magical items", bonus: "+1 circumstance" }],
  "hard-to-fool": [{ targets: [{ kind: 'perception' }, { kind: 'save', detail: 'will' }], when: "Perception vs illusions; Will vs illusion and shadow effects", bonus: "+1 circumstance" }],
  "harmlessly-cute": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "when you roll Deception for initiative", bonus: "+1 circumstance" }],
  "hazard-finder": [{ targets: [{ kind: 'perception' }, { kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "vs traps and hazards (find, their attacks, their effects)", bonus: "+1 circumstance" }],
  "helpful-poppet": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "on checks to Aid", bonus: "+2 circumstance" }],
  "heros-wings": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }, { kind: 'skill', detail: 'intimidation' }], when: "against sprites", bonus: "+2 circumstance" }],
  "hit-the-dirt": [{ targets: [{ kind: 'ac' }], when: "against a triggering ranged Strike (you Leap, land prone)", bonus: "+2 circumstance" }],
  "hold-mark": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against spells from your chosen tradition", bonus: "+1 status" }],
  "i-will-return": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against death effects", bonus: "+2 status" }],
  "idol-threat": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "Demoralize a creature whose sacred/precious item you hold and threaten", bonus: "+2 circumstance" }],
  "illusion-sense": [{ targets: [{ kind: 'perception' }, { kind: 'save', detail: 'will' }], when: "against illusions", bonus: "+1 circumstance" }],
  "incredible-improvisation": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "once/day, a check with a skill you're untrained in", bonus: "+4 circumstance" }],
  "inked-panoply": [{ targets: [{ kind: 'ac' }], when: "reaction vs an attack from a foe you can see (spends Storied Skin)", bonus: "+1 circumstance" }],
  "innate-understanding": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "attempting a trained-only skill action while untrained", bonus: "+2 circumstance" }],
  "instinctive-maneuvers": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Grapple, Reposition, Shove, or Trip after Relinquishing Control", bonus: "+2 status" }],
  "interrogate": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "vs a target of your faith (or undead/werecreature posing as one)", bonus: "+2 circumstance" }],
  "intimidating-prowess": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "you Coerce or Demoralize a target you can physically menace", bonus: "+1 circumstance (and ignore the not-sharing-a-language penalty)" }],
  "intuitive-cooperation": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "to Aid, or when an ally Aids you", bonus: "+2 circumstance" }],
  "investigate-haunting": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "to disable a haunt", bonus: "+2 circumstance" }],
  "ironblood-surge": [{ targets: [{ kind: 'ac' }], when: "until your next turn while in Ironblood Stance", bonus: "+1 circumstance" }],
  "kaiju-defense-oath": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against creatures at least 2 sizes larger than you", bonus: "+2 circumstance" }],
  "keen-nose": [{ targets: [{ kind: 'save', detail: 'fortitude' }], when: "vs olfactory effects that make you sickened", bonus: "+1 circumstance" }],
  "kin-hunter": [{ targets: [{ kind: 'save', detail: 'all' }], when: "for 1 min vs a creature you identified with an Occultism/Yaoguai Lore RK", bonus: "+1 circumstance" }],
  "kitharodian-actor-dedication": [{ targets: [{ kind: 'skill', detail: 'performance' }, { kind: 'skill', detail: 'deception' }], when: "performing or deceiving as a theatrical role", bonus: "+2 circumstance (+3 at 10th, +4 at 17th)" }],
  "know-the-beat": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Gather Information or investigate crimes", bonus: "+1 circumstance" }],
  "lab-rat": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against poisons and diseases", bonus: "+1 circumstance" }],
  "larger-than-life": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "while Large or Huge via Change Shape", bonus: "+1 circumstance" }],
  "lawbringer": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion effects", bonus: "+1 circumstance" }],
  "leaf-transformation": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "using Deception to Earn Income", bonus: "+1 status" }],
  "legendary-leader": [{ targets: [{ kind: 'skill', detail: 'intimidation' }, { kind: 'skill', detail: 'diplomacy' }], when: "to Coerce or Make an Impression on someone who has heard of you", bonus: "+2 circumstance" }],
  "legs-of-stone": [{ targets: [{ kind: 'save', detail: 'fortitude' }, { kind: 'save', detail: 'reflex' }], when: "against attempts to Shove or Trip you", bonus: "+2 status" }],
  "leshy-superstition": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against a spell or magical effect (when triggered)", bonus: "+1 circumstance" }],
  "lie-detector": [{ targets: [{ kind: 'perception' }], when: "Perception to Sense Motive, and DC vs attempts to Lie to you", bonus: "+1 circumstance" }],
  "linguistic-revival": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "while Truespeech is active, speaking a language you don't share", bonus: "+2 circumstance" }],
  "living-stone": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against diseases, poisons, and petrification", bonus: "+2 circumstance" }],
  "maguss-analysis": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "to Recall Knowledge about a creature you hit with a Strike this turn", bonus: "+1 circumstance" }],
  "manipulative-charm": [{ targets: [{ kind: 'skill', detail: 'deception' }, { kind: 'skill', detail: 'diplomacy' }], when: "vs humanoids: Lie, Gather Information, Make an Impression", bonus: "+1 circumstance" }],
  "mask-of-rejection": [{ targets: [{ kind: 'save', detail: 'all' }], when: "reroll a failed save vs your warmask tradition (once/day)", bonus: "+2 circumstance" }],
  "masked-casting": [{ targets: [{ kind: 'save', detail: 'all' }, { kind: 'skill', detail: 'all' }], when: "to disbelieve illusions while Averting your Gaze", bonus: "+2 circumstance" }],
  "mediums-awareness": [{ targets: [{ kind: 'perception' }], when: "to Seek and for initiative rolls", bonus: "+2 status (+3 at 12th, +4 at 20th)" }],
  "mercenary-motivation": [{ targets: [{ kind: 'perception' }, { kind: 'skill', detail: 'all' }], when: "toward the planned task (after 1 min planning)", bonus: "+1 circumstance" }],
  "mighty-bulwark": [{ targets: [{ kind: 'save', detail: 'reflex' }], when: "on all Reflex saves (bulwark now applies to non-damaging too)", bonus: "+4 (bulwark)" }],
  "monstrous-peacemaker": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }, { kind: 'perception' }], when: "vs non-humanoid intelligent creatures and marginalized humanoids", bonus: "+1 circumstance" }],
  "monumental-maestro": [{ targets: [{ kind: 'skill', detail: 'performance' }], when: "to Perform with a musical instrument or sing", bonus: "+2 circumstance" }],
  "morph-risen": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against forced polymorph/transformation effects", bonus: "+1 circumstance" }],
  "multilingual-cipher": [{ targets: [{ kind: 'skill', detail: 'arcana' }, { kind: 'skill', detail: 'occultism' }, { kind: 'skill', detail: 'religion' }, { kind: 'skill', detail: 'society' }], when: "to Decipher Writing", bonus: "+1 circumstance" }],
  "musetouched": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }, { kind: 'skill', detail: 'athletics' }], when: "to Escape", bonus: "+1 circumstance" }],
  "mutant-physique": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "while affected by a Bestial Mutagen", bonus: "mutagen's item bonus" }],
  "myth-of-realm-walking": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against planar anchor/banishment effects with incapacitation", bonus: "+4 status" }],
  "necromantic-deflection": [{ targets: [{ kind: 'save', detail: 'all' }, { kind: 'ac' }], when: "against necromancy spells while your shield is raised", bonus: "shield's circumstance bonus" }],
  "necromantic-physiology": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against diseases", bonus: "+2 circumstance" }],
  "necromantic-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against necromancy effects", bonus: "+1 circumstance" }],
  "necromantic-resistance-undead-slayer": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against necromancy effects", bonus: "+1 circumstance" }],
  "never": [{ targets: [{ kind: 'save', detail: 'all' }], when: "reroll vs the confused/controlled effect when you'd attack an ally", bonus: "+4 circumstance" }],
  "nimble-dodge": [{ targets: [{ kind: 'ac' }], when: "vs a triggering attack from a seen attacker (not encumbered)", bonus: "+2 circumstance" }],
  "nimble-roll": [{ targets: [{ kind: 'save', detail: 'reflex' }], when: "vs the triggering effect (use Nimble Dodge before the save)", bonus: "+2 circumstance" }],
  "no-stranger-to-death": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs spells/effects with the death, disease, or evil trait", bonus: "+2 circumstance" }],
  "noble-resolve": [{ targets: [{ kind: 'save', detail: 'will' }], when: "vs mental effects", bonus: "+1 circumstance" }],
  "nocturnal-charm": [{ targets: [{ kind: 'skill', detail: 'deception' }, { kind: 'skill', detail: 'diplomacy' }], when: "vs humanoids (or your creature type): Lie, Gather Information, Make an Impression", bonus: "+1 circumstance" }],
  "norgorbers-secret": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against mental effects", bonus: "+2 circumstance" }],
  "nourishing-gate": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against poisons, sleep, and paralysis effects", bonus: "+2 status" }],
  "numb": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion and pain effects", bonus: "+1 circumstance (+2 while your body is destroyed)" }],
  "occult-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against occult effects", bonus: "+1 circumstance" }],
  "oddity-identification": [{ targets: [{ kind: 'skill', detail: 'occultism' }], when: "to Identify Magic that twists minds, fights fortune, or reveals secrets", bonus: "+2 circumstance" }],
  "of-lions-and-wyrms": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against animals and dragons (per prose)", bonus: "+2 circumstance" }],
  "oozemorph-dedication": [{ targets: [{ kind: 'save', detail: 'reflex' }, { kind: 'skill', detail: 'athletics' }, { kind: 'skill', detail: 'acrobatics' }], when: "to avoid being Engulfed, or to Escape after being Engulfed", bonus: "+2 circumstance" }],
  "operatic-adventurer": [{ targets: [{ kind: 'perception' }], when: "on a stage, in an arena, or at the focus of a crowd", bonus: "+3 circumstance" }],
  "orc-superstition": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against the triggering spell or magical effect", bonus: "+1 circumstance" }],
  "overlooked-mastermind": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "you Lie by claiming ignorance", bonus: "+2 circumstance" }],
  "pack-hunter": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "when you Aid", bonus: "+2 circumstance" }],
  "pain-tolerance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs effects that would make you clumsy, drained, or enfeebled", bonus: "+1 circumstance" }],
  "parthenogenic-hatchling": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against diseases", bonus: "+1 circumstance" }],
  "peculiar-anatomy": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against disease or poison", bonus: "+2 circumstance" }],
  "peer-beyond": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs mental effects from incorporeal undead or haunts", bonus: "+2 circumstance" }],
  "perfect-clarity": [{ targets: [{ kind: 'save', detail: 'will' }, { kind: 'attack' }], when: "reroll a failed attack roll or Will save (then stop raging)", bonus: "+2 circumstance (reroll)" }],
  "petal-step": [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: "when you Sneak", bonus: "+1 circumstance" }],
  "phantom-charm": [{ targets: [{ kind: 'skill', detail: 'all' }, { kind: 'save', detail: 'all' }], when: "on a check subject to a misfortune effect (1/day)", bonus: "+2 circumstance" }],
  "pirouette": [{ targets: [{ kind: 'ac' }], when: "vs a triggering Strike, in Masquerade of Seasons Stance", bonus: "+2 circumstance" }],
  "plant-soul-siblings": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "Gather Information from animals or plants", bonus: "+2 circumstance" }],
  "plumekith": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects with the air trait", bonus: "+2 circumstance" }],
  "poison-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against poisons", bonus: "+1 status" }],
  "political-acumen": [{ targets: [{ kind: 'perception' }], when: "Sense Motive against other elves", bonus: "+2 circumstance" }],
  "pounding-leap": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "the High Jump or Long Jump after your fist Strike", bonus: "+2 circumstance" }],
  "practiced-brawn": [{ targets: [{ kind: 'skill', detail: 'athletics' }, { kind: 'save', detail: 'fortitude' }], when: "Force Open, Shove, or resist becoming fatigued", bonus: "+1 circumstance" }],
  "prairie-rider": [{ targets: [{ kind: 'skill', detail: 'nature' }], when: "Command an Animal on a traditional halfling mount", bonus: "+1 circumstance" }],
  "premonition-of-avoidance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against a hazard", bonus: "+2 circumstance" }],
  "proteankin": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs effects that would make you controlled", bonus: "+1 circumstance" }],
  "proximity-alert": [{ targets: [{ kind: 'perception' }], when: "on Perception checks for initiative", bonus: "+2 circumstance" }],
  "rakshasa-ravaged": [{ targets: [{ kind: 'save', detail: 'all' }], when: "on saves against occult spells", bonus: "+1 circumstance" }],
  "ravenings-desperation": [{ targets: [{ kind: 'skill', detail: 'survival' }, { kind: 'skill', detail: 'stealth' }], when: "while below half your max HP (more below a quarter)", bonus: "+1 circumstance" }],
  "rearing-display": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "to Demoralize after your mount's rearing Strike hits (while riding)", bonus: "+1 circumstance" }],
  "receive-prayers": [{ targets: [{ kind: 'perception' }], when: "to Sense Motive for a target's hopes, prayers, wishes, or strong desires", bonus: "+1 status" }],
  "recognize-spell": [{ targets: [{ kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "against a spell you Recognize (until your next turn)", bonus: "+1 circumstance" }],
  "reflexive-shield": [{ targets: [{ kind: 'save', detail: 'reflex' }], when: "while your shield is Raised", bonus: "+ shield's circumstance bonus" }],
  "reliable-squire": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "to Aid", bonus: "+2 circumstance" }],
  "repositioning-block": [{ targets: [{ kind: 'skill', detail: 'athletics' }], when: "to Reposition after Shield Block (bonus scales with shield level)", bonus: "+1 item (or higher)" }],
  "reptile-rider": [{ targets: [{ kind: 'skill', detail: 'nature' }], when: "to Handle a reptile, dinosaur, or non-sapient dragon", bonus: "+1 circumstance" }],
  "resilient-mind": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against mental effects (+2 vs. undead)", bonus: "+1 circumstance" }],
  "reverse-engineer": [{ targets: [{ kind: 'skill', detail: 'crafting' }], when: "to reverse engineer or disassemble an item", bonus: "+2 circumstance" }],
  "right-hand-blood": [{ targets: [{ kind: 'skill', detail: 'medicine' }], when: "to Administer First Aid, Treat Disease, or Treat Wounds via your blood", bonus: "+1 item" }],
  "risky-surgery": [{ targets: [{ kind: 'skill', detail: 'medicine' }], when: "to Treat Wounds after dealing 1d8 damage to your patient", bonus: "+2 circumstance" }],
  "ritual-researcher": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "on primary and secondary checks to cast a ritual", bonus: "+2 circumstance" }],
  "ritualist-dedication": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "on checks to perform a ritual", bonus: "+2 circumstance" }],
  "rivethun-disciple": [{ targets: [{ kind: 'skill', detail: 'crafting' }, { kind: 'skill', detail: 'deception' }, { kind: 'skill', detail: 'intimidation' }, { kind: 'skill', detail: 'medicine' }], when: "while concentrating on the body-spirit dichotomy", bonus: "+1 circumstance" }],
  "rough-rider": [{ targets: [{ kind: 'skill', detail: 'nature' }], when: "to Command a goblin dog or wolf mount", bonus: "+1 circumstance" }],
  "round-ears": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate that you aren't a half-elf", bonus: "+4 circumstance" }],
  "sacral-lord": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "Make an Impression on creatures within your claimed territory", bonus: "+1 circumstance" }],
  "sacred-wilds-oath": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "Diplomacy checks against animals", bonus: "+2 circumstance" }],
  "safeguard-soul": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against death, possession, or soul-manipulation effects", bonus: "+2 status" }],
  "scales-of-steel": [{ targets: [{ kind: 'ac' }], when: "while unarmored (Dex cap +3)", bonus: "+1 item (+2 at 5th level)" }],
  "scales-of-the-dragon": [{ targets: [{ kind: 'ac' }], when: "while unarmored (Dex cap +3)", bonus: "+2 item" }],
  "scaly-hide": [{ targets: [{ kind: 'ac' }], when: "while unarmored (Dex cap +3)", bonus: "+1 item (+2 at 5th level)" }],
  "scamper": [{ targets: [{ kind: 'ac' }], when: "against reactions triggered by this movement", bonus: "+2 circumstance" }],
  "scamper-underfoot": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "Tumble Through spaces of Medium or larger enemies", bonus: "+1 circumstance" }],
  "scattering-in-spring": [{ targets: [{ kind: 'ac' }], when: "against the triggering melee attack (Twisting Petal Stance)", bonus: "+2 circumstance" }],
  "scavengers-search": [{ targets: [{ kind: 'perception' }], when: "Seek to locate objects, secret doors, or hazards within 30 feet", bonus: "+2 circumstance" }],
  "scroll-trickster-dedication": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "Trick Magic Item on scrolls", bonus: "+2 circumstance" }],
  "scrutinizing-gaze": [{ targets: [{ kind: 'perception' }], when: "Sense Motive to determine if a creature is undead", bonus: "+2 circumstance" }],
  "seasoned": [{ targets: [{ kind: 'skill', detail: 'crafting' }], when: "Craft food and drink (including elixirs/potions)", bonus: "+1 circumstance (+2 if master)" }],
  "shadowdancer-dedication": [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: "Stealth while in dim light or darkness", bonus: "+2 circumstance" }],
  "shadowplay": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "Tumble Through the opponent's space after a damaging melee Strike", bonus: "+2 circumstance" }],
  "shake-off-the-gods": [{ targets: [{ kind: 'save', detail: 'all' }], when: "new save against a divine effect that required a save", bonus: "+2 status" }],
  "shaped-contaminant": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against inhaled poisons you activate", bonus: "+3 status" }],
  "shield-your-eyes": [{ targets: [{ kind: 'ac' }, { kind: 'save', detail: 'fortitude' }, { kind: 'save', detail: 'reflex' }, { kind: 'save', detail: 'will' }], when: "while shield raised, against light or visual effects", bonus: "+2 circumstance" }],
  "shiny-button-eyes": [{ targets: [{ kind: 'perception' }], when: "against visual illusions", bonus: "+1 circumstance" }],
  "shory-aerialist": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "Maneuver in Flight", bonus: "+2 circumstance" }],
  "sinister-appearance": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate a tiefling version of yourself", bonus: "+2 circumstance" }],
  "skeleton-commander": [{ targets: [{ kind: 'skill', detail: 'religion' }], when: "on Religion checks for Create Undead rituals", bonus: "+2 circumstance" }],
  "slippery-as-an-eel": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "while underwater, to Escape, Squeeze, or Tumble Through", bonus: "+2 circumstance" }],
  "smile-at-failure": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "after a creature's attitude worsens toward you, to Make an Impression on it (1 hr)", bonus: "+2 circumstance (or +1 to initiative if it starts combat)" }],
  "soaring-shape": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }], when: "in a wild/untamed shape that grants an Acrobatics modifier (flight)", bonus: "+1 status" }],
  "social-camouflage": [{ targets: [{ kind: 'skill', detail: 'deception' }], when: "to Impersonate as a resident of a settlement you've stayed in 1+ day", bonus: "+1 circumstance" }],
  "speak-with-bats": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on or Request from bats", bonus: "+2 circumstance" }],
  "speak-with-kindred": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "on Diplomacy checks with plants or fungi of your kind", bonus: "+2 circumstance" }],
  "specialty-crafting": [{ targets: [{ kind: 'skill', detail: 'crafting' }], when: "to Craft items of your chosen specialty", bonus: "+1 circumstance (+2 if master in Crafting)" }],
  "spell-repelling-form": [{ targets: [{ kind: 'save', detail: 'all' }], when: "eidolon's saving throws against magic", bonus: "+1 status" }],
  "spellmaster-dedication": [{ targets: [{ kind: 'skill', detail: 'arcana' }, { kind: 'skill', detail: 'nature' }, { kind: 'skill', detail: 'occultism' }, { kind: 'skill', detail: 'religion' }], when: "to Identify Magic (with a trained skill)", bonus: "+2 circumstance" }],
  "spellmasters-resilience": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against spells and effects of your chosen tradition", bonus: "+1 circumstance" }],
  "spirit-soother": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "to disable haunts", bonus: "+1 circumstance" }],
  "stalwart-song": [{ targets: [{ kind: 'save', detail: 'all' }], when: "on a save vs a fear effect (while in Tenacious Stance)", bonus: "+2 circumstance" }],
  "stone-face": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against fear effects", bonus: "+1 circumstance (also +2 to Will DC vs Demoralize)" }],
  "stone-soul-siblings": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Gather Information from stones", bonus: "+2 circumstance" }],
  "stonemasons-eye": [{ targets: [{ kind: 'perception' }], when: "to notice unusual stonework, or stone/hidden-in-stone traps", bonus: "+2 circumstance" }],
  "story-crooner": [{ targets: [{ kind: 'skill', detail: 'performance' }], when: "when Performing for an audience of strix", bonus: "+1 circumstance" }],
  "strange-script": [{ targets: [{ kind: 'skill', detail: 'arcana' }, { kind: 'skill', detail: 'occultism' }, { kind: 'skill', detail: 'nature' }, { kind: 'skill', detail: 'religion' }], when: "to decipher a coded or ciphered text", bonus: "+2 circumstance" }],
  "straveika": [{ targets: [{ kind: 'perception' }], when: "to Sense Motive", bonus: "+1 circumstance" }],
  "strix-defender": [{ targets: [{ kind: 'skill', detail: 'intimidation' }, { kind: 'skill', detail: 'survival' }, { kind: 'perception' }], when: "vs. humans (Intimidation, Perception, Survival)", bonus: "+1 circumstance" }],
  "stubborn-defiance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against mental effects", bonus: "+1 status" }],
  "sudden-terror": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "Demoralize a creature you were hidden to", bonus: "+2 circumstance" }],
  "supertaster": [{ targets: [{ kind: 'perception' }], when: "Perception to detect alterations/additives in food or drink you consume", bonus: "+2 circumstance" }],
  "survivor-of-desolation": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs. unnatural weather or hazards in blighted/marred regions", bonus: "+2 circumstance" }],
  "swaggering-initiative": [{ targets: [{ kind: 'perception' }], when: "rolling initiative", bonus: "+2 circumstance" }],
  "sweeping-fan-block": [{ targets: [{ kind: 'ac' }], when: "targeted by a ranged attack using ammunition (wielding two fans)", bonus: "+2 circumstance" }],
  "tales-of-the-road": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "Recall Knowledge about a city you've visited", bonus: "+2 circumstance" }],
  "tangle-tongues-wit": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against linguistic effects", bonus: "+2 circumstance" }],
  "telekinetic-slip": [{ targets: [{ kind: 'skill', detail: 'acrobatics' }, { kind: 'skill', detail: 'athletics' }], when: "Escape from being grabbed or restrained", bonus: "+2 status" }],
  "terrain-expertise": [{ targets: [{ kind: 'skill', detail: 'survival' }], when: "Survival in your chosen terrain type", bonus: "+1 circumstance" }],
  "terrifying-resistance": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs. spells of a creature you Demoralized (24 hrs)", bonus: "+1 circumstance" }],
  "thorough-reports": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "Recall Knowledge vs. a creature type you've identified before", bonus: "+2 circumstance" }],
  "thorough-search": [{ targets: [{ kind: 'perception' }], when: "Searching while taking twice as long", bonus: "+2 circumstance" }],
  "tide-hardened": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against cold and water effects", bonus: "+1 circumstance" }],
  "timeless-body": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against poisons and diseases", bonus: "+2 status" }],
  "timeless-nature": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against diseases and primal magic", bonus: "+2 status" }],
  "traces-of-the-divine": [{ targets: [{ kind: 'perception' }, { kind: 'skill', detail: 'survival' }], when: "Seek/Track creatures that can cast divine spells", bonus: "+2 circumstance" }],
  "traditional-resistances": [{ targets: [{ kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "vs. spells/magic of your lineage's tradition (+2 vs. sleep/paralysis)", bonus: "+1 status" }],
  "traditional-ways": [{ targets: [{ kind: 'skill', detail: 'nature' }, { kind: 'skill', detail: 'society' }, { kind: 'save', detail: 'all' }], when: "Nature/Society/Lore about Kyonin or its elves; saves vs. will-forcing enchantment", bonus: "+2 circumstance (skills) / +1 circumstance (saves)" }],
  "trap-finder": [{ targets: [{ kind: 'perception' }, { kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "vs traps: finding them, attacks by traps, and saves against traps", bonus: "+1 (+2 if master in Thievery) circumstance" }],
  "tricksterbane-oath": [{ targets: [{ kind: 'perception' }, { kind: 'skill', detail: 'society' }], when: "detecting a shapechanger's disguise; +2 to Recall Knowledge about shapechangers", bonus: "+4 circumstance (Perception); +2 circumstance (RK)" }],
  "truespeech": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "speaking to creatures you already share a language with (while Truespeech is active)", bonus: "+1 status" }],
  "twitchy": [{ targets: [{ kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "against hazards", bonus: "+1 circumstance" }],
  "unassuming-dedication": [{ targets: [{ kind: 'skill', detail: 'all' }], when: "performing a downtime activity", bonus: "+1 circumstance" }],
  "undaunted": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against emotion effects", bonus: "+1 circumstance" }],
  "undead-spotter": [{ targets: [{ kind: 'skill', detail: 'religion' }], when: "Recall Knowledge about undead, or to determine if a creature is undead", bonus: "+1 circumstance" }],
  "unshakable-idealism": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against fear effects and emotion effects that inflict despair", bonus: "+1 circumstance" }],
  "vessels-form": [{ targets: [{ kind: 'save', detail: 'all' }], when: "for 1 minute in your hybrid form", bonus: "+2 status" }],
  "vindicator-dedication": [{ targets: [{ kind: 'skill', detail: 'religion' }], when: "the target worships your deity or is your hunted prey (using Religion for social skills)", bonus: "+2 circumstance" }],
  "virtuosic-dancer": [{ targets: [{ kind: 'skill', detail: 'performance' }], when: "you Perform a dance, acting, or opera performance", bonus: "+1 (+2 if legendary in Acrobatics) circumstance" }],
  "virtuosic-performer": [{ targets: [{ kind: 'skill', detail: 'performance' }], when: "performing your chosen specialty", bonus: "+1 (+2 if master in Performance) circumstance" }],
  "voice-of-the-elements": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "Make an Impression on creatures with the elemental trait", bonus: "+1 circumstance" }],
  "voice-of-the-night": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on bats, rats, or wolves", bonus: "+1 circumstance" }],
  "ward-against-corruption": [{ targets: [{ kind: 'save', detail: 'all' }], when: "vs death effects, disease, and effects from undead or sahkils (+2 vs their death effect or disease)", bonus: "+1 circumstance (+2)" }],
  "warren-friend": [{ targets: [{ kind: 'skill', detail: 'society' }, { kind: 'skill', detail: 'all' }], when: "to Gather Information and Earn Income in a settlement where you've contacted the ratfolk enclave", bonus: "+1 circumstance" }],
  "wary-disarmament": [{ targets: [{ kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "against a device or trap you set off while disarming it", bonus: "+2 circumstance" }],
  "watchful-halfling": [{ targets: [{ kind: 'perception' }], when: "to Sense Motive to notice an enchanted or possessed character", bonus: "+2 circumstance" }],
  "waxed-feathers": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects with the water trait", bonus: "+1 circumstance" }],
  "web-walker": [{ targets: [{ kind: 'ac' }, { kind: 'save', detail: 'all' }], when: "vs webbing effects (+2); vs other snare/entangle effects (+1)", bonus: "+2 / +1 circumstance" }],
  "well-groomed": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against diseases (success becomes a critical success)", bonus: "+2 circumstance" }],
  "well-versed": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against auditory, illusion, linguistic, sonic, or visual effects", bonus: "+1 circumstance" }],
  "wild-speech": [{ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: "to Make an Impression on animals (requires Animal Empathy)", bonus: "+1 circumstance" }],
  "wilderness-born": [{ targets: [{ kind: 'skill', detail: 'stealth' }, { kind: 'skill', detail: 'survival' }], when: "to Hide, Sneak, and Sense Direction in natural terrain", bonus: "+1 circumstance" }],
  "wind-tempered": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against air and electricity effects (air-effect success becomes critical success)", bonus: "+1 circumstance" }],
  "winters-embrace": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against effects that inflict the dazzled condition", bonus: "+1 status" }],
  "witch-warden": [{ targets: [{ kind: 'save', detail: 'all' }], when: "against curses, and vs spells cast by a witch or hag", bonus: "+1 circumstance" }],
  "you-seem-somewhat-familiar": [{ targets: [{ kind: 'save', detail: 'all' }, { kind: 'attack' }], when: "your next attack, damage, or save after succeeding at Recall Knowledge about a creature", bonus: "+2 circumstance" }],
  "youre-next": [{ targets: [{ kind: 'skill', detail: 'intimidation' }], when: "to Demoralize a creature within 60 ft after reducing an enemy to 0 HP", bonus: "+2 circumstance" }],
  "youre-so-cute": [{ targets: [{ kind: 'skill', detail: 'performance' }], when: "to Make an Impression with Performance on humanoids", bonus: "+1 circumstance" }],
  "zephyr-guard-dedication": [{ targets: [{ kind: 'perception' }], when: "against Palm an Object, Steal, or Conceal an Object (and Seeking concealed objects)", bonus: "+1 circumstance" }],
};

/** Does a StatRef-like target match a registry target? `all` matches any of that kind. */
function targetMatches(t: SituationalTarget, ref: { kind: string; skill?: string; save?: string }): boolean {
  switch (t.kind) {
    case 'skill':
      return ref.kind === 'skill' && (t.detail === 'all' || t.detail === ref.skill);
    case 'save':
      return ref.kind === 'save' && (t.detail === 'all' || t.detail === ref.save);
    case 'perception':
      return ref.kind === 'perception';
    case 'ac':
      return ref.kind === 'ac';
    case 'attack':
      return ref.kind === 'strikeAttack';
    default:
      return false;
  }
}

/** The situational bonuses a character's taken feats grant to the given stat (empty if none). */
export function featSituationalFor(
  featIds: Iterable<string>,
  ref: { kind: string; skill?: string; save?: string },
): { id: string; when: string; bonus: string }[] {
  const out: { id: string; when: string; bonus: string }[] = [];
  const seen = new Set<string>();
  for (const id of featIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const b of FEAT_SITUATIONAL[id] ?? []) {
      if (b.targets.some((t) => targetMatches(t, ref))) out.push({ id, when: b.when, bonus: b.bonus });
    }
  }
  return out;
}

/** Whether any taken feat grants a situational bonus to this stat (drives the `*` cue). */
export function hasFeatSituational(featIds: Iterable<string>, ref: { kind: string; skill?: string; save?: string }): boolean {
  for (const id of featIds) {
    for (const b of FEAT_SITUATIONAL[id] ?? []) {
      if (b.targets.some((t) => targetMatches(t, ref))) return true;
    }
  }
  return false;
}
