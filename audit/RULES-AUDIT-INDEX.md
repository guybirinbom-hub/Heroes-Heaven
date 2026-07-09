# Heroes Heaven — PF2e Remaster rules-correctness audit (2026-07-09)

**Goal:** verify that every user-facing feature, calculation, and data value in the app is correct
against the PF2e Remaster rules and data. Ground truth = the local Foundry PF2e dataset at
`.import-src/pf2e/packs/pf2e/` (the same Paizo/Remaster data Archives of Nethys publishes, machine-checkable)
+ known PF2e Remaster formulas. Each section is self-contained and its findings are written to its own
file **before** moving on, so an interruption loses at most one section.

**Method per section:** a multi-agent workflow fans out verification agents (each owns one calculation
or data slice, states the correct rule, checks the app code / diffs against Foundry JSON), then an
adversarial verify pass re-checks each candidate finding (tries to refute it) so only confirmed defects
survive. Findings are ranked by severity.

**Severity:** `critical` (wrong result the user relies on, common case) · `high` (wrong in a common
build/case) · `medium` (wrong in a narrower case, or misleading) · `low` (cosmetic / rare / display-only).

---

## Sections

| # | Section | File | Status | Findings |
|---|---------|------|--------|----------|
| 1 | Attributes, proficiency framework, AC, saves, Perception, class DC | `01-defenses.md` | ✅ done | 4 (1 med, 3 low) |
| 2 | HP, speed, resistances / weaknesses / immunities | `02-hp-speed-iwr.md` | ✅ done | 2 (1 high, 1 med) |
| 3 | Skills & skill DCs | `03-skills.md` | ✅ done | 1 (1 med; = §1.3 root) |
| 4 | Spellcasting — attack/DC, slots per level, cantrips, signatures, focus | `04-spellcasting.md` | ✅ done | 3 (2 high, 1 med) |
| 5 | Strikes — attack bonus, MAP, damage, crit spec, runes/handwraps | `05-strikes.md` | ✅ done | 2 (1 high, 1 low) |
| 6 | Proficiency advancement per class (all 27) vs Foundry class data | `06-prof-advancement.md` | ✅ done (6a+6b+6c) | 9 (5 high, 3 med, 1 low) |
| 7 | Feat slots per level + feat prerequisites | `07-feats-slots-prereqs.md` | ✅ done (3 workflow + 5 inline) | 0 (clean) |
| 8 | Class features & subclass mechanics per class | `08-class-features.md` | ✅ done | 3 (2 high, 1 med) |
| 9 | Attribute boosts/flaws, apex, variant rules | `09-boosts-variants.md` | ✅ done | 1 (1 low, RAW-ambiguous) |
| 10 | Data: spells (rank/traditions/actions/heightening) | `10-data-spells.md` | ✅ done | 1 (1 med; rank/trad/save all exact) |
| 11 | Data: feats (level/prereqs/traits) | `11-data-feats.md` | ✅ done | 2 (2 high; action/cat/prereq all match) |
| 12 | Data: equipment (price/bulk/stats/runes/hands/traits) | `12-data-equipment.md` | ✅ done | 4 (2 high, 2 med) |
| 13 | Data: ancestries / heritages / backgrounds | `13-data-ancestry.md` | ✅ done | 7 (1 high, 3 med, 3 low) |
| 14 | Data: conditions | `14-data-conditions.md` | ✅ done | 2 (1 med, 1 low) |
| 15 | Runes & attachments (handwraps, ABP interplay) | `15-runes.md` | ✅ done | 2 (2 med) |
| 16 | Companions — animal companion, eidolon, familiar | `16-companions.md` | ✅ done | 3 (1 high, 1 med, 1 low) |

Status legend: ⬜ pending · 🟡 running · ✅ done.

---

## ✅ FIXES APPLIED (2026-07-09) — ~30 of 46 findings fixed; `tsc` clean, **1193 tests pass**

**Fixed & verified** (regression tests in `test/audit-rules-fixes.test.ts` + updated existing tests):
- **Importer pass** (`scripts/import-core.mjs` + `core.json` regenerated): §2.1 land-Speed feats (Fleet — also
  needed an *additive* land-Speed fix in `deriveSpeeds`), §2.2 Resiliency HP (`perArchetypeFeat`), §12.1
  flat-damage die (`?? ''` instead of `|| 'd4'`), §15.1 base Flaming crit-persistent, §10.1 spell-attack
  `defense: 'ac'` (+ SpellsTab display).
- **Data typos** (stale `fixes.json` overrides removed): §11.1 Uplifting Winds 16→12, §11.2 Devoted Focus 12→10,
  §13.1 Gold Falls Regular Acrobatics→Performance.
- **Strikes** (`derive.ts`): §5.1 thrown weapons use Dex to attack (+ test rewritten), §8.1 the 4 missing rage
  instincts, §8.2 Ruffian sneak attack with simple weapons (+ any unarmed).
- **Proficiency** (`advancement.ts`/`build.ts`): §4.1 Monk ki + §4.2 Ranger warden focus prof (expert@9/master@17),
  §6a.1 Fighter Versatile Legend L19 weapons, §6c.1 Cleric favored-weapon doctrine ladder.
- **Conditions** (`conditions.ts`): §14.1 prone → spell attacks; §14.2 attribute-conditions no longer leak onto
  damage AND Stupefied now correctly penalizes **Perception** (Perception is a Wisdom-based roll — Foundry's
  Perception check carries the `wis-based` domain that Stupefied targets; RAW "Wisdom-based rolls and DCs,
  including …" is non-exhaustive). _(I initially mis-called the Perception part a false positive; the user was
  right and it's fixed — the app's original exclusion was wrong.)_
- **Other**: §8.3 kineticist elementless impulses (`featSlots.ts`+`shared.tsx`), §15.2 talisman host-types
  (`attachments.ts`), §1.1/1.2/1.3/3.1 `explain.ts` breakdown reconciliation, §16.1 savage-specialized companion
  (+ UI) & §16.2 eidolon AC (`companions.ts`), §4.3 cantrip auto-heighten (`SpellsTab.tsx`).

**Second fix pass (2026-07-09, verified vs AoN):**
- §6a.2-7 **Gunslinger** cluster ✅ — built the weapon **category × group** model (`proficiencies.firearmProf`
  in build.ts + a strike-resolver branch for firearm/crossbow weapons; removed the over-applying firearm group
  and the wrong generic-category advancement rows). Firearms/crossbows advance by category (simple/martial
  expert→master@5→legendary@13; advanced trained→expert@5→master@13); generic weapons stay trained. Correction:
  the audit itself was slightly off — generic simple/martial DON'T advance for a gunslinger (Foundry's mastery
  features touch only firearms-crossbows). Tests: `test/gunslinger-proficiency.test.ts`.
- §6c.2 **Wizard** Weapon Expertise ✅ — L11 grants expert to the 5 wizard weapons + unarmed via `weaponOverrides`,
  not the whole simple category.
- §12.2/§12.4 **Shields** ✅ (verified on AoN) — Vambrace of Gorum → 20/160/80, Martyr's Shield → 8/64/32 (lesser
  sturdy) via `fixes.json`. §12.3 **Energized Shield (Major)** LEFT AS-IS — its 10/104/52 is correct for a
  major-reinforced steel shield; the audit's 8/64/32 was a wrong assumption.
- §9.1 **Dual-class key boost** ✅ (my call) — "add everything from each class" (GMG) includes the initial
  key-attribute boost, so both classes' key boosts now apply.
- §13.7 fist-die heritages (Warrior Automaton/Jotunborn → 1d6) ✅ · §16.3 Spellslime Ooze Defense AC (10+level) ✅.

**Third fix pass (2026-07-09) — the heritage model extensions ✅ (all built):**
- §13.2 **Spined Azarketi ranged strike** ✅ — threaded a `range` through the natural-attack model
  (GrantedStrike/NaturalAttack/UnarmedProfile + `deriveUnarmedStrike`); the importer now imports ranged
  granted strikes. The spine renders as a ranged 1d4 poison attack (Dex to hit, no ability to damage).
- §13.3/§13.4 **choice-based resistances** ✅ — new `heritage.choiceResistance` (importer detects the
  ChoiceSet + Resistance pattern) + `BuildState/Character.heritageResistanceChoice` + a builder picker (with a
  pending-choice flag) + derive applies the chosen type at half level.
- §13.5 **negative healing** ✅ — `heritage.negativeHealing` flag + `CharacterDefenses.negativeHealing` +
  a "Void healing" row on the Defenses rail card.
- §13.6 **conditional low-light→darkvision** ✅ — `heritage.darkvisionIfAncestryLowLight` flag; `deriveDefenses`
  upgrades to darkvision when the ancestry already grants low-light.
- Tests: `test/heritage-grants.test.ts` (7). **Every audit finding is now fixed or consciously left (Energized
  Shield §12.3 = app correct; §14.2 Perception part = false positive already fixed the correct way).**

---

## ✅ AUDIT COMPLETE — all 16 sections

- **Confirmed findings: 46** · critical **0** · high **17** · medium **18** · low **11**
- Every core calculation the user relies on was checked against the PF2e Remaster rules + the Foundry dataset
  (machine-diffed where data), and each candidate finding was adversarially re-verified before being recorded.

### Executive summary
**The engine is fundamentally sound.** There are **zero critical bugs** and **no wrong "headline" totals** in
the common case: attribute mods, proficiency, AC, all saves, HP, Perception, class DC, skills, spell attack/DC,
the full-caster slot table, strike attack/MAP/damage, and every class's save/perception/class-DC/armor/
spell-proficiency progression all compute **correctly**. Spell data (rank/traditions/saves/actions), feat data
(action cost/category/prereqs), base weapon/armor data, ancestry core data, and the condition system are highly
accurate vs Foundry. Feat prerequisites + archetype dedication gating are correctly enforced (§7 clean).

The 46 findings cluster into a few **repeated root causes**, so a handful of focused fixes clears most of them:

1. **Importer gaps (`scripts/import-core.mjs`) — 5 findings, highest ROI.** One pass fixes them all:
   - §2.1 [HIGH] `FlatModifier land-speed` dropped → **Fleet** & land-Speed feats show the wrong Speed.
   - §12.1 [HIGH] `|| 'd4'` fallback (line 1623) fabricates a d4 for ~43 **flat-damage** weapons (blowgun, bombs).
   - §15.1 [MED] base **Flaming** rune missing its 1d10 crit-persistent.
   - §10.1 [MED] spell **`defense.passive`** dropped → spell-attack spells show no attack.
   - §2.2 [MED] Resiliency-feat HP (`DedicationCount` formula) unparsed.
2. **Weapon-LIST / per-item proficiency (category-only tracks can't express it) — §6 + §8.** 
   - §6c.1 [HIGH] **Cleric favored weapon** never advances past trained (most clerics).
   - §6a.1 [HIGH] **Fighter** Versatile Legend (L19) weapon prof missing; §6c.2 Wizard weapon expertise over-grants.
   - §6a.2-7 the **Gunslinger** firearms/crossbows cluster.
   - Use the existing `weaponOverrides` machinery instead of category tracks.
3. **Focus-caster proficiency advancement — §4.1/4.2 [HIGH].** Monk (ki) & Ranger (warden) focus DC stuck at
   trained; add the expert@9 / master@17 spellcasting rows.
4. **Subclass strike riders — §8 [HIGH×2].** Barbarian's 4 unhandled instincts (bloodrager/decay/elemental/
   ligneous) → flat +2 rage dmg; Rogue **Ruffian** sneak attack doesn't fire with its own simple weapons.
5. **`explain.ts` breakdown reconciliation — §1.1/1.2/1.3/§3.1.** Correct totals, but the itemized breakdown
   omits stance AC / Monster-Parts item bonuses so the parts don't sum. One coordinated fix.
6. **Thrown-weapon attack ability — §5.1 [HIGH].** Thrown weapons use Str (should be Dex) for the attack roll.
7. **Isolated data typos — quick wins.** §11 Uplifting Winds 16→12 & Devoted Focus 12→10; §13 Gold Falls Regular
   trains Acrobatics→Performance; §12.2-4 three magic shields' Hardness/HP/BT.
8. **Condition/heritage/companion edges — §14/§13/§16.** condition penalties leaking onto damage; heritage
   grant-type coverage; savage-companion specialization; eidolon AC proficiency.

### ⚠ Tests that enshrine a bug (must update when fixing)
- `test/weapon-thrown.test.ts` asserts thrown weapons use **Str** to attack (§5.1 — wrong).
- `test/audit-batch2.test.ts:14-22` asserts only Greater Flaming has crit-persistent (§15.1 — wrong).
- `test/rage-damage.test.ts` covers only 3 instincts (extend for §8.1).

### Suggested fix order
Importer pass (theme 1) → focus-caster rows (§4) → thrown-attack (§5.1) → barbarian/ruffian riders (§8) →
cleric/fighter/gunslinger weapon prof (§6) → data typos (§11/§12/§13) → breakdown reconciliation (theme 5) →
condition/heritage/companion edges. **Note: all fixes are WEB-ONLY until an installed release is cut.**

---

## Per-section running tally (historical)

- Sections done: **16 / 16 ✅**
- **§13:** ancestry size/senses/languages + background boosts all correct; one background skill typo (Gold Falls
  Regular → Performance, high) + a heritage-grant-coverage cluster (choice resistances, ranged strike, negative
  healing, conditional darkvision, fist-die upgrade).
- **§12 highlights:** importer `|| 'd4'` fallback (import-core.mjs:1623) fabricates a d4 die for ~43 flat-damage
  weapons (blowgun, dart umbrella, 41 bombs) [high] — the **5th importer-related finding**; 3 magic shields with
  wrong Hardness/HP/BT. Base weapons/armor/prices otherwise match Foundry.
- **IMPORTER PASS is now clearly warranted** — importer gaps/bugs account for findings §2.1, §2.2, §10.1, §12.1
  (land-speed, Resiliency HP, spell passive-defense, flat-damage die).
- **§8 highlights:** Barbarian 4 instincts (bloodrager/decay/elemental/ligneous) fall to flat +2 rage dmg
  [high]; Rogue **Ruffian** sneak attack doesn't fire with its own simple weapons [high]; 5 elementless
  kineticist impulse feats hidden from the picker [med].
- _Note: §7 workflow hit a session limit after 3/8 finders; its 5 prereq/gating logic checks were done inline (clean)._
- **§6 complete — all 27 classes swept, 9 findings.** Theme: **weapon-proficiency modeling**. The app tracks
  weapons by broad category (simple/martial/advanced) + a few groups, so weapon-LIST grants (Fighter Versatile
  Legend, Wizard Weapon Expertise) and per-item grants (**Cleric favored weapon** [high, most clerics], Gunslinger
  firearms/crossbows [6 findings]) are mis-modeled. Saves / perception / class DC / armor / spellcasting-prof
  progressions are correct across ALL classes (except Monk/Ranger focus-prof, §4).
- **Cross-cutting fix opportunity:** several §6 findings need per-weapon/weapon-list proficiency instead of
  category-only tracks — the `weaponOverrides` machinery exists (build.ts) and should be leveraged.
- **⚠ §6 must-check:** focus-spell proficiency advancement is missing for Monk (ki) & Ranger (warden) — §4.1/4.2.
  §6 (per-class advancement) must verify EVERY focus-granting class (esp. **Champion** devotion spells) for the
  expert@9 / master@17 spellcasting-proficiency rows.
- **Notable HIGH:** §5.1 thrown weapons use Str (not Dex) for the attack roll — and a test encodes the wrong
  rule (`test/weapon-thrown.test.ts`), so the fix must update that test too.
- **Cross-cutting themes:**
  - **explain.ts breakdown reconciliation** (§1.1 stance AC, §1.2 stance-cap note, §1.3 + §3.1 Monster-Parts
    item bonus): several `explain` cases omit a component that `derive` folds into the total, so the itemized
    breakdown doesn't sum to the (correct) displayed total. One coordinated fix pass could close all of these.
  - **importer unhandled rule-elements** (§2.1 land-speed, §2.2 Resiliency HP): `scripts/import-core.mjs`
    silently drops some Foundry formulas → data missing from `core.json`. Warrants its own pass.
- **Highlights:** §2.1 [HIGH] Fleet & other land-Speed feats show the wrong Speed. All CORE totals (AC, saves,
  HP, Perception, class DC, skills, Speed base) compute correctly; most findings are display/breakdown or
  data-import gaps, not wrong roll math.
