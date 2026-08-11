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

## ⚠⚠ DECIDED SCOPE — the owner has already ruled on these

**Read this before deciding anything is missing.** These are the project owner's own decisions, quoted
from `work/rulings/DECISIONS.md` and `DECISIONS-round2.md`. They are settled policy, not gaps.

This section exists because it was skipped once. Readers who had never seen the rulings produced 183
"unexpressible" requirements; clustering them proposed 108 new systems, and adversarial pruning killed
106 — **85 because an existing lane or a standing ruling already covered it.** Without this section
roughly five in six audit findings are noise.

### Ruling F + N — an effect landing on SOMEONE ELSE is not your sheet's problem
> *"if its an effect the effects a teamate and not you then dont do anything"*

A bonus that goes to a teammate → **nothing on your sheet.** No star, no modifier; the record's own
description already tells the player what the ally gets. If it runs for a limited time, the character
who activated it gets a **display-only mode** so they can see it running; it changes none of their
numbers. Target-side numbers the app does not model — the target's AC, cover — get no surface either:
*"this dosent need to have an effect the player will tel the gm"*.

**So do not report "the ally's bonus never reaches them" as a defect.** That is the specified behaviour.

### ★ Companions — a companion's bonus marks the COMPANION, not you
> *"about items that effect the familer they need to be in the inventory of it… instead of your inventory"*

"Familiar" means every companion type. A companion item's bonus belongs on the companion's stat block
and the item in the companion's inventory. Absence from the character's sheet is correct.

### Ruling M — an aura you might not be standing in
Whether an emanation includes you depends on where you stand, **which the app can never know.** The
owner chose a permanent star carrying the positional condition in its note — not a mode, not a pill,
and emphatically not a positional model. **Auras are not a missing system.**

### Ruling E — consumables, in three cases
1. instantaneous only (a healing potion) → **no mode at all**
2. ongoing and it changes sheet numbers → mode **with** real modifiers
3. ongoing but changes no numbers (fast healing, persistent damage, "you are concealed") →
   **display-only** mode

**HP and damage never move sheet stats, even inside a mode.** Do not flag a healing effect for failing
to change a stat.

### Ruling D — a bonus with no stat row attaches to the THING IT MODIFIES
Not a new generic stat surface, and not the nearest roll. The marker goes on the **action** or the
**condition**, value inline in parentheses, `*` linking to the source — Magic Hands marks Treat Wounds,
Black Powder Boost marks Leap, The Survivor marks the Dying condition.

**DC-only:** a SAVE DC gets an entry in that save's breakdown, worded to say it hits the DC not the
check, star beside the DC. A **skill DC gets no surface at all** — the player remembers.

### Rulings A, B, C, G, H, I — how a situational bonus is shaped
- **A** — umbrella/summary records get no entries and are hidden from pickers.
- **B** — a flat bonus the rules restrict belongs in `situational` with the restriction in its `when`,
  **not** in `passiveEffects`. A restricted bonus sitting outside the stat total is correct.
- **C** — a bonus named after an ACTION stars **every skill that could perform it**, not just one.
- **G** — the mark lives on the thing you are looking at when it matters; a set or upgrade **replaces**
  the entry it upgrades rather than sitting beside it.
- **H** — where the rules are open, **stay open**: star everything plausible, printed trigger in the
  note. Narrowing it would put a ruling on the sheet dressed as the book's. Notes cap at about one
  line with a click-through to the full text.
- **I** — where the rules name no trigger, star **nothing**. The general answer to "the app can't
  express this" is the item editor's **Advanced** section, where the player authors their own marker
  targeting anything under any condition — rather than the app guessing a mapping.

### ★ Stacking, as displayed
Same bonus type and an identical `when` → show only the highest. Different `when` → show both. No
attempt to reason about whether two differently-worded triggers overlap.

---

## NOT lanes — do not classify these as mechanical

The overwhelming majority of prose is one of these. Getting this list right is what keeps the
candidate pile small enough to act on.

- **Anything covered by the DECIDED SCOPE section above.**
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
