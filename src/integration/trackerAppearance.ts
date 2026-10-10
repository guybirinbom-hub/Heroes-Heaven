import { useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { getAppearance, resolveAppearanceVars, type AppearanceState } from '../theme/theme-manager';

/*
 * The campaign tracker's OWN look — the GM themes their view without changing anything else.
 *
 * WHY THIS EXISTS, and why it is NOT the global appearance:
 *  - The global appearance (theme-manager, `pf2e-codex.appearance`) styles the WHOLE app, including
 *    the GM's own character sheets in the builder. The GM asked for a theme that only affects the
 *    tracker, not their character sheets — so this is a separate, tracker-only appearance.
 *  - It is DEVICE-LOCAL and never synced. A player's characters travel through the campaign/party
 *    sync; appearance never does. So whatever the GM picks here reaches no player.
 *
 * `null` means "never customised" → inherit the global appearance (apply no override). The first time
 * the GM changes any axis, the state is seeded from the current global appearance so they tweak from
 * where they already are, rather than a blank default.
 *
 * Only style/theme axes (palette · style · font · accent) — deliberately NOT layout/rail-order/tab
 * hiding. This is a look, not a re-layout.
 *
 * Part of the removable seam; see ./README.md.
 */

const KEY = 'pf2e-codex.tracker-appearance';

let state: AppearanceState | null = load();
const listeners = new Set<() => void>();

function load(): AppearanceState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<AppearanceState>;
    if (!p || typeof p !== 'object') return null;
    // A partial/garbage value shouldn't crash the tracker — fall back to inherit.
    if (typeof p.themeId !== 'string') return null;
    return {
      themeId: p.themeId,
      styleId: typeof p.styleId === 'string' ? p.styleId : 'modern',
      fontId: typeof p.fontId === 'string' ? p.fontId : 'system',
      accent: typeof p.accent === 'string' ? p.accent : null,
    };
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function set(next: AppearanceState | null): void {
  state = next;
  persist();
  for (const l of listeners) l();
}

/** Seed from the global appearance the first time any axis is set, so edits start from "as it is now". */
function base(): AppearanceState {
  return state ?? { ...getAppearance() };
}

export const trackerAppearance = {
  getState: (): AppearanceState | null => state,
  setTheme: (themeId: string) => set({ ...base(), themeId }),
  setStyle: (styleId: string) => set({ ...base(), styleId }),
  setFont: (fontId: string) => set({ ...base(), fontId }),
  /** Hex to override the accent, or null to use the chosen theme's own accent. */
  setAccent: (accent: string | null) => set({ ...base(), accent }),
  /** Back to inheriting the global appearance (no override). */
  reset: () => set(null),
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** The tracker's appearance override, or null when it inherits the global appearance. Reactive. */
export function useTrackerAppearance(): AppearanceState | null {
  return useSyncExternalStore(trackerAppearance.subscribe, trackerAppearance.getState, trackerAppearance.getState);
}

/**
 * The CSS variables to paint the tracker with, or null when it inherits the global appearance (so the
 * caller applies nothing and the document's own variables show through). Consumable colour is left to
 * the global default here — it's a device pref, not part of a tracker look.
 *
 * ONE OBJECT PER APPEARANCE STATE (memoised on it): the map also reaches every tracker popup drawn on
 * <body> through the host theme context, and a fresh object per render would re-render each of them
 * every time the tracker view did.
 */
export function useTrackerVars(): CSSProperties | null {
  const app = useTrackerAppearance();
  return useMemo(
    () =>
      app
        ? // The vars are all CSS custom properties (`--app-*`) — a plain string map, which React accepts
          // as an inline style but @types/react types with a `--${string}` index, so cast through unknown.
          (resolveAppearanceVars(app.themeId, app.styleId, app.fontId, app.accent, null).vars as unknown as CSSProperties)
        : null,
    [app],
  );
}

/**
 * A set of appearance variables made WEARABLE by a Heroes Heaven wrapper: the variables plus the four
 * text properties <body> sets — or undefined for null (nothing to re-theme). Two uses: an HH surface
 * drawn on <body> from inside the tracker wears the TRACKER's (`vars` = the tracker's: the
 * Search-everything description popup, a confirm the tracker raises), and the full review sheet inside
 * the tracker wears the APP's (`vars` = the global ones, CampaignTracker's `fullSheetRevert`).
 *
 * The variables alone are not enough: `color` and `font-family` INHERIT as finished values. <body>
 * computed its own once, from the global variables (src/theme/tokens.css), and `.tracker-root` computed
 * its own from the tracker's. So a wrapper carrying only `--app-*` keeps its parent's text colour and
 * font — light text on a light panel, with a light tracker palette over a dark app; the tracker's font
 * on the review sheet. The wrapper re-declares the four text properties, so they resolve again from the
 * variables on the wrapper itself. (The tracker's OWN body portals don't need this: its
 * `:where(.tracker-root)` rules re-declare colour and font from its variables — see BodyPortal.)
 */
export function hhSurfaceTheme(vars: CSSProperties | null): CSSProperties | undefined {
  return vars ? { ...vars, color: 'var(--app-text)', fontFamily: 'var(--app-font)', fontSize: 14, lineHeight: 1.5 } : undefined;
}

/**
 * The GLOBAL appearance's CSS variables — applied to the embedded character sheets so they keep the
 * app's normal look even when the tracker around them is re-themed. Only meaningful (and only applied
 * by callers) when the tracker HAS an override; otherwise the sheets already inherit the document.
 */
export function useGlobalVars(): CSSProperties {
  const g = getAppearance();
  return resolveAppearanceVars(g.themeId, g.styleId, g.fontId, g.accent, null).vars as unknown as CSSProperties;
}
