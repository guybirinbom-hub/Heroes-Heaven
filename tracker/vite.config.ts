import path from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// node/npm aren't on PATH here, so the dev server is launched by absolute path using Windows 8.3
// short names (see .claude/launch.json) — which means __dirname can arrive as C:\TRYING~1\PF2ECO~1\…
// Vite resolves request paths with realpathSync.NATIVE, which expands 8.3 names to their long form;
// a short-path entry in server.fs.allow would therefore never match and every file would be
// "outside the allow list". Plain realpathSync does NOT expand short names on Windows — only the
// .native variant does — so canonicalise with it here.
const TRACKER_DIR = realpathSync.native(__dirname);
const HH_DIR = path.resolve(TRACKER_DIR, '..');

/*
 * The tracker is a SEPARATE app that lives inside the Heroes Heaven project but never modifies it.
 *
 * `@hh` aliases HH's src/ so the theme engine (palette/style/font/accent + zoom) is imported LIVE
 * rather than copied — one source of truth, so a new HH theme shows up here for free. The alias
 * surface is deliberately narrow: only `@hh/theme/*` is imported today. Everything under
 * `@hh/theme` is import-clean (themes/styles/fonts/zoom/tokens.css have zero imports;
 * theme-manager pulls only its siblings + the 65-line data/syncBus, which has no Supabase), so
 * this does NOT drag HH's cloud/rules layers into the tracker bundle.
 *
 * Dev port 1421 — HH holds 1420 (strictPort), so both can run at once.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['fonts/*'],
      manifest: {
        name: 'Heroes Heaven Tracker',
        short_name: 'HH Tracker',
        description: 'A Pathfinder 2e initiative tracker and encounter builder.',
        theme_color: '#14161f',
        background_color: '#14161f',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf,eot}'],
        // The Tabler icon font (~2.8 MB) must be precached so icons render offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // The bestiary payload is cached at RUNTIME on first online load rather than precached, so
        // the service-worker install stays small and offline works after the first visit. Same
        // pattern HH uses for its ~19 MB core.json.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'hh-tracker-data',
              expiration: { maxEntries: 32 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@hh': path.join(HH_DIR, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-dom/client'] },
      },
    },
  },
  // Pin the root so it doesn't depend on the launcher's cwd/short-path form.
  root: TRACKER_DIR,
  server: {
    port: 1421,
    strictPort: true,
    // The @hh alias resolves outside this project root, so Vite must be allowed to serve the
    // Heroes Heaven dir too (real long path — see the note at the top).
    fs: { allow: [HH_DIR] },
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
