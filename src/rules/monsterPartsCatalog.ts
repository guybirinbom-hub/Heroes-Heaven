import type { MpProperty } from './monsterParts';

/*
 * Battlezoo Monster Parts — the imbued-property catalog (everything except the Fire + Energy Resistant
 * exemplars, which live in monsterParts.ts). Transcribed from the user's personal Remaster conversion of
 * Battlezoo Monster Parts (© Roll for Combat) into structured data. Per-level damage is cumulative
 * (the resolver picks the highest entry at or below the chosen level). Situational crit riders, granted
 * spells, and conditions are reference text only.
 */
export const MONSTER_PART_CATALOG: MpProperty[] = [
  {
    "id": "acid",
    "name": "Acid",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the acid trait or an attack/spell dealing acid damage",
    "effect": "vitriolic acid",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "arcane",
      "primal"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "arcane or primal",
        "levels": [
          {
            "level": 2,
            "text": "Cast Caustic Blast as a cantrip, heightened to half the item's level (rounded up)."
          },
          {
            "level": 4,
            "text": "Cast Acidic Burst once/day."
          },
          {
            "level": 6,
            "text": "Acidic Burst heightens to 2nd; cast either Acid Grip or Acidic Burst once/day, not both."
          },
          {
            "level": 8,
            "text": "Acidic Burst heightens to 3rd; cast Acid Grip and Acidic Burst each once/day."
          },
          {
            "level": 10,
            "text": "Strikes deal +1 acid damage.",
            "addDamage": {
              "flat": 1,
              "type": "acid"
            }
          },
          {
            "level": 12,
            "text": "Acid Grip heightens to 4th; cast Acid Storm once/day."
          },
          {
            "level": 14,
            "text": "Additional acid damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "acid"
            }
          },
          {
            "level": 16,
            "text": "Acid Grip heightens to 6th, Acid Storm to 7th."
          },
          {
            "level": 18,
            "text": "Additional acid damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "acid"
            }
          },
          {
            "level": 20,
            "text": "Cast Storm of Vengeance once/day, but only the acid-rain effect (which you may choose twice in a row)."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 acid damage.",
            "addDamage": {
              "flat": 1,
              "type": "acid"
            }
          },
          {
            "level": 6,
            "text": "Additional acid → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "acid"
            }
          },
          {
            "level": 8,
            "text": "Additional acid → 1d6; on a crit, the target's armor takes 3d6 acid (before Hardness), or its raised shield takes it instead.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "acid"
            }
          },
          {
            "level": 12,
            "text": "Ignores acid resistance."
          },
          {
            "level": 14,
            "text": "Crit armor/shield damage → 6d6."
          },
          {
            "level": 18,
            "text": "Additional acid → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "acid"
            }
          },
          {
            "level": 20,
            "text": "Before applying acid, the target gains weakness 1 to acid until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent acid damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "acid",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "+1 acid damage.",
            "addDamage": {
              "flat": 1,
              "type": "acid"
            }
          },
          {
            "level": 8,
            "text": "Persistent acid → 1d6; on a crit, the target's armor/shield takes 3d6 acid.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "acid",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores acid resistance (including persistent)."
          },
          {
            "level": 14,
            "text": "Persistent acid → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "acid",
              "persistent": true
            }
          },
          {
            "level": 16,
            "text": "Each time a foe (or its armor/shield) takes this persistent acid at end of turn, its resistances and Hardness drop by 1 for 1 minute (cumulative)."
          },
          {
            "level": 18,
            "text": "Persistent acid → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "acid",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "On a crit, the target is drained 1."
          }
        ]
      }
    ]
  },
  {
    "id": "bane",
    "name": "Bane",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster that is the chosen bane type (or, at GM discretion, anathematic to it)",
    "effect": "extra harm against a chosen creature type",
    "choicePrompt": "Creature type",
    "choiceOptions": [
      "aberration",
      "animal",
      "astral",
      "beast",
      "celestial",
      "construct",
      "dragon",
      "dream",
      "elemental",
      "ethereal",
      "fey",
      "fiend",
      "giant",
      "monitor",
      "ooze",
      "spirit",
      "time",
      "undead",
      "fungus and plant"
    ],
    "paths": [
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 2,
            "text": "Against the bane type, Strikes deal 1 additional damage of the weapon's base damage type.",
            "addDamage": {
              "flat": 1,
              "type": "untyped"
            }
          },
          {
            "level": 4,
            "text": "Additional base-type damage vs the bane type increases to 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "untyped"
            }
          },
          {
            "level": 6,
            "text": "Additional base-type damage increases to 1d6; on a crit, the bane creature is enfeebled 1 until the end of your next turn.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "untyped"
            }
          },
          {
            "level": 10,
            "text": "Against the bane type, the base damage ignores the first 5 points of resistance."
          },
          {
            "level": 14,
            "text": "On a crit vs the bane type, the creature attempts a Fortitude save: crit success enfeebled 1, success enfeebled 2, failure enfeebled 3, crit failure destroyed (incapacitation)."
          },
          {
            "level": 16,
            "text": "Additional base-type damage increases to 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "untyped"
            }
          },
          {
            "level": 20,
            "text": "Additional base-type damage increases to 1d10.",
            "addDamage": {
              "dice": 1,
              "die": "d10",
              "type": "untyped"
            }
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 2,
            "text": "Strikes deal 1 persistent bleed damage vs the bane type.",
            "persistentDamage": {
              "flat": 1,
              "type": "bleed",
              "persistent": true
            }
          },
          {
            "level": 4,
            "text": "1 additional damage of the weapon's base damage type vs the bane type.",
            "addDamage": {
              "flat": 1,
              "type": "untyped"
            }
          },
          {
            "level": 6,
            "text": "Persistent bleed increases to 1d6; on a crit, the creature is enfeebled 1 until the end of your next turn.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "bleed",
              "persistent": true
            }
          },
          {
            "level": 10,
            "text": "Against the bane type, the base damage and this bleed ignore the first 5 points of resistance."
          },
          {
            "level": 12,
            "text": "Persistent bleed increases to 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "bleed",
              "persistent": true
            }
          },
          {
            "level": 14,
            "text": "On a crit, the creature is enfeebled 2 and attempts a Fortitude save: failure enfeebled 3, crit failure destroyed (incapacitation)."
          },
          {
            "level": 16,
            "text": "Persistent bleed increases to 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "bleed",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "The crit enfeebled condition lasts as long as the persistent bleed (or the end of your next turn, whichever is longer)."
          }
        ]
      }
    ]
  },
  {
    "id": "charisma",
    "name": "Charisma",
    "appliesTo": [
      "skill"
    ],
    "apexAbility": "cha",
    "requirement": "the creature has Charisma as its highest or second-highest modifier",
    "effect": "dazzling charisma",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 8,
            "text": "Cast heroism once/day (occult)."
          },
          {
            "level": 14,
            "text": "Heroism heightens to 6th level."
          },
          {
            "level": 17,
            "text": "On investing, increase your Charisma by 2 (or to 18 if it was lower); the item gains the apex trait."
          },
          {
            "level": 20,
            "text": "Heroism heightens to 9th level."
          }
        ]
      }
    ]
  },
  {
    "id": "cold",
    "name": "Cold",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the cold trait or an attack/spell dealing cold damage",
    "effect": "chilling cold",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "arcane",
      "primal"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "arcane or primal",
        "levels": [
          {
            "level": 2,
            "text": "Cast Ray of Frost as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast Chilling Spray once/day."
          },
          {
            "level": 6,
            "text": "Chilling Spray heightens to 2nd rank."
          },
          {
            "level": 8,
            "text": "Strikes deal +1 cold damage.",
            "addDamage": {
              "flat": 1,
              "type": "cold"
            }
          },
          {
            "level": 10,
            "text": "Cast Ice Storm once/day."
          },
          {
            "level": 12,
            "text": "Chilling Spray heightens to 3rd rank; cast Cone of Cold once/day."
          },
          {
            "level": 14,
            "text": "Additional cold damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "cold"
            }
          },
          {
            "level": 16,
            "text": "Chilling Spray, Cone of Cold, and Ice Storm heighten to 6th rank."
          },
          {
            "level": 18,
            "text": "Additional cold damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "cold"
            }
          },
          {
            "level": 20,
            "text": "Cast 9th-rank Polar Ray once/day."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 cold damage.",
            "addDamage": {
              "flat": 1,
              "type": "cold"
            }
          },
          {
            "level": 6,
            "text": "Additional cold → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "cold"
            }
          },
          {
            "level": 8,
            "text": "Additional cold → 1d6; on a crit, also slows the target 1 until the end of your next turn (Fortitude negates).",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "cold"
            }
          },
          {
            "level": 12,
            "text": "Ignores cold resistance."
          },
          {
            "level": 14,
            "text": "On a crit, also imposes a −10-foot status penalty to the target's Speeds for 1 round."
          },
          {
            "level": 18,
            "text": "Additional cold → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "cold"
            }
          },
          {
            "level": 20,
            "text": "Before applying cold, the target gains weakness 1 to cold until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent cold damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "cold",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "On a hit, the target takes a −5-foot status penalty to Speeds for 1 round."
          },
          {
            "level": 8,
            "text": "On a crit, the target is slowed 1 (Fortitude negates); the Speed penalty increases to −10 feet."
          },
          {
            "level": 12,
            "text": "Persistent cold ignores resistances."
          },
          {
            "level": 14,
            "text": "The target's Speed penalty lasts as long as the persistent cold."
          },
          {
            "level": 16,
            "text": "A foe adjacent to a surface who critically fails the slow save freezes there, immobilized until it Escapes vs the item DC."
          },
          {
            "level": 18,
            "text": "Persistent cold → 1d4.",
            "persistentDamage": {
              "dice": 1,
              "die": "d4",
              "type": "cold",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "The Speed penalty increases to −15 feet."
          }
        ]
      }
    ]
  },
  {
    "id": "constitution",
    "name": "Constitution",
    "appliesTo": [
      "skill"
    ],
    "requirement": "the creature has Constitution as its highest or second-highest modifier",
    "effect": "resilient constitution",
    "apexAbility": "con",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 8,
            "text": "Cast 3rd-level heal (on you only) once/day (divine)."
          },
          {
            "level": 14,
            "text": "Heal heightens to 6th."
          },
          {
            "level": 17,
            "text": "On investing, raise Constitution by 2 (or to 18); gains apex."
          },
          {
            "level": 18,
            "text": "Heal heightens to 7th, or instead cast regenerate on yourself once/day."
          },
          {
            "level": 20,
            "text": "Resting 10 minutes recovers 100 Hit Points."
          }
        ]
      }
    ]
  },
  {
    "id": "dexterity",
    "name": "Dexterity",
    "appliesTo": [
      "skill"
    ],
    "apexAbility": "dex",
    "requirement": "the creature has Dexterity as its highest or second-highest modifier",
    "effect": "deft dexterity",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 8,
            "text": "Once/day, a single-action Interact grants a +10-foot status bonus to all Speeds for 10 minutes."
          },
          {
            "level": 14,
            "text": "The Speed bonus increases to +20 feet, and you gain water walk while active."
          },
          {
            "level": 17,
            "text": "On investing, raise Dexterity by 2 (or to 18); the item gains apex."
          },
          {
            "level": 20,
            "text": "The Speed bonus increases to +30 feet, and you gain both air walk and water walk while active."
          }
        ]
      }
    ]
  },
  {
    "id": "electricity",
    "name": "Electricity",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the electricity trait or an attack/spell dealing electricity damage",
    "effect": "shocking electricity",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "arcane",
      "primal"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "arcane or primal",
        "levels": [
          {
            "level": 2,
            "text": "Cast Electric Arc as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast Shocking Grasp once/day."
          },
          {
            "level": 6,
            "text": "Shocking Grasp heightens to 2nd rank."
          },
          {
            "level": 8,
            "text": "Cast Lightning Bolt once/day."
          },
          {
            "level": 10,
            "text": "Strikes deal +1 electricity damage.",
            "addDamage": {
              "flat": 1,
              "type": "electricity"
            }
          },
          {
            "level": 12,
            "text": "Lightning Bolt heightens to 4th rank; cast Lightning Storm once/day."
          },
          {
            "level": 14,
            "text": "Additional electricity damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "electricity"
            }
          },
          {
            "level": 16,
            "text": "Cast Chain Lightning (no longer Lightning Bolt); Shocking Grasp and Lightning Storm heighten to 6th rank."
          },
          {
            "level": 18,
            "text": "Additional electricity damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "electricity"
            }
          },
          {
            "level": 20,
            "text": "Chain Lightning heightens to 9th rank; Lightning Storm and Shocking Grasp to 7th rank."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 electricity damage.",
            "addDamage": {
              "flat": 1,
              "type": "electricity"
            }
          },
          {
            "level": 6,
            "text": "Additional electricity → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "electricity"
            }
          },
          {
            "level": 8,
            "text": "Additional electricity → 1d6; on a crit, the electricity arcs an equal amount to up to two creatures within 10 feet.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "electricity"
            }
          },
          {
            "level": 12,
            "text": "Ignores electricity resistance."
          },
          {
            "level": 14,
            "text": "The crit arc reaches up to 20 feet."
          },
          {
            "level": 18,
            "text": "Additional electricity → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "electricity"
            }
          },
          {
            "level": 20,
            "text": "Before applying electricity, the target gains weakness 1 to electricity until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent electricity damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "electricity",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "+1 electricity damage.",
            "addDamage": {
              "flat": 1,
              "type": "electricity"
            }
          },
          {
            "level": 8,
            "text": "Persistent electricity → 1d6; on a crit, the damage plus persistent arcs to up to two creatures within 10 feet.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "electricity",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores electricity resistance (including persistent)."
          },
          {
            "level": 14,
            "text": "Persistent electricity → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "electricity",
              "persistent": true
            }
          },
          {
            "level": 16,
            "text": "The crit arc reaches up to four creatures within 20 feet."
          },
          {
            "level": 18,
            "text": "Persistent electricity → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "electricity",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "Foes taking this persistent electricity are magnetized: metal-weapon Strikes gain a +1 circumstance bonus to hit them while it lasts."
          }
        ]
      }
    ]
  },
  {
    "id": "force",
    "name": "Force",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the force trait or an attack/spell dealing force damage",
    "effect": "pure force",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "arcane",
      "divine",
      "occult"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "arcane, divine, or occult",
        "levels": [
          {
            "level": 2,
            "text": "Cast Shield as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast Force Barrage once/day."
          },
          {
            "level": 6,
            "text": "Cast either Force Barrage or Spiritual Armament once/day (not both)."
          },
          {
            "level": 8,
            "text": "Force Barrage heightens to 3rd; cast both Force Barrage and Spiritual Armament once/day."
          },
          {
            "level": 10,
            "text": "Strikes deal +1 force damage.",
            "addDamage": {
              "flat": 1,
              "type": "force"
            }
          },
          {
            "level": 12,
            "text": "Spiritual Armament heightens to 4th; cast Spiritual Guardian once/day."
          },
          {
            "level": 14,
            "text": "Additional force damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "force"
            }
          },
          {
            "level": 16,
            "text": "Force Barrage heightens to 5th, Spiritual Guardian to 6th; cast Spirit Blast once/day (no longer Spiritual Armament)."
          },
          {
            "level": 18,
            "text": "Additional force damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "force"
            }
          },
          {
            "level": 20,
            "text": "Cast 9th-level Spirit Song once/day."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 force damage.",
            "addDamage": {
              "flat": 1,
              "type": "force"
            }
          },
          {
            "level": 6,
            "text": "Additional force → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "force"
            }
          },
          {
            "level": 8,
            "text": "Additional force → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "force"
            }
          },
          {
            "level": 10,
            "text": "On a crit, the target attempts a Fortitude save or is pushed 5 feet."
          },
          {
            "level": 12,
            "text": "Ignores force resistance."
          },
          {
            "level": 16,
            "text": "On a crit + failed save, the target is pushed 10 feet."
          },
          {
            "level": 18,
            "text": "Additional force → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "force"
            }
          },
          {
            "level": 20,
            "text": "Before applying force, the target gains weakness 1 to force until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent force damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "force",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "+1 force damage.",
            "addDamage": {
              "flat": 1,
              "type": "force"
            }
          },
          {
            "level": 8,
            "text": "On a crit, the target attempts a Fortitude save or is pushed 5 feet."
          },
          {
            "level": 10,
            "text": "Persistent force → 1d6.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "force",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores force resistance (including persistent)."
          },
          {
            "level": 14,
            "text": "On a crit + failed save, the target is pushed up to 10 feet."
          },
          {
            "level": 16,
            "text": "Foes taking this persistent force damage are off-guard."
          },
          {
            "level": 18,
            "text": "On a crit + failed save, the target is pushed up to 20 feet."
          },
          {
            "level": 20,
            "text": "At the end of a foe's turn, if it fails to remove the persistent force it must succeed at a Fortitude save or fall prone."
          }
        ]
      }
    ]
  },
  {
    "id": "fortification",
    "name": "Fortification",
    "appliesTo": [
      "armor"
    ],
    "requirement": "parts from a monster with resistance or immunity to precision damage or critical hits",
    "effect": "thickens the armor (+1 Bulk, +2 to the Strength threshold for reducing penalties); from 6th level, a flat check can downgrade a critical hit to a normal hit",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 2,
            "text": "The armor thickens: +1 Bulk and +2 to the Strength threshold for reducing its check penalty and Speed penalty."
          },
          {
            "level": 6,
            "text": "When you're critically hit, attempt a DC 20 flat check; on a success, downgrade the critical hit to a normal hit."
          },
          {
            "level": 8,
            "text": "Crit-downgrade flat check DC drops to 19."
          },
          {
            "level": 10,
            "text": "Crit-downgrade flat check DC drops to 18."
          },
          {
            "level": 12,
            "text": "Crit-downgrade flat check DC drops to 17."
          },
          {
            "level": 14,
            "text": "Crit-downgrade flat check DC drops to 16."
          },
          {
            "level": 16,
            "text": "Crit-downgrade flat check DC drops to 15."
          },
          {
            "level": 18,
            "text": "Crit-downgrade flat check DC drops to 14."
          },
          {
            "level": 20,
            "text": "Crit-downgrade flat check DC drops to 13 (minimum)."
          }
        ]
      }
    ]
  },
  {
    "id": "holy",
    "name": "Holy",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the holy trait or an attack/spell dealing spirit damage",
    "effect": "radiant, sanctified energy to defeat unholy foes",
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "always divine",
        "levels": [
          {
            "level": 2,
            "text": "Cast divine lance (spirit, holy) as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast protection once/day, warding against unholy only."
          },
          {
            "level": 8,
            "text": "Cast Holy Light once/day."
          },
          {
            "level": 10,
            "text": "Cast divine wrath (holy) once/day."
          },
          {
            "level": 12,
            "text": "Strikes deal +1 spirit damage.",
            "addDamage": {
              "flat": 1,
              "type": "spirit"
            }
          },
          {
            "level": 14,
            "text": "Additional spirit damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "spirit"
            }
          },
          {
            "level": 16,
            "text": "Cast divine decree (holy); divine wrath heightens to 5th."
          },
          {
            "level": 18,
            "text": "Additional spirit damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "spirit"
            }
          },
          {
            "level": 20,
            "text": "Cast divine aura (holy); divine decree heightens to 8th, divine wrath to 7th."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 6,
            "text": "+1 spirit damage.",
            "addDamage": {
              "flat": 1,
              "type": "spirit"
            }
          },
          {
            "level": 8,
            "text": "Additional spirit → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "spirit"
            }
          },
          {
            "level": 10,
            "text": "Additional spirit → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "spirit"
            }
          },
          {
            "level": 12,
            "text": "On a crit vs an unholy creature, it takes a -2 status penalty to attacks against creatures other than you until the end of your next turn."
          },
          {
            "level": 14,
            "text": "Ignores spirit resistance."
          },
          {
            "level": 18,
            "text": "Additional spirit → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "spirit"
            }
          },
          {
            "level": 20,
            "text": "Before applying spirit, an unholy target gains weakness 1 to spirit until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 6,
            "text": "+1 spirit damage.",
            "addDamage": {
              "flat": 1,
              "type": "spirit"
            }
          },
          {
            "level": 8,
            "text": "1 persistent spirit damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "spirit",
              "persistent": true
            }
          },
          {
            "level": 10,
            "text": "Persistent spirit → 1d6.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "spirit",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "On a crit vs an unholy creature, it takes a -1 status penalty to attacks against creatures other than you."
          },
          {
            "level": 14,
            "text": "Ignores spirit resistance (including persistent)."
          },
          {
            "level": 16,
            "text": "On a crit vs an unholy creature, if it attacks or damages another creature before the end of your next turn, it's off-guard to your imbued-weapon attacks until the end of your next turn."
          },
          {
            "level": 18,
            "text": "Persistent spirit → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "spirit",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "Each time an unholy creature attacks or damages another creature, it takes the 1d10 persistent spirit damage and immediately attempts its end-of-turn flat check."
          }
        ]
      }
    ]
  },
  {
    "id": "intelligence",
    "name": "Intelligence",
    "appliesTo": [
      "skill"
    ],
    "requirement": "the creature has Intelligence as its highest or second-highest modifier",
    "effect": "brilliant intelligence",
    "apexAbility": "int",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 8,
            "text": "Cast Hypercognition once/day (occult)."
          },
          {
            "level": 14,
            "text": "Cast Hypercognition once/hour instead."
          },
          {
            "level": 17,
            "text": "On investing, raise Intelligence by 2 (or to 18); gains apex."
          },
          {
            "level": 20,
            "text": "Cast Hypercognition once/minute instead."
          }
        ]
      }
    ]
  },
  {
    "id": "mental",
    "name": "Mental",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the astral or mental trait or an attack/spell dealing mental damage",
    "effect": "psychic power",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "arcane",
      "occult"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "arcane or occult",
        "levels": [
          {
            "level": 2,
            "text": "Cast Daze as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast Phantom Pain once/day."
          },
          {
            "level": 6,
            "text": "Phantom Pain heightens to 2nd; cast either Phantom Pain or Warrior's Regret once/day (not both)."
          },
          {
            "level": 8,
            "text": "Both heighten to 3rd; cast both once/day."
          },
          {
            "level": 10,
            "text": "Strikes deal +1 mental damage.",
            "addDamage": {
              "flat": 1,
              "type": "mental"
            }
          },
          {
            "level": 12,
            "text": "Both heighten to 4th; cast Phantasmal Killer once/day."
          },
          {
            "level": 14,
            "text": "Additional mental damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "mental"
            }
          },
          {
            "level": 16,
            "text": "Phantom Pain and Phantasmal Killer heighten to 6th; cast Phantasmal Calamity once/day (no longer Warrior's Regret)."
          },
          {
            "level": 18,
            "text": "Additional mental damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "mental"
            }
          },
          {
            "level": 20,
            "text": "Cast Weird once/day."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 mental damage.",
            "addDamage": {
              "flat": 1,
              "type": "mental"
            }
          },
          {
            "level": 6,
            "text": "Additional mental damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "mental"
            }
          },
          {
            "level": 8,
            "text": "Additional mental damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "mental"
            }
          },
          {
            "level": 10,
            "text": "On a crit, the target is stupefied 1 for 1 round."
          },
          {
            "level": 12,
            "text": "Ignores mental resistance."
          },
          {
            "level": 16,
            "text": "On a crit, the target is stupefied 2 for 1 round."
          },
          {
            "level": 18,
            "text": "Additional mental damage → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "mental"
            }
          },
          {
            "level": 20,
            "text": "Before applying mental damage, the target gains weakness 1 to mental until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent mental damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "mental",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "+1 mental damage.",
            "addDamage": {
              "flat": 1,
              "type": "mental"
            }
          },
          {
            "level": 8,
            "text": "On a crit, the target is stupefied 1 for 1 round."
          },
          {
            "level": 10,
            "text": "Persistent mental damage → 1d6.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "mental",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores mental resistance (including persistent)."
          },
          {
            "level": 14,
            "text": "Persistent mental damage → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "mental",
              "persistent": true
            }
          },
          {
            "level": 16,
            "text": "On a crit, the target is stupefied 2 for 1 round."
          },
          {
            "level": 18,
            "text": "Persistent mental damage → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "mental",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "While the foe has this persistent mental damage, the crit stupefied lasts until the persistent damage ends or 1 round, whichever is longer."
          }
        ]
      }
    ]
  },
  {
    "id": "poison",
    "name": "Poison",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the poison trait or an attack/spell dealing poison damage",
    "effect": "toxic venom",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "arcane",
      "primal"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "arcane or primal",
        "levels": [
          {
            "level": 2,
            "text": "Cast Puff of Poison as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast Spider Sting once/day."
          },
          {
            "level": 6,
            "text": "Cast 2nd-level Noxious Vapors or Spider Sting once/day (not both)."
          },
          {
            "level": 8,
            "text": "Noxious Vapors heightens to 3rd; cast Noxious Vapors, Imp Sting, and Spider Sting each once/day."
          },
          {
            "level": 10,
            "text": "Strikes deal +1 poison damage.",
            "addDamage": {
              "flat": 1,
              "type": "poison"
            }
          },
          {
            "level": 12,
            "text": "Noxious Vapors heightens to 4th; cast Swarming Wasp Stings once/day."
          },
          {
            "level": 14,
            "text": "Additional poison damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "poison"
            }
          },
          {
            "level": 16,
            "text": "Noxious Vapors heightens to 6th; cast Purple Worm Sting once/day."
          },
          {
            "level": 18,
            "text": "Additional poison damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "poison"
            }
          },
          {
            "level": 20,
            "text": "Cast Linnorm Sting once/day."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 poison damage.",
            "addDamage": {
              "flat": 1,
              "type": "poison"
            }
          },
          {
            "level": 6,
            "text": "Additional poison → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "poison"
            }
          },
          {
            "level": 8,
            "text": "Additional poison → 1d6; on a crit, 1d10 persistent poison.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "poison"
            }
          },
          {
            "level": 12,
            "text": "Ignores poison resistance."
          },
          {
            "level": 14,
            "text": "On a crit, persistent poison → 2d10."
          },
          {
            "level": 18,
            "text": "Additional poison → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "poison"
            }
          },
          {
            "level": 20,
            "text": "Before applying poison, the target gains weakness 1 to poison until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent poison damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "poison",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "+1 poison damage.",
            "addDamage": {
              "flat": 1,
              "type": "poison"
            }
          },
          {
            "level": 8,
            "text": "Persistent poison → 1d6; on a crit, an extra 1d10 persistent poison (added after doubling).",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "poison",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores poison resistance (including persistent)."
          },
          {
            "level": 14,
            "text": "Persistent poison → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "poison",
              "persistent": true
            }
          },
          {
            "level": 16,
            "text": "At the end of a creature's turn that still has this persistent poison, choose clumsy, enfeebled, or stupefied — it gains or increases that condition by 1 (max 3); removing the poison ends them."
          },
          {
            "level": 18,
            "text": "Persistent poison → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "poison",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "On a crit, the target is drained 1."
          }
        ]
      }
    ]
  },
  {
    "id": "sensory",
    "name": "Sensory",
    "appliesTo": [
      "perception"
    ],
    "requirement": "parts from a creature with the next sense to be granted — low-light vision (lvls 1–6), darkvision (6–12), scent (12–16), greater darkvision (16–18), truesight (18–20)",
    "effect": "extraordinary senses",
    "senses": [
      {
        "level": 6,
        "sense": "low-light-vision"
      },
      {
        "level": 12,
        "sense": "darkvision"
      },
      {
        "level": 16,
        "sense": "scent"
      },
      {
        "level": 18,
        "sense": "greater-darkvision"
      },
      {
        "level": 20,
        "sense": "truesight"
      }
    ],
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 4,
            "text": "Once/day, a two-action envision activation grants low-light vision for 1 hour."
          },
          {
            "level": 6,
            "text": "While invested, gain low-light vision."
          },
          {
            "level": 8,
            "text": "Once/day, a two-action envision activation grants darkvision for 1 hour."
          },
          {
            "level": 12,
            "text": "While invested, gain darkvision."
          },
          {
            "level": 14,
            "text": "Once/day, a two-action envision activation grants 30-foot imprecise scent for 1 hour."
          },
          {
            "level": 16,
            "text": "While invested, gain 30-foot imprecise scent."
          },
          {
            "level": 18,
            "text": "While invested, gain greater darkvision."
          },
          {
            "level": 20,
            "text": "While invested, constantly gain the effects of 6th-level Truesight."
          }
        ]
      }
    ]
  },
  {
    "id": "sonic",
    "name": "Sonic",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the sonic trait or an attack/spell dealing sonic damage",
    "effect": "reverberating sound waves",
    "paths": [
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "1 additional sonic damage.",
            "addDamage": {
              "flat": 1,
              "type": "sonic"
            }
          },
          {
            "level": 6,
            "text": "Additional sonic damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "sonic"
            }
          },
          {
            "level": 8,
            "text": "Additional sonic → 1d6; on a crit, the target must succeed at a Fortitude save or be deafened for 1 minute (1 hour on a critical failure).",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "sonic"
            }
          },
          {
            "level": 12,
            "text": "Ignores sonic resistance."
          },
          {
            "level": 14,
            "text": "The deafness becomes permanent on a failure or critical failure."
          },
          {
            "level": 18,
            "text": "Additional sonic → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "sonic"
            }
          },
          {
            "level": 20,
            "text": "Before applying sonic, the target gains weakness 1 to sonic until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent sonic damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "sonic",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "1 additional sonic damage.",
            "addDamage": {
              "flat": 1,
              "type": "sonic"
            }
          },
          {
            "level": 8,
            "text": "Persistent sonic → 1d6; on a crit, the target must succeed at a Fortitude save or be deafened for 1 minute (1 hour on a critical failure).",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "sonic",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores sonic resistance (including persistent)."
          },
          {
            "level": 14,
            "text": "Persistent sonic → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "sonic",
              "persistent": true
            }
          },
          {
            "level": 16,
            "text": "The deafness is permanent and the target is also stunned 1 on a failure or critical failure."
          },
          {
            "level": 18,
            "text": "Persistent sonic → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "sonic",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "The sonic and persistent sonic create a boom hitting all creatures adjacent to the target whose AC ≤ your attack roll; on a crit they attempt the Fortitude save against being deafened and stunned."
          }
        ]
      }
    ]
  },
  {
    "id": "spell",
    "name": "Spell",
    "appliesTo": [
      "skill"
    ],
    "requirement": "the creature has the matching skill or can cast the chosen spell",
    "effect": "Imbue the item with a spell. Use a suggested spell or work with the GM (avoid long-lasting buffs like mystic armor and self-only spells like true strike). Pick a tradition that can cast it. Suggested spells by skill: Acrobatics Soft Landing, Arcana Force Barrage, Athletics jump, Crafting mending, Deception illusory disguise, Diplomacy charm, Intimidation fear, Lore share lore (matching Lore only), Medicine heal, Nature summon plant or fungus, Occultism object reading, Performance enthrall, Religion bless, Society mindlink, Stealth invisibility, Survival Environmental Endurance, Thievery knock.",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 4,
            "text": "Imbue a 1st-level spell. Pick a tradition that can cast it; a kept spell heightens to the current cap."
          },
          {
            "level": 6,
            "text": "Spell-level cap rises to 2nd."
          },
          {
            "level": 8,
            "text": "Spell-level cap rises to 3rd."
          },
          {
            "level": 10,
            "text": "Spell-level cap rises to 4th."
          },
          {
            "level": 12,
            "text": "Spell-level cap rises to 5th."
          },
          {
            "level": 14,
            "text": "Spell-level cap rises to 6th."
          },
          {
            "level": 16,
            "text": "Spell-level cap rises to 7th."
          },
          {
            "level": 18,
            "text": "Spell-level cap rises to 8th."
          },
          {
            "level": 20,
            "text": "Spell-level cap rises to 9th."
          }
        ]
      }
    ]
  },
  {
    "id": "strength",
    "name": "Strength",
    "appliesTo": [
      "skill"
    ],
    "apexAbility": "str",
    "requirement": "the creature has Strength as its highest or second-highest modifier",
    "effect": "ferocious strength",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 8,
            "text": "Cast earthbind once/day (primal)."
          },
          {
            "level": 14,
            "text": "Cast earthbind once/hour instead."
          },
          {
            "level": 17,
            "text": "On investing, raise Strength by 2 (or to 18); gains apex."
          },
          {
            "level": 20,
            "text": "Cast earthbind once/minute instead."
          }
        ]
      }
    ]
  },
  {
    "id": "sturdy",
    "name": "Sturdy",
    "appliesTo": [
      "shield"
    ],
    "requirement": "parts from a monster with Hardness or resistance to physical damage (or one physical type)",
    "effect": "while this property's level equals the shield's item level, increase the shield's Hardness by 3 (−1 per level the property is below the shield's level, min 0 at 3+ levels below); if Hardness rises by at least 1, also add +2 HP and +1 BT per point of added Hardness",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 1,
            "text": "Increase the shield's Hardness by 3 when this property's level equals the shield's item level, reduced by 1 per level the property is below the shield's level (minimum 0 at 3+ levels below). For each point of Hardness added, also add +2 HP and +1 BT."
          }
        ]
      }
    ]
  },
  {
    "id": "unholy",
    "name": "Unholy",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the unholy trait or an attack/spell dealing spirit damage",
    "effect": "profane, corrupt energy to defeat holy foes",
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "always divine",
        "levels": [
          {
            "level": 2,
            "text": "Cast divine lance (spirit, unholy) as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast protection once/day, warding against holy only."
          },
          {
            "level": 8,
            "text": "Cast chilling darkness once/day."
          },
          {
            "level": 10,
            "text": "Cast divine wrath (unholy) once/day."
          },
          {
            "level": 12,
            "text": "Strikes deal +1 spirit damage.",
            "addDamage": {
              "flat": 1,
              "type": "spirit"
            }
          },
          {
            "level": 14,
            "text": "Additional spirit damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "spirit"
            }
          },
          {
            "level": 16,
            "text": "Cast divine decree (unholy); divine wrath heightens to 5th."
          },
          {
            "level": 18,
            "text": "Additional spirit damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "spirit"
            }
          },
          {
            "level": 20,
            "text": "Cast divine aura (unholy); divine decree heightens to 8th, divine wrath to 7th."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 6,
            "text": "+1 spirit damage.",
            "addDamage": {
              "flat": 1,
              "type": "spirit"
            }
          },
          {
            "level": 8,
            "text": "Additional spirit → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "spirit"
            }
          },
          {
            "level": 10,
            "text": "Additional spirit → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "spirit"
            }
          },
          {
            "level": 12,
            "text": "On a crit vs a holy creature, deal 1d10 persistent bleed."
          },
          {
            "level": 14,
            "text": "Ignores resistances."
          },
          {
            "level": 18,
            "text": "Additional spirit → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "spirit"
            }
          },
          {
            "level": 20,
            "text": "Before applying spirit, a holy target gains weakness 1 to spirit until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 6,
            "text": "+1 spirit damage.",
            "addDamage": {
              "flat": 1,
              "type": "spirit"
            }
          },
          {
            "level": 8,
            "text": "1 persistent spirit damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "spirit",
              "persistent": true
            }
          },
          {
            "level": 10,
            "text": "Persistent spirit → 1d6.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "spirit",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "On a crit vs a holy creature, it also takes 1d10 persistent bleed."
          },
          {
            "level": 14,
            "text": "Ignores resistances (including persistent bleed and spirit)."
          },
          {
            "level": 16,
            "text": "On a crit vs a holy creature, it becomes frightened 1."
          },
          {
            "level": 18,
            "text": "Persistent spirit → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "spirit",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "While affected by this persistent spirit, a holy creature can't reduce its frightened below 1 at the end of its turn."
          }
        ]
      }
    ],
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "divine"
    ]
  },
  {
    "id": "vitality",
    "name": "Vitality",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the holy trait or an attack/spell dealing vitality damage",
    "effect": "cleansing vitality energy; vitality damage only harms undead and creatures with void healing",
    "paths": [
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 2,
            "text": "1 additional vitality damage.",
            "addDamage": {
              "flat": 1,
              "type": "vitality"
            }
          },
          {
            "level": 4,
            "text": "Additional vitality → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "vitality"
            }
          },
          {
            "level": 6,
            "text": "Additional vitality → 1d6; on a crit, the undead is enfeebled 1 until the end of your next turn.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "vitality"
            }
          },
          {
            "level": 10,
            "text": "Ignores vitality resistance."
          },
          {
            "level": 14,
            "text": "On a crit, instead the undead attempts a Fortitude save: crit success enfeebled 1, success enfeebled 2, failure enfeebled 3, crit failure destroyed (incapacitation)."
          },
          {
            "level": 18,
            "text": "Additional vitality → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "vitality"
            }
          },
          {
            "level": 20,
            "text": "Before applying vitality, the target gains weakness 1 to vitality until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 2,
            "text": "1 persistent vitality damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "vitality",
              "persistent": true
            }
          },
          {
            "level": 4,
            "text": "1 additional vitality damage.",
            "addDamage": {
              "flat": 1,
              "type": "vitality"
            }
          },
          {
            "level": 6,
            "text": "Persistent vitality → 1d6; on a crit, the undead is enfeebled 1 until the end of your next turn.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "vitality",
              "persistent": true
            }
          },
          {
            "level": 10,
            "text": "Ignores vitality resistance (including persistent)."
          },
          {
            "level": 12,
            "text": "Persistent vitality → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "vitality",
              "persistent": true
            }
          },
          {
            "level": 14,
            "text": "On a crit, enfeebled 2; the undead attempts a Fortitude save: failure enfeebled 3, crit failure destroyed (incapacitation)."
          },
          {
            "level": 18,
            "text": "Persistent vitality → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "vitality",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "A creature taking this persistent vitality struggles to heal from void energy: a void effect that would restore its HP must first counteract this property (level 20, DC 43); even on a success the HP recovered is reduced by 1d10 (full amount on a counteract crit success)."
          }
        ]
      }
    ]
  },
  {
    "id": "void",
    "name": "Void",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "parts from a monster with the void or undead trait or an attack/spell dealing void damage",
    "effect": "void energy, cosmological destruction",
    "choicePrompt": "Tradition (Magic path)",
    "choiceOptions": [
      "divine",
      "primal"
    ],
    "paths": [
      {
        "id": "magic",
        "name": "Magic",
        "note": "divine or primal",
        "levels": [
          {
            "level": 2,
            "text": "Cast Void Warp as a cantrip, heightened to half the item's level."
          },
          {
            "level": 4,
            "text": "Cast harm once/day."
          },
          {
            "level": 6,
            "text": "harm heightens to 2nd; cast either harm or sudden blight once/day, not both."
          },
          {
            "level": 8,
            "text": "Both heighten to 3rd; cast both once/day."
          },
          {
            "level": 10,
            "text": "Strikes deal +1 void damage.",
            "addDamage": {
              "flat": 1,
              "type": "void"
            }
          },
          {
            "level": 12,
            "text": "Both heighten to 4th; cast enervation once/day."
          },
          {
            "level": 14,
            "text": "Additional void damage → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "void"
            }
          },
          {
            "level": 16,
            "text": "enervation and harm heighten to 6th; cast necrotize once/day (no longer sudden blight)."
          },
          {
            "level": 18,
            "text": "Additional void damage → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "void"
            }
          },
          {
            "level": 20,
            "text": "Cast Wails of the Damned once/day."
          }
        ]
      },
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 void damage.",
            "addDamage": {
              "flat": 1,
              "type": "void"
            }
          },
          {
            "level": 6,
            "text": "Additional void → 1d4.",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "void"
            }
          },
          {
            "level": 8,
            "text": "Additional void → 1d6.",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "void"
            }
          },
          {
            "level": 10,
            "text": "On a crit, the target is enfeebled 1 for 1 round."
          },
          {
            "level": 12,
            "text": "Ignores void resistance."
          },
          {
            "level": 16,
            "text": "On a crit, the target is enfeebled 2 for 1 round."
          },
          {
            "level": 18,
            "text": "Additional void → 1d8.",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "void"
            }
          },
          {
            "level": 20,
            "text": "Before applying void, the target gains weakness 1 to void until the start of your next turn."
          }
        ]
      },
      {
        "id": "technique",
        "name": "Technique",
        "levels": [
          {
            "level": 4,
            "text": "1 persistent void damage.",
            "persistentDamage": {
              "flat": 1,
              "type": "void",
              "persistent": true
            }
          },
          {
            "level": 6,
            "text": "+1 void damage.",
            "addDamage": {
              "flat": 1,
              "type": "void"
            }
          },
          {
            "level": 8,
            "text": "On a crit, the target is enfeebled 1 for 1 round."
          },
          {
            "level": 10,
            "text": "Persistent void → 1d6.",
            "persistentDamage": {
              "dice": 1,
              "die": "d6",
              "type": "void",
              "persistent": true
            }
          },
          {
            "level": 12,
            "text": "Ignores void resistance (including persistent void)."
          },
          {
            "level": 14,
            "text": "Persistent void → 1d8.",
            "persistentDamage": {
              "dice": 1,
              "die": "d8",
              "type": "void",
              "persistent": true
            }
          },
          {
            "level": 16,
            "text": "On a crit, the target is enfeebled 2 for 1 round."
          },
          {
            "level": 18,
            "text": "Persistent void → 1d10.",
            "persistentDamage": {
              "dice": 1,
              "die": "d10",
              "type": "void",
              "persistent": true
            }
          },
          {
            "level": 20,
            "text": "While the foe has this persistent void, the crit enfeebled lasts until the persistent damage ends or 1 round, whichever is longer."
          }
        ]
      }
    ]
  },
  {
    "id": "wild",
    "name": "Wild",
    "appliesTo": [
      "weapon"
    ],
    "requirement": "none — use any parts",
    "effect": "A chaotic mix of energies, inconsistent and slightly weaker than a focused property.",
    "paths": [
      {
        "id": "might",
        "name": "Might",
        "levels": [
          {
            "level": 4,
            "text": "+1 additional damage; each time you deal it, roll 1d6 for the type — 1 acid, 2 cold, 3 electricity, 4 fire, 5 void, 6 sonic (random type each hit).",
            "addDamage": {
              "flat": 1,
              "type": "untyped"
            }
          },
          {
            "level": 6,
            "text": "Additional damage → 1d4 (random type each hit).",
            "addDamage": {
              "dice": 1,
              "die": "d4",
              "type": "untyped"
            }
          },
          {
            "level": 8,
            "text": "Additional damage → 1d6 (random type each hit).",
            "addDamage": {
              "dice": 1,
              "die": "d6",
              "type": "untyped"
            }
          },
          {
            "level": 12,
            "text": "The additional damage ignores resistances."
          },
          {
            "level": 18,
            "text": "Additional damage → 1d8 (random type each hit).",
            "addDamage": {
              "dice": 1,
              "die": "d8",
              "type": "untyped"
            }
          },
          {
            "level": 20,
            "text": "Before applying the damage, the target gains weakness 1 to that damage type until the start of your next turn."
          }
        ]
      }
    ]
  },
  {
    "id": "winged",
    "name": "Winged",
    "appliesTo": [
      "armor"
    ],
    "requirement": "parts from a monster with a fly Speed",
    "effect": "wings protrude from the armor (choose arcane or primal when first imbued)",
    "choicePrompt": "Tradition",
    "choiceOptions": [
      "arcane",
      "primal"
    ],
    "paths": [
      {
        "id": "main",
        "name": "",
        "note": "arcane or primal",
        "levels": [
          {
            "level": 6,
            "text": "The armor automatically casts Soft Landing on you when you fall (can't retrigger for 1 hour)."
          },
          {
            "level": 8,
            "text": "The Soft Landing cooldown drops to 10 minutes."
          },
          {
            "level": 10,
            "text": "Cast fly on you once per day."
          },
          {
            "level": 14,
            "text": "Cast fly on you once per hour instead."
          },
          {
            "level": 16,
            "text": "You may cast 7th-level fly instead of 4th-level; if so, it can't be reused for 1 day instead of 1 hour."
          },
          {
            "level": 18,
            "text": "You can fly constantly, with a Speed equal to your land Speed."
          },
          {
            "level": 20,
            "text": "Cast 4th-level fly on an ally once per hour."
          }
        ]
      }
    ]
  },
  {
    "id": "wisdom",
    "name": "Wisdom",
    "appliesTo": [
      "perception",
      "skill"
    ],
    "requirement": "parts from a creature that has Wisdom as its highest or second-highest modifier",
    "effect": "sagacious wisdom",
    "apexAbility": "wis",
    "paths": [
      {
        "id": "main",
        "name": "",
        "levels": [
          {
            "level": 8,
            "text": "Cast augury once/day (divine)."
          },
          {
            "level": 14,
            "text": "Augury takes only a single action to activate."
          },
          {
            "level": 17,
            "text": "On investing, raise Wisdom by 2 (or to 18 if not already higher); the item gains the apex trait."
          },
          {
            "level": 20,
            "text": "You may cast foresight once/day instead of augury."
          }
        ]
      }
    ]
  }
];
