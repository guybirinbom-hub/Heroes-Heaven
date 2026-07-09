# §9 — Attribute boosts/flaws, apex, variant rules

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 1** (0 critical · 0 high · 0 medium · 1 low, RAW-ambiguous)

**Verified CORRECT (no defect):** the **partial-boost** rule (a boost to an 18+ attribute gives +1, else +2);
**level-1** boost composition (ancestry + background + class-key + 4 free, no-repeat-within-a-set, flaws
applied, a single attribute can reach 18); **mid-level** boosts (4 at each of 5/10/15/20, no-repeat, +1 over
18); **ancestry/heritage boost & flaw data** (matches Foundry for the sampled ancestries); **apex items** (set
to 18, or +2 if already 18+, one at a time); **ABP attribute apex** (L17, 18/+2); the **Gradual Ability
Boosts** variant distribution; and — critically — the **Dual Class** proficiency/HP/save merges (every prof
track via `maxRank`, HP-per-level via `Math.max`, both classes' advancement applied). Only the one item below
deviates, and it's rules-ambiguous.

---

## 9.1 — [LOW, RAW-ambiguous] Dual Class applies only the first class's key-attribute boost

- **Where:** `src/rules/build.ts:522-526` (`collectBoosts` pushes one class key boost, never references
  `classId2`/`cls2`; there is no `keyAbility2` field). Stored `Character.keyAbility` (`build.ts:1034`) is always
  the primary's, so class DC keys off class 1 too (`derive.ts:221-229`).
- **Defect:** a dual-class character gets only the **first** class's initial key-attribute boost at level 1; the
  second class's key boost is dropped.
- **Correct rule (literal RAW):** the GMG "add everything from each class except Hit Points and starting skills"
  reading includes the initial ability boost, so both classes' key boosts should apply (to different scores).
  **However** this is genuinely **RAW-ambiguous** — the GMG enumeration doesn't explicitly list the key-ability
  boost and there is **no official Paizo ruling** (the community thread reached no consensus; some GMs grant
  only one). Rated **low** for that reason.
- **Failing example:** L1 Fighter(Str)/Wizard dual-class → app **Str 12, Int 10**; a literal-RAW reading would
  give **Str 12 AND Int 12** (solo fighter = Str 12, solo wizard = Int 12).
- **Fix (if desired):** if you adopt the literal reading, push `subclassKeyAbility`/`cls2.keyAbility` for the
  second class in `collectBoosts` (and consider whether class DC should use the primary or a chosen key).
  Otherwise document the app's choice. Because it's ambiguous, this may be **intentional** — flag for a decision
  rather than an automatic fix.
