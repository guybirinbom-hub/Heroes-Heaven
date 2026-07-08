import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Vite config tuned for Tauri 2: fixed dev port, no screen clearing so Tauri
// logs stay visible, and src-tauri excluded from the watcher.
export default defineConfig({
  plugins: [
    react(),
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
