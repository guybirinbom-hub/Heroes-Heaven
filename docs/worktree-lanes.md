# Worktree lanes — several data lanes at once

**⚠ Make a lane ONLY with `node scripts/worktree-lane.mjs new <name>`.** At `bff4817`, main's own
`scripts/split-descriptions.mjs` (data chain) and `scripts/verify-characters.mjs` (verify chain) hardcode
`C:/trying ai 2/pf2e codex/`: in a lane made by plain `git worktree add`, `npm run data` rewrites MAIN's
`public/core.json` and `public/core-descriptions.json`, and `npm run verify` checks MAIN. `new` edits those
two lines inside the lane (until main has the fix, then there is nothing to edit). 24 other tracked files
still name main and read/write MAIN when run from any lane — the 16 `scripts/backfill-*.mjs`,
`diff-core-loss.mjs`, `harvest-lost-fields.mjs`, `perf-measure.mjs`, `restore-orphan-modes.mjs`, three
`scripts/audit/*.js`, and `.claude/workflows/wg-batch.js` (so the batch workflow always drives main): never
run them from a lane; `new` lists them.

A data lane that runs `npm run data` owns `public/` for 10+ minutes, so two lanes in one checkout clobber
each other. Each lane gets its own checkout instead: `new <name> [--from <ref>]` makes
`C:\trying ai 2\hh-lane-<name>` (a detached `git worktree` with `core.autocrlf=false` in its own
`config.worktree`, so every tracked file is its blob now and after any later checkout/restore/stash there —
the machine's autocrlf=true would write CRLF; `new` refuses unless main has `extensions.worktreeConfig=true`)
and links the untracked inputs the chains read — `node_modules`,
`tracker/node_modules`, `.import-src` and `work/wg` are junctioned (shared, read-only);
`public/core.foundry-backup.json`, `work/.wg-diff-all.json`, `work/owner-names.local.txt`, the gitignored
`work/wg-batch-NNN.json` pins, `scripts/aon-verify/` and `.env` are copied (the lane owns them). `new` then
edits tracked files in the lane, each changed line marked `worktree-lane:`: the chain scripts above get a
checkout-relative ROOT, and `scripts/lib/heavy-lock.mjs` defaults to MAIN's `work/.heavy.lock`, so
`node scripts/vt.mjs` in main and in every lane shares ONE queue — the lock's contract is one heavy job per
machine, because vitest under load runs zero tests and exits 0. `npm run data`/`verify` take no lock (as on
main), so regens still run side by side. `prove <name>` runs `npm run data` then `npm run verify` there
(with `HEAVY_LOCK_PATH` set to main's lock) and byte-compares every generated file against the lane's
starting commit; it exits 0 only when data exits 0, verify exits 0 and every file is byte-identical
(2026-09-25, a lane made by `new` from `bff4817`: both exit 0, 101 of 101 byte-identical, 85 of them
rewritten by the run, 148 s). verify's trust-ledger §10 skips in a lane until `node scripts/wg-diff.mjs
--out work/.wg-diff-all.json` is re-run there after the regen, exactly as on main. Merge back INPUTS only:
overlay rows as `apply-parity-fixes` spec files (re-applied on main with `apply-parity-fixes.mjs <spec>
--write`), and every other tracked change as the patch `node scripts/worktree-lane.mjs diff <name> >
lane.patch` prints — the WHOLE tree (scripts, src, test, docs, work, tracker, `public/data`, package.json …,
binary-safe) minus the generated files, with `new`'s `worktree-lane:` lines put back to what `new` found.
That happens in a scratch index, so a worker edit right next to one of those lines still merges cleanly;
never change a `worktree-lane:` line by hand (`diff` then refuses). New files are not in the patch: `diff`
names them on stderr (INPUTS copies and generated files left out) to copy by hand. Then run ONE
`npm run data` on main. The generated files — `public/core.json`, `public/core-descriptions.json`,
`public/ast-index.json`, `public/ast/*.json.gz`, `scripts/migration/out/*.json`,
`src/data/trust-ledger.json` (measured: the only tracked files a regen + verify rewrites) — are never
merged: two lanes' regens of the same corpus do not compose, and the one regen on main after the inputs
land is the only one that ships. Remove
a lane ONLY with `rm <name>`: measured on git 2.53.0.windows.2, `git worktree remove --force` follows a
junction and empties its target (main's `node_modules`, `.import-src`, `work/wg`), and so does PowerShell
5.1 `Remove-Item -Recurse`; `rm` unlinks every link first.
