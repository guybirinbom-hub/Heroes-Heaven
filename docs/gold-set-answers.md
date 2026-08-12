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
