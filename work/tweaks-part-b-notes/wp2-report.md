# WP2 report — one reader: every kind obeys the switch, its own on/off and its start level (builder, 2026-10-21)

Every kind of tweak now goes through ONE reader (`src/rules/blocks/active.ts`) that applies three things:
- the Tweaks master switch,
- each entry's own on/off,
- each entry's start level.

An entry stamped `source: 'import'` ignores the master switch.

A new guard in `npm run verify` fails on any other read of `.overrides`.

Nothing is committed and nothing is staged (`git diff --cached` is empty).

HEAD moved while I worked. The other chat ("Character-specific campaigns") committed `cc98926` and then `b02e521`, and it is still editing:
- `src/App.tsx`
- `src/data/campaign*.ts`, `src/data/storage.ts`
- its campaign tests

So `src/App.tsx`, `src/builder/Builder.tsx` and `src/builder/shared.tsx` go in through patches only. The patches were remade against `b02e521`, and all three pass `git apply --cached --check`. `src/builder/shared.tsx` still holds one foreign hunk (a blank line moved near `setIds`).

**Commit recipe (orchestrator):**
```
git add src/rules/blocks/active.ts src/rules/blocks/stored.ts src/rules/blocks/content.ts src/rules/blocks/registry.ts \
  src/rules/blocks/check.ts src/rules/blocks/overrides-readers.json src/rules/blocks/feat-readers.json \
  src/rules/heldFeats.ts src/rules/build.ts src/rules/derive.ts src/rules/play.ts src/sheet/partySummary.ts \
  src/integration/computePcStats.ts src/integration/pcSheetTruth.ts src/data/transfer.ts src/sheet/GmEditSheet.tsx \
  src/sheet/FeatsTab.tsx src/sheet/SpellsTab.tsx src/sheet/PartyMembers.tsx \
  scripts/lib/feat-readers.mjs scripts/blocks-check.mjs scripts/blocks-parity-snapshot.mjs \
  test/tweaks-pause.test.ts test/tweaks-import-stamp.test.ts test/overrides-readers-check.test.ts \
  test/content-path-pin.test.tsx test/overrides.test.ts test/bug-builder-gear-reaches-sheet.test.ts \
  test/bug-builder-roundtrip.test.ts test/bug-builder-save-lossless.test.ts test/bug-save-anyway-roundtrip.test.ts \
  test/card-feat.test.tsx test/card-ours.test.tsx test/record-ids.test.ts
git apply --cached work/tweaks-part-b-notes/wp2-App.tsx.patch       # 1 hunk
git apply --cached work/tweaks-part-b-notes/wp2-Builder.tsx.patch   # 6 hunks
git apply --cached work/tweaks-part-b-notes/wp2-shared.tsx.patch    # 3 hunks
git diff --cached --stat     # 37 files
```
Never `git add` App.tsx, Builder.tsx or shared.tsx. Before staging, read `git diff HEAD -- <file>` for the 34 files above, because the other chat is active. At my last check they held WP2 hunks only, and `src/sheet/PartyMembers.tsx` held my one hunk.

## What I built (by symbol)

### `src/rules/blocks/active.ts` (the ONE READER, LF)

**Predicates**
- `entryOn` and `tweaksSwitchOn` are re-exported from stored.ts, so there is one copy of each.
- `entryLive(inst, host)` = `entryOn(inst, tweaksSwitchOn(host))` && `startLevelOf(inst) <= host.level`.
- `startLevelOf(inst)` = 1 for the B25 kinds (remove.feat, choice.allowAnyway, text.edit; computed from the registry: no `level` part). For every other kind it is `legacyStartLevel`, which is `from`, or max(stored level, from) for given feats and class features (D6).
- `SwitchHost` / `TweakHost`.
- `blockLive` uses `entryLive`, so `activeNumberBlocks`, `rankTweaks`, `numberTweakTerms` and `scoreAddBlocks` take the host (`{overrides, options, level}`).

**Accessors** (all through one `legacyOf(h, list)`, i.e. `readLegacyBlocks` fed one key plus meta):
- `liveAttributeSets`
- `liveRemovedFeatIds`
- `liveAllowedFeats` and `isAllowedAnyway(h, featId)`
- `liveGivenFeatures`: listed from max(stored, from), and only once the character reaches that level.
- `liveGivenSpells`: rituals and non-rituals; the caller splits them.
- `liveGivenLanguages`
- `liveLegacyRanks`: the unsorted `rank.legacySet` entries the old `=` loop applies. B2: an unreadable rank keeps today's `=`.
- `liveMaxHpSet`
- `liveContentEdits(h)`:
  - memoised in a WeakMap per `contentEdits` × `meta`; the switch is read AFTER the lookup;
  - returns the stored object itself when every edit is on, a subset when some are paused, and null when none are;
  - so `contentFor`'s identity cache stays warm.

### `src/rules/blocks/stored.ts`
- Exports `entryOn` and `legacyStartLevel`.
- `GivenFeat.imported`.
- The `GIVEN` cache holds `{ list, importedOnly }`, once per (`addedFeats`, `meta`).
- `activeGivenFeats` reads the switch after the cache lookup (switch on → list, off → importedOnly). The early `return []` is gone, and the function has no level parameter.

### `src/rules/blocks/content.ts`
- `contentFor(db, host)` (B13) lays only `liveContentEdits(host)` over the database.
- The header says that contentFor cannot un-apply an edit, so every memo that calls it keys on `options` too.
- `editsOf` throws a TypeError when it is handed a bare overrides object (a host with a `contentEdits` key). A missed caller therefore fails loudly instead of silently dropping every edit.

### `src/rules/blocks/registry.ts`
`applies: 'blocks'` for:
- attribute.set
- grant.language, grant.spell, grant.classFeature
- remove.feat, choice.allowAnyway, text.edit

`rank.legacySet` stays legacy, and `number.setMaxHp` waits for WP3.

### `src/rules/build.ts` (CRLF kept)
`buildCharacter`:
- `heldPickGranters`, the focus pass, the pick-a-feat `removedGranters` and the late splice read `liveRemovedFeatIds(build)`.
- The attribute loop reads `liveAttributeSets(build)`.
- `scoreAddBlocks(build, ab)` and `rankTweaks(build)`.
- The old `=` loop reads `liveLegacyRanks(build)`.
- `addedSpells` reads `liveGivenSpells`.
- `grantedFeatures` reads `liveGivenFeatures`.
- Languages read `liveGivenLanguages`.
- `hitPoints.current` and `maxOverride` read `liveMaxHpSet`.

Other functions:
- `collectChosenIds` still counts paused entries (comment added).
- `removeChosenIds` goes through `dropEntries` ×4: the meta follows, `v` is never touched, and an emptied store becomes `undefined`.
- `deriveBuildFromCharacter`:
  - `contentFor(content, c)` and `scoreAddBlocks(c, a)`;
  - the overflow is `markImported(…, 'addedFeats', existing.length)`, which never writes `v` (B27).

### Other engine files
- `src/rules/heldFeats.ts` `heldFeatSlots` uses `liveRemovedFeatIds(build)`.

**contentFor callers that now pass the host:**
- derive.ts `deriveMaxHp`
- play.ts
- partySummary.ts
- computePcStats.ts
- pcSheetTruth.ts
- PartyMembers.tsx
- GmEditSheet.tsx `sheetContent`, deps `[viewContent, work.character.overrides, work.character.options]`
- App.tsx `sheetContent` (patch), deps `[activeContent, active?.character.overrides, active?.character.options]`
- Builder.tsx `ovContent` (patch), deps `[baseContent, build.overrides, build.options]`
- transfer.ts `exportWg`
- `scripts/blocks-parity-snapshot.mjs` `E.contentFor(baseDb, built)`

**Elsewhere:**
- `src/data/transfer.ts` `importFromWg` ritual block uses `markImported(…, 'addedSpells', prior.length)`, and writes no `v`.
- `src/builder/Builder.tsx` (patch):
  - `overridden`, `featIneligible` and `allowed` use `isAllowedAnyway(build, id)`;
  - `canOverride` and the Setup card gate use `tweaksPageOn(build)` (B14).
- `src/builder/shared.tsx` (patch): `AttributeEditor` `pinned` and the `FullStats` lock use `liveAttributeSets(build)`.
- `src/sheet/FeatsTab.tsx` `overrideOf` uses `liveContentEdits(character)`.
- `src/sheet/SpellsTab.tsx` `myRituals` uses `liveGivenSpells(character)`, with deps `+options +level`.

### The guard (plan 7.1)

**`scripts/lib/feat-readers.mjs`:**
- `scanReaders(files, { fields, homes })`.
- `scanFeatReaders` keeps its old behaviour and messages.
- `scanOverridesReaders`, `OVERRIDES_READER_FIELDS`, `OVERRIDES_READERS_HOMES` and `OVERRIDES_READERS_ALLOW`.
- `readAllow(root, file)`.

**`src/rules/blocks/check.ts`:**
- A shared private `checkReaderAllow`, so `checkFeatReaders` keeps exact messages.
- `checkOverridesReaders`, whose advice text names the active.ts accessors.
- `OVERRIDES_READERS_HOME_NAMES`.

**Wiring:** `scripts/blocks-check.mjs` runs it, so it is part of `npm run verify`.

**NEW `src/rules/blocks/overrides-readers.json`:** 18 places, 29 names, each with a reason. The reasons are:
- writers: Take anyway; the ritual import; the overflow; `removeChosenIds`; clearAttrOverrides and OverridesCard, which are B17 / WP7;
- storage: `collectChosenIds`; the `built` carry; `deriveBuildFromCharacter`'s copy;
- useMemo dependency only: App `sheetContent`, Builder `ovContent` / `listAdditions` / `listAdditions2`, GmEditSheet `sheetContent`, SpellsTab `myRituals`.

**`src/rules/blocks/feat-readers.json`:**
- new `build.ts#deriveBuildFromCharacter` 1 (the `'addedFeats'` that names the list for markImported);
- the reason for `removeChosenIds` was updated for dropEntries.

**Current scan:** "overrides" 29× in 18 places; "addedFeats" 27× in 18 places; "featPicks" 53× in 41 places; 0 errors.

## Tests

**NEW `test/tweaks-pause.test.ts`** (jsdom):
- "every registry kind has a pause fixture" (16 kinds).
- `describe.each(kind)`:
  - master switch off pauses;
  - its own switch pauses;
  - a start level above the character's level pauses (levelled kinds: level 6 → baseline, level 5 → live);
  - switching back on resumes.
- An import-stamped given feat, and a ritual (through SpellsTab), stay when Tweaks is off.
- A given feat with from 5 is held at level 5 and above, not below.
- With the SAME overrides object, switching off un-holds a non-imported given feat and keeps an imported one.
- A paused entry still counts in `collectChosenIds`.
- `removeChosenIds` drops the meta of what it removes (v:3 kept; empty → undefined).
- A paused "Take anyway" feat stays picked and only its warning returns (the real Builder, a level-4 fighter, `[data-invalid="4:class:0"]`).

**NEW `test/tweaks-import-stamp.test.ts`:**
- importFromWg stamps rituals `source: 'import'`;
- a WG import with rituals reads Tweaks ON (no v);
- the reverse build's overflow feats are stamped (a given feat with a reason is not);
- a reverse build of a build-less old character keeps `tweaksSwitchOn` true.

**NEW `test/overrides-readers-check.test.ts`** (the feat-readers-check helpers):
- passes on the real tree;
- each entry has a reason, a count and no home file;
- planted cases each fail:
  - `build.overrides?.maxHp` in derive.ts;
  - `const { overrides } = c`;
  - `c['overrides']`;
  - shorthand plus literal in a new file;
  - a count above (a second read in SpellsTab `myRituals`' dependency list);
  - stale / too high / empty reason / bad count / bad shape / missing;
- never a hit: a type position, a comment, an object key, a longer name, the home files, the symbol chain.

**`test/content-path-pin.test.tsx`:** every call passes the host, and a bare overrides object throws. New tests:
- "a paused text edit reaches no surface (sheet, card, tracker, HP write, and the Builder's ovContent)", for two cases: its own switch, and master off.
- "switching Tweaks off on a v:2 build removes a text edit from the Builder preview and the sheet with no other edit": it clicks Setup → the Overrides option.

**Updated callers (they pass the host):** overrides, bug-builder-gear-reaches-sheet, bug-builder-roundtrip (6), bug-builder-save-lossless, bug-save-anyway-roundtrip, card-feat, card-ours, record-ids (2).

### Runs (all through `node scripts/vt.mjs`)

**The 26 files** (the 3 new ones, the plan's list, the 8 changed callers, tweaks-write and tweaks-stored):
- **Main tree, run 1:** 863 passed, 4 failed, 1 expected-fail (868). The failures were all in my new tests:
  1. content-path-pin: its supabase mock had no `auth.onAuthStateChange`, and the Builder's campaign card mounts `useAuth`. The mock gained it (×2 tests).
  2. content-path-pin, master-off case: the test expected the given Toughness to stay. That was wrong, because master off pauses the given feats too. The expected sheet is now the untweaked build.
  3. overrides-readers-check: the count-above plant sat inside `const ids`, which is a NEW nested place. It now plants in the memo's dependency list.
- **Main tree, rerun of the two fixed files:** 38/38.
- **WP2-only worktree:** 866 passed, 1 failed (a 5 s timeout), 1 expected-fail. The allowlist it() re-scanned ~250 files 7 times under load, so the scan is now cached per file set. Rerun of overrides-readers-check plus feat-readers-check: 31/31.
- **Main tree, final:** the 4 new or changed WP2 files, 111/111.

The memo-deps test was also reworked:
- Toughness is now a real level-3 general pick, so the text edit is the only tweak.
- With a given Toughness, switching off would pause the feat itself, and the stale-db mutation would no longer show.
- It also asserts the sheet draws +6 while the edit is on.

**Mutation proof (in the WP2-only worktree, mutants removed afterwards).** I made three mutants:
- Builder `ovContent` deps without `build.options`;
- transfer.ts without `markImported`;
- the build.ts overflow without `markImported`.

Running content-path-pin and tweaks-import-stamp against them, exactly 3 tests failed, 21 passed:
- the memo-deps test, "the Builder preview drops the edit at once": expected 35 to be 29 (the stale +6);
- "importFromWg stamps the imported rituals source 'import'";
- "the reverse build's overflow feats are stamped source 'import'".

Builder.tsx was afterwards byte-equal to HEAD + patch, and transfer.ts / build.ts equal to main's.

**Guard plant (plan: "plant once on a temp copy").** A scratch copy of src/test/scripts/docs:
- The unplanted copy: `npx jiti scripts/blocks-check.mjs --root <copy>` is OK.
- With `const planted = c.overrides?.maxHp` in `deriveMaxHp`, it reports FAILED, 1 problem: "src/rules/derive.ts#deriveMaxHp>planted (line 1228): names "overrides" 1× — read a character's tweaks only through src/rules/blocks/active.ts …".
- The copy is deleted.

## tsc / verify
- **Main tree:** tsc app EXIT 0 and tracker EXIT 0, after every edit, the foreign hunks included.
- **WP2-only worktree:** app EXIT 0, tracker EXIT 0.
- **`npm run verify`, main tree (background):** GREEN, EXIT 0. Last line "blocks-check: OK — 16 registered kinds, 29 targets", with the tweak readers line "overrides named 29× in 18 place(s)".
- **`npm run verify`, WP2-only worktree:** GREEN, EXIT 0, same last line.
- **Line endings** (node count):
  - CRLF kept: build.ts, play.ts, partySummary.ts, transfer.ts, GmEditSheet.tsx, SpellsTab.tsx, PartyMembers.tsx, App.tsx, Builder.tsx, bug-save-anyway-roundtrip.test.ts.
  - Every other touched file is LF, the new files included.
  - No file is mixed.

## Worktree proof (the tree the commit will hold)
- `git -c core.autocrlf=false worktree add --detach "C:/trying ai 2/hh-wt-wp2" HEAD` (b02e521, LF).
- Copied in: the 34 WP2 files (CRLF→LF), plus the 3 patches applied there. The worktree diff was App 7, Builder 19, shared 7 lines, all WP2.
- Inputs copied: the 145 untracked `work/wg-batch-*.json` files and `work/.partB-baseline.json`.
- `node_modules` and `tracker/node_modules` were junctioned.

Results there: tsc clean ×2, the 26 test files (above), `npm run verify` GREEN, and parity (below).

Teardown:
- The junctions were removed FIRST.
- `git worktree remove --force` is refused by a hook ("Ask Guy first"), so I emptied the worktree instead:
  - reverse-applied its own diff;
  - deleted my 7 copied untracked files (the 4 new WP2 files, the baseline copy, the compare txt and the snapshot).
- Then a plain `git worktree remove` and `git worktree prune` succeeded.
- Main `node_modules` is intact (421 entries, tracker 471, vitest / typescript present).

## Parity
`npx jiti scripts/blocks-parity-snapshot.mjs --out work/.partB-wp2.json`, then `--compare work/.partB-baseline.json --against work/.partB-wp2.json`, with NO `--allow`.

**Main tree:**
- NUMBER differences 0
- breakdown-part differences 0
- sumOk changes 0
- build/play errors 0/0
- every known case ok (gate off and on)
- character set changed 2:
  - `overrides:new-shape:fighter-L5` and its `#none` twin are new. They are WP1's added characters, not in the baseline, and they are the only reason the compare exits 1.

**WP2-only worktree:** the same numbers (0 / 0 / 0, set changed 2, the same two ids).

There are no allowed diffs to explain. Pure routing: every snapshot character reads ON and none stores `on: false` / `from`. `work/.partB-wp2.json` is untracked output; do not commit it.

## Deviations (with reasons)
1. **B2 over the pause table's "broken" row.** `liveLegacyRanks` keeps an unreadable unsorted rank as today's `=` while it is live; master off, its own switch and a start level still pause it. B2 says it "stays `rank.legacySet` (today's `=`, untouched)", and no number may move outside A–D.
2. **`liveMaxHpSet` applies only a number.** A corrupt non-number `maxHp` used to flow raw into `hitPoints.current`; now it is not applied. No snapshot character has one.
3. **Given class features gated by start level.** Per the pause table, they are listed from max(stored level, from) and only once the character reaches that level. An old character whose given class feature is stored at a level above its current level no longer shows it on the Feats tab until it gets there. This is display only, no number. A non-number stored level reads 1.
4. **Emptied store is `undefined`.** `removeChosenIds` returns `undefined` when nothing is left (B15, through `dropEntries`).
5. **Extra contentFor guard.** `contentFor` throws when it is handed a bare overrides object. This goes beyond the plan, so a missed caller fails loudly instead of silently dropping every edit.
6. **Card shown for old characters.** `tweaksPageOn` (B14) now shows the Overrides card for an old character that has overrides while the option is off. This is a visible change, as the plan intends.
7. **Options toggle not rewired.** The Builder's Options toggle still writes `options.overridesEnabled` alone (not `setTweaksSwitch`). On an old v-less character it therefore pauses nothing ("ON by read"). That is 5.3 / WP6 work, left untouched, and the memo-deps test uses a v:2 build for this reason.
8. **Extra allowlist entries.** The memo-deps rule requires `useMemo dependency only` entries (App, Builder ×4, GmEditSheet, SpellsTab), which 7.1's list does not name. The feat-readers key is `build.ts#deriveBuildFromCharacter`, not the plan's guess `#deriveBuildFromCharacter>existing`: the literal sits in the statement.
9. **jsdom.** `tweaks-pause.test.ts` runs under jsdom because it renders the Builder and SpellsTab.
10. **eslint-disable-line.** The `ovContent` memo has an `eslint-disable-line react-hooks/exhaustive-deps`, because its deps name `build.overrides` and `build.options` while the callback reads `build`.
11. **PartyMembers.tsx has no patch.** The other chat committed its PartyMembers work, so the file is staged whole (my one hunk).
12. **Patches remade.** All three patches were remade against `b02e521` (HEAD moved during the WP).

## Ask Guy
None. No ruling conflicts, no unsettled print, and nothing in the plan was impossible as written.

## Out of scope (found, not fixed)
- **Take anyway duplicate (WP8).** The Builder's "Take anyway" writer (Builder.tsx ~4117) appends the feat id again when the existing allow entry is paused, which gives a duplicate entry.
- **Direct writes (B17 / WP7).** `AttributeEditor` `clearAttrOverrides` and `OverridesCard` still write `overrides` directly. They are listed in the allowlist as writers.
- **Options toggle (5.3 / WP6).** It is not `setTweaksSwitch` yet (see Deviation 7).
- **Foreign mutation plants.** The other chat plants mutations straight into `src/App.tsx` in the main tree (a "PLANTED" line was seen earlier, since gone). A main-tree run can therefore meet their half-done state; the WP2-only worktree run is the clean proof.

## Not checked
- I did not click through the real app (the WP is engine routing; the Builder flows are exercised through the rendered Builder in jsdom).
- The full vitest suite was not run, only the 26 files.
- I did not read every caller of `activeGivenFeats` beyond `heldFeatSlots` (unchanged signature).

## Risks
- **Foreign hunks may appear.** The other chat is editing actively. Re-read the diffs of the 34 whole-staged files before `git add`.
- **Visible changes on old characters** (no number moves, parity proves it):
  - the Overrides card now shows when overrides exist with the option off (B14);
  - a given class feature stored above the current level hides until that level.
