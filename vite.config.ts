import { readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Force a FULL RELOAD when a module React Refresh CANNOT hot-swap changes.
 *
 * THE BUG THIS FIXES. React Refresh can only patch a module whose exports are all React components.
 * When a module also exports a plain function or constant, Vite gives up on it — the dev log says so
 * out loud:
 *
 *     hmr invalidate /src/builder/Builder.tsx
 *       Could not Fast Refresh ("hasChoicesAtLevel" export is incompatible)
 *
 * It then invalidates the module and propagates an ordinary HMR update to the importers, which can keep
 * a stale instance. The page throws `ReferenceError: <name> is not defined` for a function that exists
 * perfectly well in the source — a lie that reads exactly like a real bug. It names a real file and
 * line, it survives a soft reload, and `tsc` passing looks like the contradiction rather than the proof.
 * It cost a chunk of a verification session before a hard reload cleared it, and the danger is symmetric:
 * it can also make broken code look like "just a stale module". Reloading is cheap; being lied to is not.
 *
 * WHAT COUNTS. Two kinds of module, and the first version of this plugin only caught the first:
 *   1. Pure logic — `src/rules/*.ts`, `src/data/*.ts`. No components at all, so never refreshable.
 *   2. A `.tsx` that ALSO exports something that is not a component. `CompanionsTab.tsx` exporting
 *      `targetPhrase`, `Builder.tsx` exporting `hasChoicesAtLevel`, `shared.tsx` exporting
 *      `ABILITY_LABEL`. These are the ones that actually bit, and a `.ts`-only rule walks past them.
 *
 * A component is detected by the React convention Fast Refresh itself uses: an exported binding whose
 * name starts with a capital letter. Anything lowercase makes the module unrefreshable, so it reloads.
 * A `.tsx` exporting only components still hot-swaps normally and keeps its state.
 */
function fullReloadOnLogicChange(): Plugin {
  const PURE_LOGIC = /[\\/]src[\\/](rules|data)[\\/][^\\/]+\.ts$/;
  const IN_SRC = /[\\/]src[\\/].*\.tsx$/;
  // `export const foo` / `export function foo` / `export let foo` — and the `export { foo }` form.
  const NAMED_EXPORT = /^\s*export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
  const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/gm;

  /** True when the module exports anything Fast Refresh cannot treat as a component.
   *  `exec` loops rather than `matchAll`: the config is compiled by tsconfig.node.json, whose target
   *  is too low to iterate a RegExp iterator. */
  const hasNonComponentExport = (code: string) => {
    const names: string[] = [];
    NAMED_EXPORT.lastIndex = 0;
    for (let m = NAMED_EXPORT.exec(code); m; m = NAMED_EXPORT.exec(code)) names.push(m[1]);
    EXPORT_LIST.lastIndex = 0;
    for (let m = EXPORT_LIST.exec(code); m; m = EXPORT_LIST.exec(code)) {
      for (const part of m[1].split(',')) {
        // `export { a as b }` — the exported name is what matters. `export type {…}` is erased.
        const name = part.split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, '');
        if (name) names.push(name);
      }
    }
    return names.some((n) => !/^[A-Z]/.test(n));
  };

  return {
    name: 'hh-full-reload-on-logic-change',
    enforce: 'post',
    async handleHotUpdate(ctx) {
      let force = PURE_LOGIC.test(ctx.file);
      if (!force && IN_SRC.test(ctx.file)) {
        try { force = hasNonComponentExport(await ctx.read()); } catch { /* unreadable: leave HMR alone */ }
      }
      if (!force) return;
      // `hot` is the Vite 6 channel; `ws` is the older name, kept as a fallback so a version bump
      // cannot silently turn this plugin back into the bug it fixes.
      const channel = ctx.server.hot ?? ctx.server.ws;
      channel?.send({ type: 'full-reload' });
      return []; // an empty module list skips the HMR patch entirely
    },
  };
}

/**
 * Keep BUILD-ONLY files out of `dist`.
 *
 * THE BUG THIS FIXES. Vite copies `public/` into `dist/` verbatim — every file, whether the app asks
 * for it or not. Two kinds of file in there are build inputs the browser never fetches:
 *
 *   1. `public/ast/<bucket>.json` — the RAW ast buckets. astStore.ts fetches `<bucket>.json.gz` and
 *      inflates it in the browser, precisely because the raw ones are too big; its own comment says
 *      "far too large for static-host per-file limits (items is ~36 MB raw, ~2.6 MB gzipped)". The raw
 *      files are the input the .gz is built from, and a dev-only fallback.
 *   2. `public/core.foundry-backup.json` (~18 MB) — read only by scripts/import-core-v2.mjs.
 *
 * Both are gitignored, so a git-connected build never had them and this only ever bit a deploy made
 * from a local `dist`. It bit hard: `dist/ast/items.json` is 36.2 MB and **Cloudflare Pages refuses
 * any file over 25 MiB**, so the upload fails outright rather than degrading. It also made the deploy
 * 198 MB instead of ~60 MB.
 *
 * A raw bucket is removed ONLY when its `.gz` sibling exists — if a bucket ever ships without one, the
 * fallback path in astStore.ts still has something to fetch.
 */
function stripBuildOnlyAssets(): Plugin {
  let outDir = 'dist';
  const removed: string[] = [];
  return {
    name: 'hh-strip-build-only-assets',
    enforce: 'post',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const root = path.resolve(outDir);
      const drop = (rel: string) => {
        const abs = path.join(root, rel);
        if (!existsSync(abs)) return;
        const mb = statSync(abs).size / 1048576;
        rmSync(abs);
        removed.push(`${rel} (${mb.toFixed(1)} MB)`);
      };

      const astDir = path.join(root, 'ast');
      if (existsSync(astDir)) {
        for (const f of readdirSync(astDir)) {
          if (!f.endsWith('.json')) continue; // .json.gz ends with .gz, so it is never matched
          if (existsSync(path.join(astDir, `${f}.gz`))) drop(path.join('ast', f));
        }
      }
      drop('core.foundry-backup.json');

      if (!removed.length) return;
      const total = removed.length;
      // Report the total, not the list — 60-odd buckets would bury the build output.
      const bytes = removed.reduce((n, s) => n + parseFloat(s.slice(s.lastIndexOf('(') + 1)), 0);
      // eslint-disable-next-line no-console
      console.log(`\n  build-only assets stripped from ${outDir}: ${total} files, ${bytes.toFixed(0)} MB`);
    },
  };
}

// Vite config tuned for Tauri 2: fixed dev port, no screen clearing so Tauri
// logs stay visible, and src-tauri excluded from the watcher.
export default defineConfig({
  plugins: [
    react(),
    fullReloadOnLogicChange(),
    stripBuildOnlyAssets(),
    // PWA: makes the WEB build installable ("Add to Home Screen") and offline-capable. The service
    // worker is registered manually in main.tsx and ONLY in the browser build (never the Tauri
    // shell) — see `injectRegister: null`.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['logo.svg', 'pwa-512.png', 'fonts/*'],
      manifest: {
        name: 'Heroes Heaven',
        short_name: 'Heroes Heaven',
        description: 'A Pathfinder 2e character builder and digital sheet.',
        theme_color: '#14161f',
        background_color: '#14161f',
        display: 'standalone',
        // Portrait, matching the mobile-first UI and the installed APK (AndroidManifest is portrait too).
        // 'any' made an installed PWA call screen.orientation.lock('any') on launch, which overrode the
        // phone's own rotation-lock setting and let the app rotate freely — surprising the user.
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf,eot}'],
        // The Tabler icon font (~2.8 MB) must be precached so icons render offline — raise the cap
        // above its size. (The rules data is handled separately via runtimeCaching below.)
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // The rules data is cached at runtime on first (online) load rather than precached, so the
        // service-worker install stays small; offline works after the first visit.
        //
        // BOTH files must match. Descriptions were split into `core-descriptions.json` (15 MB of the
        // old 22.5 MB core.json), and `endsWith('core.json')` does not match that name — an installed
        // PWA would have gone offline with every description blank.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/core(-descriptions)?\.json$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'heroes-heaven-data',
              // Two files per version now, so 3 was under one full set plus its predecessor.
              expiration: { maxEntries: 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  clearScreen: false,
  // The app's own version (src/version.ts) — used by the backup envelope and the update check.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    rollupOptions: {
      output: {
        // Split the React runtime into its own long-cached vendor chunk so app-code changes don't
        // bust it (and the main chunk shrinks below the size-warning threshold).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
