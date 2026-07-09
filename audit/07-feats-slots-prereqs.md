# §7 — Feat slots per level + feat prerequisites + archetype gating

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 0** — the feat system is correct.

_(Method note: the workflow completed 3 of 8 finders before a session limit; the remaining 5
prerequisite/gating **logic** checks were done **inline** by reading the code directly.)_

**Verified CORRECT (no defect):**

- **Feat-slot levels (all classes)** — class-feat, skill-feat, general-feat, ancestry-feat levels + skill
  increases all match Foundry `classFeatLevels`/`skillFeatLevels`/`generalFeatLevels`/`ancestryFeatLevels`/
  `skillIncreaseLevels` (workflow finders, clean). Universal defaults hold: ancestry 1/5/9/13/17, general
  3/7/11/15/19, skill feats even levels, skill increases 3/5/7/…; per-class class-feat levels correct.
- **Variant-rule slots** — Free Archetype adds an archetype feat slot at even levels 2-20 (`build.ts:2834`);
  Ancestry Paragon replaces the ancestry progression (2 feats @1, then odd levels 3-19, `build.ts:2817-2821`);
  Fighter bonus slots @9/15; Mythic slots at even levels. All correct.
- **Prerequisite enforcement** (`checkPrerequisites`, `build.ts:2873`) — ability-mod prereqs (`"Strength +2"`,
  AND by comma-convention, explicit OR allow-list for Fighter/Monk Dedication), proficiency-rank prereqs
  (trained/expert/master in skill/Perception/Lore, with OR handling), and has-feat prereqs (enforced when the
  name resolves to a known feat; "has" includes class features/heritage/subclass so feature-prereqs like Sneak
  Attack aren't false-blocked). Wired into the picker: `Builder.tsx:1453` marks unmet feats and
  `selectDisabled` (1505) blocks them unless the Overrides "Take anyway" is used; already-picked feats are
  **re-validated** when attributes change (1039-1040, greyed if newly invalid).
- **Archetype dedication gating** — both rules enforced: an archetype feat requires its Dedication (has-feat
  prereq), and `canTakeNewDedication` (`build.ts:377`, wired at `Builder.tsx:1332`) blocks a **new** dedication
  until each started archetype has **≥2 non-dedication feats** (the dedication tax).
- **Level & slot-type gating** (`eligibleFeatsForSlot`, `featSlots.ts:31`) — a feat can't be taken before its
  level; a general slot accepts skill feats (skill ⊂ general) but a skill slot rejects general-only feats;
  ancestry/class slots are trait-gated; kineticist impulses gated to the character's elements; Free Archetype
  slot accepts any archetype-trait feat. All correct.

**Informational (by design, NOT a defect):** `checkPrerequisites` deliberately **under-enforces** prerequisite
types it can't verify unambiguously — weapon/armor/save proficiency prereqs (e.g. "trained in martial weapons",
"expert in unarmed attacks"), membership prereqs ("member of the Bellflower Network"), and non-feat named
prereqs (darkvision, "a focus pool") are **shown** ("Requires: …") but not hard-blocked. This is intentional
(never false-block a legal pick; the app leans permissive and offers Overrides), documented in the function's
header comment. A player could thus select a feat whose weapon/armor/save-proficiency prereq is unmet without a
block — acceptable given the design, noted only for completeness.
