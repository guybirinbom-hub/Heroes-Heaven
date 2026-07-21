import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// MUST be absolute. Tailwind resolves relative content globs against process.cwd(), and the dev
// server is launched from a different directory via `vite --config <path>` (node/npm aren't on PATH
// here — see .claude/launch.json). With relative globs Tailwind scanned an empty directory, matched
// zero classes, and tree-shook EVERY utility away — which silently collapsed the whole layout
// (no flex, no h-screen, no gaps) while leaving colours working.
const HERE = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(HERE, 'index.html'), join(HERE, 'src/**/*.{js,ts,jsx,tsx}')],
  // The Chip primitive builds its tone class dynamically (`chip-${tone}`), so
  // Tailwind's content scanner can't see these literals and would tree-shake
  // them out of the `@layer components` block — leaving every PC/NPC/level/AC/
  // trait chip with no background or border. Safelist keeps them in the build.
  safelist: ['chip', 'chip-accent', 'chip-linked', 'chip-muted', 'chip-danger', 'chip-mono'],
  theme: {
    extend: {
      colors: {
        /* Tailwind palette is wired to CSS custom properties so `text-pf-*` /
           `bg-pf-*` / `border-pf-*` classes scattered through legacy components
           recolour automatically when the user picks a different theme. */
        pf: {
          bg:            'var(--bg-base)',
          surface:       'var(--bg-panel)',
          'brown-light': 'var(--bg-elevated)',
          gold:          'var(--accent)',
          'gold-light':  'var(--accent-hover)',
          // Historically these `red` slots map to the "linked" colour (sage on
          // Tavern, violet on Arcane, copper on Verdant, etc.) — keeps every
          // old `text-pf-red` class theme-aware.
          red:           'var(--linked)',
          'red-light':   'var(--linked)',
          'red-hover':   'var(--linked)',
          danger:        'var(--danger)',
          border:        'var(--border-strong)',
          'border-dark': 'var(--border)',
          muted:         'var(--text-muted)',
          cream:         'var(--text)',
          'cream-dark':  'var(--text-muted)',
          // Parchment + brown kept as literals — only used by legacy printable
          // stat-block exports where we *want* a fixed sepia look.
          parchment:     '#f8f2e0',
          brown:         '#2c1a0e',
          // Elite / Weak label colours stay fixed (they're game-mechanic tags
          // with canonical green / blue identities, not theme decoration).
          elite:         '#5e7e4a',
          weak:          '#4a6a82',
        },
      },
      fontFamily: {
        // Routed through the compat layer to Heroes Heaven's --app-font, so the builder's Font
        // picker governs the tracker too. Hardcoding Fraunces/Manrope here would silently fall
        // back to Georgia/system-ui now that the Google Fonts import is gone (offline/CSP).
        serif:   ['var(--font-display)'],
        display: ['var(--font-display)'],
        sans:    ['var(--font-ui)'],
        mono:    ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
