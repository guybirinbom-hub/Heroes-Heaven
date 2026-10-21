# Skill ranks come out in the wrong order — findings (2026-10-21)

Read-only investigation: 4 readers + 1 independent checker, every case run against the real engine.
Nothing in the app was changed. Scratch evidence (session scratchpad, may be cleaned):
`scratchpad/chk/cases.ts` (NAIVE=1 runs a naive-fix copy), `cases2.ts`, `cases3.ts`, `scan.ts`.

## The bug
`src/rules/build.ts` spends skill increases (~5344) BEFORE it applies feat skill grants (~7700-8035),
and the heritage / feat choice trainings (`effectChoices`, ~8346-8483) come even later.
So a level-1 feat's training lands "after" a level-3 increase, and the increase is wasted.

## Why "feat skills first, then increases" is wrong (all verified by running code)
1. **Feats taken AFTER the increase break.** Barbarian Dedication at 4 after an L3 Athletics increase:
   today trained + a replacement skill (correct). Naive fix: expert, the replacement skill disappears.
   Hits dozens of dedications and skill feats with "if already trained, pick another skill".
2. **"If you have legendary X" gates break.** Bardic Lore at 15 (plus Loremaster, Folktales, Gossip,
   Wild Mimic Lore): legendary Occultism comes from increases, so a gate run before them never opens.
   Today correct (Lore expert); naive fix: trained.
3. **A second lane is not reached at all.** Skills trained by heritage or feat choices (28 heritages,
   15 feats: Ancient Ash ghoran, Lorekeeper Shisk, Anvil Dwarf…) land after everything. Same bug survives.
4. **Today's bug also hands out a free skill.** Kholo Lore + L3 Stealth increase: the engine thinks Stealth
   was "already trained" and offers a replacement pick print never gives. Saved characters that answered it
   would lose that skill after any fix.
5. **Rank-gated feats read the end-of-build rank.** Stonemason's Eye at 1 + L3 Crafting increase gives
   Crafting trained + Specialty Crafting; print: Crafting expert. The naive fix leaves this wrong.
6. **Heritages and class features run after feats inside the feat pass.** Sage Jotunborn + Linguist
   Dedication at 2: Society trained, print says expert. Not about increases at all.
7. **The Builder's increase picker reads the full-level character.** The level-3 picker counts feats taken at
   4 and 5 ("T → E" when the skill is untrained at 3; skilled human wrongly greyed "capped at expert").
   Feat prerequisites and skill-choice pickers also read final ranks.
8. **Other readers have their own model:** the "how is this calculated" history (explain.ts), the reverse
   build used by Wanderer's Guide import (places rebuilt increases with no timing).
9. **Old Overrides "=" ranks and Tweaks part B** both depend on where increases sit. Moving the loop changes
   saved Overrides characters (Stealth = expert + increases → master).

Not affected: Perception, saves, weapon and armor proficiency.

## The fix that covers it (needs the rulings below first)
1. Guard first: a test with two-direction fixtures (feat before / after the increase) for every case above,
   failing on today's engine.
2. Give every skill source a level (class features, class options unlocked later, heritage = 1, feats = their
   level, choice trainings = their record's level, progressions = their step levels).
3. Replace the increase loop + the skill half of the feat pass + the choice trainings with ONE pass, level by
   level: that level's sources → judge "already trained" clauses at that moment → Tweaks floors → that
   level's increases (capped). "If you have X" gates (Bardic Lore) stay a final pass.
4. Rank-gated feat grants (Stonemason's Eye, Molten Wit) read the rank as of the feat's level.
5. Settle the old Overrides "=" place together with Tweaks part B — never both at once.
6. The engine emits a per-level skill history; the Builder picker, prerequisites and the
   "how is this calculated" popup read it instead of their own models.
7. Reverse build (WG import) places rebuilt increases after the training they build on.
8. Saved characters: never rewrite on load; keep orphaned answers; show a Builder notice where a pick or an
   increase stopped doing something.
9. `npm run verify`, narrow tests through scripts/vt.mjs, parity snapshot with an allow-list of these cases.

## ANSWERED 2026-10-21 (quoted in docs/gold-set-answers.md, "The order skill ranks are worked out in")
1. Level by level, as print — even where Wanderer's Guide differs.
2. "From your background or class" is only an example: already trained from ANY source when the feat is
   taken (an increase or another feat included) → a skill of the player's choice instead.
3. Builder notice naming what changes on that character; silent when nothing changes.
4. Start only after Tweaks part B is finished.

## Owner questions as asked
1. **Which order should the app copy?** Wanderer's Guide runs heritage + every ancestry feat first, then
   level by level (feats before increases), Free Archetype feats last, and offers "pick another skill" on
   any repeat. Print goes strictly level by level. They differ in 3 cases: an ancestry feat at 5+ after an
   increase (WG expert / print trained); Inventor Dedication after a Crafting increase (WG free extra
   skill / print nothing); a Free Archetype dedication at 2 before an L3 increase (WG trained + extra skill /
   print expert). The standing rule says exact WG parity.
2. **Kholo Lore and the other ancestry Lore feats** owe a replacement only if you would *automatically*
   become trained ("from your background or class"). Does a skill increase you chose count?
3. **Saved characters will change.** Show a Builder notice, or change silently?
4. **This fix vs Tweaks part B:** which ships first? They touch the same spot.

## Not checked
The test suite (not run), the real app screens (engine calls only), Dual Class second-class increases,
how WG's own increase picker caps a rank.
