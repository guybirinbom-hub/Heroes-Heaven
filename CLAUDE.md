# Heroes Heaven — read this before you act

This file loads automatically. It exists because sessions kept starting work without the context that
decides whether the work is right, and then had to be undone. The running log of what is in flight lives
in the owner's memory folder (its index loads with the session); this file holds only what is standing.
Sections about August 2026 work moved to `docs/CLAUDE-history-2026-08.md` on 2026-09-28.

## ▶ HOW A PARITY BATCH RUNS NOW (2026-09-06) — less Fable, fewest mistakes

The owner asked (2026-09-05) that batches use LESS of the main-loop model and make FEWER mistakes. The
plan is `docs/wg-batch-pipeline.md` (three-judge reviewed); the prompts are
`docs/wg-batch-workflow-prompts.md`. The main loop does three things per batch and nothing else:

1. `Workflow({ name: 'wg-batch', args: { batch: 'NNN', count?: N, maxLevel?: L, ids?: 'a,b', print?: true } })`
   — the saved workflow in `.claude/workflows/wg-batch.js`. `name` resolves only when the session's
   cwd is this repo; from any other cwd pass
   `scriptPath: 'C:\\trying ai 2\\pf2e codex\\.claude\\workflows\\wg-batch.js'` instead. Every agent in it is Opus; every
   mechanical step is the deterministic driver `scripts/wg-batch-run.mjs --batch NNN --stage <stage>`.
   `ids` takes BARE record keys (`twofold-tine`, never `classFeatures/twofold-tine`); a print batch
   (`print: true`) takes its packet from `work/print-batch-PNN.json`, cut by `scripts/print-batch.mjs`.
2. Read ONLY `work/.bNNN-run.json` (the per-stage table IS the digest) and the closer's notes. Never
   read raw logs or a report file; never `head -c 60000` anything.
3. Decide only what is marked "needs the orchestrator" (owner-question wording, an engine-shape
   decision, a ruling conflict, a create-row correction or row removal that needs `npm run data`),
   then commit through `scripts/wg-batch-commit.mjs --batch NNN` (stages by explicit path from the
   manifest; refuses strays; never `-A`) and record the hash in memory.
   `scripts/wg-batch-commit.mjs` is the orchestrator's command and refuses without `HH_ORCHESTRATOR=1`;
   do not set that variable (2026-09-11: an agent ran it mid-batch and f1da70a landed with two gates
   red). Fable sets it on her own shell: `HH_ORCHESTRATOR=1 node scripts/wg-batch-commit.mjs --batch NNN`.
   `--dry-run` is read-only and needs nothing.

The guards that replaced the orchestrator's eyes — do not bypass them by hand:
- `scripts/apply-parity-fixes.mjs` refuses an undeclared `supersedes`, a whole-value row landing on a
  field that `path:[…,'id=…']` rows already amend (the batch-29 magus case), prose rows with a path, a
  `why` naming no AoN doc id, restored prose absent from the mirror; `--expect-rows` rolls back. It is
  the ONLY writer of `scripts/data/effect-backfill.json`.
- `scripts/test-flip-audit.mjs --batch NNN`: a changed test, registry key, ratchet or instrument limit
  must cite `// batch NNN: <finding id>` or `// batch NNN premise: <AoN doc id> "<clause>"`; a new
  settle/teach needs a `mutation-proof` test.
- `scripts/overlay-shape-check.mjs` (in `npm run verify`), `scripts/vt.mjs` (the heavy-job lock —
  never `npx vitest` beside the harness; one vitest process at a time), owner questions only through
  `scripts/add-owner-question.mjs` (persistent `n`, max+1, duplicate refusal), `scripts/wg-batch-close.mjs`
  (derives verdicts from the read + manifest; refuses a committed batch on `--write`).
- Scratchpad scripts are never re-typed: everything a batch needs lives under `scripts/`.
- Every build → refute → fix loop ENDS ON A REFUTER, and every finding becomes a guard (a check in
  `npm run verify` or a test), never a paragraph.

## ⛔ BEFORE touching feats, items, or anything the sheet displays

**Read `docs/gold-set-answers.md` first, in full.** It holds the owner's own rulings — numbered
decisions and lettered principles, quoted in their words, not paraphrased. It is the authority.
Where it settles something, it is settled, and building against it wastes the work.

The single most expensive mistake made here was not knowing those rulings existed. A run once proposed
108 "missing systems"; adversarial pruning killed 106, and **85 of them because a ruling or an existing
lane already covered it.** Reading one file first would have prevented all of it.

Then, as the task needs:

| file | what it settles |
|---|---|
| `docs/gold-set-answers.md` | **the authority.** Owner rulings + principles (R12: the newest printing wins, whole; R9: never spend a ruling on a question whose options are all correct) |
| `docs/mechanic-lanes.md` | the 68 lanes, and **DECIDED SCOPE** — what deliberately does NOT belong on the sheet |
| `docs/wg-batch-pipeline.md` | how a batch is cut, read, applied, closed and committed |
| `docs/feat-text-audit-spec.md` | the feat audit. Opens with a **▶ RESUME HERE** section |
| `work/rulings/DECISIONS.md`, `DECISIONS-round2.md` | the original situational-bonus rulings A–O |
| `MIGRATION.md` | the AoN data migration; has its own resume point |
| `docs/CLAUDE-history-2026-08.md` | the August feat-audit tooling, batch 1, and the evidence harness |

**Ally-facing effects are the trap.** Ruling F removes the *number* from your sheet. It does **not**
remove the player's need to SEE that their own ability was modified — an ally-facing feat still needs a
marker on the record it changes. Getting this backwards invalidated six control feats once.

**Wanderer's Guide is GPL-3.0.** Its encoding is evidence to compare against, never text or data to
copy. Where it contradicts print, that is an owner question, never a decision. Release notes never
name it.

## ⚠ Traps that have each cost real time

- **`buildCharacter` does NOT return the sheet.** It returns the stored character. Senses, AC,
  resistances, speeds, strikes and situational notes are computed by `derive.ts` and appear nowhere on
  it. Diffing the stored object once reported "changes nothing" for 18 of 20 feats.
- **`scripts/data/effect-backfill.json` is the ONLY overlay that survives `npm run data`.** Anything
  written straight into `public/core.json` dies at the next regeneration. Write rows only through
  `scripts/apply-parity-fixes.mjs`.
- **`npm run data` takes 10+ minutes and can ABORT SILENTLY.** Read its output from the top; check the
  final "wrote" lines; back up `public/core.json`, `core-descriptions.json`, `ast-index.json`,
  `public/ast/` and `scripts/migration/out/` before the first run of a lane. Re-stamp the trust ledger
  (`wg-diff.mjs --out work/.wg-diff-all.json`, then `trust-ledger.mjs`) after it.
- **`public/core.json` must stay MINIFIED**, and descriptions live in `public/core-descriptions.json`.
  Any script reading core.json BY TEXT must merge them back first.
- **Line endings are MIXED per file.** Measure with node (count `\r\n` vs `\n`) before and after an
  edit and keep each file's own; never trust a git-bash grep for this.
- **`npx jiti`, not `node`,** for scripts importing `.ts`. jiti cannot parse `.tsx` — inline what you
  need instead.
- **`tsc -b` lies** (it is incremental). Use `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  (bare `npx tsc` can download a fake package). In the main chat the end-of-turn hook already runs it on changed files.
- **Search record fields at ANY depth.** A shallow top-level check once called two records empty whose
  mechanics live inside `effectChoices[].grant`.
- **Foundry's silence means nothing.** 3,537 feats exist there with zero rule elements; only 39% carry
  usable mechanics. Its prose is never a source; specification comes from our own text.
- **`src/rules/situationalBonuses.ts` IS GENERATED** by `scripts/apply-situational-lane.mjs`, and a
  dozen scripts splice into it. Hand ADDITIONS survive; hand DELETIONS die (the generator puts them
  back) — removals belong in that script's exclusion list.
- **Never import `scripts/aon-verify/apply-*.ts` to inspect it.** They are top-level scripts: importing
  one RUNS it and rewrites three `src/` files whole (`_entry-guard.ts` throws now; a test asserts it).
- **A measuring script checks its own bookkeeping, not the artefact.** Four measuring scripts here have
  produced confident wrong answers by reading fields instead of observing outcomes. Verify any harness
  against records you already know before trusting a number; random sampling is the only instrument
  for a defect rate (the real one was 11.5% when the scripts said zero).
- **UNKNOWN ≠ EMPTY.** Never sync, save or trim a list you never read; an absent stored choice means
  "untouched", not "none".

## Working agreements with the owner

- ⛔ **A player's change must NEVER be overwritten by the app.** Three revert incidents. First suspects
  are always the timers (400 ms persist, 3 s push, Realtime echo pull); a load is not an edit.
- ⛔ **The owner's own characters never enter the repo** (names, builds, saves, screenshots, filenames).
  Synthesize fixtures. `scripts/owner-names-check.mjs` runs in verify against an untracked local list;
  grep new untracked files by hand before a commit.
- ⛔ **NEVER `git add -A`, `git add .` or `git add <dir>`.** Stage files BY NAME, only the ones you
  touched. The owner keeps uncommitted work in this tree.
- ⛔ **NEVER `git checkout HEAD -- <file>`, `git restore`, `git reset --hard` or `git clean`.** HEAD is
  usually behind the working tree; a checkout once destroyed 42 KB of `build.ts`. To recover a file,
  Write it from `git show HEAD:<path>`. These are also permission deny rules in `.claude/settings.local.json`.
- **Commit locally; push and release only when the owner's whole message is "update", "update GitHub" or
  "ship it".** "Update <something>" is a normal edit. A release is always source + Windows installer +
  Android APK + the site; the steps are the `hh-release` skill.
- **Verify in the browser preview** (dev-skip login only, never the owner's account). Do not assert
  that a change works — show it. Never native `confirm`/`alert`/`prompt`; every description popup
  keeps `PinStar`.
- **Never rebuild the Tauri exe** unless asked (a release counts as asked).
- **Test characters are disposable.** Change them freely; do not narrate doing so.
- **Ask for a ruling only when rulings conflict, the print is unsettled (R9), or Wanderer's Guide's encoding
  contradicts the print.** Where a control goes: decide in one line.
- **Commit messages** explain WHY and say what was measured rather than what was attempted.
- **One chat per job.** When a job ends, use the wrapup skill; the next chat starts in this folder (its
  `.claude/settings.local.json` points `autoMemoryDirectory` at the shared memory folder).

## Where the rest lives

- **Memory folder** (loads with the session): the running log, the release pointer, batch state, the
  standing owner questions and every lesson with a date.
- **`docs/worktree-lanes.md`**: how a
  data lane runs in its own worktree and merges INPUTS only, so several can run at once.
- **`work/`**: the pipeline's tracked evidence (parity/residual JSON, owner questions) plus untracked
  scratch. Never the owner's characters.
