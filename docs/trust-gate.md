# The trust gate

Owner directive (Guy, 2026-09-10, verbatim): *"i cant trust them and i will go over them in the future but
for now i want to turn them off, i want to be able to turn them on in the furtur. the goal is taht now i will
have a working app. if we have implementation on all of the thing wg has then the app is palyble and because we
implemented the smae as them the implementation is trustworthy."*

Rulings taken the same day:
- Q1: the extra mechanics on records that were read in a closed batch but that Wanderer's Guide (WG) does not
  encode are OFF for now ("i will check them in the future"). So the trusted unit is the KIND on a record,
  not the record.
- Q2: deities are ON ("there isnt realy a place to mess up here and we need this").
- The print-only reading lane (records WG never had) is "later": those records are simply OFF.
- Nothing is pushed or released until the desk fixes and this gate are done.

This document is the plan. It follows the August design (memory: THE TRUST GATE census) and the rulings above.
It was reviewed by three judges on 2026-09-10; their accepted findings are folded in below and the rejected
ones are listed at the end with the reason.

## 1. What "off" means

A record whose mechanic is off still exists, is still pickable in the builder, still shows its printed text and
description, still records the player's choices, and still counts for prerequisites and feature ownership.
What it stops doing is touching the SHEET: no bonus, no proficiency, no granted spell/feat/item/strike, no
situational star, no mode payload, no stance payload, no resistance, no speed, no HP.

Three rules bound that:

- **Only a BENEFIT goes dark.** A field that can only ever cost the character stays on: `abilityFlaws`,
  `speedPenalty`, `weaknesses`, `dedicationGate` ("you cannot select another dedication feat until…"),
  `maxTakable`, `frequency`, `uses`, `limitedUses`, `choiceOptionLimits`. Turning a limit off would hand the
  player a character stronger than print, which is the opposite of what the gate is for.
- **Prose is not a mechanic.** `note` and `spellNotes` are printed text and are never stripped. The differ
  already treats `note` this way (`scripts/wg-diff.mjs:3364` filters it out of `missing`).
- **Chassis and display are not effects.** Nothing outside the effect-field list of §2 is ever touched — item
  and weapon chassis (`damage`, `acBonus`, `dexCap`, `checkPenalty`, `hardness`, `builtInRunes`), `actionCost`,
  `activationCost`, `usage`, `counters`, a class's `features`/`featProgression`/`subclass`, an ancestry's
  `vision`/`heritages`.

Never delete a record. Never strip a display-only bucket. Never strip builder structure (`choice`,
`effectChoices`, `options`, prerequisites, level, traits, rarity, source, names, descriptions). Inside a
`choice`/`effectChoices` option the gate empties the option's `grant` and leaves the option's id, label, value
and description — the picker still asks the question, the answer grants nothing (per ruling Q27,
`docs/gold-set-answers.md:287-311`, the control must SAY it is not verified; see §3).

## 2. What stays on (the ledger)

The gate is a DENYLIST, not an allowlist. This is the single most important correction from the review: an
allowlist over an undefined field universe strips every field no WG kind can name — measured in review, 18,701
of 26,745 records in `public/core.json` carry at least one such field, including weapon damage and armour AC —
and a generator bug would empty the app. A denylist fails safe: a record the generator never reaches keeps
everything.

Three tracked files:

**a. `scripts/data/trust-fields.json` — the strippable universe (hand-checked, tracked).**
The only field paths the gate may ever touch. Seeded once from the non-underscore field lists of `OUR_KINDS`
(`scripts/wg-diff.mjs:396-582`) plus the nested container paths `ourKindsOf` walks
(`scripts/wg-diff.mjs:1216-1300`: `choice.options[].grant.*`, `effectChoices[].options[].grant.*`,
`whileActive[]`, `enhancement.grant`, `resonant.*`, `passiveEffects.*`, `alternateAttributes.*`,
`grantedStrikes[]`), MINUS everything §1 protects. `OUR_KINDS._noCounterpart`
(`scripts/wg-diff.mjs:582`) is NOT in the universe: those eight (`degreeShifts`, `limitedUses`, `uses`,
`companions`, `dailyChoice`, `temporaryProficiency`, `redundantFallback`, `actionCost`) can never be credited
by any WG kind, so an allowlist would kill them all and a denylist must simply never list them. Entries are
PATHS, not bare field names, so a nested grant can be emptied without touching the option row.

**b. `scripts/data/trust-approvals.json` — the desk rulings (hand-maintained, tracked).**
Four lists, and every desk number in `work/desk-answers-2026-09-10.json` must appear in exactly one of them:
`approvals` (`{ "n": 28, "record": "items/unifying-emblem-shundar-quah", "fields": ["innateSpells"], "why": "…" }`),
`noMechanic` (the ruling changes nothing a field carries), `engine` (the ruling is code, not a record field —
#127 speed typing, #145 "allow no-damage attacks", #109 Guardian's Armor, whose class-feature record carries no
mechanical field at all), and `unruled` (the 22 numbers the file skips: 1, 2, 6, 8, 31, 33, 52, 54, 58-64, 67,
106, 122-126). No "…" endings: the guard in §5 goes red while any desk number is unaccounted for. Every ruling
that ADDS a mechanic WG lacks needs an `approvals` entry or it ships dark — the seven quah emblems, Armiger's
pick, Hardened Chassis, Flexible Spellcaster's pool, Haunting Memories, Dream Magic, Scar of the Survivor,
Web's damageless attack, Locate Lawbreakers, Molten Wit, Intuitive Crafting, Reborn Soul, Time Sense's
tradition, Breath of the Dragon, the astrolabe star, the Major aeon stone activation, the Zealot Staff pool,
Skybearer's scoped stars, Spirit Walk's resistance, Northridge's free action, Merchant's Scale, Curse of
Turbulent Moments, the six kitsune/nagaji `dailyChoice` controls, the #70/#71 `recordMarks` riders, the
armour-proficiency borrowing of #10/#26, Oatia's narrowed picker, magus + summoner 2026.

**c. `src/data/trust-ledger.json` — generated, tracked, deterministic.**
The OFF list. Two sections:
- `records`: `{ "feats/spirit-walk": ["passiveEffects.acBonus", "choice.options[].grant.skills"] }` — for each
  record, the strippable paths that go dark. A record with no entry is untouched.
- `lanes`: precomputed id lists the runtime reads without any kind logic — `situational`, `featGrants`,
  `modes`, `stances`, `engine`.
Written `JSON.stringify(obj, null, 1) + '\n'` with sorted keys and sorted arrays, stamped only with
`{ coreSha, wgSha, generator }` — no timestamp, or §5's diff-against-tracked check would go red on every run.
It lives in `src/data/` and is imported as a module (`import ledger from './trust-ledger.json'`), not fetched:
`mergeWithSeed` is synchronous and runs the instant `core.json` parses (`src/data/index.ts:642`), so a second
fetch would leave the first merge ungated, and a module import also removes the PWA offline question entirely.
Estimated ~111 KB beside `core.json` at 10.4 MB — not a size question.

**How the generator decides (`scripts/trust-ledger.mjs`).**
It walks only the 8 buckets WG is actually paired against — `WG_BUCKETS` at `scripts/lib/wg-parse.mjs:124`
(feats, classFeatures, heritages, backgrounds, items, ancestries, classes, actions). Every other bucket is ON
by construction and the gate never touches it: spells, runes, runesmithRune, familiarAbilities,
animalCompanions, specificFamiliars, followers, pets, services, vehicles, siegeWeapons, languages, conditions,
deities, companionSpecializations, companionAdvanced and the ~30 glossary buckets. (Runes matter here: the
mechanic lives on `core.runes[id]`, which the differ only merges INTO the items row for comparison and whose
own comment forbids adding it to `WG_BUCKETS` — `scripts/lib/wg-parse.mjs:132-143`.)

For each record in those 8 buckets:
1. **Per-path, not per-kind.** For every strippable path PRESENT on the record, look up the kinds that path
   maps to (`fieldToKinds`, built at `scripts/wg-diff.mjs:594-598`, plus the nested walk's own mapping). The
   path stays ON only when EVERY kind it maps to is in `theirKinds`. Expanding a WG kind back out to its whole
   field list, as the first draft did, is far coarser: one kind reaches up to 13 of our fields
   (`scripts/wg-diff.mjs:411`), so a single WG `conditional` op would switch on every star and mode the record
   carries. Per-path is what "the kind on a record" means in practice.
2. Records WG has but leaves prose-only (8,423, of which 6,255 carry a mechanic today) and records WG has no
   row for (3,920, of which 1,974 carry a mechanic): every strippable path OFF. This is the ruled behaviour and
   it is the largest visible change to a player — the census in §7 prints it in the owner's face rather than
   letting him find it.
3. Then the exemptions remove paths from the OFF list: **deities** (Q2 — on by construction anyway, the bucket
   is unpaired); **chassis** — every field on a `classes`, `ancestries` or `backgrounds` record itself is on
   (they are the character chassis, they were batched in B19-B23 and B28, and WG's per-row ops do not map to
   chassis fields; the prose list in the first draft named `hp` and `speed`, which no class record carries, and
   omitted `features`, `featProgression`, `skillIncreaseLevels`, `subclass`, `spellcasting`, `classDc`,
   `perception`, and an ancestry's `vision` and `heritages`). Heritages are NOT chassis: WG encodes them as
   ordinary rows, so they go through the per-path rule; **approvals** from file (b).
4. **Trust is every record WG encodes, batched or not** (4,168 paired records; 1,286 of them no closed batch
   has read). Decided from the directive's own words — "if we have implementation on all of the thing wg has
   … the implementation is trustworthy" — and because the WG lane is only at level 9. The census prints that
   1,286 separately, and `--batched-only` in the generator reverses it in one line if Guy wants the stricter
   reading.
5. **Lanes.** `situational` = ids whose star-carrying kind is off; `featGrants` = ids whose grant kind is off;
   `modes` / `stances` = the ids in `core.modes` / `core.stances` whose CARRIER record (same slug, or the
   record named in the mode's `feats`/`classes`/`ancestries`) is off for that kind — measured in review, 124
   ids are shared between the feats and stances buckets; `engine` = the ids in `scripts/data/trust-lanes.json`
   (§3) that are off.

**Bucket keying needs a one-line fix first.** The rows `wg-diff.mjs` emits carry no bucket
(`scripts/wg-diff.mjs:3392`; `noMatch`/`theirsUnencoded` at :3361-3362 carry only `{id, name}`), and ids
collide across buckets — the repo documents `warrior` (background + class feature,
`scripts/lib/wg-parse.mjs:146-149`), `clan-pistol` (feat + weapon, `scripts/wg-diff.mjs:3345-3348`) and "266
normalised names exist in two of our buckets" (`scripts/wg-diff.mjs:1591`). `bucket` is already in scope in
that loop (`for (const [id, rec, bucket] of wgAllRecords(core))`, `scripts/wg-diff.mjs:3357`), so add it to the
row literal and the two `continue` pushes. The generator refuses on any row it cannot place in exactly one
bucket. Lane lists are bare ids (that is how the code registries key), so an id is put on a lane's OFF list
only when EVERY bucket twin is off for that kind — fail open, never darken a trusted twin.

The generator needs `work/wg/wg-data.sql` and refuses without it. That dump is gitignored on legal grounds
(`.gitignore:103-105`), which is why the generated ledger is tracked: a clean clone — how releases are cut —
has no dump and could not regenerate one. The ledger holds our record ids and our field paths and nothing of
theirs: no WG text, ids, values or field names. **One line for Guy before step 1** (his standing rule, his
call): *ship the ledger tracked, or keep it untracked and regenerate locally?* Untracked means the gate cannot
ship at all, so the plan assumes tracked.

## 3. Where the gate sits

**One chokepoint.** `src/data/index.ts` `mergeWithSeed()` line 457 becomes
`const c = (trustGateOn() ? applyTrustGate(core, ledger) : core) as ContentDatabase;` — the gate runs on the
CORE object, before the seed, homebrew, user modes and the catalog are merged in. That single line covers both
callers (`loadContent` at :642 and `rebuildContent` at :524) and it settles three problems at once:

- **Homebrew and the player's own modes are untouched by construction** (§8's promise), because they are merged
  after the gate. No `license === 'homebrew'` test needed.
- **`applyTrustGate` must copy, never mutate.** `merge()` is a shallow spread of the bucket MAP
  (`src/data/index.ts:16-18`), so `db.feats[id]` IS the object in `cachedCore` and in `seedContent`. A
  `delete rec[field]` would corrupt the only copy, and the switch could never restore. The function returns a
  new bucket map with a shallow copy of each CHANGED record (and a copy along any nested path it edits);
  everything else is passed by reference. Measured in review at ~27 ms for the whole database, so running it on
  every `rebuildContent()` is fine.
- `loadDescriptions` keeps writing into the RAW `cachedCore` (`src/data/index.ts:620-622`) and the rebuild
  re-gates from raw, so the gate never runs over its own output.

`applyTrustGate` lives in a new `src/data/trustGate.ts` and is exported, so tests and the experience harness
call the same function the app calls. It also exports `trustOff(bucket, id)` returning the stripped paths — a
side map keyed `bucket/id`, NOT a `_trust` key stamped on the record: stamping a synthetic key onto game-data
records breaks the standing display-hygiene rule and would leak into the homebrew editor, the exporter and
every deep compare.

**Modes and stances need no engine change.** Their numbers live on their own records (`content.modes[id]`
resolved at `src/rules/play.ts:638-646`; `activeStanceEntry` at `src/rules/derive.ts:1117-1119` reads
`db.stances[id]` with no ownership test at all — the first draft's claim that "a stance only reaches a
character through a granting record, which is gated" is simply not true at runtime, and `isGated` at
`src/rules/modes.ts:585` is a VISIBILITY test, never an application test). Because those records are in the
core object, the gate strips their payload (`modifiers` on a mode; `acBonus`, `resistances`, `grantedStrikes`,
`speed`, `dexCap` on a stance) at load. The toggle and the chip still show, with the marker, and apply nothing.

**Three code surfaces the data gate cannot reach:**

- **Situational stars** (`FEAT_SITUATIONAL`, 2,821 carriers — the biggest bucket).
  `setSituationalSuppressions` is NOT the lever: it CLEARS its set on every call
  (`src/rules/situationalBonuses.ts:4020-4024`) and its one caller runs per character on every explain pass
  (`src/rules/explain.ts:586`), so anything the gate fed it would be erased the moment a sheet opened. Add a
  SECOND module-level set with its own setter, written once at content load, and consult it in `entriesFor`
  (`src/rules/situationalBonuses.ts:4027`). Two readers bypass `entriesFor` and must be routed through a new
  exported `shippedSituational(id)`: `src/rules/explain.ts:254` and `src/sheet/CompanionsTab.tsx:589`. The
  data-side `situational` field (152 records) is handled by the ledger like any other path.
- **The grant registries.** `FEAT_GRANTS` (`src/rules/featGrants.ts:753`) and the seven tables in
  `src/rules/featFeatGrants.ts` are read ~15 times in `src/rules/build.ts` and ~10 times in
  `src/builder/Builder.tsx`. Gate the APPLY side only: a new exported `grantsFor(id)` in `featGrants.ts`
  returns undefined for an id on the `featGrants` lane, and `build.ts` uses it everywhere it used to index the
  table. `Builder.tsx` keeps reading the raw table, so every picker still renders and still records the pick
  (§1) — with the marker, per Q27. A guard greps `src/rules/build.ts` for a raw `FEAT_GRANTS[` and goes red.
- **Hard-coded engine lanes keyed by record id.** Not a hunt — the starting inventory, found in review:
  `src/rules/derive.ts` 1534-1543 (BODY_RUNE_EXCLUDED), 1571-1599 (`sanctified-relic`), 2105
  (`cat-raise-shield`), 2443 (`inventor-initial`), 3168 (`deadly-simplicity`), 3322
  (`cutting-heaven-crushing-earth`), 3411-3413 (weapon specialization trio), 3430-3431 (runic optimization),
  3686/3701 (`sneak-attack`), 3727 (`precision`, `hunt-prey`), 3766-3782 (RAGE_DAMAGE), 3798-3804
  (`barbarian-dedication`, `raging-thrower`), 5129 (`powerful-fist`); `src/rules/build.ts` 4398, 4923, 6381,
  7628, 7816, 8423/8426, 8441, 8486, 8510, 8522, 8797, 9001, 9421-9423, 9458, 9941, 9995. Each id goes into a
  tracked `scripts/data/trust-lanes.json` with its lane and its kind; the reader checks the `engine` lane
  through the same helper. `scripts/trust-lanes-check.mjs` in `npm run verify` greps `src/rules/*.ts` for
  quoted core.json record ids and goes red on one that is not in that file — so the next such lane cannot be
  added ungated.

**Two corrections to the first draft's map.** The GM edit sheet's local content copy is NOT in `src/App.tsx`;
it is `src/sheet/GmEditSheet.tsx:64`, seeded from the already-gated `content` prop, so it needs no gate call of
its own (its `addCustomItem`/`saveModeDef` at :126-134 spread into that gated copy, which is right). And
`applyOverrides` (`src/rules/build.ts:2934`) runs AFTER the gate on every path
(`src/App.tsx:599`, `src/builder/Builder.tsx:227`, `src/sheet/GmEditSheet.tsx:117,147`): an override that
patches a stripped field restores it. That is correct and deliberate — an override is the player's own
explicit rule-breaking, exactly like homebrew — and the marker clears for a record an override has patched.

**The marker.** One shared component, rendering the "not yet verified" line from the side map, in exactly five
places: `src/sheet/FeatsTab.tsx`, `src/sheet/FeatDetail.tsx`, `src/sheet/ItemDetail.tsx`,
`src/builder/shared.tsx` (ChoiceDetails, so a gated picker says why it does nothing) and
`src/sheet/DescriptionModal.tsx`.

The gate is applied ONCE at content load, not per derive, so the sheet's cost is unchanged.

## 4. The switch

`src/data/prefs.ts`: `trustGate: boolean`, default `true`. Settings → a card "Verified rules only" with one
paragraph in plain words and the census numbers (on / off).

Flipping it must do two things, not one: `setContent(rebuildContent())` — the pattern already at
`src/App.tsx:676` — AND `rebuildRoster(roster, content)` followed by `noteDerivedRefresh(next)`, the launch
pattern at `src/App.tsx:156-157`. Every saved character carries a DERIVED cache (`src/data/rebuild.ts:17-29`);
without the roster rebuild only the open sheet changes and every other character keeps its pre-flip numbers.
⚠ `src/data/rebuild.ts:14-15`: the result must be registered as a derived refresh, never as an edit — two
revert-loop incidents are on record for this path.

Prefs are cloud-synced (`src/data/prefs.ts:69`), so a flip on one device reaches the user's others. App
subscribes with `subscribePrefs` and runs the same two rebuilds when `trustGate` changes, so a synced flip
takes effect without a relaunch (`reloadPrefs` at `src/data/prefs.ts:74-77` already notifies subscribers).
Cloud-pulled rosters are re-derived on the receiving device (`src/App.tsx:222-229`), so the gate stays a local
view. A campaign teammate or GM view shows whatever the PUBLISHING device derived; v1 does not touch the sync
path, and that is the accepted consequence.

No per-record switch in v1 (the ledger is how a record comes back on, through a batch or a print-read packet;
per-character Overrides remain the escape hatch).

## 5. Tests and guards (every one adversarially confirmed by a verifier)

- `test/trust-gate.test.ts`: (a) a we-only path on a WG-encoded record is stripped, the WG-encoded path on the
  same record survives; (b) a deity and a class record keep everything; (c) a no-WG record keeps text, choice
  structure, option labels and prerequisites, and loses every strippable path — including a nested
  `effectChoices[].options[].grant`, whose option row survives; (d) an approvals entry brings a path back;
  (e) **round trip**: deep-snapshot the parsed core, gate on, gate off, deep-equal against the snapshot — and
  assert the ungated source object was not mutated (the first draft's wording would have passed even with an
  in-place delete); (f) the side map lists exactly the stripped paths and no record carries a new key; (g)
  costs and prose survive: `abilityFlaws`, `frequency`, `uses`, `dedicationGate`, `note`, `spellNotes`.
- `test/trust-gate-registries.test.ts`: a `FEAT_GRANTS` carrier that is off grants nothing while its picker
  still renders; a star on an off carrier does not render on the sheet, in `sheetLoreKeys`, or on a companion;
  a mode/stance on an off carrier applies nothing; with the gate off all four work.
- `test/trust-gate-smoke.test.ts`: build six characters with the gate ON — a caster, a martial, a companion
  class, a kineticist, an alchemist, an eidolon summoner — at levels 1, 5 and 12; assert no throw (note
  `src/data/rebuild.ts:24-27` swallows a throw and keeps the stale sheet, so a silent regression is possible)
  and unchanged HP, AC, saves, Perception, class DC and class-feature count, since chassis is all-on. This one
  test catches a polarity mistake, a missing bucket and a chassis omission in one run.
- `test/_content.ts` gains `content({ trustGate: true })` which calls the REAL `applyTrustGate` on the parsed
  core before its own merge. This works because the gate runs on the core object: the test path and the app
  path gate the same thing even though `test/_content.ts:13-42` re-implements the merge and never calls
  `mergeWithSeed`. Add a comment there saying so. The rest of the suite keeps building content WITHOUT the
  gate — the engine and its tests stay complete.
- `scripts/trust-ledger-check.mjs` in `npm run verify`, in two halves so a clean clone stays green: the
  always-runnable half checks that every ledger key resolves to a real record in `public/core.json`, every
  approvals entry names a real record and real paths, every desk number in
  `work/desk-answers-2026-09-10.json` has exactly one disposition in `trust-approvals.json`, deities and the
  three chassis buckets are all-on, no path outside `trust-fields.json` appears in the ledger, no path that
  `fieldToKinds` knows is missing from `trust-fields.json`, and the stamped `coreSha` matches. The
  regenerate-and-diff half runs only when `work/wg/wg-data.sql` is present and prints "skipped (no
  wg-data.sql)" otherwise.
- `scripts/regen-durability-check.mjs` gains one invariant: the ledger's `coreSha` must match
  `public/core.json`. `npm run data` does not regenerate the ledger (it would need the 50 MB dump and the chain
  must stay runnable everywhere), so this is what catches a regen that added, renamed or dropped records.
- `scripts/wg-regate-all.mjs`: add the ledger's sha to `dataHashes()` (`scripts/wg-regate-all.mjs:43-47`), or a
  green recorded before the gate existed is resumed as a green after it. Regate-all itself stays a DATA proof
  and runs ungated: `scripts/wg-batch-gate.mjs:53` reads `public/core.json` off disk, which the gate never
  changes, so a "gated regate" would compare exactly the same bytes. The first draft's claim that regate-all is
  the end-to-end proof of the gate is withdrawn.
- The end-to-end proof is the experience harness, which renders through the real builder: `wg-experience.mjs`
  gains `--gated`, threaded to `test/wg-experience.harness.test.tsx` via `content({ trustGate: true })`. It
  plays 20 randomly chosen WG-encoded records and 20 untrusted ones with the gate ON: the first 20 must be OK,
  the second 20 must show the marker and no sheet effect.

## 6. Pipeline hooks (so the next batch keeps the ledger true)

- `scripts/wg-batch-run.mjs --stage close` regenerates `src/data/trust-ledger.json` (the stage exists —
  `ORDER` at `scripts/wg-batch-run.mjs:45`). A closed batch therefore turns its WG-encoded kinds on the day it
  closes.
- `scripts/wg-batch-commit.mjs`: add `src/data/trust-ledger.json` and `scripts/data/trust-approvals.json` to
  `BATCH_EVIDENCE` (`scripts/wg-batch-commit.mjs:113`), the always-staged-when-changed set that already feeds
  `staged` at :115-122. NOT `KEEP` — every entry there is a per-batch-TAG regex (:85-98) and a fixed path would
  never match.
- The print-read lane (later) adds a `print-ledger` source to the generator: a record read against print gets
  its paths listed there. That is also how the 6,255 prose-only and 1,974 no-WG records come back.

## 7. Order of work

1. **Bucket + generator + files (data only, no runtime change).** Touches `scripts/wg-diff.mjs` (add `bucket`
   to the emitted rows), `scripts/trust-ledger.mjs` (new), `scripts/data/trust-fields.json` (new),
   `scripts/data/trust-approvals.json` (new), `src/data/trust-ledger.json` (generated).
   Then the CENSUS, reviewed by Guy in one line:
   `trust gate: N fully on · N partly on · N off · N stars suppressed · N code lanes gated · deities all on · ledger NNN KB · coreSha ok`
   plus four small review files, not prose: off-counts by bucket; every record that ends FULLY dark while
   carrying a mechanic (measured in review: ~550 paired records share no kind with WG at all, 259 of them
   carrying real mechanics — `feats/spirit-walk` is one, and Guy ruled on it the same week, so it needs an
   approvals entry); the 1,286 WG-encoded records no closed batch has read; the 22 unruled desk numbers.
   The one owner line from §2 (tracked ledger, yes/no) goes with this.
2. **Runtime gate + switch + Settings card.** `src/data/trustGate.ts` (new), one line in
   `src/data/index.ts:457`, `src/data/prefs.ts`, the Settings card, the subscribe-and-rebuild wiring in
   `src/App.tsx`.
3. **Code surfaces.** `src/rules/situationalBonuses.ts` (second set + `shippedSituational`),
   `src/rules/explain.ts:254`, `src/sheet/CompanionsTab.tsx:589`, `src/rules/featGrants.ts` (`grantsFor`),
   `src/rules/build.ts` (use it), `scripts/data/trust-lanes.json` + the engine-lane readers in
   `src/rules/derive.ts` and `src/rules/build.ts`.
4. **Marker.** One component, five files (§3).
5. **Tests and guards.** `test/trust-gate.test.ts`, `test/trust-gate-registries.test.ts`,
   `test/trust-gate-smoke.test.ts`, `test/_content.ts`, `scripts/trust-ledger-check.mjs`,
   `scripts/trust-lanes-check.mjs`, `scripts/regen-durability-check.mjs`, `scripts/wg-regate-all.mjs`,
   `scripts/wg-experience.mjs`, `scripts/wg-batch-commit.mjs`, `scripts/wg-batch-run.mjs`.
6. **Then the desk fixes (a separate batch), then push + website + GitHub together.** The approvals file is
   written in step 1 with every add-a-mechanic ruling already entered, so a desk fix that lands later is live
   the moment it lands instead of shipping dark.

## 8. Non-goals (v1)

Per-record switches; a UI to browse what is off; gating the tracker; gating homebrew (homebrew is the player's
own, always on — guaranteed by gating the core object before the merge, §3); changing the cloud-sync or
campaign publish path.

## Rejected review findings

- **Make the ledger's fourth trust source the closed batches' parity artefacts** (a record read in a batch
  keeps whatever the reading confirmed). Rejected: Q1 says the opposite in as many words — "on a batched record
  only the kinds WG encodes … stay on". Print-driven extras come back through `trust-approvals.json`, and the
  fully-dark review file in step 1 makes sure none is lost silently.
- **Derive the ledger from the tracked batch parity files instead of WG's dump** (to keep the dump out of the
  build). Rejected: it would darken every WG-encoded record no batch has read, which Q1 does not ask for; the
  batch pipeline already requires the dump (`scripts/wg-experience.mjs:53`). The GPL point is answered by what
  the ledger contains and by the one owner line in §2.
- **Restrict source 1 to records a closed batch has read** (2,882 instead of 4,168). Rejected on the
  directive's own words — trust follows "we implemented the same as WG". The census prints the 1,286 affected
  records and `--batched-only` reverses it in one line if Guy prefers the stricter reading.
- **Gate stances in `activeStanceEntry` / `activeStanceDef` and modes in `play.ts`.** Rejected in favour of
  stripping the stance and mode RECORD payloads in the one data gate: same effect, no engine edit, and the UI
  keeps showing the chip and toggle as §1 requires.
- **Build published/GM sheets ungated, or move `trustGate` out of the synced prefs bundle.** Rejected for v1:
  the sync path has caused two revert loops, cloud-pulled rosters already re-derive locally
  (`src/App.tsx:222-229`), and prefs are the app's one settings bundle.
- **Add `--gated` to `scripts/wg-batch-gate.mjs` and prove the gate with regate-all.** Rejected: those
  comparers read `public/core.json` directly and the gate never changes that file, so a gated run compares the
  same bytes. The gate's end-to-end proof is the experience harness (§5); regate-all stays the data proof.
- **Widen the service-worker cache rule for the ledger** (`vite.config.ts:195`). Rejected: the ledger is
  imported as a module, so there is no fetch to cache and no stale-pairing risk.
- **Generate `trust-approvals.json` automatically from `work/desk-answers-2026-09-10.json`.** Rejected: an
  approval is a judgement about which FIELDS a ruling turns on, and that cannot be read out of prose. The
  completeness CHECK is generated instead, which is where the risk actually was.
- **Stamp `_trust` on each gated record.** Rejected: side map instead (§3) — a synthetic key on a game-data
  record breaks the display-hygiene rule and leaks into the homebrew editor and the exporter.
- **Add the ledger to `KEEP` in `wg-batch-commit.mjs`.** Rejected: `KEEP` is per-batch-TAG regexes
  (:85-98); `BATCH_EVIDENCE` (:113) is the always-staged-when-changed set.
