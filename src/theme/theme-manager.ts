/*
 * Theme manager — applies the active palette + style + accent to <html>,
 * persists the choice, and derives contrast-safe accent text and a hover shade.
 *
 * This is the only module that touches the DOM's CSS variables. Components and
 * the rest of the app just call setTheme / setStyle / setAccent.
 */
import { themes } from './themes';
import { styles } from './styles';
import { fonts } from './fonts';

const STORAGE_KEY = 'pf2e-codex.appearance';

export interface AppearanceState {
  themeId: string;
  styleId: string;
  fontId: string;
  /** Hex accent override, or null to use the active theme's own accent. */
  accent: string | null;
}

const DEFAULT: AppearanceState = { themeId: 'midnight', styleId: 'modern', fontId: 'system', accent: null };

let state: AppearanceState = { ...DEFAULT };

/**
 * Device-level override for the consumable-highlight colour, or null to use the active theme's
 * recommended value. Kept here (not in AppearanceState) because it's a device pref persisted by the
 * prefs module — prefs pushes it in via setConsumableColorOverride so applyAppearance can bake the
 * effective colour into the --app-consumable CSS variable alongside the rest of the palette.
 */
let consumableOverride: string | null = null;

function loadState(): AppearanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AppearanceState>;
      return {
        themeId: p.themeId && themes[p.themeId] ? p.themeId : DEFAULT.themeId,
        styleId: p.styleId && styles[p.styleId] ? p.styleId : DEFAULT.styleId,
        fontId: p.fontId && fonts[p.fontId] ? p.fontId : DEFAULT.fontId,
        accent: typeof p.accent === 'string' ? p.accent : null,
      };
    }
  } catch {
    /* fall through to default */
  }
  return { ...DEFAULT };
}

function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick near-black or white text for legibility on a given accent fill. */
function textOn(hex: string): string {
  return relativeLuminance(hex) > 0.45 ? '#101013' : '#ffffff';
}

/** Lighten (amount > 0) or darken (amount < 0) a hex color toward white/black. */
function shift(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  const to2 = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const [r, g, b] = hexToRgb(hex).map((v) => v + (target - v) * a);
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function setVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Write the current appearance state onto <html>. */
export function applyAppearance(): void {
  const theme = themes[state.themeId] ?? themes[DEFAULT.themeId];
  const style = styles[state.styleId] ?? styles[DEFAULT.styleId];
  const font = fonts[state.fontId] ?? fonts[DEFAULT.fontId];

  setVars(theme.tokens);
  setVars(style.tokens);
  setVars({ '--app-font': font.stack });

  const accent = state.accent ?? theme.tokens['--app-accent'];
  setVars({
    '--app-accent': accent,
    '--app-accent-text': textOn(accent),
    '--app-accent-hover': shift(accent, theme.polarity === 'light' ? -0.12 : 0.14),
    '--app-focus': accent,
  });

  // Consumable-card highlight: device override wins, else the theme's recommended colour.
  setVars({ '--app-consumable': consumableOverride ?? theme.consumableColor });

  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.polarity = theme.polarity;
  root.style.colorScheme = theme.polarity;
}

/** The active theme's recommended consumable-highlight colour (ignores any user override). */
export function themeConsumableColor(): string {
  const theme = themes[state.themeId] ?? themes[DEFAULT.themeId];
  return theme.consumableColor;
}

/**
 * Set (hex) or clear (null) the device-level consumable-colour override and re-apply. Called by the
 * prefs module whenever prefs.consumableColor changes so the CSS variable stays in sync.
 */
export function setConsumableColorOverride(color: string | null): void {
  consumableOverride = color;
  applyAppearance();
}

/** Load persisted state and apply it. Call once before first paint. */
export function initTheme(): void {
  state = loadState();
  applyAppearance();
}

export function getAppearance(): AppearanceState {
  return { ...state };
}

export function setTheme(themeId: string): void {
  if (!themes[themeId]) return;
  state = { ...state, themeId };
  saveState();
  applyAppearance();
}

export function setStyle(styleId: string): void {
  if (!styles[styleId]) return;
  state = { ...state, styleId };
  saveState();
  applyAppearance();
}

export function setFont(fontId: string): void {
  if (!fonts[fontId]) return;
  state = { ...state, fontId };
  saveState();
  applyAppearance();
}

/** Pass a hex to override the accent, or null to fall back to the theme's accent. */
export function setAccent(accent: string | null): void {
  state = { ...state, accent };
  saveState();
  applyAppearance();
}
