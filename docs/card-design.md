# The card: one design for every record popup (2026-10-02)

> STATUS: DESIGN ONLY, nothing built. Produced by workflow wf_d42625b4-089 (5 surveys, 3 designs, 2 judges, 1 synthesizer, all Opus; Fable judged the synthesis) after the owner rejected docs/display-truth-plan.md ("half ass") and "render the whole page" ("only what you have, not the future; don't break spell heightening"). The owner's three answers (section 11) and his "start the card" are PENDING. The census numbers behind it stay in docs/display-truth-plan.md; the surveys' scratch scripts live in the session scratchpad and get promoted under scripts/ in step 4.

**Basis.** The two judges tied: averaged scores were 7.75 / 7.75 / 7.75, judge 1 picked "Player at the table" and judge 2 picked "Safest migration". This design combines them:
- **Card content** (rules, order, what is scoped) comes from **design 1, the Player at the table**.
- **Build skeleton** comes from **design 3, the Safest migration**: each surface moves in its own commit, spells keep their string body until a per-spell parity check passes, and the steps run smallest blast radius first.
- **Guard and fold ledger** come from **design 2, the Book-faithful engineer**: folds stay in the DOM, level folds come from a reviewed ledger, and the guard has OURS-LEAK, CUT-IN-SENTENCE, EXTRA and card-only-check sections.

Every claim a judge marked wrong has been dropped or corrected; the list is at the end. File:line pointers are from the surveys unless marked "verified here".

Repo rules that hold throughout:
- READ-ONLY until the owner says go.
- Stage by explicit path. Never `git add -A`, `checkout`, `restore`, `reset` or `clean`.
- The display files are clean in git. `package.json`, `scripts/data/effect-backfill.json`, `scripts/import-core-v2.mjs`, `scripts/dropped-inline-check.mjs`, `src/sheet/CompanionsTab.tsx` and `src/rules/sources.ts` are dirty with another lane's work. Anything touching those waits.

---

## 1. Principle

- Every record opens in one card.
- Where the record has its own Archives page, its words come from that page and never from the old imported text, not even while the page loads.
- On the sheet, the card shows the part that is yours: your record's own section, the levels you have reached and the option you picked. Parts for later levels or for options you did not take are folded (or hidden or greyed, per the owner's answer) and never deleted.
- A printed sentence is never cut.
- Cost, Trigger, Requirements and Frequency come first, each once, in the book's words.
- Everything the app adds sits in a marked box or a marked highlight that cannot pass for print. This covers your pick, another feat's marker, a note, "at your level: 2d6", the heightened damage and the highlighted Heightened entry.
- Every sheet card has a "Full page" button. Search and the builder's picking screens always show the whole page.
- Spell heightening keeps working exactly as today at every step.

## 2. Card rules

1. **One component.** `src/sheet/RecordCard.tsx` is extracted unchanged from DescriptionModal's page / loading / fallback branches (DescriptionModal.tsx:116-127, :131-149, :152-182).
   - Pure helpers live in `.ts` files, because jiti cannot parse `.tsx`:
     - `src/sheet/astVisibility.ts`: META, labelOf, isMetaP, isSourceP and isMetaishBlock from AstRenderer.tsx:167-189, plus variantSection and withoutItemLists from useAst.ts:31-84.
     - `src/sheet/cardScope.ts`: the cuts and folds.
     - `src/sheet/cardModel.ts`: types.
     - `src/sheet/heighteningTree.ts`.
   - Props: `record:{bucket,id}` (or `{title,text,html?}` for homebrew and glossary), `mode:'browse'|'mine'|'gm'`, `chrome:'popup'|'embed'`, `scope?`, `stats?`, `controls?`, `headerActions?`, `transform?`, `ours?`, `fallbackText?`, `onExit?`.
   - PinStar, Back, close, TrustMarker and (on mine) Full page are built in and always present.
2. **Identity: by {bucket,id}, never by display name.**
   - Name lookups reopen a different page for 41 feats, 28 class features, 11 spells, 252 items and 63 actions (surfaces-pin-identity.mjs).
   - Fixes built into resolution:
     - (a) Heritage rows use bucket `heritages`, keyed by heritageId. Today FeatDetail.tsx:80-82 looks in classFeatures by name slug and resolves 0 of 336, though 333 have a page.
     - (b) The builder's fake `origin` bucket (shared.tsx:953-956) becomes the real bucket. Every origin popup falls back today.
     - (c) A hidden cursed item resolves its disguise twin's id. playerFacingContent (cursedItems.ts:44-55) stamps the shown id. Today "Spacious Pouch" prints Bag of Devouring's "devours the victim".
     - (d) An id on the generated `src/data/not-own-page.json` (plan F6) gets no tree.
     - (e) An `aon-` prefixed id is matched without the prefix for variantSection (plan F5).
     - (f) Homebrew `hb-*` ids never resolve a page.
3. **Source.**
   - The page tree is used when the record has its OWN page, meaning the id is not on not-own-page.json, after the own-section cut (rule 5a).
   - While the tree loads, a placeholder shows. This behaviour already exists (DescBody.tsx:116; DescriptionModal.tsx:129-131) and is kept.
   - If the page cannot be decoded (no DecompressionStream, astStore.ts:42-55), the card shows the fallback text with an ours line saying the page could not load on this device.
4. **Order inside a 'mine' card.**
   1. Header: name; the pick suffix as a subtitle, never part of the lookup; cost glyph (the marked cost under the action-mark ruling); trait chips; TrustMarker; Full page / Back / PinStar / close.
   2. Use lines, in the page's words, at full weight, each exactly once: Trigger, Requirements, Frequency, Cost, Prerequisites, Activate, and for spells Cast/Range/Area/Targets/Duration/Defense. This is the "printed set" (plan F1): a page line is dropped only when the surface's own stat-row function (`itemStatRows` ItemDetail.tsx:462-470, `featStatRows`, `spellStatRows`) printed that label. It replaces `hideMeta`.
   3. Controls, kept where players have them today, above the text: use pips, the Cast-at picker or chip, item choices, quantity, Attack/Damage, the prepare toggle, the action pin. bug-item-card-detail's 161 expects lock this order.
   4. The scoped body.
   5. The ours box.
   6. Footer: dimmed Source line, RemasteredLine, the desk #152 empty note, and the no-page line.
5. **What may leave page text out on 'mine'.** Only these named rules, each logged by the guard:
   - (a) **S-own**: other records' sections of a shared page.
   - (b) **S-items**: withoutItemLists, ruled 2026-09-15.
   - (c) **S-furniture**: dropped, because it is navigation, not the record's rules. Covers spoiler banners; "<X> leads to…" (982 feats); Related Feats and navigation lists; "Click here for the full rules…" and "can be found here" lines; the Class and Parent page header labels; the spell's where-to-get lines (Traditions, Deities, Domain, Bloodline, Mystery, Lesson, Patron, Spell Lists). SpellDetail's sub-line already prints traditions at SpellsTab.tsx:182, from the field until the rebuild.
   - (d) **S-printed**: a header line printed in the stat rows instead.
   - (e) **S-future** (section 3): folded, never deleted, so folded text stays in the DOM.
   - (f) **S-pick** (section 3): folded per the owner's answer.
   - No rule may act inside a sentence.
   - Kept but dimmed: Source, the Archetype label, Access, Craft Requirements and the PFS Note. A PFS Note today is hidden in the header column but printed full-weight in the body on 16 heritages, 14 companions and 7 class features.
6. **Embedded page stubs.** 5,856 empty document stubs exist; 5,583 resolve by aon id.
   - They render the referenced page inline, one level deep, with a visited-set loop guard. Examples: Rage shows the Rage action; a weapon or armor shows its group's actual specialization effect (all 24 group trees ship).
   - On browse, archetype pages show their 2,664 feat stubs as a compact linked list.
   - The 273 that do not resolve become a name link when a record exists, otherwise nothing, and are listed by the guard.
   - This changes the approved browse popup, so browse is re-baselined in the same commit as each part.
   - Split (2026-10-07, step 14's refute): step 14 resolves the stubs on ITEM pages only (the item card and an item's browse card: 419 stubs on item pages, 418 resolve; `STUB_HOST_BUCKETS` in src/sheet/astStubs.ts). Every other bucket's stubs (Rage's action, the archetype compact list, the class / feat / rules pages that embed actions), the name links for the 273 unresolved, and an embedded page's trait chips are step 14b. Strike keeps its gate in both. Why the split: step 14's brief re-stamps only itemDetail and browse and keeps every other surface's snapshot byte-equal, while Rage's class feature is drawn by the featDetail and statDetail cards (steps 11 and 5), so the Rage case cannot land inside step 14. test/card-browse.test.tsx pins the split (a non-item page's resolvable stubs draw nothing on browse).
7. **One renderer.** At the end, `scripts/card-only-check.mjs` (in verify) fails if any file outside the card renders `<AstRenderer>`, passes astKey to DescBody, or renders `<RichText>` for a record that has a page. Allowlist: NotesTab, the homebrew editor, ModeDetailModal. Today `<DescBody>` has 8 rendering files, `<AstRenderer>` 3 and `<RichText>` 2 (judge 2's grep).

## 3. Scope rules for level-dependent text

**One switch.** `FUTURE_TREATMENT: 'fold' | 'hide' | 'grey'` in `cardScope.ts`. It applies the same way to every "comes later / not yours" part, so the owner's answer changes one constant and one test. Default until he answers: **fold**. A fold is one closed, dimmed line, "At higher levels (k)" or "Other options (k)", that opens on a tap. Whatever the setting, Full page shows everything, and search and the builder's picking screens never scope.

| Shape | Treatment | How found | Measured precision |
|---|---|---|---|
| Per-level variant records (28: cleric doctrines 12, alchemist field discoveries etc. 12, masterful hunter 3, wizard 1) | **Own section only** (S-own; not a future treatment: the record IS one level's benefit) | Widened variantSection (F5); where the page has no own section → not-own-page.json fallback (F6); regen F9 writes per-variant slices | F5 census: −290 with 0 right→wrong required; F6 coverage gate 60% on ALL listed |
| Level-titled sections (title right = "Level N"/"Nth"): 161 records, 92 pages, 409 sections (causes, instincts, research fields, practices, ways, eidolons, munitions master, class pages) | **FUTURE_TREATMENT** when N > character level | Rule, from the page's structure; generated into `scripts/data/level-folds.json` | 0 false hides in one seeded 30-record hand sample (lvl-titles-sample.mjs); 15/30 fully right by level alone |
| Implement Adept/Paragon, kineticist element junctions (single vs dual gate), inventor innovations (about 20 pages) | **FUTURE_TREATMENT unless the build says you own it** | build.ts:9321-9350 (pushBenefit: adept at 7 / 11, Intense Implement, paragon at 17) and the build's gate/innovation picks; an unknown pick → shown (UNKNOWN ≠ EMPTY) | Level alone would wrongly show 24 of 36 implement sections |
| A level row that only points at the subclass text (champion relentless-reaction@9 "listed in your cause", barbarian raging-resistance) | **Shows the matching section** from the subclass page | Section title = row name | 20 of 20 |
| Paragraph that OPENS with "At Nth level," about the player (feats 204, class features 74 records) | **FUTURE_TREATMENT**, whole paragraph only | Ledger entries in level-folds.json, generated with a subject check plus a reviewed exclusion list (relics, targets, pick caps); the runtime reads the ledger, never a regex; paragraph hashes checked both ways | 0 false hides in 46 gated units, but on the OLD descriptions; a 60-record seeded hand check on the TREES is required before this ships (step 13b) |
| Sentence that scales inside itself ("2d6 at 10th and 3d6 at 18th", Sneak Attack dice, Weapon Specialization master/legendary, "half your level") | **Kept whole.** Ours line "At your level (7): 2d6" only where derive already computes the value (Sneak Attack derive.ts:3803-3838, rage, weapon specialization by rank); parser values added per family, each with a mutation-proof test | — | 715 player-level sentences, 156 parsable; a bare "Nth level" rule would hit 231 sentences about others, so none is used |
| Choose-one options printed as separate bold-led blocks (118 records) | **Picked block highlighted; others per owner question 2** (until he answers: all shown, yours highlighted, plus the ours "Your choice" line) | Label rule | 10 of 10 hand-checked; partial matches (dragon-disciple-dedication, 3 of 50 led) → whole text plus ours line |
| Choose-one with options inline or unprinted (the other 452) | Whole text plus ours "Your choice: X" | — | — |
| Skill-action rank tiers (Treat Wounds, Earn Income ×2, Gather Information, Craft, Repair; 6 lost their tiers when they got a page) | Page whole; ours "Your rank (trained): DC 15" line restoring exactly what the app showed before; where a tier is printed as its own block, it follows FUTURE_TREATMENT by rank (with "grey", it says "needs master") | SKILL_ACTIONS (skillActions.ts:1040-1047) | not hand-checked per block; inside a sentence nothing is touched |
| Kineticist impulse "Level (+N)" / "Level (Nth)" entries (60 + 25 feats) | **Highlight** the ones that apply, using character level as the rank; nothing hidden | Structured labels | 92 of 92 parsed |
| Spell Heightened entries | **All listed**; the ones that apply at the cast rank get the `.applies` rail; never hidden (they depend on rank, and casters plan slots from them) | Section 5 | — |
| Rank lists in subclass text (bloodline spells by rank, curriculum) | Castable ranks highlighted, nothing folded | — | — |
| Feat-unlocked tiers (Advanced Bloodline …) | Whole until each family's unlock is mapped (about 6 later mappings) | — | — |
| Relic gift sentences (8), feat "Special" lines (351; 3 true future riders) | Kept whole | — | — |
| Class card (Details tab) | Mine: intro, initial proficiencies, and the level-3 feature sections up to your level, with later sections under FUTURE_TREATMENT; advancement table whole, current row highlighted. Ancestry card: page order, nothing folded (flavor is not future content) | Level-3 titles on 29 class pages | — |

**Whose level counts.** The character's level. Exceptions: an impulse "Level (+N)" counts up from the feat's own level, and spells use the cast rank. Relic levels are never scoped.

## 4. What we add and how it is marked

- **One ours box** after the body, carrying `data-ours` and the existing `.sd-ours` / `.sd-addnote` look. Each line is attributed to its source record.
- **Type:**
  ```
  OursLine = {kind, from?:{bucket,id,name}, text}
  ```
- **Kinds:**
  - `choice`: "Your choice: Fire — note".
  - `mark`: principles A and C; the ally-facing marker of Ruling F (the number is removed from your sheet, but the marker stays on the record it changes).
  - `actionMark`: the note for a marked action cost (MainTab.tsx:766-786), which today shows only as a row star.
  - `note`: the record's own note. 87 feats and 4 class features carry one; 90 of 91 never reach the popup today.
  - `enhancement`: enhancedBy, moved out of a print-styled stat row (FeatDetail.tsx:130-137).
  - `spellNote`: as today, SpellsTab.tsx:256-263.
  - `atYourLevel`.
  - `usesRetune`: upgradedBy and maxByLevel. These are computed at featUses.ts:89 and rendered nowhere today.
  - `skillTier`.
  - `critSpec`: only where the page prints no specialization section, which is 683 of 1,029 weapons.
  - `blurb`: Strike's fist, blast and natural-attack blurbs (StrikeDetailModal.tsx:11-19).
  - `remastered`, `empty`, `noPage`.
- **Highlights** are CSS classes on page nodes and never change a word: the Heightened entries that apply, the picked option, the class table's current row, castable ranks, and the impulse Level entries that apply.
- **Inline insertions.** Exactly two kinds are allowed, both `<span class="up-heighten" data-ours>`: the damage arrow "(→ 9d4)" and the area suffix "(→ N-foot kind)".
- **No more string concatenation.** No surface may concatenate HTML into a description string. `withPicks` (FeatsTab.tsx:108-135) returns `{ours, preview}`. FeatEntry (FeatDetail.tsx:12) gets `ours[]`. The PinStar node carries `ours[]`. This fixes the live bug where the 7 kineticist gates print raw `| --- |` and `**` once a junction is picked (T3).
- **Search keeps finding picks.** The Feats-tab search reads `e.description` (FeatsTab.tsx:401 and :482, verified here). It must also search the ours text, so picks and notes stay findable. A test checks this.
- **Row previews** are a pure function of the card's first own body paragraph (`cardPreview`). Ours markers show as a tag on the row, not inside the sentence.

## 5. Every text modification preserved

| Feature (today) | How it survives | Proving test |
|---|---|---|
| Heightening split + `.applies` rail (heightening.ts:15-49; SpellsTab.tsx:238-251) | String lane untouched through step 16. In step 17, `heighteningTree.ts` cuts the tree's top-level "Heightened (…)" paragraphs after the last rule, attaching the lists that follow (7 spells) and the Amp columns (13). **Separate matchers** cover "Amp Heightened" (5 spells, its own group, never treated as ordinary heightening) and the 12 summons printed "Heightened As listed in the trait" with no parentheses. heightenTrigger is reused on each entry's bold label. A spell moves to the tree only when `scripts/heighten-tree-parity.mjs` shows the same or more applying entries at every rank. Failing spells stay on `src/data/heighten-string-lane.json` (shrink-only, two-way checked) | `test/card-spell-heighten.test.tsx`, written in step 0 against TODAY's SpellDetail (export only: it is a top-level function at SpellsTab.tsx:104): fireball at 3/5/9; electric-arc at 8th (1 applying entry, "(→ 9d4)"); a focus spell, a cantrip, a signature spell; ghostly-shift with Amp Heightened separate; one summon. Mutations (remove injectDamageArrow, remove the applies class, remove the area suffix) go red. heightening.test.ts (9) unchanged |
| Cast-at picker / cantrip-focus chip / slot rank (SpellsTab.tsx:129-141, 213-229) | Card controls slot, same inputs | Same test: signature picker 3rd–9th; fixed "8th" chip from an 8th slot |
| Damage arrow (injectDamageArrow SpellsTab.tsx:80-88; RichText ⟦…⟧ :245-258) | String lane, then a tree transform: split the first matching base-part text node into text + span + text (one new AstRenderer inline type). 398 of 400 anchors are found in the tree (the string manages 396). The 2 misses (electrified-crystal-ward, shadow-illusion) show the arrow as an ours line instead of silently losing it | Spell test; corpus check: arrow present for 400 of 400 (398 inline + 2 boxed) |
| Area suffix (SpellsTab.tsx:205-207; scaleArea heightening.ts:130-143) | Attached to whichever Area row renders (page or field); skipped when the page's Area text lacks "<base>-foot" (3 of 30: footholds-and-foothills, hologram-cage, mushroom-patch) | Spell test on one of the 27 |
| Spell stat rows from fields; our Defense wording | Rows from the page header (F4). Cast glyph and chip stay ours. Page Defense wording replaces "spell attack vs AC + basic X save". EXTRA rows (Buzzing Servants' Area) are hidden when a tree exists. The field stays for the engine | card-parity: approximate's Area in `.sd-stats` and not in the body; buzzing-servants "sustained up to 1 minute" and no Area row; elemental-blast's Area whole; ignition "Defense AC" |
| Spell notes N2 | ours `spellNote` after the page; the note's own DescBody never gets a tree key | spell-notes.test.tsx (8); its "You instantly transport yourself" assertion is re-pointed with a premise citation only if the tree wording differs |
| withPicks "Your choice" / A-C markers / record note | ours `choice` / `mark` / `note` | card-ours: air-gate + junction shows no raw markdown; sorcerer 3's Bloodline marker in the popup AND the pin; caustic-nectar shows its note. batch001-surfaces assertions move from string to screen with flip-audit citations |
| pickSuffix in the name | Header subtitle only; lookup by id | Pinned "Caustic Nectar (Acid)" resolves its tree (T4); builder-choice-sets (34) |
| classFeatureDescription per-class strip (featureText.ts:16-34) | For the 25 shared features, the fallback lane shows the viewer's own class paragraph. The comma-list lead bug ("Witch, Wizard"; the file matches single class names only) is fixed. Footer: "No Archives page for your class — text from our older import". After the regen, per-class pages (161 of 175 pairs found) | feature-text.test.ts gets one case per class for weapon-expertise / reflex-expertise / perception-mastery. Render: wizard 11 Weapon Expertise has no "martial weapons"; cleric Perception Expertise says expert; druid Weapon Expertise has no "martial" |
| Subclass variant swap (FeatsTab.tsx:186-192) | Kept as the "which benefit" key; S-own cut or the F6 fallback | second-doctrine-cloistered-cleric has "Fortitude", no "Final Doctrine" |
| FeatDetail glyph + Prerequisites field | The page's Prerequisites line replaces the field row when a tree exists (102 worded differently, 11 empty); glyph kept | bellflower-dedication: Prerequisites once, page wording |
| enhancedBy | ours `enhancement` | automaton-enhancement (23) plus a render with `data-ours` |
| RemasteredLine (#158), empty note (#152) | Footer and ours slot on every branch | desk-158-152-popup-lines (6), remastered-as-popup (3) |
| TrustMarker | Built in, from record {bucket,id} | trust-marker (12); a pinned record shows the right record's marker |
| Use pips and retunes | Pips stay on the row and in controls; ours `usesRetune` beside the restored printed Frequency | feat-uses (6), uses-upgrades (12), sub-daily-uses (6); Reliable Luck shows the line |
| Item controls and computed rows | Controls slot, same order; the printed set comes from itemStatRows; the phone Remove bar stays outside the scrolling body (ItemDetail.tsx:907-912) | bug-item-card-detail (161) plus 8 item test files; healing-potion shows Activate and exactly one Price |
| Crit-spec block (ItemDetail.tsx:848-857) | Page group effect via the resolved stub where printed (measured at step 14: 330 of 1,036 weapon pages draw a group page, 307 their own); ours `critSpec` otherwise, by rule C2 (step 14 round 2: the page is the truth, read whole — ours leaves where the page draws the record's own group page, or draws another and prints no "Group" line naming the record's group; a combination weapon's melee half keeps ours, marked ours, beside the ranged group page it embeds; `work/card-step14-weapon-group-drift.json`: 5 drift, 18 combination); Strike keeps its "only if you have it" gate (StrikeDetailModal.tsx:46-47) | longsword shows the effect once; full-plate shows the plate resistance (printed nowhere today) |
| Cursed disguise | The twin's id (rule 2c) | cursed-items (8), cursed-disguise (3), plus a render: hidden bag-of-devouring has no "devours" |
| Skill tiers | ours `skillTier` (plus FUTURE_TREATMENT on separate tier blocks) | Trained Treat Wounds shows "Your rank (trained)" (T5 shows it absent today) |
| Action mark | Marked cost in the header as today, plus an `actionMark` note in the body | skill-action-cost-assurance (57) plus one assertion |
| Row previews | `cardPreview`; markers as a row tag | richtext (12), text-format-fixes (6), bug-feats-long-text-collapsed; the preview equals the popup's first line for a shared-feature row |
| Main-tab feat / class-feature / granted actions on markdown (MainTab.tsx:358-390) | Moved onto the card (F1b) | Halfling Luck has identical use lines on the Main tab, the Feats tab and search; rise-up shows its Trigger |
| Import-time repairs (@Damage cleaner, dropped-inline, 2,123 description rows) | The page replaces them where a page exists (word coverage 95%+ for most buckets); the fallback lane keeps them; about 33 older-printing trees are listed by a guard and fixed as reprint links in the data, never patched on screen | cleaner-artifacts (5), dropped-inline-ratchets (2), aon-markers (6); new shrink-only older-printing section |
| AstRenderer tree changes (rule skip, glyph re-join, Activate fold, self-link, dead links, variantSection, withoutItemLists) | Inherited; hideMeta replaced by the printed set | bug-popup-divider (re-pointed with citations to principle E), bug-inline-glyph (8), bug-item-variants (8), bug-item-popup-labels-sections (9) |
| RichText markdown fixes; homebrew rich HTML + autoDir + sanitize | The card's fallback lane = DescBody's existing branches (DescBody.tsx:140-181), untouched | auto-dir (11), richtext (12); a pinned homebrew feat named like an official one shows the homebrew text |
| Modes / stances / battle forms, situational stars, GM overlay, tracker | Untouched (they never read record text) | battle-form-chip (5) |

## 6. Modes and per-surface differences

- **mine**: the sheet's detail popups, the builder's "You gain at level N" rows, and a pin made from the sheet.
  - Sheet popups: FeatDetail (feats, class features, heritages, choice rows), ItemDetail, SpellDetail, ActionDetailModal, StrikeDetailModal, StatDetailModal full text, and the Details-tab class card.
  - Builder rows: ChoiceDetails, scoped to the build's level, subclass and picks.
  - A pin made from the sheet reopens as mine at the character's current level.
  - Mine receives the scope `{level, classId, subclassId, picks, ranks, implements/gates}`.
- **browse**: today's search popup, unchanged.
  - Covers search, ref-link drill-in, trait chips, every picker preview (FilterableSelect, PopupSelect, SearchSelect), builder picking, the formula book, companion pickers, the GM search portal, and pins made from search.
  - Never scopes by level or pick. Keeps all furniture and lists, with meta dimmed.
  - Shares with mine: identity (rule 2), stub resolution (rule 6), the own-section cut (2026-09-12 #6 covers both popups), heightening display without a rank highlight, and the footer.
  - descNodeOf counts a page as non-empty (FilterableSelect.tsx:31-33).
- **gm**: HostPage (CampaignTracker.tsx:111-122). The whole page with its stat lines, embed chrome.
- **Shells.**
  - The browse card keeps the `.ast-modal` / `.picker.info-modal` class names. PopupSizeLock's SELF_SIZED (PopupSizeLock.tsx:25, verified here) therefore needs no change for browse.
  - The mine card's shell is a size-pinned `.picker`. PopupSizeLock pins every non-self-sized picker at its settled height (verified here, :41), so it would not grow when a fold opens or Full page expands. The mine shell class goes into SELF_SIZED, with a citation in test/popup-size-lock.test.tsx (its SELF_SIZED list, :150 per survey 4), and is checked in the browser preview at 375 px.
  - The `.info-body` `white-space: pre-wrap` rule lives in **src/sheet.css** (verified here). The card body resets it.
- **Typography.** Migrated surfaces adopt the approved `.ast-body` look (14px/1.62).

## 7. Fallbacks

- **No own page.** This covers 811 official records (344 items, 199 class features, 199 actions, 26 familiar abilities, 25 feats, 7 spells …), ids on not-own-page.json, and spells still on the string lane.
  - The same shell renders the fallback text through DescBody's markdown / rich-HTML / dirAuto branches.
  - Header and stat lines come from fields plus the description's bold preamble (`stripPrintedPreamble`), so no label shows twice.
  - Footer: "No Archives page — text from our older import". Decided under R9: every option is acceptable, and the player can tell unchecked text from print.
- **Shared class features.** Footer: "No Archives page for your class — text from our older import", because a page exists, just another class's.
- **App-authored records** (modes 571, runes 160, stances 131 …). No no-page line, because they were never print.
- **Homebrew.**
  - Footer "Homebrew". Looked up by id only, so it never matches an official page by name.
  - Typed trigger, frequency, requirements and access (types.ts:3294-3307) render as use lines, never styled as print. These fields have no reader today.
  - Saving runs parseFrequency into limitedUses. This needs a homebrew-editor change, listed at step 11.
- **Legacy records with a reprint.** RemasteredLine (#158). A record whose tree shows the older printing's wording is fixed as a reprint link in the data, never on screen (R12).
- **Old pins.**
  - They store `{key,title,snapshot}` (types.ts:206-214). They are re-resolved at read time only: by key + title when that names exactly one record, otherwise the stored snapshot is shown.
  - They are never written back (never-overwrite rule).
  - Identity rule: new pins store bucket + id + mode.
    - `descId` becomes `bucket:id` when present.
    - has() and unpin also match the legacy `key:title` of the same record.
    - Mode is stored, but is NOT part of identity: one pin per record, and toggling from either view unpins, as today.
  - Five files own pin identity: play.ts:2222 (descId, verified), CharacterSheet.tsx:501-503 and Builder.tsx:322-336 (verified), build.ts:9658 / 10035 and transfer.ts:1555 (survey). All five are in the pin commit.

## 8. The permanent guard (card == page, field == page)

All shrink-only, with two-way baselines: a new offender fails, and a fixed id still listed fails.

1. **`scripts/card-truth-check.mjs`**, full corpus, pure, in verify.
   - It imports the same `astVisibility.ts` / `cardScope.ts` the card renders with (through jiti), so the check and the screen cannot drift.
   - For every (surface, record) with a page, at a fixed scope grid (levels 1/5/9/13/17/20 per class; the first pick per choice set), it computes:
     - own: the record's own section.
     - card: the page text including closed folds, excluding `[data-ours]` and the stat region.
     - an omission log: every own line missing from card must carry a named rule (S-own, S-items, S-furniture by kind, S-printed, S-future, S-pick).
   - Sections:
     - **MISSING**.
     - **DIFFERS**.
     - **DUPLICATED**: a label shown in both the stat rows and the body.
     - **EXTRA**: a stat row the page lacks. Must be 0 when a tree exists.
     - **CUT-IN-SENTENCE**: must be 0.
     - **FOLDED-UNLISTED**: a fold not in level-folds.json.
     - **NOT-OWN**: the census rule plus the shared-feature class mismatch, 151 rows today.
     - **IDENTITY**: a pin, ChoiceDetails, heritage or cursed lookup resolving another tree.
     - **OURS-LEAK**: ours text inside page nodes, or page text inside ours.
     - **STUBS**: unresolved.
     - **OLDER-PRINTING**.
   - It runs on any clone from the shipped `.json.gz`.
2. **`test/card-parity.test.tsx`**, through `node scripts/vt.mjs` only, never beside another vitest.
   - For a seeded sample (mulberry32 20261002, 60 per surface) plus named cases, it renders the REAL surface popup and `<RecordCard mode='browse'>` for the same {bucket,id}.
   - Assertions:
     - every surface line is a browse line, a stats row, or inside `[data-ours]`;
     - every browse line the surface leaves out carries a named rule, which is logged;
     - every printed label appears exactly once;
     - the DOM verdict equals the ledger's, with zero disagreements;
     - one record reads identically on every mine surface for the same scope.
   - Known failures live in `test/card-parity-known.json` (shrink-only): halfling-luck, a heritage row, a wizard's expert-spellcaster, the builder background (origin), second-doctrine-cloistered-cleric, air-gate with a pick, hidden bag-of-devouring, trained treat-wounds.
   - Mutation proofs, each going red: the old whole-column drop; a string injected outside `[data-ours]`; level-only implement scoping; a fold of a paragraph not in the ledger.
   - Suite time is measured in its commit.
3. **`scripts/card-only-check.mjs`**: rule 7.
4. **`scripts/engine-page-agree-check.mjs`**, promoted from scratch engine-agree-measure.mjs. It must run from the repo cwd: aon-facets loads usage-slugs.json by a relative path, and a run from another folder produced 664 false differences.
   - Compares each engine-read field with the importer's own facet parser applied to the page, split by import path and overlay ownership.
   - Fields: spell cast / traditions / save / defense AC / range, area and duration filter values (through the real filterValues.ts) / targets / heightening triggers vs structure; feat limitedUses vs the printed Frequency, prerequisites, actionCost; item usage / activationCost / hands / frequency.
   - Baseline today: 215 cast, 143 traditions, 109 save, 56 Defense AC, 148 range / 95 area / 174 duration filter values, 99 pips, 46 prerequisites, 1,320 usage, 107 activation, 31 hands, 12 heightening.
   - Mostly only the regen shrinks it. Mirror-dependent sections skip with a printed line when the mirror is absent.
5. **`scripts/level-folds-check.mjs`**: level-folds.json equals its generator's output and the tree paragraph hashes.
6. **Shrink-only lists**, each two-way checked: `heighten-string-lane.json`, `not-own-page.json`, `card-parity-known.json`.

Checks 1, 3, 4 and 5 join `npm run verify` only when package.json is clean. Until then each refuter runs them by hand.

## 9. Build order

Each step is one commit, staged by path, ends on its refuter and runs the owner-names check on new files. Each surface has a per-surface switch `CARD_ON[surface]` in `src/sheet/cardSurfaces.ts`. That surface's legacy assertions stay in a block that runs when the switch is off. Turning a surface back is therefore one line, and its tests still hold. All switches and legacy paths go in step 22.

| # | Step | Files | Refuter | Risk |
|---|---|---|---|---|
| 0 | Pin what is unguarded, no behaviour change: export SpellDetail; render tests for spell heightening (section 5), StrikeDetailModal (0 tests today; synthesized character, never the owner's), and the Main-tab action popup body and marks, rendered through MainTab | src/sheet/SpellsTab.tsx (export), test/card-spell-heighten.test.tsx, test/card-strike-action.test.tsx | Green on today's code; mutations red | Low |
| 1 | G0: move the predicates, variantSection and withoutItemLists into astVisibility.ts; export the stat-row functions | astVisibility.ts, AstRenderer.tsx, useAst.ts, ItemDetail.tsx, FeatDetail.tsx, SpellsTab.tsx, test/card-noop.test.tsx | renderToStaticMarkup byte-equal on 600 seeded records (useAstNode seeds synchronously from getCachedAst, useAst.ts:99-108); existing tree tests unchanged; `npx tsc --noEmit` | Low |
| 2 | Hoist ActionDetailModal out of MainTab. It is a closure declared inside MainTab (MainTab.tsx:861, verified) that uses character, content, onPlay, recordMarkersFor and Star; thread them as props | src/sheet/MainTab.tsx | Byte-equal action popup through MainTab; skill-action-cost-assurance (57) | Low–medium |
| 3 | RecordCard browse extracted from DescriptionModal; class names kept; cardSurfaces.ts (all off) | RecordCard.tsx, cardModel.ts, cardSurfaces.ts, DescriptionModal.tsx | 6 DescriptionModal + 4 AstRenderer tests unchanged; byte-equal on the sample; one drill-in + Back + Escape-closes-chain case; popup-size-lock green | Low |
| 4 | The guard (section 8) in report mode, built before any fix | scripts/card-truth-check.mjs, scripts/lib/card-scope.mjs, scripts/card-only-check.mjs, scripts/engine-page-agree-check.mjs, scripts/data/card-truth-baseline.json, test/card-parity.test.tsx, test/card-parity-known.json | Every owner case and known case flagged; mutations red; 0 ledger/DOM disagreements | Baseline taken on the other lane's dirty data; re-stamped when it commits |
| 5 | Mine core on the smallest surface: StatDetailModal full text (StatDetailModal.tsx:225-239). Printed set, furniture, footer, ours slot, Full page / Back / PinStar (PinStar is missing there today), mine shell in SELF_SIZED | RecordCard.tsx, astVisibility.ts, cardScope.ts, StatDetailModal.tsx, test/popup-size-lock.test.tsx | halfling-luck shows Frequency and Trigger once; PinStar present; no "leads to"; Source dimmed; Full page shows the whole page | Low |
| 6 | HostPage → gm/embed | src/integration/CampaignTracker.tsx | Byte-equal HostPage keeps Range/Duration; gm-search-popup | Low |
| 7a | Sheet identity: PinStar nodes {key, slug=id} (FeatDetail.tsx:89, SpellsTab.tsx:173, StrikeDetailModal.tsx:44); heritage bucket; cursed twin id; ChoiceDetails passes bucket/id (shared.tsx:148); descNodeOf | FeatDetail.tsx, FeatsTab.tsx, SpellsTab.tsx, StrikeDetailModal.tsx, cursedItems.ts, ItemDetail.tsx, builder/shared.tsx, FilterableSelect.tsx | Heritage shows its page (T1); pinned "Caustic Nectar (Acid)" resolves (T4); hidden bag shows no "devours" (T7); ChoiceDetails(feats, cascade-countermeasure) renders the feat; trust-marker, cursed tests green | Medium |
| 7b | Builder `origin` → real buckets across the PopupSelect, SearchSelect and MultiPickRows call sites (about 80; tsc lists them) | builder/shared.tsx, builder/Builder.tsx | Background popup is the page, with no 404 to ast/origin.json (T3); builder harness (about 28 files), player-created-pickers green | Medium |
| 8 | The ours box on today's FeatDetail (F2). withPicks returns ours; search covers ours text; PinStar carries ours | FeatDetail.tsx, FeatsTab.tsx, src/sheet/OursBox.tsx, test/batch001-surfaces.test.tsx, test/card-ours.test.tsx | air-gate + pick clean; Bloodline marker in popup and pin; caustic-nectar note; a search for a pick note finds the row; flip-audit green | About a dozen FeatEntry builders |
| 9 | ActionDetailModal → card (F1b): activities, feat / class-feature / granted actions, tactics, runes; prepare toggle + action pin as headerActions; actionMark and skillTier lines; white-space reset in src/sheet.css | MainTab.tsx, src/sheet.css, cardSurfaces.ts | Aid and Shield Block show Trigger and Requirements once; Halfling Luck identical on three surfaces; trained Treat Wounds shows the rank line; 57 cost tests green | Medium |
| 10 | StrikeDetailModal → card (Attack/Damage + gated crit spec as controls; blurb as ours) | StrikeDetailModal.tsx | The step-0 test passes on the card; weapon text from the page | Low |
| 11 | FeatDetail feats → card mine; page Prerequisites; homebrew use lines (+ homebrew-editor parseFrequency on save) | FeatDetail.tsx, astVisibility.ts, test/bug-popup-divider.test.tsx (re-pointed, `// batch card premise: feat-NNNN "…"`), homebrew editor | halfling-luck once each; bellflower Prerequisites once; no "leads to"; a homebrew trigger shows | A label missing from the alias table shows twice; the exactly-once check catches it |
| 12 | Class features own section: F5 widening; generated not-own-page.json (F6); the shared-feature class slice with the comma-list fix | astVisibility.ts, scripts/not-own-page.mjs, src/data/not-own-page.json, useAst.ts, cardScope.ts, src/rules/featureText.ts, test/feature-text.test.ts | Census −290, 0 right→wrong; second doctrine "Fortitude" only; adept-benefit-amulet has no "Paragon"; aon-1st-rank-scroll has no "2nd-rank Scroll"; wizard / druid Weapon Expertise have no "martial"; two-way list check | False cuts; unique matches only |
| 13a | Structured level scope + tiers + pointer rows: level-folds.json generator (titles), FUTURE_TREATMENT, implement/element/innovation hooks from build.ts, impulse Level highlight | scripts/level-folds.mjs, scripts/data/level-folds.json, scripts/level-folds-check.mjs, cardScope.ts, test/card-scope.test.tsx | Justice at 5: no Relentless Reaction open; at 9: open and Exalted folded (text inside the fold); thaumaturge 11: only the owned Adept open; an unknown pick → shown; level-only mutation red on implements | Unmapped second gates are listed, never guessed |
| 13b | Prose gates into the ledger, after a 60-record seeded hand check on the TREES | same + scratch hand-check sheet | 0 wrong folds recorded in the commit; osteo-armaments folds the whole paragraph (no orphan "If you do") | Precision; that is why it uses a reviewed ledger and hashes |
| 13c | Choose-one blocks per owner question 2 | cardScope.ts, test/card-scope.test.tsx | Iruxi Armaments (Claw) highlights Claws; dragon-disciple-dedication falls back to the whole text | Waits for his answer (one constant) |
| 14 | ItemDetail → card: stub resolution on item pages (visited set, depth 1), crit-spec merge, Activate / Craft / Access from the page; the item browse card re-baselined in this commit | ItemDetail.tsx, AstRenderer.tsx, CritSpecText.tsx, critSpec.ts, card-truth baseline | bug-item-card-detail (161) unchanged; longsword effect once; full-plate plate resistance; a self-embedding test page does not loop; phone Remove bar unchanged | The biggest controls block |
| 14b | Stubs on every other bucket (section 2 rule 6): widen `STUB_HOST_BUCKETS` bucket by bucket on browse and the mine cards (StatDetail, FeatDetail, the action popup; never Strike); archetype pages' 2,664 feat stubs as a compact linked list on browse; the 273 unresolved become a name link when a record exists; an embedded page's trait chips; browse and each switched surface re-baselined in this commit | src/sheet/astStubs.ts, AstRenderer.tsx, RecordCard.tsx, card-truth baseline, test/card-browse.test.tsx | Rage's class feature shows the Rage action once; an archetype dedication's browse card lists its feats as links; a self-embedding chain does not loop; every other surface's snapshot block byte-equal | Touches every browse popup with a stub; the compact list is a new layout |
| 15 | Builder ChoiceDetails for granted features → mine scope; then, in its OWN commit, levelGrants lists the variant (F3b) | builder/shared.tsx, Builder.tsx, src/rules/build.ts | L3 cloistered cleric Details has "Fortitude"; a Justice champion 5's level-9 Relentless Reaction Details folds its cause section under "At higher levels (1)" and shows it open at 9 (a class's own level-9 rows cannot fold: the builder's level strip stops at the build's level, and their pages print no level-titled section); verify-characters, grant-reach-check, duplicate-pick-check, Gate 9 harness green | levelGrants feeds the grant checks |
| 16 | Spells phase A: stat rows from the page (F4); body stays the markdown string through stripPrintedPreamble; where-to-get lines dropped | SpellsTab.tsx, astVisibility.ts | The step-0 spell test unchanged; approximate / buzzing-servants / elemental-blast / ignition / borrow-time cases | Low for heightening (string untouched) |
| 17 | Spells phase B: tree body per spell behind heighten-tree-parity; Amp and summon matchers; arrow inline node; 2 boxed arrows | heighteningTree.ts, AstRenderer.tsx, SpellsTab.tsx, scripts/heighten-tree-parity.mjs, src/data/heighten-string-lane.json | Spell test green on the tree lane; 0 spells whose applied set shrinks or arrow disappears; the 124 unbolded-entry spells gain the rail; spell-notes green | Failing spells stay on the string lane |
| 18 | "At your level" lines from derive (Sneak Attack, rage, weapon specialization), then parser families one by one | cardScope.ts, test/card-scope.test.tsx | Rogue 7 shows "2d6"; level 11 changes it; a wrong-level mutation goes red | Marked ours; only as good as the engine |
| 19 | Pin identity (section 7, five files) | src/rules/types.ts, play.ts, CharacterSheet.tsx, builder/Builder.tsx, build.ts, transfer.ts, MainTab.tsx, test/pinned-descs.test.ts | An old title-only pin opens and unpins from a new star; pinned weapon-expertise-magus opens the magus slice; a spy on the 400 ms persist shows 0 writes on load; bug-builder-save-lossless and wg-import green | Synced shape; additive fields only |
| 20 | Details-tab class card (mine); previews from cardPreview; companion pickers pass ids | DetailsTab.tsx, InfoTerm.tsx, FeatsTab.tsx, CompanionsTab.tsx | A fighter 3 class card has no level-19 feature open, while Full page has it; preview = popup first line | CompanionsTab part WAITS for the other lane |
| 21 | Browser preview, dev-skip login only, 375 px and desktop: Halfling Luck, Buzzing Servants, a level-3 cloistered cleric (row and doctrine), Approximate, fireball at 5th, Aid, Healing Potion, a Justice champion 9, a wizard's Weapon Expertise, a hidden cursed item, a fold opening (the popup grows) | — | Screenshots match the tests; no horizontal scroll; PinStar on every popup | jsdom has no CSS; this is the only layout check |
| 22 | Remove switches and legacy paths (hideMeta, DescBody's page branch, cardSurfaces.ts); card-only-check strict. Not tied to a release: runs after step 21 and the full suite | AstRenderer.tsx, DescBody.tsx, cardSurfaces.ts, scripts/card-only-check.mjs | tsc lists 0 callers; card-only-check red on a scratch copy | — |
| W | **Waits for the other lane's commit:** the verify lines in package.json; re-stamp all baselines on committed data; F7 (comma-run holes in dropped-inline-check, rituals in spell-print-lines-check); overlay rows through apply-parity-fixes only (12 heightening structures, 3 contradicting pip rows feat-8940 / feat-3553 / feat-6145, 2 empty-facet prerequisites) | package.json, scripts/data/effect-backfill.json, scripts/dropped-inline-check.mjs, scripts/spell-print-lines-check.mjs | Verify green with 0 stale entries; a scratch-copy red run per new check | Dirty files |
| R | **Regen lane, at the owner's time, ONE `npm run data` after backups** (core.json, core-descriptions.json, ast-index.json, public/ast/, scripts/migration/out/): deriveFresh spreads spellFacets and the aonFacets item branch; spellFacets writes duration / area / range / targets / defense:'ac' (F8); feat limitedUses from the printed Frequency (with `every`), only where no overlay row exists; page-silent prerequisites → [] (desk #160 "EMPTY, not null"); EXTRA stat values removed unless the spell's own text states them; per-variant slices (F9); per-class pages for the shared features | scripts/lib/aon-facets.mjs, scripts/import-core-v2.mjs, scripts/migration/resolve.py, src/data/not-own-page.json, src/data/trust-ledger.json, MIGRATION.md | Read the output from the top, including the final "wrote" lines; engine-page-agree falls to its judged residue; 0 previously filled fields emptied except the R12 page-silent ones; not-own-page.json shrinks; regen-durability, refresh-loss, overlay-durability green; trust ledger re-stamped; filter-values.test.ts:43 still gives 60 s | 10+ min, can abort silently, lands on the other lane's importer hunks |

**Before the regen.** The spell sub-line keeps reading traditions from the field, so no spell card contradicts who can pick the spell. The lines that can contradict the engine until the regen are an item's page Usage where the field is empty, and a feat's printed Frequency where no pips exist. Both are counted by check 4.

## 10. Guarantee

**After steps 0–22**, for every official record whose own Archives page the app carries, every sheet popup shows that page's words and no old imported text:
- Every printed line of the record's own section is on the card, either open or inside a fold.
- The only lines left out are navigation, spoiler banners and the item lists already ruled out, and each one is logged by name.
- Every rules line (Trigger, Frequency, Requirements, Prerequisites, Activate, Cast, Range, Area, Targets, Duration, Defense) appears exactly once.
- Nothing the app adds can be mistaken for the book.
- Spell heightening, cast-at, the damage arrow and the area suffix work as before for every spell, on the page or on the string lane.
- A check covers every page on every run, and a test opens the real popups and must agree with it.

**Not guaranteed:**
- That the Archives itself is right.
- The 811 records with no page, records whose page is not their own, the shared class features until the regen, and spells left on the string lane. All of these show our older text, marked as such.
- The numbers the app calculates with (filters, use pips, who can pick a spell, item usage) until the rebuild. They are counted, not fixed.
- That the reviewed fold list never misses a later-level paragraph beyond its hand checks.
- Records linked to the wrong printing until the data fix.
- The tracker app.
- Phone layout beyond the browser preview.

## 11. Owner questions

1. **Parts you don't have yet.** Covers later-level sections and paragraphs, and higher-rank options printed separately. Options: (a) fold (recommended); (b) hide, with Full page to see them; (c) grey in place. One constant.
2. **Options you didn't pick.** Options: (a) yours highlighted, the others folded (recommended); (b) only yours; (c) all in full, yours highlighted.
3. **Release timing.** Options: (a) cards first, mismatches counted, rebuild right after the other lane commits (recommended); (b) hold the cards and ship them together with the rebuild.

Decided without asking:
- In-sentence scaling: whole sentence plus an ours line (N2 / R12 rule out cutting).
- The no-page footer line (R9).
- PFS Notes dimmed (R9).
- Shared features show your class's text (a correctness bug, not a preference).
- EXTRA stat lines not shown (R12, the page was read in full).
- Skill tiers: ours rank line, with separate tier blocks following question 1.
- The class card scoped and the ancestry card left in page order (placement).
- Pins keep their view.

## 12. Checked / assumed / not tested

**Checked here (this synthesis, read-only):**
- card-design-brief, display-truth-brief and display-truth-plan read in full.
- ActionDetailModal is declared inside MainTab (MainTab.tsx:861).
- The CSS file is src/sheet.css (src/sheet/sheet.css does not exist).
- `descId` = `key:title` (play.ts:2222). It is used by CharacterSheet.tsx:502-503 and Builder.tsx:327-331.
- PopupSizeLock SELF_SIZED = fsel / ref-search / info-modal / settings-modal (:25), and it pins every other picker (:41).
- The Feats-tab search reads e.description (FeatsTab.tsx:401, :482).
- Gold-set Q27 (docs/gold-set-answers.md:287-307) covers picker options that cannot be taken, not printed DC tiers, so it is not cited as settling skill tiers.
- N2 (:176) and principle E (:34) wording.

**Assumed:** every survey count and file:line not marked "verified here"; that the shipped page trees are print; that relics follow their owner's level.

**Not tested:**
- No fix prototyped. No browser preview.
- Heightening-on-tree and stub resolution are backed by layout counts, not working code.
- The 60-record tree hand check for prose gates is not done yet.
- build.ts:9658/10035 and transfer.ts:1555 pin copies not reopened.
- Suite time of the parity test unmeasured.
- DecompressionStream on the oldest Android not checked.

**Wrong claims dropped from the three designs:**
- The heightening cut does not catch the summons by a parenthesis rule. A separate matcher is added.
- The shared-feature footer no longer says "No Archives page".
- Q27 is not cited for skill tiers.
- The browse card needs no SELF_SIZED change; the mine shell does.
- ActionDetailModal needs a hoist, not just an export.
- The loading placeholder is not new.
- "Nothing else removes page text" is gone: S-furniture is named and logged.
- The 11.5% figure is the feat-mechanics residual rate, not a text defect rate, and is not used.
- Level titles had one 30-record sample, not two.
- The CSS path is corrected to src/sheet.css.
- The rollback switch is now backed by kept legacy assertions.
- Legacy removal is not tied to a release.

---

## 13. Owner rulings after the design (2026-10-02, 13:30–14:00) — these OVERRIDE the sections above

- **Q1 = A (fold).** Parts the character does not have yet (later-level sections, "At Nth level…" paragraphs, higher-rank
  tiers) are folded under ONE closed, dimmed line ("At higher levels (2)") that opens on a tap. FUTURE_TREATMENT = 'fold'.
- **Q2 = A.** Choose-one options: the picked option is highlighted, the others are folded under one line ("Other options (2)").
- **Q3 = A (cards first).** The cards ship before the data rebuild. The text does not wait for the use counters.
- **NO "Full page" button.** Owner: "you are implying we are missing data in the version we display." With folds nothing is
  unreachable; search shows the whole page. Remove every mention of the button from rules 1, 4 and the steps.
- **Raised bar on "no own page" records.** Owner was alarmed by "old import". For a record that has no page of its own but
  LIVES INSIDE a bigger Archives page (Air Gate in the kineticist class page, Advanced Rangefinder in the innovation page,
  Accept Echo inside the feat that grants it, the alchemist field discoveries…), the card cuts its paragraph/section out of
  that bigger page — at display time through a generated slice map (src/data/page-slices.json: record id → {bucket, page
  slug, section title / anchor}), two-way checked like not-own-page.json, so it needs no regen. Old imported text is shown
  ONLY for things the Archives do not have at all (gem table rows, a few AP items, homebrew), marked as ours. This widens
  step 12 and adds a mapping step after the core surfaces ship.
- **Mechanics are OUT OF SCOPE** ("don't change these, that's a problem for another day"): nothing in this job touches
  encoded effects, the trust gate, situational bonuses, grants, limitedUses or the engine's stored fields. The
  engine-page-agree check is deferred to the rebuild lane; step 4 builds only card-truth-check, card-parity and
  card-only-check.
- **Vocabulary for the owner:** he does not know "pip" — say "use counter".
- **Tree hygiene:** another chat is live in this tree (it edits test/bug-homebrew-stat-block-skipped.test.tsx and owns the
  26 modified tracked files listed by `git status`, among them package.json, scripts/data/effect-backfill.json,
  scripts/import-core-v2.mjs, scripts/dropped-inline-check.mjs, src/sheet/CompanionsTab.tsx, src/rules/sources.ts). Never
  edit those; never stage anything (the orchestrator commits by explicit path); never `git add -A` / checkout / restore.
