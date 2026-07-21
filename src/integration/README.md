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
| `src/sheet/CampaignsPage.tsx` | `integration/` imports; `<TrackerTools/>` + the `ti-palette` Customize button in the chrome; the `cmp-body-tracker` class; `<CampaignTracker>` in place of `<CampaignDetail>`; the two `TRACKER_IN_CAMPAIGN`-gated last-campaign-memory blocks; `CampaignForm`'s `localOnly` fallback | Delete the imports and restore `<CampaignDetail>` (which already has its own Settings / Delete / share code); drop `localOnly` and its branches |
| `src/theme/theme-manager.ts` | `resolveAppearanceVars` — the token-resolution half of `applyResolved`, extracted + exported so a scoped appearance (the tracker's own theme) can be built without writing `<html>` | A pure refactor with no tracker names in it; harmless to keep. To fully revert, inline it back into `applyResolved` |
| `src/sheet/SettingsPage.tsx` | the `'tracker'` section (id, `ALL_SECTIONS` entry, `renderSection` case) | Delete the three `'tracker'` references |
| `src/sheet/PartyMembers.tsx` | optional `localMembers?: PartyMember[]` prop; optional `renderExtra?` render-prop (the "Stats shown" card sections) + the `.party-extra` wrapper | Delete both props; use `members`; drop the `extra` slot |
| `src/sheet/GmEditSheet.tsx` | `forwardRef` + the `GmEditHandle` (`confirmLeave`) so the initiative order can ask before swapping the sheet out | Drop the ref plumbing; inline `confirmLeave` back into `doExit` |
| `src/sheet/useIsMobile.ts` | `ForceMobileContext` (null default) so a narrow PC pane can put the sheet into its phone layout; `useIsMobile` returns `forced ?? isMobile` | Delete the context + the `forced ??` — with no provider it was already inert |
| `src/sheet/useEscapeClose.ts` | `triggerBack()` — fires the topmost dismiss handler, so the campaign back arrow can share the dismiss stack (close an open sheet before leaving the campaign) | A generic helper with no tracker names; harmless to keep |
| `src/App.tsx` | `TEST_CAMPAIGNS_WITHOUT_LOGIN` in the **DEV-only** `devBypass`; `bootToCampaign` + its branch in the post-content-load jump; the `setOnCampaignsPage(mode==='campaigns')` effect — reopen a campaign the app was closed on; the one `combatOwnsUndo()` guard in the Ctrl+Z handler | Delete that term, the `bootToCampaign` state + branch, the marker effect, and the guard |

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

  Two more tracker-side, standalone-safe touches for the embed:
  - `InitiativeTracker`'s mini HP bar falls back to the host `pcStats` HP for a PC row when the
    combatant itself has no HP (`c.maxHP === 0`) — which is always true for an embedded PC, since HH
    feeds HP through the context, not the party store. A standalone PC gets `maxHP` at add-time, so
    its own HP still wins; the fallback only fills the gap.
  - `CampaignTracker` mounts the tracker's own `TurnTimerWidget` (self-gated on the timer setting) and
    a small `RailFooter` (quick-add a name-only combatant + Clear the order) — both pure combat-store
    features from the original toolbar/sidebar that the embed hadn't wired. Deleted with the seam.

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

**Connected.** The party cards are HH's real `PartyMembers` fed from the local roster
(`useLocalCampaignMembers`); clicking one opens the real `GmEditSheet`; the initiative order drives
which character the main pane shows; and the **party level** — which the whole encounter budget is
rated against — is derived from the characters' real levels instead of the hand-typed number that
defaulted to 1.

**Known gaps.**

- **Combatant → character matching is BY NAME** (`CampaignTracker.tsx`). The initiative order has no
  character id to join on, and this matches the tracker's own convention (`partyStore.importCharacter`
  also matches on lower-cased name) — but two same-named characters in one campaign are ambiguous.
  A stable `characterId` on the combatant is the real fix; see `tracker/DEFERRED.md` §3.
- **Creature data isn't wired up** — `Link Stat Block` reports "Data not loaded. Run: npm run
  setup-data". Creatures can still be authored via the **Custom** text converter, which is how the
  stat-block pane was verified.
- **Anything server-backed is untested here**, because these test campaigns exist only on this
  device. That includes `GmEditSheet`'s **Update** (it pushes through `gm_character_edits`) and the
  campaign's **Settings & defaults**, which reports "No campaign with that code". Local campaign
  persistence behind `TEST_CAMPAIGNS_WITHOUT_LOGIN` would close this.
