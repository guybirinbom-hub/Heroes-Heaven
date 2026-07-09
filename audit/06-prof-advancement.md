# §6 — Per-class proficiency advancement vs Foundry (all 27 classes)

Diffs each class's `src/rules/advancement.ts` `CLASS_ADVANCEMENT` table (initial ranks + every expert/master/
legendary upgrade level + focus/spellcasting proficiency) against the Foundry ground truth
(`classes/<class>.json` + `class-features/*.json`). Run in 3 batches (§6a/§6b/§6c) for durability.

**Batch status:** §6a ✅ (9 classes) · §6b ✅ (9) · §6c ✅ (9) — **all 27 classes swept.** §6 total: **9 findings.**

---

## §6a — alchemist · barbarian · champion · commander · exemplar · fighter · guardian · gunslinger · inventor

**Confirmed: 7** (0 crit · 4 high · 2 med · 1 low). **Clean (no defect):** alchemist, barbarian, **champion**
(incl. its focus/devotion-spell proficiency — advances correctly, so the §4 Monk/Ranger bug does NOT extend to
champion), commander, exemplar, guardian, inventor.

### 6a.1 — [HIGH] Fighter: Versatile Legend (L19) weapon proficiency not applied
- **Where:** `src/rules/advancement.ts:143` — the fighter table's only L19 row is `{track:'classDc',
  rank:'master'}`; the four weapon-track L19 rows are missing.
- **Defect:** Versatile Legend (L19) should raise **simple/martial/unarmed → legendary** and **advanced →
  master** (class DC → master, already present). Instead all non-group weapons stay at the L13 Weapon Legend
  ranks (master simple/martial/unarmed, expert advanced). Only the one chosen weapon group is elevated to
  legendary (`build.ts:1587-1593`).
- **Failing example:** L20 sword-group fighter striking with a warhammer → app **master** (+6), correct
  **legendary** (+8): every off-group attack understated by **2** at L19-20. Advanced off-group weapons show
  expert (+4) vs master (+6).
- **Fix:** add L19 rows `{unarmed|simple|martial → legendary}` + `{advanced → master}` to the fighter table.
  Note `test/build.test.ts:25-31` only checks L13/L20 classDc, so it won't catch this — add a L20 weapon-rank test.

### Gunslinger cluster — weapon-proficiency track modeling is systematically wrong
Root cause: the gunslinger's proficiency should track **"simple/martial/advanced firearms & crossbows"** as
their own tracks (expert@1 for simple, master@5, legendary@13; advanced trained@1→expert@5→master@13), but the
app (a) puts master@5 / legendary@13 on the **generic** simple & martial categories, and (b) models only a
single `firearm:expert` weapon-group (no `crossbow` group; firearm rank applied to all firearm categories).
`core.json classes.gunslinger.attackGroups = {"firearm":"expert"}`; advancement rows at `advancement.ts:366-375`.

- **6a.2 — [HIGH] generic simple weapons over-granted:** `simple: master@5`, `legendary@13` — correct is
  expert@5, master@13 (never legendary). L5 gunslinger w/ a dagger shows master (+6) vs expert (+4).
- **6a.3 — [HIGH] generic martial weapons over-granted:** `martial: master@5`, `legendary@13` — correct
  expert@5, master@13. L5 gunslinger w/ a longsword shows master (+6) vs expert (+4).
- **6a.4 — [MEDIUM] generic advanced weapons over-granted:** `advanced: expert@5`, `master@13` — the gunslinger
  chassis grants **no** generic advanced proficiency (stays untrained). L5 shows expert (+4) vs untrained (+0).
- **6a.5 — [HIGH] simple crossbows untrained at L1-4:** only a `firearm` group is modeled, no `crossbow` group,
  so simple crossbows resolve to `attacks.simple = trained` at L1-4 instead of **expert**. L1 gunslinger w/ a
  crossbow shows trained (+2) vs expert (+4).
- **6a.6 — [MEDIUM] advanced crossbows unmodeled:** advanced crossbows are untrained at L1-4 (should be trained),
  and the whole "advanced firearms & crossbows" track is missing for the crossbow group.
- **6a.7 — [LOW] advanced firearms expert too early:** `firearm:expert` is applied to **all** firearm categories,
  so advanced firearms show expert at L1 instead of **trained** (they reach expert only at L5).
- **Fix (whole cluster):** model firearms & crossbows as proper grouped tracks — `attackGroups` should carry
  both `firearm` and `crossbow` at the right per-category ranks and level progression (simple f&c: expert@1 /
  master@5 / legendary@13; martial f&c: same; advanced f&c: trained@1 / expert@5 / master@13), and REMOVE the
  master@5/legendary@13 rows from the generic `simple`/`martial`/`advanced` categories. This needs the strike
  rank resolver (`derive.ts:821-824`) to distinguish weapon category × group.

---

## §6b — investigator · kineticist · magus · monk · oracle · psychic · ranger · rogue · sorcerer

**Confirmed: 0.** All nine classes' proficiency advancement (initial ranks + every expert/master/legendary
upgrade level for perception, saves, class DC, weapons, armor, and spellcasting) matches Foundry ground truth.
The only known focus-caster issue for Monk (ki) and Ranger (warden) is already recorded as [§4.1/§4.2](04-spellcasting.md);
this batch found no additional advancement defects (rogue's legendary Reflex/skills, magus's spell progression,
kineticist/psychic/oracle/sorcerer/investigator progressions all verified correct).

---

## §6c — summoner · swashbuckler · thaumaturge · witch · wizard · animist · bard · cleric · druid

**Confirmed: 2** (0 crit · 1 high · 0 med · 1 low). **Clean:** summoner, swashbuckler, thaumaturge, witch,
animist, bard, druid (initial ranks + all save/weapon/armor/perception/class-DC/**spellcasting-proficiency**
progressions verified vs Foundry).

### 6c.1 — [HIGH] Cleric: deity's favored weapon proficiency never advances past Trained
- **Where:** `src/rules/build.ts:1141` (favored-weapon override pinned at `'trained'`) + `src/rules/derive.ts:822`
  (strike rank = max(category, override) only). The cleric/warpriest/battle-creed advancement tables have no
  favored-weapon upgrade.
- **Defect:** each doctrine raises the **favored weapon** via `favoredWeaponRank` (independent of the weapon's
  category): **Cloistered → expert@11**; **Warpriest → expert@7, master@19**; **Battle Creed → expert@5,
  master@13**. The app never applies this, so whenever the favored weapon is **martial/advanced** (which the
  category bump doesn't cover) it stays **trained** for all 20 levels. `grep favoredWeaponRank src/` → nothing.
- **Scope:** **303 of 472** deity favored weapons are martial (+4 advanced) → the **majority of clerics** are
  affected. (A cleric whose favored weapon is *simple* is correct via the simple-category bump — that's why it
  wasn't caught earlier.)
- **Failing example:** Cloistered Cleric of Sarenrae (scimitar = martial) at L15 → app **trained**, correct
  **expert**: scimitar attack **−2 to hit** from L11 on, **and** no weapon-specialization damage (gated on
  expert+, `derive.ts:851`). Warpriest martial favored weapon: expert@19 vs correct master@19.
- **Fix:** model the doctrine `favoredWeaponRank` ladder and resolve the favored weapon strike as
  `max(doctrine favoredWeaponRank, weapon-category rank)`, applied whether the favored weapon is simple, martial,
  or advanced. Add a test (cloistered cleric, martial favored weapon → expert@11).

### 6c.2 — [LOW] Wizard: Weapon Expertise (L11) over-grants the whole simple category
- **Where:** `src/rules/advancement.ts:205` — `{level:11, track:'simple', rank:'expert'}`.
- **Defect:** Wizard Weapon Expertise (L11) grants expert only in **club, crossbow, dagger, heavy crossbow,
  staff, and unarmed** — not all simple weapons. The app bumps the entire `simple` category, so a wizard wielding
  e.g. a spear (simple, non-wizard weapon) shows expert instead of trained. (Unarmed upgrade at :204 is correct.)
- **Failing example:** L11 wizard with a spear → app expert (+2 over trained); correct is trained.
- **Fix:** grant the L11 expert to unarmed + the five wizard-weapon bases via per-weapon overrides (`weaponOverrides`),
  not the `simple` category. Low priority (wizards rarely make off-list weapon strikes). Note: same *shape* of
  bug as the fighter Versatile Legend one — the app's category-level weapon tracks can't express weapon-list
  grants; the per-weapon `weaponOverrides` machinery exists (build.ts) and should be used for these.

---

## §6 summary
Swept all 27 classes. **9 confirmed findings**, concentrated in weapon-proficiency modeling: the app tracks
weapons by broad category (simple/martial/advanced) + a few groups, so **weapon-LIST grants** (fighter
Versatile Legend, wizard weapon expertise) and **per-item grants** (cleric favored weapon, gunslinger
firearms/crossbows) are mis-modeled. Saves, perception, class DC, armor, and spellcasting-proficiency
progressions are **correct across all classes** (except the Monk/Ranger focus-prof gap in [§4](04-spellcasting.md)).

