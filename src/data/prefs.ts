import { useEffect, useState } from 'react';
import { setConsumableColorOverride } from '../theme/theme-manager';

/*
 * Device-global UI customization preferences — apply to every character on this device, persisted
 * and reactive via subscribe (mirrors the zoom module). Set from Settings → Customization; read by
 * the components they affect through the usePrefs() hook.
 */

export interface Prefs {
  /** Replace the HP Damage/Heal buttons + the Temp-HP input with a single command field: type a
   *  number = damage, -N = heal, tN = temp HP, then Enter. The current-HP field stays for manual edits. */
  hpCommandEntry: boolean;
  /** Render the Actions list as compact chips (action name + cost glyph) that open a description
   *  popup on click, instead of one full row (with the description inline) per action — fits far
   *  more actions per row. The pin star lives inside the popup. */
  compactActions: boolean;
  /** When on, resizing any popup makes that size apply to ALL popups (saved on this device) until
   *  changed again. Off (default) = each popup resizes on its own and reopens at the default size. */
  popupSizeSync: boolean;
  /** The shared popup size, captured from a resize while popupSizeSync is on. */
  popupSize?: { w: number; h: number };
  /** Reveal the builder's "Other" Sources shelf — the niche grab-bag of Society scenarios, blog
   *  articles, and Free RPG Day specials. Hidden by default to keep the source list short. */
  showNicheSources: boolean;
  /** Mode ids the user pinned to the top of the Modes panel. A pinned mode always shows, even when
   *  it would otherwise be hidden (gated archetype mode with "Show all" off). Device-global. */
  pinnedModes: string[];
  /** Use the brand-accent scrollbar instead of the default thin neutral one (toggles :root.sb-accent). */
  scrollbarAccent: boolean;
  /** Show an available/total slot badge on each spell rank tab (phone Spells page). Default on. */
  showSlotBadges: boolean;
  /** Release tag (e.g. "v0.1.5") whose update banner the user dismissed — that version never re-nags. */
  dismissedUpdate?: string;
  /** Override hex for the consumable inventory-card highlight. Absent = use the active theme's
   *  recommended consumableColor (see src/theme/themes.ts). Drives the --app-consumable CSS variable
   *  via theme-manager.setConsumableColorOverride. */
  consumableColor?: string;
}

const STORAGE_KEY = 'pf2e-codex.prefs';
const DEFAULTS: Prefs = { hpCommandEntry: false, compactActions: true, popupSizeSync: false, showNicheSources: false, pinnedModes: [], scrollbarAccent: false, showSlotBadges: true };

let prefs: Prefs = { ...DEFAULTS };
const listeners = new Set<(p: Prefs) => void>();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function getPrefs(): Prefs {
  return prefs;
}

/** Apply the prefs that drive global CSS (the accent-scrollbar class on <html>, the consumable-colour
 *  override baked into --app-consumable by the theme manager). */
function applyDomPrefs(): void {
  try {
    document.documentElement.classList.toggle('sb-accent', prefs.scrollbarAccent);
    setConsumableColorOverride(prefs.consumableColor ?? null);
  } catch {
    /* no DOM — non-fatal */
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (prefs[key] === value) return;
  prefs = { ...prefs, [key]: value };
  save();
  applyDomPrefs();
  for (const l of listeners) l(prefs);
}

/** Pin/unpin a mode id (toggles its presence in prefs.pinnedModes). */
export function togglePinnedMode(id: string): void {
  const cur = prefs.pinnedModes ?? [];
  setPref('pinnedModes', cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}

export function subscribePrefs(fn: (p: Prefs) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Load persisted prefs. Call once before first paint. */
export function initPrefs(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    prefs = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULTS };
  } catch {
    prefs = { ...DEFAULTS };
  }
  applyDomPrefs();
}

/** Reactively read the current prefs in a component. */
export function usePrefs(): Prefs {
  const [p, setP] = useState(getPrefs);
  useEffect(() => subscribePrefs(setP), []);
  return p;
}
