# Skill ranks level by level — classified parity moves

Tracked evidence (plan "Parity, three runs"). Every row a gate allows outside the `skillorder:` family is classified
here (id | stat | before → after | case | why); a classified move outside the gate's stat regex is also listed in
`allow-pairs.json` beside this file, for that id only.

## WP3 (print pass at the resolve point) — 2026-10-22

Discovery: `npx jiti scripts/blocks-parity-snapshot.mjs --compare work/.skillrank-baseline.json --allow '^skillorder:'`
→ NUMBER differences 0 (+485 allowed by `--allow`, every one a `skillorder:` row), breakdown-part 45 (all
`skillorder:`), sumOk 1 (`skillorder:LL1 [off] skill.lore:sailing: null -> true`). No `build.hashSansSkill`,
`build.featRows` or `build.rankGated` row moved anywhere.

### Classified rows outside `skillorder:`

| id | stat | before → after | case | why |
|---|---|---|---|---|

None: no character outside the findings cases moved (overrides 48, record 843, twin 74, state 80, sweep-filled 580,
sweep 580, tweaks-browser 3 — all NUMBER-equal at both gates, `build.*` rank stats included). `allow-pairs.json` is
therefore `[]`.

Gate: `--allow '^(skillorder:)' --allow-stat '<the WP3 regex>' --allow-pairs work/skill-rank-level-by-level/allow-pairs.json
--legacy-check work/.skillrank-baseline.json` → NUMBER 0 (+485 allowed by `--allow` + `--allow-stat`); legacy check
18,224 stats, 0 differ. Every allowed `build.hash` row (57) is a `skillorder:` case whose `build.hashSansSkill` did
not move.

### For reference: the rank moves inside `skillorder:` (allowed by the family; each is its case's `expect`)

From `build.skillRanks`, baseline (3aa35e9) → WP3, and the gates it moved at. A case missing its `on` gate is a lane
the trust gate darkens (GATE_ON_KNOWN in test/skill-rank-level-order.test.ts).

| case | skill: before → after | gates |
|---|---|---|
| AA3 | stealth: trained → expert | off |
| AA7 | stealth: expert → master | off |
| AA7b | stealth: expert → master | off |
| AD2 | crafting: trained → expert | off+on |
| AD3 | crafting: trained → expert | off+on |
| B2 | athletics: trained → expert | off+on |
| BJ1 | intimidation: expert → master | off+on |
| FA1 | athletics: trained → expert | off+on |
| I2 | crafting: trained → expert | off+on |
| IC1 | crafting: trained → expert | off+on |
| J1 | society: trained → expert | off+on |
| K1 | stealth: trained → expert | off+on |
| K1s | arcana: trained → untrained | off |
| K1s | stealth: trained → expert | off+on |
| K1sa | arcana: trained → untrained | off |
| K1sa | stealth: trained → expert | off+on |
| K4 | stealth: trained → expert | off+on |
| LL1 | society: expert → master | off |
| LL1 | lore:sailing: untrained → trained | off |
| LS1 | society: trained → expert | off |
| LS2 | society: trained → expert | off |
| MW1 | deception: trained → expert | off+on |
| OW1 | religion: trained → expert | off+on |
| RB1 | stealth: trained → expert | off+on |
| RB2 | stealth: trained → expert | off+on |
| S1 | crafting: trained → expert | off+on |
| V2 | thievery: trained → expert | off+on |

The other `skillorder:` rows are `history.*` (none → the new per-level history), `build.skillFallbacks` /
`build.grantedSkills` (A2, A5*, A6* …: the replacement answer owed or no longer owed under print order) and the
`skill.*` / `pc.skills.*` / `explain.skill.*` totals that follow the ranks above.

### WP3 fix round 1 (checker round 1) — two new family characters

BJ3 and OV5 were added to the case list and to the baseline (their rows measured on the WP0 engine, state.md
deviation 47). Gate re-run (same command as above): NUMBER 0 (+491 allowed, all `skillorder:`: the 485 above + 6),
breakdown-part 45, sumOk 1, legacy check 18,240 stats / 0 differ, no `build.hashSansSkill` row.

| case | stat | before → after | gates | why |
|---|---|---|---|---|
| OV5 | build.skillFallbacks | kholo-lore:stealth → (none) | off | **plan 3.4 item 1, the intended Tweaks move**: an "at least" Stealth expert floor from 3 lands after Kholo Lore at 1 (its start level), so the feat finds Stealth untrained and owes nothing (rulings 1 + 2). At gate on WP0 owed nothing either (darkened). |
| OV5 | build.hash | moves with the fallback | off | the stored character's fallback list; `build.hashSansSkill` unchanged |
| OV5 | history.stealth | none → 1 trained (Kholo Lore), 3 expert (the floor) | off+on | the new history |
| BJ3 | history.intimidation | none → 2 trained (Blackjacket), 7 expert (the increase) | off+on | the new history; ranks unchanged (expert on both engines). BJ3 is the G1 (d) plant's case. |

## WP4 (rank-gated feat grants after the resolve) — 2026-10-22

One snapshot, `npx jiti scripts/blocks-parity-snapshot.mjs --out work/.skillrank-after-WP4.json --legacy-check
work/.skillrank-baseline.json` (2280 x 2, errors 0/0, legacy 18,240 stats / 0 differ), compared offline.

Discovery: `--compare work/.skillrank-after-WP3.json --against work/.skillrank-after-WP4.json --allow '^skillorder:'`
→ NUMBER differences 0 (+16 allowed, every one a `skillorder:` row), breakdown-part 0, sumOk 0. No row outside the
family moved. Measured on both snapshots: the only characters with a non-empty `build.rankGated` (at either gate)
are the family's S1, S2, IC1, IC2, G1 and RI1 — no other snapshot character holds a carrier with its rank met. So
the instrument sees this WP through the family only; Student of Water's 'reached' rows (Water Sprint at the level
master Athletics arrives) and the D6 re-run (Intuitive Crafting seeing a Specialty Crafting that Stonemason's Eye
handed over) are pinned by test/skill-rank-gated.test.ts instead.

### Classified rows outside `skillorder:`

None. `allow-pairs.json` stays `[]`.

Gate: `--compare work/.skillrank-after-WP3.json --against work/.skillrank-after-WP4.json --allow '^(skillorder:)'
--allow-stat '^build\.(featRows|hash|rankGated)$' --legacy-check work/.skillrank-baseline.json` → NUMBER 0 (+16
allowed), legacy 18,240 stats / 0 differ, exit 0. Every allowed row is a feat a FEAT_RANK_FEAT_GRANTS carrier hands
over (or the hash that follows it):

| case | stat | before → after | gates | why |
|---|---|---|---|---|
| S1 | build.featRows, build.rankGated | specialty-crafting@1 (stonemasons-eye) → (none) | off+on | D10 'taken': Crafting untrained just before Stonemason's Eye at 1; the 3rd-level increase no longer answers "already trained" |
| IC1 | build.featRows, build.rankGated | specialty-crafting@1 (intuitive-crafting) → (none) | off+on | the same, Intuitive Crafting (feat-7200) |
| RI1 | build.featRows | scare-to-death@1 → scare-to-death@15 | off+on | D10 'reached': "as soon as you meet the prerequisites" — legendary Intimidation at 15th; `build.rankGated` unchanged (the same carrier and feat) |
| S1, IC1, RI1 | build.hash | moves with the row | off+on | the stored feat list |

### WP4 round 2: the earliest source of a rank-gated feat wins (state.md deviation 58)

Not visible to the instrument (no snapshot character holds a rank-gate carrier AND a flat granter of the same feat;
the rewritten after-WP4 snapshot gates exactly as above: NUMBER 0, +16 allowed, legacy 0 differ). Pinned by
test/skill-rank-gated.test.ts instead. Intended moves vs today's engine:

| character | today | print pass | why |
|---|---|---|---|
| barbarian 5, Raging Intimidation at 1 (Intimidation trained), Sinister Appearance at 5, featPicks listing Sinister Appearance first | intimidating-glare@5 (sinister-appearance) | intimidating-glare@1 (raging-intimidation) | "as soon as you meet the prerequisites … you gain these feats": the carrier's level; today depended on featPicks order (D4) |
| monk 4, Student of Water at 2 (Athletics trained), Marine Marauder Dedication at 4, dedication listed first | underwater-marauder@4 (marine-marauder-dedication) | underwater-marauder@2 (student-of-water) | the same sentence |

Unchanged (today already gave these in the carrier-first order; the legacy side keeps today's answer either way):
the carrier-first order of both pairs, and an EARLIER flat grant (Sinister Appearance at 1, Raging Intimidation at
2 → intimidating-glare@1 (sinister-appearance)).

## WP5 (class trainings above 1st level: the replacement pick, D14) — 2026-10-22

Snapshot: `npx jiti scripts/blocks-parity-snapshot.mjs --out work/.skillrank-after-WP5.json --legacy-check
work/.skillrank-baseline.json` → 2280 x 2 gates, build/play errors 0/0, legacy 18,240 stats / 0 differ.

Discovery: `--compare work/.skillrank-after-WP4.json --against work/.skillrank-after-WP5.json --allow '^skillorder:'` →
NUMBER 0 (+16 allowed, every one a `skillorder:` row), breakdown-part 0, sumOk 0. No row outside `skillorder:` moved
(no record/sweep/state/overrides/tweaks-browser character holds an epithet over an already-trained skill), so
nothing is classified here and `allow-pairs.json` stays `[]`.

Gate: `--compare work/.skillrank-after-WP4.json --against work/.skillrank-after-WP5.json --allow '^(skillorder:)'
--allow-stat '^build\.(skillFallbacks|hash)$' --allow-pairs work/skill-rank-level-by-level/allow-pairs.json
--legacy-check work/.skillrank-baseline.json` → NUMBER 0 (+16 allowed), legacy 18,240 / 0 differ, exit 0. No
`build.hashSansSkill` row moved. The allowed rows:

| case | stat | before → after | gates | why |
|---|---|---|---|---|
| A5, A5e | build.skillFallbacks | (none) → the-brave:athletics | off+on | Barbarian Dedication at 2 trains Athletics; The Brave at 3 finds it trained and owes "a different skill of your choice, as normal" (Root Epithet, class-feature-1066; D14) |
| A6, A6e | build.skillFallbacks | (none) → the-brave:athletics | off+on | the 1st-level class pick trains Athletics (no longer locked by an epithet that does not exist at 1st, WP3); the same clause |
| A5, A5e, A6, A6e | build.hash | moves with the fallback list | off+on | the stored `skillFallbacks` |

A5 and A6 share A5e's and A6e's builds (the cases split one build's expect groups, state.md deviation 2).

## WP6 (Dual Class increases, D15) — 2026-10-22

Snapshot: `npx jiti scripts/blocks-parity-snapshot.mjs --out work/.skillrank-after-WP6.json --legacy-check
work/.skillrank-baseline.json` → 2280 x 2 gates, build/play errors 0/0, legacy 18,240 stats / 0 differ.

Discovery = gate (the plan's WP6 command): `--compare work/.skillrank-after-WP5.json --against
work/.skillrank-after-WP6.json --allow '^skillorder:DC'` (+ `--legacy-check work/.skillrank-baseline.json` for the
gate) → NUMBER 0 (+42 allowed, every one `skillorder:DC1` or `skillorder:DC3`), sumOk 0, legacy 0 differ, exit 0.
Breakdown-part 6 (DC1 acrobatics/deception, DC3 athletics, both gates: the proficiency part of the moved rank). No
other family holds a Dual Class character, so nothing outside the DC cases is classified and `allow-pairs.json`
stays `[]`. No `build.hashSansSkill` row moved.

| case | stat | before → after | gates | why |
|---|---|---|---|---|
| DC1 | build.skillIncreases | 3:thievery → 2:acrobatics,3:thievery,4:deception | off+on | fighter (1st) + rogue (2nd): the rogue's increases at 2nd and 4th now count (GM Core rules-1331, "a dual-class rogue/ranger still gets the … skill increase at levels where the other class doesn't provide them"; D15) |
| DC1 | skill.acrobatics(.rank), pc.skills.Acrobatics, explain total, build.skillRanks, history.acrobatics | trained 7 → expert 9 | off+on | the 2nd-level increase on Acrobatics (fighter-trained at 1st) |
| DC1 | skill.deception(.rank), pc.skills.Deception, explain total, build.skillRanks, history.deception | untrained 0 → trained 6 | off+on | the 4th-level increase |
| DC3 | build.skillIncreases | (none) → 2:athletics | off+on | the rogue's 2nd-level increase; Barbarian Dedication (2nd) trains Athletics first, then the increase (ruling 1) |
| DC3 | skill.athletics(.rank), pc.skills.Athletics, explain total, build.skillRanks, history.athletics | trained 5 → expert 7 | off+on | the same; the 2nd-level cap is expert |
| DC1, DC3 | build.hash | moves with the increases | off+on | the stored `skillIncreases` |

Not visible to the instrument (no snapshot character is a swashbuckler/thaumaturge pair): the bonus lane per
owning class. Pinned by test/skill-rank-dual-class.test.ts (thaumaturge + swashbuckler: Stylish Tricks' 3rd-level
increase, Acrobatics or the style's skill; swashbuckler + thaumaturge: Thaumaturgic Expertise's 9th-level increase).

## WP6L (the earlier checkers' minor findings) — 2026-10-22

Snapshot: `npx jiti scripts/blocks-parity-snapshot.mjs --out work/.skillrank-after-WP6L.json --legacy-check
work/.skillrank-baseline.json` → 2280 x 2 gates, build/play errors 0/0, legacy 18,240 stats / 0 differ.
Compare: `--compare work/.skillrank-after-WP6.json --against work/.skillrank-after-WP6L.json --legacy-check
work/.skillrank-baseline.json` → NUMBER 0 with no `--allow`, breakdown-part 0, sumOk 0, legacy 0 differ, exit 0.
`--self-test --baseline work/.skillrank-after-WP6L.json` → 26 checks pass. No snapshot character holds a same-level
rank-gate tie or two class-picked Lores out of alphabetical order, so nothing is classified from the instrument and
`allow-pairs.json` stays `[]`.

### Same-level rank-gate ties follow D4 (state.md deviation 72; item 2)

Before WP6L a tie (the rank gate and a flat grant of the same feat at one level) always went to the flat granter. D4
orders a level's feats by slot draw (ancestry, class, class 2, skill, general, bonus, impulse, Free Archetype, …), each
granted feat right after its granter; the rank-gated feat arrives right after its gate opens (the carrier's place, or
the step that reached the rank, whichever is later). Print source for the order: Player Core pg.29, rules-2065 ("in
whichever order you want", R9 — D4 picks the slot-draw order); for the gate: "As soon as you meet the prerequisites …
you gain these feats" (Student of Water, Raging Intimidation). Pinned by test/skill-rank-gated.test.ts "a SAME-LEVEL tie
follows D4" (both featPicks orders of each pair). Intended moves:

| character | today (WP0 engine) | after WP6 (lane) | after WP6L | why |
|---|---|---|---|---|
| monk 2, Free Archetype, Athletics trained at 1st, Student of Water (2nd, class slot), Marine Marauder Dedication (2nd, Free Archetype slot), the dedication listed first in featPicks | underwater-marauder@2 (marine-marauder-dedication) | the same | underwater-marauder@2 (student-of-water) | the class slot comes before the Free Archetype slot and the gate is open there (D4) |
| the same, Student of Water listed first | underwater-marauder@2 (student-of-water) | underwater-marauder@2 (marine-marauder-dedication) | underwater-marauder@2 (student-of-water) | WP6L restores today's result: the WP4 round-2 tie rule had moved it without a print reason |
| barbarian 1, Intimidation trained at 1st, Sinister Appearance (1st, ancestry slot), Raging Intimidation (1st, class slot), Raging Intimidation listed first | intimidating-glare@1 (raging-intimidation) | intimidating-glare@1 (sinister-appearance) | the same | the ancestry slot comes before the class slot (D4): the flat grant is first. A move vs today, kept with its print reason |
| the same, Sinister Appearance listed first | intimidating-glare@1 (sinister-appearance) | the same | the same | unchanged |
| Dual Class monk/rogue 2, no Athletics until the 2nd-level increase, Student of Water and Marine Marauder Dedication in the two class slots, either slot, either featPicks order | underwater-marauder@2 (marine-marauder-dedication); Athletics untrained (no 2nd-level increase for a monk first class, WP6) | underwater-marauder@2 (marine-marauder-dedication) | underwater-marauder@2 (student-of-water) | D5: the dedication needs "trained in Athletics" (feat-9030), met only by the level's increase, so it sits after the increase (P7) even though it writes no rank; the gate opens at the increase (P6), before it. A move vs today, kept with its print reason (WP6L checker round 1, F1) |
| Dual Class monk/rogue 4, Pirate Dedication at 2, no Athletics until the 4th-level increase, Student of Water (class slot 0), Pirate Combat Training choosing Underwater Marauder (class slot 1), either order | underwater-marauder@4 (pirate-combat-training) | the same | the same | unchanged: Pirate Combat Training's only prerequisite is Pirate Dedication, so it stays at P5 and hands the feat over before the increase (P6) opens the gate. Pins that the gate opens where the rank is REACHED |

"Today" is the WP0 engine's character (work/.wp0tree-probe, scratchpad wp6l/tie0.ts; its legacy side agrees); it
depended on featPicks order (D4's reason for existing). The lane's columns are measured with the same script.

### Class-picked Lores keep the player's order (state.md deviation 73; item 3)

WP6 wrote the class picks in sorted key order, so a character's picked Lores showed alphabetically (no rule orders
them). WP6L writes the sixteen skills in SKILLS order and the Lores in pick order: the sheet order is today's again
(WP0 engine = lane on the same builds), and the history no longer depends on click order for the sixteen skills (the
WP6 round-trip guard stays green). No number moves; pinned by test/skill-ledger.test.ts "class-picked Lores keep the
player's pick order on the sheet".
