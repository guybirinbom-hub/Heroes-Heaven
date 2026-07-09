# §4 — Spellcasting: attack/DC, slots, cantrips, signatures, repertoire, focus, heightening, font

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 3** (0 critical · 2 high · 1 medium · 0 low)

**Verified CORRECT (no defect):** spell attack roll & spell DC (level + prof + ability + item; DC = attack+10);
spellcasting **key ability per class** (Int/Wis/Cha as appropriate); the **full-caster slot table**
(`casterSlots` — 3×ranks 1-9 by L18, single 10th-rank slot at 19/20); **cantrips known** (5 base + extras);
**signature spells** (one per rank, free-heighten); **spontaneous repertoire** size per rank; **focus pool**
(cap 3, grows per source, Refocus restores 1); and **divine font** (1 + Cha extra heal/harm slots) + wizard
spellbook budget. Only the focus-proficiency advancement and cantrip auto-heighten rank are wrong.

---

## 4.1 — [HIGH] Monk ki-spell focus proficiency never advances (stuck at Trained all 20 levels)

- **Where:** `src/rules/advancement.ts:462` (monk `CLASS_ADVANCEMENT` table has **no** `{track:'spellcasting'}`
  row); focus entry created at `build.ts:1521-1531` (proficiency `'trained'`); advanced only via
  `applyAdvancement` (`build.ts:620-621`); read by `deriveSpellcasting` (`derive.ts:238-243`).
- **Defect:** the only code that raises a focus entry's proficiency is a `{track:'spellcasting'}` advancement
  row. The monk table has none, so a monk with ki spells keeps a **Trained** spell attack/DC forever.
- **Correct rule (Foundry-confirmed):** **Monk Expertise (L9)** → ki-spell proficiency to **expert**;
  **Graceful Legend (L17)** → **master** (`class-features/monk-expertise.json` upgrades
  `system.proficiencies.spellcasting.rank` to 2 under predicate `feat:qi-spells`; `graceful-legend.json` → 3).
- **Failing example:** L17 monk, Wis 20 (+5), Ki Cutting Sight → app focus DC **34** (trained), correct **38**
  (master); attack +24 vs +28. L9–16 it's 2 too low (expert vs trained).
- **Fix:** add `{track:'spellcasting', rank:'expert', level:9}` and `{...'master', level:17}` rows to the monk
  advancement table (gated on the monk actually having ki spells, as `applyAdvancement` already applies to the
  focus entry when present).

## 4.2 — [HIGH] Ranger warden-spell focus proficiency never advances (stuck at Trained)

- **Where:** `src/rules/advancement.ts:145` (ranger table has no `{track:'spellcasting'}` row); same
  create/advance/derive path as §4.1.
- **Defect:** identical root — a ranger with warden spells keeps a Trained spell attack/DC forever.
- **Correct rule (Foundry-confirmed):** **Ranger Expertise (L9)** → **expert**; **Masterful Hunter (L17)** →
  **master** (`ranger-expertise.json` / `masterful-hunter.json` upgrade `spellcasting.rank` to 2 / 3 under
  predicate `feat:initiate-warden`).
- **Failing example:** L9 ranger, Wis 18 (+4), Ranger's Bramble → app focus DC **23** (trained), correct **25**
  (expert). L17–20 it's 4 too low (master vs trained).
- **Fix:** add the expert@9 / master@17 spellcasting rows to the ranger advancement table.

> **Shared root — likely broader.** §4.1 + §4.2 are the same defect: a class that gains **focus spells** but
> whose advancement table omits the spellcasting-proficiency rows. **§6 (per-class proficiency advancement)
> must explicitly check EVERY class that can gain focus spells** for the expert/master upgrade — notably
> **Champion** (devotion/focus spells + Champion Expertise/Legend), and any other class whose focus proficiency
> should scale. One fix pattern (add the spellcasting rows, gated on having focus spells) covers all of them.

## 4.3 — [MEDIUM] Cantrip auto-heighten rank is wrong for archetype / multiclass casters

- **Where:** `src/sheet/SpellsTab.tsx:587-593` (detail-view `maxRank`), `:657` & `:676` (cantrip rank header),
  consumed at `:90/:95`.
- **Defect:** the cantrip auto-heighten rank is derived from the **highest leveled slot rank of the casting
  pool** (`Math.max(...leveledRanks)`), not from **character level**. For a full caster the pool's max slot
  rank equals `ceil(level/2)`, so it looks correct — but a spellcasting **archetype/multiclass** caster's slot
  ranks lag character level (Basic/Expert/Master Spellcasting unlock ranks slowly), so their cantrips
  **under-heighten**. At the dedication-only stage (no leveled slots yet) `maxRank=0`, so cantrips render
  completely **un-heightened**.
- **Correct rule:** cantrips are automatically heightened to the highest spell rank you can cast for your
  **level** = `ceil(characterLevel/2)` (a level-8 caster heightens cantrips to 4th regardless of archetype
  slot progression).
- **Failing example:** Fighter + Wizard Dedication + Basic Wizard Spellcasting, L8 → app heightens cantrips to
  **3rd** (pool max slot), correct **4th** (`ceil(8/2)`). At L3 (dedication only) app shows cantrips at rank 0.
- **Fix:** compute the cantrip heighten rank from `ceil(character.level/2)` (clamped to the max castable rank),
  not from the pool's max leveled slot rank. Verify against a full caster (unchanged) and an archetype caster.
