# WP3 report — old characters: the read-time rank sort, the Lore-row move, case C (builder, 2026-10-21)

Status: built, tested, verified, and parity-compared. NOT committed (as asked).

## What was built (by symbol)

**NEW `src/rules/blocks/migrate.ts`** (pure; no build import; a home file of the overrides-readers guard):
- `rankSortFor(rawKey, entryRank, atSlotRank)` (B2):
  - below the at-slot rank → `'exactly'`;
  - at or above it → `'atLeast'`;
  - a raw Lore key (not its own `loreKey` form) → always `'atLeast'`.
- `unsortedRankKeys(ov)`: the entries the sort takes.
  - It takes `rank.legacySet` entries whose rank is valid and whose target is a built rank track.
  - Unreadable ranks, unknown keys and a bare `lore:Lore` stay out.
- `withoutUnsortedRanks(host)`: the inner-build copy for B1.
  - Unsorted entries are removed.
  - Sorted entries, `meta`, `v` and every other key stay.
- `atSlotRankOf(snap, key)` and `rankSortFromSnapshot(host, keys, snap)`.
- `withRankSort(ov, sort)` (B3), a memoised in-memory copy:
  - writes `meta['proficiencies:<k>'] = { ...matching meta, mode, of, moved: true }`;
  - an import-stamped meta is never marked `moved` (plan 3.x, item 4);
  - never touches `v`; never mutates.

**`src/rules/build.ts`**:
- The module-private `AT_SLOT_PROBE` (a WeakMap). It is never exported.
- `RANK_SORT_MEMO` (build × content, both weak).
- Exported `legacyRankSort(build, content)`:
  - fast path: no sortable unsorted entry → `undefined`, with no build;
  - otherwise ONE inner build, read through the probe;
  - it asserts that the inner build has nothing left to sort (no recursion);
  - an inner-build throw → no sort (B2's safe side).
- In `buildCharacter`:
  - `tweakRankSort = legacyRankSort(...)`; `rankHost = { ...build, tweakRankSort }` feeds `rankTweaks` and `liveLegacyRanks`.
  - The probe call sits right before the old `=` loop.
  - B26 (a): `skillsBeforeFloors`. `skillsBeforeIncreases` gets only the non-moved level-1 floors. `skillFloorsAt` entries carry `moved`, and `laterFloorsOf` skips moved floors.
  - B26 (b): every live moved "exactly" is also written at the old `=` slot with `updateTrackRank`.
  - The Character literal emits `...(tweakRankSort ? { tweakRankSort } : {})` and keeps `overrides` as the stored object.
  - The `languageLoreRerun` tail hands the probe on to the rerun's build object.

**`src/rules/blocks/active.ts`**:
- `TweakHost.tweakRankSort?`.
- Private `rankOverrides(h)` (uses `withRankSort`). `rankTweaks` and `liveLegacyRanks` read through it.
- `LEGACY_NUMBER_LISTS` comes from the registry (only `maxHp`).
- `activeNumberBlocks` also yields the live legacy number-family blocks, so `numberTweakTerms(c,'max-hp')` carries the set.
- NEW `maxHpTweakTerms(c)` returns those terms. It adds a fallback set term from `hitPoints.maxOverride` only for a hand-made character with no stored `maxHp` (never both).

**`src/rules/types.ts`**:
- `TweakRankSort`.
- `Character.tweakRankSort?`: derived and documented as derived. It is not in `CARRIED_CHARACTER_FIELDS`.

**`src/rules/derive.ts`**:
- `maxHpTerms` header rewritten; it uses `maxHpTweakTerms(c)`.
- The `deriveMaxHp` early return is deleted. The old return was `maxOverride - drained`.

**`src/rules/explain.ts`** `case 'hp'`: the "Manual maximum (override)" branch is deleted. The term list prints the set line.

**`src/rules/blocks/registry.ts`**:
- `number.setMaxHp` is `applies: 'blocks'`, and its `test` is `test/tweaks-max-hp-set.test.ts`.
- The `rank.legacySet` comment now says what is left: the entries the sort cannot take.

**`src/rules/blocks/catalog.json`**: the `number.setMaxHp` note.

## Files
- New:
  - `src/rules/blocks/migrate.ts`
  - `test/tweaks-migration.test.ts`
  - `test/tweaks-max-hp-set.test.ts`
  - `test/tweaks-load-not-edit.test.ts`
- Changed:
  - `src/rules/build.ts`, `src/rules/types.ts`, `src/rules/derive.ts`, `src/rules/explain.ts`
  - `src/rules/blocks/active.ts`, `src/rules/blocks/registry.ts`, `src/rules/blocks/catalog.json`
  - `test/blocks-rank-seams.test.ts`, `test/blocks-breakdown-sums.test.ts`
- This report.

Ownership check: every hunk in those 9 tracked files is WP3's (`git diff HEAD` read hunk by hunk). There is no foreign hunk, so no `.patch` file was needed.

Line endings: each file keeps its own, with none mixed.
- CRLF: build.ts, types.ts, explain.ts.
- LF: everything else.

The other chat's files (App.tsx, campaigns, storage, CampaignsPage and their tests) were not touched.

Untracked outputs (do not commit):
- `work/.partB-wp3.json` (the WP3-only snapshot, taken in the worktree);
- `work/.partB-wp3.compare.txt` (its full compare list).

## Tests (all through `node scripts/vt.mjs`)
**New:**
- `tweaks-migration`, 18 its:
  - case A;
  - case B (an increase trains Medicine at the slot, then Medic Dedication raises it);
  - at-or-above → at least;
  - the Blackjacket blocker pin;
  - the inner build drops unsorted entries and keeps sorted ones;
  - the language-Lore rerun;
  - raw Lore → loreKey row, always at least;
  - a canonical Lore sorts like a skill;
  - unreadable / bare `lore:Lore` / unknown key stay as today;
  - `tweakRankSort` is emitted and `overrides` is the stored object;
  - a stamped entry is never re-sorted after a level-up;
  - B26 (a) Molten Wit; B26 (b) Barbarian Dedication's fallback; after an edit, a plain floor / clamp;
  - the probe is unreachable;
  - "old characters: every number equal to part A except cases A, B, C and the Lore-row move": a per-character, per-gate, per-stat pinned allowlist against the WP0 fixture deltas, with the `#none` twins built at test time;
  - the never-move set has no allowed stat;
  - hidden-card == its sibling.
- `tweaks-max-hp-set`, 7 its, each titled with `number.setMaxHp`:
  - the mode bonus is kept;
  - Drained still subtracts;
  - a Con mode moves the set;
  - paused / switched-off → the computed max HP and no `maxOverride`;
  - the breakdown shows the book lines, sums to the total, and has one set line;
  - a hand-made `maxOverride` keeps its set (and a stored set wins over a stale `maxOverride`);
  - the tracker row, party card and sheet agree.
- `tweaks-load-not-edit`, 2 its, run on the fake server:
  - the chain is `parseRoster` → `rebuildRoster` → `noteDerivedRefresh` → `noteRosterChange`;
  - on a SAMPLE + import-stamped feat + sortable entries load: no build byte changed, the same authoredKey, no `v`, no meta stamp, the same timestamp, no write, and a second launch is the same again;
  - the mutation proof: a load that writes `v: 2` moves the build bytes and the authoredKey. The clock alone would not catch it, which is why the test reads the build.

**Updated, each with a cited reason:**
- `blocks-rank-seams`: the 'rank.legacySet' describe was re-titled.
  - (1) flips to expert in all 3 expects (case A).
  - (2) is unchanged, with "(B1: sorted against the at-slot rank)" added to its title.
  - (3) keeps Fortitude / Perception and flips only the Lore expect to `lore:sailing` (the Lore-row move).
- `blocks-breakdown-sums`: the header line "a manual max HP is one line" is reworded.
- `audit-followup` ~70 (maxOverride 99): it does not move (total 99, the parts sum to 99), so it was left as the plan says.

**Results:**

| Where | Files | Tests | Result |
|---|---|---|---|
| Main tree | 23 | 812 | all passed |
| WP3-only worktree | 23 | 812 | all passed |

The 23 files: the 3 new ones, plus `blocks-rank-seams`, `blocks-breakdown-sums`, `blocks-generic-step`, `blocks-set-pooling`, `rebuild-sync`, `gm-sync`, `content-path-pin`, `bug-tracker-pc-row-agrees`, `audit-followup`, `overrides`, `held-feat-slots`, `batch5-parity`, `rank-gated-feat-grants`, `tweaks-pause`, `tweaks-legacy-fixture`, `blocks-registry`, `blocks-check`, `overrides-readers-check`, `feat-readers-check`, `initiative`.
- `batch5-parity` and `rank-gated-feat-grants` stayed green with no change.
- One failure on the first run: `tweaks-load-not-edit` compared against the raw JSON. `parseRoster` already fills play defaults (an older normaliser with its own authored-key pairing), so the test now takes the PARSED sheet as its baseline. It also asserts that the parse keeps the build byte for byte.

**Mutation proof** (in the WP3-only worktree; every mutant was removed afterwards and checked equal to main):

| Mutant | What it did | What failed |
|---|---|---|
| M2 | no probe handed to the rerun | the language-Lore it() |
| M3 | moved floors back in `skillsBeforeIncreases` / `laterFloorsOf` | the Molten Wit it() and the never-move fixture (asof) |
| M4 | no B26 (b) slot write | the Barbarian Dedication fallback it() |
| M5 | the old `deriveMaxHp` early return | 5 of 7 max-HP its |
| M1 (run alone) | sort against the FINAL rank | the Blackjacket pin, the rank-seams Medic pin and both fixture its |

- Batch A (M2–M5 together): 10 failures in total.
- Under M5, the "agree" it() still passed by design: every surface reads the same `deriveMaxHp`.

**Type-check** (`node node_modules/typescript/bin/tsc --noEmit`):
- Main app: EXIT 2, from a single foreign error: `src/sheet/CampaignsPage.tsx(33,61) TS6133 'recordTombstoneKeys'`. That is the other chat's work in progress. Earlier the same run showed a foreign `src/App.tsx(743,102)` error instead.
- Main tracker: EXIT 0.
- WP3-only worktree: app EXIT 0, tracker EXIT 0.

## Verify
`npm run verify` was GREEN (EXIT 0) in both places. The last line was "blocks-check: OK — 16 registered kinds, 29 targets".
- Main tree: GREEN.
- WP3-only worktree: GREEN.

## Parity
The snapshot was taken in the WP3-only worktree:
1. `node node_modules/jiti/lib/jiti-cli.mjs scripts/blocks-parity-snapshot.mjs --out work/.partB-wp3.json`
2. `--compare work/.partB-baseline.json --against work/.partB-wp3.json` with:
   - `--allow '^overrides:(test-sample|proficiencies|hidden-card|lore|lowered-raise|maxHp:wizard-L5#(mode|con-mode))'`
   - `--allow-stat '^(build\.hash|(explain\.)?skill\..*|pc\.skills\..*|(explain\.)?save\..*|pc\.(fort|ref|will)(Mod|Prof)|(explain\.)?perception.*|pc\.perception.*|summary\.perception.*|(explain\.)?initiative.*|(explain\.)?class-?[dD][cC].*|pc\.classDC|ac|explain\.ac.*|pc\.ac|hp\.max|explain\.hp\.total|pc\.maxHP|summary\.hpMax)$'`

**Counts:**

| Item | Count |
|---|---|
| NUMBER differences (not allowed) | 10 |
| NUMBER differences allowed | 66 |
| breakdown-part differences | 24 |
| sumOk changes | 4 (2 now sum, 0 stopped) |
| character set changed | 2 |

Without `--allow`, the compare shows 76 NUMBER differences.

**The 66 allowed rows**, every one classified:

| Case | Character | Gates | Rows | Change |
|---|---|---|---|---|
| A | `proficiencies:fighter-L7` | off, on | 4 stats each, 8 in all | Thievery trained → expert. `skill.thievery` 12 → 14, `.rank`, `pc.skills.Thievery` 12T → 14E, `explain…total` +12 → +14. The level-5 increase the old `=` swallowed now counts. |
| A | `hidden-card:fighter-L7` | off, on | 8 | Exactly the same 8 rows as its sibling. |
| Lore-row move | `lore:bard-L5` | off, on | 12 | `skill.lore:Sailing Lore` (7, trained, explain +7) → absent; `skill.lore:sailing` absent → 7 / trained / +7. Same number, one real row. |
| B | `lowered-raise:fighter-L4` | off, on | 8 | Medicine expert → untrained. `skill.medicine` 9 → 1, `.rank`, `pc.skills.Medicine` 9E → 1U, explain +9 → +1. Untrained at the slot; Medic Dedication's later raise no longer lifts it. |
| C | `maxHp:wizard-L5#con-mode` | off, on | 8 | 77 → 82 (`hp.max`, `pc.maxHP`, `summary.hpMax`, `explain.hp.total`). The +1 Con mode is +5 at 5th. |
| C | `maxHp:wizard-L5#mode` | off only | 4 | 77 → 127. Azata's Grace +50. |
| C | `maxHp:wizard-L5#mode-drained` | off only | 4 | 67 → 117. +50 − 10. |
| hash | `test-sample` ×2 characters, `lore-canonical` ×1 | off, on | 6 | `build.hash`. Proved to be ONLY the new derived `tweakRankSort` field (see below). |
| hash | `proficiencies`, `hidden-card`, `lore`, `lowered-raise` | off, on | 8 | `build.hash`. Their ranks moved as listed above. |

- Azata's Grace's own max-HP bonus is dark at trust gate ON, so the two Azata characters move at gate OFF only.
- Allow-regex note: `lore` also matches `lore-canonical` and `lore-bare`. Both are NUMBER 0 apart from lore-canonical's hash.

**The 10 not allowed:** all `build.hash` rows. They are asof-L5, at-slot-L4, daily-L5, daily-L8 and firearm-gunslinger-L5, each at both gates. These characters have sortable unsorted entries, so they get the new derived field, as the plan expects ("hash diffs only on characters with a sortable unsorted entry"). Every other stat of theirs is NUMBER 0.

**Hash proof** (scratch script):
- Method: rebuild every hash-changed character at WP3, drop `tweakRankSort`, and re-hash it the snapshot's way.
- Result: 16 of 24 hash rows equal the BASELINE hash, so the new field is the only change. Those 16 are asof, at-slot, daily ×2, firearm, lore-canonical and test-sample ×2, each at both gates.
- The other 8 are the characters whose ranks moved (A / B / Lore-move above).

**24 breakdown-part rows**, all informational:
- the thievery / medicine / Lore rows above (10);
- `hp` on every maxHp character (10) and on test-sample ×2 (4). Here "Manual maximum (override) = N" is replaced by the book lines, the set line and the mode / Drained lines. For example: Ancestry HP (Human) 8 + (6 class + 2 Con) × 5 levels 40 + Tweak: set to 77 = 29 + Azata's Grace 50.
- These are the breakdowns the plan expected to change ("the set now shows book lines").

**4 sumOk:** the Lore-row move: the raw row went `true → null` and the real row `null → true`, at both gates.

**Character set 2:** `overrides:new-shape:fighter-L5` and its `#none` twin. These are WP1's characters, not in the baseline (the same as in WP2's report).

**Every other character is NUMBER 0,** including at-slot, asof, firearm, daily, legacy-misc, import-meta, lore-bare, addedFeats, attributes, maxHp (plain) and maxHp#drained. The plain set and the Drained set give the same number as before (77 / 67): the old early return already took Drained off.

## Launch time (the plan's Risks line)
The proxy: `rebuildRoster` over 30 synthetic characters (10 classes × L5/10/15), every build a fresh JSON copy, under the heavy lock.
- The "old" roster holds `{thievery:'trained', fortitude:'trained', perception:'expert', 'lore:Sailing Lore':'trained'}` on every character.
- The "plain" roster has no overrides.
- 7 runs; times are the median, cold in brackets.
- Both measured in the same worktree, under the same conditions.

| Engine | Plain | Old |
|---|---|---|
| Before (HEAD d7577b0) | 12 ms (cold 41) | 12 ms (cold 24) |
| After (WP3) | 15 ms (cold 61) | 29 ms (cold 37) |

The sanity print shows the old entries really sorted after WP3 and not before.

The cost is one extra build per character that still holds an unsorted old rank entry, so those characters take about 2.4× as long. It is memoised per build object, and it disappears once WP4's Builder-open stamp writes the mode down.

**Limit:** these are minimal builds (one feat each). A real 30-character roster with full feat picks costs more per build in absolute terms, but the ratio is the same (one extra build).

## Deviations from the plan (with reasons)
1. **Where the helpers live.** The inner-build copy and the snapshot reading are in `migrate.ts` (`withoutUnsortedRanks`, `unsortedRankKeys`, `atSlotRankOf`, `rankSortFromSnapshot`), not in build.ts. `rankSortFromSnapshot` takes the host rather than `ov`. Reason: build.ts must not add `.overrides` reads (the overrides-readers guard), and `migrate.ts` is a home file. `legacyRankSort` itself is in build.ts, as planned.
2. **A failed inner build gives no sort.** If the inner build throws, nothing is sorted: every entry keeps today's `=`. The plan does not say; this is B2's safe side, never a guess.
3. **Where the hand-made fallback lives.** The `hitPoints.maxOverride` fallback set term is in `active.ts` `maxHpTweakTerms` (called by `derive.ts` `maxHpTerms`), not inline in derive.ts. It is one function for the "never both" rule. The behaviour is as planned.
4. **Dedications in the it()s.** The B26 / Blackjacket / Medic its give their dedications through `overrides.addedFeats`, as the existing rank-seams tests do. The fixture characters that use real `featPicks` (lowered-raise, at-slot) are pinned by the fixture-delta it().
5. **The load test's baseline.** `tweaks-load-not-edit` compares against the parsed sheet, not the raw JSON, because of parseRoster's older play normaliser (see Tests).

## Ask Guy
Nothing. No ruling conflict, unsettled print or impossible step came up.

## Out of scope (seen, not fixed)
- **An unreadable rank text is written raw.** An old entry like `{ athletics: 'Expert' }` (capitalised) is written into `proficiencies.skills.athletics` as the text `'Expert'` by today's `=`. This is WP2's deliberate "B2 keeps today's `=` for a broken rank". A downstream `profBonus('Expert')` probably reads it as untrained. The new test pins today's behaviour.
- **Unknown keys and bare `lore:Lore`.** An unknown key (`foo: 'expert'`) and a bare `lore:Lore` still write their own raw rows (today's `=`, unchanged).
- **A stale test title.** `test/audit-followup.test.ts` ~68 is titled "…shows a single reconciling part", but a hand-made `maxOverride` now shows the book lines plus a set line. Its assertions (total 99, the parts sum to 99) still hold, so the plan said leave it. Only the title is stale.
- **Foreign tsc errors in the main tree:** `src/sheet/CampaignsPage.tsx(33,61)` and, earlier, `src/App.tsx(743,102)`. Both are the other chat's work in progress.

## Worktree proof and teardown
- **Setup:** a temp worktree at HEAD d7577b0, `C:\Users\r2g2\AppData\Local\Temp\hh-wp3`, outside the repo, made with `-c core.autocrlf=false`.
  - node_modules and tracker/node_modules were junctioned in.
  - The ignored inputs were copied in: 145 `work/wg-batch-*.json` plus `work/.partB-baseline.json`.
  - 9 tracked residual files that differed only by CRLF were rewritten from HEAD.
  - WP3 was applied as `git diff HEAD` of the 9 tracked files, plus the 4 new files.
- **Run there:** both timings, tsc (app + tracker), the 23 test files, `npm run verify`, the parity snapshot and compare, and the mutation runs.
- **Teardown:**
  1. Removed both junctions FIRST (`rmdir` on the link only).
  2. Reverse-applied the patch.
  3. Deleted the 4 new files, the 146 copied inputs and the generated `.partB-wp3.json`, `.partB-baseline.compare.txt` and `settle-audit.json`.
  4. Rewrote the 9 files from HEAD bytes (the reverse apply had left CRLF).
  5. A plain `git worktree remove` and `git worktree prune`.
  6. Main `node_modules` intact: 421 entries, tracker 471, vitest and typescript present.
  7. The worktree folder is gone.

Not checked:
- The real app (Tauri / browser) on an old character. Everything here is engine, test and snapshot level, and no UI was changed.
- A full-size real roster's launch time (the proxy uses minimal builds).
- The full test suite. Only the 23 files above ran.

Risks:
- Every character that still holds an unsorted old rank entry builds twice per read until WP4 stamps it.
- `tweakRankSort` is a new derived field on every such character, so their published sheet changes once (derived, not authored: authoredKey is unchanged, which the load test checks).
- The WP3 "Watch" item (an unknown reader between seam 1 and the old slot that reads a skill's current rank) showed nothing in the compare. That covers only the snapshot's characters.

Tell Guy: nothing needed from him for WP3.
