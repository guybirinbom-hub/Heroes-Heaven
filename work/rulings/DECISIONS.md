# Situational-bonus rulings (owner decisions, 2026-07-29)

Answers to the nine policy questions blocking the last 280 situational records.
Applied by scripts/apply-rulings-*.mjs. Each entry records the decision AS GIVEN, not a paraphrase.

## A — Umbrella records (24 records) — DECIDED

> "the summery of all of the items shouldn't be an option for the characters, it's not a real
> item so they shouldn't even see that, they should only see the options they can have"

1. Umbrella/summary records get NO situational entries.
2. They are also HIDDEN FROM PICKERS — the player should only ever see the grades they can own.

Hidden, not deleted: a character who picked one while it was visible must keep resolving it,
same rule as the `aon-` duplicate suppression.

Test: an umbrella record has no price and a graded twin at the same base name.

## B — A flat bonus the rules restrict (31 records) — DECIDED

> "Move it to a star"

The bonus leaves `passiveEffects` (where it applied to EVERY check of that stat) and becomes a
situational entry with the printed restriction in its `when`. The stat's total returns to the
correct number; the restricted bonus is one click away.

Examples fixed: Gaze of the Mantis (+2 was on every Perception, text says VISUAL Perception),
Maestro's Instrument (+3 on every Performance, text says while playing music), Camouflaging
Chromatophores (+2 on every Stealth, text says to Sneak and Hide).

## C — Which skill an action-named bonus hits (27 records) — DECIDED

> "Star every skill that could do it."

Option 2. Specialist's Ring stars Arcana + Nature + Occultism + Religion (every skill that can
Recall Knowledge / Identify Magic), not Arcana alone. Eye of the Wise stars every skill that can
perform one of its six named actions. The `when` still names the action, so the player knows when
it counts.

## ★ CROSS-CUTTING — how the star list handles stacking — DECIDED

> "if there are multiple bonuses from the same type only show the highest one (if i have +1 item
> bonus and a +2 item bonus it will only show the +2) if they work at different times show them
> both under the * but if they work at the same times but one is higher show the higher, remember
> different types of bonuses stack so for example item and status bonuses stack. this rule for
> penalties too"

PF2e stacking, applied to the DISPLAY list — not just the maths:
  - same type + same trigger -> show only the best bonus (and only the worst penalty)
  - same type + different triggers -> show both, because you may have one and not the other
  - different types -> always both, they stack
  - penalties follow the same rule, worst-wins

NOTE: the computed totals ALREADY do this (modes.ts poolTypedMods: best bonus + worst penalty per
type, untyped summed). What does NOT is the situational list — explain.ts featSituationalStrings
maps every registry entry to its own line with no pooling.

⚠ ONE PART IS NOT MACHINE-DECIDABLE: "do these two work at the same time?" compares two free-text
`when` strings. Identical/equivalent triggers can be collapsed automatically; genuinely different
wording cannot be proven to overlap. Plan: collapse same-type entries with equivalent triggers to
the best one, show the rest, and label a same-type group so the player knows only the highest of
them applies rather than adding them up.

## ★ CROSS-CUTTING (amended) — stacking display, simplified

> "show both if the string doesn't match. you don't need to go over every type of circumstantial bonus."

Simpler than my proposal: compare the `when` strings. Identical -> keep the highest of that type.
Different -> show both. No attempt to reason about whether two differently-worded triggers overlap.

## D — Bonuses with no stat row (32 records) — DECIDED, new approach

> "Magic Hands show the d10 in () in the treat wounds action. with a * linking to the feat
>  Black Powder Boost show the +10 in (). with a * linking to the feat
>  The Survivor add a * on the dying condition linking to the feat."

REJECTED my option 1 (build generic stat surfaces) AND option 2 (star the nearest roll). Instead:
attach the marker to the THING IT MODIFIES — the action, or the condition — and show the changed
value inline in parentheses, with a `*` that links to the source feat.

  Magic Hands   -> Treat Wounds action, healing shown as "d10 ( )", * -> Magic Hands
  Black Powder Boost -> Leap action, "+10 feet ( )", * -> Black Powder Boost
  The Survivor  -> Dying condition, *, -> The Survivor

This needs two new marker surfaces: ACTIONS and CONDITIONS. Both already render on the sheet.

Owner asked to be shown any of the 32 that don't obviously fit this pattern.

## D (continued) — DC-only bonuses — DECIDED

> "Six-Fingers Elixir add a * in the reflex description pop up that says the effect and that it
>  only effects the dc.
>  Potion of Disguise - don't add a place for this the user will need to remember. there is a
>  setting that shows dcs make sure they fit the correct number, if they need a situational bonus
>  to the dc have a * next to the dc displayed"

SAVE DCs (Six-Fingers Elixir, Stalwart's Banner, Living Leaf Weave, Mountain Stance, Gelid Shard,
Commander's Banner):
  - the entry appears in the SAVE's breakdown popup, worded so it plainly says it affects the DC
    and not the check
  - `showSaveDCs` (Customize -> "Show save DCs", default off) renders "DC 10+mod" beside the save;
    when a DC-only bonus applies, the `*` goes NEXT TO THE DC, not next to the save name
  - verified the shipped formula is right: VitalsRail renders `DC {10 + d.modifier}`, which is the
    PF2e save DC

SKILL DCs (Potion of Disguise x4, Olfactory Obfuscator, Field Propagandist): NO surface. The player
remembers these. Not starred anywhere.

Needs a new flag on SituationalTarget to mean "this hits the DC, not the roll", so the star can be
placed on the DC and the wording can say so.

### D leftovers, resolved without a further ruling
  - anti-dragon-barding x2 -> it is the COMPANION's armour; defers to ruling F (whose sheet)
  - explosive-death-drop  -> not a design question: the importer stripped the skill name out of
                             "Roll an ___ check". A data bug, fixed on its own.
  - lightweave-scarf x2   -> ambiguous printed sentence; taking the NARROWER reading (saves against
                             illusions only, not your own Deception) unless the owner says otherwise

## E — Consumables (23 records + every other consumable) — DECIDED, expanded scope

> "create modes for all of the items that effect the user temporary and when you use them the mode
>  activates. make the mode invisible to the user in the modes search. these need to effect the
>  character sheet in the correct way you need to go over every consumible to make sure that. for
>  things like healing elixser that just give hp dont do anything but for things like Soothing Tonic
>  that effect the user every round show a mode called healing bu that mode dosent do anythings so
>  things that effect the user character sheet over the periud of the mode are need to be
>  implemented but things that effect stuff like hp or damge need to not effect the character sheet
>  if they put the user in a situation for a piriud of time then creat a mode that shows that but
>  dosent do anything only display so the user can se what effecting them"

THE RULE, as three cases:
  1. instantaneous only (a healing potion restores HP and ends)      -> NO mode at all
  2. ongoing effect that CHANGES SHEET NUMBERS for a duration        -> mode WITH real modifiers
  3. ongoing state that does NOT change sheet numbers (fast healing,
     persistent damage, "you are concealed")                          -> DISPLAY-ONLY mode: it shows
     what is affecting you and modifies nothing

HP and damage never move sheet stats, even inside a mode.
Modes created this way are HIDDEN from the Modes manager/search — they belong to the item, not to
the player's own mode list.
Scope is NOT the 23 escalated records: it is EVERY consumable that temporarily affects the user.

What the Modes system already gives us: `modifiers` (case 2), `note` (case 3 — "effects that aren't
captured as numeric modifiers"), predefined + gating, exclusiveGroup.
What is missing: (a) a hidden-from-manager flag, (b) an activate-on-use hook.

## E (continued) — how the consumable modes behave — DECIDED

> "add a use buton on concumibles that make the amount go one down ro if its the last one then
>  remove the item. the modes need to have an x like the rest of the modes in the app. also needs
>  to clear on rest unlses the consumible syes other wise, the modes needs to be clickble to show
>  the description , every thing effected by the mode needs to be higlited ( also for every other
>  mode )"

  1. USE BUTTON on consumables: quantity -1; at the last one, remove the item from inventory.
     Using it activates the item's mode. (There is no Use control today, only a +/- stepper.)
  2. The mode appears as an active pill with an X — ALREADY TRUE, VitalsRail renders activeModes as
     `cond-pill mode-pill` with a deactivate button, so consumable modes inherit this for free.
  3. CLEARS ON REST, unless the consumable's own text says otherwise (e.g. "until your next daily
     preparations" survives, a 1-minute elixir does not).
  4. The pill must be CLICKABLE to show the description. Today the description is only a `title`
     tooltip — NEW.
  5. ⭐ EVERY STAT A MODE AFFECTS IS HIGHLIGHTED — and this applies to ALL modes, not only consumable
     ones. NEW: today `.has-mode` is driven by statHasSituational, which only fires for CONDITIONAL
     mode modifiers (those with `appliesWhen`). An unconditional active mode silently changes the
     number and marks nothing.

SCOPE MEASURED: 1,912 consumables, 859 of which name a duration and so need reading against the
three cases above. This is a pass in its own right, not a data patch.

## F — Bonuses that land on someone else (17 + 3 from E) — DECIDED

> "if its an effect the effects a teamate and not you then dont do anything, if its active to a
>  limited to an amount of time then add mode to the user that activated the thing that let the
>  user kniows its activbe but it wint actually do anything"

  1. The bonus goes to a teammate, not you -> NOTHING on your sheet. No star, no modifier. The
     feat's own description already says what the ally gets.
  2. BUT if it runs for a LIMITED TIME, the character who activated it gets a DISPLAY-ONLY mode so
     they can see it is running. It changes none of their numbers.

Same display-only mode shape as ruling E case 3, so both use one mechanism.

Examples: Tweak Appearances (+1 item to the TARGET's Diplomacy/Performance, "while speaking to that
audience" -> display-only mode on the speaker); Aegis for the Innocent (+1 status AC to the target);
Endemic Herbs and the other crafting feats (the eater gets the bonus, never the cook).

⚠ STILL OPEN: companion-worn items (anti-dragon-barding x2, and 2 earlier companion records). A
companion is not a "teammate" in the sense above — it is yours, and the app HAS a companion block
with its own stats. Asked twice, not yet answered.

## G — Which record carries the mark (2 records) — DECIDED

> "Relic set: the set entry replaces the piece's, so you read one line, not two.
>  Distant Grasp: on the spell, since that's what you're looking at when you cast it."

Both as recommended. General principle: the mark lives on the thing you are looking at when it
matters, and a set/upgrade REPLACES the entry it upgrades rather than sitting beside it.

## ★ COMPANIONS — DECIDED (answers the twice-asked question, and widens it)

> "stats for companions. familers do activate on the companion stat blocks. about items that effect
>  the familer they need to be in the inventory of it (i say familer i mean every companion) instead
>  of your inventory unless an item says otherwise."

  1. A companion item's bonus marks the COMPANION's stat block, not the character's.
  2. Items that affect a companion BELONG IN THE COMPANION'S INVENTORY, not the character's —
     unless the item's own text says otherwise.
  3. "familiar" here means every companion type: familiar, animal companion, eidolon, mount, …

Already built: `CompanionConfig.inventory` exists and `companions.ts companionGear()` reads it for
bulk, invested speedBonus, worn armor (AC / Dex cap / check + Speed penalties) and equipped weapon
strikes. CompanionsTab already lists `cfg.inventory`.

NEW work: (a) a situational-marker surface on the companion block — companion items with
conditional bonuses (anti-dragon-barding) currently mark nothing anywhere; (b) routing
companion-affecting items into the companion's inventory rather than the character's.

This also retires the earlier "companion situational bonuses never display" finding, which had been
closed as not-a-bug on the grounds that those two records were the companion's and the PC had no
business showing them. That reasoning still holds for the PC — the answer is that the COMPANION
should show them.

## H — Wording and verbosity (6 records) — DECIDED

> "keep it open. Star all saves, and the note says 'saves that require you to smell or taste.' You
>  decide at the table.
>  cap the note at about one line; anything longer gets trimmed to its essential trigger, with the
>  full text staying in the item's own description a click away. ( have a place to click to open the full )
>  ...Does the wearer take their own penalty? ( dosent effect the user)"

  1. WHERE THE RULES ARE OPEN, STAY OPEN. Bootstrap Respirator stars every save with the printed
     trigger as its note. Narrowing it to Fortitude would put my ruling on the sheet dressed as the
     book's.
  2. NOTE LENGTH: cap at roughly one line. A longer condition is trimmed to its essential trigger,
     and gets a CLICK TARGET that opens the full text (the record's own description). New: today a
     long `when` just renders in full.
  3. DEMON'S KNOT: the -1 status penalty does NOT apply to the wearer, only to other creatures
     within 30 feet. (Owner overruled my suggestion, which had been to apply it to the wearer too.)
     Consequence: no star on the wearer's Will save.

## I — Bonuses that name no save (4 noqual records) — DECIDED

> "i want this to not do anything but insted i want to add a button that lets the user do heavy
>  editing to utems alllowing them to create * or other effects that effect anything in any
>  situation this needs to be behind a button that opens advanced setting on the item editing"

  1. NOQUAL: star nothing. The rules name no save and no trigger, and raw ore in a pack protects
     nobody. The description still explains what noqual is.
  2. NEW FEATURE instead — an ADVANCED section in the item editor: let the PLAYER author their own
     situational markers and effects on an item, targeting anything, under any condition. Behind a
     button so the ordinary editor stays simple.

Where it goes: `src/sheet/ItemEditorModal.tsx`, already reachable from the Inventory tab and from
the Homebrew page. The authoring shape is SituationalBonus (targets[] + when + bonus), which is the
same shape the built-in registry uses — so a hand-authored entry renders identically to a shipped
one, including the stacking rules from the cross-cutting ruling.

This is the general answer to every "the app can't express this" case: rather than guessing a
mapping, give the player the tools to say exactly what they mean.

## D leftovers — target-side bonuses — DECIDED (2026-07-30)

> "this dosent need to have an effect the player will tel the gm"

BOMBER'S EYE ELIXIR (lesser + greater) and EXECUTION POWDER: no surface, no effect, no star.
Each of these changes a number belonging to the TARGET — the circumstance bonus to AC the target gets
from cover — and the app models neither target AC nor cover. The player tells the GM at the table.

VERIFIED INERT: none of the three appears in the situational registry, carries a mode, or has
passiveEffects / a situational field (scripts/check-inert.mjs). Nothing to build; nothing to undo.

Still open: `weapon-innovation` only. See the explanation below.

## Weapon Innovation — the one genuinely homeless record

The chain, and why no existing surface fits:

  Inventor  ->  Weapon Innovation (class feature)  ->  choose 1 of 11 INITIAL WEAPON MODIFICATIONS
            ->  if that choice was SEGMENTED FRAME  ->  Interact to collapse the weapon to light Bulk
            ->  only THEN: "+2 circumstance bonus to Stealth checks and DCs to hide or conceal it"

Three separate reasons it cannot be starred today:
  1. The bonus is not Weapon Innovation's. Starring the feature would hand +2 Stealth to every
     inventor, including the ten in eleven who chose a different modification.
  2. The app does not record WHICH modification was chosen. `classFeatures/weapon-innovation` has no
     effectChoices and no extraChoices — verified — so there is nothing to gate the bonus on.
  3. Even with the choice recorded, the bonus applies only WHILE COLLAPSED, which is a per-moment
     state, not a permanent property.

It is buildable, out of parts that already exist:
  (a) an effectChoices picker on weapon-innovation for the 11 modifications (the generic
      choose-one-of-N picker already ships), then
  (b) a two-state mode for Segmented Frame (collapsed / normal), carrying the +2 Stealth — the same
      mechanism as a stance.
Not started; awaiting the owner's go-ahead.
