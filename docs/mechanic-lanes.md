# Mechanic lanes — a classification manual

Every way this app has of turning a record's printed text into something that moves on the character
sheet. A "lane" is one such route. This document exists so a classifier can read a record's prose,
name the lanes it promises, and let a script check whether the record actually carries them.

**How to use it.** For each record you are given the printed text. Output the lane keys it promises —
zero, one, or several. Judge only from the text. Do not guess at what the app stores; that is the
other half of the comparison and you must not anticipate it.

**The comparison this feeds.** For each record: lanes the text promises, minus lanes the record
carries → candidates. Two buckets matter:
- **promised but empty** — the text says it, the record has nothing there. A likely defect.
- **no lane at all, but the text is clearly mechanical** — a lane this app has never built. Rarer and
  far more valuable; the two biggest holes ever found in this project came from here.

---

## A. Proficiency and skills

| lane | the text says | satisfied by |
|---|---|---|
| `skillTrained` | "You become trained in X" | `trainedSkill`, `passiveEffects.skills`, `featGrantsAuto.skills` |
| `skillChoice` | "trained in a skill of your choice" | `trainedSkillChoice`, `choice` |
| `loreTrained` | "trained in X Lore" | `trainedLore`, `trainedLoreChoice` |
| `rankUpgrade` | "At Nth level you become master/legendary in X" | `featGrantsAuto.rankUpgrade` (accepts an array of steps) |
| `profWeapon` / `profArmor` / `profSave` / `profPerception` / `profSpell` | "You become expert in …" naming a weapon group, armour category, a save, Perception, or spell attacks/DC | `proficiencies` |
| `skillSubstitution` | "You can use X in place of Y" | `skillSubstitutions` |
| `redundantFallback` | "If you would already be trained in that, choose another" | `featGrantsAuto.redundantFallback` |

## B. Attributes, HP, and the body

| lane | the text says | satisfied by |
|---|---|---|
| `abilityBoost` / `abilityFlaw` | a boost or flaw to an attribute | `abilityBoosts`, `abilityFlaws` |
| `apex` | "increase your X to 18, or by 2 if already 18+" | `apexAttribute` |
| `hpBonus` | "You gain N Hit Points" (permanent, not temporary) | `maxHpBonus`, `hp` |
| `size` | "Your size becomes X" | `size` |

## C. Defences

| lane | the text says | satisfied by |
|---|---|---|
| `acBonus` | a bonus to AC | `acBonus`, `passiveEffects.ac` |
| `saveBonus` | a bonus to Fortitude/Reflex/Will | `passiveEffects.saves` |
| `resistance` | "resistance N to X" | `resistances`, `passiveEffects.resistances` |
| `immunity` | "You are immune to X" | `immunities`, `passiveEffects.immunities` |
| `weakness` | "You gain weakness N to X" | `passiveEffects.weaknesses` **only** — a top-level `weaknesses` on an item is read by nothing |
| `hardness` | hardness / BT / shield HP | `hardness`, `brokenThreshold`, `shieldStats` |

## D. Senses, movement, languages

| lane | the text says | satisfied by |
|---|---|---|
| `sense` | darkvision, low-light, scent, tremorsense, echolocation | `senses`, `vision`, `conditionalSenses`, `darkvisionIfAncestryLowLight` |
| `speed` | a new movement type (fly, swim, climb, burrow) | `speeds` |
| `speedBonus` / `speedPenalty` | "+N feet to your Speed" | `landSpeedBonus`, `passiveEffects.speedBonus`, `speedPenalty` |
| `language` | "You learn X" / "You can speak with Y" | `languages`, `passiveEffects.grantsLanguages` |
| `perception` | a bonus to Perception | `passiveEffects.perception` |

## E. Magic

| lane | the text says | satisfied by |
|---|---|---|
| `innateSpell` | "You can cast X once per day as an innate spell" | `innateSpells` |
| `focusSpell` | "You gain the X focus spell" | `focusSpells`, `spells` |
| `focusPool` | "your focus pool increases by 1" | `focusPoolBonus`, `refocusRestore` |
| `cantrip` | "You learn a cantrip" / "add a cantrip to your repertoire" | `featCantripGrants`, `effectChoices` |
| `spellSlot` | "You gain an extra spell slot of Nth rank" | `spellSlot`, `spellSlotBonus` |
| `spellcasting` | grants a whole tradition's casting | `spellcastingGrant`, `casterArchetypes` |
| `spellListAdd` | "add X to your spell list" | `spellListAdditions` |
| `ritual` | "You learn the X ritual" | `grantsRituals` |
| `domain` | a deity's or a feat's domain access | `domains`, `alternateDomains` |
| `curriculum` | a wizard school's spell list | `curriculum` |
| `heldSpell` | an ITEM whose activation casts a spell | `heldSpells` (keyed by RANK — the rank must match the text) |

## F. Granting other records

| lane | the text says | satisfied by |
|---|---|---|
| `grantsFeat` | "You gain the X feat" (a named one) | `grantsFeats`, `grantedFeatId`, `featFeatGrants` |
| `grantsFeatChoice` | "You gain a feat of type T, level N or lower" | `featPickGrants` |
| `grantsFeatByChoice` | which feat depends on an earlier pick | `grantedFeatByChoice` |
| `grantsClassFeature` | grants a subclass/class feature | `grantsClassFeatures` |
| `grantsAction` | the record teaches a new named activity | `grantsActions` |
| `grantsStrike` | grants an unarmed attack or a weapon-like strike | `grantedStrikes`, `strikeDamage`, `unarmedTraits` |
| `companion` | animal companion, familiar, eidolon, construct, vehicle | `companionGrants` |
| `modifiesGrant` | changes what ANOTHER record already granted | `modifiesGrant` |

## G. Choices the player must make

| lane | the text says | satisfied by |
|---|---|---|
| `choice` | "choose one of the following", a named list of options | `choice`, `effectChoices` |
| `effectGrant` | an option that itself grants something | `effectChoices[].grant` |
| `dailyChoice` | chosen during daily preparations / on rest | `dailyChoices`, `advancedAlchemy`, `dailyItems` |

## H. Weapons and strikes

| lane | the text says | satisfied by |
|---|---|---|
| `weaponRider` | changes a weapon's damage, range, traits, or reload | `weaponTraits`, `strikeDamage` |
| `critSpec` | grants or changes critical specialization | `critSpec`, `critSpecWeapons`, `critSpecLevel` |
| `favoredWeapon` | a deity's favoured weapon | `favoredWeapons` |

## I. Item-only lanes

| lane | the text says | satisfied by |
|---|---|---|
| `activation` | "Activate ⟨N⟩ …" | `activationCost` |
| `charges` | "N charges", "uses per day" on an item | `counters`, `itemUses`, `capacity` |
| `consumable` | potion/scroll/talisman/oil behaviour | `consumableType` |
| `armorStats` | AC bonus, Dex cap, check penalty, Str, speed penalty | `acBonus`, `dexCap`, `checkPenalty`, `strength`, `speedPenalty` |
| `material` | a precious-material item | `material` |
| `bulkIgnore` | "ignore N Bulk", "this counts as Light" | `ignoredBulk` |
| `disguise` | "appears to be X" | `disguisedAs` |
| `copiesRunes` | "gains the runes of your …" | `passiveEffects.copiesRunes` |

## J. Conditional and toggleable

| lane | the text says | satisfied by |
|---|---|---|
| `situational` | a bonus that applies only on a specific roll or in a specific circumstance | `situational`, `situationalBonuses.ts` |
| `mode` | a state you turn on and off — a stance, a rage, an aura, "while X is active" | the **modes** lane, which lives in the DATA (`modes` on the record), not in `src/` |
| `limitedUses` | "N times per day/hour", a per-day resource | `limitedUses`, `featUses`, `usesUpgrade` |
| `extraReaction` | "You gain an additional reaction" | `extraReaction` |
| `note` | a clause worth printing on the sheet but not computable | `note` |

## K. Structural

| lane | the text says | satisfied by |
|---|---|---|
| `classArchetype` | replaces class features wholesale | `classArchetype` |
| `advancement` | changes what a class table gives at a level | `advancement.ts` |

---

## ⚠ Lanes this app does NOT have

Both were found by reading prose, not by comparing fields — neither source has a field for them.
A classifier should emit these, and the comparison will report every record as empty, because they
are empty.

| lane | the text says | status |
|---|---|---|
| `builtInRunes` | the item's own text calls it "a *+2 greater striking flaming* longsword" | **no field exists.** 551 live items. Verified: Obsidian Edge (True) renders +21/1d10 instead of +24/3d10 + 1d6 fire |
| `armorTyped` | "Usage worn armor", "Base Armor X" on a record stored as something other than armour | **65 live items** cannot be worn as armour at all |

---

## NOT lanes — do not classify these as mechanical

The overwhelming majority of prose is one of these. Getting this list right is what keeps the
candidate pile small enough to act on.

- Flavour, lore, history, appearance.
- Anything the GM adjudicates: exploration outcomes, social consequences, narrative access,
  "the GM determines…".
- Effects on **enemies** or on the battlefield rather than on your own sheet.
- The internal steps of an activity — "make a Strike", "you may Step", "attempt an Athletics check".
  The app lists the action; the player performs it. Only the action's EXISTENCE is a lane
  (`grantsAction`).
- Restating a general rule the app already implements everywhere.
- Prerequisites, access clauses, crafting requirements, price and bulk lines.
- A bonus **to one specific roll** is `situational`, not a flat bonus — do not classify it as
  `skillTrained`, `acBonus`, or `saveBonus`.

---

## What this method cannot catch

It compares *presence*, not *value*. A record whose text says "resistance 5" and whose field says
`resistance 3` promises the lane and carries the lane, so it passes. Several real defects found by
random sampling were exactly this shape — a wand keyed to rank 6 when its text says rank 8.

So this is a complement to the nine field-comparison checks in `npm run verify`, not a replacement.
The two instruments are blind to opposite things.
