# WP5 — class trainings above 1st level, and the clause each prints (plan D14)

Tracked evidence for skill-order WP5 (plan work/skill-rank-level-by-level/plan.md, WP5 step 1). Made 2026-10-22 in the
lane `skillorder` by a read-only scratch script over the lane's content (public/core.json + core-descriptions.json,
the same `content()` the tests load): every class option (subclass option or extra-choice option) that trains a
skill or a Lore and is picked above 1st level (`subclassAnchorLevel`, `extraPickLevel` over every pick index), plus
every class feature that trains a skill above 1st level. The clause column quotes the record's OWN text, or the text
of the feature that asks the question (Root Epithet's "as normal" covers its six epithets); each quote was re-read on
the local AoN mirror (`C:\wonderers guide\aon-2e-archive\data\by-category\`), and "—" means neither text has an
"already trained" sentence there.

Only rows with a clause get the replacement judge (D14). test/skill-rank-level-order.test.ts ("WP5: the class
trainings that owe a replacement") holds `classTrainingClauseOptions(content)` (src/rules/build.ts) to EXACTLY the
clause rows of the first table, so a row added here without code, or code without a row, is red.

## Judged: the option's training owes a replacement when the skill is already trained (clause)

| id | class / group (feature) | level | skill | clause quoted | AoN doc id |
|---|---|---|---|---|---|
| the-brave | exemplar root-epithet (root-epithet) | 3 | athletics | "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal." | epithet-1 / class-feature-1066 |
| the-cunning | exemplar root-epithet (root-epithet) | 3 | deception | "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal." | epithet-2 / class-feature-1066 |
| the-deft | exemplar root-epithet (root-epithet) | 3 | thievery | "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal." | epithet-3 / class-feature-1066 |
| the-proud | exemplar root-epithet (root-epithet) | 3 | intimidation | "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal." | epithet-4 / class-feature-1066 |
| the-mournful | exemplar root-epithet (root-epithet) | 3 | diplomacy | "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal." | epithet-5 / class-feature-1066 |
| the-radiant | exemplar root-epithet (root-epithet) | 3 | diplomacy | "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal." | epithet-6 / class-feature-1066 |

## Not judged: above 1st level, no clause in its own text (plan 7.3 item 5b — no replacement, as today)

| id | class / group (feature) | level | trains | clause quoted | AoN doc id |
|---|---|---|---|---|---|
| crafter-in-the-vault | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:architecture, lore:engineering | — | apparition-3 / class-feature-1037 |
| custodian-of-groves-and-gardens | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:farming, lore:herbalism | — | apparition-4 / class-feature-1037 |
| echo-of-lost-moments | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:fortune-telling, lore:genealogy | — | apparition-5 / class-feature-1037 |
| impostor-in-hidden-places | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:fortune-telling, lore:underworld | — | apparition-6 / class-feature-1037 |
| lamentation-of-sinister-deals | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:legal, lore:scribing | — | apparition-16 / class-feature-1037 |
| lurker-in-devouring-dark | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:ocean, lore:sailing | — | apparition-7 / class-feature-1037 |
| monarch-of-the-fey-courts | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:art, lore:fey | — | apparition-8 / class-feature-1037 |
| reveler-in-lost-glee | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:circus, lore:fortune-telling | — | apparition-9 / class-feature-1037 |
| shepherd-of-errant-winds | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:sailing, lore:scouting | — | apparition-14 / class-feature-1037 |
| speaker-in-sibilance | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:fortune-telling, lore:mountain | — | apparition-15 / class-feature-1037 |
| stalker-in-darkened-boughs | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:forest, lore:hunting | — | apparition-10 / class-feature-1037 |
| steward-of-stone-and-fire | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:mountain, lore:volcano | — | apparition-11 / class-feature-1037 |
| vanguard-of-roaring-waters | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:mountain, lore:river | — | apparition-12 / class-feature-1037 |
| witness-to-ancient-battles | animist apparition (apparition-attunement) | 7/15 (also 1) | lore:battlegrounds, lore:heraldry | — | apparition-13 / class-feature-1037 |
| expert-overdrive | inventor class feature (FEAT_GRANTS row) | 3 | crafting (expert) | — | class-feature-484 |
| master-overdrive | inventor class feature (FEAT_GRANTS row) | 7 | crafting (master) | — | class-feature-493 |
| legendary-overdrive | inventor class feature (FEAT_GRANTS row) | 15 | crafting (legendary) | — | class-feature-503 |

Notes:
- No class FEATURE record carries `grants.skills` (0 in content); a class feature's skill training rides a
  FEAT_GRANTS row and is judged by the feat proficiency pass with that row's own `redundantFallback` flag (unchanged
  by WP5). The three Overdrive rows are rank raises of a skill the inventor already trains, so "already trained" has
  nothing to answer there.
- Every subclass option that trains a skill is anchored at 1st level (92 options: druid orders, rogue rackets,
  witch patrons, sorcerer bloodlines, …) and every other extra-choice group with skill grants opens at 1st: those are
  creation trainings and keep today's class-pick skip (D14, "Level 1 keeps today's class-pick skip").
- Kineticist elements added at a Gate's Threshold (5/9/13/17) and thaumaturge implements opened at 5/15 train no
  skill.
- The apparitions train LORES: their rows are listed for completeness; neither the apparition entries nor
  Apparition Attunement (class-feature-1037) prints an "already trained" sentence, so a future correctness pass
  decides them (plan 7.3 item 5b).
