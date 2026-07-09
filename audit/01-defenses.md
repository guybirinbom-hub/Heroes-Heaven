# §1 — Defenses: attributes, proficiency, AC, saves, Perception, class DC

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 4** (0 critical · 0 high · 1 medium · 3 low)

**Verified CORRECT (no defect):** attribute modifier `floor((score−10)/2)`; proficiency bonus (untrained
+0 with no level; trained/expert/master/legendary = level+2/4/6/8; PWoL variant); AC total (base + prof +
capped Dex + item + potency); all three saves (Fort=Con, Ref=Dex, Will=Wis, + resilient/ABP); Perception
total (Wis + prof + item); class DC (10 + level + prof + key attr); Dex-cap application incl. unarmored;
ABP defense/resilient thresholds; shield base AC bonus + raised gating. The finders returned **no** defect
for any of these core totals — only the breakdown/display and one niche interaction below.

---

## 1.1 — [MEDIUM] AC breakdown omits the active stance's AC bonus (parts ≠ total)

- **Where:** `src/rules/explain.ts:352-366` (the `'ac'` case) vs `src/rules/derive.ts:343-344`.
- **Defect:** `deriveAc` folds `stanceAc = stance?.acBonus?.value ?? 0` into the AC total, but the `explain`
  `'ac'` breakdown never pushes a line item for it (explain.ts has zero `stance`/`activeStance` references;
  the `modeAdjust` path only covers `activeModes`, a separate subsystem from `activeStance`).
- **Correct rule:** the itemized AC breakdown must enumerate every component so the line items reconcile
  with the displayed total. 9 of 99 stances grant an AC bonus (Mountain Stance +4 item, etc.).
- **Failing example:** L1 monk, Dex 18, unarmored, trained unarmored defense, **Mountain Stance** (acBonus +4,
  dexCap 0). Total AC = 10+0+3+0+4 = **17** (shown correctly), but the breakdown lists Base 10 + Dex 0 +
  Prof 3 = **13** — a 4-point unreconciled gap in the AC popup.
- **Fix:** in the `explain` `'ac'` case, resolve the active stance (as `deriveAc` does) and push a
  `{ label: '<Stance name>', value: stanceAc }` part when `stanceAc > 0`.
- **Note:** the AC *total* is correct; this is a breakdown-reconciliation defect only.

## 1.2 — [LOW] AC Dex-cap note hardcodes "by armor" even when the cap comes from a stance

- **Where:** `src/rules/explain.ts:354`.
- **Defect:** the Dexterity-modifier note reads `capped at +N by armor` whenever a cap is in effect, but the
  cap may originate from the active stance (`effDexCap` folds in `stance.dexCap`, derive.ts:337-339) with no
  armor worn.
- **Failing example:** L1 monk, Dex 18, no armor, Mountain Stance (dexCap 0) → note shows
  "Dexterity modifier — capped at +0 by armor" though no armor is worn and the stance imposes the cap.
- **Fix:** branch the note text on whether the cap source is armor vs stance (or say "capped at +N" and name
  the source), and only say "by armor" when `armor` is non-null.

## 1.3 — [LOW] Perception (and Skill) breakdown omits the Monster-Parts refined item bonus (parts ≠ total)

- **Where:** `src/rules/explain.ts:324-327` (`'perception'`) and the same omission at `explain.ts:251-254`
  (`'skill'`); total is computed correctly at `derive.ts:190-201`.
- **Defect:** `derivePerception` adds `Math.max(abpPerception, mpSenseSkillItemBonus(c,'perception'))` to the
  total, but the breakdown only pushes the ABP potency line — never the Monster-Parts item bonus. So with the
  Monster-Parts variant on and ABP off, the listed parts under-sum by the item bonus.
- **Failing example:** `variantRules.monsterParts` on, ABP off, L3+, an invested Monster-Parts perception
  item refined to +1. Perception total shows +9; breakdown lists only Prof + Wis = +8 — one short, and the
  item bonus is invisible.
- **Fix:** in both `'perception'` and `'skill'` cases, push the `mpSenseSkillItemBonus` value as an item-bonus
  part (matching the `Math.max` the derive uses, so ABP and Monster-Parts don't double-count in the display).
- **Note:** roll total is correct; breakdown-reconciliation defect, gated behind an uncommon config.

## 1.4 — [LOW] Tower Shield + Take Cover should give +4 to AC; app caps the combined bonus at +2

- **Where:** `src/rules/derive.ts:350` (`shieldSwappedModes`) + `src/rules/modes.ts:94-95`
  (`cat-raise-shield` / `cat-take-cover`), combined via `modeNumberBonus` (modes.ts:48-63).
- **Defect:** a raised Tower Shield's +2 circumstance AC bonus should **increase to +4 while using Take Cover**
  (per `.import-src/pf2e/packs/pf2e/equipment/tower-shield.json`: "AC increases to +4 if you are using the
  Take Cover action"). Both the raised-shield mode (+2) and Take Cover (+2) are circumstance, so
  `modeNumberBonus` takes `max(2,2)=+2`; no tower-shield-specific upgrade to +4 exists.
- **Failing example:** L1 fighter with a raised Tower Shield + Take Cover active → correct AC bonus +4, app
  shows +2 (e.g. AC 18 instead of 20). Under-reports (conservative), niche item + combat state → low severity.
- **Fix:** when the held shield is a tower shield and Take Cover is active, raise the combined circumstance
  AC bonus to +4 (special-case in `shieldSwappedModes`/`modeNumberBonus`).
