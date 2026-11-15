# WP1 inventory — every skill write and read in `buildCharacter` (skill-rank order, plan WP1 step 1)

Tracked evidence for plan `work/skill-rank-level-by-level/plan.md` (Revision 3), WP1. "HEAD" is the line in
src/rules/build.ts at 3aa35e9 (WP0); "now" is the line after WP1. "row" is the plan's 1.1 row. "source" is the
ledger event's `source` (`<kind>:<id>`). Every write now goes through `skillWrite` (a plain write) or a
`skillJudge` effect (a judgement); both apply `applySkillOp` (src/rules/skillPass.ts), the one mutation.

## How the list was made complete

1. `node scripts/skill-write-check.mjs --file <HEAD build.ts>` (the G2 scan, TypeScript AST) flags **51** direct
   writes at HEAD — every line in table A marked "scan".
2. Three HEAD writes the scan cannot see (they write through an alias or a callback, not a `skills` path) were
   found by grepping HEAD for `= maxRank`, `= stepRank`, `updateTrackRank(`, `applySkillFloors` and `into[` —
   marked "grep" in table A. Every other `maxRank`/`stepRank` assignment in HEAD is on a non-skill track
   (perception, saves, attacks, defenses, weaponGroups, `ov`/`wo` overrides maps) or a local (`r`, `best` inside
   `replayedRank`/`skillRankHere`).
3. After WP1 the same scan on the edited file finds **0** writes outside `skillWrite` / `applyExactClamp`.
   The only remaining direct skills write is `p.skills[skill] = held` inside `applyExactClamp` (row 22).
4. Known limit of the scan (also in the deviations): a write through a parameter that ALIASES the skills record
   under another name (HEAD's `into[f.key] = …` in `applySkillFloors`) is invisible to a path scan. That one is
   now a `skillWrite`; any new one is caught at run time by the G3 replay test (test/skill-ledger.test.ts), which
   compares the live record with a replay of what was recorded, on 2,278 characters × 2 gates.

## A. Writes

| # | HEAD | found by | now | symbol / what | op | row | source |
|---|---|---|---|---|---|---|---|
| 1 | 1821 | scan | — | `updateTrackRank` skill branch | (removed) | 13, 22 | skill targets now route via `skillTrackKey`: #39 and #57 |
| 2 | 5199 | scan | 5325 | init: every skill untrained | set | (seed) | `init` |
| 3 | 5228 | scan | 5326 | class fixed trainings | set + lock "your class" | 1 | `class:<id>` |
| 4 | 5232 | scan | 5330 | second class fixed trainings | set + lock | 2 | `class2:<id>` |
| 5 | 5233 | scan | 5331 | second class restricted choice (first option) | set + lock | 2 | `class2:<id>` |
| 6 | 5235 | scan | 5333 | second class Lore | set | 2 | `class2:<id>` |
| 7 | 5242 | scan | 5340 | class restricted choice (`subclassSkill`) | set + lock | 1 | `class:<id>` |
| 8 | 5246 | scan | 5343 | class Lore | set | 1 | `class:<id>` |
| 9 | 5266 | scan | 5364 (judge) | homebrew background, already trained → replacement pick | max + lock | 3 | `background:<id>` |
| 10 | 5267 | scan | 5364 (judge) | background trained skill | set + lock | 3 | `background:<id>` |
| 11 | 5277 | scan | 5386 | background Lore | set + lock | 3 | `background:<id>` |
| 12 | 5289 | scan | 5398 | feat-granted background (passion) skill | max | 7 | `background:<passion id>` |
| 13 | 5290 | scan | 5399 | passion background Lores | set | 7 | `background:<passion id>` |
| 14 | 5308 | scan | 5417 | background Lore choice lane | set + lock | 3 | `background:<id>` |
| 15 | 5310 | scan | 5419 | background skill choice lane | set + lock | 3 | `background:<id>` |
| 16 | 5328 | scan | 5437 | background Lore (choice lane 2) | set + lock | 3 | `background:<id>` |
| 17 | 5338 | scan | 5447 | `backgroundChosenLoreKeys` | set + lock | 3 | `background:<id>` |
| 18 | 5342 | scan | 5451 | background extra skill | max + lock | 3 | `background:<id>` |
| 19 | 5353 | scan | 5462 | background Lore (lane 3) | set + lock | 3 | `background:<id>` |
| 20 | 5360 | scan | 5469 | background deity skill | set + lock | 3 | `background:<id>` |
| 21 | 5392 | scan | 5502 | heritage Lore (`loreStep`) | max | 4, 5 | `heritage:<id>` |
| 22 | 5395 | scan | 5505 | `heritageSkill` | set + lock "your heritage" | 4 | `heritage:<id>` |
| 23 | 5398 | scan | 5508 | skilled human expert (level ≥ 5) | max | 6 | `heritage:skilled-human` |
| 24 | 5402 | scan | 5513 | option `grants.skills` | set + lock "a class choice" | 8 | `option:<id>` |
| 25 | 5407 | scan | 5517 | option `removesSkills` | delete + unlock | 8 | `option:<id>` |
| 26 | 5425 | scan | 5532 | option Lores (`optLoreStep`) | max + lock | 8, 5 | `option:<id>` |
| 27 | 5438 | scan | 5545 | option Lore subject | max + lock | 8 | `option:<id>` |
| 28 | 5442 | scan | 5549 | option `skillChoice` pick | set + lock | 8 | `option:<id>` |
| 29 | 5448 | scan | 5556 | dragon-type skill | set + lock "your bloodline dragon" | 9 | `option:<dragon option id>` |
| 30 | 5459 | scan | 5568 | cleric deity skill | max + lock "your deity" | 9 | `deity:<id>` |
| 31 | 5469 | scan | 5574 (judge) | class skill picks (skip locked, cap) | set | 10 | `classPick:<class id>` |
| 32 | 5494 | scan | 5601 (judge) | language Lores | set + lock `LANGUAGE_LORE_SOURCE` | 11 | `langLore:int` |
| 33 | 5537 | grep (alias `into`) | 5657 | `applySkillFloors` (also into the `skillsBeforeIncreases` copy, which records nothing) | max | 12 | `floor:<key>` (+ `moved`) |
| 34 | 5598 | scan | 5699 (judge) | skill increases, three lanes, Lore alias | step (cap by level) | 21 | `increase:<lvl>` / `bonus:<lvl>` / `bgIncrease:<lvl>` |
| 35 | 7135 | scan | 7257 | old `=` (`liveLegacyRanks`) | set | 13 | `set:<key>` |
| 36 | 7145 | grep (`updateTrackRank` callback) | 7268 | moved "exactly" written at the old slot (B26 b) | set | 13 | `set:<key>` + `moved` |
| 37 | 8047 | scan | 8180 (judge) | static skill redundant → replacement pick | max | 15 | `feat:` / `heritage:` / `feature:<id>` |
| 38 | 8050 | scan | 8180 (judge) | static skills + `deitySkill` | max | 15 | same |
| 39 | 8061 | scan | 8219 (judge) | `conditionalSkills` | max | 15 | same |
| 40 | 8071 | scan | 8219 (judge) | `conditionalSkillsFallback` pick | max | 15 | same |
| 41 | 8085 | scan | 8245 (judge) | `crossConditionalSkills` | max | 16 | same |
| 42 | 8097 | scan | 8268 | `skillsIfFeature` | max | 15 | same |
| 43 | 8133 | scan | 8397 (judge, `judgeSlot`) | `skillChoices` slot (+ Lion Blade `conditionalRank`) | max | 15 | same |
| 44 | 8205 | scan | 8397 (judge, `judgeSlot`) | slot `loreFallback` replacement | max | 15 | same |
| 45 | 8213 | scan | 8397 (judge, `judgeSlot`) | slot replacement pick | max | 15 | same |
| 46 | 8232 | scan | 8417 | answered `choiceGrants` slot | max | 15 | same |
| 47 | 8281 | scan | 8466 | `loreChoices` | max | 15 | same |
| 48 | 8290 | scan | 8475 | answered grant's Lore slot | max | 15 | same |
| 49 | 8327 | scan | 8512 (judge, `noMoved`) | Molten Wit "must take the other" | max | 17 | `feat:molten-wit` |
| 50 | 8337 | scan | 8512 (judge, `noMoved`) | Molten Wit "different skill of your choice" | max | 17 | `feat:molten-wit` |
| 51 | 8544 | scan | 8740 | class `skillProgression` | max | 18 | `feature:<id>` |
| 52 | 8560 | scan | 8758 | `applyAlwaysOn` (effectChoices / always-on grants) | max | 19 | `feat:` / `heritage:` / `deity:` / `background:` / `feature:` / `option:<id>` (via `alwaysOnFor`) |
| 53 | 8649 | scan | 8849 | Ancient Ash / `skillProgressionFromChoice` | max | 19 | `heritage:<id>` |
| 54 | 11499 | grep (`updateTrackRank` callback) | 11703 → `applyExactClamp` | "exactly" clamp (rank seam 3) | set | 22 | after the resolve; allowed symbol, not recorded |

Rank-gated feat grants (row 20, HEAD ~7823) and the `skillRankBefore` snapshot write no rank: they are judges
whose effects are `rankGate` and `before` (rows 20 and 17's input).

## B. Reads

"judge" = the read now happens inside a `skillJudge` closure, through its view. "order-free" = the read is not a
judgement on a record's place in print order, with the reason.

| HEAD | now | reader | kind | why |
|---|---|---|---|---|
| 5266 `skills[picked]`, 5289, 5342, 5392, 5398, 5425, 5438, 5459, 8231 (answered-grant `cur`), 8047-8337 `maxRank(cur, …)` | the `max` op | the read half of every "raise only" write | order-free | `max` re-reads the key when the op is applied; replayed in another order it reads the rank at its new place, which is what print means by "raise" |
| 5263 `skills[bg] !== 'untrained'` (homebrew `already`) | 5368 | homebrew background redundancy | judge (`main`) | "already trained" is a question about the place |
| 5467 `locked.has(sk)` | 5578 | class skill picks skip a locked skill | judge (`main`, `view.locked`) | which skills were locked by level-1 trainings |
| 5491 `skills[key] === 'untrained'` | 5607 | language Lores | judge (`main`) | "a Lore the character already has does not count" |
| 5582-5583 alias reads | 5704-5705 | increase lands on the old or new Lore key | judge (`main`) | 1.1 row 21: the alias is a judge on the print view |
| 5541 `{ ...skills }` | 5661 `skillsBeforeFloors` | the snapshot before level-1 floors | order-free | a copy for `skillsBeforeIncreases`; feeds only `replayedRank` (below) |
| 5566 `{ ...skillsBeforeFloors }` | 5686 `skillsBeforeIncreases` | ranks before any increase | order-free | input of `replayedRank`, which feeds the `beforeOwn` judge views; WP3/WP4 re-judge those on the print history |
| 7125 `{ ...proficiencies.skills }` | 7247 | at-slot probe (`AT_SLOT_PROBE`, `legacyRankSort`) | order-free | part B B26: reads the live state at the old `=` slot by design (what the old `=` met); not a record's judgement |
| 7708-7719 `skillsBeforeIncreases` / `skillIncreases` | 7837-7844 `replayedRank` | as-of replay | order-free (feeds a judge view) | live-only helper behind the `beforeOwn` view |
| 7721 `proficiencies.skills[skill]` | 7848 `skillRankHere` | rank before a carrier's own grants | order-free (feeds a judge view) | live-only helper behind the `beforeOwn` view |
| ~7823 FEAT_RANK_FEAT_GRANTS `skillRankHere(rg.skill, exceptId)` | 7958 | rank-gated feat grants (Stonemason's Eye, Gildedsoul) | judge (`beforeOwn`) | row 20 / D10 |
| 7900 SKILL_RANK_BEFORE_OWN_GRANTS snapshot | 8052 | `skillRankBefore[carrier]` | judge (`beforeOwn`) | D7/D12: as of the carrier's level |
| 8029 `cur` (static skills) | 8187 | redundantFallback "already trained?" | judge (`main`) | row 15 |
| 8057 `priorCond` | 8225 | conditionalSkills base/upgraded + `csf` | judge (`main`) | row 15 |
| 8082 gate skill | 8252 | crossConditionalSkills gate | judge (`main`) | row 16 / D9 |
| 8121, 8208 `cur`, `pickedCur` | 8296, 8386 | skillChoices slot: conditionalRank, redundancy, "in which you're trained" | judge (`main`) | row 15 |
| 8323 `mw[s] === 'untrained'` | 8516 | Molten Wit branches | judge (`noMoved`, the `skillRankBefore` snapshot) | row 17 / D7 |
| 8544, 8560, 8649 | 8740, 8758, 8849 | progression / always-on raises | order-free | `max` ops (first row) |
| 10890 | 11098 | `heightenBySkill` | order-free | row 22: after the resolve point, reads the final ranks (the rank you have now), unchanged by the order |
| 11499 | 11703 | "exactly" clamp | order-free | row 22: runs after every raise in any order; `applyExactClamp` |
| 11699 | 11896 | language-Lore rerun | order-free | reads the `languageLores` list (a judge effect), not a rank |
| literal | ~11903 | `Character.proficiencies.skills`, `skillIncreases`, `skillFallbacks`, `grantedSkills` | order-free | the result; WP3 swaps what fills them |
| 5605 `proficiencies = { skills, … }` | 5730 | `proficiencies.skills` is `skills` (one object) | order-free | identity, not a value read |

## C. Not skill ranks (checked, not converted)

- `cur.skills = { ...cur.skills, … }` (HEAD 9879, now 10086): an item's numeric skill BONUS map, not a rank record.
- `ov[...]`, `wo[...]`, `overrides[w]` `maxRank` writes: weapon/armor overrides maps.
- `p.saves/attacks/defenses/weaponGroups`, `perception`, `classDc`: other tracks (`updateTrackRank` keeps them).
