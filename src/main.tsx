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
import { clearRoster } from './data/storage';

// Apply the saved (or default) theme + zoom to <html> before React paints, so there's
// no flash of an unthemed/unscaled screen.
initTheme();
initZoom();
initPrefs();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      title="The app hit an unexpected error"
      renderActions={() => (
        <button
          className="btn"
          onClick={() => {
            if (confirm('Reset all saved characters? This clears the roster stored in this browser and cannot be undone.')) {
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
