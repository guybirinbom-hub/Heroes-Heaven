# §14 — Condition effects & values vs Foundry

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 2** (0 crit · 0 high · 1 medium · 1 low)
_(4 raw confirmations dedupe to 2 — three are facets of the same `effectMatches` coarseness.)_

**Verified CORRECT:** off-guard −2 AC; frightened/sickened −N to all checks & DCs; enfeebled −N to Str-based
(incl. Str damage); clumsy −N to Dex-based rolls; drained −N + HP reduction (N×level); stupefied −N to mental
checks & spell attack/DC; slowed/quickened action changes; condition list completeness + valued/boolean flags;
and the Kingmaker army-condition filter from the PC picker. Only the two interaction edges below are wrong.

---

## 14.1 — [LOW] Prone's −2 attack penalty isn't applied to spell attack rolls

- **Where:** `src/rules/conditions.ts:56` — prone effect `slots: ['attack','ac']` omits `'spell-attack'`;
  manifests at `src/rules/derive.ts:240` (`conditionPenalty(..., 'spell-attack')`).
- **Defect:** Prone gives −2 circumstance to **attack rolls**, and a **spell attack roll is an attack roll**
  (Foundry prone.json uses the union selector `attack-roll`, which covers spell attacks). Weapon strikes
  correctly get the −2 (slot `'attack'`); spell attacks don't.
- **Failing example:** a prone caster casts Ray of Frost / Telekinetic Projectile → app spell-attack modifier
  unchanged; should be −2.
- **Fix:** add `'spell-attack'` to the prone effect's `slots`.

## 14.2 — [MEDIUM] Condition→stat matching is too coarse (attribute-keyed penalties leak onto damage; Stupefied blocked from Perception)

- **Where:** `src/rules/conditions.ts:45-69` (`effectMatches` — the ability-match branch at :66 + the blanket
  `slot !== 'perception'` guard at :64-66); realized at `derive.ts:865` (Thief Dex-damage) and the Perception path.
- **Defect:** attribute-keyed conditions are matched to a slot **by governing ability alone**, ignoring which
  **selectors** each condition actually covers. Consequences:
  - **Clumsy / Drained / Stupefied wrongly reduce DAMAGE** when the damage's governing ability matches — but per
    Foundry only **Enfeebled** lists a damage selector (`str-damage`); Clumsy is `dex-based` (rolls/DCs, **not**
    the Dex damage mod), Drained is `con-based`, Stupefied is mental checks. Concretely: a **Thief rogue** using
    Dex-to-damage with **Clumsy 2** shows Dex **+3** to damage instead of **+5** (the attack roll correctly
    takes −2, but damage should not).
  - **Stupefied doesn't reach Perception**: the blanket `slot !== 'perception'` guard (added to keep Clumsy/
    Enfeebled off Perception) also blocks **Stupefied**, which *is* a Wisdom-based-check penalty and should
    apply to Perception (Seek/Sense Motive). ✅ FIXED — Perception is a Wisdom-based roll (Foundry's Perception
    check carries the `wis-based` domain, like Stealth carries `dex-based`; AoN's "Wisdom-based rolls and DCs,
    including …" is non-exhaustive), so Stupefied now penalizes it. Only wis-keyed conditions reach Perception
    since `derivePerception` passes `'wis'`.
- **Correct rule:** model each condition's actual selector set (Clumsy=dex-based rolls/DCs; Enfeebled=str-based
  **+ str-damage**; Drained=con-based/Fort **+ HP**; Stupefied=Int/Wis/Cha checks & DCs **incl. Perception** +
  spell attack/DC + a flat check to Cast a Spell). Damage is only penalized by Enfeebled (Str) — never by
  Clumsy/Drained/Stupefied.
- **Fix:** give each condition an explicit slot/selector list (rather than deriving from ability + a perception
  guard): only Enfeebled includes `damage`; Stupefied includes `perception`; Clumsy excludes `damage`. Add
  tests: Thief + Clumsy (damage unchanged); Stupefied + Perception (−N).
