import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Heroes Heaven's design tokens, imported LIVE from ../src (see vite.config.ts). hh-compat.css then
// re-expresses the tracker's own variable vocabulary in terms of them, so every component below —
// all ported unchanged from the original app — themes itself from the character builder.
import '@hh/theme/tokens.css'
// Heroes Heaven's shared chrome components (Logo, PageMenu) draw their icons from the Tabler
// webfont via `ti ti-*` classes — the same set the builder uses. Required for the hamburger.
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './index.css'
import './hh-compat.css'
// Styles for the HH components imported live above (Logo, PageMenu) — vendored from HH's sheet.css.
import './hh-chrome.css'
import { initTheme } from '@hh/theme/theme-manager'
import { initZoom } from '@hh/theme/zoom'
import App from './App.tsx'
import { GameDataProvider } from './data/gameDataContext'
import { ErrorBoundary } from './components/ErrorBoundary'

// Writes the palette/style/font onto <html> (data-theme + data-polarity + the --app-* vars that
// hh-compat.css reads). Must run before first paint.
initTheme()
initZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="the application">
      <GameDataProvider>
        <App />
      </GameDataProvider>
    </ErrorBoundary>
  </StrictMode>,
)
