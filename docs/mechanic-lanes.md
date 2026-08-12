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
| `spellNote` | the record grants a spell and then CHANGES it — "when you cast it this way…", "except the spell has…", "you can target only yourself" | `spellNotes`, printed in that spell's description under the granting record's name (owner principle N2) |

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
| `mapReduction` | the MULTIPLE ATTACK PENALTY PROGRESSION itself changes — "your multiple attack penalty … is −3 (−2 with an agile attack) … instead of −5 … and −6 … instead of −10" | `mapReduction` on the record. **4 records, all authored.** ⚠ It REPLACES, never discounts: a record states its own pair and `mapStepFor` takes the lowest printed candidate for that agile-ness, so the agile trait's −4 can never be applied twice. A reduction the sheet cannot evaluate (Combination Finisher's "your finishers' Strikes") carries `appliesWhen`, moves no number, and becomes a `*` on the strike row |
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
| `degreeShift` | a degree of success CHANGES — "a success is a critical success instead", "a critical failure is a failure instead", "one degree of success better" | `degreeShifts` on the record. Owner ruling **Q2**: one entry stars the skill AND marks the action, and all three saves when it applies to saves generally. ⚠ Do **not** also write the sentence into `situationalBonuses.ts` — that was two registries drifting apart, which is why the field exists |
| `degreeShiftDown` | the degree gets WORSE — "use the result one degree of success worse", "if you roll a critical success, you get a success instead", "a failure becomes a critical failure" | **the same `degreeShifts` field**, with `shift` set to `critSuccessToSuccess`, `failToCritFail` or `oneWorse` (added 2026-08-12; all four earlier values improved the result). **9 records, all authored.** ⚠ Two of them — Dragon's Presence and the even-tempered tanuki — print both directions in one sentence and had shipped with only the UPGRADE half, so the sheet showed the good news and hid the bad |
| `noStrikes` | a battle form says "you can't make Strikes" | `battleForm.noStrikes` on the mode. **7 modes, all authored.** ⚠ An empty or absent `strikes` array cannot say this: absent means "the form states none, keep your own", so removing your Strikes needed its own word. `strikesBlockedBy` puts the reason on the Strikes tab — an empty list with no explanation reads as a broken app (**Q27**) |
| `aura` | the record CREATES a persistent emanation centred on you (or on a banner, implement or mount you carry) — "a 15-foot emanation", "you and allies within 30 feet", "you emanate a nimbus" | a **mode** with `category: 'Aura'` in `scripts/data/toggle-modes.json`, gated to the record that projects it. Owner ruling **Q29**. ⚠ A record that merely USES an aura as a range ("an ally in your champion's aura") is not one — it is a consumer. A record that CHANGES another's aura is a **rewriter**: `modeAdjust` matched to that aura's mode id, never a second toggle |
| `battleForm` | the text states statistics that REPLACE yours — "AC = 18 + your level", "these are the only attacks you can Strike with", "Speed 40 feet" | `battleForm` on a **mode** (`scripts/data/toggle-modes.json`). Owner ruling **Q3**. ⚠ Every other lane ADDS; this one SETS, and a field the text does not state must stay ABSENT — absent is the only way to say "keep the character's own value" |

## K. Structural

| lane | the text says | satisfied by |
|---|---|---|
| `specialStatistic` | a NAMED statistic the player rolls, or whose DC an opponent beats, that no row on the sheet is labelled for — "Make an **impulse attack roll**", "using your thaumaturge class DC for **the scroll's DC**", "…is called your **chronoskimmer DC**" | `specialStatistic` on the record; `passiveEffects.specialStatBonus` for an item bonus that names it. Rendered as the **Special statistics** rail card, with a breakdown. Owner ruling **Round 9**. **11 records.** `basis` has two shapes: `{ classDc }`, and `{ higherOfClassDcOrSpellDc }` for a statistic defined as the maximum of two rows, which is a third number printed nowhere |
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
**Two entries were removed on 2026-08-12** because the lane was built rather than described — see
`degreeShiftDown` and `noStrikes` in section J. Both were listed here as "no field exists", which was
true and was also the whole reason nine records and seven modes said nothing.

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
owner chose a permanent star carrying the positional condition in its note — and emphatically not a
positional model.

⚠ **Q29 (Round 9) revised the "not a mode" half of this.** *"Aura should be a mode."* The star stays —
it is what the player sees on the stat row — and the mode is added on top: it shows the aura is
RUNNING, carries the full text including the ally half (Principle B / Ruling F), and gives the feats
that rewrite an aura something to attach to (Principle C). **The no-positional-model half is
untouched**: nothing is derived from who is standing inside the emanation. See the `aura` lane below.

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

### `specialStatistic` — the test, and what it deliberately EXCLUDES

A record joins only when **our own text names the statistic AND the number is not already printed on
the sheet under another label.** Two shapes qualify:

- **created** — the statistic exists only because of this record. The kineticist's impulse attack
  roll: our own text states the whole formula, 18 impulse feats say "Make an impulse attack roll",
  and a *gate attenuator* raises it *"(but not to your impulse DC)"*, which makes it provably a
  different number from the class DC.
- **borrowed for a named use** — the record binds an existing statistic to a thing that has no row.
  Scroll Thaumaturgy: *"using your thaumaturge class DC for the scroll's DC"*.
- **defined as the higher of two** — the value is the maximum of two rows the sheet already prints,
  which is a third number printed nowhere. Chronoskimmer Dedication: *"either your class DC or spell
  DC, whichever is higher, and is called your chronoskimmer DC"*. ⚠ Resolved by comparing the VALUES,
  not the ranks — "whichever is higher" is what the rule says, and an expert spell DC on a +5
  attribute beats a master class DC on a +3 one.

**The 11 records:** the kineticist **impulse attack roll** (`classFeatures/impulses` +
`feats/kineticist-dedication`), the **scroll DC** (`feats/scroll-thaumaturgy`), the **chronoskimmer
DC** (`feats/chronoskimmer-dedication`), and the **deviation DC + deviation attack roll** on all seven
deviant classifications.

**Excluded — an existing stat under another name.** Each was checked and rejected for a stated reason:

| not in the lane | why |
|---|---|
| the **16 archetype class DCs** (Gunslinger Dedication and kin) | the class DC of a class you do not have. Already a lane: `classDcGrant` → `secondaryClassDcs` → the *Multiclass DCs* rail card. What was wrong was DATA, not the lane |
| a record that **raises** a statistic already in the lane (Expert Kinetic Control) | it carries `classDcRank`, and the statistic follows the class DC it is defined against. A second rank track for one printed rule is how two numbers for one roll appear |
| a record **pointing at a statistic that already has a row** (Kinetic Activation, Alchemical Power, Intensify Investiture) | *"you can substitute your impulse attack roll or class DC"* — printing that number a third time under a third name |
| the **impulse DC** | it IS the kineticist class DC, which has a row. A *gate attenuator*'s *"(but not to your impulse DC)"* is what proves the impulse ATTACK is a different number, and equally proves the DC is not |

### ⚠ The deviant classifications — a WRONG exclusion, corrected 2026-08-12

The first pass excluded all six of Foundry's deviant `SpecialStatistic` uses, recording: *"Our own text
never names one — not the classifications, not the deviant feats, not AoN's five Dark Archive rules
pages."* **Both halves are false, and both were one grep away:**

- `classFeatures/flicker-deviant-classification` (and its `desynchronized-motions` sub-feature) says
  *"You can attempt to Escape against **your deviation DC**"*;
- AoN **rules-3506** *Deviation Saves and Attack Rolls*, in the local archive, prints the formula:
  *"The DC for any saving throw called for by a deviation is the higher of your class DC or spell DC.
  The attack modifier of a deviation is 10 lower than that DC."* (Our own copy of that rules page is a
  title-only stub, which is how the first read missed it.)

What was actually missing was a `basis` that could SAY "the higher of two" — so a limit of the FIELD
was written up as a property of the corpus. That is the false-gap failure in reverse: rather than
sending someone to rebuild something that works, it closed a real gap by writing down a reason.
**When a record cannot be authored, check whether the field is what cannot say it before concluding
the text does not say it.**

Reachability was measured, not assumed: 30 deviant feats are live and each carries
`grantsClassFeatures: [<its classification>]`, so a character who takes one owns the classification and
gets both rows. Four of them say only *"Make an attack roll"*, with the modifier printed nowhere.

### `dedicationGate` — a Special clause restricting further dedications

| lane | the text says | satisfied by |
|---|---|---|
| `dedicationGate` | *"**Special** You cannot select another dedication feat other than X until you have gained two other feats from the Y archetype."* | `Feat.dedicationGate {archetypes, count, except}` |

⚠ **Owner ruling Q28: only a feat that PRINTS the clause gates.** 14 of 240 live dedications do.
Player Core's Archetypes chapter states the rule generally and the Remaster lifted the boilerplate out
of the individual feats — which is why so few still print one — but the owner has ruled that here the
printed clause is the whole rule. Do not restore a default gate; it would silently block 213 dedications.

Each clause names its own archetype(s), its own count and its own exception, so the gate is read from
the record's text and never inferred. Sibling archetypes count into ONE pool.
