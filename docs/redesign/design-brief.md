# Design brief: Heroes Heaven visual redesign

Started 2026-10-24. This file holds what the new LOOK should and should not be. Product facts and the
"must keep" list live in `PRODUCT.md`. The finished look will be recorded in `DESIGN.md`, which Impeccable
writes from what was built, after the sheet's first boxes are built (section 7 of `docs/redesign/plan.md`).

Research behind this brief: `work/design-research-2026-10-24.md` (untracked).

## Scope right now

- **PC (desktop) only.** Design at 1200 x 800 px (the Windows app's default window); check 900 px wide
  (its smallest window), 900 px at zoom 1.25 (about 720 px of room), 1440 px, and 600 px tall (the
  smallest window height). Zoom goes up to 2.0 on PC, so 900 px at zoom 2.0 (about 450 px of room) must
  still work, even if it is not pretty. The phone layout is not touched until the phone section of the
  plan.
- **One section at a time.** Never redesign every screen at once.

## Order: layout first, then the look

Guy, 2026-10-24: decide the LAYOUT first (what goes where, what matters most), in grey wireframes with no
colours, fonts or theme. The feel comes later, as its own step. Both steps start from references.

- Chosen layout: **A first** (Guy, 2026-10-24: "start the work on a … but we need to adress the things
  that we are missing that you found"). On the 3 grey structure options (A two columns on the left, B a
  band across the top, C two pages side by side) he likes all three, except B's row of conditions and
  modes under the band. His goal: keep all three, with "extreme customization" for the player at the end.
  So each section is built once as a box, and A, B and C are arrangements of the same boxes: A first
  (with C's narrower columns), B second (conditions and modes leave the band; where they go is decided
  then), C last (two pages need every page to work at phone width). Free move and hide comes last.
  A must also fix what the grey options missed (the list is in plan.md, section 2).
- Chosen look and feel: _not chosen yet._ Started 2026-10-26 (Guy: "for now only design the main page and
  give me multiple looks so i can see ideas and diffrent aproches"): several clearly different looks of the
  sheet's main page, each built from named real references shown beside it (see plan.md section 3).
  **Round 1 rejected 2026-10-26:** 6 looks (Mixing desk from Ableton, Market pages from the FT, Quiet list
  from Things, Night gallery from Disco Elysium, Field manual from Mothership, Gilded hall from Baldur's
  Gate 3), all one shared page re-skinned. Guy: "i dont realy like any of these. and you only gave me things
  that are iritation on the colors i want you to go wilder. think of the stracture we made as the base but
  you have more design freedom to make diffrent things." And: "option 6 looks extrimly ai coded and this is
  bad" (warm near-black, gold hairlines, a book serif, gold diamonds). Before round 2: "search online for
  tools to make you a better designer". So round 2 may change shapes, grouping, proportions and how numbers
  are drawn, keeping every section and value of the structure; no warm-dark + gold + serif skin.
  Also 2026-10-26: no counts on the Actions page chapter buttons or chapter titles.
  **Round 2 shown 2026-10-26:** first a design-tools search (free finds used: Anthropic's frontend-design
  skill and its list of AI-design tells, real game screens from Interface In Game and Are.na, Impeccable's
  detector as a check; Game UI Database blocks robots, so only Guy can browse it). Then 4 looks, each its
  own page with its own shapes and grouping: Cut-out (Persona 5), Field tablet (Metal Gear Solid V),
  Notebook (Moonlighter), Keypad (Teenage Engineering), on the canvas page "Main page: round 2" beside
  their references. Files: `C:\trying ai 2\hh-redesign-references\looks\round2\` (PLANS.md holds each
  look's plan and the full content checklist). **Guy's verdict (2026-10-26):**
  - Cut-out: "super cool and will definetly be a theme later on but is too specific to be the main theme".
  - Field tablet: rejected ("realy bad", low contrast, "the added graph in skills is so ussless").
  - Notebook: "realy cool ... the vib is in the right diraction", but still not the main theme. Hero
    points as hearts is wrong: "they are not related to hp".
  - Keypad: rejected ("so bad").
  - **The goal is the MAIN theme, the look every user gets first, not a niche theme.** "right now the curent
    style of heroes heaven i the best look for a main theme and i dont want it because it feels so soul
    less for a app that is made for a playing a ttrpg. the main style will need to be less specific and
    string but i dont want the simple mute colors modern styl either we need somthing in the middle."
    So: between a strong niche look (Cut-out, Notebook) and a muted modern app; it must feel made for
    playing a tabletop RPG, without being tied to one game's style. Strong niche looks become extra
    themes later.
  **Round 3 shown 2026-10-26:** main-theme candidates in that middle ground. Guy at the start: "we arent
  building a game we are building a tool ... the main theme cant be too modern or too styleised because
  then it will be hard to read", so the references were warm, readable tools and printed play aids, not
  game menus. 4 looks, each beside two real references, on the canvas page "Main page: round 3": Player
  aid (Root's player board, Wingspan's rules page), Park map (Acadia park brochure and map), Sheet app,
  warm (the Foundry and Tidy5e character sheets), Ledger and planner (an old store ledger, a Hobonichi
  planner page). An independent check ran before Guy saw them (every value present, the same 4 modified
  skills starred in all four, no middle dots, no hearts, no skill bars). Files:
  `C:\trying ai 2\hh-redesign-references\looks\round3\` (PLANS.md holds each look's plan).
  **Guy's verdict (2026-10-26):**
  - Player aid: "the colors are chilidhis but i like the diraction". **This is the lead.**
  - Park map: "preferd the roundness of 1": look 1's round coins and hexagons beat 2's square black bars.
  - Sheet app, warm: "the refrences are cool execution not so much". Why: "it felt like a skin to the base
    insted of somthing tthat is built on the base using the refrenace vibe and feel".
  - Ledger and planner: "bad".
  - Colours for the next try: **ink + one accent** (section heads in dark ink, one accent colour for
    buttons and the main weapon), not a colour per section.
  - The 19 palettes: decide later, after the main look is picked.
  So the next round starts from look 1's shapes and roundness in ink + one accent, and each look is built
  from its references' feel (shapes, spacing, grouping), never as a skin laid over the grey base.
  **Round 4 shown 2026-10-27:** look 1 in ink + one accent, three ways, each from one reference: A
  Rulebook page (Wingspan, teal), B Player board (Root, oxblood), C Token tray (Spirit Island, cobalt), on
  the canvas page "Main page: round 4". Files: `C:\trying ai 2\hh-redesign-references\looks\round4\`.
  **Guy's verdict (2026-10-27):** "i dont like the so many circles, and i dont want icons next to the
  headers. players can have more sense and speed typs i cant see how it will look with more. also why is
  preception and senses and speed in defance? i like the colors of option c but all of these are good."
  He also took the DCs, spell attack and cause out of the always-in-view columns (boxes.md, under the
  box table), asked that resistances look right with and without content, and: "in general i dont want a
  staatic placement for these things because i want to allow my players to change it to theri like i
  like the 3 oriantation you brought so i wnat to design this in a wayt that will be easy to move around
  so we need to design it in some kind of blocks". So: the accent is C's cobalt; no icons beside headings;
  round shapes only where they mean something; Perception, senses and speeds are their own blocks, shown
  with several entries; the next round designs the BLOCKS (each box of boxes.md as a movable block) and
  shows them placed in layouts A, B and C, not one fixed page.

**Rejected 2026-10-24:** 4 full-colour mock-ups (Archive, Rulebook, Adventurer, Clear) made without any
references. Guy's verdict: they feel "AI vibe-coded", and they decided the theme before the layout.

## Reference pictures

Pictures of real apps, games and pages, picked by Guy. Claude follows exact pictures better than words
such as "clean" or "fantasy".

- **Where:** `C:\trying ai 2\hh-redesign-references\` (outside the repo). Never commit these pictures;
  pictures of other apps are for looking at only.
- **Good places to look:** tabletop-RPG sheet apps, computer-RPG character screens, busy pages known for
  clear numbers, anything Guy likes. Wanderer's Guide may be looked at, never copied (GPL-3.0).
- **Layout candidates (2026-10-24):** 15 real screens plus a picture of today's sheet, in
  `C:\trying ai 2\hh-redesign-references\layout-candidates\`: 5 sheet apps and the Paizo paper sheet, 3 game screens, 3 busy non-game
  pages, and the 3 closest examples of the action list, conditions and the shield. Pictures that were not
  used are in its `not-used` folder. Guy marks the ones he likes.
- **Not shown by any candidate:** a filled action list with action-cost icons, conditions with whole-number
  values given real space, and a roomy shield block. The layout step designs these.
- **Pictures Guy picked:** none (2026-10-24). Instead he wrote what is wrong with them and his own
  priorities; both are below and take the place of picks.

## Guy's layout notes (2026-10-24)

What he said about the candidates (numbers are the candidates in `index.md`), in plain words:

- The dice are not in the main design: his players don't use digital dice. They come later as an option.
- The portrait takes too much space: players know how their character looks, and most have no art.
- Ancestry, class and background take a lot of space, but nobody uses them during play.
- Candidate 3 (Foundry) is a VTT; his players use the app as a character sheet, not a VTT.
- The inventory must not be squeezed into a small strip: PF2e characters carry a lot.
- The paper-sheet order (candidate 6) is hard to search on a PC; a PC app is not one sheet of paper.
- No wasted space around blocks: players need a lot of data in front of them.
- How a number is calculated shows only when the player looks for it, not all the time.

"We are thinking too big": first decide the STRUCTURE (where each section goes), then go deep into each
section one at a time.

### What matters most during play, in Guy's order

1. **Always in view:** Perception and hero points; skills; saving throws; HP and AC; conditions and modes
   (seen, and easy to apply); speed (players mostly know it, but bonuses and penalties change it, so it is
   easy to get); senses. Skills are used every session and in combat, so they must be visible.
2. **What the player can do:** actions, spells and attacks.
   - Actions are very important: basic, skill, feat and item actions. Easy to reach, search and sort.
   - A player often uses one thing and then another (a feat action before a spell; a Grapple before an
     attack), so it must be easy to see one and then the other.
   - The number the player adds to the die, or the save the target makes, is shown with each one.
   - Attacks: most characters use only one or two, and casters almost never make weapon attacks, so
     attacks don't need a whole page.
   - Exploration and downtime activities matter less, but players don't know which is which: they look for
     Treat Wounds under actions, and it is an exploration activity. The actions area must find it anyway.
3. **Reachable, not in front all the time:** attributes (visible, but less important than skills), the
   party dashboard, languages (one click away; players rarely check them).

## Never do

A starting list from the research. It grows after each round: every new line comes from a bad screen
Claude really made, and every "don't" says what to do instead. Keep it short; long lists get ignored.

1. Don't use purple or indigo gradients as decoration. Do use flat surfaces and one accent colour.
2. Don't use several bright colours with no main accent. Do give each palette one accent, used for actions
   and selection.
3. Don't put glowing blobs or blurred shapes behind content. Do use plain backgrounds.
4. Don't use emoji as icons. Do use the Tabler icons and the Pathfinder action glyphs.
5. Don't put cards inside cards. Do use one card level and group with spacing and thin dividers.
6. Don't put a coloured stripe or status dot on everything. Do use colour only where it carries meaning
   (conditions, damage types, traits, rarity).
7. Don't use the same padding everywhere. Do use the spacing steps, tighter where data is dense.
8. Don't use many text sizes or lots of bold. Do use about 3-4 text sizes per view.
9. Don't start from today's look or offer "like today" as a choice (Guy, 2026-10-24: "the whole point is
   to create a fresh and new one"). Do design every box fresh. Only WHAT is shown carries over: everything
   the app shows today must appear somewhere in the new design, on any page, checked against the display
   list (plan.md, "Display list").
9. Don't use pill-shaped everything, monospace labels, "01 / 02" section numbers or italic accent words.
   Do use plain, readable labels.
9. Don't join facts with middle dots ("2d8+6 slashing · versatile P"); it is a known sign of AI-made
   design (found in all 4 round-2 looks, 2026-10-26). Do give each fact its own space or use commas.
10. Don't add decoration that slows the app (big images, heavy effects, blur). Do keep it fast on old PCs
    and phones.
11. Don't design only the "everything works" screen. Do design the empty, loading and error states too.
12. Don't use native browser confirm, alert or prompt. Do use the app's own confirm dialog.
13. Don't cut rules text without a way to open the full card. Do keep the full text one click away.
14. Don't change game text to fit a layout. Do change the layout.
15. Don't make any mock-up or wireframe before Guy has given his input on references (marks, or written
    notes like "Guy's layout notes"). Do collect references first. For the look step Guy asked to see
    several looks first (2026-10-26): then every look must come from named real references, shown beside
    it, never from Claude's own idea of "a fantasy app".
16. Don't choose colours, fonts or mood before the layout is chosen. Do wireframe the layout in grey first.

## The look must work with

- All 4 theme axes: palette (19 today), font, style and zoom, plus the player's own accent colour
  (app-wide, and per character). A look is designed in one palette, then must hold up in the others and
  with any accent colour.
- The per-character Customize options: every option in the `Customization` type (src/rules/types.ts;
  editor in src/sheet/CustomizationEditor.tsx). Examples: actions as chips or a list, hidden boxes
  (read from the saved hidden rail cards, `docs/redesign/boxes.md`), HP entry and IWR buttons, save DCs,
  portrait shape, level chip, hidden and default tabs, columns, inventory layout, item card detail, whether
  Notes shows the columns, and the character's own
  palette, style, font, zoom and accent colour. Players have saved these; a new layout must keep every
  one of them working. The Customize drawer stays a drawer over the sheet, so changes preview live.
- The dense character sheet: many numbers, traits, conditions and long rules text.
- The "must keep" list in `PRODUCT.md` (action glyphs, PinStar, one card design, own confirm dialog).

## How Impeccable is used (the lead design add-on)

- Always call it by name (`/impeccable <command>`) and check that it read its guide files.
- Hand it this brief and `PRODUCT.md` with every redesign request; it reads `PRODUCT.md` on its own but
  not this file.
- **Layout step (plan section 2):** use `/impeccable shape` Phase 1 only (its discovery questions), then
  stop. Its Phase 2 goes on to offer full designs with colours and mock-up pictures, which is the
  colour-first round Guy rejected. Claude draws the grey wireframes itself, as plain pages filled with a
  made-up but FULL test character (plan section 2 says what it needs; the screenshot tests' fighter is
  nearly empty and must not be changed). No colours, fonts or mock-up pictures in this step.
- **Look step (plan section 3):** pin the direction from the references Guy marked (Impeccable's own rule:
  a direction the user pins beats its own roll), so Impeccable does not pick from its own catalogue.
  Impeccable still runs its concept-seed step and may show its own extra cards; the pinned direction wins.
  Before section 3, run `impeccable context`. If it reports image generation, ask Guy once whether looks
  start from a generated picture or straight in code (Impeccable's `buildPath`: without an answer it makes
  pictures whenever it can). Write his answer to `.impeccable/config.json`; never write a value he did not
  give. Without image generation there is nothing to ask: it builds in code.
- When a layout and look are chosen, tell it plainly: "the direction is chosen; do not run your own picker".
  Watch its first commands; it may still contact its maker's server (usage data is switched off).
- Its findings are hints: check each with a screenshot or a test before acting on it.
