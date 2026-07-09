# §15 — Runes & attachments (property runes, slots, fundamental progression, talismans)

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 2** (0 crit · 0 high · 2 medium · 0 low)

**Verified CORRECT:** property-rune per-hit damage (flaming/frost/shock/corrosive/thundering all +1d6 of the
right type; greater frost/shock/corrosive/thundering correctly carry *no* extra damage rider — their crit
effects are conditions/arcs, not damage; anarchic/axiomatic correctly absent in Remaster); **rune-slot limits**
(property runes require potency, count ≤ potency value); **fundamental rune progression** (potency/striking/
resilient levels, prices, bonuses); handwraps + striking dice + potency/ABP (from §5). Only the two below.

---

## 15.1 — [MEDIUM] Base Flaming rune is missing its crit persistent damage (a test enshrines the bug)

- **Where:** `scripts/import-core.mjs:458` (`RUNE_DAMAGE.flaming` has no `critPersistent`); consumed at
  `src/rules/derive.ts:874-876` (weapon) & `:1060-1062` (handwraps). **A passing test locks in the wrong value:
  `test/audit-batch2.test.ts:14-22`** asserts exactly one rune has `critPersistent` (Greater Flaming).
- **Defect:** the **base** Flaming rune (L8) should add **1d6 fire per hit PLUS 1d10 persistent fire on a crit**;
  the app gives it only +1d6 fire, no persistent. Only `flaming-greater` (2d10 persistent) is modeled. (The
  stale comment at import-core.mjs:452-456 wrongly says "only Greater Flaming adds persistent.")
- **Correct rule (Foundry-confirmed):** `flaming.json` "1d6 fire … plus **1d10 persistent fire** on a critical
  hit"; `flaming-greater.json` "… plus 2d10 persistent fire."
- **Failing example:** a base-Flaming longsword crit shows base + striking + 1d6 fire, missing the **1d10
  persistent fire**.
- **Fix:** set `RUNE_DAMAGE.flaming.critPersistent = { dice:1, die:'d10', type:'fire' }`; regenerate `core.json`;
  **update `test/audit-batch2.test.ts`** (the count becomes 2) and fix the stale comment.

## 15.2 — [MEDIUM] Talisman affixing lets 5 talismans attach to the wrong item type

- **Where:** `src/rules/attachments.ts:23-41` (`attachHostTypes`; the `out.size === 0` fallback at :35-39
  returns **all three** host types), reached via `planAffix`/`planAttach`; live at `InventoryTab.tsx:775/:902`.
- **Defect:** `attachHostTypes` keyword-matches only weapon/armor/shield words in the talisman's affix `usage`.
  Usages with an unmatched target word — `affixed-to-headgear`, `affixed-to-a-magical-staff` — fall through to
  the fallback that permits **weapon, armor, AND shield**, so `planAffix` returns `{ok:true}` for illegal hosts.
- **Affected (5 talismans):** **Sage's Bloom, Navigator's Feather, Ixame's Eye** (headgear) and **Ruby
  Capacitor** ×3 tiers (magical staff) can be dragged onto a longsword or shield and affix successfully.
- **Correct rule:** a talisman may only be affixed to an item matching its usage (headgear → a worn head item;
  magical staff → a staff), never a weapon/shield it forbids.
- **Fix:** in `attachHostTypes`, don't default an unrecognized usage to all-three; recognize `headgear`
  (→ worn/head), `staff`/`magical-staff` (→ a staff item), and default unknown usages to **none** (reject) so
  the drag-to-attach UI blocks illegal affixes. (Armor property-rune slot handling mirrors weapons — verified OK.)
