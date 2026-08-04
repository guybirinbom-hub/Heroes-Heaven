# Round-2 rulings (owner decisions, 2026-07-30)

The 516 escalated decisions triaged down to 12 questions in 5 patterns. Each entry records the
decision AS GIVEN, not a paraphrase. Continues [[DECISIONS.md]] (rulings A–I).

## K — Choices the app drops on the floor (5 records) — DECIDED

> "if its somthing the player only choses once during the building add a place to selet it and
> record the pick, if its somthing they can change during play using and action or during dayly prep
> ( not including retraning and lv up ) then we need a place to accsses it and change it in the
> caracter sheet. 'Athletics gets the star, the other nine skills stay clean.'"

**This is a general policy, not five one-offs.** Every unrecorded choice is classified by WHEN it
can change:

| when it can change | where it lives |
|---|---|
| once, during building | a pick in the BUILDER; record it |
| by an action, or at daily preparations | a control on the CHARACTER SHEET, changeable in play |
| retraining / level-up only | builder — these do NOT count as "changeable in play" |

Never star every branch (ruling A already forbids it): the chosen branch is starred, the rest stay
clean.

**Classification of the five, from the rules text:**
- `weapon-innovation` — builder. Only `reconfigure` changes it: 1 day of downtime + a Crafting check,
  which is retraining-shaped, not an action or daily prep.
- `aon-emotion-surge` — builder (the emotion is a property of the relic; no change language).
- `thaumaturges-demesne` — builder, free text (`choice.kind:'text'` exists, types.ts:631).
- `dragon-deviant-classification` — builder ("when you gain a deviation, choose a damage type"; the
  daily-prep language in that record is about backlash reset, not the choice).
- `lurlup` sanctification — builder.

⚠️ **Two neighbours the policy CATCHES and which are not yet built:** `offensive-boost` picks its
weapon *during daily preparations*, and `infinite-invention` changes innovation type *during daily
preparations*. Both need a sheet control, not a builder pick.

⚠️ **Recording the pick does NOT commit to the subsystems behind two of them** — Deviant Abilities
strain tracking, and a ~485-deity sanctification backfill. Separate decisions.

## L — Cursed items (2 records → a real GM feature) — DECIDED

> "curssed items exist in the player options, when they are selected by players the effect the
> character sheet like they should, but if a gm puts a cursed item on a player and this cursed item
> is hidden … they wont see the penilty it wont effect thire character sheet, but in the party
> dashboard or when the gm views the character sheets he will see the effects"

> "it show the player the same item as the non cused virsion and if that item has bonusews apply thos
> bonuses on the character sheet whats importent is that on the chracater in the gm view the
> penilties match whatt he character actuall nukmber is so in waht the gm sees the charcater dosent
> get the bonuses because the arent real in the game, for the player they are real so that they cant
> tell the diffrance but the gm will see the real thing"

1. **Player-chosen cursed item** → behaves normally: the curse applies and is visible. No change.
2. **GM-planted HIDDEN cursed item** → the player sees the UNCURSED TWIN in full: its name, its
   description, and **its bonuses actually applied to their sheet**. The player cannot tell.
3. **The GM's view of that same character shows the TRUE numbers** — the fake bonuses are absent,
   because they are not real in the game. Visible in the party dashboard and when the GM opens the
   sheet.
   → **This means the sheet must be derived TWICE: a player-facing derivation and a GM-facing one.**
   That is the real engineering cost of this ruling.
4. **Disguise source** — from the data: a cursed item names its uncursed twin. PLUS the Homebrew item
   editor gains the ability to author a cursed item paired with an uncursed duplicate.
5. **Scope** — only cursed items whose text describes a disguise (not all 75 cursed items, not any
   item).
6. **Stuck items** — if an item cannot be removed, attempting to delete it opens a dialog telling the
   player to ask their GM for permission, WITH a Remove button that still works. The app does not ask
   the GM; the dialog exists so the player knows to.

## M — Aura you might not be standing in (2 records) — DECIDED

> "Permanent star"

Both Singing Shortbows: a permanent star on the affected saves, note carrying the positional
condition. Not a mode-gated star, not a display-only pill.

## N — Bonuses belonging to something that is not your sheet (2 records) — DECIDED

> "Crafting star"

`artillerist-dedication` → a star on Crafting, with a note covering all four checks (Load, Aim, move,
Repair). No companion-block marker surface is built for this.
`canary-tail-first-week` → ruling D already covers it (the player remembers). ⚠️ Its three existing
situational entries are DEAD CODE — services never enter inventory and item situationals only fire
while equipped/worn/invested (explain.ts:180-182). **Retire them.**

## O — Battleforger (1 record) — DECIDED

> "if you are a Battleforger or you have a Battleforger in your party you have the option in editing
> an item to do this and it has a indicator on the item card and it gets removed after daily prep"

Build the expiring rune:
1. Available in the ITEM EDITOR when the character has Battleforger **or a party member does**
   (campaign-aware — a party-wide capability, not only self).
2. Grants the +1 potency rune's real numbers (+1 attack, or +1 AC for armour).
3. An indicator on the item card marks it as temporary.
4. Cleared at daily preparations (`rest()` already has the hook, task #24).
5. Not a situational star — it can never say which item, and it would fire for characters the feat's
   own last sentence excludes (gear that already has a potency rune).
