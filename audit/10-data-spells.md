# §10 — Spell data (rank, traditions, save/defense, action cost, cantrip/focus) vs Foundry

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 1** (0 critical · 0 high · 1 medium · 0 low)

**Verified CORRECT via full programmatic diff (1645 spells present in both):** spell **rank** (0 mismatches,
cantrip rank-0 convention handled), **traditions** (0 mismatches), **save statistic + basic flag** (0
mismatches), **cast action cost** (matches), **cantrip/focus flags** (matches). The spell data is accurate
except the one importer gap below.

---

## 10.1 — [MEDIUM] Importer drops spell-attack / passive defenses (`system.defense.passive`)

- **Where:** `scripts/import-core.mjs:1520` (`save: s.defense?.save ? … : undefined` — reads only
  `defense.save`, never `defense.passive`). Output: `public/core.json` spells; the app schema has **no**
  attack/`requiresAttack` field at all (0 of 1811 spells carry one).
- **Defect:** spells whose defense is a **spell attack roll** (`passive.statistic==='ac'`) or a **passive check
  vs a target DC** (`passive.statistic==='fortitude-dc'`) get no attack indicator. **~11 spells** present in
  both datasets are affected:
  - **9 render fully blank** (no save, no attack): Spirit Object, Vindicator's Mark, Banishing Touch, Bonewall
    Bulwark, Boomerang Shot, Diadem of Divine Radiance, Murderous Vine, Black Tentacles, Ravenous Darkness.
  - **2 keep the save but drop the attack**: **Deity's Strike** (spell attack vs AC + basic Reflex) and
    **Ray of Corruption** (spell attack vs AC + basic Fortitude) show only the save, hiding the to-hit step.
- **Correct rule:** `defense {passive:{statistic:'ac'}}` = requires a **spell attack roll vs AC**;
  `{passive:{statistic:'fortitude-dc'}}` = a passive check vs the target's Fortitude DC; when both a passive AC
  attack **and** a save exist, both apply (attack to hit, then the save).
- **Failing example:** casting **Ray of Corruption**, the app shows only "basic Fortitude save" — a player would
  roll it as an auto-hit AoE, but RAW they must first succeed at a spell attack vs AC. Black Tentacles shows a
  blank defense though it's a check vs the target's Fortitude DC.
- **Fix:** in `import-core.mjs`, also read `s.defense?.passive` and emit an attack indicator
  (`attack:'ac'` / a passive-DC marker); surface it on the spell detail + Spells tab (the caster header already
  computes a spell-attack modifier). Since the app is web-only, this is an importer change + `core.json`
  regenerate — the **fourth** importer-gap finding (see §2.1, §2.2), reinforcing a dedicated importer pass.

---

### Informational (not a defect)
The app assigns a **tradition** to 3 focus spells that Foundry leaves blank (Foundry derives a focus spell's
tradition from the granting class/archetype). This is reasonable enrichment, not an error — noted only for
completeness.
