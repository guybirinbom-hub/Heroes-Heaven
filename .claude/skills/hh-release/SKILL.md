---
name: hh-release
description: Prepare and publish a Heroes Heaven release (website, Windows installer, Android APK, GitHub release). Use when Guy asks to release, publish or cut a new version, or when his whole message is "update", "update GitHub" or "ship it". "Update <something>" (a page, the data, a feature) is a normal edit request, never a release. Stage 1 prepares without publishing; stage 2 publishes only after a release card was shown in this chat and his next message is just "update", "update GitHub" or "ship it".
---

# Heroes Heaven release

Two stages. **Stage 1 never pushes**: pushing `main` IS publishing the website (Cloudflare Pages deploys main within ~5 minutes). Full recipe history and clone gotchas: memory `project_pf2e_codex_release_distribution`.

## Stage 1 - prepare (nothing goes public)

1. **The list.** Use the list Guy gave in this chat. If he gave none, show the open items from memory and the backlog, one line each, and wait for his go. There is no ISSUES.md; never invent a list.
2. **Lanes.** Group the items into independent lanes (no shared files). Each lane gets its own worktree from `scripts/worktree-lane.mjs` (see `docs/worktree-lanes.md`); never raw `git worktree add` or `remove --force` (that has emptied main's node_modules). At most 2 lanes at once. Set `model` on every agent: Opus for anything touching saving, sync or rules, and for every checker; Sonnet for mechanical lanes. Each lane must:
   - add or update a test that fails before the fix and passes after, run through `scripts/vt.mjs` (one vitest at a time, never bare `npx vitest`);
   - pass `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` in the root and in `tracker/` (never `tsc -b`, never bare `npx tsc`);
   - take before/after screenshots at 1440 px and 390 px in the browser preview: set the size with the resize tool and confirm `window.innerWidth` before each shot (the screenshot can capture the real window instead; see memory `project_pf2e_codex_mobile_layout`); dev-skip login only, never Guy's account; save them in the scratchpad, never in the repo;
   - end on an Opus checker.
3. **Database changes.** Write each as a new root `supabase-<topic>.sql` (like the existing ones) plus `supabase-<topic>-rollback.sql`. Do not run them: there is no Docker or Supabase CLI here, and Guy pastes SQL into the Supabase SQL editor himself. Check the SQL against the existing `supabase-*.sql` files and with tests that mock the new shape.
4. **Merge** lanes into main one at a time (inputs only, regenerate once on main, as `docs/worktree-lanes.md` says). After each merge: `npm run verify`, the root and `tracker/` suites through `scripts/vt.mjs`, and tsc in both roots. Stage by name. Run long steps in the background and watch them.
5. **Release commit in main.** Bump the version in `package.json` and `src-tauri/tauri.conf.json` and commit it in main (stage by name; by hunk if the tree is dirty). Then fast-forward the clean clone `C:\trying ai 2\hh-clone-v0.1.30` (core.autocrlf false) to that commit and run the preflight there: build, no file over 25 MiB, bundle carries the new version, hygiene including the owner-names check, release-notes refuter (notes never name Wanderer's Guide).
6. **Builds, one after another** (they race on `dist/` and `public/core.json`), from the clone:
   - `npm run build` (a check only; the site builds from the push);
   - `npx tauri build` with `CARGO_TARGET_DIR=C:\trying ai 2\pf2e codex\src-tauri\target` for that command only (about 3 minutes; the Bash tool caps background commands at 10 minutes, so start it detached and watch its log);
   - `npm run android:release` (its script sets `CARGO_TARGET_DIR=C:\hhbuild` and finds the JDK in `~\.jdks`; the global JAVA_HOME points at a deleted folder, so if Java is not found set `JAVA_HOME=C:\Users\r2g2\.jdks\jbr-17.0.9` for that command only);
   - `& "$env:ANDROID_HOME\build-tools\37.0.0\apksigner.bat" verify --verbose <apk>` (apksigner is not on PATH).
   Copy the results to the stable names `Heroes-Heaven-Setup.exe` and `Heroes-Heaven-Android.apk` in a scratchpad release folder.
7. **Release card**, at most 15 lines in plain words, as the final chat message and saved to memory as `release_card.md` (never in the repo):
   - ✅ what is fixed, one line each
   - ❌ what is not done, and why
   - the SQL files Guy must run, in order (or "none")
   - what to test on his phone
   - one line: **GO** or **NO-GO** (and why)
   Then stop and wait.

## Stage 2 - publish, only when a release card was shown in this chat and his next message is just "update", "update GitHub" or "ship it"

1. Push main (git through PowerShell). Check remote main = local main = the release commit.
2. Wait until the live site serves a bundle carrying the new version (~5 minutes).
3. `gh release create v<ver> --repo guybirinbom-hub/Heroes-Heaven --target main --title "Heroes Heaven v<ver>" --notes-file <notes> <Heroes-Heaven-Setup.exe> <Heroes-Heaven-Android.apk>`.
4. Check both `/releases/latest/download/` links answer and the site shows the new version.
5. Update the release pointer in memory, then report with the status block, leading with any SQL he must run.

If a step fails partway, say exactly what is live and what is not; never leave an empty draft release behind without saying so.

## If Guy says "stop"

Stop every lane (TaskStop), say which lanes were paused and at which step, and do not push. If it lands between the push and `gh release create`, say plainly that the website is updated but the apps are not.
