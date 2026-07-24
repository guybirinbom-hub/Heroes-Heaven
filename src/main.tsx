import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './theme/tokens.css';
import './sheet.css';
import { initTheme } from './theme/theme-manager';
import { initZoom } from './theme/zoom';
import { initPrefs } from './data/prefs';
import { initCustomization } from './data/customization';
import { ErrorBoundary } from './sheet/ErrorBoundary';
import { confirmDialog } from './sheet/confirm';
import { clearRoster } from './data/storage';
import { loadContent } from './data';
import { initPortraitStore } from './data/portraitStore';
import { isMobilePlatform, isTauri } from './platform';

// Apply the saved (or default) theme + zoom to <html> before React paints, so there's
// no flash of an unthemed/unscaled screen.
initTheme();
initZoom();
initPrefs();
// After initTheme (its accent/consumable derivation reads the loaded theme state) — seeds the global
// customization default, migrating older device prefs on first run, and applies its global CSS bits.
initCustomization();

// PWA service worker: register it in the production WEB build ONLY. The Tauri desktop/mobile shells
// serve from their own protocol and manage their own lifecycle, so they must not run the SW.
//
// registerType is 'autoUpdate' (vite.config), so a new deploy's SW skip-waits, claims clients, and
// vite-plugin-pwa reloads the page once it activates. But the SW only checks for a new version at
// REGISTRATION (page load) — a browser left open for days on a stale cached build would never notice
// a new release. So we poll for updates hourly and whenever the tab regains focus, which is what
// keeps web users from getting "stuck" on an old version (the reported Wanderer's-Guide-import case).
if (!isTauri && import.meta.env.PROD) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) =>
      registerSW({
        immediate: true,
        onRegisteredSW(_swUrl, r) {
          if (!r) return;
          const check = () => void r.update().catch(() => {});
          setInterval(check, 60 * 60 * 1000);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') check();
          });
        },
      }),
    )
    .catch(() => {});
}
// Tag the root on phone/tablet WebViews so CSS can apply mobile-only tweaks (safe-area insets, etc.);
// width-based layout is driven by @media queries so it also works in a narrow browser window.
if (isMobilePlatform) document.documentElement.classList.add('is-mobile');

// Start fetching the content database (public/core.json, ~19 MB — the slow part of cold boot,
// especially on phones) NOW, before React mounts, so the download/parse overlaps the initial
// render. App awaits the same shared promise instead of starting a second fetch.
void loadContent();

// Load on-device sharp portraits (installed app) into memory so display can pick them up. Async +
// non-blocking; a subscribe in usePortrait re-renders portraits once their local copies land.
void initPortraitStore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      title="The app hit an unexpected error"
      renderActions={() => (
        <button
          className="btn"
          onClick={async () => {
            if (
              await confirmDialog({
                title: 'Reset all saved characters?',
                message: "This clears the roster stored in this browser and can't be undone.",
                confirmLabel: 'Reset',
                danger: true,
              })
            ) {
              clearRoster();
              window.location.reload();
            }
          }}
        >
          Reset saved data
        </button>
      )}
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
