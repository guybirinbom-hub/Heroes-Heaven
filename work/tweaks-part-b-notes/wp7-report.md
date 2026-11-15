# WP7 report: the Tweaks editors, built from the registry; the old Overrides card retired. Builder, 2026-10-21

## Fix round 1 (independent checker, 2026-10-21)

Each finding was checked against the code first (read-only jiti probes in the scratchpad, plus the failing tests).
All four were real; all four are fixed. Nothing is staged or committed.

1. **MAJOR, fixed: Strength reaching a number through worn armor's Strength entry.** Confirmed on the level-5
   fixture fighter wearing full plate (Strength entry +4, check penalty -3, Speed -10): with no tweak `baselineFor`
   gave stealth -2, acrobatics 5, thievery -2, speed:land 15; with `attributes {str:18}` or an `attribute.add` +8
   on score:str it gave 1 / 8 / 1 / 20 (the checker's numbers exactly). Fix in `src/rules/blocks/baseline.ts`:
   - `skillTweaked`: also true when the skill takes the armor check penalty (`skillTakesArmorPenalty`: a
     Strength or Dexterity skill) and Strength is tweaked.
   - `tweakInsideBook`: new `case 'speed': return abilityTweaked(c, 'str')` (meeting the entry cuts the armor
     Speed penalty by 5 ft; an inventor's `removeSpeedPenaltyAtStr` is Strength too). The wrong line-95 comment
     ("Speed: no attribute…") is gone; the header names the Strength path.
   - Read whether armor is worn or not (the conservative choice, like the armor-rank check that reads every
     armor category): if the guard read only the armor worn NOW, a Str tweak would hide the check penalty of
     armor put on later, and removing the tweak would then show it as a "book change".
   - Same class, also fixed (one line): a skill-attribute swap (`skillAbilitySwapFor`, e.g. Officer's Medical
     Training rolls Medicine with the better of Wisdom and Intelligence). A tweak on the swap's attribute decides
     which attribute is rolled even when it leaves the printed one rolled, so it is checked too.
   - After the fix: every Str/Dex skill and speed:land under either Str tweak → `undefined`; Medicine and an
     unrelated Charisma tweak unchanged.
2. **MAJOR (outside WP7), fixed as its own small change: `test/tweaks-edit-path.test.ts:161` was red at HEAD.**
   WP6 (5cf6a5c) changed App.tsx `onEdit` to `const eb = editableBuildOf(active, ownDb); setEditing({ id:
   active.id, build: eb.build, derived: eb.derived })`; the pin still expected the old one-line shape. The
   assertion now expects `const eb = editableBuildOf(active, ownDb);` and `setEditing({ id: active.id, build:
   eb.build`. The intent is kept (the App path goes through editableBuildOf; the loop below still refuses
   `deriveBuildFromCharacter(` in App.tsx and GmEditSheet.tsx). Checked on planted strings: the real shape
   passes; `const eb = deriveBuildFromCharacter(...)` and `build: active.build` both fail. **Orchestrator:
   commit it alone first (recipe below), and add `test/tweaks-edit-path.test.ts` to the neighbour list the
   remaining WPs run** (it is in this round's 29-file list).
3. **MINOR, fixed: a text edit typed back to the book left an empty edit.** Confirmed: the door stored
   `contentEdits {feats:{toughness:{}}}`, still one "Your text: Toughness" row. Fixed at the write door
   (`write.ts` `updateLegacy`, contentEdits case), so every writer is covered, not just this editor: an `update`
   whose text leaves the edit with no field at all (and nothing else stored on it, e.g. traits) removes the
   entry and its meta, as an emptied number box does. While there, an UNKNOWN ≠ EMPTY hole on the same lines:
   a text edit stored as something other than a map (`toughness: 'v9'`, a newer version's shape) was rebuilt
   from `{}` by any update or repoint (probe: `{feats:{toughness:{}}}`, the string lost). Such an update /
   repoint is now refused ("…was written by a newer version or cannot be read; it is kept as it is"); Remove
   still works. Header rule added to write.ts.
4. **MINOR, fixed: pointing a given spell's row at another spell kept the old rank.** `TweakRowEditor`'s record
   change for `grant.spell` now sends `spellRank: content.spells?.[id]?.rank ?? 1`, as the Add editor does.
   (The row's "Point to another" for a BROKEN spell id still keeps the stored rank on purpose: there the rank is
   the player's and the id is what broke.)

Also in this round: `test/feat-readers-check.test.ts` "a stale entry, a count left too high…" timed out again
(5121 ms of 5000) in the 29-file run, the third time (WP6, WP7, now). It gets a 30 s limit with a comment (seven
whole-source scans; about 2 s alone). The test logic is unchanged.

### Fix round: tests added (each made to fail once on a planted bug, file restored and `cmp`-checked after)

| test | plant | result |
|---|---|---|
| tweaks-editors "baselineFor names no number while a tweak feeds its base line": full plate worn + Str add / Str set → stealth, acrobatics, thievery, speed:land `undefined`; Medicine and a Cha tweak unchanged; premises stealth -2, speed 15; Officer's Medical Training + Int 8 → Medicine `undefined` | Str guard on skills off | fails "expected 1 to be undefined" (stealth) |
| same | Speed's Str guard off | fails "expected 20 to be undefined" |
| same | swap guard off | fails "expected 7 to be undefined" |
| tweaks-editors "a text edit row keeps only what differs…" extended: Description typed back too → `contentEdits` undefined, no row left | door removal off | fails "expected { feats: { toughness: {} } } to be undefined" |
| tweaks-write NEW "a text edit typed back to the book (no field left) goes with its meta; one stored as something other than a map is refused, never replaced" | door removal off / non-map refusal off | fails each time |
| tweaks-editors NEW "pointing a given spell's row at another spell gives it THAT spell's own rank" (Fireball rank 3 → Shield: stored rank = Shield's own, row reads "Shield (cantrip)") | row keeps the old rank | fails "expected [{ shield, rank: 3 }] to deeply equal [{ shield, rank: 0 }]" |

### Fix round: runs

- Main tree, 29 files (the WP7 28 + `tweaks-edit-path`), `node scripts/vt.mjs …`: first run 650 / 651 (the
  feat-readers-check timeout above); after its limit, **651 / 651 pass**.
- tsc app + tracker (main tree): clean (twice, the second after the last edit).
- `npm run verify`, main tree (background, log read): **GREEN, EXIT=0**, last line "blocks-check: OK — 16
  registered kinds, 29 targets"; "not in Tweaks yet: rank.legacySet" only; feat readers "addedFeats" 20× in 14
  places, tweak readers "overrides" 35× in 23 places, all listed.
- Parity (snapshot run with no vitest beside it): `node node_modules/jiti/lib/jiti-cli.mjs
  scripts/blocks-parity-snapshot.mjs --out work/.partB-wp7f.json` (33,506,190 bytes).
  - `--compare work/.partB-wp6f.json --against work/.partB-wp7f.json`: **NUMBER 0, breakdown-part 0, sumOk 0.**
  - `--compare work/.partB-wp7.json --against work/.partB-wp7f.json`: **NUMBER 0, breakdown-part 0, sumOk 0**
    (the two files differ only in `takenAt`).
  - Against a COPY of the part-B baseline with WP3's `--allow` / `--allow-stat` (as below): NUMBER 10 not allowed
    (+66 allowed), breakdown-part 24, sumOk 4 (2 now sum, 0 stopped), character set 2; the full list (11,848
    bytes) is **byte-identical** (`cmp`) to `work/.partB-wp4.vs-baseline.full.txt`. Every row is WP3's,
    explained in the Parity section below. (baselineFor writes only the stored `baseline` the chip reads; no
    sheet number reads it.)
- Worktree `C:\Users\r2g2\AppData\Local\Temp\hh-wp7f` (HEAD 5cf6a5c, LF checkout, WP7's 20 tracked files by
  `git apply`, `wp7-shared.tsx.patch`, the 5 new files, junctioned node_modules for app + tracker, 558 inputs
  copied: 413 untracked `work/` files + 145 ignored `work/wg-batch-*.json`): see "Worktree proof (fix round)"
  below.

Built from `plan.md` section 1 "WP7" (with section 0 B1–B27, 4.2–4.7, 5 and 7.3), `docs/overrides-redesign.md`
and `docs/gold-set-answers.md`. Also covers the orchestrator's carry-overs: the per-target baseline guard (an
attribute tweak on a number's ability, a rank tweak on its proficiency) before any set stores a baseline, and
the stale it() title in `test/audit-followup.test.ts`. Nothing is staged or committed. `shared.tsx` holds another
chat's hunk, so WP7's shared.tsx lines ship as `work/tweaks-part-b-notes/wp7-shared.tsx.patch`.

## What was built (by symbol)

**Registry** (`src/rules/blocks/registry.ts`, `catalog.json`)
- Every phase-1 kind except `rank.legacySet` has `editor.built: true` (15 kinds).
- `STILL_TO_ADD` = `rank.legacySet` alone, with the reason "Never a new tweak: part B sorts each old entry into
  'at least' or 'exactly' when it is read".
- `rank.legacySet.title` = "Old rank, kept as it was" (catalog row too).
- `number.setMaxHp` moved before `number.atLeast` (see Deviations 1).

**Baselines** (`src/rules/blocks/baseline.ts`)
- `tweakInsideBook(c, db, target)`, with `abilityTweaked`, `rankTweaked`, `skillTweaked`: `baselineFor` returns
  `undefined` for any number target while a live attribute tweak sits on its ability, or a rank tweak on its
  proficiency (AC under a Dex set, a skill under a rank tweak, class DC under its key ability, initiative through
  Perception or its skill). WP4's max-HP/Con guard is one case of it.

**Write door** (`src/rules/blocks/write.ts`)
- `writeTweaks(host, ws[])`: applies several writes in order, each against the one before; the first refusal
  refuses them all and nothing is written. Used when a row editor's kind change needs one remove + one add.
- `pruneOverrides` doc comment updated (no screen calls it now; see Out of scope).

**Shared parts** (NEW `src/builder/tweaks/parts.tsx`, each root `data-part="<name>"`)
- `Part`, `PartNote` (refusals now start with a capital), `TargetPart` (SearchSelect "What"),
  `LoreSubjectPart` ("Lore subject"), `NumberPart`, `StaticPart`, `BonusTypePart`, `RankPart`, `RecordPart`
  (SearchSelect "Feat" / "Language" / "Spell" / "Class feature" / "Feat or class feature"), `TextPart`
  ("Name" / "Description"), `LevelPart` ("From level"), `ReasonPart` ("Reason").

**Editors** (NEW `src/builder/tweaks/TweakEditor.tsx`)
- `TweakAddEditor`: the "Add a tweak" editor. Shared-menu rule (4.6): the target first (the union of the
  menu's kinds), then the option chooser `OptionChooser` when two or more kinds accept that target (default =
  first in registry order), then exactly the resolved kind's parts, target kept on top; `advancedParts` inside
  its own `AdvancedFold`. Keeps a draft until "Add" (B22); "Cancel" drops it; `onPending` reports a draft that
  holds something.
- `TweakRowEditor`: a row's own editor. Each part writes when left (B22). An emptied number removes the
  tweak. A change of option that needs another kind is an `update` when both kinds share a storage key, else
  `writeTweaks([remove, add])` carrying reason, start level and on/off (`carriedDraft`). A text edit stores only
  the fields that differ from the book.
- `castingNoteFor`: the Give-a-feat casting note (open point 8). It dry-runs `writeTweak` add, builds the
  character once, and compares with `castingEntryChanges`: "This changes Cleric: prepared → spontaneous. Spells
  you prepared stay saved."
- `baselineOf` / `bookNumber`: a set stores `baseline = baselineFor(...)` when made or edited; the number box
  shows "book: N" as its placeholder.
- `recordOptions`: the record pickers use the FULL content (any level, Sources ignored, gold-set R12); a record
  already given is greyed "Already a tweak" ("Already has a text edit"; a known language "Already known").
- `LORE_MENU` "Add a Lore": any subject, keyed by `loreKey`; a bare "Lore" is refused ("Name the subject, not
  just 'Lore'"), as is a Lore that already has a rank tweak.

**Page and row** (`TweaksPage.tsx`, `TweakRow.tsx`, `model.ts`)
- `TweaksPage`: `write(w | w[])` goes through `writeTweaks`; `addedTweakKeys(before, after)` names the new
  rows; the open row follows its key when an edit moves it (one added, the open one gone). New props
  `bookContent`, `onPendingChange`. The Add editor mounts under the menus (`key={menu.name}`).
- `TweakRow`: new `editor` prop, shown inside an open row before Show / Delete / Point to another.
- `model.ts`: `tweakMenus` lists only built kinds; new `menuOfKind`, `kindAccepts`, `menuHasTarget`,
  `menuTargets`, `menuKindsFor`, `resolveMenuKind`, `editorParts`, `addedTweakKeys` (replaces `tweakKeys`),
  `storedTextEdit`.
- `DraftNumberInput.tsx`: value may be `null` (an empty box), `onDraft` (every keystroke, for the draft),
  `min` / `max` / `placeholder`, and a clamp on commit.

**Builder** (`Builder.tsx`, CRLF kept)
- `tweakAddPending` ref: a draft in the Add editor counts as a change in `requestLeave`.
- `TweaksPage` gets `bookContent={baseContent}` and `onPendingChange`.
- The Setup mount of `OverridesCard` and its import are gone.

**Old card retired** (`shared.tsx`, through the patch)
- Deleted: `OverridesCard`, `export { pruneOverrides }`, `PROF_TRACKS`, `profTrackName` and the misplaced
  "Overrides" doc comment; the imports only it used (`BuildOverrides`, `PROFICIENCY_RANKS`, `DraftNumberInput`,
  `pruneOverrides`).
- `builder.css`: removed `.ovr-take-inline`, `.ovr-chips`, `.ovr-chip*`, `.ovr-attrs`, `.ovr-attr*`,
  `.ovr-rows`, `.ovr-row*`, `.ovr-edit*` and their phone lines. Kept `.ovr-intro`, `.ovr-opt`, `.ovr-take` (one
  rule) and `.picker-override-note` (still used). Added the editor styles (`.tw-parts`, `.tw-part*`, `.tw-num`,
  `.tw-text*`, `.tw-chooser`, `.tw-opt`, `.tw-editor-adv*`, `.tw-missing`, `.tw-add-cancel`, `.tw-add-go`), hover
  gated by `(hover: hover)`, phone sizes (40px main, 36px secondary, 16px fields) and press feedback.
- `feat-readers.json`: the five `shared.tsx#OverridesCard…` keys removed; `test/feat-readers-check.test.ts`
  regex line removed in the same change. `overrides-readers.json`: `OverridesCard>ov` removed; new entries
  `model.ts#storedTextEdit>edits` and `TweakEditor.tsx#castingNoteFor>next`, each with its reason.

## Files

Changed: `src/rules/blocks/registry.ts`, `src/rules/blocks/catalog.json`, `src/rules/blocks/baseline.ts`,
`src/rules/blocks/write.ts`, `src/rules/blocks/feat-readers.json`, `src/rules/blocks/overrides-readers.json`,
`src/builder/DraftNumberInput.tsx`, `src/builder/Builder.tsx`, `src/builder/builder.css`,
`src/builder/shared.tsx` (patch only), `src/builder/tweaks/model.ts`, `src/builder/tweaks/TweaksPage.tsx`,
`src/builder/tweaks/TweakRow.tsx`, `test/overrides-write.test.tsx`, `test/phone-builder-leave.test.tsx`,
`test/phone-builder-css.test.ts`, `test/audit-followup.test.ts`, `test/blocks-check.test.ts`,
`test/feat-readers-check.test.ts`.
New: `src/builder/tweaks/parts.tsx`, `src/builder/tweaks/TweakEditor.tsx`, `test/_tweaks-harness.tsx`,
`test/tweaks-editors.test.tsx`, `test/tweaks-screen-registry.test.tsx`, `work/tweaks-part-b-notes/wp7-shared.tsx.patch`,
this report.
Line endings, measured with node after the edits: Builder.tsx and builder.css CRLF (4362/0, 2711/0), as before;
every other file LF (0 CRLF), new files LF.

Fix round 1 adds: `test/tweaks-write.test.ts` (changed) and `test/tweaks-edit-path.test.ts` (changed; the
stale WP6 pin, its own commit). `baseline.ts`, `write.ts`, `TweakEditor.tsx`, `tweaks-editors.test.tsx` and
`feat-readers-check.test.ts` changed again. Line endings after the round, measured with node: all seven LF
(0 CRLF): baseline.ts 0/143, write.ts 0/776, TweakEditor.tsx 0/657, tweaks-editors 0/643, tweaks-write 0/541,
tweaks-edit-path 0/252, feat-readers-check 0/168.

**Commit recipe (orchestrator).** First, alone (the stale WP6 pin; red at HEAD without WP7):
```
git add test/tweaks-edit-path.test.ts
```
Then WP7. Never `git add src/builder/shared.tsx` (another chat's hunk at `CampaignAttachCard`, a blank line
moved; the rest of that chat's campaign work is already in 1a06cbf):
```
git add src/rules/blocks/registry.ts src/rules/blocks/catalog.json src/rules/blocks/baseline.ts \
  src/rules/blocks/write.ts src/rules/blocks/feat-readers.json src/rules/blocks/overrides-readers.json \
  src/builder/DraftNumberInput.tsx src/builder/Builder.tsx src/builder/builder.css \
  src/builder/tweaks/model.ts src/builder/tweaks/TweaksPage.tsx src/builder/tweaks/TweakRow.tsx \
  src/builder/tweaks/parts.tsx src/builder/tweaks/TweakEditor.tsx \
  test/_tweaks-harness.tsx test/tweaks-editors.test.tsx test/tweaks-screen-registry.test.tsx \
  test/overrides-write.test.tsx test/phone-builder-leave.test.tsx test/phone-builder-css.test.ts \
  test/audit-followup.test.ts test/blocks-check.test.ts test/feat-readers-check.test.ts \
  test/tweaks-write.test.ts \
  work/tweaks-part-b-notes/wp7-report.md work/tweaks-part-b-notes/wp7-shared.tsx.patch
git apply --cached work/tweaks-part-b-notes/wp7-shared.tsx.patch
```
(The earlier WP reports and patches under work/tweaks-part-b-notes are tracked, so this report and the patch
file go in too.)
`git apply --cached --check` on the patch: OK (re-checked in fix round 1; shared.tsx was not touched again). The patch holds 4 hunks (imports ×2, PROF_TRACKS, the card); the
foreign hunk is left out. The Builder.tsx and every other file's diff were read hunk by hunk: WP7 lines only.

## Tests

New tests (plan 7.3 and the WP7 list):
- `test/tweaks-screen-registry.test.tsx` (23): every built kind that points at a statistic has a fixture
  target; STILL_TO_ADD is the old rank alone; every built kind's menus are buttons in the right place (main at
  once, advanced only after Advanced opens); no menu button that no built kind names; `it.each` built kind ×
  menu opens exactly its parts, target on top, `advancedParts` only inside the editor's own fold; the option
  chooser labels for Set a number (AC, Maximum HP, a score) and for Rank / Add a Lore. The expected lists are
  read off the registry, never asked of model.ts.
- `test/tweaks-editors.test.tsx` (36): `it.each` over the 15 built kinds "<id>: added through its editor, read
  back with of, paused, resumed, deleted without a question"; Give a feat offers feats of any level (problem 6);
  the record pickers ignore Sources (R12, through the real Builder); a feat already given is greyed; Add a Lore
  takes any subject, keys it by loreKey, refuses a blank or a bare 'Lore'; Add a Lore offers At least and
  Exactly; the Rank editor opens on At least; a Lore added in Tweaks is offered by the level-3 skill increase
  (spec 11); the attribute set editor works without attribute.add tweaks (open point 6); a set stores
  `baseline = baselineFor(...)` (AC, Maximum HP, Dexterity); no baseline while a tweak sits inside the book
  number; `baselineFor` names no number while a tweak feeds its base line, target by target; the casting note
  for Flexible Spellcaster Dedication on a cleric (open point 8); editing a given feat's level moves its meta
  and the row stays open (open point 1); a broken feat id fixed with Point to another; a row writes each change
  at once and an emptied number removes the tweak; Maximum HP "Set to" → "At least" is one remove + add keeping
  reason, start level and on/off; a text edit keeps only what differs from the book; the Add editor's draft,
  Cancel and pending flag; `writeTweaks` is all-or-nothing; a newer-version block survives an edit next to it,
  the Save, the roster write and the cloud push byte for byte (item 13, content-path-pin's fake server).
- Ported, never deleted: `test/overrides-write.test.tsx` D5 (Set maximum HP saves) and D6 (Dex 12 + Backspace
  Backspace 8 saves 8, not 128; "-" typed first) now run on the Tweaks editors (11 tests).
  `test/phone-builder-leave.test.tsx`: "a number still being typed counts as a change" now opens Tweaks → Set a
  number → Maximum HP (`input[aria-label="Max HP"]`); plus "a number still being typed in a tweak's own row"
  and "an Add editor opened and cancelled is no change" (19 tests).
- `test/phone-builder-css.test.ts`: the D4 attribute-grid test, the grid half of "D4 (round 2)" and "round 3:
  the Max HP box takes the whole row" are RETIRED with a written reason in the file (the six-box grid is gone:
  each attribute set, Max HP included, is its own Tweaks row). The subcard half of D4 round 2 stays. The
  `.ovr-*` entries left the 36px and 16px lists. New: "WP7 (decision 7): the tweak editors — options and Add
  40px, Cancel and Advanced 36px, 16px fields, one part per row", and the press-feedback list now includes
  `tw-opt`, `tw-add-go`, `tw-add-cancel`, `tw-editor-adv-toggle`.
- `test/audit-followup.test.ts`: the stale title is now "HP breakdown with a manual max HP shows the book lines
  plus a set line, and reconciles", with an assert that more than one part shows.
- `test/blocks-check.test.ts`: the planted input's `number.add` (and the B19 fixture's kinds) are held at
  `editor.built: false`, so the STILL_TO_ADD rules still have a kind to bite on now that the real one is built.

Runs (`node scripts/vt.mjs`, one vitest at a time), 28 files: the WP7 list (`tweaks-screen-registry`,
`tweaks-editors`, `overrides-write`, `phone-builder-leave`, `phone-builder-css`, `phone-builder-shell`,
`phone-native-feel`, `blocks-check`, `feat-readers-check`, `overrides-readers-check`, `given-feat-builder-ui`,
`sources-apply-to-everything`) plus the neighbours (`tweaks-page`, `tweaks-write`, `tweaks-pause`,
`tweaks-save-stamp`, `tweaks-save-stamp-numbers`, `tweaks-casting-confirm`, `tweaks-switch-confirm`,
`blocks-registry`, `audit-followup`, `content-path-pin`, `tweaks-max-hp-set`, `tweaks-wg-export`,
`phone-builder-back-trap`, `phone-builder-pickers`, `bug-phone-web`, `overrides`).
- Main tree, first run: 644 / 645. The one failure was `feat-readers-check` "a stale entry, a count left too
  high…" timing out at 5295 ms of its 5000 ms under the parallel load (the same timeout WP6 noted). Alone:
  13 / 13 pass.
- Worktree (WP7 files only, see below): **645 / 645 pass**.
- Main tree, final run (after the last edit, PartNote's capital): **645 / 645 pass** (28 files).

Mutation proof (temp copies, each deleted afterwards; `git status` shows none left):

| plant | result |
|---|---|
| M1 `grant.language` stays built, its menu removed from the screen (vi.mock of `tweakMenus`) | 3 fail: "every built kind's menus are buttons…", "no menu button that no built kind names", "grant.language in 'Add a language'" (the plan's required plant) |
| M2 `baselineFor` without the WP7 guard (copy of baseline.ts) | 2 fail: "a set stores no baseline while a tweak sits inside its book number…", "baselineFor names no number while a tweak feeds its base line…" |
| M3 TweakEditor: a bare "Lore" no longer refused + `castingNoteFor` always null | 2 fail: the Add a Lore refusal test, the Flexible Spellcaster casting-note test |
| M4 TweaksPage: the open row no longer follows its new key | 2 fail: "editing a given feat's level moves its meta…, and the row stays open", the Maximum HP Set to → At least test |
| M5 Builder: `requestLeave` ignores `tweakAddPending` (copy of Builder.tsx) | 1 fails: "a number still being typed (Tweaks → Set a number → Maximum HP, never left) counts as a change: Back asks" |

## Type check and verify

- `tsc --noEmit -p tsconfig.json`: clean. `-p tracker/tsconfig.json`: clean. (Main tree and worktree.)
- `scripts/blocks-check.mjs`: "not in Tweaks yet (no editor on the screen): rank.legacySet" only; OK — 16
  registered kinds, 29 targets. Feat readers "addedFeats" 20× in 14 places; tweak readers "overrides" 35× in 23
  places, all listed.
- `npm run verify`, main tree (background, log read from the top): **GREEN, EXIT=0**, last line "blocks-check:
  OK — 16 registered kinds, 29 targets".
- `npm run verify`, worktree: **GREEN, EXIT=0**, the same last line, and "not in Tweaks yet: rank.legacySet" only.

## Parity

Snapshot, run alone (no vitest beside it): `node node_modules/jiti/lib/jiti-cli.mjs
scripts/blocks-parity-snapshot.mjs --out work/.partB-wp7.json` (33,506,190 bytes, the same size as WP6's).
- **Against WP6** (`--compare work/.partB-wp6f.json --against work/.partB-wp7.json`): **NUMBER 0,
  breakdown-part 0, sumOk 0.** WP7 moves no sheet number.
- **Against the part-B baseline** with WP3's `--allow
  '^overrides:(test-sample|proficiencies|hidden-card|lore|lowered-raise|maxHp:wizard-L5#(mode|con-mode))'` and the
  same `--allow-stat`: NUMBER 10 not allowed (+66 allowed), breakdown-part 24, sumOk 4 (2 now sum, 0 stopped),
  character set 2. The full list (`work/.partB-baseline.compare.txt`, 11,848 bytes) is **byte-identical** (`cmp`)
  to WP4's `work/.partB-wp4.vs-baseline.full.txt`, so WP7 adds none. As explained in the WP3/WP4 reports:
  - the 10 are `build.hash` changing because of `tweakRankSort`;
  - the 66 allowed are cases A, B, C and the Lore-row move;
  - the 24 breakdown parts are the Thievery, Medicine and Lore rows and the max-HP book lines;
  - the 4 sumOk are the Lore-row move;
  - the character-set 2 is the new-shape pair.

## Worktree proof (the tree the commit will hold)

`C:\Users\r2g2\AppData\Local\Temp\hh-wp7`, at HEAD 5cf6a5c, LF checkout (`git -c core.autocrlf=false worktree add
--detach`). It held: the WP7 tracked diff of 18 files (applied with `git apply`), `wp7-shared.tsx.patch`
(applied cleanly), the 5 new files, junctioned node_modules (app + tracker), and the 410 untracked `work/`
inputs plus the 145 ignored `work/wg-batch-*.json` (555 copied; the parity baselines among them).
- tsc app + tracker: clean.
- The 28 test files: 645 / 645 pass.
- `npm run verify`: GREEN, EXIT=0 (last line "blocks-check: OK — 16 registered kinds, 29 targets").
- The parity compare was run in the main tree only (its numbers come from the same engine files; WP7's tracked
  diff there is the worktree's plus the foreign shared.tsx blank line, which moves no number).
- Teardown: the two junctions removed first (checked to be junctions); the 555 copied inputs and the 5 new files
  deleted; the patch and the tracked diff reversed with `git apply -R` (`git status` empty); `git worktree
  remove` without `--force`, then `git worktree prune`; the folder is gone. Main `node_modules` 421 and
  `tracker/node_modules` 471 entries, intact; the index is empty (`git diff --cached` shows nothing).

## Worktree proof (fix round 1)

`C:\Users\r2g2\AppData\Local\Temp\hh-wp7f`, at HEAD 5cf6a5c, LF checkout (`git -c core.autocrlf=false worktree
add --detach`). It held: the WP7 tracked diff of 20 files (`git apply`, from `git diff HEAD --binary` of exactly
those files), `wp7-shared.tsx.patch` (applied cleanly), the 5 new files, junctioned node_modules (app +
tracker), and 558 inputs (413 untracked `work/` files + 145 ignored `work/wg-batch-*.json`). Note: the other
chat's campaign work is now committed (1a06cbf: `campaignLeave` is in HEAD's shared.tsx), so the only foreign
line left in the main tree is the blank-line hunk in shared.tsx, which the patch leaves out.
- tsc app + tracker: clean.
- The 29 test files: first run 650 / 651 (blocks-check "item 7 … passes on the real src/ …" timed out at 5863
  ms while `npm run verify` ran in the main tree at the same time); rerun alone: **651 / 651 pass**.
- `npm run verify`: **GREEN, EXIT=0** (last line "blocks-check: OK — 16 registered kinds, 29 targets"; "not in
  Tweaks yet: rank.legacySet" only).
- The parity compare ran in the main tree (whose engine files are the worktree's; the only extra there is the
  foreign blank line in shared.tsx).
- Teardown: the two junctions removed first (checked to be junctions), the 558 inputs and the 5 new files
  deleted, both patches reversed with `git apply -R` (`git status` empty; one ignored `work/settle-audit.json`
  that verify writes), `git worktree remove` without `--force`, `git worktree prune`; the folder is gone. Main
  `node_modules` 421 and `tracker/node_modules` 471 entries (`ls`), as before; `git diff --cached` empty.
- `graphify update .` run once at the end (code graph updated).

## Real browser (Playwright headless on the vite dev server, port 1420)

The synthetic fixture `work/tweaks-part-b-notes/browser/old-overrides.codex.json` (a fighter L7 built with the
old keys only) was imported through the roster's Import (dev-skip login; test data only, localStorage cleared
afterwards, the dev server stopped).
- 1440px: the page lists the 11 moved tweaks. Set a number → What → AC → "Set to" (pressed) / "At least",
  parts target, number ("book: 22"), From level, Reason. 25 + a reason → Add: the row "AC set to 25" opens with
  its editor, the count reads 12, the side panel's Armor class reads 25.
- The "Maximum HP set to 120" row: its editor opens on "Set to" with the box labelled "Max HP"; 130 typed and
  left → the row reads "Maximum HP set to 130", the side panel's Hit points 130.
- 390px: Give a feat → Feat / From level / Reason, each on its own row, no horizontal scroll (scrollWidth 390).
  Toughness is greyed "Already a tweak"; Diehard → Add → its row opens under Feats.
- 360px: Set a number → Maximum HP (already set): the chooser buttons are 40px tall; Add with 140 shows the
  write door's refusal "Maximum HP is already set by a tweak" and keeps the draft.
- Cancel the editor, then Cancel the builder → "Discard changes?" → Discard: the sheet is back at AC 22,
  HP 120. No console errors.
Screenshots (scratchpad): `wp7-1440-page.png`, `wp7-1440-set-ac.png`, `wp7-1440-set-ac-filled.png`,
`wp7-1440-ac-row.png`, `wp7-390-givefeat.png`, `wp7-360-setnumber.png`, `wp7-360-refusal.png`.

## Deviations from the plan (with reasons)

1. **`number.setMaxHp` moved before `number.atLeast` in the registry.** The shared-menu rule opens a target on
   the first kind in registry order that accepts it. With `atLeast` first, Set a number → Maximum HP opened on
   "At least" (it accepts max-hp), while the old card's Max HP box (and the ported D5/D6 tests) is a set.
   Registry order has no other effect (blocks-check, parity NUMBER 0 vs WP6).
2. **The spell rank part takes 0–10**, 0 being a cantrip, as the old card's Rank list did (plan text: 1–10).
3. **An emptied number box on a row removes the tweak** (the old card's emptied box reverted the same way).
   In the Add editor an empty box is simply "Type a number".
4. **`writeTweaks` added to write.ts** for a row's kind change that needs another storage (remove + add): one
   Undo step, all-or-nothing, and no half-written state if the add is refused.
5. **`addedTweakKeys` replaces `tweakKeys`** in model.ts (the page needs the keys a write ADDED, to open or
   follow a row).
6. **The row editor's parts live in TweakEditor; Show, Delete and Point to another stay in TweakRow** (WP6's
   shell), so the row look does not change.
7. **`StaticPart`** stands in the text part until a record is chosen ("Choose the feat or class feature
   first.") and in the rank part for a ritual ("A ritual has no spell rank.").
8. **phone-builder-leave**: the old test typed in the Setup Max HP box. Its port opens the Add editor (a draft
   counts through `tweakAddPending`); a second new test keeps the blur-first path for a row's own box.
9. **A given feat defaults to level 1** (the plan: empty = level 1). The old card used min(feat level, build
   level).
10. **A language already known is offered greyed ("Already known")**, not hidden, so the picker explains itself.
11. **Switching to another menu or row drops the Add editor's draft without a question.** The draft is never in
    the build (B22), and the leave-the-Builder question still covers a draft left open.
12. **`PartNote` capitalises a refusal's first letter** (the write door's messages are written mid-sentence).
13. **`pruneOverrides` stays in write.ts** although no screen calls it now: test/overrides-write.test.tsx keeps
    its every-key guard. Deleting it is a cleanup choice (see Out of scope).

14. **Fix round 1:** the baseline guard reads Strength for every Str/Dex skill and Speed whether armor is worn or
    not (finding 1's conservative option), and adds the skill-attribute swap's attribute (same class, not in the
    finding). Cost: a Str-tweaked character's Dex skills and Speed store no baseline, so they show no "Book
    number changed" chip until the Str tweak goes and the set is edited again; never a false chip.
15. **Fix round 1:** finding 3 fixed at the write door, not in the editor (both were offered), so every writer
    of a text edit is covered; the same lines now refuse to rebuild a non-map text edit (UNKNOWN ≠ EMPTY).
16. **Fix round 1:** `feat-readers-check` "a stale entry…" gets a 30 s limit (was the default 5 s), after its
    third load timeout. Logic unchanged.

## Rejected findings

None. All four were confirmed against the code and fixed.

## Ask Guy

None. No ruling conflict, unsettled print (R9) or impossible plan step came up.

## Out of scope (seen, not fixed)

- Fix round 1: a MODE on Strength (play state, not a tweak) also moves the armor check penalty and armor Speed
  penalty book terms, because `meetsArmorStrength` reads `abilityModOf` (modes included); the same is true of
  `skillRolledAbility`'s better-of choice. So `bookTotal` is not purely permanent while such a mode is on, and a
  set made then stores a baseline that includes it. Rare (a Strength mode plus a set on a Str/Dex skill or
  Speed); derive.ts territory, not WP7.
- Fix round 1: `test/blocks-check.test.ts` "item 7 … passes on the real src/, test/, scripts/ and tracker/
  files" (a whole-tree scan) timed out once (5863 ms of 5000) in the worktree while `npm run verify` ran in the
  main tree at the same time; rerun alone it passed (651/651). Same class as the feat-readers timeout; left at
  5 s because it passed under the normal one-job load.

- `pruneOverrides` (write.ts) has no caller in src after WP7; only test/overrides-write.test.tsx uses it. WP10's
  cleanup can delete it with its tests, or keep it.
- A second set on a number that already has one (e.g. Maximum HP) is refused only when "Add" is pressed. The
  editor could warn as soon as the target is chosen; that is a UX polish for WP8/WP10.
- `feat-readers-check` "a stale entry…" has a 5 s timeout that a 28-file parallel run can exceed (5.3 s here,
  as in WP6). It passes alone; not changed. (Fix round 1: it hit it a third time, so it now has 30 s; see
  Deviations 16.)

## Not checked

- Fix round 1 was not re-checked in a real browser (the four fixes are covered by tests through the real
  editors and the write door; no layout changed).
- The baseline guard's Strength path on an inventor's restatted armor (`removeSpeedPenaltyAtStr`): covered by
  the same `abilityTweaked(c, 'str')` line, not by its own fixture.
- No real phone; Playwright headless at 1440, 390 and 360 px only.
- The Tauri desktop build.
- Remove something / Take anyway / Change a description in the real browser (the tests cover them; the
  browser pass covered Set a number, a row edit and Give a feat).

## Risks

- `TweakEditor.tsx` is new and large (655 lines); every built kind is exercised by the it.each and the
  screen-registry tests, but rarer combinations (a Lore's option changed after a level is set, say) are covered
  only by the generic paths.
- The open row follows a new key only when exactly one row is added and the open one is gone; a write that
  adds two rows leaves the row closed (safe: nothing is lost).
