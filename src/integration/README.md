# Tracker integration — the entire seam, and how to remove it

This folder is the **only** place Heroes Heaven knows the initiative tracker exists. It was built to
be deleted: the user explicitly asked to be able to take it out again without regret.

## How to turn it off

Set `TRACKER_IN_CAMPAIGN = false` in `enabled.ts`. Opening a campaign reverts to HH's own campaign
detail panel. Nothing else changes.

## How to remove it completely

1. Delete this folder (`src/integration/`).
2. Undo the edits in the HH files listed below. **Keep this table honest** — it is the whole
   removability guarantee, and it is only as good as its accuracy.

| HH file | What the integration added | To remove |
|---|---|---|
| `src/sheet/CampaignsPage.tsx` | `integration/` imports (`TrackerTools` + `CampaignTracker` are `React.lazy`, each in its own `<Suspense fallback={null}>`, so a player who never opens a campaign doesn't download the tracker); `<TrackerTools/>` + the `ti-palette` Customize button in the chrome; the `cmp-body-tracker` class; `<CampaignTracker>` in place of `<CampaignDetail>` on desktop; the two `TRACKER_IN_CAMPAIGN`-gated last-campaign-memory blocks; `CampaignForm`'s `localOnly` fallback; `onOpenOwn`'s second argument `fromTracker` (the own card was tapped in the tracker — `trackerView` — so App can offer "← Tracker" on that sheet) | Delete the imports and restore `<CampaignDetail>` (which already has its own Settings / Delete / share code); drop `localOnly` and its branches; pass `onOpenOwn` straight through again |
| `src/sheet/CampaignsPage.tsx` (phone) | `useIsMobile` → `isPhone`, which hides every GM tool at ≤720px (Create/Edit, the tracker, the tools row, the Customize button) and renders `<CampaignDetail gmTools={false}>` + `<JoinRow/>` instead. NOT part of the seam — it is HH's own player-facing campaigns page | Keep. Only the `TRACKER_IN_CAMPAIGN && !isPhone` terms go with the integration |
| `src/sheet/gmSync.ts` | `pendingEditStillStands` compares the published sheet with the pending edit through `canonicalJson` (key order ignored — the `sheet` column is jsonb, which hands keys back in its own order), found while closing the seam's never-overwrite door; `gmPushBuiltOn` — the sheet a seam push builds on (his pending edit while it stands on THIS fresh read — the read is still the very publish the edit was built on, by stamp equality AND by the authored hash, and no refusal receipt for it — on his OWN character too, else the published sheet) and WHICH push of his it is (`on`, carried in `gm_base.on`); `gmPushBase` is now its `.sheet`; `rememberGmEdit` records a push on the base it was built on (it used to keep the older of that and the replaced edit's, which made a push built on their newer publish look overtaken); `resolvePendingGmEdit` judges its drop on the edit it HOLDS, so his own character's edit is pruned like any other (it was never dropped at all); the `gmPendingEdit` doc names the seam's own-push test as a reader, and the `baseUpdatedAt` / `pendingEditStillStands` docs say a seam push depends on those rules | Keep `canonicalJson`, the held-edit drop and the recorded base: HH's own overlay rules, with no tracker names in them. `gmPushBuiltOn` and `gmPushBase` have no other caller: delete them with the seam (keep `pendingEditStandsOnFreshRead` — GmEditSheet's Update uses it through `gmUpdateBase`). The docs' mentions of the seam go too |
| `src/sheet/memberSheets.ts` | comments only: two notes name the tracker seam (its pushes as what used to re-join every channel, and the seam as a reader of the re-pulled map) | Delete those two mentions; nothing in the code knows the tracker |
| `src/theme/theme-manager.ts` | `resolveAppearanceVars` — the token-resolution half of `applyResolved`, extracted + exported so a scoped appearance (the tracker's own theme) can be built without writing `<html>` | A pure refactor with no tracker names in it; harmless to keep. To fully revert, inline it back into `applyResolved` |
| `src/sheet/SettingsPage.tsx` | the `'tracker'` section (id, `ALL_SECTIONS` entry, `renderSection` case); `TrackerSettingsSection` is `React.lazy` + `<Suspense>` so opening Settings doesn't pull the tracker's stores in | Delete the three `'tracker'` references and the lazy import |
| `src/sheet/PartyMembers.tsx` | optional `localMembers?: PartyMember[]` prop; optional `renderExtra?` render-prop returning `PartyCardSlots` (`header` = the turn chip + "+" button in `.party-card-tools`, `saves` = extra tiles in the turn band's `.party-defs` block, `right` = the whole `.party-row-ref` band — the card's second row — whose presence is what puts `.has-right` on `.party-card-body`); optional `onMembers?` callback (every loaded list, so the tracker's party can be built from the server party — this component mounts INSIDE the tracker's party view, which needs that party to exist first); optional `dialogStyle?` (2026-10-10), passed to the kick's `confirmDialog` as `style` so the confirm wears the tracker's look above its windows | Delete the four props + `PartyCardSlots`; use `members`; drop the `extra` slots and the `.has-right` term, which leaves the card its turn band and nothing else; drop `style: dialogStyle` from `kick` |
| `src/sheet/confirm.tsx` | optional `style?: DialogStyle` on `ConfirmOptions` / `ChooseOptions`, applied on the `.picker-overlay.confirm-overlay` (2026-10-10). The dialogs are detached roots on `<body>`, so no context reaches them: a confirm raised from the tracker (Clear the order, a card's kick, the local table's "No campaign settings") gets the tracker's `--app-*` variables plus the four text properties `<body>` sets (`hhSurfaceTheme` in `trackerAppearance.ts`) and a z-index above the floating windows (HH's own 80 sat under a window at 501). GmEditSheet's dialogs pass nothing: they belong to the app-themed full sheet (a rule in `campaign-tracker.css` lifts such an un-styled confirm above the windows while the tracker is on screen, 2026-10-11) | A generic option with no tracker names — harmless to keep. To revert: delete `DialogStyle`, the two `style?` fields and the two `style={style}` |
| `src/sheet/CampaignsPage.tsx` (local table) | the local table's `onOpenSettings` takes the tracker's `dialogStyle` argument and passes it to its "No campaign settings" `confirmDialog` as `style` (2026-10-10) | Back to `onOpenSettings={() => void confirmDialog({ … })}` with no `style` |
| `src/sheet/GmEditSheet.tsx` | `forwardRef` + the `GmEditHandle` (`confirmLeave`) so the initiative order can ask before swapping the sheet out; the optional `inTracker` prop, forwarded into `CharacterSheet`'s `gmEdit` | Drop the ref plumbing; inline `confirmLeave` back into `doExit`; drop `inTracker`. (`confirmLeave`'s builder-open Discard / Cancel prompt is HH's own — the builder's unsaved work is lost the same way on the campaign detail — and stays) |
| `src/sheet/CharacterSheet.tsx` | `gmEdit.inTracker` — the tracker hides the campaign's title bar while a sheet covers it, so the identity row leads with a labelled "← Tracker" (`.sheet-tracker-back`, calling `onBack`) in place of the trailing "Back to campaign" arrow, and becomes the window's drag region with `<WindowControls/>` and `--chrome-pad-y: 10px`; `onBackToTracker` — the same "← Tracker" on your OWN sheet when App opened it from your card in the tracker | Delete the field, the prop, `inTracker` / `trackerBack` and their JSX; the trailing arrow is unconditional again |
| `src/sheet.css` | the `.icon-btn.sheet-tracker-back` rule (the labelled "← Tracker") | Delete the rule |
| `src/sheet/useIsMobile.ts` | `ForceMobileContext` (null default) so a narrow PC pane can put the sheet into its phone layout; `useIsMobile` returns `forced ?? isMobile` | Delete the context + the `forced ??` — with no provider it was already inert |
| `src/sheet/useEscapeClose.ts` | `triggerBack()` — fires the topmost dismiss handler, so the campaign back arrow can share the dismiss stack (close an open sheet before leaving the campaign); the `DismissUnder` context and `useBackHandler`'s optional third argument `layer` (`{ cover }` / `{ under }`, 2026-10-11): while a COVER entry has a handler, entries registered UNDER it (inside a `<DismissUnder value>` boundary, or with `under`) are passed over whatever their push order — `CampaignTracker`'s floating windows are the cover, and the player's sheet (its handler and everything inside it) and the Customize panel, all drawn under the windows, are under, so Escape closes a window before anything beneath it (`test/tracker-windows-over-sheet.test.tsx`, `test/gm-search-popup.test.tsx`) | Generic helpers with no tracker names; harmless to keep (no flag set = the plain LIFO stack). To revert the layers: drop `DismissUnder`, the `layer` argument, the two entry flags and the `covered` skip in `topHandler` |
| `src/App.tsx` | `TEST_CAMPAIGNS_WITHOUT_LOGIN` in the **DEV-only** `devBypass`; `bootToCampaign` + its branch in the post-content-load jump; the `setOnCampaignsPage(mode==='campaigns')` effect — reopen a campaign the app was closed on; the one `combatOwnsUndo()` guard in the Ctrl+Z handler; `which !== 'campaigns'` on the floating undo/redo pair (Ctrl+Z there undoes the COMBAT, so a character-undo button beside it would do something else); `ownFromTracker` — the own sheet opened from your card in the tracker (CampaignsPage's `onOpenOwn(id, fromTracker)`) passes `onBackToTracker` (back to the campaigns page, which reopens the campaign it remembers), cleared by an effect the moment the screen or the character changes | Delete that term, the `bootToCampaign` state + branch, the marker effect, the guard, the `which !== 'campaigns'` term, and `ownFromTracker` with its effect and the `onBackToTracker` prop |
| `src/sheet/PartyMembers.tsx` (HH's own fix) | `useMemberViewer`'s Escape / Android-back now asks the open GM sheet first (a `GmEditHandle` ref → `confirmLeave`), as its back arrow always did. NOT part of the seam: the same page-replacing sheet opens from HH's own campaign detail | Keep |
| `src/sheet/RecordCard.tsx` (HH's own fix) | the browse card's FALLBACK branch star names `pin.where` (it said "Pinned" whatever the caller pins to; the page branch always named it) — inside the tracker that is the GM screen (2026-10-10). NOT part of the seam: any caller with a `where` gets it | Keep |
| `src/sheet/RecordCard.tsx` + `src/sheet/cardModel.ts` (window chrome, 2026-10-11) | item 7 (Search everything results open as tracker windows): `chrome: 'window'` (`WindowRecordCard`, its dispatch line, the `CardChrome` member and its doc) — the page inside a tracker window / GM-screen pane, which `CampaignTracker`'s `HostPage` draws, with the record's TrustMarker in the page head's controls (where the popup draws it); the `OpenAt` type and `onOpenRef`'s optional third argument `at` (where the link was activated) | Delete `WindowRecordCard`, its dispatch line and `'window'` from `CardChrome`; `OpenAt` and `at` are harmless to keep (every other caller ignores `at`), or drop them with the next three rows |
| `src/sheet/AstRenderer.tsx` (2026-10-11) | the `windowHead` prop (the page head without the name, the trait chips and the body, no `.ast-pop` frame) used only by the window chrome; every link, trait chip and keyboard activation hands `onOpenRef` the point it was activated at (`clickAt` / `keyAt`); the Archives link is built once (`aonLink`) for both heads — the popup's markup is unchanged | Delete the `windowHead` branch and prop; `at` is harmless to keep |
| `src/sheet/DescBody.tsx` (2026-10-11) | optional `onOpenRecord` — a linked record opens the caller's way (the window chrome's no-page lane: another tracker window at the click point, caught by `onClickCapture`; the link's own box when the keyboard made the click, through `RemasteredLine`'s `clickPoint`) instead of DescBody's own popup | Delete the prop, `catchPoint` / `clickedAt`, the `clickPoint` import and the three `if (onOpenRecord)` branches |
| `src/sheet/RemasteredLine.tsx` (2026-10-11) | the name's click hands `onOpen` its point (`at`); the exported `clickPoint` (the pointer, or the link's own box for the click a browser makes of Enter — no pointer, `detail` 0 at 0, 0 — so a keyboard-opened tracker window does not land in the corner), also used by DescBody; a type import from `cardModel.ts` | Harmless to keep (every other caller ignores `at`); or drop the third argument, `clickPoint` and the import |
| `src/sheet/ast.css` (2026-10-11) | the `.ast-win`, `.ast-win-head`, `.ast-win .ast-traits` and `.ast-win-text` rules — the window chrome's insets (the tracker window's body has none for a page) | Delete the four rules with the chrome |

**Deliberately NOT in that table:** the share code and *Delete campaign* on HH's campaign settings
page (`CampaignForm`), and their `sheet.css` rules. They moved there when the tracker replaced the
campaign detail panel, but they are HH's own controls on HH's own page and stand on their own — they
are not tracker machinery and should stay if the integration goes. (With the integration removed
`CampaignDetail` also brings its copies back; harmlessly duplicative, not broken.)

**Also deliberately NOT in that table — the GM-edit channel's own rules (F1, 2026-10).**
`gm_character_edits.gm_base`, `campaign_characters.gm_refused_at`, `src/data/authored.ts`; in
`src/sheet/gmSync.ts` `sameInstant`, `boundGmBase`, `gmEditVerdict`, `gmBaseOf`,
`pendingEditStandsOnFreshRead`, `gmUpdateBase`, `gmHeldEdit`, `memberPublishedRow`, the refusal receipt
(`gmEditRefused`, kept for a push a later one replaced without carrying it, answered by
`acknowledgeGmEditRefused`) and the schema flag, `editsToApply` by equality and `reconcileGmPendingEdits` by
equality; in `src/data/party.ts` the publish lane, `gmEditFromRow`, `markGmEditRefused` (says whether it
landed; a refused row is consumed only then), the conditional delete and the optional-column reads; in
`src/data/cloudSync.ts` `pullForGmApply` (the cloud pull before an apply); the `src/App.tsx` applier
(consuming an apply only from the committed roster, written to disk in that commit) and publish retry;
`GmEditSheet`'s proved-baseline Update; `PartyCard`'s "not applied" chip and `PartyMembers`' SQL strip; in
`src/data/storage.ts` `loadGmEditChains` / `saveGmEditChains` (the `wanderers-codex:gm-edits-chain:v1`
key) and `loadRoster`'s session record of what its load made of each entry (`loadedAuthoredAs`); `src/data/rebuild.ts`'s `carryStoredOverrides` reading `CARRIED_CHARACTER_FIELDS`; and in
`src/sheet.css` the `.party-pending.party-refused` rule (and the retired `.gm-overwrote` banner's). They protect HH's
own full-sheet Update as much as the seam's pushes, carry no tracker names, and STAY if the integration
is removed. (`CampaignTracker.tsx`'s use of `memberPublishedRow`/`gmEditRefused` goes with the folder.)

There is otherwise deliberately **nothing else to unwind**:

- **HH's build is untouched.** No Tailwind, no PostCSS, no vite/tsconfig edits. The tracker's styles
  arrive as ONE pre-built plain `.css` file (`tracker/dist-css/tracker.scoped.css`), so removing the
  integration is removing an import — not disentangling a build.
- **The tracker still runs standalone** on port 1421 exactly as before, with its own 654 tests. The
  dependency only ever points HH → tracker: where the tracker needs something only the host knows, it
  declares a context in `tracker/src/data/` with a **null default**, and HH provides the value. With
  no provider each one falls back to the tracker's original behaviour, so the standalone app is
  unchanged. There are six:

  | Context | What HH supplies | Standalone (no provider) |
  |---|---|---|
  | `partyLevelContext` | the party's level, derived from the real characters | the party store / the typed local level |
  | `monsterPartsContext` | the campaign's Battlezoo rule + Full/Light/Hybrid variant | the tracker's own "Show Monster Parts value" setting, priced on Light |
  | `pcPaneContext` | a renderer so a PC's pane is HH's editable character sheet | the tracker's own `CombatantDetail` |
  | `pcStatsContext` | each PC's real stats (AC/saves/…) so the initiative order can show them | `PartyPlayer.pcStats` (the DM-entered sheet) |
  | `hostSearchContext` | an index of every HH record for Search; `render`, the body of an HH page in a tracker window (a Search result opens as one, 2026-10-11) or a GM-screen pane; `controls`, that page's favourite star for the window's header (a strip above the page in a pane holding two tabs, which has no header); and `open` (this host opens the same window — Search calls `open` only for a host with no `render`) | Search over the tracker's own reference data |
  | `hostThemeContext` | the GM's tracker-only look (`useTrackerVars()`, one object per appearance state, or null when the tracker inherits the app's look), which `BodyPortal` puts on everything the tracker draws on `<body>` | null — the popup inherits the document's variables, as always |

  The tracker's own `DisplaySection` also takes a `campaignDriven` prop: HH passes it to hide the
  Monster Parts switch (the campaign decides), the standalone tracker doesn't and keeps it.

  HH derives the PC stats with `computePcStats` (integration) and reuses the tracker's own PcStats /
  PcDetailConfig model: the initiative order's "Show player AC & saves" toggle and the party cards'
  "Stats shown" sections are the tracker's existing display logic, now fed real data. The party
  cards' extra sections render via `PcStatsCardExtra` (integration), passed to `PartyMembers`'
  `renderExtra` prop.

  More tracker-side, standalone-safe touches for the embed:
  - `BodyPortal` (`tracker/src/components/BodyPortal.tsx`, 2026-10-10) is the ONE way the tracker draws
    on `<body>`: the initiative row's right-click menu and every hover preview (`Tooltip`) go through it.
    Its root is a direct child of `<body>` with exactly the class `tracker-root` (the tracker's CSS
    variables live under it, and `trackerPopupOpen()` above finds an open tracker popup as
    `body > .tracker-root:not(.campaign-tracker)`), plus the `hostThemeContext` variables, so the popup
    wears the tracker's look instead of resolving the app's from `<html>`. With no provider it is the
    old portal exactly. `tracker/src/components/BodyPortal.test.tsx` refuses a createPortal call anywhere
    else under `tracker/src`; `test/tracker-popup-theme.test.tsx` checks every body popup's look. To
    remove: keep it (harmless) or inline `createPortal` back into the two callers.
  - `InitiativeTracker`'s mini HP bar falls back to the host `pcStats` HP for a PC row when the
    combatant itself has no HP (`c.maxHP === 0`) — which is always true for an embedded PC, since HH
    feeds HP through the context, not the party store. A standalone PC gets `maxHP` at add-time, so
    its own HP still wins; the fallback only fills the gap.
  - `TrackerTools` mounts the tracker's own `TurnTimerWidget` in HH's chrome (gated on the timer
    setting there, and self-gated as well), and `CampaignTracker` mounts a small `RailFooter` (the
    Add-combatants button + Clear the order) — both pure combat-store features from the original
    toolbar/sidebar that the embed hadn't wired. Deleted with the seam.
  - The per-player turn chip on a campaign party card (`MemberTurnButton`, in `CampaignTracker`'s
    `cardExtra` header slot) follows the same "Enable turn timer" setting: off, no chip is drawn and
    a pane card with nothing else in its header gets `header: null`, so no empty `.party-card-tools`
    gap. The tracker's own `PartyView` member-card "⏱ m:ss" chip follows it too. Display-only — the
    saved turn history is never cleared.
  - `combatStore` exports a **vitals-gesture API** for the never-overwrite door in `pcSheetTruth.ts`:
    `takeVitalsGesture(id)`, which answers whether the dispatch now running is a GM gesture on that
    row. Inside the store, `asGesture` wraps each explicit GM vitals action (damage, healing, temp HP,
    max HP, Mark defeated / Restore, a condition added or removed, a condition's value or duration
    set) and `markGesture` marks the PC row it changed. **Undo / Redo are not gestures and never
    push**: putting an older board back is a load, so the seam re-bases a PC row on the player's sheet,
    and the GM takes a change back with the opposite gesture (Restore, heal, remove the condition).
    Nor does an Undo call back a change of his that is already on its way to the server. A
    gesture lives only while that action's own `set()` dispatches and is never written onto a row, so
    nothing persisted, saved or mirrored carries one; the standalone tracker has no subscriber that
    takes them, so there it is inert. Pinned by `tracker/src/store/vitalsGesture.test.ts`. To remove:
    drop the export, unwrap each `asGesture(…)` back to its bare `set(…)` and delete the `markGesture`
    calls — or keep it, harmless.
  - **Search pages and creatures as windows** (2026-10-11, item 7). `GlobalSearch` opens a host record
    as a `host` window when the host has `render` (`host.open` otherwise — standalone has no host), and
    its Escape stops where it is handled (the box's `onKeyDown`, plus a `document` listener for a press
    made with the focus elsewhere), so neither the top-bar Search nor the GM screen's "Add to GM
    Screen" picker can fall through to "leave the campaign". `windowStore`: a host page opens 560 wide
    (`winWidthFor`), placement and clamps are in the zoomed page's own pixels (`pageZoom`) against the
    window's own width, `toFront` on the top window no longer climbs, `topZ` is renumbered past 1500
    without ever dropping below a window's z, and `closeTop` / `closeAll` exist. `dockDragStore` (and
    `FloatingWindow`'s tab detach) put every window it moves or pops out of a pane in the zoomed page's
    own pixels too. `FloatingWindow`: the header draws `HostSearch.controls` for a host tab (a strip
    above the page when a pane of two tabs has no header), a host page and a full stat block have no body
    inset, a host page's text is selectable, and a creature WINDOW (not a hover preview) is the full
    `StatBlock` with "Add to initiative" (`BestiaryStatBlock`, one `addCombatant` row per press, inside
    the tracker's `ErrorBoundary`). That block is drawn `notOnBoard` (a `StatBlock` prop): it is no row
    on the board, so its use trackers are counts, not pips and − / + / ↺ buttons whose writes the store
    would drop, and a cooldown's dice are plain dice. A bestiary creature inside a pane layout is its own
    tab kind, `'bestiary'` (`windowStore` `toLayoutTab`): a layout reads every `'creature'` tab as a live
    combatant id and prunes the rest, so the GM screen (`GMScreen` `keepBestiaryPins`: every creature
    tab its tree gains that is no board row — the "Add to GM Screen" picker, the Random Encounter
    widget's "Preview", any later route) and a creature window docked into a layout (`dockDragStore`'s
    three drops) put it in as `'bestiary'`, which `FloatingWindow` draws as the same full block
    (`BestiaryStatBlock.test.tsx`, `FloatingWindow.body.test.tsx`).
    The seam's half: `CampaignTracker`'s Escape handler that closes the top window — a COVER on the
    dismiss stack (`useEscapeClose` `DismissUnder`), so the player's sheet and everything it opens under
    a window wait their turn, and standing down while one of the tracker's overlays (drawn over the
    windows) is open — `trackerUi.onReset` clearing the windows on the way back to the campaigns list,
    and `campaign-tracker.css` lifting a confirm HH raises without the tracker's style (the sheet's
    "Update before leaving?") above the windows. To remove: keep them (each is inert without a host) or
    revert the routing line in `choose`.

## Ctrl+Z belongs to whatever is on screen

HH binds Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y globally to the CHARACTER undo timeline, with no mode gating.
Inside a campaign that was actively harmful: a GM undoing a bad damage roll silently reverted an
unrelated character edit (possibly from before they opened the campaign) and left the combat alone —
combat has its own undo stack, reachable only from two glyph buttons in the rail.

So `CampaignTracker` **claims** the shortcut while it's mounted (`combatUndoClaim.ts`) and runs its own
handler against `combatStore.undo/redo`; `App.tsx` checks `combatOwnsUndo()` and stands down. One press
= one action, and it's the action you just took where you're looking. Outside the campaign the claim is
released and Ctrl+Z is the character undo exactly as before. Both stay window listeners — the claim is
the only thing stopping them from both firing.

**Except on a player character's row.** Its HP and conditions are the player's sheet (below), and an
Undo there never reaches that sheet: the same pass puts the row back on what the sheet holds — the GM's
own change included once it is on its way — so Ctrl+Z takes back nothing of his that has reached, or
is on its way to, the server. What it does take off the row is a change of his not sent yet: one that
reached nobody and is waiting for a retry, or one made while another of his was still on its way —
neither then ever goes out. Monster rows, initiative, turns and everything else undo as before. To
take back what he did to a player, the GM uses the opposite action (Restore, heal, remove the
condition), which reaches their sheet like any other.

## Why the `.tracker-root` wrapper is load-bearing — do not remove it

The tracker's stylesheet is compiled with Tailwind, which emits **Preflight**: a global reset
targeting `*`, `html`, `body`, `h1..h6`, `ul/ol`, `button`. Unscoped, that reset would wreck the
builder — HH has 37 heading elements but only 5 heading rules, so Preflight's
`h1..h6 { font-size: inherit; font-weight: inherit }` alone would collapse ~32 of HH's headings to
body text, strip bullets from lists that don't set `list-style`, and impose a global `box-sizing` HH
never had. The two stylesheets also both define 5 class names (`btn`, `btn-primary`, `btn-danger`,
`btn-ghost`, `chip`) which would otherwise fight over load order.

`tracker/scripts/build-scoped-css.mjs` confines **every** selector to `.tracker-root`, and
`tracker/scripts/verify-scoped-css.mjs` proves it by walking the parsed AST (grep can't do this —
Tailwind emits multi-line selector lists). Both run on `npm run build:css`:

```
selectors checked : 425
✓ every selector is confined to .tracker-root
```

**If the wrapper class is removed from the mount, the CSS still loads — and silently breaks HH's
headings.** The scoping only works because the wrapper exists.

### …and why the reset uses `:where()` — the subtle half

Scoping a selector doesn't just move it, it **promotes** it. Preflight's `button { padding: 0 }` is
specificity (0,0,1); HH's `.tab { padding: … }` is (0,1,0) and normally wins. Prefixed naively to
`.tracker-root button` it becomes (0,1,1) and starts **beating** `.tab` — so HH's own components
rendered inside the tracker (the GM's sheet, the party cards) lost their padding and borders and
rendered as run-together text. Caging the reset made it *stronger*, which is the opposite of the
intent.

So the build splits the two cases:

- **Element-only selectors** (the reset: `button`, `h1`, `ul`, `[type='text']`, `*`) →
  `:where(.tracker-root) button`. `:where()` contributes **zero** specificity, so the rule stays
  (0,0,1) exactly as Tailwind intended — still unable to escape the wrapper, still outranked by any
  class rule, HH's included.
- **Class/id selectors** (`.btn`, `.chip`) → plain `.tracker-root .btn`. Here the added specificity
  is *wanted*: it's what makes the tracker's `.btn` win over HH's colliding `.btn` inside the mount.

Both forms are accepted by the verifier. **Don't "simplify" this back to a uniform prefix** — that
is precisely the bug it fixes.

## The tools live OUTSIDE the tracker — anything that can lose the sheet must ASK

`TrackerTools` renders in Heroes Heaven's chrome (`CampaignsPage`), while the GM's open `GmEditSheet`
and its unpushed working copy live inside `CampaignTracker`. So a tools button **cannot see whether
there are unsaved changes**, and must never navigate or swap the pane on its own — leaving the
campaign view unmounts the tracker and bins the working copy silently.

Every such button therefore posts a **nonce** to `trackerUiStore` (`paneRequest`, `settingsRequest`)
and `CampaignTracker` decides: it calls `GmEditSheet`'s `confirmLeave` and only proceeds if the GM
agrees (Update / Discard) — Cancel, or a failed push, leaves everything where it is. Nonces rather
than booleans because "show me the party" is a real request even when Party is already the selected
view, and because the answer is asynchronous and refusable.

**If you add a tools button that leaves or replaces the campaign view, follow this pattern.** Wiring
it straight to a `setView` looks identical and works fine right up until a GM loses an evening's
edits.

## Maintenance

After editing any tracker CSS, re-run `npm run build:css` **in `tracker/`**. The scoped bundle is a
build artifact; it does not hot-reload inside HH (the tracker standalone still does).

## Test fixtures (created 2026-07-15 — delete when done)

The integration was verified with LOCAL test data only. Nothing was signed in and nothing was
written to Supabase — HH's campaigns are server-backed and `createCampaign` refuses without auth, so
the campaign here is a **local membership cache entry** plus the app's built-in DEV-only auth bypass.

Seeded (all in the browser's storage for `localhost:1420`):

| Storage | Key | Value |
|---|---|---|
| localStorage | `wanderers-codex:roster:v1` | 3 characters: **TEST Valeros** (fighter 3), **TEST Kyra** (cleric 3), **TEST Merisiel** (rogue 3) — built with HH's OWN `buildCharacter()` so they're structurally valid — each with `campaignIds: ['test-campaign-1']` |
| localStorage | `pf2e-codex.campaigns` | one membership: `{ id: 'test-campaign-1', code: 'TEST01', role: 'gm', name: 'TEST Campaign' }` |
| localStorage | `wanderers-codex:active:v1` | the Valeros id |
| localStorage | `pf2e-tracker-parties` (tracker) | a "TEST Campaign" party with the 3 players |
| sessionStorage | `hh-dev-skip` = `'1'` | HH's own DEV-only auth bypass (`import.meta.env.DEV &&` — always false in a production build), which is what makes `partyEnabled` true without signing in |

**To remove:** clear those keys (or Application → Clear site data on localhost:1420). They are
dev-only and cannot reach a production build or the server.

## What is connected, and what isn't

**Connected.** The party cards are HH's real `PartyMembers`, fed from the **server party**
(`fetchParty` at mount, then every list `PartyMembers` loads, via `onMembers`) with the local roster
as the dev-without-login fallback; clicking one opens the real `GmEditSheet`; the initiative order
drives which character the main pane shows; and the **party level** — which the whole encounter
budget is rated against — is derived from the characters' real levels instead of the hand-typed
number that defaulted to 1.

**The sheet is the truth for PCs** (`pcSheetTruth.ts`). A PC row's HP and conditions are READ from
the player's published sheet (`fetchMemberSheet` + `subscribeMemberSheet` per member), and a
condition or damage the GM applies to a PC in the tracker is written back to that sheet through
`pushGmEdit` — only on the GM's own gesture (the combat store's vitals-gesture API, above), never
because a row merely differs from the sheet, and never on Ctrl+Z / Ctrl+Y. Each push first reads the
published sheet (with the GM's own pending edit, `gmPushBuiltOn`) and lands only while it still carries
what the row showed when he made the gesture; otherwise the sheet wins. Read that file's header before
touching either direction: it is where the never-overwrite rules live.

**Known gaps.**

- **The seam's row is matched charId first** (`isSamePc`, the tracker's own rule): a PC row added
  from the party carries the character's id, so two same-named characters get two rows, each driven
  by its own sheet. A row with no id (typed in by hand, or saved before ids were kept) falls back to
  the name — and a row two members' names both match is driven by NEITHER sheet: nothing is written
  to it and nothing is pushed from it. Other surfaces in `CampaignTracker.tsx` (the PC stats strip,
  the live-member lookup) still match by name; see `tracker/DEFERRED.md` §3.
- **A GM change can still be lost** (the seam header, rule C) — the player's only in the narrow cases
  named at the end of this bullet. The player's app
  applies a push only when their sheet is still exactly the one it was built on (`gmEditVerdict`), so
  ANY change of theirs published between his fresh read and their app picking the push up — a potion,
  a Shield Block, a note — refuses his whole push: the overlay stands down, his row snaps to their
  sheet and the card says "not applied"; he gestures again. Back-to-back gestures (the second built on
  his first, `gm_base.on`) land when the device that applied the first judges the second (its chain
  record names that push, or the very publish it was applied over — so a third gesture is caught too)
  while that device still holds exactly what the apply produced and the server is still at that
  publish or holds that result, or when no device has applied the first yet and their published row is
  still the very publish he built on. Otherwise the second is refused the same visible way: judged by
  their other device after the first republished, or after ANY republish of theirs, even one that
  changed nothing of theirs (a launch) — content alone cannot tell "nothing changed" from "his first
  push was applied and then taken back" (a heal after his hit), and applying there would carry the hit
  back over the heal. **That includes two between-session Updates, the second built on the first: when
  the player's launch republish lands before their app reads its own row, both are refused ("not
  applied") — a GM-side, visible cost kept for player safety, open for the owner's ruling**
  (test/bug-gm-edit-race.test.tsx leg 34c pins both orders). A single between-session Update (built on
  their published sheet) still lands after a launch, by content — also when this version's load
  migrates their play (`storage.loadedAuthoredAs`, leg 34b). The ordering no stamp can tell apart (their app applying
  an EARLIER push of his after a LATER one was built on it) still snaps his row for a moment. Unseen:
  an owed gesture the seam never got to send before it unmounted. With no sign beyond his "waiting"
  chip going: an unapplied edit of his when their app republishes WITHOUT changing anything of theirs
  (a launch) and he gestures before their app has applied the edit: the write
  path wants the very publish his edit was built on, so his next gesture — or his next full-sheet
  Update from `GmEditSheet`, which judges against their sheet then — is built on their sheet and
  replaces that edit on the server (the price of refusing to build on a sheet that only came BACK to
  his base, which would carry an old hit of his over their heal). On the server: only an edit an OLDER
  GM app wrote has no proved base; every push this app makes carries `gm_base`, so seeded edits are
  built on. **The player's loss that remains** (F1 design §6.3, narrow): one device applies his edit and
  they press Ctrl+Z inside the 400 ms publish debounce, so nothing of the undo is published; their OTHER
  device, open and level with the server, then judges his next push built on that edit before cloud
  sync carries the undo across — it applies (nothing it can read says otherwise), and the per-character
  cloud merge can carry that over the undo. The chain record is per device on purpose: synced, a stale
  device's record could overwrite newer work. Two more, both pre-existing in kind: after an APPLY, this
  device's republish can overwrite a publish their other device made after this device's own-row read
  (about 400 ms plus a round trip; the cloud roster merge then decides — F1 design §6.4). A device
  BEHIND its own cloud copy no longer applies at all: the app pulls its cloud copy first
  (`cloudSync.pullForGmApply`). A newer copy from their other device is adopted, and that adopt lands
  BEFORE the apply — both are ordinary background updates on the same React lane, rendered in the order
  they were made — so the apply's re-check finds the entry moved and the push WAITS; once the adopted
  sheet republishes it is REFUSED, with a receipt (race legs 38, 43–45, run under production update
  priorities) — what that pull cannot see is a change their other device has published but not yet
  synced to the cloud (its 3-second upload debounce), the same window in kind; and the GM's
  own knowing **Overwrite anyway** on the full-sheet Update, shown "changed since your copy", pushes on
  their current sheet, so their app applies it over those changes — his choice, never the app's.
- **Two tabs of one browser profile**: a GM apply in the background tab inside the other tab's 400 ms
  persist debounce can win the cross-tab write — a pre-existing class (the applier before F1 had the
  same window), open for the owner's ruling since 2026-09-13 ("two tabs both editing within 400 ms,
  last flush wins"); between DEVICES the cloud merge keeps the player's change.
- **A hung cloud pull holds every apply**: the player's GM-edit pass gives up on any one network answer
  after 20 s and ends, but a pull that never answers leaves cloud sync's `syncing` flag set until it
  settles, so every APPLY waits for the rest of that session — nothing is lost, the GM sees "waiting".
- **An absolute play write in the apply's render batch**: the player's app tells "his edit, or their
  change made on top of it" by a mark the apply leaves on the entry (App's `GM_APPLIED`, carried by
  every updater's spread). A play write that sets a value outright from what the screen showed — typing
  HP, temp HP or XP — landing in the very batch that applies a tracker gesture keeps the mark but
  overwrites that one field with the player's value: the gesture is consumed as applied, with no
  receipt, and his row snaps to their sheet. A sub-millisecond window; the player's value wins, by rule.
- **A builder save in the apply's render batch**: the builder's save spreads the entry, so it keeps the
  mark and the edit is consumed as applied, while the builder's character and build — the copy taken
  when the builder opened, before the apply — replace his; his play changes stay (`playForRebuild`).
  No receipt; his card shows their published sheet. The same is true of a builder save made at any
  time after an apply (the builder saves the copy it opened). A sub-millisecond window inside the
  batch; GM-only and visible.
- **Ctrl+Z in the apply's render batch** spends the keypress on the apply the player never saw (the
  entry goes back to the one it was judged over, which still carries the judged mark, so nothing is
  consumed and nothing is refused); the edit stays waiting and the next pass applies it again. Nothing
  is lost.
- **Creature data isn't wired up** — `Link Stat Block` reports "Data not loaded. Run: npm run
  setup-data". Creatures can still be authored via the **Custom** text converter, which is how the
  stat-block pane was verified.
- **Anything server-backed is untested here**, because these test campaigns exist only on this
  device. That includes `GmEditSheet`'s **Update** (it pushes through `gm_character_edits`) and the
  campaign's **Settings & defaults**, which reports "No campaign with that code". Local campaign
  persistence behind `TEST_CAMPAIGNS_WITHOUT_LOGIN` would close this. The server path IS covered by
  `test/bug-tracker-seam.test.tsx`, which runs the whole seam against a mocked party layer with the
  dev flag OFF — but nothing here has met a real Supabase campaign.
- **A phone never sees the tracker at all** (see the table above): the GM half of the campaigns page
  is desktop/web only.
