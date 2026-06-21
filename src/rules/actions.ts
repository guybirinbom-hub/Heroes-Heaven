import type { ActionCost } from './types';

/** A universal / skill action (encounter) or an exploration / downtime activity. */
export interface ActivityDef {
  name: string;
  mode: 'encounter' | 'exploration' | 'downtime';
  /** Action cost for encounter actions; omitted for exploration / downtime activities. */
  cost?: ActionCost;
  /** Governing skill, if it's a skill action. */
  skill?: string;
  traits?: string[];
  desc: string;
}

const A1: ActionCost = { type: 'actions', value: 1 };
const A2: ActionCost = { type: 'actions', value: 2 };
const FREE: ActionCost = { type: 'free' };
const REACT: ActionCost = { type: 'reaction' };
const VAR: ActionCost = { type: 'variable', min: 1, max: 3 };

/**
 * Curated universal + skill actions (encounter) and exploration / downtime activities,
 * compiled + cross-checked against PF2e Player Core via a workflow. The Main tab filters
 * this by the selected play mode; feat-granted actions are added from the character.
 */
export const ACTIVITIES: ActivityDef[] = [
  // ── Encounter — universal / basic actions ──
  { name: 'Strike', mode: 'encounter', cost: A1, traits: ['attack'], desc: 'Make a melee or ranged attack roll against a target, dealing weapon or unarmed damage on a hit.' },
  { name: 'Stride', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Move up to your Speed across the ground.' },
  { name: 'Step', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Carefully move 5 feet without triggering reactions such as Attacks of Opportunity.' },
  { name: 'Leap', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Jump horizontally up to 10 feet (15 with a high enough Speed) or 3 feet vertically without risking a fall.' },
  { name: 'Crawl', mode: 'encounter', cost: A1, traits: ['move'], desc: 'While prone, move 5 feet by crawling.' },
  { name: 'Drop Prone', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Throw yourself to the ground, gaining the prone condition.' },
  { name: 'Stand', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Rise from prone, removing the prone condition.' },
  { name: 'Take Cover', mode: 'encounter', cost: A1, desc: 'Press against cover or hunker down to gain greater cover (or cover if you had none) for a better AC and Reflex bonus.' },
  { name: 'Raise a Shield', mode: 'encounter', cost: A1, desc: "Position a wielded shield to gain its circumstance bonus to AC until your next turn." },
  { name: 'Interact', mode: 'encounter', cost: A1, traits: ['manipulate'], desc: 'Manipulate an object — draw or stow an item, open a door, pick something up, and so on.' },
  { name: 'Release', mode: 'encounter', cost: FREE, traits: ['manipulate'], desc: "Release something you're holding (drop an item, let go of a grabbed creature) without triggering reactions." },
  { name: 'Ready', mode: 'encounter', cost: A2, traits: ['concentrate'], desc: 'Prepare a single action or free action to be taken later as a reaction when a trigger you specify occurs.' },
  { name: 'Delay', mode: 'encounter', cost: FREE, desc: 'At the start of your turn, wait and reorder yourself to a later point in the initiative order.' },
  { name: 'Recover', mode: 'encounter', cost: FREE, desc: 'While dying, attempt a recovery flat check at the start of your turn to reduce your dying value (or worsen it on a failure).' },
  { name: 'Aid', mode: 'encounter', cost: REACT, traits: ['concentrate'], desc: 'After preparing on a prior turn, attempt a DC 15 check to grant an ally a circumstance bonus to a triggering check.' },
  { name: 'Seek', mode: 'encounter', cost: A1, skill: 'Perception', traits: ['concentrate', 'secret'], desc: 'Perception check to find hidden or undetected creatures, or to search an area or object.' },
  { name: 'Point Out', mode: 'encounter', cost: A1, traits: ['auditory', 'manipulate', 'visual'], desc: 'Indicate an undetected or hidden creature to allies, making it merely hidden to them instead.' },
  { name: 'Sense Motive', mode: 'encounter', cost: A1, skill: 'Perception', traits: ['concentrate', 'secret'], desc: "Perception vs. a creature's Deception DC to gauge whether it's being honest or acting oddly." },
  { name: 'Recall Knowledge', mode: 'encounter', cost: A1, skill: 'Lore', traits: ['concentrate', 'secret'], desc: 'Skill check (Arcana, Nature, Religion, Society, Lore, etc.) to remember useful information about a creature, place, or topic.' },
  { name: 'Sustain', mode: 'encounter', cost: A1, traits: ['concentrate'], desc: 'Maintain a spell or effect with a sustained duration for another round, sometimes altering its area or targets.' },
  { name: 'Dismiss', mode: 'encounter', cost: A1, traits: ['concentrate'], desc: 'End a spell, effect, or item with a duration that can be dismissed.' },
  { name: 'Cast a Spell', mode: 'encounter', cost: VAR, desc: "Cast a spell by performing its components; the action cost is set by the spell." },
  { name: 'Activate an Item', mode: 'encounter', cost: VAR, desc: "Use an item's activated ability, performing the required components to produce its effect." },
  { name: 'Escape', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: 'Unarmed attack, Athletics, or Acrobatics check to free yourself from grabbed, immobilized, or restrained.' },
  { name: 'Mount', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Climb onto and ride a willing or controlled creature at least one size larger than you.' },
  { name: 'Command an Animal', mode: 'encounter', cost: A1, skill: 'Nature', traits: ['auditory', 'concentrate'], desc: "Nature check to direct an animal you're handling to use one or two of its actions." },
  { name: 'Fly', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Using a fly Speed, move up to that Speed through the air in any direction.' },
  { name: 'Burrow', mode: 'encounter', cost: A1, traits: ['move'], desc: 'Using a burrow Speed, tunnel through dirt, sand, or other loose material up to that Speed.' },
  { name: 'Arrest a Fall', mode: 'encounter', cost: REACT, skill: 'Acrobatics', desc: 'While falling, attempt a DC 15 Acrobatics check to slow your descent and reduce falling damage.' },
  { name: 'Grab an Edge', mode: 'encounter', cost: REACT, traits: ['manipulate'], desc: 'When you would fall past a ledge, attempt a Reflex save (not a skill) to catch yourself and become hanging instead.' },
  { name: 'Avert Gaze', mode: 'encounter', cost: A1, traits: ['concentrate'], desc: 'Avert your eyes from visual effects, gaining +2 circumstance to saves against them until your next turn.' },

  // ── Encounter — skill actions ──
  { name: 'Grapple', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: 'Athletics vs. Fortitude DC to grab a creature, making it grabbed or restrained.' },
  { name: 'Shove', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: 'Athletics vs. Fortitude DC to push a creature up to 5 feet away (10 on a crit).' },
  { name: 'Trip', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: 'Athletics vs. Reflex DC to knock a creature prone.' },
  { name: 'Disarm', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: "Athletics vs. Reflex DC to knock an item from a creature's grasp or weaken its grip." },
  { name: 'Reposition', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: 'Athletics vs. Fortitude DC to move a creature you are grabbing or restraining to another spot within reach.' },
  { name: 'High Jump', mode: 'encounter', cost: A2, skill: 'Athletics', traits: ['move'], desc: 'Stride then make an Athletics check to leap vertically farther than normal.' },
  { name: 'Long Jump', mode: 'encounter', cost: A2, skill: 'Athletics', traits: ['move'], desc: 'Stride then make an Athletics check to leap horizontally farther than your Speed allows.' },
  { name: 'Climb', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['move'], desc: 'Athletics check to move up, down, or across an incline.' },
  { name: 'Swim', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['move'], desc: 'Athletics check to move through water.' },
  { name: 'Force Open', mode: 'encounter', cost: A1, skill: 'Athletics', traits: ['attack'], desc: 'Athletics check to break open a door, lock, container, or similar obstacle by force.' },
  { name: 'Tumble Through', mode: 'encounter', cost: A1, skill: 'Acrobatics', traits: ['move'], desc: "Acrobatics vs. an enemy's Reflex DC to move through its space as difficult terrain." },
  { name: 'Balance', mode: 'encounter', cost: A1, skill: 'Acrobatics', traits: ['move'], desc: 'Acrobatics check to move across narrow surfaces or uneven ground while keeping your footing.' },
  { name: 'Maneuver in Flight', mode: 'encounter', cost: A1, skill: 'Acrobatics', traits: ['move'], desc: 'Acrobatics check to perform a difficult aerial maneuver while flying.' },
  { name: 'Hide', mode: 'encounter', cost: A1, skill: 'Stealth', traits: ['secret'], desc: "Stealth vs. observers' Perception DCs to become hidden while you have cover or concealment." },
  { name: 'Sneak', mode: 'encounter', cost: A1, skill: 'Stealth', traits: ['move', 'secret'], desc: "Stealth check to move up to your Speed while staying undetected by creatures you're hidden from." },
  { name: 'Conceal an Object', mode: 'encounter', cost: A1, skill: 'Stealth', traits: ['manipulate', 'secret'], desc: "Stealth vs. Perception DCs to hide a small object on your person." },
  { name: 'Feint', mode: 'encounter', cost: A1, skill: 'Deception', traits: ['mental'], desc: "Deception vs. an adjacent foe's Perception DC to make it off-guard against your melee attacks until your next turn." },
  { name: 'Create a Diversion', mode: 'encounter', cost: A1, skill: 'Deception', traits: ['mental'], desc: 'Deception vs. Perception DCs using a gesture, trick, or false words to immediately Hide from those you fool.' },
  { name: 'Demoralize', mode: 'encounter', cost: A1, skill: 'Intimidation', traits: ['auditory', 'concentrate', 'emotion', 'fear', 'mental'], desc: "Intimidation vs. a creature's Will DC to make it frightened 1 (2 on a crit)." },
  { name: 'Bon Mot', mode: 'encounter', cost: A1, skill: 'Diplomacy', traits: ['auditory', 'concentrate', 'emotion', 'linguistic', 'mental'], desc: 'A feat-granted Diplomacy check vs. Will DC to penalize the target’s Perception and Will saves.' },
  { name: 'Request', mode: 'encounter', cost: A1, skill: 'Diplomacy', traits: ['auditory', 'concentrate', 'linguistic', 'mental'], desc: "Diplomacy vs. a creature's Will DC to ask it to do something." },
  { name: 'Administer First Aid', mode: 'encounter', cost: A2, skill: 'Medicine', traits: ['manipulate'], desc: 'Medicine check to stabilize a dying adjacent creature or stop its persistent bleed damage.' },
  { name: 'Battle Medicine', mode: 'encounter', cost: A1, skill: 'Medicine', traits: ['healing', 'manipulate'], desc: 'A feat-granted Medicine check to restore HP to yourself or an adjacent ally in combat.' },
  { name: 'Treat Poison', mode: 'encounter', cost: A1, skill: 'Medicine', traits: ['manipulate'], desc: "Medicine check to grant a poisoned adjacent creature a bonus to its next save against the poison." },
  { name: 'Perform', mode: 'encounter', cost: A1, skill: 'Performance', traits: ['concentrate'], desc: 'A single-action Performance check (a quick flourish) used by some feats and class features.' },
  { name: 'Steal', mode: 'encounter', cost: A1, skill: 'Thievery', traits: ['manipulate'], desc: "Thievery vs. Perception DC to take an object from a creature's person without being noticed." },
  { name: 'Palm an Object', mode: 'encounter', cost: A1, skill: 'Thievery', traits: ['manipulate'], desc: 'Thievery vs. Perception DCs to pick up and conceal an unattended small object without being seen.' },
  { name: 'Disable a Device', mode: 'encounter', cost: A2, skill: 'Thievery', traits: ['manipulate'], desc: 'Thievery vs. a device or trap’s DC to disarm or disable it (some devices need multiple successes).' },

  // ── Exploration activities ──
  { name: 'Avoid Notice', mode: 'exploration', skill: 'Stealth', traits: ['exploration'], desc: 'Travel at half Speed making a Stealth check to avoid notice; also sets your initiative if combat begins.' },
  { name: 'Defend', mode: 'exploration', traits: ['exploration'], desc: 'Travel at half Speed with your shield raised, gaining Raise a Shield before your first turn if combat starts.' },
  { name: 'Detect Magic', mode: 'exploration', traits: ['concentrate', 'exploration'], desc: 'Cast detect magic at intervals while moving at half Speed to spot magical auras before the party reaches them.' },
  { name: 'Follow the Expert', mode: 'exploration', traits: ['auditory', 'concentrate', 'exploration', 'visual'], desc: "Match an ally's effort at a skill they're trained in, adding a bonus to your own checks while you can perceive them." },
  { name: 'Hustle', mode: 'exploration', traits: ['exploration', 'move'], desc: 'Travel at double your travel Speed for minutes equal to 10 × your Con modifier (minimum 10).' },
  { name: 'Investigate', mode: 'exploration', traits: ['concentrate', 'exploration'], desc: 'Travel at half Speed pursuing a line of inquiry, attempting secret Recall Knowledge checks as you go.' },
  { name: 'Repeat a Spell', mode: 'exploration', traits: ['concentrate', 'exploration'], desc: "Recast the same single-action spell each round so it's active when combat begins, moving at half Speed." },
  { name: 'Scout', mode: 'exploration', traits: ['concentrate', 'exploration'], desc: 'Move at half Speed scouting ahead and behind, granting everyone a +1 circumstance bonus to initiative.' },
  { name: 'Search', mode: 'exploration', skill: 'Perception', traits: ['concentrate', 'exploration'], desc: 'Travel at half Speed making Perception checks to find hidden creatures, doors, hazards, or objects.' },
  { name: 'Track', mode: 'exploration', skill: 'Survival', traits: ['concentrate', 'exploration', 'move'], desc: 'Move at half Speed following a trail, attempting Survival checks to keep tracking your quarry.' },
  { name: 'Cover Tracks', mode: 'exploration', skill: 'Survival', traits: ['concentrate', 'exploration', 'move'], desc: 'Move at up to half travel Speed obscuring your trail so others must beat your Survival DC to Track you.' },
  { name: 'Sustain an Effect', mode: 'exploration', traits: ['concentrate', 'exploration'], desc: 'Extend an ongoing spell or effect while traveling rather than in an encounter.' },
  { name: 'Refocus', mode: 'exploration', traits: ['exploration'], desc: 'Spend 10 minutes meditating, praying, or practicing to recover 1 Focus Point.' },
  { name: 'Treat Wounds', mode: 'exploration', skill: 'Medicine', traits: ['exploration', 'healing', 'manipulate'], desc: 'Spend 10 minutes on a Medicine check to restore HP and remove the wounded condition (then the target is briefly immune).' },
  { name: 'Borrow an Arcane Spell', mode: 'exploration', skill: 'Arcana', traits: ['concentrate', 'exploration'], desc: "Study another caster's spellbook to prepare an arcane spell from it that you don't already know." },
  { name: 'Decipher Writing', mode: 'exploration', skill: 'Arcana', traits: ['concentrate', 'exploration', 'secret'], desc: 'Spend time on a check (Arcana, Occultism, Religion, or Society) to understand archaic, coded, or esoteric text.' },
  { name: 'Identify Magic', mode: 'exploration', skill: 'Arcana', traits: ['concentrate', 'exploration', 'secret'], desc: 'Spend 10 minutes per item on the matching tradition skill to learn what a magical aura is and does.' },
  { name: 'Learn a Spell', mode: 'exploration', skill: 'Arcana', traits: ['concentrate', 'exploration'], desc: 'Study a spell of your tradition, spending time + materials, then attempt a skill check to add it to your spellbook or repertoire.' },
  { name: 'Identify Alchemy', mode: 'exploration', skill: 'Crafting', traits: ['concentrate', 'exploration', 'secret'], desc: "Spend 10 minutes with alchemist's tools on a Crafting check to identify an alchemical item and how to activate it." },
  { name: 'Repair', mode: 'exploration', skill: 'Crafting', traits: ['exploration', 'manipulate'], desc: 'Spend 10 minutes with a repair kit on a Crafting check to restore HP to a damaged item or shield.' },
  { name: 'Subsist', mode: 'exploration', skill: 'Survival', traits: ['exploration'], desc: 'Spend a day on a Survival (wild) or Society (settlement) check to find food and shelter.' },
  { name: 'Sense Direction', mode: 'exploration', skill: 'Survival', traits: ['exploration', 'secret'], desc: 'Spend about an hour on a Survival check to figure out where you are or what direction you face.' },
  { name: 'Squeeze', mode: 'exploration', skill: 'Acrobatics', traits: ['exploration', 'move'], desc: 'Acrobatics check to contort through a space too small to walk through, at greatly reduced speed.' },
  { name: 'Pick a Lock', mode: 'exploration', skill: 'Thievery', traits: ['exploration', 'manipulate'], desc: 'Thievery check (with thieves’ tools) over time to open a lock without its key.' },
  { name: 'Lie', mode: 'exploration', skill: 'Deception', traits: ['auditory', 'concentrate', 'exploration', 'linguistic', 'mental', 'secret'], desc: "Deception vs. listeners' Perception DCs to convince them of a falsehood during a conversation." },
  { name: 'Impersonate', mode: 'exploration', skill: 'Deception', traits: ['concentrate', 'exploration', 'manipulate', 'secret'], desc: 'Don a disguise and make a Deception check vs. observers’ Perception to pass yourself off as someone else.' },
  { name: 'Make an Impression', mode: 'exploration', skill: 'Diplomacy', traits: ['auditory', 'concentrate', 'exploration', 'linguistic', 'mental'], desc: 'Spend ~1 minute of conversation on a Diplomacy check vs. Will DC to improve a creature’s attitude toward you.' },
  { name: 'Gather Information', mode: 'exploration', skill: 'Diplomacy', traits: ['exploration', 'secret'], desc: 'Spend time in a settlement on a Diplomacy check to learn about a person, place, or thing from locals.' },
  { name: 'Coerce', mode: 'exploration', skill: 'Intimidation', traits: ['auditory', 'concentrate', 'emotion', 'exploration', 'linguistic', 'mental'], desc: 'Spend ~1 minute threatening a creature on an Intimidation check vs. Will DC to make it bend to your demands.' },

  // ── Downtime activities ──
  { name: 'Craft', mode: 'downtime', skill: 'Crafting', traits: ['manipulate'], desc: "Spend days making an item from materials worth half its Price via a Crafting check, then pay off the rest." },
  { name: 'Earn Income', mode: 'downtime', skill: 'Crafting', desc: 'Use a skill (Crafting, Lore, Performance, …) over days to do paid work, earning income based on a level-DC check.' },
  { name: 'Retrain', mode: 'downtime', desc: 'Spend a week or more (often with a teacher) to swap a feat, skill increase, or similar choice for a legal alternative.' },
  { name: 'Treat Disease', mode: 'downtime', skill: 'Medicine', traits: ['manipulate'], desc: 'Spend 8+ hours tending a diseased creature on a Medicine check to grant a bonus to its next save against it.' },
  { name: 'Subsist', mode: 'downtime', skill: 'Survival', desc: 'Spend a day on a Survival (or Society in a settlement) check to provide your own food and shelter.' },
  { name: 'Long-Term Rest', mode: 'downtime', desc: 'Spend a full day and night resting to recover twice your normal daily Hit Points.' },
  { name: 'Learn a Spell', mode: 'downtime', skill: 'Arcana', traits: ['concentrate'], desc: 'Spend time + materials by the spell’s rank on a tradition skill check to add a spell to your spellbook or repertoire.' },
  { name: 'Recover (Bed Rest)', mode: 'downtime', desc: 'Spend full days resting in bed to recover from drained, doomed, or wounded and regain HP faster than normal.' },
  { name: 'Research', mode: 'downtime', traits: ['concentrate', 'secret'], desc: 'Spend days studying a library or source, attempting daily checks to accumulate knowledge on a topic.' },
];
