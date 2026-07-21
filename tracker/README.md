# Heroes Heaven Tracker

A Pathfinder 2e initiative tracker / encounter builder — a **port** of the Electron app at
`C:\pf2e-tracker` (v1.5.1, ~32k LOC) onto Heroes Heaven's stack and look, backed by the
Archives of GuyB data instead of the old app's bundled bestiary.

**Status: Phase 0 complete** (skeleton + design-system proof). No tracker features yet.

## Ground rules

| Rule | Why |
|---|---|
| Never modify `../src` or any Heroes Heaven file | User constraint. `git status` in the HH project must only ever show `?? tracker/`. |
| Never modify `C:\pf2e-tracker` | It's the reference implementation and still in use. |
| Data comes ONLY from `C:\trying ai 2\Archives of GuyB\data` | User constraint — the old app's bestiary is not to be reused. |
| Not connected to the character builder yet | Deliberate. The PC/party model is designed so a later connection is a data contract, not a merge. |

## Why a separate app (not part of Heroes Heaven's build)

Sharing HH's build would require editing four HH files (`package.json`, `vite.config.ts`,
`tsconfig.json`, `src-tauri/tauri.conf.json` — one `src-tauri` = one binary, and HH's Cargo has no
`[workspace]`). That breaks the "don't change existing code" rule, so the tracker is its own npm +
Vite project nested inside the HH folder. Nesting is safe: HH's tsconfig compiles only `src`, and
HH's Vite only bundles what its own `index.html` imports.

This does **not** make the later "connect them" step harder — that connection will be a *data*
contract (an exported character JSON), not a shared bundle.

## How it matches the character builder

Two tiers, because the design system is two different things:

- **Tokens — imported LIVE.** `@hh` aliases `../src`, so `@hh/theme/tokens.css` +
  `@hh/theme/theme-manager` are the *same files* HH uses. One source of truth: add a palette to HH
  and it appears here for free. Verified import-clean — `themes/styles/fonts/zoom/tokens.css` have
  zero imports, and `theme-manager` pulls only its siblings plus the 65-line `data/syncBus` (no
  Supabase). Keep this alias surface narrow: **never** import `@hh/rules/*` or `@hh/data/cloudSync`.
- **Components — vendored.** `src/ui.css` copies only the ~10 reusable blocks from HH's
  `sheet.css` (which is ~10k lines of character-sheet layout, not a component library), each tagged
  with its origin. **Rule: no raw hex in `ui.css`** — every value must come from a token, or the
  tracker will drift out of sync with HH's themes.

## Platform

Full parity with Heroes Heaven: **web + PWA + desktop + Android**. This rules out the otherwise
attractive SQLite-in-Rust data layer; instead the bestiary is built to compact JSON and cached at
runtime by the service worker (`CacheFirst` on `/data/`) — the same pattern HH uses for its ~19 MB
`core.json`.

## Data

`npm run data` (Phase 1) will extract from `C:\trying ai 2\Archives of GuyB\data` into
`public/data/` (gitignored — large and regenerable).

- The archive is 1.1 GB (`images` 729 MB, `by-category` 351 MB). The tracker needs 9 categories /
  ~13.6k docs = **135 MB raw**: creature 4714, hazard 634, spell 2461, action 3979, trait 907,
  creature-family 646, condition 98, creature-ability 85, creature-adjustment 60.
- Most of that is fields the app never reads (`*_scale`, `*_scale_number`, `search_markdown`,
  `*_raw`, duplicate `*_markdown`) — trim to a small always-loaded search index + lazily fetched
  stat blocks.
- **Dedupe is already solved in the source data**: a 5-way edition model (`legacy` / `remaster` /
  `neutral` / `legacy-era` / `remaster-era`) with `superseded_by` set on exactly 954 creatures.
- **Images: deferred** (user decision). 722 MB, and the Archives PLAN.md marks the artwork as
  Paizo's and not for redistribution.

### ⚠ The biggest risk: AoN has no structured attacks

A creature's real strike — `jaws +37 (…), Damage 4d10+17 piercing plus 3d6 fire` — exists **only
inside the `markdown` prose**. The structured fields are `attack_bonus: [35,35,37,37]` (unlabeled)
and `strike_damage_average` (*averages, not dice*). The old app's `Attack{name, attack, damage,
isAgile}` and its damage scaling cannot be fed from AoN's fields, so Phase 2 must parse strikes out
of the prose at build time.

**Free test oracle:** parse the dice, compute expected value, assert it ≈ `strike_damage_average`
across all 4,714 creatures.

## Toolchain gotchas (this machine)

- **node/npm are NOT on PATH** (node is at `C:\Program Files\nodejs`). Bash: prepend
  `export PATH="/c/Program Files/nodejs:$PATH"`.
- The dev server is launched (see `C:\wonderers guide\.claude\launch.json` → `hh-tracker`, port
  **1421**; HH holds 1420) by calling `node.exe` directly on `vite.js`, because vite's `.cmd` shim
  shells out to a bare `node`. `runtimeExecutable` cannot contain spaces (use `C:/PROGRA~1/...`),
  but `runtimeArgs` can. Use **long** paths in the args — mixing 8.3 and long paths made Vite
  resolve `/@vite/client` against a different root and 404, leaving a blank page.
- `python` on PATH is a broken Anaconda; use `C:\Users\r2g2\AppData\Local\Programs\Python\Python310\python.exe`.

## Phases

0. ✅ **Skeleton + design-system proof** — themes/styles/fonts switch live from HH.
1. **Data pipeline + bestiary + read-only stat block** — biggest foundational chunk.
2. **Strike/ability/spell extractor** ⚠ — the AoN-shape gap; highest risk.
3. **Combat engine** — the ordered `nextTurn` pipeline, HP/temp/defeat, undo/redo.
4. **Conditions** — typed stacking, the two tick phases, badges, custom editor.
5. **Encounter math** — XP/difficulty (ports nearly verbatim; it's pure), weak/elite, scale-to-level.
6. **Parties/PCs** — the HH-connection seam. Use a stable `characterId`, not the old app's
   name-as-join-key (which breaks silently on rename).
7. **Floating windows / GM screen** — largest UI surface, least rules risk; can ship later.
8. **Custom creatures + text converter**.
9. **Polish** — turn timer, backup/restore, encounter tables.

Full subsystem surveys (every feature + rules formula of the old app) are in this session's
workflow journal; the combat/encounter/condition rules were captured in detail because they must
port exactly.
