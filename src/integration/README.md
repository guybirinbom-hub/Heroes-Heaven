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
| `src/sheet/CampaignsPage.tsx` | `integration/` imports (`TrackerTools` + `CampaignTracker` are `React.lazy`, each in its own `<Suspense fallback={null}>`, so a player who never opens a campaign doesn't download the tracker); `<TrackerTools/>` + the `ti-palette` Customize button in the chrome; the `cmp-body-tracker` class; `<CampaignTracker>` in place of `<CampaignDetail>` on desktop; the two `TRACKER_IN_CAMPAIGN`-gated last-campaign-memory blocks; `CampaignForm`'s `localOnly` fallback | Delete the imports and restore `<CampaignDetail>` (which already has its own Settings / Delete / share code); drop `localOnly` and its branches |
| `src/sheet/CampaignsPage.tsx` (phone) | `useIsMobile` → `isPhone`, which hides every GM tool at ≤720px (Create/Edit, the tracker, the tools row, the Customize button) and renders `<CampaignDetail gmTools={false}>` + `<JoinRow/>` instead. NOT part of the seam — it is HH's own player-facing campaigns page | Keep. Only the `TRACKER_IN_CAMPAIGN && !isPhone` terms go with the integration |
| `src/sheet/gmSync.ts` | `pendingEditStillStands` compares the published sheet with the pending edit through `canonicalJson` (key order ignored — the `sheet` column is jsonb, which hands keys back in its own order), found while closing the seam's never-overwrite door; `gmPushBase` — the sheet a GM push builds on: his pending edit while it stands on a PROVED base, on his OWN character too (where `resolvePendingGmEdit` never draws it), else the published sheet; `rememberGmEdit` records a push on the base it was built on (it used to keep the older of that and the replaced edit's, which made a push built on their newer publish look overtaken); `resolvePendingGmEdit` judges its drop on the edit it HOLDS, so his own character's edit is pruned like any other (it was never dropped at all); the `gmPendingEdit` doc names the seam's own-push test as a reader, and the `baseUpdatedAt` / `pendingEditStillStands` docs say a seam push depends on those rules | Keep `canonicalJson`, the held-edit drop and the recorded base: HH's own overlay rules, with no tracker names in them. `gmPushBase` has no other caller: delete it with the seam. The docs' mentions of the seam go too |
| `src/sheet/memberSheets.ts` | comments only: two notes name the tracker seam (its pushes as what used to re-join every channel, and the seam as a reader of the re-pulled map) | Delete those two mentions; nothing in the code knows the tracker |
| `src/theme/theme-manager.ts` | `resolveAppearanceVars` — the token-resolution half of `applyResolved`, extracted + exported so a scoped appearance (the tracker's own theme) can be built without writing `<html>` | A pure refactor with no tracker names in it; harmless to keep. To fully revert, inline it back into `applyResolved` |
| `src/sheet/SettingsPage.tsx` | the `'tracker'` section (id, `ALL_SECTIONS` entry, `renderSection` case); `TrackerSettingsSection` is `React.lazy` + `<Suspense>` so opening Settings doesn't pull the tracker's stores in | Delete the three `'tracker'` references and the lazy import |
| `src/sheet/PartyMembers.tsx` | optional `localMembers?: PartyMember[]` prop; optional `renderExtra?` render-prop returning `PartyCardSlots` (`header` = the turn chip + "+" button in `.party-card-tools`, `saves` = extra tiles in the turn band's `.party-defs` block, `right` = the whole `.party-row-ref` band — the card's second row — whose presence is what puts `.has-right` on `.party-card-body`); optional `onMembers?` callback (every loaded list, so the tracker's party can be built from the server party — this component mounts INSIDE the tracker's party view, which needs that party to exist first) | Delete the three props + `PartyCardSlots`; use `members`; drop the `extra` slots and the `.has-right` term, which leaves the card its turn band and nothing else |
| `src/sheet/GmEditSheet.tsx` | `forwardRef` + the `GmEditHandle` (`confirmLeave`) so the initiative order can ask before swapping the sheet out | Drop the ref plumbing; inline `confirmLeave` back into `doExit` |
| `src/sheet/useIsMobile.ts` | `ForceMobileContext` (null default) so a narrow PC pane can put the sheet into its phone layout; `useIsMobile` returns `forced ?? isMobile` | Delete the context + the `forced ??` — with no provider it was already inert |
| `src/sheet/useEscapeClose.ts` | `triggerBack()` — fires the topmost dismiss handler, so the campaign back arrow can share the dismiss stack (close an open sheet before leaving the campaign) | A generic helper with no tracker names; harmless to keep |
| `src/App.tsx` | `TEST_CAMPAIGNS_WITHOUT_LOGIN` in the **DEV-only** `devBypass`; `bootToCampaign` + its branch in the post-content-load jump; the `setOnCampaignsPage(mode==='campaigns')` effect — reopen a campaign the app was closed on; the one `combatOwnsUndo()` guard in the Ctrl+Z handler; `which !== 'campaigns'` on the floating undo/redo pair (Ctrl+Z there undoes the COMBAT, so a character-undo button beside it would do something else) | Delete that term, the `bootToCampaign` state + branch, the marker effect, the guard, and the `which !== 'campaigns'` term |

**Deliberately NOT in that table:** the share code and *Delete campaign* on HH's campaign settings
page (`CampaignForm`), and their `sheet.css` rules. They moved there when the tracker replaced the
campaign detail panel, but they are HH's own controls on HH's own page and stand on their own — they
are not tracker machinery and should stay if the integration goes. (With the integration removed
`CampaignDetail` also brings its copies back; harmlessly duplicative, not broken.)

There is otherwise deliberately **nothing else to unwind**:

- **HH's build is untouched.** No Tailwind, no PostCSS, no vite/tsconfig edits. The tracker's styles
  arrive as ONE pre-built plain `.css` file (`tracker/dist-css/tracker.scoped.css`), so removing the
  integration is removing an import — not disentangling a build.
- **The tracker still runs standalone** on port 1421 exactly as before, with its own 654 tests. The
  dependency only ever points HH → tracker: where the tracker needs something only the host knows, it
  declares a context in `tracker/src/data/` with a **null default**, and HH provides the value. With
  no provider each one falls back to the tracker's original behaviour, so the standalone app is
  unchanged. There are four:

  | Context | What HH supplies | Standalone (no provider) |
  |---|---|---|
  | `partyLevelContext` | the party's level, derived from the real characters | the party store / the typed local level |
  | `monsterPartsContext` | the campaign's Battlezoo rule + Full/Light/Hybrid variant | the tracker's own "Show Monster Parts value" setting, priced on Light |
  | `pcPaneContext` | a renderer so a PC's pane is HH's editable character sheet | the tracker's own `CombatantDetail` |
  | `pcStatsContext` | each PC's real stats (AC/saves/…) so the initiative order can show them | `PartyPlayer.pcStats` (the DM-entered sheet) |

  The tracker's own `DisplaySection` also takes a `campaignDriven` prop: HH passes it to hide the
  Monster Parts switch (the campaign decides), the standalone tracker doesn't and keeps it.

  HH derives the PC stats with `computePcStats` (integration) and reuses the tracker's own PcStats /
  PcDetailConfig model: the initiative order's "Show player AC & saves" toggle and the party cards'
  "Stats shown" sections are the tracker's existing display logic, now fed real data. The party
  cards' extra sections render via `PcStatsCardExtra` (integration), passed to `PartyMembers`'
  `renderExtra` prop.

  Four more tracker-side, standalone-safe touches for the embed:
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
published sheet (with the GM's own pending edit, `gmPushBase`) and lands only while it still carries
what the row showed when he made the gesture; otherwise the sheet wins. Read that file's header before
touching either direction: it is where the never-overwrite rules live.

**Known gaps.**

- **The seam's row is matched charId first** (`isSamePc`, the tracker's own rule): a PC row added
  from the party carries the character's id, so two same-named characters get two rows, each driven
  by its own sheet. A row with no id (typed in by hand, or saved before ids were kept) falls back to
  the name — and a row two members' names both match is driven by NEITHER sheet: nothing is written
  to it and nothing is pushed from it. Other surfaces in `CampaignTracker.tsx` (the PC stats strip,
  the live-member lookup) still match by name; see `tracker/DEFERRED.md` §3.
- **A GM change can still be lost** (the seam header, rule C) — never the player's. Visibly, his row
  snapping to their sheet, in one ordering no stamp can tell apart: the player's app applies an
  EARLIER push of his after a LATER one was already built on it; only the sheets' content could tell
  that republish from a change of the player's own, which the seam's rule E rules out. (A push built
  ON such a republish is recorded on it and stands.) Unseen: an owed gesture the seam never got to
  send before it unmounted. And on the server: an edit of his with no proved base (seeded from his
  other device or by a sign-in, or pushed after a failed read) is never built on — only the GM's
  clock says it still stands, and a fast one put a stale copy over a newer sheet of theirs — so his
  next tracker gesture on that character goes out on their sheet and replaces it. Where that edit
  changed vitals, the first gesture stands down and the row snaps to their sheet; where it did not
  (an XP award, an item), it goes without a sign. Only a base stamp carried on the
  `gm_character_edits` row itself (`src/data/party.ts` + SQL) would prove such an edit.
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
