# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Pathfinder Second Edition (Remaster) players who build a character from level 1 to 20 and then play from its sheet, at the table or online.
- Game Masters who run campaigns: they see and edit their players' sheets, run the initiative tracker and share homebrew with the group.
- The owner and his group use it every session; the app is public and free on GitHub.

## Product Purpose

Build a PF2e character where every rules choice shows its full description and what it grants before you pick it, then play from a complete, live-calculated sheet. Success means players trust every number, find any rule in one or two clicks, and never lose a change they made.

## Positioning

- Rules content comes from the Archives of Nethys data, with the newest printing winning; the app shows the rule text in full instead of paraphrasing it.
- Every number on the sheet can be opened to see where it comes from.
- It works fully offline on Windows and Android; an optional account adds cloud sync and campaigns with a GM.

## Operating Context

- The app ships as a Windows desktop app (Tauri), an Android app (APK) and a website (PWA). All three are the same web app in a wrapper, with one design language. The Windows app has no system title bar and draws its own window buttons; the website and the Android app have none.
- The visual redesign starts with the PC (desktop) version only; the phone layout is a later, separate section (see docs/redesign/plan.md).

- Used during play for quick lookups: hit points, conditions, strikes, spells, actions, hero points.
- Used at home for building, levelling up and managing inventory.
- Long rules text is read in record popups ("cards"); a player can pin a description to keep it.
- Characters move in and out by import and export, including the Wanderer's Guide format.
- In a campaign, the GM sees member sheets, can make GM edits, and runs the initiative tracker. On PC the tracker is built into the Campaigns page; it also exists as a separate app (tracker/). Both share the design tokens.

## Capabilities and Constraints

- Screens: login and loading screens, character list (roster), builder, character sheet, campaigns (with the party page and the GM edit sheet), homebrew and settings. The sheet has a top bar (app name, page menu, window buttons) and an identity row (portrait, name, level chip, subline, XP, the tab strip, and the Daily preparations, dice, undo/redo, edit and Customize buttons). The tab strip holds Main, Spells, Inventory, Feats & features, Companions, Notes, Details (plus an Actions tab on phones, and a Party button when the character is in a campaign). A vitals rail sits beside every tab (on Notes only if the player turns it on). The same sheet also serves the GM edit view (an editing strip with Edit in builder, Export, Update and Back), the read-only party view (a read-only strip and Back) and the tracker (the top bar hidden, a "← Tracker" back button, and the window buttons in the identity row's corner). The per-character Customize drawer opens over the sheet and previews changes live on it. Smaller parts: the dice tray and the update notice.
- Player-chosen theming with four independent axes: 19 colour palettes (src/theme/themes.ts), a font picker (src/theme/fonts.ts), styles (src/theme/styles.ts) and zoom (src/theme/zoom.ts), plus an optional accent colour (app-wide, and per character). The design tokens live in src/theme/tokens.css.
- Per-character sheet settings (the Customize drawer), on top of a device-wide default: every option in the `Customization` type (src/rules/types.ts; editor in src/sheet/CustomizationEditor.tsx; defaults in src/data/customization.ts). Examples: which rail cards are hidden (the new layout hides the matching boxes; a saved card order gets a one-time notice instead, see docs/redesign/boxes.md); hidden, auto-hidden and default tabs; actions as chips or a list (compact actions); HP entry and IWR buttons on the rail; save DCs and plus signs on modifiers; portrait shape, level chip and subline in the header; compact columns, inventory layout and item card detail; whether Notes shows the rail; and the character's own palette, style, font, zoom and accent colour. "Density" is only read from old saves now (the Style axis replaced it). Players have saved these; every new layout must keep every option working.
- Plain CSS with CSS custom-property tokens; no Tailwind and no component library. Icons come from the Tabler icon font; action costs come from the Pathfinder action glyph font (Pathfinder2eActions).
- The sheet is dense: many numbers, traits, conditions and long rules text on one screen.
- A phone layout exists (720px and below) and stays as it is until the phone section of the redesign.
- Open product decision: whether all 19 palettes stay after the redesign (the owner decides).

## Brand Commitments

- The name is "Heroes Heaven". It is an unofficial fan tool; Paizo content is used under the ORC License, and the app uses no Paizo trade dress.
- Action costs are shown with the Pathfinder action glyphs.
- Every description popup keeps its pin (PinStar).
- One card design for every record popup (docs/card-design.md and its owner rulings).
- No native browser confirm, alert or prompt; the app's own confirm dialog is used.
- Game text is shown as printed: no synthetic markers added into rules text, and text is never changed to fit a layout.
- A player's change is never overwritten by the app.
- The player keeps the right to choose the palette, font, style, zoom and accent colour (per device and per character) and to arrange the sheet with Customize.

## Evidence on Hand

- Real rules content: public/core.json and public/core-descriptions.json.
- App icon: src-tauri/icons/.
- Test characters are synthesized fixtures only. The owner's own characters, names and saves never appear in the repo, in screenshots or in design mock-ups.
- No logo or brand artwork exists beyond the app icon. Do not invent artwork, testimonials or claims.

## Product Principles

1. Every number is right and can be explained on demand.
2. Nothing the player did is ever lost or overwritten.
3. Rules text is complete, as printed, and one click away.
4. Fast and offline first, on old PCs and phones too.
5. The player decides how it looks.

## Accessibility & Inclusion

- A High contrast palette, a Readable font (Atkinson Hyperlegible), a dyslexia-friendly font option and a zoom axis exist and must keep working.
- Text must stay readable in every palette. Today some text in some palettes is below the contrast minimum; the contrast check (docs/ui-tests.md) stops it getting worse on the screens it covers, and the redesign must bring it up.
