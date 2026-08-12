# The builder-side harness — spec

**Why this exists.** The owner's standing mandate has two halves: every record must be experienced
correctly *"if it is choosing the things that are supposed to be chosen **or** influencing the character
sheet in the correct way."* `scripts/feat-evidence.mjs` measures the second half well. **Nothing
measures the first.**

The 500-feat audit therefore reports a defect rate for the SHEET and says almost nothing about the
BUILDER. That gap must not be read as coverage.

## What the sheet harness cannot see

It builds a character with and without a feat and diffs derived values. It never resolves a picker. So
today these are all invisible:

- A feat that **has** a `choice` but whose option list is **wrong** — too many, too few, or the wrong ones.
- Options that should be filtered by **Ruling Q9** ("the builder shows only what the player may legally
  pick"). Domain Fluency offering all 49 domains instead of the mystery's was found by *reading*, never
  by a check.
- A feat offered to characters who don't qualify, or withheld from ones who do.
- A choice that never renders at all, so the player is never asked — the grant silently defaults.
- A choice whose answer is stored but **read by nothing**, the write-only-with-no-reader failure this
  project has hit before.

## The design — observe the outcome, not the fields

Mirror `feat-evidence.mjs`'s discipline, which is the reason it works: **drive the real resolution and
look at what comes out.** Do not read `choice` off a record and assume it renders; a lane can be
satisfied in several places and reading the representation is how measuring instruments here have lied.

For each feat, produce an evidence pack:

| field | how to get it |
|---|---|
| `presentsChoices` | the choice slots the builder would render for a character who takes it |
| `optionsPerChoice` | the actual option list for each, resolved for a concrete host character |
| `optionCount` | so an implausible list (0, or all 49 domains) is visible at a glance |
| `answerIsRead` | take the feat, answer the choice, rebuild — **does any derived value change?** An answer nothing reads is a defect however well the picker renders |
| `unansweredState` | take the feat and answer nothing — what does the sheet show? A silent default is a defect |
| `eligibleHosts` | which of a spread of reference characters may legally take it |

The choice machinery is centralised, so this needs no React: `build.ts` holds `featPicks`,
`featChoices`, `featSkillChoices`, `featLoreChoices`, `dedicationSkillFeats`,
`grantedChoiceFeatTraits`, and the per-record `choice` / `effectChoices`. `featSlots` decides which
slots exist at a level.

## The two checks worth running first

1. **A choice nobody can answer** — the record declares one and the builder renders no picker.
2. **An answer nobody reads** — the picker renders, the player answers, and no derived value moves.

Both are mechanical, need no model, and each is the kind of failure that looks like working software.

## Reading the results

Same discipline as everywhere else in this project: findings are **candidates** until verified. And an
option list being long is not automatically wrong — some feats really do offer many options. The signal
is a list that contradicts the feat's own printed restriction.
