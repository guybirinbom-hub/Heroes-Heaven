# §5 — Strikes: attack, MAP, damage, striking, weapon spec, crit spec, handwraps, potency

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 2** (0 critical · 1 high · 0 medium · 1 low)

**Verified CORRECT (no defect):** melee/finesse/ranged attack ability selection (melee=Str, finesse=better of
Str/Dex, projectile=Dex); MAP (−5/−10, agile −4/−8); damage ability (melee=Str, thrown adds full Str to
**damage**, propulsive=half Str, plain ranged=0, finesse doesn't add Dex to damage, thief racket swaps to
Dex); striking dice (+1/+2/+3); **weapon specialization** (+2/+3/+4 by rank, greater doubles, correct class
gating); **Handwraps of Mighty Blows** (potency/striking/property to unarmed only); potency/ABP attack
thresholds (no double-count); and 15 of 16 crit-spec group effects. Only the two below are wrong.

---

## 5.1 — [HIGH] Thrown weapons use Strength for the **attack roll** (should be Dexterity)

- **Where:** `src/rules/derive.ts:804-813`; breakdown mislabels via `src/rules/explain.ts:549`.
  **A regression test asserts the wrong rule:** `test/weapon-thrown.test.ts:20-22`.
- **Defect:** `usesDex = projectile || (finesse && dexMod > strMod)` with `projectile = ranged && !thrown`.
  A non-finesse thrown weapon has `projectile=false` → `atkAbility='str'`. The author's comment even states
  (incorrectly) "THROWN weapons still use Strength like a melee weapon."
- **Correct rule:** a thrown weapon makes a **ranged attack** → the attack roll uses **Dexterity**. Thrown is
  the exception only for **damage** (adds full Strength). So: **Dex to attack, Str to damage.** (Confirmed vs
  AoN Thrown trait + Weapons rules; Foundry treats a pure thrown weapon's attack as Dex-based.)
- **Affected:** pure thrown ranged weapons — **javelin, chakram, shuriken, dart, bola**, etc. (weapons with a
  range increment + thrown trait, no melee). Daggers are finesse so already use Dex. (Melee weapons with a
  `thrown-N` trait — trident, light hammer, spear — are treated as melee-only; the app has no "throw this melee
  weapon" mode, a separate limitation, not this bug.)
- **Failing example:** L1 fighter, Str 10 (+0), Dex 18 (+4), javelin → app attack uses Str (+0), breakdown says
  "Strength modifier +0"; correct is Dex (+4). Understates the attack by 4 (scales with the Dex−Str gap).
- **Why HIGH:** silently-wrong primary attack bonus for a whole common weapon category, for any Dex-based
  thrower, and it's enshrined by a passing test.
- **Fix:** set `usesDex = projectile || thrown || (finesse && dexMod > strMod)` (i.e. Dex to attack for any
  ranged strike incl. thrown) while keeping the existing full-Str-to-**damage** logic (`usesStrDamage`
  unchanged). **Update `test/weapon-thrown.test.ts:20-22`** to assert Dex-to-attack / Str-to-damage.

## 5.2 — [LOW] Bow crit-spec effect uses pre-Remaster wording (Escape vs DC 10 Athletics)

- **Where:** `src/rules/critSpec.ts:16` (bow group).
- **Defect:** the bow critical-specialization text says the immobilized target frees itself "until it Escapes
  (or the ammunition is pulled free with an Interact action)" — 1st-printing CRB wording.
- **Correct rule (Remaster):** the target is Immobilized and "must spend an Interact action to attempt a **DC 10
  Athletics check** to pull the missile free; it can't move until it succeeds" — no Escape option. (Confirmed
  in-repo via `equipment/enfilading-arrow.json` + `grievous.json` bow upgrade "the Athletics check … is DC 20".)
- **Failing example:** L5 fighter with a shortbow + crit spec → app shows "immobilized until it Escapes"; should
  be the DC 10 Athletics Interact. Display-only text (no calc), other 15 groups correct → low.
- **Fix:** update the bow group's crit-spec effect string to the Remaster DC 10 Athletics wording.
