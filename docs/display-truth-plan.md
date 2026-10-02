# Display truth — the plan (2026-10-02, diagnosis workflow wf_aa917a46-e22: 8 refuters, 3 designers, 2 judges, 1 synthesizer, all Opus; Fable judged the synthesis)

Status: PLAN ONLY. Nothing below is built. Owner go + the two decisions in section 7 are pending. The measuring scripts the
numbers came from are in the session scratchpad; promote them under scripts/ when building (G1).

This plan is built on the winning plan, INSTRUMENT FIRST. It takes in every graft both judges asked for and leaves out every claim a judge marked wrong. Every number comes from a refuter's run, cited by script or by file:line. Nothing here has been built yet.

## 1. What the owner reported, corrected

- **Halfling Luck.** The Frequency and Trigger lines are missing only from the Feats-tab popup and the stat "full text" popup. The pinned popup, the builder popup and the Main-tab action popup all show them. Without the trigger, the Feats-tab popup reads "Activate ⟨free⟩", as if the feat could be used at any time. The class is wider than one feat, and it is a regression that started in v0.1.16 (commit 061f099, 2026-07-24). In that popup it affects:
  - about 1,647 feats that lose a Trigger, Frequency or Requirements line;
  - 72 class features;
  - 31–34 built-in actions on the Main tab, including Aid, Raise a Shield, Grapple and Treat Wounds (since v0.1.29, commit 29a2d95);
  - on items: the Activate line on 1,828, Craft Requirements on 1,075 and Access on 444.
- **Buzzing Servants.** This is a data problem, not a display problem. Our old Foundry importer threw away the "sustained" flag (scripts/import-core.mjs:1677), and the value has been carried forward ever since. The same popup also shows an "Area 5-foot square" row that the printed book does not have. Across all spells:
  - 223 spells lost the word "sustained";
  - 289 spells show at least one wrong stat row;
  - 291 spells are missing a line the book prints;
  - 574 spells in all (28%) are wrong or missing on at least one line.
- **Cleric Doctrine.** The cause is that the record was filed under the whole subclass page during migration, and a wider class has the same cause:
  - 73 class features show a page that is not their own (the census method counts 71);
  - for 27 alchemist and Masterful Hunter variants, the player's own benefit is missing entirely, not just buried;
  - Anathema (Cleric) shows the druid's page;
  - 4 feats show a different feat's rules;
  - about 434 items show their whole family page.
  - The builder never names the doctrine benefit at all.
- **Approximate.** 145 spells carry a stat line in the description instead of the stat rows. Beyond that:
  - 216 more spells show their whole stat block as run-on prose;
  - some of those lines are themselves damaged, for example Elemental Blast's "Area , , or";
  - 52 spell-attack spells show no "Defense AC" at all.
  - The pinned popup of the same spell is already right.

## 2. The habit

The same printed line exists in up to three copies: the Archives page tree, a stored field, and the description text, which is mostly old Foundry text. Each popup picks one copy on its own, and nothing checks that what reaches the screen equals what the page prints. The existing guards compare fields with fields, and two of them pass by construction: ast-provenance-check compares the tree's stamp with the record's aonId, and classfeature-page-check compares the badge with class content.

## 3. The guard

**Name: display truth.** It is built from three pieces in two commits, and it lands before any fix.

**Piece 0: one predicate module, with no behaviour change.**
- `src/sheet/astVisibility.ts` (plain .ts, because jiti cannot parse .tsx and AstRenderer.tsx imports css and context) takes over the following from AstRenderer.tsx and useAst.ts:
  - `META`, `labelOf`, `isMetaP`, `isSourceP`, `STAT_LABELS` and `isMetaishBlock` (AstRenderer.tsx:167-189);
  - `variantSection` and `withoutItemLists` (useAst.ts:31-48, 73).
- AstRenderer and useAst import from it, so the renderer and the check share one predicate and there is no copy that can drift.
- It adds three new functions:
  - `pageLabelLines(tree)`: every bold-labelled line on the page as `{label, text, where: 'header'|'body'}`. It looks inside column and row blocks, splits inline-only stat rows by their bold label, and includes lines after the first rule.
  - `normLabel(label)`, using one alias table: Target/Targets/Target(s), Saving Throw→Defense, Requirement(s), Prerequisite(s), Tradition(s), AC bonus/AC Bonus, Dex cap, Check penalty, Speed penalty, HP/Hit Points/BT, and Worn slot↔Usage. Plain "Target" appears on 915 spell pages, "Saving Throw" on 152 and "Target(s)" on 84.
  - `visibleLabelLines(tree, printed)`: the lines the renderer will draw.
- Each detail view's stat rows move into an exported pure function that the component itself renders: `itemStatRows(item, content)` (taken from ItemDetail.tsx:462-470), `featStatRows`, and `spellStatRows`. A surface's "printed" set is therefore derived from the same array that draws the rows, and only from labels that have a value. Nobody keeps a hand-written table.
- Proof of no change: renderToStaticMarkup is byte-equal before and after, on a seeded sample of 600 records.

**Piece 1: the full-corpus ledger in `npm run verify`.**
- `jiti scripts/display-truth-check.mjs`, with helpers `scripts/lib/printed-lines.mjs` and `scripts/lib/shared-page-census.mjs`. The census is promoted from the refuter's scratch script, whose port was checked identical to variantSection on 18,666 slugs.
- The expected lines come from the shipped `public/ast/*.json.gz`, so S1, S2, S3 and S5 run on any clone. Only S4 needs the local mirror; without it, S4 is skipped and the script prints a line saying so, as spell-print-lines-check already does.
- **Verdict per (surface, record, label):** OK (shown exactly once, equal after normalisation), MISSING, DIFFERS, DUPLICATED (shown in both the stat rows and the body), or EXTRA (we show a line the page does not print, such as Buzzing Servants' Area).
- **The five sections:**

  | Section | What it lists | Today |
  |---|---|---|
  | S1 hidden | A page label line that no popup region shows | FeatDetail feats, class features, ACTIVITIES, items, StatDetailModal |
  | S2 not-own page | One definition: the census rule. The rendered tree is identical to a differently named record's tree, or lacks the record's own text, or is another record's page. | 529 (items 434, classFeatures 71, feats 15, familiarAbilities 6, actions 1, conditions 1, deities 1); the 2 extra class features found by content identity are classified when the baseline is taken |
  | S3 placement | A spell stat label that renders in the prose instead of the stat rows | 145 bold-preamble spells + 216 scraped headers |
  | S4 field vs print (mirror needed) | Rows that differ from print or are missing. The ~50 hand verdicts from classify-spell-stat-lines.mjs carry over as a keyed JUDGE map. | 307 wrong rows on 289 spells; 291 spells missing a line |
  | S5 identity | The pinned popup or builder ChoiceDetails resolves a different record's tree | pinned: 6 feats + 28 class features; ChoiceDetails: 16 feats + 96 class features (the class-feature→own-action-page rows get JUDGE entries) |

- **Baseline and ratchet.** The baseline is `scripts/data/display-truth-baseline.json`, using the two-way rule from spell-print-lines-check and reprint-check: a new offender fails ("fix the record or the surface, never the baseline"), and a listed id that is now right also fails ("remove it, the list only shrinks"). Every fix commit lowers the baseline in the same commit. Flags: `--list` and `--pending spec.json`. Every count in this plan is a reference, not the baseline; the baseline is whatever the instrument itself measures on the day it lands. Lens 1's rendered-block count of 4,996 feats includes Archetype and spoiler lines; the label-based count is about 1,857 feats losing any label. The activity count is 31 to 34 and is likewise settled by the instrument.

**Piece 2: the rendered test, which validates the ledger against the screen.**
- `test/display-truth.test.tsx` runs under jsdom and serves the tracked .gz through the fetch stub the refuters used. It runs only through `node scripts/vt.mjs`, and it is never part of verify.
- **(a) Corpus agreement.** Every record that has a tree is rendered through `DescBody` with the exact props its surface passes. Its stat region comes from the exported stat-row function. For every record, the ledger's verdict must equal the verdict read off the DOM, with zero disagreements. This works because useAstNode seeds synchronously from `getCachedAst` once the store is primed (useAst.ts:102), so the tree draws on the first pass. The full detail components are NOT rendered over the whole corpus; the refuters' corpus passes rendered AstRenderer only, so that cost is unproven.
- **(b) Seeded sample through the player's real path.** `mulberry32(20261002)`, 60 records per surface:
  - FeatsTab row click → FeatDetail, for a built character of each class;
  - inventory row → ItemDetail;
  - SpellsTab row → SpellDetail (exported for the test);
  - a Main-tab action click, both ACTIVITIES and feat actions;
  - StatDetailModal full text;
  - PinStar → DescriptionModal;
  - Builder ChoiceDetails.

  Each assertion:
  - the popup passes the same astKey and astId as the corpus row and shows the same text;
  - each label appears exactly once across the stat and prose regions;
  - one record shows identical stat lines on FeatDetail, the Main-tab action popup, DescriptionModal and StatDetailModal.
- **(c) The owner's four cases, pinned by name.** These assertions must flag each case first; each flips in the commit that fixes it:
  - halfling-luck: Frequency and Trigger in S1;
  - buzzing-servants: Duration in S4, Area as EXTRA;
  - second-doctrine-cloistered-cleric in S2;
  - approximate: Area in S3.
- **(d) Mutation proofs.**
  - The old boolean hide behaviour, kept only as a test fixture, must make the test report halfling-luck's two lines missing.
  - A synthetic tree with a sibling section appended must trip S2.
  - Re-adding the whole-column drop must fail the rendered test while the pure ledger stays green. That proves the rendered half is what catches a component bypassing the shared predicate.

**Blind spots (written in the script's header):**
- Only labelled lines and "is this the record's own page" are checked. Words inside a paragraph are not, apart from the hole shapes dropped-inline-check knows; F7 adds comma-runs to those.
- Matching is by substring, so a dropped line whose text appears elsewhere on the page counts as kept.
- The Archives page is taken as true.
- A record linked to the wrong printing passes, because print is read through that record's own link.
- Heightened and calculated numbers are not checked.
- Records with no page tree are checked only for their own text being shown: 25 feats, 199 class features, all 336 heritage rows (markdown path) and homebrew.
- jsdom applies no CSS, so the cut-off one-line row preview counts as shown.
- The builder's picker lists and the tracker app are not covered.

## 4. The fixes

| id | what | kind | files | refuter test | risk |
|---|---|---|---|---|---|
| G0 | Move the drop rules, variantSection and withoutItemLists into `astVisibility.ts`; export the stat-row functions and `SpellDetail`. No behaviour change. | guard (prep) | src/sheet/astVisibility.ts, AstRenderer.tsx, useAst.ts, ItemDetail.tsx, FeatDetail.tsx, SpellsTab.tsx | Byte-equal renderToStaticMarkup on 600 seeded records; bug-popup-divider, bug-inline-glyph and ast-provenance-render tests pass unchanged. | Low. A miss shows up as a byte difference. |
| G1 | The ledger (S1–S5 with OK/MISSING/DIFFERS/DUPLICATED/EXTRA), its baseline, and the rendered test (corpus agreement, seeded sample, owner cases, mutation proofs). | guard | scripts/display-truth-check.mjs, scripts/lib/printed-lines.mjs, scripts/lib/shared-page-census.mjs, scripts/data/display-truth-baseline.json, test/display-truth.test.tsx | The four owner cases appear as offenders; the mutation cases go red; zero ledger/DOM disagreements over the corpus; the check is green against its own baseline, and green with S4 skipped when the mirror is absent. | The baseline is measured on the other lane's dirty public/core.json and must be re-stamped when that lane commits. The verify line in package.json (dirty with that lane's hunk) is held until then. Suite time under the heavy lock: measure it in this commit. |
| F1 | **RC-A.** Delete `hideMeta` from AstRenderer's prop type, so `npx tsc --noEmit` lists every caller, and replace it with `printed: ReadonlySet<StatLabel>` from the surface's stat-row function. Changes: column and row are no longer dropped whole; they recurse (isMetaishBlock deleted). Inline-only rows are filtered per bold-label segment (AstRenderer.tsx:396; 5,378 such rows in item headers). A META p is dropped only when its label is in `printed` and it sits before the first rule. Spoilers and PFS Notes render dimmed, as in the pinned popup. Source shows dimmed, as in the pinned popup (decided: then the detail popup equals the pinned popup minus what the stat rows print, with no exception). The AoN navigation section "… leads to..." (982 feat trees) is dropped in bodyOnly. FeatDetail lifts `useAstNode` itself (today only DescBody calls it); when a tree exists, FeatDetail stops printing its Prerequisites field row, so the page's own wording shows (11 empty fields, 102 worded differently; print wins, R12). The new prop is wired through DescBody (DescBody.tsx:106), ItemDetail, the MainTab popup (:910) and StatDetailModal (:235). | display-code | src/sheet/AstRenderer.tsx, astVisibility.ts, DescBody.tsx, FeatDetail.tsx, ItemDetail.tsx, MainTab.tsx, StatDetailModal.tsx, test/bug-popup-divider.test.tsx, test/display-truth.test.tsx, baseline | Rendered: FeatDetail(halfling-luck) shows "Frequency once per day" and "Trigger You fail a skill check or saving throw" exactly once; FeatDetail(shield-block) shows its Trigger; FeatDetail(bellflower-dedication) shows Prerequisites once, worded "Charisma 14"; FeatDetail(azata-magic) shows Prerequisites; ItemDetail(healing-potion) shows Activate and exactly one Price; a weapon and an armor popup show Hands, Damage, AC Bonus and Dex Cap once each; the Aid popup shows Trigger and Requirements; the-distant-grasp shows its Amp text; no body contains "leads to...". S1 drops to the residue. bug-popup-divider.test.tsx:61-68, 148-157 and 163-178 are re-pointed, each with `// batch dt1 premise: <AoN doc id> "<clause>"` (the form PREMISE_RE accepts, scripts/test-flip-audit.mjs:51), citing gold-set principle E (docs/gold-set-answers.md:34, 120-122). | Popups get longer: that is what the page prints. A label missing from the alias table shows twice; the exactly-once corpus assertion catches it. |
| F1b | Move feat actions and class-feature actions on the Main tab (MainTab.tsx:358-375) onto the same tree path, so one record reads the same on the Main tab and the Feats tab. 231 feats whose markdown lacks the bold label are fixed by this. | display-code | src/sheet/MainTab.tsx, test/display-truth.test.tsx | Halfling Luck shows identical stat lines in the Main-tab popup, FeatDetail and DescriptionModal; rise-up and swift-support show their printed Trigger/Requirements. | Low once F1 is in. |
| F4 | **RC-D and the display half of RC-B.** SpellDetail's rows come from the page. `pageStatLines(tree)` returns the header lines with the alias vocabulary: Cast, Trigger, Requirements, Cost, Secondary Casters, Primary Check, Secondary Checks, Range, Area, Targets, Duration, Defense, in printed order. Cast keeps the field's glyph and cast-at chip; the heighten suffix "(→ N-foot kind)" is appended to the page's Area row. EXTRA rows (ours only) are not shown when a tree exists; the field stays for the engine. The field fallback applies only when there is no tree, or the tree is not a spell/ritual page (7 + 8 records). The body stays markdown (injectDamageArrow needs the string) and goes through `stripPrintedPreamble()`, which removes the leading bold lines and the scraped "Name / Source … pg. N" header only for labels the rows printed. Rows show a loading placeholder until the tree loads. | display-code | src/sheet/astVisibility.ts, src/sheet/SpellsTab.tsx, test/display-truth.test.tsx, baseline | Rendered SpellDetail: approximate has "Area 1 cubic foot" in .sd-stats and no "Area" in .sd-desc (cantrip chip still shown); buzzing-servants has "Duration sustained up to 1 minute" and no Area row; elemental-blast's Area reads "10-foot-radius burst, 30-foot cone, or 60-foot line"; ignition shows "Defense AC"; a ritual reads Targets via "Target(s)"; a legacy spell reads Defense via "Saving Throw"; anathematic-reprisal has its Trigger in .sd-stats; borrow-time's body does not start with "Borrow Time Source"; a heightened fireball still computes the suffix. Control: a stubbed no-tree spell shows the old field rows. S3 = 0 for spells with a tree. | Until F8 the screen (print) and the engine fields (filters, heighten arrow) can disagree; S4 keeps that counted. Note: in the shipped trees, Cast and Trigger are separate paragraphs (0 of 10,423 spell header paragraphs hold two bold labels), so no multi-label split is needed for spells. |
| F5 | **RC-C, code half.** variantSection also matches: the slug without a leading "aon-"; the same words in any order (of/the dropped); and a unique level-2 section whose words are a subset of the record name, only when the page title equals the record's bracketed qualifier. Each match is accepted only if exactly one section qualifies. | display-code | src/sheet/astVisibility.ts, scripts/lib/shared-page-census.mjs, test/display-truth.test.tsx, baseline | Census run before and after: S2 drops by exactly 290 (260 items + 30 implement benefits), and every record that was right keeps a byte-identical cut (0 right→wrong). Rendered: aether-marbles-greater lacks "Lesser Aether Marbles"; adept-benefit-amulet lacks "Paragon Benefit"; aon-1st-rank-scroll lacks "2nd-rank Scroll"; 1st-rank-scroll is unchanged. | False cuts. Unique-only keeps the 4 ambiguous items uncut. |
| F6 | **RC-C fallback.** `scripts/not-own-page.mjs` generates `src/data/not-own-page.json`: the S2 residue after F5 (41 class features, 15 feats, 6 familiars, about 177 items, 3 others). For a listed id, useAstNode returns no tree, so every popup falls back to the record's own description. A record joins the list only if its description passes at least 60% own-sentence coverage against its mirror section, checked on ALL listed records, not a sample. A record that fails stays on its page and in the S2 baseline. The ledger fails if the file and the census differ in either direction. | display-code | scripts/not-own-page.mjs, src/data/not-own-page.json, src/sheet/useAst.ts, scripts/display-truth-check.mjs, test/display-truth.test.tsx | Rendered: second-doctrine-cloistered-cleric (FeatDetail and search popup) contains "Fortitude" and not "Final Doctrine (19th)"; field-discovery-toxicologist contains "poison resistance"; masterful-hunter-flurry contains its multiple-attack-penalty clause; anathema-cleric has no "druids"; quick-recovery has no "Kingdom"; the-harder-they-fall has no "Titan Wrestler". Delete an id → red; add a right id (deity-cleric) → red as stale. | The fallback text is old Foundry text, not print-checked word for word; the coverage gate is the brake. Generated file: never hand-edit it. |
| F2 | Our own lines reach the popup. withPicks (FeatsTab.tsx:108-135) stops appending "Your choice", the Principle A/C markers and the record `note` to entry.description. FeatEntry (declared at src/sheet/FeatDetail.tsx:12) gets `ours: {kind, text}[]`. FeatDetail renders it on both paths and the PinStar node (FeatDetail.tsx:89) carries it too. The row preview keeps the marker text. Homebrew feats get their first reader for the frequency, trigger, requirements and access fields (types.ts:3294-3307, written by homebrewSchemas.ts:226-228), shown only when no page line carries that label. | display-code | src/sheet/FeatsTab.tsx, src/sheet/FeatDetail.tsx, test/batch001-surfaces.test.tsx, test/display-truth.test.tsx | Sorcerer 3 with ancestral-blood-magic: the Bloodline popup AND its pinned popup show the marker (today: popupHasMark=false). batch001-surfaces.test.tsx:175 moves from string to screen, with a premise citation. A homebrew feat with trigger "X happens" shows "Trigger X happens"; halfling-luck still shows Trigger once. caustic-nectar shows its note. | About a dozen FeatEntry builders; tsc and a grep for withPicks find them. |
| F3 | Popup identity. The PinStar node carries `key` and `slug` (DescriptionModal.tsx:42 already prefers `slug` over the title), and ChoiceDetails (src/builder/shared.tsx:115-152) passes the bucket and id it already receives. | display-code | src/sheet/FeatDetail.tsx, src/builder/shared.tsx, test/display-truth.test.tsx, baseline | Pinned zombie-horde-impossible-magic has no "Clockwork Reanimator"; ChoiceDetails(feats, cascade-countermeasure) renders the feat, not the spell; pinned weapon-expertise-magus renders the magus slice. S5 drops to the JUDGE residue. | Pins saved earlier keep the name lookup until re-pinned. |
| F3b | Builder: once a subclass is chosen, levelGrants (src/rules/build.ts) lists the variant `${featureId}-${subId}`, the rule FeatsTab.tsx:191 uses, so the level-3 Details names the actual benefit. | display-code | src/rules/build.ts | Builder harness: cloistered cleric, level-3 Details contains "Fortitude"; with no subclass chosen it still lists the generic record. verify-characters, grant-reach-check, duplicate-pick-check and the Gate 9 experience harness stay green. | levelGrants feeds grant reach and duplicate checks; this is its own commit. |
| F7 | Guard gaps. dropped-inline-check.mjs gets a comma-run hole pattern with its own shrink-only baseline (today it reports 0 while shadow-blast "Choose , , , …" and elemental-blast "Area , , or" ship). spell-print-lines-check.mjs stops skipping rituals (20 durations and 2 Requirements are unguarded) and defers equality to S4. ast-provenance-check's header says it is green by construction for shared parents and that S2 is the real check. | guard | scripts/dropped-inline-check.mjs, scripts/spell-print-lines-check.mjs, scripts/data/spell-print-lines-baseline.json, scripts/ast-provenance-check.mjs | dropped-inline-check lists shadow-blast and elemental-blast and fails on a scratch copy with one more comma-run; spell-print-lines-check lists planar-displacement and ravenous-reanimation and fails when one is removed from the baseline. | dropped-inline-check.mjs is dirty with another lane's edit, so this waits for that lane's commit. |
| F8 | **RC-B data half, regen lane.** spellFacets() (scripts/lib/aon-facets.mjs:1138, merged at :1227, wins over `...old` at import-core-v2.mjs:876) emits duration, area, range and targets from the export doc the importer already holds. Rules: read the `*_markdown` twins where present, so links survive; unwrap {{rules}} templates; include rituals and their "Target(s)" label; emit `defense:'ac'` for "Defense AC" (52 spells); refuse the 8 non-spell aonIds. It fills or replaces ONLY where print has a value: the 16/23/24/25 values print lacks are never emptied (UNKNOWN ≠ EMPTY). The stale comment at :963-967 and MIGRATION.md:495 are fixed. Heightening values stay out of scope. Prose restores for shadow-blast and elemental-blast go in as apply-parity-fixes rows in this same lane, citing their spell-NNNN. | importer+regen | scripts/lib/aon-facets.mjs, MIGRATION.md, scripts/data/effect-backfill.json (via apply-parity-fixes only), baselines, src/data/trust-ledger.json | After `npm run data`, read its output from the top and check the final "wrote" lines. buzzing-servants.duration === "sustained up to 1 minute"; S4 falls to the JUDGE residue; every ours-only id still has its value; the count of fields that had a value before and are empty after is 0; test/filter-values.test.ts:43 still gives 60 s; regen-durability-check, refresh-loss-check and overlay-durability stay green. Re-stamp the trust ledger (wg-diff → trust-ledger.mjs). | 10+ minutes and can abort silently. Back up public/core.json, core-descriptions.json, ast-index.json, public/ast/ and scripts/migration/out/ first. Generated overlay rows are rejected as the route: 223 rows would be an importer in disguise and would freeze today's print. |
| F9 | **RC-C data half, same regen.** import-core-v2.mjs:1447-1453 writes each subclass variant's own slice instead of the whole parent page. Doctrines use the existing sections.json "inline-bold" slice on doctrine-4/5 (the newest printing, not legacy doctrine-2). Alchemist and Masterful Hunter variants, whose benefit is not on the parent page, get no tree. resolve.py's paren-only rule (:139-141) changes only for records with a slice or no own page. | ast-pipeline | scripts/import-core-v2.mjs, scripts/migration/resolve.py, src/data/not-own-page.json, baseline | second-doctrine-cloistered-cleric's tree contains "Fortitude" and not "First Doctrine (1st)"; not-own-page.json shrinks by 39; the census shows 0 newly wrong records in every bucket; ast-provenance-check and classfeature-page-check stay green. | Implement benefits share the paren-only rule; measure the census on every bucket. |

## 5. Order

Before the data regen. These steps touch only code, tests and new scripts. Each commit is staged by explicit path; the owner-names check is run on new files; every step ends on its rendered refuter.

1. **G0.** The no-change predicate move. Ends on byte-equal renders.
2. **G1.** The ledger, baseline and rendered test. Ends on: the four owner cases flagged, the mutation cases red, zero disagreements. The verify line in package.json waits (step 12); until then the check is run by hand in each fix's refuter.
3. **F1.** The printed set replaces hideMeta, plus the bug-popup-divider re-point with citations. Ends on Halfling Luck, Shield Block, Aid, Healing Potion and a weapon popup each showing their lines exactly once.
4. **F1b.** Main-tab feat actions move onto the tree path. Ends on the same stat lines on three surfaces.
5. **F4.** Spell rows come from the page. Ends on Approximate, Buzzing Servants, Elemental Blast, Ignition and the heightened fireball check.
6. **F5.** The looser section key. Ends on −290 exactly and 0 right→wrong.
7. **F6.** The not-own fallback list. Ends on the cleric doctrine render and the two-way list check.
8. **F2.** Our lines and homebrew fields. Ends on the Bloodline marker in the popup and in the pinned popup.
9. **F3.** Pin and builder identity. Ends on Zombie Horde and Cascade Countermeasure.
10. **F3b.** The builder lists the chosen doctrine, in its own commit. Ends on the builder harness plus the grant checks.
11. **Browser preview** with dev-skip login, never the owner's account. Phone and desktop screenshots of Halfling Luck, Buzzing Servants, a level-3 cloistered cleric's Second Doctrine, Approximate, Aid and a Healing Potion. PinStar must still be on every popup.

After the other lane commits its uncommitted output:

12. Re-stamp every baseline against the committed data; add `jiti scripts/display-truth-check.mjs` to the verify chain; land **F7**. Ends on verify green with zero stale entries, and the scratch-copy red runs.

The regen lane, at a time the owner chooses:

13. **F8 + F9** in ONE `npm run data`, after the backups. Ends on: S4 at the JUDGE residue, 0 emptied values, not-own-page.json 39 shorter, the durability checks green, and the trust ledger re-stamped.

After that:

14. **Follow-up measurement.** A seeded random sample of paragraph text against the mirror, to give a real prose error rate. The 11.5% precedent is why this matters.

Screen fixes ship after steps 3–10. The stored spell values behind filters and the heighten arrow are corrected only by step 13.

## 6. What can be guaranteed and what cannot

**What we can promise once steps 1–10 ship.** For every official feat, class feature, action, item and spell whose Archives page the app carries, every labelled rules line that page prints appears exactly once in every sheet popup, in the page's own words. That covers Trigger, Frequency, Requirements, Access, Cost, Prerequisites, Activate, Range, Area, Targets, Duration and Defense. For spells these lines sit in the stat rows; for feats, items and actions they sit at the top of the page text. Each popup shows that record's own section, or the record's own description where the page has no section of its own. A check in `npm run verify` covers every page on every run. A test opens a fixed sample through the real popups and must agree with that check. Every known exception is written down in a list that can only get shorter.

**What we cannot promise:**
- **That the paragraph text is right word for word.** Most description text came from the old Foundry import: 1,675 of 2,031 spell descriptions and 5,479 of 6,560 feat descriptions are byte-identical to it. The spell popup's paragraph text and every fallback description are that text. The real error rate inside paragraphs can only be measured by random sampling against the book, and that has not been done yet (step 14).
- **About 239 records on the "not its own page" list.** They show our own description instead of the page until they are worked down. It is checked for coverage, not word for word.
- **Records with no Archives page.** That is about 231 official records plus all homebrew. For homebrew we only promise that what was typed is shown.
- **The values the app calculates with.** Spell durations and areas used by filters and the heighten arrow stay wrong for about 290 spells until the data rebuild (step 13). Heightened and bonus numbers are not checked at all.
- **A record linked to the wrong printing.** It passes, because the book is read through that link.
- **The tracker app, the builder's picker lists, and how a one-line row preview is cut off on a phone.**
- **Mistakes in the Archives itself.**

## 7. Decisions only the owner can make

1. When the data rebuild (step 13) may run. It needs the other lane's uncommitted output committed or set aside first, and it takes 10+ minutes.
2. Whether the screen fixes (steps 3–10) go out as a release before that rebuild. Any release first needs the one check still owed on commit ea0d27b.

## 8. Checked / assumed / not tested

**Checked by me (synthesizer):**
- I read the brief in full and every refuter, plan and judge input.
- Spot checks in the repo:
  - FeatEntry is declared at src/sheet/FeatDetail.tsx:12, and FeatDetail does not call useAstNode (only PinStar at :5 and :89).
  - The PinStar node at FeatDetail.tsx:89 carries no slug.
  - ItemDetail's stat rows at ItemDetail.tsx:462-470 include typeStats, Material, Worn slot, Price, Bulk, Usage and Hands. That is why the winner's {Source, Price, Bulk, Usage} set was dropped.
  - PREMISE_RE at scripts/test-flip-audit.mjs:51 needs `// batch <id> premise: <doc-id> "<clause>"`.
  - useAst.ts:102 seeds from getCachedAst.
  - hideMeta's drop points are at AstRenderer.tsx:286, 362, 373 and 388.
- Every count above is a refuter's or judge's measurement. I did not re-run them.

**Assumed:**
- The refuters' jsdom renders reflect the browser.
- 58e7a34 is v0.1.41 (from memory; there is no tag).
- The full-corpus render through DescBody plus the pure stat-row functions is affordable under the vitest lock. The full detail components over the whole corpus were judged unproven, so they are sampled instead.
- The other lane's dirty data does not change these classes. Spell stat fields were measured unchanged from HEAD to the working tree; feat and item data were not.
- The "Source shown dimmed" choice is a display decision I made, not a ruling.

**Not tested:**
- No fix was prototyped.
- No browser preview.
- The census's 7 undecided items.
- The heightened values.
- The ~50 hand verdicts in the JUDGE table (one agent's judgement, not the owner's).
- The ChoiceDetails "different page" rows for class features (some may be acceptable).
- Whether a looser section key causes false cuts beyond the census's own before/after check.
- Suite time of the corpus test.
