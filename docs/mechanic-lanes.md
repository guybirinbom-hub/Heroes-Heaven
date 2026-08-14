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
| `language` | "You learn X" | `languages`, `passiveEffects.grantsLanguages` |
| `speakWith` | **"You can speak with Y"** where Y is a kind of creature, not a language — "you can ask questions of, receive answers from, and use the Diplomacy skill with animals" | a **`situational` star on the skill the clause names**, not a language pill. ⚠ Measured before choosing: `core.languages` holds 120 real slugs and none for animal speech; only 4 values are ever granted through `grantsLanguages`; and `languageDesc(id)` is keyed by id alone, so a pill could not carry "rudimentary" per record and its generic fallback would tell the player they can READ the creature's writing. 32 records share the phrase, 24 of them carrying no mechanical field at all |
| `perception` | a bonus to Perception | `passiveEffects.perception` |
| `creatureTrait` | "You gain the undead and zombie traits" — a CREATURE trait, which decides what can target you | `grantsCreatureTraits` on the record, read through `creatureTraitsOf` and printed on the Details tab. Owner ruling **Q6**. ⚠ **Four shapes, and only the first fits that field** — see below |

### `creatureTrait` — the four shapes, and why one field could not hold them

`grantsCreatureTraits` is flat, unconditional and unchosen: owning the record grants every trait listed,
for as long as you own it. Twelve records used it for clauses that were none of those things, and each
one made the Details tab state something false. Verified and fixed 2026-08-13.

| the text says | lane | example |
|---|---|---|
| you simply gain these traits | `grantsCreatureTraits` on the record | Zombie Dedication. Ghost Dedication is the failure mode: *"You gain the ghost, spirit, and undead traits"* was dropped and only the later *"you also gain the incorporeal trait"* authored, so a ghost read as a living humanoid |
| one BRANCH of a choice grants it | `EffectGrant.grantsCreatureTraits` on that option | Swimming Animal — *"**Aquatic:** you gain the aquatic trait"*, against a Water-dwelling branch that exists because that character still breathes air. Deity (Champion) likewise: holy, unholy, or a *"none"* deity's neither |
| the ANSWER is the trait | `grantsCreatureTraitFromChoice: '<this record's own choice flag>'` | *"the trait appropriate to the type of servitor you've become (archon, angel, or azata, **for example**)"*. The parenthesis is illustrative, so the picker takes `allowCustom` (principle **I**) and the answer is taken at its word |
| it is true only WHILE something runs | `ModeDef.creatureTraits` on the mode that IS the form or the event | Worm Form — *"**while in this form**, you gain the animal trait"*, which on the feat made an untransformed worm caller an animal. Fey Life is the same shape with a trigger instead of a duration: *"the **first time you die** after gaining this feat … you gain the fey trait"*, against a prerequisite reading *"you're not a fey"* (principle **M2** — the app supplies the capability, the player supplies the timing) |

⚠ `EffectGrant.grantsCreatureTraits` is honoured on the **always-on** sink only. The item sink writes
`ItemPassiveEffects` and the daily sink's readers take skills/senses/IWR, so a trait authored into
either would be resolved and dropped without a sound; `test/creature-trait-lanes.test.ts` guards both.

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
| `spellNote` (source-driven) | a rule about WHERE a spell came from — "when you cast a non-cantrip spell you gained from a heritage or an ancestry feat" | `spellNotes[].fromAncestrySpells`, resolved per character in `build.ts`'s `wantsAncestrySpellNote` pass. ⚠ The ordinary `spellNotes` entry is keyed by literal `spellId`, which cannot express this: 252 ancestry-feat grants qualify and WHICH of them a character has is a per-character fact. Two records (`dracomancer`, heritage `spellhorn-kobold`) grant a whole spellcasting ENTRY instead of named spells and are a KNOWN, named residual — `SpellcastingGrant` carries no source id |
| `domain` | a deity's or a feat's domain access | `domains`, `alternateDomains` |
| `curriculum` | a wizard school's spell list | `curriculum` |
| `heldSpell` | an ITEM whose activation casts a spell | `heldSpells` (keyed by RANK — the rank must match the text) |
| `spellNote` | the record grants a spell and then CHANGES it — "when you cast it this way…", "except the spell has…", "you can target only yourself" | `spellNotes`, printed in that spell's description under the granting record's name (owner principle N2) |
| `innateGate` | one record grants its spells on a LADDER — *"You can cast Claim Curse. **At 10th level**, you can also cast Seal Fate, and **at 12th level**, you can also cast Inevitable Disaster"* | `InnateSpellGrant.minLevel`. Below it the grant is dropped, and so is any `spellNotes` clause the same record writes about that spell. Distinct from `heightenAt`, which scales a spell you already have; the alternatives before it existed were handing all three over at 8th (Accursed Magic) or dropping the late one (Lion's Magic) |
| `innateSwap` | the spell the record grants DEPENDS ON THE CHARACTER — *"**Special** If you have void healing, you instead cast Harm"* | `ContentBase.voidHealingSpellSwap`. Applied to the grant and to the record's own `spellNotes`, whose text has the spell's name substituted, since the clause is the same rule about a differently-named spell. Always-on paths only — a swap inside `effectChoices` would be resolved and dropped in silence |

| `innateTradition` | the sentence names the tradition it is cast at — *"as an innate **occult** spell"*, *"one cantrip from the **occult** spell list"* | `InnateSpellGrant.tradition` / `CantripPickSpec.tradition` / `traditionByOption` (per option) / `traditionFromChoiceFlag` (the player's own answer — Bone Magic's Special clause). Recorded per spell on the entry as `SpellcastingEntry.spellTraditions`, because one pooled innate entry has ONE header over spells that disagree. **`npm run scan:traditions`** keeps it at zero in both directions |
| `heightenBySkill` | a heighten ladder keyed to a SKILL, not to a level — *"If you're a master in Religion, spirit link is heightened to 3rd rank"* | `InnateSpellGrant.heightenBySkill`. A FLOOR (R7's Land Legs shape), never a replacement: a cantrip already auto-heightens to `ceil(level/2)` and the printed number can be lower than what the character has |
| `scopedRetune` | *"you can cast any innate spells you know **from an ancestry feat or heritage** using your psychic spellcasting… the spell's tradition becomes occult"* | `entryRetune.onlySources`. Retunes those spells and recomputes the entry's own tradition from the result; relabelling the entry stated something false about the background's and every invested item's spells, which share it |

⚠ **The tradition is not decoration.** With no `tradition` on a grant, `buildCharacter` falls back to
the SPELL's first listed tradition — whichever the importer wrote first — and the pooled entry's header
is a majority vote over those. That is a WRONG value, not a missing one: five records shipped saying
Arcane or Divine where their own sentence said Occult or Primal. The `own-deity-spell` naming rule
belongs here too: an open choice whose pool depends on the character MUST be named `own-*`, because two
shipped guards require every other open choice to resolve non-empty with no character.

⚠ `heightenHalfLevel` means exactly `ceil(level/2)` and **overrides `rank`**. Where the text names its
own steps ("at 5th level and every 2 levels thereafter, to a maximum of a 9th-rank charm") it is the
wrong field twice over: it reached a rank the sentence caps, and it discarded the printed base rank
underneath. Those belong in `heightenAt`, which the resolver reads as "the highest step you have
passed, never below the base" — see `test/innate-spell-verification.test.ts`.

## F. Granting other records

| lane | the text says | satisfied by |
|---|---|---|
| `grantsFeat` | "You gain the X feat" (a named one) | `grantsFeats`, `grantedFeatId`, `featFeatGrants` |
| `grantsFeatChoice` | "You gain a feat of type T, level N or lower" | `featPickGrants` |
| `grantsFeatByChoice` | which feat depends on an earlier pick | `grantedFeatByChoice` (backgrounds only) · `CHOICE_FEAT_GRANTS` + `featFeatGrantsFor` (featFeatGrants.ts) for a FEAT whose own picker decides — "your choice of the **Pet** general feat or the **Train Animal** skill feat". Falls back to the flat table when unanswered, so no saved character loses a grant |
| `grantsClassFeature` | grants a subclass/class feature | `grantsClassFeatures` |
| `grantsAction` | the record teaches a new named activity | `grantsActions` |
| `grantsStrike` | grants an unarmed attack or a weapon-like strike | `grantedStrikes`, `strikeDamage`, `unarmedTraits` |
| `companion` | animal companion, familiar, eidolon, construct, vehicle | `companionGrants` |
| `modifiesGrant` | changes what ANOTHER record already granted | `modifiesGrant` |
| `enhancement` | a second tier the record prints but only HAS while another record names it | `Feat.enhancement`, `Feat.enhancementPicker` — see below |

## G. Choices the player must make

| lane | the text says | satisfied by |
|---|---|---|
| `choice` | "choose one of the following", a named list of options | `choice`, `effectChoices` |
| `effectGrant` | an option that itself grants something | `effectChoices[].grant` |
| `dailyChoice` | chosen during daily preparations / on rest | `dailyChoices`, `advancedAlchemy`, `dailyItems` |
| `temporaryProficiency` | "During your daily preparations … gain the trained proficiency rank in one skill of your choice … until you prepare again" (or a language) | `choice { daily: true, kind: 'array' \| 'text' \| 'open' }` whose options carry `grant.skills`; the language half uses `from: { type: 'language', grantLanguage: true }`. Owned by `scripts/apply-temporary-proficiency-lane.mjs`. **7 records, all authored.** Measured by `npm run scan:daily` |
| `slotRestriction` | "**Special** You can select this feat only at 1st level" | `Feat.onlyAtLevel`, read by `eligibleFeatsForSlot` (featSlots.ts). An EQUALITY, unlike `level`, which is a floor. **28 records print it, 27 authored** — `nocturnal-grippli` is exempt because it ships as category `general` and general slots start at 3rd. Measured by `npm run scan:choices` shape A |
| `distinctAcrossTakes` | "**Special** You can select this feat multiple times. Each time, choose a **different** skill / type of terrain / type of mercy" | `FeatChoiceDef.distinctAcrossTakes`, read by `buildChoiceOptions` (build.ts). Distinct from `distinct`, which separates the picks of ONE choice def; this crosses SLOTS. Greys, never hides (Q27). **3 records.** Shape B |
| `optionGate` | an option inside a choice that has its own condition — "You must have low-light vision before you can gain darkvision **with this feat**" | `EffectChoice.options[].requiresAnySense` → `senseGateReason` (derive.ts) → the effect-choice picker in Builder.tsx. Greyed with the sentence, never removed (Q27) |
| `openAncestry` | "Choose a common ancestry **or another ancestry to which you have access**" | `choice.from = { type: 'ancestry', excludeOwn: true }` → `openChoiceOptions` (openChoice.ts). Rarity is SHOWN, not filtered: access is the GM's to grant. The ANSWER is read by `adoptedAncestryIds` (featSlots.ts), which widens the ancestry-feat slot from the level the feat was taken |

### The two shapes a choice set goes wrong in, and where the corpus stands

`npm run scan:choices` measures five shapes. Two of them are **not** in the lane table above, because
they are defects rather than lanes:

- **asked twice** — a record carrying BOTH a `choice` and an `effectChoices` that ask the same
  question. Two pickers for one printed decision, and the Feats tab printed the answer twice
  ("Elemental Wrath (Fire) (Fire)"). **30 measured; 4 had no consumer at all and their `choice` was
  deleted.** The other 26 keep both because the `choice` answer IS read — Molten Wit's and Hold Mark's
  decide a skill grant (`featGrantsLane.ts`), several feed `FEAT_SITUATIONAL`. For those, only the
  duplicated LABEL is suppressed, at `FeatsTab.tsx`'s `pickSuffix`. Deciding which of the two lanes
  should own each question is a separate pass and is **not** closed.
- **computable** — a Yes/No picker asking something the app already knows ("do you already have a base
  swim Speed"). **3 measured, all deleted**; `animal-actor`'s was answered by its own
  `conditionalSkills` entry all along.

### `temporaryProficiency` — the two ways this lane fails silently

Ruling **Q23**: a pick re-made every morning renders at **Daily preparations**, never in the builder,
and defaults to yesterday's answer.

1. **A `kind: 'skills'` menu marked `daily` is askable nowhere the player would look.**
   `askedAtDailyPrep` (`derive.ts`) accepts only `'array' | 'text' | 'open'` — `'skills'` and
   `'domains'` resolve against the BUILD — so the question falls back to the builder, where
   `'skills'` resolves through `trainedSkillOptions`, i.e. the skills you are **already trained in**.
   For a "become trained in one skill" grant that inverts the list: every option offered is a wasted
   grant and the untrained skills the feat exists to help cannot be picked at all.
2. **A daily grant must NOT also be a build grant.** These records all print *"you can't use it as a
   prerequisite for a skill increase or a permanent character option"*, and `checkPrerequisites` reads
   `character.proficiencies.skills` — the build store. Keeping the rank out of the build **is** the
   enforcement, with no extra machinery. A `FEAT_SKILL_GRANTS` entry alongside the daily choice breaks
   that rule *and* grants silently, because an unanswered `skillChoices` slot defaults to its first
   option: Ancient Memories trained an unchosen Acrobatics, Endless Memories made it expert.

Option filtering here is **Q21**, not Q27: a trained-rank grant on a skill you are already trained in
(or a language you already speak) is wasted for the whole career, with no later level that redeems it,
so the option is removed rather than greyed. `FeatChoiceDef.disableIfOwned` documents the other half of
that split.

⚠ A **Lore** skill cannot be granted this way. `kind: 'text'` is the only shape for "one Lore skill of
your choice" (the subjects are open-ended), and a text answer has no `options[].grant` for
`dailyChoiceGrants` to read — nor a row on the Skills list, whose Lore keys come from
`character.proficiencies.skills` alone. Twilight Talon Dedication is recorded, not granted, and its
`note` says so.

## H. Weapons and strikes

| lane | the text says | satisfied by |
|---|---|---|
| `weaponRider` | changes a weapon's damage, range, traits, or reload | `weaponTraits`, `strikeDamage` on the RECORD (permanent), or on a **mode** (`ModeDef.weaponTraits`) when the text supplies an off switch |
| `weaponRider` (toggleable) | the rider has a printed way to END — Agile Shield Grip's *"You can use Agile Shield Grip again to switch to a normal grip, returning the damage to the usual amount and removing the agile trait"* | `ModeDef.weaponTraits`, read by `applyWeaponRiders` (derive.ts) from `c.activeModes`, exactly as `strikeDamage` already rides there. ⚠ Authoring the rider on the FEAT is the tempting wrong fix: `DefenseGrants.weaponTraits` has no off switch, so the reduced die and the agile trait would be unconditional. A switch is a mode (**Q11**) |
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
| `recordMark` on a FEATURE | Principle C — this feat widens what ANOTHER record granted, and that other record is a **class feature**, not an action or a condition (Ancestral Blood Magic widens the bloodline's blood-magic trigger) | `RECORD_MARKERS[...] = [{ on: 'feature', id, note }]`, rendered into that record's own entry by `featEntries`' `withPicks` (FeatsTab). ⚠ The note must NOT open with its own record's name — all three renderers prefix it, and `markNote` strips a redundant one. ⚠ Target the BASE feature id (`bloodline`), not `bloodline-<subclass>`: FeatsTab's variant lookup finds no `bloodline-bloodline-draconic`, so the rendered entry keeps the base id whichever subclass was picked |
| `durationActivity` | an activity whose cost is a printed TIME rather than an action symbol — "As an activity that takes 10 minutes…" | its own `actions` record with `actionCost: {type:'duration', text}`, pointed at by the granting record's `grantsActions`. ⚠ THE TYPE EXISTED AND NOTHING RENDERED IT: `ActionGlyph`'s `default: return null` left the cost slot blank and MainTab's `isActionCost` filtered the row out, which is why zero records used it. Both are widened now, and `test/batch001-surfaces.test.tsx` fails the next time an `actionCost.type` reaches the data with no renderer |
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

### ⚠⚠ …and the reachability claim under it was ALSO wrong — corrected 2026-08-13

The paragraph that stood here read: *"Reachability was measured, not assumed: 30 deviant feats are
live and each carries `grantsClassFeatures: [<its classification>]`."* **It was not measured.** Counted
properly: 30 deviant feats, **20 carried the field and 10 did not.** Eight of the ten are the
classification feats from *Pathfinder #202: Severed at the Root* — sprout-fruit, vine-lash,
defensive-growth, disperse-into-petals (Verdant Core) and release-spores, rotten-slurry, irradiate,
unleash-the-blight (Blight Soul). The other two are the universal Awakened Power / Greater Awakened
Power, which legitimately grant none.

`ownedFeatureIds` reaches a deviant classification **only** through `grantsClassFeatures`, so **two of
the seven classifications could never be owned**, and `deriveSpecialStats` emitted neither row for
them — authored, correct, and shown to nobody. A Verdant Core deviant holding **Vine Lash** (*"Make a
melee attack roll against a creature within 30 feet"*) had no modifier printed anywhere on the sheet:
exactly the failure the attack row exists to prevent, and exactly the argument that justified the row
for Blasting Beams.

**The written measurement was itself what hid it** — a sentence claiming a count is what the next
reader trusts instead of counting. The eight grants are now authored (membership taken from each
classification's own archive record, which embeds its four feats as
`<document level="3" id="feat-NNNN" />`), and two things now fail rather than pass quietly:
`scripts/apply-special-statistics.mjs` throws if any classification has no granting feat, and
`test/special-statistic.test.ts` builds a character from a feat of EACH classification and observes the
rows. The old test asserted only that the FIELD was present, and built its runtime half from two Dark
Archive feats that both happened to grant.

Four deviant feats say only *"Make an attack roll"*, with the modifier printed nowhere else.

### `companion` — the second sentence, and the ability-budget trap

The GRANT half of this lane (a record gives you a familiar / animal companion / eidolon) has been built
for a long time. What was missing is the SECOND sentence most of these records print — the one that
modifies the companion the first sentence handed over. `FEAT_COMPANION_GRANTS`
(`src/rules/companionGrants.ts`) carries it:

| field | the text says | read by |
|---|---|---|
| `lockedAbilities` | "it always has the X familiar ability" | `deriveFamiliar`; seeded into `CompanionConfig.abilities` by CompanionsTab |
| `lockedFree` | **and** "…which doesn't count against your usual limit" / "in addition to the two you normally choose" / "instead of the normal choice" | `deriveFamiliar` (granted channel → `fromFeat`), the Edit-card budget chip, `FamiliarAbilityPicker` |
| `abilityBudget` | "you can select four familiar or master abilities each day, instead of two" | the Edit card's "N of B chosen" |
| `statAbility` | "the familiar uses your Intelligence modifier to determine its Perception, Acrobatics, and Stealth modifiers" | `deriveFamiliar` → `FamiliarBlock.perception` / `.skills` / `.statNote` |

⚠ **`lockedFree` is the trap, and it is a 5-to-4 split, not a default.** Corgi Mount, Psychopomp
Familiar, Enhanced Psychopomp Familiar, Draconic Familiar and Star Orb all print the OPPOSITE — *"which
counts against your limit for familiar and master abilities as normal"*, *"one of them must always be
the Dragon familiar ability"* — so for them the named ability is one of the player's own picks and
spends a slot. Treating every lock as free lets a corgi owner end with three abilities where the rules
give two. `npm run scan:companion-locks` reads every record's printed text and fails if the table
disagrees with it, including for two records whose clause is printed on the feat they GRANT (Spore
Order inherits Leshy Familiar's, which is how that one was found).

Two records are EXEMPT with the blocker recorded in the scanner: **Leshy Familiar** ("your choice of
either the plant or fungus familiar ability" — a CHOICE, which `lockedAbilities` cannot express without
picking for the player) and **Marine Ally** ("a swim Speed or the amphibious familiar ability" — half
the clause has no `familiarAbilities` id at all). `leaf-order` and `cultivation-order` supersede Leshy
Familiar and inherit the same blocker.

The eidolon half of the lane is `deriveEidolon`'s evolution blocks: Advanced Weaponry adds the chosen
trait to `attacks[0|1].traits` (WHICH attack is an `effectChoices` answer; the trait is the feat's own
`choice`). The animal half is `modNotes`, which is where a clause whose text depends on the OWNER's
class lands — Animal Companion (Ranger)'s hunter's edge is passed in by the caller, because the
companion block cannot see the owner's subclass.

### `enhancement` — a benefit you print but do not have until something names you

| lane | the text says | satisfied by |
|---|---|---|
| `enhancement` | *"**Enhancement** …"* — a second paragraph, gained only when another record points at this one | `Feat.enhancement { grant, strikeDieStep, choiceIds }` |
| `enhancementPicker` | *"You gain the enhancement benefits of one of your 1st- or 5th-level automaton ancestry feats"* | `Feat.enhancementPicker { choiceIds }` on the record that hands it out |

**Measured on the shipped data (`npm run scan:enhancements`):** 22 feats carry the `automaton` trait;
**19 print an Enhancement**; **18 are reachable** — Lesser Augmentation prints one and is deliberately
absent from Greater's option list, because an enhanced Lesser would open a second picker that enhances
a third feat and turn one pass into a fixed point. 4 are computed
(`automaton-armament`, `arcane-eye`, `arcane-communication`, `automaton-lore`); the other 15 keep
their option in the picker carrying a note that the benefit is prose, which is the honest **Q27**
answer rather than a silent inert control.

Three things about this lane are easy to get wrong:

1. **The payload lives on the RECORD, never on the option lists.** Nine options on Lesser plus
   eighteen on Greater would be 27 copies of 19 rules — the two-registries shape `degreeShifts` exists
   to prevent.
2. **It must not be authored as a one-option `effectChoices` picker.** `resolvePick` auto-applies a
   choice that has exactly one option even when unanswered, so every tier would be delivered
   unconditionally — the defect the lane exists to fix. Any gated choice here needs two or more
   options.
3. **`enhancement.grant` is a general grant sink**, so every corpus sweep over a grant lane has to
   walk it too (`test/innate-grant-lanes.test.ts` does). A grant lane no sweep walks is the
   write-only shape one level up.

⚠ `'lore:automaton': 'trained'` on `automaton-lore` is FLAT on purpose, and is not a defect of this
lane: the remaster clause grants the Additional Lore FEAT, whose 3rd/7th/15th skill increases are
unmodelled for **every** Lore in the app, corpus-wide.

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
