# Heroes Heaven Tracker

A Pathfinder 2e initiative tracker / encounter builder — a **port** of the Electron app at
`C:\pf2e-tracker` (v1.5.1, ~32k LOC) onto Heroes Heaven's stack and look, backed by the
Archives of GuyB data instead of the old app's bundled bestiary.

**Status (2026-10-20): built and embedded in Heroes Heaven.** It is the Campaign page's initiative
tracker, and its settings are a section of HH's Settings. How HH and the tracker are joined (the
contexts HH provides, the scoped CSS, what to delete to remove it) is described in
**`../src/integration/README.md`**. What is still open is in `DEFERRED.md`.

## Ground rules

| Rule | Why |
|---|---|
| Never modify `C:\pf2e-tracker` | It's the reference implementation and still in use. |
| Data comes ONLY from the Archives of GuyB and the verified bestiary corpus | User constraint — the old app's bestiary is not to be reused. |
| The dependency points HH → tracker only | The tracker never imports HH's rules or cloud code; where it needs something only HH knows, it declares a context with a null default and HH provides it (see `../src/integration/README.md`). |

## Why it is still its own npm project

The tracker keeps its own `package.json`, Vite config and test config under `tracker/`. HH does not
build it with its own toolchain: the tracker's styles arrive in HH as one pre-built, scoped CSS file
(`dist-css/tracker.scoped.css`, `npm run build:css` here), and its components are imported through
`src/integration/`. The standalone dev app (below) still runs on its own.

## How it matches the character builder

Two tiers, because the design system is two different things:

- **Tokens — imported LIVE.** `@hh` aliases `../src`, so `@hh/theme/tokens.css` +
  `@hh/theme/theme-manager` are the *same files* HH uses. One source of truth: add a palette to HH
  and it appears here for free. Keep this alias surface narrow: **never** import `@hh/rules/*` or
  `@hh/data/cloudSync`.
- **Components — vendored.** `src/ui.css` copies only the ~10 reusable blocks from HH's
  `sheet.css`, each tagged with its origin. **Rule: no raw hex in `ui.css`** — every value must come
  from a token, or the tracker will drift out of sync with HH's themes.

## Platform

Full parity with Heroes Heaven: **web + PWA + desktop + Android**, because it ships inside HH. The
bestiary is compact JSON fetched at runtime and cached by HH's service worker.

## Data

The tracker has no data folder of its own: it reads HH's `public/data/` (tracked in git; the
standalone dev server serves it through `publicDir`). The stat blocks were first built from the
Archives (4837736), then replaced by the verified bestiary corpus (`scripts/import-bestiary-corpus.mjs`
at the HH root; c725a17 … ce9f842). **Images: deferred** (user decision) — the artwork is Paizo's and
not for redistribution.

## Toolchain gotchas (this machine)

- **node/npm are NOT on PATH** (node is at `C:\Program Files\nodejs`). Bash: prepend
  `export PATH="/c/Program Files/nodejs:$PATH"`.
- The standalone dev server is `hh-tracker` in HH's own `.claude/launch.json` (port **1421**; HH
  holds 1420). It calls `node.exe` directly on `vite.js`, because vite's `.cmd` shim shells out to a
  bare `node`. `runtimeExecutable` cannot contain spaces (use `C:/PROGRA~1/...`), but `runtimeArgs`
  can. Use **long** paths in the args — mixing 8.3 and long paths made Vite resolve `/@vite/client`
  against a different root and 404, leaving a blank page.
- Tests: from the HH root, `node scripts/vt.mjs run --config tracker/vitest.config.ts [files]`
  (the shared heavy-job lock; never bare `npx vitest`).
- `python` on PATH is a broken Anaconda; use `C:\Users\r2g2\AppData\Local\Programs\Python\Python310\python.exe`.
