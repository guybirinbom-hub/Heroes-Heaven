# Heroes Heaven

A fast, fully-offline **Pathfinder Second Edition (Remaster)** character builder and digital character sheet for Windows. Build a character from level 1 to 20, then play from a complete interactive sheet — everything runs locally on your machine, with no account and no internet connection required.

<p align="center">
  <a href="https://github.com/guybirinbom-hub/character-builder-/releases/latest/download/Heroes-Heaven-Setup.exe">
    <img alt="Download Heroes Heaven for Windows" src="https://img.shields.io/badge/Download-Windows%20Installer-5B4FC7?style=for-the-badge&logo=windows&logoColor=white&labelColor=2C2A4A" height="46">
  </a>
</p>

<p align="center">
  <sub>One-click download of the latest installer · <a href="https://github.com/guybirinbom-hub/character-builder-/releases">browse all releases</a></sub>
</p>

---

## Installing

1. Click the button above to download `Heroes-Heaven-Setup.exe`.
2. Run it. The app isn't code-signed yet, so Windows SmartScreen may show a blue warning — click **More info → Run anyway**.
3. It installs for the current user (no admin prompt) and adds a Start-menu shortcut.

Your characters and settings are stored locally on your device. There is no cloud sync and no telemetry — nothing leaves your machine.

## What it does

**Builder (levels 1–20)**
- All 27 Remaster classes, with every ancestry, heritage, background, and class feature mechanized
- Each choice shows its full description and what it grants *before* you pick it
- Optional GMG variant rules: Automatic Bonus Progression, Free Archetype, Dual Class, Ancestry Paragon, Gradual Ability Boosts, Proficiency Without Level
- Multiclass and caster archetypes, per-character source-book filtering, and per-case rule overrides

**Character sheet**
- Live-calculated AC, saves, Perception, class/spell DCs, skills, and full strike attack/damage breakdowns
- Spellcasting with slots, signature spells, heightening, and staff/wand charges
- Inventory with rune etching/affixing, containers, bulk, and wealth tracking
- Companions: animal companions, eidolons (with their own attacks), and vehicles / siege weapons
- Hero points, conditions, custom toggleable modifiers ("modes"), notes, and global undo/redo

**Homebrew & interop**
- Author your own items, feats, spells, ancestries, heritages, backgrounds, and actions
- Import and export characters, including the Wanderer's Guide format

## Build from source

Requires Node.js, Rust, and — on Windows — the WebView2 runtime plus the MSVC build tools.

```bash
npm install
npm run dev          # web app at http://localhost:1420
npm run tauri dev    # desktop app with hot-reload
npm run tauri build  # build the Windows installer → src-tauri/target/release/bundle/nsis/
npm test             # run the test suite
```

> **Releasing:** every GitHub release should include a stable-named `Heroes-Heaven-Setup.exe` asset (a copy of the generated `*_x64-setup.exe`) so the download button above always points at the newest installer.

## Content & license

Game rules content is from Pathfinder Second Edition (Remaster) by [Paizo Inc.](https://paizo.com), used under the ORC License. This is an unofficial, fan-made tool and is not affiliated with or endorsed by Paizo.
