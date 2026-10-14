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
| `src/sheet/PartyMembers.tsx` | optional `localMembers?: PartyMember[]` prop; optional `renderExtra?` render-prop returning `PartyCardSlots` (`header` = the turn chip + "+" button in `.party-card-tools`, `saves` = extra tiles in the turn band's `.party-defs` block, `right` = the whole `.party-row-ref` band — the card's second row — whose presence is what puts `.has-right` on `.party-card-body`, and `core` (2026-10-13, owner's list item 3: "the switches need to do what they say") = the tracker's "Stats shown" switches for the card's own sub-line, AC tile and Perception tile — `PartyCard`'s `showSub` / `showPerc` / `showAc` / `showDefs`, the HP bar never one of them; a card with no `core` shows all three, so HH's own Party page and campaign detail are unchanged); optional `onMembers?` callback (every loaded list, so the tracker's party can be built from the server party — this component mounts INSIDE the tracker's party view, which needs that party to exist first); optional `dialogStyle?` (2026-10-10), passed to the kick's `confirmDialog` as `style` so the confirm wears the tracker's look above its windows | Delete the four props + `PartyCardSlots`; use `members`; drop the `extra` slots and the `.has-right` term, which leaves the card its turn band and nothing else (the four `show…` flags go with `core`: the sub-line, Perception and AC are drawn unconditionally again); drop `style: dialogStyle` from `kick` |
| `src/sheet/partySummary.ts` (HH's own fix, 2026-10-13) | `computeSummary` asks `derivePerception(c, content)` WITH the content database, as the sheet's own rail does, so a passive Perception item's item bonus reaches the card. NOT part of the seam: every party card reads it. The summary a player's app PUBLISHES changes with it — a teammate on an older app publishes the value without that bonus until they update | Keep |
| `src/sheet/confirm.tsx` | optional `style?: DialogStyle` on `ConfirmOptions` / `ChooseOptions`, applied on the `.picker-overlay.confirm-overlay` (2026-10-10). The dialogs are detached roots on `<body>`, so no context reaches them: a confirm raised from the tracker (Clear the order, a card's kick, the local table's "No campaign settings") gets the tracker's `--app-*` variables plus the four text properties `<body>` sets (`hhSurfaceTheme` in `trackerAppearance.ts`) and a z-index above the floating windows (HH's own 80 sat under a window at 501). GmEditSheet's dialogs pass nothing: they belong to the app-themed full sheet (a rule in `campaign-tracker.css` lifts such an un-styled confirm above the windows while the tracker is on screen, 2026-10-11) | A generic option with no tracker names — harmless to keep. To revert: delete `DialogStyle`, the two `style?` fields and the two `style={style}` |
| `src/sheet/download.ts` (2026-10-13, G7s) | optional `style?: DialogStyle` on `DownloadFile`, handed to the Android route's Save to folder / Share `chooseDialog` as its `style` (the web and PC route raises no dialog and ignores it). `CampaignTracker`'s `hostSave` passes the same `dialogStyle` its confirms get, so the chooser an export opens in the tracker wears the tracker's look above its windows (the owner, 2026-10-01: "if i open a pop up in the initiative tracker it needs to have the same colors as the initiative tracker"); `TrackerSettingsSection` passes none (HH's own Settings page). `test/download-platform-route.test.tsx` | A generic option with no tracker names — harmless to keep. To revert: drop the field, `saveOrShareOnPhone`'s `style` parameter and the `style` line in its `chooseDialog` call |
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
  unchanged. There are seven:

  | Context | What HH supplies | Standalone (no provider) |
  |---|---|---|
  | `partyLevelContext` | the party's level, derived from the real characters | the party store / the typed local level |
  | `monsterPartsContext` | the campaign's Battlezoo rule + Full/Light/Hybrid variant | the tracker's own "Show Monster Parts value" setting, priced on Light |
  | `pcPaneContext` | a renderer so a PC's pane is HH's own party card for that character (a click opens the GM sheet over the tracker); the row's member is found by its character id first | the tracker's own `CombatantDetail` |
  | `pcStatsContext` | each PC's real stats (AC/saves/level/temp HP/…) so the initiative order can show them, keyed by character id (`byId`, a row's first key — a rename on either side keeps the link) and by name (a row with no id); `folded` — which conditions those stats already count, so the row adds the tracker's penalty only for the rest; `badgesById` — the sheet's derived conditions and active modes, drawn locked; `members` — the campaign's PCs, for Quick add | `PartyPlayer.pcStats` (the DM-entered sheet), every condition counted by the tracker, no badges, Quick add name-only |
  | `hostSearchContext` | an index of every HH record for Search; `render`, the body of an HH page in a tracker window (a Search result opens as one, 2026-10-11) or a GM-screen pane; `controls`, that page's favourite star for the window's header (a strip above the page in a pane holding two tabs, which has no header); and `open` (this host opens the same window — Search calls `open` only for a host with no `render`) | Search over the tracker's own reference data |
  | `hostThemeContext` | the GM's tracker-only look (`useTrackerVars()`, one object per appearance state, or null when the tracker inherits the app's look), which `BodyPortal` puts on everything the tracker draws on `<body>` | null — the popup inherits the document's variables, as always |
  | `hostSaveContext` (2026-10-13, item 8's Android half) | HH's one export helper, `downloadText` (`src/sheet/download.ts`): the anchor on the web and the PC app, the app's Save to folder / Share chooser on the Android app, whose WebView ignores an anchor download. `TrackerSettingsSection` gives it as is (Settings → Initiative tracker → Encounter tables' Export); `CampaignTracker` gives `hostSave`, a wrapper that also sets `isolation: isolate` on its root while the export is in flight, so the chooser on `<body>` (the confirm lift, 1600) is drawn over the Encounter Manager that asked (a tracker modal, 2000) instead of under it (the G8t refuter, measured in Edge), and hands the chooser the tracker's `dialogStyle` (`download.ts` `style`, G7s), so it wears the tracker's look. Both tracker exports go through `tracker/src/utils/saveTextFile.ts` with the same file names and text as before (`tracker/src/components/hostSave.exports.test.tsx`; the HH half in `test/download-platform-route.test.tsx`) | the tracker's own anchor download, unchanged — attached while clicked, its URL revoked a second later (the encounter-table export used to click a detached anchor and revoke at once) |

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
    combatant itself has no HP (`c.maxHP === 0`) — a PC row the seam has not reached yet (once it
    has, `pcSheetTruth.writeVitals` puts the sheet's current and max HP on the row). A standalone PC
    gets `maxHP` at add-time, so its own HP still wins; the fallback only fills the gap.
  - **The PC row agrees with the card** (2026-10-13, owner's list item 3). `InitRow` reads the host's
    stats by `useHostPcStats(name, charId)` (and its party-store fallback by `isSamePc`), so a renamed row
    or character keeps them; for a PC with host stats it applies the tracker's condition penalties only
    to the badges the host does not fold (`useHostConditionFolded`) — the sheet's own conditions are
    already inside those numbers, and counting them again drew a frightened player two under their
    card; it draws the sheet's temp HP as "+N" beside the bar (`PcStats.hpTemp`, display only — never
    the row's `tempHP`, never pushed), the sheet's derived conditions and modes as dashed locked badges
    (`useHostPcBadges`), and with "Show level in initiative order" a PC's level from the host. Badges
    go through `conditionMetaOf` (`conditionEffects.ts`), whose alias table styles HH's
    `persistent-damage` as the tracker's `persistent damage` — display only: the row keeps the sheet's
    name, so the auto-roll (which wants that exact name and an amount) never fires on a player. The
    encounter rating's per-PC level asks `useHostPcLevel(name, charId)` the same way. To remove: keep
    them (inert without a provider) or drop the `charId` arguments, `pcCm`, `lockedBadges`, `pcLevel`
    and `hpTemp`.
  - **Quick add links a member's name** (`MonsterSearch` `quickAdd`, 2026-10-13): inside a campaign a
    line that names one of its PCs (`useHostPcMembers`) is added as that PC — `addPartyMemberToOrder`
    with their entry in the campaign's mirrored party, through `addCombatant`'s `isSamePc` dedupe. An
    entry that is missing is made first, exactly as the mirror makes it (`partyStore`
    `ensureCampaignMember`, sharing `mirrorMember` with `syncCampaignParty`, in the party of the campaign
    `syncCampaignParty` last mirrored), so every member's row carries its party stamp — there is no
    direct PC add any more (2026-10-14; test/bug-tracker-pc-row-agrees.test.tsx (H)). Standalone, and for
    any other line, it is the name-only row it always was. To remove: back to `addCombatant(null, { name })`
    for every line.
  - **Players' conditions step with the turn** (2026-10-13, owner's list item 3): the setting
    `pcConditionTicks` (`settingsStore`, on by default; "Step players' conditions each turn" in
    `SettingsModal`'s `PlayersSection`, reached from HH Settings → Initiative tracker → Player
    characters) lets `endTurnPass` / `tickConditionsAtStart` step a PC's Frightened and Stunned as they
    do a monster's (`stepsConditions`); off, a PC's conditions are left alone. The step is a vitals
    GESTURE (below). `PlayersSection` and `PcDetailControls` take an optional `campaignDriven` /
    `descs` so HH's Settings describes the Defenses switch as AC only (a campaign card keeps its HP bar).
    To remove: keep (standalone-safe) or drop the setting and `stepsConditions`.
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
    set) and `markGesture` marks the PC row it changed — and, since 2026-10-13, `nextTurn`,
    `startCombat` and `returnFromDelay`, whose condition step marks a PC row only when it changed it
    (Frightened down at the end of a player's turn, Stunned used up at the start, while
    `pcConditionTicks` is on); `pcSheetTruth.writeVitals` leaves those two sheet conditions unpinned
    for it (`stepsWithTheTurn`, `pinsAStep`). A step the seam TAKES is spent (`markStep`,
    `_stepsTaken`, keyed by fight, PLAYER, turn phase and round, kept outside every undo snapshot; the
    player is `stepOwner` — their character id, else their party stamp, else for a row with neither their
    name — never the row id, which a load or the other device can hand to a different player): an Undo
    of that Next cannot reach the player's sheet, so Next pressed again does not step them a second time
    for the same turn. `startCombat` gives a fresh fight a new id (`newFight`, `freshFightId`, never
    reused, on any device) rather than clearing the record, because Start is no undo step: every undo /
    redo snapshot carries its board's fight (`CombatSnapshot.fight`), so Ctrl+Z back across an End and a
    Start brings the older fight back with the steps it spent. The undo history is not all that can bring
    an older turn back: the GM-device mirror (`trackerSync.ts`) adopts any board with a newer server
    stamp, and one edited on his other device while this one pressed Next predates that Next. So the
    fight id is saved WITH the board (`PersistedCombat.fightId`, and so mirrored), and `reloadFromStorage`
    (a mirrored board, a campaign switch) keeps the spent steps of the loaded board's fight and lets go of
    every other fight's (`keepFight`); a board with no fight id (saved before 2026-10-14) clears the
    record as before. The fight's spent steps are saved with its board too (`PersistedCombat.spentSteps`,
    each without the fight, sorted, read as the save happens; absent when none), and every load takes
    them in — a mirrored board, a campaign switch back, and the app starting (`adoptSpent`) — so Next and
    Ctrl+Z on one of his devices cannot let the other step that turn end again, and nor can switching
    campaigns away and back. Neither field is part of a saved encounter or of the board's fingerprint
    (`combatSignature`), and a load still writes nothing back: the list only rides on saves the board
    makes anyway. One side effect: after this device adopts an older board of the same fight while it
    holds more spent steps, the next save that is no edit (a dice roll) writes different bytes, so the
    GM-device mirror pushes that board to his other device. It touches only his own two devices, never a
    player, and a running turn timer already did the same. Not covered: Next pressed for the same turn end on BOTH of his devices before either
    has the other's board steps it on each; a board saved by an app version from before 2026-10-14 (his
    other device not yet updated) carries no fight id and clears the record when it is loaded. KNOWN
    GAP — a step handed back can come back as spent: handing it back (`releaseSteps`, below) lets go of
    it on THIS device only. A board saved before that still lists it, and once the mirror has carried
    that board to his other device, that device holds the step spent too (a board of the same fight
    keeps its fight's steps) and lists it again on its next save; this device adopts that board, and the
    step is spent here again. So when that turn comes round again the player misses that one condition
    step. It needs the sheet offline, an Undo and both GM devices in use at once; it never overwrites
    anything, and the GM steps the condition by hand. Handing it back deliberately writes nothing, since
    a save that is no edit would make the mirror push this board over a newer one from his other device.
    Pinned as today's behaviour (`pcConditionTicks.test.ts`, "KNOWN GAP"), so a change to it is
    deliberate. Nothing is spent where no host takes it. The seam hands a step back (`releaseSteps`,
    the change's `steps`) when it never reaches the player — owed and then taken off the row by a load,
    or lost to the sheet winning — so that turn steps them once if it comes round again (on this device;
    the known gap above). **Undo / Redo are not gestures and never
    push**: putting an older board back is a load, so the seam re-bases a PC row on the player's sheet,
    and the GM takes a change back with the opposite gesture (Restore, heal, remove the condition).
    Nor does an Undo call back a change of his that is already on its way to the server. A
    gesture lives only while that action's own `set()` dispatches and is never written onto a row, so
    nothing persisted, saved or mirrored carries one; the standalone tracker has no subscriber that
    takes them, so there it is inert. Pinned by `tracker/src/store/vitalsGesture.test.ts` (spent steps:
    `tracker/src/store/pcConditionTicks.test.ts`; through the mirror: `test/tracker-sync.test.ts` ab, ac, ad;
    through the seam: `test/bug-tracker-seam-never-overwrite.test.tsx`). To remove: drop the export, unwrap each
    `asGesture(…)` back to its bare `set(…)` and delete the `markGesture` / `markStep` calls and
    `_stepsTaken` — or keep it, harmless.
  - `combatStore` exports `moveBeforeActive(s, id)`, the one reorder for 'a creature went down'.
    `pcSheetTruth` keeps, per player, the HP last seen on THEIR side (`SeenPc.theirs`). It also keeps a
    drop to 0 owed to the row (`SeenPc.drop`), set when their side goes from above 0 to 0: either a
    sheet arrives, or a GM push loses to a newer sheet. In its plain (non-gesture) writeVitals it moves
    the row before the acting creature, onto its number, only when that write takes the row from above
    0 to 0 mid-fight. Nothing is pushed. Pinned by test/bug-tracker-seam-never-overwrite.test.tsx ('a
    player whose own sheet drops to 0…' legs). To remove: drop writeVitals' `dropped` argument,
    `follow`, `SeenPc.drop` and `SeenPc.theirs`.
  - CombatantDetail opens InitiativeTracker's exported CombatantMenu on a right-click of the stat
    block. HH's App.tsx right-click blocker leaves an already-prevented event alone
    (test/bug-tracker-dying-npc.test.tsx (a)).
  - Tracker boxes and inline menus spend their own Escape (tracker/src/utils/spendEscape.ts, plus the
    ☰ menu's document listener; the condition picker is a registered tracker layer (useEscapeCloses,
    `panel`) since 2026-10-14), so it never reaches the campaign's base handler
    (test/bug-tracker-dying-npc.test.tsx (b), (c), (d)).
  - **The seam's own Escape guards** (`CampaignTracker`, 2026-10-13): its window capture listener reads,
    as of the key press, whether a tracker popup is on `<body>` (`popupAtPress`), whether a tracker
    modal is open in the view (`modalAtPress`, `trackerModalOpen` — the `.modal-overlay` of the
    Encounter Building tables, Link Stat Block, the encounter-table editor, the advanced condition
    editor, a party card's turn-time graph) and whether the press was typed in a tracker text box
    (`editableAtPress`, `editableInTracker` — a text input, textarea or editable region; a dropdown holds
    no text and is a plain press) and, if so, which floating window holds that box (`boxWinAtPress`,
    the `[data-float-win]` id). The base "leave the campaign" handler stands down for any
    of them — a box in ANY tracker file (the stat block's, the GM screen's, the Monster Parts popup's)
    can no longer leave the campaign — and the windows' handler stands down for a popup, a modal, or a
    box outside every window, so Escape never closes a window hidden behind one, nor an unrelated window
    while the GM types elsewhere. A box inside a window closes THAT window, even when another window is
    above it (keyboard focus raises no window) (test/bug-tracker-escape-boxes.test.tsx). Both also stand
    down for a tracker modal still on screen when they run (`trackerModalOpen()` live, beside the
    as-of-the-press checks): Android's Back is a `popstate`, no key press, so nothing was recorded for it
    (G7s, 2026-10-13). And neither acts on a REPEAT (`repeatAtPress`, the key held down; G7s round 2):
    after a tracker popup that is no registered modal took the first press — the stat block's ☰ menu,
    the row menu (the condition picker until 2026-10-14) — each repeat closed the next window and then
    left the campaign
    (test/bug-tracker-escape-boxes.test.tsx (i)). Deleted with the seam.
  - **The tracker's modals close themselves on Escape** (`tracker/src/utils/spendEscape.ts`
    `useEscapeCloses`, 2026-10-13): the Encounter Building tables, the encounter-table editor and its
    Link picker, the custom-condition editor and its Delete confirm, MonsterSearch (Add Combatants and a
    party card's Link Stat Block) and its right-click menu, the Text Converter and its help box; the
    turn-time graph, the Monster Parts popup, the condition picker, and the GM screen's + menu and "Add
    to GM Screen" picker (2026-10-14). One
    `document` listener closes the top one not covered all over by another layer — nor drawn under another
    floating window, when it sits inside one (`underAnotherWindow`: a stat block's Edit converter in a
    window, with a window opened over it; G7s round 2) — and spends the press; a `window` capture listener
    holds a held key's repeats from the first press, whichever listener closes the modal (the StrictMode
    order). Standalone-safe (it is the tracker's own Escape); no host needed.
    `tracker/src/components/modalEscape.test.tsx`, `modalEscapeCoverage.test.ts` (which counts a listener
    as a closer only when it spends the press; TurnTimeline and MonsterPartsPopup left its KNOWN_GAPS on
    2026-10-14). The Text Converter's overlay keeps its right-clicks (its Edit copy sits inside the stat
    block, whose right-click opened the combatant menu over it; `CombatantMenu.test.tsx`).
  - **Android's Back closes the tracker modal on top** (G7s, 2026-10-13). The same file exports
    `closeTopTrackerModal()` (closes the top registered modal through its own close, unless something is
    drawn over all of it; answers whether it did) and `useTrackerModalCount()` (how many are open, a
    `useSyncExternalStore` told on every open and close). The seam's half: `CampaignTracker` registers
    `useBackHandler(synced && modalCount > 0, closeTopTrackerModal, { cover: true })`, declared after the
    windows' handler — which is off the stack while a modal is open, so a window opened from inside one
    cannot land above it — and `TrackerSettingsSection` the same over HH Settings' page handler, so Back
    over the table editor closes the editor and Settings stays (test/bug-tracker-escape-boxes.test.tsx,
    BACK). The keyboard's Escape reaches them past an open modal only when the modal's own listener left
    it unspent for a layer drawn over all of the modal, and `closeTopTrackerModal` closes nothing while
    such a press is still on its way — so a layer that closed itself on that press never takes the modal
    under it too (test/bug-tracker-escape-boxes.test.tsx (g); modalEscape.test.tsx (p)). The `cover` is
    load-bearing: the sheet and Customize, drawn under the modals and registered `under`, wait their turn
    whenever they were pushed (BACK, "Customize opened since"). A modal UNDER A WINDOW (G7s round 2): the
    same file exports `topTrackerModalUnderAWindow()` and `underAnotherWindow(el)`; while the top modal sits
    in a window another is drawn over, `CampaignTracker`'s modal handler closes the window on top instead
    (the windows' own close, `closeWindowForPress`), standing down for a modal drawn over every window
    (`trackerModalOverWindows`, as of the press and live) — test/bug-tracker-escape-boxes.test.tsx (h),
    BACK. A panel with no backdrop registers with `{ panel: true }` (its own box is hit-tested);
    `topTrackerModalUnderAWindow()` also answers true for a layer drawn under the windows that one covers
    all over (the GM screen's + menu), so the campaign's modal Back handler closes that window first.
    The + menu also closes on any press or focus outside it. To remove: delete the two Back handlers,
    the `modalCount` term in the windows' gate,
    `trackerModalOverWindows` and `modalOverWindowsAtPress`; the four exports are harmless to keep (no
    caller, nothing registered).
  - **Search pages and creatures as windows** (2026-10-11, item 7). `GlobalSearch` opens a host record
    as a `host` window when the host has `render` (`host.open` otherwise — standalone has no host), and
    its Escape stops where it is handled (the box's `onKeyDown`, plus a `document` listener for a press
    made with the focus elsewhere), so neither the top-bar Search nor the GM screen's "Add to GM
    Screen" picker can fall through to "leave the campaign". Opened with an `escapeRef` (the GM screen's
    picker) it adds no document listener of its own — the shared tracker-layer listener closes it, and
    Back reaches it. `windowStore`: a host page opens 560 wide
    (`winWidthFor`), placement and clamps are in the zoomed page's own pixels (`pageZoom`) against the
    window's own width, `toFront` on the top window no longer climbs, `topZ` is renumbered past 1500
    without ever dropping below a window's z, and `closeTop` / `closeAll` exist. A window's height cap is
    a number of the zoomed layout's viewport (`winMaxH`: 680, at most 88 %; a live row's `liveWinH`), not
    CSS vh, which html{zoom} multiplies. Once drawn, and whenever its height changes, `FloatingWindow`
    measures the window and `windowStore.fit` lifts it until its bottom is on screen, unless the GM has
    dragged (`moved`) or resized it (`windowStore.test.ts`, `FloatingWindow.fit.test.tsx`). `dockDragStore` (and
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

- **Every PC join is charId first** (`isSamePc`, the tracker's own rule): a PC row added from the
  party — or by Quick add of a member's name — carries the character's id, so two same-named
  characters get two rows, each driven by its own sheet, and a rename on either side keeps the row
  linked: the seam's sheet sync, the row's AC/saves/level/badges (`pcStatsContext`), the PC's pane
  card (`memberOfRow`), the dashboard card's jump to that pane, the encounter rating's per-PC level and
  the party mirror's max-HP fallback. A row with no id (typed in by hand before Quick add linked, or
  saved before ids were kept) falls back to the name — and a row two members' names both match is
  driven by NEITHER sheet (nothing is written to it or pushed from it) and has no pane card. The
  tracker-internal HP bridge between rows and the tracker's own party cards (`syncPcHp` /
  `setPcMaxHP`) matches by identity too (`partyStore.partyCardOfRow`, 2026-10-14): the row's party stamp,
  then its character id, its name only when neither side has an id and exactly one card answers —
  otherwise nothing is written (`tracker/src/store/pcHpBridge.test.ts`).
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
