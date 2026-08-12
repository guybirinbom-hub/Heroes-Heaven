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

---

# The merge — one evidence pack per feat (2026-08-12)

The harness above was built and ran, and the audit still never saw it: `scripts/audit/audit-500.js`
pointed at the sheet half alone. **`scripts/merge-evidence.mjs`** joins them.

```
npx jiti scripts/feat-evidence.mjs      # sheet half   -> scripts/audit/feat-500-evidence.json
npx jiti scripts/builder-evidence.mjs   # builder half -> scripts/audit/builder-500-evidence.json
node scripts/merge-evidence.mjs         # both         -> scripts/audit/audit-500-evidence.json
```

The two producers stay separate — each is independently useful and independently testable, and either
can be regenerated alone. The merge **measures nothing of its own**. It adds three things:

1. **The sheet half's field names are unchanged** (`sheetDiff`, `storedFields`, `registries`,
   `textNumbers`), and the builder half arrives under `builder`. An existing reader briefing still works.
2. **`crossChecks`** — the facts that need both halves to be true or false, because neither producer can
   state them alone:

   | fact | why one half cannot say it |
   |---|---|
   | `sheetSilentButBuilderAsks` | an empty diff on a feat that ASKS something is an effect waiting on an answer, not an inert record. **34 of the 162 empty diffs in the frozen 500 are this shape** — every one of them was reading to the auditor as "changes nothing". |
   | `silentOnBothHalves` | changes nothing *and* asks nothing. 128 feats. The strongest candidate — and still only a candidate, because DECIDED SCOPE and the harness limits produce this shape legitimately. |
   | `sheetSilentAndNoAnswerRead` | it asks, and no answer moves anything either. 14 feats. |
   | `answerDeadButSheetMoves` | the feat works and the ANSWER is decorative. 5 feats — the Q20 / Round-5 shape (Eidetic Ear, Weight of Experience), where the correct answer is a `*` on the chosen skill, not a number. |
   | `declaredWithoutPicker`, `pickerWithZeroOptions` | the spec's two mechanical checks, hoisted so a scan finds them. Both 0 today. |

3. **`harnessLimits`** — per feat, the limits that apply, each carrying the evidence that triggered it.
   The audit prompt used to list two of these as caveats a reader had to remember; they are now facts in
   the pack. A pick-a-feat grant no longer just *claims* its empty diff is expected — the builder half
   sits beside it showing the picker and its 86 options.

   ⚠ **A limit explains an absence of evidence. It never establishes that a feat is correct.** Ranged
   Combatant carries `companion-tab` and is a defect the owner has already ruled on.

## ⚠ It refuses to merge two halves that do not describe the same app

Both inputs are derived files, and a merge across one fresh half and one stale one is a measuring
instrument that lies — the failure this project has paid for four times. So:

- each half's mtime is checked against `public/core.json`, `public/core-descriptions.json`, `src/rules/`,
  the frozen sample, and its own producer. Older than any of them ⇒ **exit 1** with the regeneration
  command (`--allow-stale` overrides and records `stale: true` in the output header);
- a half that is **short** is a hard failure listing the feats it lacks, never a total that happens to
  look plausible. `--allow-partial` overrides, and every pack records which halves it has.

`scripts/data/effect-backfill.json` is deliberately not a staleness input: it only reaches a built
character through `npm run data`, which rewrites `core.json`, so listing it would report staleness for an
edit that has not been imported yet.

`test/merged-evidence.test.ts` pins the merge, including one guard that the fields the verify prompt
tells the reader to read are fields the pack actually has — the prompt is a string in one file and the
pack is JSON from another, and nothing else connects them.

---

# Re-running the audit cheaply — the cache (2026-08-12)

**The first run cost 17.4M tokens because it reads every feat twice.** Two properties of the audit's own
design make most of that recoverable, and both are now built:

1. **A requirement is derived from the TEXT ALONE.** Phase 1's prompt tells the reader it has no
   information about any app and must not speculate — so building a lane, fixing a registry or
   regenerating `core.json` cannot change a single requirement. Only the feat's own text can.
2. **A verdict only needs redoing where the EVIDENCE moved.** Building one lane moves the evidence for a
   few hundred feats, not for all of them.

```
npm run evidence                             # both producers + the merge, as before
node scripts/audit-cache.mjs plan            # what still has to be asked, and why
Workflow({ scriptPath: 'scripts/audit/audit-500.js', args: <scripts/audit/audit-500-args.json> })
node scripts/audit-cache.mjs apply <run.json># fold the answers back in, assemble all 500
```

With no `args` the workflow runs exactly as it did before the cache existed. `plan --force` ignores the
cache; `plan --briefing-ok` is the only way to reuse across a changed briefing, and it is meant to be a
decision somebody makes rather than a default.

## What each hash is taken over — this is the whole design

A cache is the one optimisation that can leave an audit **worse off**: a hash over anything but what the
reader actually saw serves a stale answer for changed input, and a stale verdict is indistinguishable
from a fresh one in the report. So:

| hash | taken over | why exactly that |
|---|---|---|
| `textHash` | the pack's `text` field | the only field phase 1 is allowed to read |
| `evidenceHash` | the **whole pack**, as written to disk | phase 2 reads the feat's "full entry". A curated subset is a list of the fields somebody remembered, and the forgotten one is the one that goes stale |
| `briefingHash` | the two prompts, the constants they interpolate, and every document they send the reader to open | a new ruling in `gold-set-answers.md` can change every verdict in the file |

Three invalidation rules follow, and each is a test in `test/audit-cache.test.ts`:

- changed text ⇒ **both** phases recompute (a verdict judged from requirements that are about to change
  is not evidence of anything);
- changed evidence ⇒ the verdict recomputes, the requirements are **reused** — this is the saving;
- a verdict is stamped with the hash of the requirements it was judged from, so requirements that moved
  without the text moving still invalidate it.

⚠ **What the briefing hash deliberately does not cover**: the short per-batch tail the workflow appends
("Your feats are the feats at indices …"). Hashing the whole script instead would invalidate every
cached answer whenever a comment changed, which in practice means nobody uses the cache. Rewrite that
tail and you re-plan with `--force`.

## The two accounting properties that keep it honest

- **The workflow's output is short by design** under a plan — it holds only what was recomputed, and
  says `partial: true`. The complete 500-feat answer is assembled from the cache by `apply`, which names
  every feat with no verdict (`missingVerdicts`) and every verdict whose evidence has since moved
  (`staleVerdicts`). A cache makes Haiku's silent-shortfall failure *easier*, not harder: an absent
  result and a reused one both look like "no agent ran".
- **`apply` refuses results whose evidence moved while the run was in flight.** The run takes an hour;
  regenerating evidence during it and folding anyway would stamp a verdict with the hash of a pack the
  reader never saw, and poison the cache permanently.

The workflow now also returns **every** verdict rather than only the defects. The 2026-08-11 run counted
136 correct and stored none of them, so nothing could be reused and the pile could not be re-examined.

## Measured before a token is spent

Both producers stamp each pack with its own hash and report how many changed since the previous run;
the merge reports the same across the merged packs. So `npm run evidence` now ends with the number that
decides whether to launch the audit at all — *how many feats did my change actually move?*

## ⚠ The 2026-08-11 requirements were NOT seeded into the cache, and why

Seeding them would have made the next run's phase 1 free. It was rejected as unverifiable: `core.json`
was rewritten after that run, the evidence file it read has been overwritten since and is not in git, so
there is no way to prove the text those requirements were derived from is the text in the pack today.
The one check available — do the reader's quoted clauses still appear in the current text? — cannot
settle it either: of the 500, **427 have no quoted span long enough to test**, 33 match in full and 38
match partially, the partials being the readers' own ellipses rather than evidence of drift.

Storing them keyed by today's text hash would be exactly the failure this design exists to prevent. The
first re-run therefore pays for phase 1 once more and every run after it does not.
