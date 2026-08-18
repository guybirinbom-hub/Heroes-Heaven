# Migration: one dataset, three renderings

**Read this file first.** It is the resume point. If a session ended mid-work, section 6 says exactly
what to do next. Nothing here needs re-measuring — every number was verified against the real files.

---

## 1. The goal, in the user's words

- "All of the data that is in my app Archives of GuyB needs to be in Heroes Heaven (except for images)."
- "There shouldn't be allowed duplicates — 1 database for the archive and one for the initiative
  tracker; there needs to be **1 database** the app uses in the character sheets, initiative tracker,
  and when we get to it in the future the archive."
- "The data will also need to be able to be displayed in 2 ways, because things in the character sheet
  won't be displayed the same as the archive, but the data needs to come from the same place."
- Creatures: the archive page looks like Archives of GuyB; the initiative tracker keeps its **current**
  layout, dice rolling and condition handling. Same record, two renderings.

## 2. HARD RULES — do not violate these

1. **No value that ever originated in Foundry.** This is the strict reading and it is the user's
   explicit decision. It is not enough to delete the Foundry file — no value copied out of it may
   survive either.
2. **If you cannot find something in the archive, STOP AND ASK.** Do not fall back to Foundry data,
   ever, not even "temporarily". The user's words: *"if you reach something you have a problem with
   DON'T USE THE FOUNDRY DATA, instead we will find it together in the archives."*
3. The user guarantees the archive lacks nothing. **The expected failure mode is us misreading the
   data, not the data being absent.** Treat every apparent gap as a lookup bug until proven otherwise.
4. **Never match records by name.** PLAN.md records 8,227 same-category name collisions, and matching
   by name has already produced two wrong conclusions in this project (see section 5). Match by
   archive doc id.
5. Never auto-fill a player's choice (a long-standing rule in this app, unrelated to but unaffected by
   this migration).

## 3. Where everything lives

| What | Path |
|---|---|
| Heroes Heaven | `C:\trying ai 2\pf2e codex` |
| Archives of GuyB (design record: **PLAN.md**, 297 lines — read it) | `C:\trying ai 2\Archives of GuyB` |
| Built archive db (957 MB, read-only) | `…\Archives of GuyB\app\src-tauri\resources\aon.db` |
| The export HH already builds from | `C:\trying ai 2\hh-data-export\without-images\data` (93 files) |
| Foundry base — **to be deleted** | `pf2e codex\public\core.foundry-backup.json` (18 MB) |
| Python (PATH `python` is a broken Anaconda) | `C:\Users\r2g2\AppData\Local\Programs\Python\Python310\python.exe` |

No `sqlite3` CLI and no `better-sqlite3`. Query `aon.db` with the Python above, always
`file:...?mode=ro`.

## 4. Measured facts (verified — do not re-derive)

**Archive** — 43,686 docs, 93 categories, 289 fields, scrape index `aon81`, manifest `verified:true`.
`docs.json` 222.0 MB raw → 23.5 MB gz. `docs.ast` 186.9 MB raw → 24.8 MB gz. 1,111,524 link rows.
`vectors` 43,686 × 384 float32 = 64.0 MB. FTS `docs_fts_data` = 27.0 MB. Embedding model
`BAAI/bge-small-en-v1.5`, `model_optimized.onnx` = 63.4 MB. Images 722 MB — **excluded**.

Top categories: equipment 8642, feat 8460, creature 4714, action 3979, rules 3645, spell 2461,
item-bonus 1315, class-feature 1254, trait 907, deity 717, sidebar 694, creature-family 646,
hazard 634, weapon 614, background 612, heritage 436, archetype 336.

**Heroes Heaven today** — `public/ast/` 21,737 docs in the files but only 20,220 in `ast-index.json`
(1,517 shipped-but-unreachable), 9.3 MB gz. `core.json` 8.5 MB, `core-descriptions.json` 15 MB,
`idmap.json` 1.6 MB (**never fetched at runtime** — verified by grep), `public/data/` 50.9 MB
uncompressed, 210 files, 4,347 creatures. `dist/` 94 MB. **Android APK release = 44,314,664 bytes
(42.3 MB)**, at `src-tauri/gen/android/app/build/outputs/apk/arm64/release/`.

**Compression** — Tauri brotli-embeds `dist`, so pre-gzipping *hurts* the APK. Measured on
`public/ast/items.json`: raw 36.25 MB; gzip 2.47 MB; **brotli(raw) 1.36 MB; brotli(gzip) 2.36 MB** —
pre-gzipping wastes 1.00 MB on that one file. → **ship gz to the web build, raw to Tauri.**

**Decisions already made by the user**
- Browser/Cloudflare **is** still a shipping target → keep emitting gz for web.
- Phone search: **keyword-only**. No ONNX runtime, no vector table in the APK.
- Creatures render two ways from one record (archive page + tracker stat block).

## 5. Two wrong conclusions already made here — do not repeat them

1. **Read the right category file.** "The archive has no weapon damage / armour dex cap" was false —
   `equipment.json` lacks them but `weapon.json` (614) has damage/damage_die/hands/range/reload and
   `armor.json` (75) has ac/check_penalty/dex_cap/speed_penalty/strength. `shield.json` (32) has
   ac/hardness/hp. Spells: `saving_throw`, `actions` (cast), tradition, range, area, duration,
   heighten, target are all on `spell.json`.
2. **Read the right doc, not the right name.** "Flurry of Blows has no traits in the archive" was
   false. There are FOUR docs: `action-9` and `action-2817` carry `['Flourish','Monk']`;
   `class-feature-180` and `class-feature-929` carry none. AoN splits "the class grants you X" from
   "X, the action" — **the traits live on the action.** The user caught this from a screenshot.

Corrected trait figure: of 361 non-class trait entries on HH class features, **231 are found in the
archive by name in some category**, 130 not yet — and name matching is exactly what rule 4 forbids, so
the real number will be better once matched by id.

## 6. STATUS — what to do next

**Stage 1 (inventory): FIRST PASS DONE.** `scripts/migration/inventory.mjs` exists, is re-runnable
(`node scripts/migration/inventory.mjs [--collection feats]`, seconds) and writes
`scripts/migration/out/inventory.{json,md}`.

Result: 25,344 core.json records, **21,737 joined by id (85.8%)**, 3,607 not joined.

**Stage 1b (close the join): DONE. Blocked on the user for the last 963 records.**

Final join, after four matching rules (`node scripts/migration/join.mjs`):

| how matched | records |
|---|---:|
| via `idmap.json` | 21,737 |
| via slug, in a CAT_BUCKET category | 121 |
| via slug, in ANY of the 93 categories | 460 |
| via slug minus a trailing `(…)` | 1,284 |
| hand-authored, no archive doc expected | 779 |
| **no archive doc found** | **963** |

A fifth rule — order-insensitive word-token match, which correctly pairs HH `Aged Arbor Wine` with
archive `Arbor Wine (Aged)` — recovers only **11** more, so it was tested and NOT added to the script.

The 963 are listed in full in `scripts/migration/out/unmatched.md`. **Verified absent, not mis-joined:**
exact-name SQL against `aon.db` returns nothing for `Tiny`, `Small`, `Large`, `Huge`, `Magic Carpet`,
`Flying Broom`, `Warship`, `Agate`, `Alocer`, `Erudite`, `Camouflage Coat`, `Construct Companion`.
The archive holds 907 `trait` docs and **zero** size traits — AoN treats size as a rules concept, not
a trait page, while HH models it as a trait.

Shape of the 963: items 402, classFeatures 263 (of which 20 are HH-synthesised `Adept Benefit (…)` /
`Paragon Benefit (…)`), actions 186, feats 56, familiarAbilities 26, spells 8, vehicles 5, trait 5,
backgrounds 4, deities 4, heritages 3, animalCompanions 1.

## STAGE 2a IS COMPLETE — `out/map.json` is the single source of truth

`node scripts/migration/build-map.mjs` collapses every stage-1 output into ONE file. Everything after
this reads only `out/map.json`. **Zero records are `open`, and zero entries are missing their id.**

| status | records | % | meaning |
|---|---:|---:|---|
| `doc` | 23,700 | 93.5% | has its own archive document (`docId`) |
| `authored` | 779 | 3.1% | hand-written HH content — modes/runes/stances, user-confirmed |
| `subblock` | 660 | 2.6% | a section inside another doc (`parentDocId`) |
| `drop` | 145 | 0.6% | user decided to remove — Foundry-only content |
| `derived` | 22 | 0.1% | HH generates it from one archive feature (`parentDocId`) |
| `scraped` | 19 | 0.1% | from the targeted #220 fetch |
| `table` | 19 | 0.1% | a row in a table inside another doc (`parentDocId`) |

The `DERIVED`, `MANUAL` and `DROP_ABSENT` tables live in the script itself, each entry commented with
why — so the map regenerates from source and no decision is lost in a data file.

## STAGE 2b — sub-block extraction: 540 of 594 (91%)

**These three scripts are a LOOP and must be run to convergence** (two passes; the third is a no-op):

```
node scripts/migration/build-map.mjs      # map.json, now consuming reclassified.json
node scripts/migration/extract.mjs        # sections.json + sections-missing.json  (~40s)
python scripts/migration/reclassify.py    # reclassified.json  (CUMULATIVE — see below)
```

| shape | extracted | example |
|---|---:|---|
| `bold` — block led by a bold run | 239 | `Accept Echo` in the feat `Echo of the Fallen` |
| `table` — a row of a table | 151 | `Agate` in the rules page `Gems` |
| `title` — a heading and its siblings | 95 | `Curse of Ancestral Meddling` in the mystery `Ancestors` |
| `inline-bold` — a bold inside a long paragraph | 55 | the 22 inventor weapon modifications, all in ONE `<p>` with 131 children |
| **not found** | **48** | |
| parent doc not in the export | 6 | the Avenger activities — their feats came from the #220 scrape, which has no ast |

`derived` records are deliberately excluded (594 = 573 subblock + 21 table): HH generates them from a
whole parent feature, so the parent page IS their content.

**Converged map: doc 23,779 (93.8%) / authored 785 / subblock 573 / drop 145 / derived 22 / table 21 /
scraped 19 / open 0.** Extracted sections: median 293 characters, shortest 31, **zero empty**.

### An extracted section must carry a BODY — this is an ACCEPTANCE test, not a report

At one point 515 sections extracted cleanly and **151 of them held nothing but their own label**. That
is worse than not extracting at all: it ships as a page that looks migrated and renders blank. Three
causes, all fixed, and the last one is the load-bearing rule:

- The label sat in a block of its own with the description in the NEXT, unlabelled block. The item
  `Tiger's-eye` came out as the bare string `Activate—Tiger's Eyes`. `extract.mjs` now absorbs
  following unlabelled blocks *until it has a body*, then stops.
- A generic stat-block FIELD swallowed a specific record: the bare `Bloodline` field on a sorcerer
  spell matched `Bloodline: Aberrant`. Fixed by requiring a short label to cover **more than 60%** of
  the record's name — the comparison is `>`, not `>=`, because `bloodline` is exactly 60% of
  `bloodline aesir` and three records slipped through on the boundary. Those 13 are real `bloodline`
  documents, now resolved by the `prefix:` rule below.
- **`bodied()` rejects a candidate that yields only its label, so the next candidate gets a turn.**
  `Lust` matched a stray bold in a background; `Pride` one in an action. Reporting not-found beats
  shipping an empty section. The floor is 25 characters — comfortably under the smallest real section
  (a table row is ~49) — plus the label's own length.

Re-run the length check over `out/sections.json` after ANY rule change; it is what caught all three.

**Extraction is also the arbiter of whether a `subblock` assignment was ever right.** `locate.py`
(FTS) ran BEFORE the book-scoped matcher, so weak full-text guesses claimed 652 records before the
strong rules saw them — `Vindicator's Judgment` was filed as a section of "Vindicator's Judgement",
`Norns` under "Norn", `Warship` under "Movement and Heading". A genuine section extracts; a page that
merely mentions the word does not. Two repairs came out of that:

- `extract.mjs` now tries **every** candidate parent `locate.py`/`leftovers.py` found, not just the
  first. 34 records extracted only from a corrected parent — `Amber` was filed under the item
  `Eyes of the Eagle` (which mentions amber) when it is really a row in the `Gems` table.
- `reclassify.py` re-runs the strong rules over every extraction failure and **82 records** came back
  as real matches. `build-map.mjs` now reads `out/reclassified.json`, so its verdict overrides the FTS
  guess and the map still regenerates from source.

**`reclassify.py` is CUMULATIVE and must stay that way.** Its output feeds `build-map.mjs`, so a
matched record stops being a `subblock`, stops being attempted by `extract.mjs`, and vanishes from
`sections-missing.json` on the next pass. Overwriting the file silently dropped all 50 matches from
the previous run. It now loads and merges its own output; to retract a bad match, delete that entry
from `out/reclassified.json` by hand.

| reclassify rule | n | example |
|---|---:|---|
| `prefix:bloodline` | 13 | `Bloodline: Aberrant` → `bloodline-1` "Aberrant" |
| `typo` | 12 | `Commandant's Scabbard` → the archive's `Comandant's Scabbard` |
| `paren-variant` | 9 | `Awakened Adamantine Shot` — the "parent" `Awakened Metal Shot (Awakened Adamantine Shot)` IS its doc |
| `suffix:implement` / `:order` | 8 + 8 | `Bell Implement` → `implement-2`; `Flame Order` → `druidic-order-5` |
| `suffix:eidolon` | 10 | `Angel Eidolon` → `eidolon-1` "Angel" |
| `suffix:instinct` | 5 | `Fury Instinct` → `instinct-3` "Fury" |
| `suffix:methodology` | 4 | `Empiricism Methodology` → `methodology-2` "Empiricism" |
| `exact` | 4 | `Worldforge` → `World Forge` (spacing) |
| `suffix:innovation` | 3 | `Weapon Innovation` → `innovation-3` |
| `variant-prefix` | 2 | `Smoky Hag Eye` → base `Hag Eye` |
| `plural` | 1 | `Ashes` → `Ash` |

Heroes Heaven appends the game term where the Archives use the bare name, so `SUFFIX_RULES` resolves
each suffix inside the one archive category it implies — `implement`, `druidic-order`, `innovation`,
`eidolon`, `methodology`, `instinct`, `arcane-school`, `arcane-thesis`, `research-field`. The category
check is what keeps `Lantern Implement` off the equipment `Lantern`.

Two more archive naming habits, handled inside `labelMatches` rather than by reclassification:
**mythic ikons** put the game term first behind an em dash — the feat `Shield of Stone` carries
`Transcendence—Brandish the Gorgon's Gaze` (46 records, stored twice by HH, once as a classFeature and
once as an action) — and the archive **trails the qualifier** where HH leads with it
(`Arbor Wine (Aged)` vs `Aged Arbor Wine`, `gold piece (gp)` vs `Gold Pieces`).

**Five guards were added because the first run produced wrong matches** — the same failure mode as the
`Agate`→`Plate` round in stage 1. Do not remove them:

- **typo needs ≥2 words.** One word carries no context: `Warship` matched the archive's `Airship` at
  one edit. `Warship` is genuinely absent (already verified by exact-name SQL) and stays unplaced.
- **variant-prefix skips parenthetical names.** `Rounds (Flintlock Pistol)` is ammunition FOR the gun;
  stripping "Rounds" mapped it onto `weapon-192`, the gun itself.
- **the six size traits are `authored`, pinned by key in `build-map.mjs`.** Every automated pass finds
  a plausible WRONG home for them: `Tiny` matched a bulk-conversion table row
  ("Size of Creature | Bulk | Tiny | 1"), `Medium` matched a class sample. Stage 1b already verified
  the Archives hold 907 `trait` docs and zero size traits — there is nothing to join to.
- **variant-prefix emits `table`, not `doc`.** Four Hag Eye variants all resolve to `equipment-935`;
  four records sharing one `docId` is exactly the duplication this migration exists to remove.
- **short-word guard on edit distance.** ≤5 characters may differ by 1 edit, not 2, or
  `Unfettered Mark` matches `Unfettered Pack`.

**NEXT — in order:**
1. **The remaining 71**, listed in `out/reclassified.json` → `stillUnknown`: classFeatures 31,
   items 17, actions 14, feats 4, spells 1, and one each of heritages/backgrounds/animalCompanions/
   vehicles. A diagnostic pass showed most DO have their name somewhere in the parent's text — but as
   a passing mention (`Cutlery` in the spell `Servant`, `Cytillesh Toolkit` in the creature
   `Dero Strangler`), not as a section. So **the parent is wrong, not the shape unsupported**, and
   more matching rules will not help — the automated avenues are exhausted, and the last three rounds
   of rule-adding produced more false matches than real ones. These need the user's Archives-of-GuyB
   lookups, per the agreed method. `Warship` is already known to be genuinely absent.
2. ~~**Stamp `aonId`**~~ — DONE, see below.

## STAGE 2c — provenance stamped onto every record

`node scripts/migration/stamp-aonid.mjs` — **safe by default**: writes `out/core.stamped.json` and a
diff summary. `--write` overwrites `public/core.json`, taking `core.json.pre-aonid.bak` first, and
REFUSES to run if any record is missing from the map.

Each record gets exactly one of:

| field | meaning | records |
|---|---|---:|
| `aonId` | the record's own archive document | 23,819 |
| `aonParentId` + `aonSection` | the document it is a section of, and that section's label | 534 |
| `aonOrigin: 'authored'` | hand-written HH content, no archive source | 785 |
| *(none)* | parent never verified — the NEED-LOOKUP set | 61 |
| *(untouched)* | user chose to drop | 145 |

This field is what makes "one database, two renderings" work: the sheet renders its own compact view,
the archive view renders the full AoN document, both from the same record. Cost: **+7.0% on core.json**
(8.85 → 9.47 MB uncompressed).

**An UNVERIFIED parent is never stamped.** The map's `parentDocId` for a record whose extraction
FAILED is just the unverified full-text guess, and those are routinely wrong — the gem `Alabaster` is
filed under the feat `Alabaster Eyes`, `Emerald` under `Emerald Grasshopper`. Writing that would record
a provenance we know to be false, which is worse than leaving the record unresolved. Only a parent
`extract.mjs` actually pulled a section out of gets written.

### "The section is the whole document" — a record can BE the doc

A late check compared each extracted section's length to its parent's: **47 sections covered >90% of
the parent**, meaning they were not sections at all. Two different things were hiding in there, and the
record's name against the parent's name separates them:

- **names near-equal → the record IS that document.** `Discomfiting Whispers` is the spell
  `Discomfiting Whisper` (`spell-2139`) — the user confirmed this exact case from their Archives app.
  Also `Busine of Divine Reinforcement(s)`, `Eye(s) of the Moonwarden`, `Practice Target(s)`,
  `Spray Pellet(s)`. `extract.mjs` writes these to `out/is-really-the-doc.json` and `build-map.mjs`
  promotes them to `doc`.
- **names differ → the parent is simply wrong**, and the candidate is rejected so the next one gets a
  turn. This is what caught seven gems matching unrelated items.

The rule that caused it has been removed: `labelMatches` no longer accepts a label LONGER than the
record's name (`Alabaster` ⊂ `Alabaster Eyes`). No length ratio separates the good cases from the bad —
`obsidian` is 62% of `obsidian edge` — and the one legitimate case it served, label
`Blunt Shot (Ranged Only)` for the record `Blunt Shot`, is already covered by the paren-stripped variant.

## THE UNLOCK — the importer reads the archive ONE LEVEL TOO SHALLOW

**Every archive doc has a `data` object. 100% of them. `import-core-v2.mjs` never touches it.**

It reads ~21 flattened top-level facets and nothing else, which is why this project kept concluding
that the Archives "lack" mechanics. They do not. Measured across the export:

| field | present at top level | present in `.data` |
|---|---:|---:|
| spell `tradition` / `heighten` / `range` / `duration` | 0% | 66% / 59% / 69% / 53% |
| spell `saving_throw` / `area` / `target` / `component` | 0% | 36% / 23% / 50% / 55% |
| spell `actions` | 0% | **100%** |
| weapon `damage` | 0% | 94% |
| armor `ac` / `strength` | 0% | **100%** / 92% |
| feat `prerequisite` / `requirement` / `trigger` / `frequency` | 0% | 62% / 12% / 10% / 9% |
| item `usage` / `price_raw` / `bulk_raw` | 0% | 84% / 80% / 64% |

The user's guarantee holds exactly as stated: *"the archives don't lack anything… the real problem you
can encounter is having problems understanding the data correctly."* That is precisely what happened.

## HOW BIG THE FOUNDRY PROBLEM ACTUALLY IS

Foundry enters at ONE line — `scripts/import-core-v2.mjs:311`:

```js
out[s] = { ...old, ...overlayContent(rec), id: s, edition: rec.edition }
```

`...old` is the Foundry record. `overlayContent` (`:130`) returns `{ name }`. So an overlaid record
takes three keys from the Archives and **every other key verbatim from Foundry**.

**76.9% of all field-values in `core.json` are byte-identical to `core.foundry-backup.json`**
(209,839 of 272,992). Buckets that are 100% Foundry: `vehicles`, `services`, `followers`, `pets`.
Then `runes` 98%, `classFeatures` 94%, `classes` 93%, `spells` 92%, `feats` 87%, `items` 79%.

Two Foundry values also leak into records we call "AoN-built":
- `:142-148` + `:252` — `mapBook()` rewrites a fresh record's `source.book` to the canonical *Foundry*
  string. 1,699 of 2,043 fresh records.
- `:232-233` — a fresh feat's `category` is decided by testing traits against `Object.keys(cur.classes)`
  and `cur.ancestries`, i.e. the Foundry key sets.

### Measured disagreement — `node scripts/migration/facet-diff.mjs`

Joined by `docId`, never by name. Reports three populations, not two, so records missing a value on one
side cannot flatter the agreement rate.

| facet | comparable | agree | differ | rate | AoN has it, HH does not |
|---|---:|---:|---:|---:|---:|
| level | 12,736 | 12,696 | 40 | 0.31% | 2,828 |
| rarity | 17,255 | 17,180 | 75 | 0.43% | 4,270 |
| price | 5,403 | 5,382 | 21 | 0.39% | 770 |
| bulk | 6,176 | 5,951 | 225 | 3.64% | 703 |
| traits | 15,222 | 12,273 | **2,949** | 19.37% | 92 |

**The traits number is not 2,949 separate problems — it is one policy question.** HH carries Foundry's
*remaster-updated* trait vocabulary; the Archives carry what was *printed* in that edition. The join is
edition-aligned (21,542 same-edition vs 394 different), so this is a real difference in content:
- school traits (`evocation`, `necromancy`, …) — removed by the remaster, still printed on legacy docs
- `positive`/`negative` → `vitality`/`void`; `good`/`evil`/`lawful` → `holy`/`unholy`
- `metamagic` → `spellshape`; `concentrate`/`manipulate` present on HH spells, absent on AoN's

**The `AoN has it, HH does not` column is the real prize**: 4,270 rarities, 2,828 levels, 770 prices and
703 bulks the app is missing today and the Archives can supply.

**facet-diff is also a join-quality check.** It is what caught `Peridot` mapped to
`Crystal Ball (Peridot)` — a 2.5 gp gem inheriting a 12,500 gp price. `reclassify.py`'s paren-variant
rule now needs ≥2 words, for the same reason typo matching does: a one-word record name is often just a
material or colour qualifier on an unrelated item.

## SAFETY — done before any of this

`public/core.foundry-backup.json` is **untracked and gitignored** (`.gitignore:37`); one copy existed on
disk and deleting it could not have been undone. Copied outside the repo with checksums, together with
today's `core.json` and `map.json` (also untracked):

```
C:\trying ai 2\_migration-safety\{core.foundry-backup.json, core.json.baseline, map.json.baseline, SHA256SUMS.txt}
```

## STAGE 2d, PHASE A — FACETS NOW COME FROM THE ARCHIVES. **All 2,819 tests pass.**

`overlayContent()` (`scripts/import-core-v2.mjs`) now returns the name **plus every facet the Archives
state** — level, rarity, traits, price, bulk — via the new `scripts/lib/aon-facets.mjs`.

| | before | after |
|---|---:|---:|
| field-values sourced from the Archives | ~23% | **58.8%** |
| still copied from Foundry | ~77% | 41.2% (213 distinct field names) |

Regenerate with **`npm run data`** — all three steps. A bare `import-core-v2.mjs` costs 57 siege
weapons, and `split-descriptions.mjs` is what keeps core.json at 8.5 MB instead of 22.6 MB.

### The user's decision, recorded

Asked whose traits to use for legacy content, the user chose **"the Archives, but keep remaster
wording"**. So `REMASTER_TRAIT` in `aon-facets.mjs` renames `positive→vitality`, `negative→void`,
`good→holy`, `evil→unholy`, `metamagic→spellshape`, drops `lawful`/`chaotic` (the remaster removed them
with no successor), and **keeps the eight school traits**, which the Archives print and Foundry had
stripped.

### Five defects this uncovered — all were pre-existing, all are now fixed

The first regeneration failed 9 tests. Every one was a real bug, not a broken test:

1. **`traits` loses the parameter — read `trait_raw`.** The `traits` array says `Deadly`; `trait_raw`
   says `"Deadly d8"`, which is what HH encodes as `deadly-d8`. Reading the wrong one cost the rapier
   its crit die, the bastard sword its two-handed die, the light hammer its thrown range and Bastion
   Plate its `entrench-melee`. `trait_raw` is present on **100%** of docs that have traits.
2. **A magic weapon's page lists only its magic traits.** `Eclipse` says Evocation/Light/Magical/Unique;
   the weapon traits live on its base item, which the Archives name in `data.base_item` —
   Eclipse → Starknife → Agile, Deadly d6, Finesse, Thrown 20 ft., Versatile S. 774 items need this
   union or they silently lose their weapon mechanics.
3. **The slug dedup picks the wrong twin.** `Death from Above` is BOTH `feat-7380` (level 16, Mythic,
   Eternal Legend) and `feat-7610` (level 8, Archetype, Verduran Shadow). They slugify identically, so
   `bestByBucket` kept only the higher edition rank — harmless while only the name was copied, but it
   put Mythic and level 16 onto the Verduran Shadow feat and dragged an ordinary level-2 archetype into
   the mythic destiny list. **The importer now reads `out/map.json` and prefers the doc the verified
   migration join names.** If that file is missing it warns and falls back to slug dedup.
4. **The half-ancestries.** The Archives print BOTH names (`["Aiuvarin","Half-Elf"]`), so the legacy
   name came back and half-elf grew a feat list. Treated as remaster renames, matching this project's
   own stated policy at `scripts/backfill-heritage-feat-access.mjs:13`.
5. **A family summary must bind to the family's page, not to one of its variants.** The Archives give
   `equipment-2948` "Potion of Flying" (no price — it IS the summary) plus `-2817`/`-2818` for the
   lesser and greater. The join bound the summary to the lesser, so the summary grew a 100 gp price and
   dropped out of umbrella detection. `preferBase()` re-binds a record with ≥2 kin to the base doc —
   the same kin test `findUmbrellaIds` uses (`src/data/index.ts:217`). Counting kin must span BOTH key
   sets: `potion-of-flying` is a FRESH record, absent from the Foundry reference entirely.

**262 archive docs are still claimed by more than one HH record** (748 records) — variant families where
HH splits per-variant and the Archives keep one page, e.g. the four `wand-of-legerdemain-*-rank`
records all on `equipment-equipment-22819`. Worth revisiting when the archive view is built.

### PROVENANCE IS NOW RECORDED BY THE IMPORTER, NOT INFERRED

`import-core-v2.mjs` writes `scripts/migration/out/used-docs.json` — bucket → slug → **the archive doc
each record was actually built from** — and `build-map.mjs` reads it ahead of every matching rule.

This matters because the map's answer and the importer's answer legitimately differ: `preferBase()`
re-binds a family summary to its base page, and the `exclude_from_search` guard keeps a visible doc over
the hidden one `idmap` happens to name. Stamping `aonId` from the map alone asserted a provenance that
was not where the values came from. 22,457 records (85.8%) are built from an archive doc; the rest are
kept orphans and the hand-authored buckets.

**Two more importer bugs found this way.** `join.mjs:89` built `` `${raw.category}-${numericId}` `` when
the export already keys by the full id, producing `equipment-equipment-22819` — **1,860 records** whose
ids resolved against nothing, so they silently fell back to slug dedup. And forcing the map's doc lost
`Knockdown` and `envision` entirely: both have a visible doc AND a hidden `exclude_from_search` twin,
`idmap` names the hidden one, and `deriveFresh` drops excluded docs. The importer's own ranking comment
warns about exactly this (it is how Jalmeri Heavenseeker went missing before).

### Where the facets actually stand — measured on the records the importer builds

`facet-diff.mjs` now applies the SAME transforms as the importer (remaster renames + base-item union),
or it reports our own intended behaviour as disagreement — that alone accounted for over half of what
looked like a trait gap.

| facet | disagreements on records built from the archive | on kept orphans / carried buckets |
|---|---:|---:|
| level | **1** | 371 |
| rarity | **10** | 102 |
| price | **0** | 44 |
| bulk | **3** | 57 |
| traits | 236 | 376 |

The 236 trait rows are mostly post-import backfill work re-applying hand-authored values, plus one real
gap: `samsaran` ↔ `universal-ancestry` (24 records) needs a rename rule.

**The orphan/carried column is the next opportunity, not a defect**: those records never pass through
`overlayContent`, so they still hold Foundry values. 3,607 records — items 1,314, classFeatures 683,
actions 348, feats 212 — many of which `map.json` HAS found an archive doc for. Feeding the map's doc
into the orphan branch would lift coverage from 85.8% toward ~95%.

## PHASE B — STARTED. Spells first. **All 2,819 tests still pass.**

`spellFacets()` in `scripts/lib/aon-facets.mjs` now supplies `rank`, `traditions`, `spellLists` and
`cast` from the Archives. Changes vs the Foundry baseline: rank 1, traditions 7, spellLists 0, cast 14.

Three findings that make these exact rather than approximate:

- **The 115 "cantrip rank disagreements" are explained.** `spell_type === 'Cantrip'` selects all 115
  with zero false positives — not the cantrip trait, and not `level`. HH's rank-0 convention
  reconstructs perfectly. It also **fixes a real bug**: `glowing-trail` had rank 0 with no cantrip
  trait; the Archives say rank 1, and they are right.
- **`data.tradition` carries a fifth value, `Elemental`,** which is exactly HH's `spellLists`. Splitting
  on the four-tradition allowlist rebuilds both fields — `detect-magic` came out identical without
  being told to.
- **Read `data.actions`, never the top-level `action_cost`.** The latter is a BUCKETED search facet: it
  coarsens "10 minutes" to "1 minute+" and collapses every range to one value. This also reconciles
  `statuette`, whose cast is `{type:'duration', text:'1 hour'}`.

Deliberately NOT adopted yet — the spec found a real trap in each: `range`, `duration`, `targets`
(prose), `save` (`data.saving_throw` is the bare word; `daze` needs `basic:true` which is only in the
body text), and `heightening` (`establish-ward` has only `heighten: ['+2']`, the substance is prose).

## `source.license` — THE ONE ACKNOWLEDGED EXCEPTION (user decision, 2026-08-11)

**17,081 records carry `source.license` (ORC 11,835 / OGL 5,246) and the Archives have NO licence data
at all.** Verified twice: 0 of 43,686 docs contain "OGL", "ORC" or "Open Game License" anywhere in their
JSON. It is not derivable from the source doc's edition (ORC×legacy-era 243, OGL×remaster-era 95) nor
from the book (37 of 221 books carry mixed licences).

Asked under HARD RULE 2, **the user chose to keep the existing values as-is.** It is publishing
metadata rather than game data, and it is the single field the Archives cannot answer. Do not attempt
to re-derive it, and do not treat its survival as a violation of rule 1 — it is a recorded exception.

## `source.book` — HIGH RISK, do not adopt raw. The proposed transform was REFUTED.

`source.book` is **not a label, it is the primary key of the source filter.** `CORE_BOOKS`
(`src/rules/sources.ts:9`) hard-codes the four Foundry-style names; `enabledBookSet(undefined)` returns
them for every character that has never touched the Sources card; `applySources`
(`src/rules/build.ts:1583`) keeps a record only if `enabled.has(book)`. AoN says "Player Core", HH says
"Pathfinder Player Core" — **adopting raw AoN names empties the builder for every default character**
and moves 9,295 records to the hidden "Other" shelf (today: 280). Saved characters persist these
strings and `src/data/persist.ts` has no migration.

The Archives DO carry a usable book identity, by ID and not by name: every one of the 43,686 docs has a
`/Sources.aspx?ID=N` link in `data.source_markdown` that joins to the 245-doc `source` category, which
supplies `primary_source_category` and `primary_source_group` — a direct replacement for the regex
ladder in `categoryOfBook` and the hand-maintained `AP_VOLUME_MAP` (`sources.ts:108-132`).

But the adversarial check REFUTED the transform on two counts, both of which must be fixed first:
- **`book` / `data.source[0]` is NOT the primary source.** Array order carries no meaning — AoN stores
  the same weapon twice with the same two sources in opposite order (`weapon-192` vs `weapon-522`,
  Flintlock Pistol). 834 docs are multi-source. Needs an explicit HH-owned precedence, with ties
  reported rather than silently picked.
- **Resolve EVERY `Sources.aspx` link, not the first.** `equipment-4348` links ID=324 and ID=326, and
  326 is the right book. Key the canonical table on the source ID: two source docs share the name
  "Pathfinder Beginner Box: Game Master's Guide".

## PHASE B — `actionCost` DONE. **All 2,819 tests pass.**

`actionCostOf()` in `aon-facets.mjs` supplies `actionCost` for feats / classFeatures / actions.
Changed vs baseline: feats 37, actions 5, **classFeatures 0**.

**The discovery that made this possible: `<actions string="" />` — an EMPTY glyph in the page `<title>`
is how the Archives say PASSIVE.** Nobody in this project had used it. On feat.json the correspondence
is total: 8,460/8,460 docs carry the tag, 5,498 empty and 2,962 non-empty, and those 2,962 are exactly
the docs that have a `data.actions` facet. `undefined` (no tag at all) still means "unknown — keep HH's
value"; the two must never be conflated.

**Do NOT use the flattened top-level `rec.action_cost`.** It is a BUCKETED search facet: it coarsens
"10 minutes" to "1 minute+" and collapses every range to a single value. The old `parseActionCost()`
read it, which turned all 374 time-based casts into `{type:'passive'}`. 16 feats gain a proper
`{type:'variable'}` from this change — `Act Together` and `Elemental Blast` are genuinely variable-cost.

Two guards, both load-bearing:
- **A class feature with `grantsActions` is forced passive.** Following the granted action's cost would
  make the feature look like an activity. All 26 such records are passive today and a test asserts it —
  with the guard, classFeatures changed by exactly 0.
- **A `Stance` feat with an empty glyph is an Archives HOLE, not a passive feat.** Proven by the
  Archives themselves: of 126 Stance-trait feat docs, 125 carry a glyph (123 "Single Action") and
  exactly one is empty — `feat-3575` Powder Punch Stance. One outlier against 125 siblings is a missing
  value. HH's existing value is kept and the record reported.

### How a feat that GRANTS an activity is resolved — five rules, all Archives-sourced

The user checked these by hand in their Archives app, and they pin the whole design:

| feat | what the page shows | resolves to | why |
|---|---|---|---|
| Glass Skin | inline `<actions string="Reaction">` | **reaction** | grants Shatter Glass, described inline — no page of its own, so the feat is the only place to keep it |
| Moldersoul | inline `<actions string="Two Actions">` | **2 actions** | grants Decompose, described inline |
| Ka Stone Ritual | `**Activate** <actions string="Two Actions">` | **2 actions** | the same shape, with a label |
| Brightness Seeker | `<document id="action-320">` | **passive** + link | grants a reaction that HAS its own page |
| Reach Beyond | prose: *"You can spend an action, which has the concentrate trait"* | **1 action** | the Archives state it, just untagged |
| Powder Punch Stance | nothing at all | **passive** | the user confirmed it takes no action |

Resolution counts: inline glyph 155 · prose 8 · passive-plus-link 23 · nothing anywhere 11.

**Powder Punch Stance killed an earlier guess of mine.** I had reasoned that because 125 of 126
Stance-trait feats carry a glyph, the one that does not must be an Archives hole. The user checked the
page: it genuinely takes no action. **A corpus majority is not evidence about a specific record** — that
guard is gone, and the reasoning behind it should not be reintroduced.

**The 170-feat blowup came from the EMBED path, not the inline one.** Summoner Dedication has no inline
tag at all; its bogus 3 actions came from following the Manifest Eidolon embed. So reading any inline
glyph is safe, and embeds instead yield `passive` + a `grantsActions` link.

### A feat can be PASSIVE and still grant something that costs actions

The user caught this: demoting a feat to passive threw away the granted activity's cost, and *"we still
need to know it's a reaction for the filtering"*. The Archives record it two ways, and the two need
DIFFERENT homes:

- **The activity has no page of its own** → the cost is on the feat, in a labelled
  `**Activate** <actions string="Two Actions" />` line. `Ka Stone Ritual` is the user's example. This
  goes to the feat's own `actionCost`, because there is nowhere else for it. 11 feats.
- **The activity HAS its own page** → `<document level="2" id="action-320" />`. Heroes Heaven already
  holds that record with the right cost (`call-upon-the-brightness` is a reaction, `manifest-eidolon`
  is three actions); what was missing is the LINK. This fills `grantsActions` and **never touches the
  feat's cost**. 21 links added.

**The over-reach that produced this design, recorded so it is not repeated.** Taking the first
`<actions>` tag *anywhere* in the body moved **170 feats**, because an embedded sub-activity's glyph is
not the feat's cost — `Summoner Dedication` became a 3-action feat by picking up Manifest Eidolon's
glyph. Only the `**Activate**` LABEL is unambiguous. Every one of the 170 was wrong in the same
direction (passive → a cost), which is exactly what a too-greedy match looks like.

`grantsActions` is filtered at the very end of the importer, once the actions bucket exists: the target
must be a record that IS an action. Three Archives embeds point at pages HH models as passive
(`call-companion`, `influence-rumor`, `call-follower`) and `test/granted-actions.test.ts` asserts the
invariant.

### 17 feats need the user's eye — `out/NEED-LOOKUP-actions.md`

The Archives show no action icon on these; the old Foundry data gave them a cost. **One is already
proven to be a Foundry ERROR rather than an Archives gap**: `Brightness Seeker` (feat-984) is a passive
feat that GRANTS a reaction via `<document level="2" id="action-320" />`, and Foundry had copied the
granted reaction's cost onto the feat itself. The Archives are right and the app is now more correct.
The other 17 may be the same pattern; the user is checking.

Also worth mining later: that `<document level="2" id="action-N" />` embed IS the grantsActions
relationship. 17 of 27 already agree with HH's list and it supplies 10 HH is missing
(`arcane-cascade` → `action-756`).

## PHASE B — `prerequisites` DONE. **All 2,819 tests pass.**

`prerequisitesFrom()` reads `data.prerequisite` — semicolon-delimited, already free of AoN's link
markup. 5,799 unchanged, 491 changed, 22 filled that were empty, **0 emptied**.

This is NOT display text: `checkPrerequisites()` (`src/rules/build.ts:5445`) parses every clause, so
wording gates feat selection. Each rule below exists because skipping it turns a gate OFF silently:

- **Ability SCORE → modifier, globally.** AoN writes "Intelligence 14", HH writes "Intelligence +2",
  and the engine compares against `abilityMod()`. Global, not anchored — `spellmaster-dedication` is
  "Intelligence 14, Wisdom 14, or Charisma 14" and an anchored rule converts only the first.
- **Collapse a repeated rank word** — "Trained in Deception or Trained in Diplomacy" → "trained in
  Deception or Diplomacy", because the engine's OR-split only understands the second form (57 clauses).
- **Lowercase a leading rank word ONLY before `in`/`with`/`at`.** "Expert Longevity" and
  "Master Summoner" are FEAT NAMES (26 clauses); lowercasing them makes the rank pattern swallow them.
- Strip AoN's `[Class]` prefix, markdown italics, curly quotes, trailing periods.

**A bug I shipped into the first run and caught in the diff.** The rank-collapse rule fired on any
clause containing "or expert in", so `Student of Perfection Dedication` went from
"powerful fist or **expert in** unarmed attacks" to "powerful fist or unarmed attacks" — deleting a
real proficiency requirement. It now only fires when the clause ITSELF starts with that same rank word,
which is the only case where the repeat is redundant.

Quality check: single-name prerequisites that name nothing in the database fell from **565 to 521**, so
the Archives resolve more of them than Foundry did. The remainder are non-feat conditions
("redeemer cause", "harmful font", "member of the Pathfinder Society").

### Two feats can share a NAME — the archetype separates them

There are two "Stone Blood" feats, both level 6: `feat-890` (Living Monolith, prereq Ka Stone Ritual)
and `feat-4380` (Stonebound, prereq Stonebound Dedication). They slugify identically, so HH's Living
Monolith feat was getting the Stonebound one's prerequisites — the same shape as the `Death from Above`
bug. `pickByArchetype()` now matches HH's `archetype` against the Archives' `data.archetype`, and it
outranks every other selection rule. Of 2,247 archetype feats, 8 remain mismatched, and those are
HH's own cross-archetype `shared-archetype-feats` bucket plus a few remaster renames.

This needed `allByBucket` — every candidate per slug, not just the edition-rank winner.

## PHASE B — combat statistics DONE. **All 2,819 tests pass.**

`damage`, `range`, `reload`, `acBonus`, `dexCap`, `checkPenalty`, `speedPenalty`, `strength` now come
from the Archives. The result is almost entirely CONFIRMATION rather than change — damage 0 changed of
7,572, every armour field 0 changed, range 1, reload 2, strength 2 filled. That is the ideal outcome:
the provenance rule is satisfied and nothing moved.

Three traps handled:
- **Never read `data.damage_type`.** It is alphabetical and mixes the versatile options with the real
  type — `kusarigama` is "1d8 S" with `["Bludgeoning","Slashing"]`, so `[0]` makes it bludgeoning. The
  type is the abbreviation inside `data.damage`.
- **A melee weapon's thrown range is only in `trait_raw`.** Spear has `data.range` null and
  "Thrown 20 ft."; 0 of 49 melee+thrown docs carry `data.range`. And a `range` written WITHOUT the
  thrown trait breaks strike math — `derive.ts:2616` treats any range as ranged and `derive.ts:1962`
  then refuses finesse/agile.
- **Combination weapons are two docs on one URL** and the export lists the wrong one first:
  `/Weapons.aspx?ID=218` is both `weapon-218` (Gun Sword ranged) and `weapon-218--melee`.

### DO NOT follow `base_item` for combat statistics

This was tried and reverted, after diffing the 21 weapons it changed. It is wrong three ways:

- **It destroys a magic weapon's damage type, which is the point of the item.** Brilliant Rapier
  fire → piercing, Mindlance mental → piercing, Thundercrasher sonic → piercing, Spark Dancer
  fire → piercing, Dezullon Fountain acid → piercing.
- **Some items name several bases and there is no single answer.** Gearblade lists Bastard Sword,
  Greatsword, Longsword, Shortsword AND Greatclub; taking the first gave it a shortsword's d8.
- **Heroes Heaven folds striking runes into `damage.dice`** — Ankylostar is 3d6 where the base
  morningstar is 1d6 — so the base's dice are not comparable in the first place.

Base weapons and armour carry their own stats in `weapon.json` / `armor.json`, which is where these
values matter and where they already agreed. Magic-item numbers need the override sentence in the
item's own prose (`/instead of dealing (\w+) damage/`) and are left alone until then.

The base-item hop is still correct and still used for the TRAIT union — that one is verified by tests.

## WHERE PHASE B STANDS

**68.6% of all field-values now come from the Archives, up from ~23% this morning.** Remaining Foundry
carriers, largest first: `source` 19,290 · `itemType` 7,572 · `category` 7,565 · `usage` 4,969 ·
`activationCost` 3,256 · `archetype` 2,247 · `frequency` 2,194 · `counters` 1,909 · `consumableType`
1,714 · `uses` 1,714.

`source` is specced but HIGH RISK (see above — it is the source-filter key, not a label) and
`source.license` is the recorded exception. `usage` needs a prose→slug mapping: HH's 118 values are
Foundry slugs, the Archives have prose.

## PHASE B COMPLETE — **84.6% of every value now comes from the Archives** (was ~23%)

**All 2,819 tests pass.** `npm run data` is now the whole pipeline and all four steps are mandatory:

```
node scripts/import-core-v2.mjs        # facets from the Archives
node scripts/import-siege-and-gaps.mjs # or 57 siege weapons vanish
node scripts/split-descriptions.mjs    # or core.json is 22.6 MB instead of 9.5 MB
node scripts/migration/stamp-aonid.mjs --write   # or the provenance is lost on every regen
```

| field | records | outcome |
|---|---:|---|
| `source.book` | 19,290 | 24,601 same, 582 changed, 161 gained, **0 lost** |
| `usage` | 4,969 | 7,215 same, 234 filled, 123 changed |
| `activationCost` | 3,256 | 7,465 same, 48 filled, 59 changed |
| `archetype` | 2,247 | 6,067 same, 230 filled, 15 changed |
| `hands` / `category` | 1,249 | 152 filled, **0 changed** — category matched 100% |
| combat stats | 1,433 | damage **0 changed of 7,572**, every armour field 0 changed |
| `prerequisites` | 6,073 | 5,799 same, 491 changed, 22 filled, 0 emptied |

Two lookup tables were LEARNED ONCE and are now HH-owned, generated by
`scripts/migration/gen-book-names.mjs` and `gen-usage-slugs.mjs`:

- **`scripts/data/book-names.json`** — Archives book name → HH's canonical display string. This is what
  removed the last Foundry read from the importer: `mapBook()` used to derive the string by reading
  `core.foundry-backup.json`. The Archives give the book IDENTITY (a `/Sources.aspx?ID=N` link on every
  one of the 43,686 docs) but only a SHORT name — their doc for "Pathfinder Player Core" is called
  "Player Core". The prefix is HH's own convention, so HH owns it. **`source.book` is the primary key
  of the source filter** (`CORE_BOOKS`, `src/rules/sources.ts:9`); adopting the short names raw would
  empty the builder for every default character.
- **`scripts/data/usage-slugs.json`** — Archives usage prose → HH's usage slug. A mechanical slugify
  reaches only 79.8%: HH writes "worn cloak" as `worncloak` with no separator, drops the article in
  "affixed to a weapon", and calls "tattoo" `tattooed-on-the-body`. 178 strings, 9 genuinely ambiguous.

### A MULTI-SOURCE record must pick its book by SHELF, not by array order

`source.book` is the key the source filter runs on, so the wrong string removes a record from the
builder for anyone using the default Core-only setup. `rec.book` is just `data.source[0]`, and **array
order carries no meaning** — `weapon-365` Spear lists `["Tian Xia Character Guide", "Player Core"]`
because it is printed in both, so reading the first entry filed a basic Player Core weapon under a
setting book and took the spear out of every default character's equipment list.

The Archives rank the books themselves: each source doc carries `primary_source_category`
(Rulebooks / Lost Omens / Adventures / Adventure Paths / Society / Comics / Blog Posts / April Fools).
`bestBook()` takes the highest shelf and keeps printed order on a tie. Core-book departures fell from
**64 to 43**, and the 43 that remain are corrections — the Archives list `Tiger Fork` ONLY in Tian Xia
and `Traveler's Chair` in Guns & Gears / Grand Bazaar; neither was ever Player Core.

`shelfOf` and `SHELF_RANK` must be declared BEFORE the export load loop that calls `indexShelf()` —
a `const` read from a hoisted function throws. That is the third time this trap has fired in this file.

### Judgement calls made while doing this

- **`group` is FILL-ONLY.** The Archives put crossbows in the `bow` group, correct for the remaster,
  but HH's weapon-familiarity feats still name `crossbow` and `test/weapon-familiarity-mirror.test.ts`
  asserts the two agree. Moving the weapons alone breaks a real invariant; it is 5 weapons and gains
  nothing. A paired change for later.
- **A multi-archetype feat keeps its existing archetype** when the Archives list it among several. The
  level-20 mask feats are `["Druid","Wizard"]` and HH's field holds one, so taking `[0]` is churn.
  A single-valued list IS authoritative and does correct HH — `Reminder of the Greater Fear` was
  `gray-gardener`, the Archives say Vigilante, and its own traits confirm that.
- **`Draw the Lightning` and the elemental spells moved Rage of Elements → Secrets of Magic.** Checked:
  there is one doc each, legacy-era, not superseded. Foundry had the wrong book; the Archives correct it.

### `frequency` — from the printed stat line

`frequencyOf()` reads the `**Frequency**` line: 7,447 unchanged, 80 filled, 45 changed, 0 lost.
HH's item shape is `{max, per}` with `per` from a CLOSED set (`types.ts:1971` + `:1183`) and no `every`
field, so "once per 10 minutes" collapses to `minute` — which is what the app already shipped for those
35 records. A unit outside the set is not emitted rather than guessed.

### The pipeline is DETERMINISTIC

`npm run data` run three times produced byte-identical `core.json`
(`da397336ff71c64ca55e4085b16db9a189b7aebb5bd63fde80c348a8655e06af`). Worth re-checking after any
change to the extractions.

## THE USER'S CORRECTION — "extract it" is the answer, not "it is absent"

> *"the source of all data in the app needs to come from the archives. if we need to EXTRACT data from
> the archives to use it correctly that's ok"*

An earlier version of this document listed `itemType`, `frequency`, `uses`, `counters`,
`consumableType` and the spell `save`/`duration`/`targets` as "cannot come from the Archives". **That
framing was wrong.** The Archives state these on the page — in the stat block, the body prose, the item
category, the page structure — just not as a tidy field. "No structured field" is not "not in the
Archives", and the standing guarantee applies: *the archives don't lack anything; the real problem is
understanding the data correctly.*

`frequency` proved it: 2,194 records that had been written off, recovered from the `**Frequency**`
stat line at 94% first pass.

### `heldSpells` — extracted from the page body

`heldSpellsOf()` reads the spell list a staff/wand/prayer-beads holds:
`<ul><li>**Cantrip** [_ignition_](/Spells.aspx?ID=1565)</li>…</ul>`. 699 of 723 reproduce exactly.

Three things it has to get right:

- **One page holds every variant, and they share the same markdown.** `equipment-3041`, `-3041-2916`
  and `-3041-2917` are Staff of Fire / Greater / Major with byte-identical `data.markdown`. The variant
  is the `<title level="2">` section it sits under.
- **Staves are CUMULATIVE** — Greater holds its own spells plus every lower one, which is why
  `staff-of-fire-major` runs ranks 0 to 5. A variant takes the union of its section and all above it.
- **The spell links point at the LEGACY printing.** Staff of Sieges links `/Spells.aspx?ID=280`, which
  is `spell-280` "Shield", superseded by the remaster `spell-1671`. Superseded docs are pruned before
  `idMap` is written, so a bare lookup returned nothing and the staff lost 8 of its 10 ranks. The
  resolver follows `superseded_by` first.

**It refuses to SHRINK a list.** On 14 multi-variant staves the extraction comes back 1–3 spells short
— `Beast Staff (Major)` loses its whole 5th-rank row — and I have not pinned down which section slice
is wrong. Those keep their existing list and are reported. Same principle as the untagged action costs:
an extraction that is mostly right and lossy in a way nobody notices is worse than one that declines.

## A CORRECTION TO THIS DOCUMENT'S OWN NUMBERS

The "% sourced from the Archives" figures above are **optimistic**, and an audit caught it. They count a
field as Archives-sourced when the importer HAS A ROUTE for it — but `aonFacets()` omits the key
whenever the Archives say nothing for that particular record, and `...old` then supplies the Foundry
value silently.

Measured by WHICH PIPELINE STEP ACTUALLY WROTE EACH VALUE, over `core.json` + `core-descriptions.json`
(301,378 field-values): **194,449 (64.5%) from the Archives, 10,447 (3.5%) hand-authored HH, 96,482
(32.0%) still delivered by the `...old` spread.** On `core.json` alone it is **26.0% Foundry**, not the
12.9% a route-based count gives.

Both numbers are meaningful — "we have a route" is real progress — but the honest headline is the
per-value one. Report that.

### A WAND IS NOT A CONSUMABLE — a real bug the Archives caught

Measured: of 438 archive docs with `item_category: "Wands"`, **ZERO** carry the `Consumable` trait and
all 438 carry `Wand`. The Archives state the rule outright — trait-564 Consumable: *"can be used only
once … destroyed after activation"*; trait-731 Wand: *"contains a single spell which you can cast once
per day"*.

Heroes Heaven disagreed with itself: 119 wands were typed `consumable` and 253 were not. The 119 had a
destructive symptom — `ItemDetail.tsx` gates the "Use one" button on `itemType === 'consumable'`, which
calls `useConsumable` and REMOVES the item, so casting from those wands destroyed them. All 119 are now
`equipment`; `itemUses.ts:85` already documented the correct model.

46 were fixed through `overlayContent`; the other **73 needed a post-pass in the importer** because they
are KEPT ORPHANS — `Arboreal Wand (Rank 2)` and its siblings are HH's own per-rank variants with no AoN
slug, so the overlay never runs for them. Any future correction of this shape needs the same treatment.

**The rest of the itemType classifier was NOT adopted**, and the reason is worth keeping: `itemType` is
a union TAG meaning *"which stat block this record carries"*, not *"which shelf the AoN page sits on"*.
An adversarial check found that every record the proposed classifier re-typed lacked the stats the new
type requires — 135 weapons with no `damage`, 55 shields with no `acBonus` — which crashes
`ItemDetail.tsx:63` on `item.damage.dice`. Extract the missing stats FIRST, then re-type.

### Spell saves, deities and backgrounds — all structured in the Archives

**`save` (680)** — read `data.saving_throw_markdown`, never `data.saving_throw`: the plain twin
flattens "[basic](/Rules.aspx?ID=329) Reflex" to "basic  Reflex" and loses the LINK, which is the
machine-readable marker. Result: **0 wrong save types**, 108 filled, 0 lost. The three known traps all
resolve on the page — `daze` states "basic Will save" in the body and carries no `**Critical Success**`
block (AoN's structural way of saying the outcomes are the basic ones), `quench` carries the linked
marker in prose, `heat-metal` prints all four degree lines so it is NOT basic.

**Deities (1,921 values)** — `data.domain_primary`, `divine_font`, `favored_weapon`, `skill` are clean
structured arrays. Use `domain_primary`, NOT `domain`: the plain field merges the ALTERNATE domains in,
and Abadar's `duty` is an alternate. But never SHRINK — Lissala is the one deity the Archives record
with 3 primaries plus an alternate where HH and the Splinter Faith rule both want four.

**Backgrounds (1,254 values)** — `data.skill` gives the trained skill and the Lore subject,
`feat_markdown` gives the granted feat by LINK. Four guards, each from a test:
- not when the background offers a skill CHOICE (`trainedSkillChoice`) — writing a single skill over it
  leaves the picked skill untrained;
- `grantedFeatId` is FILL-ONLY — `test/identity-data.test.ts` is titled *"the mirror is not always
  right"* and asserts Alma's Clerk grants Glean Contents whatever the source says;
- never glue an EITHER/OR lore into one subject — `legal-lore-or-underworld` once shipped and seven
  characters were trained in a skill that does not exist;
- keep HH's `abilityBoosts` ordering when the option SET matches, or 240 records churn for nothing.

The 10 lore changes are all the Archives fixing HH's spelling: `gladatorial` → `gladiatorial`,
`gladitorial` → `gladiatorial`, `geneaology` → `genealogy`, `pathfinder` → `pathfinder-society`.

## THE COMPLETE "ARCHIVES CANNOT ANSWER" LIST — `out/ARCHIVES-CANNOT-ANSWER.md`

Nine agents searched every remaining field, each required to show its searches before claiming absence.
The full report with those searches is in that file. It is **very short**, and most of what earlier
passes called "absent" turned out to be a page we were not reading, a link we were not following, or a
record joined to the wrong document.

Genuinely absent, in total:

| what | n | note |
|---|---:|---|
| deity records with no archive page | 3 | Alocer and two others; searched by name and by full-JSON scan over all 43,686 docs |
| background: Belkzen Anthropologist's granted feat | 1 | the page's last sentence names the skills and no feat; `data.feat` is null |
| spell `duration` | 3 | `rite-of-the-red-star` and two others print no Duration row at all |
| ~~class DC for Magus and Summoner~~ | ~~2~~ | **NOT A GAP — see below** |
| Awakened Animal's land Speed | 1 | `ancestry-72` prints an EMPTY Speed row — but see below, HH's own value is wrong |
| follower type stat blocks | 5 | Battlecry! pg. 77–79 — Berserker/Medic/Scout/Sharpshooter/Shieldbearer |
| `apexAttribute` on 6 mythic artifacts | 6 | **and these are MIS-JOINED** — `equipment-3754 "Soulcutter (Artifact)"` exists as its own doc |

### The Magus/Summoner "class DC gap" is NOT a gap — the user caught this

An agent reported it as absent and I repeated that without checking. Verified directly: there is
exactly ONE Magus doc (`class-17`) and ONE Summoner doc (`class-18`), both Secrets of Magic, and
neither has a remaster twin. Neither prints a Class DC line. But that is what the BOOK does —
where Fighter's Initial Proficiencies read

> **Class DC** Trained in fighter class DC

the Magus's read

> **Spells** Trained in arcane spell attacks / Trained in arcane spell DCs

because those two classes key off spell DC. **The Archives reproduce the book exactly.** Heroes Heaven's
`classDc: "trained"` on all 27 classes does not come from a class page at all — it comes from the
universal rule that every character is trained in their class DC at level 1. Derivable, not absent.

The general lesson, and the reason to re-check every "absent" claim: **"the page does not print it" is
not "the Archives lack it"** when the value follows from a rule the Archives also carry.

### Awakened Animal's Speed — re-checked on the same grounds, and it is HH that is wrong

`ancestry-72` prints an empty `<title level="3">Speed</title>` with nothing under it, and no "N feet"
appears anywhere on the page. That looked like an Archives hole. But Heroes Heaven stores
`speeds: { land: 5 }` — and **5 feet is not a valid Pathfinder base speed**. The page is blank because
this ancestry defers its speed to the animal type the player picks; the Archives are right and the
existing value is a Foundry artefact. Do not "fill" this from the Archives, and do not trust the 5.

### THE FOUR UNRESOLVED RECORDS, CHECKED AGAINST LIVE AoN — and the user's decision

The four were queried against the live Archives of Nethys once, read-only. **THE LOCAL ARCHIVES ARE THE
SOURCE OF TRUTH FOR THIS PROJECT** — the user's words: *"my archives is up to date in a manner that is
satisfying to me. use the data he has, not the foundry one."* Do not re-fetch from live AoN or propose
a re-scrape.

`Alocer` came back as `deity-732` on live AoN, from exactly the book HH cites (One-Shot #2: Dinner at
Lionlodge). Our snapshot holds 717 deities up to `deity-731`; live has 718, so it is the one document
added afterwards. **The user then decided that book not being included is fine**, so Alocer stays on the
DROP list. Do not re-add it without asking.

**An orphan-overlay experiment was tried here and REVERTED.** To make Alocer's facets flow, kept
orphans were given Archives facets whenever the map named a doc. It moved 1,897 records from Foundry to
Archives sourcing — but broke four tests, because an orphan is usually an orphan ON PURPOSE: a curated
near-duplicate, an `aon-` scrape twin, a deliberate rename the app hides or reshapes.
`test/aon-dedupe.test.ts`, `test/grade-spelling-duplicates.test.ts` and `test/granted-actions.test.ts`
all encode that curation. The idea is sound and the prize is real; a future attempt must respect those
tests rather than bulldoze them.

The other three, checked against live AoN and not there either:

- **The Curtain Call** — the live index has ZERO deity documents from the Curtain Call Player's Guide.
  A "Curtain Call Cloak" item and the source entry exist; no deity.
- **Atheists and Free Agents** — nothing on the live index under that name. HH's record has an EMPTY
  domain list, which fits a Divine Mysteries sidebar rather than a deity.
- **Belkzen Anthropologist's granted feat** — the live page is 705 characters, complete, and the word
  "feat" never appears. It states the attribute boosts and the two trained skills and stops. HH's
  `multilingual` has no source on AoN at all.

**Corrections the audit forced on this document:**

- **`Norns` is NOT absent.** The Archives file it under its TITLE — `deity-322 "Followers of Fate"`.
  Confirmed on the facets rather than the name: domains Family/Fate/Knowledge/Truth, font Harm+Heal,
  weapon Shears, skill Occultism, all matching. It had been a full-text guess against
  `creature-family-448`, the Norn *creature* family. Now pinned in `build-map.mjs`.
- **heritage→ancestry is recoverable** — see the struck-through line below.
- **127 item records have a PAIRING gap, not a data gap**: 69 of them sit on a page that exists under a
  sibling name because HH expanded one AoN page into per-energy or per-creature records.
- **The printed name is edition-stale; the URL is the arbiter.** A deity page printed in a legacy book
  links the legacy weapon/domain page, and following `superseded_by` / `remaster_id` is what makes the
  domain renames exact (Delirium→Disorientation, Void→Nothingness, Wyrmkin→Dragon).
- Every natural-attack flavour name on a deity page — claw, claws, jaw, jaws, fang, nails, tail — links
  to the Fist page. The word is flavour; the link gives the resolvable weapon.

## WHAT REMAINS — and it is EXTRACTION WORK, not absence

| field | records | why |
|---|---:|---|
| `itemType` | 7,572 | `treasure` (218) and `container` (52) have no AoN expression at all, and AoN scatters HH's containers across six different `item_category` values |
| `frequency` `counters` `uses` `limitedUses` `heldSpells` `note` | ~8,700 | Heroes Heaven engine constructs; the Archives state these in prose only |
| `consumableType` | 1,714 | same |
| spell `duration` `targets` `save` | 3,180 | derivable but TRAPPY, and the spec found the traps: `data.saving_throw` on `daze` is the bare word "Will" while HH needs `basic: true`, which appears only in body prose; `quench` and `heat-metal` have no Saving Throw row at all yet do have one; `establish-ward`'s heightening is a sentence, not a field |
| `source.license` | 17,081 | **the recorded exception** — 0 of 43,686 docs mention OGL/ORC anywhere; the user chose to keep it |

`core.foundry-backup.json` therefore still cannot be deleted: `...old` at `import-core-v2.mjs:311` is
what supplies those fields. The file is backed up outside the repo either way.

## NEXT

The backup CANNOT be deleted yet: 41.2% of values still come from `...old`. The remaining carriers, in
size order, with the `.data` field that answers each:

| HH field | records | from `rec.data` | coverage |
|---|---:|---|---:|
| `source` | 19,288 | `book` (top level) + `mapBook()` must stop rewriting to the Foundry string | 100% |
| `actionCost` | 7,924 | `actions` | 100% on spells, 35% feats, 29% equipment |
| `itemType` / `category` | 7,565 | `item_category` / `item_subcategory` | high |
| `prerequisites` | 6,073 | `prerequisite` | 62% of feats |
| `usage` | 4,969 | `usage` | 84% of equipment |
| `activationCost` | 3,256 | `activate` / `actions` | — |
| spell `rank`/`traditions`/`cast`/`range`/`duration` | ~8,700 | `tradition`, `heighten`, `range`, `duration`, `target`, `component`, `saving_throw`, `area` | 36–69% |

Also still to do: `mapBook()` (`:142-148`, `:252`) rewrites a fresh record's `source.book` to the
canonical **Foundry** string on 1,699 of 2,043 fresh records, and `:232-233` decides a fresh feat's
`category` by testing traits against the Foundry key sets. Both are Foundry leaks into records we
otherwise call AoN-built.

~~Known genuine gaps~~ — **CORRECTED. The heritage→ancestry claim below was WRONG.** It is not a field
anywhere, which is true, but it IS fully recoverable from the Archives, and an audit proved it. Do not
cite this line as a reason to stop. (Original text kept for the record: heritage→ancestry linkage — the
Archives' own app derives it by name-substring at `Archives of GuyB/app/src-tauri/src/db.rs:2046`),
115 items where no Bulk is printed, 63 items with no price anywhere, shield `brokenThreshold`, and the
19 `services`/`followers`/`pets` records that have no AoN category at all.

## THE ORIGINAL SHAPE OF STAGE 2d (superseded by Phase A above) — read this before touching `core.foundry-backup.json`

Deleting the backup file is NOT the job. The job is removing Foundry-*originated values*, and there
are far more of them than the file's existence suggests.

`scripts/import-core-v2.mjs:122` — `overlayContent(rec)` **returns only `{ name: rec.name }`**. For
every record whose AoN slug matches an existing Foundry slug (~21,737 of 25,344), the importer keeps
the Foundry `level`, `rarity`, `traits`, `price`, `bulk` and all mechanics, and adopts nothing from the
Archives but the name. The importer's own comment at `:123-129` says why: the facets measured "99%+
identical", and the ~1% that differ are ambiguous — it cites `Uplifting Winds` at Foundry 12 vs AoN 16,
with HH's tests asserting 12 and no arbiter available.

**But there IS an arbiter now: the user.** Their instruction covers exactly this case — *"if you reach
something you have a problem with DON'T USE THE FOUNDRY DATA, instead we will find it together in the
archives."* So the shape of the work is:

1. Measure the Foundry-vs-Archive disagreement per facet, joining **by `docId` from `map.json`**, never
   by name.
2. Where they agree — adopt the Archive value. No behaviour change, and the provenance rule is met.
3. Where they disagree — that list, and only that list, goes to the user.

Two other things make this riskier than it looks and must be settled first:

- **`core.json` is not solely the importer's output.** Roughly 100 `apply-*.mjs` / `backfill-*.mjs` /
  `fix-*.mjs` scripts in `scripts/` mutate it afterwards. `import-core-v2.mjs:55-60` already warns that
  a full regen loses 57 siege weapons unless `import-siege-and-gaps.mjs` is re-run. **Establish the
  complete post-import recipe before regenerating anything**, or hand-authored work disappears.
- Nothing in `src/` references Foundry (verified by grep) — only `import-core-v2.mjs`,
  `import-siege-and-gaps.mjs`, `migrate-diff.mjs` and three JSON files under `scripts/audit/`. So the
  runtime is already clean; the contamination is entirely in the build pipeline and the data values.
4. **Delete `core.foundry-backup.json`** and prove nothing regressed — this is the point of the whole
   exercise, so gate it on the test suite plus a field-level diff.
5. **Re-run `inventory.mjs`** — its field-gap table finally means something on a closed join.

---

## Stage 1 (complete) — how every record was accounted for

| outcome | records | what it means |
|---|---:|---|
| matched to its own archive doc | 23,602 | nothing to do |
| hand-authored HH constructs | 779 | modes/runes/stances — user-confirmed, keep |
| inside a parent page (sub-block) | 652 | needs section extraction at build time |
| resolved by book-scoped matching | 92 | typos, `(…)` suffixes, bracket-only names |
| table/variant expansions | 19 | needs table extraction at build time |
| **drop — Foundry-only adventure loot** | **117** | user decided; `out/drop-adventure-loot.json` |
| needs the scraper (2 un-scraped books) | 32 | Crypt of Runes, Into the Apocalypse Archive |
| remaining odds and ends | ~51 | small: 5 spells, 6 feats, 3 actions, 3 deities, 3 vehicles, 2 heritages |

**Nothing is missing from the archive** except the 32 records in two adventure volumes it never
scraped. Everything else is a shape difference we now understand.

**NEXT ACTIONS, in order:**
1. ~~Scrape ONLY the two missing books.~~ **DONE** — see "Targeted scrape" below.
2. Work the ~51 odds and ends the same way — group, one example each, ask.
3. Then stage 2 proper: build the extraction (sub-blocks + tables), stamp archive ids, and re-run
   `inventory.mjs` — its field-gap table finally becomes meaningful once the join is closed.

### Targeted scrape — DONE (`scripts/migration/scrape-missing.mjs`, output `out/scraped/`)

Two books only, never the full 43,686-doc scroll. Same public endpoint the user's own scraper uses
(`elasticsearch.aonprd.com`), `match_phrase` on `primary_source`, 150 ms between requests.

**#220 Crypt of Runes — 79 documents fetched.** equipment 15, creature 20, action 19, hazard 14,
feat 6, item-bonus 3, source 1, trait 1. All six Avenger feats are in it (`Avenger of Envy` =
`feat-9411`).

Of that book's 25 HH records: 16 fetched directly; **6 of the 9 "missing" are the sub-block pattern
again** — `Aegis of Envy` is an activity described INSIDE `Avenger of Envy`'s own text (verified), and
the same for Convocation of Greed / Gluttonous Feast / Host of Wrath / Summon Sloth / Sorshen's
Devotion. Only `Chromatic Robe (Greater)`, `Ten Day's Breath`, `Three Day's Breath` are still open, and
those look like the variant/table shape.

Incidentally the fetched `action` docs confirm PLAN.md's known defect: their names are trait lists
(`"(concentrate)"`, `"1 minute (concentrate)"`, `""`) — the 456 broken-name stubs. Expect them.

**#221 Into the Apocalypse Archive — 0 documents. NOT ON AoN AT ALL.** Verified four ways: the book
title, "Apocalypse Archive", "Pathfinder #221", and individual item names (`Apocalypse Seed`,
`Sorshen's Sinuous Guisarme`) all return zero hits from the live index. So its 7 records exist only in
Foundry. **Needs a user decision** — most likely the same "drop" as the other adventure loot.

NOTE: this fetches RAW documents only. The `ast` render tree comes from the Archives' own build
(`build.py`), so these docs must go through that build before Heroes Heaven can render them.

### Stage 1f — the last leftovers (`scripts/migration/leftovers.py`, writes `out/leftovers.json`)

A full substring scan of every doc's raw JSON (FTS indexes the body; this catches table cells and
unindexed fields). 68 leftovers once the two adventure books are set aside. They resolve as:

- **22 HH-SYNTHESISED names for a real archive feature.** `Kinetic Gate` (`class-feature-596`) and
  `Gate's Threshold` (`class-feature-606`) exist; HH expands them into `Air/Fire/Water/Wood Gate` and
  `Second/Third/Fourth Gate's Threshold`. Same for `Ligneous` (`instinct-16`) → `Ligneous Instinct`,
  the Deviant Classifications, the Phantom Eidolons, and `Alchemist Armor Expertise (Level 13)`.
  Nothing missing — HH names things the archive doesn't name separately.
- **18 dragon's breath potions** — the table expansion already documented above (one archive page +
  a Dragon Type table; HH makes one item per dragon × age).
- **3 more typos**, found only by DROPPING the book scope: `Lesson of Elements`→`Lesson of the
  Elements` (`lesson-2`), `Harsh Judgement`→`Harsh Judgment` (`feat-3330`), `Empathic Envoy`→
  `Empathetic Envoy` (`feat-4115`). HH and the archive sometimes file the same record under different
  books, so the book scope is a good FIRST pass but must not be the only one.
- **6 genuinely absent from AoN** (need a user decision, same shape as the dropped adventure loot):
  `Battle-Trained Human (BB)`, `Warden Human (BB)` (Beginner Box — the archive has 0 heritage docs
  from it), deities `The Curtain Call` and `Atheists and Free Agents`, vehicles `Magic Carpet` and
  `Sandsailer`.
- **The last ~19, resolved individually:**
  - `Premonition Reflexes` → `class-feature-972` **Premonition’s Reflexes** (a curly apostrophe)
  - `Curse of the Living Death` → inside mystery **Bones** (`mystery-3`/`mystery-14`) — the oracle-curse
    sub-block pattern again
  - `Knight Vigilant Dedication` → feat **Knight Vigilant** (`feat-…`); HH appends " Dedication" to
    archetype dedication feats — a naming rule worth adding
  - `Swirl Crimson Shroud` → feat **Crimson Shroud** (`feat-6521`, Prey for Death). The feat exists and
    the book matches, but its text does NOT contain "Swirl", so HH named the granted activity itself.
    Probable, not certain — worth the user's eye.

### FINAL: what is genuinely absent from the Archives — ~27 of 25,344 records (0.1%)

Verified by full substring scan of every doc's JSON; these names appear NOWHERE in the corpus.

| group | records | note |
|---|---:|---|
| Book #221 Into the Apocalypse Archive | 7 | AoN never published it — 0 hits on the live index |
| Beginner Box heritages | 2 | archive holds 0 heritage docs from the Beginner Box |
| deities `The Curtain Call`, `Atheists and Free Agents` | 2 | the latter is a category page, not a deity |
| vehicles `Magic Carpet`, `Sandsailer` | 2 | (`Flying Broom` IS there, as `Broom of Flying`) |
| spells | 5 | Anima Invocation (Modified), Aspirational State, Destroy Mindscape, Rite of Cleansing Flame, Unfettered Mark |
| class features | 4 | Anvil's Hardness, Churning Mind, Echoes of the Scrolls, Echoes of the Swords |
| feats | 3 | Lotus Above the Wind, Construct Dynamo, Autonomic Psychic Action |
| actions | 2 | Mirror-Trickery, Activate Resonant Reflection |

All are adventure-path or Society-scenario content of the same kind the user already chose to drop.
**Awaiting the user's decision — do NOT take any of them from Foundry.**

**NEW GUARD NEEDED before relaxing the book scope.** Dropping it also produced `Unfettered Mark` →
`Unfettered Pack` — 2 edits on a 4-letter word. Add a PROPORTIONAL limit (e.g. distance 1 for words of
5 characters or fewer) on top of `token_compatible`, or the same class of wrong match returns.

Also note `Flying Broom` → `Broom of Flying` (`equipment`): a word-ORDER difference the token-multiset
test missed because it did not drop stopwords. Worth one more rule.

### Scripts (all read-only, all re-runnable, seconds each)
| script | writes | does |
|---|---|---|
| `inventory.mjs` | `out/inventory.{json,md}` | field-by-field comparison, value-based |
| `join.mjs` | `out/join.json` | the 4-rule id/slug join |
| `report.mjs` | `out/unmatched.html` | browsable review page |
| `locate.py` | `out/located.json` | FTS search for records inside a parent page |
| `resolve.py` | `out/resolved.json` | book-scoped exact/no-paren/paren-only/typo |

### What the 963 actually are — four causes found so far

1. **Singular/plural and spelling variance — 26 records.** The user found this by searching their own
   app: HH `Discomfiting Whispers` is archive `Discomfiting Whisper` (`spell-2139`, singular). Also
   `Vindicator's Judgment`→`Judgement`, `Busine of Divine Reinforcements`→`Reinforcement`. SAFE to
   automate as a match rule.
2. **AoN typos that HH silently fixed.** `Cavalry Commander's Lance` is `Calvary Commander's Lance` in
   the archive (equipment-3838); `Commandant's Scabbard` is `Comandant's Scabbard` (equipment-3961).
   HH holds the correct spelling. Match them, but keep HH's spelling — do not import the typo.
3. **Data that lives in a TABLE, not as a document.** Gemstones and art objects: HH has `Agate`,
   `Amber`, `Citrine` as individual items; the archive has them as rows inside `rules-1111` / `rules-3228`
   ("Gems") and `rules-1112` ("Art Objects"), plus the `Trade Goods` category page
   (`equipment-category-91`). The data IS present — it is just not shaped as docs. Likely accounts for
   a large share of the 350 remaining `items`. **Needs a decision from the user:** parse the table into
   item records, or keep HH's item rows and link them to the rules page.
4. **HH-synthesised records.** At least 20 `Adept Benefit (…)` / `Paragon Benefit (…)`; expect more
   among the 242 remaining classFeatures.

### THE BIG ONE — HH splits out what the Archives keeps as a SECTION of a bigger page

The user resolved five examples by hand and they were all the same shape. Confirmed mechanically by
`scripts/migration/locate.py` (FTS5 search over the archive's full text; writes `out/located.json`):

| HH record | lives inside |
|---|---|
| `Accept Echo` (action) | feat **Echo of the Fallen** |
| `Familiar of Balanced Luck` | patron **Spinner of Threads** (Witch Patron Theme) |
| `Curse of Ancestral Meddling` | mystery **Ancestors** (Oracle Mystery) |
| `Adept/Initiate/Paragon Benefit (Amulet)` | implement **Amulet** |
| `Bloodline: Aberrant` | bloodline **Aberrant** |

**652 of the 963 are located inside a parent page.** Per bucket: actions 177/186, familiarAbilities
26/26, classFeatures 192/263, items 212/402, trait 5/5, feats 29/56, spells 3/8.

So the remaining work is not "find missing data" — it is **sub-block extraction**: parse the parent
doc's ast for the named section and bind the HH record to it. That is a build step, not a question.

### Confirmed by the user, and what to do

- **Gems / art objects** — RESOLVED, no work needed. The user: *"the Agate case is special, the only
  thing that uses it is the Aeon Stone (Agate Ellipsoid), so there is no need for a full item called
  Agate."* HH's individual gemstone items can be DROPPED; only the Aeon Stone variant matters.
- **AoN typos HH silently fixed** — `Camouflage Coat` is `Camoflage Coat` in the archive
  (`feat-5337`, missing the `u`). Also `Calvary Commander's Lance`, `Comandant's Scabbard`. Match on
  the archive id, keep HH's correct spelling.
- **Singular/plural** — `Discomfiting Whispers` is `Discomfiting Whisper` (`spell-2139`). 26 records.
- **`Avenger of Envy` — A REAL GAP IN THE ARCHIVE.** The user: *"it's a feat in pf2e but it isn't in
  the archives of guy b. use the data from the archives of nethys to fix this."* So a small number of
  records need re-fetching from AoN. `C:\trying ai 2\archives-of-nethys-scraper` exists. **Open
  question: re-scrape, or fetch just these?** Do NOT take them from Foundry.

### Stage 1d — book-scoped resolution (`scripts/migration/resolve.py`, writes `out/resolved.json`)

The trick that makes typo-tolerance SAFE: **scope every search to the record's own source book.**
HH records carry `source.book`, archive docs carry `book`, and one book holds a few hundred docs
instead of 43,686 — so `Camouflage Coat` / `Camoflage Coat` has no competition. Four rules, strongest
first: `exact` → `no-paren` → `paren-only` → `typo`.

Resolved **92 of the 311**: exact 3, paren-only 62 (`Adept Benefit (Amulet)` → implement `Amulet`),
typo 27. All 27 typos were reviewed by hand and are genuine (`Peshpine`→`Peshspine`,
`Sack of Hydra's Teeth`→`Hyrdra's`, `Repulse the Wicked`→`Wicken`, `Historical Reenactor`→`Reeanactor`).
Only `Luring Chomp`→`Lurching Chomp` is worth a second look.

**Two guards were added after the first run produced wrong matches** — keep both:
1. `same_family()` — the archive category must map to the HH bucket. Caught `Air Gate` (a class
   feature) matching the SPELL `Serrate`, and `Water Gate` matching the FEAT `Water Step`.
2. `token_compatible()` — the two names must be the SAME WORDS, differing only in spelling. Caught
   `Red Dragon's Breath Potion` matching `Dragon's Breath Potion`: dropping "Red" is exactly what
   distinguishes it from the Black and Brass ones. Also killed `Lotus Above the Wind` → `…the Mud`.

### Running total

| | records |
|---|---:|
| matched to their own archive doc | 23,602 |
| hand-authored, no doc expected | 779 |
| located inside a parent page (sub-block) | 652 |
| resolved by book-scoped matching | 92 |
| **still unresolved** | **219** |

Of the 219: **32 are from the two un-scraped books** (Crypt of Runes, Into the Apocalypse Archive) and
**187 are from books the archive DOES hold** — GM Core 26, Player Core 2 22, Core Rulebook 21,
Guns & Gears 19, and a long tail. Those 187 are still ours to explain, not gaps.

### Stage 1e — what the last 187 actually are (books the archive DOES hold)

Three shapes, all verified against `aon.db`:

**(a) Table expansion — HH makes one record per table ROW.** Same as the gems. The archive holds ONE
`Dragon's Breath Potion` (`equipment-185`) plus three age variants (`-225/-226/-227` Young/Adult/Wyrm),
and a table inside the text:

    Dragon Type        Breath Weapon (Save)
    Black or copper    30-foot line of acid (Reflex)
    Blue or bronze     30-foot line of electricity (Reflex)
    Brass              30-foot line of fire (Reflex)   …

HH expands that into one item per dragon type × age. 19 of the 136 unresolved items are this shape.

**(b) Sub-block of a class page.** `Alchemist Armor Expertise (Level 13)` has no doc of its own; the
Alchemist class page (`class-1`) contains the section *"Medium Armor Expertise"*. HH renames it and
appends its level. Accounts for most of the 29 classFeatures (also `Air/Fire/Water/Wood Gate`,
`… Deviant Classification`, `… Phantom Eidolon`).

**(c) Adventure loot the archive does not publish — 117 items. USER DECIDED: DROP THEM.**
Decision recorded 2026-08-10, list written to `out/drop-adventure-loot.json` (117 records with their
books). Reason: one-off adventure loot, not character-building content, present only because Foundry
ships every item in an adventure module. The 19 that ARE explainable as variants of a base item are
kept, in `out/variant-items.json`.
`Abrogail I Script` (Hellbreakers), `Astrolabe of the Falling Stars` (Gatewalkers),
`Cinnamon Nostalgia Bun`, `Duskwood violin by a legend`, `Cordelia's Greater Construct Key`…
The BOOKS are in the archive and it does index adventure equipment (Hellbreakers 56 equipment docs,
Gatewalkers 37, Season of Ghosts 62) — these specific items simply are not among them. They are in HH
because FOUNDRY ships every item in an adventure module while AoN publishes only what gets a rules
entry. Under hard rule 1 they cannot stay as-is. Options: drop them (they are adventure loot, not
character-building content), hand-author them as HH content, or find them on AoN. **Ask.**

### DANGER — do not enable fuzzy matching
Levenshtein ≤2 over the whole corpus "recovers" 104 more but is mostly WRONG: it pairs
`Agate`→`Plate` (an armor group), `Amber`→`Gambler` (a background), `Citrine`→`Catrina` (a creature),
`Chromatic Robe`→`Chromatic Ooze` (a creature), `Cutlery`→`Cutter` (a vehicle). A wrong match is far
worse than no match — it silently attaches the wrong rules to a record. Fuzzy results may ONLY be
offered as candidates for human review, never auto-accepted, and only within the same category.

---

_(historical — stage 1b working notes)_ `scripts/migration/join.mjs` exists, re-runnable, writes
`out/join.json`. It rebuilds the join from the archive side using the importer's exact `slug()` and
`CAT_BUCKET` (both copied verbatim into the script — keep them in sync).

Where the join stands:

| | records |
|---|---:|
| total in core.json | 25,344 |
| matched via `idmap.json` | 21,737 |
| matched via slug (new in 1b) | 121 |
| hand-authored, no archive doc expected (user-confirmed) | 779 |
| **still unmatched after 1b** | **1,928** |

Then a diagnostic (run inline, not yet scripted) tested three explanations against those 1,928:

| explanation | recovers |
|---|---:|
| the doc is in a category `CAT_BUCKET` doesn't map (only 27 of 93 categories are mapped) | ~1,178 |
| HH appends a disambiguating parenthetical the archive doesn't have — `Tusks (Orc)` → `Tusks`, `Irrepressible (Halfling)` → `Irrepressible` | ~490 |
| **remaining** | **~969** |

**NEXT ACTION:** fold those two rules into `join.mjs` (widen the category map; add a
strip-parenthetical fallback, recorded as `how: 'slug-noparen'` so it is never mistaken for an exact
match), re-run, then re-run `inventory.mjs` on the improved join. Only then does the field-gap table
mean anything.

Known shapes inside the remaining ~969, for whoever picks this up:
- `classFeatures` ~263 — many are HH-SYNTHESISED, e.g. the ten `Adept Benefit (Amulet|Bell|Chalice…)`
  records the builder generates per implement. Expect these to have no archive doc by design; confirm
  against the implement docs rather than assuming.
- `items` ~420 — treasure/trade goods and variant children (`Agate`, `Aged Arbor Wine`,
  `Abrogail I Script`). PLAN.md §5 says AoN keeps 5,159 equipment variants under `item_parent_id`;
  the variant child's own name may differ from HH's. Check `variants` in the db before concluding.
- `actions` ~186, `feats` ~68, `familiarAbilities` ~26, `vehicles` 5, `animalCompanions` 1.

Do NOT read the field-gap list as a list of missing data yet. A record that did not join reports every
one of its fields as unsupplied, so the gap table is still dominated by join failures. The user's
guarantee is that the archive lacks nothing, so treat every one of these as a mapping bug:

- `items` 1,314 unjoined — near-certainly because HH's one `items` bucket draws from SEVERAL archive
  categories (equipment 8,642 + weapon 614 + armor 75 + shield 32 + relic 219 + item-bonus 1,315 …)
  and `idmap.json` only recorded some of them.
- `classFeatures` 683 unjoined — near-certainly the ones AoN files under its own categories
  (curse, tactic, ikon, instinct, doctrine, lesson, mystery, bloodline, …), same as the traits finding.
- `actions` 348, `animalCompanions` 73, `spells` 50, `vehicles` 48, `familiarAbilities` 38,
  `conditions` 15, `heritages` 12, `trait` 12, `backgrounds` 11, `deities` 11, `siegeWeapons` 1.
- Genuinely HH-only, expected, no archive doc should exist: `modes` 429, `runes` 159, `stances` 129,
  `specificFamiliars` 38, `services` 12, `companionAdvanced` 5, `followers` 5, `pets` 2 (779 total).

Build the join from the archive side (walk all 93 category files, map each doc to the HH bucket/slug the
importer would produce) rather than trusting `idmap.json`, which only covers 27,140 of 43,686 docs.

**Only once the join is ~complete** does the field-gap table mean anything. Then stop and show the
user the list — per hard rule 2, every apparent gap is a question for them, not a decision for us.

### Known matcher artefacts (NOT gaps) — already seen on feats
- `source` — HH keeps Foundry's long book name ("Pathfinder Core Rulebook"), the archive the short one
  ("Core Rulebook"). `import-core-v2.mjs` already has `normBook` for this.
- `id` — HH's id is the slug, the archive's is `feat-123`. Different by design.
- `actionCost` — HH writes `{"type":"passive"}`; the archive encodes passive as the ABSENCE of an
  `actions` field. An encoding difference, not missing data.
- `category` — HH "class", archive spells it differently.

### Confirmed Foundry-origin values (these must be replaced, not copied)
`resistances` on feats contains Foundry rule-element expressions verbatim, e.g.
`{"type":"acid","value":"@actor.abilities.cha.mod"}`. `grantedStrikes` carries Foundry weapon
statblocks (`die`, `damageType`, `group`). These prove the field's provenance — they are exactly what
hard rule 1 is about.

### Resume protocol
- All real work goes in `scripts/migration/*.mjs` and its output in `scripts/migration/out/`. The
  scripts are the durable artifact; conversation context is not.
- Every script must be **re-runnable and idempotent** — re-running costs a few seconds and needs no
  memory of the previous session.
- Append findings to section 7 as they are established, one line each, with the evidence.
- On "go": read this file, read section 6, continue.

## 7. Findings log

_(append one line per established fact, newest last)_

- 2026-08-10 — `hh-data-export/manifest.json` says `source: "Archives of GuyB (aon.db)"`; its README
  records the user's instruction *"don't change the data itself — I will make changes to HH in the
  future to make it deal with our data"*. `scripts/import-core-v2.mjs:22` already reads it. The bridge
  exists; this migration finishes it.
- 2026-08-10 — `import-core-v2.mjs:134` loads `core.foundry-backup.json` as `REF`, the base that
  archive data is overlaid onto. 22 collections, 17,772 records. This is the thing to eliminate.
- 2026-08-10 — the archive's `class-feature` docs carry no traits at all (0 of 1,254, in the db's
  `traits` table too). The traits live on the corresponding `action`/`tactic`/`curse`/`mythic-calling`
  docs. `tactic.json` 37/37 have traits, `curse.json` 91/92, `mythic-calling.json` 15/15;
  `ikon.json` 0/21, `instinct.json` 0/16, `doctrine.json` 0/5.
- 2026-08-10 — USER CONFIRMED: `modes` (429), `runes` (159) and `stances` (129) stay. They are
  hand-authored HH constructs (`AUTHORED_BUCKETS` at import-core-v2.mjs:62, carried over wholesale)
  and correctly have no archive doc.
- 2026-08-10 — but they are not free of Foundry NOTATION. `@actor.*` / `@item.*` expressions appear in
  `effect-backfill.json` (429 uses), `toggle-modes.json` (56) and `stances.json` (9);
  `consumable-modes.json` is clean. Only **15 distinct expressions** across all of them —
  `@actor.level`, `@actor.speed.land`, `@actor.abilities.{cha,wis,int}.mod`, `@actor.speed.{climb,swim}`
  and similar. These are references to the CHARACTER, not content copied from Foundry, and HH derives
  every one of them itself. Renaming the 15 tokens to HH's own notation is a small, self-contained job.
  Flagged for the user rather than decided (hard rule 2).
