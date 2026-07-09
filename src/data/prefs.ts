import { useEffect, useState } from 'react';
import { touchSettings } from './syncBus';

/*
 * Device-global preferences that are NOT part of the per-character sheet customization system. These
 * apply device-wide and can't sensibly differ per character: popup-resize memory, the builder's niche
 * sources shelf, pinned modes, and the dismissed-update marker. Everything that customizes how a
 * character's SHEET looks/behaves now lives in data/customization.ts (global default + per-character
 * override). Persisted + reactive via subscribe; set from Settings; read via usePrefs().
 */

export interface Prefs {
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
  /** Release tag (e.g. "v0.1.5") whose update banner the user dismissed — that version never re-nags. */
  dismissedUpdate?: string;
}

const STORAGE_KEY = 'pf2e-codex.prefs';
const DEFAULTS: Prefs = { popupSizeSync: false, showNicheSources: false, pinnedModes: [] };

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

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (prefs[key] === value) return;
  prefs = { ...prefs, [key]: value };
  save();
  touchSettings(); // prefs are a synced setting — stamp + nudge cloud upload
  for (const l of listeners) l(prefs);
}

/** Re-read prefs from storage and notify subscribers — used after cloud sync overwrites them. */
export function reloadPrefs(): void {
  initPrefs();
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
}

/** Reactively read the current prefs in a component. */
export function usePrefs(): Prefs {
  const [p, setP] = useState(getPrefs);
  useEffect(() => subscribePrefs(setP), []);
  return p;
}
