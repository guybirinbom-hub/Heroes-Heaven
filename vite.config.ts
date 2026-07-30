import { readFileSync } from 'node:fs';
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

// Vite config tuned for Tauri 2: fixed dev port, no screen clearing so Tauri
// logs stay visible, and src-tauri excluded from the watcher.
export default defineConfig({
  plugins: [
    react(),
    fullReloadOnLogicChange(),
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
        // above its size. (The ~19 MB core.json is handled separately via runtimeCaching below.)
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // The ~19 MB rules file is cached at runtime on first (online) load rather than precached,
        // so the service-worker install stays small; offline works after the first visit.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('core.json'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'heroes-heaven-data',
              expiration: { maxEntries: 3 },
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
