# Worktree lanes — several data lanes at once

A data lane that runs `npm run data` owns `public/` for 10+ minutes, so two lanes in one checkout clobber
each other. Each lane gets a checkout of its own, `C:\trying ai 2\hh-lane-<name>`, made, checked and
removed ONLY by `scripts/worktree-lane.mjs`:

| command | what it does |
|---|---|
| `new <name> [--from <ref>]` | makes the lane, detached at `<ref>` (default: main's HEAD), and records its base |
| `prove <name>` | `npm run data` then `npm run verify` in the lane, then compares (see Proof) |
| `diff <name> > lane.patch` | prints the merge-back patch; what it cannot carry goes to stderr |
| `apply <name>` | puts that patch on main with `git apply --3way`; stages nothing |
| `rm <name>` | unlinks every junction, then removes and prunes the lane |
| `list` | the lanes |

**⚠ Remove a lane ONLY with `rm <name>`.** Measured on git 2.53.0.windows.2: `git worktree remove --force`
follows a junction and empties its target — main's `node_modules`, `.import-src`, `work/wg` — and so does
PowerShell 5.1 `Remove-Item -Recurse`. `rm` unlinks every link first.

## What `new` sets up

`new` changes NO tracked file: right after it, `git status` in the lane shows nothing, and the merge-back
patch is exactly the lane's own work. Everything a lane shares with main comes from main's own code, which
works the same from any checkout (see Paths and The lock).

- **Line endings: `core.autocrlf=input`** in the lane's own `config.worktree` (`new` refuses unless main
  has `extensions.worktreeConfig=true`). A checkout writes every file as its blob — the machine's
  `autocrlf=true` would turn every LF file CRLF — and git reads CRLF back as LF exactly as main does.
  `scripts/lib/write-backfill.mjs` always writes the overlay CRLF over its LF blob: with `autocrlf=false`
  git saw the whole 6 MB file as changed, with `input` it sees only the rows that changed. The unit test
  keeps CRLF-written, LF-committed files in its fixture so this cannot come back.
- **The base.** `<lane>/.worktree-lane.json` records the commit the lane was cut from and a sha1 of every
  file `new` copied. `diff` and `prove` compare against that base, so commits made inside the lane stay in
  the patch. A lane made by an older `new` (its record lists an edit to `heavy-lock.mjs`) is refused by
  `diff` and `prove`: `rm` it and make it again.
- **The untracked inputs** the chains read (measured with a file-access trace of `npm run data` +
  `npm run verify`, 69 processes; the rest serve the tests and the lane tools):

  | input | how | read by |
  |---|---|---|
  | `node_modules` | junction (shared with main) | every chain |
  | `tracker/node_modules` | junction | tests that render tracker components |
  | `.import-src` | junction | the Foundry-based backfill and gold scripts |
  | `work/wg` | junction | `wg-diff.mjs` (the WG dump), to refresh `.wg-diff-all.json` |
  | `public/core.foundry-backup.json` | copy | `import-core-v2` (its transcription reference) |
  | `work/.wg-diff-all.json` | copy | `trust-ledger.mjs`; trust-ledger-check §10 |
  | `work/owner-names.local.txt` | copy | `owner-names-check` (verify) |
  | `work/wg-batch-NNN.json`, the gitignored batch pins | copy | `parity-residual-check`, `trust-ledger.mjs`, tests |
  | `scripts/aon-verify/` | copy | tests import `_ser.ts` and read the `apply-*.ts` scripts as text. **⚠ 9 of its scripts name the MAIN checkout** — never run them from a lane (see Paths) |
  | `.env` | copy | vite, vitest |

## The lock

`node scripts/vt.mjs` takes the heavy-job lock, and there is ONE lock for the whole machine: MAIN's
`work/.heavy.lock`. `scripts/lib/heavy-lock.mjs` finds it through the `.git` dir every checkout of this repo
shares, so vitest in any lane — even one made by a plain `git worktree add` — waits in the same queue as
main's. That is correct for vitest: under load this machine's vitest cannot start its workers, reports zero
tests and exits 0. A wait is normal. (Before 2026-09-29 `new` made the lane share it by editing
`heavy-lock.mjs` there; a plain worktree got a lock of its own.)

A lane cut from a commit before that fix (2ba18f5 or earlier) still has the old `heavy-lock.mjs`: `new`
says so and prints the command to use instead — `HEAVY_LOCK_PATH=<main>\work\.heavy.lock` in every shell
there — or cut the lane from a later commit. `new` edits nothing to fix it.

**⚠ What the lock does not cover.** `npm run data` and `npm run verify` take no lock, on main or in a lane —
the owner accepts that load. So a lane's regen can run while another checkout's vitest runs, and that
vitest can then report zero tests and exit 0. While a regen runs anywhere on the machine, read a vitest
result's test count, never only its exit code.

## Paths: every chain resolves its own checkout

A CHAIN is what `npm run data`, `npm run verify` and `node scripts/vt.mjs` RUN: the files package.json names
(following `npm run`), what they import, what they spawn, and what they load by path (`import()` of a built
path, jiti) — and, for vt.mjs, every test file with its own imports. `chainClosure` in the tool computes it
(2026-09-29: 128 files for data + verify, 1,130 with the tests). It reads code, never comments, and
over-counts on purpose: in a file that can spawn or load by path, every string that names a runnable file
counts as run.

Every file in that closure resolves ROOT from its own location, so even a lane made by a plain
`git worktree add` writes its own data, never main's. Three guards keep it so:
- `test/worktree-lane.test.ts` fails if any file in the closure names the main checkout (any spelling:
  `C:/…`, `C:\…`, `C:\\…`, git-bash `/c/…`), the four agent workflow scripts below aside;
- `prove` refuses — before running anything — a lane where a file its data/verify closure runs names main
  (a lane cut from a commit before a root fix);
- `new` lists every file in the lane that names main, tracked or not (the untracked copies included), and
  flags the ones its chains run.

35 code files name `C:/trying ai 2/pf2e codex` today and read or write MAIN from any checkout. None is in a
chain's closure except the four workflow scripts. Never run them from a lane:
- **24 tracked:** the 16 one-off `scripts/backfill-*.mjs`, `diff-core-loss.mjs`, `harvest-lost-fields.mjs`,
  `perf-measure.mjs` and `restore-orphan-modes.mjs` (run by hand, by no chain); and the agent workflow
  scripts `.claude/workflows/wg-batch.js`, `scripts/audit/audit-500.js`, `audit-batch.js`, `bakeoff.js`.
  Those four drive MAIN by design: the harness runs each as a function body, so it has no location of its
  own, and the path only goes into the agents' prompts ("work from this root"). `test/audit-cache.test.ts`
  evaluates `audit-500.js` under stub agents, which touch no file.
- **9 untracked in `scripts/aon-verify/`, which `new` copies into every lane:** `apply-clear.ts`,
  `apply-conditional.ts`, `apply-fixes.ts`, `apply-reviewed.ts` and `fix-conditional-ranks.ts` WRITE main's
  `src/rules/featGrantsAuto.ts`, `featFeatGrants.ts` and `featCantripGrants.ts`; `build-worklist.ts` and
  `apply-fixes.ts` read main's `public/core.json`; `build-worklist.ts`, `chunk-remaining.mjs`,
  `harvest.mjs` and `prescan-skills.mjs` take main's `scripts/aon-verify` as their own folder and write
  their work files there. The tests only import `_ser.ts` and read these as text.
- **2 untracked in `scripts/audit/`** (`audit-covered-workflow.js`, `verify-authored.js`): workflow
  scripts like the four above; not copied, so no lane has them.

## Proof

`prove <name>` runs `npm run data` then `npm run verify` in the lane and passes only when both exit 0,
every generated file is byte-identical to the lane's base, the run rewrote exactly the generated files (no
more, no fewer — so the GENERATED list below cannot drift silently), and `diff` has nothing to carry.
verify's trust-ledger §10 skips in a lane until `node scripts/wg-diff.mjs --out work/.wg-diff-all.json` is
re-run there after the regen, exactly as on main.

2026-09-29, `hh-lane-proof2` made by the current `new` from `2ba18f5` (no tracked file edited): data exit 0,
verify exit 0, 85 generated files compared, 85 byte-identical, the run rewrote exactly those 85, and `diff`
gave a 0-byte patch with nothing on stderr and the overlay unchanged — 160 s. Run again later that day,
holding the machine lock so no vitest started beside the regen: the same result in 161 s.

## Merge back — inputs only

Generated files are never merged: two lanes' regens of the same corpus do not compose, and the one regen
on main after the inputs land is the only one that ships. GENERATED is what a regen + verify rewrites,
measured: `public/core.json`, `public/core-descriptions.json`, `public/ast-index.json`, every
`public/ast/*.json.gz`, and six files in `scripts/migration/out/` — `map.json`, `used-docs.json`,
`archive-created.json`, `action-cost-notes.json`, `player-created.json`, `open.json`. The other files there
are INPUTS and do reach the patch (`build-map.mjs` reads `join`, `located`, `resolved`,
`drop-adventure-loot`, `variant-items`, `reclassified` and `is-really-the-doc`; `stamp-aonid.mjs` reads
`sections`). Two more files stay out of the patch: `src/data/trust-ledger.json` (no regen writes it; main
re-stamps it) and the overlay `scripts/data/effect-backfill.json` — `apply-parity-fixes.mjs` is its only
writer, so the lane's rows go to main as the lane's spec files, and what the data chain itself writes
there, main's own regen writes again.

`diff` puts every other change since the base into the patch — the whole tree (scripts, src, test, docs,
work, tracker, `public/data`, package.json …), binary-safe, lane commits included. On stderr it names what
the patch cannot carry: new files (not-ignored ones anywhere, and new gitignored files at a copied input,
such as a new batch pin `work/wg-batch-NNN.json`, unless main has them byte for byte), copies the lane
changed that now differ from main's, and a changed overlay.

On main, in this order:
1. `node scripts/worktree-lane.mjs apply <name>` — `git apply --3way` into main's working tree; nothing is
   staged. It refuses, applying nothing, if main has uncommitted changes in a file the patch touches (or
   an untracked file where the patch creates one). A file main changed since the lane's base merges, or
   gets conflict markers to resolve by hand. Every line of a file main already has keeps its own line
   ending (see Line endings on apply). A file the patch creates is left untracked — stage it by name with
   the rest. Then copy by hand the files it names on stderr.
2. Each of the lane's spec files: `node scripts/apply-parity-fixes.mjs <spec> --write`.
3. ONE `npm run data` (10+ minutes; it can abort silently — read its output from the top, check the exit
   code and the final "wrote" lines).
4. `node scripts/wg-diff.mjs --out work/.wg-diff-all.json`, then `node scripts/trust-ledger.mjs`, so the
   ledger carries the new core.json's sha (regen-durability-check reads it).
5. `npm run verify`.

## Line endings on apply

Main's line endings are mixed per file (2026-09-29: 2,510 text files LF on disk, 516 CRLF, and one mixed —
`test/armor-traits.test.ts`, 229 LF lines and 1 CRLF). git writes every file it applies through this
machine's `autocrlf=true`, which makes every line CRLF. So after `git apply`, `apply` puts back the endings
of every file that had a bare LF before — LF-only and mixed alike, conflicted or not — line by line:
- a line the patch left alone keeps its own ending;
- the k-th line of a change takes the ending of the k-th line it replaced;
- a line beyond those takes the ending of the line above it (at the top of the file, the ending most of
  the file's lines had; LF on a tie).

It does this only where autocrlf did the writing: a blob that already holds CR (a file a worker committed
CRLF on purpose) git writes as it is, and those endings stay. A CRLF-only file needs nothing. A file the
patch creates is written as any checkout here writes it: CRLF. `apply` names the files whose endings it put
back, and — should their lines ever fail to match up — the ones it had to leave CRLF.

Proved 2026-09-29 on a scratch clone of main (`autocrlf=true`) whose working tree was given main's own
per-file endings (2,510 LF, 516 CRLF, the mixed file), with two commits made in the clone since the lane's
base. A real 11-file patch from a lane made by `new` — the harness's own four files, the mixed file (a
line after its CRLF line and one at the end), an LF doc the clone changed on the same line, an LF script
the clone changed elsewhere, a CRLF script, a CRLF `scripts/migration/out` input, a PNG and a file committed
inside the lane — applied with nothing staged: the script merged, the doc got conflict markers, and every
file came out byte for byte as built by hand from the known edits (the mixed file 2 CRLF + 230 LF, the LF
files LF, the conflicted doc with no CR at all, the CRLF files CRLF, the PNG equal); the new file came out
CRLF, and a second `apply` refused with nothing changed. The refuter's probe (the mixed file made half
CRLF, half LF, then one line added at the end) now gives 115 CRLF + 116 LF, where it gave 231 CRLF.

## Line endings of these files

`scripts/worktree-lane.mjs`, `test/worktree-lane.test.ts` and this doc are LF in git (the test checks the
blobs, and that no file is mixed). On disk they are whatever the last checkout wrote: this machine's
`autocrlf=true` writes them CRLF on a branch switch or merge. Only a `.gitattributes` `eol=lf` line would
pin them LF on disk.
