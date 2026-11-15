# UI checks for the redesign (PC only for now)

Two free checks that catch visual changes nobody meant to make. They run in a real browser (the
installed Microsoft Edge) against the Vite dev server on port 1420, at desktop sizes: 1440x900 for
both checks, and 1200x800 for the screenshots too. **Phone layouts are not covered yet.** They will be
added as their own section later.

They are **not** part of `npm run verify`, because they need a browser and a dev server. Run them by
hand before and after a redesign step.

| command | what it does |
|---|---|
| `npm run test:visual` | **Screenshot check.** It photographs 4 screens (Characters, the sheet's Main tab, the builder's first step, Settings) in 4 palettes (Midnight, the default, plus Parchment, Daylight and Contrast) at two PC sizes, and compares them with the saved pictures in `e2e/visual/__screenshots__/`. That makes 16 pictures per size, 32 in all. It uses the default style, font and zoom. |
| `npm run test:contrast` | **Contrast ratchet.** It runs axe-core's `color-contrast` rule on Characters and the sheet's Main tab in every palette in `src/theme/themes.ts` (at 1440x900), then compares the results with `e2e/visual/contrast-baseline.json`, which holds each palette+screen's count and the list of elements that fail today, plus a second count and list for the elements axe could not measure (see below). |
| `npm run test:ui` | Runs both checks. |

All three commands take the same heavy-job lock as `scripts/vt.mjs`, so they never run beside vitest.
If a dev server is already running on 1420, they reuse it. If not, Playwright starts one and stops it
afterwards. Because the first load compiles the whole app, the first test can take a minute.

## What the checks see

- **They never use a real account or character.** Login is skipped with the app's DEV-only bypass,
  sessionStorage `hh-dev-skip`. That bypass is never on in a production build.
- **The character is synthesized.** "Test Fighter" (human fighter, level 3) is stored in
  `e2e/visual/fixtures/roster.json`. It was built with the app's own `buildCharacter` by
  `npx jiti e2e/visual/make-fixture.ts`. Never replace it with a player's save.
- **Settings are seeded, not clicked.** Palette, style, font, zoom and the start screen are written into
  the same storage keys the app reads at start-up (see `e2e/visual/helpers.ts`).
- **Each picture is steady before it is taken.** Animations are off and the text caret is hidden. Each
  picture waits for the fonts to load (`document.fonts.ready`).
- **The comparison is strict.** A pixel counts as changed when its colour moves by more than a small
  amount (`threshold: 0.02`), and a picture fails when more than 10 pixels changed. Anti-aliased edges
  are ignored. Measured on 2026-10-24: unchanged screens came out pixel-identical run after run; a 3%
  page tint and a hidden 22-pixel pin icon both slipped through the earlier setting (0.05 and 100
  pixels) and both fail at 0.02 and 10. Smaller changes than those were not measured.
- **Two PC sizes.** Playwright project `pc-1440` (1440x900) keeps its pictures directly in
  `e2e/visual/__screenshots__/screens.spec.ts/`. Project `pc-1200` (1200x800, the size the Windows app
  opens at, see `src-tauri/tauri.conf.json`) keeps its own 16 pictures in
  `e2e/visual/__screenshots__/screens.spec.ts/pc-1200/`. The redesign designs at 1200 and checks 900 and
  1440 by hand; 900 has no pictures yet. Run one size alone with
  `npm run test:visual -- --project=pc-1200`. The contrast check runs only in `pc-1440`, because its
  entries have no size in their names.
- **Nothing on these 4 screens depends on the clock today.** If a clock, date or "x ago" text is ever
  added to one of them, give that element the `data-uitest-mask` attribute so the pictures cover it.

## When the screenshot check fails

1. Open the report: `npx playwright show-report work/.ui-test-report`. Each failure shows the expected
   picture, the actual picture and a diff.
2. **A person must look at the diff.** If the change is a mistake, fix the code.
3. If the change was intended, accept it with `npm run test:visual -- --update-snapshots`. Run the check
   again to confirm it passes, then commit the new pictures together with the change that caused them.

Never update baselines just to make the check green.

If an update run stops with "the page reloaded while it was being captured", the picture it had just
written is bad (a dev-server reload happened under it). Run the update again until it passes.

**After an Edge update.** Edge updates itself, and a new Edge can draw text edges a little differently.
If ALL the screenshots fail at once right after an Edge update, and the diffs show only text edges
changing (no colour, size or layout change), a person looks at the diffs, then re-takes the baselines
with `npm run test:visual -- --update-snapshots` and commits the new pictures in a commit of their own
that says "Edge update" and nothing else. Never mix that with a design change.

## When the contrast check fails

- **A count went UP, or a new element fails.** The test prints each new failing element and its
  contrast ratio. A new failing element fails the check even when the count stayed the same, so a new
  problem cannot hide behind a fix made in the same change. Fix the colour. Raising a number or adding
  an element to a list is a hand edit of `contrast-baseline.json` and needs a reason in the commit message.
- **A count went DOWN** (the run says "improved"). Lock the improvement in with
  `UPDATE_CONTRAST_BASELINE=1 npm run test:contrast`. In PowerShell, run
  `$env:UPDATE_CONTRAST_BASELINE='1'; npm run test:contrast; Remove-Item Env:UPDATE_CONTRAST_BASELINE`.
  This only ever lowers a number. It also adds a missing entry, for example for a new palette, and fills
  in a missing element list. It never raises a number or adds an element to an existing list.
- **A redesign renamed classes or moved elements.** axe names each element by a CSS selector, so after a
  rename the same old failures show up as "new" elements. Then: delete that palette+screen's entry (or
  entries) from `contrast-baseline.json`, run with `UPDATE_CONTRAST_BASELINE=1` to record it again,
  confirm the new count is NOT higher than the old one, and give the reason (the rename) in the commit
  message. If the count went up, that is a real new failure: fix the colour first.

## The "#incomplete" entries

axe puts an element in `incomplete` ("needs review") instead of failing it when it cannot work out the
background behind the text: a gradient, an image, or a stack of translucent layers. A real contrast
failure there would never reach the normal entry. So each palette+screen has a second entry, for example
`midnight/sheet#incomplete`, with its own count and element list, and the SAME rules: the count may not
go up, a new element fails even when the count stays the same, and `UPDATE_CONTRAST_BASELINE=1` only
lowers counts and fills in missing entries or lists. When an element leaves this list because it was
given a plain background, check that it did not move into the normal entry instead.

## Files

- `e2e/visual/playwright.config.ts`: Edge, the two PC sizes (projects `pc-1440` and `pc-1200`), the dev server, and where the pictures go
- `e2e/visual/screens.spec.ts`: the 16 screenshots per size
- `e2e/visual/contrast.spec.ts`: the axe contrast ratchet
- `e2e/visual/contrast-baseline.json`: the ratchet's current counts
- `e2e/visual/helpers.ts`: seeding and navigation
- `e2e/visual/fixtures/roster.json` and `make-fixture.ts`: the synthesized character
- `scripts/ui-test.mjs`: the runner, which holds the heavy-job lock
- Type-check: `node node_modules/typescript/bin/tsc --noEmit -p e2e/tsconfig.json`
- Run output goes to `work/.ui-test-results/` and `work/.ui-test-report/`. Both folders are scratch and are ignored by git.
