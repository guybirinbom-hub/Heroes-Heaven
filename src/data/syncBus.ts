// Tiny decoupling layer so localStorage-mutating modules (prefs, theme, homebrew, modes) can nudge
// cloud sync to upload — WITHOUT importing cloudSync (which would create import cycles). cloudSync
// registers the handler; everyone else just calls markLocalDataChanged(). No-op when sync is off.

const SETTINGS_TS_KEY = 'wanderers-codex:settings-updated:v1';
const CUSTOMIZATION_TS_KEY = 'wanderers-codex:customization-updated:v1';

let handler: (() => void) | null = null;

/** cloudSync registers this to hear about non-roster local changes (homebrew / modes / settings). */
export function onLocalDataChanged(cb: (() => void) | null): void {
  handler = cb;
}

/** Nudge cloud sync to schedule an upload (no-op when sync isn't running). */
export function markLocalDataChanged(): void {
  handler?.();
}

/** Last time device settings (prefs/appearance) changed — drives last-write-wins on sync. */
export function loadSettingsUpdated(): number {
  try {
    return Number(localStorage.getItem(SETTINGS_TS_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveSettingsUpdated(ts: number): void {
  try {
    localStorage.setItem(SETTINGS_TS_KEY, String(ts));
  } catch {
    /* non-fatal */
  }
}

/** Stamp settings as just-changed AND nudge an upload. Called by setPref + the appearance setters. */
export function touchSettings(): void {
  saveSettingsUpdated(Date.now());
  markLocalDataChanged();
}

/** Last time the global sheet-customization default changed. Kept SEPARATE from settings so a customization
 *  edit on one device can't be discarded by a more-recent theme/prefs edit on another (independent LWW). */
export function loadCustomizationUpdated(): number {
  try {
    return Number(localStorage.getItem(CUSTOMIZATION_TS_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveCustomizationUpdated(ts: number): void {
  try {
    localStorage.setItem(CUSTOMIZATION_TS_KEY, String(ts));
  } catch {
    /* non-fatal */
  }
}

/** Stamp the global customization default as just-changed AND nudge an upload. */
export function touchCustomization(): void {
  saveCustomizationUpdated(Date.now());
  markLocalDataChanged();
}
