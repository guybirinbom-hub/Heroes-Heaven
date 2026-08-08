# The feat text audit — standing spec

**Status: scaffolding built, gold set in progress, full read NOT started.** Written 2026-08-07,
paused 2026-08-08.

---

# ▶ RESUME HERE

## Where we stopped

The method is settled and the scaffolding exists. What remains before the full read is the **gold
set** — the hand-adjudicated measuring stick, which the owner must personally review because a single
wrong exemplar propagates into all 6,179 feats.

### Built and verified

| artifact | what it is |
|---|---|
| `scripts/feat-audit-sample.mjs` | draws the **frozen 500**, seed 20260808. `--check` fails loudly if the committed file drifts. |
| `scripts/audit/feat-500.json` | the frozen 500. Drawn from 6,179 (excludes the 27 unreadable). **Never redraw.** |
| `scripts/audit/feat-text-defects.json` | 27 feats whose whole text is "You gain the benefits." — the basic/expert/master rungs of 14 archetypes. Excluded from sampling; **come back and resolve each parent archetype's text in.** |
| `docs/mechanic-lanes.md` | the 68-lane vocabulary, phrased by what the TEXT says. |
| `scripts/lane-gap-diff.mjs` → `scripts/audit/lane-gaps.json` | one-way Foundry diff. **9 systems with no route, ~289 records.** |
| `scripts/feat-evidence.mjs` → `feat-500-evidence.json` | differential sheet-diff harness. For VERIFICATION only — not for requirement extraction. |
| `scripts/gold-set-candidates.mjs` → `gold-candidates.json` | 43 stratified gold candidates, 8 exemplar / 35 test. |
| `scripts/audit/gold-text-only.json` | contamination-free reader input (id/name/level/text only). |
| `scripts/audit/gold-freetext.json` | the 183 requirements no lane could express. |

### The extraction result (2026-08-08)
Three diverse lenses over the 43, text only: **416 requirements. 233 fit our 68 lanes. 183 (44%)
needed free text.** Only 28 of 68 lanes were used at all.
⚠ **Do not read 44% as the corpus rate** — the candidates were stratified toward hard shapes. It says
that when a feat is complicated, the vocabulary runs out about half the time.

### ⚠⚠ The clustering result — 44% free text did NOT mean 44% missing systems

`scripts/audit/system-candidates.json`. The 183 free-text requirements clustered into **108 proposed
systems; adversarial pruning killed 106.**

| refutation | n |
|---|---|
| **already-expressible** — an existing lane covers it, the reader just didn't know | **85** |
| not-one-system — the cluster conflated unrelated capabilities | 13 |
| out-of-scope — another creature's sheet, GM adjudication, or VTT geometry | 8 |
| **survived** | **2** |

The survivor worth acting on: **resistance-stacking exceptions** — a named per-source exception to
PF2e's take-the-highest rule, where a gate junction's resistance and Thermal Nimbus's must ADD, with
both sources shown.

**The lesson is about the reader's briefing, not the app.** Readers produced free text at 44% because
`mechanic-lanes.md` never told them (a) the full set of lanes in enough operational detail, and above
all (b) **the project's DECIDED SCOPE BOUNDARIES** in `work/rulings/DECISIONS.md`. Ruling F settles
ally-facing effects — "if it's an effect that affects a teammate and not you then don't do anything" —
and Ruling M settles auras, because emanation membership depends on where you stand and the app has no
positional model. Readers kept "discovering" those as missing systems. **Before the full read,
`mechanic-lanes.md` must absorb the rulings.** Otherwise ~85% of what the audit surfaces will be noise.

⚠ The pruner was instructed to **default to refuting**, so 2 is a floor, not a count. And this does not
touch the nine systems from `lane-gaps.json` — those came from Foundry's rule elements, are separately
evidenced, and stand.

Cost of that run: 111 agents, 9.9M tokens, 69 minutes.

### Next actions, in order

0. **Fold the rulings into `docs/mechanic-lanes.md`** (see above). Highest value, cheapest, and every
   later step inherits the benefit.
2. **⚠ FIX the inert stratum — it is currently wrong.** It was selected as "our app carries nothing
   AND Foundry carries nothing", which correlates with *unbuilt*, not with *needs nothing*. Robust
   Recovery increases a circumstance bonus; Energetic Resonance is a reaction that spends a spell slot
   for resistance; Pheromonal Message is an action. **So the gold set has no true-negative controls and
   over-flagging cannot yet be measured.** True controls must be chosen by TEXT CHARACTER — content
   that is purely enemy-facing, ally-facing, or GM-adjudicated — because field absence cannot find them.
3. **Adjudicate the 43** into gold answers: merge the three lenses, cross-check against Foundry rule
   elements and against what our records carry, mark confidence, drop anything uncertain rather than
   guess.
4. **Owner reviews the 43.** Each entry shows the text, the extracted requirements, both sources'
   claims, and the reasoning — in a form that is easy to correct. This is the step that gets to "not
   one mistake"; it cannot be delegated.
5. **Then the full read**: all 6,179 feats, clause-level, batches of ~5, escalate on signal,
   calibrated against the gold set. ~80M tokens, 1–2 days.

### Traps already paid for — do not re-learn these

- **`buildCharacter` does NOT return the sheet.** It returns the stored character. Senses, AC,
  resistances, speeds, strikes and situational notes are computed by `derive.ts` and appear nowhere on
  it. Diffing the stored object reported "changes nothing" for 18 of the first 20 feats.
- **Search record fields at ANY depth.** A shallow top-level + `passiveEffects` check called Natural
  Senses and Magical Resistance empty; both hold their mechanic inside `effectChoices[].grant`.
- **Foundry's ItemAlteration / ActiveEffectLike / RollOption are mostly plumbing** (match-tags on
  spells, Foundry flags, VTT toggles). 1,299 records — **never quote as gaps** without per-record triage.
- **Foundry silence means nothing.** 3,537 of our feats exist there with zero rule elements; only 39%
  carry usable mechanics. Their prose is never used.
- **Haiku 4.5 is disqualified**: 87.5% verdict agreement (needed 95%), 6% missed-defect rate (needed
  2%), and it silently returned only 368 of 500 with one agent inventing 64 verdicts for a 50-feat range.
- **Assert one result per feat and fail loudly.** Haiku's shortfall looked like clean coverage.
- `npx jiti` is required for scripts importing `.ts`; jiti cannot parse `.tsx`, so `isActionCost` is
  inlined in `feat-evidence.mjs`.

---

## The ask, in the owner's words

> Go over the text of every feat in the game and make sure the app implements the things that feat is
> supposed to do to the character sheet using the correct systems. If the feat isn't using all of the
> systems it should and there are things it should be doing and the app ignores them, flag it. If
> there are things it shouldn't do and the app does them with this feat, flag it. If it requires a
> change to the character sheet we don't have in the app, flag it. We need this audit over every feat
> in the game and you will go over the text of each feat.

## Scope

**Every live feat — ~6,206 records.** Not a sample. Not a filtered subset. Each feat's own printed
text is read, one at a time.

"Live" means: not an `aon-` scrape duplicate, not in `duplicateIds` or `umbrellaIds`, not
`edition: 'superseded'`. Those are unreachable and cannot be defects.

## The four verdicts

Every feat ends in exactly one:

| verdict | meaning |
|---|---|
| **correct** | everything the text promises happens, through the right lane, and nothing extra happens |
| **missing** | the text promises an effect the app does not deliver |
| **spurious** | the app does something with this feat the text does not call for — a wrong lane, a wrong bonus type, an effect that fires always where the text says sometimes, a value the text never states |
| **no lane** | the text needs a sheet system this app does not have |

`missing` and `spurious` are equally in scope. **Using the wrong system counts as a defect even when
the sheet number happens to come out right** — a circumstance bonus where the text says status is a
`spurious` finding, because it stacks differently.

## Method — the layers are EVIDENCE, never a FILTER

This is the load-bearing design decision and it was got wrong once in planning.

A cheap deterministic pass **must not clear any feat from review.** Presence-and-number checks cannot
see the *kind* of an effect, so a feat that moves the right number onto the wrong stat, or applies a
bonus unconditionally where the text conditions it, passes a filter silently. That is precisely the
failure class this audit exists to catch.

Instead, precompute per feat and hand it to the reader as evidence:

1. **The observed sheet diff** — build a reference character that can own the feat, build it again
   with the feat, diff every derived value (stats, skills, AC, saves, resistances, senses, speeds,
   actions, spells, notes). This states what the feat *actually does*, observed rather than inferred
   from fields. It also dissolves the "a lane can be satisfied in six places" problem — no need to
   know where something is implemented when you are watching the outcome.
2. **Extracted numbers** — every number in the text (resistance 5, +2 status, 3/day, 60 feet,
   8th-rank) paired with the matching field value.
3. **The record's stored fields** and any `src/rules/` registry entry keyed by its id.

The reader then answers one question: **does the observed behaviour match the text, through the right
system?** It is not exploring the codebase, which is what keeps the per-feat cost down.

Lane vocabulary: [`docs/mechanic-lanes.md`](./mechanic-lanes.md) — 68 lanes, the two known-missing
ones, and the explicit not-a-lane list (flavour, GM adjudication, enemy-facing effects, the internal
steps of an action).

## Prerequisites — build these first

- [ ] **Differential build test.** Does not exist yet. `orphan-features.mjs` proves a record can be
      *owned*; nothing proves owning it *changes* anything.
- [ ] **Number extraction** from feat text.
- [ ] **Calibration.** Before trusting any run at scale, measure the reader against records with known
      answers — the 122 adjudicated in the sample (`scripts/audit-sample.mjs`, seed 20260807) and the
      ground-truth set behind `verify-characters.mjs`. Report its precision and recall as a number.
      Every prior instrument in this project that skipped calibration turned out to be lying.

## ⚠ Reframed 2026-08-08 — this is a SPECIFICATION pass, not a comparison

The owner's goal is **a concrete list of the systems we need to build**. That question is answered
from a feat's text alone; what the app currently does is irrelevant to it.

The first bake-off got this wrong: it handed readers the observed sheet diff, which turned "what does
this feat require?" into "does the app already do this?". That is actively harmful here — a feat
needing a system we have never built produces an empty diff, indistinguishable from a feat that is
legitimately inert. The cases that should populate the build list are exactly the ones the diff hides.

**Two passes, strictly separated:**
1. **Requirements — text only.** No diff, no stored fields, no registries. Per feat: what must a
   character sheet be able to express for this to work?
2. **A mechanical join** of those requirements against the 68 lanes in `mechanic-lanes.md`. Anything
   unmatched clusters into the systems list.

The sheet diff still has a job, but *after* the list exists and for a different question: does lane Y
actually fire for feat X. That is verification, not discovery.

### Agreed design (owner-approved 2026-08-08)

1. **Classify CLAUSES, not feats.** Split each text into individual mechanical clauses and state a
   requirement per clause. Partial coverage was the dominant error — Kin Hunter delivered its Recall
   Knowledge bonus but not its damage bonus; Ironblood Stance delivered neither its Strike nor its
   resistance yet passed because the stance action appeared. A feat-level verdict cannot express
   "two of three clauses".
2. **A hand-adjudicated GOLD SET (~40 feats) is the prerequisite for everything else** — without it
   "more accurate" is unfalsifiable. ⚠ Split it: some feats as worked examples in the prompt, a
   **held-out remainder as the test**. Using the same feats for both contaminates the measurement.
3. **Escalate on signal, don't read everything three times.** One reader by default; a second and
   third only on long text, multiple clauses, use of the free-text escape, or self-reported low
   confidence. ~1.3x cost rather than 3x. The gold set decides which shapes trigger escalation.
   Where multiple readers ARE used, give each a different lens (what numbers change / what the player
   must choose or track / what has no field at all) — identical readers correlate their mistakes.
4. **"None of these fit" is a first-class answer.** Require the lane keys where they fit AND a
   mandatory free-text field otherwise, with the prompt encouraging its use. Clustering that free text
   is how a missing system gets named and sized by the data rather than by an author's guess.
5. **Supply referenced definitions and parent text** — glossary entries for terms a feat leans on
   (off-guard, Recall Knowledge, Tumble Through), and the parent record where a feat says "you gain
   the benefits of X". Both are source data, so neither contaminates the way the diff did.
6. **Batches of ~5**, and assert exactly one result per feat with a loud failure otherwise.

## Gate: the 500-feat model bake-off (owner's instruction, run FIRST)

Before the full pass, run **500 random feats through two models of different tiers**. If the results
match, the full audit uses the cheaper one.

Design points that decide whether this answers the question:

1. **Identical input to both.** Same precomputed diff, same prompt, same `mechanic-lanes.md`, same
   feats. Otherwise it measures prompts, not models. Run independently — neither sees the other.
2. **Agreement is measured on the VERDICT** (correct / missing / spurious / no lane), not on the
   wording of the reason. Expect near-zero agreement on free text; do not measure it.
3. **⚠ Score the two disagreement directions separately — they are not equally costly.**
   - *cheap says correct, strong says defect* → a **missed defect**, invisible, and the whole point of
     the audit. This is the number that decides the question.
   - *cheap says defect, strong says correct* → an over-flag, absorbed by triage. Cheap to tolerate.
   A model that over-flags twice as often but never misses is the better buy.
4. **Agreement is not correctness — both can be wrong together.** Include a third leg: seed the 500
   with records that have known answers (the 122 adjudicated at seed 20260807, plus
   `verify-characters.mjs` ground truth) and report each model's **accuracy against those**, not just
   concordance with each other.
5. **Set the threshold before running**, or it gets argued afterwards. Proposed: adopt the cheaper
   model if verdict agreement ≥95% **and** missed-defect rate ≤2%.
6. **Consider three tiers, not two.** Haiku 4.5 / Sonnet 5 / Opus 5 on the same 500 costs barely more
   than two and shows *where the cliff is* rather than just whether one pair happens to match.
7. **Two cheap passes with different prompts may beat one expensive pass** at the same price. Worth
   measuring in the same run if the cheap model turns out to over-flag rather than miss.

Sample: `scripts/audit-sample.mjs` with a fresh seed, feats only, n=500.

## Cost

Measured, not guessed — from the 122-record run on 2026-08-07 (12 agents, 1.28M tokens, ~22 min):

- ~10k tokens per record exploring from scratch; **~5–6k with the diff precomputed**
- **~80M tokens total**, one to two days of wall clock in parallel batches
- The staged alternative (cheap layers as a gate, ~3,000 records read) costs ~30M — but it is a
  different, weaker audit and does **not** satisfy this ask. Do not substitute it.

## Output

One row per feat: id, verdict, the clause of text at issue, the observed sheet behaviour, the lane it
should use, and the fix. `no lane` findings cluster — group them, because a single missing lane
covered 551 items last time and building one lane is a day's work that fixes hundreds of records.

## Known limits — state them in the final report

- Bounded by the reader's Pathfinder rules knowledge. Calibration measures this; it does not remove it.
- **The source text is sometimes wrong.** AoN has Judgment Thurible's grades transposed and spellhearts
  printing the same resistance at all three tiers. Matching bad text perfectly still yields a wrong app.
- Feats are ~6,206 of ~17,500 live records. Items measured *worse* than feats in the sample (18% vs 9%).
  This audit does not cover them.
