# §8 — Class features & subclass mechanics (stat-affecting)

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 3** (0 critical · 2 high · 1 medium · 0 low)

**Verified CORRECT (no defect):** subclass **key-attribute** overrides (rogue racket → Dex/Cha/Str/Int, psychic
subconscious mind → Int/Cha) feeding class DC; **rogue Sneak Attack** dice scaling + off-guard/weapon gating +
**Thief** Dex-to-damage; **ranger Precision** rider dice/scaling (Flurry's MAP reduction is a target-specific
bonus deliberately omitted, acceptable); **kineticist blast** ability (Con) + element gating of *element-traited*
impulses; subclass-granted **focus spells** + focus-pool counting; and subclass initial **proficiency** grants.

---

## 8.1 — [HIGH] Barbarian: 4 of 10 instincts fall through to a flat +2 rage bonus damage

- **Where:** `src/rules/derive.ts:701-708` (`RAGE_DAMAGE` table) + fall-through at `:718`/`:721-729`
  (`rageStrikeRider`).
- **Defect:** `RAGE_DAMAGE` has only 6 instincts (fury/spirit/superstition/dragon/giant/animal), but
  `core.json` offers **10** selectable instincts. For **bloodrager, decay-instinct, elemental-instinct,
  ligneous-instinct** the lookup is undefined → the rider keeps its default **+2** and the weapon's own damage
  type at all levels.
- **Correct rule (Foundry-confirmed, standard L7/L15 breakpoints the code already uses):**
  - Elemental Instinct **+4/+6/+12**, chosen element's damage type (Rage of Elements)
  - Decay Instinct **+6/+10/+18 poison** (Severed at the Root)
  - Ligneous Instinct **+6/+10/+18** weapon damage
  - Bloodrager **+2/+4/+8** (War of Immortals)
- **Failing example:** L15 full barbarian, Elemental Instinct (fire), raging, melee weapon → strike shows rage
  rider **"+2 <weapon type>"**; correct **"+12 fire"**. Decay/Ligneous show +2 vs +18 (Decay also missing poison
  type). Under-reports up to +16 and wrong type.
- **Fix:** add the four rows to `RAGE_DAMAGE`: `bloodrager:{tiers:[2,4,8]}`, `decay-instinct:{tiers:[6,10,18],
  type:'poison'}`, `elemental-instinct:{tiers:[4,6,12], type:'energy'}`, `ligneous-instinct:{tiers:[6,10,18]}`.
  Extend `test/rage-damage.test.ts` (currently only fury/dragon/giant).

## 8.2 — [HIGH] Rogue Ruffian: Sneak Attack doesn't fire with the racket's own simple weapons

- **Where:** `src/rules/derive.ts:676-685` (`strikePrecisionRiders`), caller at `:894`.
- **Defect:** the melee Sneak-Attack gate is strictly `agile || finesse`, with no Ruffian case. Ruffian's core
  benefit — deal Sneak Attack with a **simple weapon (die ≤ d8)** or **martial/advanced (die ≤ d6)** regardless
  of agile/finesse — is unimplemented in derive (only the Ruffian medium-armor grant at `build.ts:1580` exists;
  `grep ruffian src/` finds only comments + that armor branch).
- **Correct rule:** Foundry `ruffian.json` tags a qualifying weapon `sneak-attack`; the sneak-attack DamageDice
  fires on `item:tag:sneak-attack` + target off-guard.
- **Failing example:** L3 Ruffian, mace (simple, d6, no agile/finesse), Strike vs off-guard → app emits **no**
  sneak-attack rider (should be **+1d6 precision**). The racket's signature weapons deal zero sneak damage;
  a thief/scoundrel with an agile/finesse weapon still works, so the bug is Ruffian-specific.
- **Fix:** widen the `qualifies` melee branch: `c.subclassId === 'ruffian' && (category==='simple' &&
  dieFaces<=8 || (category==='martial'||category==='advanced') && dieFaces<=6)`. Add a Ruffian sneak-attack test.

## 8.3 — [MEDIUM] Kineticist: 5 elementless impulse feats are wrongly hidden from the picker

- **Where:** `src/rules/featSlots.ts:61-63`; duplicated in the Expand-the-Portal picker at
  `src/builder/shared.tsx:2548-2550`.
- **Defect:** the impulse gate `if (elements.length && !f.traits.some(t => elements.includes(t))) return false`
  rejects any impulse feat that carries **no** element trait — but a real kineticist always has ≥1 element, so
  these are always hidden. Affected: **Command Elemental (L4), Counter Element (L6), Fearsome Familiar (L6),
  Purify Element (L8), Imperious Aura (L16)** (traited `impulse,kineticist`, no element trait).
- **Correct rule:** impulse feats **without** an element trait aren't gated to any one element — any kineticist
  may take them (they say "choose one of your kinetic elements" at use time). Only element-traited impulses are
  restricted.
- **Failing example:** L4 kineticist with a single Fire gate → Command Elemental doesn't appear in the L4 class
  feat slot, though it's legal.
- **Fix:** only reject an impulse when it carries **at least one** element trait that isn't among the
  character's elements: `const eTraits = f.traits.filter(t => ELEMENTS.includes(t)); if (eTraits.length &&
  !eTraits.some(t => elements.includes(t))) return false;`. Apply to both sites.
