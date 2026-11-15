# Redesign plan: sections, PC first

Started 2026-10-24. Guy's instruction: work in sections, the PC (desktop) version first, and not every
screen at once. The phone version comes later, as its own sections, only when Guy says so.

Read first: `PRODUCT.md` (product facts, must keep), `docs/redesign/design-brief.md` (the look: never do,
references, the chosen layout and look) and `DESIGN.md` (the finished look, once it exists).

**Design first, build later (Guy, 2026-10-25):** "i want to only focus in the visuals for now there isnt a
need to make things work. and we focus only on the chraacte sheet for now you dont need to go that deep we
are doing design work now not implementation". So for now: design pictures of the character sheet only
(layout, then the look), at mock-up depth. No app code, tests or wiring, and no other screens. Building
(sections 4-7 in the app) starts only after the whole sheet's design is done and Guy says to build.

## Sections, in order

Each section ends with Guy looking at it and saying yes before the next one starts.

| # | Section | What changes | Status |
|---|---|---|---|
| 0 | Groundwork | Brief files, add-on settings, fonts built into the app, PC safety checks | done 2026-10-24 |
| 1 | Layout references | Real screenshots of well-made layouts (character sheets, game character screens, busy pro tools) plus any Guy sends; Guy marks what he likes in each | done 2026-10-24: Guy marked none; he wrote notes on them and his own priority order instead (brief, "Guy's layout notes") |
| 2 | Layout | Grey wireframes only (no colours, no fonts, no theme) of the PC sheet: its top bar, identity row, tab strip, main tab and the vitals rail beside it: what goes where and what matters most. 2-3 options built from the marked references; Guy picks. Planning uses `/impeccable shape` Phase 1 only (its discovery questions), stopping before Phase 2: no concept-seed, no directions, no mock-up pictures. Claude draws the wireframes itself as plain grey pages, filled with a made-up but FULL test character (for example a level 5 champion: two weapons, a raised shield with its HP and Hardness, 3 conditions with values such as frightened 2, 10+ actions, focus points). Build that character like `e2e/visual/make-fixture.ts`, but write it to a new file name; never change `e2e/visual/fixtures/roster.json`, because every baseline picture depends on it. Conditions, damage, shield damage, focus used and the raised shield (`activeModes: ['cat-raise-shield']`) are play state: put them in the roster entry's `play` (PlayState in src/rules/play.ts). Also take a new picture of today's sheet with that character, to compare against; seed it with its own small script or a fixture-path option in `e2e/visual/helpers.ts`, never by swapping roster.json. The header must also fit the GM edit view (editing strip, Edit in builder, Export, Update, Back), the read-only party view (its read-only strip and Back) and the tracker, where the top bar is hidden and the window buttons sit in the identity row's top-right corner beside the "← Tracker" button. Guy 2026-10-24: first the STRUCTURE of the whole sheet (where each section goes, by his priority order), then each section in depth, one at a time | done 2026-10-24: Guy chose A first (B and C later as presets); the gaps the grey options missed are listed below the table |
| 3 | Look and feel | Colours, fonts, shapes and mood for the chosen layout, again from references Guy likes. The direction is pinned from Guy's marked references (Impeccable: a direction the user pins beats its own roll). Before this section, ask Guy once: picture first or code first (design-brief.md, "How Impeccable is used") | started 2026-10-26. Guy: "i feel like we have enough stracture now for starting to work on the actuall look of the app. for now only design the main page and give me multiple looks so i can see ideas and diffrent aproches". So: several clearly different looks of the sheet's main page only (layout A: the left columns and the Actions page), design pictures, no app code. Each look is built from named real references, shown beside it, so his reactions to the looks take the place of marking references first (brief, "Never do" 15). Round 1 (6 looks, one page re-skinned) rejected 2026-10-26: "go wilder", the structure is the base, not a cage; option 6 (Gilded hall) "looks extrimly ai coded". Design-tools search done 2026-10-26 (brief, "Chosen look and feel"); chapter counts removed. Round 2 (4 looks with their own shapes: Cut-out, Field tablet, Notebook, Keypad) shown 2026-10-26: Cut-out kept as a LATER extra theme, Notebook's feel "in the right diraction", the other two rejected. Guy: the goal is the MAIN theme every user sees first; today's look "feels so soul less" for a tabletop RPG app, niche looks are too specific, muted modern is not wanted either: "we need somthing in the middle". Round 3 (main-theme candidates from warm, readable tools and printed play aids: Player aid, Park map, Sheet app warm, Ledger) shown 2026-10-26 on the canvas page "Main page: round 3": Player aid is the lead ("the colors are chilidhis but i like the diraction"), its roundness preferred over Park map's, Sheet app "felt like a skin to the base", Ledger "bad". Colours next: ink + one accent. Round 4 (look 1 in ink + one accent, three ways: Rulebook teal, Player board oxblood, Token tray cobalt) shown 2026-10-27: cobalt chosen, no icons beside headings, fewer circles, DCs and cause leave the columns, design BLOCKS that move between layouts A, B and C (brief, "Chosen look and feel"; boxes.md). NEXT: round 5 = the block set in cobalt, each block with little and lots of content, placed in A, B and C |
| 4 | Foundation | tokens.css: colours, text sizes, spacing steps, corners, shadows for the chosen look | not started |
| 5 | Shared parts | Buttons, inputs, record cards and popups, pickers, menus, the confirm dialog | not started |
| 6 | App frame (PC) | Top bar with the app's own window buttons (minimise, maximise, close: the Windows app has no system title bar; the website's top bar has none, and both must look right), page menu, page layout | not started |
| 7 | Character sheet (PC) | Built from boxes (`docs/redesign/boxes.md`): each section is one box, built once, and layout A places them. Top bar, identity row, tab strip, then the always-in-view boxes (Perception and hero points, skills, saves, HP and AC with the shield, conditions and modes, speed, senses), then the other column boxes, then the pages: Actions (today's Main tab actions), spells, inventory, feats and features, companions, notes, details, one page at a time, and the Customize drawer (it opens over the sheet and previews changes live on it; it stays a drawer; the same editor also appears in Settings → Appearance, so check both). Saved rail and tab settings map to the boxes by the written mapping (boxes.md, "Saved settings"; tested in `test/sheet-boxes.test.ts`). The header must also fit the GM edit view, the read-only party view and the tracker's back button. After the first boxes are built, Impeccable writes `DESIGN.md` from what was built | in progress: always-in-view boxes; Guy chose the fresh grey sample's form 2026-10-24 (a card per box, AC in a strip with the saves, condition tiles, Raise a Shield only in the shield box; boxes.md). Building them is PAUSED (Guy 2026-10-25: design first); next is design pictures of the rest of the sheet |
| 7b | Layout presets and layout editing (PC) | B and C as presets of the same boxes (B: conditions and modes leave the band, where they go is decided then; C: two pages side by side, each page in its narrow form). Then layout editing: pick a preset, move a box to another slot, hide or show a box. Fixed slot widths only (no dragging widths). The editor lives inside the Customize drawer and in Settings → Appearance (the device default), like every Customize option, and stores its result in `pcLayout`; it never writes `railOrder` / `railHidden`, which the phone still reads. A character's own settings always beat a device-wide layout (`layoutSource`, boxes.md) | not started |
| 8 | Builder (PC) | Step by step | not started |
| 9 | Other pages (PC) | Character list, settings, campaigns and the party page, the GM edit view's own strip and buttons (the sheet inside it is section 7), homebrew, login and loading screens, the dice tray, the update notice | not started |
| 10 | Initiative tracker (PC) | The tracker inside the Campaigns page and the separate tracker app; both share the tokens | not started |
| 11 | Phone | Every section again for phone width, plus a real-phone check. Until here the phone ignores PC layouts (`pcLayout`); this section decides whether presets reach the phone, and how | only when Guy says |

Open question for Guy before section 4: do all 19 palettes stay? (Asked 2026-10-26: "Decide later", after the main look is picked.)

### Section 2: what the grey options missed (all part of layout A's work)

Guy chose layout A first (2026-10-24) and asked that these gaps, found by an independent check, be
fixed as part of it. Details and measurements: `docs/redesign/boxes.md`.

1. **Missing boxes.** The grey options left out Class DC, Reactions, Initiative (when something changes
   it), archetype class DCs, special statistics, panache, the champion's cause, mythic and the full
   resistances / weaknesses / immunities box. The box list starts from today's 12 rail cards plus the Main
   tab's parts and holds all of them; Languages move to Details, one click away (players who hid the
   Details page keep the Languages box). Fit is proven on a grey
   sample with a full test champion built from real app data (20 skills, two archetype DCs, two
   resistances): at 1200 x 800 all 20 skills and every always-in-view box show, and only the bottom 16 px
   of the last box (resistances) needs a scroll; at 1200 x 600 every always-in-view box and every skill
   still show. Done 2026-10-24 (grey).
2. **Saved Customize settings.** `railHidden`, `hiddenTabs` and `defaultTab` 'Main' map to the boxes by a
   written mapping in `src/data/sheetBoxes.ts`, tested in `test/sheet-boxes.test.ts`. A saved `railOrder` is
   not carried over (it would push Conditions off screen); those players, and everyone who had Languages on
   the rail (except players who hid the Details page, who keep the Languages box), get a one-time notice, so nothing changes silently. The PC keeps storing 'Main' for its Actions
   page so the phone's opening page never changes. Nothing is rewritten on load. Mapping and test done
   2026-10-24; wiring it into the sheet is part of section 7.
3. **Sync and folding.** The layout uses the device default plus the per-character override, like every
   Customize option, and a character's own settings always beat a device-wide layout; the phone ignores
   PC layouts until section 11. Fold rules for each slot at 900 px wide, zoom 1.25, zoom 2.0 and 600 px
   tall are in boxes.md, "Fold rules". Written 2026-10-24.
4. **GM edit view, party view, Campaigns-page tracker.** They render the same sheet (the tracker opens a
   member full screen), so A works there. They show the viewer's own settings today (one provider in
   `App.tsx`). Whether a GM should see the owner's layout instead waits until section 9 (Guy, 2026-10-24:
   "not relevant now"). The separate tracker app does not use the sheet.
5. **This plan.** Section 7 builds boxes, section 7b adds presets and layout editing, section 11 decides
   presets on the phone, and the rules below speak of boxes. Done 2026-10-24.

### Display list (Guy 2026-10-24: a fresh design, nothing shown today lost)

Guy: ignore today's look; "the only thing we need from the old design is what to display". Not the same
things on the same page, but everything the app shows today must appear somewhere in the new design.

Before the first box is built into the app (section 7), make the display list: every value, control,
badge and text that any screen shows today (sheet, every tab and popup, builder, roster, campaigns, party,
GM edit view, settings, homebrew, dice tray), each with the new box or page it moves to. A test fails
when an item has no new home, and when a box in `src/data/sheetBoxes.ts` holds no item. Its first part already exists: every rail card has a box (`test/sheet-boxes.test.ts`).
Made 2026-10-24: `docs/redesign/display-list.json` (about 1,600 items from every screen, the separate
tracker app's parts included, each with its new
box, page, popup, small shared part, later screen or "phone"), checked by `test/display-list.test.ts`. The
test also fails when a box, page or popup holds nothing, when a listed item disappears without a reason
in `removed` (ids frozen in `test/fixtures/display-list-ids.txt`), when a phone-only home is given to
something the PC shows, when a box takes in something from another screen without a note on how the box
shows it, and when a committed .tsx file in `src/` or `tracker/src/` is named by no item (a new screen
added without listing what it shows). Screens redesigned later (builder, tracker, campaigns, settings,
homebrew) are listed at a coarser grain; each of those sections refines its own part first. What the test
does NOT catch: a new value added inside a file that is already listed. Each section's build compares its
screen with the list by hand before it starts. The list was made once by helpers reading the code; from now
on it is edited by hand (a new item also gets its id added to the frozen list; an item taken off goes in
`removed` with the reason).
Guy's answers so far: the shield is its own box; the quick-add condition chips stay (they hide when the
window is short); conditions are designed fresh, not compared with today's chips.

**Guy 2026-10-24: layout first, the feel later.** A first try made 4 full-colour looks straight away; Guy
rejected all 4 as "AI vibe-coded" and as theme-first. So: no colours, fonts or mood before the layout is
chosen, and no mock-up or wireframe before Guy has given his input on references (marks or written notes;
given 2026-10-24 as "Guy's layout notes" in the brief).

### Whole-sheet design pictures (from 2026-10-25)

Grey pictures of the whole sheet in layout A at 1200 x 800, one page at a time, kept outside the repo
(`C:\trying ai 2\hh-redesign-references\section-pages\sheet-A.html` and its screenshots) and shown on the
sheet design canvas. The left two columns are the always-in-view design Guy chose (boxes.md). Top bar:
small (logo, page menu, window buttons). Name line: a small round portrait (initials without a picture),
name, level, a short "ancestry · class" line, XP field, Undo, Redo, Rest, Edit build, Customize; dice
beside Rest when that option is on, "← Tracker" at the left from the tracker, the GM-edit or read-only
strip in place of the right-hand buttons.

Guy's choices on the **Actions page** (2026-10-25): one list for everything, with search, type and cost
filters, sort and a Pinned group on top. An entry opens in a **popup**, like today (the popup's own look
is designed later). **One line per entry**; a line that doesn't fit wraps to more lines instead of being
cut. No descriptions in the line, only facts such as damage or the skill used; "if the user want to see
what the spell does he needs to open it". He called these details for the build, not the design stage.
Decided by Claude: pinned things also stay in their own group, so a filter never hides them; exploration
and downtime groups are folded at the bottom and search always finds them (Treat Wounds).

**Actions page, deep pass** (Guy 2026-10-25). **Stances sit on top of the list, one line per stance**,
like the action lines: cost, name, facts (for example "AC +4 status · Dex cap +0") and an On / Off
button at the right; "one at a time" in the label. Pressing the name opens the stance's popup, so reading
a stance and turning it on are two separate presses. He liked the top place but said that if pressing the
name turns the stance on, "there isnt an easy way to opent the pop up to see what the stance does"; he
picked this from four new ideas (a switch beside the name, Enter inside the popup, current stance with
Change, a line per stance). A stance that is on but whose requirement fails (Mountain Stance in armor)
shows "Not active: …; its effects aren't applied" on its line. Also placed (Claude, from the display
list): a battle form that forbids Strikes puts a notice at the top of Attacks; reload shows with the
weapon's facts; alchemy is its own group with the vials, prepared count, Quick Alchemy and Prepare in its
header and − n + and Use on each line. **No "compact actions" option**: Guy, when asked how it should
look, "ignore existingg design choces like the compact or not compact we are making a whole new design";
today's display settings are not requirements, only the information they show.

**Actions, attacks and spells: a new approach** (Guy 2026-10-25, after 10 new ideas drawn on the canvas).
He was not satisfied with the list and wanted new approaches. His verdicts, which are now rules:
- Big weapon cards (idea 2): made for a character with many weapons, but "even high lv martials wont use
  more then 2 weapens usually". **The main weapon used every round is prominent; others (Fist) stay
  available but quiet.**
- Split by goal (Attack, Heal, Protect…; idea 3): "pf2e things are to vage and versitile to split them up
  like that. i hate this." **No goal split. No "attacks this turn" switch.** **Everything that uses the
  multiple attack penalty shows its 3 bonuses** (+15 +10 +5), skill attacks and attack spells too.
- Fight / explore modes (idea 4): "so many things on one screen". **Calm screens, not everything at once.**
- Hotbar (idea 5): "pinned things dont need to be that huge". **He wants a pin system, small.**
- One table (idea 6): "overwhealming". Spell ranks as columns (idea 7): spells take much space and "the
  actions are overshadowed". **Spells must not crowd out actions.** Stat block (idea 8): rejected.
- **The new direction, his words:** "i want to have the actions spells attacks exploration and downtime
  in one page that is very long but to give buttons to navigited between them like chapters. this lets
  the user have 1 search fro everything he can do and a simple action amount filter. also devidin tthem
  to chapters will allow the user to arrange them in any way he likes." So: one long page, chapter
  buttons that jump, one search, a simple action-cost filter, chapters the player can reorder.
- Six ways to do that are drawn on the canvas page "Actions page: one long page with chapters" (A a row
  of chapter buttons, B a list down the left, C a thin index on the right edge, D chapters that fold to
  one line, E one "Chapter: Spells ▾" button, F a second row for parts of the current chapter). They
  add a Pinned chapter on top and an Items chapter (potions, scrolls).
- **His pick (2026-10-25): "option A is the best with option c a good custumization".** A (a row of
  chapter buttons under the search) is the page. C (a thin index on the right edge) is kept as a choice
  the player could switch to later. D (chapters that fold to one line) is rejected: "option d is shit".
- **No pin star on every line**: "if a user wants to pin that option needs to be in the pop up not the
  full page". Pinning lives in the entry's popup (the popup is designed later). The Pinned chapter stays.
- **Customization comes last, but the page is built for it**: "i dont really care about the way the user
  will see the custumization now that will be last, what i do want is to create a system that is easy to
  reorder and custumise." So no screens for moving or hiding chapters yet; instead every chapter, group
  and line is made from the same few parts, so any order still looks right.
- Drawn on the canvas page "Actions page: option A, version 2": the page without stars (side pictures:
  scrolled deep, the 2-actions filter, a search); **the parts** (top bar; chapter title line = name,
  count, the chapter's own facts and buttons; group title with its own counter; 8 line kinds that all
  keep cost, name, facts, numbers in that order: normal, 3 attack bonuses, the big main weapon, a quiet
  line, used up (crossed out), with a count, an activity (a time in the cost slot), can't use now
  (greyed, the reason in the facts)); and the same parts on a made-up fighter (no spells, so no Spells
  chapter) and wizard (Spells moved up, C's index). Escape sits in Skill attacks (it takes the penalty).
- **Items stays a chapter on the Actions page** (Guy 2026-10-25: "Yes, keep the Items chapter on the
  Actions page"): potions, elixirs and scrolls you use are things you can do, so one search finds them.

**Spells page** (Guy 2026-10-25): one line per spell, like the Actions list (not small cards). Groups:
divine font, cantrips, each rank with "N of M cast", focus spells with the focus points and Refocus, item
spells with Cast; Prepare and Learn a spell in the toolbar; spell DC and attack at the top of the page.

**Spells chapter, deep pass** (Guy 2026-10-25: "Design the Spells page next"). Spells is now a chapter of
the one long Actions page, so it uses the same parts (cost, name, facts, numbers on every line). Drawn on
the canvas page "Spells chapter" with made-up level 8 characters (warpriest, wizard, draconic sorcerer).
Drawn as settled (they follow his rules; he can still change them):
- The chapter title line holds the spell DC and attack, Prepare and Learn a spell; a facts line under it
  says the key attribute and the domains, school or bloodline.
- Groups: divine font (one line per font slot), cantrips, one group per rank, focus spells, innate
  spells, rituals (a rank and a casting time in the cost slot). A rank shows one dot per slot and "2 left
  · 1 empty"; an empty slot is its own line "Empty slot · choose in Prepare". A spell you cast is crossed
  out. The Focus group title shows the focus points and a Refocus button.
- A character with no spells has no Spells chapter. No spells prepared: one line "No spells prepared yet"
  with Prepare. A search with no spell match greys the Spells chapter button at 0 (replaces today's "No
  spells match.").
- Rare cases on the same parts: a cantrip from a feat (Adapted Cantrip), cantrips traded through Spell
  Blending, "2 over the limit · remove some", a feat bonus written into the facts (Healing Hands), spell
  damage that varies, two focus sources each with its own DC, a 1/day innate spell with its dot, the
  familiar's spells as one line with a count, battle font, "No focus spells."
- **His answers (2026-10-25), after the options side by side:**
  - **Signature spells repeat in every higher rank** (option 1): each rank lists everything its slots can
    cast, so the player never works out ranks; the count counts each spell once.
  - **Two kinds of spellcasting = one Spells chapter with a title line per kind** (option 1), each with
    its own DC, attack and buttons. This adds one part to the system: the entry title line, between the
    chapter title and the group title.
  - **A staff and a wand go in the Items chapter**, not in Spells.
  - **Spells that aren't prepared are not on the long page**: "spells that arent preperd dont need to be
    in this long page". So no spellbook group and no spellbook line; the spellbook is reached through
    Prepare (in the popup, designed later). By the same rule (Claude), the sorcerer's "learned, not in
    your repertoire" spells and a familiar's unprepared spells stay off the page too.
- The popups (Prepare, the repertoire, Learn a spell, trading slots) come later. Next: one "version 2"
  picture of the Spells chapter with these answers built in.

**Actions page parked** (Guy 2026-10-25: "i want to stop working on the actions page for now and now work on the feats and features page"). Next there, when he comes back: a version 2 picture of the Spells chapter with his answers built in.

**Feats and features page** (Guy 2026-10-25: "show me different aproches for it"). Three approaches drawn
whole-sheet at 1200 x 800 on the canvas page "Feats and features page" (the test champion, level 8;
`sheet-A.html?page=feats&fa=chapters|level|grid`): 1 chapters by type, 2 a timeline by level, 3 the whole
build as one grid. **His pick: 1, chapters by type**, like the Actions page: a row of chapter buttons under
one search (Class, Archetype, Ancestry and background, Skill, General, each with its count); each chapter
has a title line with its own facts (Champion · Justice · Iomedae; free archetype · 2 dedications) and
groups (Class features, Class feats; one group per dedication with its DC); one line per entry: level,
cost, name with the choice in brackets, facts, number. No descriptions in the line; the line opens its
popup. Decided by Claude: traits and today's first-line preview move into the popup (search still finds
them); the type filter becomes the chapter buttons; lines inside a chapter go by level.

**Feats and features, deep pass** (2026-10-25/26, canvas page "Feats and features page", second row).
Settled: no sort button and no All button (buttons jump, every chapter is always on the page); search
finds names, choices, facts, traits, groups, rarity, text and your notes, best name match first, and dims
chapters with no match; nothing found = "No feats or features found."; a granted feat has a dashed
"granted" tag and names its source; an unchecked record has a dashed "not yet verified" tag; a class-group
pick reads "Group (your pick)", like Cause (Justice); two classes = one Class chapter with a title line per
class; a class archetype's dedication sits in the Archetype chapter; a character with no archetype has no
Archetype chapter. A checker found 5 rules mistakes in the first boards (rune grade, two wrong action
marks, an impossible made-up cleric, a missing Deific Weapon); all fixed before Guy saw them.
- **His answers (2026-10-26):** **notices sit where they belong** (option 2): Check this and Missing data
  as a small tag on the line they are about, the class archetype note and "Replaced:" under the Class
  title, and one "N need a look · Show" line on top that jumps to them. **The Class chapter has two
  groups**, Class features then Class feats (option 1).
- **Open (Guy: "not decided for now"):** limited uses as a − 1 / 1 + counter or as dots like the Spells
  chapter (board "Question 2"). Uses that refill each turn, round, minute or hour keep a "new encounter"
  refill button either way.

**Inventory page** (Guy 2026-10-25): both left columns stay (column 2 does not fold away on this page).
One line per item: Equipped, Carried and one group per container (with its Bulk); at the top search, Add
item, Create item, the Bulk count, invested count and coins; on each line Wield / Wear / Invest, a count
with − and + for things used up, uses per day, Bulk and price; an item opens its popup.

**Perception, initiative, reactions, speed and senses** (Guy 2026-10-25): "initiative and reactions are
both things that wont be on most characters but it will be more common to have a bonus on iniattaive so i
wnat to chnage the way that the reaction speed sense and preception boxes are to be more flexible and
independed so if a uses has a diffrent amount it will still work". So they are no longer fixed pairs
(Initiative beside Reactions, Speed beside Senses). Each is its own small box that shows only when the
character has it (Perception always), takes the room its content needs (one speed or several, one sense or
several), and the boxes flow into the space, so a character with none, one or many still looks right.
Drawn for a plain character and a busy one (`?char=plain|busy` in sheet-A.html). Rules (Claude):
Perception and hero points always show; Initiative only when it differs from Perception; Reactions only
when the character has more than one, as a star with no number (Guy's ruling 2026-09-16). Two small boxes share a row (label above the number, like the AC
strip); a box with several values takes the whole row; a box alone on its row stretches, so there is no
empty hole. Guy's answers (2026-10-25, after side-by-side pictures): **speed and senses sit under the
conditions** (Perception, hero points, Initiative and Reactions stay above them), so the conditions stay in
view at 1200 x 600 even for a busy character; **several speeds or senses show as one line that wraps**
("20 ft · climb 10 ft · swim 15 ft"; senses as one comma list), not a value per cell.
Fit: plain character, column 1 ends at 729 at 1200 x 800 (the fixed pairs ended at 754); at 1200 x 600 the
conditions end at 470. Busy character (initiative, 2 reactions, 3 speeds, 3 senses): conditions end at 620
(1200 x 800) and 514 (1200 x 600); Panache and Cause need a small scroll. At build time PRESET_A's pairs and
test/sheet-boxes.test.ts ("three side-by-side pairs") change to match.

**One page at a time, in depth** (Guy 2026-10-25, when shown four page drafts together): "i want to go in
to each page deep so we need to work on them sepertly not all ta once". Each page gets its own pass: draw
it, show its options side by side, ask his taste questions, write his answers here. First drafts of
Feats and features, Companions, Notes and Details, plus a whole-sheet check against the display list (412
sheet items, 59 without a home, sorted by page), are in
`C:\trying ai 2\hh-redesign-references\section-pages\page-drafts-and-findings-2026-10-25.md`. Each page's
pass starts from that page's findings. Already fixed from the check: the Reactions box shows a star and
no number (Guy's ruling 2026-09-16), and temp HP is a field you type into.

Next: the deep pass of one page at a time (Guy picks the order).

## How each section is built

Sections 4-11 are built like this. Sections 2 and 3 end with Guy's pick instead, and skip the palette and
test steps below.

1. **Guard first.** Before building, add the section's screens to the screenshot and contrast checks
   (`e2e/visual/`, see `docs/ui-tests.md`). Today the screenshots cover 4 screens (character list, sheet
   main tab, builder first step, settings) in 4 palettes; the contrast check covers only the character
   list and the sheet main tab, in all 19 palettes.
2. Claude builds the section at 1200 x 800 px (the Windows app's default window), then checks 900 px wide
   (its smallest window), 900 px at zoom 1.25 (about 720 px of room) and 1440 px, and 600 px tall (the
   smallest window height). Zoom goes up to 2.0 on PC, so at 900 px and zoom 2.0 (about 450 px of room)
   the layout must still work, even if it is not pretty.
3. **Screenshot, compare, fix.** Claude takes a screenshot, puts it next to the chosen layout and look (and
   `DESIGN.md` once it exists), lists every difference (spacing, text size, alignment, colour) and fixes only
   those. Repeat until nothing is left.
4. **Every palette.** Check the section in the main palettes (the default, parchment, daylight, high
   contrast); the contrast check runs all 19 palettes on the screens it covers.
5. **Fresh reviewer.** A second agent that did not build the section checks it against `PRODUCT.md`, the
   brief and the chosen layout and look (or `DESIGN.md`), and reports only real rule breaks.
6. **Safety checks.** Run the screenshot tests and the contrast check (`docs/ui-tests.md`). A changed
   picture is accepted only after a person looked at it; never refresh the baseline pictures just to make a
   test pass. The contrast check only stops things getting worse: it lists the elements that fail today, and
   each section should lower those numbers.
7. Guy looks at the screenshots and says yes, or what to change. Every "don't" he names goes into the brief's
   "Never do" list.
8. Commit the section.

## Rules for the redesign

- Use the design tokens for every colour, size and spacing value; type no raw values into a screen.
- Keep every per-character Customize option working: every option in the `Customization` type
  (src/rules/types.ts; editor in src/sheet/CustomizationEditor.tsx). Players have saved these. In the
  boxes and pages that means at least: actions as chips or a list, HP entry and IWR buttons, save DCs, plus
  signs on modifiers, the shield Damage/Repair box (auto-subtract Hardness), and the hidden boxes, read
  from the saved hidden rail cards by the mapping in `docs/redesign/boxes.md` ("Saved settings"; the card
  keys are frozen; a saved card order gets a one-time notice instead); in the header, portrait shape, level chip and
  subline; on the tab strip, hidden, auto-hidden and default tabs ('Main' now opens the Actions page).
- Improve one thing per request once the layout and look are chosen (only fonts, then only colours, then motion).
- Opus for taste steps (picking a layout or a look, final reviews); medium or high effort to apply a chosen plan.
- No new design add-ons without reading every file first. Never install with `npx skills`. Never turn on a
  hook that runs a checker after every edit (Impeccable's "hooks on" included).
- Do not add the big "anti-AI-look" add-ons (Taste, Hallmark, UI UX Pro Max); they repeat Impeccable.
- Mock-ups and screenshots use synthesized test characters only.
