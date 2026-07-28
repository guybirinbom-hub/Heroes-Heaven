# Missing content: Archives of Nethys mirror vs. Heroes Heaven `core.json`

_Generated 2026-07-28. Analysis only — no app code or data was changed._

**Headline: 115 distinct player-facing names exist in the AoN mirror and not in `core.json`.**
Of those, **63 are genuine content gaps**, 2 more are genuine but reference-only, and **50 are false
positives** (same content present under a different name, or modelled differently by the app).
The previously circulated estimate of **~744 missing names does not hold** — see [Why the number moved](#why-the-number-moved).

---

## 1. Methodology

### Sources compared

| Side | Path | Shape |
|---|---|---|
| Ground truth | `C:\wonderers guide\aon-2e-archive\data\by-category\<category>\_index.json` | one array per category; each entry has `id`, `name`, `level`, `rarity`, `trait[]`, `primary_source`, `source[]`, `type`, `remaster_id[]`, `legacy_id[]`, `exclude_from_search`, `url`. The per-record `*.json` files carry the same facets plus `markdown`/`text`; the `_index.json` was used because it is the identical field set without the prose. |
| App | `C:\trying ai 2\pf2e codex\public\core.json` | 74 top-level buckets, each an object keyed by slug → record with a `name`. |

### Name normalisation (match is BY NAME ONLY)

A single normaliser, deliberately identical to the app's own `slug()` in `scripts/import-core-v2.mjs`,
so that a match here means a match in the app:

```js
norm = (s) => s.normalize('NFKD')          // decompose accents
  .replace(/[\u0300-\u036f]/g, '')        // …then drop the combining marks (Ma’at, Niyaháat, Ustradi)
  .toLowerCase()                           // case-insensitive
  .replace(/[‘’ʼ'`´]/g, '')            // every flavour of apostrophe is DELETED, not replaced
  .replace(/[^a-z0-9]+/g, '-')             // all other punctuation/space -> single hyphen
  .replace(/^-+|-+$/g, '');                // trim
```

Consequences, stated explicitly:

- Case, spacing, hyphen-vs-space, commas, ampersands and slashes are all ignored.
- `Fiend's Mouth Cannon` → `fiends-mouth-cannon`; `Premonition’s Reflexes` → `premonitions-reflexes`.
  Note this is **not** the same as `Premonition Reflexes` → `premonition-reflexes`; a dropped possessive
  is a real mismatch and is reported as such rather than silently fuzzed away.
- **Parenthetical suffixes are NOT stripped** for matching. `Battering Ram (Covered)` is a different
  name from `Battering Ram`, and `Refugee (FoP)` is different from `Refugee`. Stripping them would
  collapse genuinely distinct items (`Bracers of Armor (Greater)` vs `(Major)`). A *secondary*
  paren-stripped + leading-article-stripped key is computed **for diagnosis only** and reported as
  `LOOSE-MATCH`; it never changes a count.
- **Leading articles are NOT stripped** for matching (`The Harrow Court` stays distinct), for the same reason.
- A Levenshtein pass (distance ≤ 3) was run over every remaining "missing" name against all app names in
  the same bucket, again purely to surface near-misses for human judgement.

### How the "present" set was built (this is where the previous attempt went wrong)

- The present-set is built **from the app side only**: for every bucket, `Set(norm(record.name))` over
  `core.json`. Nothing from AoN ever enters it.
- The AoN side is **collapsed to distinct normalised names per category before comparison**. If AoN holds
  a name 3 times (reprints across books) and the app holds it once, that counts as **1 name, covered** —
  not as 3 covered. Collapsed duplicates are reported per category in the `dup` column below
  (1,668 records collapsed in total).
- A record ID lookup was included as a belt-and-braces fallback. It was measured and contributed
  **0 additional matches**, so every "present" verdict in this report is a pure name match.

### Sanity checks (two independent counts, plus a third from the other direction)

| Check | Result |
|---|---|
| **Pass 1** — per-category classification, summed | 115 missing / 21,614 present |
| **Pass 1** — same data deduplicated at *bucket* level (catches a name appearing in two categories that map to one bucket, e.g. `weapon` + `equipment` → `items`) | **115** missing / 21,610 present |
| **Pass 2** — independent record-level re-walk of the mirror, building `bucket\|name` keys into two sets | **115** missing / 21,610 present |
| Keys appearing in both the present and missing sets (would indicate a counting bug) | **0** |
| **Reverse check** — app names with no AoN counterpart at all | 1,891 (expected: Foundry-era names, curated treasure, per-class disambiguated feature names) |

The two passes agree exactly. The 4-record difference between the per-category sum and the bucket-level
dedup is the *present* side only: 4 names that AoN lists under two categories mapping to the same app bucket.

### Scope and exclusions

| Excluded | Count (records) | Reason |
|---|---|---|
| 16 `REF_SKIP` entity/GM categories (`creature`, `hazard`, `weather-hazard`, `creature-ability`, `creature-family`, `creature-adjustment`, `creature-theme-template`, `eidolon`, `article`, `class-sample`, `warfare-army`, `warfare-tactic`, `kingdom-event`, `kingdom-structure`, `campsite-meal`, `cult-activity`) | 6,575 | Deliberate importer scope decision (`import-core-v2.mjs` line 62); a separate call. |
| 6 companion categories (`animal-companion`, `-advanced`, `-specialization`, `-unique`, `familiar-ability`, `familiar-specific`) | 378 | Re-imported earlier today; out of scope per the brief. |
| `exclude_from_search` records | 3,475 | AoN's own hidden entries. Verified harmless — see §4, *Why the number moved*. |
| Legacy records superseded by a remaster twin | 9,808 | See below. |
| Records with no usable name | 53 | AoN data defects. |

That leaves a comparison universe of **23,397 records → 21,725 distinct names**.

### Legacy / Remaster handling

AoN links a superseded legacy record to its replacement via `remaster_id[]` (and back via `legacy_id[]`).
A legacy record was dropped from the universe **iff at least one of its `remaster_id` targets resolves to a
real record in the mirror**. The twin's presence in the app was then checked *in the twin's own bucket*,
so a record that AoN moved between categories (17 `item-bonus` entries that became `equipment`, 4 legacy
`ancestry` entries that became versatile heritages, 1 `sidebar` that became a `rules` page) is correctly
recognised as present.

- **9,808 records excluded this way**, collapsing to **1,041 distinct names** that would otherwise have
  been reported missing. Spot-checked and confirmed as genuine Remaster renames: `Feral Mutagen`→`Mutant
  Physique`, `Celestial Eyes`→`Nephilim Eyes`, `Sense Chaos`→`Sense Iniquity`, `Eyes of the Night`→`Eyes of
  Night`, `Razor Claws`/`Sharp Fangs`/`Tail Whip`→`Iruxi Armaments` (a 3→1 merge), `Hellknight Signifer
  Dedication`→`Hellknight Signifer Preferment`.
- **80 records** carry a `remaster_id` pointing at an ID not in the mirror. These were **kept in the
  universe** (not silently dropped) since the twin cannot be verified. None of them ended up in the missing list.
- **18 records** were excluded whose twin is also absent from the app. In every case the twin itself is
  in scope and is counted in the missing list below, so nothing is lost. Only **2** had a twin that lands
  in a skipped category, i.e. the theoretical maximum undercount from this rule is 2 records.

### Category → bucket mapping used

| App bucket | AoN categories mapped into it |
|---|---|
| `actions` | `action` |
| `ancestries` | `ancestry` |
| `apparition` | `apparition` |
| `arcaneSchool` | `arcane-school` |
| `arcaneThesis` | `arcane-thesis` |
| `archetype` | `archetype` |
| `armorGroup` | `armor-group` |
| `backgrounds` | `background` |
| `bloodline` | `bloodline` |
| `categoryPage` | `category-page` |
| `cause` | `cause` |
| `classFeatures` | `class-feature` |
| `classes` | `class` |
| `conditions` | `condition` |
| `consciousMind` | `conscious-mind` |
| `curse` | `curse` |
| `deities` | `deity` |
| `deityCategory` | `deity-category` |
| `deviantAbilityClassification` | `deviant-ability-classification` |
| `disease` | `disease` |
| `doctrine` | `doctrine` |
| `domain` | `domain` |
| `draconicExemplar` | `draconic-exemplar` |
| `druidicOrder` | `druidic-order` |
| `element` | `element` |
| `epithet` | `epithet` |
| `feats` | `feat` |
| `hellknightOrder` | `hellknight-order` |
| `heritages` | `heritage` |
| `huntersEdge` | `hunters-edge` |
| `hybridStudy` | `hybrid-study` |
| `ikon` | `ikon` |
| `implement` | `implement` |
| `innovation` | `innovation` |
| `instinct` | `instinct` |
| `itemBonus` | `item-bonus` |
| `items` | `armor`, `class-kit`, `equipment`, `relic`, `set-relic`, `shield`, `weapon` |
| `languages` | `language` |
| `lesson` | `lesson` |
| `methodology` | `methodology` |
| `muse` | `muse` |
| `mystery` | `mystery` |
| `mythicCalling` | `mythic-calling` |
| `patron` | `patron` |
| `plane` | `plane` |
| `practice` | `practice` |
| `racket` | `racket` |
| `researchField` | `research-field` |
| `rules` | `rules` |
| `sidebar` | `sidebar` |
| `siegeWeapons` | `siege-weapon` |
| `skill` | `skill` |
| `skillGeneralAction` | `skill-general-action` |
| `source` | `source` |
| `spells` | `ritual`, `spell` |
| `style` | `style` |
| `subconsciousMind` | `subconscious-mind` |
| `tactic` | `tactic` |
| `tenet` | `tenet` |
| `tradition` | `tradition` |
| `trait` | `trait` |
| `vehicles` | `vehicle` |
| `way` | `way` |
| `weaponGroup` | `weapon-group` |

**Every in-scope AoN category mapped cleanly — none were left unmapped.** Two mappings needed care:

- `ancestry` is **not** a 1:1 mapping. AoN files 25 `Versatile Heritage` and 2 `Half-Human Heritage`
  records inside the `ancestry` category (`type` field); the app stores those in `heritages` with
  `versatile: true`. The bucket is therefore resolved **per record from its `type`**, not per category.
  Skipping this produced 20 spurious "missing ancestries" (Aasimar, Tiefling, Nephilim, Aiuvarin, Dromaar,
  Dhampir, Dragonblood, Duskwalker, Changeling, Beastkin, Aphorite, Ifrit, Oread, Suli, Sylph, Undine,
  Ardande, Talos, Hungerseed, Reflection) — all 22 versatile heritages are in fact present.
- `class-feature` → `classFeatures` is a **structurally unreliable comparison** and its numbers should not
  be trusted as a content gap. See §4.

---

## 2. Summary table

Columns: **AoN recs** = raw records in the mirror · **hidden** = `exclude_from_search` · **legacy** =
superseded, twin resolved · **dup** = duplicate-name records collapsed · **distinct** = names actually
compared · **present** / **MISSING** = distinct names.

| AoN category | App bucket | AoN recs | hidden | legacy | dup | distinct | present | MISSING |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `siege-weapon` | `siegeWeapons` | 84 | 0 | 0 | 22 | 62 | 5 | **57** |
| `class-feature` | `classFeatures` | 1254 | 0 | 533 | 350 | 371 | 327 | **44** |
| `heritage` | `heritages` | 436 | 33 | 97 | 0 | 306 | 302 | **4** |
| `deity` | `deities` | 717 | 0 | 233 | 3 | 481 | 478 | **3** |
| `action` | `actions` | 3979 | 3221 | 155 | 44 | 507 | 505 | **2** |
| `archetype` | `archetype` | 336 | 3 | 92 | 0 | 241 | 239 | **2** |
| `background` | `backgrounds` | 612 | 0 | 113 | 3 | 496 | 494 | **2** |
| `language` | `languages` | 155 | 0 | 34 | 1 | 120 | 119 | **1** |
| `ancestry` | `ancestries` | 94 | 0 | 24 | 0 | 70 | 70 | 0 |
| `apparition` | `apparition` | 14 | 0 | 0 | 0 | 14 | 14 | 0 |
| `arcane-school` | `arcaneSchool` | 23 | 0 | 0 | 0 | 23 | 23 | 0 |
| `arcane-thesis` | `arcaneThesis` | 10 | 0 | 5 | 0 | 5 | 5 | 0 |
| `armor` | `items` | 75 | 4 | 33 | 0 | 38 | 38 | 0 |
| `armor-group` | `armorGroup` | 7 | 0 | 0 | 0 | 7 | 7 | 0 |
| `bloodline` | `bloodline` | 28 | 0 | 10 | 0 | 18 | 18 | 0 |
| `category-page` | `categoryPage` | 285 | 0 | 65 | 4 | 216 | 216 | 0 |
| `cause` | `cause` | 13 | 0 | 6 | 0 | 7 | 7 | 0 |
| `class` | `classes` | 47 | 0 | 20 | 0 | 27 | 27 | 0 |
| `class-kit` | `items` | 32 | 0 | 0 | 16 | 16 | 16 | 0 |
| `condition` | `conditions` | 98 | 0 | 42 | 0 | 56 | 56 | 0 |
| `conscious-mind` | `consciousMind` | 12 | 0 | 6 | 0 | 6 | 6 | 0 |
| `curse` | `curse` | 92 | 0 | 35 | 1 | 56 | 56 | 0 |
| `deity-category` | `deityCategory` | 40 | 0 | 0 | 0 | 40 | 40 | 0 |
| `deviant-ability-classification` | `deviantAbilityClassification` | 10 | 0 | 0 | 3 | 7 | 7 | 0 |
| `disease` | `disease` | 44 | 0 | 0 | 15 | 29 | 29 | 0 |
| `doctrine` | `doctrine` | 5 | 0 | 2 | 0 | 3 | 3 | 0 |
| `domain` | `domain` | 124 | 2 | 61 | 0 | 61 | 61 | 0 |
| `draconic-exemplar` | `draconicExemplar` | 44 | 0 | 0 | 0 | 44 | 44 | 0 |
| `druidic-order` | `druidicOrder` | 13 | 0 | 4 | 0 | 9 | 9 | 0 |
| `element` | `element` | 6 | 0 | 0 | 0 | 6 | 6 | 0 |
| `epithet` | `epithet` | 18 | 0 | 0 | 0 | 18 | 18 | 0 |
| `equipment` | `items` | 8642 | 102 | 2333 | 466 | 5741 | 5741 | 0 |
| `feat` | `feats` | 8460 | 31 | 2313 | 24 | 6092 | 6092 | 0 |
| `hellknight-order` | `hellknightOrder` | 14 | 0 | 0 | 7 | 7 | 7 | 0 |
| `hunters-edge` | `huntersEdge` | 7 | 0 | 3 | 0 | 4 | 4 | 0 |
| `hybrid-study` | `hybridStudy` | 8 | 0 | 0 | 0 | 8 | 8 | 0 |
| `ikon` | `ikon` | 21 | 0 | 0 | 0 | 21 | 21 | 0 |
| `implement` | `implement` | 19 | 0 | 9 | 0 | 10 | 10 | 0 |
| `innovation` | `innovation` | 7 | 0 | 0 | 3 | 4 | 4 | 0 |
| `instinct` | `instinct` | 16 | 0 | 6 | 0 | 10 | 10 | 0 |
| `item-bonus` | `itemBonus` | 1315 | 6 | 350 | 264 | 695 | 695 | 0 |
| `lesson` | `lesson` | 31 | 0 | 12 | 0 | 19 | 19 | 0 |
| `methodology` | `methodology` | 9 | 0 | 4 | 0 | 5 | 5 | 0 |
| `muse` | `muse` | 9 | 0 | 4 | 0 | 5 | 5 | 0 |
| `mystery` | `mystery` | 22 | 0 | 10 | 1 | 11 | 11 | 0 |
| `mythic-calling` | `mythicCalling` | 15 | 0 | 0 | 0 | 15 | 15 | 0 |
| `patron` | `patron` | 27 | 0 | 10 | 1 | 16 | 16 | 0 |
| `plane` | `plane` | 47 | 0 | 22 | 0 | 25 | 25 | 0 |
| `practice` | `practice` | 4 | 0 | 0 | 0 | 4 | 4 | 0 |
| `racket` | `racket` | 10 | 0 | 4 | 0 | 6 | 6 | 0 |
| `relic` | `items` | 219 | 0 | 97 | 0 | 122 | 122 | 0 |
| `research-field` | `researchField` | 8 | 0 | 4 | 0 | 4 | 4 | 0 |
| `ritual` | `spells` | 201 | 0 | 56 | 0 | 145 | 145 | 0 |
| `rules` | `rules` | 3645 | 0 | 1288 | 349 | 2008 | 2008 | 0 |
| `set-relic` | `items` | 14 | 0 | 0 | 7 | 7 | 7 | 0 |
| `shield` | `items` | 32 | 0 | 16 | 0 | 16 | 16 | 0 |
| `sidebar` | `sidebar` | 694 | 0 | 233 | 70 | 390 | 390 | 0 |
| `skill` | `skill` | 50 | 0 | 17 | 0 | 33 | 33 | 0 |
| `skill-general-action` | `skillGeneralAction` | 25 | 0 | 6 | 0 | 19 | 19 | 0 |
| `source` | `source` | 245 | 0 | 0 | 2 | 243 | 243 | 0 |
| `spell` | `spells` | 2461 | 25 | 799 | 0 | 1637 | 1637 | 0 |
| `style` | `style` | 11 | 0 | 5 | 0 | 6 | 6 | 0 |
| `subconscious-mind` | `subconsciousMind` | 8 | 0 | 4 | 0 | 4 | 4 | 0 |
| `tactic` | `tactic` | 37 | 0 | 0 | 0 | 37 | 37 | 0 |
| `tenet` | `tenet` | 2 | 0 | 0 | 0 | 2 | 2 | 0 |
| `tradition` | `tradition` | 5 | 0 | 0 | 0 | 5 | 5 | 0 |
| `trait` | `trait` | 907 | 0 | 351 | 5 | 551 | 551 | 0 |
| `vehicle` | `vehicles` | 137 | 0 | 41 | 0 | 96 | 96 | 0 |
| `way` | `way` | 11 | 0 | 0 | 5 | 6 | 6 | 0 |
| `weapon` | `items` | 614 | 48 | 241 | 2 | 323 | 323 | 0 |
| `weapon-group` | `weaponGroup` | 17 | 0 | 0 | 0 | 17 | 17 | 0 |
| **TOTAL** | | **36733** | **3475** | **9808** | **1668** | **21729** | **21614** | **115** |

> **Note on the `ancestry` row:** its 70 distinct names are checked against `ancestries` *or* `heritages`
> per record, per the `type` split described above — which is why it reads 0 missing despite the app having
> only 50 ancestries.

> The TOTAL `distinct`/`present` are per-category sums; deduplicated at bucket level they are 21,725 and
> 21,610. `MISSING` is 115 under both.

### Missing, grouped by source book

| Source book | Missing | Categories |
|---|---:|---|
| Battlecry! | 30 | `class-feature`, `siege-weapon` |
| Player Core 2 | 19 | `background`, `class-feature` |
| Guns & Gears (Remastered) | 15 | `class-feature`, `siege-weapon` |
| Howl of the Wild | 13 | `siege-weapon` |
| Player Core | 12 | `class-feature` |
| High Seas | 5 | `deity`, `heritage` |
| Dark Archives (Remastered) | 3 | `class-feature` |
| Pathfinder #216: The Acropolis Pyre | 3 | `deity`, `language` |
| Secrets of Magic | 3 | `class-feature` |
| War of Immortals | 3 | `class-feature` |
| Book of the Dead | 1 | `action` |
| Guns & Gears | 1 | `siege-weapon` |
| Impossible Lands | 1 | `archetype` |
| Pathfinder #172: Secrets of the Temple City | 1 | `archetype` |
| Pathfinder #215: To Blot Out the Sun | 1 | `siege-weapon` |
| Pathfinder #223: Hell's Destiny | 1 | `siege-weapon` |
| Pathfinder Adventure Path #219: Lord of the Trinity Star | 1 | `action` |
| Rage of Elements | 1 | `class-feature` |
| The Fall of Plaguestone | 1 | `background` |

**No book is wholly absent from the app.** Coverage of the newest hardcovers was verified directly:

| Book | Player-facing records | Present | Missing |
|---|---:|---:|---:|
| Battlecry! (2025-07) | 589 | 589 | 0 |
| Divine Mysteries (2025-01) | 521 | 521 | 0 |
| Guns & Gears (Remastered) (2025-02) | 650 | 650 | 0 |
| Dark Archives (Remastered) (2026-02) | 387 | 387 | 0 |
| Rival Academies (2025-02) | 201 | 201 | 0 |
| Shining Kingdoms (2025-06) | 151 | 151 | 0 |
| Claws of the Tyrant (2025-04) | 24 | 24 | 0 |
| **High Seas (2026-07, newest)** | 112 | 107 | **5** |

(Feats / equipment / weapons / armor / shields / spells / rituals / backgrounds / heritages / deities /
actions / archetypes only; the siege-weapon shortfall is counted separately below.)

---

## 3. Per-category missing lists (complete)

### `siege-weapon` → `siegeWeapons` — 57 missing

The single largest and most clear-cut gap. `core.json.siegeWeapons` contains exactly 5 records — `Ballista`, `Catapult`, `Trebuchet`, `Battering Ram`, `Cannon` — against 62 distinct names in the mirror. `siegeWeapons` is one of the importer's `CARRY_WHOLESALE` buckets, so the AoN corpus is never merged into it. All 57 below are genuine, verified absences (`Light Mortar` and `Wolf Fang` collide by name with an inventor innovation and a weapon respectively — different content).

**Battlecry!** (28)

- **Light Mortar** — level 1, uncommon _(name exists in another bucket)_
- **Crossbow Catapult** — level 3, uncommon
- **Flame Bellows** — level 3, uncommon
- **Falconet** — level 4, uncommon
- **Ribauldequin** — level 4, uncommon
- **Steam Artillery** — level 5, uncommon
- **Wolf Fang** — level 5, uncommon _(name exists in another bucket)_
- **Drilling Ram** — level 6, uncommon
- **Arcane Ram** — level 8, uncommon
- **Web Launcher** — level 8, uncommon
- **Shatterpult** — level 9, uncommon
- **Blessed Onager** — level 10, uncommon
- **Adamantine Drilling Ram** — level 11, uncommon
- **Nullifier Sling** — level 11, rare
- **Tar Spitter** — level 11, uncommon
- **Clockwork Ballista** — level 12, rare
- **Stasian Sled** — level 12, uncommon
- **Jistkan Horn** — level 13, uncommon
- **Mud Maker** — level 13, uncommon
- **Sigilstone Slinger** — level 14, uncommon
- **Burning Glass** — level 15, rare
- **Glacial Zephyr** — level 15, uncommon
- **Flute Rocket** — level 16, uncommon
- **Nexian Disgorger** — level 17, rare
- **Volley Gun** — level 17, uncommon
- **Ustradi Long Cannon** — level 18, rare
- **Corrupted Polyp** — level 19, rare
- **Fists of Divinity** — level 20, unique

**Guns & Gears** (1)

- **Springald** — level 7, uncommon

**Guns & Gears (Remastered)** (13)

- **Door Ram** — level 2, uncommon
- **Hwacha** — level 4, uncommon
- **Bombard** — level 5, uncommon
- **Battering Ram (covered)** — level 6, uncommon _(app has: `Battering Ram`)_
- **Blasting Ram** — level 7, uncommon
- **Mortar** — level 7, uncommon
- **Firedrake** — level 8, uncommon
- **Heavy Ballista** — level 8, uncommon
- **Heavy Bombard** — level 9, uncommon
- **Fiend's Mouth Cannon** — level 11, uncommon
- **Alchemical Springald** — level 13, uncommon
- **Steelheart 21** — level 13, rare
- **Alkenstar Cannon** — level 15, rare

**Howl of the Wild** (13)

- **Teekdoon** — level 1, uncommon
- **Trapdoor Actuator** — level 3, uncommon
- **Marking Powder Cannon** — level 5, rare
- **Pheromone Sprayer** — level 5, uncommon
- **Harpoon Cannon** — level 7, uncommon
- **Kickback Spring** — level 7, uncommon
- **Blob Paste Propulsor** — level 8, uncommon
- **Lashtail** — level 9, uncommon
- **Sonic Horn** — level 10, uncommon
- **Seedpod Shooter** — level 11, rare
- **Anesthetizing Jaws** — level 13, rare
- **Aquatic Disintegrator** — level 15, rare
- **Seismic Amplifier** — level 15, rare

**Pathfinder #215: To Blot Out the Sun** (1)

- **Bolt Emitter** — level 9, unique

**Pathfinder #223: Hell's Destiny** (1)

- **Cyclonic Cannon** — level 13, rare

### `class-feature` → `classFeatures` — 44 missing

**Treat these numbers as unreliable.** See §4 — the app and AoN model class features differently, and all 44 are scaffolding or naming-model artefacts rather than absent content — none is a thing a player can pick that the app lacks.

**Battlecry!** (2)

- **Commander Feats** — level 1, common
- **Guardian Feats** — level 1, common

**Dark Archives (Remastered)** (3)

- **Thaumaturge Feats** — level 1, common
- **Psychic Feats** — level 2, common
- **Lightning Reflexes** — level 3, common

**Guns & Gears (Remastered)** (2)

- **Gunslinger Feats** — level 1, common
- **Inventor Feats** — level 1, common

**Player Core** (12)

- **Anathema** — level 1, common _(app has: `Anathema (Cleric)`, `Anathema (Druid)`)_
- **Bard Spellcasting** — level 1, common
- **Deity** — level 1, common _(app has: `Deity (Champion)`, `Deity (Cleric)`; name exists in another bucket)_
- **Familiar** — level 1, common _(app has: `Familiar (Witch)`; name exists in another bucket)_
- **Fighter Feats** — level 1, common
- **Ranger Feats** — level 1, common
- **Rogue Feats** — level 1, common
- **Bard Feats** — level 2, common
- **Cleric Feats** — level 2, common
- **Druid Feats** — level 2, common
- **Witch Feats** — level 2, common
- **Wizard Feats** — level 2, common

**Player Core 2** (18)

- **Alchemist Feats** — level 1, common
- **Ancestry and Background** — level 1, common
- **Attribute Boosts** — level 1, common _(name exists in another bucket)_
- **Barbarian Feats** — level 1, common
- **Champion Feats** — level 1, common
- **Initial Proficiencies** — level 1, common _(name exists in another bucket)_
- **Investigator Feats** — level 1, common
- **Monk Feats** — level 1, common
- **Swashbuckler Feats** — level 1, common
- **Oracle Feats** — level 2, common
- **Skill Feats** — level 2, common _(name exists in another bucket)_
- **Sorcerer Feats** — level 2, common
- **General Feats** — level 3, common _(name exists in another bucket)_
- **Skill Increases** — level 3, common _(name exists in another bucket)_
- **Ancestry Feat** — level 5, common
- **Vigilant Senses** — level 7, common
- **Incredible Senses** — level 13, common
- **Premonition’s Reflexes** — level 13, common

**Rage of Elements** (1)

- **Kineticist Feats** — level 1, common

**Secrets of Magic** (3)

- **Arcane Spellcasting** — level 1, common _(app has: `Arcane Spellcasting (Magus)`)_
- **Magus Feats** — level 2, common
- **Summoner Feats** — level 2, common

**War of Immortals** (3)

- **Exemplar Feats** — level 1, common
- **Animist Feats** — level 2, common
- **Ancestry Feats** — level 5, common _(name exists in another bucket)_

### `heritage` → `heritages` — 4 missing

All four are from **High Seas** (July 2026), the newest book. Every other High Seas record (feats, items, spells, backgrounds, deities) is present — the ancestries `Athamaru`, `Merfolk`, `Tripkee` and `Elf` all exist with their other heritages, so these are four isolated omissions, not a missing book.

**High Seas** (4)

- **Aquatic Elf** — common
- **Benthic Athamaru** — common
- **Camouflage Tripkee** — common
- **Cecaelia Merfolk** — common

### `deity` → `deities` — 3 missing

**High Seas** (1)

- **Surveyors of the Deep** — common

**Pathfinder #216: The Acropolis Pyre** (2)

- **Chinostes (Nightwarden)** — common _(app has: `Chinostes`)_
- **Chinostes (Redeemer)** — common _(app has: `Chinostes`)_

### `archetype` → `archetype` — 2 missing

These are the *archetype glossary/reference* records. Both archetypes are otherwise playable: `Jalmeri Heavenseeker Dedication` and `Bright Lion Dedication` are both present in `feats`. Only the reference entry that description links resolve to is absent. (`Bright Lion` also collides with a background of the same name.)

**Impossible Lands** (1)

- **Jalmeri Heavenseeker** — level 4, uncommon

**Pathfinder #172: Secrets of the Temple City** (1)

- **Bright Lion** — level 2, uncommon _(name exists in another bucket)_

### `background` → `backgrounds` — 2 missing

**Both are false positives.** The app carries `Refugee (PC2)` and `Refugee (Fall of Plaguestone)` — deliberately disambiguated names for AoN's `Refugee` and `Refugee (FoP)`.

**Player Core 2** (1)

- **Refugee** — common _(app has: `Refugee (Fall of Plaguestone)`, `Refugee (PC2)`)_

**The Fall of Plaguestone** (1)

- **Refugee (FoP)** — common _(app has: `Refugee (Fall of Plaguestone)`, `Refugee (PC2)`)_

### `language` → `languages` — 1 missing

**Pathfinder #216: The Acropolis Pyre** (1)

- **Iblydosi** — common

### `action` → `actions` — 2 missing

**Both are false positives** — AoN data defects. These are item-activation component strings that leaked into the `action` category as records but were not flagged `exclude_from_search`.

**Book of the Dead** (1)

- **envision** — common

**Pathfinder Adventure Path #219: Lord of the Trinity Star** (1)

- **(concentration)** — common _(app has: `(spellshape)`)_

---

## 4. Analysis

### Verified genuine gaps: 63 (+2 reference-only)

| What | Count | Confidence |
|---|---:|---|
| Siege weapons | 57 | Certain — bucket holds 5 of 62 |
| High Seas heritages | 4 | Certain |
| Deity: `Surveyors of the Deep` (High Seas) | 1 | Certain |
| Language: `Iblydosi` (PF #216) | 1 | Certain |
| **Genuine content gaps** | **63** | |
| _(separate)_ Archetype reference entries (`Jalmeri Heavenseeker`, `Bright Lion`) | 2 | Certain, but both Dedication feats exist in `feats` — only the description-link target is absent |

### Verified false positives: 50

| What | Count | Why it is not a gap |
|---|---:|---|
| `class-feature` — `<Class> Feats` table rows (`Bard Feats`, `Cleric Feats`, … 27 of them) | 27 | Not content. AoN emits one record per class-advancement-table row. The app has **zero** records named `* Feats` and grants class feats from the class progression instead. |
| `class-feature` — universal character-creation rows (`Anathema`, `Deity`, `Familiar`, `Attribute Boosts`, `Initial Proficiencies`, `Skill Increases`, `Skill Feats`, `General Feats`, `Ancestry Feat`, `Ancestry Feats`, `Ancestry and Background`) | 11 | Same scaffolding. 6 already resolve as `rules` pages; the app additionally carries per-class variants (`Anathema (Cleric)`, `Anathema (Druid)`, `Deity (Champion)`, `Deity (Cleric)`, `Familiar (Witch)`). |
| `class-feature` — proficiency bumps under generic app names | 4 | `Lightning Reflexes`, `Vigilant Senses`, `Incredible Senses` → the app uses `Reflex Expertise` / `Perception Mastery` / `Perception Expertise`. `Premonition’s Reflexes` → the app has `Premonition Reflexes` (dropped possessive; Levenshtein distance 1). |
| `class-feature` — spellcasting entries | 2 | `Arcane Spellcasting` → app `Arcane Spellcasting (Magus)`; `Bard Spellcasting` → app `Occult Spellcasting`. |
| `background` — `Refugee`, `Refugee (FoP)` | 2 | App has `Refugee (PC2)` and `Refugee (Fall of Plaguestone)`. |
| `deity` — `Chinostes (Nightwarden)`, `Chinostes (Redeemer)` | 2 | App has a single `Chinostes`. AoN splits the deity into two aspect records. Partial coverage, not absence. |
| `action` — `envision`, `(concentration)` | 2 | AoN data defects (activation-component strings). |
| **Total false positives** | **50** | |

### Where the gaps concentrate

1. **One bucket accounts for 90% of the real gap.** `siegeWeapons` is `CARRY_WHOLESALE` in
   `import-core-v2.mjs`, so the importer never merges AoN data into it — the bucket froze at the 5
   hand-authored entries. Three books that add siege weapons (Battlecry! 28, Guns & Gears (Remastered) 13,
   Howl of the Wild 13, plus 3 singles) are consequently invisible.
2. **The newest book is the only one with content-level holes.** High Seas (2026-07) contributes 5 of the
   remaining 6 non-siege gaps. Everything else, including books released as recently as 2026-06, is complete.
3. **First-class buckets that the importer never fills from fresh AoN records are where the gaps live.**
   `FRESH_BUCKETS` covers only `feats`/`actions`/`spells`/`items`, and every other AoN category falls
   through to the automatic reference-bucket path. The buckets in between — `heritages`, `deities`,
   `languages`, `backgrounds`, `ancestries`, `conditions`, `classFeatures`, `classes`, `vehicles`,
   `siegeWeapons` — only get a record when an old Foundry record with the same slug already exists
   (`else deferred++` at line ~295). That is exactly the shape of the residual list.
4. **The mass-content buckets are effectively complete.** feats 6,092/6,092 · equipment 5,741/5,741 ·
   spells 1,637/1,637 · rituals 145/145 · weapons 323/323 · relics 122/122 · rules 2,008/2,008 ·
   traits 551/551 · item bonuses 695/695 · vehicles 96/96 · conditions 56/56 · curses 56/56 ·
   domains 61/61 · archetypes 239/241.

### Unresolved naming mismatches vs. genuine omissions

Every one of the 115 was inspected individually. The split is: 63 genuine omissions, 2 genuine
reference-only omissions, 10 naming mismatches (`Refugee`×2, `Chinostes`×2, `Premonition’s Reflexes`,
`Arcane Spellcasting`, `Bard Spellcasting`, `Lightning Reflexes`, `Vigilant Senses`, `Incredible Senses`),
38 modelling differences (class-table scaffolding), and 2 AoN data defects. **There is no residue of
"probably a naming mismatch, could not tell"** — the list is small enough to have been exhaustively resolved.

### Categories that could NOT be compared reliably

- **`class-feature` → `classFeatures`.** AoN holds 371 distinct names after dedup; the app holds 1,007
  records of which 663 have no AoN name at all. The app names features per class
  (`adept-benefit-amulet`, `anathema-cleric`) where AoN emits one generic record, and AoN emits
  advancement-table rows the app does not model as records. The 44 "missing" figure is therefore a
  **modelling artefact, not a content measurement**. Only 6 of the 44 correspond to anything a player
  could notice, and all 6 exist under another name.
- **`actions` (partially).** 3,221 of 3,979 AoN action records are `exclude_from_search` item-activation
  strings, and 2 more leaked in unflagged. The 505/507 figure is sound but the denominator is not the
  "number of actions in Pathfinder".

### Why the number moved

The ~744 estimate is not reproducible from this data under any consistent set of rules. The measured
sensitivity of the result to the two exclusion rules is:

| Rule set | Missing names |
|---|---:|
| Exclude hidden **and** superseded-legacy records (correct) | **115** |
| Exclude legacy only — keep AoN's hidden records | 519 |
| Exclude hidden only — keep superseded legacy records | 1,156 |
| No exclusions at all | 1,577 |

So the legacy/remaster rule alone is worth **1,041 names** and the hidden rule **404**. An estimate in the
700s is consistent with applying the legacy rule but not the hidden rule (or vice versa) while also
mis-mapping versatile heritages. Both exclusions were independently validated here:

- **Hidden records cost nothing.** Sweeping every `exclude_from_search` record whose name has no visible
  AoN sibling *and* is absent from the app yields 2,168 hits — 2,167 of which are `action` junk strings
  (`command, Interact`, `(1 minute) envision, Interact`) and 1 is an archetype already counted. Not one
  hidden feat, item, spell, heritage or weapon is genuinely absent.
- **Legacy exclusions are genuine renames**, spot-checked across ~35 samples (see §1).

---

## 5. Recommended order of work

| # | Work | Records | Effort | Value |
|---|---|---:|---|---|
| 1 | **Siege weapons — merge the AoN corpus into `siegeWeapons`.** Remove `siegeWeapons` from `CARRY_WHOLESALE` in `import-core-v2.mjs` (or add a dedicated fresh-derivation path) so the 62 mirror records land in the bucket. One importer change buys 90% of the entire gap. Stat blocks are faceted in the mirror (`level`, `rarity`, `price`, `trait`) so a `deriveFresh`-style path is viable; the existing `VehicleBlock` rendering is the closest precedent. | 57 | Low–medium (1 importer change) | **Highest** |
| 2 | **High Seas heritages** — `Aquatic Elf`, `Benthic Athamaru`, `Camouflage Tripkee`, `Cecaelia Merfolk`. All four parent ancestries already exist with sibling heritages, so these are four data rows. | 4 | Low | High — newest book, player-selectable |
| 3 | **`Surveyors of the Deep`** (High Seas deity/pantheon) and **`Iblydosi`** (PF #216 language). Two isolated rows. | 2 | Trivial | Medium |
| 4 | **Rename `Premonition Reflexes` → `Premonition’s Reflexes`** in `classFeatures` to match the printed name. Watch for saved-character references keyed on the old slug. | 1 | Trivial | Low–medium (correctness) |
| 5 | **Add the two archetype reference entries** (`Jalmeri Heavenseeker`, `Bright Lion`) so description links resolve instead of rendering inert. Both dedications already exist as feats. | 2 | Trivial | Low–medium |
| 6 | **Split `Chinostes` into its two aspects** (`Nightwarden`, `Redeemer`) if the app wants to match AoN's deity modelling. Judgement call, not a bug. | 2 | Low | Low |
| 7 | **Do nothing about the 44 `class-feature` entries.** 38 are advancement-table scaffolding with no player-facing meaning and 6 already exist under the app's own generic names. Importing them would add noise to pickers. | 0 | — | None |
| 8 | **Do nothing about the 2 `action` entries** — AoN data defects. If desired, filter action records whose name matches `/^[(a-z]/` and contains only activation keywords. | 0 | — | None |

### Explicitly out of scope (unchanged decisions)

- The 16 `REF_SKIP` entity/GM categories (6,575 records: creatures, hazards, kingdom/warfare content,
  eidolons, articles) remain a separate product decision.
- The 6 companion categories were re-imported earlier today and were not re-measured here.

---

## 6. Reproducing this

The analysis script lives in the session scratchpad (not the repo):
`C:\Users\r2g2\AppData\Local\Temp\claude\C--wonderers-guide\5918d0b1-bab3-4da3-a573-2dc18399e7ae\scratchpad\gapanalysis.mjs`,
emitting `gap-report.json` with the full per-record detail (AoN id, URL, traits, all source books,
near-miss app candidates) behind every number above.
