# Skill ranks level by level — build plan (designer, 2026-10-22) — Revision 3

**Revision 3** (final checker, 10 findings F1-F10: all accepted, F2's plant wording replaced, section 8): src/builder/shared.tsx is never edited in the lane (its readers move on main after the merge, or stay a "Still open" line); the lane commits sit on a local branch `skillorder-wps`; new guard cases BJ1/BJ2 (the expert-upgrade branch), K4/K4b (same-level feat + increase), twins for every reader case, part B's three browser characters and a language-Lore rerun character in the snapshot; G1's planted proof fixed (Revision 2's "swap P5 and P6" could not fail cross-level cases); discovery runs in WP4-WP6; WP11 re-runs the browser steps after a conflicted merge; OV values and finding labels stated; the rerun's legacy side decided from live ranks.

**Revision 2** (two checkers, 25 findings: 24 accepted, 1 rejected, section 8). What changed:
- WP1-WP10 run in a worktree lane (D21), so main never ships moved ranks without the notice; new parity stats stay out of `numbers` (D18); every gate from WP3 also proves the live path = today (`--legacy-check`, G11).
- Pass: a feat whose skill prerequisite needs that level's increase goes after it (D5, P7, Snare Setter); an old `=` swallows every raise it overwrote today, any level (D3 P2); swallowed increases stay stored; judges read their own level; the Lore alias is a judge; rank-gated grants respect Tweaks removals (D10).
- D14 follows each record's own clause (rules-2103 is creation only); apparition Lore steps read from data (8th/16th); notice line 7 for new Dual Class increase slots; a GM's edit neither shows nor stamps (D13).
- New readers: the feat "Trained skill" slot picker, the feat picker's occupant-subtree prerequisites, explain's `historyAgrees` fallback; shared.tsx readers parked; flipped cases get "today" premise tests (D17); reverse-build cases RB1/RB2 fail today.

Read-only design. Nothing in the repo was run or changed; only small `npx jiti` engine probes ran, from the session
scratchpad. Sources read: Guy's request for this job (the spec; its "Done when" list is mapped in 0.3),
work/skill-rank-timing-2026-10-21.md (findings 1-9 and the fix shape), docs/gold-set-answers.md "The order skill
ranks are worked out in" (~1143-1164, rulings 1-4), work/tweaks-part-b-notes/plan.md (B1-B27, the format of this
file), the six designer maps (scratchpad `map/{map-cases,map-early-sources,feat-pass,feat-grant-queue,map-tweaks-saved,readers}`;
the per-case today/print table is `map/map-cases/out-final.txt`), and the code named below. Print, from the AoN mirror
(`C:\wonderers guide\aon-2e-archive\data\by-category\rules\`): rules-1329 and rules-1331 (GM Core / GMG Dual Class),
rules-2065 (Player Core pg.29, leveling up: "in whichever order you want"), rules-2103 ("Initial Proficiencies", a
CREATION rule: a class training a skill you already have at 1st level → "you can select another skill"), and the
records' own clauses (Root Epithet class-feature-1066: "If you are already trained in the granted skill, you become
trained in a different skill of your choice, as normal"; Snare Setter: prerequisite "trained in Crafting" + "If you
were already trained in Crafting, you instead become trained in a skill of your choice").

Name code by SYMBOL. `~NNN` is a line hint only (build.ts moves hundreds of lines a day).

How builders use this file: one work package (WP) at a time, in the order of section 5. Each WP ends on an
independent Opus checker that re-reads the diff against the WP's "Done when", runs the named tests through
`node scripts/vt.mjs <files>` (never `npx vitest`), runs `npm run verify`, runs the WP's parity compare, and proves
each NEW guard fails once on a planted bad case (section 6 says where). Before each WP: `git status`; never overwrite
another chat's uncommitted edit. Commit locally, by file name only, never push. WP0 commits on main; WP1-WP10 commit
inside the lane `skillorder` (5.L), and WP11 merges the lane into main. Never `git add -A`, `.` or a
directory; never `git checkout HEAD -- <file>`, `git restore`, `git reset --hard`, `git clean`. **Never stage
`src/builder/shared.tsx`: it holds another chat's one blank-line change in `CampaignAttachCard`; never edit it in
the lane either (section 2's note).** The parity
instrument takes the heavy lock: never beside vitest. Line endings are mixed per file: measure each touched file with
node (count `\r\n` vs `\n`) before and after and keep its own. Test characters are synthetic; Guy's own characters
never enter the repo. Do not set `HH_ORCHESTRATOR=1`. Wanderer's Guide is evidence only (GPL-3.0): never copy its
code or data, never name it in release notes. A subagent that changed code in a folder with `graphify-out` runs
`graphify update .` once at the end of its WP.

---

## 0. Decisions + owner questions

### 0.1 Decisions (each is used below)

| id | decision | why |
|---|---|---|
| D1 | ONE skill-event ledger plus a print resolver. Every skill write and every skill judgement inside `buildCharacter` goes through one helper that (a) applies it to the live state at once, exactly where and how today's line does, and (b) records an event carrying its PRINT position (level, phase, record order, seq). One `resolveSkillPass` (new pure module `src/rules/skillPass.ts`) replays the events in print order. Today's code order stays as the "live path". | No physical reorder of the ~3,500 lines between the early block (~5198) and the feat plain-choice loop (~8739): they interleave features, spells, effects and feat queues that depend on today's order, and a moved block would be an unreviewable diff. Each judgement is written once (a pure closure, run on the live view and again on the print view). The live path yields, for free, the at-slot rank part B's sort needs (`AT_SLOT_PROBE` / `legacyRankSort` keep reading it unchanged) and the "before" the Builder notice compares against (ruling 3). |
| D2 | The resolve point is right after the feat plain-choice loop (~8722-8739), before anything after it reads skills. The print results REPLACE the live `proficiencies.skills`, `skillFallbacks`, `skillIncreases`, `grantedSkills`, `skillRankBefore`. `heightenBySkill` (~10891), the exactly clamp (~11466-11506), the literal (~11690-11713) and the language-Lore rerun (~11866) then run on print state. **The rerun's legacy side (D19):** whether the rerun happens reads `recordLanguageSlots(…, proficiencies.skills, …)` (~11693), and `languageChoicesAtRank` (Multilingual, Linguist Dedication: +1 slot at master Society, +1 at legendary) makes that count rank-dependent, so the print ranks can decide a rerun today's engine did not make (or the reverse). WP3 computes the decision twice: from the print skills (`languageLoreRerun`, drives the returned character, as today's code) and from the live skills after `applyExactClamp` (`legacyLanguageLoreRerun`). The returned character's `SKILL_ORDER_BEFORE` entry is the one of the build with the LEGACY decision: the same rerun build when both decisions are equal; the outer build's entry when only print reruns (carried into the rerun through a module-private `SKILL_ORDER_BEFORE_CARRY` WeakMap, set on `rerun` the way `AT_SLOT_PROBE` is carried, ~11868); and, when only legacy reruns or the two lists differ, the legacy entry of one extra `buildCharacter({ ...build, languageLores: legacyLanguageLoreRerun })` (rare: a language Lore + a rank-gated language slot whose rank moved). | It is the last write that belongs to the pass. WP1's inventory proves every skill read between ~5198 and ~8739 is either a judge (re-run in print order) or order-free. The notice's "before" and `--legacy-check` (G11) must be today's engine even on a character the rerun decision splits (final checker F10). |
| D3 | Per level, in this order: P0 creation (level 1 only) → P1 Tweaks floors starting at L → P2 old `=` sets and moved "exactly" entries starting at L (`entryLive`'s start level; in practice 1, since an old entry has no start level and an edit drops `moved`) → P3 class features and options of L → P4 heritage of L (level 1, and its later steps at their level) → P5 feats of L → P6 increases of L → P7 feats of L whose skill prerequisite needs that level's increases (D5). After the last level: the final pass (D9). **P2 swallow rule:** a P2 set on key K swallows (note `swallow`, no rank change) every event on K placed after it whose LIVE write ran before the old `=` slot (live `seq` < the set's `seq`): early-block sources of any level (skilled human expert at 5, heritage and apparition Lore steps, options above 1st), floors and increases. Events whose live write runs after the slot (the feat pass, `effectChoices`) raise it as today (case B). | Ruling 1's gloss: "that level's class features, heritage (1st), feats and their choice trainings, then that level's skill increases". Floors stay FIRST at their level because part B pins it (test/blocks-rank-seams.test.ts: "an in-build 'already trained when the feat was taken?' reader sees a floor from its start level", Molten Wit at 5 with a floor from 5 → trained); the findings' step 3 ("sources → clauses → floors → increases") predates that pin, and Guy said to keep every Tweaks behaviour. P2 reproduces the old `=` slot (part B B26 b): today the `=` runs after the whole early block and the increase loop, so every reader between the slot and the clamp sees the lowered rank. Measured (designer probe3): skilled human Athletics + a moved "exactly" untrained + Barbarian Dedication at 6 → today untrained, no replacement owed; without the swallow rule the 5th-level expert step would lift it again and the dedication would owe one. |
| D4 | Inside P5: the slot-draw order of `levelGrants(...).featSlots` (ancestry, class, cls2 class, skill, general, bonus, impulse, archetype = Free Archetype, mythic), then Tweaks-given feats (`activeGivenFeats`); every granted feat right after its granter, depth first. Inside P0: today's code order (seq). | Player Core pg.29 (rules-2065): "You can perform the steps in the leveling-up process in whichever order you want" — every order inside a level is print-correct (R9), so the Builder's own display order is chosen. It replaces today's dependence on `featPicks` JSON insertion order and Wanderer's Guide's "Free Archetype last" (ruling 1: print, even where WG differs). |
| D5 | Trainings and "already trained" judgements run feats-before-increases (D3). Feat prerequisites and "a skill you're trained in" choice pools read the rank at the END of the record's level, without that record's own steps and its granted feats' steps. **One moment for both questions:** a feat whose skill prerequisite is NOT met at its P5 place but IS met at the end of its level is moved, with its granted subtree, to P7 (after that level's increases), so its own trainings and "already trained" clause are judged where its prerequisite holds. The prerequisite test is one pure helper, `skillPrereqLines(feat)`, extracted from `checkPrerequisites`' rank-line branch (~13306: "X or Y" = any; a line with a non-skill alternative is not a skill prerequisite) and used by both. | Player Core pg.29 (rules-2065): "in whichever order you want", with its own example (the 10th-level boost "and then take Intimidating Prowess … at the same level"). Reading prerequisites at the start of the level would make a 7th-level master skill feat after a 7th-level master increase illegal for every rogue. But a feat can only be taken once its prerequisite holds, so a feat whose prerequisite needs the same level's increase has exactly ONE legal print order: increase first. Snare Setter (kobold, prerequisite "trained in Crafting", "If you were already trained in Crafting, you instead become trained in a skill of your choice") taken at 5 with the 5th-level increase on Crafting: print = Crafting trained + a skill of your choice. Without P7 the pass would give Crafting expert and no replacement, an order print does not allow (today gives the print result because it spends increases first: designer probe1 SN1). Excluding the record's own steps stops a feat from meeting its own prerequisite. |
| D6 | "Already trained" (ruling 2) = rank ≥ trained in the main view at the record's position, from ANY source: class, background, heritage, an earlier feat, a floor, an increase. It applies to every record that carries the clause today (`redundantFallback`, `conditionalSkillsFallback`, the Kholo-type ancestry Lore feats, Lion Blade, Molten Wit's branches) and, through D14, to class trainings after 1st level whose own text prints it. **Every judge reads its record's own level, never the final one:** a grant's ladder rank is `upgradeRankAt(g, view.level)` (today `at()` uses the character level, ~7971), and `redundantFallbackIfFeat` (Intuitive Crafting's "if you have both") reads `view.hasFeat(id)` = a feat row placed before this event and not granted by this record (today `feats.some(…)` reads the final list, ~8039). | Ruling 2, quoted: "already trained from ANY source when the feat is taken (an increase or another feat included) → a skill of the player's choice instead". "When the feat is taken" is that level, so a later ladder step or a later feat cannot answer it. |
| D7 | Two views: `main` (every event) and `noMoved` (main minus moved floors and P2 sets). Molten Wit's three branches and the `skillRankBefore` snapshot (`SKILL_RANK_BEFORE_OWN_GRANTS`) read `noMoved`; every other judge reads `main`. | Part B B26 a: "a moved floor is not in the asOf replay" — the old `=` never fed that reader. Keeps `overrides:asof:*` at NUMBER 0. |
| D8 | Tweaks kept whole: "at least" floors land at their start level (P1); "exactly" stays the final clamp after the resolve (code unchanged); old Overrides feed the build through part B's sort, whose probe keeps reading the live path. | Guy: "Keep every Tweaks behaviour". |
| D9 | Final pass after the last level: `crossConditionalSkills` ("if you have legendary X": Bardic Lore, Loremaster, Folktales, Gossip, Wild Mimic Lore). Its step's level = the later of the record's level and the first level the gate holds. | Standing gates read the finished character (findings case 2; BL15 opens, BL14 stays closed). The step level lets the history say "Expert at 15th". |
| D10 | `FEAT_RANK_FEAT_GRANTS` (src/rules/featFeatGrants.ts) is judged after the resolve, on the print history. Stonemason's Eye and Intuitive Crafting ("if you were already trained in Crafting, you instead gain Specialty Crafting"): the rank at the feat's position, before its own steps. Student of Water (Underwater Marauder at trained Athletics, Water Sprint at master) and Raging Intimidation (Intimidating Glare at trained, Scare to Death at legendary): granted at the first level the gate holds, and that granted row's `level` is that level. Gildedsoul (Courtly Graces "if you're trained in Society"): a standing gate on the final rank, as today. The live queue (~7823) still computes today's decision, but only into the D19 side channel: it no longer pushes a row and no longer adds to `takenFeats` or `grantedPairs`. `rankGatedGrants` runs after the resolve and (a) skips a feat in `liveRemovedFeatIds(build)` (a Tweaks removal stays removed), (b) skips a feat the character already holds at that point (today's `takenFeats` dedupe, read from `feats`), (c) re-sorts `feats` by level after inserting (stable), because the removal pass and `feats.sort` (~7913-7918) ran before it. | Findings case 5 (S1/IC1). Gildedsoul's sentence reads either way and both are print-correct (R9), so today's reading stays. The six granted feats (specialty-crafting, courtly-graces, underwater-marauder, water-sprint, intimidating-glare, scare-to-death) carry nothing the passes between the queue and the resolve read; guard G5 pins that. |
| D11 | Source levels come from one helper, `sourceLevelOf` (section 1.1). The event level for class-2 features (today `srcLevel` ~7775 knows class-1 features only) and the grantSources rows pushed at level 1 is fixed internally; the feat ROW `level` field shown on the sheet is NOT changed, except D10's granted rows. | Correct event levels are the whole fix; a row level is display only, and moving it is a separate visible change (deferred, 7.3). |
| D12 | The engine emits a derived `Character.skillHistory` (shape in 1.5). Pure readers live in `src/rules/ranks.ts` (a leaf that explain.ts already imports). It replaces the Builder's `baseSkills` rebuild, explain's inferred timeline and the reverse build's timing guess. `skillRankBefore` keeps its shape (`qualifiesForOption` reads it) but is filled by the pass. `skillRankHere` / `replayedRank` / `laterFloorsOf` stay in the live path only. | Guy: "Readers with their own model must read the engine's per-level history". A Character field survives `carryStoredOverrides`' spread; a WeakMap would not. |
| D13 | Saved builds are never rewritten on load. A new optional `BuildState.skillOrder?: 2` marks a build already seen by this engine. `emptyBuild()` sets it; old builds lack it (UNKNOWN ≠ EMPTY). The Builder stamps the draft at open (like `openForTweaks`) and shows the notice for an unstamped build; Save persists the stamp. Orphaned answers stay stored and unread. **A GM's edit does neither:** the Builder gets a prop `skillOrderNotice?: boolean` (default true); `GmEditSheet` (~522) passes `false`, and with it the Builder shows no notice, does not stamp at open and does not stamp at Save, so the stamp state of `initial` (absent) is carried unchanged and the player sees the notice on their own next open. | Ruling 3 + Guy's "never rewrite on load; keep orphaned answers". Ruling 3 is for the player ("tell the user what will change in their characters"); GmEditSheet renders the same Builder with the player's build (src/sheet/GmEditSheet.tsx:522) and pushes what it saves. |
| D14 | Class trainings after 1st level (a class option, a class feature with `grants.skills`) that hit an already-trained skill owe a replacement pick ONLY where the record's own text prints the clause: Root Epithet (class-feature-1066: "If you are already trained in the granted skill, you become trained in a different skill of your choice, as normal") covers every epithet option it grants. The pick is stored like a feat's: `featSkillChoices['<recordId>:fallback:<skill>']`, rendered beside that option on its level page. A record without the clause gets no replacement (today's behaviour) and goes to 7.3 with its id. Level 1 keeps today's class-pick skip. | Print, record by record (R12-style: the record's own words). rules-2103 is "Initial Proficiencies", a creation rule, so it does not by itself reach later levels. Without this, A5 (Barbarian Dedication at 2, The Brave at 3) loses a skill: D6 removes the dedication's replacement, and Root Epithet's clause then owes one. |
| D15 | Dual Class: the main increase levels are the union of both classes' `skillIncreaseLevels` (one increase per level); the bonus lane and its restriction come from whichever class owns that level; `levelGrants` and the reverse build use the same union. The live path keeps class-1 eligibility, so the notice can name "your 2nd-level increase now counts" and the new empty slots (3.3 line 7). | rules-1331: "A dual-class rogue/ranger still gets the extra skill feat and skill increase at levels where the other class doesn't provide them"; rules-1329: "add everything from each class except Hit Points and starting skills: … skill increases for rogues". Measured (designer probe3): `levelGrants` for fighter+rogue gives increases only at 3, 5; rogue+fighter at 2-6. |
| D16 | `SkillIncrease` gains `lane?: 'bonus' \| 'background'` (absent = main). | The reverse build and the readers must tell the three lanes apart; today they guess from the class's levels. |
| D17 | The guard comes first and is a ratchet: each print expectation that today's engine gets wrong is `it.fails` with the WP that fixes it; that WP flips it to `it`. A WP that fixes a case without flipping it fails the run. **Every flipped case also carries `today` (today's exact wrong values, from map/map-cases/out-final.txt, e.g. K1 `skills: { stealth: 'trained' }`, `fallbacks: ['kholo-lore:stealth']`), asserted by a PLAIN `it` premise test while `flips` is set: every id resolves in content, the build does not throw, and today's values hold. The flipping WP sets `flips: null` and deletes `today` in the same commit, which removes the premise test and turns `it.fails` into `it`.** A meta test: every case with `flips` has `today`, and every case without `flips` has none. | Guy: "Guard test first, failing today". `it.fails` passes whenever the test throws for ANY reason (a renamed id, a wrong slot key, an engine throw); the premise test proves each case fails for the reason the findings give, not a typo. |
| D18 | Parity: `normaliseCharacter` in scripts/blocks-parity-snapshot.mjs drops `skillHistory`, so `build.hash` is history-blind. The new rank-shaped stats (5.WP0) live in a sibling field of each gate, `g.rankStats` (beside `buildHash`), added in `flattenNumbers` only; they never enter `g.numbers`. A `skillorder:*` family carries the guard cases. Taken BEFORE any engine edit. | Otherwise one new field moves every hash and hides the real moves. `g.numbers` is compared whole by part B: `legacyDeltas` (test/tweaks-migration.test.ts ~356, test/tweaks-legacy-fixture.test.ts ~95) diffs every `numbers` key against the `#none` twin and the never-retaken fixture, and test/tweaks-save-stamp-numbers.test.ts:51 compares `numbers` before and after `openForTweaks`; a new `numbers` key would turn all three red at WP0 with no allowed way back. |
| D19 | The legacy result for the notice travels in a module-private `WeakMap` keyed by the returned Character (`SKILL_ORDER_BEFORE`; the name avoids part B's `/probe\|at_?slot/i` rule), read by one export `skillOrderChanges(build, content)` and, for the parity instrument only, `skillOrderLegacyOf(character)` → `{ skills, skillFallbacks, skillIncreases, rankGated }` (skills after `applyExactClamp`). Nothing legacy goes on Character. | No stored field for a one-time message; no second build in the engine. The instrument read lets every gate from WP3 on prove the live path still equals today's engine (`--legacy-check`, WP3), because the notice's "before" is only as good as that. |
| D20 | Int-boost trainings and language Lores stay at creation (P0), as today. | `classSkills` is a flat list with no level; moving them needs a per-level pick and a stored level (deferred, 7.3). |
| D21 | WP1-WP10 run in ONE worktree lane, `skillorder` (5.L), cut from WP0's commit; each WP commits inside the lane by file name; WP11 merges the lane into main once WP10 passed. | WP3 (the switch) changes saved characters' ranks and replacement picks, and the notice and the `emptyBuild` stamp arrive only in WP9. Another chat releases from main (`hh-release` ships main), so a release cut between WP3 and WP9 would break ruling 3, and characters made in that window would lack the stamp. The lane is the project's own mechanism (scripts/worktree-lane.mjs, docs/worktree-lanes.md; the release skill uses it too) and shares main's heavy-job lock. |

### 0.2 Owner questions: none

Each candidate was checked against the rule (ask only on a ruling conflict, an unsettled print text, or WG contradicting print):
- Order inside one level (feats vs increases, slot order, Free Archetype place): Player Core pg.29 makes every order correct → R9, decided in D4/D5.
- Prerequisites at the start vs the end of the level: both print-correct (pg.29's own example) → D5.
- A feat whose prerequisite needs that level's increase (Snare Setter at 5 + the 5th-level Crafting increase): no ruling
  question. Ruling 1 says "level by level, as print"; its gloss ("feats …, then that level's skill increases") is the
  order where print allows any order. Here print allows only one (a feat needs its prerequisite when taken), so the
  feat goes after the increase (D5, P7). This does not conflict with the ruling: the gloss is followed everywhere else.
- Gildedsoul standing gate vs "when taken": the sentence reads either way → R9, today's reading kept (D10).
- Class trainings after 1st level (Root Epithet): settled by the record's own clause ("… a different skill of your
  choice, as normal") → D14. Records without a clause keep today's no-replacement (print says nothing) → 7.3.
- WG differences (FA last, ancestry feats first, free extra skills): ruling 1 already chose print.

### 0.3 Guy's "Done when" → where it is proven

| his words | proven by |
|---|---|
| work out skill ranks level by level, as print | D1-D9; WP1-WP3 (in the lane, D21) |
| 4 rulings: level by level even where WG differs; already trained from ANY source → pick another; Builder notice, silent if nothing; start after Tweaks part B | D3-D6; WP9; part B ends at c52f9b7 (HEAD's parent chain holds 7155266…c52f9b7) |
| keep every Tweaks behaviour (floors at their start level before increases; exactly = final clamp; old Overrides as before) | D3, D7, D8; part B tests kept green in every WP; 3.4 |
| guard test first, failing today; parity snapshot first | WP0 |
| WPs, each with an independent checker and a commit by file name | section 5 (every WP) |
| saved characters: never rewrite on load; keep orphaned answers; notice; part B numbers kept except intended moves | section 3; WP9; WP3 gate; part B's three browser characters (`tweaks-browser:*`, WP0 step 6) at NUMBER 0 in every gate, and the fixture fighter's sheet re-checked in the browser (WP10 step 6) |
| readers with their own model read the engine's history | section 2; WP7, WP8 |
| Dual Class second-class increases and the FA order | section 4; WP3 (FA), WP6 (Dual Class) |
| every findings case gives the print result | G1 with zero `it.fails` left (WP11) |
| verify and the full suite green | every WP (verify); WP0 + WP11 (full suite; a failure still there at WP11 is a "Still open" line, never "done") |
| parity shows only intended, classified moves | WP3/WP4/WP5/WP6 gates; WP11 compare against the WP0 baseline |
| browser test desktop + phone | WP10; re-run on main's merged code when the merge conflicted or main moved a touched file (WP11 step 0g) |
| release notes + memory note | WP11 |

---

## 1. The model

### 1.1 Every skill / Lore source, with its level

"Today" is where the write sits now; "level" is the print level the event carries (`sourceLevelOf`); "phase" is D3's.

| # | source | today (symbol, ~line) | level | phase |
|---|---|---|---|---|
| 1 | class trained skills (fixed list, class Lore) | early block ~5198 | 1 | P0 |
| 2 | class 2 trained skills (Dual Class "skills automatically granted by each class") | early block | 1 | P0 |
| 3 | background skill + Lore, its choice lanes, homebrew background fallback (`<bg>:fallback:<skill>`) | early block ~5258 | 1 | P0 |
| 4 | heritage trained skill (`heritageSkill`), heritage Lore first step (`loreStep`) | early block, `loreStep` at the FINAL level | 1 | P0 |
| 5 | later heritage Lore steps; apparition Lore steps | folded into the early block at the final level (`loreStep` ~5386, `optLoreStep` ~5420) | each step's level READ FROM the record's `loreProgression` (never hard-coded): heritage Lorekeeper Shisk expert at 5; every animist apparition expert at 8, master at 16 (14 options, core.json). An apparition's own training sits at the option's level (`extraPickLevel`) | P4 (heritage), P3 (apparition) |
| 6 | skilled human expert | early block `level >= 5` | 5 | P4 |
| 7 | second heritage (`secondHeritageIdOf`) and a feat-granted background (`passionBackground` ~683) | early block, read at level 1 | the granting feat's `heldFeatSlots` level | P5, right after the granting feat |
| 8 | `grantOptions` (an option's `grants.skills` "=trained", `removesSkills` delete, `lores`, `optLoreStep`, `skillChoice`) | early block, final level | the option's level: `extraPickLevel(g, index)`, `subclassAnchorLevel`, kineticist first threshold; class-archetype substitutes stay 1 (R9) | 1 → P0; above 1 → P3 |
| 9 | dragon-type skill; cleric deity skill (`clericDeitySkill`) | early block | 1 | P0 |
| 10 | class skill picks (`additionalClassSkills`, skip a skill locked at 1) | early block | 1 | P0 (judge) |
| 11 | language Lores (`languageLores`, `intLanguageSlots`) | early block | 1 (D20) | P0 (judge) |
| 12 | Tweaks floors (`skillFloorsAt`, `applySkillFloors`; moved floors flagged) | seam 1 ~5524-5542 and the increase loop | start level | P1 |
| 13 | old `=` (`liveLegacyRanks`) and a moved "exactly" entry (B26 b) | old slot ~7121-7146 | its start level (`entryLive`; in practice 1) | P2 (set; swallows every later-placed event on that key whose live write ran before the slot, D3) |
| 14 | feat-granted feats (`FEAT_FEAT_GRANTS`, `_LEVELED`, substitutes) | queue ~7649-7911, `srcLevel` ~7775 | the granter's level (class-2 features fixed) | P5 after the granter |
| 15 | feat proficiency pass: static skills + `redundantFallback`, `conditionalSkills` (+Fallback), `skillsIfFeature`, `skillChoices` slots, answered `choiceGrants`, `loreChoices`, Lion Blade `conditionalRank` + fallback, rank upgrades (`upgradeRankAt` featGrants.ts:40) | ~7934-8291 in `grantSourcesForProficiency` order (feats by level, then ALL class features, then heritages), each at the final level | the record's level; upgrade steps at their own levels | feats P5, class features P3, heritages P4 |
| 16 | `crossConditionalSkills` | same pass | D9 | final |
| 17 | Molten Wit three branches | ~8316-8340 | the feat's level | P5 judge, `noMoved` view |
| 18 | class `skillProgression` (Warfare, Esoteric, Undead Lore) | ~8540 (`ownedFeatureIds`) | each step's level | P3 |
| 19 | `effectChoices` / `applyAlwaysOn`: feats, heritages (+ `skillProgressionFromChoice` ~8638: Ancient Ash, Lorekeeper Shisk expert at 5), background, deity, class features, `grantOptions`, inventor modifications, feature plain choice, feat plain choice (~8722) | ~8558-8739 | the record's level; progression steps at theirs | by record kind: feat P5, heritage/background/deity P4, class P3 |
| 20 | `FEAT_RANK_FEAT_GRANTS` | queue ~7823 | D10 | after the resolve |
| 21 | skill increases: main, bonus (`bonusSkillIncreaseLevels` + `restrictedSkillIncreaseAllowed`), background (`backgroundSkillIncreaseAllowed`); the old-key Lore alias (~5582: `lore:lore-of-the-sea` follows its Lore to `lore:sea` when the new key is trained) | loop ~5544-5601 | stored level | P6 (the alias is a judge on the print view) |
| 21b | feats whose skill prerequisite needs that level's increases (D5) | — (today the increases run first) | the feat's level | P7 |
| 22 | `heightenBySkill`, exactly clamp, literal, language-Lore rerun | ~10891, ~11496, ~11690, ~11866 | — | after the resolve, unchanged, except the rerun's legacy side (D2) |

### 1.2 The pass (one walk, level by level)

```
resolveSkillPass(events, ctx):          // ctx: final level, skillIncreaseCap, LOCKED_SKILL_KEYS, eligibility per lane
  sort events by (level, phaseRank, orderPath[], seq)
  main = {}, noMoved = {}, locks = {}, swallowed = Set, fallbacks = [], increases = [], before = {}, steps = []
  for level = 1 .. ctx.level:
    P0 (level 1)  raise / delete / lock / judge (class picks skip locks; language Lores)
    P1            floors starting here: maxRank (moved ones: main only)
    P2            sets starting here: key = rank on main only; swallowed[key] = the set's live seq
    P3, P4, P5    raise; judge(view) → effects: raise | fallback{featId, skill, slot?, note?, lore?, rank?} + the stored pick
                  (skillFallbackPick) raising its answer | before{carrier, ranks} | lock (level 1 only)
                  a P5 feat whose skillPrereqLines fail here but hold at the end of the level → deferred to P7 (D5)
    any phase     an event on a swallowed key whose live seq < swallowed[key] → step note 'swallow', no rank change
    P6            per lane (main, bonus, background): key = alias judge on the view (stored, or its loreKey form when
                  the stored key is untrained and the new one trained); drop if LOCKED_SKILL_KEYS or the lane's
                  restriction (note drop, not pushed, as today); swallowed (note swallow) or stepRank(rank,
                  skillIncreaseCap(level)) (note cap if no change); push {level, skill: key, lane?} — a swallowed
                  increase IS pushed, as today (~5598: today it was applied and pushed, and the `=` overwrote it)
    P7            the deferred feats, in their D4 order, with their granted subtrees
  final pass:     crossConditionalSkills judges, in record order
  return { skills: main, fallbacks, increases, grantedSkills: level-1 locks, skillRankBefore: before,
           history: { v: 1, steps, at } }
```
Every event that touches a key appends one step (1.5), including judged no-changes. A judge is a pure closure:
`(view: { rank(key), locked(key), level, hasFeat(id) }) => SkillEffect[]`; `view.level` is the event's own level
(D6: ladders via `upgradeRankAt(g, view.level)`), `view.hasFeat` sees only feat rows placed before the event and not
granted by its record. The live path runs it on the live view at today's place (live `level` = the character level,
live `hasFeat` = today's final list, so the live result is unchanged) and applies its effects there; the resolver runs
it again on the print view. Nothing else in a judge may mutate.

### 1.3 Final passes

1. `crossConditionalSkills` (D9) inside the resolver, after level `ctx.level`.
2. After the resolve, in `buildCharacter`: D10's rank-gated grants (reading the print history), then the existing
   `heightenBySkill`, the exactly clamp (extracted into `applyExactClamp(skills, …)` so the notice's legacy side can
   be clamped by the same function), the literal, the language-Lore rerun.

### 1.4 Rank-gated grants (D10)

- New `rankGatedGrants(history, feats, table)` beside `FEAT_RANK_FEAT_GRANTS`'s readers: for each held carrier,
  "when taken" entries read `skillRankBeforeSource(history, 'feat:<carrier>', skill)`; "as soon as" entries
  (`student-of-water`, `raging-intimidation`) read `firstLevelAtRank(history, skill, rank)` and grant at
  max(carrier level, that level); Gildedsoul (`countOwnGrant: true`) reads the final rank.
- A field `when: 'taken' | 'reached' | 'standing'` is added to each `FEAT_RANK_FEAT_GRANTS` entry (data stays in
  that file) so the rule is per entry, not per name.
- The live queue keeps computing today's decision into the legacy side channel (D19) and no longer pushes rows, adds
  to `takenFeats` or adds to `grantedPairs` (so an S1-type legacy grant blocks no other granter).
- `rankGatedGrants` skips `liveRemovedFeatIds(build)` and feats already held, and re-sorts `feats` by level (stable)
  after inserting (D10).

### 1.5 The per-level history

```ts
// src/rules/types.ts
export type SkillPhase = 'create' | 'floor' | 'set' | 'feature' | 'heritage' | 'feat' | 'increase' | 'featAfterIncrease' | 'final';
export interface SkillStep {
  level: number;            // print level of the step
  phase: SkillPhase;
  key: ProficiencyKey;      // 'stealth', 'lore:sailing', …
  from: ProficiencyRank;
  to: ProficiencyRank;      // === from for a judged no-change
  source: string;           // '<kind>:<id>' — kind: class | class2 | background | heritage | ancestry | option |
                            // feature | feat | deity | classPick | langLore | floor | set | increase | bonus |
                            // bgIncrease | pick (a stored replacement answer, id = the record that owed it)
  note?: 'same' | 'redirect' | 'swallow' | 'cap' | 'drop';
  pick?: ProficiencyKey;    // with note 'redirect': the replacement the stored answer trained, absent when unanswered
}
export interface SkillHistory {
  v: 1;
  steps: SkillStep[];                 // already in print order
  at: Record<string, number>;         // '<kind>:<id>' → index of that record's first step (its print position);
                                      // every record that had an event, judged no-changes included
}
// Character: skillHistory?: SkillHistory   (derived; absent on a character built before this engine)
```
- Derived only: never authored, not in `CARRIED_CHARACTER_FIELDS` (src/data/authored.ts), ignored by `authoredKey`,
  dropped from the parity hash (D18). Names are resolved at display time from content, never stored.
- Size budget: ≤ 16 KB of JSON on the largest snapshot character (guard G4).
- Readers (src/rules/ranks.ts, pure, history-only; each returns `undefined` when `c.skillHistory` is absent so the
  caller keeps today's reading):
  - `skillRankAt(c, key, level, point, opts?: { without?: ReadonlySet<string> })` with
    `point: 'creation' | 'beforeIncreases' | 'afterMain' | 'afterBonus' | 'end'` — the `to` of the last step for
    `key` at or before that point; `final` steps count only at `'end'` of their level; `without` skips steps whose
    source id is in the set.
  - `skillRanksAt(c, level, point, opts?)` — the same for every key at once.
  - `skillRankBeforeSource(c, source, key)` / `skillRanksBeforeSource(c, source, opts?)` — the rank(s) just before that
    record's print position (`history.at[source]`), for one key or every key; `undefined` when the record has no
    position (the caller then uses `skillRanksAt(c, level, 'beforeIncreases', { without })`).
  - `firstLevelAtRank(c, key, rank)` — the first level whose end holds ≥ rank.
  - `historyAgrees(c, key)` — the history's last `to` for `key`, after the "exactly" hold the explain line already
    shows, equals `c.proficiencies.skills[key]`. A reader of a STORED character (explain) uses the history for a key
    only when it agrees; otherwise it keeps today's reading. (The import patches ranks after the build,
    src/data/transfer.ts ~1415-1447, so its stored history can end below the sheet until the next launch rebuild.)
- What it replaces: `Builder` `baseSkills` (~517-544, one full rebuild per level page), explain's `skillTimeline`
  inference (~1201-1261), the reverse build's "earliest free level" (~12731-12758). `skillRankBefore` stays, filled
  by the pass from `noMoved`.

### 1.6 Why a ledger and not a reorder

- A reorder moves the early block (~5198-5494), the increase loop (~5544-5601), the old slot (~7121-7146), the queue
  (~7649-7911), the proficiency pass (~7934-8291), Molten Wit, `skillProgression` and `effectChoices` (~8540-8739)
  into one loop. Those blocks also build features, spells, effects, warnings and feat rows that later code reads in
  today's order; every one would need re-proving.
- The ledger changes each write line in place (WP1, NUMBER 0 provable) and adds one module; the order lives in one
  sort key, testable by itself.
- The live path stays for exactly two readers (part B's at-slot probe, the notice's "before"); G2 and G3 keep it and
  the ledger in step, and G11 (`--legacy-check`, every gate from WP3 on) keeps it equal to today's engine while WP4-WP6
  edit the shared judges and lanes.

---

## 2. Readers that must read the history

**src/builder/shared.tsx is never edited inside the lane** (final checker F1). The lane is a clean detached checkout
of WP0's commit, so a `git status` there never shows the other chat's uncommitted blank line in main's copy, and
`worktree-lane.mjs apply` refuses the WHOLE patch while main has uncommitted changes in a file the patch touches
(docs/worktree-lanes.md, "On main", step 1). Its three readers (the background caller ~4044, the homebrew-background
replacement picker ~4118-4140, `newLoreRefusal` ~5305) move in WP11 step 0h, on main after the merge, only if MAIN's
copy is clean then; otherwise they are a "Still open" line in the final report (7.3 item 12, 7.5).

| reader | today | change (WP) |
|---|---|---|
| Builder skill increase picker (`Builder` `baseSkills` useMemo ~517-544; options ~3690-3730; `increaseNote`; result `nextRank(baseSkills[…], lvl)`) | a full `buildCharacter` with increases below `sel` and `overridesAsOf(build.overrides, sel)`; every source folded at the final level, so the level-3 page counts a feat taken at 4 (P1-P4) | `skillRanksAt(featPrereqChar, sel, 'beforeIncreases')`, then the "exactly" entries active at `sel` laid over it (the same `rankTweaks` read `skillTweakNotes` uses) so a held skill reads as the sheet reads it. The bonus and background pickers (`store: build.bonusSkillIncreases` ~3753, `build.backgroundSkillIncreases` ~3763) read `'afterMain'` / `'afterBonus'`. Lore keys come from the same map. The extra build goes; drop the `overridesAsOf` import if unused; remove the allowlist entry `src/builder/Builder.tsx#Builder>baseSkills` from src/rules/blocks/overrides-readers.json in the same commit (WP7) |
| `skillTweakNotes(host, lvl, key, baseRank, picked)` (src/builder/tweaks/skillNotes.ts) | `baseRank` from `baseSkills` | same value from the new map (WP7) |
| feat prerequisites `checkPrerequisites(feat, character, content)` (~13237) | skill and Lore lines read the final `character.proficiencies.skills` | new optional 4th arg `{ atLevel?: number; without?: ReadonlySet<string> }`; with it and a history, rank lines read `skillRankAt(c, key, atLevel, 'end', { without })` (the same `skillPrereqLines` helper the resolver uses, D5). Builder callers pass the slot level and `without` = a SUBTREE: the feat id plus every `character.feats` row whose `grantedBy` chain reaches it. Which feat: ~3536 (the picked feat's own revalidation badge) = the picked feat; ~4019 and ~4137 (the feat picker's rows, candidates not yet in the build) = the slot's OCCUPANT, `build.featPicks[pickerKey]`, when there is one, because a candidate replaces it (Barbarian Dedication in 2:class:0 trains Athletics at 2: a candidate needing trained Athletics is not met once it replaces the dedication). Other callers keep the final rank (WP7) |
| skill-choice pools: `buildChoiceOptions` kind `'skills'` → `trainedSkillOptions(character, minRank)` (~2875) | final ranks | `buildChoiceOptions` gets the record's level (from `slotKey`'s level, or the granted row's level) and passes `{ proficiencies: { skills: skillRanksAt(c, level, 'end', { without: record subtree }) } }` (WP7). The background caller in src/builder/shared.tsx:4044 is not touched in the lane; it moves in WP11 step 0h (main, after the merge) only if main's copy is clean, else it is a "Still open" line |
| feat "Trained skill" slot picker (Builder ~1207-1236: `cur = featPrereqChar.proficiencies.skills[s]`, `dead = s !== effective && skillSlotGrant(slot, cur) === null`, reason "Already <rank> — this grant would change nothing") | final ranks: a Gildedsoul (1st, Diplomacy or Society, `redundantFallback`) with a 3rd-level Society increase greys Society in the 1st-level slot; Rogue Dedication at 2 with an Arcana increase at 3 greys Arcana in its "any" slot; print has both untrained at that point | `cur` = `skillRanksBeforeSource(featPrereqChar, 'feat:<id>', { without: record subtree })[s]` (the rank at the record's print position, so the same-level feats before it and nothing after it count), falling back to `skillRanksAt(…, featLevel, 'beforeIncreases', { without })` (WP7; P8, P9) |
| class skill picks greying (`grantedSkills`) | `grantedSkills` = every early-block source, later-level ones included (A6) | no code change: the pass fills `grantedSkills` with level-1 locks only (WP3) |
| `newLoreRefusal` second branch (shared.tsx ~5305: `proficiencies.skills[key] !== 'untrained'` refuses a Lore trained at ANY level) and the homebrew-background replacement picker (shared.tsx ~4118-4140: heading `held` and greying from `limitChar`'s final ranks) | final ranks for a level-1 question | read `skillRanksAt(c, 1, 'creation')` (P0 only). **Parked:** never edited in the lane; WP11 step 0h moves both (with the 4044 line) on main after the merge, only if `git -C "C:\trying ai 2\pf2e codex" status --porcelain -- src/builder/shared.tsx` prints nothing; otherwise a "Still open" line |
| replacement ("fallback") picker (Builder ~1243-1310) | heading `held` = final rank; options grey final ranks | `held` = `skillRankBeforeSource(featPrereqChar, 'feat:<id>', fb.skill)`; options grey skills trained at the record's print position, `skillRanksBeforeSource(c, 'feat:<id>', { without: record subtree })` (fallback `skillRanksAt(c, featLevel, 'beforeIncreases', { without })`) (WP7). The same component renders D14's class-option picks (WP5) |
| "how was this calculated" popup: explain.ts `skillTimeline` ~1201-1261 | part B already replays the 1st-level training, floors at their start level, each increase (with "no change: already X") and the "exactly" hold last (test/tweaks-skill-timeline.test.ts pins those lines); every other raise is one unnamed "Raised to X" line at `c.level` | part B's line texts stay exactly ("1 At least Trained [Tweak (tutored)]", "3 Skill increase → Expert", "(no change: already Expert)", "Held at Trained" last). New: the steps part B could not name get their record and level ("1 Trained [Kholo Lore]"; Medic Dedication's "Raised to Expert" becomes "2 Expert [Medic Dedication]" (WP7 edit: the feat's own level, 2nd, where the test gives it; "4" was the character's level) — that one pinned line in tweaks-skill-timeline.test.ts changes, cited), plus `redirect` ("Kholo Lore: already trained — you picked Arcana"), `swallow`, `cap`, `drop` lines. Uses the history for a key only when `historyAgrees(c, key)`; otherwise today's replay (WP7) |
| `qualifiesForOption` (derive.ts:2133) | reads `skillRankBefore` | none: the shape is kept, the pass fills it |
| reverse build `deriveBuildFromCharacter` (~11940) | native increases by class-1 levels (~12006-12023, `bonusLevels` from `classId` only); synthesis "earliest free level by cap" (~12731-12758) | native increases split by `lane` and by D15's union (~12018, ~12740); a synthesized increase lands at the earliest free level ≥ `firstLevelAtRank(baseline, key, 'trained')` of the baseline build (~12638-12730), so it never lands before the training it builds on (WP8). Measured (designer probe1): a build-less character (no `skillIncreases`) with Kholo Lore at 5 and Stealth expert gets its increase at 3, and the rebuild gives Trained, today and after WP3 alike (RB2); with Kholo Lore at 1 it gets 3 and rebuilds Trained today, Expert after WP3 (RB1) |
| WG import, src/data/transfer.ts `importCharacter` (warnings ~736-1615; final rank bump ~1411-1450) | patches ranks onto the stored character; the next launch's `rebuildRoster` drops them silently | after the reverse build, rebuild once and add one warning per skill the rebuild cannot reach: "<Skill>: the file has <Rank>; the rebuilt character has <Rank>." The bump stays (WP8) |

---

## 3. Saved characters

### 3.1 Never rewrite on load
- `rebuildRoster` (src/data/rebuild.ts) is untouched: the stored build is read, the derived character is refreshed
  as a DERIVED refresh (`noteDerivedRefresh`), as for every engine change. `skillHistory` is a derived field, so it
  rides that path and never counts as an edit.
- No code path writes `skillOrder` except `emptyBuild`, the Builder's open stamp and Save, and neither stamp runs in
  the GM's edit sheet (D13, G10).

### 3.2 Orphaned answers
- A stored `featSkillChoices['<id>:fallback:<skill>']` (or `featLoreChoices[…]`) whose replacement is no longer owed
  stays in the build. The engine reads an answer only for an owed replacement (`skillFallbackPick`), so it is inert;
  it counts again if the player reorders back. No prune touches `featSkillChoices` (WP9 confirms by grep of
  `pruneOverrides`, `stampTweaksSave`, `openForTweaks`, save.ts). K1s pins it.

### 3.3 The Builder notice (ruling 3)
- WHEN: `initial` lacks `skillOrder`. Computed once at open from `initial` by `skillOrderChanges(initial, baseContent)`
  (one `buildCharacter`, reads D19's side channel). The draft is stamped `skillOrder: 2` by `openForSkillOrder` at
  the same call sites as `openForTweaks`; `useBuildChanged` treats it as "not the player's change", so Cancel asks
  nothing and stores nothing. Save persists the stamp (`stampSkillOrderSave` beside `stampTweaksSave` in `submit`),
  so the notice never shows again. Cancel → it shows again next open. New characters, WG imports and reverse builds
  start from `emptyBuild` and never show it. In the GM's edit sheet (`skillOrderNotice={false}`, D13) there is no
  notice, no open stamp and no Save stamp.
- WHAT (legacy result vs print result, both after the same `applyExactClamp`), one line each:
  1. a rank changed: "Stealth: Trained → Expert (Kholo Lore at 1st, skill increase at 3rd)." — the brackets list the
     print steps that raised that key, by name and level;
  2. a replacement no longer owed: "Kholo Lore (1st) no longer gives a replacement skill: Stealth was not trained yet
     when you took it." plus, when an answer is stored, "Your earlier pick, Arcana, is kept but no longer counts.";
  3. a replacement newly owed: "Barbarian Dedication (2nd) now lets you pick a replacement skill: Athletics was
     already trained. Pick it on the 2nd-level page.";
  4. a rank-gated feat gained or lost: "Stonemason's Eye no longer gives Specialty Crafting: Crafting was untrained
     when you took it at 1st." / "Raging Intimidation now gives Scare to Death at 15th.";
  5. an increase that now counts or no longer counts: "Your 2nd-level skill increase (Acrobatics) now counts." /
     "Your 3rd-level increase on Stealth no longer raises it: it is held by a tweak.";
  6. a feat whose skill prerequisite is met only at a later level (D5): "Assurance (3rd) needs Expert in Medicine,
     which you reach at 5th."
  7. new empty increase slots (D15, Dual Class): "You now get a skill increase at 2nd, 4th and 6th level from your
     second class. Pick them on those level pages." (and "an extra skill increase" for a bonus lane). Computed from the
     print lanes' levels (union) minus the legacy lanes' levels, at or below the character level, where the build
     stores no answer for that lane. A stored answer at such a level is line 5 instead.
- Wording rules (G7 tests them): plain words; skill names through `skillKeyLabel`; ranks as capitalised words;
  levels as ordinals; never the words override, engine, legacy, print, ledger, history, Wanderer's Guide; heading
  "Skill ranks are now worked out level by level, as the rules do. On this character that changed:"; at most 6 lines,
  then "…and N more" opens the rest; empty list → no element at all (silent).
- WHERE: all lines in a `.setup-note` on the Setup page (~2862); each line also as a `.lvl-note` (~3607-3623) on its
  level page (rank lines on the level of their first differing step, the rest on the record's level).

### 3.4 Old Overrides and Tweaks test characters
Part B's numbers stay except these intended moves, each of which must appear in the WP3 classification and, where a
part B test pins the old value, be added to test/tweaks-migration.test.ts `EXPECTED` with its case:
1. A Tweaks "at least" floor whose start level is ABOVE a same-key feat's level (a floor from 3 on Stealth + Kholo Lore
   at 1): the feat now trains Stealth with no replacement owed (ruling 1 + 2). Part B's live order judged after the
   floor. Pinned by the case OV5 (`skillorder:OV5`, added in WP3's fix round; no other snapshot character has this shape).
2. Any old character that also matches a findings case (K1, K4, B2, S1, J1, AA3/AA7, LS1/LS2, AD1-AD3, V2, I2, FA1,
   DC1/DC3, A2, A5/A6, OW1, MW1, IC1, BJ1 = Blackjacket at 2 + an Intimidation increase at 7 → master): the print
   result, on top of what its tweaks do.
Expected NUMBER 0 (any move is a bug, not a classification):
- `NEVER_MOVES = /^overrides:(at-slot|asof|firearm|daily|legacy-misc|import-meta):/`.
- OV1, OV2, OV3: the moved floor sits at level 1 before every feat (D3), so Kholo Lore still sees Stealth at least
  expert and still owes its replacement; OV3 stays master. Exact values in WP0 step 3.
- Part B's three browser characters (`tweaks-browser:fixture-fighter`, `tweaks-browser:broken`,
  `tweaks-browser:cleric-l4`, WP0 step 6): no feat skill grant and no findings shape, so every number holds. Their
  family sits OUTSIDE `skillorder:` on purpose: every gate allows `^skillorder:`, which would hide their moves.
- Case A (Thievery), the Lore-row move, case B (Medic lowered-raise: the moved "exactly" untrained is set at P2, Medic
  at 2 trains, the 3rd-level increase is swallowed but still stored in `skillIncreases` as today, the clamp holds
  untrained), case C (max HP).
- A moved "exactly" or old `=` on a key that an early-block source of a later level raises (skilled human expert at
  5): the P2 swallow rule keeps the lowered rank for every reader between the slot and the clamp (D3; `skillorder:OV4`).
- test/fixtures/tweaks-legacy-before.json is never re-taken; its deltas hold unless a move is in the list above. The
  new rank stats never reach it: they live in `rankStats`, outside `numbers` (D18).

---

## 4. Dual Class second-class increases and the Free Archetype order

| | print | code today | change |
|---|---|---|---|
| main increases | rules-1329: "add everything from each class except Hit Points and starting skills: … skill increases for rogues"; rules-1331: "benefits only once per level… a dual-class rogue/ranger still gets the extra … skill increase at levels where the other class doesn't provide them" | `siLevels = cls?.skillIncreaseLevels` (~5546), `levelGrants` `skillIncrease` (~13108), reverse build (~12740): class 1 only. Rogue and investigator have increases at 2-20; every other class at 3, 5, …, 19 | union of both classes' levels, one increase per level, in the print path, `levelGrants` and the reverse build (WP6). DC1 (fighter 1st + rogue 2nd) gets 2, 4 |
| bonus lane + restriction | each class's own extra increase (swashbuckler 3/7/15, thaumaturge 9/17) | `bonusSiLevels`, `restrictedSkillIncreaseAllowed` (~1414): class 1 only; the subclass read uses `subclassId` only | new `restrictedSkillIncreaseLanes(build, content)` returns one lane per class (class 2 resolves `includeSubclassGrantedSkills` through `subclassId2`); `restrictedSkillIncreaseAllowed` keeps its signature as the per-level union for its callers; `levelGrants` `bonusSkillIncrease` uses the union (WP6) |
| starting skills | "apply the skills automatically granted by each class, and then apply the larger number of additional skills" | early block applies both classes' trained skills; `additionalClassSkills` (~814) takes the larger count | none |
| order of a level with two classes' features | features of both classes, then heritage, feats, increases (ruling 1) | class-2 features judged at level 1 in the queue (`srcLevel`) | `sourceLevelOf` gives class-2 features their level (WP2) |
| Free Archetype | GM Core variant: an extra class feat that must be an archetype feat, at 2nd level and every 2 levels after | its dedication is judged with all feats after every increase, in `featPicks` insertion order (FA1 wrong; WG puts FA last) | level by level at its even level, inside the level after ancestry/class/skill/general/bonus slots (D4) (WP3) |
| live path | — | — | keeps class-1 eligibility on purpose, so the notice names an increase that now counts (line 5) and the new empty slots (line 7) |

---

## 5. Work packages, in build order

```
main:  WP0 guard + snapshot
lane:  ─► WP1 ledger ─► WP2 levels ─► WP3 print pass ─► WP4 rank-gated ─► WP5 class replacement ─► WP6 Dual Class
       ─► WP7 readers ─► WP8 reverse build + import ─► WP9 notice ─► WP10 browser
main:  ─► WP11 merge + proof + docs
```
All share build.ts, Builder.tsx or the guard test: strictly in order. Models: builders Opus high (WP0-WP9),
Sonnet medium (WP10 driving, WP11 docs); every checker Opus high. After each engine WP's gate passes, write the next
reference (in the lane): `npx jiti scripts/blocks-parity-snapshot.mjs --out work/.skillrank-after-WPn.json` (untracked).

**PART-B SET** (run in every WP from WP0 on, beside the WP's own tests): test/blocks-rank-seams.test.ts,
test/tweaks-migration.test.ts, test/tweaks-legacy-fixture.test.ts, test/tweaks-save-stamp-numbers.test.ts,
test/tweaks-skill-timeline.test.ts, test/tweaks-skill-picker.test.tsx. A part B test that turns red is either a 3.4
intended move (added to `EXPECTED` with its case, cited) or a bug; never a loosened assertion.

Every WP ends the same way (not repeated below): tests through `node scripts/vt.mjs <files>` (the WP's files + the
PART-B SET); `npm run verify`; the WP's parity compare (from WP3 on, also `--legacy-check`, G11);
`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` when a script or merge changed .ts files; an
independent Opus checker reads the diff against "Done when" and runs the planted proofs of any new guard; commit by
file name (never `src/builder/shared.tsx`), message saying WHY and what was measured; record the hash in
work/skill-rank-level-by-level/state.md (untracked; in the lane, the lane's own copy). A changed existing test cites
`// skill-order WPn: <case id>` and its print source on the changed line; no assertion is loosened to pass.

### 5.L — The lane (D21)

- Made once, right after WP0's commit, FROM MAIN'S CHECKOUT: `node scripts/worktree-lane.mjs new skillorder --from <WP0 hash>`
  → `C:\trying ai 2\hh-lane-skillorder`. Every worktree-lane command is run from main's checkout (a lane made from
  inside a lane is untested). Never `git worktree remove` by hand.
- Right after `new`, before any commit: `git -C "C:\trying ai 2\hh-lane-skillorder" switch -c skillorder-wps` (a LOCAL
  branch, never pushed). `new` leaves the lane on a detached HEAD, so without a branch every WP commit becomes
  unreachable after `rm` and git's cleanup deletes it later (final checker F4). `diff`/`prove` compare against the
  BASE recorded in `.worktree-lane.json`, so the branch changes nothing they do. The branch is KEPT after WP11's `rm`;
  its name goes in the WP11 commit message and the memory note.
- First step inside the lane, before any edit: the baseline (WP0 step 7 moves here) and its determinism check, so
  the baseline is the clean WP0 commit, not main's working tree.
- WP1-WP10 edit, test and commit inside the lane (by file name), on `skillorder-wps`; never src/builder/shared.tsx
  (section 2's note). `node scripts/vt.mjs` and the parity instrument
  share main's heavy-job lock through the git dir, so they queue with main's jobs.
- Planted-proof lanes (section 6) are made from main's checkout with `--from <the skillorder lane's HEAD hash>`.
- WP10's dev server runs in the lane on its own port: `npm run dev -- --port 1431 --strictPort` (main's 1420 may be
  in use by another chat).
- Memory, at lane creation: one line in the skill-rank memory note, "skill-order work lives in lane
  hh-lane-skillorder (local branch `skillorder-wps`) until WP11 merges it; main is unaffected".
- Merged in WP11 (step 0); removed afterwards with `node scripts/worktree-lane.mjs rm skillorder`.

### WP0 — Guard test, snapshot family, baseline (no src/ change)

Runs on MAIN (no engine change; green on today's engine). Files: NEW test/fixtures/skill-order-cases.ts; NEW
test/skill-rank-level-order.test.ts; NEW test/skill-rank-readers.test.tsx; NEW test/skill-rank-reverse-build.test.ts;
scripts/blocks-parity-snapshot.mjs; NEW test/fixtures/skill-order-tweaks/{old-overrides,broken-tweaks,cleric-l4}.codex.json
(step 6).
1. `git status`; list other chats' uncommitted edits in any file of this plan into
   work/skill-rank-level-by-level/state.md (untracked), including src/builder/shared.tsx.
2. Full suite once, in the background, watched: `node scripts/vt.mjs --reporter=dot` → failing files + first error
   lines into work/skill-rank-level-by-level/full-suite-before.md. A failure in a file this plan touches is
   understood before that WP starts; a failure that needs a few lines is fixed and committed alone (say so); the
   rest go to chat-todo.md.
3. test/fixtures/skill-order-cases.ts exports `SKILL_ORDER_CASES: SkillOrderCase[]`:
   `{ id, title, finding: 1-9 | null, tag?: 'DC' | 'FA' | 'OV' | 'D5' | 'RB' | 'P', dir: 'before' | 'after' | 'same' | 'control', twin?: id,
   build, expect: { skills?, fallbacks?: string[] /* exact 'featId:skill' list */, featsHave?, featsLack?,
   grantedSkillsLack?, storedAnswers? }, flips: 'WP3' | … | null, today?: <same shape as expect: today's exact values>,
   print: string /* ruling or AoN doc id */ }`.
   `finding` is ALWAYS the findings-file number (work/skill-rank-timing-2026-10-21.md, "Why … is wrong" 1-9); `tag`
   only sub-groups (final checker F9): OV cases → finding 9 (old Overrides "=" and part B); RB cases → finding 8
   (the reverse build is one of "other readers"); the P reader cases of test/skill-rank-readers.test.tsx → finding 7
   (P7, the explain timeline, → 8), exported from the same fixture file as `SKILL_ORDER_READER_CASES` so one meta test
   sees every case; D5 (SN1/SN2) → 1. DC and FA cases come from Guy's request item 6 ("also cover what the findings
   did not check"), not from a finding: `finding: null` with `tag: 'DC' | 'FA'`; a `null` finding without a tag fails
   the meta test. Every other case carries the number of the finding its title names; none is invented to fill a number.
   Port the recipes from scratchpad map/map-cases/cases-all.ts (synthetic: `mk(o) = { ...emptyBuild(), name: 't',
   keyAbility: 'str', backgroundId: 'acolyte', classSkills: [], ...o }`; slot keys through a `slot(level, classId,
   kind)` helper over `levelGrants(...).featSlots`, exactly as that script does). Cases and flips (today/print values
   from map/map-cases/out-final.txt and the designer probes map/designer/probe{1,2,3}.ts; confirm each in the test
   run):
   - WP3: K1, K1s (ranks), B2, J1, AA3, AA7, AA7b, LS1, LS2, AD1, AD2, AD3, V2, I2, FA1, A2, A5 (no
     barbarian-dedication replacement), A6 (`grantedSkillsLack: ['athletics']`), OW1, MW1, and (Revision 3):
     - BJ1 (finding 1, `dir: 'before'`, twin BJ2; the `conditionalSkills` expert-upgrade branch, featGrantsAuto.ts
       `blackjacket-dedication`: Intimidation "trained, or expert if already trained"): fighter 7, class pick
       Intimidation, Blackjacket Dedication in the 2nd-level class slot, Intimidation increase at 7 → print
       `{ skills: { intimidation: 'master' }, fallbacks: [] }` (trained at 1, expert at 2 by the upgrade, master at
       7); `today: { skills: { intimidation: 'expert' }, fallbacks: [] }` (measured, designer-r3 bj.ts: the increase
       runs first, so the upgrade sees expert and adds nothing);
     - K4 (finding 1, `dir: 'same'`, twin K4b; the only single-class SAME-level feat + increase case): investigator
       5 (increases every level), kholo dog-kholo, Kholo Lore in the 5th-level ancestry slot, Stealth increase at 5 →
       print `{ skills: { stealth: 'expert' }, fallbacks: [] }` (D3: that level's feats, then its increase);
       `today: { skills: { stealth: 'trained' }, fallbacks: ['kholo-lore:stealth'] }` (measured, designer-r3 k4.ts);
   - WP4: S1 (crafting expert, `featsLack: ['specialty-crafting']`), IC1, a Raging Intimidation case (Scare to Death
     row at the level legendary is reached);
   - WP5: A5 epithet (`fallbacks: ['the-brave:athletics']`), A6 epithet;
   - WP6: DC1, DC3;
   - WP9: K1s stored answer kept through `openForSkillOrder` + `stampSkillOrderSave`;
   - null (pass today, must stay): K2, K3, B1, BL15, BL14, S2, J2, J3, J4, AA5, V1, I1, FA2, FA3, DC2, A5b, A5c, A6b,
     OW2, MW2, IC2, G1, AD4, OV1, OV2, OV3, the new twin LS3 (Society increase at 3, Lorekeeper Shisk Society,
     Linguist Dedication at 4 → expert, no replacement), and the Revision 2 guards against a naive reorder.
     **OV values are stated here, not taken from out-final.txt** (its OV print column is a placeholder, final checker
     F8): OV1 `{ skills: { stealth: 'expert' }, fallbacks: [] }`; OV2 `{ skills: { stealth: 'expert' }, fallbacks:
     ['kholo-lore:stealth'] }`; OV3 `{ skills: { stealth: 'master' }, fallbacks: ['kholo-lore:stealth'] }` — today's
     values, which 3.4 keeps;
     - SN1 (D5): kobold fighter 5, Snare Setter in the 5th-level ancestry slot, the 5th-level increase on Crafting →
       crafting trained, `fallbacks: ['snare-setter:crafting']` (today gives it: probe1); SN2, its twin: Crafting
       increase at 3, Snare Setter at 5 → the same;
     - OV4 (D3 P2 swallow): skilled human Athletics, a moved "exactly" Athletics = untrained (`meta: { of:
       'untrained', mode: 'exactly', moved: true }`), Barbarian Dedication at 6 → athletics untrained, `fallbacks: []`;
       OV4c: the same with an unstamped old `=` (sorted "exactly" at read) → the same (probe3);
     - AL1 (row 21 alias): a custom background (or a `dbPatch` background) whose Lore is "Lore of the Sea" + `skillIncreases: { 3:
       'lore:lore-of-the-sea' }` → `lore:sea` expert (keeps the part B Lore-row move at NUMBER 0);
     - OA1 (D6 ladders): a character at 16 with Operatic Adventurer at 12 → performance legendary (history level
       checked in WP2's table: master at 12, legendary at 15);
     - IG1 (D10): Raging Intimidation with Intimidating Glare removed by a Tweaks removal → `featsLack:
       ['intimidating-glare']` (stays removed after WP4);
     - DC1n: DC1 with no stored increases (the notice's line 7 in WP9).
     - BJ2 (BJ1's twin, `dir: 'after'`): fighter 4, class pick Intimidation, Intimidation increase at 3, Blackjacket
       Dedication at 4 → `{ intimidation: 'expert', fallbacks: [] }` today and in print (measured);
     - K4b (K4's twin): investigator 5, Stealth increase at 4, Kholo Lore at 5 → `{ stealth: 'trained', fallbacks:
       ['kholo-lore:stealth'] }` today and in print (measured; ruling 2);
     - LL1 (finding 8: the language-Lore rerun is one more reader of ranks; D2; listed here for its recipe, but it
       `flips: 'WP3'` because its print Society rank differs from today's by construction): the setup
       rule "Int slot spent on a Lore" on, one language Lore, Multilingual (`languageChoicesAtRank`: +1 at master
       Society), a Society chain whose print rank is master where today's is expert (a 1st-level Society training
       whose step today's increase-first order swallows, + Society increases at 3 and 7), and exactly as many picked
       languages as the LEGACY slot count fits, so print and legacy split on the rerun. The builder finds the exact
       recipe by a probe and states today's values (`today`, including `languageLores` kept); its `skillorder:LL1`
       row in G11 (`--legacy-check`) must equal the baseline.
   - Reverse build (test/skill-rank-reverse-build.test.ts, `finding: 'RB'`): a BUILD-LESS character (built, then
     `skillIncreases` deleted from the Character, Stealth set to expert) → `deriveBuildFromCharacter` → rebuild:
     RB1 Kholo Lore at 1 → stealth expert (flips WP3; today trained, increase placed at 3, probe1); RB2 Kholo Lore at
     5 → stealth expert and the increase at 5 (flips WP8; today and after WP3 the increase lands at 3 and the rebuild
     is trained, probe1).
4. test/skill-rank-level-order.test.ts: one test per case and expect group, `(c.flips ? it.fails : it)`; for every case
   with `flips`, also a PLAIN `it` premise test: every feat/heritage/background id resolves in content, the build
   does not throw, and `today` holds exactly (D17). Meta tests (over `SKILL_ORDER_CASES` + `SKILL_ORDER_READER_CASES`):
   every finding 1-9 has a case under the step 3 label map; a `null` finding carries a DC or FA tag; every
   `dir: 'before'` case names an existing `dir: 'after'` twin and every `dir: 'same'` case names a twin; DC, FA, D5,
   OV, RB and P tags each have a case; every reader case with `lower: true` (below) names an existing twin; every
   `flips` names a WP of this plan; every case with `flips` has `today`, and none without.
5. test/skill-rank-readers.test.tsx (Builder render harness from an existing render test such as
   test/bloodline-gift-variants.test.tsx), all `it.fails` flipping in WP7, each with a premise test (today's exact
   label or reason): P1 (Barbarian Dedication at 4, level-3 picker shows Athletics "U → T"), P2 (skilled human
   Athletics, "T → E" not greyed), P3 (Kholo Lore at 5, Stealth "U → T"), P4 (Ancient Ash Stealth, "T → E"), P5 (a
   feat at 3 needing expert X with X's expert increase at 5 → prerequisite not met at 3), P6 (the replacement heading
   for B1 reads the rank when taken), P7 (K1's explain lines name Kholo Lore at 1st and the increase at 3rd), P8
   (Gildedsoul at 1 answered Diplomacy + a Society increase at 3: Society not greyed in the 1st-level "Trained skill"
   slot), P9 (Rogue Dedication at 2 + an Arcana increase at 3: Arcana not greyed in its "any" slot), P10 (Barbarian
   Dedication in 2:class:0, no other Athletics source: in that slot's feat picker, a candidate needing trained
   Athletics shows as not met).
   **Twins in the other direction (final checker F3).** P1-P5 and P8-P10 each prove a source from a LATER point is
   NOT counted (`lower: true` in `SKILL_ORDER_READER_CASES`); a reader that read 1st-level (creation) ranks would pass
   every one of them. Each gets a twin proving a source from an EARLIER point IS counted; twins pass today and must
   stay green (plain `it`, `flips: null`):
   - P1b: Barbarian Dedication at 2 → the level-3 picker shows "Athletics (T → E)";
   - P2b: skilled human Athletics, a 7th-level fighter → the level-7 picker shows "Athletics (E → M)" (the 5th-level
     expert step counts);
   - P3b: Kholo Lore at 1 → the level-3 picker shows "Stealth (T → E)";
   - P4b: Ancient Ash Stealth, a 7th-level build → the level-7 picker shows "Stealth (E → M)" (the 5th-level expert
     step counts);
   - P5b: the expert increase on X at 3 and the feat needing expert X at 4 → the prerequisite is met;
   - P8b: Gildedsoul at 1 answered Diplomacy, Society trained by the class pick at 1 → Society greyed in the
     1st-level "Trained skill" slot ("Already Trained");
   - P9b: Rogue Dedication at 2, Arcana trained by the class pick at 1 → Arcana greyed in its "any" slot;
   - P10b: as P10 but Athletics trained by the class pick at 1 → the candidate needing trained Athletics shows as met.
   The builder confirms each twin's label on today's engine in the WP0 run and writes it into the case.
6. scripts/blocks-parity-snapshot.mjs:
   - `normaliseCharacter` drops `skillHistory`;
   - each gate gets a sibling field `rankStats` (beside `buildHash`; NEVER inside `numbers`, D18), flattened into the
     compare by `flattenNumbers` only: `build.skillRanks` (sorted `key:rank` of `proficiencies.skills`),
     `build.skillFallbacks` (sorted `featId:skill[:slot]`, joined), `build.skillIncreases` (sorted `level:skill`, lane
     left out), `build.grantedSkills` (sorted keys), `build.featRows` (sorted `id@level`), `build.rankGated` (sorted
     `grantedBy>featId` for rows granting a `FEAT_RANK_FEAT_GRANTS` feat from a carrier in that table),
     `build.hashSansSkill` (hash of the normalised character minus `proficiencies.skills`, `skillFallbacks`,
     `skillIncreases`, `skillRankBefore`, `grantedSkills`, `feats`); and, once WP3 exports `skillOrderLegacyOf`,
     `legacy.skillRanks`, `legacy.skillFallbacks`, `legacy.skillIncreases`, `legacy.rankGated` in the same formats
     (absent before WP3: the reader is optional);
   - family `skillorder:<caseId>` from `SKILL_ORDER_CASES` (`keepFull: true`), with `history.<key>` stats in
     `rankStats` (`level:to:source` joined by `|`, `'none'` without a history) for the keys the case's `expect` names;
   - **part B's browser characters (final checker F5)** — Guy's "the Tweaks test characters must keep part B's
     numbers": the three files part B's browser test used (work/tweaks-part-b-notes/browser-report.md, "Fixtures"):
     the Tweaks Fixture Fighter `old-overrides.codex.json` (fighter 7, increases 3 Athletics / 5 Thievery / 7 Stealth,
     old Overrides keys only; made by scripts/tweaks-browser-fixture.mjs), `broken-tweaks.codex.json` and
     `cleric-l4.codex.json`. They are UNTRACKED in main's work/tweaks-part-b-notes/browser/, so a lane would not see
     them: copy the three byte for byte to test/fixtures/skill-order-tweaks/ (synthetic test characters; run
     `node scripts/owner-names-check.mjs` and read each name field before staging). The snapshot reads them through
     the roster's import path, `importCharacter(text, content)` (src/data/transfer.ts; the files are `exportNative`
     output), then the stored build through the gate pipeline,
     as family `tweaks-browser:` (`tweaks-browser:fixture-fighter`, `tweaks-browser:broken`, `tweaks-browser:cleric-l4`;
     NOT under `skillorder:`, which every gate allows), `keepFull: true`. Expected NUMBER 0 in every gate (3.4; they match no findings case). WP0's checker also compares the
     fixture fighter's `numbers` against work/tweaks-part-b-notes/browser/expected-before.json plus part B's two
     recorded moves (Thievery 12 T → 14 E, the Lore-row rename), i.e. the browser report's step 2;
   - `--allow-pairs <json file>`: an array of `"<cid>|<stat>"`; a NUMBER row passes when its exact pair is listed (for
     a classified move outside the gate's stat regex, e.g. `initiative` or a `strike.*` that follows a rank);
   - `--legacy-check <baseline>` (G11): for every character and gate of this run that has `legacy.*` stats, each must
     equal the baseline's `build.*` twin; any difference fails the run, with no allow;
   - confirm compare treats string stats with `!==` (extend if not); extend `--self-test`: a planted `skillHistory`
     change does not move `build.hash`; a planted `skillFallbacks` change moves `build.skillFallbacks`; a planted
     `rankStats` change never appears in `legacyDeltas`; `--allow-pairs` allows its pair and only it; a planted
     `legacy.skillRanks` difference fails `--legacy-check`.
   - One-time proof (the checker): `legacyDeltas` over `snapshotSubset('^overrides:')` is byte-equal from the HEAD
     script (written to the scratchpad with `git show HEAD:scripts/blocks-parity-snapshot.mjs`) and from the new one.
7. `npx jiti scripts/blocks-parity-snapshot.mjs --self-test`; a determinism run on main
   (`--out work/.skillrank-wp0-check.json`, then `--compare work/.skillrank-wp0-check.json --only '^(skillorder|tweaks-browser):'` →
   NUMBER 0). The real baseline is taken in the lane (5.L), from the clean WP0 commit.
8. `node scripts/vt.mjs test/skill-rank-level-order.test.ts test/skill-rank-readers.test.tsx
   test/skill-rank-reverse-build.test.ts` + the PART-B SET → green.
Done when: the three new test files and the PART-B SET green on today's engine (every `it.fails` really fails, every
premise test and control passes); self-test, the `legacyDeltas` one-time proof and determinism done; the checker
reads each premise against out-final.txt / the probes (OV values against step 3, never out-final's OV print column)
and each null case's premise, and the fixture fighter against the browser report's step 2; verify green; the WP0 files
(five, plus the three copied `.codex.json` fixtures) committed on main ("why": the guard and the before-numbers for skill order). Then 5.L: make the lane, take the
baseline there.

### WP1 — The ledger, live path unchanged (NUMBER 0)

Files: NEW src/rules/skillPass.ts (event and effect types, `newSkillLedger`, the live-replay helper);
src/rules/build.ts; NEW scripts/skill-write-check.mjs; package.json (`verify` gets `node scripts/skill-write-check.mjs`
before `jiti scripts/blocks-check.mjs`); NEW test/skill-ledger.test.ts.
1. Inventory every skill write (`skills[…] =`, `proficiencies.skills[…] =`, `delete`, `maxRank`/`stepRank`
   assignments) and every skill read in `buildCharacter` from the early block to ~8739 into
   work/skill-rank-level-by-level/wp1-inventory.md (tracked evidence): symbol, op, its 1.1 row, and for each read:
   "judge" or "order-free, because …".
2. Two helpers inside `buildCharacter`: `skillWrite(target, key, op, rank, ev)` (op: `set` | `max` | `step` |
   `delete`, exactly the line's own) and `skillJudge(ev, judge)` (runs the closure on the live view, applies its
   effects, records). Convert every inventoried line. Judges become pure closures (1.2); a judge that pushes to
   `skillFallbacks`, `featSubstitutions` or warnings returns that as an effect.
3. Events carry `level`/`phase` placeholders (WP2 fills them) and `seq` (code order).
4. Export `skillLedgerReplay(build, content): string[]` (mismatches between the live state at the resolve point and a
   seq-order replay of the recorded events with live ops); used only by tests.
5. scripts/skill-write-check.mjs: in src/rules/build.ts, any assignment or `delete` on a skills record outside
   `skillWrite`, the resolve swap and `applyExactClamp` fails; anchors by symbol, never by line; `--file <path>` for
   planted proofs.
6. test/skill-ledger.test.ts: `skillLedgerReplay` is empty for every character of `snapshotSubset('^(sweep-filled|skillorder|overrides|tweaks-browser):')`.
Tests: `node scripts/vt.mjs test/skill-ledger.test.ts test/skill-rank-level-order.test.ts test/blocks-rank-seams.test.ts test/tweaks-migration.test.ts`.
Parity: `npx jiti scripts/blocks-parity-snapshot.mjs --compare work/.skillrank-baseline.json` → NUMBER 0, no `--allow`.
Done when: inventory complete (the checker re-greps and finds no unlisted write); NUMBER 0; ledger test green; G2 and
G3 planted proofs done; guard results identical to WP0.

### WP2 — Print levels and phases on every event (NUMBER 0)

Files: src/rules/build.ts (`sourceLevelOf`, event levels incl. class-2 `srcLevel`), src/rules/skillPass.ts (phase
ranks, `orderPath`), test/skill-ledger.test.ts.
1. `sourceLevelOf(source)` per 1.1: class/class2/arch-added features by their level, options by
   `extraPickLevel` / `subclassAnchorLevel` / kineticist first threshold, second heritage and feat-granted background
   by `heldFeatSlots` level, Root Epithet 3, an apparition's training at its option level and its Lore steps at the
   levels its `loreProgression` names (8 and 16 today; read from the data, never hard-coded), ladder steps at their
   levels, skilled human 5.
2. Ladders (`loreStep`, `optLoreStep`, `skillProgression`, `skillProgressionFromChoice`, `upgradeRankAt`) record one
   event per step level; the live write stays the final-level rank.
3. `orderPath` for P5: index in `levelGrants(...).featSlots` by slot key, then Tweaks-given feats, then granted feats
   depth-first under their granter; P3: class 1 feature list order, class 2, archetype-added, options after their
   feature.
4. test/skill-ledger.test.ts gains a table: ~20 sources (one per 1.1 row) → expected `[level, phase, source]`,
   including an apparition Lore (expert step at 8, NOT at 7; master at 16), Lorekeeper Shisk's Lore (expert at 5) and
   Operatic Adventurer (OA1: master at 12, legendary at 15).
Parity: `--compare work/.skillrank-baseline.json` → NUMBER 0, no `--allow`.
Done when: NUMBER 0; level table green; the checker re-derives five rows from the print text.

### WP3 — The print pass and the history (the switch)

Files: src/rules/skillPass.ts (`resolveSkillPass`), src/rules/build.ts (resolve point, replacement of live outputs,
`applyExactClamp` extraction, `SKILL_ORDER_BEFORE` side channel with the legacy skills, fallbacks, increases and the
queue's rank-gated decision, `skillOrderLegacyOf`, `skillPrereqLines`), src/rules/types.ts (`SkillStep`,
`SkillHistory`, `Character.skillHistory`, `SkillIncrease.lane`), src/rules/ranks.ts (1.5 readers),
scripts/blocks-parity-snapshot.mjs (the optional `legacy.*` reader now finds `skillOrderLegacyOf`), test files (flips;
any part B move per 3.4).
1. Resolve per 1.2 at the D2 point; views per D7; locks: only level-1 sources lock level-1 class picks. Judges read
   their own level and the feats held before them (D6).
2. Fallbacks: a judged "already trained" emits the entry and applies the stored answer through `skillFallbackPick`
   (same keys as today); an unanswered one stays owed.
3. P2 per D3: placed at its start level; swallows every later-placed event on its key whose live write ran before
   the slot (early-block sources of any level, floors, increases): step note `swallow`, no rank change; a swallowed
   increase is still pushed to `skillIncreases`. OV4 / OV4c stay green.
4. P7 per D5: a feat whose `skillPrereqLines` fail at its P5 place and hold at the end of its level moves, with its
   granted subtree, after that level's increases. SN1 / SN2 stay green.
5. The Lore alias (row 21) is decided on the print view. AL1 stays green.
6. Emit `skillHistory` (with `at`); `skillRankBefore` from `noMoved`.
6b. The language-Lore rerun's legacy side per D2 (`legacyLanguageLoreRerun` from the live skills after
   `applyExactClamp`; `SKILL_ORDER_BEFORE_CARRY` into the rerun; the extra legacy build only when the decisions
   differ the other way). LL1 green in `--legacy-check`; a unit test in test/skill-ledger.test.ts covers all three
   branches (equal, print-only rerun, legacy-only rerun): `skillOrderLegacyOf(c).skills` equals the skills today's
   engine gives that build (written into the test as literals from a WP0-commit probe run, cited).
7. Flip every `flips: 'WP3'` case (and RB1) — `flips: null`, `today` deleted, in this commit; run the PART-B SET; a
   part B test that now fails is either a 3.4 intended move (add to `EXPECTED` with the case) or a bug (fix the pass).
Tests: `node scripts/vt.mjs test/skill-rank-level-order.test.ts test/skill-ledger.test.ts test/skill-rank-reverse-build.test.ts`
+ the PART-B SET, plus every test file that names a moved feat (grep the case feat ids in test/: kholo-lore,
molten-wit, barbarian-dedication, linguist-dedication, alchemist-dedication, inventor-dedication, vandal, orc-warmask,
ancient-ash, lorekeeper-shisk, anvil-dwarf, sage-jotunborn, snare-setter, blackjacket-dedication, multilingual).
Parity, three runs:
- discovery: `npx jiti scripts/blocks-parity-snapshot.mjs --compare work/.skillrank-baseline.json --allow '^skillorder:'`
  → every remaining row is classified in work/skill-rank-level-by-level/moves.md (id | stat | before → after | case
  from 3.4 or the findings | why) or fixed;
- gate: `npx jiti scripts/blocks-parity-snapshot.mjs --compare work/.skillrank-baseline.json --allow '^(skillorder:|<classified ids, escaped, joined with |>)' --allow-stat '^(skill\.[^.|]+(\.rank|\.substitutedFrom)?|pc\.skills\.[^|]+|lores|explain\.skill\.[^|]+\.total|build\.(hash|skillRanks|skillFallbacks|skillIncreases|grantedSkills|featRows|rankGated)|history\..+)$' --allow-pairs work/skill-rank-level-by-level/allow-pairs.json`
  → NUMBER 0, and for every allowed `build.hash` row `build.hashSansSkill` did not move (else the full diff is read
  and classified). `explain.*` totals other than a skill's (AC, saves, HP, spells) are NOT in the regex. Any other
  stat that follows a moved rank on a classified id (`initiative` through `initiativeSkill`, a `strike.*` that reads
  a skill rank such as Versatile Vial's Crafting, a `special.*`) is classified in moves.md as its own id + stat row
  and listed in allow-pairs.json (tracked, beside moves.md), allowed for that id only;
- legacy: `--legacy-check work/.skillrank-baseline.json` → every character's `legacy.*` equals the baseline's
  `build.*` (G11): the live path, the notice's "before", is still today's engine.
Done when: every WP3 case green and flipped; the PART-B SET green; G3, G4, G11 green; gate NUMBER 0; history ≤ 16 KB
on the largest snapshot character; the checker reads ten random classified rows against print.

### WP4 — Rank-gated feat grants

Files: src/rules/featFeatGrants.ts (`when` per entry), src/rules/build.ts (`rankGatedGrants` after the resolve; the
queue keeps only the legacy decision), NEW test/skill-rank-gated.test.ts (G5), test/skill-rank-level-order.test.ts.
1. Before moving: list every pass between the queue (~7911) and the resolve point that reads feat rows, and confirm
   the six granted records have none of the fields they read (FEAT_GRANTS, effectChoices, grants.skills,
   choiceGrants, proficiency grants, feat grants); that list is G5's field list.
2. Implement 1.4; granted rows get `grantedBy` as today and D10's level; `rankGatedGrants` skips Tweaks removals and
   held feats and re-sorts by level; the queue's legacy decision touches neither `takenFeats` nor `grantedPairs`.
3. Discovery run first (as WP3; final checker F6): `--compare work/.skillrank-after-WP3.json --allow '^skillorder:'`;
   every remaining row is added to moves.md (id | stat | before → after | case | why) and, outside the gate's stat
   regex, to allow-pairs.json, or fixed — before the gate below.
Tests: `node scripts/vt.mjs test/skill-rank-gated.test.ts test/skill-rank-level-order.test.ts` + the PART-B SET + the
existing tests naming stonemasons-eye, intuitive-crafting, gildedsoul, student-of-water, raging-intimidation.
Parity: `--compare work/.skillrank-after-WP3.json --allow '^(skillorder:|<classified ids>)' --allow-stat '^build\.(featRows|hash|rankGated)$'`
→ NUMBER 0; each allowed row is a carrier from the table; `--legacy-check work/.skillrank-baseline.json` green (the
legacy rank-gated decision still equals today's rows).
Done when: S1, IC1 and the Raging Intimidation case flipped; IG1 still green (a removed Intimidating Glare stays
removed); G5 planted proof done.

### WP5 — Class trainings after 1st level: the replacement pick (D14)

Files: src/rules/build.ts (judge for class options and class features with `grants.skills` at level > 1),
src/builder/Builder.tsx (the fallback SubCard extracted into a small local component, rendered beside the class
option on its level page), test/skill-rank-level-order.test.ts.
1. List (scratch script) every class option and class feature with `grants.skills` whose `sourceLevelOf` > 1, each
   with the clause its OWN text prints (or its granting feature's, as Root Epithet's "as normal" covers its epithets),
   into work/skill-rank-level-by-level/wp5-class-trainings.md (tracked evidence: id | level | skill | clause quoted |
   AoN doc id). Only rows with a clause get the judge (D14); the rest keep today's no-replacement and go to 7.3 with
   their ids. Data check in the test: none of the judged ids equals a feat or background id (the answer key has no
   prefix, like a background's), and the judged set equals the evidence file's clause rows.
2. Judge per D6 at P3; answer key `featSkillChoices['<optionId>:fallback:<skill>']`.
3. Discovery run first (F6): `--compare work/.skillrank-after-WP4.json --allow '^skillorder:'`; every remaining row
   classified in moves.md (and allow-pairs.json when outside the stat regex) or fixed, before the gate.
Tests: `node scripts/vt.mjs test/skill-rank-level-order.test.ts` + the PART-B SET + a render test for the option's
SubCard (add to test/skill-rank-readers.test.tsx).
Parity: `--compare work/.skillrank-after-WP4.json --allow '^(skillorder:|<classified ids>)' --allow-stat '^build\.(skillFallbacks|hash)$'`
→ NUMBER 0; `--legacy-check work/.skillrank-baseline.json` green.
Done when: A5 epithet and A6 epithet flipped; the SubCard shows on the level-3 page of A6 and stores the answer.

### WP6 — Dual Class increases (D15)

Files: src/rules/build.ts (union in the print lanes, `restrictedSkillIncreaseLanes`, `levelGrants` ~13108-13109),
src/builder/Builder.tsx (bonus picker greying per lane), test/skill-rank-level-order.test.ts, NEW
test/skill-rank-dual-class.test.ts.
1. Print lanes per section 4; the live path keeps class 1.
2. `levelGrants` `skillIncrease` / `bonusSkillIncrease` use the union; no feat slot is added or reordered (stored slot
   keys index `featSlots`).
3. Test: for fighter+rogue, rogue+fighter, swashbuckler+thaumaturge and a single class, every `levelGrants` slot key
   of levels 1-20 is unchanged against today's list; increases exist at the union's levels.
4. Discovery run first (F6): `--compare work/.skillrank-after-WP5.json --allow '^skillorder:DC'`; any other moved
   row (a Dual Class character in another family) is classified in moves.md, with its id added to the gate's allow,
   or fixed, before the gate.
Tests: `node scripts/vt.mjs test/skill-rank-dual-class.test.ts test/skill-rank-level-order.test.ts` + the PART-B SET.
Parity: `--compare work/.skillrank-after-WP5.json --allow '^skillorder:DC'` → NUMBER 0 outside the DC cases (no other
family holds a Dual Class character; if one does, classify it); `--legacy-check work/.skillrank-baseline.json` green
(the live path keeps class-1 eligibility).
Done when: DC1, DC3 flipped; DC2 still green; slot-key test green.

### WP7 — Readers read the history

Files: src/builder/Builder.tsx, src/builder/tweaks/skillNotes.ts (only if its signature needs the map),
src/rules/build.ts (`checkPrerequisites` 4th arg, `buildChoiceOptions` level), src/rules/explain.ts
(`skillTimeline`), src/rules/blocks/overrides-readers.json (remove `src/builder/Builder.tsx#Builder>baseSkills`),
test/skill-rank-readers.test.tsx, test/tweaks-skill-timeline.test.ts (only its Medic "Raised to Expert" line, cited:
`// skill-order WP7: P7 — the history names the record`), and any other explain/Builder test pinning the old inference
(cite the case).
1. Every row of section 2 marked WP7, as written there (incl. the feat "Trained skill" slot picker and the feat
   picker's occupant-subtree `without`).
2. `src/builder/shared.tsx` is NOT edited here (section 2's note; F1): a lane `git status` cannot see main's
   uncommitted line, and a lane edit to that file would make WP11's `apply` refuse the whole patch. Write the three
   readers (background caller ~4044, homebrew-background replacement picker ~4118-4140, `newLoreRefusal` ~5305) with
   their section 2 rows and the exact replacement code into the lane's work/skill-rank-level-by-level/shared-readers.md
   (tracked), for WP11 step 0h. The WP7 checker greps the lane diff: no hunk in src/builder/shared.tsx.
Tests: `node scripts/vt.mjs test/skill-rank-readers.test.tsx test/skill-rank-level-order.test.ts` + the PART-B SET (it
holds test/tweaks-skill-timeline.test.ts, which pins part B's timeline lines and never names `skillTimeline`) + the
explain and overrides-readers tests (grep `skillTimeline`, `explainStat`, `checkOverridesReaders` in test/).
Parity: `--compare work/.skillrank-after-WP6.json` → NUMBER 0, no `--allow` (no engine output changes);
`--legacy-check work/.skillrank-baseline.json` green.
Done when: P1-P10 flipped; part B's timeline lines unchanged except the cited Medic line; an imported character whose
rank was patched after the build falls back to today's timeline (`historyAgrees`, one test); the Builder makes one
fewer `buildCharacter` per level page (the checker counts calls with a spy in the render test);
`checkOverridesReaders` green with the entry removed; test/tweaks-skill-timeline.test.ts `SKILL_ORDER_FALLBACK_PIN`
back to at most {off 19, on 16}: WP0's {off 17, on 15} plus the two family characters WP3's fix round added (BJ3 off,
OV5 off + on, each a Lore line of the same kind WP0 already counted). WP3 raised it to {off 23, on 18} (state.md
deviations 35 and 47).

### WP8 — Reverse build and the import warning

Files: src/rules/build.ts (`deriveBuildFromCharacter` ~12006-12023, ~12731-12758), src/data/transfer.ts
(`importCharacter` warning), test/skill-rank-reverse-build.test.ts (made in WP0).
1. Section 2's two rows.
2. Test: the round trips run on BUILD-LESS characters (built natively, then `skillIncreases` deleted from the
   Character), because a native character's stored increases are copied back verbatim (~12019) and never reach the
   synthesis (~12731-12758): for K1, K2, B2, S1, AA7, DC1 and RB2 the rebuilt skills equal the original's; RB2 flips
   here (its increase lands at 5, not 3). Plus the native round trips of the same cases, unchanged. A synthetic import
   whose rank cannot be reached produces exactly one warning naming it.
Tests: `node scripts/vt.mjs test/skill-rank-reverse-build.test.ts` + the PART-B SET + the existing transfer/import tests
(grep `importCharacter` in test/).
Parity: `--compare work/.skillrank-after-WP6.json` → NUMBER 0, no `--allow`; `--legacy-check
work/.skillrank-baseline.json` green.
Done when: RB2 flipped; round trips equal; warning test green; existing import tests green.

### WP9 — The Builder notice and the stamp

Files: src/rules/build.ts (`emptyBuild` sets `skillOrder: 2`; `BuildState.skillOrder?: 2`; export
`skillOrderChanges`), src/rules/blocks/save.ts (`openForSkillOrder`, `stampSkillOrderSave`), src/builder/Builder.tsx
(init beside `openForTweaks` ~335, `submit` ~2700-2712, `.setup-note`, `.lvl-note`, the `skillOrderNotice` prop),
src/sheet/GmEditSheet.tsx (passes `skillOrderNotice={false}`, ~522), NEW test/skill-rank-notice.test.tsx.
1. Section 3.3 exactly, lines 1-7. Every Builder host is listed by grep (`<Builder`: src/App.tsx ~1763,
   src/sheet/GmEditSheet.tsx ~522); the player's host stamps and shows, the GM's passes `skillOrderNotice={false}`
   (D13).
2. `skillOrder` is not copied onto Character (the parity hash must not move).
3. Test: an unstamped K1s build shows lines 1 and 2 with the stored Arcana named and keeps the answer after Save; an
   unstamped DC1n build shows line 7 naming 2nd and 4th level; a stamped build and an unstamped build with no
   difference render no notice element; Cancel stores nothing; a second open after Save shows nothing; with
   `skillOrderNotice={false}` an unstamped build shows no notice and its Save leaves `skillOrder` absent (G10); no line
   contains a forbidden word (G7).
Tests: `node scripts/vt.mjs test/skill-rank-notice.test.tsx test/skill-rank-level-order.test.ts` + the PART-B SET + the
existing save/open tests (grep `openForTweaks`, `GmEditSheet` in test/).
Parity: `--compare work/.skillrank-after-WP6.json` → NUMBER 0, no `--allow`; `--legacy-check
work/.skillrank-baseline.json` green.
Done when: K1s storedAnswers flipped; notice tests green; G7 and G10 planted proofs done.

### WP10 — Browser test, desktop and phone

In the lane (5.L): its own dev server, `npm run dev -- --port 1431 --strictPort`, dev-skip login only, never Guy's
account, synthetic test characters only; Playwright headless (`playwright` MCP) against it; desktop 1280×800 and
phone 375×812. Screenshots and notes in the lane's work/skill-rank-level-by-level/browser/ (untracked). Close the
server when done.
1. Kholo Lore + Stealth increase: new kholo character, Kholo Lore at 1, Stealth increase at 3 → sheet Stealth Expert,
   no replacement card on the 1st-level page, the "how was this calculated" popup lists Kholo Lore at 1st and the
   increase at 3rd.
2. Barbarian Dedication after an Athletics increase: fighter (Acrobatics as its choice), Athletics increase at 3,
   Barbarian Dedication at 4 → Athletics Trained and the replacement card on the 4th-level page.
3. Bardic Lore at 15: enigma bard 15, Occultism increases at 3, 7, 15 → Bardic Lore Expert; the 15th-level picker
   shows "Bardic Lore (T → E)" greyed with its "can't be increased by any other means" reason (today's
   `LOCKED_SKILL_KEYS` greying, Builder.tsx ~3705, unchanged; the T is the rank before that level's increases); the
   same bard at 14 → Trained.
4. The level-3 increase picker with a feat at 4: Barbarian Dedication at 4, no other Athletics source → the 3rd-level
   picker reads "Athletics (U → T)".
5. The notice: import a synthetic native export without `skillOrder` (K1s shape; written by a scratch script into the
   browser folder) → the notice names Stealth Trained → Expert and the kept Arcana pick; Save; reopen → no notice. A
   new character → no notice.
6. Part B's fixture fighter (F5): import test/fixtures/skill-order-tweaks/old-overrides.codex.json → after a reload
   the sheet matches work/tweaks-part-b-notes/browser-report.md step 2 (AC 22, saves 11/14/13, Perception 11, Init
   13, class DC 22, HP 120, Speed 25, every skill as expected-before.json except Thievery 14 E and "Sailing lore") and
   opening the Builder shows no skill-order notice (nothing changed on it).
Done when: all six on both sizes, a screenshot each; console free of new errors.

### WP11 — Final proof, release notes, memory note

0. Merge the lane (main's checkout; nothing else may be writing files: check the session list and `git status`):
   a. `git status` on main; note other chats' uncommitted edits (shared.tsx at least).
   b. Main may have moved since WP0 (a release): before applying, on main,
      `npx jiti scripts/blocks-parity-snapshot.mjs --out work/.skillrank-main-before.json`.
   c. `node scripts/worktree-lane.mjs diff skillorder > <scratchpad>/skillorder.patch`, read what it reports it
      cannot carry, then `node scripts/worktree-lane.mjs apply skillorder` (git apply --3way, stages nothing, keeps
      each line's ending). A conflict is resolved by hand in the conflicting file only, never by checkout/restore.
   d. Commit on main by file name (the lane's files; never src/builder/shared.tsx), message naming the kept local
      branch `skillorder-wps` and listing every lane WP commit hash on it and its checker verdict from the lane's
      state.md.
   e. Then steps 1-3 below on main, the parity compare against BOTH references: the lane's baseline, copied first
      from `C:\trying ai 2\hh-lane-skillorder\work\.skillrank-baseline.json` to main's work/ (moves.md complete), and
      `work/.skillrank-main-before.json` (the same classified moves, nothing else).
   f. `node scripts/worktree-lane.mjs rm skillorder`. The branch `skillorder-wps` stays (never `git branch -D` it);
      `git log --oneline main..skillorder-wps` still lists every WP commit afterwards.
   g. Browser re-check on the merged code (F7): if `apply` reported any conflict, or main changed since WP0 any file the
      patch touches (`git diff --stat <WP0 hash> HEAD~1 -- <the patch's files>` non-empty), re-run WP10 steps 1, 4 and 5
      on main's merged code, desktop and phone, on its own port (`npm run dev -- --port 1431 --strictPort`), dev-skip
      login, synthetic characters, screenshots in main's work/skill-rank-level-by-level/browser-merged/ (untracked).
      Otherwise say in the report that main's touched files had not moved, so WP10's run stands.
   h. The shared.tsx readers (F1): `git -C "C:\trying ai 2\pf2e codex" status --porcelain -- src/builder/shared.tsx`.
      Empty → apply the three readers from shared-readers.md, run test/skill-rank-readers.test.tsx (+ a P case for
      each: the background "Trained skill" choice, the homebrew-background replacement heading, `newLoreRefusal` with a
      Lore trained only at a later level), verify, an Opus checker, commit that file by name. Not empty → leave the
      file alone; the three readers are a "Still open" line in the final report and a chat-todo.md item (7.3 item 12).
1. Full suite in the background, watched: `node scripts/vt.mjs --reporter=dot` → green. A failure still there is fixed
   when it needs a few lines (committed alone, said so); otherwise it is a "Still open" line in the final report, and
   the job is not reported done (Guy's "the full test suite are green").
2. `npm run verify` green.
3. Final parity with the union of all classifications:
   `npx jiti scripts/blocks-parity-snapshot.mjs --compare <reference> --allow '^(skillorder:|<all classified ids>)' --allow-stat '<the WP3 gate stat regex>' --allow-pairs work/skill-rank-level-by-level/allow-pairs.json`
   → NUMBER 0 for both references (0e); moves.md complete; `--legacy-check work/.skillrank-main-before.json` green
   (the live path equals main's engine as it was just before the merge).
4. No `it.fails` and no `today` field left in any of the three new test files (test/skill-rank-level-order.test.ts,
   test/skill-rank-readers.test.tsx, test/skill-rank-reverse-build.test.ts) nor in test/fixtures/skill-order-cases.ts
   (F9).
5. Release-note lines under a new "Skill ranks level by level — release notes" section in docs/overrides-redesign.md
   Part 3 (beside "Phase 1 release notes"; update its "NEXT" pointer ~19): plain words, what a player sees (ranks
   worked out level by level; a skill trained before an increase no longer wastes it; replacement picks only where
   the skill was already trained; the one-time Builder notice; Dual Class increases at both classes' levels); never
   Wanderer's Guide.
6. chat-todo.md "Future correctness pass": every 7.3 item with its reason.
7. Memory: update project_hh_skill_rank_timing_2026_10_21.md (DONE, commits, what is open; drop the "lives in the
   lane" line; name the kept branch `skillorder-wps`; say whether the shared.tsx readers moved) and its MEMORY.md line.
Done when: 0a-0h and 1-7 done (0g run, or its "not needed" reason stated; 0h moved, or its "Still open" line
written); the checker re-reads Guy's request line by line against 0.3, including "skill-choice pickers": every one
moved, or the shared.tsx ones named as still open.

---

## 6. Guards (each with its planted-bad-case proof)

Planted proofs never touch the main tree or the `skillorder` lane: scripts take `--file <copy>`; vitest guards run in
a throwaway lane made FROM MAIN'S CHECKOUT, `node scripts/worktree-lane.mjs new skillorder-plant --from <the commit
under test: WP0's hash, or the skillorder lane's HEAD>`, then `node scripts/vt.mjs <test>` there, then
`node scripts/worktree-lane.mjs rm skillorder-plant` (never `git worktree remove` by hand: it follows junctions).

| id | guard | proof |
|---|---|---|
| G1 | test/skill-rank-level-order.test.ts ratchet (both directions, every finding, DC, FA, D5, the expert-upgrade branch BJ1/BJ2/BJ3, the same-level K4/K4b) + the `today` premise tests (D17) | WP0: run on today's engine → every `it.fails` case fails its assertion and every premise test passes; plant a renamed feat id in one flips case's fixture → its premise test fails (the `it.fails` alone would have stayed green). After WP3, in a plant lane (the sort key is (level, phaseRank, …), so a phase swap alone moves only SAME-level order): (a) swap P5 and P6 in the phase ranks → K4 fails (Kholo Lore and the Stealth increase both at 5); (b) sort by (phaseRank, level) with P6 ranked first, i.e. every increase before every feat (today's order) → K1, B2, MW1, BJ1 fail; (c) sort by (phaseRank, level) with today's ranks, i.e. every feat before every increase (the naive reorder) → K2, B1, K4b fail; (d) judge `conditionalSkills` on the final view instead of the record's position → BJ3 fails (no Intimidation before the dedication, so the two views disagree; BJ1 is trained from 1st on both views and cannot fail — WP3 checker round 1, finding 1); drop the P7 move → SN1 fails; drop the P2 swallow of early-block events → OV4 fails |
| G2 | scripts/skill-write-check.mjs in `npm run verify` (no direct skill write outside the helpers) | copy build.ts to scratch, add `proficiencies.skills.stealth = 'expert'` in the feat pass, run with `--file` → exit 1 naming the line |
| G3 | test/skill-ledger.test.ts: seq-order replay of the ledger equals the live state for every snapshot-subset character | lane: delete one `skillWrite` recording (keep the live write) → the test names that character and key |
| G4 | history invariants (in test/skill-ledger.test.ts): replaying `skillHistory` gives the pre-clamp final skills; every `skillFallbacks` entry has a `redirect` step; steps are in print order; JSON ≤ 16 KB | lane: drop the last step in the resolver → replay mismatch reported |
| G5 | test/skill-rank-gated.test.ts: the six granted feats carry none of the WP4 field list; every `FEAT_RANK_FEAT_GRANTS` entry has `when`; IG1 (a Tweaks-removed Intimidating Glare stays removed) and a held feat is never granted twice | lane: give `specialty-crafting` an `effectChoices` in a patched db copy inside the test → fails; drop the `liveRemovedFeatIds` skip in `rankGatedGrants` → IG1 fails |
| G6 | test/skill-rank-readers.test.tsx P1-P10 + `checkOverridesReaders` with the `Builder>baseSkills` entry removed | lane: restore the old `baseSkills` memo → P1-P4 fail and `checkOverridesReaders` names the unlisted reader; restore `featPrereqChar.proficiencies.skills[s]` in the slot picker → P8, P9 fail; make the increase picker and the slot picker read `skillRanksAt(c, 1, 'creation')` → P1b, P2b, P3b, P4b and P9c fail (a reader that ignores every later level passes P1-P4 and P8-P9 alone; P8b and P9b train at 1st, so they pass such a reader — P9c trains Arcana by a 3rd-level increase before a 4th-level Rogue Dedication; WP7 round 2) |
| G7 | notice wording test (test/skill-rank-notice.test.tsx): forbidden words, silent when empty, ≤ 6 lines before "…and N more" | lane: add "override" to the heading → fails |
| G8 | parity `skillorder:*` family + the new rank stats in `rankStats` (never in `numbers`) + `--allow-pairs` | `--self-test` planted rows (WP0 step 6), incl. a planted `rankStats` change absent from `legacyDeltas` |
| G9 | test/skill-rank-dual-class.test.ts: slot keys unchanged, union levels present | lane: insert a skill slot mid-`featSlots` → slot-key assertion fails |
| G10 | test/skill-rank-notice.test.tsx: `rebuildRoster` output builds are byte-equal to the input builds; only `emptyBuild`, the open stamp and Save write `skillOrder`; with `skillOrderNotice={false}` (the GM's edit) nothing writes it | lane: stamp `skillOrder` inside `rebuildRoster` → fails; ignore the prop in the Save stamp → the GM case fails |
| G11 | `--legacy-check <baseline>` in every gate from WP3 on: the live path (the notice's "before", part B's at-slot reading) equals today's engine on every snapshot character | `--self-test` planted `legacy.skillRanks` row (WP0 step 6); in a plant lane after WP4, let the live queue skip one rank-gated grant → the check names that character |

---

## 7. Risks, performance, not covered

### 7.1 Risks
- A skill write the inventory missed would differ silently between print and live: G2 (scan) and G3 (replay) catch
  it; any new skill source must go through `skillWrite`.
- Two orders live side by side; the live path now serves only part B's probe and the notice. If either is retired
  later, the live path can shrink with it (chat-todo note, not this job).
- A judge with a hidden side effect would apply it twice: judges return effects only; the WP1 checker reads every
  judge for mutation.
- `skillHistory` adds a few KB to every synced character: G4's 16 KB cap; it is derived, so a launch refresh never
  counts as an edit.
- Prerequisites at the slot level (D5) can mark a saved feat "not met" where final ranks met it: notice line 6 says
  so; the feat stays on the sheet.
- An old app version that saves a build may drop `skillOrder`; the notice then shows once more on the new app. Harmless.
- `src/builder/shared.tsx` is blocked by another chat's change: the lane never edits it (a lane edit would make WP11's
  `apply` refuse the whole patch); its three readers move on main in WP11 step 0h if main's copy is clean then.
- `npm run data` can change records the fixtures name: G1's premise tests (D17) check every id against content and
  fail loudly, which an `it.fails` alone would swallow.
- The lane (D21) can drift from main while it runs (a release): WP11 step 0 takes main's own reference before the
  merge and requires the same classified moves against it.

### 7.2 Performance
- The resolver sorts ~50-400 events and re-runs ~10-40 judges: well under a millisecond per build; no extra
  `buildCharacter` inside the engine.
- The Builder loses one full `buildCharacter` per level-page render (`baseSkills`).
- The notice costs one build at open, only for an unstamped build, once per Builder session.
- Part B's probe build is unchanged (one inner build when old entries exist).

### 7.3 Not covered (each goes to chat-todo.md "Future correctness pass" in WP11, with its reason)
1. Int-boost trainings and language Lores at the boost level (rules-2065): needs a per-level pick UI and a stored level.
2. The class/background overlap count (rogue + Emancipated: 7 vs 8 picks): a creation count rule, not an order.
3. Vindicator `removesSkills` deleting a background-trained Nature: a P0 order question inside creation.
4. The class-2 restricted skill choice reading `choice[0]` instead of the pick: a Dual Class creation lane.
5. `effectChoices` / `choiceGrants` "already trained → another skill" flags with no Builder picker (inert today):
   a picker per lane is UI work; D14 covers class trainings only.
5b. Class options and class features above 1st level whose own text prints no "already trained" clause (WP5's
   evidence file lists them): no replacement, as today; print says nothing, so a future pass decides per record.
6. Undead Slayer, Fey Ascension, Hellknight-type clauses the data does not model.
7. `heightenBySkill` reads pre-clamp ranks.
8. Feats removed by a tweak still entering the queue (their own grants run before the removal pass). The rank-gated
   grants are covered (D10: `rankGatedGrants` skips removed ids); the general queue is not.
9. Feat row `level` for class-2 feature grants and grantSources rows pushed at level 1 (display only).
10. Dual Class extra skill FEATS at the other class's levels (rules-1331): a feat-slot change, not a rank.
11. `skillsIfFeature` reads feature ownership at the final level (today's reading).
12. src/builder/shared.tsx readers (background `trainedSkillOptions` ~4044, homebrew-background replacement picker
   ~4118-4140, `newLoreRefusal` ~5305), if main's copy was still not clean at WP11 step 0h. Also a "Still open" line
   in the final report: they are among Guy's named "skill-choice pickers".

### 7.4 Ideas rejected, with the reason
- Physically reorder build.ts: 1.6.
- One `buildCharacter` per level: up to 20× the cost, and a level build cannot see later slot keys.
- Store the history on BuildState: it is derived; it would sync as an edit.
- Keep the history in a WeakMap: `carryStoredOverrides` spreads the character and loses it.
- Rewrite saved answers on load: forbidden (never rewrite on load).
- Ask Guy about the order inside a level: R9 (0.2).
- Build WP1-WP9 straight on main: a release in the WP3-WP9 window would ship changed ranks with no notice (D21).
- A release-blocking marker file checked by verify: verify must stay green in every WP; editing the release skill is
  configuration, not this job's to change.
- Read feat prerequisites before that level's increases (one of the two fixes offered for Snare Setter): it would make
  a 7th-level master skill feat after a 7th-level master increase illegal for every rogue, which pg.29 allows (D5).

### 7.5 Tell Guy (in the final report)
- Some saved characters gain a rank or a replacement pick, a few lose a replacement pick they had; the Builder says
  which, once, and keeps old answers stored. A GM editing a player's character does not see or clear it.
- Dual Class characters get new, empty skill increase slots at the second class's levels; the notice names them.
- A feat whose skill prerequisite is reached only later now shows "not met" at its level.
- If src/builder/shared.tsx still held the other chat's change at the merge: three skill pickers (the background's
  "trained skill" choice, the homebrew background's replacement pick, the new-Lore refusal) still read the finished
  character's ranks; they are a "Still open" line and in chat-todo.md, and move once that file is committed.
- The WP commits are kept on the local branch `skillorder-wps` (not pushed); main carries one merged commit.
- Not checked by this designer: the test suite and the parity instrument (not run; another chat was publishing),
  the real screens. The designer probes (Snare Setter, the reverse build, the moved "exactly" + skilled human case,
  Dual Class increase levels) ran through `npx jiti` from the session scratchpad.

---

## 8. Rejected findings, with the reason

Checker ids: R = checker-rules-engine, U = checker-saved-readers-ui.
- U9 (WP10 "the 15th-level picker greys Bardic Lore" is produced by no WP): the greying already exists and stays:
  `LOCKED_SKILL_KEYS` disables Bardic Lore in every increase picker (Builder.tsx ~3705, "can't be increased by any
  other means"). The step's wording now names that source and shows the label it gives ("T → E", greyed).

Revision 3 (final checker F1-F10): every finding accepted. One part of one fix is replaced, not taken:
- F2, the planted-proof wording "swapping P5 and P6 must also make BJ1 fail": it cannot. The resolver sorts by
  (level, phaseRank, …), and BJ1's feat (2nd) and increase (7th) sit at different levels, so a phase swap does not
  change their order. The same flaw was in Revision 2's own G1 plant ("swap P5 and P6 → K1, B2, MW1 fail": K1's
  feat is at 1st and its increase at 3rd). G1's proof is rewritten: (a) the phase swap now targets the new same-level
  case K4; (b) increases-before-feats across levels fails K1, B2, MW1, BJ1; (c) the naive feats-first reorder fails
  K2, B1, K4b; (d) judging `conditionalSkills` on the final view fails BJ1. BJ1/BJ2 themselves are added as asked.
