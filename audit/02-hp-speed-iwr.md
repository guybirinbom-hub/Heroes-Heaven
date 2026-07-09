# §2 — HP, Speed, resistances/weaknesses/immunities, dying subsystem

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 2** (0 critical · 1 high · 1 medium · 0 low)

**Verified CORRECT (no defect):** max-HP formula (ancestry flat + (class HP + Con)×level); negative-Con
per-level reduction; Toughness (+level) and per-level HP feats; **base** ancestry Speeds; armor Speed penalty
+ Strength-requirement reduction; IWR aggregation (same-type resistances take the max, not summed); temp-HP
non-stacking + damage ordering; the **dying/wounded/doomed** subsystem (death at 4 − doomed, wounded adds to
new dying, recovering adds wounded); and class/ancestry HP **data** values (all match Foundry).

Both findings share a root cause: the content importer (`scripts/import-core.mjs`) doesn't parse two Foundry
rule-element shapes, so the data never reaches `core.json` and the (correct) derive code has nothing to add.

---

## 2.1 — [HIGH] Land-Speed feats/heritages (Fleet, Nimble Elf, …) are silently dropped

- **Where:** root cause `scripts/import-core.mjs:817-827` (`parseDefenses`); consumed at
  `src/rules/derive.ts:1169-1174` (`deriveSpeeds`) and `src/rules/explain.ts:510-516` (breakdown).
- **Defect:** feats that raise land Speed express it in Foundry as a `FlatModifier` with
  `selector: "land-speed"` (Fleet `+5`, Nimble Elf `+5`, etc.). The importer only reads `BaseSpeed` rule
  elements and only for `fly/swim/climb/burrow` — it never reads `FlatModifier`/`land-speed`. So the compiled
  feat has `speeds === undefined`, `deriveSpeeds` adds nothing, and no breakdown line appears.
- **Affected (unconditional, untyped):** Fleet (+5), Nimble Elf (+5), Arcane Locomotion (+5), Animal Swiftness
  (+5), Call of Elysium (+5), Nimble Hooves (+5), Swift (+5), Tiller's Drive (+10), Bellflower Dedication (+5).
  Also status-typed/conditional ones dropped by the same gap: Scout's Speed (+10 status), Monk Moves (+10
  status, unarmored).
- **Failing example:** Human (base 25) + **Fleet** → app shows **25 ft**, correct is **30 ft**. Elf (base 30)
  + Nimble Elf → shows 30, correct 35. The Speed popup shows only "Ancestry Speed" with no Fleet line.
- **Why HIGH:** Fleet is a very common general feat; this is a wrong **core statblock number** (Speed) for any
  character who takes it, and it's invisible in the breakdown.
- **Fix:** in `import-core.mjs parseDefenses`, read `FlatModifier` rules with `selector: "land-speed"` and emit
  `speeds.land = value` (respecting type/predicate where present); regenerate `core.json`. `deriveSpeeds`
  already applies `feat.speeds.land`, so no engine change is needed once the data is present. Add a test:
  Human+Fleet → land 30.

## 2.2 — [MEDIUM] Class "Resiliency" archetype feats grant 0 HP (should be 3 × archetype-feat count)

- **Where:** root cause `scripts/import-core.mjs:866-882` (`parseHpGrant`, documented gap at :863-865);
  consumed at `src/rules/derive.ts:246-253` (`featHpBonus`), `build.ts:2035-2039`, `explain.ts:477-481`.
- **Defect:** the 7 Resiliency feats (Barbarian/Champion/Exemplar/Fighter/Guardian/Monk/Ranger) grant HP via a
  Foundry `FlatModifier` on `hp` with value `"3 * @actor.flags.system.<class>DedicationCount"`. `parseHpGrant`
  only handles plain numbers and `[n]*@actor.level`, so the DedicationCount formula falls through to `{}` and
  no `maxHpBonus` is written. All 7 have `maxHpBonus === undefined` in `core.json`.
- **Correct rule:** "+3 HP for each <class> archetype class feat you have" (count includes the Dedication and
  Resiliency feats themselves).
- **Failing example:** Fighter Dedication + Fighter Resiliency (L4+) → correct **+6 HP** (2 archetype feats ×3);
  app gives **+0**, and the feat is absent from the HP breakdown. Each further archetype feat should add +3.
- **Fix:** teach `parseHpGrant` to recognize the `3 * @actor.flags.system.<x>DedicationCount` shape and emit a
  count-scaled `maxHpBonus`, then have `featHpBonus`/`build.ts` multiply by the number of that archetype's feats
  the character has. (Requires the engine to count archetype feats per dedication — a small addition.) Lower
  priority than 2.1 (7 niche feats, +3 each).

---

### Follow-up note
Both defects are **importer** gaps, not engine bugs — the fix is in `scripts/import-core.mjs` + a `core.json`
regenerate (+ for 2.2 a small `featHpBonus` count-scaling addition). Worth auditing `import-core.mjs` for
other unhandled rule-element formulas as its own pass (candidate for a later section).
