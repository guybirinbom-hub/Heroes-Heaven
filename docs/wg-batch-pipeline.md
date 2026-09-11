# Less Fable per batch — the batch pipeline (v2, after the three-judge review)

Owner's ask (2026-09-05): change the parity workflow so it uses less Fable (the main-loop model), in
the way that leads to the fewest mistakes. v1 was reviewed by three Opus judges (process gaps, data
safety, agent failure modes; their full output is `work/.pipeline-plan-review.txt`). v2 folds in every
must-fix and most should-fix items. Where v2 says "refuse", it means a script exits non-zero with the
offending ids named — a finding becomes a guard, never a sentence in a prompt.

## Where Fable was spent (batch 29 as the measure)

Launching scripts by hand and reading their raw output (~30 tool results); the "orchestrator pass"
after the apply workflow (reading ~40 KB of reports, reshaping specs, applying them in order, the
replay, tests, triage, stale-premise flips, follow-up agents, owner questions, the close script, the
sweep, the gate, the re-gate, the suite, verify, the commit, memory). Every mistake this session came
from those hand steps: spec order, the created-record prose two-phase, path-blind applier keys, the
harness run under load, a gate parser bug, scratchpad scripts re-typed from memory.

## Target

Per batch Fable does three things: launch ONE saved workflow with the batch number; read ONE
machine-generated digest (`work/.bNNN-run.json`, a per-stage table — the closer's prose is displayed
but never load-bearing); approve the commit or send the digest's "needs the orchestrator" items back.
Everything else is a deterministic script or an Opus agent whose work an Opus adversary verifies with
evidence it must produce (re-run output quoting a per-stage nonce, diffs). Opus stays the judgement
tier: over batches 25–29 its verifiers caught a real error every batch.

## A. The driver — `scripts/wg-batch-run.mjs --batch NNN --stage <stage> [--print]`

Stages: `cut | baseline | read-digest | apply | apply-digest | gaps | close | experience | gate |
regate | suite | verify | all`. Every stage: takes the heavy-job lock (`work/.heavy.lock`, waited on,
never failed on), records a fresh `runId` nonce, snapshots `git rev-parse HEAD`, `git rev-list --count
HEAD`, `git stash list`, `git status --porcelain` and the sha256 of `scripts/data/effect-backfill.json`,
`public/core.json`, `public/core-descriptions.json` at its start and end, and writes
`{ stage, ok, exitCode, runId, counts, digest, next, git, hashes }` into `work/.bNNN-run.json` (an
array, one entry per stage run; the file IS the digest). Raw output goes to `work/.bNNN-run.log`.
Commands per stage are an explicit allowlist; `npm run data` and `--skip-harness` are never invoked.
A stage that needs a full regen stops with `needs the orchestrator: npm run data`.

- `cut` — `wg-next-batch-ids.mjs --count N --max-level L` (add `--max-level`; the predicate is recorded)
  or `--ids`; refuses if `work/wg-batch-NNN.json` exists unless `--recut`; records the sha256 of the
  id list, and every later stage asserts the batch file still hashes to it. Records the batch-start
  commit sha for the flip audit.
- `baseline` — parity dump, wg-values / wg-identity / wg-casting, wg-diff scoped to the batch ids
  (wg-diff has no `--batch`; intersect its `--out` dump), the experience sweep, the gate; copies the
  comparer dumps to `work/.bNNN-baseline/` so the close stage can diff "what went quiet".
  Snapshots `test/`, the four ratchet constants, the three settle registries and
  `work/experience-instrument-limits.json` into `work/.bNNN-testbase/` for the flip audit.
  RULING (2026-09-08): a batch is judged ONLY against what changed since its own start, so this stage also
  writes `work/.bNNN-baseline/start-state.json` — the `git status --porcelain` paths already dirty at the
  start (`dirtyAtStart`, tracked and untracked) and the verify checks already red at the start
  (`verifyFailingAtStart`, name + first failure line). The testbase gains `dirtyTests`, the tracked test
  files another effort had already modified, byte-copied like the untracked ones so the flip audit diffs
  them against the copy rather than against `startSha`.
- `read-digest` — turns the read workflow's result file into `work/.bNNN-read.json` +
  `work/.bNNN-read-summary.txt` (the batch-29 digest script, ported).
- `apply` — reads the manifest `work/.bNNN-specs.json`
  (`[{ file, kind: 'rows' | 'created-prose', family }]`, written by the builders). Pre-checks over
  the WHOLE manifest before writing anything: (1) one collision check across every spec (the same
  category/id/path/field key apply-parity-fixes uses) — hard refuse, never "later wins";
  (2) any row whose key already exists in the overlay must carry `supersedes: true`, and the old→new
  pair is written into the digest; (3) refuse a pathless whole-value row on a category/id/field that
  already has `path:[…,'id=…']` rows beneath it (or vice versa) — the magus case; (4) refuse a
  description / descRefs row with a `path`; (5) refuse a `why` that names no AoN doc id, and for a
  description row refuse unless the restored tokens occur in that mirror doc. Then, in manifest
  order: `apply-parity-fixes.mjs <spec> --write` followed by `apply-backfill-now.mjs` for each spec;
  `created-prose` specs last, then one final unconditional replay. Post-checks: every authored row is
  readable from the SHIPPED artefacts (core.json / core-descriptions.json), not just the overlay;
  every `create` row deep-equals its shipped record (a corrected create needs `npm run data` — stop);
  no overlay row key present at the batch-start commit is missing or narrowed (a removal must be an
  explicit `value: null` / `delete: true` row); the overlay's row count equals rows-before + declared
  new (declared supersedes counted as replacements); the applier treats an edit whose `find` is gone
  and `replace` present as already applied (resume-safe).
- `apply-digest` — turns the apply workflow's result into `work/.bNNN-apply.json` and collates every
  "DATA STILL NEEDED" / "CROSS-FILE GAPS" line into `work/.bNNN-gaps.json`
  (`[{ family, line, status: 'open' }]`).
- `gaps` — refuses to proceed while any gap entry is `open`; each must be `authored` (names a
  manifest spec / edit / test) or `parked` (an owner-question queue entry or a flaggedResidue with a
  reason).
- `close` — `wg-batch-close.mjs` DERIVES `work/wg-batch-NNN-parity.json` and `-residual.json` from
  `.bNNN-read.json` + the manifest: `FIXED` requires a cited row / code edit / named test for that
  finding id, `MATCHES` requires a file:symbol or an instrument teach, `OWNER-QUEUED` requires the
  desk `n`; merges — never drops or overwrites an existing verdict; refuses on a batch whose commit
  already exists (`git log --grep "parity batch NNN"`). The two files leave `.gitignore`
  (`!work/wg-batch-*-parity.json`, `!work/wg-batch-*-residual.json`) so a bad write shows in a diff.
  Also diffs the baseline comparer dumps against fresh ones: every record that went quiet must be in
  this batch or individually cited in the digest.
- `experience` — the sweep, under the lock, one bounded retry on a forks-worker failure; the artefact
  gains `observed` (the raw file's mtime) and gate 9 compares `observed`, not `generated`.
- `gate` — the nine gates.
- `regate` — for every earlier batch: experience sweep then gate, serialised, progress recorded per
  batch so a restart resumes; blocking — a newly failing earlier-batch record needs a disposition line
  in the digest (fixed here / queued with `n` / next batch) and the closer may not settle an id outside
  the current batch.
- `suite` — the full vitest run through `scripts/vt.mjs` (below). Tolerates nothing: the batch's own tests
  must be green whoever turned one red.
- `verify` — the `npm run verify` chain, SPLIT at its `&&` and run one check at a time (a single chain
  stops at the first red check, and tolerating that one would silently tolerate the thirty after it).
  A check that was already failing in `start-state.json` is reported as
  `pre-existing at start (not this batch): <name>` and does not fail the stage; a check green at the
  baseline and red now fails it as before, and with no start-state nothing is tolerated.
- `all` — the stages from `apply` onward, stopping at the first failure.

## B. Guards that make agent judgement checkable

- `scripts/vt.mjs <vitest args>` — takes the exclusive heavy-job lock, then spawns vitest. Every
  RULES block says `node scripts/vt.mjs …`, never `npx vitest`; the driver's suite and experience
  stages take the same lock.
- `scripts/test-flip-audit.mjs --batch NNN` — diffs `test/`, the ratchet constants, the three settle
  registries (VERIFIED_EQUIVALENT / SETTLED_VALUES / NOT_A_SCALAR / SETTLED_IDENTITIES) and
  `experience-instrument-limits.json` against the `.bNNN-testbase/` snapshot. Every changed or
  removed `it(` / `expect(` / registry entry / baseline constant must sit under
  `// batch NNN: <finding id>` (a CONFIRMED finding in `.bNNN-read.json` whose record id appears in
  the enclosing describe/it text) or `// batch NNN premise: <AoN doc id> "<clause>"`. Fails on any new
  `.skip` / `.only` / `.todo`, a deleted test file or describe block, or a changed numeric literal inside
  an otherwise unchanged `it(`. A settle or comparer teach added without a mutation-proof test (the
  batch-29 stunted-table pattern) fails the audit. RULING (2026-09-08): a test file listed in the
  testbase's `dirtyTests` is diffed against its byte copy under `.bNNN-testbase/`, never against
  `startSha`, so another effort's pre-batch edits are not this batch's flips; a file clean at the batch's
  start still diffs against `startSha` exactly as before.
- `scripts/overlay-shape-check.mjs` (in `npm run verify`) — no whole-field assignment row may sit at a
  later index than a `path:[…,'id=…']` row into the same category/id/field.
- Owner questions: a one-time backfill adds a persistent `n` to every entry of `open` / `deferred` /
  `ruled` / `authorisedExceptions` in `work/owner-questions.json` (assigned from today's positions so
  #104 keeps its identity) with a test pinning the n→id map; `scripts/add-owner-question.mjs` (the
  existing writer — no sixth writer) allocates `max(n) + 1` over all four arrays, refuses an existing
  id (a follow-up gets its own `n`), refuses an entry whose `printed` names no AoN doc id or whose
  `theirs` quotes no op that `wg-show.mjs --raw` prints. The closer never edits that file: it writes
  `work/.bNNN-queue.json`, the driver's `gaps` stage feeds it through the writer, and the
  close-verifier diffs the file.
- `scripts/wg-batch-commit.mjs --batch NNN` — stages, by explicit path, the manifest's `stage: []`
  list ∪ the known batch set (the three data artefacts always together, parity + residual, read.json,
  specs, tests named in the manifest) and REFUSES while any modified tracked path is unaccounted for
  or any of the three data files is modified-but-unstaged; message from `work/.bNNN-commit.txt`;
  prints the staged list. Never `-A`, never a glob. RULING (2026-09-08): a modified tracked path that was
  already in `start-state.json`'s `dirtyAtStart` and is not in this batch's stage set is left alone and
  printed under `left alone (dirty before this batch started)`, and only a path dirtied SINCE the start is
  refused; the three data artefacts stay always-staged-together even when they were dirty at the start,
  and the printed plan says so.
  RULING (2026-09-11): this script is the ORCHESTRATOR's command and refuses (exit 2, nothing staged)
  without `HH_ORCHESTRATOR=1` in the calling shell. No agent prompt names that variable and no script in
  this repo sets it — do not set it. Fable sets it on her own shell; `--dry-run` is read-only and needs
  nothing. WHY: on 2026-09-11 a pipeline agent ran the commit mid-batch and f1da70a landed with two gates
  red and without the batch's parity/residual artefacts. Every "did this batch change X" test in the
  script measures against the batch-start commit (`startSha` in `work/.bNNN-cut.json`), never HEAD: a
  mid-batch commit puts the change INTO HEAD, which is what made the prose rule ("manifest specs carry
  prose but `public/core-descriptions.json` did not change") misfire on the close-out. The driver's cut
  stage writes `work/.bNNN-open` and only a successful commit removes it; while it exists, the `baseline`
  and `close` stages print a loud MID-BATCH COMMIT line into `work/.bNNN-run.json` whenever HEAD has moved
  off `startSha`.
- `scripts/wg-regate-all.mjs` — the re-gate loop (ported from the scratchpad), resumable.

## C. One saved workflow — `.claude/workflows/wg-batch.js`

`Workflow({ name: 'wg-batch', args: { batch: 'NNN', count?: N, maxLevel?: L, ids?: 'a,b', print?: true } })`.
All agents Opus; effort high except the runner (low). Stages:

1. runner: driver `cut` + `baseline`; returns the run.json tail.
2. readers (slices) → read-verifiers (adversarial, default REFUTED) — the batch-29 prompts.
   `print: true` drops the THEIRS step and the gates that need it, and the digest SAYS SO (the same
   green report must not stand for both lanes).
3. runner: `read-digest`.
4. builders by family → build-verifiers — the batch-29 prompts, plus: builders write their spec files
   and manifest entries (with `supersedes` declared and `stage` paths listed) instead of telling the
   orchestrator; RULES say `node scripts/vt.mjs`. A family holding more than 12 finding ids is split
   into equal chunks `<family>-1`, `<family>-2` … each with its own builder, verifier, spec, report and
   manifest entry (batch 033 gave one family 41 findings and it could not finish), and `count` now
   defaults to 40 records because 50 overloaded that batch.
5. runner: `apply-digest` (produces the gaps file).
6. gap agents: one Opus agent per gap family resolves or parks each open line (rows into a new manifest
   spec, or a queue entry / flaggedResidue with a reason); a gap-verifier refutes.
7. CLOSER (Opus, high): runs the driver stage by stage (`apply` → `gaps` → `close` → `experience` →
   `gate` → `regate` → `suite` → `verify`); triages failures with citations (flip audit); its own
   src edits are listed as `closerEdits[]` with a test each; writes `work/.bNNN-commit.txt`; returns
   notes (non-load-bearing); a red gate is never the batch's final state, so it returns every still-red
   item in `gateRed[]`.
7b. gate-red round, at most once per batch and only when the closer ends red: a triage agent groups every
   red item into disjoint-file lanes, one builder + adversarial verifier per lane, then a second closer
   pass re-runs `apply` → … → `verify`. Reds surviving it are `needsOrchestrator`, not a third round.
8. close-verifier (Opus, high): default REFUTE. Must re-run `flip-audit`, `gate`, `verify` and quote
   each stage's `runId` from its own run.json entries; diff `work/owner-questions.json` against the
   batch start; check every gap line is authored or parked; check the git snapshots (HEAD unmoved, no
   stash, no file the run log says changed now byte-equal to HEAD); check every new settle/teach has
   its mutation-proof test; list what still needs the orchestrator.
9. runner: final run.json → Fable.

## D. Fable's protocol (memory + CLAUDE.md)

Never read raw output or logs — read `work/.bNNN-run.json` and the closer's notes. Never re-type a
scratchpad script — everything a batch needs lives under `scripts/`. Decide only what the digest marks
"needs the orchestrator" (owner-question wording, an engine-shape decision, a ruling conflict, a
create-row correction or row removal that needs `npm run data`). Commit through
`wg-batch-commit.mjs`; record the hash and the digest in memory.

## E. Rollout with the fewest mistakes

1. Build the scripts and the workflow file. Validate the driver on the CLOSED batch 029 with stages
   `close → experience → gate → suite → verify` (not `apply`): acceptance = `scripts/data/effect-backfill.json`,
   `public/core.json`, `public/core-descriptions.json`, every file under `src/` and `test/` byte-identical
   before and after; `wg-batch-029-parity.json` / `-residual.json` byte-identical; `-experience.json`
   identical modulo `generated`, `observed`, `harnessMs` and per-record `ms` (timings move on any
   machine with a clock); the gate exit 0; `git status --porcelain` unchanged on tracked paths.
   Decisions taken after the first dry run (2026-09-06): the close stage's DRY RUN computes the merge
   on a committed batch and reports byte-identical / would-change per file — only `--write` refuses
   (that is what makes this acceptance test performable); the per-run gate and settle dumps
   (`work/.gate-prose.json`, `.gate-diff.json`, `.stale-diff.json`, `settle-audit.json`) are untracked
   scratch, not batch artefacts; a pre-contract batch (029) reproduces 36 of 37 verdicts because one
   MATCHES teach lives in a comparer with no report file to cite — accepted as the bound for batches
   closed before the report-file contract existed; owner questions carry `n` 1–126 (five previously
   unnumbered entries took 122–126), so the next question is #127.
2. Run the saved workflow on batch 030 (the next level-8 slice, `count` small) with Fable reading only
   the digest; fix the closer checklist from what it needed.
3. Then the print-read lane with `print: true`.

## What stays with Fable

Owner-question recommendations, engine-shape decisions, ruling conflicts, `npm run data` decisions,
and whatever the close-verifier marks "needs the orchestrator". Nothing else.
