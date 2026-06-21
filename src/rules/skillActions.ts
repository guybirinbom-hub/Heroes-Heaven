/*
 * Per-skill action lists for the stat detail panel — "what can I do with this skill",
 * filtered to the character's proficiency. Authored + verified against the PF2e remaster
 * (scripts via the pf2e-skill-actions workflow). Keyed by skill id (+ 'perception', 'lore').
 */
import type { ProficiencyRank } from './types';

export interface SkillAction {
  name: string;
  /** Action cost shown as a chip: "1 action", "reaction", "10 minutes", "downtime", … */
  costText?: string;
  /** Minimum proficiency in the skill needed to use it at all. */
  minRank: ProficiencyRank;
  /** True when it needs a specific feat (Battle Medicine, Bon Mot, …), not mere proficiency. */
  feat?: boolean;
  featName?: string;
  desc: string;
  /** Proficiency-gated upgrades to the SAME action (e.g. Treat Wounds higher DCs). */
  tiers?: { rank: ProficiencyRank; note: string }[];
}

const ORDER: ProficiencyRank[] = ['untrained', 'trained', 'expert', 'master', 'legendary'];
export const rankAtLeast = (have: ProficiencyRank, need: ProficiencyRank) => ORDER.indexOf(have) >= ORDER.indexOf(need);

export const SKILL_ACTIONS: Record<string, SkillAction[]> = {
  "acrobatics": [
    {
      "name": "Balance",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Move across a narrow surface or uneven ground with an Acrobatics check against the surface's Balance DC; you're off-guard while balancing. Success lets you move up to your Speed as difficult terrain, and a critical failure means you fall and your turn ends."
    },
    {
      "name": "Tumble Through",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Stride up to your Speed and attempt to move through one enemy's space, rolling Acrobatics vs. its Reflex DC. On a success you pass through (treating its space as difficult terrain); on a failure your movement ends and you trigger reactions as if leaving your starting square."
    },
    {
      "name": "Maneuver in Flight",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "While flying, attempt a tricky aerial maneuver such as a steep ascent or reversing direction with an Acrobatics check against a GM-set DC. Requires a fly Speed."
    },
    {
      "name": "Squeeze",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Contort through a space barely large enough to fit, attempting an Acrobatics check vs. the Squeeze DC. Success moves you through at 1 minute per 5 feet (1 minute per 10 feet on a critical success); a critical failure leaves you stuck. This is an exploration activity."
    },
    {
      "name": "Escape",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt to break free of the grabbed, immobilized, or restrained condition, rolling against the effect's DC. You may use your unarmed attack modifier, Acrobatics, or Athletics; success removes those conditions from the chosen source."
    },
    {
      "name": "Cat Fall",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Cat Fall",
      "desc": "Treat falls as 10 feet shorter, reducing fall damage. The reduction scales with proficiency (25 feet expert, 50 feet master), and a legendary acrobat always lands on their feet and takes no fall damage.",
      "tiers": [
        {
          "rank": "trained",
          "note": "Treat falls as 10 feet shorter."
        },
        {
          "rank": "expert",
          "note": "Treat falls as 25 feet shorter."
        },
        {
          "rank": "master",
          "note": "Treat falls as 50 feet shorter."
        },
        {
          "rank": "legendary",
          "note": "Always land on your feet and take no damage from any fall."
        }
      ]
    },
    {
      "name": "Steady Balance",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Steady Balance",
      "desc": "When you roll a success to Balance, you get a critical success instead, and you're not made off-guard while balancing. Triggered when you roll a success at a Balance check."
    },
    {
      "name": "Kip Up",
      "costText": "free",
      "minRank": "master",
      "feat": true,
      "featName": "Kip Up",
      "desc": "Stand up immediately as a free action without triggering reactions. Requires master proficiency in Acrobatics."
    }
  ],
  "arcana": [
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt an Arcana check (DC set by the GM, usually by the subject's level and rarity) to remember a fact about arcane theory, magical traditions, constructs and creatures of the arcane, and the planes tied to the Arcane. A critical success gives extra context or a follow-up answer; a critical failure gives false information."
    },
    {
      "name": "Decipher Writing",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Spend (typically) 1 minute per page to understand complex writing about magic or science, attempting an Arcana check against a GM-set DC. On a failure you take a -2 circumstance penalty to further attempts to decipher it; on a critical failure you misconstrue the text's meaning."
    },
    {
      "name": "Identify Magic",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "Spend 10 minutes studying an item, location, or ongoing effect already known to be magical and attempt an Arcana check (GM-set DC) to learn what arcane magic does and how to activate it. A critical success also reveals its name and whether it's cursed; a failure means you can't try again for 1 day."
    },
    {
      "name": "Learn a Spell",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Spend 1 hour per spell rank plus the listed material cost, then attempt an Arcana check to add an arcane spell to your repertoire or spellbook (typical DC 15 at 1st rank/cantrip up to 41 at 10th). A critical success expends only half the materials; on a failure the materials aren't expended and you can retry after gaining a level."
    },
    {
      "name": "Borrow an Arcane Spell",
      "costText": "varies",
      "minRank": "trained",
      "desc": "If you're an arcane spellcaster who prepares from a spellbook, attempt an Arcana check (GM-set DC by rank and rarity, usually a bit easier than Learn a Spell) to prepare a spell from someone else's spellbook during your daily preparation. On a failure the slot stays open for another spell and you can't retry until you next prepare."
    },
    {
      "name": "Recognize Spell",
      "costText": "reaction",
      "minRank": "trained",
      "feat": true,
      "featName": "Recognize Spell",
      "desc": "Trigger: a creature within line of sight casts a spell you don't have prepared or in your repertoire. You automatically identify common arcane spells of rank 2 or lower (4 if expert, 6 if master, 10 if legendary), rolling only to try for a critical success; the GM rolls a secret Arcana check. A critical success grants a +1 circumstance bonus to your AC or save against it."
    },
    {
      "name": "Quick Identification",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Quick Identification",
      "desc": "You Identify Magic (using Arcana) in 1 minute instead of 10. If you're a master it becomes a 3-action activity, and if you're legendary it takes a single action."
    }
  ],
  "athletics": [
    {
      "name": "Climb",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "With both hands free, attempt an Athletics check (GM sets DC by the surface) to move up to 5 feet up, down, or across an incline (more with high Speed). You're off-guard while climbing without a climb Speed, and on a critical failure you fall."
    },
    {
      "name": "Swim",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt an Athletics check (GM sets DC by turbulence; calm water is an automatic critical success) to move up to 10 feet through water, more with high Speed. Critical failure makes no progress and costs a round of held breath."
    },
    {
      "name": "High Jump",
      "costText": "2 actions",
      "minRank": "untrained",
      "desc": "Stride, then attempt a DC 30 Athletics check to leap vertically (auto-fail if you didn't Stride 10 feet); success leaps 5 ft up, critical success 8 ft up and 10 ft horizontal. Failure is a normal Leap; critical failure leaves you prone."
    },
    {
      "name": "Long Jump",
      "costText": "2 actions",
      "minRank": "untrained",
      "desc": "Stride, then attempt a DC 15 Athletics check to leap horizontally up to your check result rounded down to 5 ft (max your Speed; auto-fail if you didn't Stride 10 feet). Failure is a normal Leap; critical failure ends prone."
    },
    {
      "name": "Force Open",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt an Athletics check to force open a door, window, container, or gate (or smash a wall); without a crowbar you take a -2 item penalty. Critical failure jams it shut for a -2 circumstance penalty on future attempts."
    },
    {
      "name": "Grapple",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "With a free hand (or while already grabbing it), attempt an Athletics check vs the target's Fortitude DC to grab a creature at most one size larger. Success grabs it, critical success restrains it (until the end of your next turn); critical failure lets it grab you or knock you prone."
    },
    {
      "name": "Shove",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "With a free hand, attempt an Athletics check vs the target's Fortitude DC to push a creature (at most one size larger) back 5 feet, or 10 on a critical success; you may Stride after it. Critical failure leaves you prone."
    },
    {
      "name": "Trip",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "With a free hand, attempt an Athletics check vs the target's Reflex DC to knock a creature (at most one size larger) prone; critical success also deals 1d6 bludgeoning damage. Critical failure leaves you prone."
    },
    {
      "name": "Disarm",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "With a free hand, attempt an Athletics check vs the target's Reflex DC; critical success knocks an item from its grasp, while a success weakens its grip (-2 to attacks/checks with it, +2 to your further Disarms). Critical failure makes you off-guard."
    },
    {
      "name": "Reposition",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "With a free hand or while grabbing the target (at most one size larger), attempt an Athletics check vs its Fortitude DC to move it 5 feet, or 10 on a critical success, keeping it within reach. Critical failure lets it reposition you 5 feet."
    },
    {
      "name": "Escape",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "When grabbed, restrained, or otherwise immobilized, attempt an Athletics check (you may also use Acrobatics or an unarmed attack modifier) vs the DC of the effect to free yourself. Success ends the condition; critical success also lets you step."
    },
    {
      "name": "Titan Wrestler",
      "costText": "passive",
      "minRank": "trained",
      "feat": true,
      "featName": "Titan Wrestler",
      "desc": "A skill feat letting you Disarm, Grapple, Reposition, Shove, or Trip creatures up to two sizes larger than you (three if you're legendary in Athletics)."
    }
  ],
  "crafting": [
    {
      "name": "Craft",
      "costText": "downtime",
      "minRank": "trained",
      "desc": "Spend 2 days (or 1 with the formula) setting up, then attempt a Crafting check against a level-based DC to make an item of your level or lower from raw materials worth at least half its Price. On a success you finish by paying the rest of the Price, or reduce that cost with extra downtime days.",
      "tiers": [
        {
          "rank": "trained",
          "note": "Craft items of your level or lower (an item without a level counts as level 0)."
        },
        {
          "rank": "master",
          "note": "Required to craft items of level 9 or higher."
        },
        {
          "rank": "legendary",
          "note": "Required to craft items of level 17 or higher."
        }
      ]
    },
    {
      "name": "Repair",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "While holding a repair toolkit, spend 10 minutes fixing a damaged (not destroyed) item against a GM-set DC, usually equal to its Craft DC. Restores Hit Points scaling with your Crafting proficiency; on a critical failure you instead deal 2d6 damage (reduced by Hardness) to the item.",
      "tiers": [
        {
          "rank": "trained",
          "note": "Restores 10 HP on a success (20 HP on a critical success)."
        },
        {
          "rank": "expert",
          "note": "Restores 15 HP on a success (30 HP on a critical success)."
        },
        {
          "rank": "master",
          "note": "Restores 20 HP on a success (40 HP on a critical success)."
        },
        {
          "rank": "legendary",
          "note": "Restores 25 HP on a success (50 HP on a critical success)."
        }
      ]
    },
    {
      "name": "Earn Income",
      "costText": "downtime",
      "minRank": "trained",
      "desc": "During downtime, Craft common goods for the market, attempting a Crafting check against a GM-set DC for a task of the chosen level. Earnings come from the Income Earned table based on the task level and your proficiency rank.",
      "tiers": [
        {
          "rank": "trained",
          "note": "Earn the trained rate from the Income Earned table for the task level."
        },
        {
          "rank": "expert",
          "note": "Earn the higher expert rate for the task level."
        },
        {
          "rank": "master",
          "note": "Earn the higher master rate for the task level."
        },
        {
          "rank": "legendary",
          "note": "Earn the highest legendary rate for the task level."
        }
      ]
    },
    {
      "name": "Identify Alchemy",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "While holding an alchemist's toolkit, spend 10 minutes testing an alchemical item (a secret Crafting check vs its level-based DC) to learn its nature and how to activate it. On a failure you can try again; on a critical failure you misidentify it as another item."
    },
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a Crafting check against a GM-set DC to remember useful information about alchemy, alchemical or crafted items, and how things are made. A critical failure gives incorrect information."
    },
    {
      "name": "Alchemical Crafting",
      "costText": "downtime",
      "minRank": "trained",
      "feat": true,
      "featName": "Alchemical Crafting",
      "desc": "A Crafting skill feat that lets you use the Craft activity to create alchemical items, and you add four common 1st-level alchemical formulas to your formula book. Without it you cannot Craft alchemical items."
    },
    {
      "name": "Magical Crafting",
      "costText": "downtime",
      "minRank": "expert",
      "feat": true,
      "featName": "Magical Crafting",
      "desc": "A Crafting skill feat (expert in Crafting) that lets you use the Craft activity to create magic items, and you gain formulas for four common magic items of 2nd level or lower."
    },
    {
      "name": "Quick Repair",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Quick Repair",
      "desc": "A Crafting skill feat that lets you Repair an item in 1 minute instead of 10 (it also loses the exploration trait). If you're a master in Crafting it takes 3 actions; if you're legendary it takes a single action."
    }
  ],
  "deception": [
    {
      "name": "Create a Diversion",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "With a gesture, a trick, or distracting words, attempt one Deception check against the Perception DC of each creature you're diverting. On a success you become hidden to those creatures (letting you Sneak), lasting until the end of your turn. Whether you succeed or fail, diverted creatures gain a +4 circumstance bonus to their Perception DC against your Create a Diversion attempts for 1 minute."
    },
    {
      "name": "Feint",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "While within melee reach of the target, attempt a Deception check against its Perception DC. Success makes it off-guard against your next melee attack against it before the end of your turn (critical success: against your melee attacks until the end of your next turn); critical failure makes you off-guard to its melee attacks until the end of your next turn."
    },
    {
      "name": "Lie",
      "costText": "varies",
      "minRank": "untrained",
      "desc": "Try to fool someone with an untruth (at least 1 round, longer for elaborate lies). Roll one Deception check against the Perception DC of each creature you're trying to fool; on a failure they don't believe you and gain a +4 circumstance bonus against your Lies for the rest of the conversation. The GM may later let a creature attempt to Sense Motive against your Deception DC."
    },
    {
      "name": "Impersonate",
      "costText": "10 minutes",
      "minRank": "untrained",
      "desc": "Assemble a disguise (10 minutes, usually a disguise kit) to pass yourself off as someone or something else. Creatures detect the ruse only by using Seek against your Deception DC; if you interact directly while disguised, the GM rolls a secret Deception check against their Perception DC. Critical failure: the creature recognizes you."
    },
    {
      "name": "Lengthy Diversion",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Lengthy Diversion",
      "desc": "When you critically succeed to Create a Diversion, you remain hidden after the end of your turn rather than the hidden state ending. The effect lasts for a GM-determined duration based on the diversion and situation (minimum 1 additional round)."
    },
    {
      "name": "Lie to Me",
      "minRank": "trained",
      "feat": true,
      "featName": "Lie to Me",
      "desc": "When someone tries to Lie to you during a back-and-forth conversation, you use your Deception DC instead of your Perception DC (if it's higher) to determine whether they succeed. This doesn't apply when there's no dialogue, such as a lie told during a long speech."
    },
    {
      "name": "Charming Liar",
      "minRank": "trained",
      "feat": true,
      "featName": "Charming Liar",
      "desc": "When you critically succeed at a Lie meant to convey important information, inflate your status, or ingratiate yourself, the target's attitude toward you improves by one step (as a successful Make an Impression). This works only once per conversation."
    }
  ],
  "diplomacy": [
    {
      "name": "Make an Impression",
      "costText": "1 minute",
      "minRank": "trained",
      "desc": "After at least 1 minute of conversation, attempt a Diplomacy check against one creature's Will DC to improve its attitude toward you by one step (critical success two steps; critical failure worsens it one step). You can target up to five creatures at once by taking a -2 penalty."
    },
    {
      "name": "Request",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "Ask a friendly or helpful creature to do something; attempt a Diplomacy check against a DC the GM sets by the difficulty of the request. Success means it agrees (possibly with conditions); critical failure worsens its attitude one step."
    },
    {
      "name": "Gather Information",
      "costText": "exploration",
      "minRank": "trained",
      "desc": "Canvass markets, taverns, and gathering places (typically 2 hours) and attempt a Diplomacy check against a GM-set DC to learn about a person or topic. Critical failure yields incorrect information.",
      "tiers": [
        {
          "rank": "trained",
          "note": "Common rumor / talk of the town."
        },
        {
          "rank": "expert",
          "note": "Obscure rumor or a poorly guarded secret."
        },
        {
          "rank": "master",
          "note": "Well-guarded or esoteric information."
        },
        {
          "rank": "legendary",
          "note": "Information known only to an incredibly select few."
        }
      ]
    },
    {
      "name": "Bon Mot",
      "costText": "1 action",
      "minRank": "trained",
      "feat": true,
      "featName": "Bon Mot",
      "desc": "Launch an insightful quip at a foe within 30 feet; attempt a Diplomacy check against its Will DC. On a success the target takes a -2 (critical -3) status penalty to Perception and Will saves for 1 minute; on a critical failure you take that penalty instead."
    },
    {
      "name": "Group Impression",
      "costText": "1 minute",
      "minRank": "trained",
      "feat": true,
      "featName": "Group Impression",
      "desc": "When you Make an Impression, compare a single Diplomacy check to the Will DCs of up to 10 creatures you conversed with, with no penalty (20 if expert, 50 if master, 100 if legendary)."
    },
    {
      "name": "Hobnobber",
      "costText": "exploration",
      "minRank": "trained",
      "feat": true,
      "featName": "Hobnobber",
      "desc": "You Gather Information in half the usual time (typically 1 hour). If you're a master in Diplomacy, a critical failure on the Gather Information check becomes a failure instead."
    }
  ],
  "intimidation": [
    {
      "name": "Coerce",
      "costText": "1 minute",
      "minRank": "untrained",
      "desc": "After at least 1 minute of conversation laced with veiled or overt threats, attempt an Intimidation check against the target's Will DC. On a success the target complies with your demands (so long as they aren't self-harming) for up to 1 day before turning unfriendly; on a critical success it complies and is too scared to retaliate, while a critical failure makes it hostile and immune to your Coercion for at least a week."
    },
    {
      "name": "Demoralize",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "With a shout or threatening gesture, target one creature within 30 feet and attempt an Intimidation check against its Will DC. Success makes it frightened 1 and a critical success frightened 2; you take a -4 circumstance penalty if you don't share a language, and the target is immune to your Demoralize for 10 minutes regardless of the result."
    },
    {
      "name": "Battle Cry",
      "costText": "free",
      "minRank": "master",
      "feat": true,
      "featName": "Battle Cry",
      "desc": "When you roll initiative you can yell a battle cry and Demoralize an observed foe as a free action. If you're legendary in Intimidation, you can instead use a reaction to Demoralize a foe when you critically succeed at an attack roll against it."
    },
    {
      "name": "Scare to Death",
      "costText": "1 action",
      "minRank": "legendary",
      "feat": true,
      "featName": "Scare to Death",
      "desc": "Target a living creature within 30 feet that you sense and attempt an Intimidation check against its Will DC (-4 if it can't hear or understand you); the target is immune for 1 minute. Critical success forces a Fortitude save vs your Intimidation DC (dies on a critical failure, otherwise frightened 2 and fleeing 1 round); success makes it frightened 2, failure frightened 1, and critical failure leaves it unaffected. This action has the incapacitation trait."
    }
  ],
  "lore": [
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a Lore check against a GM-set DC to remember a fact within that Lore's narrow specialty. Critical success gives extra context or a follow-up answer; critical failure gives false information."
    },
    {
      "name": "Earn Income",
      "costText": "downtime",
      "minRank": "trained",
      "desc": "Practice a trade tied to one of your Lore specialties during downtime. The GM assigns a task level and secretly sets the DC; you make one Lore check, then earn that task level's daily income for each day worked.",
      "tiers": [
        {
          "rank": "trained",
          "note": "Earn the trained column's daily income on a success; critical success pays as if the task were one level higher."
        },
        {
          "rank": "expert",
          "note": "Earn the higher expert-column income for the same task levels."
        },
        {
          "rank": "master",
          "note": "Earn the master-column income, noticeably higher at upper task levels."
        },
        {
          "rank": "legendary",
          "note": "Earn the legendary-column income, the highest pay available."
        }
      ]
    },
    {
      "name": "Dubious Knowledge",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Dubious Knowledge",
      "desc": "When you fail (but don't critically fail) a Recall Knowledge check with any skill, you learn one true and one false fact without knowing which is which. Lore is the classic carrier for this feat."
    },
    {
      "name": "Unmistakable Lore",
      "costText": "free",
      "minRank": "expert",
      "feat": true,
      "featName": "Unmistakable Lore",
      "desc": "When you Recall Knowledge using any Lore subcategory you're trained in, a critical failure becomes a failure instead. If you're a master in that Lore, a critical success yields even more information."
    }
  ],
  "medicine": [
    {
      "name": "Treat Wounds",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "While wearing or holding a healer's toolkit, spend 10 minutes treating one injured living creature and attempt a DC 15 Medicine check; on a success the target regains 2d8 HP and loses the wounded condition (4d8 on a critical success), or takes 1d8 damage on a critical failure. The target is then immune to Treat Wounds for 1 hour; treating for a full hour on a success doubles the HP regained.",
      "tiers": [
        {
          "rank": "expert",
          "note": "You can instead attempt a DC 20 check to heal 10 more HP (e.g. 2d8+10)."
        },
        {
          "rank": "master",
          "note": "You can instead attempt a DC 30 check to heal 30 more HP (e.g. 2d8+30)."
        },
        {
          "rank": "legendary",
          "note": "You can instead attempt a DC 40 check to heal 50 more HP (e.g. 2d8+50)."
        }
      ]
    },
    {
      "name": "Administer First Aid",
      "costText": "2 actions",
      "minRank": "trained",
      "desc": "While wearing or holding a healer's toolkit, treat an adjacent dying or bleeding creature. Stabilize (DC 5 + the creature's recovery roll DC, typically 15 + its dying value) removes the dying condition (it stays unconscious), or Stop Bleeding (usually the DC of the bleed's source) grants an assisted recovery against persistent bleed; a critical failure increases the dying value by 1 or deals the bleed damage immediately."
    },
    {
      "name": "Treat Disease",
      "costText": "downtime",
      "minRank": "trained",
      "desc": "While wearing or holding a healer's toolkit, spend at least 8 hours caring for a diseased creature, then attempt a Medicine check against the disease's DC. Success grants a +2 circumstance bonus (critical success +4) to its next save against that disease; a critical failure inflicts a -2 circumstance penalty. You can't retry until after the creature's next save against the disease."
    },
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a Medicine check against a relevant DC to recall knowledge about diseases, poisons, wounds, anatomy, and physiology, or to identify a creature's malady or injuries."
    },
    {
      "name": "Treat Poison",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "While wearing or holding a healer's toolkit, treat a patient to prevent the spread of poison; attempt a Medicine check against the poison's DC. Success grants a +2 circumstance bonus (critical success +4) to its next save against that poison; a critical failure inflicts a -2 circumstance penalty. You can't retry until after the creature's next save against the poison."
    },
    {
      "name": "Battle Medicine",
      "costText": "1 action",
      "minRank": "trained",
      "feat": true,
      "featName": "Battle Medicine",
      "desc": "While wearing or holding a healer's toolkit, immediately treat yourself or an adjacent creature, healing as Treat Wounds (same DC and HP, including the higher-DC options if you qualify) but without removing the wounded condition. The target is then immune to your Battle Medicine for 1 day."
    }
  ],
  "nature": [
    {
      "name": "Command an Animal",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "Issue an order to an animal with a Nature check against its Will DC; on a success it does as commanded on its next turn. You automatically fail if the animal is hostile or unfriendly, and a critical failure makes it misbehave."
    },
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a Nature check (a secret check) against a GM-set DC to remember information about the natural world such as fauna, flora, geography, weather, fey, beasts, plants, and elementals. The GM sets the DC by the subject's level or rarity."
    },
    {
      "name": "Identify Magic",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "Spend 10 minutes studying a magical item, location, or ongoing effect with a Nature check (a secret check) against a GM-set DC to learn the particulars of its primal magic. On a failure you can't try again for 1 day."
    },
    {
      "name": "Train Animal",
      "costText": "downtime",
      "minRank": "trained",
      "feat": true,
      "featName": "Train Animal",
      "desc": "Spend roughly a week of downtime teaching an animal a basic action with a Nature check against a GM-set DC. On a success the animal learns the action and can be Commanded to perform it (a previously known action then needs no check)."
    },
    {
      "name": "Natural Medicine",
      "costText": "10 minutes",
      "minRank": "trained",
      "feat": true,
      "featName": "Natural Medicine",
      "desc": "Use Nature instead of Medicine to Treat Wounds, with higher Nature proficiency unlocking the more difficult DCs; in the wilderness you may gain a +2 circumstance bonus from fresh ingredients. It only substitutes for Treat Wounds, not other Medicine uses.",
      "tiers": [
        {
          "rank": "trained",
          "note": "DC 15, restore 2d8 HP (crit success 4d8)"
        },
        {
          "rank": "expert",
          "note": "DC 20, restore 2d8+10 HP"
        },
        {
          "rank": "master",
          "note": "DC 30, restore 2d8+30 HP"
        },
        {
          "rank": "legendary",
          "note": "DC 40, restore 2d8+50 HP"
        }
      ]
    },
    {
      "name": "Tame Animal",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Tame Animal",
      "desc": "Approach a non-hostile wild animal and attempt a Nature check, usually against its Will DC, to keep it from attacking you and your allies. Time spent drops from 1 hour to 10 minutes (expert), 1 minute (master), or three actions (legendary); success lasts a month and a critical success is permanent."
    }
  ],
  "occultism": [
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt an Occultism check against a target's DC to remember a fact about the esoteric, the occult, mysticism, fortune-telling, and obscure mysteries, including esoteric creatures such as aberrations, monitors, spirits, and undead. A critical failure gives you incorrect information."
    },
    {
      "name": "Decipher Writing",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Spend at least 1 minute per page studying esoteric texts about mysteries and philosophy and attempt an Occultism check against the GM's DC to understand the writing. On a critical failure you misconstrue its message."
    },
    {
      "name": "Identify Magic",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "Spend 10 minutes examining a magic item, location, or ongoing effect of the occult tradition and attempt an Occultism check against the GM's DC to learn what it does, how to activate it, and whether it's cursed. On a failure you can't try again for 1 day; a critical failure misidentifies it."
    },
    {
      "name": "Learn a Spell",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Spend 1 hour per spell rank and the listed Price in materials, then attempt an Occultism check against the spell's DC (typically 15 at 1st rank up to 41 at 10th) to add an occult spell to your repertoire or spellbook. Failure means you can't try again until you gain a level; critical failure expends half the materials."
    },
    {
      "name": "Bizarre Magic",
      "costText": "free",
      "minRank": "master",
      "feat": true,
      "featName": "Bizarre Magic",
      "desc": "Your spellcasting draws on strange variations, whether or not you can cast occult spells. The DCs for others to Recognize Spells you cast and to Identify Magic you use increase by 5."
    }
  ],
  "perception": [
    {
      "name": "Seek",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Scan an area (usually 30 feet or less) for undetected or hidden creatures and hidden objects, doors, or hazards. The GM rolls a secret Perception check vs each target's Stealth DC (or the object's detection DC); a success makes an undetected creature hidden and a hidden creature observed, and a critical success makes the creature observed."
    },
    {
      "name": "Sense Motive",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Assess one creature for signs it is lying or being affected by mental magic. The GM rolls a secret Perception check vs the creature's Deception DC (or the DC of a mental effect); a critical success reveals its true intentions, while on a failure you believe what a deceiver wants you to."
    },
    {
      "name": "Point Out",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Indicate a creature you can see that is undetected by one or more allies (but not by you), making it hidden to those allies instead of undetected. Allies must be able to see you; allies who can't hear or understand you must succeed at a Perception check vs the creature's Stealth DC or mistake its location."
    },
    {
      "name": "Search",
      "costText": "exploration",
      "minRank": "untrained",
      "desc": "While exploring, you Seek meticulously for hidden doors, objects, and hazards, moving at half Speed (no faster than 300 feet per minute, or 150 to spot things before you reach them). When you pass something hidden, the GM attempts a secret Seek check vs its Stealth or detection DC to see if you notice it."
    },
    {
      "name": "Detect Magic",
      "costText": "exploration",
      "minRank": "untrained",
      "desc": "While exploring, you repeatedly cast detect magic, moving at half Speed, to notice nearby magic auras. No check is required, and it doesn't pinpoint the exact source, but it alerts you so you can investigate further (travel at 150 feet per minute or slower to detect auras before entering them)."
    },
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a check to remember a relevant fact, asking the GM one question; the GM sets a DC and answers truthfully on a success (or with a bonus detail/follow-up on a critical success). When the knowledge comes from direct observation, the GM may let you use Perception instead of a skill, though most topics use a relevant skill or Lore."
    },
    {
      "name": "Battle Assessment",
      "costText": "1 action",
      "minRank": "trained",
      "feat": true,
      "featName": "Battle Assessment",
      "desc": "Study an enemy engaged in combat that isn't concealed, hidden, or undetected from you: the GM rolls a secret Perception check vs the higher of its Deception or Stealth DC. On a success the GM tells you one of its highest weakness, lowest save, an immunity, or highest resistance; a critical success reveals two (GM's choice), and a critical failure gives false information."
    },
    {
      "name": "Thorough Search",
      "costText": "exploration",
      "minRank": "expert",
      "feat": true,
      "featName": "Thorough Search",
      "desc": "While Searching, you take twice as long (moving at up to a quarter Speed) to be thorough. When the GM rolls your secret Seek check to notice something hidden, you gain a +2 circumstance bonus to that Perception check, and a success becomes a critical success."
    }
  ],
  "performance": [
    {
      "name": "Perform",
      "costText": "1 action",
      "minRank": "trained",
      "desc": "Put on a quick show with a single flourish — dance, sing, play an instrument, act, declaim, and so on. Roll Performance against an audience-based DC; the action gains the appropriate trait (such as auditory or visual) for the medium and is mainly used to power feats and class features."
    },
    {
      "name": "Earn Income",
      "costText": "downtime",
      "minRank": "trained",
      "desc": "Spend days of downtime performing for an audience to make money. Attempt a Performance check against the level-based DC of a task no higher than your level; success earns that task level's daily income and a critical success earns income as if the task were one level higher."
    },
    {
      "name": "Impressive Performance",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Impressive Performance",
      "desc": "You can Make an Impression using Performance instead of Diplomacy (vs. the target's Will DC). Performing for at least 10 minutes lets you target up to 10 audience members at once with no penalty, increasing to 20 for a 1-hour performance and 50 for a 2-hour one."
    },
    {
      "name": "Fascinating Performance",
      "costText": "1 action",
      "minRank": "trained",
      "feat": true,
      "featName": "Fascinating Performance",
      "desc": "When you Perform, compare your result to one observer's Will DC; on a success it is fascinated by you for 1 round. In a situation demanding immediate attention (such as combat) you must critically succeed and the action gains the incapacitation trait. You can fascinate up to 4 observers if you're an expert in Performance and up to 10 if you're a master."
    },
    {
      "name": "Virtuosic Performer",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Virtuosic Performer",
      "desc": "Choose one type of performance (such as acting, dance, or a specific instrument family) and gain a +1 circumstance bonus on Performance checks of that type. This bonus increases to +2 if you are a master in Performance."
    }
  ],
  "religion": [
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Religion check (GM-set, usually level-based DC) to remember facts about deities, religious traditions and tenets, the planes, the dead and undeath, and divine or cosmological matters."
    },
    {
      "name": "Decipher Writing",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Spend about 1 minute per page studying scripture or other religious text and attempt a Religion check against a GM-set DC (by complexity) to understand its true meaning; a critical failure means you misconstrue it."
    },
    {
      "name": "Identify Magic",
      "costText": "10 minutes",
      "minRank": "trained",
      "desc": "Spend 10 minutes examining a divine (or generically magical) item, location, or ongoing effect and attempt a Religion check against a GM-set DC to learn what it does and how to activate it. On a failure you can't retry for 1 day."
    },
    {
      "name": "Learn a Spell",
      "costText": "1 hour per rank",
      "minRank": "trained",
      "desc": "With a spellcasting class feature, spend 1 hour per spell rank plus materials, then attempt a Religion check (typical DC 15 at 1st rank up to 41 at 10th) to add a divine spell to your repertoire or prepared list."
    },
    {
      "name": "Student of the Canon",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Student of the Canon",
      "desc": "A critical failure to Decipher Writing of a religious nature or to Recall Knowledge about a faith's tenets becomes a failure; on Recall Knowledge about your own faith's tenets you treat a failure as a success and a success as a critical success."
    },
    {
      "name": "Exhort the Faithful",
      "costText": "varies",
      "minRank": "expert",
      "feat": true,
      "featName": "Exhort the Faithful",
      "desc": "When you Request something of, or Coerce, members of your own faith you can roll Religion instead of Diplomacy or Intimidation and gain a +2 circumstance bonus; a critically failed Request doesn't worsen the target's attitude."
    }
  ],
  "society": [
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a Society check against a GM-set DC to remember information about a topic of society, civilization, settlements, citizenship, or local laws and customs. A critical failure can yield incorrect information."
    },
    {
      "name": "Subsist",
      "costText": "downtime",
      "minRank": "untrained",
      "desc": "Provide food and shelter for yourself (and possibly others) in a settlement, attempting a Society check against a GM-set DC based on the location. On a failure you're exposed to the elements and become fatigued until you find sufficient food and shelter."
    },
    {
      "name": "Decipher Writing",
      "costText": "varies",
      "minRank": "trained",
      "desc": "Spend 1 minute per page (about 1 hour per page for ciphers) on a Society check against a GM-set DC to understand a coded message or archaic document. Failure imposes a -2 penalty to further attempts, and critical failure misconstrues the text."
    },
    {
      "name": "Create Forgery",
      "costText": "downtime",
      "minRank": "trained",
      "desc": "Over a day or week, forge a document; the GM rolls a secret DC 20 Society check. On a success passive observers don't notice the fake, while creatures who closely examine it roll Perception or Society against your Society DC to detect it."
    },
    {
      "name": "Courtly Graces",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Courtly Graces",
      "desc": "Use Society in place of Diplomacy to Make an Impression on nobles and in place of Deception when you Impersonate a noble; if you use the normal skill instead you gain a +1 circumstance bonus. You're also assumed to be a noble or close associate."
    },
    {
      "name": "Streetwise",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Streetwise",
      "desc": "Use your Society modifier instead of Diplomacy to Gather Information, and in a settlement you frequent you can Recall Knowledge with Society (at a higher DC) to learn what you'd normally have to Gather Information."
    }
  ],
  "stealth": [
    {
      "name": "Hide",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "While you have cover or greater cover from a creature, or are concealed from it, the GM secretly rolls your Stealth check against its Perception DC to become hidden from it rather than observed. You gain a +2 circumstance bonus (or +4 with greater cover)."
    },
    {
      "name": "Sneak",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Stride up to half your Speed while trying to become or stay undetected; at the end of the move the GM secretly rolls your Stealth check against each relevant creature's Perception DC. On a success you are undetected by that creature during and after the movement."
    },
    {
      "name": "Conceal an Object",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Hide a small object on your person; the GM rolls your Stealth check against a passive observer's Perception DC, and a creature deliberately searching can roll Perception against your Stealth DC. On a success the object stays undetected."
    },
    {
      "name": "Avoid Notice",
      "costText": "exploration",
      "minRank": "untrained",
      "desc": "Travel at half Speed attempting a Stealth check to avoid being noticed. If you're Avoiding Notice when an encounter begins, you usually roll Stealth for initiative and to see whether enemies notice you (vs. their Perception DCs)."
    },
    {
      "name": "Terrain Stalker",
      "costText": "free",
      "minRank": "trained",
      "feat": true,
      "featName": "Terrain Stalker",
      "desc": "Choose one terrain (rubble, snow, or underbrush). While undetected by all non-allies in that terrain, you can Sneak without a Stealth check as long as you move no more than 5 feet and never pass within 10 feet of an enemy."
    },
    {
      "name": "Quiet Allies",
      "costText": "free",
      "minRank": "expert",
      "feat": true,
      "featName": "Quiet Allies",
      "desc": "While you Avoid Notice and your allies Follow the Expert, you and those allies can roll a single Stealth check using the lowest modifier instead of rolling separately. This doesn't apply to initiative rolls."
    }
  ],
  "survival": [
    {
      "name": "Sense Direction",
      "costText": "exploration",
      "minRank": "untrained",
      "desc": "Stay oriented in the wild using the stars, sun, terrain, or wildlife, attempting a secret Survival check at a GM-set DC (usually once per day). Success keeps you from getting hopelessly lost (and gives a sense of cardinal directions); without a compass you take a -2 item penalty."
    },
    {
      "name": "Subsist",
      "costText": "downtime",
      "minRank": "untrained",
      "desc": "Provide food and shelter for yourself (and possibly others) in the wilds against a GM-set DC based on the environment. Success grants a subsistence living; failure leaves you fatigued, and you take a -5 penalty if you Subsist after 8 hours or less of exploration."
    },
    {
      "name": "Recall Knowledge",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Attempt a Survival check (or a relevant Lore) against the subject's DC to recall information about the environment, weather, terrain, or creatures of the wild. Usable in or out of an encounter."
    },
    {
      "name": "Track",
      "costText": "exploration",
      "minRank": "untrained",
      "desc": "Follow tracks at up to half your travel Speed, attempting a Survival check at a GM-set DC when you start, each hour, and whenever the trail changes significantly; in an encounter this is a single action. Failure loses the trail (retry after 1 hour); critical failure means no retry for 24 hours."
    },
    {
      "name": "Cover Tracks",
      "costText": "exploration",
      "minRank": "untrained",
      "desc": "Conceal your trail while moving up to half your travel Speed (a single action in an encounter); no check is needed. Anyone Tracking you must beat your Survival DC if it is higher than the normal Track DC."
    },
    {
      "name": "Survey Wildlife",
      "costText": "10 minutes",
      "minRank": "trained",
      "feat": true,
      "featName": "Survey Wildlife",
      "desc": "Spend 10 minutes studying signs of nearby creatures (nests, scat, marks), then attempt a Survival check at a GM-set DC to learn what creatures are around. On a success you may attempt a Recall Knowledge check at a -2 penalty about them (no penalty if you're a master in Survival)."
    },
    {
      "name": "Forager",
      "costText": "downtime",
      "minRank": "trained",
      "feat": true,
      "featName": "Forager",
      "desc": "While using Survival to Subsist, any result worse than a success becomes a success, and on a success you feed four extra creatures (eight as an expert, 16 as a master, 32 as legendary), doubling that on a critical success. You can instead support half as many at a comfortable living."
    },
    {
      "name": "Planar Survival",
      "costText": "downtime",
      "minRank": "master",
      "feat": true,
      "featName": "Planar Survival",
      "desc": "You can Subsist using Survival on other planes without penalty, even ones lacking normal sustenance. A successful Subsist check also prevents damage from the plane's general conditions to you and anyone you support (not smaller hazards)."
    },
    {
      "name": "Experienced Tracker",
      "costText": "exploration",
      "minRank": "trained",
      "feat": true,
      "featName": "Experienced Tracker",
      "desc": "You can Track while moving at full travel Speed by taking a -5 penalty to the Survival check; a master in Survival takes no penalty. A legendary tracker no longer needs to roll each hour, only when the trail changes significantly."
    }
  ],
  "thievery": [
    {
      "name": "Palm an Object",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Pick up a small, unattended object of negligible Bulk without being noticed. Roll one Thievery check against the Perception DC of each creature observing you; on a success that creature doesn't notice."
    },
    {
      "name": "Steal",
      "costText": "1 action",
      "minRank": "untrained",
      "desc": "Take a small object of negligible Bulk worn or carried by a creature that isn't in combat or on guard. Thievery vs. the bearer's Perception DC (typically +5 if the item is in a pocket or hand), also checked against other observers."
    },
    {
      "name": "Disable a Device",
      "costText": "2 actions",
      "minRank": "trained",
      "desc": "Disarm a trap or complex device; a thieves' toolkit is often helpful or required. Thievery check against the device's DC, sometimes needing multiple successes; a critical failure triggers the device."
    },
    {
      "name": "Pick a Lock",
      "costText": "2 actions",
      "minRank": "trained",
      "desc": "Open a lock without its key while holding or wearing a thieves' toolkit. Thievery check against the lock's DC (higher-quality locks may need several successes); a critical failure breaks your toolkit."
    },
    {
      "name": "Pickpocket",
      "costText": "1 action",
      "minRank": "trained",
      "feat": true,
      "featName": "Pickpocket",
      "desc": "Steal or Palm an Object that's closely guarded (such as in a pocket) without the usual -5 penalty. If you're a master in Thievery, you can Steal from a creature in combat or on guard by spending 2 actions and taking a -5 penalty."
    },
    {
      "name": "Concealing Legerdemain",
      "costText": "varies",
      "minRank": "trained",
      "feat": true,
      "featName": "Concealing Legerdemain",
      "desc": "When you Conceal an Object of light Bulk or less, you can use Thievery instead of Stealth for your check and for a searcher's Perception DC. You roll once but must keep spending actions to Conceal the Object."
    },
    {
      "name": "Quick Unlock",
      "costText": "1 action",
      "minRank": "master",
      "feat": true,
      "featName": "Quick Unlock",
      "desc": "You can Pick a Lock using a single action instead of two. Requires master proficiency in Thievery."
    }
  ]
};

/**
 * Actions available with `skill` at proficiency `rank`. Feat-gated actions are included
 * only when `hasFeat(name)` is true. Each returned action's `tiers` are filtered to those
 * unlocked at the character's rank.
 */
export function skillActionsFor(
  skill: string,
  rank: ProficiencyRank,
  hasFeat: (featName: string) => boolean,
): SkillAction[] {
  return (SKILL_ACTIONS[skill] ?? [])
    .filter((a) => rankAtLeast(rank, a.minRank) && (!a.feat || hasFeat(a.featName ?? a.name)))
    .map((a) => ({ ...a, tiers: a.tiers?.filter((t) => rankAtLeast(rank, t.rank)) }));
}
