# WP4 report: the save path (open stamp, Save stamp, edit paths, casting confirm). Builder, 2026-10-21

**Status:** built, tested, verified, and parity-compared; then a fix round for the independent checker's 6 findings
(section "Fix round" right below). Everything ran twice: in a temp LF worktree holding only the WP4 files, and in the
main tree. **Not committed** (as asked).

## Fix round (checker findings, 2026-10-21)

All 6 findings were verified against the code first; all 6 were real. 2 majors and 4 minors, all fixed.

1. **MAJOR, fixed: a rank meta with a `mode` this version does not know was overwritten.** `stored.ts` reads any mode
   other than atLeast/exactly as `rank.legacySet`, so `unsortedRankKeys` listed it and the freeze path wrote
   `{ ...m, mode: <sorted>, of, moved }` over the newer app's `atMost`.
   - `save.ts`: new `freezable(m)` = an object with NO `mode` (`m.mode === undefined`). It gates both places: the
     `needs` loop and the freeze branch.
   - The freeze branch was also restructured: a matching meta that is not freezable is skipped (`continue`), never
     sent to the "no meta / stale" branch below it. That branch would rewrite it too.
   - New it() in `tweaks-save-stamp`: "a rank meta whose mode this version does not know is never rewritten (a newer
     app's "atMost"), at open or at Save". A v:3 build with `meta['proficiencies:athletics'] = { of:'trained',
     mode:'atMost', reason:'newer app' }` plus an unstamped Dex set (so the stamp really runs). That meta comes back
     byte-equal from `openForTweaks` and from `stampTweaksSave`, and a Save after the open returns the build itself.
2. **MAJOR, fixed: open point 3's page notice had no owner.** `plan.md` is edited, which is where the WP6 builder reads:
   - WP6 "Files and symbols" gains a bullet: keep `derived` in App's `editing` state (`onEdit`) and GmEditSheet's
     (`openBuilder`), pass it as a new Builder prop (`derivedBuild?: boolean`), and show ONE line on the Tweaks page
     when it is true and a rank tweak exists. It comes with the notice's wording and a named test in
     `tweaks-page.test.tsx`.
   - Section 6, row 3, now reads "WP4 (the page notice: WP6, see its Files list)".
   - WP4 itself does not wire `derived` into App / GmEditSheet now: there is no page to show it on, and a prop nobody
     reads would be dead code in two CRLF host files.
3. **MINOR, fixed (a little more than the suggested fix): the blank-build fallback was stamped against no sheet.**
   - `save.ts` `metaStamps`: `character()` is `null` when `!build.classId` (no build is attempted). An entry whose stamp
     is read off the character (a sortable rank, `attributes:<ab>`, `maxHp:max-hp`) is then **left exactly as stored**:
     no `{ of, moved }`, no mode, no baseline. The same holds for a build that throws.
   - Why not the suggested "skip only mode and baseline": stamping `{ of, moved }` makes that meta "matching" for good.
     A rank's mode would still come later (the freeze path), but a set's baseline never would: the Save stamp only
     stamps entries with no matching meta. Leaving the entry unstamped lets the first Save of the real character stamp
     it whole.
   - `v` and the switch are still stamped. Entries that need no character (languages, given feats …) still get
     `{ of, moved }`. Nothing a reader turns into a number changes.
   - New it() in `tweaks-edit-path`: "the fallback's blank build gets no mode and no baseline at open; the first Save
     of the rebuilt character stamps them as its sheet sorts". It uses the checker's probe: a fighter L7 with Fortitude
     trained, Athletics expert, Str 18 and max HP 60.
     - At open, none of the four entries has meta, and no meta has a mode or baseline.
     - After the class is rebuilt, `stampTweaksSave` stamps Fortitude `{ of:'trained', moved:true, mode:'exactly' }`
       (the real sheet's sort). Its whole meta equals `openForTweaks(real build).overrides.meta`.
     - Str's baseline is not 10, and max HP's baseline is > 0.
4. **MINOR, fixed: no test guarded unknown keys, foreign blocks or plan 3.3 step 4.** New it() in `tweaks-save-stamp`:
   "a key this version does not know and a newer-version block come through byte-equal; an import-stamped rank gets
   its mode and never `moved`".
   - Fixture: `futureKey: { x: 1 }`, `blocks: [{ id:'t9', kind:'future.kind', v: 9 }]`, and `proficiencies.athletics`
     with `meta { of, source:'import' }` and no mode.
   - Checked for both functions: `futureKey` and `blocks` are byte-equal, the key list is exactly `blocks, futureKey,
     meta, proficiencies, v`, and the import rank is `{ of, source:'import', mode }`.
5. **MINOR, fixed: the dialog text named causes that do not fit every case.** `castingConfirm.tsx` now reads "Spells you
   prepared or chose for it stay saved, and come back if the change is undone." (the bracket is dropped).
   - `tweaks-casting-confirm` "Keep editing…" now asserts that text, and that neither "remove the feat" nor "tweak back
     on" appears.
6. **MINOR, fixed: the max-HP baseline carried a live Con tweak.** `baseline.ts` returns `undefined` for `max-hp` while a
   live Con SET or a live Con `attribute.add` block exists (both are inside `(class + Con) × level`).
   - The Con set's own baseline is still stamped. A paused Con set is no tweak on the sheet, so the max-HP baseline
     comes back.
   - The header says WP7 adds the same guard per target for the other number targets. A line was added to `plan.md` WP7
     too (AC under a Dex set, a skill under a rank tweak).
   - New it() in `tweaks-save-stamp`: "a max-HP set beside a live Con tweak stores no baseline …". It covers the Con
     set, a Con +2 `attribute.add`, and the paused set (where the baseline equals the book maximum).

**Rejected findings:** none. (Finding 3 was fixed more strictly than suggested, for the reason in item 3.)

**Fix-round mutation proof** (each mutant ALONE in the WP4-only worktree, then reverted; afterwards all 8 new WP4 files
were `cmp`-equal to main):

| # | mutant | red |
|---|---|---|
| F1 | `freezable` = any object (an unknown mode passes) | save-stamp "a rank meta whose mode…" (`atMost` came back `atLeast`) |
| F3a | the classless build is built anyway (`!build.classId` check off) | edit-path "the fallback's blank build…" (Fortitude got `{ of, moved, mode }`) |
| F3b | the "no character → leave as stored" `continue` off | edit-path "the fallback's blank build…" (Fortitude got `{ of, moved }`) |
| F4a | the import rank stamped `moved` | save-stamp "a key this version does not know…" |
| F4b | the stamp keeps only the 13 known overrides keys | save-stamp "a key this version does not know…" (`futureKey` gone) |
| F5 | the old bracket back in the dialog text | casting "Keep editing…" |
| F6a | the max-HP Con guard off | save-stamp "a max-HP set beside a live Con tweak…" (baseline 78 stored) |
| F6b | only the `attribute.add` half of the guard off | the same it() (baseline 68 stored) |

**Fix-round runs:**

| check | WP4-only worktree (HEAD `6a386d9` + WP4, LF) | main tree |
|---|---|---|
| the 4 WP4 test files | (inside the 18) | 25 / 25 passed |
| the plan's 18 files (list below) | 349 / 349 passed | 349 / 349 passed |
| tsc app / tracker | EXIT 0 / EXIT 0 | EXIT 0 / EXIT 0 (the other chat's shared.tsx edit is a blank-line move) |
| `npm run verify` | GREEN (EXIT 0), "blocks-check: OK — 16 registered kinds, 29 targets", tweak readers "32× in 20 place(s)" | GREEN (EXIT 0), same last line, same reader count |
| parity vs WP9a | NUMBER 0, breakdown-part 0, sumOk 0 | — |
| parity vs baseline (WP3's allow lists) | NUMBER 10 (+66 allowed), breakdown-part 24, sumOk 4, character set 2. The full list is byte-equal (`diff --strip-trailing-cr`) to the first WP4 run's 11,848-byte list | — |

- The snapshot took 17.7 s. It was copied to the main tree's untracked `work/.partB-wp4.json`, with the three compare
  lists (`.partB-wp4.vs-wp9a.txt`, `.vs-baseline.txt`, `.vs-baseline.full.txt`), replacing the first run's.
- The worktree's first verify run stopped at `parity-residual-check` ("no batch files found"). The gitignored
  `work/wg-batch-NNN-NN.json` inputs (145 files) had not been copied. They were copied in (no tracked file touched),
  and the re-run was GREEN.
- Teardown, in this order:
  1. Removed both junctions first (`rmdir`).
  2. Rewrote the 6 tracked files from `git show HEAD:`, deleted the temp files, and checked that `git status` was
     clean.
  3. Ran a plain `git worktree remove` + `prune`.
  4. Confirmed the folder is gone with `git worktree list` and `ls`.
  5. Main `node_modules` still has 421 entries (426 with hidden ones) and tracker 471 (476). vitest and typescript
     are present.

---

- **HEAD at build time:** `6a386d9` (WP9a).
- **Foreign check at the start:** only `src/builder/shared.tsx` held another chat's edit. Two untracked files were
  also foreign: `cpo.json` and `docs/homebrew-stat-block-for-chats.md`. WP4 touches none of them.
- **Foreign check at the end:** every hunk in `src/App.tsx`, `src/builder/Builder.tsx` and `src/sheet/GmEditSheet.tsx`
  is WP4's (checked with `git diff`), so **no `wp4-*.patch` file is needed**.

## What was built (by symbol)

### NEW `src/rules/blocks/save.ts`

Pure. It imports `../build`; build.ts never imports it. It is a home file of the overrides-readers guard.

**`openForTweaks(build, content)`** (B4, section 3.3)
- Stamps the Builder's DRAFT once, at open. It never stores anything.
- Returns `build` itself when there is nothing to stamp.

**`stampTweaksSave(build, content)`**
- The same stamp, run by `submit` on the build it hands to `onCreate`.
- Idempotent: a second Save writes nothing more.
- It also stamps an entry that an un-routed writer (the old OverridesCard) added after open.

**Private `stamp` / `metaStamps` / `storesTweaks`** (section 3.3, steps 1-4)
1. **Nothing stored:** if `overrides` holds no entry, no block and no unknown key (`v` and `meta` alone are no tweak,
   B15), the build comes back unchanged.
2. **Version and switch:**
   - `v: Math.max(2, stored v)` (B27: a stored `v: 3` stays 3).
   - While the stored switch is not yet the authority (no `v ≥ 2`), it writes
     `options.overridesEnabled = tweaksSwitchOn(build)`. An old character reads ON, so it is stamped `true`.
3. **Old entries** (`legacyEntries`) without matching meta get `meta[key] = { of, moved: true }`, plus:
   - `mode` for a rank, from `buildCharacter(build, content).tweakRankSort`: THE sort the sheet used. The character is
     built once, lazily.
   - `baseline` for `attributes:<ab>` and `maxHp:max-hp`, from `baselineFor`.
   - (Fix round) A build with no class, or one that throws, has no character: its sortable ranks and its sets are left
     exactly as stored (no meta at all), so the first Save of a real character stamps them whole.
4. **Stale meta:** a meta whose `of` names another value keeps ONLY its `reason`.
5. **Import-stamped entries** are never marked `moved`.
6. **A matching rank meta that has no `mode`** (a reason written before Tweaks) is frozen as
   `{ ...meta, mode, of, moved }`. That is exactly what `withRankSort` already lays over it in memory. (Fix round) A
   matching meta with a `mode` this version does not know is never rewritten (`freezable`).
7. **Unknown shapes are kept:** a `meta` that is not a map, or any meta value that is not an object, is kept and never
   stamped into (UNKNOWN ≠ EMPTY).
8. Every other key is carried byte-equal.

**`castingEntryChanges(prev, next): CastingChange[]`** (B16)
- Matches entries by `SpellcastingEntry.id`. It looks only at prepared and spontaneous entries (`CHOSEN`).
- The lines it reports:
  - `removed`
  - `prepared → spontaneous` (any type change)
  - `no prepared spell slots left`
  - `repertoire a → b spells`. Capacity is `spellCollection` when it is a number, otherwise Σ over ranks ≥ 1 of
    `repertoireMax[r] ?? slots[r].max`.
  - `cantrips a → b`
- `interface CastingChange { id, name, what: string[] }`.

### NEW `src/rules/blocks/baseline.ts`

**`baselineFor(c, db, target, build?)`**: the book number under a set.
- **Score targets with a build:** the computed score without the set and without `attribute.add`
  (`computeAbilitiesDetailed(build, contentFor(db, build))`).
- **Score targets without a build:** `c.abilities[ab]` minus the live `attribute.add` blocks. It is `undefined` while
  a live set exists.
- **Every number target** (max HP included): `bookTotal(numberTermsFor(c, db, target))`. These are WP5's exports, so
  the open stamp and the TweakEditor (WP7) get the same number.
- (Fix round) **Max HP is `undefined` while a live Con set or Con `attribute.add` exists**: the Con is inside its
  `(class + Con) × level` base line. The other number targets need the same guard for the ability and rank feeding
  each; that is WP7's (written in plan.md WP7 and in the code comment).

### NEW `src/data/editBuild.ts`

**`editableBuildOf(saved, db): { build, derived }`**
- Returns the stored build when one exists, and then never calls `deriveBuildFromCharacter`.
- Otherwise it returns the reverse build.
- If the reverse build throws, it logs with `console.error` and returns `{ ...emptyBuild(), overrides, options }`
  with `derived: true`. The character's own tweaks and switch are carried (UNKNOWN ≠ EMPTY).

### NEW `src/builder/tweaks/castingConfirm.tsx`

**`confirmCastingChanges(changes)`**
- An empty list resolves `true` with no dialog.
- Otherwise it opens `confirmDialog`:
  - **Title:** "This changes <entry name>", or "This changes N spellcasting entries" when there are several.
  - **List:** `ul.casting-changes` with one line per entry, "**name**: what; what".
  - **Text:** "Spells you prepared or chose for it stay saved, and come back if the change is undone." (fix round:
    the bracket naming causes is gone, because the question also fires on a level-down or a class change).
  - **Buttons:** "Save anyway" / "Keep editing".

### Wiring the save path into the app

**`src/builder/Builder.tsx`** (CRLF kept)
- The `useUndoableState` initializer is now `initial ? openForTweaks(initial, baseContent) : emptyBuild()`.
- `submit`, after the "choices left" dialog and only when `initial` exists:
  - It calls `castingEntryChanges(buildCharacter(initial, baseContent), featPrereqChar)` inside a try/catch (a warning
    on a throw; Save still saves).
  - It then calls `confirmCastingChanges`. "Keep editing" returns without saving.
  - Last, it calls `onCreate(stampTweaksSave(build, baseContent))`.

**`src/App.tsx` `onEdit`** (CRLF kept): calls `editableBuildOf(active, ownDb).build`. The unused
`deriveBuildFromCharacter` / `emptyBuild` imports were dropped.

**`src/sheet/GmEditSheet.tsx` `openBuilder`** (CRLF kept): calls `editableBuildOf(work, viewContent).build`.

### Guard, docs and the KNOWN LIMIT test

**`src/rules/blocks/overrides-readers.json`**: new entry `src/data/editBuild.ts#editableBuildOf`.
- Count 2. Why: storage carried as it is. The blank build carries the stored `overrides` object (and `options`)
  unchanged, and applies nothing.
- Same change as the reader (section 7.1). Without it, `overrides-readers-check` had 14 failures; with it, 18/18.

**`docs/overrides-redesign.md`**: appended "Open point 8, as built (2026-10-21, part B WP4)". It records:
- The launch rebuild already applies case D: `rebuildRoster` → `buildCharacter` → `heldFeatSlots`. A test proves it.
- So the 2026-10-20 browser note was a stale-module artefact.
- `playForRebuild` keeps every key.
- The new casting confirm.

**`test/blocks-rank-seams.test.ts`**: two comment lines in the KNOWN LIMIT test, pointing to
`test/tweaks-edit-path.test.ts`. The test itself is unchanged and still pins the reverse build's loss.

### Open point 8, first step

The step was proven before the confirm was built: "the launch rebuild already turns a cleric given Flexible
Spellcaster Dedication spontaneous".
- The test runs `rebuildRoster` on a stored roster with a stale cache.
- The cleric's `cleric-casting` comes back `spontaneous` with `spellCollection` 4, equal to the picked feat.

## Files

**New source**
- `src/rules/blocks/save.ts` (LF)
- `src/rules/blocks/baseline.ts` (LF)
- `src/data/editBuild.ts` (LF)
- `src/builder/tweaks/castingConfirm.tsx` (LF)

**Changed**
- `src/App.tsx`, `src/builder/Builder.tsx`, `src/sheet/GmEditSheet.tsx` (CRLF kept)
- `src/rules/blocks/overrides-readers.json`, `docs/overrides-redesign.md`, `test/blocks-rank-seams.test.ts` (LF kept)

**New tests**
- `test/tweaks-save-stamp.test.tsx`
- `test/tweaks-save-stamp-numbers.test.ts`
- `test/tweaks-edit-path.test.ts`
- `test/tweaks-casting-confirm.test.tsx`

**This report:** `work/tweaks-part-b-notes/wp4-report.md`

**Untracked outputs (do not commit)**
- `work/.partB-wp4.json` (the snapshot)
- `work/.partB-wp4.vs-wp9a.txt`
- `work/.partB-wp4.vs-baseline.txt`
- `work/.partB-wp4.vs-baseline.full.txt`

## Tests

### `test/tweaks-save-stamp.test.tsx` (jsdom, 13 tests; 3 added in the fix round, listed in "Fix round" above)

Fixture: the frozen OLD SAMPLE on a synthetic level-5 fighter, plus the hidden-card character.
- **"opening the Builder stamps v: 2, the switch, and each old entry's mode, of, moved and baseline into the draft
  only"**
  - Checks the exact meta.
  - Checks the baselines against `deriveMaxHp` and the scores.
  - Cancel asks nothing and stores nothing.
  - The hidden-card character's Setup switch (`button.ovr-opt`) shows ON at open.
- **"ON by read before the first save; the stored switch is obeyed after it"**: `it.each` over SAMPLE and the hidden
  card.
- **"Save writes v: 2 and overridesEnabled together; Cancel writes nothing and asks nothing"**
- **"the first Save of SAMPLE changes no old key…"**: the raw `lore:Sailing Lore` key stays raw; the old keys are
  byte-equal; only `v` and `meta` are added.
- **"a stale meta keeps its reason through the open stamp; its on, from, source and baseline do not come back…"**
- **"a second Save of a stamped build writes nothing more"**
  - An entry added after open gets `{ of, moved }`.
  - Source pins on `onCreate(stampTweaksSave(build, baseContent));` and on the initializer.
- **"a character with no overrides gets no overrides object"**: the empty `{ v, meta }` shell too.
- **"the GM's Builder stamps the same way, and only on Save"**: GmEditSheet → Edit in builder → Cancel → the export is
  unchanged → Edit → Save → the export equals `openForTweaks(build, db).overrides`.
- **"stampTweaksSave / openForTweaks keep v: 3 (B27)…"**: an opaque meta string is kept too.

### `test/tweaks-save-stamp-numbers.test.ts` (node env, 1 test)

"opening the Builder moves no number: every overrides character of the snapshot builds the same before and after
openForTweaks"
- Runs over every non-twin `overrides:` spec of `scripts/blocks-parity-snapshot.mjs`, under both trust gates, through
  the snapshot's own `snapOne`.
- Numbers and breakdowns must be equal.
- It also checks that the stamp is real: every spec is stamped (`stamped === specs × 2`), and both modes and
  baselines are greater than 0.

### `test/tweaks-edit-path.test.ts` (jsdom, 4 tests; "the fallback's blank build gets no mode and no baseline…" added in the fix round)

- **"both edit paths use the stored build and never reverse-derive one when it exists"**
  - The unit test uses a Proxy character that throws on any read.
  - The GM path is mounted with a pass-through spy on `editableBuildOf`, which must return
    `{ build: sc.build, derived: false }`.
  - Source pins on App `onEdit` and GmEditSheet `openBuilder`; neither may contain `deriveBuildFromCharacter(`.
- **"wizard classSkills [athletics] + exactly expert Athletics keeps athletics in classSkills through a Builder save
  round trip"**
- **"the reverse-derive fallback keeps overrides and options"**: the same object, `toBe`.

### `test/tweaks-casting-confirm.test.tsx` (jsdom, 7 tests)

- "the launch rebuild already turns a cleric given Flexible Spellcaster Dedication spontaneous"
- "castingEntryChanges names the cleric entry: prepared → spontaneous", plus synthetic shapes: removed, no slots
  left, smaller repertoire, fewer cantrips, and the non-chosen types ignored.
- "no casting change, no dialog"
- "Keep editing leaves onCreate uncalled"
  - Builder with a cleric given FSD → Setup → switch Tweaks off → Save.
  - The dialog says "This changes Divine prepared spellcasting" / "spontaneous → prepared", and (fix round) "come
    back if the change is undone" with no cause named.
  - "Keep editing" → nothing is created.
  - "Save anyway" → created with `overridesEnabled: false`, `v: 2`.
- "playForRebuild keeps every preparedSpells key"
- "pausing a given casting dedication and saving keeps its preparedSpells / known-spell keys, and resuming restores
  them", in two variants:
  - **Its own switch:** `writeTweak` setOn, on a fighter given Wizard Dedication. The keys
    `wizard-dedication-casting:cantrip:0/1` (electric-arc / shield) are kept, and the entry is removed, then restored.
  - **The master switch off:** `setTweaksSwitch`, on a cleric given FSD. `repertoireSpells` (bless / heal) are kept.
  - Both variants assert that the casting confirm fires ("removed").

### Runs (all through `node scripts/vt.mjs`; never `npx vitest`; never beside a snapshot)

| where | files | tests | result |
|---|---|---|---|
| main tree | the 4 new files + phone-builder-leave, bug-builder-save-lossless, bug-builder-roundtrip, gm-sync, rebuild-sync, given-feat-builder-ui, overrides-write, persist (the plan's list) + content-path-pin, tweaks-load-not-edit, blocks-rank-seams, given-feat-like-picked, tweaks-write, overrides-readers-check | 345 in 18 files | all passed |
| WP4-only worktree | the same 18 files | 345 | all passed |
| main tree, after the header updates | save-stamp, edit-path, casting-confirm | 20 | all passed |
| main tree, after the header update | save-stamp-numbers | 1 | passed |
| fix round, main tree | the 4 WP4 files | 25 | all passed |
| fix round, WP4-only worktree | the same 18 files (before the comment-only mutation-proof header edits) | 349 | all passed |
| fix round, main tree (after the test headers were updated) | the same 18 files | 349 | all passed |

### Mutation proof

Each mutant was run ALONE in the worktree, then reverted. Afterwards every WP file was confirmed `cmp`-equal to the
main tree's.

| # | mutant | red |
|---|---|---|
| M1 | Builder initializer back on `initial ?? emptyBuild()` | save-stamp "opening the Builder stamps…" (switch shows OFF / draft has no switch), save-stamp "a second Save…" (initializer pin), casting "Keep editing…" — 3 |
| M2 | `submit` → `onCreate(build)` without `stampTweaksSave` | save-stamp "a second Save…" (source pin) — 1 |
| M3 | stale meta spread kept (`{ ...m, reason, of, moved }`) | save-stamp "a stale meta keeps its reason…" — 1 |
| M4 | `v` always 2 (a stored 3 lowered) | save-stamp "…keep v: 3 (B27)…" — 1 |
| M5 | every rank stamped `atLeast` | save-stamp-numbers (first red `overrides:daily:wizard-L8 [off]` numbers) — 1 |
| M6 | `editableBuildOf` calls `deriveBuildFromCharacter` first | edit-path "both edit paths…" (character read) and "fallback…" (throw outside the try) — 2 |
| M7 | the catch returns a bare `emptyBuild()` | edit-path "fallback…" — 1 |
| M8 | GmEditSheet `openBuilder` back on HEAD's code | edit-path "both edit paths…" (spy never called) — 1 |
| M9 | `submit` never asks (`true ‖ confirm…`) | casting "Keep editing…" — 1 |
| M10 | `castingEntryChanges` skips a removed entry | casting "names the cleric entry…" (synthetic removed), both pause/resume tests — 3 |

The mutation-proof headers in the four test files now name exactly what each mutant turned red.

## Type-check

`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` and the same with `-p tracker/tsconfig.json`:

| where | app | tracker |
|---|---|---|
| main tree (the other chat's shared.tsx edit present) | EXIT 0 | EXIT 0 |
| WP4-only worktree | EXIT 0 | EXIT 0 |

## npm run verify

| where | result | last line | tweak readers |
|---|---|---|---|
| main tree (the other chat's shared.tsx edit present) | GREEN (EXIT 0) | "blocks-check: OK — 16 registered kinds, 29 targets" | "32× in 20 place(s)" |
| WP4-only worktree | GREEN (EXIT 0) | same | same |

## Parity

Snapshot in the WP4-only worktree (HEAD `6a386d9` + WP4), which took 21 s:
`node node_modules/jiti/lib/jiti-cli.mjs scripts/blocks-parity-snapshot.mjs --out work/.partB-wp4.json`.

Both compares ran against COPIES, so no earlier compare list was overwritten.

**1. Against WP9a's snapshot:** `--compare <copy of work/.partB-wp9a.json> --against work/.partB-wp4.json`
- Result: **NUMBER 0, breakdown-part 0, sumOk 0.**
- That is exactly what "no engine change" predicts.
- The snapshot is the same size as WP9a's (33,506,190 bytes).

**2. Against the part-B baseline**, with WP3's allow lists:
- `--allow '^overrides:(test-sample|proficiencies|hidden-card|lore|lowered-raise|maxHp:wizard-L5#(mode|con-mode))'`
- `--allow-stat '^(build\.hash|(explain\.)?skill\..*|pc\.skills\..*|(explain\.)?save\..*|pc\.(fort|ref|will)(Mod|Prof)|(explain\.)?perception.*|pc\.perception.*|summary\.perception.*|(explain\.)?initiative.*|(explain\.)?class-?[dD][cC].*|pc\.classDC|ac|explain\.ac.*|pc\.ac|hp\.max|explain\.hp\.total|pc\.maxHP|summary\.hpMax)$'`

Result: these are exactly the counts of WP3, WP5 and WP9a (the full list is 11,848 bytes, the same as WP5's). Compare 1
shows WP4 equals WP9a row for row, so every row is WP3's and is already classified in wp3-report.md:

| count | what | explained by |
|---|---|---|
| 10 NUMBER, not allowed | `build.hash` changes on asof:fighter-L5, at-slot:fighter-L4, daily:wizard-L5/L8, firearm:gunslinger-L5, under both gates | the derived `tweakRankSort` field WP3 added to the Character (no sheet number) |
| 66 NUMBER, allowed | | cases A, B, C and the Lore-row move |
| 24 breakdown-part | | thievery / medicine / Lore rows and the max-HP book lines |
| 4 sumOk | | the Lore-row move: "Sailing Lore" → `sailing` |
| 2 character set | | the new-shape pair, `overrides:new-shape:fighter-L5` (+ `#none`) |

WP4 adds no difference. Opening and saving never move a number. The node-env test above proves this a second way:
it builds every overrides character before and after the stamp.

## Worktree proof and teardown

**Setup**
- Path: `C:\Users\r2g2\AppData\Local\Temp\hh-wp4`, HEAD `6a386d9`, made with `git -c core.autocrlf=false worktree
  add --detach`.
- The tracked WP4 diff (6 files, +52 −22) went in via `git apply`; the 8 new files were copied in.
- `node_modules` and `tracker/node_modules` were junctioned in.
- Copied in: `work/wg-batch-*.json`, `.partB-baseline.json` and `.partB-wp9a.json`. The 9 residual JSONs that the copy
  turned to CRLF were rewritten from `git show HEAD:<path>`.
- Ran there: tsc (app + tracker), the 18 test files, `npm run verify`, the snapshot, both compares, and the 10
  mutants.
- Three LF files (overrides-readers.json, the doc, blocks-rank-seams) came out CRLF in the worktree, because the repo's
  `core.autocrlf=true` applied to `git apply`. Their content is identical to main's (`diff --strip-trailing-cr`). The
  main tree keeps each file's own line endings, and HEAD's blobs are LF.

**Teardown**
1. Removed both junctions FIRST (`rmdir`).
2. Rewrote the tracked files from HEAD bytes and deleted the temp untracked files. `git status` was then clean.
3. Ran a plain `git worktree remove` + `git worktree prune` (no `--force`).
4. Confirmed the folder is gone in two ways: `git worktree list` and `ls`.
5. Main `node_modules` has 421 entries (`ls`; 426 with `-A`) and tracker 471 (476 with `-A`), as before. vitest and
   typescript are present.

## Deviations from the plan (with reasons)

1. **`baselineFor(c, db, target, build?)` takes an optional build and already covers every number target.**
   - With the build, a score's baseline is computed from the build's boosts exactly as the sheet computes it,
     instead of being reverse-engineered from `c.abilities`.
   - Every number target goes through WP5's `numberTermsFor` + `bookTotal`, which already exist. The plan had left
     that extension to WP7, which now only calls it.
   - For max HP, `bookTotal` over the tweak-free term list is the plan's "permanent pool of `maxHpTerms` with every
     tweak term left out".
2. **"Opening the Builder moves no number" lives in its own node-environment file**, `tweaks-save-stamp-numbers.test.ts`,
   not in `tweaks-save-stamp.test.tsx`. The parity instrument's `fileURLToPath(new URL(...))` refuses jsdom's URL
   ("The URL must be of scheme file").
3. **The casting comparison passes `baseContent` for the stored build**, not "ovContent-of-initial". `buildCharacter`
   lays the build's own live content edits itself (`content = contentFor(content, build)`, the one content path), so
   this is the same character. The "after" side is the Builder's existing memo `featPrereqChar` (this build,
   `ovContent`), so nothing is built twice.
4. **The casting check covers prepared and spontaneous entries only.** Focus, innate, item and ritual entries are
   granted lists that hold no choice of the player's (`play.preparedSpells` / `repertoireSpells` exist only for the
   chosen types).
   - "A smaller repertoire" means fewer PLACES (capacity), not fewer picks: removing a spell in the Builder is the
     player's own change.
5. **The compare is wrapped in try/catch.** The question is advice. If the stored build cannot be built to compare,
   Save still saves, with a `console.warn`. It must never block a Save.
6. **A matching rank meta with no `mode` is frozen too** (`{ ...meta, mode, of, moved }`). This is not in section 3.3's
   step list.
   - Without it, an old rank entry whose reason was written before Tweaks would be re-sorted at every launch, and a
     level-up could flip it (B4: "after the stamp the sort never runs again").
   - The frozen value is exactly what `withRankSort` lays over it in memory today, so no number moves (the numbers
     test covers it).
7. **The dialog line is "Spells you prepared or chose for it stay saved, and come back if the change is undone."**
   - The plan's line was "Spells you prepared for it stay saved and come back if you remove the feat".
   - The new wording also covers a spontaneous repertoire, a pause, the master switch, a level-down and a class
     change, which the plan's own B16 cases include. (The first build's bracket, "remove the feat, or turn the tweak
     back on", was dropped in the fix round: it did not fit a level-down or a class change.)
   - It is written only after the `playForRebuild` / pause / switch tests passed, as the plan requires.
8. **The App edit path is pinned by its source, not mounted.** Mounting the whole App shell needs the roster, auth and
   service-worker layers. The GM path IS mounted with a spy. Both paths call the same function, and its behaviour is
   unit-tested.
9. **The edit-path spy is a Proxy character plus a pass-through spy on `editableBuildOf`**, not a spy on `build.ts`.
   - The Proxy throws on any read of the character, so a reverse build cannot run unnoticed.
   - Mocking `../src/rules/build` broke unrelated imports in the jsdom environment.
10. **The open point 3 "page notice" is not built here.** `editableBuildOf` returns `derived`, but the one-line notice
    belongs on the Tweaks page (section 3.2: "the page shows a one-line notice when the Builder was opened from a
    reverse build … and rank tweaks exist"), and no Tweaks page exists yet (WP6/WP7).
    - Both hosts pass only `.build` today.
    - **Hand-off to WP6** (fix round: now written in `plan.md` WP6 "Files and symbols" and section 6 row 3, not only
      here): keep `derived` in App's `editing` state and GmEditSheet's, pass it as a Builder prop, and show the
      notice there, with its test.
11. **(Fix round) A classless or unbuildable build leaves its ranks and sets with no meta at all**, rather than the
    suggested `{ of, moved }` without mode or baseline. Reason: a `{ of, moved }` meta is "matching" for good, so a
    set's baseline would never be stamped by any later Save (see "Fix round" item 3).
12. **(Fix round) `plan.md` was edited twice** (WP6's notice bullet, WP7's baseline-guard note), plus section 6 row 3.
    `plan.md` is untracked working notes, so it is not in the files list.

## Ask Guy

Nothing. No ruling conflict, unsettled print or impossible step came up.

## Tell Guy (plan section 10, no question needed)

- Characters with old Overrides show Tweaks after their first Builder open + Save, even if the old card was switched
  off (that switch only hid the card; the changes always counted).
- Saving a character whose casting changes (a Flexible Spellcaster Dedication given or picked, a casting dedication
  paused, Tweaks switched off) now asks first, names the entry and what changes, and says the chosen spells stay saved.

## Out of scope (seen, not fixed)

- **The Options "Overrides" toggle writes `overridesEnabled` alone, without `v`** (shared.tsx, the other chat's file).
  For a character whose overrides have no `v`, the next Save stamps the switch as it READS (ON), so a player who
  switched it off before their first Save sees it ON again. WP6/WP7 route that toggle through `setTweaksSwitch`, which
  writes `v` with it.
- **The blank-build fallback keeps only `overrides` and `options`.** The rest of a character whose reverse build
  throws is still lost on Save (plan section 8: chat-todo).
- **The old OverridesCard still writes entries without meta.** The Save stamp marks them `moved` (read as the old `=`)
  until WP7 retires the card.
- ~~The max-HP baseline's base line uses the Con the sheet shows~~: fixed in the fix round (finding 6). **Still open
  for WP7:** every OTHER number target's `bookTotal` includes a live attribute tweak on the ability feeding it (AC
  under a Dex set) and a rank tweak on its proficiency term (a skill set under an "at least" floor). WP4 stores no
  such baseline; WP7 must add the guard before its TweakEditor stores one (written in plan.md WP7).
- **(WP3's code) `unsortedRankKeys` / `withRankSort` still sort a rank whose meta `mode` this version does not know**
  (`stored.ts` reads any mode other than atLeast/exactly as `rank.legacySet`). The Save no longer stores that sort
  (finding 1), but in memory the newer app's entry is read as a sorted old `=`, so the sheet shows it as this app's
  "at least" / "exactly". This is for WP3's owner: `unsortedRankKeys` should skip a matching meta that has ANY `mode`,
  and the reader should list it as a newer-version entry (read-only).
- **The engine names the cleric's FSD entry "Divine prepared spellcasting" even when it is spontaneous.** The dialog
  shows that name ("This changes Divine prepared spellcasting" / "spontaneous → prepared").
- **Focus and innate entry changes never ask** (deviation 4).
- **The confirm dialog body never scrolls.** WP9a noted this too. A casting list is at most a few lines, so it was not
  given its own scroll.

## Not checked

- The dialog in a real browser or at phone width (jsdom has no layout; WP10's browser test covers the screens).
- Launch time with the extra `buildCharacter` per old character at Builder open. It is one build, and only when an
  entry needs a mode or baseline.
