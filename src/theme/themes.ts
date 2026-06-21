/*
 * Theme registry — the PALETTE axis of the design system.
 *
 * A theme is pure data: a set of values for the color tokens declared in
 * tokens.css. Adding a new theme is just adding an entry here; no component
 * code changes. `--app-accent-text` and `--app-accent-hover` are derived from
 * the effective accent at runtime (see theme-manager.ts), so a theme only needs
 * to supply the base accent.
 */

export type Polarity = 'dark' | 'light';

export interface Theme {
  id: string;
  name: string;
  polarity: Polarity;
  /** Values for the color tokens in tokens.css. */
  tokens: Record<string, string>;
}

export const themes: Record<string, Theme> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    polarity: 'dark',
    tokens: {
      '--app-bg': '#14161f',
      '--app-surface': '#1c1f2b',
      '--app-surface-2': '#262a3a',
      '--app-surface-3': '#303547',
      '--app-border': '#333a4d',
      '--app-text': '#e6e8f0',
      '--app-text-dim': '#9aa0b4',
      '--app-text-faint': '#6b7186',
      '--app-accent': '#6366f1',
      '--app-good': '#34d399',
      '--app-warn': '#fbbf24',
      '--app-bad': '#f87171',
    },
  },
  parchment: {
    id: 'parchment',
    name: 'Parchment',
    polarity: 'light',
    tokens: {
      '--app-bg': '#ece3d0',
      '--app-surface': '#f5eedd',
      '--app-surface-2': '#e6d9bd',
      '--app-surface-3': '#dccaa3',
      '--app-border': '#c9b78f',
      '--app-text': '#3a2f23',
      '--app-text-dim': '#7a6a52',
      '--app-text-faint': '#a3927a',
      '--app-accent': '#8a2d2d',
      '--app-good': '#5a7d34',
      '--app-warn': '#9c6b12',
      '--app-bad': '#9b2c2c',
    },
  },
  daylight: {
    id: 'daylight',
    name: 'Daylight',
    polarity: 'light',
    tokens: {
      '--app-bg': '#f4f6fa',
      '--app-surface': '#ffffff',
      '--app-surface-2': '#eef1f6',
      '--app-surface-3': '#e3e8f0',
      '--app-border': '#d8dee8',
      '--app-text': '#1f2733',
      '--app-text-dim': '#67707f',
      '--app-text-faint': '#9aa3b2',
      '--app-accent': '#2563eb',
      '--app-good': '#15803d',
      '--app-warn': '#b45309',
      '--app-bad': '#b91c1c',
    },
  },
  nocturne: {
    id: 'nocturne',
    name: 'Nocturne',
    polarity: 'dark',
    tokens: {
      '--app-bg': '#000000',
      '--app-surface': '#0c0e12',
      '--app-surface-2': '#15181f',
      '--app-surface-3': '#1e222c',
      '--app-border': '#242a33',
      '--app-text': '#e8edf2',
      '--app-text-dim': '#8b94a3',
      '--app-text-faint': '#5b6473',
      '--app-accent': '#14b8a6',
      '--app-good': '#22d3ee',
      '--app-warn': '#f59e0b',
      '--app-bad': '#fb7185',
    },
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    polarity: 'dark',
    tokens: {
      '--app-bg': '#1a1413',
      '--app-surface': '#241a18',
      '--app-surface-2': '#2f2220',
      '--app-surface-3': '#3a2b28',
      '--app-border': '#4a3531',
      '--app-text': '#f1e6e0',
      '--app-text-dim': '#b79a90',
      '--app-text-faint': '#7e655d',
      '--app-accent': '#e2562d',
      '--app-good': '#9aa83f',
      '--app-warn': '#f0a830',
      '--app-bad': '#ef4444',
    },
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    polarity: 'dark',
    tokens: {
      '--app-bg': '#0f150f',
      '--app-surface': '#18211a',
      '--app-surface-2': '#212d22',
      '--app-surface-3': '#2b3a2d',
      '--app-border': '#324234',
      '--app-text': '#e4ede2',
      '--app-text-dim': '#93a690',
      '--app-text-faint': '#637061',
      '--app-accent': '#c9a227',
      '--app-good': '#6bbf59',
      '--app-warn': '#d9a441',
      '--app-bad': '#d9534f',
    },
  },
  arcane: {
    id: 'arcane',
    name: 'Arcane',
    polarity: 'dark',
    tokens: {
      '--app-bg': '#140f1f',
      '--app-surface': '#1d1630',
      '--app-surface-2': '#281d40',
      '--app-surface-3': '#33264f',
      '--app-border': '#3c2d5e',
      '--app-text': '#ece6f7',
      '--app-text-dim': '#a596c4',
      '--app-text-faint': '#6f6293',
      '--app-accent': '#a855f7',
      '--app-good': '#34d399',
      '--app-warn': '#fbbf24',
      '--app-bad': '#fb7185',
    },
  },
  contrast: {
    id: 'contrast',
    name: 'High contrast',
    polarity: 'dark',
    tokens: {
      '--app-bg': '#000000',
      '--app-surface': '#0a0a0a',
      '--app-surface-2': '#161616',
      '--app-surface-3': '#222222',
      '--app-border': '#ffffff',
      '--app-text': '#ffffff',
      '--app-text-dim': '#d0d0d0',
      '--app-text-faint': '#9a9a9a',
      '--app-accent': '#ffd400',
      '--app-good': '#00e676',
      '--app-warn': '#ffd400',
      '--app-bad': '#ff5252',
    },
  },
};

export const themeList: Theme[] = Object.values(themes);
