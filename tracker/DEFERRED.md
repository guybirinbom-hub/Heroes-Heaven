# Deferred work — status

This list was written (v0.1.15) while the tracker was still a separate app. The tracker is now
embedded in Heroes Heaven (the Campaign page's initiative tracker; the seam is described in
`src/integration/README.md`), and most of it is built. Last checked 2026-10-20 against the code and git.

Legend: ✅ done · 🟡 open

---

## ✅ 1. Tracker settings inside Heroes Heaven's Settings
Built in 321a03d (v0.1.15) and finished in 97c0cf5. HH's Settings page has an "Initiative tracker"
section (`src/sheet/SettingsPage.tsx`, section id `tracker`), rendered by
`src/integration/TrackerSettingsSection.tsx`. It is hidden on phones on purpose.

## ✅ 2. Export / import through HH's backup
Built in 041e5a5 (v0.1.17): `src/data/backup.ts` `APP_KEY_PREFIXES` includes `pf2e-`, so every
tracker key is in the HH backup, and a restore tells the tracker to reload (`notifyReset`).
Since 34cdc9d, `src/data/trackerSync.ts` also syncs the GM's tracker keys to the cloud.

## ✅ 3. Parties joined on a stable character id, not the name
Built. Campaign parties mirror the campaign's characters by `charId` (`partyStore.syncCampaignParty`);
rows carry `charId` and `partyMemberId`; HP and max HP go through `partyStore.partyCardOfRow`.
The last name join, the turn timer's "Save to Averages", now also goes through `partyCardOfRow`
(`partyStore.addTurnsToRow`, 2026-10-20). The name is only the fallback for a row with no id.

## ✅ 4. One logo / one shell
Built for the embedded tracker: it lives inside HH's own page and menu. The standalone dev app
(`tracker/`, port 1421) already uses HH's logo and menu component (`@hh/sheet/Logo`, `@hh/sheet/PageMenu`,
with an empty menu); only its page frame is its own, on purpose.

## ✅ 5. Per-campaign initiative
Built in 97c0cf5: each campaign keeps its own order under `pf2e-current-combat:<campaignId>`.

## 🟡 6. Conditions section restyled to match HH's Modes — OPEN
Still open: it waits on the owner's decision about the look. The match should be visual only; the
tracker's `AdvancedConditionEditor` (typed bonus/penalty, situational toggles) must keep what it can do.

## ✅ 7. Zoom axis — 🟡 leftover open
Built: HH's zoom (`src/theme/zoom.ts`) reaches the tracker, and `tracker/src/utils/zoomFix.ts` (44bff33)
corrects the modal and window sizes for it.
Leftover, open: about ten non-modal size caps still use CSS `vh`/`vw`, which ignore the zoom —
`GlobalSearch.tsx` (12vh, 70vh), `TurnTimerWidget.tsx` (70vh), `FloatingWindow.tsx` (min(88vh, 680px)),
`TextConverter.tsx` (92vw / 90vh). Needs a screen check at zoom 1.5 before changing them.

## ✅ 8. Electron shims
Built in 97c0cf5 (the Electron types and updater are gone). Inert `WebkitAppRegion` styles remain in
the standalone `tracker/src/App.tsx`; a browser ignores them.

## ✅ 9. The data
Built by another route: the bestiary and rules files are tracked in `public/data/`, first built from
the Archives (4837736), then replaced by the verified bestiary corpus (c725a17 … ce9f842).
Images stay deferred (the artwork is Paizo's and not for redistribution).

---

## Kept deliberately

### The tracker keeps its own Sources setting
A GM may run stat blocks from a book the players should not have. GM-side and player-side source
access are different questions and stay separate settings. Still honoured.
