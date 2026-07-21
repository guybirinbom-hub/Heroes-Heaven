# Deferred work — needs the Heroes Heaven app

The tracker is deliberately **not connected** to the character builder yet. Everything below is
blocked on that connection (or is queued behind it). Recorded so it isn't lost.

Legend: 🔴 blocked on connection · 🟡 doable standalone, queued · ✅ done

---

## 🔴 Blocked on connecting the two apps

### 1. Tracker settings must live in the whole-app Settings
**Goal:** there is ONE Settings, Heroes Heaven's, and the tracker's sections are part of it — not a
separate modal.

**Why it's blocked:** the tracker is its own Vite/Tauri app with its own `SettingsModal`. HH's
Settings is a full page (`src/sheet/SettingsPage.tsx`) driven by a `SECTIONS` list, rendering cards
on mobile and a nav+pane on desktop. Merging means the two apps are one build.

**When we connect:** move these tracker sections into HH's `SECTIONS` array —
Display · Stat Blocks · **Sources** · Turn Timer · Player Characters · Conditions ·
Encounter Tables. Drop the tracker's own modal shell entirely.

**Interim:** the tracker's SettingsModal is being restyled to *look* like HH's Settings so the
eventual move is cosmetic, not a redesign.

### 2. Export / import via the whole-app backup
**Goal:** the tracker has no export/import of its own; HH's app-wide backup covers everything.

**⚠ GAP THIS OPENS:** removing the tracker's "Backup & Data" section leaves the tracker with **no
export at all** until the apps are connected. Its data (current combat, encounters, parties, custom
creatures, custom conditions) lives in localStorage under `pf2e-*` keys and would be
unrecoverable if lost. **Decide:** either accept the gap, or keep a hidden/temporary export until
HH's backup can see the tracker's keys.

**When we connect:** teach HH's `src/data/backup.ts` envelope about the tracker's localStorage keys:
`pf2e-current-combat`, `pf2e-encounters`, `pf2e-custom-conditions`, `pf2e-party-level`, plus the
party / settings / sources / encounter-tables / custom-themes / dm-average stores.

### 3. Parties should become Heroes Heaven's parties
The tracker has its OWN `partyStore` (PCs + allied NPCs, with `pcStats` sheets typed by hand). HH
has real characters. Today the initiative tracker is being scoped **per party** using the tracker's
own parties; once connected, a "party" should be an HH campaign/party and PCs should be real HH
characters.

**Design note carried forward:** join on a stable `characterId`, NOT the name-as-key the original
app uses (`syncCurrentHpByName`, `addTurnsToPlayerByName`). Name-matching breaks silently on rename
and is the acknowledged weak point of the original.

### 4. One logo / one shell
Using HH's real `Logo` + `PageMenu` now (imported live via `@hh`), but the hamburger's destinations
(Characters / Homebrew / Campaigns) only exist in HH. Until connected, the tracker's menu can only
offer its own Settings.

---

## 🟡 Doable standalone — queued

### 5. Per-party initiative tracker
Combat state is currently global (one `pf2e-current-combat`). It should be scoped per party, so each
party has its own initiative order. Internal to the tracker — no HH needed. Touches `combatStore`
persistence + `partyStore`.

### 6. Conditions section restyled to match HH
Match HH's player-facing Conditions + custom **Modes** UI, while still being called **Custom
Conditions** here. The tracker's `AdvancedConditionEditor` (33 stat-mod keys, typed
bonus/penalty selectors, situational `*` toggles) is far richer than HH's mode editor — the match
should be *visual*, and must not throw away that editor's capability.

### 7. Zoom axis
HH scales the app via `--zoom`; the tracker ignores it (`initZoom()` runs, variable unused).

### 8. Electron → web/Tauri shims
8 files still reference Electron: `App.tsx` (window controls), `CombatantDetail`, `MonsterSearch`,
`SettingsModal`, `TurnTimerWidget` (`WebkitAppRegion`), `UpdateNotice` (electron-updater),
`types/electron.d.ts`, `utils/themeIcon.ts` (taskbar icon).

### 9. The data
Deferred by decision. `data/dataStore.ts` is already `fetch()`-based, so it only needs files in
`public/data/` extracted from `C:\trying ai 2\Archives of GuyB\data`. See README for the sizing and
the ⚠ strike-parsing risk.

---

## ✅ Kept deliberately

### Sources stays in the tracker's settings
Even once HH has its own source filtering, **the tracker keeps its own Sources section**: a GM may
run stat blocks from a book the players shouldn't have access to. GM-side source access and
player-side source access are different questions and must not be merged into one setting.
