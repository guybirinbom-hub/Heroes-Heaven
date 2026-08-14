# Heroes Heaven — read this before you act

This file loads automatically. It exists because sessions kept starting work without the context that
decides whether the work is right, and then had to be undone.

## ▶ IN FLIGHT (2026-08-13, late) — applying the owner's Round 11 rulings

Tree is coherent: `tsc` clean, **3,372 tests / 328 files pass**, everything **UNCOMMITTED** on top of
`71f1536`. Nothing below needs the owner. Keep going.

### 🔧 THE TOOLING THE OWNER ASKED FOR (2026-08-13)

> "we need to make the tools that implenet them efficant so future feats can be implemented easily"

**`npm run feat -- <id>`** (`scripts/feat-doctor.mjs`) answers, in seconds, the four questions every fix
used to start with by hand: what the record SAYS, what the app DOES with it, which of 92 authoring
scripts OWNS it, and whether each authored field has a READER in `src/`. It reproduced the audit's
`adopted-ancestry` finding in one command instead of 47k tokens. Add `--no-evidence` for data only,
`--json` for machine output. It works on any collection: `npm run feat -- heritages/swimming-animal`.
Both evidence harnesses now take `--only <ids>`, which is what makes it fast.

**`npm run scan:text`** (`scripts/scan-damaged-descriptions.mjs`) finds descriptions the importer
damaged — a value dropped and the sentence left grammatical, so it reads as finished and is wrong
("races away from you in a ." was "in a 60-foot line"). **866 of 19,245 descriptions** carry one of five
shapes. This is a live player surface: MainTab's action popup renders `description` through RichText
with no ast key. Repair one by adding it to `scripts/apply-import-damaged-text.mjs`, which writes BOTH
the overlay row (durable) and `public/core-descriptions.json` (live) — the documented
"append a row then run import-siege-and-gaps" shortcut does NOT work for this field, because
`split-descriptions.mjs` sees a handful against 19k and exits rather than write.
⚠ Two shapes were tried and REMOVED for false positives: "double space mid-sentence" matched 2,018 and
was detecting the scanner's own newline normalisation; a bare "takes damage" matched correct prose
("whenever the ward takes damage"). The first count was 2,897 and it was wrong. Anchor a shape on
something impossible in correct English, never on whitespace.

**`test/authoring-guards.test.ts`** catches the two ways a fix silently fails to exist — a field with no
reader, and a value in a file that gets rewritten. On its first run it found two orphan fields (both
turned out to be principled exemptions, now encoded).

⚠ **`src/rules/situationalBonuses.ts` HAS NO SINGLE OWNER** — a dozen-plus scripts parse it, splice
their entries in and write it back, so whichever ran last decides its contents. Consolidating it to one
writer is the highest-value tooling job left. (No exact writer count is asserted anywhere: three
detections gave 3, 14 and 24, because "writes this file" is genuinely hard to tell from "reads it and
writes something else". Don't pin a number you can't measure.)

**CORRECTION to an earlier claim in this file: hand ADDITIONS to that registry DO survive.**
`apply-situational-lane.mjs` builds `existingIds` from the live file (line 29) and skips any id already
present (line 49, `alreadyAuthored`), so a new entry hand-written into the pre-banner regions
(FEAT_SITUATIONAL 85–432, CHOICE_SITUATIONAL 3243–3260, RECORD_MARKERS 3332–3465) is left alone.
**It is DELETIONS that die** — remove an id from the file and the generator puts it straight back. So
R2's removals belong in that script's exclusion list; R2's additions can be authored directly.

⚠⚠ **`scripts/aon-verify/apply-reviewed.ts` REWRITES THREE src/ FILES WHOLE** — `featGrantsAuto.ts`,
`featFeatGrants.ts`, `featCantripGrants.ts` — by keeping each file's header and regenerating the map
from a serialiser. It was **a loaded gun**: the serialiser emitted four keys and dropped the rest, so
running it would have stripped a field from **120 of 321 grants** (72 × `redundantFallback`,
30 × `weaponFamiliarity`, 8 × `armor`, 7 × `rankUpgrade`, 5 × `weapon`, 1 each `save`/`minLevel`) with
no error and no diff. That matters because cluster 1's fix adds 68 more `redundantFallback` flags to
that very file.

FIXED: the serialiser is now generic (it walks whatever is there rather than enumerating keys) and
every record is **round-tripped before write** — it throws rather than losing a byte. Verified lossless
on all 321. ⚠ Note `scripts/aon-verify/*.ts` are **.ts, not .mjs**, so `test/authoring-guards.test.ts`
does not scan them; that is a gap in the guard, not an absence of hazard.

⚠ **DO NOT IMPORT `scripts/aon-verify/apply-*.ts` TO INSPECT IT.** They are top-level scripts, not
modules — importing one RUNS it and it writes those three files. Done accidentally once; the changes
were reverted with `git checkout --` after a semantic diff confirmed what they were.

### ⛔ THE RHYTHM THE OWNER SET (2026-08-13) — audit 100, FIX those 100, then the next 100

> "i want that we stop after each 100 and make them work in the app correctly then do the next 100"

**Never cut the next batch while the current one has open findings.** The audit only JUDGES; it fixes
nothing, and the backlog it produces is a bigger job than the audit that produced it. Batch 1 found 83
defects in 100 feats — cutting batch 2 first would grow that faster than it closes.

So the loop is: cut batch → generate evidence → run the audit → **fix every finding** → only then cut
the next batch. If you are ever unsure what to do next and the current batch has findings open, the
answer is fix them.

**THE AUDIT HAS STARTED AND ITS FIRST BATCH IS DONE.** Level-ordered, lowest level first — not the
frozen 500, which survives only as the instrument for "did the rate move".
- `scripts/audit/batch-001.json` — 100 level-1 feats, indices 0–99 of 6,179 live. **Batch 2 starts at
  `--from 100`**: `node scripts/feat-audit-order.mjs --from 100 --count N --out scripts/audit/batch-002.json`.
- `scripts/audit/batch-001-result.json` — **14 of 100 fully correct.** 65 missing, 17 spurious, 1
  no-lane, 3 uncertain (settled by the owner as R1–R3). Split: 45 sheet-only, 28 both, **10 builder-only**.
- ⚠ **Do NOT compare that with the 500's 27%.** That run read sheet evidence only; zero of its 342
  defects even carry a `half`. It is not a baseline.
- The instrument is `scripts/audit/audit-batch.js`, DERIVED from the frozen `audit-500.js` by
  `scratchpad/derive-audit-batch.mjs` so the prompts cannot drift. Regenerate evidence first —
  `npx jiti scripts/feat-evidence.mjs --in <batch> --out <…-sheet-evidence.json>`, the same for
  `builder-evidence.mjs`, then `node scripts/merge-evidence.mjs --sheet … --builder … --sample … --out …`
  — then `Workflow({scriptPath, args:{sample, evidence, total}})`.

**The owner's rulings are `docs/gold-set-answers.md` → Round 11 (R1–R9).** Read them before touching
any of this. R9 records a mistake worth not repeating: never spend a ruling on a question whose options
are all correct — decide it and say so in one line.

### ⛔ EVERY FINDING BECOMES A GUARD, NOT A PARAGRAPH

> "all these probloms you find you need to make sure you wont do in the futiure telling me wont make me
> fix them"

A hazard written down is a hazard that recurs. When you find one, build the thing that stops it and
only then write the sentence. What is now ENFORCED rather than documented:

| was a warning | is now |
|---|---|
| "importing an `apply-*.ts` runs it" | `scripts/aon-verify/_entry-guard.ts` — every writer throws on import; a test asserts none is missed. Proven by re-running the exact mistake |
| "the serialiser drops fields" | it round-trips every record and throws rather than lose a byte |
| "866 damaged descriptions" | `npm run scan:text` + a ratchet test — the number may only go DOWN |
| "84 grants are missing `redundantFallback`" | `npm run scan:fallback` + a guard that fails at one |
| "a repaired description might not reach the overlay" | a test that fails when the two disagree |

Three CLI tools, all `npm run`: **`feat -- <id>`** (what a record says, does, who owns it, what has no
reader), **`scan:text`**, **`scan:fallback`**.

### ▶ BATCH 1 IS FIXED — 90 of 83 findings closed (2026-08-14)

All ten clusters applied, each by one agent and then INDEPENDENTLY verified by another.
`scripts/audit/batch-001-applied.json` holds the full record. Suite went 3,388 → 3,640.

- **90 landed · 122 confirmed · 62 NOT defects · 38 deferred with a stated blocker · 9 problems**
- The 62 matter as much as the 90: more than a third of what the audit flagged was correct, and each
  was checked against the printed rules before being dismissed rather than "fixed".

**5 of the 9 verifier problems are still open** (4 fixed, see below). They are in the `problems` array
of that file, with the measurement that found each. Do these before cutting batch 2:
  · **bardic-lore** — the builder card still shows the disabled option selected, and the "Learn a new
    lore" free-text path bypasses the disabled option entirely.
  · **builder level card duplicates its upgrade line** — `additional-lore` can appear twice in
    `character.feats`, and Builder.tsx:1495 keys rows `up-${featId}-${lvl}`, so two identical rows share
    a React key. The render bug pre-dates this work (weapon-proficiency taken twice reproduces it); this
    made it reachable without the player choosing to take anything twice.
  · **star-orb** — its new grant note contradicts the number printed on the same card.
  · **adopted-ancestry** — the GRANTED half of the level gate does not work, though its own doc says it
    does.
  · **hellknight-dedication** — a claim in the cluster's notes is wrong (the row existed before; only
    its subject did not). Documentation, not behaviour.

### Landed this session, all tested
six innate DC notes · 14 battle-form creature traits · the Form chip rewired to the real mode · the ★
signature merge (`signatureFixed`) · the granted-repertoire mirror on both feat paths · Land Legs as a
floor · Swimming Animal's label and note · Fey Life's unprinted duration · the sanctification collision.

### Still to apply — specs exist AND have each been refuted once
`scripts/audit/round11-specs.json` holds a spec and the refutation that broke it, per ruling. **Read the
refutation, not just the spec: all four specs were wrong.** In dependency order:
0. **11 SPURIOUS `redundantFallback` flags** — found by the same scan, not yet triaged. These carry the
   flag but their text prints no such clause, so the app offers a choice the book doesn't:
   `aldori-duelist-dedication`, `alkenstar-agent-dedication`, `blackjacket-dedication`,
   `childlike-plant`, `harmless-doll`, `harrower-dedication`, `investigator-dedication`,
   `lion-blade-dedication`, `officers-medical-training`, `oozemorph-dedication`, `stonemasons-eye`.
   At least two (`aldori-duelist`, `alkenstar-agent`) print *"you become an EXPERT instead"* — a
   different mechanic (`conditionalSkills`), so the flag is probably the wrong lane rather than a
   spurious one. Read each before removing anything. `npm run scan:fallback` lists them.
1. **Ask the Bones (R2)** — a 69-record pass. Apply the 39 feat/classFeature deletions. Two traps:
   - ⚠ **`src/rules/situationalBonuses.ts` IS GENERATED** by `scripts/apply-situational-lane.mjs`
     (`writeFileSync(REGISTRY, next)` at line 88). Deleting entries from the `.ts` by hand is a second
     registry and the next run of that script puts every one of them back. The removals belong in the
     script's exclusion list, the same way the battle-form traits had to go in the script that owns
     those mode objects.
   - ⚠ Do NOT touch the 8 items (`cunning` plus 7 affixed talismans). Their replacement marker surface
     does not exist — `characterSituationalIds` skips anything not equipped/worn/invested, and an
     affixed talisman is none of those, while `cunning` is a rune the etch CONSUMES — so removing the
     star deletes the bonus outright with nowhere to put it. `cunning`'s star is live today.
2. **Avenge in Glory (R3)** — the engine half is verified; the sweep missed `form-a-flock` and five more
   modes parking a temp-HP pool in prose.
3. **The strike-trait lane (R5)** — 16 records. The spec's sanctification premise was false, and its
   count missed the Remaster's "become magical" wording for the same clause.
4. **The Halcyon merge (R4) — LAST**, after the repertoire mirror (already landed). ⚠ Its refutation
   found `customUnlocks: []` is truthy, which breaks `archetypeSlots` for ordinary archetypes.

`scripts/audit/recheck-diagnosis.json` holds the previous round's diagnoses in the same shape.

## ⛔ BEFORE touching feats, items, or anything the sheet displays

**Read `docs/gold-set-answers.md` first, in full.** It holds the owner's own rulings — 19 numbered
decisions and 16 lettered principles, quoted in their words, not paraphrased. It is the authority.
Where it settles something, it is settled, and building against it wastes the work.

The single most expensive mistake made here was not knowing those rulings existed. A run once proposed
108 "missing systems"; adversarial pruning killed 106, and **85 of them because a ruling or an existing
lane already covered it.** Reading one file first would have prevented all of it.

Then, as the task needs:

| file | what it settles |
|---|---|
| `docs/gold-set-answers.md` | **the authority.** Owner rulings + principles |
| `docs/mechanic-lanes.md` | the 68 lanes, and **DECIDED SCOPE** — what deliberately does NOT belong on the sheet |
| `docs/feat-text-audit-spec.md` | the feat audit. Opens with a **▶ RESUME HERE** section |
| `work/rulings/DECISIONS.md`, `DECISIONS-round2.md` | the original situational-bonus rulings A–O |
| `MIGRATION.md` | the AoN data migration; has its own resume point |

**Ally-facing effects are the trap.** Ruling F removes the *number* from your sheet. It does **not**
remove the player's need to SEE that their own ability was modified — an ally-facing feat still needs a
marker on the record it changes. Getting this backwards invalidated six control feats once.

## ⚠ Traps that have each cost real time

- **`buildCharacter` does NOT return the sheet.** It returns the stored character. Senses, AC,
  resistances, speeds, strikes and situational notes are computed by `derive.ts` and appear nowhere on
  it. Diffing the stored object once reported "changes nothing" for 18 of 20 feats.
- **`scripts/data/effect-backfill.json` is the ONLY overlay that survives `npm run data`.** Anything
  written straight into `public/core.json` dies at the next regeneration. Run
  `node scripts/import-siege-and-gaps.mjs` after editing it.
- **`public/core.json` must stay MINIFIED**, and descriptions live in `public/core-descriptions.json`.
  Any script reading core.json BY TEXT must merge them back first.
- **`npx jiti`, not `node`,** for scripts importing `.ts`. jiti cannot parse `.tsx` — inline what you
  need instead.
- **`tsc -b` lies** (it is incremental). Use `npx tsc --noEmit`.
- **Search record fields at ANY depth.** A shallow top-level check once called two records empty whose
  mechanics live inside `effectChoices[].grant`.
- **Foundry's silence means nothing.** 3,537 feats exist there with zero rule elements; only 39% carry
  usable mechanics. Its `ItemAlteration`, `ActiveEffectLike` and `RollOption` are mostly VTT plumbing —
  never quote their counts as gaps. Its prose is never a source; specification comes from our own text.

## Working agreements with the owner

- **Verify in the browser preview.** Do not assert that a change works — show it. A duplicate row on
  the Details tab was caught this way and would otherwise have shipped.
- **Never rebuild the Tauri exe** unless asked.
- **Never improvise when a referenced file is missing** — ask for the real one.
- **Every sheet description popup needs the favourite star** (reuse `PinStar`).
- **Test characters are disposable.** Change them freely; do not narrate doing so.
- ⛔ **NEVER `git add -A` or `git add <dir>`.** The owner keeps substantial uncommitted work in this
  tree. Stage files BY NAME, only the ones you touched. This was got wrong twice in one session and
  both commits had to be undone.
- Commit messages: explain WHY, and say what was measured rather than what was attempted.

## ▶ IN FLIGHT — pick this up first

**Both halves of the mandate are now measured, and the audit reads both.** Spec:
`docs/builder-harness-spec.md`.

| producer | measures | output |
|---|---|---|
| `scripts/feat-evidence.mjs` | what the SHEET does — build without the feat, build with it, diff every derived value | `scripts/audit/feat-500-evidence.json` |
| `scripts/builder-evidence.mjs` | what the BUILDER asks — the pickers rendered, the option lists resolved, whether the answer moves anything | `scripts/audit/builder-500-evidence.json` |
| `scripts/merge-evidence.mjs` | **neither** — it joins them per feat and adds the facts that need both | `scripts/audit/audit-500-evidence.json` ← what `audit-500.js` reads |

Regenerate all three in that order (`npm run evidence`); the merge **refuses to run over a stale or
short half**, so a green run of it is also the freshness check.

**A re-run is now mostly cached.** `node scripts/audit-cache.mjs plan` says what still has to be asked
and why, prints the `args` blob for the workflow, and `… apply <run.json>` folds the answers back in and
assembles all 500 from the cache. Requirements survive any engine change (they are derived from the text
alone); verdicts are re-judged only where the evidence pack moved. `--force` ignores the cache. Both
producers and the merge now end with *how many feats your change actually moved*, which is the number
that decides whether to launch the audit. Design and its invalidation rules: `docs/builder-harness-spec.md`.

⚠ **`scripts/audit/audit-500-result.json` still describes the SHEET ONLY.** It predates the merge. Its
136-correct / 342-candidate split must never be quoted as covering the builder, and re-running the audit
is gated on **Q24** ("do not re-run yet").

⚠ Verify any harness against feats you already know present choices BEFORE trusting a single number.
Four measuring scripts in this project have produced confident wrong answers by reading fields instead
of observing outcomes.

## State of the feat audit

Four lanes built and tested: creature traits, degree-of-success, battle forms, the formula book.
The frozen 500 (`scripts/audit/feat-500.json`, seed 20260808 — **never redraw**) has been audited on
Opus: 136 correct, 342 defect candidates, 22 uncertain since resolved.

**The 342 are CANDIDATES, not confirmed defects.** No verification pass has run on them. The last claim
pile went 27 → 14 under scrutiny. Do not fix from that list without verifying first: a false gap sends
you to rebuild something that already works, which happened with a "⚠ VERIFIED GAP" that was flatly
wrong — the code shipped at `featGrantsAuto.ts:23` all along.
