# Gold set — the owner's answers, and the principles they establish

Owner review, round 1 (2026-08-11). Ten feats answered directly. The principles below are derived from
those answers and are what the remaining entries were adjudicated against.

**These override my earlier reading of the rulings wherever they differ.** One of them does.

---

## ⚠ The correction that matters most

I had treated "an effect that lands on an ally" as producing **nothing at all** — that was the basis
for the six control feats. The owner's answers to #1 and #2 say otherwise:

> *"in the lay on hands spell description there needs to be indication that this effect exist"*

Ruling F removes the **number** from your sheet. It does **not** remove the player's need to SEE that
their own ability has been modified. So an ally-facing feat still carries a requirement: **an
indication on the record it modifies** — the spell, the action, the class feature.

This is Ruling D's principle ("the mark lives on the thing you are looking at when it matters")
applied to ally-facing effects, and it means five of the six controls were NOT true negatives.

---

## The principles

| # | principle | from |
|---|---|---|
| **A** | An ally-facing effect still needs an **indication on the record it modifies**. No number on your sheet; a visible marker on the source ability. | 1, 2 |
| **B** | A mode carries the **full text** of what it does, including parts the app cannot compute. Rounds are not tracked, so a per-round effect contributes no number — but the player must still read what it does. | 3 |
| **C** | A feat that modifies **another record's** granted thing must be **reflected in that thing**. | 3 |
| **D** | Star **every skill that could perform** the named action, so the player sees it where they look up the number. | 6 |
| **E** | A reaction needs to **appear in the reactions list**, with its trigger and requirements in its popup. That is often the whole requirement — no further sheet impact. | 7 |
| **F** | A granted movement type needs the **speed itself plus a `*`** carrying the feat's details. | 8 |
| **G** | A granted class feature needs its **details surfaced AND its choice offered**. | 9 |
| **H** | An action whose cost changes conditionally appears under **both costs**, with the explanation in the popup. | 13 |
| **I** | **Free-text player input** is a legitimate choice type. | 15 |
| **J** | Situational stars go on **the specific skills or actions affected**, not on a general stat. | 15, 16 |
| **K** | Anything the player re-chooses in the **builder** needs no sheet surface. | 15 |

---

## Round 2 — the 14 decisions (2026-08-11)

| Q | decision | settles |
|---|---|---|
| **Q1** | **Effects lasting 1 round are not implemented — indication only.** A longer duration gets a **mode**. Shield the Faithful is a mode: it runs 1 minute and includes YOU (+1 item AC, resistance 10 spirit), so its mode carries real numbers for your half and text for the ally half. Healing Sanctuary's per-round ally temp HP is text inside that mode. | ~100 feats |
| **Q2** | **Both** — star the skill AND the action. When it applies to saves generally, **star all three saves**. | 75 here, 176 by Foundry's count |
| **Q3** | A battle form gets a mode that **really overrides** the stats it names — **and must make plain that a mode is active and what changed**. | 44 feats |
| **Q4** | An enemy-condition reaction: **the reaction entry is the whole surface**. | — |
| **Q6** | **Record acquired creature traits on the sheet** (the Details tab already carries tags). | 16 feats |
| **Q7** | The `*` is for a **conditional** movement type — Wyrmling Flight's fly Speed depends on your Speed, so the player needs to see when flight is available. **Most granted speeds are permanent and need no star.** | — |
| **Q8** | **Yes** — Ruling D's shape applies: mark the action the feat modifies. | — |
| **Q9** | **The builder shows only what the player may legally pick**, unless they toggle "show options not meeting prerequisites". So Domain Fluency must filter to the mystery's domains. | — |
| **Q11** | **Check the rules**: if the effect can be shut down, it is a **mode**; if it cannot, it is a **passive bonus**. | — |
| **Q12** | Whichever spelling **leaves the player least confused**. | — |
| **Q13** | Show **only darkvision** when it supersedes low-light. | 9 feats |

| **Q5** | **No requirement. The inventory stays open** — item rarity does not gate the shop. Q9's "only what you may pick" governs the BUILDER's choices, not the item list. So an "access to uncommon X" clause needs nothing. | 80 feats |
| **Q10** | **Only apply the remap when it makes the player better.** The app's existing `betterRank` chain (`derive.ts:2635`) is therefore already correct; RAW's strict replacement is rejected because it could lower a rank. | 9 feats |
| **Q14** | Improbable Elixirs' picks **must reach a formula book** — and the formula book itself needs building. Full spec below. | — |

## Round 3 — rulings on the five challenged entries (2026-08-11)

| Q | ruling |
|---|---|
| **Q15** | **An effect that fires on a critical success needs no implementation unless the effect is COMPLICATED.** A complicated one gets a mode the player applies; temporary Hit Points alone are not complicated. This **overrules the challenge pass on #11**, which argued from Q1 that a one-minute duration earns a display-only mode. **Q1 governs duration; Q15 governs the crit-trigger shape, and Q15 comes first.** |
| **Q16** | #12 fix accepted — restore the `*` on Constant Levitation's fly Speed. ⚠ It also exposed a real bug: `core.json` hardcodes `speeds:{fly:40}`, wrong for any character whose Speed is not 40. Must resolve `max(@actor.speed.land, 20)`. |
| **Q17** | #27 fix accepted — `negativeHealing: true` on Zombie Dedication. ⚠ **No feat carries this field today**, only the dhampir heritage and four items, so any feat granting it is silent. |
| **Q18** | #29 fix accepted — the "⚠ VERIFIED GAP" was **false**. Both the Thievery grant and its redundancy fallback are already built at `featGrantsAuto.ts:23`. |
| **Q19** | #42 fix accepted — the formulas this feat writes into the book **are craftable**: *"You gain formulas to create these potions as alchemical consumables and you can craft alchemical consumables."* So they join the Advanced Alchemy prepare list and the Quick Alchemy picker — pool membership, never an inventory copy. |

### Q14 — the formula book, as specified

The book is an **item**, and its popup is where formulas live.

1. **Add formula** button — the player picks any item; the book lists it as *"<item name> formula"*.
2. **It does not store the item.** A formula is a reference, never a copy in inventory.
3. **Remove** — the player can delete a formula.
4. **Search** inside the formula-book popup.
5. **Capacity 100 formulas.**
6. **Taking a feat that grants a formula book ensures the character has one** — if they have none, add it.
7. **A feat that grants formulas gets a picker in the builder**, offering **only the options that feat
   allows** — not the whole item list.
8. **Unpicked grants show as empty slots** in the item's inventory popup; pressing one opens the
   selection of that feature's relevant options.
9. ⚠ **After the first pick, the grant is severed from the book.** The chosen formulas are written INTO
   the book and belong to it. *"if he loses the book he dosent get the formulas back from the feature
   because it dosent work like that."* So the grant is a **one-time write**, not a live derivation.

**Point 9, confirmed by the owner 2026-08-11:** the builder picker exists so the player remembers to
choose while building; once chosen, the book owns those formulas outright. Deleting the book loses them
permanently, and the feature will not re-grant them. **The grant is a one-time write, never a live
derivation** — so whatever implements it must copy into the book's own state rather than deriving the
book's contents from the owned feature, which is the shape every other grant in this app uses.

---

## The answers as given

**1. Resilient Touch** · **2. Amplifying Touch**
> *"in the lay on hands spell description there needs to be indication that this effect exist, later we can decide how its displayed."*

Requirement: a marker on **Lay on Hands** showing the feat modifies it. Display shape deferred.

**3. Healing Sanctuary**
> *"we need to have a mode for Shield the Faithful and if the player also has the Healing Sanctuary the mode needs to reflact it… Healing Sanctuary wont give anything in the mode because we dont truck rounds but we do need the text that syaes what it does"*

Requirements: a **mode for Shield the Faithful**; Healing Sanctuary **modifies that mode's text**;
contributes **no numbers** (rounds untracked).

**6. Mastermind's Eye**
> *"i want the feat to have a * in every skill that can recall knolladge so the use can see what happens when he cheks his recall knolladge number"*

Requirement: a situational star on **every Recall Knowledge skill**. (Record confirms the prerequisite
is Butterfly Blade Dedication.) The off-guard clause itself lands on the enemy and adds nothing.

**7. Minor Omen**
> *"this is a reaction that needs to apear in the reactions the Trigger You fail a Reflex save. the Requirement needs to be writen in the pop up there isnt a need for it to imact the sheet in another way."*

Requirements: **a reaction in the reactions list**, trigger and requirements shown in its popup.
Nothing else — explicitly not a degree-of-success surface.

**8. Wyrmling Flight**
> *"add a fly speed with a * that has the feat details."*

Requirements: **fly Speed equal to your Speed**, plus a `*` carrying the feat's details.

**9. Devout Blessing**
> *"the user gets the blessing of the devoted class feature and this needs to have the details of the feature and letting the user chose one of the blessing"*

Requirements: **grant the Blessing of the Devoted class feature**, surface its details, and offer the
**choice of one blessing**. ⚠ Owner unsure whether other sources widen the blessing list — open.

**13. Quick Recognition**
> *"have Recognize a Spell apear as both free action and raction and on the pop up have explanation"*

Requirements: **Recognize a Spell listed under both costs** — its native reaction and the free action
this feat enables — with the explanation in the popup.

**15. Guerrilla Dedication**
> *"choose a single, discrete urban or wilderness location ( have a free text filed where the user typs)… ( have a * on sneak with this detail)… ( have a * on avoide notice)… ( if the user wants to change they wil do it in the builder)"*

Requirements: a **free-text field** for the favoured location; a `*` on **Sneak**; a `*` on **Avoid
Notice**; changing the location is a builder action, no sheet surface.
⚠ **I am adding one the owner did not mention**: the feat's first sentence also grants *"trained in
your choice of Deception or Thievery; if you are already trained in both, you become an expert in one
instead"* — a skill choice with a redundancy fallback. Flagged rather than assumed.

**16. The Truth as I See it**
> *"( heaving a * on deception )"*

Requirement: a `*` on **Deception**, carrying the once-per-day reroll and the ring-of-truth clause.

---

## Round 4 — the audit-500 uncertain pile, answers 1–7 (2026-08-11)

| # | feat | ruling |
|---|---|---|
| **1** | Wukong Extension | **Reach is a VALUE on the Strike, not a note.** If the feat always changes reach, write the new reach. If several sources give several reaches, write them all. A reach that applies only in certain circumstances gets a `*`. Two sources giving the SAME reach under different circumstances are written `reach/reach` with a `*` on **both**, each opening its own source. |
| **2** | Out of Hand | Taking the feat adds the ability to put **the severed arm in the Companions tab as a minion**, following the feat's own stat block. **The player adds it when it happens in play** — the app provides the capability, never the trigger. |
| **3** | Realm Strider | The feat's extra text is written **onto the granted spell's description, under that feat's name**, so the player cannot mistake it for part of the spell as normally printed. ⚠ *"adding notes to spells from features will come up more in the future"* — build this as a general lane, not a one-off. |
| **4** | Communal Sustain | **A once-per-round frequency needs no counter.** No use pip. |
| **5** | Posse | No special implementation, and **no `*`** — the bonus only arrives after the player deliberately spends a minute doing something, so there is nothing to warn them about on a stat row. |
| **6** | Greater Vital Evolution | No implementation needed. |
| **7** | Eidetic Memorization | No implementation needed. |

### The principles these establish

| # | principle | from |
|---|---|---|
| **L** | **Reach is displayed, not annotated.** Multiple reaches are shown together; conditional ones are starred; identical reaches from different circumstances are shown twice with a star each, because the player must be able to tell which one a given situation uses. | 1 |
| **M2** | A feat that creates a **temporary creature** gets a Companions-tab entry the **player** adds. The app supplies the capability and the stat block; the timing is the player's, never the app's. | 2 |
| **N2** | A feat that **modifies a spell it grants** writes its text into that spell's description **attributed to the feat and visually separated** from the spell's own rules. A recurring shape — build it as a lane. | 3 |
| **O2** | **Per-round frequencies get no use pip.** A counter is for a resource that runs out across a scene, not one that resets every round. | 4 |
| **P** | A benefit gated behind a **deliberate out-of-combat action** needs no star. The player already knows they did the thing. | 5 |

---

## Round 5 — the echo-only pickers (2026-08-11)

**Q20. When a feat's choice changes nothing but the feat's own label, is that acceptable?**

> **(c) Fine only when the choice has no mechanical consequence the app models.** Judged individually,
> not by rule. *"but remember Assurance needs to have a `*` on the skill that it affects."*

### ⚠ The refinement is the important half

Label-only is **almost never the complete answer**. Even where no number moves, if the choice names a
specific stat, **that stat carries a `*` back to the feat**. Assurance is the case: you roll 10 +
proficiency instead of a d20, so nothing on the sheet changes — and the skill must still be starred,
because that is where the player looks the number up.

So the test is two questions, not one:
1. Does the app model a mechanical consequence? If yes, the choice must produce it — a label is not enough.
2. Does the choice name a specific stat? If yes, **that stat gets a `*`**, whether or not a number moves.

A choice is legitimately label-only only when **both** answers are no.

### The three worked examples the owner gave

| feat | verdict | what it must do |
|---|---|---|
| **Ranged Combatant** | **defect — answer has no consumer** | The record carries the damage-type picker and *nothing else*. It must grant the eidolon a **ranged unarmed attack: range increment 30 ft, 1d4, magical + propulsive**, with the picked type as its damage. Owner's own words. |
| **Manifold Modifications** | **defect — unfiltered list (Q9)** | Offers all 17 modifications. Must offer only those belonging to **the innovation the character already has**. |
| **Exemplar Dedication** | **defect — a phantom question** | Its two-option "ability score" picker is the *prerequisite* ("Strength +2 or Dexterity +2") rendered as a choice. **Delete the picker.** The mangled prompt `"Class DCAbility Score"` is import damage; the feat's real unbuilt content is *trained in martial weapons* and *one ikon with its immanence and transcendence actions*. |

**Assurance-style feats (Eidetic Ear, Weight of Experience) are correct to move no number — and still
need the `*` on the chosen skill.**

---

## Round 6 — Canny Acumen, and when an option may NOT be filtered (2026-08-11)

**Q21. Canny Acumen, as specified by the owner:**

> *"you just let the user choose either Fortitude saves, Reflex saves, Will saves, or Perception and he
> becomes expert at it. At 17th level, you become a master in his choice. Usually it shouldn't allow a
> player to choose something he is already an expert in, but because at 17th level he becomes a master,
> in this case allow it."*

1. Four options: fortitude, reflex, will, perception.
2. The pick grants **expert** in that track.
3. At level 17 the **same** pick becomes **master** — an automatic upgrade, not a second choice.
4. ⚠ The picker must **not** filter out a track the character is already expert in.

### The principle — a deliberate exception to Q9

| # | principle |
|---|---|
| **Q** | **An option is filtered out only when the grant would be genuinely WASTED. If a later level-scaling upgrade makes it worthwhile, the option stays.** |

Q9 says the builder shows only what the player may legally pick, and the naive reading filters any
option the character already has. Canny Acumen is the counter-example: choosing a save you are already
expert in looks wasted at the moment you take it, and is not — the level-17 upgrade to master is the
real prize. Filtering it would quietly deny the player the feat's whole point.

**So option filtering must ask "is this wasted across the character's whole career?", not "is this
redundant right now?"** Anywhere a feat scales at a later level, that later level is part of the answer.

---

## Round 7 — reach, daily choices, and the dedication rule (2026-08-11)

| Q | ruling |
|---|---|
| **Q22 — size does NOT grant reach** | *"Large PCs do not automatically gain additional reach, though some Large ancestries (such as minotaurs) have ancestry feats that grant them additional reach."* **The app is correct as shipped** — base reach stays 5 ft for Large ancestries, and Jotun's Heart's explicit "10-foot reach" is right rather than redundant. Nothing to change; the reach lane's open question is closed. |
| **Q23 — daily choices belong to daily prep, not the builder** | They must **not** render in the builder. They appear when the player presses **Daily preparations**, and **default to the last choice made**. ⚠ The owner thinks a setting for that default may already exist — **check before building one**. |
| **Q24 — do not re-run the 500-feat audit** | Not yet, despite the Strength-wizard host bug. Finish the audit systems first; the owner will set the next step then. |
| **Q25 — the archetype dedication rule is UNBUILT** | Feats print *"**Special** You cannot select another dedication feat other than X until you have gained two other feats from the Y archetype."* **Nothing in `src/` enforces this** — no dedication gate exists anywhere. ⚠ **It is NOT a general rule.** Only **12 of the 240 live dedication feats** print the clause — Magaambyan Attendant, Juggler, Jalmeri Heavenseeker, Wellspring Mage and eight others. Building it as a blanket gate would wrongly block 228 legal picks, which is worse than the current gap. |

### Q25 — what has to be true

The rule is: once you take a dedication, you may not take **another** dedication until you have **two
more feats from that same archetype**. Some feats name an exception (Halcyon Speaker Dedication is
allowed after Magaambyan Attendant).

This belongs in the builder's eligibility test, alongside prerequisites — and per **Q9** an ineligible
dedication should not be offered at all unless the player toggles "show options not meeting
prerequisites". Per **Q21**, the filter must ask whether the pick is legal *now*, which for this rule
genuinely is a now-question rather than a career-question.

### Q25, corrected — the rule is PER-FEAT, not global

⚠ I first recorded this as "a general rule across every archetype". **That was wrong**, and the owner
corrected it. Measured: **12 of 240 live dedication feats** carry the Special clause. A blanket gate
would wrongly block 228 legal picks — a worse bug than the one it fixes.

So the gate must be driven by **the feat's own text**, read per record, and each clause names its own
exception ("other than Halcyon Speaker Dedication") and its own archetype ("two other feats from the
Magaambyan Attendant or halcyon speaker archetype"). It is a field on those 12 records, not a rule in
the engine.

### Q26 — a dead picker may be a MISSING LANE, not flavour

Asked what Magaambyan Attendant's dead "Magaambya branch" picker should do, the owner: **"it should
grant something we haven't built — then it's a missing lane."**

So the default reading for a picker whose answer reaches nothing is **not** "it must be flavour". Each
of the five is a candidate missing grant, and the branch pick is one. Do not close these by deciding
they are decorative; find what the text says the branch gives and build it.

---

## Round 8 — unpickable must LOOK unpickable (2026-08-11)

**Q27, from a bug the owner hit in play:**

> *"when I can choose a skill to be trained in it shows me options I'm already trained in. It doesn't
> let me pick them like it should, but there isn't any point in showing them — the user is just
> annoyed. Instead I want them greyed out. If there are more places where a user can't pick something
> but there isn't a visual indication he can't, it's just bad design."*

### The rule

**An option that cannot be picked must LOOK unpickable.** Greyed out, and ideally saying why. Never
rendered identically to a live option and silently inert — that reads as a broken app, not a rule.

This is a **display** rule and does not contradict **Q9** (*the builder shows only what the player may
legally pick*), which is a **filtering** rule. They divide like this:

| case | treatment |
|---|---|
| you fail its **prerequisites** | filtered out (Q9), revealed by the "show options not meeting prerequisites" toggle |
| the option is **shown but cannot be taken** — already trained, already owned, budget spent | **shown, greyed, and it says why** |
| the grant would be **wasted across your whole career** | filtered (Q21) |
| the grant looks wasted now but a **later level makes it worthwhile** | kept and live (Q21 — Canny Acumen) |

**Scope: every picker in the app, not only the skill one.** The owner's last sentence makes this a
sweep, not a one-line fix. Anywhere a control is inert without looking inert is in scope — pickers,
option lists, buttons, slots.

---

## ⚠ Q25 CORRECTION — my "nothing enforces this" was FALSE

I recorded: *"Nothing in `src/` enforces this — no dedication gate exists anywhere."* **That was wrong,
and verifiable in one grep.** `canTakeNewDedication` shipped at `src/rules/build.ts:576`, was applied at
two sites in `Builder.tsx`, and had a test. It blocked every dedication until each started archetype had
two other feats.

That is the same false-gap error this whole project exists to catch — a claim that something is missing,
sending someone to build what already works. I made it while warning about it.

**And the underlying rule IS general.** Player Core's Archetypes chapter (AoN rules-1431 / rules-167,
read from the local archive): *"once you select a dedication feat for an archetype, you must satisfy its
requirements before you can gain another dedication feat."* The Remaster lifted that boilerplate out of
each feat into the chapter — **which is exactly why only 13 records still print a clause: they are the
ones whose requirement DIFFERS.**

So the owner's *"not every archetype has this rule"* is **right about the printed clause and wrong about
the rule**, and my "228 legal picks would be wrongly blocked" followed only from believing no gate existed.

**What was built, conservatively:** the general two-feat default is KEPT, with the 13 printed clauses
layered on top as per-record overrides (`Feat.dedicationGate {archetypes, count, except}`), each quoted
from the archive. Every difference the owner actually named — per-feat archetypes, per-feat exceptions —
is now driven by the record's own text rather than assumed.

**❓ OPEN FOR THE OWNER:** if you do want no default gate, it is one constant plus deleting a fallback —
but it would un-gate 213 dedications, so it needs saying explicitly rather than inferring it from my
wrong note.

**Q28 (owner, 2026-08-11), superseding the correction above:** *"not every dedication keeps the general
two-feat gate — only feats that say it. When we audit the feats it needs to be one of the systems that
the audit marks."*

Applied: the general default is **removed**; only the 14 records printing the Special clause gate.
`dedicationGate` is now a lane in `docs/mechanic-lanes.md`, so the feat audit checks it like any other.

⚠ Two tests asserted the old default and were rewritten, each keeping a comment on what it used to
claim — `test/polish.test.ts` and `test/dedication-gate.test.ts`. They would otherwise have vouched for
behaviour the owner rejected.

---

## Round 9 — the six remaining lane gaps (2026-08-11)

| gap | records | ruling |
|---|---|---|
| **Aura** | 39 | **A mode.** Fits Q11 (it can be shut down) and Q1 (it outlasts a round). Ruling F still governs the numbers: an ally's bonus lands on no sheet of yours, but the mode shows it is running and carries the full text (Principle B). It also gives later feats that rewrite an aura something to attach to (Principle C). |
| **Special statistic** | 9 | **Very important — build it.** A named statistic with its own DC that is not a save, a skill or the class DC. Gunslinger Dedication needs a *secondary* class DC for a class the character does not have. → **BUILT, see Q30** |
| **Multiple attack penalty** | 4 | **Very important — build it.** Flurry and Agile Grace change the MAP progression itself (−3/−6 rather than −5/−10). `mapStep` is currently fixed. → **BUILT, see Q31** (the engine half already existed) |
| Ephemeral effect | 21 | **No implementation.** |
| Roll twice | 6 | **No implementation.** |
| Fast healing | 4 | **No implementation** — rounds are not tracked. |

### Q29 — the aura lane, as built (2026-08-12)

**38 aura modes authored** (`scripts/author-aura-modes.mjs` → `scripts/data/toggle-modes.json`,
`category: 'Aura'`), plus **20 `modeAdjust` rewrites** in `effect-backfill.json`.

How "which records are auras" was decided, in order:
1. Foundry's 39 `Aura` rule elements over our live feats + class features were the EVIDENCE set that
   produced the ruling — reproduced exactly, then read against our own text one by one.
2. **12 of the 39 are not auras of their own**: they REWRITE one (seven champion-aura feats, Blessed
   Swiftness, Wide Overwatch, Glorious Banner, and the two later regalia benefits). Those became
   `modeAdjust` rows on the aura they change — Principle C — rather than 12 extra toggles. That
   leaves **27 of the 39 creating an aura**.
3. **Foundry's silence carries no information**, so our own text was scanned independently: **11 more
   aura-creating records** it does not mark, including Shield the Faithful, and the **earth** gate's
   Aura Junction — Foundry marks the Aura Junction on the other five gates and not on that one.
   27 + 11 = the 38 modes. Eight further rewriters came from the same scan.
4. Excluded by a ruling, not by taste: Survive the Wilds (lasts 1 round — **Q1**), the Lantern
   implement's umbrella record (**Ruling A**), Form Up! / Rattle the Earth (they use an aura as a
   RANGE), War Rider Stance (the aura is the dragon companion's — the companion ruling).

Numbers: **real** (the stat moves) only where the text puts no further condition on your half beyond
the aura running AND no `situationalBonuses.ts` star already claims it — 4 modes. **Conditional**
(`appliesWhen`; displays, moves nothing) where the text restricts it or a star already carries it.
**Text only** for the 23 that land on allies or enemies — Ruling F.

Two readers had to be fixed for the data to be anything but write-only: `adjustModes` looked in
`content.feats` alone, so a class feature could never rewrite a mode; and `playerModeLibrary` put
every gated content mode in the panel's "Your modes" section, which is not relevance-filtered.

⚠ Still deferred, and measured rather than guessed: ~18 kineticist STANCE impulses reshape the
kinetic aura (Thermal Nimbus, Shattershields, Winter Sleet …). They belong to the stance lane, which
already carries several of them, and were left there rather than duplicated as modes.

### Q30 — the special-statistic lane, as built (2026-08-12)

**The lane test, and the answer to "how did you decide it was not an existing stat renamed":** a
record joins only when **our own text names the statistic AND the number is not already printed on
the sheet under another label.** Both halves do work.

**Built:** `specialStatistic` on the record → `deriveSpecialStats` → a **Special statistics** rail
card with a clickable breakdown, plus `passiveEffects.specialStatBonus` for an item bonus that names
one statistic and no other. Three records authored:

| record | statistic | why it qualifies |
|---|---|---|
| `classFeatures/impulses` | **Impulse attack roll** | our own text states the formula; 18 impulse feats roll it; a *gate attenuator* raises it *"(but not to your impulse DC)"*, so it is provably not the class DC |
| `feats/kineticist-dedication` | the same, for an archetype kineticist | its own sentence grants *"kineticist class DC and impulse attack rolls"* together |
| `feats/scroll-thaumaturgy` | **Scroll DC** | the owner's second example — a DC belonging to a THING, with no row of its own |

⚠ **Gunslinger Dedication — the owner's clearest case — is an existing stat under another name, and
the app already had the lane.** `classDcGrant` → `secondaryClassDcs` → the *Multiclass DCs* rail card
shipped some time ago, and Gunslinger Dedication itself already carried the field. What was actually
broken was **data**: of 16 dedications printing *"You become trained in ⟨class⟩ class DC"*, **9 carried
nothing** (barbarian, champion, guardian, inventor, investigator, kineticist, monk, swashbuckler,
thaumaturge), and Brilliant Crafter's *"expert in your inventor class DC"* had no `classDcRank` to
raise a DC that was never granted. All ten are now authored.

`basis` names a **class DC** rather than a rank, so an archetype character resolves through the
borrowed DC and a feat that raises it raises the statistic too — which is why Expert Kinetic Control
needed no entry of its own.

**Excluded, each for a stated reason** — see `docs/mechanic-lanes.md` for the table. The one worth
repeating: the **6 deviant classifications** are 6 of Foundry's 9 `SpecialStatistic` uses, and our own
text names no deviant statistic anywhere — not the classifications, not the deviant feats, not AoN's
five Dark Archive rules pages read from the local archive. Building the number from Foundry's rule
element alone would import another implementation's ruling.

### Q31 — the multiple attack penalty, as built (2026-08-12)

The engine half was **already built** (commit 6201fcf: `mapReduction` + `mapStepFor`), and three of
the four records were authored. Measured, the lane is four — the same four Foundry marks, and the
same four our own text yields when scanned for a stated progression:

| record | progression | state |
|---|---|---|
| `classFeatures/flurry` | −3/−6, −2/−4 agile, vs hunted prey | already authored |
| `classFeatures/masterful-hunter-flurry` | −2/−4, −1/−2 agile | already authored |
| `feats/agile-grace` | −3/−6, agile only | already authored |
| `feats/combination-finisher` | −4/−8, −3/−6 agile, on FINISHER Strikes | **authored now** |

**How agile and a replaced progression are kept from compounding.** `mapStepFor` starts at the
default (4 agile / 5 otherwise) and takes the **lowest printed candidate for that agile-ness**. It
never subtracts. Each record states its own pair — Flurry prints *"−3 (−2 with an agile attack)"* —
so the matching one REPLACES the default and the agile discount can never be applied twice. Agile
Grace states only an `agileStep`, which is why a greatsword in its owner's hands is still −5/−10, and
a 17th-level Flurry ranger owning both Flurry and Masterful Hunter gets the better pair (2/1), not
their sum.

**Combination Finisher does not move a number**, and that is the ruling rather than an omission.
Whether a Strike is *part of a finisher* is a fact about the ACTION, decided at the table; no toggle
on the sheet can answer it. `whileState: 'panache'` was the tempting shape and is wrong — having
panache is what lets you MAKE a finisher, not proof this Strike is one, so it would hand the player
−4/−8 on every ordinary Strike while flush. It carries `appliesWhen`, displays, and moves nothing.

**Three fixes were needed for the progression to actually reach the strike row.** The row prints
three numbers derived from the step, and two of the four strike builders computed it from a literal
`agile ? 4 : 5` — so a battle-formed or blasting character silently reverted to −5/−10. Both now read
`mapStepFor`. And the breakdown now names the source (*"That progression comes from Flurry (hunted
prey)"*), which it never did.

⚠ **Combination Finisher's rule was hand-copied into `situationalBonuses.ts`** — the only one of the
four whose rule lived there, restating numbers held nowhere else and checked by nothing. The star is
now generated from the `mapReduction` field itself, so the row's `*`, its note and the breakdown all
read the authored numbers. Same one-registry lesson as `degreeShifts`.

### ⚠ Two lanes are built but EMPTY — CLOSED, both authored

`degreeShifts` and `battleForm` exist in the engine with **zero records authored**. Until an authoring
pass runs, the 176 degree-of-success feats and 44 battle-form feats still report as broken and the lanes
look pointless. Both are mechanical passes — no model, no design decisions, specs already settled by
Q2 and Q3.

**Both passes have since run**: `degreeShifts` carries **308 records / 348 entries**, `battleForm`
**16 modes**. See the closing note below for what the three follow-up passes changed.

---

## Round 10 — the write-only fields, closed (2026-08-12)

Three things an auditor would have reported as defects, each fixed by making the FIELD able to say what
the text says rather than by writing a reason it could not:

| was | now |
|---|---|
| `BattleForm.size` (14 modes) and `BattleForm.tempHp` (7) were authored and read by **nothing** | `deriveSize` prints the form's size on the Details tab naming the form; `toggleMode` grants the temporary Hit Points on entry and takes them back on exit. `apply-battle-forms.mjs` kept a `NO_READER` list excusing them with "it is also in the note" — a note is prose the player must act on by hand |
| a form saying **"you can't make Strikes"** could not say it — an empty `strikes` array reads as "grants none", not "removes yours" | `BattleForm.noStrikes` (7 modes: the six pest-form variants + Bone Swarm). `strikesBlockedBy` puts the reason on the Strikes tab, because an empty list with no explanation reads as a broken app (**Q27**) |
| **9 records state a DOWNGRADE** and `DegreeShift.shift` had four values that all improved | `critSuccessToSuccess`, `failToCritFail`, `oneWorse`; all nine authored. ⚠ Two of them (Dragon's Presence, the even-tempered tanuki) print both directions in one sentence and had shipped with **only the upgrade half** — showing the good news and hiding the bad |

⚠ **Q30's deviant exclusion was wrong.** It recorded that our own text names no deviant statistic. It
does — `classFeatures/flicker-deviant-classification` says *"Escape against your deviation DC"* — and
AoN rules-3506 prints the formula. What was missing was a `basis` that could express *"the higher of
your class DC or spell DC"*. The lane is now **11 records**: the three from Q30, plus the
**chronoskimmer DC** (found by scanning our own text, not in Foundry's 9) and the **deviation DC +
attack roll** on all seven classifications. Full account in `docs/mechanic-lanes.md`.

**Q31 needed nothing.** The MAP lane was measured, not rebuilt: `mapReduction` carries 4 records,
`mapStepFor` is read by all four strike builders, and Flurry and Agile Grace do change the progression
(`test/map-reduction.test.ts`). No field named `mapAdjust` has ever existed. The one real gap in that
area is **Furious Focus**, whose clause changes how many MAP steps an ACTION spends rather than what
the steps are — no `step`/`agileStep` pair can say it, and it is now a marker on Vicious Swing (Q8).
