import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './theme/tokens.css';
import './sheet.css';
import { initTheme } from './theme/theme-manager';
import { initZoom } from './theme/zoom';
import { initPrefs } from './data/prefs';
import { ErrorBoundary } from './sheet/ErrorBoundary';
import { confirmDialog } from './sheet/confirm';
import { clearRoster } from './data/storage';
import { loadContent } from './data';
import { isMobilePlatform } from './platform';

// Apply the saved (or default) theme + zoom to <html> before React paints, so there's
// no flash of an unthemed/unscaled screen.
initTheme();
initZoom();
initPrefs();
// Tag the root on phone/tablet WebViews so CSS can apply mobile-only tweaks (safe-area insets, etc.);
// width-based layout is driven by @media queries so it also works in a narrow browser window.
if (isMobilePlatform) document.documentElement.classList.add('is-mobile');

// Start fetching the content database (public/core.json, ~19 MB — the slow part of cold boot,
// especially on phones) NOW, before React mounts, so the download/parse overlaps the initial
// render. App awaits the same shared promise instead of starting a second fetch.
void loadContent();

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
