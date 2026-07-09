# §12 — Equipment data (weapon damage/traits/group, armor, shields, price/bulk/level) vs Foundry

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 4** (0 critical · 2 high · 2 medium)
_(7 raw confirmations dedupe to the 4 distinct issues below — the flat-die bug was flagged by two finders.)_

**Verified CORRECT via programmatic diff:** weapon **damage die/type** (except the flat-damage bug below),
weapon **traits / group / category / hands**, **armor** stats (acBonus/dexCap/checkPenalty/speedPenalty/
strength/category), and item **price / bulk / level** all match Foundry. Only the items below are wrong.

---

## 12.1 — [HIGH] Importer fabricates a `d4` die for every flat-damage weapon (~43 items)

- **Root cause:** `scripts/import-core.mjs:1623` — `die: pick(s.damage?.die, bs?.damage?.die) || 'd4'`. When
  Foundry's die is an **empty string** `""` (a weapon that deals **flat** damage, no die) the `|| 'd4'` fallback
  substitutes `d4`. Consumed by `src/rules/derive.ts:844-849/888` which renders `${dice}${die}`.
- **Affected:** **Blowgun** (should be flat **1 piercing**, app shows 1d4), **Dart Umbrella** (flat 1, app 1d4),
  and **41 alchemical bombs** (Acid Flask, Blood Bomb, Water Bomb, etc. → flat 1 direct; and persistent-only
  bombs like **Atrophy Bomb** have **0** direct damage in Foundry — `dice:0, die:null` — but the app shows 1d4).
- **Failing example:** a Blowgun Strike shows **1d4 piercing** (avg 2.5); correct is **1 piercing** (flat). An
  Acid Flask shows 1d4 acid; correct is 1 acid + 1d6 persistent + 1 splash (the app also doesn't model bomb
  splash/persistent — a separate alchemist gap, but the **die** here is the data error).
- **Fix:** change the fallback so an empty Foundry die stays flat (`die: pick(...) ?? ''` and treat `dice:0`/
  empty die as flat damage), and have `derive.ts` render `N <type>` (no die) when the die is empty; regenerate
  `core.json`. This is the **5th importer-related finding** — a dedicated `import-core.mjs` pass is overdue.

## 12.2 — [HIGH] Vambrace of Gorum — wrong shield Hardness/HP/BT

- **Where:** `public/core.json → items['vambrace-of-gorum']` = Hardness **12**, HP **128**, BT **64**.
- **Correct:** Hardness **20**, HP **160**, BT **80** (understated — affects Shield Block absorption).
- **Fix:** correct the three values from Foundry.

## 12.3 — [MEDIUM] Energized Shield (Major) — wrong Hardness/HP/BT

- **Where:** `items['energized-shield-major']` = Hardness **10**, HP **104**, BT **52**.
- **Correct:** Hardness **8**, HP **64**, BT **32** (overstated).

## 12.4 — [MEDIUM] Martyr's Shield (Hellbreakers) — wrong Hardness/HP/BT

- **Where:** `items['martyrs-shield-hellbreakers']` = Hardness **11**, HP **108**, BT **54**.
- **Correct:** Hardness **8**, HP **64**, BT **32** (overstated).

> 12.2–12.4 are isolated magic-shield stat errors (3 items); the base/common shields and armor are all correct.
