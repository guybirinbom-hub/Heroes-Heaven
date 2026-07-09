# §16 — Companions (animal companion, eidolon, familiar)

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 3** (0 crit · 1 high · 1 medium · 1 low)
_(4 raw confirmations dedupe to 3 — the eidolon-AC issue was flagged twice.)_

**Verified CORRECT:** animal companion base stats (size/Speed/AC formula/HP scaling with master level/unarmed
attacks/ability mods); mature & nimble maturity upgrades; familiar HP (5×master level), ability count, and
specific-familiar abilities; eidolon HP, attacks (own ability mods), and act-together economy; and companion
attack/save/Perception proficiency scaling with master level. Only the three edges below are wrong.

---

## 16.1 — [HIGH] Animal companion: the **Savage → Specialized** path uses the wrong (nimble) values

- **Where:** `src/rules/companions.ts:92-95` (single `specialized` maturity row) + config shape
  `types.ts:900-903` + UI `CompanionsTab.tsx:863-868` (no nimble-vs-savage sub-path).
- **Defect:** `maturities.specialized` hardcodes one row — `{str:2, dex:4, con:2, wis:2, int:2}`, flatDamage 4 —
  which is the **nimble→specialized** spread. A **savage→specialized** companion (a fully legal path: Incredible
  Companion grants nimble **or** savage; Specialized Companion upgrades "your nimble **and** savage companions")
  should be `{str:3, dex:3, con:2, wis:2, int:2}`, flatDamage **6**. There's no way to represent the savage path.
- **Correct rule (Foundry-confirmed):** Savage (on mature) = Str +2, Dex/Con/Wis +1, +3 unarmed damage;
  Specialized raises additional unarmed damage 3→6. Cumulative savage→specialized = Str +3, Dex +3, flat +6.
- **Failing example:** L20 Savage→Specialized Bear, Jaws (1d8) → app shows attack Str **+5** and **3d8+9**;
  correct is Str **+6** and **3d8+12** (and AC/Reflex are +1 too high because Dex is modeled +1 over).
- **Fix:** split the specialized row by prior path (nimble vs savage) — add a `maturity` sub-path (or a
  `specializedFrom: 'nimble'|'savage'` config field + UI) and the savage-path boosts/flat damage.

## 16.2 — [MEDIUM] Eidolon AC uses the **summoner's** unarmored-defense proficiency, not the eidolon's own

- **Where:** `src/rules/companions.ts:464-470` (`deriveEidolon` → `eidolonAc` uses
  `character.proficiencies.defenses.unarmored`).
- **Defect:** the eidolon has its **own** unarmored-defense progression — trained L1, **expert L11** (Eidolon
  Defensive Expertise), **master L19** (Eidolon Defensive Mastery) — but the app uses the summoner's unarmored
  rank (trained until L13 via Defensive Robes, never master). Since the summoner's rank ≤ the eidolon's, the
  eidolon's AC is **understated by 2 at L11-12 and L19-20**.
- **Failing example:** L11 summoner, eidolon Dex +3 → correct AC = 10 + 3 + (expert 4 + 11) = **28**; app
  computes with trained → **26**.
- **Fix:** derive the eidolon's AC from the **eidolon's own** unarmored-defense rank (trained→expert@11→master@19),
  not the summoner's.

## 16.3 — [LOW] Spellslime familiar: Ooze Defense AC override not applied

- **Where:** `src/rules/companions.ts:374` (`deriveFamiliar` sets AC = master's AC, no Spellslime override).
- **Defect:** the Spellslime specific familiar's "Ooze Defense" sets a fixed AC (per its stat block) rather than
  the master's AC; the app always uses the master's AC (the override is prose-only).
- **Failing example:** a Spellslime familiar shows the master's AC instead of its Ooze Defense AC.
- **Fix:** apply the Spellslime AC override in `deriveFamiliar` (a small specific-familiar special case).
