# `wg-batch` workflow — the prompt texts

Why this file exists: `docs/wg-batch-pipeline.md` section C makes `.claude/workflows/wg-batch.js` the
single thing Fable launches per batch. The prompts inside it are the whole judgement layer, and a
reviewer should not have to read JavaScript to audit them. **The script is the source of truth**; this
file mirrors its prompt blocks so they can be read, argued with, and diffed. Change the script, then
change this file in the same edit.

```
Workflow({ name: 'wg-batch', args: { batch: '030', count?: 40, maxLevel?: 8, ids?: 'a,b', print?: true } })
```

`batch` is padded to three digits when numeric (`30` → `030`); a print batch keeps its own id (`P01`).
Everything below writes `NNN` for that id and `.bNNN` for the run-file prefix.

## Shape

| # | Phase | Agents | Model / effort | Writes |
|---|-------|--------|----------------|--------|
| 1 | Cut | runner | opus / low | — (runs driver `cut` + `baseline`) |
| 2 | Read | one per slice of 5 records, grouped by bucket, `agentType: general-purpose` | opus / high | `work/.bNNN-read-slice-<i>.json` |
| 3 | Verify read | one per slice, adversarial | opus / high | `work/.bNNN-verify-slice-<i>.json` |
| 4 | Read digest | runner | opus / low | — (runs `read-digest`) |
| 5 | Build | one per family | opus / high | spec files, manifest entry, `work/.bNNN-report-<family>.txt` |
| 6 | Verify build | one per family | opus / high | `work/.bNNN-verify-<family>.txt` |
| 7 | Apply digest | runner | opus / low | — (runs `apply-digest`, produces the gaps file) |
| 8 | Gaps | one per family with open lines + one gap-verifier | opus / high | `work/.bNNN-rows-gap-<family>.json`, `work/.bNNN-queue.json`, gap status |
| 9 | Close | closer | opus / high | `work/.bNNN-commit.txt` |
| 10 | Verify close | close-verifier | opus / high | its own run.json entries |
| 11 | Final | runner | opus / low | — (returns the run.json tail) |

Read→verify runs as one `pipeline()` (no barrier: slice 3 can be verifying while slice 7 still reads);
builders→build-verifiers likewise. `parallel()` is used only for the gap agents, whose results the
single gap-verifier needs together. The script itself touches no file — the runner returns the record
list (`bucket | id | name | flags`) as structured output and the script slices it 5 per bucket, folding
a trailing one-record slice back into its neighbour (a reader *and* an adversarial verifier spent on a
single record is waste). Batch 29's 17 items / 14 class features / 6 feats slice to 4 + 3 + 1 = **8
readers**, the same count it ran by hand.

`flags` are not in the run.json digest, which carries only counts: the baseline stage wrote them to
`work/.bNNN-baseline/` (`values.txt`, `identity.txt`, `diff-batch.json`, `casting.txt`,
`experience.txt`, `gate.txt`), and the runner concatenates the lines naming each record id. The print
lane's baseline writes none of those files, so every `flags` is empty there — correct, not missing.

---

## The prohibition block (in every prompt)

> ABSOLUTE PROHIBITIONS (a violation is a failed run, not a note): never run any git write command
> (add / commit / stash / checkout / reset — reading status, log, diff, rev-parse, show is fine);
> never run `npm run data`; never run `apply-parity-fixes.mjs --write`, `apply-backfill-now.mjs` or any
> `apply-*.mjs` (the driver applies); never pass `--skip-harness` to anything; never edit
> `work/owner-questions.json` (an owner question is an entry you write into `work/.bNNN-queue.json` and
> nothing else); never delete or rewrite another agent's file.
>
> Run vitest ONLY through `node scripts/vt.mjs <args>` (it takes the exclusive heavy-job lock) — never
> `npx vitest`, and never more than one vitest process at a time. Do not run the full suite; run only the
> test files you touched. Finish with `npx tsc --noEmit` clean.
>
> Write code with the Edit / Write tools, NEVER through a shell heredoc or `node -e`. `node -e` is for
> INSPECTING data only.

## PROJECT RULES (builders, verifiers, gap agents, closer)

Ported from the batch-29 apply workflow, generalised off batch 29:

- Findings live in `work/.bNNN-read.json` (`confirmed` / `refuted` / `askOwner`) and are assigned per
  family in `work/.bNNN-read-summary.txt`; read your findings in full before touching anything.
- The printed text is the authority. WG is GPL-3.0: its encoding is **evidence to match, never text to
  copy**. WG-vs-print goes to the queue file, never to a decision.
- `public/core.json` is 8 MB and minified — `node -e` only. Descriptions are in
  `public/core-descriptions.json` (`"<bucket>/<id>"`). Durable data goes through overlay rows in
  `scripts/data/effect-backfill.json`, **but no agent in this workflow writes that file** — you emit a
  spec and the driver applies it.
- Whole-field re-emission: `traits`, `counters`, `spellSlotBonus`, `resonant`, a subclass `options`
  array are each ONE field — dump it, edit the copy, emit the complete value. Two findings on one
  record+field merge into ONE row. A row replacing an existing overlay row carries `supersedes: true`
  and the superseded value merged whole.
- Reuse the existing lanes (grantsItems, grantedStrikes, builtInRunes, counters, frequency, the modes
  bucket, recordMarks / RECORD_MARKERS / FEAT_SITUATIONAL, skillSubstitutions, speedsIf,
  `spellSlotBonus.restricted`, resonant, `advancement.ts` class tables, degreeShifts, featGrantsAuto,
  featFeatGrants, classResources, itemAliases, `grantedByRank`).
- Grep the field name in `build.ts` / `derive.ts` to prove a READER exists; a field with no reader IS a
  finding.
- Every code change carries a WHY comment quoting the printed clause and a vitest test on a BUILT
  character. A test written before its row lands asserts against a content copy with the field
  stripped/patched **in memory** — never a patched-vs-shipped delta.
- Stay inside your files; anything else goes in CROSS-FILE GAPS.
- **Citation conventions**, enforced exactly by `scripts/test-flip-audit.mjs` — an uncited flip fails the
  batch. Nothing in the repo used these before batch 030 (batch 29's own comment reads
  `// Batch 29: <prose>`, which the audit rejects), so they are stated here and in the closer prompt:
  1. Every changed or removed `it(` / `expect(` / settle-registry entry / ratchet constant sits within
     the 6 lines below `// batch NNN: <finding id>`, where `<finding id>` is an id from `confirmed[]` in
     `work/.bNNN-read.json` **and** that finding's RECORD id appears in the enclosing `describe`/`it`
     title. The audit checks both halves.
  2. Where print is the authority and no finding covers the change:
     `// batch NNN premise: <AoN doc id> "<clause>"` — the doc id must exist in the AoN mirror and the
     clause must be verbatim from that document.
  3. Every test proving a **new settle or comparer teach** still reports on a **stunted** copy carries
     the marker comment `// mutation-proof` in its body, naming the settle key it stunts. A settle or
     teach with no such test fails the audit — add the test, never an exemption.
- **A teach line in `work/.bNNN-report-<family>.txt` names the FINDING id, not just the record id.**
  `scripts/wg-batch-close.mjs` derives the `MATCHES` verdict from exactly that line; a record-only line
  makes every sibling finding on that record read as taught, which is how a real gap ships as MATCHES.

---

## 1. Runner — cut + baseline (`opus`, effort `low`)

> You are the RUNNER for parity batch NNN (WG-COMPARISON lane / PRINT-READ lane). Repo:
> `C:\trying ai 2\pf2e codex`. You run the driver and report; you author nothing.
> [prohibitions]
> Do exactly this, in order: 1. `node scripts/wg-batch-run.mjs --batch NNN --stage cut [--ids … | --count … --max-level …] [--print]`
> 2. `node scripts/wg-batch-run.mjs --batch NNN --stage baseline [--print]`
> The driver takes the heavy-job lock itself and waits — do not kill it because it is quiet. If a stage
> exits non-zero, do NOT retry more than once and do not work around it: report `ok:false` and put the
> driver's own "next" line into `stopped`.
> Then read `work/.bNNN-run.json` and return, **verbatim**, the entries these two stages appended.
> Also return the RECORD LIST the workflow slices: one entry per record with `bucket`, `id`, `name` and
> `flags`, read from `work/.bNNN-baseline/flags.json` — the baseline stage writes it keyed by record id
> as `{kinds, values, identity, experience}` (wg-diff KINDS / wg-values lines / wg-identity lines / the
> experience verdict). Join a record's non-empty entries into one string; empty when nothing flagged it.
> **Do not parse `values.txt` / `identity.txt` / `diff-batch.json` by hand** — flags.json is the same
> data already extracted, and two parsers of one dump eventually disagree. **Do not invent flags and do
> not adjudicate them — the readers do that.** In the print lane every entry is empty by design.

## 2. Reader (one per slice, `agentType: general-purpose`)

Header:

> You are one READER in the parity pipeline, batch NNN; you read the slice below. INVESTIGATION ONLY:
> modify no repo file. [prohibitions] **The ONLY file you write is `work/.bNNN-read-slice-<i>.json` and
> nothing else** — no reports, no scratch files, no notes anywhere else.

Three reads (WG lane):

1. **OURS** — the packet `work/wg-batch-NNN.json` (printed text, `ourFields`, `ourRegistries`,
   `theirEncoding`), then the full record and description out of `core.json` /
   `core-descriptions.json` via `node -e`.
2. **THEIRS** — `node scripts/wg-show.mjs "<Name>" --raw`.
3. **PRINT** — the AoN mirror `C:\wonderers guide\aon-2e-archive\data\by-category\<category>\<aonId>.json`
   (category = the aonId without its trailing number).

With `print: true` **step 2 is dropped entirely** ("Do NOT run wg-show.mjs and do not reason about their
encoding at all"), the packet is `work/print-batch-NNN.json`, and only two reads happen.

Finding kinds — WG lane:

- **(a)** their encoding delivers a mechanic ours does not (exact parity: we adopt theirs; include their op)
- **(b)** ours contradicts print (wrong number / rank / level / skill / target, missing or extra grant)
- **(c)** print states a mechanic neither side models and a player would miss it (residual read)
- **(d)** ours duplicates what another of our carriers already delivers
- **(e)** WG contradicts print → `askOwner: true`, propose nothing, never side against print (R10: WG
  encoding *less* than print is parity, not a question)
- **(f)** the instrument flag is wrong → `proposal: "instrument: …"` so the settle can be written

Print lane: **kinds (a), (e) and (f) do not exist** (no their-side, no comparer run) — never emit one,
`theirs` is always `""`, `askOwner` always false. Only (b), (c), (d) survive.

Carrier sweep before claiming we lack anything — items (passiveEffects, situationalBonuses, counters /
activationCost / frequency, innateSpells, heldSpells, spellSlotBonus, resonant, grantsItems,
grantedStrikes, recordMarks, itemAliases, investmentGroup, shield fields, builtInRunes, the modes
bucket), class features (**the owning class's table in `advancement.ts`, checked for every owning class
at the feature's level**, degreeShifts, featGrantsAuto, classResources, choice lanes, spell-grant
lanes, weapon specialization in derive.ts), feats (skillSubstitutions, speedsIf, situationalBonuses,
featFeatGrants, featGrantsAuto, degreeShifts, passiveEffects, recordMarks). Named false-positive
classes: a class table or another record carries it; legacy pre-remaster text quoted at a remaster
record; a situational entry keyed by an alias.

Output: `{"findings":[{id, claim, printed, ours, theirs, proposal, playerVisible, askOwner}]}` written to
the slice file — id is the record id with a `#aspect` suffix when a record has several, never a batch
prefix; a record with no findings appears nowhere. The structured return is only the path and the count.

## 3. Read-verifier (one per slice)

> Your default is REFUTED — a finding survives only if you fail to break it. The ONLY file you write is
> `work/.bNNN-verify-slice-<i>.json`.

Re-reads print itself, re-runs `wg-show.mjs --raw` when the claim cites their side, and sweeps every
carrier before accepting a "we lack it" claim. Same false-positive list, plus "WG encoding LESS than
print is parity, not a finding". In the print lane it additionally **refutes on sight** any finding that
cites WG, sets `theirs` to anything but `""`, or sets `askOwner`. One verdict per finding, same order:
`CONFIRMED | REFUTED` + evidence ("what you re-read and what it showed").

## 4. Runner — read-digest

Runs `--stage read-digest`, which merges the slice files into `work/.bNNN-read.json` +
`-read-summary.txt` (merge rule: `askOwner` → `askOwner[]`, `REFUTED` → `refuted[]`, else `confirmed[]`
with `CONFIRMED|UNVERIFIED`). If the stage reports fewer slice files than the workflow made slices, the
runner reports `ok:false` and names the missing indices rather than proceeding.

In the print lane the stage itself writes the disclosure, into **both** the digest entry and the summary:
`PRINT LANE: no THEIRS step; finding kinds (a)/(e)/(f) not emitted`. The baseline entry carries its own
(`PRINT LANE: … skipped …`, naming the THEIRS-dependent steps that did not run). The runner checks the
disclosure is there; a run.json with it nowhere is `ok:false`, "the print lane is not disclosed in the
digest", **so this batch's green report cannot be mistaken for a WG-comparison batch**.

Returns the run.json entries verbatim plus the **family list**, which the runner **copies, never routes**:
the summary now carries a `== FAMILIES` block written by the driver from `FAMILY_RULES` in
`scripts/wg-batch-run.mjs` — first rule wins, exactly one family per finding, a family with no findings
omitted. The rule, in order: proposal starting `instrument:` or naming wg-diff / wg-values / wg-identity /
wg-experience-lanes / experience-instrument-limits → `instruments`; `scripts/repair-*` or
`dropped-inline` → `repair`; `situationalBonuses.ts` / `RECORD_MARKERS` / `FEAT_SITUATIONAL` →
`situational`; a backfill row, created record or description → `data-rows`; any other `src/rules/*.ts` or
`src/builder` file → `engine` (situationalBonuses is excluded here **by order**); everything else →
`data-rows`. A missing block is `ok:false`, not an invitation to route by hand — hand routing is the step
this block removed.

## 5. Builders (one per family)

Each builder is told: **your findings are exactly the ids routed to you**, read in full from
`work/.bNNN-read.json` (the summary prints the same claims and proposals). A finding you believe belongs
to another family goes in CROSS-FILE GAPS naming that family — never silently dropped, never taken from
another family. A family that was routed no ids authors nothing and says so in its report. Per-family
file grants:

- **data-rows** — writes only `work/.bNNN-rows.json`, `work/.bNNN-created-desc.json` (prose for created
  records, since a create row never carries a description) and `test/batchNNN-data.test.ts`. No `src/`,
  no `scripts/`, never the overlay file. Its tests must fail for the right reason until the driver applies.
- **instruments** — `wg-diff.mjs`, `wg-values.mjs`, `wg-identity.mjs`, `wg-casting.mjs`,
  `lib/wg-experience-lanes.mjs`, `experience-instrument-limits.json`, its two test files. Prefer ONE
  teach over N settles; **measure the blast radius** and prove a record whose carrier does not reach the
  printed value is still flagged; never the word "verified" in a settle comment ("adversarially
  confirmed"); every teach/settle needs a **mutation-proof test** or the flip audit fails the batch;
  re-run all four comparers on this packet and the two previous ones.
- **situational** — `situationalBonuses.ts`, the exclusion list of `apply-situational-lane.mjs`
  (deletions only — generated rows come back otherwise), `test/batchNNN-situational.test.ts`. Every
  entry tested on a derived sheet through the reader the sheet uses.
- **engine** — `types.ts`, `build.ts`, `derive.ts`, `spellcasting.ts`, `advancement.ts`, the two builder
  files where a lane needs a control, `test/batchNNN-engine.test.ts`. Every reader exercised on a BUILT
  character; every widening states which existing records change behaviour; rows belong to data-rows and
  are tested patched in memory.
- **repair** — a new `scripts/repair-<what>.mjs` (dry-run by default), a hole class in
  `dropped-inline-check.mjs` with a measured baseline (ratchet fails when the count RISES),
  `work/.bNNN-rows-repair.json`, `test/batchNNN-repair.test.ts`. A repair restores missing tokens into
  OUR wording — it never replaces a description with mirror text.
- anything else — exactly the files the summary names, plus its own spec and test file.

Closing rules for every builder:

1. Write `work/.bNNN-report-<family>.txt`: per finding id — what you did (file + symbol, or the row),
   the test, what you could not do. It **starts** with `DATA STILL NEEDED` and `CROSS-FILE GAPS`, one
   line each, headers present even when empty.
2. Append the manifest entry to `work/.bNNN-specs.json` per spec file:
   `{file, kind: "rows"|"created-prose", family, stage: [every path the commit must stage]}` — re-read
   immediately before writing, keep every existing entry, never touch another family's.
3. Declare `supersedes: true` on every replacing row, carrying the superseded value merged whole. The
   driver hard-refuses undeclared replacements, cross-spec collisions, a pathless whole-value row over a
   `path:[…,'id=…']` row (or the reverse), a description row with a `path`, and a `why` naming no AoN doc id.
4. Spec shape `{"findings":[{id, backfillRows:[…], note}]}`; a finding that correctly needs no row still
   gets an entry with `backfillRows: []` and a note saying why.

## 6. Build-verifier (one per family)

Default: the work is NOT done. Re-reads the findings, opens every changed file, runs `tsc --noEmit` and
the family's tests through `vt.mjs`, and rules DONE / WRONG (fix it directly, add a test) / NOT DONE per
finding. Verifies the **rows as rows** without applying them (targets exist or `create:true`;
re-emitted values lost nothing; readers exist or are named as another family's; no duplicate
record+field+path key across specs; created records carry no description in the create row; every spell
/ action / trait / item id exists) and builds a throwaway in-memory harness where a mechanic can be
exercised, then deletes it. Checks the manifest still holds every other family's entry and that
`stage[]` lists every touched path. Writes `work/.bNNN-verify-<family>.txt`.

## 7. Runner — apply-digest

Runs `--stage apply-digest` (→ `work/.bNNN-apply.json` and `work/.bNNN-gaps.json`), returns the run.json
entries and the distinct families that still have `status: "open"` lines.

## 8. Gap agents + gap-verifier

One agent per family with open lines. Framing: *the driver's gaps stage refuses to proceed while any
line is open, so every open line ends this run **authored** or **parked** — never as prose.*

- **AUTHORED** — rows into `work/.bNNN-rows-gap-<family>.json` with a manifest entry
  (`family: "gap-<family>"`, `stage[]`), or a code fix in the file the line names with a test.
- **PARKED** — an owner question becomes an entry in `work/.bNNN-queue.json`
  (`{id, batch, printed, theirs, ours, question}`), the **only** way to ask an owner anything; the driver
  feeds it through `add-owner-question.mjs`, and `work/owner-questions.json` is never touched by an
  agent. Otherwise a `flaggedResidue` line with a reason.

Then it rewrites its own family's lines to `authored` / `parked` with a `ref`, leaving every other
family's line untouched, and reports one line per gap.

The gap-verifier defaults to REFUTE: it opens every `ref` (spec exists, valid, targets real, manifest
entry present; a code ref exists and its test fails when reverted; a queue entry carries a question print
cannot already answer), sets anything unproven back to `open`, names every still-open line, confirms
nobody edited `owner-questions.json` (`git diff`) and that no agent dropped another family's manifest
entry or gap line. Writes `work/.bNNN-verify-gaps.txt`.

## 9. Closer (opus, high) — the eleven rules

1. Run the driver **one stage at a time**, reading `work/.bNNN-run.json` after each:
   `apply → gaps → close → experience → gate → regate → suite → verify`. Never `--stage all`, never two
   at once, never in the background, never around a refusal.
2. The driver waits on the heavy lock — a quiet stage is a waiting stage. One bounded retry for a
   forks-worker failure in `experience`, and nothing else.
3. A refusal names its ids: fix the **cause** (the row, the missing `supersedes`, the unauthored gap
   line, the uncited flip) and re-run that stage.
4. [prohibitions]
5. Anything that stops with "needs the orchestrator" (create-row correction, row removal, `npm run
   data`, owner-question wording, engine-shape decision, ruling conflict) **stops there** and goes into
   `needsOrchestrator` — that is Fable's half of the protocol.
6. Every flip is cited or it does not happen, in these **exact** forms — `test-flip-audit.mjs --batch
   NNN` parses them: every changed or removed `it(` / `expect(` / settle-registry entry / ratchet
   constant sits within the 6 lines below `// batch NNN: <finding id>`, where the id comes from
   `confirmed[]` in `work/.bNNN-read.json` **and** that finding's record id appears in the enclosing
   `describe`/`it` title; or, where print is the authority and no finding covers it,
   `// batch NNN premise: <AoN doc id> "<clause>"` with the doc id in the AoN mirror and the clause
   quoted verbatim. Every test that proves a new settle or comparer teach still reports on a **stunted**
   copy carries the marker comment `// mutation-proof` in its body, naming the settle key it stunts. No
   new `.skip`/`.only`/`.todo`, no deleted test file or describe block, no changed numeric literal
   inside an otherwise unchanged `it(`. A settle or teach without a mutation-proof test fails the audit
   — **add the test rather than the exemption**. `// Batch 29: <prose>` is not one of these forms.
6b. A teach line in `work/.bNNN-report-<family>.txt` names the **finding** id, not just the record id:
   `wg-batch-close.mjs` derives `MATCHES` from that line, and a record-only line turns every sibling
   finding on that record into MATCHES too. Fix an inherited record-only line and say so in the notes.
7. Own edits are listed: `closerEdits[] = {file, why (the printed clause or the refusal), test}`. An
   edit with no test does not ship.
8. `regate` is blocking: a newly failing earlier-batch record gets a disposition line (fixed here /
   queued with its owner-question `n` / next batch), and no id outside batch NNN may be settled.
9. `close` **derives** `wg-batch-NNN-parity.json` / `-residual.json` — never hand-written, never
   overwriting an existing verdict.
10. Write `work/.bNNN-commit.txt`, ≥ 200 characters: what changed (families, row count, code lanes),
    what was settled and why, what is queued for the owner, what is deferred. `wg-batch-commit.mjs`
    reads it and the closer does **not** run it — the `verify` stage's `next` line names that script
    because it is the next step in the protocol, and that step is Fable's (she approves the commit).
    Running it would stage and commit the batch unapproved. No git write command, no commit script.
11. Notes are displayed but never load-bearing: under 3000 characters, with every fact that matters in
    the digest, the reports and the commit file instead.

## 10. Close-verifier (opus, high) — plan step 8

Default: **REFUTE**. The closer's notes are a claim, not evidence.

1. Re-run `test-flip-audit.mjs --batch NNN`, `--stage gate` and `--stage verify`, and **quote each
   stage's `runId` from the run.json entries its own runs appended** (a runId the closer produced is not
   evidence).
2. `git diff <startSha> -- work/owner-questions.json`: every added entry came through
   `add-owner-question.mjs` from the queue file, carries a fresh `n`, and does not restate a question
   print already answers. A hand edit is automatically REFUTED.
3. Every gap line is `authored` or `parked` with a ref it opened and found real.
4. The git snapshots in run.json: HEAD unmoved across the run, `git stash list` unchanged, and no file
   the log says changed now byte-identical to HEAD (a change that vanished was reverted). Read git only.
5. Every new settle / teach / exemption has a mutation-proof test — remove the taught carrier from a
   content copy and prove the test fails.
6. Spot-check `closerEdits[]`: file, cited test, printed clause. Unlisted, or a test that does not fail
   when the edit is reverted → REFUTED.
7. `work/.bNNN-commit.txt` ≥ 200 chars and every claim traceable.

Returns `verdict`, `report` (evidence per numbered check, with the runIds), and `needsOrchestrator[]`.

## 11. Runner — final

Returns the LAST entry of every distinct stage (`cut, baseline, read-digest, apply, apply-digest, gaps,
close, experience, gate, regate, suite, verify`) **verbatim**, whole objects including `runId`, `counts`,
`digest`, `next`, `git`, `hashes`, `refusals` — "this is the only thing Fable reads, so drop nothing and
summarise nothing".

The workflow returns `{ batch, runJsonTail, closerNotes, verifierReport }`.
