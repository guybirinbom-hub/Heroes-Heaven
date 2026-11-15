# Sheet boxes: the parts every layout is built from

Started 2026-10-24, for layout A (plan.md section 2). Guy likes all three grey structure options (A two
columns on the left, B a band across the top, C two pages side by side) and wants "extreme customization"
at the end. So each section of the PC sheet is built ONCE as a box, and a layout preset only says which
slot each box sits in. A comes first, then B, then C, then free move and hide (fixed slot widths only).

Code: `src/data/sheetBoxes.ts` (the box list, layout A, the mapping of saved settings, the one-time notice,
which layout setting wins). Test: `test/sheet-boxes.test.ts` (fails if a rail card has no box, if a saved
setting maps wrongly, or if a saved order could move the always-in-view boxes).

## The boxes

Today's sheet has 12 rail cards (`DEFAULT_RAIL_ORDER`, `src/data/customization.ts`; drawn in
`src/sheet/VitalsRail.tsx`) and the Main tab (`src/sheet/MainTab.tsx`: Ability scores, Skills, Pinned, the
actions card). Several rail cards hold more than one thing; the "hp" card holds Hit points, Armor Class
with the shield, and the Class DC / spell DC tiles. The boxes split them, and add the parts the grey
options left out. Every box keeps everything its old card shows today; "What it holds" lists it so the
build drops nothing.

| Box | What it holds | Comes from (today) | Layout A | Shows |
|---|---|---|---|---|
| hp | current / max HP, temp HP, the HP bar, Heal and Damage (or the one-line entry); on the phone the XP chip or line and the numpad with its IWR buttons. Dying and the death threshold show in the conditions box (the Dying pill, its recovery DC and "Dead"), as today | rail `hp` | column 1 | always |
| ac | Armor Class (with the shield bonus while raised) and its breakdown star | rail `hp` | column 1 | always |
| shield | its own box (Guy, 2026-10-24): the shield's name (opens the item card and editor, where the runes line lives), the "+N AC" bonus, HP, Hardness, broken threshold, Broken / Destroyed badge, Repair and Damage with auto-Hardness. New in A: a Raise button (today Raise a Shield is only a mode) | rail `hp` | column 1, under Armor Class | with a shield |
| dcs | Class DC, spell DC, spell attack, spell damage when something changes it | rail `hp` | column 2 | always |
| perception | Perception, its DC when "show DCs" is on, its situational star | rail `saves` | column 1, paired with hero points | always |
| heroPoints | hero points (tap a pip to spend or fill) | rail `movement` | column 1, paired with Perception | always |
| initiative | initiative, only when something changes it from Perception, with its popup | rail `movement` | column 1, paired with reactions | with content |
| saves | Fortitude, Reflex, Will, their DCs when on, situational stars | rail `saves` | column 1 | always |
| speed | Speed, other speeds, the temporary-speed flag | rail `movement` | column 1, paired with senses | always |
| senses | senses with ranges, notes for one stimulus only | rail `movement` | column 1, paired with speed | always |
| reactions | extra reactions: a star and no number (Guy's ruling 2026-09-16, `VitalsRail.tsx`), the star opening which record gives them and what they may be spent on | rail `movement` | column 1, paired with initiative | with content |
| conditions | active conditions with values and steppers, the dying recovery DC, the "Dead" state, ruling-D markers, derived conditions with a lock and no remove, the Add button and the conditions picker, and (new in A, Guy 2026-10-24) quick-add chips; active modes as pills that open their detail | rail `conditions` | column 1 | always |
| attributes | the six attribute modifiers, the score, the partial-boost mark | Main tab | column 2 | always |
| skills | every skill and Lore: rank, total, situational star, Assurance, "today" for a daily rank, "via" another skill, the armor check penalty badge | Main tab | column 2 | always |
| iwr | resistances, weaknesses, immunities in full, void healing, the situational resistances row | rail `defenses` | column 2 | with content |
| resources | class resources (counters and toggles) | rail `resources` | column 1 | with content |
| archetypeDcs | class DCs from archetype dedications | rail `multiclassDc` | column 2 | with content |
| specialStats | special statistics (impulse attack, scroll DC) and their basis | rail `specialStats` | column 2 | with content |
| panache | one-tap states: Rage, Panache, Hunt Prey, Unleash Psyche, each with what entering it grants | rail `panache` | column 1 | with content |
| champion | the champion's cause (opens its tenets, reaction and aura) | rail `champion` | column 1 | with content |
| mythic | mythic points with the Rewrite Fate note, calling and destiny, the Rules shortcut | rail `mythic` | column 1 | with content |
| languages | languages, with "recalled today" marks | rail `languages` | column 1, hidden by default | when shown |

The page slot holds the pages: Actions (from the Main tab: Pinned, the actions card with its Strikes /
Actions / Skills / Items subtabs, the stance and form bar, the Encounter / Exploration / Downtime lists and
Camping, the search, the action-cost filters, the Alchemy panel), Spells, Inventory, Feats & features,
Companions, Notes, Details. The Details page always lists languages in its own section, which is not a
box, so hiding the Languages box never takes them off Details.

**Guy, 2026-10-27 (round 4 of the looks):** the `dcs`, `archetypeDcs` and `champion` boxes leave the
always-in-view columns. "the attack bonus and spells dc and class dcs dont need to be there they are used
alot but they apear in the place where you cast spells or attack ( we will find a place for the class dc
later ) so thy take important relastate. also causes dont neeed to be there its somthing that teh players
knows he dosent need to check." Nothing is lost: spell DC and spell attack show on the Spells page, attack
bonuses on each Strike, the cause on Feats & features. Still open: where the class DC (and archetype class
DCs) go. `specialStats` was not named; it stays until Guy says. Also: "resitinces is important but most
players dont have it", so the `iwr` box must look right with nothing in it hidden and with several lines;
the speed and senses boxes must hold several speeds and senses. Every box must work in any slot of
layouts A, B and C: "i dont want a staatic placement ... we need to design it in some kind of blocks".

Pairs: layout A puts Perception with hero points, initiative with reactions, and speed with senses, side
by side on one line. The measured fit depends on it. When one half of a pair is hidden or has no content, the other half takes the
whole line.

## Saved settings: old to new (before A ships)

Players saved Customize settings by keys that are frozen. Layout A READS them (`boxesFromLegacy`,
`pageFromLegacyTab`, `pagesHiddenFromLegacy`) and writes nothing on load (a load is not an edit). Where a
saved choice can't be kept, the player is told once (`layoutChangeNotes`), so nothing changes silently.

| Saved setting | Means in layout A |
|---|---|
| `railHidden` | carried over. A box is hidden exactly when the old card it comes from is hidden: hiding `hp` hides Hit points, Armor Class and the DC box; hiding `saves` hides Perception and the saves; hiding `movement` hides hero points, initiative, speed, senses and reactions. A hidden box keeps its place for when it is shown again. Skills and attributes came from the Main tab, which could not be hidden, so they start shown. |
| `railOrder` | NOT carried over. The old rail was one column; layout A's order is Guy's priority list in two columns. The Customize editor writes all 12 keys on any move, and the old default order has Conditions 11th of 12, so re-sorting by a saved order would push Conditions and the other always-in-view boxes off screen for exactly the players who customized. A player whose saved order differs from the default gets a one-time notice: "The sheet has a new layout, so your own order of the side cards was not kept. Hidden cards stay hidden. You can move boxes again in Customize." |
| Languages | the Languages box starts hidden in column 1; the Details page shows languages anyway. Every player who had Languages on the rail (did not hide it) gets a one-time notice: "Languages moved to the Details page. You can show the Languages box in a column again in Customize." Exception: a player who hid the Details page and kept Languages on the rail keeps the Languages box shown in column 1, and gets no Languages line. |
| `defaultTab` | 'Main' reads as 'Actions'; every other tab keeps its name. The remembered last tab is read the same way. |
| writing tabs | the PC stores its Actions page as 'Main', in `defaultTab` and in the remembered tab (`storedTabFromPage`). On the phone 'Main' is the stats page and 'Actions' a page of its own, so storing 'Actions' would change the phone's opening page. |
| `hiddenTabs` | every hideable tab kept its name, so hidden stays hidden. Actions, like Main, can never be hidden. |
| `notesShowRail` | whether the columns show on the Notes page (default off, as today). |
| every other option | unchanged: they belong to boxes, not to slots (HP entry, IWR buttons, shield auto-Hardness, save DCs, plus signs, compact actions, inventory options, the header options, the per-character look). |

The notice reads the EFFECTIVE settings (`effectiveCustomization(global, override)`), so a card order or
hidden Languages set in Settings → Appearance counts as much as one set on the character. It lists only
the lines that apply and stays until the player closes it. The order line is about one character: closing
it may store a stamp on that character (the way the skill-order notice does, `src/rules/skillOrderNotice.ts`),
so it never comes back on any device. The Languages line says the same thing for every character, so it
shows once per device, not once per character. Opening the sheet alone writes nothing.

## Where the layout is stored and who reads it

- The layout follows the same two levels as every Customize option: a device default (Settings →
  Appearance; the global customization, which also syncs to the account) with each character's own
  override on top (the Customize drawer). The new editor (plan.md section 7b) stores its result in a new
  key, `pcLayout`, and never writes `railOrder` / `railHidden`.
- Which setting wins (`layoutSource`): the character's own `pcLayout`; then the character's own hidden
  cards (`railHidden`; a saved `railOrder` alone does not count, because layout A does not use it); then
  the device default's `pcLayout`; then the device default's rail settings.
  The two levels are read separately, because the usual merge (`effectiveCustomization`) would let a
  device `pcLayout` silently undo a character's own hidden cards.
- The phone ignores `pcLayout` completely until the phone section (plan.md section 11). It keeps today's
  phone sheet, which still reads `railOrder` / `railHidden`. A PC layout can never reach the phone.

## Fold rules

"Room" is the width the sheet really has in CSS pixels: the window width divided by the zoom. The app's
zoom is CSS `zoom` on `<html>` (`src/theme/zoom.ts`), and CSS media queries ignore it, so the sheet
measures its own size (a ResizeObserver) and picks the fold from that. Which measuring call reports CSS
pixels under zoom must be tested at zoom 2.0 when this is built. Measured on the grey sample with the full
test champion; pictures in `C:\trying ai 2\hh-redesign-references\section-always-in-view\`.

| Room | Column 1 (226 px) | Column 2 (204 px) | Page | Seen at |
|---|---|---|---|---|
| window 720 px or less (CSS px, zoom ignored) | the phone sheet takes over (`useIsMobile`, sheet.css); none of the rows below apply | | | website in a narrow window, phones |
| 1100 px or more | shown | shown | the rest (738 px at 1200) | 1200 and 1440 wide |
| 860 to 1099 px | shown | shown, skills still in view | the rest (438 px at 900), in its narrow form; tabs that don't fit go behind the tab strip's arrows | 900 wide, zoom 1.0 |
| 640 to 859 px | shown, with column 2's boxes folded under it (skills right after conditions) | folded into column 1 | the rest (470 px at 900 and zoom 1.25) | 900 wide at zoom 1.25; 1200 at zoom 1.5 |
| under 640 px | opens as a "Stats" panel from a button in the page's top line | inside that panel | the whole width, with a one-line summary on top: HP, AC, conditions | 900 wide at zoom 2.0 (450 px); only reachable at a zoom above 1, on a window wider than 720 |

| Height | Rule |
|---|---|
| 700 px of room or more | full boxes |
| under 700 px (600 tall at zoom 1; 800 tall at zoom 1.25) | attributes become one row of six; skill rows go from 23 to 20 px; Perception, hero points, saves, speed and senses become one-line boxes; the quick-add condition chips hide (the Add button stays). Each column scrolls on its own. |
| skills still don't fit | the attributes box moves below the skills box, then the skills box scrolls inside itself with its heading kept on top. Skills are used more than attributes (Guy's notes). |

What this costs, honestly:
- At 900 x 800 the page is 438 px wide: every page needs a narrow form. Layout C needs the same (its
  pages are about 365 px), so it is built once for both.
- Between 640 and 859 px of room, skills are one scroll away; they can't stay in view next to a usable page.
- Under 640 px the columns are one click away. It works; it is not pretty.
- The top bar and the identity row wrap at zoom 1.25 and 2.0 in the grey sample, and the window buttons
  are pushed off screen at 2.0. They are sections 6 and 7; the fold rules there must drop button labels to
  icons and move the rest into a menu.

## Fit (proof with a full test character)

The test character is real app data: `e2e/visual/make-redesign-fixture.ts` builds "Test Champion" with the
app's own `buildCharacter()` and writes `e2e/visual/fixtures/redesign-champion.json` (a separate file; the
screenshot tests' `roster.json` is untouched). Level 8 Forge Dwarf champion of Justice with Free Archetype:
Fighter and Swashbuckler dedications (class DCs 24 and 22, panache), 20 skills (16 plus 4 Lores), fire 4
and slashing 3 resistance, a raised steel shield at 65/72, HP 73/122, frightened 2, wounded 1, off-guard,
2 hero points, an extra reaction (Quick Shield Block). Pictures of today's sheet with it: `C:\trying ai 2\hh-redesign-references\today-sheet-champion\`
(take them again with `node scripts/redesign-capture.mjs`).

The grey sample (`C:\trying ai 2\hh-redesign-references\section-always-in-view\always-in-view-A.html`) shows
that character's numbers. `?worst=1` adds what it lacks but a full character can have: an initiative change
and a 4th condition.

The table below was measured on the first grey sample, while the shield sat inside the Armor Class box.
The fresh sample (2026-10-24, `always-in-view-A-v2.html` in the same folder, shield in its own box) was
measured again; its numbers are under "Fit of the fresh sample".

| Size | Column 1 | Column 2 | Skills |
|---|---|---|---|
| 1200 x 800 | every box shown, 31 px spare (worst case: 7 px spare) | every box shown except the last 16 px of the resistances box | all 20 in view (bottom at 648 of 792 px) |
| 1200 x 600 | all of Guy's always-in-view list shown, conditions and modes included (conditions end at 546 of 592 px; worst case 570); panache and cause one scroll away | attributes and all 20 skills shown; the DC and resistance boxes one scroll away | all 20 in view (bottom at 571 of 592 px) |
| 900 x 800 | as at 1200 x 800 | as at 1200 x 800 | all 20 in view; the page is 438 px |

Limits: at 1200 x 600 the skills box has 21 px left, so one more Lore (a 20 px row) still fits and a 6th
Lore needs the "skills still don't fit" rule above. At 1200 x 800 a 5th Lore or a 3rd resistance pushes
the last box of column 2 further down. The always-in-view boxes are at the top of column 1 and skills at
the top of column 2, so they never leave the screen first.

### Fit of the fresh sample (shield in its own box)

Guy, 2026-10-24: design fresh; only what is shown carries over. The fresh grey sample makes each column
one surface with boxes split by thin lines, puts Armor Class and the three saves in one strip, gives the
shield its own box under that strip (HP bar with the broken mark on it, Hardness, Raised, Damage, Repair),
shows Perception and hero points as a two-cell strip, and draws conditions as tiles (the value is the
biggest thing) with quick-add chips under them. Worst case (`?worst=1`): an initiative change, a 4th
condition, a locked condition (Encumbered from Bulk) and a weakness. `&dcs=1` shows the save DCs. Bottom
of the room: 792 px at 800 tall, 592 px at 600 tall (in CSS px).

| Size | Column 1 | Column 2 | Skills |
|---|---|---|---|
| 1200 x 800 | every box shown, ends at 698 (94 px spare); worst case 745 (47 spare); worst case with save DCs 771 (21 spare) | every box shown, ends at 756 (worst 777) | all 20 in view (bottom at 611) |
| 1200 x 600 | all of Guy's always-in-view list shown: conditions end at 506 (worst 567); panache and cause one scroll away | attributes and all 20 skills shown; the DC and resistance boxes one scroll away | all 20 in view (bottom at 551) |
| 900 x 800 | as at 1200 x 800 | as at 1200 x 800 | all 20 in view; the page is 438 px |
| 900 x 800, zoom 1.25 (720 px room) | column 2 folds under the conditions (attributes, then skills); one column scrolls | folded | one scroll away |
| 900 x 800, zoom 2.0 (450 px room) | behind the Stats button; the page shows HP, AC and conditions in one line | inside the Stats panel | inside the Stats panel |

**Guy's choices on the fresh sample (2026-10-24, after seeing both options side by side):**
- A card for every box, with a small gap between cards (`?cards=1`), not one surface per column.
- Armor Class in one strip with Fortitude, Reflex and Will.
- Conditions as tiles, the value the biggest thing.
- Raise a Shield shows only in the shield box (its Raised button); the modes line does not repeat it.

Fit with cards (the chosen form; under 700 px of height the gap between cards drops from 6 to 3 px):

| Size | Column 1 | Column 2 | Skills |
|---|---|---|---|
| 1200 x 800 | every box shown, ends at 754 (38 px spare); worst case: the cause box is 9 px under the edge (one small scroll) | every box shown, ends at 784; worst case the weakness line is 13 px under | all 20 in view (bottom at 618) |
| 1200 x 600 | all of Guy's always-in-view list shown: conditions end at 531; worst case exactly at the edge (592, no spare) | attributes and all 20 skills shown | all 20 in view (bottom at 555) |

Limit: at 1200 x 600 a 5th condition, or save DCs switched on, pushes the bottom of the conditions box
under the edge. The build must then shrink the tiles further (one line per tile under 700 px) rather than
move conditions down.

Today's sheet with the same character, for comparison: at 1200 x 800 the conditions are below the fold of
the rail, and the borrowed Fighter and Swashbuckler class DCs show nowhere (see "Found on the way").

## GM edit view, party view and the tracker

- The GM edit view (`GmEditSheet`), the read-only party view (`PartyMembers`) and the tracker inside the
  Campaigns page (it opens a member as a full-screen `GmEditSheet`) render the same `CharacterSheet`, so
  layout A and its boxes work there with no second build. They follow the window fold rules.
- Today they show the VIEWER's settings: `App.tsx` gives the sheet one `CustomizationContext`, built from
  the device default and the viewer's own active character, not from the character on screen. That stays
  until Guy decides whether a GM should see the owner's layout instead (asked 2026-10-24).
- The tracker's PC panes show party cards, not the sheet. (The `ForceMobileContext` pane switch in
  `src/integration/CampaignTracker.tsx` and its `.ct-pc-pane.is-narrow` sheet styles look unused now.)
- The separate tracker app (`tracker/`) does not use the sheet; nothing here applies to it.

## Found on the way (not part of the layout work)

- Today's sheet shows no archetype class DC card for the test champion, although its stored character has
  a Fighter DC 24 and a Swashbuckler DC 22 in `secondaryClassDcs` (the card `cards.multiclassDc` is drawn
  only when that list has entries).
- The app's prerequisite check accepted Fighter Resiliency for a champion, whose class gives 10 + Con HP
  per level (the feat needs 8 or less); the test character uses Basic Maneuver instead.
