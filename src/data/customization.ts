import { createContext, useContext, useEffect, useState } from 'react';
import type { Customization, SheetDensity } from '../rules/types';
import { setConsumableColorOverride } from '../theme/theme-manager';
import { touchCustomization } from './syncBus';

/*
 * Sheet customization — a single option set used two ways:
 *   1. a device-GLOBAL default (this module's store), the baseline for every character; and
 *   2. per-character OVERRIDES (Character.customization), a partial layered on top.
 *
 * The GLOBAL default is edited in Settings → Customization; per-character overrides in the Customize
 * page (hamburger → Customize). effectiveCustomization(global, override) resolves what a given
 * character actually shows. The global store mirrors prefs.ts: localStorage-persisted, reactive via
 * subscribe, synced (touchSettings), and applied to the DOM for the bits that are global CSS.
 */

const STORAGE_KEY = 'pf2e-codex.customization';

/** The baseline value of every option (used when neither the global default nor an override sets it). */
export const DEFAULT_CUSTOMIZATION: Customization = {
  portraitShape: 'circle',
  showLevelChip: true,
  showSubline: true,
  plusOnMods: true,
  showSaveDCs: false,
  autoHideEmpty: false,
  hpCommandEntry: false,
  compactActions: true,
  showSlotBadges: true,
  consumableHighlight: true,
  scrollbarAccent: false,
};

/** The natural (unconfigured) order of the vitals-rail cards. */
export const DEFAULT_RAIL_ORDER = ['hp', 'saves', 'movement', 'defenses', 'resources', 'panache', 'champion', 'mythic', 'conditions', 'languages'];

/** The desktop sheet tabs, in order — the single source of truth shared by the sheet + Customize editor. */
export const SHEET_TABS = ['Main', 'Spells', 'Inventory', 'Feats & features', 'Companions', 'Notes', 'Details'];
/** Tabs that may be hidden (Main is always shown). */
export const HIDEABLE_TABS = SHEET_TABS.filter((t) => t !== 'Main');

/** Human labels for the rail cards, for the Customize editor. */
export const RAIL_CARD_LABELS: Record<string, string> = {
  hp: 'Hit points & defenses',
  saves: 'Saves & perception',
  movement: 'Hero points & movement',
  defenses: 'Resistances, weaknesses, immunities',
  resources: 'Class resources',
  panache: 'Panache (swashbuckler)',
  champion: 'Cause (champion)',
  mythic: 'Mythic (calling & destiny)',
  conditions: 'Conditions',
  languages: 'Languages',
};

/** Map a density to the Style whose spacing tokens it borrows (null = follow the app Style). */
export function densityStyleId(d?: SheetDensity): string | null {
  return d === 'comfortable' ? 'modern' : d === 'compact' ? 'compact' : d === 'cozy' ? 'cozy' : null;
}

/** The global default, layered over the baseline, with a character's overrides on top. Arrays are
 *  replaced (not merged) so a customized rail order/hidden set wholly wins. */
export function effectiveCustomization(global: Customization, override?: Customization | null): Customization {
  return { ...DEFAULT_CUSTOMIZATION, ...global, ...(override ?? {}) };
}

/** The appearance axes whose DEVICE-level home is theme-manager/zoom (not the global customization blob).
 *  A character override MAY carry them, but the global default must NOT — else a leaked/legacy value would
 *  silently override every non-customized sheet with no way to clear it from the UI. */
const APPEARANCE_AXES = ['themeId', 'styleId', 'fontId', 'zoom', 'accentColor'] as const;

/** Return a copy of a customization with the device-level appearance axes removed (for the GLOBAL blob). */
export function stripAppearanceAxes(c: Customization): Customization {
  const out = { ...c };
  for (const k of APPEARANCE_AXES) delete out[k];
  return out;
}

/** True when an override carries nothing (so the character follows the global default entirely). An
 *  explicit empty array (e.g. railHidden: []) is a real override — "hide nothing" beats a non-empty
 *  global default — so it does NOT count as empty. */
export function isCustomizationEmpty(override?: Customization | null): boolean {
  if (!override) return true;
  return Object.values(override).every((v) => v === undefined);
}

/** Pure setter for a per-character override: returns a new partial with `key` set (or removed when the
 *  value is undefined). Used by the Customize page to edit Character.customization. */
export function withCustomizationField<K extends keyof Customization>(
  override: Customization | undefined,
  key: K,
  value: Customization[K] | undefined,
): Customization {
  const next: Customization = { ...(override ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

let globalCustom: Customization = { ...DEFAULT_CUSTOMIZATION };
const listeners = new Set<(c: Customization) => void>();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(globalCustom));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function getGlobalCustomization(): Customization {
  return globalCustom;
}

/** Apply the global-default options that drive global CSS: the accent-scrollbar class on <html> and the
 *  consumable-highlight colour baked into --app-consumable. (Per-character overrides re-apply these via
 *  the sheet overlay while a character is open; this is the baseline used everywhere else.) */
export function applyGlobalCustomizationDom(): void {
  try {
    document.documentElement.classList.toggle('sb-accent', !!globalCustom.scrollbarAccent);
    setConsumableColorOverride(globalCustom.consumableColor ?? null);
  } catch {
    /* no DOM — non-fatal */
  }
}

export function setGlobalCustomization(next: Customization): void {
  // The global default never carries the device-level appearance axes (they live in theme-manager/zoom).
  globalCustom = stripAppearanceAxes(next);
  save();
  touchCustomization(); // synced on its OWN timestamp (independent of prefs/appearance) — stamp + nudge upload
  applyGlobalCustomizationDom();
  for (const l of listeners) l(globalCustom);
}

/** Set a single field of the global default. */
export function setGlobalCustomizationField<K extends keyof Customization>(key: K, value: Customization[K] | undefined): void {
  setGlobalCustomization(withCustomizationField(globalCustom, key, value));
}

export function subscribeCustomization(fn: (c: Customization) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Seed the global default from the pre-existing device prefs, the FIRST time this runs (before the
 *  customization store existed, these lived in pf2e-codex.prefs). Keeps a user's compact-actions /
 *  quick-HP / consumable choices when they upgrade. */
function migrateFromPrefs(): Customization {
  const out: Customization = {};
  try {
    const raw = localStorage.getItem('pf2e-codex.prefs');
    if (!raw) return out;
    const p = JSON.parse(raw) as Record<string, unknown>;
    for (const k of ['hpCommandEntry', 'compactActions', 'showSlotBadges', 'consumableHighlight', 'scrollbarAccent'] as const) {
      if (typeof p[k] === 'boolean') out[k] = p[k] as boolean;
    }
    if (typeof p.consumableColor === 'string') out.consumableColor = p.consumableColor;
  } catch {
    /* ignore */
  }
  return out;
}

/** Load persisted global customization (migrating from prefs on first run). Call once before paint. */
export function initCustomization(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Strip any device-level appearance axes that leaked in from a legacy build / synced blob / backup,
      // so they can't override every non-customized sheet.
      globalCustom = stripAppearanceAxes({ ...DEFAULT_CUSTOMIZATION, ...(JSON.parse(raw) as Partial<Customization>) });
    } else {
      globalCustom = stripAppearanceAxes({ ...DEFAULT_CUSTOMIZATION, ...migrateFromPrefs() });
      save(); // persist the migrated defaults so this only happens once
    }
  } catch {
    globalCustom = { ...DEFAULT_CUSTOMIZATION };
  }
  applyGlobalCustomizationDom();
}

/** Re-read the global customization from storage and notify subscribers — used after cloud sync
 *  overwrites it. */
export function reloadCustomization(): void {
  initCustomization();
  for (const l of listeners) l(globalCustom);
}

/** Reactively read the device-global customization default. */
export function useGlobalCustomization(): Customization {
  const [c, setC] = useState(getGlobalCustomization);
  useEffect(() => subscribeCustomization(setC), []);
  return c;
}

/** The EFFECTIVE customization for the character currently being viewed (global default + that
 *  character's overrides), provided by App around the sheet. Defaults to the baseline off-sheet. */
export const CustomizationContext = createContext<Customization>(DEFAULT_CUSTOMIZATION);

/** Read the effective customization for the current character (from the sheet's provider). */
export function useCustomization(): Customization {
  return useContext(CustomizationContext);
}
