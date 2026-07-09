# §3 — Skills: modifier, ability map, armor check penalty, lore, DCs, Assurance

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 1** (0 critical · 0 high · 1 medium · 0 low)
_(shares a root cause with §1.3 — one fix resolves both)_

**Verified CORRECT (no defect):** skill modifier formula (level + prof + ability + item − armor check
penalty); **all 16 skill→ability mappings + Lore=Int** (Acrobatics/Stealth/Thievery=Dex, Athletics=Str,
Arcana/Crafting/Occultism/Society=Int, Deception/Diplomacy/Intimidation/Performance=Cha, Medicine/Nature/
Religion/Survival=Wis); armor check penalty (applied only to Str/Dex skills, removed when Str requirement
met); lore skills (Int, independent proficiency); the level-based DC table + simple DCs (10/15/20/30/40);
Assurance; and skill-action proficiency gating / DCs (`skillActions.ts`) — all correct.

---

## 3.1 — [MEDIUM] Skill breakdown omits the Monster-Parts refined skill item bonus (parts ≠ total)

- **Where:** `src/rules/explain.ts:253-254` (skill breakdown) vs `src/rules/derive.ts:203-219` (`deriveSkill`
  total). Rendered as parts-vs-Total in `src/sheet/StatDetailModal.tsx:81-91`.
- **Defect:** `deriveSkill` adds `Math.max(abpSkillBonus, mpSenseSkillItemBonus(c,'skill',key))` to the total
  (the Monster-Parts item bonus applies whenever the variant is on, independent of ABP). But the `explain`
  skill case only pushes an item-bonus part when **ABP** is on (`abpOn(c) ? abpSkillBonus : 0`) and never
  references `mpSenseSkillItemBonus`. So with the Monster-Parts variant on and ABP off, the listed parts
  under-sum by the item bonus.
- **Correct rule:** the Monster-Parts refined item bonus (Table 4E: +1/+2/+3 at levels 3/9/17) is a real item
  bonus and must appear as a breakdown line so the parts sum to the Total.
- **Failing example:** L10, Monster-Parts on, ABP off, Int 18, Trained Arcana, invested MP skill item refined
  to level ≥9 (+2). `deriveSkill('arcana')` = +4 + 12 + 2 = **+18**; breakdown lists Prof +12 + Int +4 = **+16**
  with Total +18 — the +2 item row is missing.
- **Fix:** in the `explain` skill case, push the `mpSenseSkillItemBonus` value (using the same `Math.max` vs
  ABP as `deriveSkill`, so they don't double-count).

> **Same root as [§1.3](01-defenses.md)** (which flagged the identical omission in the Perception breakdown,
> `explain.ts:324-327`). A single fix — have the `explain` `'perception'` **and** `'skill'` cases push the
> Monster-Parts item bonus (mirroring `deriveSkill`/`derivePerception`) — resolves §1.3 **and** §3.1.
