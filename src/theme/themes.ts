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
  /**
   * Recommended highlight colour for consumable inventory cards (the left accent border + faint tint).
   * Picked per-theme to harmonise with the palette while reading clearly against the card surface and
   * staying distinct from the accent (used for the invested/equipped highlight). A device-level user
   * override (prefs.consumableColor) supersedes this when set.
   */
  consumableColor: string;
}

export const themes: Record<string, Theme> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    polarity: 'dark',
    consumableColor: '#f0b429',
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
    consumableColor: '#2f8f83',
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
    consumableColor: '#c2740c',
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
    consumableColor: '#f0a53a',
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
    consumableColor: '#4ec9c0',
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
    consumableColor: '#e08a5a',
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
    consumableColor: '#f0b429',
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
    consumableColor: '#00e5ff',
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
  slate: {
    id: 'slate',
    name: 'Slate',
    polarity: 'dark',
    consumableColor: '#f0a832',
    tokens: {
      '--app-bg': '#0f1419',
      '--app-surface': '#171d26',
      '--app-surface-2': '#212934',
      '--app-surface-3': '#2c3642',
      '--app-border': '#374252',
      '--app-text': '#e3e8ef',
      '--app-text-dim': '#94a1b2',
      '--app-text-faint': '#647084',
      '--app-accent': '#38bdf8',
      '--app-good': '#34d399',
      '--app-warn': '#fbbf24',
      '--app-bad': '#f87171',
    },
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson',
    polarity: 'dark',
    consumableColor: '#37c0a8',
    tokens: {
      '--app-bg': '#160f12',
      '--app-surface': '#211519',
      '--app-surface-2': '#2e1d23',
      '--app-surface-3': '#3b262d',
      '--app-border': '#4d2f38',
      '--app-text': '#f2e3e6',
      '--app-text-dim': '#bd97a0',
      '--app-text-faint': '#856068',
      '--app-accent': '#e11d48',
      '--app-good': '#34d399',
      '--app-warn': '#fbbf24',
      '--app-bad': '#fb7185',
    },
  },
  royal: {
    id: 'royal',
    name: 'Royal',
    polarity: 'dark',
    consumableColor: '#5ab0f0',
    tokens: {
      '--app-bg': '#0e1024',
      '--app-surface': '#181a35',
      '--app-surface-2': '#222547',
      '--app-surface-3': '#2d3159',
      '--app-border': '#383d6e',
      '--app-text': '#e8e9fb',
      '--app-text-dim': '#9ea2cf',
      '--app-text-faint': '#686d9c',
      '--app-accent': '#eab308',
      '--app-good': '#34d399',
      '--app-warn': '#fbbf24',
      '--app-bad': '#fb7185',
    },
  },
  sage: {
    id: 'sage',
    name: 'Sage',
    polarity: 'light',
    consumableColor: '#b06a1f',
    tokens: {
      '--app-bg': '#e8ede3',
      '--app-surface': '#f3f6ee',
      '--app-surface-2': '#dde6d3',
      '--app-surface-3': '#cdd9c0',
      '--app-border': '#b5c4a5',
      '--app-text': '#2a3327',
      '--app-text-dim': '#5f6e57',
      '--app-text-faint': '#8a9880',
      '--app-accent': '#3f7d56',
      '--app-good': '#3b7d34',
      '--app-warn': '#a06b12',
      '--app-bad': '#b3372e',
    },
  },
  mono: {
    id: 'mono',
    name: 'Mono',
    polarity: 'dark',
    consumableColor: '#d99a2b',
    tokens: {
      '--app-bg': '#121212',
      '--app-surface': '#1b1b1b',
      '--app-surface-2': '#262626',
      '--app-surface-3': '#323232',
      '--app-border': '#3d3d3d',
      '--app-text': '#ededed',
      '--app-text-dim': '#a0a0a0',
      '--app-text-faint': '#6e6e6e',
      '--app-accent': '#d4d4d4',
      '--app-good': '#22c55e',
      '--app-warn': '#eab308',
      '--app-bad': '#ef4444',
    },
  },

  /*
   * ── Ported palettes ────────────────────────────────────────────────────────
   * Six looks carried over from the owner's original PF2 initiative tracker so
   * the two apps can wear the same colours. Each surface/text/accent value is
   * that theme's own token from the tracker's CSS; the semantic trio is mapped
   * good = its hp-full, bad = its danger, warn = its hp-mid — the "wounded"
   * step, which is where each palette already keeps its caution colour (gold in
   * Tavern and Obsidian, mustard in Verdant Grove). Graveyard and Stellar are
   * the exception: their hp-mid is just the accent again, a pale moss and a
   * cyan, neither of which reads as caution, so those two take their `--linked`
   * (bone gold / amber) instead. Goatval has no warm colour anywhere in its
   * source and gets one mixed for it — see its `--app-warn`.
   * `--app-border` is its translucent border-strong flattened onto its panel,
   * because HH's border token is opaque.
   */
  tavern: {
    id: 'tavern',
    name: 'Tavern',
    polarity: 'dark',
    consumableColor: '#82a89a',
    tokens: {
      '--app-bg': '#161011',
      '--app-surface': '#1e1617',
      '--app-surface-2': '#271c1d',
      '--app-surface-3': '#2f2324',
      '--app-border': '#463522',
      '--app-text': '#f0e6d6',
      '--app-text-dim': '#9b8a7e',
      '--app-text-faint': '#7d6e62',
      '--app-accent': '#d4a14a',
      '--app-good': '#8fb56a',
      '--app-warn': '#d4a14a',
      '--app-bad': '#c66a5a',
    },
  },
  graveyard: {
    id: 'graveyard',
    name: 'Graveyard',
    polarity: 'dark',
    consumableColor: '#b8a886',
    tokens: {
      '--app-bg': '#0c1014',
      '--app-surface': '#141a1f',
      '--app-surface-2': '#1f272c',
      '--app-surface-3': '#2a3338',
      '--app-border': '#353f3a',
      '--app-text': '#d6dcd2',
      '--app-text-dim': '#909c95',
      '--app-text-faint': '#69756f',
      '--app-accent': '#a8c098',
      '--app-good': '#8aa888',
      '--app-warn': '#b8a886',
      '--app-bad': '#cc6a64',
    },
  },
  stellar: {
    id: 'stellar',
    name: 'Stellar',
    polarity: 'dark',
    consumableColor: '#ffb454',
    tokens: {
      '--app-bg': '#050a14',
      '--app-surface': '#0a1424',
      '--app-surface-2': '#122036',
      '--app-surface-3': '#1a2c45',
      '--app-border': '#1c3e4f',
      '--app-text': '#cfe6f3',
      '--app-text-dim': '#7e9cba',
      '--app-text-faint': '#566b88',
      '--app-accent': '#5cd2e6',
      '--app-good': '#5ee0a0',
      '--app-warn': '#ffb454',
      '--app-bad': '#ff5470',
    },
  },
  verdant: {
    id: 'verdant',
    name: 'Verdant Grove',
    polarity: 'light',
    consumableColor: '#7a6a4a',
    tokens: {
      '--app-bg': '#ebe5c8',
      '--app-surface': '#f3eed8',
      '--app-surface-2': '#d8cfa8',
      '--app-surface-3': '#c8c098',
      '--app-border': '#b8c09b',
      '--app-text': '#2a3a1a',
      '--app-text-dim': '#44502b',
      '--app-text-faint': '#6a5a3a',
      '--app-accent': '#4a6b2a',
      '--app-good': '#4a6b2a',
      '--app-warn': '#7a5614',
      '--app-bad': '#a04020',
    },
  },
  goatval: {
    id: 'goatval',
    name: 'Goatval',
    polarity: 'dark',
    consumableColor: '#15a883',
    tokens: {
      '--app-bg': '#0a171b',
      '--app-surface': '#15262d',
      '--app-surface-2': '#28373e',
      '--app-surface-3': '#344750',
      '--app-border': '#304149',
      '--app-text': '#e7f3ee',
      '--app-text-dim': '#9fb2b6',
      '--app-text-faint': '#6e848c',
      '--app-accent': '#3df0c6',
      '--app-good': '#3dc89e',
      // Goatval is the one ported palette with no warm colour at all — its hp-mid is Mistfall, an ash
      // slate, so mapping it to warn painted every caution badge grey. This is a candle-amber mixed
      // for it: warm enough to read as caution beside the rose danger (#d56b74), muted enough not to
      // compete with Wraithglow. 8.36:1 on its bg, 7.14:1 on its panel.
      '--app-warn': '#e0a458',
      '--app-bad': '#d56b74',
    },
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    polarity: 'dark',
    consumableColor: '#74b4e4',
    tokens: {
      '--app-bg': '#0c0d0f',
      '--app-surface': '#141518',
      '--app-surface-2': '#1e2024',
      '--app-surface-3': '#2c2e32',
      '--app-border': '#3a3a3d',
      '--app-text': '#e8eaee',
      '--app-text-dim': '#9ca3ad',
      '--app-text-faint': '#787f89',
      '--app-accent': '#f0a830',
      '--app-good': '#7ec96a',
      '--app-warn': '#f0a830',
      '--app-bad': '#f0564f',
    },
  },
};

/**
 * Retired palette ids → the palette that took their place.
 *
 * A ported palette that measured as very similar to an existing one (ΔE76 ≤ 10 on bg, surface, text
 * AND accent, same polarity) replaced it rather than sitting next to it as a near-duplicate. The old
 * id keeps working: anything that was saved naming it — the device appearance, a character's
 * customization override — resolves here instead of falling back to the default palette, so nobody
 * opens the app to a theme they never chose. Resolution is for PAINTING only; the stored id is left
 * as the user saved it, because appearance syncs across devices that may be on different builds (see
 * loadState in theme-manager.ts).
 *
 *   abyss (deep navy + cyan) → stellar (ΔE bg 3.8 / surface 5.1 / text 4.3 / accent 7.2)
 */
export const themeAliases: Record<string, string> = {
  abyss: 'stellar',
};

/** The palette for an id, following a retired id to its replacement. Undefined if it is neither. */
export function getTheme(id: string | null | undefined): Theme | undefined {
  if (!id) return undefined;
  return themes[id] ?? themes[themeAliases[id]];
}

export const themeList: Theme[] = Object.values(themes);
