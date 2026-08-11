# The audit of 500 — the 22 I could not settle

Every one of the 500 frozen feats got a verdict. These 22 are the ones where the answer genuinely
depends on a decision only you can make — not where the work was hard, but where two of your own
rulings pull opposite ways, or a shape has come up that none of them covers.

Answer by number.

---

### 1. Wukong Extension  `wukong-extension`

Wukong Extension is its own 1-action activity, and its popup already reads "your reach for that Strike is 30 feet". Does the 30-foot reach ALSO need a marker on the Strike row / the weapon innovation entry — the way Hydraulic Maneuvers marks Disarm, Shove and Trip with "range 15 feet" — or is a feat's own activity popup the whole surface when the modified Strike happens inside that same activity? (The general rule that would settle it: when a feat's activity contains a Strike with changed reach/range/damage, does the changed value get mirrored onto the Strikes list, or does it stay in the activity's own text?)

<sub>The activity is delivered — `sheetDiff` adds `actions[3] = "Wukong Extension"`, with the 1-action cost from storedFields and the full text (including "your reach for that Strike is 30 feet" and the weapon-innovation restriction) in the popup via MainTab.tsx's `desc: f.description`. The access clause needs nothing (Q5). The open item is the 30-foot reach, and two of the owner's decisions pull oppos</sub>

---

### 2. Out of Hand  `out-of-hand`

Out of Hand's severed limb has familiar statistics and its own Hit Points (Lay Down Arms keys off "if the detached limb was at 0 Hit Points"), but it only exists after you spend an action and vanishes when you reattach it. Do you want it as a Companions-tab card (a FEAT_COMPANION_GRANTS familiar entry with abilities suppressed and the Speed-5 / borrowed-Strike text in its note — giving the player a real HP pool), or does it belong to the temporary-minion model you already held necrologist-dedication and moray-eel-mount back for, leaving the limb as text on the feat until that model exists?

<sub>Half is clean: `grantsActions:['lay-down-arms']` puts Lay Down Arms in the action list (sheetDiff confirms), the action record exists with its own description and `aonParentId: feat-3563` tying it back to this feat. The severed limb has no surface at all — `FEAT_COMPANION_GRANTS` (src/rules/companionGrants.ts) has no `out-of-hand` entry, so no minion block, no HP, nothing. What I cannot settle is </sub>

---

### 3. Realm Strider  `realm-strider`

The granted Translocate entry shows "rank 4 · at will · from Realm Strider" and opens the plain Translocate text; nothing on it says that every cast also fills the adjacent spaces with your realm's damage type. DECIDED SCOPE says battlefield/enemy damage gets no surface on your sheet, but principle A/C says the record a feat modifies needs a visible indication that it has been modified. Does the granted spell entry need a marker carrying the rider (with the damage type resolved from the archfiend `realmDamage` choice), or does "from Realm Strider" on the entry count as sufficient indication?

<sub>Two of the three clauses are delivered exactly. innateSpells = [{translocate, tradition divine, rank 4, atWill true}] → the entry lands at repertoire.4, and SpellsTab.tsx:1770 renders "rank 4 · at will · from Realm Strider" with the cast pip suppressed (build.ts:4253 sets innateUses=0 for atWill, SpellsTab suppresses pip/onPip when uses===0). So the explicit 4th rank and the affirmative at-will ma</sub>

---

### 4. Communal Sustain  `communal-sustain`

Should a printed 'Frequency once per round' (or per turn) be a spendable use pip refilled by the 'New encounter' button, as the app does today for 61 feats, or does Principle B mean sub-daily frequencies must be popup text only with no counter?

<sub>The grantsAction half is delivered: sheetDiff puts "Communal Sustain" at actions[0], the record carries `actionCost {actions:1}` (the text prints none, so it correctly comes from the record), and the feat text carrying the 30-foot requirement and the Frequency line is what the popup renders. The ally-side clause correctly produces nothing. What I cannot settle is the Frequency. The record stores `</sub>

---

### 5. Posse  `posse`

Posse's +1 circumstance initiative star is built and correct. Should Posse also get a display-only mode the player switches on after spending the minute — carrying the up-to-five-creatures limit, the GM-determined 'out of your presence' loss, and the 'until you designate new prey or the prey dies' ending — as Ruling F's limited-time-ally-effect clause and Q11 suggest? Or is the permanent star with the condition in its `when` (Ruling M's shape) the intended answer, with the rest read from the feat's description? And separately: should a feat that is a 1-minute EXPLORATION activity (passive actionCost, e.g. Posse) appear in an activity list at all, given the app currently lists only encounter-cost feats plus a curated set of universal exploration activities?

<sub>The one number that belongs on your own sheet IS built and is correct: situationalBonuses.ts:543 — "posse": targets [{kind:'initiative'}], when "on initiative rolls when entering combat with your designated prey…", bonus "+1 circumstance" — right target, right type, right value, restriction in the `when` per Ruling B, and explain.ts case 'initiative' (line 701) merges featSituationalLines for the </sub>

---

### 6. Greater Vital Evolution  `greater-vital-evolution`

Greater Vital Evolution's two uses are tracked as pips on the Feats tab. Ruling D would put the mark where the player is looking when it matters — the spell-slot display, beside the rank that has just run out — but nothing today can mark a spellcasting rank row from data. Should a per-day resource that acts on spellcasting get a surface on the Spells page (carrying the "the two casts must be of different spell ranks" restriction there), or is the feat-row pip the whole surface? The same answer would settle Studious Capacity and Divine Effusion.

<sub>The resource itself is delivered and nothing is spurious: `limitedUses {max:2, per:'day'}` → two spendable pips on the feat row (FeatsTab.tsx:411), refilled by rest(); the count is 2, not 1. What is not delivered is placement. The pips live only on the Feats tab; nothing appears on the Spells page beside the rank rows that have run dry, and "the two spells you cast with this feat must be of differ</sub>

---

### 7. Eidetic Memorization  `eidetic-memorization`

Eidetic Memorization leaves you holding one memorized page until your next daily preparations — a state with a real duration but no number attached to it. Q1 says a duration longer than a round earns a mode and Ruling E case 3 says an ongoing no-number state gets a display-only mode; but this state changes nothing mechanical and expires in play. Do you want a display-only mode (single slot, replaced each use, cleared at daily prep) with a free-text field for WHICH writing is memorized, or is this popup text the player remembers?

<sub>The grantsAction half is delivered and correct: actions[0] = "Eidetic Memorization", full text in the popup (recreation medium, no need to understand the language, the fade-at-daily-prep clause, the one-at-a-time rule), no usage limit asserted — and AoN feat-2230 confirms "Three Actions", so the stored actionCost {actions:3} is right, not an over-assertion (the reader's "text states no action cost</sub>

---

### 8. Snap Out of It! (Pathfinder Agent)  `snap-out-of-it-pathfinder-agent`

The skill-detail panel lists 42 feat-gated actions, and every one is a GENERAL skill feat (Battle Medicine, Bon Mot, Pickpocket). Should an ARCHETYPE skill feat that rolls a skill — Snap Out of It! (Pathfinder Agent), rolled with Medicine — also appear under that skill so the player sees it where they read their Medicine number (Principle D), or is the actions-list entry the whole surface for archetype feats (Principle E)? The answer decides this for every archetype skill feat, not just this one.

<sub>The activity and its outcomes are delivered: sheetDiff shows the single expected change, "Snap Out of It! (Pathfinder Agent)" added to the actions list at 2 actions, and the four degrees of success plus the "DC is the DC for the effect that caused the condition" line are in the record text the popup renders. The ally-side condition arithmetic correctly moves nothing (decided scope). What I cannot </sub>

---

### 9. Disrupting Strikes  `disrupting-strikes`

Disrupting Strikes currently appears only as an action row carrying its printed text. Under Q1 ("1-round effects are indication only"), is that action row the whole surface, or does Ruling D still require a star on the Strike rows (weapon and unarmed) carrying the rune's effect — and if so, should that star state the level-appropriate version only (disrupting below 14th, greater disrupting from 14th, per Ruling G) and show the resolved max(class DC, spell DC) as a number?

<sub>Clause: "Your weapon and unarmed Strikes gain the effects of a *disrupting* property rune until the start of your next turn… greater at 14th… The DC for the rune's effect is equal to your class DC or spell DC, whichever is higher." The only sheet surface is the action row (sheetDiff: actions[0] = "Disrupting Strikes"), which exists purely because actionCost is 1 action; the popup prints the book t</sub>

---

### 10. Growth Spell  `growth-spell`

Should a spellshape feat put an indication on the spells it can modify — i.e. mark every non-cantrip area spell with "Growth Spell can expand this area", the way Lay on Hands carries a marker from each feat that modifies it — or is the action-list entry the whole surface for the spellshape family (Widen Spell, Reach Spell, Conceal Spell and Growth Spell are all action-only today)?

<sub>The printed activity IS delivered: the feat reaches the actions list (sheetDiff actions[0] = "Growth Spell") carrying its stored 1-action cost, and the three shape-specific expansions (burst +5 ft, cone +10 ft, line +15 ft) plus the wood trait ride in its own description popup — which is everything the text itself asks for. The only unsettled point is the reader's ADDED requirement, an indication </sub>

---

### 11. Goloma Lore  `goloma-lore`

Goloma Lore says "If you would automatically become trained in ONE of those skills ... you instead become trained in a skill of your choice." A character automatically trained in BOTH Stealth and Survival currently gets TWO replacement skill picks in the builder (one per collision). Should a double collision yield two replacements, or only one? Your answer also settles the roughly 60 other feats that use the same redundantFallback machinery.

<sub>Everything the text states unambiguously is delivered: Stealth and Survival trained and Goloma Lore trained (sheetDiff shows all three, skills.stealth 0 -> 22 and skills.survival 1 -> 23 at level 20), from featGrantsAuto.ts:154 `{ skills: { survival, stealth, 'lore:goloma' }, redundantFallback: true }`; the collision path at build.ts:3095-3101 skips the redundant grant and applies the replacement,</sub>

---

### 12. Healing Transformation  `healing-transformation`

For a spellshape feat whose target is a CLASS of spells rather than one named spell — Healing Transformation applies to any non-cantrip polymorph spell that targets one creature — does the Principle A/C indication requirement apply, so every eligible spell card on the Spells page carries a "Healing Transformation can apply here" marker (which needs a trait+target-count selector added to SPELL_MARKERS, currently keyed by spell id only)? Or is the granted action entry the whole surface for spellshapes, as Q4 rules for reactions? Your answer settles every spellshape/metamagic feat in the app, not just this one.

<sub>The spellshape action itself is delivered: sheetDiff shows actions[0] = "Healing Transformation" (1 action, druid/spellshape), so the player can fire it and the full text — non-cantrip, polymorph, single target, 1d6 HP per spell rank — sits in its popup. Ruling E correctly keeps the healing out of every sheet stat, and Ruling F correctly keeps the ally-facing number off this sheet. What is unresol</sub>

---

### 13. Wounded Party  `wounded-party`

Wounded Party is a reaction whose effect is 'You Rage.' The app already lists it in the reactions list with the full Trigger and a link to Rage. Does the Rage action ALSO need a mark pointing back (RECORD_MARKERS: 'also enterable as a reaction — Wounded Party'), i.e. Q8/Principle H's 'appears under both costs'? Or is a self-contained reaction entry the whole surface, per Principle E, whenever the feat has its own action row?

<sub>Delivered: the feat is a reaction and reaches the actions list (sheetDiff `actions[2] = "Wounded Party"`), its stored `actionCost:{type:'reaction'}` gives it the reaction glyph, and core-descriptions.json carries the Trigger verbatim — BOTH halves ('You or your designated ally takes damage, and you're capable of entering a Rage') — plus a descRef link to Rage. The 'your designated ally' clause cor</sub>

---

### 14. Legendary Medic  `legendary-medic`

Should a capability-only skill feat — one that adds a NEW USE of a skill rather than a bonus to it — get a `*` on that skill? Legendary Medic (spend 1 hour, Medicine check to remove a disease or blinded/deafened/doomed/drained, once per day per target), Ward Medic and Advanced First Aid currently carry nothing at all on the Medicine row, while every Medicine feat that grants a number does. If yes, this is a family-wide backfill rather than one feat; if no, Legendary Medic is correct as shipped.

<sub>sheetDiff is completely empty and no registry carries the feat — no situationalBonuses entry, no grantsActions, no note. The whole surface is the feat's own entry plus its description text. Two things are demonstrably RIGHT: the per-target frequency is correctly not modelled as a single character-wide daily pip (no `limitedUses` is stored, so the player is never locked out after one use), and the </sub>

---

### 15. Explosive Expert  `explosive-expert`

Guns & Gears (Remastered) p. 201: does Explosive Expert grant immunity to splash damage from your own bombs and firearms (Foundry's text, which the app carries), or the standard weapon-expertise escalation — "whenever you gain a class feature that grants you expert or greater proficiency in certain weapons, you also gain that proficiency for simple and martial bombs and firearms" (AoN's text, identical in remaster and legacy)? If AoN is right, the immunity must be deleted and a proficiency-escalation lane built; and it raises the wider question of whether other feats imported from Foundry carry text AoN contradicts.

<sub>AGAINST THE TEXT THE APP CARRIES, the record is exemplary: `immunities: ["splash damage from your own Strikes with bombs and firearms"]` lands on defenses.immunities as the FULL qualified string (not a bare "splash damage"), with defenses.sources attributing it to Explosive Expert — precisely the qualified-scope immunity the requirement demanded, and nothing spurious on the strikes. AND that text </sub>

---

### 16. Wood Ward  `wood-ward`

Wood Ward's ward persists 3 rounds when the attack misses, and can be destroyed. Q1 says an effect longer than 1 round gets a mode and Q11 says a thing that can be shut down is a mode — both point at a display-only mode carrying the printed text. But Principle E says a reaction's popup is often the whole surface, and whether the lattice is still between you and a given attacker is positional, which Ruling M says the app can never know and answers with a star-plus-note rather than a mode. The app's own precedent is on the star side (only one reaction in the entire data set ever got a mode). Which wins — does a persisting battlefield object created by a reaction earn a display-only mode, or is the reaction popup plus the AC star the whole requirement? Your answer is a policy call for a class of feats, not just this one. Secondary: if it stays a star, should the star's `when` mention that the ward keeps standing for 3 rounds, or stay scoped to the triggering attack as it is now?

<sub>Delivered: the reaction reaches the actions list with its full popup text (trigger, "Frequency once per hour", the 30-point reduction, the 3-round persistence, the difficult terrain); limitedUses {max:1, per:'hour'} is a real supported cadence that refills on the encounter reset (featUses.ts:110 SUB_DAILY) rather than only at rest; and situationalBonuses.ts:477 puts a star on AC reading "+2 circum</sub>

---

### 17. Rouse the Forest's Fury  `rouse-the-forests-fury`

For the 85 impulse-style feats whose description ends in a '**Level (Nth)**' scaling block (Rouse the Forest's Fury: '+32 and 5d10+9' at 20th vs the base '+30'), should the action entry resolve to the reading character's level the way the Spells page resolves heightened values inline, or is reproducing the book's full text with the level line as a footnote the intended behaviour? Related: this feat's base clause prints no damage die at all ('Either Strike has a +30 attack modifier and deals damage'), so below 20th level there is no damage figure available to surface — do you want that hole flagged in the entry, or left as the book prints it?

<sub>Three of the four requirements are cleanly delivered. The impulse reaches the sheet as a usable 3-action activity (sheetDiff: actions[7] = "Rouse the Forest's Fury"; MainTab.tsx:255-266 lists feats with a real action cost), and its popup renders the description in full through DescBody (MainTab.tsx:660) with no truncation — the stored description contains AC 40 / Fort +33 / Ref +24 / Will +30 / 20</sub>

---

### 18. Additional Follower  `additional-follower`

Additional Follower is repeatable (maxTakable: 3), but the companion grant is keyed by feat id, so only ONE follower card appears no matter how many times it is taken — companionGrants.ts:105's own note says 'add the further ones by hand in the Companions tab'. Is that documented manual fallback the shape you want for a repeatable companion grant, or should each taking materialise its own follower card (i.e. count instances rather than treating ownership as a boolean)?

<sub>Two of the three requirements are delivered — the empty sheetDiff is only the harness (snapshot() in scripts/feat-evidence.mjs derives no companions at all, so a companionGrants hit can never show). companionGrants.ts:105 grants `{ kind: 'follower', label: 'Additional Follower', note: 'Another novice follower with the minion trait joins you. Repeatable up to four followers in total — add the furth</sub>

---

### 19. Proximity Alert  `proximity-alert`

Proximity Alert's +2 is filed under Perception, so the Perception row is starred and the Initiative breakdown popup lists the bonus via delegation — but the Initiative ROW shows no `*`, because statHasSituational only matches targets of kind 'initiative'. Should the Initiative row's star delegate to the underlying statistic the way explainStat already does (lighting up whenever the Perception/skill it reads has situational lines), or is the popup-only surface the intended behaviour?

<sub>Requirement 1 is delivered exactly: situational.perception carries "+2 circumstance" with when = "on Perception checks for initiative", outside the Perception total (Ruling B), and the Perception row shows the `*`. Requirement 2 is delivered in substance but not in cue. The app has a real Initiative stat row (VitalsRail.tsx:640-650) and explainStat's `initiative` case (explain.ts:701-716) delegate</sub>

---

### 20. Extend Elixir  `extend-elixir`

Extend Elixir doubles the duration of EVERY elixir mode of 1 minute or longer, including one the character bought rather than brewed, with the infused restriction stated only in the note. No item in core.json carries the `infused` trait, but play-state does track which items came from Advanced/Quick Alchemy (`infusedItems` in src/rules/play.ts). Should the doubling be gated on that tracked list so a purchased elixir is not doubled, or is the note the intended surface and the over-application acceptable?

<sub>Both mechanical requirements land. `modeAdjust` matches `{traits:['elixir'], minDurationMinutes:1}` with `doubleDuration:true`; `adjustModes` (src/rules/modes.ts:441) is applied in src/rules/play.ts:555 when the elixir's mode goes live, `doublePrinted` doubles the printed duration string, and the running-mode pill (src/sheet/VitalsRail.tsx:1078) shows the doubled figure with a click-through to Mod</sub>

---

### 21. Shadow Reservoir  `shadow-reservoir`

Shadow Reservoir currently ships as a free-text 'which spell source' box plus an inert 'not tracked, note it down yourself' hint. The restricted-slot lane (perRankFrom + rankChoice.belowHighest + costsSlot, as used by Master Summoner and Sin Reservoir) could model the reservoir for real: one slot per rank up to your highest minus 2, each spending one ordinary slot of that rank. Do you want it built that way — and if so, are the reservoir's spells picked once in the builder (permanent, as the text implies) or re-picked at daily preparations, and should the picker enforce 'requires a spell attack roll or a saving throw' (which no spell filter currently expresses)?

<sub>Only the LAST clause is built. storedFields carries a single free-text choice (flag reservoirSource, kind 'text') for "choose one source of spells for your shadow reservoir" — legitimate per Ruling I/K. Everything else is declared untracked by the choice's own `inert` string: "Recorded only: the reservoir itself isn't tracked — note down one spell of each rank…". So the reservoir's per-rank spell </sub>

---

### 22. Scoundrel's Surprise  `scoundrels-surprise`

Scoundrel's Surprise does not change how Impersonate works — it is a separate action you may take AFTER Impersonating with a disguise kit. Should a feat of that shape ("after you do X, you can do Y") put a marker on X's action row, so a player looking at Impersonate learns the follow-up exists? Or is the feat's own entry the whole surface, with markers reserved for feats that actually alter the marked action's outcome? Your answer would settle a class of feats, not just this one.

<sub>The settled half is delivered: the feat reaches the action list (sheetDiff actions[3]), its popup carries the whole condition — after Impersonating with a disguise kit, before the end of your turn — and its description even ref-links "Impersonate" to the action and "off-guard" to the condition, so the player can jump from the feat to Impersonate. Nothing spurious fires, and correctly nothing model</sub>
