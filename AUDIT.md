# Wanderer's Codex — bug audit (2026-06-16)

Source: a multi-agent audit of the whole app (engine + 7 tabs + builder + play-state +
persistence), every finding adversarially verified, plus live runtime testing.
74 confirmed-real findings (0 critical / 6 high / 28 medium / 40 low) — consolidated below
(duplicates across finders merged).

**STATUS (2026-06-16): all tiers worked top-down. tsc clean; 344 Vitest tests (+26 new); live-verified.**
Two audit rules-claims were checked against Archives of Nethys and turned out partly different:
companion per-type HP IS real (fixed), but the "familiar 5/level is wrong" claim was a FALSE
POSITIVE (the code was already correct — left as-is).

**Deferred (low / architectural, NOT done):**
- #9 Deadly/Fatal crit-DAMAGE numbers (traits already display; full crit calc would risk a
  subtly-wrong formula — the app models no crit damage anywhere).
- #15 builder BIO INPUT (alignment/age/portrait upload/accent color) — the Details tab now
  *displays* any bio present and the dead controls are gone, but collecting bio is a new feature.
- #28 Frightened/Sickened auto-decrement + slowed/stunned effects — need per-turn/round tracking
  the app doesn't model.
- coin-input keystroke polish (minor).

## Tier 1 — core play/build breakers  ✅ ALL DONE (2026-06-16, tests + live-verified)

- [x] **1. Clearing Dying always adds Wounded.** Manually stepping Dying to 0, removing it in the
  Conditions modal, or clicking the pip down all wrongly bump Wounded; toggling on/off stacks
  Wounded 2,3,… The Wounded bump must fire ONLY on heal-recovery, not manual clears.
  `play.ts` condRemove/removeCondition; `VitalsRail.tsx` pips; `ConditionsModal.tsx`.
- [ ] **2. "Rest for the night" doesn't recover conditions.** HP/slots/focus reset, but Wounded &
  Fatigued aren't cleared and Doomed & Drained aren't decremented — a knocked-out PC stays Wounded
  forever and the next knockout starts Dying too high. Also doesn't clear other/companion conditions.
  `play.ts` rest().
- [ ] **3. Focus spells vanish for non-spellcasting classes.** Champion (Lay on Hands), Monk (Ki),
  Ranger (Warden/Vindicator) get NO focus pool and NO focus spell — the focus block is gated behind
  `if (cls.spellcasting)`. `build.ts:603`.
- [ ] **4. Editing a played character ignores gear changes.** After any play action, editing the
  build and changing equipment does nothing on the sheet — stale `play.inventory` shadows the rebuild.
  Same for level-down (stale spell slots / class resources). `play.ts` applyPlayState; `App.tsx` edit branch.
- [ ] **5. Skilled Heritage grants no skill.** A Skilled human (the default origin!) has no picker for
  the skill it trains → permanently down a trained skill; the level-5 expert bump never fires.
  `shared.tsx` changeHeritage / SkillEditor.
- [ ] **6. Containers are uncontrollable.** Backpack / bandolier / bag of holding render only as a
  section header — can't equip, invest, restack, remove, or inspect. `InventoryTab.tsx`.
- [ ] **7. Changing ancestry/deity leaves illegal stale picks.** Switch ancestry after picking
  ancestry feats → old feats stay baked in. Switch deity after Domain Initiate → still grants the old
  deity's domain focus spell. Subclass/background-granted skills also stay in the class-pick counter,
  blocking legit picks. `shared.tsx` change* actions.

## Tier 2 — wrong rules / wrong numbers

- [ ] **8. Thrown & propulsive weapon math.** Thrown weapons (javelin, dagger) use Dex not Str and add
  NO attribute to damage; propulsive (sling) adds no Str; daggers never get a thrown mode. `derive.ts:383-401`; importer.
- [ ] **9. Deadly/Fatal traits ignored in crit damage.** `derive.ts:397-404`.
- [ ] **10. Companion stats wrong.** Animal HP uses flat base 6 for every type (Bear=8, Bird=4);
  Nimble/Specialized get phantom +10 ft Speed; Eidolon shows the summoner's *armored* AC/saves
  (eidolons are unarmored); Familiar HP flat 5/level. `companions.ts`.
- [ ] **11. Spontaneous casters add unlimited known spells per rank** in Manage Spells (should cap at
  the slot count). `SpellsTab.tsx:158`.
- [ ] **12. Dying shown twice + illegal values.** Dying/Wounded appear both in the dedicated track and
  as steppered condition pills (two controls that can disagree); pips allow Dying above the death threshold.
  `VitalsRail.tsx`.
- [ ] **13. Key-attribute mislabeled** for classes whose subclass sets it (psychic subconscious mind,
  rogue racket) — Attributes panel highlights the wrong "key". `shared.tsx` AttributeEditor.
- [ ] **14. Misc rules:** non-OR ability prereqs treated as OR (under-enforce); granted cantrips can
  duplicate a picked cantrip; ACTIVITIES missing Reposition + mislabels save-based actions as skills;
  cantrip header hardcodes "heightened to 3rd"; kineticist with no elements shows all impulse feats.

## Tier 3 — dead / inert controls

- [ ] **15. Details tab is mostly non-functional.** "Add portrait" does nothing; Origin/Traits/Languages
  rows show chevrons + pointer cursors but have no handlers; custom-background details never display;
  no bio fields (alignment/age/height/personality/appearance) are shown or editable; per-character
  portrait + accent color are dead data; the builder can't set any bio detail except deity.
  `DetailsTab.tsx`; `build.ts:760`.
- [ ] **16. Bon Mot / Battle Medicine listed twice + duplicate React key.** Shown under both Feat and
  Skill actions; pinning duplicates the row with a colliding key. `MainTab.tsx`.
- [ ] **17. Pinning an Exploration/Downtime activity does nothing** — the star toggles + persists but
  never surfaces in any Pinned section. `MainTab.tsx`.
- [ ] **18. Smaller dead controls:** qty-decrement at qty 1; `InventoryItem.charges` declared but never
  used; `HitPoints.maxOverride` read but never settable; items with a missing definition silently
  disappear and become unremovable.

## Tier 4 — content & text

- [ ] **19. Broken rules text from stripped references** (found live). Condition/spell/feat text reads
  "You are , you don't treat anyone as your ally" / "Blinded overrides ." — the importer deletes
  `@UUID[...]` links that have no inline label. Needs an importer fix + re-import. `import-core.mjs:133`.
- [ ] **20. Inconsistent labels** — "rank 3" vs "3rd rank" across spell cards. `SpellsTab.tsx`.

## Tier 5 — UX / performance polish

- [ ] 21. Enter key in the HP amount field always Heals (never Damages).
- [ ] 22. Coin inputs awkward (forced 0, clamp on every keystroke).
- [ ] 23. Notes write the entire roster to localStorage on every keystroke.
- [ ] 24. Notes heading/quote buttons are one-way (can't toggle back to paragraph).
- [ ] 25. Dice-roll ids collide after reload → duplicate React keys in history.
- [ ] 26. Item picker silently truncates to 60 results.
- [ ] 27. Conditions modal close is a non-focusable icon (found live).
- [ ] 28. Frightened/Sickened not auto-decremented; slowed/stunned/persistent-damage are display-only.
- [ ] 29. Companion conditions can orphan/vanish when a companion is removed in the builder.
- [ ] 30. Invested count includes contained/non-magical items (can mis-trigger the 10 cap).
