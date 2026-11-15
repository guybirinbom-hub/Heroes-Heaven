# WP9a report — Wanderer's Guide export warning (builder, 2026-10-21)

Status: built, tested, verified (temp worktree AND main tree) and parity-compared. NOT committed (as asked).
HEAD at build time: `c2abbcd` (WP5). Foreign check at start: only `src/builder/shared.tsx` held another
chat's edit (plus untracked `cpo.json`, `docs/homebrew-stat-block-for-chats.md`); WP9a touches none of them,
so no `.patch` file was needed.

## What was built (by symbol)

**NEW `src/rules/blocks/wgExport.ts`** (pure, read-only):
- `tweaksWgCannotCarry(saved, content?)` → `string[]`: one line per stored tweak the WG file cannot carry (B20).
  - Reads through the one stored reader `readTweaks`, with the character's read-time rank sort laid over the
    meta first (`withRankSort(c.overrides, c.tweakRankSort)`), so an old rank entry reads "at least" /
    "exactly" exactly as the sheet applies it.
  - EVERY stored tweak is listed, grouped by kind (registry `BLOCK_KINDS` order, stored order inside a kind).
  - A tweak that does nothing right now is marked "(off now)": paused (its own switch), a start level above
    the character's level, or Tweaks switched off. Decided by the one predicate `entryLive(b, character)`
    (blocks/active.ts) — so an import-stamped entry, which ignores the master switch, is correctly NOT off.
  - A stored entry this version cannot read is listed with "(can't be read: <why>)", never skipped
    (decision 13, UNKNOWN ≠ EMPTY).
  - The blocks kept unread (`readTweaks().foreign`) get one line each: "A tweak (Bonus or penalty) made by a
    newer version of the app" for a newer version; "… this version of the app can't read" for an unknown kind
    or an unparsable element.
  - Reason shown in brackets after the row, like the breakdown lines.
  - Private helpers: `rowText` (one readable line per kind: "Strength score set to 18", "Stealth: at least
    expert", "Feat given: Fleet (level 3)", "Language added: …", "Spell added: … (rank N)", "Feat removed: …",
    "Taken anyway: …", "Your text for: …", "Fortitude save +1 status", …), `targetName` (target key → words,
    Lores through their subject: "Sailing Lore"), `recordName` (name from the content view, the id when the
    record is missing), `foreignText`.

**`src/sheet/RosterScreen.tsx`** (CRLF kept: 457 → 485 CRLF lines, 0 LF-only):
- NEW module function `wgTweaksOk(c, content)`: `tweaksWgCannotCarry(c, ownContent(content, c))`; empty → true
  (no dialog); otherwise `confirmDialog` titled "Some tweaks can't go to Wanderer's Guide", message = the list
  (`ul.wg-tweaks-lost`) + "The numbers in the file include the tweaks that are on, but a re-import will not
  bring any of them back as tweaks.", buttons "Export anyway" / "Cancel".
- `askExport`: between the target choice and `doExport`, only for `'wg'` (and only when content is loaded):
  `if (target === 'wg' && content && !(await wgTweaksOk(c, content))) return;` — Cancel / Escape / the X
  write no file. `exportWg` is untouched (still a pure string builder). The `.codex` export never asks.

**`src/rules/blocks/overrides-readers.json`**: new entry `src/rules/blocks/wgExport.ts#tweaksWgCannotCarry`
(count 1, why: storage listed as it is, every stored tweak including paused and unread ones; live-ness asked
of `entryLive`; applies nothing) — section 7.1, same commit as the reader.

## Files
- NEW `src/rules/blocks/wgExport.ts`
- `src/sheet/RosterScreen.tsx`
- `src/rules/blocks/overrides-readers.json`
- NEW `test/tweaks-wg-export.test.tsx`
- NEW `work/tweaks-part-b-notes/wp9a-report.md` (this file)

Untracked outputs (do not commit): `work/.partB-wp9a.json`, `work/.partB-wp9a.vs-wp5.txt`,
`work/.partB-wp9a.vs-baseline.txt`.

## Tests
NEW `test/tweaks-wg-export.test.tsx` (12 tests, synthetic level-5 fighter "Wren"):
- pure: "three live tweaks, three lines"; "no tweak at all, an empty list"; "paused tweaks are listed as off —
  its own switch, and a start level above the character"; "with Tweaks off every tweak is listed as off";
  "a newer-version block is listed, and so is a stored entry this version cannot read"; "records are named
  from the content; a given feat says its level" (a missing record is listed by its id); "an old rank entry
  reads as the sheet sorts it (the read-time sort)".
- roster dialog: "no tweak at all, no dialog — the file is written"; "lists the tweaks, and 'Export anyway'
  writes the file" (also: no file before the answer; the list scrolls inside the dialog); "with Tweaks off the
  export still warns"; "Cancel writes no file"; "the lossless .codex export never asks".

Runs (all through `node scripts/vt.mjs`):
| where | files | tests | result |
|---|---|---|---|
| main tree | tweaks-wg-export, bug-export-menu-clipped, transfer | 39 | all passed |
| WP9a-only worktree (final files) | tweaks-wg-export, bug-export-menu-clipped, transfer, overrides-readers-check | 57 | all passed |

**Mutation proof** (in the worktree, each mutant reverted before teardown):
- M1 drop the gate in `askExport` → 3 dialog tests fail ("lists…", "Tweaks off still warns", "Cancel writes no file").
- M2 never mark "(off now)" → "paused…" and "with Tweaks off…" fail.
- M3 drop the foreign lines → "a newer-version block is listed…" fails.
- M4 drop the list's scroll style → "lists the tweaks…" fails.

## Type-check
- Main tree (with the other chat's shared.tsx edit present): app EXIT 0, tracker EXIT 0.
- WP9a-only worktree: app EXIT 0, tracker EXIT 0.

## npm run verify
- WP9a-only worktree: GREEN (EXIT 0), run twice (before and after the list-scroll addition). Last line
  "blocks-check: OK — 16 registered kinds, 29 targets"; tweak readers "30× in 19 place(s)" with the new entry.
- Main tree (other chat's shared.tsx edit present): GREEN (EXIT 0), same last line.

## Parity
Snapshot in the WP9a-only worktree (HEAD `c2abbcd` + WP9a):
`node node_modules/jiti/lib/jiti-cli.mjs scripts/blocks-parity-snapshot.mjs --out work/.partB-wp9a.json`.

1. Against WP5's snapshot: `--compare work/.partB-wp5.json --against work/.partB-wp9a.json`
   → NUMBER differences 0, breakdown-part differences 0, sumOk changes 0.
2. Against the part-B baseline with WP3's allow lists (same `--allow` / `--allow-stat` as wp5-report.md):
   → NUMBER 10 not allowed (+66 allowed), breakdown parts 24, sumOk 4, character set 2 — exactly WP3's / WP5's
   counts, and compare 1 shows WP9a equals WP5 row for row, so every row is WP3's, already classified in
   wp3-report.md (66 allowed = cases A, B, C and the Lore-row move; 10 = `build.hash` of the derived
   `tweakRankSort` field; 24 parts = thievery / medicine / Lore rows and the max-HP book lines; 4 sumOk = the
   Lore-row move; 2 = the new-shape pair). WP9a adds no difference: it changes no sheet number.

## Worktree proof and teardown
- `C:\Users\r2g2\AppData\Local\Temp\hh-wp9a`, HEAD `c2abbcd`, made with `-c core.autocrlf=false` (LF checkout).
  RosterScreen / overrides-readers.json got WP9a's diff via `git apply` (diff stat: 2 files +32); wgExport.ts
  and the test copied in. node_modules and tracker/node_modules junctioned; `work/wg-batch-*.json`,
  `.partB-baseline.json`, `.partB-wp5.json` copied in; the 9 residual JSONs that differ only by CRLF
  rewritten from `git show HEAD:<path>` (same as WP5).
- Teardown: both junctions removed FIRST (`rmdir`), tracked files rewritten from HEAD bytes, temp untracked
  files deleted, plain `git worktree remove` + `git worktree prune` (no `--force`); the folder is gone; main
  node_modules 421 entries and tracker 471 (as in WP5), vitest and typescript present.

## Deviations from the plan (with reasons)
1. **`tweaksWgCannotCarry(saved, content?)`** takes an optional content view (the plan wrote `(saved)`): a
   given feat / spell / language is stored by id, and the player needs its name. RosterScreen passes the same
   `ownContent(content, c)` view the export uses (so carried custom records are named too). Without content a
   record shows its id.
2. **Every foreign block is listed, not only newer-version ones** (B20 names "newer-version entries"): an
   unknown kind or an unreadable element is lost on export just the same, and "EVERY stored tweak" covers it.
   A broken old-key entry is listed with "can't be read" instead of "(off now)".
3. **The list scrolls inside the dialog** (`maxHeight: 45vh; overflowY: auto`, inline on the `ul`):
   `.picker` clips (`overflow: hidden`, max 92vh), so a long tweak list would push "Export anyway" out of
   reach on a phone. Inline style rather than a sheet.css rule, to keep WP9a out of a file the other chat
   edits; a test pins it.
4. **Row text is local to wgExport.ts** (`rowText`, `targetName`): the Tweaks page's `rowText` (plan 4.4) is
   WP6's. WP6 may move these into `src/builder/tweaks/model.ts` and have the export reuse them, so the dialog
   and the page word a tweak the same way.

## Ask Guy
Nothing. No ruling conflict, unsettled print or impossible step came up.

## Out of scope (seen, not fixed)
- The confirm dialog (`.confirm-body`) itself never scrolls: any other confirm with a long message has the
  same clipped-button risk (`.picker` overflow hidden). Only this WP's list was given its own scroll.
- A `spell-attack` / `spell-dc` tweak names its casting entry by id in the list (no casting-entry name lookup
  exists in the blocks layer yet); WP6's row text should name the entry.

## Not checked
- The dialog in a real browser / phone width (jsdom has no layout; WP10's browser test covers the screens).
