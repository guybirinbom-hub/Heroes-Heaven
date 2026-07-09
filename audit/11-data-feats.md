# §11 — Feat data (level, action cost, traits/category, prerequisites) vs Foundry

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 2** (0 critical · 2 high · 0 medium · 0 low)
_(The workflow surfaced 6 confirmations that dedupe to the 2 distinct feat-level errors below — each was flagged
by multiple finders/verifiers.)_

**Verified CORRECT via programmatic diff:** feat **action cost** (passive/1-3/reaction/free), **category &
gating traits** (class/ancestry/skill/general/archetype + class/ancestry trait), and **prerequisites** all
match Foundry across the shared feat set. Out of thousands of feats, only **two** have a wrong level.

---

## 11.1 — [HIGH] Uplifting Winds — level 16, should be 12

- **Where:** `public/core.json → feats['uplifting-winds'].level = 16` (correct: **12**).
- **Defect:** the druid (Storm Order) class feat is gated 4 levels too late. Foundry ground truth:
  `feats/class/druid/level-12/uplifting-winds.json` → `system.level.value = 12` (remaster; the file even lives
  under `level-12/`). All other fields (traits `[druid]`, prereq "storm order", category class) match.
- **Failing example:** a level-12 storm-order druid can't select Uplifting Winds in their L12/L14 class feat
  slots — unavailable until L16.
- **Fix:** set `feats['uplifting-winds'].level = 12` (data fix; check the importer/source so a re-import keeps it).

## 11.2 — [HIGH] Devoted Focus — level 12, should be 10

- **Where:** `public/core.json → feats['devoted-focus'].level = 12` (correct: **10**).
- **Defect:** the champion class feat (devotion spells) is gated 2 levels too late. Foundry:
  `feats/class/champion/level-10/devoted-focus.json` → `system.level.value = 10` (remaster, Player Core 2).
  Other fields (traits `[champion]`, prereq "devotion spells", passive) match.
- **Failing example:** a level-10 champion with devotion spells can't select Devoted Focus in their L10/L11
  class feat slots — unavailable until L12. (Devoted Focus increases the focus pool — a real capability delay.)
- **Fix:** set `feats['devoted-focus'].level = 10`.

> Both are isolated single-field level errors (likely importer/source typos), not systematic — the rest of the
> feat data is accurate.
