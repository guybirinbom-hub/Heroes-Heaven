# WP5 report — holds everywhere, timelines that name tweaks, ignored 0-lines (builder, 2026-10-21)

Status: built, tested, verified and parity-compared, then FIXED after the checker's round (section "Fix round 1"
at the end). NOT committed (as asked).

## What was built (by symbol)

**NEW `src/rules/ranks.ts`** (a leaf; imports only the rank list):
- `skillIncreaseCap` and `stepRank`, moved here from build.ts unchanged.
- build.ts imports both and re-exports `skillIncreaseCap`, so the Builder's import still works. explain.ts imports ranks.ts, never build.ts.

**`src/rules/build.ts`**:
- The `rankTw.exactly` clamp (rank seam 3) has a new rule. A hold on `weapon:<cat>` that is NOT moved also sets `proficiencies.firearmProf[cat]` to the held rank when that category is present (B6). A moved hold never does (B26 c).
- The C16 comment above the clamp is rewritten as "WHAT IT CAPS / WHAT IT DOES NOT CAP". It covers:
  - the track rank;
  - the firearm rank and the daily pick, for player-made holds only;
  - in-build readers before the clamp, for player-made holds;
  - moved holds (B26 b and c);
  - weapon-group and one-weapon ranks.

**`src/rules/blocks/active.ts`** (the one reader):
- `ignoredTweakTerms(host, target, why)`: the target's tweak terms as untyped `add` terms of value 0, each with the reason as its note. They are never a set, so `resolveTerms` needs no new branch.
- `tweakRankLines(host, target)` returns `{ floors, hold? }`.
  - Each line carries `level` (its start level), `rank`, the registry `line`, `reason` and `moved`.
  - It reads through `rankTweaks`, so the read-time sort is included.
  - A Lore target is keyed through `loreKey`.
  - When two stored keys hit one track, the last hold wins (the clamp order).
- `heldExactly(host, key, { forCap })`:
  - It is cached per overrides object × read-time sort × (level, switch).
  - Lore keys go through `loreKey`.
  - With `forCap` it answers only for holds that are not moved. Without `forCap` it covers every live hold; that form is for WP8's picker.
- The header lists the three new readers.

**`src/rules/derive.ts`**:
- `acBuild`, battle-form return: adds `ignoredTweakTerms(c, 'ac', 'not during a battle form')`.
- `spellTerms`, fixed-DC return: adds `ignoredTweakTerms(c, 'spell-dc@casting-entry:<id>', 'not on a DC printed by its source')`.
- `landSpeedResolved`: when a battle form states its Speeds, the land-Speed tweaks are added as 0 parts with the note 'not while a battle form states its Speeds'.
- `SpeedPart` gains an optional `layer`: book / transient / tweak, set on every part this function returns. It is for `numberTermsFor`/`bookTotal`; the breakdown never shows it.
- `dailySkillRank` returns `undefined` when `heldExactly(c, key, { forCap: true })`.

**NEW `src/rules/numberTerms.ts`**:
- `numberTermsFor(c, db, target)`: one dispatcher from a phase-1 number target key to the term list the sheet number is the total of. It returns `null` for a target this phase builds no number for.
  - Covers: max HP, AC, the 3 saves, Perception, every skill and Lore, class DC, Initiative, spell attack and DC per entry, land Speed.
  - Returns `null` for: a score, a rank target, `speed:fly`, a casting entry that no longer exists.
  - A skill that a stand-in beats gets the "X instead" line as an untyped transient term.
  - Max HP gets its "Minimum 0" line.
  - Land Speed returns its breakdown parts as untyped terms, each with its layer.
- `bookTotal(terms)`: the base + book layers pooled — the permanent number that a set replaced.

**`src/rules/initiative.ts`**: NEW export `initiativeTermsFor(c, db)`, which returns Initiative's whole term list (the private `initiativeTermList`).

**`src/rules/explain.ts`**:
- NEW `skillTimeline(c, db, key)` replaces the old timeline in `case 'skill'`. It replays in level order from untrained:
  - the 1st-level "Trained" line, when it can be inferred (see Deviations 4);
  - floors at their start level, before that level's increases: "At least R" with "Tweak (reason)" under it, or "(no change: already R)";
  - each increase through `stepRank` + `skillIncreaseCap`: "Skill increase → R", or "Skill increase (no change: already R)";
  - a raise the replay cannot name: "Raised to R" with "by level N: a feat, class feature or other grant", or "Set to R" with "an old Overrides entry" for an unsortable legacy `=`;
  - the hold LAST: "Held at R" with the registry line "Tweak: exactly R (reason)".
- `profTimeline` (saves, Perception, class DC, armor) gets the same lines:
  - a floor at its start level, after that level's class raises;
  - the hold last.
  - New helpers: `rankTargetOfTrack`, `floorEntry`, `holdEntry`, `higherRank`.
- `case 'speed'` copies label, note and value only, so `layer` never reaches the breakdown.

## Files
- New:
  - `src/rules/ranks.ts`
  - `src/rules/numberTerms.ts`
  - `test/tweaks-skill-timeline.test.ts`
  - this report
- Changed:
  - `src/rules/build.ts`, `src/rules/derive.ts`, `src/rules/explain.ts`, `src/rules/initiative.ts`, `src/rules/blocks/active.ts`
  - `test/blocks-rank-seams.test.ts`, `test/blocks-breakdown-sums.test.ts`, `test/blocks-generic-step.test.ts`

Foreign check: none of these files had a foreign edit (`git status` was checked at the start and before the worktree), so no `.patch` file was needed. The other chat committed `1a06cbf` while I worked; HEAD for the worktree was `1a06cbf`. Its open files (shared.tsx, campaigns, storage, cloudMerge, CampaignsPage, the campaign tests) were not touched.

Line endings were measured before and after. Each file keeps its own:
- CRLF: build.ts, explain.ts, initiative.ts.
- LF: derive.ts, active.ts, the tests and the new files.

Untracked outputs (do not commit):
- `work/.partB-wp5.json` (the snapshot)
- `work/.partB-wp5.vs-baseline.txt` and `.vs-baseline.full.txt`
- `work/.partB-wp5.vs-wp3.txt`

## Tests (all through `node scripts/vt.mjs`)
**New or extended:**
- `blocks-rank-seams`, new describe, 3 its:
  - "exactly caps a gunslinger's firearm rank": a martial hold at trained gives the martial firearm rank trained; the arquebus Strike drops by master−trained; simple is unchanged.
  - "exactly caps a daily-preparation skill pick (Ageless Spirit)": a paused hold caps nothing.
  - "a MOVED hold … caps neither": an old sorted `martial: trained` keeps the firearm rank and the arquebus number. A stamped `moved` keeps them too. An old sorted Arcana entry still lets the morning's Arcana pick lift the skill, while the same hold made by the player caps it.
- NEW `tweaks-skill-timeline`, 9 its:
  - names an "at least" floor;
  - names an "exactly" hold and an increase that changed nothing;
  - a floor from 5 is absent at 4 and present at 5;
  - a trained-then-increased skill reads as before;
  - a skill only an increase trained does not claim a 1st-level training;
  - a Medic Dedication raise is one "Raised to Expert" line;
  - the save and Perception timelines name a floor or hold;
  - the GUARD "the timeline's last rank equals the sheet rank on every snapshot character with no daily or firearm beat", gate off and gate on. It walks every spec of `blocks-parity-snapshot.mjs` through `loadEngine`, every skill and Lore, and needs at least 1000 checks. Each gate takes about 5 s.
- `blocks-breakdown-sums`:
  - 3 its for the 0-lines (+1 AC in bat form; +2 on Sigil of the First Clan's printed DC; the three land-Speed tweaks in bat form). Each checks that the number is unchanged and the parts still sum.
  - "numberTermsFor returns the list the sheet number reads, for every phase-1 target", one it per sheet of the spread. The total equals the sheet number, and the parts equal the breakdown parts.
  - "a target with no number this phase builds has no term list".
  - A `bookTotal` it: reflex set, stealth set, class-DC at-least, max-HP at-least, Speed set, each against the same sheet with that target's tweaks taken off.
- `blocks-generic-step`: `ignoredHere(c, key)` skips the three states, with the written reason (battle-form AC, battle-form Speeds, printed DC). The describe that pins what happens in them stays.

**Run results:**

| Where | Files | Tests | Result |
|---|---|---|---|
| Main tree | 23 | 972 | all passed |
| WP5-only worktree | 23 | 972 | all passed |

The 23 files:
- `blocks-rank-seams`, `tweaks-skill-timeline`, `blocks-breakdown-sums`, `blocks-generic-step`, `blocks-set-pooling`, `initiative`
- `tweaks-migration`, `tweaks-legacy-fixture`, `tweaks-max-hp-set`, `tweaks-pause`
- `card-statdetail`, `blocks-book-fields`, `package-m-data3-perception`, `advancement`, `dual-class-owned-features`, `batch28-engine`
- `overrides-readers-check`, `feat-readers-check`, `blocks-check`, `blocks-registry`
- `rank-gated-feat-grants`, `batch5-parity`, `batch032-engine`

First-run failures, both fixed in the tests (the code was right):
- the Strike was looked up by `instanceId`, which the build reassigns; it now finds the martial firearm;
- max HP under "at least 500" plus an untyped +4 is 504, not 500.

**Mutation proof** (in the worktree; every mutant was removed afterwards and checked byte-equal to the main copies):

| Batch | Mutants | Result |
|---|---|---|
| A, together | no firearm lines in the clamp; no `heldExactly` line in `dailySkillRank`; no "Raised to" reconcile line in `skillTimeline`; `ignoredTweakTerms` returns `[]` | 9 failures: the 3 cap its, the 3 zero-line its, the Medic it, and the snapshot guard at both gates |
| B | cap moved holds too (the clamp without `!b.moved`, `heldExactly` ignoring `forCap`) | 6 failures: the MOVED it, `tweaks-migration` ×2 (the fixture-delta and never-move its), `tweaks-legacy-fixture` ×3 (the firearm and daily premises, the never-move deltas) |

## Type-check
`node node_modules/typescript/bin/tsc --noEmit`:
- Main app: EXIT 0. Earlier in the session it showed one foreign error, `src/data/cloudMerge.ts(44,10)` from the other chat; that error was gone by the second run.
- Main tracker: EXIT 0.
- Worktree app and tracker: EXIT 0.

## Verify
`npm run verify` is GREEN in both places:
- Worktree: EXIT 0.
- Main tree: EXIT 0.

The last line in both: "blocks-check: OK — 16 registered kinds, 29 targets".

## Parity
The snapshot was taken in the WP5-only worktree at HEAD `1a06cbf` plus WP5: `node node_modules/jiti/lib/jiti-cli.mjs scripts/blocks-parity-snapshot.mjs --out work/.partB-wp5.json`.

**1. WP5 against WP3's snapshot.** Command: `--compare work/.partB-wp3.json --against work/.partB-wp5.json`.

| Item | Count |
|---|---|
| NUMBER differences | 0 |
| breakdown-part differences | 0 |
| sumOk changes | 0 |

This holds for every character, including the B26 (c) characters `overrides:firearm:gunslinger-L5` (strikes unchanged) and `overrides:daily:wizard-L5` / `-L8`. No snapshot character carries a tweak in a battle form or on a fixed DC, so the expected 0 new breakdown parts is met.

**2. WP5 against the part-B baseline, with WP3's allow lists.** Command: `--compare work/.partB-baseline.json --against work/.partB-wp5.json`, with:
- `--allow '^overrides:(test-sample|proficiencies|hidden-card|lore|lowered-raise|maxHp:wizard-L5#(mode|con-mode))'`
- `--allow-stat '^(build\.hash|(explain\.)?skill\..*|pc\.skills\..*|(explain\.)?save\..*|pc\.(fort|ref|will)(Mod|Prof)|(explain\.)?perception.*|pc\.perception.*|summary\.perception.*|(explain\.)?initiative.*|(explain\.)?class-?[dD][cC].*|pc\.classDC|ac|explain\.ac.*|pc\.ac|hp\.max|explain\.hp\.total|pc\.maxHP|summary\.hpMax)$'`

| Item | Count |
|---|---|
| NUMBER differences (not allowed) | 10 |
| NUMBER differences allowed | 66 |
| breakdown-part differences | 24 |
| sumOk changes | 4 |
| character set changed | 2 |

These are exactly WP3's counts, and compare 1 shows WP5 equals WP3 row for row, so every row is WP3's, already classified in wp3-report.md:
- 66 allowed: cases A, B and C plus the Lore-row move.
- 10 not allowed: the `build.hash` of asof, at-slot, daily ×2 and firearm, each at both gates. The only change in those is the derived `tweakRankSort` field, as proved in WP3.
- 24 breakdown parts: the thievery, medicine and Lore rows, and the max-HP book lines.
- 4 sumOk: the Lore-row move.
- 2 in the character set: the new-shape pair.

**No NEW number difference.**

## Deviations from the plan (with reasons)
1. **`numberTermsFor` and `bookTotal` are in a new `src/rules/numberTerms.ts`, not in derive.ts.** Initiative's term list lives in initiative.ts, and initiative.ts imports derive.ts, so a derive.ts dispatcher would close an import cycle. initiative.ts gained one export, `initiativeTermsFor`. WP4/WP7 should import both from `src/rules/numberTerms`.
2. **Land Speed has no term list of its own** (it is ordered stages). `SpeedPart` gained an optional `layer` so its parts can serve as terms; explain.ts copies label, note and value only, so the breakdown is byte-equal. `bookTotal` of Speed is exact under a set or a lifting "at least": the parts are then the permanent run's stages, the only case where a baseline is read. With no set, a typed tweak that beats a record Speed bonus would make the book parts approximate; nothing reads a baseline there.
3. **The shape of `tweakRankLines`** is `{ floors, hold? }` (the map called them atLeast/exactly). There is one hold: the last one wins, as in the clamp.
4. **The 1st-level training in the skill timeline is inferred.** A Character does not store it. The rule:
   - a start is used when exactly one of trained / untrained replays to the stored rank;
   - otherwise (both, neither, or a hold), only a PRINTED training counts: the background's or the class's fixed skill.

   The timeline therefore never claims a training it cannot see. A class-skill pick that a later feat raised now reads as one "Raised to" line, not "Trained" plus "Raised". The plan did not specify this.
5. **The "Raised to / Set to" line sits at the character's level.** The level of a feat or feature raise is not known on a Character, so the line says "by level N". The hold line uses the hold's start level and is always last.
6. **profTimeline puts a floor after that level's class raises** (the build applies floors after the class raises at the old slot).
7. **The guard reads the snapshot's specs directly** (`loadEngine` → `E.specs`, sheet db as `snapCharacter` builds it), not `snapshotSubset`: it needs the explain timeline, which the snapshot does not record.
8. **The daily cap test gives Ageless Spirit as a given feat** (`overrides.addedFeats`), the way the existing rank-seams tests give feats. The snapshot's daily characters cover slot picks.
9. **Weapons get no floor/hold timeline lines** (added in fix round 1). The plan names "saves, Perception, class
   DC, armor, weapons" for profTimeline, but no weapon timeline exists: the strikeAttack breakdown returns
   `timeline: []`. So a `weapon:<cat>` hold (which also caps the firearm rank, B6) is named in no breakdown yet.
   Naming it is left to WP7/WP10 (or the Tweaks page row); no code change in this WP.

## Ask Guy
Nothing. No ruling conflict, unsettled print or impossible step came up.

## Out of scope (seen, not fixed)
- **I overwrote an untracked WP3 file.** `--compare A --against B` writes its full list next to A, so my compare against `work/.partB-wp3.json` overwrote WP3's untracked `work/.partB-wp3.compare.txt`. I restored it from the equivalent WP5-vs-baseline full list (same 11,848 bytes; WP5 equals WP3 row for row). It is untracked scratch, and WP3 is committed.
- **The skill timeline does not show a daily-preparation rank.** That rank is play state, not the build, and the guard excludes it. A "today" line could be added later.
- **`numberTermsFor` does not cover attribute scores.** The 'score' aspect has no term list. WP4's `baselineFor` handles a score set on its own.
- **The verify banner already lists `save` among the overrides-reader home files** (`{stored,active,content,write,save,migrate}`). WP4 may have added it; it was not touched here.

## Worktree proof and teardown
- **Setup:** a temp worktree at HEAD `1a06cbf`, `C:\Users\r2g2\AppData\Local\Temp\hh-wp5`, made with `-c core.autocrlf=false`.
  - The 11 WP5 files were copied in. Their diff stat is identical to main: 8 files, +516 / −65.
  - node_modules and tracker/node_modules were junctioned in with PowerShell `New-Item -ItemType Junction`.
  - The inputs were copied in: `work/wg-batch-*.json` and `work/.partB-baseline.json`.
  - The 9 residual JSONs that differed only by CRLF were rewritten from `git show HEAD:<path>`.
- **Run there:** tsc (app + tracker), `npm run verify`, the 23 test files, the snapshot and both compares, and both mutation batches.
- **Teardown:**
  1. Removed both junctions FIRST (`rmdir` on the links).
  2. Rewrote the tracked files from HEAD bytes and deleted the untracked files.
  3. A plain `git worktree remove` and `git worktree prune`. `--force` is blocked by a hook and was not used.
  4. The folder is gone.
  5. Main node_modules intact: 421 entries (ls), tracker 471, vitest and typescript present.

Not checked:
- The real app in a browser. No UI changed. The timelines and 0-lines are seen only through `explainStat` in tests.
- The full test suite (only the 23 files above).

Risks:
- The timeline's 1st-level inference (Deviation 4) can drop the "Trained" line of a class-skill pick under a hold or a covering floor. It never adds a false one.
- `heldExactly` runs on every `dailySkillRank` call. It is cached and has a fast path when there are no proficiency overrides; the cost was not measured beyond the snapshot's own run time, which was unchanged in feel.

Tell Guy: nothing needed from him for WP5.

## Fix round 1 (after the independent checker, 2026-10-21)

Every finding was checked against the code first. All 5 were real; all were fixed (finding 3 by a report line).

| # | Finding | What was done |
|---|---|---|
| 1 major | profTimeline ended on a LOWER rank when a floor sat above a later class raise (wizard L9 "at least master" Reflex ended "5 Raised to Expert = expert") | `explain.ts` profTimeline: `next = higherRank(rank, e.rank)`; when the raise is below the rank already met it reads `Raised to Expert (no change: already Master)` with the floor's rank, otherwise as before with `rank: next`. A raise to the SAME rank keeps its old text, so untweaked timelines are unchanged. New it: wizard L9 Reflex floor → last rank = sheet (master), the "no change" line at 5; the same character untweaked still reads "Raised to Expert". |
| 2 major | the snapshot guard could not fail on a wrong replay; no it put a floor and an increase on one level | New it "a floor and an increase on the SAME level": wizard L3, increase 3 → Athletics, "at least expert" from 3 → exactly `['3 At least Expert [Tweak] = expert', '3 Skill increase (no change: already Expert) = expert']`. The guard now counts skill timelines with a "Raised to / Set to" fallback line and RATCHETS it (`FALLBACK_PIN` off 153, on 151, `toBeLessThanOrEqual`). The guard also walks the save ×3, Perception, class DC and worn-armour timelines of every snapshot character (13,224 / 13,230 track checks per gate, 0 bad) and needs > 1000 of them. |
| 3 minor | weapons have no floor/hold lines and the report did not say so | Deviation 9 added. No code change (no weapon timeline exists). |
| 4 minor | a background's printed Lore never counted as printed | `printed` uses `backgroundTrains(bg, key)` (blocks/book.ts), which covers the fixed skill and the Lores; the import of `backgroundTrainings` in explain.ts became `backgroundTrains`. New it: an acolyte wizard's `lore:scribing` reads "1 Trained [from the Acolyte background]", and under "exactly untrained" keeps that line before "Held at Untrained". (Lore keys are lower-case subjects, `lore:scribing`, not `lore:Scribing Lore`.) |
| 5 minor | two comments said a battle form's AC is one term that no tweak reaches | Reworded in `explain.ts` (the battle-form AC return) and `derive.ts` (`acTerms` doc): the stated AC plus a 0 line per AC tweak it ignores (`ignoredTweakTerms`). |

**Rejected findings:** none.

**Mutation proof** (in the WP5-only worktree; each mutant removed afterwards, all 11 files checked byte-equal to main):

| Mutant | Caught by |
|---|---|
| M1 profTimeline back to `rank: e.rank`, no "no change" line (finding 1 undone) | the wizard L9 Reflex it. The snapshot has no floor above a later raise, so the guard alone does not see it. |
| M2 skill floors AFTER that level's increases (checker's plant 1) | the same-level it. The ratchet stays at 153/151: no snapshot character has a floor and an increase on one level. |
| M3 increase cap replaced by legendary (checker's plant 2) | the ratchet at BOTH gates (153→180, 151→178), plus 2 specific its |
| M4 a background Lore not counted as printed | the background Lore it |
| M5 profTimeline drops the hold line | the guard at both gates (4 bad each: `overrides:hidden-card:fighter-L7` and `overrides:proficiencies:fighter-L7` Fortitude and Perception), plus the fighter Perception-hold it |

**Line endings** kept: explain.ts CRLF (1697 → 1706 CRLF, 0 LF), derive.ts LF (7047 → 7048 LF, 0 CRLF), the timeline test LF (0 CRLF), this report LF.

**Runs, fix round 1**

| Where | What | Result |
|---|---|---|
| WP5-only worktree (`C:\Users\r2g2\AppData\Local\Temp\hh-wp5b`, HEAD `1a06cbf`, LF checkout, the 11 WP5 files copied in, diff stat 8 files +531/−70 = main minus the foreign shared.tsx hunk) | tsc app / tracker | EXIT 0 / EXIT 0 |
| same | the 23 test files via vt.mjs | 23 files, 975 tests, all passed (972 + 3 new its) |
| same | `npm run verify` | EXIT 0 ("blocks-check: OK — 16 registered kinds, 29 targets") |
| same | snapshot `--out work/.partB-wp5.json`, then compare vs WP3 (a copy, `.partB-wp3c.json`, so WP3's compare list was not overwritten) | NUMBER 0, breakdown-part 0, sumOk 0 |
| same | compare vs `.partB-baseline.json` with WP3's allow lists (the same two `--allow` / `--allow-stat` as above) | NUMBER 10 (+66 allowed), breakdown-part 24, sumOk 4, character set 2 — exactly WP3's counts, all classified in wp3-report.md (no new difference) |
| main tree | tsc app / tracker | EXIT 0 / EXIT 0 |
| main tree | the 23 test files | 974 of 975 passed; `feat-readers-check` "a stale entry, a count left too high…" timed out at 5,235 ms against vitest's 5,000 ms default. Re-run alone: 13/13 passed (5.5 s). A timing flake, not a WP5 file (see Out of scope). |
| main tree | `npm run verify` | EXIT 0 |

Teardown: junctions removed FIRST (`rmdir`), tracked files rewritten from HEAD bytes, the temp untracked files deleted, plain `git worktree remove` + `git worktree prune`; the folder is gone; main node_modules 421 entries and tracker 471 (as before), vitest and typescript present. The fresh snapshot and compare lists were copied to the main tree's untracked `work/.partB-wp5.json`, `.partB-wp5.vs-wp3.txt`, `.partB-wp5.vs-baseline.txt`, `.partB-wp5.vs-baseline.full.txt` (do not commit).

Out of scope (fix round 1):
- `test/feat-readers-check.test.ts:101` runs ~5.2–5.5 s against the 5 s default timeout, so it fails under load. It needs an explicit timeout; not a WP5 file, not changed.
- profTimeline still has no "raised by a feat" reconcile line like the skill side. The extended guard found NO snapshot character where a save, Perception, class DC or armour timeline misses the sheet rank, so nothing needs it today.

Not checked (fix round 1): the real app in a browser (no UI changed; timelines seen through `explainStat` only); the full test suite.
