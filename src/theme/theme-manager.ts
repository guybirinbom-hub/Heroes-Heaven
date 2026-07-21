/*
 * Theme manager — applies the active palette + style + accent to <html>,
 * persists the choice, and derives contrast-safe accent text and a hover shade.
 *
 * This is the only module that touches the DOM's CSS variables. Components and
 * the rest of the app just call setTheme / setStyle / setAccent.
 */
import { themes, type Polarity } from './themes';
import { styles } from './styles';
import { fonts } from './fonts';
import { touchSettings } from '../data/syncBus';

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
  touchSettings(); // appearance is a synced setting — stamp + nudge cloud upload
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

/**
 * Resolve a palette + style + font + accent + consumable colour into the flat map of CSS variables
 * that defines that appearance. The single source of truth for what an appearance IS — used to write
 * <html> (applyResolved) and to apply a scoped appearance to a subtree without touching the document
 * (the campaign tracker's own theme). Returns `data-theme`/`data-polarity` alongside the vars so a
 * caller applying this to an element can mirror what applyResolved sets on <html>.
 */
export function resolveAppearanceVars(
  themeId: string,
  styleId: string,
  fontId: string,
  accent: string | null,
  consumable: string | null,
): { vars: Record<string, string>; theme: string; polarity: Polarity } {
  const theme = themes[themeId] ?? themes[DEFAULT.themeId];
  const style = styles[styleId] ?? styles[DEFAULT.styleId];
  const font = fonts[fontId] ?? fonts[DEFAULT.fontId];
  const acc = accent ?? theme.tokens['--app-accent'];
  return {
    vars: {
      ...theme.tokens,
      ...style.tokens,
      '--app-font': font.stack,
      '--app-accent': acc,
      '--app-accent-text': textOn(acc),
      '--app-accent-hover': shift(acc, theme.polarity === 'light' ? -0.12 : 0.14),
      '--app-focus': acc,
      // Consumable-card highlight: override wins, else the theme's recommended colour.
      '--app-consumable': consumable ?? theme.consumableColor,
    },
    theme: theme.id,
    polarity: theme.polarity,
  };
}

/** Resolve a palette + style + font + accent + consumable colour onto <html>. Used both for the
 *  device-global appearance and for a per-character overlay (which passes overrides, falling back to
 *  the global state for anything unset). */
function applyResolved(themeId: string, styleId: string, fontId: string, accent: string | null, consumable: string | null): void {
  const { vars, theme, polarity } = resolveAppearanceVars(themeId, styleId, fontId, accent, consumable);
  setVars(vars);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.polarity = polarity;
  root.style.colorScheme = polarity;
}

/** Write the current (device-global) appearance state onto <html>. */
export function applyAppearance(): void {
  applyResolved(state.themeId, state.styleId, state.fontId, state.accent, consumableOverride);
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

/**
 * Overlay a specific character's customization onto <html> while their sheet is open, WITHOUT touching
 * the persisted global appearance state. Each field is applied only when set (a null/absent field
 * leaves the global value in place). To revert, the sheet calls applyGlobalCustomizationDom() (which
 * re-runs applyAppearance and resets every token to the global default). Values here come from
 * effectiveCustomization for the viewed character.
 */
export function applySheetOverlay(o: {
  themeId?: string | null;
  styleId?: string | null;
  fontId?: string | null;
  accent?: string | null;
  consumable?: string | null;
}): void {
  applyResolved(
    o.themeId ?? state.themeId,
    o.styleId ?? state.styleId,
    o.fontId ?? state.fontId,
    // Accent fallback: the DEVICE accent belongs to the device theme, so only inherit it when the theme
    // ISN'T overridden. When the character overrides the palette but leaves accent on inherit, pass null
    // so applyResolved uses that theme's OWN accent (no cross-theme accent bleed).
    o.accent ?? (o.themeId ? null : state.accent),
    o.consumable ?? consumableOverride,
  );
}
